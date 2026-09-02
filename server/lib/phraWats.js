const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const { clean, sanghaTambonName, districtName, withWatPrefix, normTemple, findTemple } = require("./wats");

const WAT_PLACE_SQL = `(
  SELECT DISTINCT ON (lower(name), lower(district)) id, name, district, tambon, sangha_tambon, province, audit_id
    FROM phra_wats
   ORDER BY lower(name), lower(district), CASE WHEN sangha_tambon <> '' THEN 0 ELSE 1 END, id
)`;

function watOut(r) {
  return {
    id: r.id,
    name: r.name || "",
    district: r.district || "",
    tambon: r.tambon || "",
    province: r.province || "",
    sanghaTambon: r.sangha_tambon || "",
    regNo: r.audit_id || "",
    monkCount: r.monk_n || 0,
    drifted: !!r.drifted
  };
}

function catalogWatsFromRows(rows) {
  const byKey = new Map();
  for (const row of rows || []) {
    const name = clean(row.name);
    if (!name) continue;
    const district = districtName(row.district);
    const tambon = clean(row.tambon);
    const key = name.toLowerCase() + "\0" + district.toLowerCase();
    const cur = byKey.get(key) || {
      name,
      tambon: "",
      sanghaTambon: "",
      district: "",
      province: ""
    };
    if (tambon) cur.tambon = tambon;
    if (row.sangha_tambon && !cur.sanghaTambon) cur.sanghaTambon = row.sangha_tambon;
    if (district) cur.district = district;
    if (row.province) cur.province = clean(row.province);
    byKey.set(key, cur);
  }
  let wats = [...byKey.values()];
  const located = new Set(wats.filter((w) => w.district).map((w) => w.name));
  wats = wats.filter((w) => w.district || !located.has(w.name));
  wats.forEach((w) => {
    if (!w.province && w.district) w.province = "พระนครศรีอยุธยา";
  });
  wats.sort((a, b) => a.name.localeCompare(b.name, "th") || a.district.localeCompare(b.district, "th") || a.tambon.localeCompare(b.tambon, "th"));
  return wats;
}

function auditDatabaseUrl() {
  const file = path.join("D:", "WatAccounting", "ตรวจบัญชีวัด", "server", ".env");
  if (!fs.existsSync(file)) return "";
  const m = fs.readFileSync(file, "utf8").match(/^DATABASE_URL=(.*)$/m);
  return m ? m[1].trim().replace(/^['"]|['"]$/g, "") : "";
}

async function ensureWatSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS phra_wats (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      district TEXT NOT NULL DEFAULT '',
      sangha_tambon TEXT NOT NULL DEFAULT ''
    )
  `);
  await pool.query(`ALTER TABLE phra_wats ADD COLUMN IF NOT EXISTS tambon TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE phra_wats ADD COLUMN IF NOT EXISTS province TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE phra_wats ADD COLUMN IF NOT EXISTS audit_id INTEGER`);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS phra_wats_place
      ON phra_wats (lower(name), lower(district))
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS phra_wats_audit_id
      ON phra_wats (audit_id) WHERE audit_id IS NOT NULL
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS phra_sangha_tambons (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      district TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`ALTER TABLE phra_sangha_tambons ADD COLUMN IF NOT EXISTS province TEXT NOT NULL DEFAULT ''`);
  await pool.query(`
    UPDATE phra_sangha_tambons s
       SET province = COALESCE(NULLIF((
         SELECT w.province FROM phra_wats w
          WHERE lower(w.district) = lower(s.district) AND w.province <> ''
          LIMIT 1
       ), ''), 'พระนครศรีอยุธยา')
     WHERE s.province = ''
  `);
  await pool.query(`DROP INDEX IF EXISTS phra_sangha_tambons_place`);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS phra_sangha_tambons_place
      ON phra_sangha_tambons (lower(name), lower(district), lower(province))
  `);
  try {
    await syncWatsFromAudit(pool);
  } catch (e) {
    console.error("ซิงทะเบียนวัดจากตรวจบัญชีไม่สำเร็จ", e && e.message);
  }
  await harvestMissingWats(pool);
  await pool.query(`
    INSERT INTO phra_sangha_tambons (name, district, province)
    SELECT DISTINCT t.sangha_tambon, t.district,
           COALESCE(NULLIF(t.province, ''), 'พระนครศรีอยุธยา')
      FROM phra_wats t
     WHERE t.sangha_tambon <> ''
       AND NOT EXISTS (
         SELECT 1 FROM phra_sangha_tambons s
          WHERE lower(s.name) = lower(t.sangha_tambon)
            AND lower(s.district) = lower(t.district)
            AND lower(s.province) = lower(COALESCE(NULLIF(t.province, ''), 'พระนครศรีอยุธยา'))
       )
  `);
}

