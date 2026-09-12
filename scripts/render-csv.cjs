/**
 * End-to-end render check for Garden Gantt Card against the real garden CSV.
 *
 * Rebuilds the calendar events from Gartenplan_Kalender.csv (same logic used
 * to import them into calendar.gartenplan), runs them through the card's
 * layout code and prints the resulting Gantt as ASCII.
 *
 * Run: node scripts/render-csv.cjs /path/to/Gartenplan_Kalender.csv
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const csvPath = process.argv[2];
if (!csvPath) {
  console.error("Usage: node scripts/render-csv.cjs <Gartenplan_Kalender.csv>");
  process.exit(2);
}

const MONTHS = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

// --- parse CSV -----------------------------------------------------------
const raw = fs.readFileSync(csvPath, "utf8").replace(/^\uFEFF/, "");
const lines = raw.split(/\r?\n/).filter((l) => l.trim().length);
const header = lines[0].split(";");
const idx = (name) => header.indexOf(name);

const csvRows = lines.slice(1).map((line) => {
  const cells = line.split(";");
  return {
    pflanze: cells[idx("Pflanze")],
    kategorie: cells[idx("Kategorie")],
    aktivitaet: cells[idx("Aktivität")],
    hinweise: cells[idx("Hinweise")] || "",
    active: MONTHS.filter((m) => (cells[idx(m)] || "").trim().toLowerCase() === "x"),
  };
});

// 12-month window: Sep 2026 .. Aug 2027
const window = [];
for (let i = 0; i < 12; i++) {
  let m = 9 + i;
  let y = 2026;
  while (m > 12) {
    m -= 12;
    y += 1;
  }
  window.push({ y, m });
}

const pad = (n) => String(n).padStart(2, "0");
const events = [];
const groups = {};
for (const r of csvRows) {
  if (!r.active.length) continue;
  groups[r.pflanze] = r.kategorie;
  const winMonths = window.filter((w) => r.active.includes(MONTHS[w.m - 1]));
  // contiguous runs -> one event each
  const runs = [];
  let cur = [winMonths[0]];
  for (let i = 1; i < winMonths.length; i++) {
    const a = winMonths[i - 1];
    const b = winMonths[i];
    const next = a.m === 12 ? { y: a.y + 1, m: 1 } : { y: a.y, m: a.m + 1 };
    if (b.y === next.y && b.m === next.m) cur.push(b);
    else {
      runs.push(cur);
      cur = [b];
    }
  }
  runs.push(cur);
  for (const run of runs) {
    const s = run[0];
    const e = run[run.length - 1];
    const ey = e.m === 12 ? e.y + 1 : e.y;
    const em = e.m === 12 ? 1 : e.m + 1;
    events.push({
      summary: `${r.pflanze}: ${r.aktivitaet}`,
      description: `Monate: ${r.active.join(", ")}${r.hinweise ? ` | ${r.hinweise}` : ""}`,
      start: { date: `${s.y}-${pad(s.m)}-01` },
      end: { date: `${ey}-${pad(em)}-01` },
    });
  }
}

// --- load card -----------------------------------------------------------
const SRC = fs.readFileSync(path.join(__dirname, "..", "dist", "garden-gantt-card.js"), "utf8");
class HTMLElementStub {
  attachShadow() {
    const s = { innerHTML: "" };
    this.shadowRoot = s;
    return s;
  }
}
const sandbox = {
  console: { info: () => {} },
  HTMLElement: HTMLElementStub,
  customElements: { define: () => {} },
  window: {},
  setInterval: () => 0,
  clearInterval: () => {},
};
vm.createContext(sandbox);
vm.runInContext(SRC + "\n;globalThis.__Card = GardenGanttCard;", sandbox);

const card = new sandbox.__Card();
card.setConfig({
  entity: "calendar.gartenplan",
  start: "2026-09-01",
  months: 12,
  groups,
});
card._events = events;
const built = card._buildRows();

// --- print ASCII Gantt ----------------------------------------------------
const hdr = " ".repeat(38) + window.map((w) => MONTHS[w.m - 1].padEnd(4)).join("");
console.log(hdr);
let lastGroup = null;
for (const row of built.rows) {
  if (row.group !== lastGroup) {
    console.log(`\n== ${row.group} ==`);
    lastGroup = row.group;
  }
  const bars = row.active.map((on) => (on ? "██" : "· ").padEnd(4)).join("");
  const label = row.label.length > 36 ? row.label.slice(0, 35) + "…" : row.label;
  console.log(label.padEnd(38) + bars);
}

console.log(
  `\n${events.length} events, ${built.rows.length} rows, ${built.groupOrder.length} groups — layout OK`
);
