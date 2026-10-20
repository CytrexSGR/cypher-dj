// D1 S3, Auftrag 14 c: die Projekt-Attrappe der Seite (pruef/proj_attrappe.mjs, nach dem S3-Plan gebaut) gegen den echten S3-Ablauf
// (bereiche/proj/ausgabe.ts über tests/hilfen/ausgabe_aufbau.mjs, echte S2-Integration, Render-Doppel, echtes ffmpeg). Dieselben Fälle auf
// demselben Projekt (Kick ohne Clip, Bass RB-338, Lead Surge mit einer Note ab Beat 8, Loop 0..16, 120 BPM) an beide; verglichen werden
// HTTP-Code, Grund, die Felder der Antwort (Freeze-Feld, Export-Felder datei, frames, spitze_db, regler_quelle, lufs_i, lra, true_peak_dbtp,
// loudness_fehler) und der text, wo die Seite ihn zeigt (beschaeftigt, zu_gross: ausgabe.js mehrdeutigText). Kein Kern, kein Ton, Ports frei (0).
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { starteProjAttrappe } from '../pruef/proj_attrappe.mjs';
import { aufbau } from './hilfen/ausgabe_aufbau.mjs';
import { warteBis } from './hilfen/proj_kontext.mjs';
import { alsAntwort } from '../bereiche/proj/ausgabe.ts';

