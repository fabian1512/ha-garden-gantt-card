/**
 * Garden Gantt Card
 *
 * A year/month Gantt-style overview for one Home Assistant calendar entity.
 * Reads events live from the calendar REST API and renders them as colored
 * bars across a 12-month grid, optionally grouped (e.g. plant category).
 *
 * https://github.com/fabian1512/ha-garden-gantt-card
 */

const VERSION = "0.1.4";

const MONTHS_DE = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const DEFAULT_GROUP_COLORS = [
  "#4caf50", "#e91e63", "#ff9800", "#9c27b0", "#009688", "#3f51b5",
  "#795548", "#607d8b", "#8bc34a", "#f44336", "#00bcd4", "#cddc39",
];

const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const ymdhms = (d) => `${ymd(d)}T00:00:00`;

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function parseDate(value) {
  if (!value) return null;
  if (typeof value === "string") {
    // "2026-09-01" or "2026-09-01T08:00:00+02:00"
    const d = value.length <= 10 ? new Date(`${value}T00:00:00`) : new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
  if (value.date) return parseDate(value.date);
  if (value.dateTime) return parseDate(value.dateTime);
  return null;
}

function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addMonths(d, n) {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

class GardenGanttCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._events = null;
    this._error = null;
    this._loading = false;
    this._fetchKey = null;
    this._lastFetch = 0;
    this._timer = null;
  }

  static getStubConfig() {
    return { entity: "calendar.gartenplan", title: "Gartenplan", months: 12 };
  }

  setConfig(config) {
    if (!config || !config.entity) {
      throw new Error("garden-gantt-card: 'entity' is required (e.g. calendar.gartenplan)");
    }
    this.config = Object.assign(
      {
        title: "",
        start: null,
        months: 12,
        groups: {},
        group_colors: {},
        show_legend: true,
        show_empty_months: true,
        refresh_interval: 300,
        language: null,
      },
      config
    );
    this._events = null;
    this._fetchKey = null;
    this._error = null;
    this._render();
    this._scheduleRefresh();
  }

  set hass(hass) {
    this._hass = hass;
    this._maybeFetch();
  }

  getCardSize() {
    const rows = this._rows ? this._rows.length : 8;
    return Math.max(4, Math.min(30, Math.ceil(rows / 3) + 3));
  }

  getGridOptions() {
    return { columns: 12, min_columns: 6 };
  }

  connectedCallback() {
    this._scheduleRefresh();
  }

  disconnectedCallback() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }

  _scheduleRefresh() {
    if (this._timer) clearInterval(this._timer);
    const interval = Number(this.config && this.config.refresh_interval);
    if (interval > 0) {
      this._timer = setInterval(() => {
        this._lastFetch = 0;
        this._maybeFetch();
      }, interval * 1000);
    }
  }

  _language() {
    if (this.config.language) return this.config.language;
    if (this._hass && this._hass.locale && this._hass.locale.language) {
      return this._hass.locale.language;
    }
    return "en";
  }

  _months() {
    return this._language().toLowerCase().startsWith("de") ? MONTHS_DE : MONTHS_EN;
  }

  _window() {
    let start;
    if (this.config.start) {
      start = parseDate(this.config.start) || startOfMonth(new Date());
    } else {
      start = startOfMonth(new Date());
    }
    const months = Math.max(1, Math.min(24, Number(this.config.months) || 12));
    const end = addMonths(start, months);
    return { start, end, months };
  }

  async _maybeFetch() {
    if (!this._hass || !this.config) return;
    const { start, end } = this._window();
    const key = `${this.config.entity}|${ymd(start)}|${ymd(end)}`;
    const now = Date.now();
    const interval = Number(this.config.refresh_interval) || 0;
    const stale = interval <= 0 || now - this._lastFetch > interval * 1000;
    if (this._fetchKey === key && this._events && !stale) return;
    if (this._loading) return;

    this._loading = true;
    this._error = null;
    this._render();
    try {
      const path = `calendars/${this.config.entity}?start=${encodeURIComponent(
        ymdhms(start)
      )}&end=${encodeURIComponent(ymdhms(end))}`;
      const data = await this._hass.callApi("GET", path);
      this._events = Array.isArray(data) ? data : [];
      this._fetchKey = key;
      this._lastFetch = Date.now();
    } catch (err) {
      this._error = (err && (err.message || err.error || err.body?.message)) || String(err);
      this._events = this._events || [];
    } finally {
      this._loading = false;
      this._render();
    }
  }

  _buildRows() {
    const { start, months } = this._window();
    const monthsList = this._months();
    const lang = this._language();
    const groups = this.config.groups || {};
    const groupColors = this.config.group_colors || {};

    const monthInfos = [];
    for (let i = 0; i < months; i++) {
      const d = addMonths(start, i);
      monthInfos.push({
        date: d,
        label: monthsList[d.getMonth()],
        year: d.getFullYear(),
        isJanuary: d.getMonth() === 0,
        start: d,
        end: addMonths(d, 1),
      });
    }

    const now = new Date();
    const currentMonthKey = `${now.getFullYear()}-${now.getMonth()}`;

    const events = (this._events || [])
      .map((ev) => {
        const evStart = parseDate(ev.start);
        let evEnd = parseDate(ev.end);
        if (!evStart) return null;
        if (!evEnd) evEnd = new Date(evStart.getTime() + 86400000);
        const summary = ev.summary || "(ohne Titel)";
        const plant = summary.includes(":") ? summary.split(":")[0].trim() : summary.trim();
        let group = groups[plant];
        if (!group && ev.location) group = String(ev.location);
        if (!group) group = "Aufgaben";
        return {
          summary,
          plant,
          group,
          description: ev.description || "",
          start: evStart,
          end: evEnd,
        };
      })
      .filter(Boolean);

    events.sort((a, b) => a.start - b.start || a.summary.localeCompare(b.summary, lang));

    const groupOrder = [];
    const byGroup = new Map();
    for (const ev of events) {
      if (!byGroup.has(ev.group)) {
        byGroup.set(ev.group, []);
        groupOrder.push(ev.group);
      }
      byGroup.get(ev.group).push(ev);
    }

    const palette = DEFAULT_GROUP_COLORS;
    const colorFor = (group, idx) => groupColors[group] || palette[idx % palette.length];

    const rows = [];
    groupOrder.forEach((group, gi) => {
      const color = colorFor(group, gi);
      const groupEvents = byGroup.get(group);
      groupEvents.forEach((ev) => {
        const active = monthInfos.map(
          (mi) => ev.start < mi.end && ev.end > mi.start
        );
        const firstIdx = active.indexOf(true);
        rows.push({
          group,
          color,
          summary: ev.summary,
          label: ev.summary,
          description: ev.description,
          active,
          firstIdx,
        });
      });
    });

    return { monthInfos, rows, groupOrder, byGroup, colorFor, currentMonthKey };
  }

  _render() {
    if (!this.config) return;
    const { start, end, months } = this._window();
    const built = this._buildRows();
    this._rows = built.rows;
    const { monthInfos, rows, groupOrder, colorFor } = built;
    const title = this.config.title || "Gartenplan";
    const lang = this._language();

    const rangeLabel = `${monthInfos[0].label} ${monthInfos[0].year} – ${
      monthInfos[monthInfos.length - 1].label
    } ${monthInfos[monthInfos.length - 1].year}`;

    let body = "";
    if (this._error) {
      body = `<div class="msg error">Fehler beim Laden von <code>${esc(
        this.config.entity
      )}</code>: ${esc(this._error)}</div>`;
    } else if (this._loading && (!this._events || !this._events.length)) {
      body = `<div class="msg">Lade Kalenderdaten …</div>`;
    } else if (!rows.length) {
      body = `<div class="msg">Keine Termine im Zeitraum ${esc(rangeLabel)} gefunden.</div>`;
    } else {
      const groupsWithRows = groupOrder.filter((g) => rows.some((r) => r.group === g));
      const multiGroup = groupsWithRows.length > 1;

      const headerCells = monthInfos
        .map((mi) => {
          const isNow = `${mi.date.getFullYear()}-${mi.date.getMonth()}` === built.currentMonthKey;
          const yearTag = mi.isJanuary ? `<span class="yr">${mi.year}</span>` : "";
          return `<th class="${isNow ? "now" : ""}">${yearTag}${esc(mi.label)}</th>`;
        })
        .join("");

      let tableRows = "";
      for (const group of groupsWithRows) {
        const gRows = rows.filter((r) => r.group === group);
        if (multiGroup) {
          tableRows += `<tr class="grouprow"><td colspan="${months + 1}">
            <span class="swatch" style="background:${esc(colorFor(group, groupsWithRows.indexOf(group)))}"></span>
            ${esc(group)} <span class="count">${gRows.length}</span></td></tr>`;
        }
        for (const r of gRows) {
          const cells = r.active
            .map((on) => `<td class="${on ? "on" : ""}">${on ? '<div class="bar"></div>' : ""}</td>`)
            .join("");
          const tip = r.description ? ` title="${esc(r.description)}"` : "";
          tableRows += `<tr style="--gg-bar:${esc(r.color)}"><td class="label"${tip}>${esc(r.label)}</td>${cells}</tr>`;
        }
      }

      body = `<div class="wrap"><table>
        <thead><tr><th class="label head">Aufgabe</th>${headerCells}</tr></thead>
        <tbody>${tableRows}</tbody>
      </table></div>`;
    }

    const legend =
      this.config.show_legend !== false && groupOrder.length > 1
        ? `<div class="legend">${groupOrder
            .map(
              (g, i) =>
                `<span class="item"><span class="swatch" style="background:${esc(
                  colorFor(g, i)
                )}"></span>${esc(g)}</span>`
            )
            .join("")}</div>`
        : "";

    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        ha-card { padding: 12px 12px 8px; }
        .head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 6px; }
        .title { font-size: var(--ha-card-header-font-size, 18px); font-weight: 500; color: var(--primary-text-color); }
        .sub { font-size: 12px; color: var(--secondary-text-color); }
        .legend { display: flex; flex-wrap: wrap; gap: 10px; margin: 6px 0 8px; font-size: 12px; color: var(--secondary-text-color); }
        .legend .item, .legend { align-items: center; }
        .legend .item { display: inline-flex; gap: 5px; }
        .swatch { display: inline-block; width: 12px; height: 12px; border-radius: 3px; vertical-align: middle; }
        .wrap { overflow-x: auto; }
        table { width: 100%; border-collapse: collapse; font-size: 13px; table-layout: fixed; }
        th, td { padding: 0; }
        thead th { font-weight: 500; font-size: 11px; color: var(--secondary-text-color); padding: 2px 4px; text-align: center; }
        thead th.label { text-align: left; }
        th.now { color: var(--error-color, #e53935); font-weight: 700; }
        th .yr { display: block; font-size: 9px; opacity: .7; font-weight: 400; }
        td.label { text-align: left; padding: 3px 8px 3px 2px; color: var(--primary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        th.label { width: 26%; }
        td, thead th:not(.label) { width: ${Math.max(2.5, 74 / months)}%; }
        tbody td:not(.label) { padding: 2px 0; }
        tbody td.on:not(.label) { border-bottom-color: transparent; }
        .bar { height: 14px; border-radius: 3px; background: var(--gg-bar, #4caf50); }
        tr.grouprow td { padding-top: 10px; padding-bottom: 3px; font-size: 12px; font-weight: 600; color: var(--primary-text-color); border-bottom: 1px solid var(--divider-color); }
        tr.grouprow .count { color: var(--secondary-text-color); font-weight: 400; margin-left: 4px; }
        tbody tr:not(.grouprow) td { border-bottom: 1px solid var(--divider-color, rgba(0,0,0,.08)); }
        .msg { padding: 12px 4px; color: var(--secondary-text-color); font-size: 13px; }
        .msg.error { color: var(--error-color, #e53935); }
        code { font-size: 12px; }
        .foot { margin-top: 6px; font-size: 11px; color: var(--secondary-text-color); text-align: right; }
      </style>
      <ha-card>
        <div class="head">
          <div class="title">${esc(title)}</div>
          <div class="sub">${esc(rangeLabel)}${rows.length ? ` · ${rows.length} Aufgaben` : ""}</div>
        </div>
        ${legend}
        ${body}
        <div class="foot">Garden Gantt Card v${VERSION}</div>
      </ha-card>
    `;
  }
}

customElements.define("garden-gantt-card", GardenGanttCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "garden-gantt-card",
  name: "Garden Gantt Card",
  description: "Jahres-/Monats-Gantt für eine Home-Assistant-Kalender-Entität",
  preview: false,
});

console.info(
  `%c GARDEN-GANTT-CARD %c v${VERSION} `,
  "color:#fff;background:#4caf50;font-weight:700;border-radius:3px 0 0 3px;padding:2px 4px",
  "color:#4caf50;background:#111;font-weight:700;border-radius:0 3px 3px 0;padding:2px 4px"
);
