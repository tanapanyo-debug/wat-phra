require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const { normTemple, withWatPrefix } = require("./lib/wats");
const { thaiDigits } = require("./lib/courses");

const APPLY = process.argv.includes("--apply");
const fileArg = process.argv.find((a) => a.startsWith("--file="))?.slice(7);
const dirArg = process.argv.find((a) => a.startsWith("--dir="))?.slice(6)
  || path.join(process.env.TEMP || "C:\\Temp", "phra-src", "cid-ayutthaya66");

const DATABASE_URL = String(process.env.DATABASE_URL || "").trim();
if (!DATABASE_URL) {
  console.error("ยังไม่มี DATABASE_URL ใน server/.env");
  process.exit(1);
}
if (/wat_accounting|wat_audit/i.test(DATABASE_URL)) {
  console.error("ฐานนี้ต้องเป็น wat_phra");
  process.exit(1);
}

function dash(v) {
  const s = String(v || "").replace(/\s+/g, " ").trim();
  if (!s || s === "-" || s === "–" || s === "—" || s === "*") return "";
  return s;
}

function normPali(s) {
  return String(s || "")
    .replace(/[ฺํ์]/g, "")
    .replace(/ปัญ/g, "ปญ")
    .replace(/ธัมม/g, "ธมม")
    .replace(/ธัม/g, "ธม")
    .replace(/[\s."'()*]/g, "")
    .toLowerCase();
}

function citizenId(v) {
  const d = thaiDigits(String(v || "")).replace(/[^\d]/g, "");
  if (d.length !== 13) return "";
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(d[i]) * (13 - i);
  if (((11 - (sum % 11)) % 10) !== Number(d[12])) return "";
  return d;
}

function paliBits(m) {
  const out = [];
  const add = (v) => {
    const n = normPali(v);
    if (n.length >= 4) out.push(n);
  };
  add(m.chaya_pali);
  const parts = String(m.chaya || "").split(/\s+/).filter(Boolean);
  parts.forEach(add);
  return [...new Set(out)];
}

function watSet(m) {
  const s = new Set();
  [m.wat_name].concat(m.rainWats || []).forEach((w) => {
    const n = normTemple(w);
    if (n) s.add(n);
  });
  return s;
}

function sameWat(src, m) {
  if (!src.watN) return false;
  return watSet(m).has(src.watN);
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a) return (b || "").length;
  if (!b) return a.length;
  if (Math.abs(a.length - b.length) > 1) return 99;
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

function findCols(header) {
  const h = header.map((x) => String(x || "").replace(/\s+/g, ""));
  const id = h.findIndex((x) => /เลขประจำตัว|13หลัก/.test(x) && !/จำนวน/.test(x));
  const pali = h.findIndex((x) => x === "ฉายา");
  const wat = h.findIndex((x) => /ชื่อวัด|^วัด$/.test(x));
  const name = h.findIndex((x) => x === "นาม" || x === "ชื่อ");
  const amphoe = h.findIndex((x) => /อำเภอ/.test(x));
  const dup = h.findIndex((x) => /ชื่อซ้ำ/.test(x));
  if (id < 0 || pali < 0 || wat < 0) return null;
  return { id, pali, wat, name, amphoe, dup };
}

function readFileRows(filePath) {
  const text = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/).map((line) => line.split("\t"));
  let cols = null;
  let start = 0;
  for (let i = 0; i < Math.min(12, lines.length); i++) {
    const found = findCols(lines[i]);
    if (found) {
      cols = found;
      start = i + 1;
      break;
    }
  }
  if (!cols) return [];
  const out = [];
  for (let i = start; i < lines.length; i++) {
    const c = lines[i];
    const pali = dash(c[cols.pali]);
    if (!pali || pali === "ฉายา") continue;
    if (cols.dup >= 0 && /ซ้ำ/.test(dash(c[cols.dup]))) continue;
    const id = citizenId(c[cols.id]);
    if (!id) continue;
    const amphoe = cols.amphoe >= 0 ? dash(c[cols.amphoe]) : "";
    out.push({
      pali,
      paliN: normPali(pali),
      name: cols.name >= 0 ? dash(c[cols.name]) : "",
      wat: withWatPrefix(c[cols.wat]),
      watN: normTemple(c[cols.wat]),
      amphoe,
      cityAmphoe: amphoe === "พระนครศรีอยุธยา" || amphoe === "",
      citizen_id: id
    });
  }
  return out.filter((r) => r.paliN.length >= 4);
}

function listSources() {
  if (fileArg) return [fileArg];
  if (!fs.existsSync(dirArg)) return [];
  return fs.readdirSync(dirArg)
    .filter((n) => /\.tsv$/i.test(n))
    .map((n) => path.join(dirArg, n))
    .sort();
}

function findMonk(src, monks) {
  const want = src.paliN;
  const exact = [];
  const close = [];
  for (const m of monks) {
    const bits = paliBits(m);
    const ch = normPali(m.chaya);
    const paliHit = bits.indexOf(want) >= 0 || (ch && ch.indexOf(want) >= 0);
    if (paliHit) {
      exact.push(m);
      continue;
    }
    if (want.length >= 5 && bits.some((b) => b.length >= 5 && levenshtein(b, want) <= 1)) {
      close.push(m);
    }
  }
  const exactWat = exact.filter((m) => sameWat(src, m));
  if (exactWat.length === 1) return { monk: exactWat[0], how: "pali+wat" };
  if (exact.length === 1 && (sameWat(src, exact[0]) || src.cityAmphoe)) {
    return { monk: exact[0], how: sameWat(src, exact[0]) ? "pali+wat" : "pali" };
  }
  const closeWat = close.filter((m) => sameWat(src, m));
  if (closeWat.length === 1) return { monk: closeWat[0], how: "close+wat" };
  if (exact.length > 1 || close.length > 1) return { monk: null, how: "ambiguous" };
  return { monk: null, how: "missing" };
}

(async () => {
  const files = listSources();
  if (!files.length) {
    console.error("ไม่พบไฟล์นำเข้า");
    process.exit(1);
  }
  let rows = [];
  files.forEach((f) => { rows = rows.concat(readFileRows(f)); });
  const byId = {};
  rows.forEach((r) => { byId[r.citizen_id] = (byId[r.citizen_id] || 0) + 1; });
  const src = rows.filter((r) => byId[r.citizen_id] === 1);
  const skippedDup = rows.length - src.length;

  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false }
  });
  const client = await pool.connect();
  const stats = {
    "pali+wat": 0, pali: 0, "close+wat": 0,
    missing: 0, ambiguous: 0, already: 0, conflict: 0, overwritten: 0, filled: 0
  };
  try {
    const monks = (await client.query(
      `SELECT id, chaya, chaya_pali, wat_name, citizen_id FROM monks`
    )).rows;
    const rains = (await client.query(
      `SELECT monk_id, wat_name FROM monk_rains`
    )).rows;
    const rainBy = {};
    rains.forEach((x) => {
      if (!rainBy[x.monk_id]) rainBy[x.monk_id] = [];
      rainBy[x.monk_id].push(x.wat_name);
    });
    monks.forEach((m) => { m.rainWats = rainBy[m.id] || []; });

    const usedMonk = {};
    const updates = [];
    const overwrites = [];
    for (const r of src) {
      const hit = findMonk(r, monks);
      if (!hit.monk) {
        stats[hit.how] = (stats[hit.how] || 0) + 1;
        continue;
      }
      if (usedMonk[hit.monk.id]) {
        stats.ambiguous += 1;
        continue;
      }
      usedMonk[hit.monk.id] = true;
      if (hit.monk.citizen_id) {
        if (hit.monk.citizen_id === r.citizen_id) stats.already += 1;
        else if (hit.how === "pali+wat" || hit.how === "close+wat") {
          stats.overwritten += 1;
          overwrites.push({ id: hit.monk.id, citizen_id: r.citizen_id, pali: r.pali, how: hit.how });
        } else {
          stats.conflict += 1;
        }
        continue;
      }
      stats[hit.how] = (stats[hit.how] || 0) + 1;
      updates.push({ id: hit.monk.id, citizen_id: r.citizen_id, pali: r.pali, how: hit.how });
    }

    const all = updates.concat(overwrites);
    if (APPLY) {
      await client.query("BEGIN");
      for (const u of all) {
        await client.query(
          `UPDATE monks
              SET citizen_id=$2,
                  chaya_pali=COALESCE(NULLIF(chaya_pali,''), $3),
                  updated_at=now()
            WHERE id=$1`,
          [u.id, u.citizen_id, u.pali.slice(0, 80)]
        );
        stats.filled += 1;
      }
      await client.query("COMMIT");
    } else {
      stats.filled = all.length;
    }
    const left = await client.query(`SELECT count(*)::int AS n FROM monks WHERE citizen_id=''`);
    const have = await client.query(`SELECT count(*)::int AS n FROM monks WHERE citizen_id<>''`);
    console.log(JSON.stringify({
      apply: APPLY,
      files: files.length,
      excelRows: rows.length,
      skippedDupId: skippedDup,
      match: {
        paliWat: stats["pali+wat"] || 0,
        pali: stats.pali || 0,
        closeWat: stats["close+wat"] || 0
      },
      skipped: {
        missing: stats.missing || 0,
        ambiguous: stats.ambiguous || 0,
        already: stats.already || 0,
        conflict: stats.conflict || 0
      },
      overwritten: stats.overwritten || 0,
      wouldFill: stats.filled,
      dbHaveId: have.rows[0].n,
      dbMissingId: left.rows[0].n
    }, null, 2));
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch (x) {}
    console.error(e.message || e);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
