# Address search: `siteadd` whitespace breaks 59 counties

**Status: fixed.** The address is looked up in AddressNC and the parcel found by
point, as recommended below. `calc.js` holds the query builder
(`parseAddressParts`, `buildAddressNcQueries`) and `index.html` the resolution;
the same route is in the plugin's `assets/js/ptx-app.js`.

Reported as: *"5223 Lone Eagle Lane, New Hanover County does not work."*

## The short version

The statewide parcel search matches a typed address with a single-spaced `LIKE`
pattern against `siteadd`. 59 of the 100 counties write `siteadd` with more than
one space between the house number and the street name, or between other tokens.
A `LIKE` pattern cannot match across a wider gap, so **every variant in the
query ladder misses and the tool reports "no residential matches found"** for
those addresses.

New Hanover is one of 59, not a special case. Six counties are 100% affected.

## The reported address

The address as given does not exist. New Hanover has no Lone Eagle Lane; the
street is a Court:

```
5223  LONE EAGLE CT   (note the two spaces)
```

Parcel `3134-85-7054.000`, `parval` 630,400, `improvval` 451,700, `parusedesc`
Residential, Wilmington.

Even the suffix-dropped rung of the ladder (`5223 LONE EAGLE`, which
`buildQueryVariants` does generate) fails, because of the gap:

```
UPPER(siteadd) LIKE UPPER('%5223 LONE EAGLE%')   -> 0 features
UPPER(siteadd) LIKE UPPER('%5223  LONE EAGLE%')  -> 1 feature  (the right one)
```

Had it worked, the receipt for that parcel is:

| | |
| --- | --- |
| Paid | $1,960.35 |
| Could have paid | $1,759.41 |
| Could have saved | $200.94 |
| Percent | OR 10% lower |

(`savings_rate` 0.1025 = column Q, New Hanover, `x` 80,988,112,436, `act`
251,847,898.)

## Affected counties

`siteadd LIKE '%  %'` — a record containing any run of two or more spaces —
per county, against `NC1Map_Parcels/MapServer/0`. Scanned 2026-09-30.

| FIPS | County | padded | total | share |
| --- | --- | ---: | ---: | ---: |
| 37021 | Buncombe | 134741 | 134741 | 100% |
| 37101 | Johnston | 125583 | 125583 | 100% |
| 37097 | Iredell | 101619 | 109254 | 93% |
| 37129 | New Hanover | 93438 | 103489 | 90% |
| 37085 | Harnett | 84368 | 84508 | 99.8% |
| 37089 | Henderson | 75373 | 75373 | 100% |
| 37125 | Moore | 70322 | 76657 | 92% |
| 37157 | Rockingham | 52670 | 56362 | 93% |
| 37039 | Cherokee | 35043 | 35669 | 98% |
| 37111 | McDowell | 33449 | 33449 | 100% |
| 37037 | Chatham | 33060 | 48850 | 68% |
| 37053 | Currituck | 26588 | 27885 | 95% |
| 37003 | Alexander | 24909 | 25265 | 99% |
| 37059 | Davie | 23669 | 26424 | 90% |
| 37115 | Madison | 19983 | 21381 | 93% |
| 37033 | Caswell | 17222 | 17222 | 100% |
| 37119 | Mecklenburg | 16587 | 442287 | 4% |
| 37173 | Swain | 12669 | 12669 | 100% |
| 37175 | Transylvania | 10926 | 31755 | 34% |
| 37095 | Hyde | 3593 | 7698 | 47% |
| 37171 | Surry | 1591 | 44417 | 4% |
| 37199 | Yancey | 300 | 17378 | 2% |
| 37155 | Robeson | 217 | 80391 | <1% |
| 37163 | Sampson | 149 | 50538 | <1% |
| 37079 | Greene | 143 | 12720 | 1% |
| 37197 | Yadkin | 107 | 28320 | <1% |
| 37149 | Polk | 104 | 18211 | 1% |
| 37181 | Vance | 79 | 26547 | <1% |
| 37007 | Anson | 75 | 19127 | <1% |
| 37193 | Wilkes | 73 | 52847 | <1% |
| 37057 | Davidson | 62 | 98799 | <1% |
| 37027 | Caldwell | 59 | 52777 | <1% |
| 37189 | Watauga | 52 | 47388 | <1% |
| 37031 | Carteret | 49 | 64151 | <1% |
| 37061 | Duplin | 48 | 43612 | <1% |
| 37019 | Brunswick | 42 | 151753 | <1% |
| 37083 | Halifax | 42 | 39403 | <1% |
| 37139 | Pasquotank | 42 | 22788 | <1% |
| 37179 | Union | 31 | 117539 | <1% |
| 37001 | Alamance | 27 | 79495 | <1% |
| 37049 | Craven | 24 | 59840 | <1% |
| 37045 | Cleveland | 22 | 59964 | <1% |
| 37167 | Stanly | 17 | 44171 | <1% |
| 37107 | Lenoir | 13 | 36463 | <1% |
| 37077 | Granville | 10 | 34602 | <1% |
| 37029 | Camden | 9 | 7955 | <1% |
| 37109 | Lincoln | 9 | 56862 | <1% |
| 37185 | Warren | 7 | 23477 | <1% |
| 37191 | Wayne | 7 | 70711 | <1% |
| 37105 | Lee | 6 | 35303 | <1% |
| 37177 | Tyrrell | 6 | 4368 | 14% |
| 37047 | Columbus | 3 | 51706 | <1% |
| 37065 | Edgecombe | 2 | 31591 | <1% |
| 37141 | Pender | 2 | 55025 | <1% |
| 37159 | Rowan | 2 | 83292 | <1% |
| 37041 | Chowan | 1 | 12845 | <1% |
| 37123 | Montgomery | 1 | 30283 | <1% |
| 37151 | Randolph | 1 | 80940 | <1% |
| 37183 | Wake | 1 | 435380 | <1% |

