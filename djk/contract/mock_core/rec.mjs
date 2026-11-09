// Aufnahme (INTERFACES §4.12, §5.14; 1.8 Slice 1) in der Attrappe: Zustand, Quittungen und Dateien wie der Kern, ohne Ton. Der Take beginnt am Einsatz-Sample
// des Arrangements (K.arr.start_s) und endet, wenn das Arrangement nicht mehr spielt (Vereinfachung: am Blockanfang, der Kern am Ende-Sample)
// oder, bei eingeschalteter Loop-Klammer, am ersten Wrap (wie der Kern, recording.h).
// Inhalt der Rohdatei ist das Prüfmuster L = ((Kern-Sample) mod 1000) / 1000, R = −L, damit der Server seine WAV-Umwandlung bitgenau prüfen kann.
// 1.8 S0 (Vertrag): /k/rec/spur trägt modus und monitor, /k/rec/start vorzaehler_takte, /zustand/rec ausgang_vorhalt und quantum, /e/aufnahme art.
// Wie der Kern (net_rec.cpp, 1.8 S2a): ein_1..4 sind Abgriffe und tragen den Kanalmodus 0..3; modus != 0 auf einem internen Code (11..13, 15..17, 21, 22) ist
// ausserhalb_bereich (auch beim Entschärfen); 20 bleibt eingang_fehlt bis zu seiner Slice (auch mit modus); vorzaehler_takte != 0 ist ausserhalb_bereich,
// monitor wird angenommen und ignoriert (D11).
// 1.8 S4b (Vertrag, S4a im Kern): vorzaehler_takte 0, 1, 2, 4 (3 und alles andere ausserhalb_bereich); der Count-in verschiebt den Einsatz des wartenden Transports (arr.mjs) und /zustand/rec
// meldet Status 1, solange er zaehlt. Laeuft der Transport schon (Arrangement spielt), beginnt der Take am naechsten Projekt-Takt (4/4, p = 0 mod 4), mit Loop-Klammer an der Naht, wenn der Takt hinter
// der Klammer liegt; der Count-in ist dann ohne Wirkung (D7), Quittung 2 traegt den PROJEKT-Beat des Take-Starts (D8) und der Take endet an der naechsten Naht (ein ganzer Durchgang).
// Testhaken ATTRAPPE_REC_LAUFEND_VERZUG_MS verzoegert den Start in einem laufenden Transport um so viele Millisekunden (nur Tests; arr.mjs hat ATTRAPPE_EINSATZ_VERZUG_MS fuer den wartenden Transport). Mock-Werte: ausgang_vorhalt 0 (der Mock verzögert nichts), quantum 256 (der Mock rechnet in 256er Blöcken); art immer 0 (audio).
// Statuswerte /zustand/rec: 0 steht, 2 wartet auf den Einsatz, 3 nimmt auf. Quittungen von /k/rec/start: 1 angenommen, 2 am Einsatz, 3 am Ende, 7 abgebrochen
// (Gründe: abbruch = das Arrangement endete vor dem Einsatz, zu_spaet = kein Transportstart innerhalb der Frist, ki_stopp: im Kern, nicht hier).
// /k/rec/stopp ist wie /k/arr/stopp vom KI-Stopp ausgenommen (core.mjs; der Kern lässt Anhalten zu). Schreibfehler (kein Ordner, Datei vorhanden) enden wie im Kern mit Status 3 und Begleitdatei "kein_platz".
import fs from 'node:fs';
import path from 'node:path';
import { llround } from './clock.mjs';

const N = 256;   // block size of the stand-in; the core's earliest start is one cycle ahead

