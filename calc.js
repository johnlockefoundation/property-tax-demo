(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.PT = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Per-property receipt for the FY2025-26 single-year comparison.
  //
  // county is a record from data/benchmarks.json:
  // { x, act, hyp, savings_rate, below_benchmark }
  //
  //   paid        = V * act / X              actual FY2025-26 county bill
  //   could_have  = paid * (1 - savings_rate)  percent = column Q (published
  //                                            5-year savings rate in
  //                                            Data(tax).csv), so the dollars
  //                                            always match the published %.
  //   saved       = paid * savings_rate
  function computeReceipt(value, county) {
    if (!isFinite(value) || value < 0) {
      return { ok: false, reason: "Value must be a non-negative number." };
    }
    if (!county || !isFinite(county.act) || !isFinite(county.x) || !isFinite(county.savings_rate)) {
      return { ok: false, reason: "County inputs are missing or inconsistent." };
    }
    if (county.x <= 0) return { ok: false, reason: "County taxable base is unavailable." };

    const paid = (value * county.act) / county.x;
    const rate = county.savings_rate;
    return {
      ok: true,
      value: value,
      paid: paid,
      could_have: paid * (1 - rate),
      saved: paid * rate,
      rate: rate,
      below_benchmark: !!county.below_benchmark
    };
  }

  // Build a safe OneMap where-clause for a free-text NC address search.
  // Escapes single quotes (SQL injection safe) and uses a case-insensitive
  // substring match on the site address. Prefix-free; the service matches %...%.
  // Applied once per candidate form by buildQueryVariants below.
  function buildAddressWhere(query) {
    const q = String(query == null ? "" : query).trim();
    if (!q) return null;
    const escaped = q.replace(/'/g, "''");
    return "UPPER(siteadd) LIKE UPPER('%" + escaped + "%')";
  }

  // Reduce whatever a person typed into a short ladder of street-line forms,
  // narrowest first, for the search to try in turn. OneMap stores a standardised
  // street line ("1000 E WOODLAWN RD") but the field receives a whole postal
  // address from browser autofill ("1000 E Woodlawn Rd, Charlotte, NC 28203")
  // and suffix spellings vary ("Road" where the record says "RD"), so a single
  // whole-string match cannot hit either. The last rung is the raw string, so
  // nothing that worked before stops working.
  var SUFFIXES = {
    ALLEY: "ALY", AVENUE: "AVE", BOULEVARD: "BLVD", BYPASS: "BYP", CIRCLE: "CIR",
    CORNER: "COR", CROSSING: "XING", DRIVE: "DR", ESTATE: "EST", EXPRESSWAY: "EXPY",
    EXTENSION: "EXT", FREEWAY: "FWY", GARDEN: "GDN", GREEN: "GRN", GROVE: "GRV",
    HEIGHTS: "HTS", HIGHWAY: "HWY", HOLLOW: "HLLW", ISLAND: "IS", JUNCTION: "JCT",
    LAKE: "LK", LANDING: "LNDG", LANE: "LN", LOOP: "LOOP", MEADOWS: "MDWS",
    PARKWAY: "PKWY", PASS: "PASS", PATH: "PATH", PLACE: "PL", PLATEAU: "PLT",
    POINT: "PT", RAMP: "RAMP", RANCH: "RNCH", RESERVE: "RSV", RIDGE: "RDG",
    RIVER: "RIV", ROAD: "RD", ROUTE: "RTE", ROW: "ROW", RUN: "RUN", SHOAL: "SHL",
    SHORE: "SHR", SPRING: "SPG", SPUR: "SPUR", SQUARE: "SQ", STATION: "STA",
    STRAVEN: "STR", STREAM: "STM", STREET: "ST", TERRACE: "TER", TRACE: "TRCE",
    TRACK: "TRK", TRAIL: "TRL", TURNPIKE: "TPKE", VALLEY: "VLY", VIADUCT: "VDCT",
    VIEW: "VW", VILLAGE: "VLG", WALK: "WALK", WALL: "WALL", WAY: "WAY", WEND: "WND",
    // Spellings the USPS also accepts, and short forms people actually type.
    AV: "AVE", AVEN: "AVE", PKY: "PKWY", STRT: "ST", TRN: "TRN", CIRCL: "CIR",
    MTD: "MTD", BCH: "BCH", BLF: "BLF", BRG: "BRG", PRT: "PRT", RST: "RST",
    VST: "VST", KEY: "KEY", CRK: "CRK"
  };

  // The abbreviation maps to itself, so an already-abbreviated street is left
  // alone and "Road" and "Rd" converge on the same stored token.
  var SUFFIX_LOOKUP = {};
  for (var sfx in SUFFIXES) {
    if (Object.prototype.hasOwnProperty.call(SUFFIXES, sfx)) {
      SUFFIX_LOOKUP[sfx] = SUFFIXES[sfx];
      SUFFIX_LOOKUP[SUFFIXES[sfx]] = SUFFIXES[sfx];
    }
  }

  var DIRECTIONS = {
    NORTH: "N", SOUTH: "S", EAST: "E", WEST: "W",
    NORTHEAST: "NE", NORTHWEST: "NW", SOUTHEAST: "SE", SOUTHWEST: "SW",
    N: "N", S: "S", E: "E", W: "W", NE: "NE", NW: "NW", SE: "SE", SW: "SW"
  };

  // Designators whose trailing value is a unit, not part of the street name.
  var UNIT_WORDS = {
    APARTMENT: 1, APT: 1, UNIT: 1, SUITE: 1, STE: 1, ROOM: 1, RM: 1, BLDG: 1,
    BUILDING: 1, LOT: 1, SPACE: 1, SPC: 1, TRAILER: 1, TRLR: 1, DEPARTMENT: 1,
    DEPT: 1, FLOOR: 1, FL: 1, NUMBER: 1, NO: 1
  };

  var STATE_NAMES = [
    "District of Columbia", "New Hampshire", "New Jersey", "New Mexico", "New York",
    "North Carolina", "North Dakota", "Rhode Island", "South Carolina", "South Dakota",
    "West Virginia", "Alabama", "Alaska", "Arizona", "Arkansas", "California",
    "Colorado", "Connecticut", "Delaware", "Florida", "Georgia", "Hawaii", "Idaho",
    "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana", "Maine",
    "Maryland", "Massachusetts", "Michigan", "Minnesota", "Mississippi", "Missouri",
    "Montana", "Nebraska", "Nevada", "Ohio", "Oklahoma", "Oregon", "Pennsylvania",
    "Tennessee", "Texas", "Utah", "Vermont", "Virginia", "Washington", "Wisconsin",
    "Wyoming"
  ];

  var STATE_CODES = [
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID",
    "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO",
    "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA",
    "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY"
  ];

  // Longest name first, so "North Carolina" is never read as "North".
  var STATE_TAIL_RE = new RegExp(
    "\\s+(?:" +
      STATE_NAMES.slice().sort(function (a, b) { return b.length - a.length; })
        .join("|").replace(/ /g, "\\s+") +
      "|" + STATE_CODES.join("|") +
    ")\\.?\\s*$",
    "i"
  );

  var ZIP_TAIL_RE = /\s+\d{5}(-\d{4})?\s*$/;

  // Drop the city, but stop as soon as the tail looks like the end of a street
  // rather than the end of a city. Stripping a fixed number of words does not
  // work -- a city is one or two words, so "... Rd Charlotte" would lose the
  // suffix too and query "1000 E Woodlawn".
  function dropCity(tail) {
    var parts = String(tail).split(/\s+/).filter(Boolean);
    while (parts.length > 2) {
      var last = parts[parts.length - 1].toUpperCase();
      if (SUFFIX_LOOKUP[last] || DIRECTIONS[last]) break;
      parts.pop();
    }
    return parts.join(" ");
  }

  // "1000 E Woodlawn Rd, Charlotte, NC 28203" -> "1000 E Woodlawn Rd". The comma
  // case is what autocomplete produces. With no commas, only strip a trailing
  // ZIP (and the state and city in front of it) so that a plain "1000 E
  // Woodlawn Rd" is left exactly as typed.
  function streetLine(text) {
    var line = String(text == null ? "" : text);
    var comma = line.indexOf(",");
    if (comma !== -1) return line.slice(0, comma);
    if (!ZIP_TAIL_RE.test(line)) return line;
    return dropCity(line.replace(ZIP_TAIL_RE, "").replace(STATE_TAIL_RE, ""));
  }

  // Uppercase the street line and fold the spellings OneMap abbreviates. "#"
  // is kept as its own token so a unit can be recognised and dropped later,
  // and "'" survives so "O'Brien" is not mangled into "O Brien".
  function tokenize(line) {
    var out = [];
    String(line == null ? "" : line)
      .replace(/#/g, " # ")
      .replace(/[^A-Za-z0-9#'-]/g, " ")
      .toUpperCase()
      .split(/\s+/)
      .forEach(function (t) {
        if (!t) return;
        var next = DIRECTIONS[t] || SUFFIX_LOOKUP[t] || t;
        // "123 Main Road Rd" would otherwise become "123 MAIN RD RD".
        if (out.length && out[out.length - 1] === next) return;
        out.push(next);
      });
    return out;
  }

  // "1000 MAIN ST APT 4B", "1000 MAIN ST # 4B" and "1000 MAIN ST 4" all fall
  // back to "1000 MAIN ST", because siteadd usually carries the street line
  // only and the unit lives in another field.
  function dropUnitTail(tokens) {
    var out = tokens.slice();
    var last = out[out.length - 1];
    if (!last || last === "#") return out;
    if (!UNIT_WORDS[last] && !/^\d+[A-Z-]*$/.test(last)) return out;
    out.pop();
    var word = out[out.length - 1];
    if (word === "#" || (word && UNIT_WORDS[word])) out.pop();
    return out;
  }

  // The ladder, narrowest first. Matching is already case-insensitive, so
  // variants are deduped case-insensitively to avoid a pointless extra request.
  function buildQueryVariants(raw) {
    var text = String(raw == null ? "" : raw).replace(/\s+/g, " ").trim();
    if (!text) return [];

    var variants = [];
    var seen = {};
    var add = function (value) {
      var s = (value || []).join(" ").trim();
      if (!s) return;
      var key = s.toUpperCase();
      if (seen[key]) return;
      seen[key] = true;
      variants.push(s);
    };

    var full = tokenize(streetLine(text));
    if (!full.length) return variants;   // punctuation only, nothing to search

    add(full);

    var noUnit = dropUnitTail(full);
    add(noUnit);

    // Drop the suffix so "1000 E Woodlawn" also finds "... RD" or "... AVE".
    if (noUnit.length && SUFFIX_LOOKUP[noUnit[noUnit.length - 1]]) {
      add(noUnit.slice(0, -1));
    }
    // And a suffix we have no mapping for ("AV", "TRN"): drop whatever trails
    // the street name, provided a house number and name both survive.
    if (noUnit.length >= 3) {
      add(noUnit.slice(0, -1));
    }

    add([text]);   // exactly what was typed, which is all the demo ever sent
    return variants;
  }

  // True if a parcel attribute object is a usable ordinary residential parcel.
  // Some counties leave `parusecode` blank and only populate the human-readable
  // `parusedesc`, with varied residential wording (e.g. "SINGLE FAMILY", "SINGLE
  // WIDE MH", "MANUFACTURED HOME"), so accept a curated set of descriptors.
  var RESIDENTIAL_DESC = [
    /\bRESID/, /\bFAMILY/, /\bTOWNHOUS/, /\bCONDO/, /\bAPARTMENT/, /\bMULTI-FAMILY/,
    /\bDUPLEX/, /\bTRIPLEX/, /\bMOBILE HOME/, /\bMANUFACTURED HOME/, /\bSINGLE WIDE/,
    /\bDOUBLE WIDE/, /\bCOTTAGE/, /\bBUNGALOW/, /\bTRAILER/
  ];
  function isUsableResidential(attrs) {
    var v = Number(attrs && attrs.parval);
    var code = String((attrs && attrs.parusecode) || "").toUpperCase();
    var desc = String((attrs && attrs.parusedesc) || "").toUpperCase();
    var residential = code.indexOf("R") === 0 || RESIDENTIAL_DESC.some(function (re) { return re.test(desc); });
    return isFinite(v) && v > 0 && residential;
  }

  // Counties where the state parcel service publishes no site address, so a
  // reader cannot be matched to an individual parcel and no receipt can be
  // printed. The county-level savings rate is published for all 100 counties,
  // so the tool still answers with that rather than a dead end. Keyed on FIPS
  // rather than county name so a rename cannot silently drop a county.
  // Franklin is here too: it does publish addresses, but its service sits behind
  // a bot challenge and answers a browser's request with an interstitial often
  // enough that a receipt would be unreliable, so it reports the county rate
  // like the three that publish no address at all.
  var NO_PARCEL_ADDRESS_FIPS = ["37069", "37093", "37143", "37153"]; // Franklin, Hoke, Perquimans, Richmond

  function hasParcelAddress(county) {
    if (!county || !county.fips) return true;
    return NO_PARCEL_ADDRESS_FIPS.indexOf(String(county.fips)) === -1;
  }

  // Counties the state parcel service cannot search, because it publishes no
  // site address for them. Each resolves an address through the county's own
  // service instead, and then reads the assessed value from the statewide
  // parcel layer by parcel number, so every receipt's value comes from one
  // dataset.
  //
  //   mode "key"   the address record carries the parcel number
  //   mode "point" the address record is a point; the parcel is the one that
  //                contains it
  //
  // `spelling` says how that county writes street suffixes and directions, so
  // the query is tried in the right form first. `pin` reformats the county's
  // parcel number into the statewide one where the two differ.
  var NC_PARCELS = "https://services.nconemap.gov/secure/rest/services/NC1Map_Parcels/MapServer";
  var ADDRESS_NC = "https://services.nconemap.gov/secure/rest/services/AddressNC/NC1Map_Addresses/MapServer/0/query";

  var PARCEL_SOURCES = {
    "37135": { mode: "key", spelling: "abbr", county: "Orange",
      address: "https://gis.orangecountync.gov/arcgis/rest/services/WebBetaPortal/MapServer/1/query", field: "Add_St", key: "PIN" },
    "37017": { mode: "key", spelling: "abbr", county: "Bladen",
      address: "https://gis.bladenco.org/server/rest/services/BladenCounty/MapServer/0/query", field: "Full_Address", key: "PIN" },
    "37025": { mode: "key", spelling: "abbr", county: "Cabarrus",
      address: "https://location.cabarruscounty.us/arcgisservices/rest/services/DataExplorerSearch/FeatureServer/0/query", field: "Full_con_cat", key: "PIN",
      pin: function (v) { return v.split(".")[0] + "0000"; } },
    "37081": { mode: "point", spelling: "long", county: "Guilford",
      address: "https://gcgis.guilfordcountync.gov/arcgis/rest/services/SiteStructureAddressPoints/FeatureServer/0/query", field: "FullAddress",
      lon: "Long", lat: "Lat", srs: 4326 },
    "37011": { mode: "point", spelling: "long", county: "Avery",
      address: ADDRESS_NC, field: "full_address", lon: "long", lat: "lat", srs: 102719,
      countyField: "countyfips" },
  };

  function parcelSource(fips) {
    return PARCEL_SOURCES[String(fips == null ? "" : fips)] || null;
  }

  // Cabarrus writes PINs as a number with a decimal tail ("5552051850.00000000")
  // where the statewide layer writes the same parcel without a dot and padded
  // out to fourteen characters. Everywhere else the two agree.
  function oneMapParno(fips, key) {
    var src = parcelSource(fips);
    var value = String(key == null ? "" : key).trim();
    if (!value) return "";
    if (src && typeof src.pin === "function") return src.pin(value);
    return value;
  }

  // The reverse of SUFFIX_LOOKUP, for counties that spell the type out
  // ("ROAD") where the statewide layer abbreviates it ("RD").
  var LONG_SUFFIX = {};
  for (var sname in SUFFIXES) {
    if (Object.prototype.hasOwnProperty.call(SUFFIXES, sname)) {
      var short = SUFFIXES[sname];
      // A short form maps back to the longest spelling that abbreviates to it,
      // so "RD" becomes "ROAD" rather than some other source word.
      if (!LONG_SUFFIX[short] || LONG_SUFFIX[short].length < sname.length) {
        LONG_SUFFIX[short] = sname;
      }
    }
  }

  var LONG_DIRECTION = { N: "NORTH", S: "SOUTH", E: "EAST", W: "WEST", NE: "NORTHEAST", NW: "NORTHWEST", SE: "SOUTHEAST", SW: "SOUTHWEST" };

  function spellOut(tokens) {
    return tokens.map(function (t) {
      if (LONG_SUFFIX[t]) return LONG_SUFFIX[t];
      if (LONG_DIRECTION[t]) return LONG_DIRECTION[t];
      return t;
    });
  }

  /**
   * The ladder of address forms to try against a county's own address layer.
   *
   * Counties disagree about how they write an address: some abbreviate the
   * suffix and direction, some spell both out, some append the city, state and
   * ZIP and some do not. Rather than encode every combination, each candidate is
   * generated in the spelling that county prefers and then in the other one, so
   * "1000 N Main St" finds both "1000 NORTH MAIN STREET" and "1000 N MAIN ST".
   */
  function buildCountyVariants(query, preferLong) {
    var text = String(query == null ? "" : query).replace(/\s+/g, " ").trim();
    if (!text) return [];

    var out = [];
    var seen = {};
    var add = function (parts) {
      var s = (parts || []).join(" ").trim();
      if (!s) return;
      var k = s.toUpperCase();
      if (seen[k]) return;
      seen[k] = true;
      out.push(s);
    };

    var full = tokenize(streetLine(text));
    if (!full.length) return out;

    var abbr = full;
    var long = spellOut(full);
    if (preferLong) { add(long); add(abbr); } else { add(abbr); add(long); }

    // The same pair again without a unit, then with the suffix dropped, which
    // matches whatever the county calls the type.
    [abbr, long].forEach(function (tokens) {
      var noUnit = dropUnitTail(tokens);
      add(noUnit);
      if (noUnit.length) add(spellOut(noUnit));
    });
    if (full.length) {
      add(full.slice(0, -1));
      add(spellOut(full.slice(0, -1)));
    }

    add([text]);
    return out;
  }

  return {
    computeReceipt: computeReceipt,
    buildAddressWhere: buildAddressWhere,
    buildQueryVariants: buildQueryVariants,
    isUsableResidential: isUsableResidential,
    hasParcelAddress: hasParcelAddress,
    parcelSource: parcelSource,
    oneMapParno: oneMapParno,
    buildCountyVariants: buildCountyVariants
  };
});
