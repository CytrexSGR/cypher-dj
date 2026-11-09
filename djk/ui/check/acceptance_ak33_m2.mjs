// AK33 M2 against a TEST INSTANCE (b, d or e, never f): a dragged warp marker is click-free, and the clicks on the other markers stay on the grid.
//   node check/ak33_m2_setup.mjs --ziel /dev/shm/b1-ziel/m2 --instanz e > /dev/shm/b1-ziel/m2/aufbau.json
//   B1_KATALOG=/dev/shm/b1-ziel/m2/katalog.sqlite <start instance e>   (the catalog of the aufbau)
//   node check/acceptance_ak33_m2.mjs --url http://127.0.0.1:52300 --aufbau /dev/shm/b1-ziel/m2/aufbau.json [--ausgabe <folder>]
// Each click is measured twice: centre of energy (klickLagen) and onset foot at 20 % of the burst peak (klickFuesse, what a level-based onset detector and the D6 limit see);
// both must be within the limit. Source: 64 beats at 120 BPM, a calibrated Hann click centred on every source beat (ak33_m2_setup.mjs). Project 128 BPM, clip at beat 8 (so the start rule of a
// work clip does not touch the measurement), export 0..72. Markers: (0,0), (10 s, beat 20) set by warp_marker setze (the marker ON the grid), (32 s, beat 64).
// The drag is warp_marker verschiebe beat 20 -> neu_quell_s 10.05 (see acceptance_w3b.mjs:50). Expected click position = the warp map applied to the click's source beat.
//   K0  control, no warp effect: tempo 120, RE-PITCH: every click within 1.5 samples of the grid (the instrument's zero)
//   K1  marker on the grid, tempo 128, per mode: RE-PITCH <= 1.5 samples, COMPLEX and TONES <= 24 (D6, Andreas 2026-11-04)
//   K2  after the drag of beat 20 by +50 ms: all 63 clicks against the map of the DRAGGED markers, same limits. The clicks away from the dragged marker (not between beats 18
//       and 22) are reported separately: they stay where the grid puts them
//   NK2 the same export measured against the map of the UNDRAGGED markers: must be far off (more than 500 samples), else the drag had no effect or the measurement is blind
//   S1a seam, steady 440 Hz tone, same drag (COMPLEX, TONES): the residual of a one-sinusoid fit per 10 ms window within 100 ms of the seam is not more than SEAM_DB above the
//       99th percentile of the windows 0.15 s to 2 s away
//   S1b the same seam, all modes: the largest sample-to-sample step within 100 ms of the seam is at most 1.1 times the largest step away from it (a step = a click)
//   NS1 positive control: the tone with a 180 degree phase flip at the source point the drag puts on beat 20: step ratio at least 3 and fit excess at least 15 dB (the measures see a real seam)
// Return: 0 all OK, 1 at least one FEHL, 2 usage.
import fs from 'node:fs';
import path from 'node:path';
import { starte, Fehl } from './w3a_target.mjs';
import { klickSignal, klickFuesse, klickLagen, erwarteteLagen, dehnung, abweichungen, nahtMass, sprungMass, median, GRENZE, klickUrteil } from './ak33_m2_measure.mjs';

const z = starte('abnahme_ak33_m2', 'b1m2', { modi: { type: 'string' } });
const { AUFBAU: A, CYPHER, notiere, info, aendern, aktuell, instanz, ORDNER } = z;
if (!/^[bde]$/.test(instanz)) { process.stderr.write(`abnahme_ak33_m2: instance ${instanz} is not allowed: b, d or e only\n`); process.exit(2); }
const MODI = (z.opt.modi ?? 'repitch,complex,tones').split(',');
const START = 8, SEAM_DB = 3, BEAT_S = 60 / 128, FPB = 22500;
const roh = {};
// onset foot of the SOURCE burst relative to its centre (same function as on the export, so the instrument's own offset cancels)
const FUSS = (() => { const x = klickSignal(), l = new Float32Array(x.length / 2); for (let i = 0; i < l.length; i++) l[i] = x[2 * i]; return median(klickFuesse(l).map((f, k) => f - 24000 * (k + 1))); })();
const NAHT_SAMPLE = (START + 20) * FPB;

