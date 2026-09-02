function dash(s) {
  return String(s == null ? "" : s).replace(/\s+/g, " ").trim();
}

const EDU_TRACKS = ["โลก", "ธรรม", "บาลี"];
const POST_GROUPS = ["ปกครอง", "เลขา", "สมณศักดิ์", "อุปัชฌาย์", "แม่กอง", "อื่น"];

const WORLD_MAP = [
  ["pri", "ประถม"], ["m1", "มัธยมต้น"], ["m3", "มัธยมปลาย"],
  ["dip", "อนุปริญญา"], ["ba", "ปริญญาตรี"], ["ma", "ปริญญาโท"],
  ["phd", "ปริญญาเอก"], ["hon", "กิตติมศักดิ์"]
];
const DHAMMA_MAP = [
  ["dhammaTri", "นักธรรมตรี"], ["dhammaTo", "นักธรรมโท"], ["dhammaEk", "นักธรรมเอก"]
];
const PALI_MAP = [
  ["pali12", "ประโยค 1-2"], ["pali3", "ป.ธ.3"], ["pali4", "ป.ธ.4"], ["pali5", "ป.ธ.5"],
  ["pali6", "ป.ธ.6"], ["pali7", "ป.ธ.7"], ["pali8", "ป.ธ.8"], ["pali9", "ป.ธ.9"]
];

function eduOut(r) {
  return {
    id: r.id,
    track: r.track,
    level: r.level || "",
    yearText: r.year_text || "",
    school: r.school || "",
    major: r.major || "",
    place: r.place || "",
    note: r.note || ""
  };
}
function postOut(r) {
  return {
    id: r.id,
    groupName: r.group_name,
    title: r.title || "",
    place: r.place || "",
    appointedOn: r.appointed_on || "",
    note: r.note || ""
  };
}

function pushEdu(out, track, level, year, school, major, place) {
  const y = dash(year);
  const s = dash(school);
  const l = dash(level);
  const m = dash(major);
  const p = dash(place);
  if (!l && !s && !y && !m) return;
  out.push({
    track, level: l, year_text: y.slice(0, 40), school: s.slice(0, 160),
    major: m.slice(0, 120), place: p.slice(0, 200), note: ""
  });
}

function bioToEdu(bio) {
  const b = bio && typeof bio === "object" ? bio : {};
  const out = [];
  WORLD_MAP.forEach(([p, label]) => {
    pushEdu(out, "โลก", b[p + "Grade"] || label, b[p + "Year"], b[p + "School"], b.secularMajor && p === "ba" ? b.secularMajor : "", "");
  });
  if (!out.some((x) => x.track === "โลก") && (b.secularLevel || b.secularSchool)) {
    pushEdu(out, "โลก", b.secularLevel, b.secularYear, b.secularSchool, b.secularMajor, "");
  }
  DHAMMA_MAP.forEach(([p, label]) => {
    pushEdu(out, "ธรรม", label, b[p + "Year"], b[p + "School"], "", "");
  });
  if (!out.some((x) => x.track === "ธรรม") && (b.dhammaLevel || b.dhammaSchool)) {
    const lv = b.dhammaLevel === "เอก" ? "นักธรรมเอก" : b.dhammaLevel === "โท" ? "นักธรรมโท" : b.dhammaLevel === "ตรี" ? "นักธรรมตรี" : b.dhammaLevel;
    pushEdu(out, "ธรรม", lv, b.dhammaYear, b.dhammaSchool, "", "");
  }
  PALI_MAP.forEach(([p, label]) => {
    pushEdu(out, "บาลี", label, b[p + "Year"], b[p + "School"], "", "");
  });
  if (!out.some((x) => x.track === "บาลี") && (b.paliLevel || b.paliSchool)) {
    pushEdu(out, "บาลี", b.paliLevel, b.paliYear, b.paliSchool, "", "");
  }
  return out;
}