59 counties, ~1.07M parcels. The other 41 write `siteadd` with single spaces and
are unaffected.

Note Mecklenburg and Wake are near zero: their handful of padded records are
mid-street-name or an appended city, not the number gap, so most of their
addresses still work. That is why this was not caught earlier — the demo's
smoke-test county and the README's example both happen to be fine.

Reproduce the scan:

```python
# for each fips in data/benchmarks.json
where = f"stcntyfips='{fips}' AND siteadd LIKE '%  %'"
POST https://services.nconemap.gov/secure/rest/services/NC1Map_Parcels/MapServer/0/query
  where=<above>&outFields=parno&returnGeometry=false&returnCountOnly=true&f=json
```

## The gap is not in a consistent place

This is the part that makes a one-line fix impossible. Real records:

| County | `siteadd` | gap after | before suffix | before city |
| --- | --- | :---: | :---: | :---: |
| New Hanover | `5223␣␣LONE␣EAGLE␣CT` | yes | no | no |
| Johnston | `74␣␣DANDELION␣␣LN` | yes | yes | no |
| Iredell | `579␣␣STEWART␣ROCK␣RD␣` | yes | no | no |
| Buncombe | `36␣ASHER␣␣LN` | no | yes | no |
| Harnett | `70␣␣FOX␣WOOD␣␣SANFORD` | yes | no | yes |
| Harnett | `201␣S␣13TH␣ST␣␣ERWIN` | no | no | yes |
| Mecklenburg | `15025␣␣NEW␣AMSTERDAM␣LN␣CHARLOTTE␣NC` | yes | no | yes |
| Chowan | `436␣DRUMMOND'S␣␣POINT␣RD` | no | no | no (mid-name) |

A single "try the double-spaced form too" variant fixes New Hanover and Iredell
and nothing else. Buncombe needs the gap in a different position; Harnett has
two. A tolerance that handles all of them — replacing every space in the pattern
with `%` — matches all of the above but is too loose to be safe: the ladder's
suffix-dropped rung would degrade to a near-unconstrained scan of 1.6M
parcels and produce nonsense candidate lists on common street names.

