function destWat(a) {
  if (!a) return "";
  const to = String(a.to_wat_name || a.toWatName || "").trim();
  const wat = String(a.wat_name || a.watName || "").trim();
  return to || wat;
}

function lastAffiliation(affiliations) {
  const rows = Array.isArray(affiliations) ? affiliations : [];
  for (let i = rows.length - 1; i >= 0; i--) {
    const a = rows[i] || {};
    const kind = a.kind || "";
    if (kind === "ย้ายสังกัด" && destWat(a)) return a;
    if ((kind === "รับเข้าสังกัด" || kind === "สังกัดเมื่อบวช") && (a.wat_name || a.watName)) return a;
  }
  return null;
}

function affHomeWat(affiliations, fallback) {
  const last = lastAffiliation(affiliations);
  const fromAff = last ? destWat(last) : "";
  return fromAff || String(fallback || "").trim();
}

function sameWatName(a, b) {
  function n(s) {
    return String(s || "").replace(/\s+/g, " ").trim().replace(/^วัด/, "").toLowerCase();
  }
  return !!n(a) && n(a) === n(b);
}

function homeRainPlace(affiliations, monk) {
  const monkWat = String((monk && (monk.wat_name || monk.watName)) || "").trim();
  const wat = affHomeWat(affiliations, monkWat);
  if (!wat) return null;
  const last = lastAffiliation(affiliations);
  const useMonk = sameWatName(wat, monkWat);
  if (last && last.kind === "ย้ายสังกัด") {
    return {
      wat_name: wat,
      tambon: String(last.to_tambon || last.toTambon || "").trim(),
      sangha_tambon: "",
      district: String(last.to_district || last.toDistrict || "").trim(),
      province: String(last.to_province || last.toProvince || "").trim()
    };
  }
  return {
    wat_name: wat,
    tambon: String((last && last.tambon) || (useMonk && monk && monk.tambon) || "").trim(),
    sangha_tambon: String((last && (last.sangha_tambon || last.sanghaTambon)) || (useMonk && monk && (monk.sangha_tambon || monk.sanghaTambon)) || "").trim(),
    district: String((last && last.district) || (useMonk && monk && monk.district) || "").trim(),
    province: String((last && last.province) || (useMonk && monk && monk.province) || "").trim()
  };
}

function statusFromLastAffiliation(affiliations, currentStatus, existingMovedTo, currentWat) {
  const cur = String(currentStatus || "").trim() || "จำพรรษา";
  if (cur === "มรณภาพ" || cur === "ลาสิกขา") {
    return { status: cur, movedToWat: "" };
  }
  const last = lastAffiliation(affiliations);
  if (last && last.kind === "ย้ายสังกัด") {
    const dest = destWat(last) || String(existingMovedTo || "").trim();
    const home = String(currentWat || "").trim();
    if (home && dest && sameWatName(dest, home)) {
      return { status: "จำพรรษา", movedToWat: "" };
    }
    return { status: "ย้ายวัด", movedToWat: dest };
  }
  return { status: cur, movedToWat: cur === "ย้ายวัด" ? String(existingMovedTo || "").trim() : "" };
}

function movedStatusLabel(status, movedToWat) {
  const st = String(status || "").trim() || "จำพรรษา";
  const dest = String(movedToWat || "").trim();
  if (st === "ย้ายวัด" && dest) return "ย้ายวัด · " + dest;
  return st;
}

module.exports = { destWat, lastAffiliation, affHomeWat, sameWatName, homeRainPlace, statusFromLastAffiliation, movedStatusLabel };