function bioToPosts(bio) {
  const b = bio && typeof bio === "object" ? bio : {};
  const out = [];
  function add(groupName, title, place, on, note) {
    const t = dash(title);
    if (!t) return;
    out.push({
      group_name: groupName, title: t.slice(0, 200), place: dash(place).slice(0, 160),
      appointed_on: dash(on).slice(0, 80), note: dash(note).slice(0, 300)
    });
  }
  const watHist = Array.isArray(b.watPosHistory) ? b.watPosHistory : [];
  if (watHist.length) {
    watHist.forEach(function (a) {
      add("ปกครอง", a.position, [a.watName, a.tambon, a.district, a.province].filter(Boolean).join(" "), a.appointedOn, a.note);
    });
  } else {
    add("ปกครอง", b.watPosition, b.watPosPlace, b.watPosOn, "");
  }
  const sanghaHist = Array.isArray(b.sanghaPosHistory) ? b.sanghaPosHistory : [];
  if (sanghaHist.length) {
    sanghaHist.forEach(function (a) {
      add("ปกครอง", a.position, [a.tambon, a.zone ? "เขต " + a.zone : "", a.district, a.province, a.region].filter(Boolean).join(" "), a.appointedOn, a.note);
    });
  } else {
    add("ปกครอง", b.sanghaPosition, "", b.sanghaPosOn, "");
  }
  add("สมณศักดิ์", b.royalClass || b.royalName, "", b.royalOn, b.royalRank);
  add("อื่น", b.specialRole || b.specialWork, "", b.specialOn, b.specialDetail);
  add("อื่น", b.sixType, "", b.sixOn, b.sixDetail);
  return out;
}

function applyEduToBio(bio, rows) {
  const out = Object.assign({}, bio || {});
  const list = Array.isArray(rows) ? rows : [];
  WORLD_MAP.forEach(([p, label]) => {
    const row = list.find((x) => x.track === "โลก" && (dash(x.level) === label || dash(x.level) === dash(out[p + "Grade"])));
    if (!row) return;
    if (dash(row.level) && dash(row.level) !== label) out[p + "Grade"] = dash(row.level).slice(0, 40);
    if (dash(row.school)) out[p + "School"] = dash(row.school).slice(0, 160);
    if (dash(row.year_text || row.yearText)) out[p + "Year"] = dash(row.year_text || row.yearText).slice(0, 40);
  });
  const world = list.filter((x) => x.track === "โลก");
  const lastW = world[world.length - 1];
  if (lastW) {
    out.secularLevel = dash(lastW.level).slice(0, 40) || out.secularLevel;
    out.secularSchool = dash(lastW.school).slice(0, 160) || out.secularSchool;
    out.secularYear = dash(lastW.year_text || lastW.yearText).slice(0, 40) || out.secularYear;
    out.secularMajor = dash(lastW.major).slice(0, 120) || out.secularMajor;
  }
  DHAMMA_MAP.forEach(([p, label]) => {
    const row = list.find((x) => x.track === "ธรรม" && dash(x.level) === label);
    if (!row) return;
    out[p + "Year"] = dash(row.year_text || row.yearText).slice(0, 40);
    out[p + "School"] = dash(row.school).slice(0, 160);
  });
  const dhamma = ["นักธรรมเอก", "นักธรรมโท", "นักธรรมตรี"];
  for (const lv of dhamma) {
    const row = list.find((x) => x.track === "ธรรม" && dash(x.level) === lv);
    if (!row) continue;
    out.dhammaLevel = lv.replace("นักธรรม", "");
    out.dhammaYear = dash(row.year_text || row.yearText).slice(0, 40);
    out.dhammaSchool = dash(row.school).slice(0, 160);
    break;
  }
  PALI_MAP.forEach(([p, label]) => {
    const row = list.find((x) => x.track === "บาลี" && dash(x.level) === label);
    if (!row) return;
    out[p + "Year"] = dash(row.year_text || row.yearText).slice(0, 40);
    out[p + "School"] = dash(row.school).slice(0, 160);
  });
  for (let i = PALI_MAP.length - 1; i >= 0; i--) {
    const label = PALI_MAP[i][1];
    const row = list.find((x) => x.track === "บาลี" && dash(x.level) === label);
    if (!row) continue;
    out.paliLevel = label;
    out.paliYear = dash(row.year_text || row.yearText).slice(0, 40);
    out.paliSchool = dash(row.school).slice(0, 160);
    break;
  }
  return out;
}

