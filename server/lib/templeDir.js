const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { clean, districtName, withWatPrefix } = require("./wats");

function decodeXml(s) {
  return String(s || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function colOf(a) {
  let n = 0;
  for (let i = 0; i < a.length; i++) n = n * 26 + (a.charCodeAt(i) - 64);
  return n - 1;
}

function parseSharedStrings(xml) {
  const strings = [];
  xml.replace(/<x:t[^>]*>([^<]*)<\/x:t>/g, function (_, t) {
    strings.push(decodeXml(t));
    return "";
  });
  return strings;
}

function parseRows(sheetXml, strings) {
  const rowRe = /<x:row r="(\d+)"[^>]*>([\s\S]*?)<\/x:row>/g;
  const rows = [];
  let m;
  while ((m = rowRe.exec(sheetXml))) {
    if (Number(m[1]) === 1) continue;
    const cells = new Array(24).fill("");
    const re = /<x:c r="([A-Z]+)\d+"([^>]*)>(?:<x:v>([^<]*)<\/x:v>)?/g;
    let c;
    while ((c = re.exec(m[2]))) {
      const i = colOf(c[1]);
      const tm = /t="([^"]+)"/.exec(c[2] || "");
      let v = c[3] == null ? "" : c[3];
      if (tm && tm[1] === "s") v = strings[Number(v)] || "";
      if (i >= 0 && i < 24) cells[i] = clean(v);
    }
    rows.push(cells);
  }
  return rows;
}

function rowToTemple(cells) {
  const code = cells[1] || "";
  const rawName = cells[2] || "";
  if (!rawName) return null;
  const nameBare = rawName.replace(/^(วัด|พระอาราม)/, "").trim() || rawName;
  return {
    code,
    name: nameBare,
    name_full: withWatPrefix(rawName),
    wat_type: cells[3] || "",
    nikaya: cells[4] || "",
    tambon: cells[10] || "",
    district: districtName(cells[11] || ""),
    province: cells[12] || "",
    postcode: cells[13] || ""
  };
}

function extractXlsx(xlsxPath) {
  const dest = path.join(os.tmpdir(), "report-temple-xlsx");
  fs.mkdirSync(dest, { recursive: true });
  execFileSync("tar", ["-xf", xlsxPath, "-C", dest, "xl/sharedStrings.xml", "xl/worksheets/sheet.xml"], {
    windowsHide: true
  });
  return dest;
}

function readTemplesFromXlsx(xlsxPath) {
  const dest = extractXlsx(xlsxPath);
  const strings = parseSharedStrings(fs.readFileSync(path.join(dest, "xl", "sharedStrings.xml"), "utf8"));
  const rows = parseRows(fs.readFileSync(path.join(dest, "xl", "worksheets", "sheet.xml"), "utf8"), strings);
  return rows.map(rowToTemple).filter(Boolean);
}

