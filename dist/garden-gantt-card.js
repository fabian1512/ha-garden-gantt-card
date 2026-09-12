/**
 * Garden Gantt Card
 *
 * A year/month Gantt-style overview for one Home Assistant calendar entity.
 * One row per subject (plant), each activity drawn as a colored bar carrying
 * its own label. Activities that overlap are stacked into lanes.
 *
 * Subject & activity are derived from the calendar event:
 *   - row (plant)   : event.location, else the text before ":" in the summary
 *   - activity label: the text after ":" in the summary
 *   - color         : activity keyword class (Pflanzen, Pflege, Düngen, …)
 *
 * https://github.com/fabian1512/ha-garden-gantt-card
 */

const VERSION = "0.2.1";

const MONTHS_DE = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Activity classes: order matters (first match wins). Keywords are matched
// case-insensitively against the activity label.
const DEFAULT_ACTIVITY_RULES = [
  { key: "ernte", label: "Ernte", color: "#e53935", kw: ["ernte", "ernten", "pflück"] },
  { key: "schutz", label: "Schutz", color: "#00897b", kw: ["schutz", "schützen", "leimring", "pheromon", "netz", "anhäufeln", "vlies", "weißel", "weissel"] },
  { key: "duengen", label: "Düngen", color: "#fb8c00", kw: ["düng", "kompost", "hornspäne", "kalk"] },
  { key: "pflanzen", label: "Pflanzen/Aussaat", color: "#43a047", kw: ["aussaat", "aussä", "säen", "pflanz", "vorkultur", "vorkeim", "pikier", "direktsaat", "steck", "setzen"] },
  { key: "pflege", label: "Pflege", color: "#1e88e5", kw: ["pflege", "häufel", "mulch", "stütz", "gieß", "jät", "hack", "binden", "ausdünn", "behang", "vertikutier", "laub", "mähen"] },
  { key: "schnitt", label: "Schnitt", color: "#8e24aa", kw: ["schnitt", "schneid", "ausgeiz", "kappen", "entfern", "teil", "stutz", "verjüng"] },
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
        row_field: "location",
        bar_height: 22,
        lane_gap: 3,
        row_gap: 10,
        show_labels: true,
        show_legend: true,
        activity_colors: {},
        activity_keywords: {},
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
    const rows = this._model ? this._model.rows.length : 8;
    return Math.max(4, Math.min(40, rows + 3));
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

  _rules() {
    const colors = this.config.activity_colors || {};
    const keywords = this.config.activity_keywords || {};
    return DEFAULT_ACTIVITY_RULES.map((r) => ({
      key: r.key,
      label: r.label,
      color: colors[r.key] || r.color,
      kw: keywords[r.key] || r.kw,
    }));
  }

  _classify(label) {
    const hay = String(label).toLowerCase();
    for (const rule of this._rules()) {
      if (rule.kw.some((k) => hay.includes(String(k).toLowerCase()))) return rule;
    }
    return { key: "pflege", label: "Pflege", color: (this.config.activity_colors || {}).pflege || "#1e88e5" };
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

  _buildModel() {
    const { start: winStart, end: winEnd, months } = this._window();
    const monthsList = this._months();
    const lang = this._language();
    const rowField = this.config.row_field || "location";

    const monthInfos = [];
    const now = new Date();
    for (let i = 0; i < months; i++) {
      const d = addMonths(winStart, i);
      monthInfos.push({
        date: d,
        label: monthsList[d.getMonth()],
        year: d.getFullYear(),
        isJanuary: d.getMonth() === 0,
        isNow: d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth(),
        start: d,
        end: addMonths(d, 1),
      });
    }

    const total = winEnd.getTime() - winStart.getTime();
    const msPerMonth = total / months;

    const segments = [];
    for (const ev of this._events || []) {
      const evStart = parseDate(ev.start);
      let evEnd = parseDate(ev.end);
      if (!evStart) continue;
      if (!evEnd || evEnd <= evStart) evEnd = new Date(evStart.getTime() + 86400000);
      if (evStart >= winEnd || evEnd <= winStart) continue;

      const summary = ev.summary || "(ohne Titel)";
      const ci = summary.indexOf(":");
      const prefix = ci > 0 ? summary.slice(0, ci).trim() : "";
      const rest = ci > 0 ? summary.slice(ci + 1).trim() : summary.trim();
      const location = ev.location ? String(ev.location).trim() : "";
      const row = (rowField === "location" && location) ? location : (prefix || "Allgemein");
      const label = prefix ? rest : summary;

      const cls = this._classify(label);
      segments.push({
        row,
        label,
        type: cls.key,
        typeLabel: cls.label,
        color: cls.color,
        description: ev.description || "",
        start: evStart,
        end: evEnd,
      });
    }

    segments.sort((a, b) => a.row.localeCompare(b.row, lang) || a.start - b.start || a.label.localeCompare(b.label, lang));

    const rows = [];
    const byRow = new Map();
    for (const seg of segments) {
      if (!byRow.has(seg.row)) {
        const row = { row: seg.row, segments: [], lanes: [] };
        byRow.set(seg.row, row);
        rows.push(row);
      }
      byRow.get(seg.row).segments.push(seg);
    }

    const typesUsed = new Map();
    for (const row of rows) {
      row.segments.sort((a, b) => a.start - b.start || a.end - b.end);
      for (const seg of row.segments) {
        // greedy lane packing: reuse a lane whose last bar ends at/before this start
        let lane = row.lanes.findIndex((lastEnd) => lastEnd <= seg.start.getTime());
        if (lane === -1) {
          lane = row.lanes.length;
          row.lanes.push(0);
        }
        row.lanes[lane] = seg.end.getTime();
        seg.lane = lane;
        seg.left = ((Math.max(seg.start, winStart) - winStart) / total) * 100;
        seg.width = ((Math.min(seg.end, winEnd) - Math.max(seg.start, winStart)) / total) * 100;
        const spanMonths = (seg.width / 100) * months;
        seg.showLabel = this.config.show_labels !== false && spanMonths >= 0.85;
        if (!typesUsed.has(seg.type)) typesUsed.set(seg.type, { label: seg.typeLabel, color: seg.color });
      }
    }

    rows.sort((a, b) => a.row.localeCompare(b.row, lang));

    return { monthInfos, rows, months, winStart, winEnd, msPerMonth, typesUsed: [...typesUsed.values()] };
  }

  _render() {
    if (!this.config) return;
    const { months } = this._window();
    const model = this._buildModel();
    this._model = model;
    const { monthInfos, rows, typesUsed } = model;
    const title = this.config.title || "Gartenplan";
    const barH = Math.max(12, Number(this.config.bar_height) || 22);
    const laneGap = Math.max(0, Number(this.config.lane_gap) || 3);
    const rowGap = Math.max(0, Number(this.config.row_gap) || 10);

    const rangeLabel = `${monthInfos[0].label} ${monthInfos[0].year} – ${
      monthInfos[monthInfos.length - 1].label
    } ${monthInfos[monthInfos.length - 1].year}`;

    const tasks = rows.reduce((n, r) => n + r.segments.length, 0);
    const colWidth = 100 / months;

    const gridCells = (cls) =>
      monthInfos.map((mi) => `<div class="${cls}${mi.isNow ? " now" : ""}"></div>`).join("");

    const header = `<div class="hrow">
      <div class="hlabel">Pflanze</div>
      <div class="htrack">${monthInfos
        .map((mi) => {
          const yr = mi.isJanuary ? `<span class="yr">${mi.year}</span>` : "";
          return `<div class="hcell${mi.isNow ? " now" : ""}">${yr}${esc(mi.label)}</div>`;
        })
        .join("")}</div>
    </div>`;

    let body = "";
    for (const row of rows) {
      const lanes = Math.max(1, row.lanes.length);
      const trackH = lanes * barH + (lanes - 1) * laneGap;
      const bars = row.segments
        .map((seg) => {
          const top = seg.lane * (barH + laneGap);
          const tip = seg.description ? ` title="${esc(seg.description)}"` : "";
          const txt = seg.showLabel ? `<span>${esc(seg.label)}</span>` : "";
          return `<div class="seg" style="left:${seg.left.toFixed(3)}%;width:${seg.width.toFixed(
            3
          )}%;top:${top}px;height:${barH}px;background:${esc(seg.color)}"${tip}>${txt}</div>`;
        })
        .join("");
      body += `<div class="prow" style="padding-bottom:${rowGap}px">
        <div class="plabel" title="${esc(row.row)}">${esc(row.row)}</div>
        <div class="track" style="height:${trackH}px">
          <div class="gridlines">${gridCells("gcell")}</div>
          ${bars}
        </div>
      </div>`;
    }

    let content;
    if (this._error) {
      content = `<div class="msg error">Fehler beim Laden von <code>${esc(
        this.config.entity
      )}</code>: ${esc(this._error)}</div>`;
    } else if (this._loading && (!this._events || !this._events.length)) {
      content = `<div class="msg">Lade Kalenderdaten …</div>`;
    } else if (!rows.length) {
      content = `<div class="msg">Keine Termine im Zeitraum ${esc(rangeLabel)} gefunden.</div>`;
    } else {
      content = `<div class="grid-table">${header}${body}</div>`;
    }

    const legend =
      this.config.show_legend !== false && typesUsed.length
        ? `<div class="legend">${typesUsed
            .map((t) => `<span class="item"><span class="swatch" style="background:${esc(t.color)}"></span>${esc(t.label)}</span>`)
            .join("")}</div>`
        : "";

    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        ha-card { padding: 12px 12px 8px; }
        .head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 6px; }
        .title { font-size: var(--ha-card-header-font-size, 18px); font-weight: 500; color: var(--primary-text-color); }
        .sub { font-size: 12px; color: var(--secondary-text-color); }
        .legend { display: flex; flex-wrap: wrap; gap: 10px; margin: 4px 0 8px; font-size: 12px; color: var(--secondary-text-color); }
        .legend .item { display: inline-flex; align-items: center; gap: 5px; }
        .swatch { display: inline-block; width: 12px; height: 12px; border-radius: 3px; }
        .grid-table { overflow-x: auto; min-width: 520px; }
        .hrow, .prow { display: flex; align-items: flex-start; }
        .hlabel, .plabel { flex: 0 0 clamp(88px, 20%, 180px); padding-right: 8px; box-sizing: border-box; }
        .hlabel { font-size: 11px; color: var(--secondary-text-color); text-align: left; }
        .plabel { font-size: 13px; color: var(--primary-text-color); padding-top: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .htrack { flex: 1 1 auto; display: grid; grid-template-columns: repeat(${months}, 1fr); min-width: ${months * 72}px; }
        .hcell { font-size: 11px; text-align: center; color: var(--secondary-text-color); padding: 2px 0; border-left: 1px solid transparent; }
        .hcell.now { color: var(--error-color, #e53935); font-weight: 700; }
        .hcell .yr { display: block; font-size: 9px; opacity: .7; font-weight: 400; }
        .track { flex: 1 1 auto; position: relative; min-width: ${months * 72}px; }
        .gridlines { position: absolute; inset: 0; display: grid; grid-template-columns: repeat(${months}, 1fr); }
        .gcell { border-left: 1px solid var(--divider-color, rgba(0,0,0,.08)); }
        .gcell.now { background: color-mix(in srgb, var(--error-color, #e53935) 10%, transparent); }
        .seg { position: absolute; box-sizing: border-box; border-radius: 4px; overflow: hidden; display: flex; align-items: center; cursor: default; }
        .seg span { color: #fff; font-size: 11px; line-height: 1; padding: 0 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-shadow: 0 1px 1px rgba(0,0,0,.25); }
        .prow:not(:first-child) .track { border-top: 1px solid transparent; }
        .msg { padding: 12px 4px; color: var(--secondary-text-color); font-size: 13px; }
        .msg.error { color: var(--error-color, #e53935); }
        code { font-size: 12px; }
        .foot { margin-top: 8px; font-size: 11px; color: var(--secondary-text-color); text-align: right; }
      </style>
      <ha-card>
        <div class="head">
          <div class="title">${esc(title)}</div>
          <div class="sub">${esc(rangeLabel)}${rows.length ? ` · ${rows.length} Zeilen · ${tasks} Tätigkeiten` : ""}</div>
        </div>
        ${legend}
        ${content}
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
  description: "Jahres-/Monats-Gantt: eine Zeile je Pflanze, farbige Tätigkeitsbalken",
  preview: false,
});

console.info(
  `%c GARDEN-GANTT-CARD %c v${VERSION} `,
  "color:#fff;background:#4caf50;font-weight:700;border-radius:3px 0 0 3px;padding:2px 4px",
  "color:#4caf50;background:#111;font-weight:700;border-radius:0 3px 3px 0;padding:2px 4px"
);