// 1.8 T8 (eingang 30, midi_ein_1): the stand-in arms instrument tracks (a set of track numbers, no limit, not counted in `scharf`) and, like the core (T7a), writes ONE
// take file for them all, midi-<kennung>.bin (records of 12 bytes, little endian: i64 sample, u8 status, u8 d1, u8 d2, u8 pad) plus the sidecar midi-<kennung>.json,
// and reports /e/aufnahme with spur 0, art 1, frames = event count. The content is deterministic: one control change 500 samples after the start and up to 16 notes
// (pitch 48 + k, velocity 64 + k, note on 1000 + 3000 k samples after the start, 1500 samples long); a note still sounding at the end is closed there, a note that
// would begin after the end is not played. Tests may replace it with cfg.rec_midi(start_s, ende_s) -> [[sample, status, d1, d2], ...] in time order.
export const MIDI_NOTEN = 16;
export function midiMuster(start, ende) {
  const e = [[start + 500, 0xB0, 1, 64]];
  for (let k = 0; k < MIDI_NOTEN; k++) {
    const an = start + 1000 + 3000 * k;
    if (an >= ende) break;
    e.push([an, 0x90, 48 + k, 64 + k], [Math.min(an + 1500, ende), 0x80, 48 + k, 0]);
  }
  return e.sort((a, b) => a[0] - b[0]);   // stable: the off of a note that ends at `ende` stays behind its on
}
function schreibeMidi(K, ende) {
  const R = K.rec;
  const ereignisse = (K.cfg.rec_midi ?? midiMuster)(R.start_s, ende);
  let st = 0;
  try {
    if (!K.cfg.arr_ordner) throw new Error('kein arr_ordner');
    fs.mkdirSync(K.cfg.arr_ordner, { recursive: true });
    const puf = Buffer.alloc(ereignisse.length * 12);
    ereignisse.forEach(([sample, status, d1, d2], i) => { puf.writeBigInt64LE(BigInt(sample), i * 12); puf[i * 12 + 8] = status; puf[i * 12 + 9] = d1; puf[i * 12 + 10] = d2; });
    fs.writeFileSync(path.join(K.cfg.arr_ordner, `midi-${R.kennung}.bin`), puf, { flag: 'wx' });
  } catch { st = 3; }
  const n = st === 0 ? ereignisse.length : 0;
  try {
    if (!K.cfg.arr_ordner) throw new Error('kein arr_ordner');
    fs.writeFileSync(path.join(K.cfg.arr_ordner, `midi-${R.kennung}.json`), JSON.stringify({ art: 'midi', spur: 0, kennung: R.kennung, eingang: 30, start_sample: R.start_s,
      ende_sample: ende, ereignisse: n, abgelehnt: 0, status: st === 0 ? 'fertig' : 'kein_platz' }));
  } catch { /* without a folder no sidecar */ }
  K.aus('/e/aufnahme', [0, R.kennung, st, BigInt(n), BigInt(R.start_s), 0, 1]);
  return st;
}

function beende(K, ende) {
  const R = K.rec;
  const frames = Math.max(0, ende - R.start_s);
  let status = 0;
  for (const [spur, s] of R.spuren) {
    let st = 0;
    try {
      if (!K.cfg.arr_ordner) throw new Error('kein arr_ordner');
      fs.mkdirSync(K.cfg.arr_ordner, { recursive: true });
      const puf = Buffer.alloc(frames * 8);
      for (let i = 0; i < frames; i++) { const v = Math.fround(((R.start_s + i) % 1000) / 1000); puf.writeFloatLE(v, i * 8); puf.writeFloatLE(-v, i * 8 + 4); }
      fs.writeFileSync(path.join(K.cfg.arr_ordner, `aufnahme-${spur}-${R.kennung}.f32`), puf, { flag: 'wx' });
    } catch { st = 3; }
    // wie der Kern (Plan I08 Z. 3315-3316, begleitdatei): die Begleitdatei entsteht auch beim Fehler, dann mit "kein_platz"; gemeldet werden die bis dahin geschriebenen Frames (hier 0)
    const geschrieben = st === 0 ? frames : 0;
    try {
      if (!K.cfg.arr_ordner) throw new Error('kein arr_ordner');
      fs.writeFileSync(path.join(K.cfg.arr_ordner, `aufnahme-${spur}-${R.kennung}.json`), JSON.stringify({ spur, kennung: R.kennung, eingang: s.eingang, start_sample: R.start_s, frames: geschrieben, luecken: 0, status: st === 0 ? 'fertig' : 'kein_platz' }));
    } catch { /* ohne Ordner keine Begleitdatei */ }
    status = Math.max(status, st);
    K.aus('/e/aufnahme', [spur, R.kennung, st, BigInt(geschrieben), BigInt(R.start_s), 0, 0]);
  }
  if (R.midi.size > 0) status = Math.max(status, schreibeMidi(K, Math.max(ende, R.start_s)));
  K.q(R.id, 3, '', ende);
  R.status = 0;
}