function watScore(w) {
  const n = w.name || "";
  let s = n.length;
  if (w.audit_id) s += 1000;
  if (w.sangha_tambon) s += 100;
  if (w.tambon) s += 40;
  if (/ราชวรมหาวิหาร|ราชวรวิหาร|วรมหาวิหาร|วรวิหาร/.test(n)) s += 50;
  return s;
}

async function remapWatName(client, from, to) {
  const oldName = clean(from);
  const next = clean(to);
  if (!oldName || !next || oldName === next) return 0;
  let n = 0;
  n += (await client.query(
    "UPDATE monks SET wat_name=$1, updated_at=now() WHERE wat_name=$2",
    [next, oldName]
  )).rowCount;
  n += (await client.query(
    "UPDATE monk_rains SET wat_name=$1 WHERE wat_name=$2",
    [next, oldName]
  )).rowCount;
  n += (await client.query(
    "UPDATE monk_affiliations SET wat_name=$1 WHERE wat_name=$2",
    [next, oldName]
  )).rowCount;
  n += (await client.query(
    "UPDATE monk_affiliations SET to_wat_name=$1 WHERE to_wat_name=$2",
    [next, oldName]
  )).rowCount;
  return n;
}

function placeKey(w) {
  return normTemple(w.name) + "\0" + districtName(w.district).toLowerCase();
}

async function watNameAliases(client, wat) {
  const r = await client.query(`
    SELECT DISTINCT name, district FROM (
      SELECT wat_name AS name, district FROM monks WHERE wat_name <> ''
      UNION
      SELECT wat_name, district FROM monk_rains WHERE wat_name <> ''
      UNION
      SELECT name, district FROM phra_wats WHERE name <> ''
    ) x
  `);
  const n = normTemple(wat.name);
  const dist = districtName(wat.district).toLowerCase();
  const names = [];
  const seen = {};
  r.rows.forEach((row) => {
    if (normTemple(row.name) !== n) return;
    if (dist && districtName(row.district).toLowerCase() && districtName(row.district).toLowerCase() !== dist) return;
    const k = String(row.name || "").toLowerCase();
    if (!k || seen[k]) return;
    seen[k] = true;
    names.push(row.name);
  });
  if (!names.length && wat.name) names.push(wat.name);
  return names;
}

async function mergeDuplicateWats(pool) {
  const rows = (await pool.query(
    "SELECT id, name, district, tambon, province, sangha_tambon, audit_id FROM phra_wats"
  )).rows;
  const groups = {};
  rows.forEach((w) => {
    const k = placeKey(w);
    if (!normTemple(w.name)) return;
    (groups[k] = groups[k] || []).push(w);
  });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const g of Object.values(groups)) {
      if (g.length < 2) continue;
      g.sort((a, b) => watScore(b) - watScore(a) || a.id - b.id);
      const keep = Object.assign({}, g[0]);
      g.slice(1).forEach((o) => {
        if (!keep.tambon && o.tambon) keep.tambon = o.tambon;
        if (!keep.province && o.province) keep.province = o.province;
        if (!keep.sangha_tambon && o.sangha_tambon) keep.sangha_tambon = o.sangha_tambon;
        if (!keep.audit_id && o.audit_id) keep.audit_id = o.audit_id;
      });
      await client.query(
        `UPDATE phra_wats
            SET name = $1, tambon = $2, province = $3, sangha_tambon = $4, audit_id = $5
          WHERE id = $6`,
        [keep.name, keep.tambon || "", keep.province || "", keep.sangha_tambon || "", keep.audit_id || null, keep.id]
      );
      for (const o of g.slice(1)) {
        await remapWatName(client, o.name, keep.name);
        await client.query("DELETE FROM phra_wats WHERE id = $1", [o.id]);
      }
    }
    await client.query("COMMIT");
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch (x) {}
    throw e;
  } finally {
    client.release();
  }
}

