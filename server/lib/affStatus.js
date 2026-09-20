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

const ILL_PLACES = ["บ้าน", "วัด", "โรงพยาบาล"];

function isLockedStatus(status) {
  const st = String(status || "").trim();
  return st === "มรณภาพ" || st === "ลาสิกขา";
}

function isResidentLikeStatus(status) {
  const st = String(status == null || status === "" ? "จำพรรษา" : status).trim();
  return st === "จำพรรษา" || st === "อาพาธ";
}

function parseIll(v) {
  return v === true || v === "true" || v === "1" || v === "อาพาธ";
}

function parseIllBedridden(v) {
  return v === true || v === "true" || v === "1" || v === "ติดเตียง";
}

function parseIllPlace(v) {
  const s = String(v || "").replace(/\s+/g, "").trim();
  if (s === "โรงพยาบาล" || s === "โรงพบาบาล") return "โรงพยาบาล";
  if (s === "บ้าน") return "บ้าน";
  if (s === "วัด") return "วัด";
  return "";
}

function monkIsIll(status, bio) {
  const st = String(status || "").trim();
  if (st === "อาพาธ") return true;
  return parseIll(bio && bio.ill);
}

function canonicalStatus(status) {
  const st = String(status || "").trim() || "จำพรรษา";
  return st === "อาพาธ" ? "จำพรรษา" : st;
}

function illStatusLabel(ill, illBedridden, illPlace) {
  if (!parseIll(ill)) return "";
  const bits = ["อาพาธ"];
  if (parseIllBedridden(illBedridden)) bits.push("ติดเตียง");
  const place = parseIllPlace(illPlace);
  if (place) bits.push(place);
  return bits.join(" · ");
}

function statusFromLastAffiliation(affiliations, currentStatus, existingMovedTo, currentWat) {
  const raw = String(currentStatus || "").trim() || "จำพรรษา";
  const cur = canonicalStatus(raw);
  if (isLockedStatus(cur)) {
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

function movedStatusLabel(status, movedToWat, ill, illBedridden, illPlace) {
  const st = canonicalStatus(status);
  const dest = String(movedToWat || "").trim();
  const base = st === "ย้ายวัด" && dest ? "ย้ายวัด · " + dest : st;
  const extra = isResidentLikeStatus(status) ? illStatusLabel(ill || String(status || "").trim() === "อาพาธ", illBedridden, illPlace) : "";
  if (!extra) return base;
  return base === "จำพรรษา" ? "จำพรรษา · " + extra : extra;
}

function statusFilterClause(statusSql, param) {
  const ill = `(COALESCE(m.bio->>'ill','') IN ('true','1') OR ${statusSql} = 'อาพาธ')`;
  return `(${param} = '' OR (${param} = 'จำพรรษา' AND ${statusSql} IN ('จำพรรษา','อาพาธ')) OR (${param} = 'อาพาธ' AND ${ill}) OR (${param} <> 'จำพรรษา' AND ${param} <> 'อาพาธ' AND ${statusSql} = ${param}))`;
}

module.exports = {
  destWat, lastAffiliation, affHomeWat, sameWatName, homeRainPlace,
  statusFromLastAffiliation, movedStatusLabel, isLockedStatus, isResidentLikeStatus,
  ILL_PLACES, parseIll, parseIllBedridden, parseIllPlace, monkIsIll, canonicalStatus,
  illStatusLabel, statusFilterClause
};
