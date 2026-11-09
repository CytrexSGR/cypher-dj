// 1.8 T8: pure measuring helpers of acceptance_rec5.mjs (MIDI take stamps against the impulse of the proof client, offset verdict, end of a held tone, onset
// delay of live notes, overdub check). No I/O; calibrated in tests/pruef_rec5_messen.test.mjs.
export const RATE = 48000;
const dbAbs = (v) => (v > 1e-10 ? 20 * Math.log10(v) : -200);
const lin = (db) => 10 ** (db / 20);

// Note ons of a MIDI take file (leseMidiDatei records), in file order. A velocity-0 on is an off.
export function noteOnStempel(ereignisse) {
  return ereignisse.filter((e) => (e.status & 0xF0) === 0x90 && e.d2 > 0).map((e) => ({ sample: e.sample, ton: e.d1 }));
}

// On/off pairs by pitch alone (the rule of the core file, R2 fix) with the frames between them; an on without an off has no end (laenge null).
export function noteLaengen(ereignisse) {
  const aus = [], offen = new Map();
  for (const e of ereignisse) {
    const t = e.status & 0xF0, k = e.d1;
    if (t === 0x90 && e.d2 > 0) {
      const n = { ton: e.d1, kanal: e.status & 0x0F, ein: e.sample, aus: null, laenge: null };
      aus.push(n); offen.set(k, n);
    } else if (t === 0x80 || (t === 0x90 && e.d2 === 0)) {
      const n = offen.get(k);
      if (n) { n.aus = e.sample; n.laenge = e.sample - n.ein; offen.delete(k); }
    }
  }
  return aus;
}

// The flank samples the core reported (/zustand/ein flanke_sample, polled; the same value repeats, -1 = none) that belong to this take: unique, in order,
// not before the take start. A flank of an earlier run that the core still reports at the start is not a pair.
export function frischeFlanken(werte, ab) {
  const aus = [];
  for (const v of werte) if (Number.isFinite(v) && v >= 0 && v >= ab && !aus.includes(v)) aus.push(v);
  return aus;
}

// Placed note against the impulse, in samples (positive = the note lies late). The note beat is what the server computed from the core stamp with
// versatz = vorhalt + midi.versatz_samples; the impulse is put on the same beat line with the core delay only (the music the player heard), so the
// difference is stamp - flank - midi.versatz_samples.
export function platziertAbw(noteBeat, flanke, { startBeat, bpm, startSample, vorhalt }) {
  const proSample = bpm / (60 * RATE);
  const impBeat = startBeat + (flanke - startSample - vorhalt) * proSample;
  return (noteBeat - impBeat) / proSample;
}

// Verdict over the deviations of all pairs: every one within +-tol is OK; a constant offset (spread max - min <= tol) is a FINDING with its mean (the value
// for midi.versatz_samples); anything else, no pair or a missing value is FEHL.
export function urteilVersatz(abw, tol = 2) {
  if (abw.length === 0 || abw.some((a) => !Number.isFinite(a))) return { art: 'fehl', grund: abw.length === 0 ? 'no pair' : 'a pair has no value', min: NaN, max: NaN, mittel: NaN, streuung: NaN };
  const min = Math.min(...abw), max = Math.max(...abw), mittel = abw.reduce((a, b) => a + b, 0) / abw.length, streuung = max - min;
  const g = { min, max, mittel, streuung };
  if (abw.every((a) => Math.abs(a) <= tol)) return { art: 'ok', grund: '', ...g };
  if (streuung <= tol) return { art: 'finding', grund: `constant offset ${mittel.toFixed(2)} samples (spread ${streuung.toFixed(2)})`, versatz: Math.round(mittel), ...g };
  return { art: 'fehl', grund: `deviation ${min.toFixed(1)} to ${max.toFixed(1)} samples, spread ${streuung.toFixed(1)} > ${tol}`, ...g };
}

// What goes into midi.versatz_samples (0..48000, integer; the field cannot say "earlier").
export function versatzFinding(u) {
  if (u.art !== 'finding') return { schreibe: null, grund: 'none' };
  if (u.versatz < 0) return { schreibe: null, grund: 'negative' };
  if (u.versatz > 48000) return { schreibe: null, grund: 'too_large' };
  return { schreibe: u.versatz };
}