async function harvestMissingWats(pool) {
  const temples = (await pool.query(
    "SELECT id, name, district, tambon, province, sangha_tambon, audit_id FROM phra_wats"
  )).rows;
  const src = await pool.query(`
    SELECT DISTINCT ON (lower(wat_name), lower(district))
           wat_name AS name, district, tambon, province, sangha_tambon
      FROM (
        SELECT wat_name, district, tambon, province, sangha_tambon FROM monks WHERE wat_name <> ''
        UNION ALL
        SELECT wat_name, district, tambon, province, sangha_tambon FROM monk_rains WHERE wat_name <> ''
      ) x
     ORDER BY lower(wat_name), lower(district), CASE WHEN sangha_tambon <> '' THEN 0 ELSE 1 END
  `);
  for (const row of src.rows) {
    const name = withWatPrefix(row.name);
    const district = districtName(row.district);
    if (!name) continue;
    const hit = findTemple(name, district, temples);
    if (!hit.temple) continue;
    const t = hit.temple;
    const tambon = t.tambon || clean(row.tambon);
    const province = t.province || clean(row.province);
    const sangha = t.sangha_tambon || "";
    if (tambon !== t.tambon || province !== t.province) {
      await pool.query(
        `UPDATE phra_wats SET tambon=$1, province=$2 WHERE id=$3`,
        [tambon, province, t.id]
      );
      t.tambon = tambon;
      t.province = province;
    }
    if (name !== t.name) await remapWatName(pool, name, t.name);
  }
  await mergeDuplicateWats(pool);
  await pool.query(`
    UPDATE monks m SET
      sangha_tambon = w.sangha_tambon,
      tambon = CASE WHEN w.tambon = '' THEN m.tambon ELSE w.tambon END,
      updated_at = now()
    FROM phra_wats w
    WHERE lower(m.wat_name) = lower(w.name)
      AND w.sangha_tambon <> ''
      AND lower(m.district) = lower(w.district)
  `);
  await pool.query(`
    UPDATE monk_rains y SET
      sangha_tambon = w.sangha_tambon,
      tambon = CASE WHEN w.tambon = '' THEN y.tambon ELSE w.tambon END
    FROM phra_wats w
    WHERE lower(y.wat_name) = lower(w.name)
      AND w.sangha_tambon <> ''
      AND lower(y.district) = lower(w.district)
  `);
}

