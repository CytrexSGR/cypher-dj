// Automation slice 2, listening project for Andreas (not part of the acceptance verdict): "A2 Hörprobe automation", 124 BPM, three parts of 16 beats one after the other.
//   1  beats  0..16  a steady synth chord loop (core library, 122 bpm warped to 124) with a pan lane from -1 (left) to 1 (right)
//   2  beats 16..32  a drum loop (core library, Tech House 123 bpm warped to 124) with a mute lane: every second eighth note (the off-beat eighth) is muted
//   3  beats 32..48  an RB-338 track with a 16th-note acid pattern in C minor and a geraet.cutoff lane from closed to open
// The material comes from the stock of the media library (shas of the catalog), nothing is downloaded. The script talks to a TEST INSTANCE whose catalog contains these shas
// (djk-start with CYPHERDJ_KATALOG=<copy of mediathek/katalog.sqlite>), creates the project through the Cypher path and measures the loudness of every part (proj_lautheit).
// Usage: node check/a2_listening_project.mjs --url http://127.0.0.1:52300 [--ausgabe <folder>]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parseArgs } from 'node:util';

const { values: opt } = parseArgs({ options: { url: { type: 'string' }, ausgabe: { type: 'string' }, 'pad-db': { type: 'string' }, 'drums-db': { type: 'string' }, 'acid-db': { type: 'string' }, 'acid-laut': { type: 'string' } } });
if (!opt.url || /:(47300|48300|50300|51300)\b/.test(opt.url)) { process.stderr.write('usage: --url <test instance e>; the operation and instances a, c, d are not allowed\n'); process.exit(2); }
const URL = opt.url, CYPHER = { 'x-djk-quelle': 'cypher' };
const ruf = async (m, w, k) => {
  const r = await fetch(URL + w, m === 'GET' ? { headers: CYPHER } : { method: 'POST', headers: { 'content-type': 'application/json', ...CYPHER }, body: JSON.stringify(k ?? {}) });
  const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch { j = { text: t }; }
  return { code: r.status, j };
};
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (w, r) => { if (r.code !== 200) throw new Error(`${w} → ${r.code} ${JSON.stringify(r.j).slice(0, 300)}`); return r.j; };
const aendern = async (label, befehle) => ok(`aendern ${label}`, await ruf('POST', '/proj/aendern', { rev: ok('rev', await ruf('GET', '/proj/aktuell?nur=rev')).rev, label, befehle }));

const PAD = { sha: '955b2da1be69713b3a18cd0b1dd88d442eecb3cca9aa38037995078e43064f6b', sek: 7.868844, hinweis: path.join(os.homedir(), '.wine-ableton/drive_c/ProgramData/Ableton/Live 12 Standard/Resources/Core Library/Samples/Loops/Tonal/Synth/Synth Chords Cmin11 122 bpm.wav'), beats: 16 };
const DRUMS = { sha: 'b49e8c0ae074eea25b74da1eb86f1a82e6bfd94069f9e12f529298815637e170', sek: 15.609751, hinweis: path.join(os.homedir(), '.wine-ableton/drive_c/ProgramData/Ableton/Live 12 Standard/Resources/Core Library/Samples/Loops/Drums/Full/Tech House 123 bpm.aif'), beats: 32 };
const warp = (q) => ({ an: true, detune_ct: 0, marker: [[0, 0], [q.sek, q.beats]], modus: 'repitch', quelle: 'takte', transpose_st: 0, versatz_beats: 0 });

// acid pattern: 16 sixteenth steps per bar, C minor, accents on the vel; four bars per 16 beats are the same figure with a small turn in the last bar
const FIGUR = [[36, 100], [36, 70], [48, 120], [36, 70], [39, 100], [36, 70], [51, 120], [36, 70], [43, 100], [36, 70], [48, 120], [41, 100], [36, 100], [39, 70], [36, 70], [46, 120]];
const noten = [];
for (let takt = 0; takt < 4; takt++) FIGUR.forEach(([ton, vel], i) => noten.push({ beat: takt * 4 + i * 0.25, laenge: 0.2, ton: takt === 3 && i === 13 ? 43 : ton, vel }));

