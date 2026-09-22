import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PT = (await import(path.join(__dirname, "..", "calc.js"))).default;

// data/benchmarks.json is a faithful mirror of the Data(tax).csv FY2025-26
// columns and the vendored build inputs under data/source/.
const BENCHMARKS = JSON.parse(
  readFileSync(path.join(__dirname, "..", "data", "benchmarks.json"), "utf8")
);
const county = BENCHMARKS.wake; // above benchmark (grade C)
const below = BENCHMARKS.alamance; // at/below benchmark (grade A)

// Read the authoritative Data(tax).csv (vendored) so tests can verify column Q wiring.
function csvRows(text) {
  const out = [];
  for (const line of text.trim().split(/\r?\n/)) {
    const cells = []; let cur = "", q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') q = false;
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ",") { cells.push(cur); cur = ""; }
      else cur += ch;
    }
    cells.push(cur); out.push(cells);
  }
  return out;
}
const CSV_ROWS = csvRows(readFileSync(path.join(__dirname, "..", "data", "source", "Data(tax).csv"), "utf8"));
const CSV_HEAD = CSV_ROWS[0].map(h => h.trim());
const CSV_BY_SLUG = new Map();
for (const r of CSV_ROWS.slice(1)) {
  if (!r[0] || r[0].trim().toLowerCase() === "total") continue;
  const rec = Object.fromEntries(CSV_HEAD.map((h, i) => [h, r[i]]));
  const slug = r[0].trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  CSV_BY_SLUG.set(slug, rec);
}

// ---- Per-property receipt ----

test("Wake fixture: V=291834 => paid 1509.82, could 1346.76, saved 163.06, 11% lower", () => {
  const res = PT.computeReceipt(291_834, county);
  assert.equal(res.ok, true);
  assert.ok(Math.abs(res.paid - 1509.82) < 0.01, `paid ${res.paid}`);
  assert.ok(Math.abs(res.could_have - 1346.76) < 0.02, `could ${res.could_have}`);
  assert.ok(Math.abs(res.saved - 163.06) < 0.02, `saved ${res.saved}`);
  assert.equal(Math.round(100 * res.rate), 11);
});

test("receipt math identities: paid=V*act/X; could=(1-rate)*paid; saved=rate*paid", () => {
  const V = 400_000;
  const res = PT.computeReceipt(V, county);
  assert.equal(res.paid, (V * county.act) / county.x);
  assert.equal(res.could_have, res.paid * (1 - county.savings_rate));
  assert.equal(res.saved, res.paid * county.savings_rate);
  assert.equal(res.saved + res.could_have, res.paid);
});

test("receipt scales linearly with assessed value within a county", () => {
  const a = PT.computeReceipt(200_000, county).paid;
  const b = PT.computeReceipt(400_000, county).paid;
  assert.equal(b, a * 2);
});

test("below-benchmark county reports below_benchmark=true", () => {
  const res = PT.computeReceipt(400_000, below);
  assert.equal(res.ok, true);
  assert.equal(res.below_benchmark, true);
});

test("missing/inconsistent inputs -> unavailable, not zero-dollar tax", () => {
  const noCounty = PT.computeReceipt(400_000, null);
  assert.equal(noCounty.ok, false);
  assert.notEqual(noCounty.reason, "");
  const bad = PT.computeReceipt(400_000, { x: county.x, act: county.act, savings_rate: undefined });
  assert.equal(bad.ok, false);
  const zeroBase = PT.computeReceipt(400_000, { x: 0, act: county.act, savings_rate: 0.1 });
  assert.equal(zeroBase.ok, false);
});

test("negative value -> unavailable", () => {
  const res = PT.computeReceipt(-1, county);
  assert.equal(res.ok, false);
});

// ---- Address search ----

test("address where-clause escapes single quotes (injection safe)", () => {
  const w = PT.buildAddressWhere("O'Brien 100");
  assert.equal(w, "UPPER(siteadd) LIKE UPPER('%O''Brien 100%')");
  assert.ok(!w.includes("O'Brien'%'"));
  assert.equal(PT.buildAddressWhere("   "), null);
  assert.equal(PT.buildAddressWhere(""), null);
});