async function syncWatsFromAudit(pool) {
  const url = auditDatabaseUrl();
  if (!url || /wat_phra/i.test(url)) return;
  const audit = new Pool({ connectionString: url, ssl: false });
  let src;
  let tambons;
  try {
    src = await audit.query(
      `SELECT id, name, district, tambon, province, sangha_tambon
         FROM audit_temples WHERE name <> '' ORDER BY id`
    );
    tambons = await audit.query(
      `SELECT name, district FROM audit_sangha_tambons WHERE name <> ''`
    );
  } finally {
    await audit.end();
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let current = (await client.query(
      "SELECT id, name, district, tambon, province, sangha_tambon, audit_id FROM phra_wats"
    )).rows;
    for (const a of src.rows) {
      const name = withWatPrefix(a.name);
      const district = districtName(a.district);
      const tambon = clean(a.tambon);
      const province = clean(a.province) || "พระนครศรีอยุธยา";
      const sangha = sanghaTambonName(a.sangha_tambon);
      let row = current.find((w) => w.audit_id === a.id);
      if (!row) {
        const hit = findTemple(name, district, current);
        if (hit.temple) row = hit.temple;
      }
      if (row) {
        const extras = current.filter((w) => {
          if (w.id === row.id) return false;
          if (w.audit_id === a.id) return true;
          return placeKey(w) === placeKey({ name, district });
        });
        for (const o of extras) {
          await remapWatName(client, o.name, name);
          await client.query("DELETE FROM phra_wats WHERE id=$1", [o.id]);
        }
        current = current.filter((w) => !extras.some((o) => o.id === w.id));
        if (row.name !== name) await remapWatName(client, row.name, name);
        await client.query(
          `UPDATE phra_wats
              SET name=$1, district=$2, tambon=$3, province=$4, sangha_tambon=$5, audit_id=$6
            WHERE id=$7`,
          [name, district, tambon, province, sangha, a.id, row.id]
        );
        row.name = name;
        row.district = district;
        row.tambon = tambon;
        row.province = province;
        row.sangha_tambon = sangha;
        row.audit_id = a.id;
      } else {
        const ins = await client.query(
          `INSERT INTO phra_wats (name, district, tambon, province, sangha_tambon, audit_id)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT ((lower(name)), (lower(district))) DO UPDATE SET
             tambon = EXCLUDED.tambon,
             province = EXCLUDED.province,
             sangha_tambon = EXCLUDED.sangha_tambon,
             audit_id = EXCLUDED.audit_id
           RETURNING id, name, district, tambon, province, sangha_tambon, audit_id`,
          [name, district, tambon, province, sangha, a.id]
        );
        if (ins.rows[0]) {
          const got = ins.rows[0];
          const idx = current.findIndex((w) => w.id === got.id);
          if (idx >= 0) current[idx] = got;
          else current.push(got);
        }
      }
    }
    const leftovers = current.filter((w) => !w.audit_id);
    const catalog = current.filter((w) => w.audit_id);
    for (const w of leftovers) {
      const hit = findTemple(w.name, w.district, catalog);
      if (!hit.temple) continue;
      await remapWatName(client, w.name, hit.temple.name);
      await client.query("DELETE FROM phra_wats WHERE id=$1", [w.id]);
    }
    for (const s of tambons.rows) {
      const name = sanghaTambonName(s.name);
      const district = districtName(s.district);
      if (!name || !district) continue;
      await client.query(
        `INSERT INTO phra_sangha_tambons (name, district)
         SELECT $1, $2
          WHERE NOT EXISTS (
            SELECT 1 FROM phra_sangha_tambons x
             WHERE lower(x.name) = lower($1) AND lower(x.district) = lower($2)
          )`,
        [name, district]
      );
    }
    await client.query(`
      UPDATE monks m SET
        sangha_tambon = w.sangha_tambon,
        tambon = CASE WHEN w.tambon = '' THEN m.tambon ELSE w.tambon END,
        district = CASE WHEN w.district = '' THEN m.district ELSE w.district END,
        province = CASE WHEN w.province = '' THEN m.province ELSE w.province END,
        updated_at = now()
      FROM phra_wats w
      WHERE lower(m.wat_name) = lower(w.name)
        AND lower(m.district) = lower(w.district)
    `);
    await client.query(`
      UPDATE monk_rains y SET
        sangha_tambon = w.sangha_tambon,
        tambon = CASE WHEN w.tambon = '' THEN y.tambon ELSE w.tambon END,
        district = CASE WHEN w.district = '' THEN y.district ELSE w.district END,
        province = CASE WHEN w.province = '' THEN y.province ELSE w.province END
      FROM phra_wats w
      WHERE lower(y.wat_name) = lower(w.name)
        AND lower(y.district) = lower(w.district)
    `);
    await client.query("COMMIT");
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch (x) {}
    throw e;
  } finally {
    client.release();
  }
}

