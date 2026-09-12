/**
 * Logic test for Garden Gantt Card — no browser required.
 *
 * Loads dist/garden-gantt-card.js in a minimal DOM stub, feeds representative
 * calendar events (matching the Gartenplan event shapes) and asserts the
 * month-bar layout.
 *
 * Run: node scripts/test.js
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = fs.readFileSync(
  path.join(__dirname, "..", "dist", "garden-gantt-card.js"),
  "utf8"
);

function makeCard() {
  class HTMLElementStub {
    attachShadow() {
      const shadow = { innerHTML: "" };
      this.shadowRoot = shadow;
      return shadow;
    }
  }
  const sandbox = {
    console,
    HTMLElement: HTMLElementStub,
    customElements: { define: () => {} },
    window: {},
    setInterval: () => 0,
    clearInterval: () => {},
  };
  vm.createContext(sandbox);
  vm.runInContext(SRC + "\n;globalThis.__Card = GardenGanttCard;", sandbox);
  const card = new sandbox.__Card();
  card._hass = { locale: { language: "de" } };
  return card;
}

function coverage(card, events, start, months) {
  card._events = events;
  card.setConfig({ entity: "calendar.gartenplan", start, months });
  card._events = events; // setConfig clears, put back
  const built = card._buildRows();
  return built.rows.map((r) => ({ label: r.label, active: r.active }));
}

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("Garden Gantt Card — layout tests\n");

// Window: Sep 2026 .. Aug 2027 (12 months, indices 0..11)
const START = "2026-09-01";

// 1) Two-month all-day span (Sep 1 – Nov 1 exclusive) -> Sep + Okt
{
  const card = makeCard();
  const rows = coverage(
    card,
    [
      {
        summary: "Kartoffel: Ernte Lagerkartoffeln",
        description: "Vor dem ersten Frost",
        start: { date: "2026-09-01" },
        end: { date: "2026-11-01" },
      },
    ],
    START,
    12
  );
  const a = rows[0].active;
  check("all-day Sep1–Nov1 covers Sep+Okt", a[0] && a[1] && !a[2], JSON.stringify(a));
  check("row keeps full summary", rows[0].label === "Kartoffel: Ernte Lagerkartoffeln");
}

// 2) Single-month event (Mai 2027 is index 8 in a Sep-start window)
{
  const card = makeCard();
  const rows = coverage(
    card,
    [
      {
        summary: "Tomate: Auspflanzen",
        start: { date: "2027-05-01" },
        end: { date: "2027-06-01" },
      },
    ],
    START,
    12
  );
  check("Mai 2027 -> index 8 only", rows[0].active[8] === true && rows[0].active.filter(Boolean).length === 1, JSON.stringify(rows[0].active));
}

// 3) Spanning the year boundary (Dez 2026 – Feb 2027 -> indices 3,4)
{
  const card = makeCard();
  const rows = coverage(
    card,
    [
      {
        summary: "Thuja-Hecke: Radikaler Rückschnitt",
        start: { date: "2026-10-01" },
        end: { date: "2027-03-01" },
      },
    ],
    START,
    12
  );
  check("Okt–Feb spans 5 cells (Okt,Nov,Dez,Jan,Feb)", rows[0].active.slice(1, 6).every(Boolean) && !rows[0].active[6], JSON.stringify(rows[0].active));
}

// 4) Timed event (dateTime) is included and clamped to its day
{
  const card = makeCard();
  const rows = coverage(
    card,
    [
      {
        summary: "Gurke: Düngen",
        start: { dateTime: "2027-06-14T08:00:00+02:00" },
        end: { dateTime: "2027-06-14T09:00:00+02:00" },
      },
    ],
    START,
    12
  );
  check("timed event in Jun 2027 -> index 9", rows[0].active[9] === true, JSON.stringify(rows[0].active));
}

// 5) Grouping: groups map assigns categories, unknown falls back to location
{
  const card = makeCard();
  card._events = [
    { summary: "Tomate: Ernte", start: { date: "2027-07-01" }, end: { date: "2027-08-01" } },
    { summary: "Gurke: Ernte", start: { date: "2027-07-01" }, end: { date: "2027-08-01" } },
    { summary: "Unbekannt: X", location: "Sonstiges", start: { date: "2027-07-01" }, end: { date: "2027-08-01" } },
  ];
  card.setConfig({
    entity: "calendar.gartenplan",
    start: START,
    months: 12,
    groups: { Tomate: "Gemüse", Gurke: "Gemüse" },
  });
  card._events = [
    { summary: "Tomate: Ernte", start: { date: "2027-07-01" }, end: { date: "2027-08-01" } },
    { summary: "Gurke: Ernte", start: { date: "2027-07-01" }, end: { date: "2027-08-01" } },
    { summary: "Unbekannt: X", location: "Sonstiges", start: { date: "2027-07-01" }, end: { date: "2027-08-01" } },
  ];
  const built = card._buildRows();
  const g = built.rows.map((r) => r.group);
  check("groups map applied", g.filter((x) => x === "Gemüse").length === 2, JSON.stringify(g));
  check("location fallback used", g.includes("Sonstiges"), JSON.stringify(g));
  check("same group shares one color", new Set(built.rows.filter((r) => r.group === "Gemüse").map((r) => r.color)).size === 1);
}

// 6) Events outside the window produce no active cell
{
  const card = makeCard();
  const rows = coverage(
    card,
    [{ summary: "Alt: X", start: { date: "2026-01-01" }, end: { date: "2026-02-01" } }],
    START,
    12
  );
  check("out-of-window event has no active cells", rows[0].active.every((x) => x === false), JSON.stringify(rows[0].active));
}

// 7) Group color is applied to the rendered bar cells
{
  const card = makeCard();
  card.setConfig({
    entity: "calendar.gartenplan",
    start: START,
    months: 12,
    groups: { Erdbeere: "Obst" },
    group_colors: { Obst: "#e91e63" },
  });
  card._events = [
    { summary: "Erdbeere: Ernte", start: { date: "2027-05-01" }, end: { date: "2027-08-01" } },
  ];
  card._render();
  const html = card.shadowRoot.innerHTML;
  check("rendered HTML applies group color", html.includes("--gg-bar:#e91e63"), "no --gg-bar:#e91e63 in HTML");
  check("rendered HTML escapes nothing broken", html.includes("Erdbeere: Ernte"));
}

console.log(
  failures === 0
    ? "\nAll tests passed."
    : `\n${failures} test(s) failed.`
);
process.exit(failures === 0 ? 0 : 1);
