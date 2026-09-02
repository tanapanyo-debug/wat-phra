function dash(v) {
  return String(v == null ? "" : v).trim();
}

function royalNameOf(r) {
  const bio = r && r.bio && typeof r.bio === "object" ? r.bio : {};
  return dash(bio.royalName || r.sangha_name || r.sanghaName);
}

function chayaOf(r) {
  return dash(r && (r.chaya_pali || r.chayaPali));
}

function civilNameOf(r) {
  return [r && (r.former_name || r.formerName), r && (r.former_surname || r.formerSurname)]
    .map(dash)
    .filter(Boolean)
    .join(" ");
}

function stripPrefix(text, prefix) {
  const t = dash(text);
  const p = dash(prefix);
  if (!p || !t) return t;
  if (t === p) return "";
  if (t.indexOf(p) === 0) return dash(t.slice(p.length).replace(/^[,\s]+/, ""));
  return t;
}

function monasticName(r) {
  const rankName = royalNameOf(r);
  const pali = chayaOf(r);
  const legacy = dash(r && r.chaya);
  if (rankName) {
    let chayaPart = pali || stripPrefix(legacy, rankName);
    chayaPart = stripPrefix(chayaPart, rankName);
    return [rankName, chayaPart].filter(Boolean).join(" ") || legacy;
  }
  if (pali && legacy && legacy !== pali && legacy.indexOf(pali) >= 0) return legacy;
  return pali || legacy;
}

function displayName(r) {
  const main = monasticName(r);
  const civil = civilNameOf(r);
  if (!main) return civil;
  return civil ? main + " (" + civil + ")" : main;
}

function noviceChaya(r) {
  return dash(r && (r.former_surname || r.formerSurname));
}

function displayNameAt(r, personType) {
  if (personType !== "สามเณร") return displayName(r);
  const given = dash(r && (r.former_name || r.formerName));
  const surname = noviceChaya(r);
  const civil = civilNameOf(r);
  let main = "สามเณร" + (given || surname || "");
  if (given && surname) main = "สามเณร" + given + " " + surname;
  return civil ? main + " (" + civil + ")" : main;
}

module.exports = { royalNameOf, chayaOf, civilNameOf, monasticName, displayName, displayNameAt, noviceChaya };