async function applyPlaceToRecords(client, wat) {
  const names = await watNameAliases(client, wat);
  const sangha = wat.sangha_tambon || "";
  const tambon = wat.tambon || "";
  const district = wat.district || "";
  const province = wat.province || "";
  for (const name of names) {
    await client.query(
      `UPDATE monks SET
          sangha_tambon = $1,
          tambon = CASE WHEN $2 = '' THEN tambon ELSE $2 END,
          district = CASE WHEN $3 = '' THEN district ELSE $3 END,
          province = CASE WHEN $4 = '' THEN province ELSE $4 END,
          updated_at = now()
        WHERE lower(wat_name) = lower($5)
          AND ($3 <> '' AND lower(district) = lower($3))`,
      [sangha, tambon, district, province, name]
    );
    await client.query(
      `UPDATE monk_rains SET
          sangha_tambon = $1,
          tambon = CASE WHEN $2 = '' THEN tambon ELSE $2 END,
          district = CASE WHEN $3 = '' THEN district ELSE $3 END,
          province = CASE WHEN $4 = '' THEN province ELSE $4 END
        WHERE lower(wat_name) = lower($5)
          AND ($3 <> '' AND lower(district) = lower($3))`,
      [sangha, tambon, district, province, name]
    );
  }
}

async function upsertWatFromPlace(client, p) {
  const name = withWatPrefix(p.wat_name || p.watName || p.name);
  if (!name) return;
  const district = districtName(p.district);
  const tambon = clean(p.tambon);
  const province = clean(p.province);
  const sangha = sanghaTambonName(p.sangha_tambon || p.sanghaTambon);
  const temples = (await client.query(
    "SELECT id, name, district, tambon, province, sangha_tambon FROM phra_wats"
  )).rows;
  const hit = findTemple(name, district, temples);
  if (hit.temple) {
    if (name !== hit.temple.name) await remapWatName(client, name, hit.temple.name);
    await client.query(
      `UPDATE phra_wats SET
          tambon = CASE WHEN tambon = '' THEN $1 ELSE tambon END,
          province = CASE WHEN province = '' THEN $2 ELSE province END,
          sangha_tambon = CASE WHEN sangha_tambon = '' THEN $3 ELSE sangha_tambon END
        WHERE id = $4`,
      [tambon, province, sangha, hit.temple.id]
    );
  }
}

async function listWats(pool) {
  const wats = (await pool.query(
    `SELECT id, name, district, tambon, province, sangha_tambon, audit_id
       FROM phra_wats
      ORDER BY district, sangha_tambon, name`
  )).rows;
  const monks = (await pool.query(
    "SELECT id, wat_name, sangha_tambon, district FROM monks WHERE wat_name <> ''"
  )).rows;
  wats.forEach((w) => {
    w.monk_n = 0;
    w.drifted = false;
  });
  monks.forEach((m) => {
    const hit = findTemple(m.wat_name, m.district, wats);
    if (!hit.temple) return;
    hit.temple.monk_n += 1;
    if (m.sangha_tambon && (hit.temple.sangha_tambon === "" || m.sangha_tambon !== hit.temple.sangha_tambon)) {
      hit.temple.drifted = true;
    }
  });
  return wats.map(watOut);
}

async function listSanghaTambons(pool, district, province) {
  const dist = districtName(district);
  const prov = clean(province);
  const params = [];
  const where = [];
  if (dist) {
    params.push(dist);
    where.push(`s.district = $${params.length}`);
  }
  if (prov) {
    params.push(prov);
    where.push(`(s.province = '' OR s.province = $${params.length})`);
  }
  const r = await pool.query(
    `SELECT s.id, s.name, s.district, s.province, COUNT(t.id)::int AS n
       FROM phra_sangha_tambons s
       LEFT JOIN phra_wats t
         ON lower(t.district) = lower(s.district)
        AND t.sangha_tambon = s.name
        AND (s.province = '' OR t.province = '' OR lower(t.province) = lower(s.province))
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      GROUP BY s.id, s.name, s.district, s.province
      ORDER BY s.province, s.district, s.name`,
    params
  );
  return r.rows.map((x) => ({
    id: x.id,
    name: x.name || "",
    district: x.district || "",
    province: x.province || "",
    count: x.n || 0
  }));
}