test("partial address where clause matches OneMap substring form", () => {
  const w = PT.buildAddressWhere("1000 E Woodlawn");
  assert.equal(w, "UPPER(siteadd) LIKE UPPER('%1000 E Woodlawn%')");
});

test("residential filter keeps usable homes and excludes commercial/non-value", () => {
  assert.equal(PT.isUsableResidential({ parval: 260653, parusecode: "R100" }), true);
  assert.equal(PT.isUsableResidential({ parval: 2754300, parusecode: "C700" }), false);
  assert.equal(PT.isUsableResidential({ parval: 0, parusecode: "R100" }), false);
  assert.equal(PT.isUsableResidential({ parval: 260653, parusecode: null }), false);
});

test("residential filter accepts counties with varied descriptions", () => {
  const cases = [
    ["SINGLE FAMILY", true],
    ["SINGLE WIDE MH", true],
    ["DOUBLE WIDE MH", true],
    ["MOBILE HOME L/I", true],
    ["MANUFACTURED HOME", true],
    ["VACANT LAND 0-9 ACRES", false],
    ["GENERAL FARM - PRESENT US", false],
    ["MANUFACTURING", false],
    ["EXEMPT", false],
    ["MISC", false]
  ];
  for (const [desc, expected] of cases) {
    assert.equal(PT.isUsableResidential({ parval: 132700, parusecode: "", parusedesc: desc }), expected, desc);
  }
});

// ---- Data(tax).csv conformance ----

test("benchmarks mirror the Data(tax).csv FY2025-26 columns for all 100 counties", () => {
  const entries = Object.entries(BENCHMARKS);
  assert.equal(entries.length, 100);
  for (const [key, c] of entries) {
    assert.ok(/^[a-z0-9-]+$/.test(key), `slug ${key}`);
    assert.equal(c.period, "FY2025-26", `${key} period`);
    assert.equal(c.act, c.l_actual, `${key} act`);
    assert.equal(c.hyp, c.l_benchmark, `${key} hyp`);
    assert.equal(c.cnt_diff, c.act - c.hyp, `${key} cnt_diff`);
    assert.equal(c.l_scenario, Math.min(c.act, c.hyp), `${key} scenario`);
    assert.equal(c.below_benchmark, c.act <= c.hyp, `${key} below`);
    assert.equal(c.by_year.length, 1, `${key} by_year`);
    assert.equal(c.by_year[0].fy, "2025-26", `${key} by_year year`);
    const csv = CSV_BY_SLUG.get(key);
    assert.ok(csv, `${key} present in Data(tax).csv`);
    assert.equal(c.savings_rate, parseFloat(csv["5-year_savings_rate"]), `${key} column Q`);
    assert.ok(Math.abs(c.savings_rate_fy26 - (c.act - c.hyp) / c.act) < 1e-9, `${key} fy26 rate`);
    assert.ok(Math.abs(c.pct_diff - (c.act / c.hyp - 1) * 100) < 1e-6, `${key} pct_diff`);
  }
});

test("receipt percentage equals Data(tax).csv column Q (Wake ~11%), not the single-year rate", () => {
  assert.equal(Math.round(100 * BENCHMARKS.wake.savings_rate), 11);
  assert.ok(Math.abs(BENCHMARKS.wake.savings_rate_fy26 - 0.19449565867922175) < 1e-9);
});

test("four counties are at/below benchmark for FY2025-26", () => {
  const names = Object.values(BENCHMARKS).filter(c => c.below_benchmark).map(c => c.label).sort();
  assert.deepEqual(names, ["Alamance County", "Macon County", "Madison County", "Moore County"]);
});

test("benchmarks are reproducible from the vendored build inputs", () => {
  const repo = path.join(__dirname, "..");
  const r = spawnSync(process.execPath, ["tools/build_benchmarks.mjs"], { cwd: repo, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const rebuilt = JSON.parse(readFileSync(path.join(repo, "data", "benchmarks.json"), "utf8"));
  assert.deepEqual(rebuilt, BENCHMARKS);
});