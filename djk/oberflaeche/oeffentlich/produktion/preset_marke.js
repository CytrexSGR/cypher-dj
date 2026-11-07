// PRODUCTION (package 1.16 rest U7, T7.4, decision F8): the origin mark. A stage or an instrument track whose `preset` field is set shows the preset name;
// when its current values differ from the values the preset maps to, it shows "modified". "Modified" is never stored: the page asks the server for the
// plan of the same preset on the same target (POST /presets/anwenden, which never writes) and compares the plan's values with the current ones.
// A deleted or unreadable preset, or a plan the server refuses, only clears the mark. Without any `preset` in the project nothing is asked.
// The views read ctx.presetMarke(art, id) -> {text, titel, geaendert} | null while they draw (inserts.js, spurkoepfe.js); ctx.beimMarken lists the
// functions to call when a mark changed. ctx.presetMarkenNeu() is called when the preset store changed (the PRESETS panel saved, renamed or deleted).
const REGISTER_ID = /^(werk|nutzer):[a-z0-9-]+\/[a-z0-9][a-z0-9-]{0,47}$/;
const EPSILON = 1e-9;

export const markeText = (name, geaendert) => (geaendert ? `${name} · modified` : name);
/** The page path of the preset file for a register id ("werk:komp/drum-bus" -> "/presets/werk/komp/drum-bus"). */
export const presetDatei = (id) => `/presets/${id.replace(':', '/')}`;

/** Targets with a preset mark: [{schluessel, art, id, preset, ziel, ist}] (ist: the current values the mark is compared on). */
export function markenZiele(projekt) {
  const aus = [];
  for (const s of projekt?.spuren ?? []) {
    const g = s.geraet;
    if (g?.art === 'intern' && typeof g.preset === 'string' && REGISTER_ID.test(g.preset)) {
      aus.push({ schluessel: `spur:${s.id}`, art: 'spur', id: s.id, preset: g.preset, ziel: { art: 'spur', spur_id: s.id }, ist: g.parameter ?? {} });
    }
  }
  const staerke = [...(projekt?.spuren ?? []), ...(projekt?.gruppen ?? []), ...(projekt?.returns ?? []), ...(projekt?.master ? [projekt.master] : [])];
  for (const x of staerke) {
    for (const i of x.inserts ?? []) {
      if (typeof i.preset === 'string' && REGISTER_ID.test(i.preset)) aus.push({ schluessel: `insert:${i.id}`, art: 'insert', id: i.id, preset: i.preset, ziel: { art: 'insert', insert_id: i.id }, ist: i.werte ?? {} });
    }
  }
  // stages first, then tracks (the order of the answers does not matter to the views; the tests pin it)
  return aus.sort((a, b) => (a.art === b.art ? 0 : a.art === 'insert' ? -1 : 1));
}

const gleich = (a, b) => a === b || (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= EPSILON);
function gleicheMenge(ist, soll) {
  const k = new Set([...Object.keys(ist), ...Object.keys(soll)]);
  for (const n of k) if (!(n in ist) || !(n in soll) || !gleich(ist[n], soll[n])) return false;
  return true;
}
/** true: the current values differ from the plan's; false: equal; null: the answer is no project plan for this target. */
export function istGeaendert(ziel, plan) {
  if (plan?.weg !== 'proj' || !Array.isArray(plan.befehle) || plan.befehle.length !== 1) return null;
  const b = plan.befehle[0];
  if (ziel.art === 'insert' && b.befehl === 'insert_werte_setzen' && b.werte) {
    // the plan carries the mapped rows only; the other rows of the stage are not the preset's business
    return Object.entries(b.werte).some(([n, w]) => !(n in ziel.ist) || !gleich(ziel.ist[n], w));
  }
  if (ziel.art === 'spur' && b.befehl === 'spur_aendern' && b.geraet?.parameter) return !gleicheMenge(ziel.ist, b.geraet.parameter);
  return null;
}

export function bindePresetMarken(ctx, { verzoegerung = 250 } = {}) {
  const marken = new Map();      // schluessel -> {key, text, titel, geaendert}
  const fertig = new Map();      // schluessel -> key of the last answer (also a refusal), so a refused target is not asked at every project update
  const unterwegs = new Set();   // `${schluessel}|${key}` in flight
  const soll = new Map();        // schluessel -> key wanted now
  const offen = new Map();       // schluessel -> target waiting for the next batch
  let uhr = null;
  ctx.presetMarke = (art, id) => { const m = marken.get(`${art}:${id}`); return m ? { text: m.text, geaendert: m.geaendert, titel: m.titel } : null; };
  const melde = () => { for (const h of ctx.beimMarken ?? []) h(); };

  async function rechne(z, key) {
    const [plan, datei] = await Promise.all([ctx.holeJson('/presets/anwenden', { id: z.preset, ziel: z.ziel }), ctx.holeGet(presetDatei(z.preset))]);
    unterwegs.delete(`${z.schluessel}|${key}`);
    if (soll.get(z.schluessel) !== key) return false;   // the target moved on while we asked: a newer batch decides
    if (plan.status === 0 || datei.status === 0) return false;   // no answer (server away): ask again at the next project update
    fertig.set(z.schluessel, key);
    const geaendert = plan.status === 200 ? istGeaendert(z, plan.j) : null;
    const name = datei.status === 200 && typeof datei.j?.name === 'string' ? datei.j.name : null;
    const vorher = marken.get(z.schluessel);
    if (geaendert === null || name === null) { marken.delete(z.schluessel); return vorher !== undefined; }
    const text = markeText(name, geaendert);
    marken.set(z.schluessel, { key, text, geaendert, titel: geaendert ? `Preset: ${name} (values changed since)` : `Preset: ${name}` });
    return !vorher || vorher.text !== text;
  }
  async function arbeite() {
    uhr = null;
    const stapel = [...offen.values()]; offen.clear();
    const aenderungen = await Promise.all(stapel.map((z) => { const key = soll.get(z.schluessel); return key === undefined ? false : rechne(z, key); }));
    if (aenderungen.some(Boolean)) melde();
  }
  // U7 review R1: the preset store changed (a save, rename or delete in the PRESETS panel): forget the cached answers and ask every marked target again
  ctx.presetMarkenNeu = () => { fertig.clear(); pruefe(ctx.st.projekt); };
  ctx.beimProjekt.push((p) => pruefe(p));
  function pruefe(p) {
    const ziele = markenZiele(p), jetzt = new Set(ziele.map((z) => z.schluessel));
    let weg = false;
    for (const k of [...marken.keys()]) if (!jetzt.has(k)) { marken.delete(k); weg = true; }
    for (const k of [...soll.keys()]) if (!jetzt.has(k)) { soll.delete(k); fertig.delete(k); offen.delete(k); }
    for (const z of ziele) {
      const key = JSON.stringify([z.preset, z.ist]);
      soll.set(z.schluessel, key);
      if (fertig.get(z.schluessel) === key || unterwegs.has(`${z.schluessel}|${key}`)) continue;
      unterwegs.add(`${z.schluessel}|${key}`);
      offen.set(z.schluessel, z);
    }
    if (weg) melde();
    if (offen.size && uhr === null) uhr = setTimeout(arbeite, verzoegerung);
  }
}