async function addSanghaTambon(pool, body) {
  const name = sanghaTambonName(body && body.name);
  const district = districtName(body && body.district);
  const province = clean(body && body.province);
  if (!name) throw Object.assign(new Error("กรอกชื่อตำบลคณะสงฆ์"), { status: 400 });
  if (!province) throw Object.assign(new Error("เลือกจังหวัดก่อน"), { status: 400 });
  if (!district) throw Object.assign(new Error("เลือกอำเภอก่อน"), { status: 400 });
  try {
    const r = await pool.query(
      `INSERT INTO phra_sangha_tambons (name, district, province) VALUES ($1, $2, $3)
       RETURNING id, name, district, province`,
      [name, district, province]
    );
    return {
      id: r.rows[0].id,
      name: r.rows[0].name,
      district: r.rows[0].district,
      province: r.rows[0].province,
      count: 0
    };
  } catch (e) {
    if (e && e.code === "23505") {
      throw Object.assign(new Error("มีตำบลคณะสงฆ์ชื่อนี้อำเภอนี้แล้ว"), { status: 409 });
    }
    throw e;
  }
}

async function renameSanghaTambon(pool, id, nextName) {
  const name = sanghaTambonName(nextName);
  if (!id) throw Object.assign(new Error("ไม่พบตำบลคณะสงฆ์"), { status: 400 });
  if (!name) throw Object.assign(new Error("กรอกชื่อตำบลคณะสงฆ์"), { status: 400 });
  const client = await pool.connect();
  try {
    const cur = await client.query("SELECT id, name, district, province FROM phra_sangha_tambons WHERE id = $1", [id]);
    if (!cur.rows[0]) throw Object.assign(new Error("ไม่พบตำบลคณะสงฆ์นี้"), { status: 404 });
    const old = cur.rows[0];
    await client.query("BEGIN");
    await client.query("UPDATE phra_sangha_tambons SET name = $1 WHERE id = $2", [name, id]);
    await client.query(
      `UPDATE phra_wats SET sangha_tambon = $1
        WHERE lower(district) = lower($2) AND sangha_tambon = $3
          AND ($4 = '' OR province = '' OR lower(province) = lower($4))`,
      [name, old.district, old.name, old.province || ""]
    );
    const wats = await client.query(
      `SELECT name, district, tambon, province, sangha_tambon FROM phra_wats
        WHERE lower(district) = lower($1) AND sangha_tambon = $2
          AND ($3 = '' OR province = '' OR lower(province) = lower($3))`,
      [old.district, name, old.province || ""]
    );
    for (const w of wats.rows) await applyPlaceToRecords(client, w);
    await client.query("COMMIT");
    return { id, name, district: old.district, province: old.province || "" };
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch (x) {}
    if (e && e.code === "23505") {
      throw Object.assign(new Error("มีตำบลคณะสงฆ์ชื่อนี้อำเภอนี้แล้ว"), { status: 409 });
    }
    throw e;
  } finally {
    client.release();
  }
}

async function deleteSanghaTambon(pool, id) {
  if (!id) throw Object.assign(new Error("ไม่พบตำบลคณะสงฆ์"), { status: 400 });
  const client = await pool.connect();
  try {
    const cur = await client.query("SELECT id, name, district, province FROM phra_sangha_tambons WHERE id = $1", [id]);
    if (!cur.rows[0]) throw Object.assign(new Error("ไม่พบตำบลคณะสงฆ์นี้"), { status: 404 });
    const old = cur.rows[0];
    await client.query("BEGIN");
    const wats = await client.query(
      `SELECT name, district, tambon, province FROM phra_wats
        WHERE lower(district) = lower($1) AND sangha_tambon = $2
          AND ($3 = '' OR province = '' OR lower(province) = lower($3))`,
      [old.district, old.name, old.province || ""]
    );
    await client.query(
      `UPDATE phra_wats SET sangha_tambon = ''
        WHERE lower(district) = lower($1) AND sangha_tambon = $2
          AND ($3 = '' OR province = '' OR lower(province) = lower($3))`,
      [old.district, old.name, old.province || ""]
    );
    for (const w of wats.rows) {
      await applyPlaceToRecords(client, { ...w, sangha_tambon: "" });
    }
    await client.query("DELETE FROM phra_sangha_tambons WHERE id = $1", [id]);
    await client.query("COMMIT");
    return { ok: true };
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch (x) {}
    throw e;
  } finally {
    client.release();
  }
}

