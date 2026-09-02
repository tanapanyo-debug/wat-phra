const { thaiDigits } = require("./courses");

const THAI_MONTHS = [
  ["มกราคม", "ม.ค.", 1], ["กุมภาพันธ์", "ก.พ.", 2], ["มีนาคม", "มี.ค.", 3],
  ["เมษายน", "เม.ย.", 4], ["พฤษภาคม", "พ.ค.", 5], ["มิถุนายน", "มิ.ย.", 6],
  ["กรกฎาคม", "ก.ค.", 7], ["สิงหาคม", "ส.ค.", 8], ["กันยายน", "ก.ย.", 9],
  ["ตุลาคม", "ต.ค.", 10], ["พฤศจิกายน", "พ.ย.", 11], ["ธันวาคม", "ธ.ค.", 12]
];

function currentBe() {
  return new Date().getFullYear() + 543;
}

function toParts(v) {
  if (v == null || v === "") return null;
  if (v instanceof Date && !isNaN(v.getTime())) {
    const y = v.getFullYear();
    const ce = y > 2200 ? y - 543 : y;
    return { ce, month: v.getMonth() + 1, day: v.getDate() };
  }
  const raw = thaiDigits(String(v).trim());
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const y = parseInt(iso[1], 10);
    const ce = y > 2200 ? y - 543 : y;
    return { ce, month: parseInt(iso[2], 10), day: parseInt(iso[3], 10) };
  }
  let month = null;
  for (let i = 0; i < THAI_MONTHS.length; i++) {
    if (raw.indexOf(THAI_MONTHS[i][0]) >= 0 || raw.indexOf(THAI_MONTHS[i][1]) >= 0) {
      month = THAI_MONTHS[i][2];
      break;
    }
  }
  const ym = raw.match(/(25\d{2}|24\d{2}|26\d{2})/);
  if (!ym) return null;
  const be = parseInt(ym[1], 10);
  const dm = raw.match(/(\d{1,2})/);
  const day = dm ? parseInt(dm[1], 10) : 1;
  return { ce: be - 543, month: month || 8, day: day >= 1 && day <= 31 ? day : 1 };
}

function yearBeFromAny(v) {
  const p = toParts(v);
  return p ? p.ce + 543 : null;
}

function storedPersonType(r) {
  const s = String((r && (r.person_type || r.personType)) || "").trim();
  return s === "สามเณร" ? "สามเณร" : "ภิกษุ";
}

function upasampadaParts(r) {
  const bio = r && r.bio && typeof r.bio === "object" ? r.bio : {};
  const fromText = toParts(bio.ordainedOnText);
  if (fromText) return fromText;
  const fromDate = toParts(r && (r.ordained_on || r.ordainedOn));
  if (fromDate) return fromDate;
  const y = yearBeFromAny(bio.ordainedOnText);
  if (y) return { ce: y - 543, month: 8, day: 1 };
  return null;
}

function partsBefore(a, b) {
  if (!a || !b) return false;
  if (a.ce !== b.ce) return a.ce < b.ce;
  if ((a.month || 1) !== (b.month || 1)) return (a.month || 1) < (b.month || 1);
  return (a.day || 1) < (b.day || 1);
}

function personTypeAt(r, asOfYear, asOfDate) {
  const ordained = upasampadaParts(r);
  if (ordained) {
    const asOf = asOfParts(asOfYear, asOfDate);
    if (partsBefore(asOf, ordained)) return "สามเณร";
    return "ภิกษุ";
  }
  return storedPersonType(r);
}

function isNovice(r, asOfYear, asOfDate) {
  return personTypeAt(r, asOfYear, asOfDate) === "สามเณร";
}

function ordainedParts(r, rains) {
  const direct = upasampadaParts(r);
  if (direct) return direct;
  if (storedPersonType(r) === "สามเณร") return null;
  let best = null;
  for (const x of rains || []) {
    const year = x.year_be != null ? Number(x.year_be) : Number(x.yearBe);
    const v = x.vassa;
    if (!Number.isFinite(year) || v == null || v === "") continue;
    const vv = Number(v);
    if (!Number.isFinite(vv) || vv < 0) continue;
    const inferredFirst = year - vv + 1;
    if (inferredFirst < 2400 || inferredFirst > 2700) continue;
    if (!best || year > best.y) best = { y: year, inferredFirst };
  }
  if (!best) return null;
  return { ce: best.inferredFirst - 543, month: 8, day: 1 };
}

function ordainedYearBe(r, rains) {
  const p = ordainedParts(r, rains);
  return p ? p.ce + 543 : null;
}

function beOf(parts) {
  return parts.ce + 543;
}

function firstVassaBe(parts) {
  if (!parts) return null;
  const be = beOf(parts);
  return parts.month > 8 ? be + 1 : be;
}

function asOfParts(asOfYearBe, asOfDate) {
  if (asOfDate) {
    const p = toParts(asOfDate);
    if (p) return p;
  }
  if (asOfYearBe) return { ce: Number(asOfYearBe) - 543, month: 8, day: 1 };
  const n = new Date();
  return { ce: n.getFullYear(), month: n.getMonth() + 1, day: n.getDate() };
}

function countVassa(ordained, asOf) {
  if (!ordained || !asOf) return null;
  const first = firstVassaBe(ordained);
  if (!first) return null;
  const nowBe = beOf(asOf);
  const last = asOf.month >= 8 ? nowBe : nowBe - 1;
  const n = last - first + 1;
  if (!Number.isFinite(n) || n < 0) return 0;
  if (n > 100) return null;
  return n;
}

function vassaAt(ordainedYear, asOfYear) {
  return countVassa({ ce: Number(ordainedYear) - 543, month: 8, day: 1 }, asOfParts(asOfYear));
}

function vassaFor(r, rains, asOfYear, asOfDate) {
  if (isNovice(r, asOfYear, asOfDate)) return null;
  const p = ordainedParts(r, rains);
  if (!p) return null;
  return countVassa(p, asOfParts(asOfYear, asOfDate));
}

function vassaNow(r, rains) {
  return vassaFor(r, rains);
}

function birthYearBeOf(r) {
  const y = r.birth_year_be != null ? Number(r.birth_year_be) : Number(r.birthYearBe);
  if (Number.isFinite(y) && y >= 2400 && y <= 2700) return y;
  const bio = r.bio && typeof r.bio === "object" ? r.bio : {};
  return yearBeFromAny(bio.birthText);
}

function ageAt(r, rains, asOfYear) {
  const asOf = Number(asOfYear) || currentBe();
  const by = birthYearBeOf(r);
  if (by) {
    const age = asOf - by;
    if (age > 0 && age < 130) return age;
  }
  let best = null;
  for (const x of rains || []) {
    const year = x.year_be != null ? Number(x.year_be) : Number(x.yearBe);
    if (!Number.isFinite(year) || x.age == null || x.age === "") continue;
    const aa = Number(x.age);
    if (!Number.isFinite(aa) || aa < 0) continue;
    if (!best || year > best.y) best = { y: year, age: aa };
  }
  if (!best) return null;
  const shifted = best.age + (asOf - best.y);
  return shifted > 0 && shifted < 130 ? shifted : best.age;
}

function ageNow(r, rains) {
  return ageAt(r, rains, currentBe());
}

module.exports = {
  currentBe, yearBeFromAny, isNovice, personTypeAt, ordainedYearBe, firstVassaBe,
  vassaAt, vassaFor, vassaNow, ageNow, ageAt, countVassa, toParts, asOfParts
};
