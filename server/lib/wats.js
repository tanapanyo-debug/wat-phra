function clean(v) {
  return String(v == null ? "" : v).replace(/\s+/g, " ").trim();
}

function sanghaTambonName(v) {
  return clean(v).replace(/^(ตำบล|ต\.|ต\s+)/, "").trim();
}

function districtName(v) {
  return clean(v).replace(/^(อำเภอ|เขต|อ\.|อ\s+)/, "").trim();
}

function withWatPrefix(name) {
  const t = clean(name);
  if (!t) return "";
  if (/^(วัด|พระอาราม)/.test(t)) return t;
  return "วัด" + t;
}

function foldThaiLetters(s) {
  return String(s || "")
    .replace(/[ศษ]/g, "ส")
    .replace(/[ธฑฒ]/g, "ท")
    .replace(/ฆ/g, "ค")
    .replace(/ภ/g, "พ")
    .replace(/ฬ/g, "ล")
    .replace(/ใ/g, "ไ");
}

function normTemple(name) {
  return foldThaiLetters(
    withWatPrefix(name)
      .replace(/^(วัด|พระอาราม)/, "")
      .replace(/อรัญญิก$/, "")
      .replace(/ราชวรมหาวิหาร|ราชวรวิหาร|วรมหาวิหาร|วรวิหาร/g, "")
      .replace(/[()\[\]{}ฯ.,"'“”‘’\-_/]/g, "")
      .replace(/ฏ/g, "ฎ")
      .replace(/[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/g, "")
      .replace(/\s+/g, "")
      .toLowerCase()
  );
}

function overlapLen(a, b) {
  if (!a || !b) return 0;
  if (a === b) return a.length;
  if (a.indexOf(b) >= 0 || b.indexOf(a) >= 0) return Math.min(a.length, b.length);
  return 0;
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a) return (b || "").length;
  if (!b) return a.length;
  if (Math.abs(a.length - b.length) > 2) return 99;
  const v0 = new Array(b.length + 1);
  const v1 = new Array(b.length + 1);
  for (let i = 0; i <= b.length; i++) v0[i] = i;
  for (let i = 0; i < a.length; i++) {
    v1[0] = i + 1;
    for (let j = 0; j < b.length; j++) {
      v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + (a[i] === b[j] ? 0 : 1));
    }
    for (let j = 0; j <= b.length; j++) v0[j] = v1[j];
  }
  return v0[b.length];
}

function findTemple(name, district, temples) {
  const q = normTemple(name);
  if (!q) return { temple: null, reason: "empty" };
  const dist = districtName(district);
  let pool = (temples || []).filter((t) => !dist || districtName(t.district) === dist);
  if (dist && !pool.length) pool = temples || [];
  function pick(list, how) {
    if (list.length === 1) return { temple: list[0], how };
    if (list.length > 1) return { temple: null, reason: "ambiguous", candidates: list };
    return null;
  }
  const exact = pool.filter((t) => normTemple(t.name) === q);
  const named = pick(exact, "exact");
  if (named) return named;
  const close = pool
    .map((t) => ({ t, d: levenshtein(normTemple(t.name), q) }))
    .filter((x) => x.d <= 2 && q.length >= 4)
    .sort((a, b) => a.d - b.d);
  if (close.length === 1 || (close.length > 1 && close[0].d < close[1].d)) {
    return { temple: close[0].t, how: "close" };
  }
  const fuzzy = pool
    .map((t) => ({ t, n: overlapLen(normTemple(t.name), q) }))
    .filter((x) => x.n >= 6)
    .sort((a, b) => b.n - a.n || b.t.name.length - a.t.name.length);
  if (fuzzy.length) {
    const top = fuzzy.filter((x) => x.n === fuzzy[0].n).map((x) => x.t);
    const picked = pick(top, "fuzzy");
    if (picked) return picked;
  }
  const prefix = pool
    .map((t) => {
      const n = normTemple(t.name);
      const ok = n.length >= 4 && q.length >= 4 && (n.startsWith(q) || q.startsWith(n));
      return { t, n: ok ? Math.min(n.length, q.length) : 0 };
    })
    .filter((x) => x.n >= 4)
    .sort((a, b) => b.n - a.n);
  if (prefix.length === 1 || (prefix.length > 1 && prefix[0].n > prefix[1].n)) {
    return { temple: prefix[0].t, how: "prefix" };
  }
  return { temple: null, reason: "missing" };
}

module.exports = {
  clean,
  sanghaTambonName,
  districtName,
  withWatPrefix,
  foldThaiLetters,
  normTemple,
  findTemple
};
