function clean(v) {
  return String(v == null ? "" : v).replace(/\s+/g, " ").trim();
}

function sameKey(a, b) {
  return clean(a).toLowerCase() === clean(b).toLowerCase();
}

function scopeFromFilters(user, watName, sanghaTambon, province) {
  const wat = clean(watName);
  const tambon = clean(sanghaTambon);
  const prov = clean(province);
  if (wat) return { scope: "wat", scopeKey: wat };
  if (tambon) return { scope: "tambon", scopeKey: tambon };
  if (prov) return { scope: "province", scopeKey: prov };
  const lv = user && user.accessLevel;
  if (lv === "wat" && user.watName) return { scope: "wat", scopeKey: clean(user.watName) };
  if (lv === "tambon" && user.sanghaTambon) return { scope: "tambon", scopeKey: clean(user.sanghaTambon) };
  if (lv === "province" && user.province) return { scope: "province", scopeKey: clean(user.province) };
  return { scope: "all", scopeKey: "" };
}

function lockCoversPlace(lock, place) {
  if (!lock || !lock.closed) return false;
  const scope = lock.scope;
  const key = clean(lock.scope_key != null ? lock.scope_key : lock.scopeKey);
  if (scope === "all") return true;
  const wat = clean(place && (place.watName || place.wat_name));
  const tambon = clean(place && (place.sanghaTambon || place.sangha_tambon));
  const province = clean(place && place.province);
  if (scope === "wat") return !!wat && sameKey(key, wat);
  if (scope === "tambon") return !!tambon && key === tambon;
  if (scope === "province") return !!province && key === province;
  return false;
}

function placeClosedByLocks(locks, yearBe, place) {
  const y = Number(yearBe);
  return (locks || []).some((lock) => Number(lock.year_be != null ? lock.year_be : lock.yearBe) === y && lockCoversPlace(lock, place));
}

function scopeLabel(scope, scopeKey) {
  if (scope === "wat") return "วัด" + (scopeKey && scopeKey.indexOf("วัด") === 0 ? scopeKey.slice(1) : scopeKey);
  if (scope === "tambon") return "ตำบลคณะสงฆ์ " + scopeKey;
  if (scope === "province") return "จังหวัด " + scopeKey;
  return "ทั้งระบบ";
}

