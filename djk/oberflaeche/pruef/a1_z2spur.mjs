// Gain trace over the loop wrap (Z2 diagnosis, step 2): control (no lane) and lane 0 -> -30 dB over 0..16 (loop 0..16) in 48-frame windows every 8 frames from wrap-960 to
// wrap+1440 (wrap = onset + 16 beats), the lane/control ratio over time, both onset frames, and a fit of the ideal lane (control recording times lin(Lane)) with a free shift of
// the wrap in samples: a shift by N samples, a blend, or something else?
//   node pruef/a1_z2spur.mjs --url http://127.0.0.1:52300 --aufbau <aufbau.json> --bau <core build folder> --instanz e --ausgabe <folder> --etikett <text>
// For two sources (amplitude 0.3 and 0.03) it records the master ring over the loop wrap, once without a lane (control) and once with the lane 0 -> -30 dB over 0..16
// (loop 0..16), and prints the level in the 10 ms before, the 10 ms after and the following 10 ms (relative to the unattenuated reference of that source), plus the
// largest reduction of the master limiter seen in /zustand/arr (limiter_db) during the run. The instance decides the variant (limiter ceiling, hold of the core binary).
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { starte, Fehl } from './w3a_ziel.mjs';
import { amplitude, einsatzRel as einsatz, beatSample, verstaerkungsSpur } from './a1_messen.mjs';

const z = starte('a1_z2spur', 'a1d', { bau: { type: 'string' }, etikett: { type: 'string' } });
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
const lanedb = (b) => -30 * b / 16;   // the lane 0 -> -30 dB over the beats 0..16
const roh = {};
async function satz(etikett, sha) {
  await z.neuesProjekt(etikett);
  await aendern('trace tempo and track', [{ befehl: 'tempo_setzen', bpm: 120 }, { befehl: 'spur_neu', art: 'audio', name: 'D' }], CYPHER);
  const spur = (await z.aktuell()).projekt.spuren[0].id;
  await aendern('trace clip', [{ befehl: 'clip_neu', spur_id: spur, art: 'audio', start_beat: 0, laenge_beats: 64, sha256: sha }, { befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: 16 }], CYPHER);
  await z.geladen(); await warte(3000);
  const k = await nimm(`${etikett}-kontrolle`);
  await aendern('trace lane', [{ befehl: 'auto_neu', spur_id: spur, ziel: 'fader' }], CYPHER);
  const lane = (await z.aktuell()).projekt.spuren[0].automation[0].id;
  await aendern('trace points', [{ befehl: 'auto_punkte', lane_id: lane, loesche_von: 0, loesche_bis: 100000, setze: [{ beat: 0, wert: 0 }, { beat: 16, wert: -30 }] }], CYPHER);
  await z.geladen(); await warte(1200);
  const n = await nimm(`${etikett}-lane`);
  const ref = amplitude(k.l, einsatz(k.l) + beatSample(4, SCHLAG), 1200);
  const ek = einsatz(k.l), en = einsatz(n.l), wk = ek + beatSample(16, SCHLAG), wn = en + beatSample(16, SCHLAG);
  const von = -960, bis = 1440;
  const sk = verstaerkungsSpur(k.l, wk + von, wk + bis, 8, 48, ref), sn = verstaerkungsSpur(n.l, wn + von, wn + bis, 8, 48, ref);
  // the ideal lane run: the control recording times lin(Lane) with the wrap at wk + d (the lane run is compared to the control by the onset frames)
  const ideal = (d) => {
    const x = new Float32Array(k.l.length);
    for (let i = 0; i < x.length; i++) {
      const rel = i - wk - d;
      const b = rel < 0 ? 16 + rel / SCHLAG : rel / SCHLAG;
      x[i] = k.l[i] * Math.pow(10, lanedb(Math.max(0, Math.min(16, b))) / 20);
    }
    return x;
  };
  let beste = null;
  for (let d = -150; d <= 150; d += 2) {
    const sp = verstaerkungsSpur(ideal(d), wk + von, wk + bis, 8, 48, ref);
    let q = 0;
    for (let i = 0; i < sp.length; i++) q += (sp[i].lin - sn[i].lin) ** 2;
    if (!beste || q < beste.q) beste = { d, q, rms: Math.sqrt(q / sp.length) };
  }
  const idealNull = verstaerkungsSpur(ideal(0), wk + von, wk + bis, 8, 48, ref);
  let q0 = 0;
  for (let i = 0; i < idealNull.length; i++) q0 += (idealNull[i].lin - sn[i].lin) ** 2;
  const verhaeltnis = sk.map((e, i) => ({ frame: e.frame - wk, kontrolle: e.lin, lane: sn[i].lin, ideal0: idealNull[i].lin, verhaeltnis: sn[i].lin / e.lin }));
  roh[etikett] = { ref, einsatz_kontrolle: ek, einsatz_lane: en, wrap_kontrolle: wk, wrap_lane: wn, passung_schiebung: beste, rms_ohne_schiebung: Math.sqrt(q0 / idealNull.length), spur: verhaeltnis, limiter_min: [k.limiterMin, n.limiterMin],
    roh: { kontrolle_wrap: Array.from(k.l.subarray(wk - 200, wk + 800)), lane_wrap: Array.from(n.l.subarray(wn - 200, wn + 800)), kontrolle_anfang: Array.from(k.l.subarray(ek - 8, ek + 64)), lane_anfang: Array.from(n.l.subarray(en - 8, en + 64)) } };
  info(`${etikett}: onset control ${ek}, lane ${en} (difference ${en - ek}); best shift of the ideal lane ${beste.d} samples, rms ${beste.rms.toExponential(2)} (shift 0: ${Math.sqrt(q0 / idealNull.length).toExponential(2)})`);
  const zeile = [];
  for (const e of verhaeltnis) if ((e.frame + 960) % 48 === 0 || (e.frame % 24 === 0 && Math.abs(e.frame) < 120))
    zeile.push(`${e.frame >= 0 ? '+' : ''}${e.frame}: ctrl ${e.kontrolle.toFixed(4)} lane ${e.lane.toFixed(4)} ideal ${e.ideal0.toFixed(4)} ratio ${e.verhaeltnis.toFixed(4)}`);
  info('trace (window centre relative to the wrap):\n' + zeile.join('\n'));
}
(async () => {
  await z.ruf('POST', '/proj/transport', { aktion: 'stopp' }).catch(() => null);
  await warte(1500);
  await satz('laut', A.sha);
  fs.writeFileSync(path.join(z.ORDNER, 'rohdaten.json'), JSON.stringify({ etikett: z.opt.etikett, ...roh }, null, 1));
  await z.ende(`Z2 gain trace ${z.opt.etikett}`, /^a1d-/);
})().catch(async (e) => { notiere('trace', false, e instanceof Fehl ? e.message : e.stack); await z.ende('Z2 gain trace', /^a1d-/); });
