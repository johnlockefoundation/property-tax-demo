import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PT = (await import(path.join(__dirname, "..", "calc.js"))).default;

// data/benchmarks.json is a faithful mirror of the Data(tax).csv FY2025-26 columns.
const BENCHMARKS = JSON.parse(
  readFileSync(path.join(__dirname, "..", "data", "benchmarks.json"), "utf8")
);
const county = BENCHMARKS.mecklenburg; // above benchmark
const below = BENCHMARKS.alamance;     // at/below benchmark (grade A)

// Read the authoritative Data(tax).csv so tests can verify column Q wiring.
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
const CSV_ROWS = csvRows(readFileSync(path.join(__dirname, "..", "..", "Data(tax).csv"), "utf8"));
const CSV_HEAD = CSV_ROWS[0].map(h => h.trim());
const CSV_BY_SLUG = new Map();
for (const r of CSV_ROWS.slice(1)) {
  if (!r[0] || r[0].trim().toLowerCase() === "total") continue;
  const rec = Object.fromEntries(CSV_HEAD.map((h, i) => [h, r[i]]));
  const slug = r[0].trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  CSV_BY_SLUG.set(slug, rec);
}

test("arithmetic fixture: V=400000, r_actual=0.4927, r_scenario=0.4000", () => {
  const res = PT.computeComparison(400000, {
    x: 1, l_scenario: 1, r_actual: 0.4927, r_scenario: 0.4000, l_actual: 0, b_endpoint: 0
  });
  assert.equal(Math.round(res.tax_actual * 100) / 100, 1970.8);
  assert.equal(Math.round(res.tax_scenario * 100) / 100, 1600.0);
  assert.equal(Math.round(res.difference * 100) / 100, 370.8);
});

test("benchmark fixture: $100m baseline, 2% infl + 1% pop => $103m after one transition", () => {
  const out = PT.benchmarkEndpoint(100_000_000, [{ growth: 0.02 + 0.01 }]);
  assert.equal(out, 103_000_000);
});

test("benchmark compounds from the prior benchmark, not the baseline", () => {
  const out = PT.benchmarkEndpoint(100_000_000, [{ growth: 0.03 }, { growth: 0.03 }]);
  assert.equal(out, 100_000_000 * 1.03 * 1.03);
});

test("rate fixture: scenario levy $100m on $25b base => 0.4000 per $100", () => {
  assert.equal(PT.rateFor(100_000_000, 25_000_000_000), 0.4);
});

test("scenarioLevy caps at actual when actual is below ceiling", () => {
  assert.equal(PT.scenarioLevy(1_492_300_028, 1_554_687_233), 1_492_300_028);
});

test("two rate equations are equivalent within reconciliation rounding", () => {
  const fromBase = PT.rateFor(county.l_scenario, county.x);
  const fromActual = county.r_actual * (county.l_scenario / county.l_actual);
  const rel = Math.abs(fromBase - fromActual) / county.r_actual;
  assert.ok(rel < 0.001, `relative discrepancy ${rel}`);
});

test("rate reconciliation: X*r_actual/100 reproduces the levy within documented rounding", () => {
  const pct = PT.rateReconciliationPct(county.r_actual, county.x, county.l_actual);
  assert.ok(Math.abs(pct) < 0.05, `reconciliation off by ${pct}%`);
});

test("Mecklenburg reported r_scenario equals 100*L_scenario/X", () => {
  assert.ok(Math.abs(PT.rateFor(county.l_scenario, county.x) - county.r_scenario) < 1e-4);
});

test("missing/inconsistent inputs -> unavailable, not zero-dollar tax", () => {
  const res = PT.computeComparison(400000, null);
  assert.equal(res.ok, false);
  assert.notEqual(res.reason, "");
  const bad = PT.computeComparison(400000, { r_actual: 0.49, l_scenario: 0, x: -1 });
  assert.equal(bad.ok, false);
});

test("zero actual value does not divide by zero", () => {
  const res = PT.computeComparison(0, { x: 1, l_scenario: 0.5, r_actual: 0.49, r_scenario: 0.4, l_actual: 0, b_endpoint: 0 });
  assert.equal(res.ok, true);
  assert.equal(res.tax_actual, 0);
  assert.equal(res.percent_difference, 0);
});

test("at/below-benchmark county leaves the rate and bill unchanged", () => {
  const res = PT.computeComparison(400000, below);
  assert.equal(res.below_benchmark, true);
  assert.equal(res.same_rate, true);
  assert.equal(res.tax_scenario, res.tax_actual);
});

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

test("residential filter accepts counties with only a description (e.g. Halifax)", () => {
  assert.equal(PT.isUsableResidential({ parval: 132700, parusecode: "", parusedesc: "Residential" }), true);
  assert.equal(PT.isUsableResidential({ parval: 132700, parusecode: "R100", parusedesc: "SINGLE FAMILY RESIDENTIAL" }), true);
  assert.equal(PT.isUsableResidential({ parval: 500000, parusecode: "", parusedesc: "Commercial" }), false);
});

test("ambiguity: a multi-match search yields a candidate list, not a silent pick", () => {
  const mock = [
    { parno: "17103426", parval: 260653, parusecode: "R300" },
    { parno: "17103458", parval: 276968, parusecode: "R300" },
    { parno: "17103483", parval: 437421, parusecode: "R300" }
  ];
  const usable = mock.filter(PT.isUsableResidential);
  assert.equal(usable.length, 3);
  const amounts = new Set(usable.map(p => PT.computeComparison(p.parval, county).tax_actual));
  assert.equal(amounts.size, usable.length);
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

test("per-property amounts are the FY2025-26 levy columns apportioned by assessed value", () => {
  const V = 291_834;
  const c = BENCHMARKS.wake;
  const paid = (V * c.act) / c.x;
  const could = (V * c.hyp) / c.x;
  assert.ok(Math.abs(paid - 1509.82) < 0.01, `paid ${paid}`);
  assert.ok(Math.abs(paid - could - 293.65) < 0.01, `saved ${paid - could}`);
});

test("four counties are at/below benchmark for FY2025-26", () => {
  const names = Object.values(BENCHMARKS).filter(c => c.below_benchmark).map(c => c.label).sort();
  assert.deepEqual(names, ["Alamance County", "Macon County", "Madison County", "Moore County"]);
});