async function ensureRainYearLockSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS rain_year_locks (
      id SERIAL PRIMARY KEY,
      year_be INTEGER NOT NULL,
      scope TEXT NOT NULL,
      scope_key TEXT NOT NULL DEFAULT '',
      closed BOOLEAN NOT NULL DEFAULT TRUE,
      closed_at TIMESTAMPTZ,
      closed_by INTEGER,
      reopened_at TIMESTAMPTZ,
      reopened_by INTEGER
    )
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS rain_year_locks_uidx
      ON rain_year_locks (year_be, scope, scope_key)
  `);
}

async function loadYearLocks(pool, yearBe) {
  const y = Number(yearBe);
  if (!Number.isFinite(y)) return [];
  const r = await pool.query(
    "SELECT * FROM rain_year_locks WHERE year_be = $1 AND closed = TRUE",
    [y]
  );
  return r.rows;
}

async function loadLocksForYears(pool, years) {
  const ys = [...new Set((years || []).map(Number).filter((y) => Number.isFinite(y)))];
  if (!ys.length) return [];
  const r = await pool.query(
    "SELECT * FROM rain_year_locks WHERE year_be = ANY($1::int[]) AND closed = TRUE",
    [ys]
  );
  return r.rows;
}

function isAdmin(user) {
  return !!(user && user.accessLevel === "admin");
}

async function yearLockStatus(pool, user, yearBe, watName, sanghaTambon) {
  const y = Number(yearBe);
  const want = scopeFromFilters(user, watName, sanghaTambon);
  const locks = await loadYearLocks(pool, y);
  const place = {
    watName: watName || (user && user.watName) || "",
    sanghaTambon: sanghaTambon || (user && user.sanghaTambon) || "",
    province: user && user.province || ""
  };
  const closed = placeClosedByLocks(locks, y, place) || locks.some((lock) => (
    lock.scope === want.scope && sameKey(lock.scope_key, want.scopeKey) && lock.closed
  ));
  const hit = locks.find((lock) => lock.scope === want.scope && sameKey(lock.scope_key, want.scopeKey))
    || locks.find((lock) => lockCoversPlace(lock, place));
  return {
    yearBe: y,
    closed: !!closed,
    scope: want.scope,
    scopeKey: want.scopeKey,
    label: scopeLabel(want.scope, want.scopeKey),
    canClose: !!y && !closed,
    canOpen: !!closed && isAdmin(user),
    canEdit: !!y && (!closed || isAdmin(user)),
    closedBy: hit ? hit.closed_by : null
  };
}

async function assertYearWritable(pool, user, yearBe, place) {
  if (isAdmin(user)) return;
  const y = Number(yearBe);
  if (!Number.isFinite(y)) return;
  const locks = await loadYearLocks(pool, y);
  if (placeClosedByLocks(locks, y, place || {})) {
    const err = new Error("ปี " + y + " ปิดบัญชีจำพรรษาแล้ว ต้องให้ผู้ดูแลระบบเปิดปีให้ก่อน");
    err.status = 403;
    throw err;
  }
}

function rainFromDb(r) {
  return {
    year_be: r.year_be,
    wat_name: r.wat_name || "",
    tambon: r.tambon || "",
    sangha_tambon: r.sangha_tambon || "",
    district: r.district || "",
    province: r.province || "",
    age: r.age,
    vassa: r.vassa,
    secular_edu: r.secular_edu || "",
    naktham: r.naktham || "",
    naktham_year: r.naktham_year || "",
    naktham_school: r.naktham_school || "",
    naktham_province: r.naktham_province || "",
    pali: r.pali || "",
    pali_year: r.pali_year || "",
    pali_school: r.pali_school || "",
    pali_province: r.pali_province || "",
    remark: r.remark || "",
    rain_kind: r.rain_kind || ""
  };
}

async function mergeRainsKeepingClosed(pool, user, oldRows, incoming) {
  if (isAdmin(user)) return incoming || [];
  const old = oldRows || [];
  const next = incoming || [];
  const years = old.concat(next).map((x) => Number(x.year_be != null ? x.year_be : x.yearBe));
  const locks = await loadLocksForYears(pool, years);
  const out = [];
  const used = {};
  next.forEach((a) => {
    const y = Number(a.year_be != null ? a.year_be : a.yearBe);
    const prev = old.find((r) => Number(r.year_be) === y);
    const place = {
      watName: a.wat_name || a.watName || (prev && prev.wat_name) || "",
      sanghaTambon: a.sangha_tambon || a.sanghaTambon || (prev && prev.sangha_tambon) || "",
      province: a.province || (prev && prev.province) || ""
    };
    if (placeClosedByLocks(locks, y, place) || (prev && placeClosedByLocks(locks, y, {
      watName: prev.wat_name, sanghaTambon: prev.sangha_tambon, province: prev.province
    }))) {
      if (prev) {
        out.push(rainFromDb(prev));
        used[y] = true;
      }
      return;
    }
    out.push(a);
    used[y] = true;
  });
  old.forEach((prev) => {
    const y = Number(prev.year_be);
    if (used[y]) return;
    if (placeClosedByLocks(locks, y, {
      watName: prev.wat_name, sanghaTambon: prev.sangha_tambon, province: prev.province
    })) {
      out.push(rainFromDb(prev));
    }
  });
  return out;
}

async function setYearClosed(pool, user, yearBe, watName, sanghaTambon, closed, province) {
  const y = Number(yearBe);
  if (!Number.isFinite(y) || y < 2400 || y > 2700) {
    const err = new Error("เลือกปีจำพรรษาก่อน");
    err.status = 400;
    throw err;
  }
  const want = scopeFromFilters(user, watName, sanghaTambon, province);
  if (!closed && !isAdmin(user)) {
    const err = new Error("เปิดปีให้แก้ได้เฉพาะผู้ดูแลระบบ");
    err.status = 403;
    throw err;
  }
  if (closed && want.scope === "all" && !isAdmin(user)) {
    const err = new Error("ปิดทั้งระบบได้เฉพาะผู้ดูแลระบบ");
    err.status = 403;
    throw err;
  }
  const uid = user && user.id || null;
  await pool.query(
    `INSERT INTO rain_year_locks (year_be, scope, scope_key, closed, closed_at, closed_by, reopened_at, reopened_by)
     VALUES ($1,$2,$3,$4, CASE WHEN $4 THEN now() ELSE NULL END, CASE WHEN $4 THEN $5 ELSE NULL END,
             CASE WHEN $4 THEN NULL ELSE now() END, CASE WHEN $4 THEN NULL ELSE $5 END)
     ON CONFLICT (year_be, scope, scope_key) DO UPDATE SET
       closed = EXCLUDED.closed,
       closed_at = CASE WHEN EXCLUDED.closed THEN now() ELSE rain_year_locks.closed_at END,
       closed_by = CASE WHEN EXCLUDED.closed THEN EXCLUDED.closed_by ELSE rain_year_locks.closed_by END,
       reopened_at = CASE WHEN EXCLUDED.closed THEN rain_year_locks.reopened_at ELSE now() END,
       reopened_by = CASE WHEN EXCLUDED.closed THEN rain_year_locks.reopened_by ELSE EXCLUDED.reopened_by END`,
    [y, want.scope, want.scopeKey, !!closed, uid]
  );
  return yearLockStatus(pool, user, y, watName, sanghaTambon);
}

module.exports = {
  clean,
  scopeFromFilters,
  lockCoversPlace,
  placeClosedByLocks,
  scopeLabel,
  ensureRainYearLockSchema,
  loadYearLocks,
  loadLocksForYears,
  yearLockStatus,
  assertYearWritable,
  mergeRainsKeepingClosed,
  setYearClosed,
  rainFromDb
};
