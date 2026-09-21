# NC Property Tax — Understanding HB 1089 (Static Demo)

A static, single-page site hosted on GitHub Pages (no backend required). Enter a North
Carolina street address, pick the matching parcel, and the page estimates what the
county-wide property tax would have been under an HB 1089–style **levy limit** anchored
to a **2019 base year**.

The result is presented as a store receipt: the five fiscal years FY2021-22 through
FY2025-26 itemized, then **what you paid**, **what you could have paid**, and **you
could have saved**.

## How it works

The levy limit is a ceiling that compounds from the 2019 base year by **inflation
(CPI-U) + population growth**. For each county the CSV holds a hypothetical benchmark
levy for every fiscal year FY2021-22–FY2025-26, so the comparison is over the five-year
total:

```
L_actual   = sum of the five yearly county-wide levies actually collected
B          = sum of the five yearly 2019-base benchmark levies
L_scenario = min(L_actual, B)          # the limit is a ceiling, never an increase
r_actual   = 100 * L_actual   / X      # X = current assessed valuation (NCDOR LG04)
r_scenario = 100 * L_scenario / X
paid        = V * r_actual   / 100
could_have  = V * r_scenario / 100
savings     = paid - could_have        # as a % of paid = the county's savings rate
```

- `V` = parcel assessed value from NC OneMap (ordinary residential parcels only).
- Assessed value is held constant across the five years; reassessment timing is not
  modeled.
- County-wide property tax only — municipal, school, and special district taxes are
  out of scope.
- Where the county is at or below the benchmark, `L_scenario = L_actual` and the page
  shows a short "no savings" explanation instead of the receipt.

Four counties are at or below the benchmark: **Alamance, Macon, Madison, and Moore**.

## Data

`data/benchmarks.json` holds the per-county inputs (all 100 counties) keyed by county
slug, with the full 5-digit STCOFIPS, the five yearly actual/benchmark levies, and the
five-year totals. The headline percentage matches the `5-year_savings_rate` column in
`Data(tax).csv` (e.g. Wake 10.8% → grade C).

Regenerate it with:

```
node tools/build_benchmarks.mjs [Data(tax).csv] [valuation.csv] [fips.csv] [out.json]
```

Defaults point at the companion monorepo layout (`../../Data(tax).csv`,
`../../property-tax-widget/data/...`). The assessed valuation comes from the NCDOR LG04
FY2025-26 workbook.

The shared calculation logic lives in `calc.js` (`PT.computeComparison`), used by both
the page and the tests.

## Tests

```
node --test test/calc.test.mjs
```

## Local preview

```
python3 -m http.server 8000
```

then open `http://localhost:8000/`.

## Live site

https://mkale-jlf.github.io/property-tax-demo/