async function assignSanghaWats(pool, body) {
  const district = districtName(body && body.district);
  const province = clean(body && body.province);
  const name = sanghaTambonName(body && body.name);
  const ids = (Array.isArray(body && body.watIds) ? body.watIds : [])
    .map(Number)
    .filter((n) => Number.isFinite(n) && n > 0);
  if (!district) throw Object.assign(new Error("เลือกอำเภอ"), { status: 400 });
  if (!name) throw Object.assign(new Error("เลือกตำบลคณะสงฆ์"), { status: 400 });
  const exists = await pool.query(
    `SELECT id FROM phra_sangha_tambons
      WHERE lower(name) = lower($1) AND lower(district) = lower($2)
        AND ($3 = '' OR province = '' OR lower(province) = lower($3))`,
    [name, district, province]
  );
  if (!exists.rows[0]) throw Object.assign(new Error("ไม่พบตำบลคณะสงฆ์นี้"), { status: 404 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const cleared = await client.query(
      `UPDATE phra_wats SET sangha_tambon = ''
        WHERE lower(district) = lower($1) AND sangha_tambon = $2
          AND ($4 = '' OR province = '' OR lower(province) = lower($4))
          AND NOT (id = ANY($3::int[]))
        RETURNING name, district, tambon, province, sangha_tambon`,
      [district, name, ids, province]
    );
    let assigned = { rows: [] };
    if (ids.length) {
      assigned = await client.query(
        `UPDATE phra_wats SET sangha_tambon = $1
          WHERE id = ANY($2::int[]) AND lower(district) = lower($3)
            AND ($4 = '' OR province = '' OR lower(province) = lower($4))
          RETURNING name, district, tambon, province, sangha_tambon`,
        [name, ids, district, province]
      );
    }
    for (const w of cleared.rows.concat(assigned.rows)) {
      await applyPlaceToRecords(client, w);
    }
    await client.query("COMMIT");
    const n = await pool.query(
      `SELECT COUNT(*)::int AS n FROM phra_wats
        WHERE lower(district) = lower($1) AND sangha_tambon = $2
          AND ($3 = '' OR province = '' OR lower(province) = lower($3))`,
      [district, name, province]
    );
    return { ok: true, count: n.rows[0].n };
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch (x) {}
    throw e;
  } finally {
    client.release();
  }
}

async function addWat(pool, body) {
  const name = withWatPrefix(body && body.name);
  const district = districtName(body && body.district);
  const tambon = clean(body && body.tambon);
  const province = clean(body && body.province) || (district ? "พระนครศรีอยุธยา" : "");
  const sangha = sanghaTambonName(body && body.sanghaTambon);
  if (!name) throw Object.assign(new Error("กรอกชื่อวัด"), { status: 400 });
  if (!district) throw Object.assign(new Error("กรอกอำเภอ"), { status: 400 });
  try {
    const r = await pool.query(
      `INSERT INTO phra_wats (name, district, tambon, province, sangha_tambon)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id, name, district, tambon, province, sangha_tambon, audit_id`,
      [name, district, tambon, province, sangha]
    );
    if (sangha && district) {
      await pool.query(
        `INSERT INTO phra_sangha_tambons (name, district, province)
         SELECT $1, $2, $3
          WHERE NOT EXISTS (
            SELECT 1 FROM phra_sangha_tambons s
             WHERE lower(s.name) = lower($1) AND lower(s.district) = lower($2)
               AND lower(s.province) = lower($3)
          )`,
        [sangha, district, province]
      );
    }
    return watOut({ ...r.rows[0], monk_n: 0, drifted: false });
  } catch (e) {
    if (e && e.code === "23505") {
      throw Object.assign(new Error("มีวัดนี้อำเภอนี้ในฐานแล้ว"), { status: 409 });
    }
    throw e;
  }
}

async function ensureDistrictFromDirectory(pool, body) {
  const province = clean(body && body.province);
  const district = districtName(body && body.district);
  if (!province) throw Object.assign(new Error("เลือกจังหวัดก่อน"), { status: 400 });
  if (!district) throw Object.assign(new Error("เลือกอำเภอก่อน"), { status: 400 });
  await pool.query(
    `UPDATE phra_wats w
        SET tambon = CASE WHEN w.tambon = '' THEN d.tambon ELSE w.tambon END,
            province = CASE WHEN w.province = '' THEN d.province ELSE w.province END
       FROM temple_directory d
      WHERE d.province = $1 AND d.district = $2
        AND lower(w.name) = lower(d.name_full)
        AND lower(w.district) = lower(d.district)
        AND (w.tambon = '' OR w.province = '')`,
    [province, district]
  );
  const r = await pool.query(
    `INSERT INTO phra_wats (name, district, tambon, province, sangha_tambon)
     SELECT d.name_full, d.district, d.tambon, d.province, ''
       FROM temple_directory d
      WHERE d.province = $1 AND d.district = $2
        AND NOT EXISTS (
          SELECT 1 FROM phra_wats w
           WHERE lower(w.name) = lower(d.name_full)
             AND lower(w.district) = lower(d.district)
        )
     RETURNING id`,
    [province, district]
  );
  return { ok: true, added: r.rowCount };
}

async function resolveWat(pool, body) {
  const province = clean(body && body.province);
  const district = districtName(body && body.district);
  const name = withWatPrefix(body && body.name);
  const tambon = clean(body && body.tambon);
  if (!province) throw Object.assign(new Error("เลือกจังหวัดก่อน"), { status: 400 });
  if (!district) throw Object.assign(new Error("เลือกอำเภอก่อน"), { status: 400 });
  if (!name) throw Object.assign(new Error("เลือกวัด"), { status: 400 });
  await ensureDistrictFromDirectory(pool, { province, district });
  let r = await pool.query(
    `SELECT id, name, district, tambon, province, sangha_tambon, audit_id
       FROM phra_wats
      WHERE lower(name) = lower($1) AND lower(district) = lower($2)
      ORDER BY CASE WHEN sangha_tambon <> '' THEN 0 ELSE 1 END, id
      LIMIT 1`,
    [name, district]
  );
  if (!r.rows[0]) {
    r = await pool.query(
      `INSERT INTO phra_wats (name, district, tambon, province, sangha_tambon)
       VALUES ($1,$2,$3,$4,'')
       RETURNING id, name, district, tambon, province, sangha_tambon, audit_id`,
      [name, district, tambon, province]
    );
  } else if (tambon || province) {
    await pool.query(
      `UPDATE phra_wats SET
          tambon = CASE WHEN tambon = '' THEN $1 ELSE tambon END,
          province = CASE WHEN province = '' THEN $2 ELSE province END
        WHERE id = $3`,
      [tambon, province, r.rows[0].id]
    );
    r = await pool.query(
      `SELECT id, name, district, tambon, province, sangha_tambon, audit_id FROM phra_wats WHERE id = $1`,
      [r.rows[0].id]
    );
  }
  return watOut({ ...r.rows[0], monk_n: 0, drifted: false });
}

function sendErr(res, e, fallback) {
  const status = e && e.status ? e.status : 500;
  if (status >= 500) console.error(e);
  res.status(status).json({ error: (e && e.message) || fallback });
}

module.exports = {
  WAT_PLACE_SQL,
  ensureWatSchema,
  harvestMissingWats,
  applyPlaceToRecords,
  upsertWatFromPlace,
  catalogWatsFromRows,
  listWats,
  listSanghaTambons,
  addSanghaTambon,
  renameSanghaTambon,
  deleteSanghaTambon,
  assignSanghaWats,
  addWat,
  ensureDistrictFromDirectory,
  resolveWat,
  syncWatsFromAudit,
  sendErr,
  clean,
  sanghaTambonName,
  districtName,
  withWatPrefix
};