Harnett is also a reminder that some counties append the city to `siteadd`, so
the ladder's rungs and a county's format interact in more than one place.

## Server-side normalisation is not available

`NC1Map_Parcels` runs on ArcGIS, and every string function is rejected in the
`where` clause. All of these return HTTP 400
`Unable to complete operation` (code `-2147220985`), in ~0.2s, i.e. a plan
failure rather than a timeout:

| Attempted | Result |
| --- | --- |
| `REPLACE(siteadd,'  ',' ')` | 400 |
| `UPPER(REPLACE(siteadd,'  ',' ')) LIKE ...` | 400 |
| `LTRIM(RTRIM(siteadd)) LIKE ...` | 400 |
| `TRIM(siteadd) LIKE ...` | 400 |
| `siteadd LIKE saddno + '  %'` (field concat) | 400 |

So the whitespace cannot be fixed in the query. It has to be handled in the
pattern, on the client, per county.

## The parcel layer's own structured fields are not a fix

Layer 0 carries `saddno`, `saddpref`, `saddstname`, `saddstr`, `saddstsuf`,
`saddsttyp` — clean, whitespace-free components that would be the obvious search
target. They are not populated statewide:

| County | `saddno` | `saddstr` | `saddsttyp` |
| --- | --- | --- | --- |
| New Hanover | `5223` | `LONE EAGLE` | `CT` |
| Wake | `7712` | `BILL LOVE` | `RD` |
| Buncombe | `36␣` (trailing space) | `ASHER` | `LN` |
| Johnston | *(empty)* | *(empty)* | *(empty)* |
| Iredell | *(empty)* | *(empty)* | *(empty)* |
| Harnett | *(empty)* | *(empty)* | *(empty)* |

Johnston, Iredell and Harnett populate none of them, and those are three of the
worst-affected counties. `saddno` in Buncombe carries its own trailing space.
Not usable as a general search source.

## The fix: search AddressNC, resolve by point

`AddressNC/NC1Map_Addresses/MapServer/0` is the statewide NG9-1 address layer.
The plugin already uses it for Avery. It is properly normalised — no whitespace
gaps — and is populated for every affected county:

```
countyfips='129' AND add_number='5223' AND UPPER(st_name) LIKE '%LONE EAGLE%'
  -> add_number=5223  st_name=LONE EAGLE  st_postyp=COURT
     long=2338730.0  lat=145081.578125   (EPSG:102719)
```

Same query shape works in Buncombe (`36` / `ASHER` / `LANE`), Johnston
(`74` / `DANDELION` / `LANE`) and Harnett (`70` / `FOX WOOD`).

It carries a point, and point-in-polygon against the parcel polygons returns the
right parcel. Verified end to end for the reported address:

```
POST NC1Map_Parcels/MapServer/1/query
  where=stcntyfips='37129'
  geometry=2338730.0,145081.578125
  geometryType=esriGeometryPoint
  inSR=102719
  spatialRel=esriSpatialRelIntersects
  outFields=parno,siteadd,parval,parusecode,parusedesc
->
  parno=3134-85-7054.000  siteadd='5223  LONE EAGLE CT'
  parval=630400  parusecode=RES  parusedesc=Residential
```

That is the same parcel the `siteadd` search returns when hand-spaced, and the
same `parcelAtPoint` call the Avery path already makes — so the join is not new
machinery.

Suggested shape: search AddressNC on `add_number` / `st_predir` / `st_name` /
`st_postyp`, take `long`/`lat`, point-in-polygon to the parcel, and keep
`siteadd` as the *displayed* address and as a fallback route. The assessed
value still comes from `NC1Map_Parcels`, so the receipt keeps its single data
source. (Built as described below, except that `st_postyp` is not filtered on.)

## How it is implemented

`parseAddressParts` splits what was typed into the parts the address layer keeps
separately, and `buildAddressNcQueries` turns those into a short ladder of
`where` clauses, narrowest first:

