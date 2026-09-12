/**
 * Logic test for Garden Gantt Card — no browser required.
 *
 * Loads dist/garden-gantt-card.js in a minimal DOM stub and asserts the new
 * model: one row per plant (location), activity-colored bars, lane stacking of
 * overlapping activities and labels inside the bars.
 *
 * Run: npm test
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = fs.readFileSync(
  path.join(__dirname, "..", "dist", "garden-gantt-card.js"),
  "utf8"
);

class HTMLElementStub {
  attachShadow() {
    const shadow = { innerHTML: "" };
    this.shadowRoot = shadow;
    return shadow;
  }
}

function makeCard() {
  const sandbox = {
    console: { info: () => {}, log: console.log, error: console.error },
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

const START = "2026-09-01";

function build(events, cfg) {
  const card = makeCard();
  card.setConfig(Object.assign({ entity: "calendar.gartenplan", start: START, months: 12 }, cfg || {}));
  card._events = events;
  return { card, model: card._buildModel() };
}

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`  ok   ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("Garden Gantt Card — model tests\n");

// 1) One row per plant, even with several activities
{
  const { model } = build([
    { summary: "Tomate: Vorkultur", location: "Tomate", start: { date: "2027-03-01" }, end: { date: "2027-04-01" } },
    { summary: "Tomate: Auspflanzen", location: "Tomate", start: { date: "2027-05-16" }, end: { date: "2027-06-01" } },
    { summary: "Gurke: Vorkultur", location: "Gurke", start: { date: "2027-04-01" }, end: { date: "2027-05-01" } },
  ]);
  check("one row per plant", model.rows.length === 2, JSON.stringify(model.rows.map((r) => r.row)));
  const tomate = model.rows.find((r) => r.row === "Tomate");
  check("both Tomate activities in one row", tomate.segments.length === 2, JSON.stringify(tomate.segments.length));
  check("rows are sorted by plant", model.rows[0].row === "Gurke" && model.rows[1].row === "Tomate");
}

// 2) Different activities -> different colors (per type)
{
  const { model } = build([
    { summary: "Tomate: Vorkultur", location: "Tomate", start: { date: "2027-03-01" }, end: { date: "2027-04-01" } },
    { summary: "Tomate: Ernte", location: "Tomate", start: { date: "2027-07-01" }, end: { date: "2027-08-01" } },
  ]);
  const row = model.rows[0];
  check("activities differ in color", row.segments[0].color !== row.segments[1].color, JSON.stringify(row.segments.map((s) => s.color)));
  check("Vorkultur classified as pflanzen", row.segments[0].type === "pflanzen");
  check("Ernte classified as ernte", row.segments[1].type === "ernte");
}

// 3) Overlapping activities are stacked into separate lanes
{
  const { model } = build([
    { summary: "Tomate: Ausgeizen", location: "Tomate", start: { date: "2027-05-01" }, end: { date: "2027-07-01" } },
    { summary: "Tomate: Düngen", location: "Tomate", start: { date: "2027-06-01" }, end: { date: "2027-08-01" } },
  ]);
  const row = model.rows[0];
  check("overlap uses 2 lanes", row.lanes.length === 2, JSON.stringify(row.lanes.length));
  check("overlapping segments get different lanes", row.segments[0].lane !== row.segments[1].lane);
}

// 4) Non-overlapping activities share one lane
{
  const { model } = build([
    { summary: "Tomate: Vorkultur", location: "Tomate", start: { date: "2027-03-01" }, end: { date: "2027-04-01" } },
    { summary: "Tomate: Ernte", location: "Tomate", start: { date: "2027-07-01" }, end: { date: "2027-08-01" } },
  ]);
  const row = model.rows[0];
  check("non-overlap stays in 1 lane", row.lanes.length === 1 && row.segments.every((s) => s.lane === 0));
}

// 5) DTEND is exclusive: Sep 1 – Nov 1 fills Sep+Okt only
{
  const { model } = build([
    { summary: "Kartoffel: Ernte (Lager)", location: "Kartoffel", start: { date: "2026-09-01" }, end: { date: "2026-11-01" } },
  ]);
  const seg = model.rows[0].segments[0];
  check("Sep1–Nov1 -> left 0%", Math.abs(seg.left) < 0.001, String(seg.left));
  check("Sep1–Nov1 -> spans ~2 months (Sep+Okt)", seg.width > 16 && seg.width < 17.5 && seg.left + seg.width < 100 / 12 * 3, String(seg.width));
}

// 6) Timed event lands in its month
{
  const { model } = build([
    { summary: "Gurke: Düngen", location: "Gurke", start: { dateTime: "2027-06-14T08:00:00+02:00" }, end: { dateTime: "2027-06-14T09:00:00+02:00" } },
  ]);
  const seg = model.rows[0].segments[0];
  check("timed event inside Jun (75–83.3%)", seg.left >= 75 && seg.left < 100 / 1.2, String(seg.left));
}

// 7) Row falls back to summary prefix when no location, then to Allgemein
{
  const { model } = build([
    { summary: "Rose: Pflanzen", start: { date: "2027-03-01" }, end: { date: "2027-04-01" } },
    { summary: "Eisheilige", start: { date: "2027-05-11" }, end: { date: "2027-05-16" } },
  ]);
  const names = model.rows.map((r) => r.row).sort();
  check("summary prefix becomes the row", names.includes("Rose"), JSON.stringify(names));
  check("no prefix/location -> Allgemein", names.includes("Allgemein"), JSON.stringify(names));
}

// 8) Labels shown only when the bar is wide enough
{
  const { model } = build([
    { summary: "Tomate: Ernte", location: "Tomate", start: { date: "2027-05-01" }, end: { date: "2027-06-01" } },
    { summary: "Tomate: Vorkultur", location: "Tomate", start: { date: "2027-05-01" }, end: { date: "2027-05-16" } },
  ]);
  const row = model.rows[0];
  const full = row.segments.find((s) => s.label === "Ernte");
  const short = row.segments.find((s) => s.label === "Vorkultur");
  check("1-month bar shows its label", full.showLabel === true);
  check("half-month bar hides its label", short.showLabel === false);
}

// 9) Render applies taller bars, colors and activity text; escapes HTML
{
  const { card } = build(
    [
      { summary: "Rasen & Beet: Herbst-Düngung", location: "Rasen & <Beet>", start: { date: "2026-09-01" }, end: { date: "2026-10-01" } },
    ],
    { bar_height: 30, activity_colors: { duengen: "#123456" } }
  );
  card._render();
  const html = card.shadowRoot.innerHTML;
  check("bar height applied", html.includes("height:30px"));
  check("activity color applied", html.includes("background:#123456"));
  check("activity written into the bar", html.includes("<span>Herbst-Düngung</span>"));
  check("plant label escaped", html.includes("Rasen &amp; &lt;Beet&gt;") && !html.includes("Rasen & <Beet>"));
}

// 10) Empty window is handled
{
  const { model } = build([
    { summary: "Alt: X", location: "Alt", start: { date: "2020-01-01" }, end: { date: "2020-02-01" } },
  ]);
  check("out-of-window events produce no rows", model.rows.length === 0);
}

console.log(failures === 0 ? "\nAll tests passed." : `\n${failures} test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
