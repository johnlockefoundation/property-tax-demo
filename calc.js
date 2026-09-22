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
  function buildAddressWhere(query) {
    const q = String(query == null ? "" : query).trim();
    if (!q) return null;
    const escaped = q.replace(/'/g, "''");
    return "UPPER(siteadd) LIKE UPPER('%" + escaped + "%')";
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

  return {
    computeReceipt: computeReceipt,
    buildAddressWhere: buildAddressWhere,
    isUsableResidential: isUsableResidential
  };
});