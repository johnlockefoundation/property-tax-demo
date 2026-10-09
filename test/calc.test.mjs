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
const county = BENCHMARKS.wake; // above benchmark (grade B)
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
// Row 1 is a methodology note; the header row names the columns.
const CSV_HEAD_INDEX = CSV_ROWS.findIndex((r) => (r[0] || "").trim().toLowerCase() === "county");
const CSV_HEAD = CSV_ROWS[CSV_HEAD_INDEX].map(h => h.trim());
const CSV_BY_SLUG = new Map();
for (const r of CSV_ROWS.slice(CSV_HEAD_INDEX + 1)) {
  if (!r[0] || r[0].trim().toLowerCase() === "total") continue;
  const rec = Object.fromEntries(CSV_HEAD.map((h, i) => [h, r[i]]));
  const slug = r[0].trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  CSV_BY_SLUG.set(slug, rec);
}

// ---- Per-property receipt ----

test("Wake fixture: V=291834 => paid 1509.82, could 1486.87, saved 22.95, 2% lower", () => {
  const res = PT.computeReceipt(291_834, county);
  assert.equal(res.ok, true);
  assert.ok(Math.abs(res.paid - 1509.82) < 0.01, `paid ${res.paid}`);
  assert.ok(Math.abs(res.could_have - 1486.87) < 0.02, `could ${res.could_have}`);
  assert.ok(Math.abs(res.saved - 22.95) < 0.02, `saved ${res.saved}`);
  assert.equal(Math.round(100 * res.rate), 2);
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
 * Counties whose site address is padded. 59 of them write `siteadd` with a run
 * of two or more spaces, which no LIKE pattern built from single-spaced input
 * can match, so the address is looked up in the statewide NG9-1 layer instead and
 * the parcel found from its point. docs/address-search-whitespace.md has the
 * per-county scan.
 * ------------------------------------------------------------------------ */

const nh = (q, fips = "37129") => PT.buildAddressNcQueries(PT.parseAddressParts(q), fips);

test("the reported address parses into the parts the address layer stores", () => {
  // "5223  LONE  EAGLE  CT" is New Hanover's siteadd; typed with any suffix
  // spelling it still has to come out as house number 5223 and the street name.
  for (const typed of ["5223 Lone Eagle Lane", "5223 Lone Eagle Ln", "5223 Lone Eagle Ct",
                       "5223  LONE  EAGLE  CT", "5223 LONE EAGLE COURT, Wilmington NC 28409"]) {
    const p = PT.parseAddressParts(typed);
    assert.deepEqual(p, { number: "5223", digits: "5223", predir: null, name: "LONE EAGLE" }, typed);
  }
  assert.deepEqual(nh("5223 Lone Eagle Lane"),
    ["countyfips='129' AND add_number='5223' AND UPPER(st_name) LIKE UPPER('%LONE EAGLE%')"]);
});

test("an address with no house number or no street name cannot use this route", () => {
  // The layer matches the number exactly and the name as a substring, so either
  // one missing would be an unconstrained scan. The `siteadd` ladder is what
  // serves partial addresses.
  for (const typed of ["1000", "Lone Eagle", "Main", "O'Brien Rd", "", "   ", "***", null]) {
    assert.equal(PT.parseAddressParts(typed), null, String(typed));
    assert.deepEqual(PT.buildAddressNcQueries(PT.parseAddressParts(typed), "37129"), [], String(typed));
  }
});

test("a query is scoped to the county, and a statewide search is left unscoped", () => {
  assert.ok(nh("5223 Lone Eagle Ln").every((w) => w.startsWith("countyfips='129' AND ")));
  // AddressNC keys the county on three digits.
  assert.ok(nh("36 Asher Ln", "37021").every((w) => w.startsWith("countyfips='021' AND ")));
  assert.ok(PT.buildAddressNcQueries(PT.parseAddressParts("5223 Lone Eagle Ln")).every((w) => !w.includes("countyfips")));
  assert.ok(PT.buildAddressNcQueries(null, "37129").length === 0, "nothing parsed, nothing to ask");
});

test("the pre-direction is asked for in both spellings, then dropped", () => {
  // Mecklenburg writes EAST where New Hanover leaves the field blank, so an exact
  // match on one spelling would miss the other.
  const rungs = nh("1000 E Woodlawn Rd", "37119");
  assert.deepEqual(rungs, [
    "countyfips='119' AND add_number='1000' AND st_predir IN ('E','EAST') AND UPPER(st_name) = UPPER('WOODLAWN')",
    "countyfips='119' AND add_number='1000' AND st_predir IN ('E','EAST') AND UPPER(st_name) LIKE UPPER('%WOODLAWN%')",
    "countyfips='119' AND add_number='1000' AND UPPER(st_name) LIKE UPPER('%WOODLAWN%')",
  ]);
  // Narrowest first: the exact street name is asked for before the substring.
  assert.ok(rungs[0].includes("= UPPER('WOODLAWN')"));
  assert.ok(rungs.at(-1).includes("LIKE UPPER('%WOODLAWN%')"));
});

test("a street named after a direction or a type is asked for by name, spelled out", () => {
  // New Hanover's "3811 NORTHEAST AVE" is Northeast Avenue, and Chatham's
  // "111 LANE ST" is Lane Street. Searching the abbreviation as a pre-direction,
  // or stripping the type off the front of the name, would look for a street
  // called "AVE" or "LN".
  for (const typed of ["3811 Northeast Ave", "3811 Northeast"]) {
    assert.deepEqual(PT.parseAddressParts(typed),
      { number: "3811", digits: "3811", predir: null, name: "NORTHEAST" }, typed);
  }
  assert.deepEqual(PT.parseAddressParts("111 Lane St"),
    { number: "111", digits: "111", predir: null, name: "LANE" });
  // "N Ave" is not knowable: N could be any of the four quadrants, so it is
  // asked for as typed rather than guessed at.
  assert.deepEqual(PT.parseAddressParts("3811 N Ave"),
    { number: "3811", digits: "3811", predir: null, name: "NORTH" });
  // An ordinary street keeps its pre-direction and its name folded.
  assert.deepEqual(PT.parseAddressParts("12 N Main St"),
    { number: "12", digits: "12", predir: "N", name: "MAIN" });
  assert.deepEqual(PT.parseAddressParts("1000 E Woodlawn Rd"),
    { number: "1000", digits: "1000", predir: "E", name: "WOODLAWN" });
  // A name that merely ends in a folded word keeps the fold, since the layer
  // holds "FOX WOOD" rather than a spelled-out variant of it.
  assert.deepEqual(PT.parseAddressParts("70 Fox Wood Ln"),
    { number: "70", digits: "70", predir: null, name: "FOX WOOD" });
});

test("a letter on the house number gets a looser rung, after the exact one", () => {
  const rungs = nh("123A Oak St", null);
  assert.deepEqual(rungs, [
    "add_number='123A' AND UPPER(st_name) LIKE UPPER('%OAK%')",
    "add_number LIKE '123%' AND UPPER(st_name) = UPPER('OAK')",
    "add_number LIKE '123%' AND UPPER(st_name) LIKE UPPER('%OAK%')",
  ]);
  // A plain number needs no looser rung, so the ladder stays short.
  assert.equal(nh("5223 Lone Eagle Ln").length, 1);
});

test("patterns are upper-cased and quotes doubled", () => {
  // This layer's LIKE is case-sensitive even through UPPER(), and a quote in a
  // street name must not be able to end the literal.
  const w = nh("5223 Lone Eagle Ln").at(-1);
  assert.ok(w.includes("UPPER('%LONE EAGLE%')"), w);
  const quoted = nh("123 O'Brien Rd", null);
  assert.ok(quoted.every((q) => !q.includes("O'Brien'")), "quotes are doubled");
  assert.ok(quoted.every((q) => (q.match(/'/g) || []).length % 2 === 0), quoted.join(" | "));
});

test("the street type is never filtered on, because counties disagree about it", () => {
  // The same address is CT in New Hanover's siteadd and COURT in the address
  // layer, so a query that asked for the typed type would miss it.
  for (const typed of ["5223 Lone Eagle Ct", "5223 Lone Eagle Lane", "5223 Lone Eagle Court"]) {
    assert.deepEqual(nh(typed), nh("5223 Lone Eagle Ln"), typed);
  }
});

test("the layer is queried for fields the point resolution needs", () => {
  assert.equal(PT.ADDRESS_NC, "https://services.nconemap.gov/secure/rest/services/AddressNC/NC1Map_Addresses/MapServer/0/query");
  const fields = PT.ADDRESS_NC_FIELDS.split(",");
  for (const f of ["add_number", "st_name", "countyfips", "long", "lat"]) {
    assert.ok(fields.includes(f), `${f} is requested`);
  }
});

test("the counties that report a county-level rate stay out of the parcel route", () => {
  // The address layer holds addresses for all seven, but printing a receipt
  // there would contradict the message the tool already shows them: for Camden,
  // Chowan and Yancey the parcel layer carries no assessed value, and the other
  // four cannot be matched to an address the tool can rely on.
  for (const slug of ["camden", "chowan", "franklin", "hoke", "perquimans", "richmond", "yancey"]) {
    assert.equal(PT.hasParcelAddress(BENCHMARKS[slug]), false, slug);
  }
  assert.equal(PT.hasParcelAddress(BENCHMARKS["new-hanover"]), true, "New Hanover is served per parcel");
});

test("COURT folds to CT, which is how the parcel layer writes it", () => {
  assert.equal(first("5223 Lone Eagle Court"), "5223 LONE EAGLE CT");
  // ...and dropping the type still reaches a county that pads the street name.
  assert.ok(PT.buildQueryVariants("5223 Lone Eagle Ct").includes("5223 LONE EAGLE"));
});

/* --------------------------------------------------------------------------
 * Counties the tool cannot serve per parcel — no usable site address, or an
 * address with no assessed value in the parcel layer. No receipt can be
 * printed, but the county-level savings rate is published for every county
 * and is still reported.
 * ------------------------------------------------------------------------ */

test("counties that cannot be served per-parcel are identified by FIPS", () => {
  for (const slug of ["camden", "chowan", "franklin", "hoke", "perquimans", "richmond", "yancey"]) {
    assert.equal(PT.hasParcelAddress(BENCHMARKS[slug]), false, `${slug} is a county-level county`);
  }
  // Orange has no site address in the parcel service either, but its own
  // service answers reliably, so the flag must not simply mirror that list.
  for (const slug of ["orange", "guilford", "mecklenburg", "wake", "alamance", "moore"]) {
    assert.equal(PT.hasParcelAddress(BENCHMARKS[slug]), true, `${slug} should be served`);
  }
});

test("a missing or malformed county is treated as served rather than blocked", () => {
  assert.equal(PT.hasParcelAddress(null), true);
  assert.equal(PT.hasParcelAddress(undefined), true);
  assert.equal(PT.hasParcelAddress({}), true);
});

test("every county-level-only county has a rate to report or is at/below benchmark", () => {
  for (const slug of ["camden", "chowan", "franklin", "hoke", "perquimans", "richmond", "yancey"]) {
    const c = BENCHMARKS[slug];
    assert.ok(c.period, `${slug} has a period to cite`);
    if (c.below_benchmark) {
      // A negative rate cannot be spoken as "NN% lower"; the site shows the
      // no-savings sentence for these instead.
      assert.ok(c.savings_rate <= 0, `${slug} at/below benchmark has no positive rate`);
    } else {
      assert.ok(c.savings_rate > 0, `${slug} has a savings rate to report`);
      assert.ok(Math.round(c.savings_rate * 100) >= 1, `${slug} rounds to a whole percent`);
    }
  }
  // Franklin and Richmond joined the at/below set once inflation was applied
  // to every county; the other five still report a positive county rate.
  const atBelow = ["camden", "chowan", "franklin", "hoke", "perquimans", "richmond", "yancey"]
    .filter((s) => BENCHMARKS[s].below_benchmark).sort();
  assert.deepEqual(atBelow, ["franklin", "richmond"]);
});

/* --------------------------------------------------------------------------
 * The six counties the statewide parcel layer cannot search. Each resolves an
 * address through its own service and then reads the value from the statewide
 * layer by parcel number.
 * ------------------------------------------------------------------------ */

const SERVED = {
  orange: "37135", bladen: "37017",
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
  for (const [fips, value] of [["37135", "9872416580"], ["37017", "026918412138"]]) {
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


test("the residential filter needs an improvement value only on a text search", () => {
  // OneMap has no improvement figure for some houses, which is the whole reason
  // the two paths differ. Both fixtures are houses the county lists.
  const houseNoImprov = { parval: 260020, improvval: 0, parusecode: "", parusedesc: "" };
  const bareLand = { parval: 50000, improvval: 0, parusecode: "", parusedesc: "" };
  const noValue = { parval: 0, improvval: 0, parusecode: "", parusedesc: "" };

  // A free-text search cannot tell that parcel from a lot, so it needs the
  // improvement figure and rejects the house it cannot confirm.
  assert.deepEqual(PT.keepResidential([houseNoImprov], false), []);
  // An exact parcel from the county's own address layer is taken on the
  // county's word that the address exists there, so the value is the only test.
  assert.deepEqual(PT.keepResidential([houseNoImprov], true), [houseNoImprov]);
  // Land the county also lists at that address is still shown, which is the
  // deliberate cost of not having a land-use code to read.
  assert.deepEqual(PT.keepResidential([bareLand], true), [bareLand]);
  // A parcel with no value is never shown, either way.
  assert.deepEqual(PT.keepResidential([noValue], true), []);
  assert.deepEqual(PT.keepResidential([noValue], false), []);
});

test("where the county publishes a land-use code, both routes use it", () => {
  const home = { parval: 500000, improvval: 400000, parusecode: "R300", parusedesc: "RESIDENTIAL" };
  const flats = { parval: 27000000, improvval: 22000000, parusecode: "C", parusedesc: "APART" };
  for (const exact of [false, true]) {
    assert.deepEqual(PT.keepResidential([home, flats], exact), [home],
      `an apartment block is not an ordinary residence (exact=${exact})`);
  }
});

test("residential filter keeps usable homes and excludes commercial/non-value", () => {
  assert.equal(PT.isUsableResidential({ parval: 260653, parusecode: "R100" }), true);
  assert.equal(PT.isUsableResidential({ parval: 2754300, parusecode: "C700" }), false);
  assert.equal(PT.isUsableResidential({ parval: 0, parusecode: "R100" }), false);
  assert.equal(PT.isUsableResidential({ parval: 260653, parusecode: null }), false);
});

test("a county whose codes cannot be read still yields its houses", () => {
  // Mitchell writes "561" and Catawba writes "03" with no legend in the layer,
  // so the label cannot be tested and the improvement figure is the only signal
  // that a house was built on the parcel. Without this, every address in both
  // counties was reported as "no matches found".
  const house = { parval: 77900, improvval: 42700, parusecode: "", parusedesc: "561" };
  const bareLand = { parval: 8913, improvval: 0, parusecode: "", parusedesc: "500" };
  assert.deepEqual(PT.keepResidential([house], false), [house], "a house with an improvement");
  assert.deepEqual(PT.keepResidential([bareLand], false), [], "bare land still rejected");
  assert.deepEqual(PT.keepResidential([{ ...house, improvval: 0 }], true), [{ ...house, improvval: 0 }],
    "an exact county route needs no improvement figure");
});

test("a county's own vocabulary is read, including its abbreviations", () => {
  // Values captured from the live service.
  const cases = [
    ["D-Dwelling", 180000, 120000, true],   // Nash
    ["V-Vacant", 40000, 0, false],
    ["C-Commercial", 500000, 400000, false],
    ["RES", 607800, 0, true],               // Union
    ["COM", 900000, 0, false],
    ["Improved", 88820, 62790, true],       // Cherokee
    ["Vacant", 263180, 163180, false],
  ];
  for (const [desc, parval, improvval, expected] of cases) {
    const p = { parval, improvval, parusecode: "", parusedesc: desc };
    assert.equal(PT.keepResidential([p], false).length, expected ? 1 : 0,
      `${desc} ${expected ? "is" : "is not"} a house`);
  }
});

test("a land-use label the county applies to every parcel is not a classification", () => {
  // Duplin writes "VACANT LAND" on all 43,273 of its addressed parcels and Surry
  // "Vacant" on all 44,417, six-figure houses included. Read as a classification
  // that constant empties the county, so it must not veto a house. Cherokee, which
  // really does distinguish "Improved" from "Vacant", is unaffected.
  const duplin = [
    { stcntyfips: "37061", parval: 214830, improvval: 208230, parusecode: "", parusedesc: "VACANT LAND" },
    { stcntyfips: "37061", parval: 135700, improvval: 98000, parusecode: "", parusedesc: "VACANT LAND" },
  ];
  assert.deepEqual(PT.keepResidential(duplin, false), duplin, "both are houses");
  const cherokee = [
    { parval: 88820, improvval: 62790, parusecode: "", parusedesc: "Improved" },
    { parval: 263180, improvval: 163180, parusecode: "", parusedesc: "Vacant" },
  ];
  assert.deepEqual(PT.keepResidential(cherokee, false), [cherokee[0]], "only the improved one");
  // A county with no land-use data at all behaves as it always has.
  const blank = [{ parval: 260020, improvval: 0, parusecode: "", parusedesc: "" }];
  assert.deepEqual(PT.keepResidential(blank, false), []);
  assert.deepEqual(PT.keepResidential(blank, true), blank);
});

test("a description the county wrote settles the parcel, whatever the code says", () => {
  // Henderson populates both fields and they contradict each other: its
  // parusecode pairs "INDUSTRIAL", "RESTAURANTS" and "OFFICES" with
  // "RES-SINGLE FAMILY" on the same row. The description is the classification
  // and the code records what stands on the parcel, so the description decides
  // and the code is only read when the description is blank.
  const house = { stcntyfips: "37089", parval: 386300, improvval: 300000, parusecode: "OFFICES", parusedesc: "RES-TOWNHOUSE" };
  assert.deepEqual(PT.keepResidential([house], false), [house], "the code does not veto the description");
  // A restaurant has a description that says so.
  const shop = { stcntyfips: "37089", parval: 260000, improvval: 250000, parusecode: "RESTAURANTS", parusedesc: "COMMERCIAL" };
  assert.deepEqual(PT.keepResidential([shop], false), [], "rejected on the description, not the R");
  // With no description the code is all there is, and it is still not a code.
  assert.deepEqual(PT.keepResidential([{ ...shop, parusedesc: "" }], false), [],
    "a description-less parcel falls back to the improvement figure, not to an R");
});

test("Henderson's own residential and commercial wording is read", () => {
  // Values captured from the live service.
  const houses = ["RES-SINGLE FAMILY", "RES-CONDO", "RES-TOWNHOUSE", "RES-DUPLEX", "RES-MODULAR",
                  "RES-MULTI RE", "RES-LEASEHOLD", "RES-TRIPLEX", "REAL PROP MANF HOME",
                  "PERSONAL PROPERTY MH", "MANU HOME PARK"];
  for (const desc of houses) {
    const p = { stcntyfips: "37089", parval: 200000, improvval: 150000, parusecode: "", parusedesc: desc };
    assert.deepEqual(PT.keepResidential([p], false), [p], `${desc} is a house`);
  }
  const notHouses = ["VACANT LAND", "COMM VACANT LAND", "IND VACANT LAND", "COMMERCIAL", "RELIGIOUS",
                     "GOVERNMENTAL", "INDUSTRIAL", "COMM-CONDO", "APT-CONDO", "MEDICAL", "CEMETERY",
                     "AGRICULTURE-HORTICUL", "UTILITIES", "PARKING LOT", "CAMPS", "LOW INCOME APARTMENT"];
  for (const desc of notHouses) {
    const p = { stcntyfips: "37089", parval: 200000, improvval: 150000, parusecode: "", parusedesc: desc };
    assert.deepEqual(PT.keepResidential([p], false), [], `${desc} is not a house`);
  }
});

test("a commercial prefix outranks the residential word inside it", () => {
  // "COMM-CONDO" and "APT-CONDO" contain CONDO, which is how a house is labelled.
  for (const desc of ["COMM-CONDO", "APT-CONDO", "COMM-LI"]) {
    const p = { stcntyfips: "37089", parval: 200000, improvval: 150000, parusecode: "", parusedesc: desc };
    assert.deepEqual(PT.keepResidential([p], false), [], desc);
  }
  // And a plain residential condo is still a house.
  const own = { stcntyfips: "37089", parval: 200000, improvval: 150000, parusecode: "", parusedesc: "RES-CONDO" };
  assert.deepEqual(PT.keepResidential([own], false), [own]);
});

test("an apartment block is not an ordinary residence", () => {
  // Several counties abbreviate it to "APART", which is not the "APARTMENT" a
  // single home is labelled.
  const flats = { parval: 27000000, improvval: 22000000, parusecode: "", parusedesc: "APART" };
  const offices = { parval: 900000, improvval: 800000, parusecode: "", parusedesc: "OFFICES" };
  assert.deepEqual(PT.keepResidential([flats], false), []);
  assert.deepEqual(PT.keepResidential([offices], false), []);
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
    assert.equal(c.below_benchmark, c.savings_rate <= 0, `${key} below`);
    assert.equal(c.by_year.length, 1, `${key} by_year`);
    assert.equal(c.by_year[0].fy, "2025-26", `${key} by_year year`);
    const csv = CSV_BY_SLUG.get(key);
    assert.ok(csv, `${key} present in Data(tax).csv`);
    assert.equal(c.savings_rate, parseFloat(csv["savings_rate"]), `${key} column Q`);
    assert.ok(Math.abs(c.savings_rate_fy26 - (c.act - c.hyp) / c.act) < 1e-9, `${key} fy26 rate`);
    assert.ok(Math.abs(c.pct_diff - (c.act / c.hyp - 1) * 100) < 1e-6, `${key} pct_diff`);
  }
});

test("receipt percentage equals Data(tax).csv column Q (Wake ~2%), not the single-year rate", () => {
  assert.equal(Math.round(100 * BENCHMARKS.wake.savings_rate), 2);
  assert.ok(Math.abs(BENCHMARKS.wake.savings_rate_fy26 - 0.03405157437744774) < 1e-9);
});

test("39 counties are at/below benchmark (five-year savings rate)", () => {
  const names = Object.values(BENCHMARKS).filter(c => c.below_benchmark).map(c => c.label).sort();
  assert.deepEqual(names, [
    "Alamance County",
    "Anson County",
    "Avery County",
    "Beaufort County",
    "Bertie County",
    "Bladen County",
    "Brunswick County",
    "Burke County",
    "Cabarrus County",
    "Carteret County",
    "Catawba County",
    "Clay County",
    "Cleveland County",
    "Craven County",
    "Cumberland County",
    "Dare County",
    "Duplin County",
    "Edgecombe County",
    "Forsyth County",
    "Franklin County",
    "Gaston County",
    "Henderson County",
    "Johnston County",
    "Macon County",
    "Madison County",
    "Martin County",
    "Mecklenburg County",
    "Montgomery County",
    "Moore County",
    "New Hanover County",
    "Pamlico County",
    "Pasquotank County",
    "Pitt County",
    "Richmond County",
    "Rutherford County",
    "Sampson County",
    "Union County",
    "Washington County",
    "Wilkes County"
  ]);
});

test("benchmarks are reproducible from the vendored build inputs", () => {
  const repo = path.join(__dirname, "..");
  const r = spawnSync(process.execPath, ["tools/build_benchmarks.mjs"], { cwd: repo, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const rebuilt = JSON.parse(readFileSync(path.join(repo, "data", "benchmarks.json"), "utf8"));
  assert.deepEqual(rebuilt, BENCHMARKS);
});