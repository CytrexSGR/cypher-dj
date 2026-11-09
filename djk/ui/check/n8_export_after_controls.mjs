// N8 probe (routing 1.10, open flank 4): an export right after a mixer change must render the NEW value, never an interim value of the ramp.
// Against a TEST INSTANCE page server (instances b, d or e; never f, g, h, i, never the operation) with the freshly built core and cypherdj-render:
//   node check/n8_export_after_controls.mjs --url http://127.0.0.1:52300 [--wartezeit 0] [--runden 3] [--ziel gruppe|spur|beide] [--ausgabe <folder>]
// Build: a project with three instrument tracks (MIDI, 8 beats), s2 and s3 in the group g1, s1 muted. The mixer values go through /proj/aendern
// (group fader, track fader). A SETTLED reference export (1500 ms after the change) is taken once per value; then, per round and value, the change is
// made, --wartezeit ms are waited and ONE export is taken at once. An export is WRONG when its peak differs from the settled reference of that value
// by more than 0.01 dB. A value whose settled reference is within 0.05 dB of another one is useless as a probe (the peak would not tell them apart):
// the run is then INVALID (exit 3), not green.
// Return: 0 no wrong export, 1 at least one wrong export, 2 usage, 3 invalid probe (references too close or an export failed).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';

const { values: opt } = parseArgs({ options: { url: { type: 'string' }, wartezeit: { type: 'string' }, runden: { type: 'string' }, ziel: { type: 'string' }, ausgabe: { type: 'string' } } });
const usage = (t) => { process.stderr.write(`n8_export_nach_regler: ${t}\nusage: --url <http://127.0.0.1:port> [--wartezeit ms=0] [--runden n=3] [--ziel gruppe|spur|beide] [--ausgabe folder]\n`); process.exit(2); };
if (!opt.url) usage('--url is required');
if (/:(47300|47100|47200)\b/.test(opt.url)) usage('never against the operation (47300)');
const port = Number(new globalThis.URL(opt.url).port);
const k = (port - 47300) / 1000;
const instanz = Number.isInteger(k) && k >= 1 && k <= 9 ? String.fromCharCode(96 + k) : '?';
if (!/^[bde]$/.test(instanz)) usage(`instance ${instanz} (port ${port}) is not allowed: b, d or e only`);
const WARTE = Number(opt.wartezeit ?? 0), RUNDEN = Number(opt.runden ?? 3), ZIEL = opt.ziel ?? 'beide';
if (!(WARTE >= 0) || !(RUNDEN >= 1) || !['gruppe', 'spur', 'beide'].includes(ZIEL)) usage('invalid --wartezeit, --runden or --ziel');
const AUSGABE = opt.ausgabe ? path.resolve(opt.ausgabe.replace(/^~(?=\/|$)/, os.homedir())) : null;
if (AUSGABE) fs.mkdirSync(AUSGABE, { recursive: true });

const CYPHER = { 'x-djk-quelle': 'cypher' };
const ruf = async (m, p, body, h = {}) => {
  const r = await fetch(opt.url + p, { method: m, headers: { 'content-type': 'application/json', ...h }, body: m === 'GET' ? undefined : JSON.stringify(body ?? {}) });
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = t; }
  return { code: r.status, j };
};
const rev = async () => (await ruf('GET', '/proj/aktuell?nur=rev')).j.rev;
const aendern = async (label, befehle) => {
  const r = await ruf('POST', '/proj/aendern', { rev: await rev(), label, befehle }, CYPHER);
  if (r.code !== 200) throw new Error(`${label}: ${r.code} ${JSON.stringify(r.j)}`);
  return r.j;
};
const exportiere = async () => {
  const t0 = Date.now();
  const r = await ruf('POST', '/proj/export', { von_beat: 0, bis_beat: 8 }, CYPHER);
  if (r.code !== 200) throw new Error(`export: ${r.code} ${JSON.stringify(r.j)}`);
  return { spitze: r.j.spitze_db, quelle: r.j.regler_quelle, ms: Date.now() - t0 };
};
const warte = (ms) => new Promise((res) => setTimeout(res, ms));

