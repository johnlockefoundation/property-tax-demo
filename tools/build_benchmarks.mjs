#!/usr/bin/env node
// Build data/benchmarks.json for the NC property-tax demo.
//
// Inputs are vendored under data/source/ so the build is self-contained
// (paths overridable with argv):
//   1. Data(tax).csv                 -- authoritative yearly levies + column Q
//   2. lg04_fy2025-26_valuation.csv  -- NCDOR LG04 assessed valuation (taxable base X)
//   3. nc_county_fips.csv            -- county name -> 5-digit STCOFIPS
//
// Methodology (mirrors docs/methodology.html): the levy limit is anchored to the
// 2019 base year. The receipt compares a single fiscal year, FY2025-26, because
// parcel assessments shift over time and a multi-year sum would have to assume a
// fixed share of the county tax base.
//   * paid        = V * act / X            (the actual FY2025-26 bill)
//   * percent     = column Q               (the published 5-year savings rate)
//   * could_have  = paid * (1 - Q)         so the dollars always match the rate
//   * below-benchmark counties (act26 <= hyp26) show a sentence, not a receipt.
//
// Usage:
//   node tools/build_benchmarks.mjs [Data(tax).csv] [valuation.csv] [fips.csv] [out.json]

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = resolve(HERE, "../data/source");

const YEARS = ["2021-22", "2022-23", "2023-24", "2024-25", "2025-26"];
const ACT_COL = { "2021-22": "2021-22_act", "2022-23": "2022-23_act", "2023-24": "2023-24_act", "2024-25": "2024-25_act", "2025-26": "2025-26_act" };
const HYP_COL = { "2021-22": "2021-22_hyp", "2022-23": "2022-23_hyp", "2023-24": "2023-24_hyp", "2024-25": "2024-25_hyp", "2025-26": "2025_26_hyp" };

const srcCsv = process.argv[2] || resolve(SOURCE, "Data(tax).csv");
const valCsv = process.argv[3] || resolve(SOURCE, "lg04_fy2025-26_valuation.csv");
const fipsCsv = process.argv[4] || resolve(SOURCE, "nc_county_fips.csv");
const outPath = process.argv[5] || resolve(HERE, "../data/benchmarks.json");

function parseCsv(text) {
  return text.trim().split(/\r?\n/).map((line) => {
    const cells = [];
    let cur = "", quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') quoted = false;
        else cur += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ",") { cells.push(cur); cur = ""; }
      else cur += ch;
    }
    cells.push(cur);
    return cells;
  });
}

const money = (v) => Number(String(v == null ? "" : v).replace(/[",$]/g, "").trim()) || 0;
const lower = (c) => c.trim().toLowerCase();

function mapByCounty(csvText, valueHeader) {
  const rows = parseCsv(csvText);
  const head = rows[0].map(lower);
  const vi = head.indexOf(valueHeader);
  return Object.fromEntries(rows.slice(1).filter((r) => r[0]).map((r) => [lower(r[0]), r[vi].trim()]));
}

const valuation = mapByCounty(readFileSync(valCsv, "utf8"), "assessed_valuation");
const fips = mapByCounty(readFileSync(fipsCsv, "utf8"), "fips");

const taxRows = parseCsv(readFileSync(srcCsv, "utf8"));
const head = taxRows[0].map((h) => h.trim());

const out = {};
const problems = [];
for (const row of taxRows.slice(1)) {
  const name = (row[0] || "").trim();
  if (!name || name.toLowerCase() === "total") continue;
  const rec = Object.fromEntries(head.map((h, i) => [h, row[i]]));

  const byYear = YEARS.map((fy) => ({
    fy,
    actual: money(rec[ACT_COL[fy]]),
    hypothetical: money(rec[HYP_COL[fy]]),
  }));

  // The bill compares the FY2025-26 columns only (no multi-year sum).
  const act26 = money(rec["2025-26_act"]);
  const hyp26 = money(rec["2025_26_hyp"]);
  const l_scenario = Math.min(act26, hyp26);
  const x = money(valuation[lower(name)]);

  if (!x) problems.push(`${name}: missing assessed valuation`);

  out[slug(name)] = {
    label: `${name} County`,
    fips: fips[lower(name)] || null,
    baseline_year: 2019,
    period: "FY2025-26",
    x,
    // Data(tax).csv FY2025-26 columns (authoritative definition)
    act: act26,
    hyp: hyp26,
    cnt_diff: act26 - hyp26,
    pct_diff: hyp26 ? round6((act26 / hyp26 - 1) * 100) : null,
    // Column Q = 5-year_savings_rate from the Data(tax).csv; the receipt's "% lower"
    // always reflects this published figure.
    savings_rate: parseFloat(rec["5-year_savings_rate"]),
    savings_rate_fy26: act26 ? (act26 - hyp26) / act26 : null,
    // Values the calculation library consumes
    l_actual: act26,
    b_endpoint: hyp26,
    l_benchmark: hyp26,
    l_scenario,
    r_actual: x ? round6((100 * act26) / x) : null,
    r_scenario: x ? round6((100 * l_scenario) / x) : null,
    below_benchmark: act26 <= hyp26,
    by_year: byYear.filter((y) => y.fy === "2025-26"),
  };
}

writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");
const below = Object.values(out).filter((c) => c.below_benchmark).length;
console.log(`Wrote ${outPath} with ${Object.keys(out).length} counties (${below} at/below benchmark)`);
if (problems.length) console.warn("WARNINGS:\n" + problems.join("\n"));

function slug(v) { return v.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
function round6(n) { return Math.round(n * 1e6) / 1e6; }
