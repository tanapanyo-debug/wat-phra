const { normalizeCourseKind } = require("./courses");
const { matchParianFilter } = require("./edu");

function blob(r) {
  const bio = r.bio && typeof r.bio === "object" ? r.bio : {};
  return [
    r.rank_kind, r.rankKind, r.title, r.chaya, r.sangha_name, r.sanghaName, r.chaya_pali, r.chayaPali, r.note,
    bio.royalClass, bio.royalName, bio.specialWork, bio.specialRole, bio.watPosition, bio.sanghaPosition, bio.sixType,
    Array.isArray(bio.specialKinds) ? bio.specialKinds.join(" ") : bio.specialKinds
  ].filter(Boolean).join(" ").replace(/\s+/g, "");
}

function parseSpecialKinds(r) {
  const bio = r && r.bio && typeof r.bio === "object" ? r.bio : {};
  let raw = bio.specialKinds;
  if (typeof raw === "string") raw = raw.split(/[,|]/);
  if (!Array.isArray(raw)) raw = [];
  return raw.map((s) => normalizeCourseKind(s)).filter(Boolean);
}

function courseKindsOf(courses) {
  return (Array.isArray(courses) ? courses : []).map((c) => String((c && c.kind) || "").trim()).filter(Boolean);
}

const SANGHA_RANK_KINDS = ["พระราชาคณะ", "พระครูสัญญาบัตร", "พระครูฐานานุกรม", "พระฐานานุกรม"];
const PLAIN_NAME_KIND = "ชื่อพระสงฆ์ / สามเณร";

function isSanghaRankKind(k) {
  return SANGHA_RANK_KINDS.indexOf(String(k || "").trim()) >= 0;
}

function normalizeRankKind(k) {
  const s = String(k || "").trim();
  if (isSanghaRankKind(s) || s === PLAIN_NAME_KIND) return s;
  return "";
}

function applyCallingName(bio, sanghaName, rankKind) {
  const out = bio && typeof bio === "object" ? bio : {};
  const name = String(sanghaName || "").trim();
  const titled = isSanghaRankKind(rankKind);
  if (!titled) {
    out.royalHistory = (Array.isArray(out.royalHistory) ? out.royalHistory : []).filter((a) => {
      const hasDetail = !!(a && (a.yearText || a.royalClass || a.position || a.royalOn || a.patronName || a.fanRank || a.ratchakitcha || a.royalRank));
      if (hasDetail) return true;
      const n = String((a && a.royalName) || "").trim();
      if (!n || n === name || n === "ในราชทินนามเดิม") return false;
      return true;
    });
  }
  let histName = "";
  (out.royalHistory || []).forEach((a) => {
    const n = String((a && a.royalName) || "").trim();
    if (n && n !== "ในราชทินนามเดิม") histName = n;
  });
  out.royalName = titled ? (name || histName || "") : (histName || "");
  return out;
}

function inferRank(n) {
  if (!n) return "";
  if (/ราชาคณะ|สมเด็จพระ|ชั้นธรรม|ชั้นเทพ|ชั้นราช|พระพรหม|พระเทพ/.test(n)) return "พระราชาคณะ";
  if (/พระราช/.test(n) && !/พระราชทาน/.test(n)) return "พระราชาคณะ";
  if (/พระธรรม/.test(n) && !/ธรรมทูต|ธรรมพูต/.test(n)) return "พระราชาคณะ";
  if (/พระ(เมธี|ศรี|ญาณ)/.test(n) && !/พระครู/.test(n)) return "พระราชาคณะ";
  if (/ฐานานุกรม|ฐานานุกรรม/.test(n)) return /พระครู/.test(n) ? "พระครูฐานานุกรม" : "พระฐานานุกรม";
  if (/พระครู(ปลัด|สมุห์|สมุฮ|ใบฎีกา|ใบฏีกา|สังฆรักษ์|สังฆรักข์)/.test(n)) return "พระครูฐานานุกรม";
  if (/พระ(ปลัด|สมุห์|สมุฮ|ใบฎีกา|ใบฏีกา)/.test(n)) {
    return /พระครู/.test(n) ? "พระครูฐานานุกรม" : "พระฐานานุกรม";
  }
  if (/สัญญาบัตร/.test(n) || /พระครู/.test(n)) return "พระครูสัญญาบัตร";
  return "";
}

