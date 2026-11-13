// Surge end to end of the MIDI import on the REAL core and the REAL Surge host of a TEST INSTANCE (e only; a, f, g, h, i are taboo, never the live studio).
// Setup as in acceptance_p1.mjs: material catalog first, then `djk-start --instanz e --arr1`; then
//   node check/acceptance_midi_surge.mjs [--url http://127.0.0.1:52300]
// A small SMF (one part, four notes) is imported with zuordnung surge, the project is exported (freeze through the Surge host, then offline render) and the WAV is
// measured: it must hold sound in every quarter of the notes. Control: the same SMF without an assignment previews on the RB-338, so the Surge result
// comes from the assignment (the device text of the import report is compared).
// Exit 0 OK, 1 FEHL, 2 call error.
import fs from 'node:fs';
import { smf, spur, nameMeta, tempoMeta, programm, note } from '../tests/helpers/smf_build.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const URL = arg('url', 'http://127.0.0.1:52300');
const post = async (p, body) => {
  const r = await fetch(URL + p, { method: 'POST', headers: { 'content-type': 'application/json', 'x-djk-quelle': 'cypher' }, body: JSON.stringify(body) });
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = t; }
  return { code: r.status, j };
};
const wav = (datei) => {
  const raw = fs.readFileSync(datei), i = raw.indexOf('data'), n = raw.readUInt32LE(i + 4);
  return new Float32Array(raw.buffer.slice(raw.byteOffset + i + 8, raw.byteOffset + i + 8 + n));
};
let fehl = 0;
const pruefe = (ok, text) => { console.log(`${ok ? 'OK  ' : 'FEHL'} ${text}`); if (!ok) fehl += 1; };

const datei = smf([
  spur([nameMeta('conductor'), tempoMeta(120)]),
  spur([nameMeta('Lead'), programm(0, 80), ...note(0, 60, 100, 96), ...note(0, 64, 100, 96), ...note(0, 67, 100, 96), ...note(0, 72, 100, 96)]),
]);
const b64 = Buffer.from(datei).toString('base64');
const neu = await post('/proj/neu', { name: 'gk-midi-surge' });
if (neu.code !== 200) { console.log('proj/neu', neu.code, JSON.stringify(neu.j).slice(0, 200)); process.exit(2); }

const kontrolle = await post('/proj/midi_import', { daten_b64: b64, name: 's.mid', vorschau: true });
pruefe(kontrolle.code === 200 && kontrolle.j.bericht.spuren[0].geraet_text === 'RB-338', `negative control: without zuordnung the part is on the RB-338 (${kontrolle.j.bericht?.spuren?.[0]?.geraet_text})`);

const imp = await post('/proj/midi_import', { daten_b64: b64, name: 's.mid', zuordnung: { '1.1': 'surge' } });
pruefe(imp.code === 200 && imp.j.bericht.spuren[0].geraet_text === 'Surge', `import with zuordnung surge: part on Surge (${imp.j.bericht?.spuren?.[0]?.geraet_text}, code ${imp.code})`);
const ex = await post('/proj/export', {});
pruefe(ex.code === 200, `export answers 200 (${ex.code} ${ex.code === 200 ? '' : JSON.stringify(ex.j).slice(0, 200)})`);
if (ex.code === 200) {
  const f = wav(ex.j.datei), viertel = Math.floor(f.length / 2 / 4);
  const spitzen = [0, 1, 2, 3].map((k) => { let m = 0; for (let i = k * viertel * 2; i < (k + 1) * viertel * 2; i++) m = Math.max(m, Math.abs(f[i])); return m; });
  pruefe(spitzen.every((s) => s > 0.01), `sound in all four quarters, peaks ${spitzen.map((s) => s.toFixed(3)).join(' ')} (limit 0.01)`);
}
console.log(fehl === 0 ? 'ALLES OK' : `${fehl} FEHL`);
process.exit(fehl === 0 ? 0 : 1);