async function neu(name, sha, bpm, modus) {
  await z.neuesProjekt(name);
  await aendern(`${name} setup`, [{ befehl: 'tempo_setzen', bpm }, { befehl: 'spur_neu', art: 'audio', name: 'AK33' },
    { befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: START, laenge_beats: 1, sha256: sha, warp: 'auto' }], CYPHER);
  const c = (await aktuell()).projekt.spuren[0].clips[0];
  await aendern(`${name} length`, [{ befehl: 'clip_aendern', clip_id: c.id, laenge_beats: 64 }, { befehl: 'warp_setzen', clip_id: c.id, modus }], CYPHER);
  await z.geladen();
  return c.id;
}
const lageVon = async (id) => z.erwarte200('/proj/warp', await z.ruf('GET', `/proj/warp?clip_id=${id}&marker_max=4096`)).j.warp.marker.map((m) => [m.quell_s, m.beat]);
const exportiere = async (name) => { await z.geladen(); const e = await z.exportiere(0, START + 64, name); return e.l; };

async function klickFall(modus, art) {
  const bpm = art === 'K0' ? 120 : 128, fpb = bpm === 120 ? 24000 : FPB;
  const id = await neu(`${art}-${modus}`, A.sha_klick, bpm, modus);
  await aendern(`${art} set marker`, [{ befehl: 'warp_marker', clip_id: id, setze: [{ quell_s: 10 }] }], CYPHER);
  const gitter = await lageVon(id);
  let schritt = { gitter };
  if (art === 'K2') {
    await aendern(`${art} drag`, [{ befehl: 'warp_marker', clip_id: id, verschiebe: [{ beat: 20, neu_quell_s: 10.05 }] }], CYPHER);
    schritt.gezogen = await lageVon(id);
  }
  const x = await exportiere(`${art.toLowerCase()}-${modus}`);
  const lagen = klickLagen(x);
  const markerSoll = schritt.gezogen ?? gitter;
  const erw = erwarteteLagen(markerSoll, START, fpb);
  const dev = abweichungen(lagen, erw), devF = abweichungen(klickFuesse(x), erw.map((v, j) => v + FUSS * (modus === 'repitch' ? dehnung(markerSoll, (j + 1) * 0.5, bpm) : 1)));
  const nah = dev.d.map((d, i) => ({ d, k: i + 1 })).filter((o) => o.k >= 18 && o.k <= 22), fern = dev.d.filter((_, i) => i + 1 < 18 || i + 1 > 22);
  const r = { modus, n: dev.n, max: dev.max, max_nah: Math.max(...nah.map((o) => Math.abs(o.d))), max_fern: Math.max(...fern.map(Math.abs)), nah: nah.map((o) => +o.d.toFixed(2)),
    median: median(dev.d), erster_klick: lagen[0], marker: markerSoll, fuss_n: devF.n, fuss_max: devF.max, fuss_median: median(devF.d), fuss_quelle: FUSS };
  if (art === 'K2') r.gegen_gitter = abweichungen(lagen, erwarteteLagen(gitter, START, fpb)).max;
  return r;
}

async function nahtFall(modus, sha, name, gezogen) {
  const id = await neu(`${name}-${modus}`, sha, 128, modus);
  await aendern(`${name} set marker`, [{ befehl: 'warp_marker', clip_id: id, setze: [{ quell_s: 10 }] }], CYPHER);
  if (gezogen) await aendern(`${name} drag`, [{ befehl: 'warp_marker', clip_id: id, verschiebe: [{ beat: 20, neu_quell_s: 10.05 }] }], CYPHER);
  const x = await exportiere(`${name.toLowerCase()}-${modus}`);
  const f0 = modus === 'repitch' ? 440 * 128 / 120 : 440;   // RE-PITCH speeds the tone up by the tempo ratio, COMPLEX and TONES keep the pitch
  const w = nahtMass(x, NAHT_SAMPLE - 2 * 48000, NAHT_SAMPLE + 2 * 48000, { fNenn: f0, spanne: 8 });
  const nah = w.filter((o) => Math.abs(o.a + 240 - NAHT_SAMPLE) <= 4800), fern = w.filter((o) => Math.abs(o.a + 240 - NAHT_SAMPLE) > 7200).map((o) => o.db).sort((a, b) => a - b);
  const p99 = fern[Math.floor(0.99 * (fern.length - 1))], nahMax = Math.max(...nah.map((o) => o.db));
  const ort = nah.reduce((b, o) => (o.db > b.db ? o : b), nah[0]);
  return { modus, fern_median_db: median(fern), fern_p99_db: p99, fern_max_db: fern.at(-1), nah_max_db: nahMax, ueberschuss_db: nahMax - p99, bei_samples_von_naht: ort.a + 240 - NAHT_SAMPLE,
    f_nah: ort.f, f_median: median(w.map((o) => o.f)), pegel_median_db: median(w.map((o) => o.pegel_db)), sprung: sprungMass(x, NAHT_SAMPLE) };
}