const noten = (ton) => Array.from({ length: 8 }, (_, i) => ({ beat: i, laenge: 0.5, ton, vel: 110 }));
const slug = `n8-${Date.now()}`;
const neu = await ruf('POST', '/proj/neu', { name: slug }, CYPHER);
if (neu.code !== 200) { process.stderr.write(`/proj/neu: ${neu.code} ${JSON.stringify(neu.j)}\n`); process.exit(3); }
const zeilen = [];
const ausg = (t) => { zeilen.push(t); process.stdout.write(`${t}\n`); };
let rc = 0;
try {
  const b = [{ befehl: 'tempo_setzen', bpm: 128 }];
  for (let n = 1; n <= 3; n++) b.push({ befehl: 'spur_neu', art: 'instrument', name: `R${n}` });
  [36, 43, 48].forEach((t, i) => b.push({ befehl: 'clip_neu', spur_id: `s${i + 1}`, art: 'midi', start_beat: 0, laenge_beats: 8, noten: noten(t) }));
  b.push({ befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: 8 });
  await aendern('build', b);
  await aendern('group', [{ befehl: 'gruppenspur_neu' }]);
  await aendern('routing', [{ befehl: 'ziel_setzen', strang_id: 's2', ausgang: { art: 'gruppe', id: 'g1' } }, { befehl: 'ziel_setzen', strang_id: 's3', ausgang: { art: 'gruppe', id: 'g1' } },
    { befehl: 'spur_aendern', spur_id: 's1', mute: true }]);

  const faelle = [];   // {name, setze(db) -> befehle}
  if (ZIEL !== 'spur') faelle.push({ name: 'gruppe', werte: [-6.0206, -3, -9, 0, -12], setze: (db) => [{ befehl: 'gruppenspur_aendern', gruppe_id: 'g1', fader_db: db }] });
  if (ZIEL !== 'gruppe') faelle.push({ name: 'spur', werte: [-6.0206, -3, -9, 0, -12], setze: (db) => [{ befehl: 'spur_aendern', spur_id: 's3', fader_db: db }] });

  const falsch = [], alle = [];
  for (const f of faelle) {
    // settled references, one per value (the change, 1500 ms, one export)
    const ref = new Map();
    for (const db of f.werte) {
      await aendern(`ref ${f.name} ${db}`, f.setze(db));
      await warte(1500);
      const e = await exportiere();
      ref.set(db, e.spitze);
      ausg(`ref ${f.name} fader ${db}: ${e.spitze} dBFS (source ${e.quelle})`);
      if (e.quelle !== 'kern') throw Object.assign(new Error(`regler_quelle is ${e.quelle}, not kern: the probe would not read the core state`), { ungueltig: true });
    }
    const r = [...ref.values()];
    for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) {
      if (Math.abs(r[i] - r[j]) < 0.05) throw Object.assign(new Error(`${f.name}: two references within 0.05 dB (${r[i]}, ${r[j]}): the peak cannot tell the values apart`), { ungueltig: true });
    }
    for (let runde = 1; runde <= RUNDEN; runde++) {
      // a different order per round, so the previous value is not always the same
      const folge = [...f.werte].sort((a, c) => ((a * 7 + runde * 13) % 11) - ((c * 7 + runde * 13) % 11));
      for (const db of folge) {
        await aendern(`${f.name} ${db} r${runde}`, f.setze(db));
        await warte(WARTE);
        const e = await exportiere();
        const abw = e.spitze - ref.get(db);
        const ist = Math.abs(abw) > 0.01;
        alle.push({ fall: f.name, runde, fader: db, spitze: e.spitze, ref: ref.get(db), abweichung: abw, falsch: ist, export_ms: e.ms });
        if (ist) falsch.push(alle.at(-1));
        ausg(`${ist ? 'WRONG' : 'ok   '} ${f.name} r${runde} fader ${db} wait ${WARTE} ms: peak ${e.spitze} (reference ${ref.get(db)}, diff ${abw.toFixed(3)} dB, export ${e.ms} ms)`);
      }
    }
  }
  ausg(`RESULT wait ${WARTE} ms: ${falsch.length} of ${alle.length} exports wrong`);
  if (AUSGABE) fs.writeFileSync(path.join(AUSGABE, `n8-wait${WARTE}-${Date.now()}.json`), JSON.stringify({ wartezeit: WARTE, runden: RUNDEN, ziel: ZIEL, falsch: falsch.length, gesamt: alle.length, alle }, null, 1));
  rc = falsch.length ? 1 : 0;
} catch (e) {
  process.stderr.write(`n8_export_nach_regler: ${e.ungueltig ? 'INVALID PROBE: ' : 'ERROR: '}${e.message}\n`);
  rc = 3;
} finally {
  // only the own project (slug n8-...) is removed; the instance keeps nothing of it
  const dirs = [];
  try {
    const a = await ruf('GET', '/proj/aktuell');
    if (a.code === 200 && a.j && typeof a.j.slug === 'string' && a.j.slug.startsWith('n8-')) dirs.push(a.j.slug);
  } catch { /* instance gone: nothing to clean */ }
  for (const d of dirs) {
    const p = path.join('/dev/shm', `cypherdj-${instanz}`, 'projekte', d);
    if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
  }
}
process.exit(rc);
