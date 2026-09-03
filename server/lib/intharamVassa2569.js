const YEAR_BE = 2569;
const WAT_NAME = "วัดอินทาราม";
const PLACE = "พระนครศรีอยุธยา";

const MONKS = [
  {
    formerName: "Bhutan",
    formerSurname: "Barua",
    chayaPali: "Suriyananda Bhikkhu",
    homeWat: "Machadia Gyan Bikash Vihar",
    homeDistrict: "Chattogram",
    homeProvince: "Chattogram"
  },
  {
    formerName: "Jewel Rana",
    formerSurname: "Barua",
    chayaPali: "Ananda Priya Bhikkhu",
    homeWat: "Patiya Central Buddhist Monastery and Welfare Complex",
    homeDistrict: "Chattogram",
    homeProvince: "Chattogram"
  },
  {
    formerName: "Ruttom Barua",
    formerSurname: "Barua",
    chayaPali: "progga Nidhi",
    homeWat: "Chittagong Buddhist monastery nandakanon Chittagong",
    homeDistrict: "Chittagong",
    homeProvince: "Chittagong"
  }
];

function monkMatchSql(alias) {
  const m = alias || "m";
  return `(
    (lower(btrim(${m}.former_surname)) = 'barua' AND (
      lower(btrim(${m}.former_name)) IN ('bhutan', 'jewel rana', 'ruttom', 'ruttom barua', 'jewel rana barua')
      OR lower(btrim(${m}.former_name)) LIKE 'bhutan%'
      OR lower(btrim(${m}.former_name)) LIKE 'jewel rana%'
      OR lower(btrim(${m}.former_name)) LIKE 'ruttom%'
    ))
    OR lower(btrim(${m}.chaya_pali)) IN ('suriyananda bhikkhu', 'ananda priya bhikkhu', 'progga nidhi')
    OR lower(btrim(${m}.chaya)) IN ('suriyananda bhikkhu', 'ananda priya bhikkhu', 'progga nidhi')
  )`;
}

async function lookupIntharam(pool) {
  const r = await pool.query(
    `SELECT id, name, tambon, sangha_tambon, district, province
       FROM phra_wats
      WHERE lower(name) = lower($1)
         OR name ILIKE '%อินทาราม%'
         OR name ILIKE '%intharam%'
      ORDER BY CASE WHEN province = $2 OR district = $2 THEN 0 ELSE 1 END,
               CASE WHEN sangha_tambon <> '' THEN 0 ELSE 1 END, id
      LIMIT 1`,
    [WAT_NAME, PLACE]
  );
  const wat = r.rows[0];
  if (!wat) return null;
  return {
    id: wat.id,
    name: wat.name || WAT_NAME,
    tambon: wat.tambon || "หัวรอ",
    sanghaTambon: wat.sangha_tambon || "",
    district: wat.district || PLACE,
    province: wat.province || PLACE
  };
}

async function insertMissingMonks(pool, wat) {
  let added = 0;
  for (const row of MONKS) {
    const found = await pool.query(
      `SELECT id FROM monks m
        WHERE lower(btrim(chaya_pali)) = lower($1)
           OR lower(btrim(chaya)) = lower($1)
           OR (lower(btrim(former_name)) = lower($2) AND lower(btrim(former_surname)) = lower($3))
        LIMIT 1`,
      [row.chayaPali, row.formerName, row.formerSurname]
    );
    if (found.rowCount) continue;
    const ins = await pool.query(
      `INSERT INTO monks (
         person_type, chaya, former_name, former_surname, chaya_pali,
         wat_name, district, province, stay_wat_id, status, note
       ) VALUES (
         'ภิกษุ', $1, $2, $3, $1,
         $4, $5, $6, $7, 'จำพรรษา', 'พระต่างชาติจำพรรษาที่วัดอินทาราม ปี 2569'
       ) RETURNING id`,
      [
        row.chayaPali, row.formerName, row.formerSurname,
        row.homeWat, row.homeDistrict, row.homeProvince, wat.id
      ]
    );
    added += 1;
    const monkId = ins.rows[0].id;
    await pool.query(
      `INSERT INTO monk_rains (monk_id, year_be, wat_name, tambon, sangha_tambon, district, province, rain_kind)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'')
       ON CONFLICT (monk_id, year_be) DO UPDATE SET
         wat_name = EXCLUDED.wat_name,
         tambon = EXCLUDED.tambon,
         sangha_tambon = EXCLUDED.sangha_tambon,
         district = EXCLUDED.district,
         province = EXCLUDED.province`,
      [monkId, YEAR_BE, wat.name, wat.tambon, wat.sanghaTambon, wat.district, wat.province]
    );
  }
  return added;
}

async function ensureIntharamVassa2569(pool) {
  const wat = await lookupIntharam(pool);
  if (!wat) return { ok: false, updated: 0, added: 0 };
  const added = await insertMissingMonks(pool, wat);
  const named = await pool.query(
    `INSERT INTO monk_rains (monk_id, year_be, wat_name, tambon, sangha_tambon, district, province, rain_kind)
     SELECT m.id, $1, $2, $3, $4, $5, $6, COALESCE(y.rain_kind, '')
       FROM monks m
       LEFT JOIN monk_rains y ON y.monk_id = m.id AND y.year_be = $1
      WHERE ${monkMatchSql("m")}
     ON CONFLICT (monk_id, year_be) DO UPDATE SET
       wat_name = EXCLUDED.wat_name,
       tambon = EXCLUDED.tambon,
       sangha_tambon = EXCLUDED.sangha_tambon,
       district = EXCLUDED.district,
       province = EXCLUDED.province`,
    [YEAR_BE, wat.name, wat.tambon, wat.sanghaTambon, wat.district, wat.province]
  );
  const place = await pool.query(
    `UPDATE monk_rains y
        SET wat_name = $2,
            tambon = COALESCE(NULLIF($3, ''), y.tambon),
            sangha_tambon = COALESCE(NULLIF($4, ''), y.sangha_tambon),
            district = $5,
            province = $6
      WHERE y.year_be = $1
        AND (
          y.wat_name ILIKE '%อินทาราม%'
          OR y.wat_name ILIKE '%intharam%'
          OR lower(btrim(y.wat_name)) = lower($2)
        )`,
    [YEAR_BE, wat.name, wat.tambon, wat.sanghaTambon, wat.district, wat.province]
  );
  await pool.query(
    `UPDATE monks m
        SET stay_wat_id = $1,
            status = CASE WHEN m.status IN ('มรณภาพ', 'ลาสิกขา', 'ย้ายวัด') THEN m.status ELSE 'จำพรรษา' END,
            updated_at = now()
      WHERE ${monkMatchSql("m")}`,
    [wat.id]
  );
  return {
    ok: true,
    updated: (named.rowCount || 0) + (place.rowCount || 0),
    added
  };
}

module.exports = {
  YEAR_BE,
  WAT_NAME,
  MONKS,
  monkMatchSql,
  ensureIntharamVassa2569
};