async function ensureTempleDir(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS temple_directory (
      id SERIAL PRIMARY KEY,
      code TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL,
      name_full TEXT NOT NULL,
      wat_type TEXT NOT NULL DEFAULT '',
      nikaya TEXT NOT NULL DEFAULT '',
      tambon TEXT NOT NULL DEFAULT '',
      district TEXT NOT NULL DEFAULT '',
      province TEXT NOT NULL DEFAULT '',
      postcode TEXT NOT NULL DEFAULT ''
    )
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS temple_directory_code
      ON temple_directory (code) WHERE code <> ''
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS temple_directory_place
      ON temple_directory (lower(name), lower(district), lower(province))
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS temple_directory_prov ON temple_directory (province)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS temple_directory_prov_dist ON temple_directory (province, district)`);
}

function templeOut(r) {
  return {
    id: r.id,
    code: r.code || "",
    name: r.name_full || withWatPrefix(r.name),
    shortName: r.name || "",
    watType: r.wat_type || "",
    nikaya: r.nikaya || "",
    tambon: r.tambon || "",
    district: r.district || "",
    province: r.province || "",
    postcode: r.postcode || "",
    sanghaTambon: r.sangha_tambon || ""
  };
}

function searchNeedle(q) {
  return clean(q).replace(/^(วัด|พระอาราม)/, "").trim();
}

async function listProvinces(pool) {
  const r = await pool.query(
    `SELECT province, COUNT(*)::int AS n
       FROM temple_directory
      WHERE province <> ''
      GROUP BY province
      ORDER BY province`
  );
  if (r.rows.length) return r.rows.map((x) => ({ name: x.province, count: x.n }));
  const w = await pool.query(
    `SELECT province, COUNT(*)::int AS n
       FROM phra_wats
      WHERE province <> ''
      GROUP BY province
      ORDER BY province`
  );
  return w.rows.map((x) => ({ name: x.province, count: x.n }));
}

async function listDistricts(pool, province) {
  const p = clean(province);
  if (!p) return [];
  const r = await pool.query(
    `SELECT district, COUNT(*)::int AS n
       FROM temple_directory
      WHERE province = $1 AND district <> ''
      GROUP BY district
      ORDER BY district`,
    [p]
  );
  if (r.rows.length) return r.rows.map((x) => ({ name: x.district, count: x.n }));
  const w = await pool.query(
    `SELECT district, COUNT(*)::int AS n
       FROM phra_wats
      WHERE province = $1 AND district <> ''
      GROUP BY district
      ORDER BY district`,
    [p]
  );
  return w.rows.map((x) => ({ name: x.district, count: x.n }));
}

async function searchTemples(pool, query) {
  const province = clean(query && query.province);
  const district = districtName(query && query.district);
  const q = searchNeedle(query && query.q);
  const limit = Math.min(40, Math.max(1, Number(query && query.limit) || 25));
  if (!province && !district && q.length < 2) return [];
  const r = await pool.query(
    `SELECT * FROM (
        SELECT DISTINCT ON (d.id)
               d.*, COALESCE(w.sangha_tambon, '') AS sangha_tambon
          FROM temple_directory d
          LEFT JOIN phra_wats w
            ON lower(w.name) = lower(d.name_full)
           AND lower(w.district) = lower(d.district)
         WHERE ($1 = '' OR d.province = $1)
           AND ($2 = '' OR d.district = $2)
           AND ($3 = '' OR d.name ILIKE '%' || $3 || '%' OR d.name_full ILIKE '%' || $3 || '%')
         ORDER BY d.id, CASE WHEN COALESCE(w.sangha_tambon,'') <> '' THEN 0 ELSE 1 END
      ) x
      ORDER BY
        CASE WHEN name ILIKE $3 || '%' OR name_full ILIKE 'วัด' || $3 || '%' THEN 0 ELSE 1 END,
        name
      LIMIT $4`,
    [province, district, q, limit]
  );
  return r.rows.map(templeOut);
}

async function listTemplesInPlace(pool, province, district) {
  const p = clean(province);
  const d = districtName(district);
  if (!p || !d) return [];
  const r = await pool.query(
    `SELECT d.id AS dir_id, d.code, d.name_full, d.tambon, d.district, d.province,
            w.id AS wat_id, COALESCE(w.sangha_tambon, '') AS sangha_tambon
       FROM temple_directory d
       LEFT JOIN phra_wats w
         ON lower(w.name) = lower(d.name_full)
        AND lower(w.district) = lower(d.district)
      WHERE d.province = $1 AND d.district = $2
      ORDER BY d.name_full
      LIMIT 500`,
    [p, d]
  );
  if (r.rows.length) {
    return r.rows.map((x) => ({
      dirId: x.dir_id,
      watId: x.wat_id || null,
      code: x.code || "",
      name: x.name_full || "",
      tambon: x.tambon || "",
      district: x.district || "",
      province: x.province || "",
      sanghaTambon: x.sangha_tambon || ""
    }));
  }
  const w = await pool.query(
    `SELECT id, name, tambon, district, province, sangha_tambon
       FROM phra_wats
      WHERE province = $1 AND district = $2
      ORDER BY name
      LIMIT 500`,
    [p, d]
  );
  return w.rows.map((x) => ({
    dirId: null,
    watId: x.id,
    code: "",
    name: x.name || "",
    tambon: x.tambon || "",
    district: x.district || "",
    province: x.province || "",
    sanghaTambon: x.sangha_tambon || ""
  }));
}

async function templeCount(pool) {
  const r = await pool.query("SELECT COUNT(*)::int AS n FROM temple_directory");
  return r.rows[0].n;
}

async function importTemples(pool, temples) {
  const list = Array.isArray(temples) ? temples : [];
  let n = 0;
  for (let i = 0; i < list.length; i += 150) {
    const chunk = list.slice(i, i + 150);
    const params = [];
    const values = chunk.map((t, idx) => {
      const o = idx * 9;
      params.push(
        t.code || "", t.name, t.name_full, t.wat_type || "", t.nikaya || "",
        t.tambon || "", t.district || "", t.province || "", t.postcode || ""
      );
      return `($${o + 1},$${o + 2},$${o + 3},$${o + 4},$${o + 5},$${o + 6},$${o + 7},$${o + 8},$${o + 9})`;
    });
    await pool.query(
      `INSERT INTO temple_directory (code, name, name_full, wat_type, nikaya, tambon, district, province, postcode)
       VALUES ${values.join(",")}
       ON CONFLICT DO NOTHING`,
      params
    );
    n += chunk.length;
  }
  return n;
}

module.exports = {
  ensureTempleDir,
  listProvinces,
  listDistricts,
  searchTemples,
  listTemplesInPlace,
  templeCount,
  importTemples,
  readTemplesFromXlsx
};
