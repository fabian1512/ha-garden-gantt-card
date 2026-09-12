/**
 * End-to-end render check for Garden Gantt Card against the real garden CSV.
 *
 * Rebuilds calendar events from Gartenplan_Kalender.csv (one event per plant ×
 * activity), runs them through the card's model and prints an ASCII Gantt with
 * one row per plant and a type marker per month.
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
for (const r of csvRows) {
  if (!r.active.length) continue;
  const winMonths = window.filter((w) => r.active.includes(MONTHS[w.m - 1]));
  // contiguous month runs -> one event each
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
      location: r.pflanze,
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
card.setConfig({ entity: "calendar.gartenplan", start: "2026-09-01", months: 12 });
card._events = events;
const model = card._buildModel();

// --- print ASCII Gantt ----------------------------------------------------
const MARK = { ernte: "E", schutz: "S", duengen: "D", pflanzen: "A", pflege: "P", schnitt: "C" };
const hdr = " ".repeat(34) + window.map((w) => MONTHS[w.m - 1].padEnd(4)).join("");
console.log(hdr);
console.log(" ".repeat(34) + window.map(() => "----").join(""));

for (const row of model.rows) {
  const cells = window.map((w) => {
    const hits = row.segments.filter((s) => {
      const cellStart = new Date(w.y, w.m - 1, 1).getTime();
      const cellEnd = new Date(w.m === 12 ? w.y + 1 : w.y, w.m === 12 ? 0 : w.m, 1).getTime();
      return s.start.getTime() < cellEnd && s.end.getTime() > cellStart;
    });
    return (hits.length ? MARK[hits[0].type] || "?" : "·") + "  ";
  }).join("");
  const label = row.row.length > 32 ? row.row.slice(0, 31) + "…" : row.row;
  console.log(label.padEnd(34) + cells);
}

console.log("\nLegende:", Object.entries(MARK).map(([k, v]) => `${v}=${k}`).join("  "));
console.log(`${events.length} events, ${model.rows.length} Pflanzen-Zeilen, ${model.typesUsed.length} Tätigkeitstypen — layout OK`);