async function oben() {
  const srv = http.createServer((q, a) => { a.writeHead(200, { 'content-type': 'text/plain' }); a.end('oben'); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${srv.address().port}/`, stoppe: () => new Promise((r) => { srv.closeAllConnections(); srv.close(r); }) };
}
const BEFEHLE = [
  { befehl: 'tempo_setzen', bpm: 120 },
  { befehl: 'spur_neu', art: 'audio', name: 'Kick' },
  { befehl: 'spur_neu', art: 'instrument', name: 'Bass', geraet: { art: 'intern' } },
  { befehl: 'spur_neu', art: 'instrument', name: 'Lead', geraet: { art: 'wirt' } },
  { befehl: 'clip_neu', spur_id: 's2', art: 'midi', start_beat: 0, laenge_beats: 16, noten: [{ beat: 0, laenge: 0.5, ton: 36, vel: 100 }] },
  { befehl: 'clip_neu', spur_id: 's3', art: 'midi', start_beat: 8, laenge_beats: 8, noten: [{ beat: 0, laenge: 1, ton: 60, vel: 90 }] },
  { befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: 16 },
];

// Seite A: der echte Ablauf (ohne Netz); ruf → {code, j}
async function server(t) {
  const a = await aufbau(t, { mitKick: false, kern: { art: 'ok', ms: 200 } });
  const ruf = async (f) => { try { return { code: 200, j: await f() }; } catch (e) { const x = alsAntwort(e); return { code: x.code, j: x.body }; } };
  return {
    name: 'server',
    freeze: (d) => ruf(() => a.ausgabe.freeze(d)),
    exportiere: (d) => ruf(() => a.ausgabe.exportiere(d)),
    aendern: async (befehle) => { await a.aendern(befehle); await warteBis(() => a.zustand.kernNr === a.projekt().wiedergabe_rev && !a.s.ladenGesperrt()); },
    projekt: () => a.projekt(),
    ohneFfmpeg: () => { a.optionen.ffmpeg = ['/gibt/es/nicht/ffmpeg']; },
  };
}
// Seite B: die Attrappe der Seite über HTTP
async function attrappe(t) {
  const o = await oben(), at = await starteProjAttrappe({ oben: o.url, freezeMs: 300, renderMs: 50 });
  t.after(async () => { await at.stoppe(); await o.stoppe(); });
  const post = async (weg, d) => { const r = await fetch(at.url + weg.slice(1), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(d) }); return { code: r.status, j: await r.json() }; };
  const projekt = async () => (await (await fetch(at.url + 'proj/aktuell')).json()).projekt;
  await post('/proj/neu', { name: 'Erster Track' });
  const r = await post('/proj/aendern', { rev: (await projekt()).rev, label: 'Aufbau', befehle: BEFEHLE });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  return {
    name: 'attrappe',
    freeze: (d) => post('/proj/freeze', d),
    exportiere: (d) => post('/proj/export', d),
    aendern: async (befehle) => { const x = await post('/proj/aendern', { rev: (await projekt()).rev, label: 'Fall', befehle }); assert.equal(x.code, 200, JSON.stringify(x.j)); },
    projekt,
    ohneFfmpeg: () => post('/attrappe/ausgabe', { lufs_i: null, lra: null, true_peak_dbtp: null, loudness_fehler: 'ffmpeg_fehlt: /gibt/es/nicht/ffmpeg' }),
  };
}

const MEHRDEUTIG = new Set(['beschaeftigt', 'zu_gross']);   // ausgabe.js zeigt hier den text des Servers
// text: wo die Seite ihn zeigt wörtlich, sonst nur, ob es ein englischer Satz ist (nicht der Grund selbst, Spec 6.34)
const form = (r) => (r.code === 200 ? [200, Object.keys(r.j).sort()]
  : [r.code, r.j.fehler, MEHRDEUTIG.has(r.j.fehler) ? r.j.text : (typeof r.j.text === 'string' && r.j.text !== r.j.fehler && /^[\x20-\x7e×–]+$/.test(r.j.text) ? 'satz' : `kein satz: ${r.j.text}`)]);

test('Attrappe der Seite gegen den S3-Ablauf: Codes, Gründe, Felder und Texte gleich (Auftrag 14 c)', async (t) => {
  const seiten = [await server(t), await attrappe(t)];
  const lead = async (s) => (await s.projekt()).spuren.find((x) => x.id === 's3');
  const nid = async (s) => (await lead(s)).clips[0].noten[0].id;
  const cid = async (s) => (await lead(s)).clips[0].id;
  const faelle = [], abweichungen = [];
  const vergleiche = (name, ist, soll) => { try { assert.deepEqual(ist, soll); } catch { abweichungen.push({ name, attrappe: ist, server: soll }); } };
  const fall = async (name, f) => {
    const [a, b] = [await f(seiten[0]), await f(seiten[1])];
    faelle.push({ name, server: a, attrappe: b });
    vergleiche(name, form(b), form(a));
    return [a, b];
  };
  await fall('freeze ohne an', (s) => s.freeze({ spur_id: 's3' }));
  await fall('freeze unbekannte Spur', (s) => s.freeze({ spur_id: 's9', an: true }));
  await fall('freeze RB-338', (s) => s.freeze({ spur_id: 's2', an: true }));
  await fall('freeze Feld zu viel', (s) => s.freeze({ spur_id: 's3', an: true, mehr: 1 }));
  await fall('unfreeze schon so', (s) => s.freeze({ spur_id: 's3', an: false }));
  await fall('export Feld unbekannt', (s) => s.exportiere({ von: 0 }));
  await fall('export Zahl als Text', (s) => s.exportiere({ von_beat: '0' }));
  await fall('export unter 1 Beat', (s) => s.exportiere({ von_beat: 4, bis_beat: 4.5 }));
  await fall('export über 1024 Beats', (s) => s.exportiere({ von_beat: 0, bis_beat: 1025 }));
  await fall('export vor Beat 0', (s) => s.exportiere({ von_beat: -1, bis_beat: 4 }));
  // Spec 6.17: Noten nur hinter loop_beats klingen nicht
  for (const s of seiten) await s.aendern([{ befehl: 'clip_aendern', clip_id: await cid(s), loop_beats: 0.5 }, { befehl: 'noten_aendern', clip_id: await cid(s), noten: [{ id: await nid(s), beat: 1 }] }]);
  await fall('freeze Loop-Clip, Noten nur hinter loop_beats', (s) => s.freeze({ spur_id: 's3', an: true }));
  for (const s of seiten) await s.aendern([{ befehl: 'clip_aendern', clip_id: await cid(s), loop_beats: null }, { befehl: 'noten_aendern', clip_id: await cid(s), noten: [{ id: await nid(s), beat: 0 }] }, { befehl: 'clip_aendern', clip_id: await cid(s), laenge_beats: 300 }]);
  await fall('freeze über 256 Beats', (s) => s.freeze({ spur_id: 's3', an: true }));
  for (const s of seiten) await s.aendern([{ befehl: 'clip_aendern', clip_id: await cid(s), laenge_beats: 8 }]);
  // ein Lauf zur Zeit: während des Freeze antworten Export und Freeze 409 beschaeftigt mit demselben text
  const laeufe = seiten.map((s) => s.freeze({ spur_id: 's3', an: true }));
  await new Promise((r) => setTimeout(r, 80));
  await fall('export während Freeze', (s) => s.exportiere({}));
  await fall('freeze während Freeze', (s) => s.freeze({ spur_id: 's3', an: true }));
  const [fs, fa] = await Promise.all(laeufe);
  vergleiche('Freeze-Antwort', form(fa), form(fs));
  assert.equal(fs.code, 200, JSON.stringify(fs.j));
  const ffs = fs.j.projekt.spuren.find((x) => x.id === 's3').freeze, ffa = fa.j.projekt?.spuren.find((x) => x.id === 's3').freeze ?? {};
  vergleiche('Felder des Freeze', Object.keys(ffa).sort(), Object.keys(ffs).sort());
  // frames meldet der Kern (/e/freeze); das Kern-Doppel des Ablaufs nimmt 4800, die Attrappe rechnet wie K3: (8 Beats + 2 Nachlauf) bei 120 BPM
  vergleiche('von_beat, Dateiname', [ffa.von_beat, ffa.datei?.replace(/\d+\.f32$/, '')], [ffs.von_beat, ffs.datei.replace(/\d+\.f32$/, '')]);
  assert.equal(ffa.frames, (8 + 2) * 0.5 * 48000, 'Attrappe: frames wie K3');
  const [es, ea] = await fall('export nach Freeze', (s) => s.exportiere({}));
  vergleiche('export: Typen', ['frames', 'spitze_db', 'regler_quelle', 'lufs_i', 'lra', 'true_peak_dbtp'].map((k) => typeof ea.j[k]),
    ['frames', 'spitze_db', 'regler_quelle', 'lufs_i', 'lra', 'true_peak_dbtp'].map((k) => typeof es.j[k]));
  vergleiche('export: frames, regler_quelle', [ea.j.frames, ea.j.regler_quelle], [es.j.frames, es.j.regler_quelle]);
  const name = /\/export\/erster-track-\d{8}-\d{6}(-\d+)?\.wav$/;
  vergleiche('export: Dateiname', [name.test(ea.j.datei), name.test(es.j.datei)], [true, true]);
  for (const s of seiten) await s.ohneFfmpeg();
  const [ls, la] = await fall('export, Lautheit gescheitert', (s) => s.exportiere({ von_beat: 0, bis_beat: 4 }));
  vergleiche('export, Lautheit gescheitert: Felder', [la.j.lufs_i, la.j.lra, la.j.true_peak_dbtp, la.j.loudness_fehler], [ls.j.lufs_i, ls.j.lra, ls.j.true_peak_dbtp, ls.j.loudness_fehler]);
  t.diagnostic(JSON.stringify(faelle.map((f) => [f.name, form(f.server)])));
  assert.deepEqual(abweichungen, [], 'Attrappe sagt / Server hat');
});
