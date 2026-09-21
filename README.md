# NC Property Tax — Understanding HB 1089 (Static Demo)

A static, single-page site hosted on GitHub Pages (no backend required). Enter a North
Carolina street address, pick the matching parcel, and the page estimates what the
county-wide property tax would have been under an HB 1089–style **levy limit** anchored
to a **2019 base year**.

The result is presented as a simple bill: **what you paid**, **what you could have
paid**, and **you could have saved**.

## How it works

For each county the page holds four official inputs: the FY2025-26 county-wide levy
(`L_actual`), the FY2025-26 assessed valuation (`X`), the 2019 base-year levy, and a
benchmark ceiling grown forward from 2019 by **inflation (CPI-U) + population growth**.

```
B_2019      = L_2019
B_t         = B_(t-1) * (1 + inflation_growth_t + population_growth_t)
L_scenario  = min(L_actual, B)          # the limit is a ceiling, never an increase
r_actual    = 100 * L_actual   / X
r_scenario  = 100 * L_scenario / X
tax_actual  = V * r_actual   / 100
tax_scenario= V * r_scenario / 100
savings     = tax_actual - tax_scenario
```

- `V` = parcel assessed value from NC OneMap (ordinary residential parcels only).
- Assessed value is held constant; reassessment timing is not modeled.
- County-wide property tax only — municipal, school, and special district taxes are
  out of scope.
- Where the county is at or below the benchmark, `L_scenario = L_actual` and the page
  shows a short "no savings" explanation instead of the bill.

Four counties are at or below the benchmark for FY2025-26: **Alamance, Macon, Madison,
and Moore**.

## Data

`data/benchmarks.json` holds the per-county inputs (all 100 counties) keyed by county
slug, with the full 5-digit STCOFIPS. It is generated from the canonical 2019-base
dataset (`Data(tax).csv` for levies, NCDOR LG04 FY2025-26 for assessed valuation) in
the companion `property_tax_widget` project (`build_calculator_data.py`).

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
