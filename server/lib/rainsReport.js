const { chayaOf, royalNameOf, noviceChaya } = require("./names");

function dash(v) {
  return String(v == null ? "" : v).replace(/\s+/g, " ").trim();
}

function toThaiNum(v) {
  const map = ["๐", "๑", "๒", "๓", "๔", "๕", "๖", "๗", "๘", "๙"];
  return String(v == null ? "" : v).replace(/[0-9]/g, (d) => map[Number(d)] || d);
}

function withWatPrefix(name) {
  const t = dash(name);
  if (!t) return "";
  if (/^(วัด|พระอาราม|ที่พักสงฆ์)/.test(t)) return t;
  return "วัด" + t;
}

function stripWatPrefix(name) {
  return dash(name).replace(/^วัด/, "");
}

function detectLevel(q) {
  const wat = dash(q && q.watName);
  const sangha = dash(q && q.sanghaTambon);
  const access = dash(q && q.accessLevel);
  if (access === "wat" || wat) return "wat";
  if (access === "tambon" || (sangha && sangha !== "(ยังไม่ระบุตำบลคณะสงฆ์)")) return "tambon";
  return "district";
}

function headerLines(opt) {
  const o = opt || {};
  const yearBe = o.yearBe || "";
  const level = o.level || detectLevel(o);
  const dist = dash(o.district) || "พระนครศรีอยุธยา";
  const prov = dash(o.province) || dist;
  const reg = dash(o.region) || "ภาค ๒";
  const line1 = "บัญชีรายชื่อพระภิกษุ-สามเณร อยู่จำพรรษา";
  let line2;
  if (level === "wat") {
    const wat = withWatPrefix(o.watName);
    const bits = [wat];
    if (dash(o.tambon)) bits.push("ตำบล" + dash(o.tambon));
    else if (dash(o.sanghaTambon) && dash(o.sanghaTambon) !== "(ยังไม่ระบุตำบลคณะสงฆ์)") {
      bits.push("ตำบลคณะสงฆ์" + dash(o.sanghaTambon));
    }
    bits.push("อำเภอ" + dist);
    bits.push("จังหวัด" + prov);
    line2 = bits.filter(Boolean).join(" ");
  } else if (level === "tambon") {
    line2 = ["ตำบลคณะสงฆ์" + dash(o.sanghaTambon), "อำเภอ" + dist, "จังหวัด" + prov, reg]
      .filter(function (x) { return dash(x) && dash(x) !== "ตำบลคณะสงฆ์"; })
      .join(" ");
  } else {
    line2 = ["อำเภอ" + dist, "จังหวัด" + prov, reg].join(" ");
  }
  return {
    level: level,
    levelLabel: level === "wat" ? "ระดับวัด" : (level === "tambon" ? "ระดับตำบลคณะสงฆ์" : "ระดับอำเภอ"),
    line1: line1,
    line2: line2,
    line3: "ประจำปี พุทธศักราช " + toThaiNum(yearBe)
  };
}

function splitNameChaya(m) {
  const type = (m && (m.personType || m.person_type)) || "";
  const given = dash(m && (m.formerName || m.former_name));
  if (type === "สามเณร") {
    return { name: given ? "สามเณร" + given : "สามเณร", chaya: noviceChaya(m) };
  }
  const pali = chayaOf(m);
  const royal = royalNameOf(m);
  const legacy = dash(m && m.chaya);
  if (royal) {
    let rest = pali || legacy;
    if (rest.indexOf(royal) === 0) rest = dash(rest.slice(royal.length));
    return { name: royal, chaya: rest };
  }
  if (pali) {
    let name = legacy;
    if (name && name.slice(-pali.length) === pali) name = dash(name.slice(0, name.length - pali.length));
    if (name.indexOf(pali) >= 0) name = dash(name.replace(pali, ""));
    return { name: name || legacy, chaya: pali };
  }
  const parts = legacy.split(" ").filter(Boolean);
  if (parts.length >= 2) return { name: parts.slice(0, -1).join(" "), chaya: parts[parts.length - 1] };
  return { name: legacy, chaya: "" };
}

function nakthamShort(v, rank) {
  const s = dash(v);
  if (rank === 3 || /เอก/.test(s)) return "เอก";
  if (rank === 2 || (/โท/.test(s) && !/เอก/.test(s))) return "โท";
  if (rank === 1 || /ตรี/.test(s)) return "ตรี";
  return s.replace(/^น\.?ธ\.?/, "");
}

function paliShort(v, rank) {
  if (rank >= 3) return String(rank);
  if (rank === 2) return "1-2";
  const s = dash(v).replace(/^ป\.?ธ\.?/, "");
  const m = s.match(/([1-9])/);
  return m ? m[1] : (s === "-" ? "" : s);
}

function parseNote(note) {
  const s = dash(note);
  const out = {};
  const born = s.match(/เกิด\s*พ\.?ศ\.?\s*([0-9]{4})/);
  if (born) out.birthYearBe = born[1];
  const prov = s.match(/จ\.([^\s·]+)/);
  if (prov) out.birthProvince = dash(prov[1]);
  const sec = s.match(/สามัญ\s+([^·]+)/);
  if (sec) out.secular = dash(sec[1]);
  const nak = s.match(/นธ\.([^\s·]+)(?:\s*ปี\s*([0-9]{4}))?\s*([^·]*)/);
  if (nak) {
    out.naktham = nakthamShort(nak[1]);
    out.nakthamYear = dash(nak[2]);
    const rest = dash(nak[3]).split(/\s+/).filter(Boolean);
    if (rest.length) out.nakthamSchool = rest[0];
    if (rest.length > 1) out.nakthamProvince = rest.slice(1).join(" ");
  }
  const pali = s.match(/ป\.?ธ\.([^\s·]+)(?:\s*ปี\s*([0-9]{4}))?\s*([^·]*)/);
  if (pali) {
    out.pali = paliShort(pali[1]);
    out.paliYear = dash(pali[2]);
    const rest = dash(pali[3]).split(/\s+/).filter(Boolean);
    if (rest.length) out.paliSchool = rest[0];
    if (rest.length > 1) out.paliProvince = rest.slice(1).join(" ");
  }
  return out;
}