// 1.8 S4b (D8): where a take that starts inside a running transport begins. Returns { s, beat, uEnde } or null: the sample of the start (the next project bar at least one
// block ahead, or the seam of the running pass), the project beat reported with receipt 2, and the unwrapped arrangement beat at which the take ends on a loop (null without loop).
function laufenderStart(K) {
  const A = K.arr, l = A.loop;
  const frueh = K.jetzt + N;
  const schleife = l.an && l.bis > l.von && A.start_beat < l.bis;
  const L = l.bis - l.von;
  const u = (s) => K.uhr.beat(s) - A.ursprung + A.start_beat;                 // unwrapped arrangement beat
  const sampleBeiU = (x) => llround(K.uhr.sample(A.ursprung - A.start_beat + x));
  const uFrueh = u(frueh);
  const p0 = schleife && uFrueh >= l.bis ? l.von + ((uFrueh - l.von) % L) : uFrueh;
  let p = 4 * Math.ceil(p0 / 4 - 1e-9);
  // the seam that ends the running pass: the first one at or behind uFrueh
  const naht = (ab) => (ab <= l.bis ? l.bis : l.bis + L * Math.ceil((ab - l.bis) / L));
  let uStart = uFrueh + (p - p0), beat = p;
  if (schleife && p >= l.bis - 1e-9) { uStart = naht(uFrueh); beat = l.von; }
  const s = Math.max(sampleBeiU(uStart), frueh);
  let uEnde = null;
  if (schleife) {
    const n = naht(uStart + 1e-9);
    uEnde = n > uStart + 1e-9 ? n : n + L;   // a seam equal to the start does not end the take
  }
  return { s, beat, uEnde, sampleBeiU };
}