function eduSummary(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const bits = [];
  const ek = list.find((x) => x.track === "ธรรม" && /เอก/.test(x.level || ""));
  const to = list.find((x) => x.track === "ธรรม" && /โท/.test(x.level || "") && !/เอก/.test(x.level || ""));
  const tri = list.find((x) => x.track === "ธรรม" && /ตรี/.test(x.level || ""));
  if (ek) bits.push("น.ธ.เอก");
  else if (to) bits.push("น.ธ.โท");
  else if (tri) bits.push("น.ธ.ตรี");
  const pali = [...list].reverse().find((x) => x.track === "บาลี" && dash(x.level));
  if (pali) bits.push(dash(pali.level));
  const world = [...list].reverse().find((x) => x.track === "โลก" && (dash(x.level) || dash(x.major)));
  if (world) bits.push(dash(world.major) || dash(world.level));
  return bits.join(", ");
}

function arabicDigits(s) {
  const th = "๐๑๒๓๔๕๖๗๘๙";
  return String(s == null ? "" : s).replace(/[๐-๙]/g, function (c) { return String(th.indexOf(c)); });
}

function keyedHas(b, key) {
  return ["Year", "School", "Wat", "Samnak", "Province"].some(function (suf) {
    return dash(b[key + suf]);
  });
}

function parsePaliRank(text) {
  const t = arabicDigits(dash(text)).replace(/\s+/g, "");
  if (!t) return 0;
  if (/ป\.?ธ\.?1-2|ป\.?ธ\.?12|ประโยค1-2|ประโยค12|ปธ\.?1-2|ปธ\.?12/.test(t)) return 2;
  const m = t.match(/(?:ป\.?ธ\.?|ปธ\.?)([3-9])/);
  if (m) return Number(m[1]);
  const p = t.match(/เปรียญ(?:ธรรม)?(?:.*ประโยค)?([3-9])/);
  if (p) return Number(p[1]);
  const q = t.match(/ประโยค([3-9])/);
  if (q) return Number(q[1]);
  return 0;
}

function compactWorld(v) {
  const t = dash(v);
  if (!t) return "";
  if (/กิตติมศักดิ์/.test(t)) return "กิตติมศักดิ์";
  if (/ปริญญาเอก/.test(t)) return "ปริญญาเอก";
  if (/ปริญญาโท|มหาบัณฑิต/.test(t)) return "ปริญญาโท";
  if (/ป\.?\s*ตรี|ปริญญาตรี/.test(t)) return "ป.ตรี";
  if (/อนุปริญญา|ปวส/.test(t)) return "อนุปริญญา";
  if (/ปวช/.test(t)) return "ปวช.";
  if (/มัธยมศึกษาปีที่\s*6|ม\.?\s*6|มัธยมปลาย/.test(t)) return "ม.6";
  if (/มัธยมศึกษาปีที่\s*3|ม\.?\s*3|มัธยมต้น/.test(t)) return "ม.3";
  if (/ประถม/.test(t)) return "ประถม";
  return t.replace(/^สามัญ\s*/, "") || t;
}

function worldHighest(bio, rains, note) {
  const b = bio && typeof bio === "object" ? bio : {};
  for (let i = WORLD_MAP.length - 1; i >= 0; i--) {
    const key = WORLD_MAP[i][0];
    const label = WORLD_MAP[i][1];
    if (dash(b[key + "Year"]) || dash(b[key + "School"]) || dash(b[key + "Grade"])) {
      return compactWorld(b[key + "Grade"] || label);
    }
  }
  if (dash(b.secularLevel) || dash(b.secularSchool) || dash(b.secularYear)) {
    return compactWorld(b.secularLevel);
  }
  let fromRain = "";
  (rains || []).forEach(function (a) {
    const s = dash(a.secular_edu || a.secularEdu);
    if (s) fromRain = compactWorld(s);
  });
  if (fromRain) return fromRain;
  const n = dash(note);
  const m = n.match(/สามัญ\s+([^·]+)/);
  return m ? compactWorld(m[1]) : "";
}

