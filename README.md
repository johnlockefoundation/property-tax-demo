# NC Property Tax — Understanding HB 1089

A static, single-page site hosted on GitHub Pages (no backend required). Enter a North
Carolina street address, pick the matching parcel, and the page estimates what the
county-wide property tax would have been under an HB 1089–style **levy limit** anchored
to a **2019 base year**.

The result is presented as a store receipt for the single fiscal year **FY2025-26**:
**what you paid**, **what you could have paid**, and **you could have saved** (with a
percent figure).

## How it works

For each county a hypothetical benchmark levy is derived that compounds from the FY2020-21
actual levy by **inflation (BLS South urban CPI) + OSBM certified population growth**, per
the published research methodology. The published **5-year savings rate** (column Q of
`Data(tax).csv`) is the cumulative savings over FY2021-22–FY2025-26:

```
savings_rate = (cumulative actual levy - cumulative hypothetical levy) / cumulative actual levy
```

The receipt applies that rate to the property's current FY2025-26 county bill:

```
paid        = V * act / X          # V = parcel assessed value (NC OneMap)
                                  # act = county-wide FY2025-26 actual levy (NCDOR LG04)
                                  # X   = county FY2025-26 assessed valuation (LG04)
could_have  = paid * (1 - savings_rate)
saved       = paid * savings_rate  # the "percent lower" always matches column Q
```

- County-wide property tax only — municipal, school, and special district taxes are
  out of scope.
- Assessed value is held constant for the year; reassessment timing is not modeled.
- Where the county is at or below the benchmark, the page shows a short "no savings"
  explanation instead of a receipt.

Two counties are at or below the benchmark: **Alamance and Moore**.

## Data

`data/benchmarks.json` holds the per-county inputs (all 100 counties) keyed by county
slug, with the 5-digit STCOFIPS, the FY2025-26 actual/hypothetical levies, the assessed
valuation base, the column-Q savings rate, and the at/below flag.

Build inputs are **vendored** under `data/source/`, so the build is fully reproducible
without any sibling checkout:

```
data/source/
  Data(tax).csv                # authoritative yearly levies; column Q = 5-year savings rate
  lg04_fy2025-26_valuation.csv # NCDOR LG04 assessed valuation (taxable base X)
  nc_county_fips.csv           # county name -> 5-digit STCOFIPS
```

Regenerate `data/benchmarks.json` with:

```
node tools/build_benchmarks.mjs
```

The shared calculation logic lives in `calc.js` (`PT.computeReceipt`,
`PT.buildAddressWhere`, `PT.isUsableResidential`), used by the page and the tests.

## Methodology notes

See `docs/methodology.html` for the full methodology and data reconciliation notes.

## Tests

```
node --test test/calc.test.mjs
```

Tests cover the receipt arithmetic, address/residential filtering, column-Q wiring for
all 100 counties, the two at/below-benchmark counties, and build reproducibility.

## Local preview

```
python3 -m http.server 8000
```

then open `http://localhost:8000/`.

## Live site

https://johnlockefoundation.github.io/property-tax-demo/