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

test("Wake fixture: V=291834 => paid 1509.82, could 1311.13, saved 198.69, 13% lower", () => {
  const res = PT.computeReceipt(291_834, county);
  assert.equal(res.ok, true);
  assert.ok(Math.abs(res.paid - 1509.82) < 0.01, `paid ${res.paid}`);
  assert.ok(Math.abs(res.could_have - 1311.13) < 0.02, `could ${res.could_have}`);
  assert.ok(Math.abs(res.saved - 198.69) < 0.02, `saved ${res.saved}`);
  assert.equal(Math.round(100 * res.rate), 13);
});

test("receipt math identities: paid=V*act/X; could=(1-rate)*paid; saved=rate*paid", () => {
  const V = 400_000;
  const res = PT.computeReceipt(V, county);
  assert.equal(res.paid, (V * county.act) / county.x);
  assert.equal(res.could_have, res.paid * (1 - county.savings_rate));
  assert.equal(res.saved, res.paid * county.savings_rate);
  assert.ok(Math.abs(res.saved + res.could_have - res.paid) < 1e-6, `${res.saved} + ${res.could_have} != ${res.paid}`);
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

/* --------------------------------------------------------------------------
 * Address normalisation. OneMap stores a standardised street line, but the
 * field receives whole postal addresses from browser autofill and people
 * spell suffixes out. These forms are tried narrowest-first; the last is
 * always the raw string, so nothing that worked before stops working.
 * ------------------------------------------------------------------------ */

const first = (s) => PT.buildQueryVariants(s)[0];

test("autofill output is reduced to the street line", () => {
  assert.equal(first("1000 E Woodlawn Rd, Charlotte, NC 28203"), "1000 E WOODLAWN RD");
  assert.equal(first("1000 E Woodlawn Rd, Charlotte, North Carolina 28203-1234"), "1000 E WOODLAWN RD");
});

test("a pasted address with no commas still drops city, state and ZIP", () => {
  assert.equal(first("1000 E Woodlawn Rd Charlotte NC 28203"), "1000 E WOODLAWN RD");
  assert.equal(first("123 Main St Winston-Salem NC 27101"), "123 MAIN ST");
  assert.equal(first("123 Main St Winston Salem NC 27101"), "123 MAIN ST");
});

test("a plain street address is left exactly as typed", () => {
  assert.equal(first("1000 E Woodlawn Rd"), "1000 E WOODLAWN RD");
  assert.equal(first("Home Rd"), "HOME RD");
  // No city, state or ZIP, so nothing is stripped off the end.
  assert.equal(first("1000 Woodlawn"), "1000 WOODLAWN");
});

test("spelled-out suffixes and directions fold to the stored abbreviation", () => {
  assert.equal(first("1000 East Woodlawn Road"), "1000 E WOODLAWN RD");
  assert.equal(first("1000 East Woodlawn Rd"), "1000 E WOODLAWN RD");
  assert.equal(first("12 North Main Street"), "12 N MAIN ST");
  assert.equal(first("7 Oak Avenue"), "7 OAK AVE");
  assert.equal(first("9 Ridge Parkway"), "9 RDG PKWY");
  // A county that spells the suffix out is still reachable: the suffix-free
  // rung, and the raw text last, cover both storage conventions.
  assert.equal(PT.buildQueryVariants("9 Ridge Parkway").at(-1), "9 Ridge Parkway");
});

test("a unit designator gets its own rung, then the bare street line", () => {
  assert.deepEqual(PT.buildQueryVariants("1000 E Woodlawn Rd Apt 4B"),
    ["1000 E WOODLAWN RD APT 4B", "1000 E WOODLAWN RD", "1000 E WOODLAWN"]);
  assert.deepEqual(PT.buildQueryVariants("1000 E Woodlawn Rd #4B"),
    ["1000 E WOODLAWN RD # 4B", "1000 E WOODLAWN RD", "1000 E WOODLAWN", "1000 E Woodlawn Rd #4B"]);
  assert.deepEqual(PT.buildQueryVariants("1000 E Woodlawn Rd 4"),
    ["1000 E WOODLAWN RD 4", "1000 E WOODLAWN RD", "1000 E WOODLAWN"]);
  // A street number alone is a house number, not a unit.
  assert.deepEqual(PT.buildQueryVariants("1000 E Woodlawn Rd"), ["1000 E WOODLAWN RD", "1000 E WOODLAWN"]);
});

test("dropping the suffix makes the query match any suffix", () => {
  const forms = PT.buildQueryVariants("1000 E Woodlawn Road");
  assert.ok(forms.includes("1000 E WOODLAWN"), "street plus name is reachable");
  // The suffix-free form is a substring of every suffixed spelling OneMap holds.
  for (const stored of ["1000 E WOODLAWN RD", "1000 E WOODLAWN AVE", "1000 E WOODLAWN WAY"]) {
    assert.ok(stored.includes("1000 E WOODLAWN"), `${stored} is reachable`);
  }
});

test("an unknown suffix still falls through to the suffix-free form", () => {
  assert.deepEqual(PT.buildQueryVariants("1000 Woodlawn Turn"), ["1000 WOODLAWN TURN", "1000 WOODLAWN"]);
});

test("the ladder never widens past house number plus street name", () => {
  for (const q of ["1000 Woodlawn", "1000 E Woodlawn", "1000 E Woodlawn Rd", "1000 Woodlawn Turn"]) {
    for (const v of PT.buildQueryVariants(q)) {
      assert.ok(v.split(/\s+/).length >= 2, `"${v}" is too broad to search`);
    }
  }
  // A bare house number is still searchable, which the status copy advertises.
  assert.deepEqual(PT.buildQueryVariants("1000"), ["1000"]);
});

test("every rung is quoted, and the raw text is the last resort", () => {
  const forms = PT.buildQueryVariants("O'Brien Rd, Raleigh, NC 27601");
  assert.equal(forms[0], "O'BRIEN RD", "the apostrophe survives normalisation");
  assert.equal(
    PT.buildAddressWhere(forms[0]),
    "UPPER(siteadd) LIKE UPPER('%O''BRIEN RD%')",
    "and is escaped exactly once, by buildAddressWhere"
  );
  for (const v of forms) {
    const w = PT.buildAddressWhere(v);
    // Quotes only ever appear as the pattern delimiters or as a doubled pair.
    assert.equal((w.match(/'/g) || []).length % 2, 0, `odd quote count in ${w}`);
  }
  assert.equal(forms.at(-1), "O'Brien Rd, Raleigh, NC 27601", "raw text is last");
});

test("variants are deduplicated case-insensitively, and empty input yields none", () => {
  assert.deepEqual(PT.buildQueryVariants("1000 woodlawn rd"), ["1000 WOODLAWN RD", "1000 WOODLAWN"]);
  assert.deepEqual(PT.buildQueryVariants(""), []);
  assert.deepEqual(PT.buildQueryVariants("   "), []);
  assert.deepEqual(PT.buildQueryVariants(null), []);
  assert.deepEqual(PT.buildQueryVariants("***"), [], "nothing searchable left after stripping");
  // Hyphens are kept, for hyphenated street and city names.
  assert.deepEqual(PT.buildQueryVariants("123 Main St, Winston-Salem NC"),
    ["123 MAIN ST", "123 MAIN", "123 Main St, Winston-Salem NC"]);
});

test("a doubled-up spelling does not produce a repeated token", () => {
  assert.equal(first("123 Main Road Rd"), "123 MAIN RD");
});

/* --------------------------------------------------------------------------
 * Counties with no site address in the state parcel service. They cannot be
 * matched to a parcel, so no receipt is printed, but the county-level
 * savings rate is published for every county and is still reported.
 * ------------------------------------------------------------------------ */

test("counties with no published site address are identified by FIPS", () => {
  for (const slug of ["hoke", "perquimans", "richmond"]) {
    assert.equal(PT.hasParcelAddress(BENCHMARKS[slug]), false, `${slug} has no parcel address`);
  }
  // Orange is in the same situation in the parcel service but is expected to
  // be served, so the flag must not simply mirror the no-address list.
  for (const slug of ["orange", "guilford", "mecklenburg", "wake", "alamance", "moore"]) {
    assert.equal(PT.hasParcelAddress(BENCHMARKS[slug]), true, `${slug} should be served`);
  }
});

test("a missing or malformed county is treated as served rather than blocked", () => {
  assert.equal(PT.hasParcelAddress(null), true);
  assert.equal(PT.hasParcelAddress(undefined), true);
  assert.equal(PT.hasParcelAddress({}), true);
});

test("every county-level-only county still has a publishable savings rate", () => {
  for (const slug of ["hoke", "perquimans", "richmond"]) {
    const c = BENCHMARKS[slug];
    assert.ok(c.savings_rate > 0, `${slug} has a savings rate to report`);
    assert.equal(c.below_benchmark, false, `${slug} is not a below-benchmark county`);
    assert.ok(c.period, `${slug} has a period to cite`);
    assert.ok(Math.round(c.savings_rate * 100) >= 1, `${slug} rounds to a whole percent`);
  }
});

/* --------------------------------------------------------------------------
 * The six counties the statewide parcel layer cannot search. Each resolves an
 * address through its own service and then reads the value from the statewide
 * layer by parcel number.
 * ------------------------------------------------------------------------ */

const SERVED = {
  orange: "37135", bladen: "37017", franklin: "37069",
  cabarrus: "37025", guilford: "37081", avery: "37011",
};

test("each served county has a usable source pointing at a real endpoint", () => {
  for (const [slug, fips] of Object.entries(SERVED)) {
    assert.equal(BENCHMARKS[slug].fips, fips, `${slug} fips`);
    const src = PT.parcelSource(fips);
    assert.ok(src, `${slug} has a parcel source`);
    assert.equal(src.county, BENCHMARKS[slug].label.replace(/ County$/, ""), `${slug} source names the county`);
    assert.ok(["key", "point"].includes(src.mode), `${slug} has a known mode`);
    assert.ok(src.address.startsWith("https://"), `${slug} endpoint is absolute`);
    assert.ok(src.field, `${slug} names an address field`);
    if (src.mode === "key") {
      assert.ok(src.key, `${slug} names a parcel key field`);
    } else {
      assert.ok(src.lon && src.lat, `${slug} names coordinate fields`);
      assert.ok(src.srs === 4326 || src.srs === 102719, `${slug} declares a known spatial reference`);
    }
  }
});

test("a county the statewide layer can search has no parcel source", () => {
  for (const slug of ["mecklenburg", "wake", "durham", "alamance", "moore", "rowan", "onslow"]) {
    assert.equal(PT.parcelSource(BENCHMARKS[slug].fips), null, `${slug} uses the direct search`);
  }
  assert.equal(PT.parcelSource(null), null);
  assert.equal(PT.parcelSource("nonsense"), null);
});

test("the statewide parcel number is reformatted only where the county differs", () => {
  // Cabarrus writes PINs with a decimal tail and the statewide layer pads them.
  assert.equal(PT.oneMapParno("37025", "5552051850.00000000"), "55520518500000");
  // Everywhere else the two agree and the value passes through untouched.
  for (const [fips, value] of [["37135", "9872416580"], ["37017", "026918412138"], ["37069", "2809-23-4743"]]) {
    assert.equal(PT.oneMapParno(fips, value), value);
    assert.equal(PT.oneMapParno(fips, ` ${value} `), value, "surrounding space is trimmed");
  }
  assert.equal(PT.oneMapParno("37025", ""), "");
  assert.equal(PT.oneMapParno("37025", null), "");
});

test("county variants try the county's own spelling first, then the other", () => {
  const abbr = PT.buildCountyVariants("1000 N Main St", false);
  const long = PT.buildCountyVariants("1000 N Main St", true);
  assert.equal(abbr[0], "1000 N MAIN ST", "abbreviated county gets the short form first");
  assert.equal(long[0], "1000 NORTH MAIN STREET", "spelled-out county gets the long form first");
  // Both spellings are always tried, so a county that changes convention still works.
  for (const list of [abbr, long]) {
    assert.ok(list.includes("1000 N MAIN ST"), "the short form is tried");
    assert.ok(list.includes("1000 NORTH MAIN STREET"), "the long form is tried");
    assert.ok(list.includes("1000 N MAIN"), "the suffix-free form is tried");
    // The raw text is the last resort, unless an earlier form already matches it
    // case-insensitively, in which case there is nothing to gain by sending it.
    assert.ok(
      list.some((v) => v.toUpperCase() === "1000 N MAIN ST"),
      "the raw text is covered"
    );
  }
});

test("county variants strip a city, state and ZIP from every derived form", () => {
  const raw = "1000 Woodlawn Rd, Charlotte, NC 28203";
  const list = PT.buildCountyVariants(raw, false);
  assert.equal(list[0], "1000 WOODLAWN RD");
  // Only the raw fallback keeps what the reader typed; nothing derived from it
  // carries the city or the ZIP.
  for (const v of list.slice(0, -1)) {
    assert.ok(!/28203/.test(v), `${v} should not carry the ZIP`);
    assert.ok(!/CHARLOTTE/.test(v), `${v} should not carry the city`);
  }
  assert.ok(list.some((v) => v.toUpperCase() === raw.toUpperCase()), "the raw text is still tried last");
});

test("a residential code override exists only for the county that needs one", () => {
  assert.deepEqual(PT.residentialCodes("37069"), ["D", "LWMH", "MHP"]);
  for (const slug of ["orange", "bladen", "cabarrus", "guilford", "avery", "mecklenburg"]) {
    assert.equal(PT.residentialCodes(BENCHMARKS[slug].fips), null, `${slug} uses the shared rule`);
  }
  assert.equal(PT.residentialCodes(null), null);
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

test("receipt percentage equals Data(tax).csv column Q (Wake ~13%), not the single-year rate", () => {
  assert.equal(Math.round(100 * BENCHMARKS.wake.savings_rate), 13);
  assert.ok(Math.abs(BENCHMARKS.wake.savings_rate_fy26 - 0.21582375051269642) < 1e-9);
});

test("two counties are at/below benchmark for FY2025-26", () => {
  const names = Object.values(BENCHMARKS).filter(c => c.below_benchmark).map(c => c.label).sort();
  assert.deepEqual(names, ["Alamance County", "Moore County"]);
});

test("benchmarks are reproducible from the vendored build inputs", () => {
  const repo = path.join(__dirname, "..");
  const r = spawnSync(process.execPath, ["tools/build_benchmarks.mjs"], { cwd: repo, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const rebuilt = JSON.parse(readFileSync(path.join(repo, "data", "benchmarks.json"), "utf8"));
  assert.deepEqual(rebuilt, BENCHMARKS);
});