const name = 'A2 Hörprobe automation';
const neu = ok('proj_neu', await ruf('POST', '/proj/neu', { name }));
const slug = neu.slug ?? neu.projekt?.slug;
console.log('slug', slug);
await aendern('tempo', [{ befehl: 'tempo_setzen', bpm: 124 }]);
await aendern('tracks', [
  { befehl: 'spur_neu', art: 'audio', name: 'Pad (pan sweep)' },
  { befehl: 'spur_neu', art: 'audio', name: 'Drums (mute pattern)' },
  { befehl: 'spur_neu', art: 'instrument', name: 'RB-338 acid (cutoff sweep)', geraet: { art: 'intern', name: 'rb338', parameter: { lautstaerke: Number(opt['acid-laut'] ?? 0.9), cutoff: 0.28, resonanz: 0.6, env_mod: 0.5, decay: 0.35, accent: 0.6 } } },
]);
let p = ok('aktuell', await ruf('GET', '/proj/aktuell')).projekt;
const [pad, drums, acid] = p.spuren.map((s) => s.id);
await aendern('clips', [
  { befehl: 'spur_aendern', spur_id: pad, fader_db: Number(opt['pad-db'] ?? 0) },
  { befehl: 'spur_aendern', spur_id: drums, fader_db: Number(opt['drums-db'] ?? 0) },
  { befehl: 'spur_aendern', spur_id: acid, fader_db: Number(opt['acid-db'] ?? 0) },
  { befehl: 'clip_neu', spur_id: pad, art: 'audio', start_beat: 0, laenge_beats: 16, sha256: PAD.sha, pfad_hinweis: PAD.hinweis, name: 'Synth Chords Cmin11', warp: warp(PAD) },
  { befehl: 'clip_neu', spur_id: drums, art: 'audio', start_beat: 16, laenge_beats: 16, sha256: DRUMS.sha, pfad_hinweis: DRUMS.hinweis, name: 'Tech House 123', warp: warp(DRUMS) },
  { befehl: 'clip_neu', spur_id: acid, art: 'midi', start_beat: 32, laenge_beats: 16, name: 'Acid C minor', noten },
]);
// lanes (project beats)
await aendern('lanes new', [
  { befehl: 'auto_neu', spur_id: pad, ziel: 'pan' },
  { befehl: 'auto_neu', spur_id: drums, ziel: 'mute' },
  { befehl: 'auto_neu', spur_id: acid, ziel: 'geraet.cutoff' },
]);
p = ok('aktuell', await ruf('GET', '/proj/aktuell')).projekt;
const lane = (id, ziel) => p.spuren.find((s) => s.id === id).automation.find((l) => l.ziel === ziel).id;
const mute = [{ beat: 16, wert: 0 }];
for (let b = 16; b < 32; b++) mute.push({ beat: b + 0.5, wert: 1 }, { beat: b + 1, wert: 0 });
await aendern('lanes points', [
  { befehl: 'auto_punkte', lane_id: lane(pad, 'pan'), loesche_von: 0, loesche_bis: 100000, setze: [{ beat: 0, wert: -1 }, { beat: 16, wert: 1 }] },
  { befehl: 'auto_punkte', lane_id: lane(drums, 'mute'), loesche_von: 0, loesche_bis: 100000, setze: mute },
  { befehl: 'auto_punkte', lane_id: lane(acid, 'geraet.cutoff'), loesche_von: 0, loesche_bis: 100000, setze: [{ beat: 32, wert: 0.28 }, { beat: 48, wert: 0.92 }] },
]);
// wait until the playback is loaded and decoded
for (let t = 0; t < 60000; t += 250) {
  const a = ok('aktuell', await ruf('GET', '/proj/aktuell'));
  const dek = a.projekt.spuren.flatMap((s) => s.clips).map((c) => c.dekodiert);
  if (dek.every((d) => d === 'fertig' || d == null) && a.kern?.rev_geladen === a.projekt.wiedergabe_rev && a.kern?.status === 0) break;
  if (t >= 59750) throw new Error(`not loaded: ${JSON.stringify(dek)}`);
  await warte(250);
}
// loudness of every part (offline, the whole mix of the range)
const ergebnis = {};
for (const [teil, von, bis] of [['1 pan sweep', 0, 16], ['2 mute pattern', 16, 32], ['3 cutoff sweep', 32, 48]]) {
  const r = ok(`lautheit ${teil}`, await ruf('POST', '/proj/lautheit', { von_beat: von, bis_beat: bis }));
  ergebnis[teil] = { lufs_i: r.summe.lufs_i, true_peak_dbtp: r.summe.true_peak_dbtp, spitze_db: r.summe.spitze_db };
  console.log(teil, JSON.stringify(ergebnis[teil]));
}
const dest = opt.ausgabe ? path.resolve(opt.ausgabe.replace(/^~(?=\/|$)/, os.homedir())) : null;
if (dest) { fs.mkdirSync(dest, { recursive: true }); fs.writeFileSync(path.join(dest, 'lautheit.json'), JSON.stringify({ slug, ergebnis }, null, 1)); }
console.log(JSON.stringify({ slug, ordner: `/dev/shm/cypherdj-e/projekte/${slug}` }));