```
countyfips='129' AND add_number='1000' AND st_predir IN ('E','EAST') AND UPPER(st_name) = UPPER('WOODLAWN')
countyfips='129' AND add_number='1000' AND st_predir IN ('E','EAST') AND UPPER(st_name) LIKE UPPER('%WOODLAWN%')
countyfips='129' AND add_number='1000' AND UPPER(st_name) LIKE UPPER('%WOODLAWN%')
```

So the query ends up scoped by county, matched on the exact house number, and
never filters on the street type — the number plus the street name is what
identifies the parcel. Nothing about it is normalised at query time, which is the
point: the layer arrives already clean, so no county-by-county whitespace
handling is needed anywhere.
countyfips='129' AND add_number='5223' AND st_predir IN ('E','EAST') AND UPPER(st_name) = UPPER('WOODLAWN')
countyfips='129' AND add_number='1000' AND st_predir IN ('E','EAST') AND UPPER(st_name) LIKE UPPER('%WOODLAWN%')
countyfips='129' AND add_number='1000' AND UPPER(st_name) LIKE UPPER('%WOODLAWN%')
```

Things the live service settled that the recommendation above did not pin down:

- **UPPER() works, but LIKE does not.** `UPPER(st_name) LIKE UPPER('%LONE
  EAGLE%')` matches; `...LIKE UPPER('%lone eagle%')` returns nothing. Every
  pattern has to be upper-cased as well as the field. (The parcel layer is the
  opposite: it rejects the functions outright.)
- **`st_predir` is spelled out in some counties.** Mecklenburg writes `EAST`
  where New Hanover leaves it blank, so both spellings are asked for in one
  request with `IN`, and the pre-direction is dropped on the last rung.
- **The street type is never filtered on.** It is `CT` in New Hanover's
  `siteadd` and `COURT` in the address layer, so a query that asked for the typed
  type would miss the very address this was written for. A house number plus a
  street name is narrow enough that the candidate list separates the answers.
- **`add_number` is a string** and is matched exactly, so `add_number='123A'`
  needs a second rung on `LIKE '123%'` to catch a county that stores `123`.
- **Direction words and street types are not always part of the street.** New
  Hanover's `3811 NORTHEAST AVE` is Northeast Avenue and Chatham's `111 LANE ST`
  is Lane Street, so a name left alone by the type strip is spelled back out the
  way the layer stores it.

Two routes, in order, both scoped to the county when it is known:

1. the existing `siteadd` ladder, which is unchanged and still answers first;
2. only on a miss, AddressNC, and then point-in-polygon to the parcel polygons.

`siteadd` is still the address printed on the receipt, and `parval` still comes
from `NC1Map_Parcels`, so there is still one source for the number on the
receipt. When no county has been chosen, step 2 runs statewide and the county is
taken from the point's own county, so the reported address works without picking
New Hanover first.

Measured by round trip against the live services, taking a padded `siteadd` from
each county, collapsing its whitespace to what a person would type, and asking
whether the parcel comes back: **27 of 35 sampled addresses across 8 counties are
recovered, 1 was already reachable, and the 8 that remain are honest misses** —
five are placeholders that are not addresses (`0 DEFAULT STREET`, `0 CAUSEWAY
DR`), and the rest are addresses Madison's NG 9-1 submission does not carry at
all. New Hanover, the county reported, is 9 of 10.

The four counties in `NO_PARCEL_ADDRESS_FIPS` are deliberately left out: the
address layer does hold addresses for them, but printing a receipt there would
contradict the message the tool already shows them.

### Still open, and separate

- **Henderson's `parusecode` is a description, not a code.** It holds
  `RESTAURANTS`, `OFFICES`, `RETAIL BUILDINGS`, and `isUsableResidential` reads
  any code starting with `R` as residential, so a restaurant passes the filter.
  This is pre-existing and affects the `siteadd` route identically; it was left
  alone because the fix needs a survey of which counties' codes are codes, and
  it changes which parcels every county offers.
- **`saddno`/`saddstr`/`saddsttyp`** on the parcel layer remain unusable as a
  search source, for the reasons above.
- **Henderson (37089)** still shows 75,373 "padded" records that are actually
  `'       '` — blank addresses, not a formatting problem. Separate issue.