export default {
  name: 'rec',
  init(K) { K.rec = { spuren: new Map(), midi: new Set(), status: 0, kennung: 0, id: null, nachlauf: 0, start_s: -1, ende_s: -1, frist_s: 0, gesehen: false, vorzaehler: 0, laufend: null, einsatz_s: -1, naht_s: -1 }; },
  befehle: {
    '/k/rec/spur': (K, a, b) => {
      const midi = a.eingang === 30;   // 1.8 T8 (midi_ein_1): a bit per instrument track, no tap and no channel mode
      const externEin = a.eingang >= 1 && a.eingang <= 4;   // Slice 2: ein_1..4 sind Abgriffe mit Kanalmodus
      const erzOderPad = (a.eingang >= 11 && a.eingang <= 13) || (a.eingang >= 15 && a.eingang <= 17) || a.eingang === 21 || a.eingang === 22;   // wie rec_mixer_index
      if (!(a.spur >= 1 && a.spur <= 32) || (a.scharf !== 0 && a.scharf !== 1) || !(a.eingang === 0 || erzOderPad || a.eingang === 20 || externEin || midi)
        || !(a.modus >= 0 && a.modus <= 3) || !(a.monitor >= 0 && a.monitor <= 2))
        return K.q(b, 6, 'ausserhalb_bereich');
      if (erzOderPad && a.modus !== 0) return K.q(b, 6, 'ausserhalb_bereich');                        // der Kanalmodus gibt es nur für ein_1..4
      if (a.scharf === 1 && a.eingang === 0) return K.q(b, 6, 'kein_eingang');
      if (a.scharf === 1 && a.eingang === 20) return K.q(b, 6, 'eingang_fehlt');   // wie der Kern (net_rec.cpp): der Master vor dem Fader ist noch kein Abgriff (auch mit modus)
      if (a.scharf === 1 && midi && a.modus !== 0) return K.q(b, 6, 'ausserhalb_bereich');   // the channel mode only exists for ein_1..4
      if (a.scharf === 1 && midi && K.rec.midi.has(a.spur)) { K.q(b, 1); K.q(b, 3); return; }   // already armed: nothing changes (also while a run is going)
      if (K.rec.status !== 0) return K.q(b, 6, 'aufnahme_laeuft');
      if (a.scharf === 1 && midi) {   // a track has ONE input: an audio arm of this track goes; the MIDI arm is not counted against the eight audio arms
        K.rec.spuren.delete(a.spur); K.rec.midi.add(a.spur);
        K.q(b, 1); K.q(b, 3);
        return;
      }
      if (a.scharf === 1 && !K.rec.spuren.has(a.spur) && K.rec.spuren.size >= 8) return K.q(b, 6, 'zu_viele_scharf');
      if (a.scharf === 1) K.rec.spuren.set(a.spur, { eingang: a.eingang }); else K.rec.spuren.delete(a.spur);
      K.rec.midi.delete(a.spur);   // an audio arm or a disarm clears the MIDI bit of the track
      K.q(b, 1);
      K.q(b, 3);
    },
    '/k/rec/start': (K, a, b) => {
      const R = K.rec;
      if (!(a.kennung >= 0) || !(a.nachlauf_samples >= 0 && a.nachlauf_samples <= 480000)) return K.q(b, 6, 'ausserhalb_bereich');
      if (!(a.frist_samples === 0 || (a.frist_samples >= 48000 && a.frist_samples <= 1440000))) return K.q(b, 6, 'ausserhalb_bereich');
      if (![0, 1, 2, 4].includes(a.vorzaehler_takte)) return K.q(b, 6, 'ausserhalb_bereich');   // 3 and everything outside [0, 4] is refused, as the core does
      if (R.status !== 0) return K.q(b, 6, 'aufnahme_laeuft');
      if (R.spuren.size === 0 && R.midi.size === 0) return K.q(b, 6, 'kein_eingang');   // 1.8 T8: a MIDI arm alone is a run (instrument-only)
      if (K.arr.status !== 0 && K.arr.status !== 2) return K.q(b, 6, 'ueberlappung');
      Object.assign(R, { status: 2, kennung: a.kennung, id: b, nachlauf: a.nachlauf_samples, start_s: -1, ende_s: -1, gesehen: false, vorzaehler: a.vorzaehler_takte,
        laufend: null, einsatz_s: -1, naht_s: -1, frist_s: K.stempel + (a.frist_samples > 0 ? a.frist_samples : 96000) });
      if (K.arr.status === 2) {   // D8: the transport plays; the count-in has no effect
        const v = laufenderStart(K);
        const verzug = Number(process.env.ATTRAPPE_REC_LAUFEND_VERZUG_MS ?? 0);
        R.vorzaehler = 0;
        R.laufend = v;
        R.einsatz_s = v.s + (verzug > 0 ? Math.round(verzug * 48) : 0);
        R.gesehen = true;
      }
      K.q(b, 1);
    },
    '/k/rec/stopp': (K, a, b) => {
      const R = K.rec;
      K.q(b, 1);
      if (R.status === 2) { K.q(R.id, 7, 'abbruch'); R.status = 0; } else if (R.status === 3 && R.ende_s < 0) R.ende_s = K.stempel + R.nachlauf;
      K.q(b, 3);
    },
  },
  ausgaben(K, s0, s1) {
    const R = K.rec, A = K.arr;
    if (R.status === 2) {   // wie der Kern (recording.h): die Frist gilt nur, bis das Arrangement wartet; danach zählt dessen Quant
      if (A.status === 1) R.gesehen = true;
      if (R.laufend) {   // started inside a running transport (D8): begins at its bar or seam, receipt 2 carries the project beat
        if (A.status !== 2) { K.q(R.id, 7, 'abbruch'); R.status = 0; }
        else if (s1 > R.einsatz_s) {
          R.status = 3; R.start_s = Math.max(R.einsatz_s, s0);
          if (R.laufend.uEnde !== null) R.naht_s = R.laufend.sampleBeiU(R.laufend.uEnde);
          K.q(R.id, 2, '', R.start_s, R.laufend.beat);
        }
      } else if (A.status === 2) { R.status = 3; R.start_s = A.start_s; K.q(R.id, 2, '', R.start_s); }
      else if (R.gesehen && A.status === 0) { K.q(R.id, 7, 'abbruch'); R.status = 0; }
      else if (!R.gesehen && s1 > R.frist_s) { K.q(R.id, 7, 'zu_spaet'); R.status = 0; }
    }
    if (R.status === 3 && R.ende_s < 0 && R.naht_s >= 0 && A.status === 2 && R.naht_s >= s0 && R.naht_s < s1) R.ende_s = R.naht_s;   // running start with a loop: the following seam
    if (R.status === 3 && R.ende_s < 0 && !R.laufend && A.status === 2 && A.loop.an && A.start_beat < A.loop.bis) {
      // Loop-Klammer (Spec 1.8 F2, „ein Durchgang“; Kern: recording.h arr.naht): der Take endet am ersten Wrap hinter dem Einsatz, ohne Nachlauf.
      // Die Attrappe wrappt ihre Position nicht; sie rechnet das Sample, an dem der Kopf die Klammer erreicht, aus der Uhr.
      const naht = llround(K.uhr.sample(A.ursprung + (A.loop.bis - A.start_beat)));
      if (naht >= R.start_s && naht >= s0 && naht < s1) R.ende_s = naht;
    }
    if (R.status === 3 && R.ende_s < 0 && A.status !== 2) R.ende_s = s0 + R.nachlauf;
    if (R.status === 3 && R.ende_s >= 0 && s1 >= R.ende_s) beende(K, Math.max(R.ende_s, R.start_s));
    const abstand = R.status === 0 ? 24000 : 4800;
    const status = R.status === 2 && A.status === 1 && R.vorzaehler > 0 ? 1 : R.status;   // 1 counts in (the arrangement waits behind a count-in)
    if (Math.ceil(s0 / abstand) * abstand < s1) K.aus('/zustand/rec', [status, R.kennung, R.spuren.size, 0n, A.status === 2 ? K.uhr.beat(s0) - A.ursprung + A.start_beat : 0, 0, 256, R.midi.size]);   // 1.8 T8: rec_midi_scharf = armed instrument tracks
  },
};
