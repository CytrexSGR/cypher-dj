// Diagnosis of the Z2 deviation (loop seam, lane step from -30 dB to 0 dB): which stage after the fader changes the first 10 ms after the wrap?
//   node check/a1_z2diag.mjs --url http://127.0.0.1:52300 --aufbau <aufbau.json> --bau <core build folder> --instanz e --ausgabe <folder> --etikett <text>
// For two sources (amplitude 0.3 and 0.03) it records the master ring over the loop wrap, once without a lane (control) and once with the lane 0 -> -30 dB over 0..16
// (loop 0..16), and prints the level in the 10 ms before, the 10 ms after and the following 10 ms (relative to the unattenuated reference of that source), plus the
// largest reduction of the master limiter seen in /zustand/arr (limiter_db) during the run. The instance decides the variant (limiter ceiling, hold of the core binary).
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { starte, Fehl } from './w3a_target.mjs';
import { amplitudeDb, amplitude, einsatzRel as einsatz, beatSample } from './a1_measure.mjs';

const z = starte('a1_z2diag', 'a1d', { bau: { type: 'string' }, etikett: { type: 'string' } });
const { AUFBAU: A, CYPHER, notiere, info, aendern, instanz } = z;
const BAU = path.resolve(z.opt.bau), SCHLAG = 24000, warte = z.warte;
const db = (x) => x.toFixed(3);
const prog = (programm, args) => new Promise((res) => {
  const p = spawn(programm, args, { env: { ...process.env, CYPHERDJ_INSTANZ: instanz } });
  let out = '', err = '';
  p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { err += d; });
  p.on('close', (rc) => res({ rc, out, err }));
});
function strom() {
  const ac = new AbortController(), m = [];
  const f = (async () => {
    try {
      const r = await fetch(z.URL + '/strom', { signal: ac.signal }), dec = new globalThis.TextDecoder();
      let puf = '';
      for await (const s of r.body) {
        puf += dec.decode(s, { stream: true });
        let i;
        while ((i = puf.indexOf('\n\n')) >= 0) { const b = puf.slice(0, i); puf = puf.slice(i + 2); if (b.startsWith('data: ')) try { m.push(JSON.parse(b.slice(6))); } catch { /* half */ } }
      }
    } catch { /* aborted */ }
  })();
  return { m, stop: async () => { ac.abort(); await f; } };
}
const transport = async (aktion) => z.erwarte200('transport', await z.ruf('POST', '/proj/transport', aktion === 'start' ? { aktion, beat: 0 } : { aktion }, CYPHER));
async function nimm(name) {
  const dir = path.join(z.ORDNER, 'roh'); fs.mkdirSync(dir, { recursive: true });
  const datei = path.join(dir, `${name}.f32`), s = strom();
  const mit = prog(path.join(BAU, 'cypherdj-mitschnitt'), ['--sekunden', '17', '--aus', datei]);
  await warte(500);
  await transport('start');
  const r = await mit;
  await transport('stopp'); await warte(300); await s.stop();
  if (r.rc !== 0) throw new Fehl(`mitschnitt rc ${r.rc} ${r.err}`);
  const b = fs.readFileSync(datei), st = new Float32Array(b.buffer, b.byteOffset, b.length >> 2), l = new Float32Array(st.length >> 1);
  for (let i = 0; i < l.length; i++) l[i] = st[2 * i];
  fs.rmSync(datei);   // 6.5 MB each; the numbers are kept
  const lim = s.m.filter((x) => x.a === '/zustand/arr' && typeof x.f?.limiter_db === 'number').map((x) => x.f.limiter_db);
  return { l, limiterMin: lim.length ? Math.min(...lim) : null, n: lim.length };
}
const fenster = (l, ref) => {
  const e = einsatz(l), w = e + beatSample(16, SCHLAG);
  return { vor: amplitudeDb(l, w - 240, 480, ref), nach: amplitudeDb(l, w + 240, 480, ref), nach2: amplitudeDb(l, w + 720, 480, ref) };
};
const roh = {};
async function satz(etikett, sha) {
  await z.neuesProjekt(etikett);
  await aendern('diag tempo and track', [{ befehl: 'tempo_setzen', bpm: 120 }, { befehl: 'spur_neu', art: 'audio', name: 'D' }], CYPHER);
  const spur = (await z.aktuell()).projekt.spuren[0].id;
  await aendern('diag clip', [{ befehl: 'clip_neu', spur_id: spur, art: 'audio', start_beat: 0, laenge_beats: 64, sha256: sha }, { befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: 16 }], CYPHER);
  await z.geladen(); await warte(3000);
  const k = await nimm(`${etikett}-kontrolle`);
  const ref = amplitude(k.l, einsatz(k.l) + beatSample(4, SCHLAG), 1200);
  const fk = fenster(k.l, ref);
  await aendern('diag lane', [{ befehl: 'auto_neu', spur_id: spur, ziel: 'fader' }], CYPHER);
  const lane = (await z.aktuell()).projekt.spuren[0].automation[0].id;
  await aendern('diag points', [{ befehl: 'auto_punkte', lane_id: lane, loesche_von: 0, loesche_bis: 100000, setze: [{ beat: 0, wert: 0 }, { beat: 16, wert: -30 }] }], CYPHER);
  await z.geladen(); await warte(1200);
  const n = await nimm(`${etikett}-lane`);
  const fl = fenster(n.l, ref);
  roh[etikett] = { ref, kontrolle: fk, lane: fl, differenz_nach: fl.nach - fk.nach, limiter_min_kontrolle: k.limiterMin, limiter_min_lane: n.limiterMin, limiter_meldungen: [k.n, n.n] };
  info(`${z.opt.etikett} | ${etikett}: reference ${ref.toFixed(5)}; control before ${db(fk.vor)}, after ${db(fk.nach)}, next ${db(fk.nach2)}; lane before ${db(fl.vor)}, after ${db(fl.nach)}, next ${db(fl.nach2)}; `
    + `lane minus control after the wrap ${db(fl.nach - fk.nach)} dB; limiter reduction min control ${k.limiterMin}, lane ${n.limiterMin} dB (${k.n} + ${n.n} reports)`);
}
(async () => {
  await z.ruf('POST', '/proj/transport', { aktion: 'stopp' }).catch(() => null);
  await warte(1500);
  await satz('laut', A.sha);
  await satz('leise', A.sha_leise);
  fs.writeFileSync(path.join(z.ORDNER, 'rohdaten.json'), JSON.stringify({ etikett: z.opt.etikett, ...roh }, null, 1));
  await z.ende(`Z2 diagnosis ${z.opt.etikett}`, /^a1d-/);
})().catch(async (e) => { notiere('diag', false, e instanceof Fehl ? e.message : e.stack); await z.ende('Z2 diagnosis', /^a1d-/); });