function hasKind(list, kind, blobText, re) {
  if (list.indexOf(kind) >= 0) return true;
  return !!(re && re.test(blobText || ""));
}

function classifyRanks(r, courses) {
  const n = blob(r);
  const override = String(r.rank_kind || r.rankKind || "").trim();
  const rankKind = override === PLAIN_NAME_KIND
    ? ""
    : (SANGHA_RANK_KINDS.indexOf(override) >= 0 ? override : inferRank(n));
  const extra = parseSpecialKinds(r).concat(courseKindsOf(courses));
  const isDhammaduta = !!(r.is_dhammaduta || r.isDhammaduta) || hasKind(extra, "ธรรมทูต", n, /ธรรมทูต|ธรรมพูต/);
  const isPreacher = !!(r.is_preacher || r.isPreacher) || hasKind(extra, "นักเทศน์", n, /นักเทศน์/);
  const isVipassana = !!(r.is_vipassana || r.isVipassana) || hasKind(extra, "วิปัสสนาจารย์", n, /วิปัสสนาจารย์|วิปัสนาจารย์/);
  const isPariyatti = hasKind(extra, "ปริยัตินิเทศน์", n, /ปริยัตินิเทศน์/);
  const isBandit = hasKind(extra, "บัณฑิตเผยแผ่", n, /บัณฑิตเผยแผ่/);
  const ranks = [];
  if (isDhammaduta) ranks.push("ธรรมทูต");
  if (isPreacher) ranks.push("นักเทศน์");
  if (isVipassana) ranks.push("วิปัสสนาจารย์");
  if (isPariyatti) ranks.push("ปริยัตินิเทศน์");
  if (isBandit) ranks.push("บัณฑิตเผยแผ่");
  extra.forEach((k) => {
    const name = String(k || "").trim();
    if (!name) return;
    if (ranks.indexOf(name) >= 0) return;
    if (name === "อบรม") return;
    ranks.push(name);
  });
  if (rankKind) ranks.push(rankKind);
  return { rankKind, isDhammaduta, isPreacher, isVipassana, isPariyatti, isBandit, ranks };
}

function matchRankFilter(cls, wanted) {
  const w = String(wanted || "").trim();
  if (!w) return true;
  const parian = matchParianFilter(cls, w);
  if (parian != null) return parian;
  if (w === "ธรรมทูต" || w === "พระธรรมทูต") {
    return !!(cls.isDhammaduta || (cls.ranks || []).indexOf("ธรรมทูต") >= 0);
  }
  if (w === "นักเทศน์" || w === "พระนักเทศน์") {
    return !!(cls.isPreacher || (cls.ranks || []).indexOf("นักเทศน์") >= 0);
  }
  if (w === "วิปัสสนาจารย์" || w === "พระวิปัสสนาจารย์" || w === "พระวิปัสนาจารย์") {
    return !!(cls.isVipassana || (cls.ranks || []).indexOf("วิปัสสนาจารย์") >= 0);
  }
  if (w === "ปริยัตินิเทศน์" || w === "พระปริยัตินิเทศน์") {
    return cls.isPariyatti || (cls.ranks || []).indexOf("ปริยัตินิเทศน์") >= 0
      || (cls.courses || []).some((c) => c.kind === "ปริยัตินิเทศน์");
  }
  if (w === "บัณฑิตเผยแผ่" || w === "พระบัณฑิตเผยแผ่") {
    return cls.isBandit || (cls.ranks || []).indexOf("บัณฑิตเผยแผ่") >= 0
      || (cls.courses || []).some((c) => c.kind === "บัณฑิตเผยแผ่");
  }
  return cls.rankKind === w;
}

module.exports = {
  inferRank, classifyRanks, matchRankFilter, parseSpecialKinds,
  SANGHA_RANK_KINDS, PLAIN_NAME_KIND, isSanghaRankKind, normalizeRankKind, applyCallingName
};