try {
  for (const modus of MODI) {
    const g = GRENZE[modus];
    z.punkt = `K-${modus}`;
    if (modus === 'repitch') {
      const k0 = await klickFall(modus, 'K0'); roh[`K0-${modus}`] = k0;
      notiere(`K0 control tempo 120 ${modus}: 63 clicks, every one within ${g} samples of the grid`, klickUrteil({ n: k0.n, max: k0.max }, g) && klickUrteil({ n: k0.fuss_n, max: k0.fuss_max }, g), `${k0.n} clicks, centre max ${k0.max.toFixed(2)}, onset foot max ${k0.fuss_max.toFixed(2)}`);
    }
    const k1 = await klickFall(modus, 'K1'); roh[`K1-${modus}`] = k1;
    notiere(`K1 ${modus}, marker on the grid, tempo 128: 63 clicks within ${g} samples of the map`, klickUrteil({ n: k1.n, max: k1.max }, g) && klickUrteil({ n: k1.fuss_n, max: k1.fuss_max }, g), `${k1.n} clicks, centre max ${k1.max.toFixed(2)} (median ${k1.median.toFixed(2)}), onset foot max ${k1.fuss_max.toFixed(2)} (median ${k1.fuss_median.toFixed(2)}), first click at sample ${k1.erster_klick.toFixed(1)}`);
    const k2 = await klickFall(modus, 'K2'); roh[`K2-${modus}`] = k2;
    notiere(`K2 ${modus}, marker beat 20 dragged by +50 ms: 63 clicks within ${g} samples of the map of the dragged markers`, klickUrteil({ n: k2.n, max: k2.max }, g) && klickUrteil({ n: k2.fuss_n, max: k2.fuss_max }, g),
      `${k2.n} clicks, centre max ${k2.max.toFixed(2)}, onset foot max ${k2.fuss_max.toFixed(2)} (centre near the seam, clicks 18..22: ${k2.max_nah.toFixed(2)} [${k2.nah.join(' ')}], away from it: ${k2.max_fern.toFixed(2)}), median ${k2.median.toFixed(2)}`);
    notiere(`NK2 ${modus}: the same export against the UNDRAGGED map is more than 500 samples off (the drag acts, the measurement sees it)`, k2.gegen_gitter > 500, `max ${k2.gegen_gitter.toFixed(0)} samples`);
    z.punkt = `S-${modus}`;
    const s1 = await nahtFall(modus, A.sha_ton, 'S1', true); roh[`S1-${modus}`] = s1;
    // sine fit: only where the pitch is kept (COMPLEX, TONES); RE-PITCH changes the pitch with the segment tempo (about 8.7 cent here), a frequency step the fit reads as residual
    if (modus === 'repitch') info(`S1 ${modus}: sine-fit excess ${s1.ueberschuss_db.toFixed(1)} dB (a frequency step, not a click: the pitch of RE-PITCH follows the segment tempo), f ${s1.f_median.toFixed(1)} Hz`);
    else notiere(`S1a ${modus}, tone, dragged marker: no seam artefact (residual within 100 ms of the seam at most ${SEAM_DB} dB above the 99th percentile away from it)`, s1.ueberschuss_db <= SEAM_DB,
      `near max ${s1.nah_max_db.toFixed(1)} dB, away p99 ${s1.fern_p99_db.toFixed(1)} dB (median ${s1.fern_median_db.toFixed(1)}, max ${s1.fern_max_db.toFixed(1)}), excess ${s1.ueberschuss_db.toFixed(1)} dB, level ${s1.pegel_median_db.toFixed(1)} dBFS, f ${s1.f_median.toFixed(1)} Hz`);
    notiere(`S1b ${modus}, tone, dragged marker: no step in the waveform (largest sample step within 100 ms of the seam at most 1.1 times the largest step away from it)`, s1.sprung.verhaeltnis <= 1.1,
      `near ${s1.sprung.nah_max.toFixed(5)}, away ${s1.sprung.fern_max.toFixed(5)}, ratio ${s1.sprung.verhaeltnis.toFixed(3)}`);
    const ns = await nahtFall(modus, A.sha_sprung, 'NS1', true); roh[`NS1-${modus}`] = ns;
    notiere(`NS1 ${modus}, positive control (phase flip at the seam): the largest step is at least 3 times the reference and the fit excess at least 15 dB`, ns.sprung.verhaeltnis >= 3 && ns.ueberschuss_db >= 15,
      `step ratio ${ns.sprung.verhaeltnis.toFixed(2)} at ${ns.sprung.bei_samples_von_naht} samples from the seam, fit excess ${ns.ueberschuss_db.toFixed(1)} dB`);
  }
} catch (e) { notiere('setup/run', false, e.message); }
fs.writeFileSync(path.join(ORDNER, 'rohdaten.json'), JSON.stringify(roh, null, 1));
await z.ende('AK33 M2 dragged marker', /^b1m2-/);