// A held tone must end at the stop of the transport. x = master recording (one channel) of a project that holds only that track, stopIdx = the index of the
// stop. OK when the tone sounded (>= -60 dBFS), is still loud within 300 ms before the stop (it was held, not cut early), and from the stop + 100 ms on
// nothing reaches -90 dBFS (it did not run on). A tone that runs to the end of the recording is reported as a hanging note.
export function endePruefung(x, { stopIdx, laut = -60, stille = -90, fensterMs = 100, vorStoppMs = 300, endeMs = 500 }) {
  const lautLin = lin(laut), stilleLin = lin(stille), ms = (v) => Math.round(v * RATE / 1000);
  let letzteLaut = -1;
  for (let i = x.length - 1; i >= 0; i--) if (Math.abs(x[i]) >= lautLin) { letzteLaut = i; break; }
  if (letzteLaut < 0) return { ok: false, grund: 'no tone: it never sounded', letzteLaut, spitzeNachDb: -200 };
  if (letzteLaut > x.length - ms(endeMs)) return { ok: false, grund: 'the tone is still sounding at the end of the recording (hanging note)', letzteLaut, spitzeNachDb: NaN };
  let spitze = 0;
  for (let i = Math.max(0, stopIdx + ms(fensterMs)); i < x.length; i++) { const v = Math.abs(x[i]); if (v > spitze) spitze = v; }
  const spitzeNachDb = dbAbs(spitze);
  if (spitze >= stilleLin) return { ok: false, grund: `${fensterMs} ms after the stop the level is ${spitzeNachDb.toFixed(1)} dBFS, not below ${stille} dBFS`, letzteLaut, spitzeNachDb };
  if (letzteLaut < stopIdx - ms(vorStoppMs)) return { ok: false, grund: `the tone ended ${((stopIdx - letzteLaut) / RATE * 1000).toFixed(0)} ms before the stop, not at it`, letzteLaut, spitzeNachDb };
  return { ok: true, grund: '', letzteLaut, spitzeNachDb };
}

// Onsets: the first sample >= thr after at least ruheMs below it (the first onset may be at the very start).
export function onsetsNach(x, thr, ruheMs = 200) {
  const ruhe = Math.round(ruheMs * RATE / 1000), aus = [];
  let still = ruhe;
  for (let i = 0; i < x.length; i++) {
    if (Math.abs(x[i]) >= thr) { if (still >= ruhe) aus.push(i); still = 0; } else still++;
  }
  return aus;
}

// The live tone of one note: stamp is a core sample, s0 the core sample of the first frame of x. Reports whether a sample >= thr follows within `fenster`
// frames, its delay against the stamp, and the level of the 300 ms before the stamp (the note must rise out of quiet).
export function tonAb(x, s0, stempel, thr, fenster = 12000) {
  const idx = stempel - s0;
  let davor = 0;
  for (let i = Math.max(0, idx - 14400); i < Math.min(idx, x.length); i++) { const v = Math.abs(x[i]); if (v > davor) davor = v; }
  for (let i = Math.max(0, idx); i < Math.min(idx + fenster, x.length); i++) {
    if (Math.abs(x[i]) >= thr) return { laut: true, verzug: i - idx, spitzeDavorDb: dbAbs(davor) };
  }
  return { laut: false, verzug: null, spitzeDavorDb: dbAbs(davor) };
}

// Overdub: the second run added `zugefuegt` notes, the notes of the first run are all still there with the same id and content, and no id is used twice.
export function verdoppelt(alt, neu, zugefuegt) {
  const inhalt = (n) => JSON.stringify({ id: n.id, beat: n.beat, laenge: n.laenge, ton: n.ton, vel: n.vel });
  if (neu.length !== alt.length + zugefuegt) return { ok: false, grund: `note count ${neu.length}, expected ${alt.length} + ${zugefuegt}` };
  for (const n of alt) {
    const k = neu.find((m) => m.id === n.id);
    if (!k || inhalt(k) !== inhalt(n)) return { ok: false, grund: `first ids not unchanged: ${n.id} is ${k ? 'changed' : 'gone'}` };
  }
  const ids = neu.map((n) => n.id);
  if (new Set(ids).size !== ids.length) return { ok: false, grund: 'an id is used twice' };
  return { ok: true, grund: '' };
}
