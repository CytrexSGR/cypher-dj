// Aufnahme (SCHNITTSTELLEN §4.12, §5.14; 1.8 Slice 1) in der Attrappe: Zustand, Quittungen und Dateien wie der Kern, ohne Ton. Der Take beginnt am Einsatz-Sample
// des Arrangements (K.arr.start_s) und endet, wenn das Arrangement nicht mehr spielt (Vereinfachung: am Blockanfang, der Kern am Ende-Sample)
// oder, bei eingeschalteter Loop-Klammer, am ersten Wrap (wie der Kern, aufnahme.h).
// Inhalt der Rohdatei ist das Prüfmuster L = ((Kern-Sample) mod 1000) / 1000, R = −L, damit der Server seine WAV-Umwandlung bitgenau prüfen kann.
// Statuswerte /zustand/rec: 0 steht, 2 wartet auf den Einsatz, 3 nimmt auf. Quittungen von /k/rec/start: 1 angenommen, 2 am Einsatz, 3 am Ende, 7 abgebrochen
// (Gründe: abbruch = das Arrangement endete vor dem Einsatz, zu_spaet = kein Transportstart innerhalb der Frist, ki_stopp: im Kern, nicht hier).
// /k/rec/stopp ist wie /k/arr/stopp vom KI-Stopp ausgenommen (kern.mjs; der Kern lässt Anhalten zu). Schreibfehler (kein Ordner, Datei vorhanden) enden wie im Kern mit Status 3 und Begleitdatei "kein_platz".
import fs from 'node:fs';
import path from 'node:path';
import { llround } from './uhr.mjs';

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
    K.aus('/e/aufnahme', [spur, R.kennung, st, BigInt(geschrieben), BigInt(R.start_s), 0]);
  }
  K.q(R.id, 3, '', ende);
  R.status = 0;
}

export default {
  name: 'rec',
  init(K) { K.rec = { spuren: new Map(), status: 0, kennung: 0, id: null, nachlauf: 0, start_s: -1, ende_s: -1, frist_s: 0, gesehen: false }; },
  befehle: {
    '/k/rec/spur': (K, a, b) => {
      if (!(a.spur >= 1 && a.spur <= 32) || (a.scharf !== 0 && a.scharf !== 1) || !(a.eingang === 0 || (a.eingang >= 11 && a.eingang <= 13) || a.eingang === 20))
        return K.q(b, 6, 'ausserhalb_bereich');
      if (a.scharf === 1 && a.eingang === 0) return K.q(b, 6, 'kein_eingang');
      if (a.scharf === 1 && a.eingang === 20) return K.q(b, 6, 'eingang_fehlt');   // wie der Kern (netz_rec.cpp): Master vor dem Fader ist noch kein Abgriff
      if (K.rec.status !== 0) return K.q(b, 6, 'aufnahme_laeuft');
      if (a.scharf === 1 && !K.rec.spuren.has(a.spur) && K.rec.spuren.size >= 8) return K.q(b, 6, 'zu_viele_scharf');
      if (a.scharf === 1) K.rec.spuren.set(a.spur, { eingang: a.eingang }); else K.rec.spuren.delete(a.spur);
      K.q(b, 1);
      K.q(b, 3);
    },
    '/k/rec/start': (K, a, b) => {
      const R = K.rec;
      if (!(a.kennung >= 0) || !(a.nachlauf_samples >= 0 && a.nachlauf_samples <= 480000)) return K.q(b, 6, 'ausserhalb_bereich');
      if (!(a.frist_samples === 0 || (a.frist_samples >= 48000 && a.frist_samples <= 1440000))) return K.q(b, 6, 'ausserhalb_bereich');
      if (R.status !== 0) return K.q(b, 6, 'aufnahme_laeuft');
      if (R.spuren.size === 0) return K.q(b, 6, 'kein_eingang');
      if (K.arr.status !== 0) return K.q(b, 6, 'ueberlappung');
      Object.assign(R, { status: 2, kennung: a.kennung, id: b, nachlauf: a.nachlauf_samples, start_s: -1, ende_s: -1, gesehen: false,
        frist_s: K.stempel + (a.frist_samples > 0 ? a.frist_samples : 96000) });
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
    if (R.status === 2) {   // wie der Kern (aufnahme.h): die Frist gilt nur, bis das Arrangement wartet; danach zählt dessen Quant
      if (A.status === 1) R.gesehen = true;
      if (A.status === 2) { R.status = 3; R.start_s = A.start_s; K.q(R.id, 2, '', R.start_s); }
      else if (R.gesehen && A.status === 0) { K.q(R.id, 7, 'abbruch'); R.status = 0; }
      else if (!R.gesehen && s1 > R.frist_s) { K.q(R.id, 7, 'zu_spaet'); R.status = 0; }
    }
    if (R.status === 3 && R.ende_s < 0 && A.status === 2 && A.loop.an && A.start_beat < A.loop.bis) {
      // Loop-Klammer (Spec 1.8 F2, „ein Durchgang“; Kern: aufnahme.h arr.naht): der Take endet am ersten Wrap hinter dem Einsatz, ohne Nachlauf.
      // Die Attrappe wrappt ihre Position nicht; sie rechnet das Sample, an dem der Kopf die Klammer erreicht, aus der Uhr.
      const naht = llround(K.uhr.sample(A.ursprung + (A.loop.bis - A.start_beat)));
      if (naht >= R.start_s && naht >= s0 && naht < s1) R.ende_s = naht;
    }
    if (R.status === 3 && R.ende_s < 0 && A.status !== 2) R.ende_s = s0 + R.nachlauf;
    if (R.status === 3 && R.ende_s >= 0 && s1 >= R.ende_s) beende(K, Math.max(R.ende_s, R.start_s));
    const abstand = R.status === 0 ? 24000 : 4800;
    if (Math.ceil(s0 / abstand) * abstand < s1) K.aus('/zustand/rec', [R.status, R.kennung, R.spuren.size, 0n, A.status === 2 ? K.uhr.beat(s0) - A.ursprung + A.start_beat : 0]);
  },
};
