# AGENTS.md

## Project

Static, single-page GitHub Pages site — "NC Property Tax: Understanding HB 1089". A user
enters a NC street address, picks a parcel from NC OneMap, and sees a receipt estimating
what the county property tax bill would have been under an HB 1089-style levy limit
anchored to the FY2020-21 county levy and compounded by OSBM population growth + South
urban CPI.

Live: https://johnlockefoundation.github.io/property-tax-demo/ (served from `main`, root).

## Layout

- `index.html` — the page; address search + receipt rendering. County/benchmark data
  fetched from `data/benchmarks.json`.
- `calc.js` — the ONLY calculation logic (UMD, global `PT`). Keep all math here so the
  page and tests share it.
- `data/benchmarks.json` — per-county inputs (100 counties), KEYED BY COUNTY SLUG
  (lowercase, hyphens). Includes `x` (assessed valuation base), `act`/`hyp`
  (FY2025-26 actual/hypothetical levies), `savings_rate` (Data(tax).csv column Q),
  `below_benchmark`.
- `data/source/` — VENDORED build inputs (`Data(tax).csv`, `lg04_fy2025-26_valuation.csv`,
  `nc_county_fips.csv`). Frozen copies; the repo is self-contained for reproducibility.
- `tools/build_benchmarks.mjs` — regenerates `data/benchmarks.json` from `data/source/`.
- `test/calc.test.mjs` — node:test suite; must stay green.
- `docs/methodology.html` — methodology notes; keep in sync with `calc.js`/`index.html`.

## Authoritative data

`Data(tax).csv` (the "authoritative levies" export) lives in the parent workspace
`/Users/mihirkale/repos/locke/property_tax_project/Data(tax).csv`; `data/source/Data(tax).csv`
is its vendored copy. Column map: A County, ... K `2025-26_act`, L `2025_26_hyp`,
M/N/O/P five-year act/hyp/cnt_diff/pct_diff, **Q `5-year_savings_rate`**, R grade.
The receipt's "percent lower" MUST equal column Q (100 × Q for the display).

## Calculation contract (do not break)

```
paid       = V * act / x
could_have = paid * (1 - savings_rate)
saved      = paid * savings_rate      # paid - could_have
percent    = 100 * savings_rate       # rendered as "NN% lower"
```

- `below_benchmark` counties (`act26 <= hyp26`) render a "would not have saved anything"
  sentence, NOT a receipt. There are exactly 4: Alamance, Macon, Madison, Moore.
- County-wide property tax only (no municipal/school/special district).

## Commands

```
node --test test/calc.test.mjs                    # tests (must pass)
node tools/build_benchmarks.mjs                   # regenerate data/benchmarks.json
python3 -m http.server 8000                       # local preview
```

## Conventions

- When changing numbers/formulas, update `calc.js`, `test/calc.test.mjs`,
  `docs/methodology.html`, and `index.html` doc-text together; never leave docs stale.
- Regenerate `data/benchmarks.json` only when `data/source/*.csv` actually changed.
- The live GitHub Pages site caches for `max-age=600`; verify after deploy.
- Do not add comments to code unless asked; repository docs (README, AGENTS.md) are the
  place for explanation.

## Deploy

Push to the `main` branch of `johnlockefoundation/property-tax-demo` (HTTPS remote).
GitHub Pages serves the repo root; no build step.