function standingOf(bio, rains, title, note) {
  const b = bio && typeof bio === "object" ? bio : {};
  let nakthamRank = 0;
  if (keyedHas(b, "dhammaEk")) nakthamRank = 3;
  else if (keyedHas(b, "dhammaTo")) nakthamRank = 2;
  else if (keyedHas(b, "dhammaTri")) nakthamRank = 1;
  if (!nakthamRank) {
    const lv = dash(b.dhammaLevel);
    if (/เอก/.test(lv)) nakthamRank = 3;
    else if (/โท/.test(lv)) nakthamRank = 2;
    else if (/ตรี/.test(lv)) nakthamRank = 1;
  }
  (rains || []).forEach(function (a) {
    const lv = dash(a.naktham);
    if (/เอก/.test(lv) && nakthamRank < 3) nakthamRank = 3;
    else if (/โท/.test(lv) && !/เอก/.test(lv) && nakthamRank < 2) nakthamRank = 2;
    else if (/ตรี/.test(lv) && nakthamRank < 1) nakthamRank = 1;
  });
  if (!nakthamRank) {
    const n = dash(note).replace(/\s+/g, "");
    if (/น\.?ธ\.?เอก|นักธรรมเอก/.test(n)) nakthamRank = 3;
    else if (/น\.?ธ\.?โท|นักธรรมโท/.test(n)) nakthamRank = 2;
    else if (/น\.?ธ\.?ตรี|นักธรรมตรี/.test(n)) nakthamRank = 1;
  }
  const nakthamCode = nakthamRank === 3 ? "น.ธ.เอก" : nakthamRank === 2 ? "น.ธ.โท" : nakthamRank === 1 ? "น.ธ.ตรี" : "";

  const paliKeys = [
    ["pali9", 9], ["pali8", 8], ["pali7", 7], ["pali6", 6],
    ["pali5", 5], ["pali4", 4], ["pali3", 3], ["pali12", 2]
  ];
  let paliRank = 0;
  paliKeys.forEach(function (pair) {
    if (keyedHas(b, pair[0]) && pair[1] > paliRank) paliRank = pair[1];
  });
  const fromLevel = parsePaliRank(b.paliLevel);
  if (fromLevel > paliRank) paliRank = fromLevel;
  const fromTitle = parsePaliRank(title || b.royalClass || "");
  if (fromTitle > paliRank) paliRank = fromTitle;
  (rains || []).forEach(function (a) {
    const n = parsePaliRank(a.pali);
    if (n > paliRank) paliRank = n;
  });
  const paliCode = paliRank >= 3 ? ("ปธ." + paliRank) : (paliRank === 2 ? "ปธ.1-2" : "");
  const worldLabel = worldHighest(bio, rains, note);
  return {
    label: [nakthamCode, paliCode].filter(Boolean).join(" "),
    nakthamRank,
    paliRank,
    isParian: paliRank >= 3,
    worldLabel,
    remark: worldLabel
  };
}

function matchParianFilter(row, wanted) {
  const w = String(wanted || "").trim();
  const rank = Number(row && row.paliRank) || 0;
  if (w === "พระเปรียญธรรม" || w === "เปรียญธรรม") return rank >= 3;
  const m = arabicDigits(w).replace(/\s+/g, "").match(/(?:ป\.?ธ\.?|ปธ\.?)([3-9])/);
  if (m) return rank === Number(m[1]);
  return null;
}

async function ensureEdu(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS monk_edu (
      id SERIAL PRIMARY KEY,
      monk_id INTEGER NOT NULL REFERENCES monks(id) ON DELETE CASCADE,
      track TEXT NOT NULL,
      level TEXT NOT NULL DEFAULT '',
      year_text TEXT NOT NULL DEFAULT '',
      school TEXT NOT NULL DEFAULT '',
      major TEXT NOT NULL DEFAULT '',
      place TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS monk_posts (
      id SERIAL PRIMARY KEY,
      monk_id INTEGER NOT NULL REFERENCES monks(id) ON DELETE CASCADE,
      group_name TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      place TEXT NOT NULL DEFAULT '',
      appointed_on TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

module.exports = {
  EDU_TRACKS, POST_GROUPS, WORLD_MAP, DHAMMA_MAP, PALI_MAP,
  eduOut, postOut, bioToEdu, bioToPosts, applyEduToBio, eduSummary, ensureEdu,
  standingOf, matchParianFilter
};
