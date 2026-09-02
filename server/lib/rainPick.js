function rainYearOf(x) {
  return Number(x && (x.year_be != null ? x.year_be : x.yearBe));
}

function pickRain(rains, wantedYear, status) {
  const y = Number(wantedYear);
  if (!Number.isFinite(y)) return null;
  const rows = (rains || []).filter((x) => Number.isFinite(rainYearOf(x)));
  const exact = rows.find((x) => rainYearOf(x) === y);
  if (exact) return exact;
  const st = String(status == null || status === "" ? "จำพรรษา" : status).trim();
  if (st !== "จำพรรษา") return null;
  return rows
    .filter((x) => rainYearOf(x) <= y)
    .sort((a, b) => rainYearOf(b) - rainYearOf(a))[0] || null;
}

function rainCarryJoin(monkAlias, yearParam) {
  const m = monkAlias || "m";
  const y = yearParam || "$2";
  return `JOIN LATERAL (
    SELECT y0.*
      FROM monk_rains y0
     WHERE y0.monk_id = ${m}.id
       AND y0.year_be <= ${y}
       AND (
         y0.year_be = ${y}
         OR COALESCE(NULLIF(${m}.status,''), 'จำพรรษา') = 'จำพรรษา'
       )
     ORDER BY y0.year_be DESC
     LIMIT 1
  ) y ON TRUE`;
}

function canCarryStatus(status) {
  const st = String(status == null || status === "" ? "จำพรรษา" : status).trim();
  return st === "จำพรรษา";
}

const RAIN_KIND_PENDING = "ยังไม่มา";

function isPendingRainKind(kind) {
  const k = String(kind || "").trim();
  return k === RAIN_KIND_PENDING || k === "ยังไม่มาจำพรรษา";
}

function carrySourceSql(watPlaceSql) {
  const sanghaExpr = `COALESCE(NULLIF(pw.sangha_tambon,''), NULLIF(y.sangha_tambon,''), m.sangha_tambon)`;
  const fromWhere = `
      FROM monks m
      JOIN monk_rains y ON y.monk_id = m.id AND y.year_be = $1
      LEFT JOIN ${watPlaceSql} pw ON lower(pw.name) = lower(COALESCE(NULLIF(y.wat_name,''), m.wat_name))
       AND (COALESCE(NULLIF(y.district,''), m.district) = '' OR lower(pw.district) = lower(COALESCE(NULLIF(y.district,''), m.district)))
     WHERE COALESCE(NULLIF(m.status,''), 'จำพรรษา') = 'จำพรรษา'
       AND COALESCE(NULLIF(y.rain_kind,''), '') <> '${RAIN_KIND_PENDING}'
       AND $2::int <> $1
       AND ($3::text = '' OR COALESCE(NULLIF(y.wat_name,''), m.wat_name) = $3 OR m.wat_name = $3)
       AND ($4::text = '' OR ${sanghaExpr} = $4)
       AND ($5::int = 0 OR ${sanghaExpr} = '')`;
  return { sanghaExpr, fromWhere };
}

module.exports = { rainYearOf, pickRain, rainCarryJoin, canCarryStatus, carrySourceSql, RAIN_KIND_PENDING, isPendingRainKind };
