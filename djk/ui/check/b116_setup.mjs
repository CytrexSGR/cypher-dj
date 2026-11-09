// Package 1.16 rest U3b (T3b.3), set-up for pruef/abnahme_b116.mjs. Two modes:
//   node check/b116_setup.mjs --ziel /dev/shm/b116-ziel --katalog-nur
//       writes an empty katalog.sqlite into --ziel (djk-start needs CYPHERDJ_KATALOG before the instance exists; the acceptance needs no audio file)
//   node check/b116_setup.mjs --ziel /dev/shm/b116-ziel --instanz e
//       builds the project THROUGH THE API of the running test instance (b, d or e only; port 47300 + 1000 * k):
//         one rb338 track "RB" with a one-bar MIDI clip of sixteenth notes at C2 (ton 36, 16 notes, 0.2 beat long),
//         one audio track "Bus" with a komp stage made by insert_setzen whose values differ from the factory preset drum-bus in EVERY mapped row
//         (schwelle -40, ratio 2, knie 0, attack 50, release 500, makeup 12, mix 0.5, schp 200; all inside the INSERT_ARTEN.komp ranges).
//       Writes <ziel>/aufbau.json and prints it as one JSON line.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { baueKatalog } from '../tests/support/catalog.mjs';

const { values: opt } = parseArgs({ options: { ziel: { type: 'string' }, instanz: { type: 'string' }, 'katalog-nur': { type: 'boolean' } } });
const aus = (t, rc) => { process.stderr.write(`b116_aufbau: ${t}\n`); process.exit(rc); };
if (!opt.ziel) aus('usage: --ziel <folder> (--katalog-nur | --instanz b|d|e)', 2);
fs.mkdirSync(opt.ziel, { recursive: true });
if (opt['katalog-nur']) {
  const datei = path.join(opt.ziel, 'katalog.sqlite');
  if (!fs.existsSync(datei)) baueKatalog(opt.ziel, []);
  process.stdout.write(`${JSON.stringify({ katalog: datei })}\n`);
  process.exit(0);
}
if (!/^[bde]$/.test(opt.instanz ?? '')) aus(`instance '${opt.instanz}' is not allowed: b, d or e only (never f, never the operation)`, 2);
const URL = `http://127.0.0.1:${47300 + 1000 * (opt.instanz.charCodeAt(0) - 96)}`;
const CYPHER = { 'x-djk-quelle': 'cypher' };
const ruf = async (methode, weg, koerper, kopf = {}) => {
  const r = await fetch(URL + weg, methode === 'GET' ? { headers: kopf } : { method: 'POST', headers: { 'content-type': 'application/json', ...kopf }, body: JSON.stringify(koerper ?? {}) });
  const t = await r.text();
  let j = null; try { j = t ? JSON.parse(t) : null; } catch { j = { text: t }; }
  if (r.status !== 200) throw new Error(`${methode} ${weg} -> ${r.status} ${JSON.stringify(j).slice(0, 300)}`);
  return j;
};
const warte = (ms) => new Promise((ok) => setTimeout(ok, ms));
const aendern = async (label, befehle) => ruf('POST', '/proj/aendern', { rev: (await ruf('GET', '/proj/aktuell?nur=rev')).rev, label, befehle }, CYPHER);

const zwei = (n) => String(n).padStart(2, '0'), d0 = new Date();
const zeit = `${d0.getFullYear()}${zwei(d0.getMonth() + 1)}${zwei(d0.getDate())}t${zwei(d0.getHours())}${zwei(d0.getMinutes())}${zwei(d0.getSeconds())}`;
await ruf('POST', '/proj/transport', { aktion: 'stopp' }, CYPHER).catch(() => null);
const neu = await ruf('POST', '/proj/neu', { name: `b116-aufbau-${zeit}` });
const slug = neu.slug ?? neu.projekt?.slug;
if (!slug) throw new Error(`/proj/neu without slug: ${JSON.stringify(neu).slice(0, 200)}`);
await warte(1500);
const BPM = 120;
await aendern('b116 tempo', [{ befehl: 'tempo_setzen', bpm: BPM }]);
await aendern('b116 tracks', [
  { befehl: 'spur_neu', art: 'instrument', name: 'RB', geraet: { art: 'intern', name: 'rb338', parameter: {} } },
  { befehl: 'spur_neu', art: 'audio', name: 'Bus' }]);
const p0 = (await ruf('GET', '/proj/aktuell')).projekt;
const rb = p0.spuren.find((s) => s.name === 'RB'), bus = p0.spuren.find((s) => s.name === 'Bus');
if (!rb || !bus) throw new Error('tracks RB and Bus not found after spur_neu');
const NOTEN = Array.from({ length: 16 }, (_, i) => ({ beat: i * 0.25, laenge: 0.2, ton: 36, vel: 100 }));
const WERTE = { schwelle: -40, ratio: 2, knie: 0, attack: 50, release: 500, makeup: 12, mix: 0.5, schp: 200 };
await aendern('b116 clip and stage', [
  { befehl: 'clip_neu', spur_id: rb.id, art: 'midi', start_beat: 0, laenge_beats: 4, noten: NOTEN },
  { befehl: 'insert_setzen', strang_id: bus.id, pos: 0, art: 'komp', werte: WERTE }]);
const p = (await ruf('GET', '/proj/aktuell')).projekt;
const insert = p.spuren.find((s) => s.id === bus.id).inserts?.[0];
if (!insert) throw new Error('the komp stage is missing after insert_setzen');
const aufbau = { url: URL, instanz: opt.instanz, slug, bpm: BPM, rb_spur_id: rb.id, bus_spur_id: bus.id, insert_id: insert.id, insert_slot: insert.slot,
  insert_werte: insert.werte, noten: NOTEN.length, laenge_beats: 4, rev: p.rev };
fs.writeFileSync(path.join(opt.ziel, 'aufbau.json'), JSON.stringify(aufbau));
process.stdout.write(`${JSON.stringify(aufbau)}\n`);
