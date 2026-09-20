const { sameWatName } = require("./affStatus");

function officeRankFromText(t) {
  const s = String(t || "");
  if (/ผู้ช่วยเจ้าอาวาส/.test(s) || /(?:^|[^ก-ฮA-Za-z])(ท?ผจร|ท?ผจล)\.?/.test(s)) return 3;
  if (/รองเจ้าอาวาส/.test(s) || /(?:^|[^ก-ฮA-Za-z])(รจร|รจล)\.?/.test(s)) return 2;
  if (/รักษาการเจ้าอาวาส/.test(s) || /(?:^|[^ก-ฮA-Za-z])รก\./.test(s)) return 1;
  if (/เจ้าอาวาส/.test(s) || /(?:^|[^ก-ฮA-Za-z])(จร|จล)\./.test(s)) return 0;
  return 4;
}

function watPosHistoryOf(bio) {
  const b = bio && typeof bio === "object" ? bio : {};
  const hist = Array.isArray(b.watPosHistory) ? b.watPosHistory : [];
  const rows = hist.map((a) => ({
    position: String((a && a.position) || "").trim(),
    watName: String((a && a.watName) || "").trim()
  })).filter((a) => a.position);
  if (rows.length) return rows;
  const pos = String(b.watPosition || "").trim();
  if (!pos) return [];
  return [{ position: pos, watName: String(b.watPosPlace || "").trim() }];
}

function officeRank(m, homeWat) {
  let best = 4;
  const home = homeWat || m.watName || m.wat_name || "";
  (m.watPosHistory || watPosHistoryOf(m.bio) || []).forEach((a) => {
    const wat = String((a && a.watName) || "").trim();
    if (home && !wat) return;
    if (home && wat && !sameWatName(wat, home)) return;
    const r = officeRankFromText(a.position);
    if (r < best) best = r;
  });
  const pos = String(m.watPosition || "").trim();
  if (pos) {
    const r = officeRankFromText(pos);
    if (r < best) best = r;
  }
  return best;
}

function isAbbot(m) {
  const hist = (m && m.watPosHistory) || watPosHistoryOf(m && m.bio) || [];
  if (hist.some((a) => officeRankFromText(a.position) === 0)) return true;
  return officeRankFromText((m && m.watPosition) || "") === 0;
}

function personRank(m) {
  return (m.personType || m.person_type) === "สามเณร" ? 1 : 0;
}

function vassaRank(m) {
  if (personRank(m)) return -1;
  const n = Number(m.vassa);
  return Number.isFinite(n) ? n : -1;
}

function sectionRank(m) {
  if (m.away || m.pending) return 3;
  if (personRank(m)) return 2;
  return 1;
}

function compareReportRows(a, b, homeWat) {
  const sa = sectionRank(a);
  const sb = sectionRank(b);
  if (sa !== sb) return sa - sb;
  if (sa === 1) {
    const oa = officeRank(a, homeWat);
    const ob = officeRank(b, homeWat);
    if (oa !== ob) return oa - ob;
  }
  const pa = personRank(a);
  const pb = personRank(b);
  if (pa !== pb) return pa - pb;
  const va = vassaRank(b) - vassaRank(a);
  if (va) return va;
  const na = String(a.displayName || a.chaya || "");
  const nb = String(b.displayName || b.chaya || "");
  if (na !== nb) return na < nb ? -1 : 1;
  return (Number(a.monkId || a.id) || 0) - (Number(b.monkId || b.id) || 0);
}

function sortLikeReport(rows, homeWat) {
  return (rows || []).slice().sort((a, b) => compareReportRows(a, b, homeWat));
}

module.exports = {
  officeRankFromText, officeRank, isAbbot, sectionRank, personRank, vassaRank,
  compareReportRows, sortLikeReport, watPosHistoryOf
};