function remarkOf(title, note, rainRemark) {
  const fromRain = dash(rainRemark);
  if (fromRain) return fromRain;
  const t = dash(title);
  const n = dash(note);
  const blob = (t + " " + n).replace(/\s+/g, "");
  const hit = blob.match(/(ท?ผจล|ท?ผจร|รจล|รจร|จล|จร|รก)(?:\.[ชอทตพวิ]*)?\.?/);
  if (hit) {
    const code = hit[1];
    if (code === "ทผจล" || code === "ผจล") return "ผจล.";
    if (code === "ทผจร" || code === "ผจร") return "ผจร.";
    if (code === "รจล") return "รจล.";
    if (code === "รจร") return "รจร.";
    if (code === "จล") return "จล.";
    if (code === "จร") return "จร.";
    if (code === "รก") return "รก.";
  }
  if (/ผู้ช่วยเจ้าอาวาส/.test(t)) return "ผจร.";
  if (/รองเจ้าอาวาส/.test(t)) return "รจร.";
  if (/รักษาการเจ้าอาวาส/.test(t)) return "รก.";
  if (/เจ้าอาวาส/.test(t)) return "จร.";
  return "";
}

function firstFilled() {
  for (let i = 0; i < arguments.length; i++) {
    const v = dash(arguments[i]);
    if (v && v !== "-") return v;
  }
  return "";
}

function bioHighest(bio, keys) {
  const b = bio && typeof bio === "object" ? bio : {};
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i].key;
    const year = dash(b[key + "Year"]);
    const school = dash(b[key + "School"] || b[key + "Samnak"]);
    const province = dash(b[key + "Province"]);
    const wat = dash(b[key + "Wat"]);
    if (year || school || province || wat) {
      return {
        short: keys[i].short,
        year: year,
        school: school || wat,
        province: province
      };
    }
  }
  return null;
}

function formRow(m, rain, stand) {
  const row = m || {};
  const a = rain || {};
  const bio = row.bio && typeof row.bio === "object" ? row.bio : {};
  const noteF = parseNote(row.note);
  const names = splitNameChaya(row);
  const st = stand || {};
  const nakBio = bioHighest(bio, [
    { key: "dhammaEk", short: "เอก" },
    { key: "dhammaTo", short: "โท" },
    { key: "dhammaTri", short: "ตรี" }
  ]);
  const paliBio = bioHighest(bio, [
    { key: "pali9", short: "9" }, { key: "pali8", short: "8" }, { key: "pali7", short: "7" },
    { key: "pali6", short: "6" }, { key: "pali5", short: "5" }, { key: "pali4", short: "4" },
    { key: "pali3", short: "3" }, { key: "pali12", short: "1-2" }
  ]);
  const naktham = nakthamShort(
    firstFilled(a.naktham, bio.dhammaLevel, nakBio && nakBio.short, noteF.naktham),
    st.nakthamRank
  );
  const pali = paliShort(
    firstFilled(a.pali, bio.paliLevel, paliBio && paliBio.short, noteF.pali),
    st.paliRank
  );
  const secular = firstFilled(
    a.secular_edu || a.secularEdu,
    bio.secularLevel,
    noteF.secular
  );
  return {
    name: names.name,
    chaya: names.chaya,
    surname: dash(row.formerSurname || row.former_surname),
    age: row.age != null && row.age !== "" ? row.age : "",
    vassa: row.personType === "สามเณร" || row.person_type === "สามเณร"
      ? ""
      : (row.vassa != null && row.vassa !== "" ? row.vassa : ""),
    birthYearBe: firstFilled(row.birthYearBe || row.birth_year_be, noteF.birthYearBe),
    birthProvince: firstFilled(row.birthProvince || row.birth_province, noteF.birthProvince, bio.formerProvince),
    secular: secular,
    wat: stripWatPrefix(row.watName || row.wat_name),
    tambon: dash(row.tambon),
    naktham: naktham,
    nakthamYear: firstFilled(a.naktham_year || a.nakthamYear, nakBio && nakBio.year, bio.dhammaYear, noteF.nakthamYear),
    nakthamSchool: firstFilled(a.naktham_school || a.nakthamSchool, nakBio && nakBio.school, bio.dhammaSchool, noteF.nakthamSchool),
    nakthamProvince: firstFilled(a.naktham_province || a.nakthamProvince, nakBio && nakBio.province, noteF.nakthamProvince),
    pali: pali,
    paliYear: firstFilled(a.pali_year || a.paliYear, paliBio && paliBio.year, bio.paliYear, noteF.paliYear),
    paliSchool: firstFilled(a.pali_school || a.paliSchool, paliBio && paliBio.school, bio.paliSchool, noteF.paliSchool),
    paliProvince: firstFilled(a.pali_province || a.paliProvince, paliBio && paliBio.province, noteF.paliProvince),
    remark: remarkOf(row.title, row.note, a.remark)
  };
}

module.exports = {
  dash,
  toThaiNum,
  withWatPrefix,
  stripWatPrefix,
  detectLevel,
  headerLines,
  splitNameChaya,
  parseNote,
  remarkOf,
  formRow
};
