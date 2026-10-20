// Arrangement (SCHNITTSTELLEN §4.11, §5.13; D1 K1) in der Attrappe: Zustand, Quittungen und /zustand/arr wie der Kern,
// ohne Ton. Die Attrappe liest keine Wiedergabe-Datei: /k/arr/laden merkt sich nur nr (Quittung 1 und 3). Der Einsatz
// folgt der Start-Regel des Kerns bei Quantum 256 (jetzt + Vorhalt 537 + 256, dann Quant: 0 sofort, 1 Beat, 2 Takt mit
// (Kern-Beat − start_beat) ≡ 0 mod 4), Quittung 2 am Einsatz-Sample. Stopp gilt sofort (Quittung 1 und 3), ohne Quant.
// /zustand/arr geht bei jeder Änderung hinaus und, wie im Kern (kern_arr.cpp arr_zustand), im Takt: 50 Hz (je 960 Samples), solange er
// wartet oder spielt, sonst 2 Hz (je 24 000), Stempel am Blockanfang (D1 Fix4 J1).
// Paket K3: /k/arr/freeze startet wie /k/arr/start (Quant 0) ab von_beat, meldet Status 3, Quittung 2 am Einsatz und am Ende
// des Nachlaufs (bis − von + 2 Beats) Quittung 3 und /e/freeze (spur, kennung, 0, frames); mit cfg.arr_ordner liegt dann
// <arr_ordner>/freeze-<spur>-<kennung>.f32 (Nullen, frames · 8 Bytes, eine vorhandene Datei wird nie ersetzt: Status 2,
// Spec 6.25), ohne Ordner meldet /e/freeze Status 2. Stopp, Start, Laden, die Hand-Taste, eine Tempo-Rampe und /k/set/neu
// brechen ab (Quittung 7 abbruch, /e/freeze 1; Spec 6.33, Fix L1: bei /k/set/neu am Sample 0 der neuen Achse), der KI-Stopp
// Cyphers Freeze (7 ki_stopp). Solange eine Tempo-Rampe offen ist
// (wartet auf ihren Einsatz oder läuft), lehnt /k/arr/freeze mit tempo_rampe ab (Spec 6.33). Vereinfacht: keine
// Spur-Prüfung (die Attrappe liest keine Wiedergabe), kein Puffer, Quant immer 0.
import fs from 'node:fs';
import path from 'node:path';
// Der Vertragstest in tests/arr.test.mjs liest jede Meldung nach den Feldern aus osc_adressen.ts (K1-Fix 12).
// Wie der Kern (Review): ein wartender Start, der ohne Einsatz endet, bekommt 7 (abbruch, hand, ki_stopp); der KI-Stopp
// beendet einen von Cypher gestarteten Transport (Spec 2.12). Während des KI-Stopps lehnt kern.mjs alle cypher-Befehle
// ab außer /k/arr/stopp (Spec 6.27, gemeinsamer Fall djk/vertrag/faelle/arr_ki_stopp.json).
import { llround } from './uhr.mjs';

const N = 256;
const VORHALT = 2 * N + 25;

function melde(K, s) {
  const a = K.arr;
  const p = a.status === 2 ? K.uhr.beat(s) - a.ursprung + a.start_beat : a.start_beat;
  const w = [a.nr, a.status, a.loop.an ? 1 : 0, p, BigInt(a.start_s), a.start_beat, a.metro.an ? 1 : 0];
  if (a.freeze && a.status !== 0) w[1] = 3;   // Paket K3: Status freeze, solange er wartet oder läuft (wie der Kern)
  if (K.mutation.has('arr_zustand_alt')) w.pop();   // Fehlerfall: Form ohne metronom_an (der Vertragstest muss es sehen)
  K.aus('/zustand/arr', w);
}

// Paket K3: Ende eines Freeze am Sample s; ok: Quittung 3, Datei, /e/freeze 0; sonst Quittung 7 (grund), /e/freeze 1
function freezeEnde(K, s, ok, grund = 'abbruch') {
  const f = K.arr.freeze;
  if (!f) return;
  K.arr.freeze = null;
  let status = ok ? 0 : 1;
  if (ok) {
    K.q(f.b, 3, '', s);
    try {
      if (!K.cfg.arr_ordner) throw new Error('kein arr_ordner');
      fs.mkdirSync(K.cfg.arr_ordner, { recursive: true });   // wie der Kern beim Start (create_directories)
      // Spec 6.25: nie ersetzen (wx: Fehler, wenn die Datei besteht)
      fs.writeFileSync(path.join(K.cfg.arr_ordner, `freeze-${f.spur}-${f.kennung}.f32`), Buffer.alloc(f.frames * 8), { flag: 'wx' });
    } catch {
      status = 2;
    }
  } else {
    K.q(f.b, 7, grund, s);
  }
  K.aus('/e/freeze', [f.spur, f.kennung, status, BigInt(status === 0 ? f.frames : 0)]);
}

// Spec 6.33: offen ist eine angenommene Rampe, die auf ihren Einsatz wartet oder läuft
const rampeOffen = (K) => K.teile.some((u) => u.art === 'tempo' && (u.status === 'wartet' || u.status === 'laeuft'));

function startAbbrechen(K, s, grund) {   // wartender Start ohne Einsatz: Endquittung 7
  const a = K.arr;
  if (a.b_start && a.status === 1) K.q(a.b_start, 7, grund, s);
  a.b_start = null;
}

function beidesQ(K, b, tu) {   // Quittung 1 jetzt, 3 am nächsten Blockanfang (wie der Kern: angenommen und fertig)
  K.q(b, 1);
  K.sofortQ.push(() => {
    tu(K.stempel);
    K.q(b, 3);
    melde(K, K.stempel);
  });
}

export default {
  name: 'arr',
  init(K) {
    K.arr = { nr: -1, status: 0, start_beat: 0, ursprung: 0, start_s: -1, b_start: null, cypher: false,
      loop: { an: false, von: 0, bis: 0 }, metro: { an: false, pegel_db: -12, ziel: 0 } };
    K.arrStartStopp = (s) => {   // Hand-Zielart arr/start_stopp (§7.2): Stopp, oder Start sofort (die Attrappe spielt nie)
      const a = K.arr;
      if (a.status !== 0) {
        startAbbrechen(K, s, 'hand');
        a.status = 0;
        freezeEnde(K, s, false);   // Paket K3: wie der Kern (Grund abbruch)
      } else if (a.nr >= 0) {
        const kb = K.uhr.beat(s + VORHALT + N);
        Object.assign(a, { status: 1, ursprung: kb, start_s: llround(K.uhr.sample(kb)), b_start: null, cypher: false });
      }
      melde(K, s);
    };
    K.arrKiStopp = (s) => {   // Spec 2.12: der KI-Stopp beendet einen von Cypher gestarteten Transport
      const a = K.arr;
      if (a.status === 0 || !a.cypher) return;
      startAbbrechen(K, s, 'ki_stopp');
      a.status = 0;
      freezeEnde(K, s, false, 'ki_stopp');   // Paket K3: Cyphers Freeze endet mit dem KI-Stopp
      melde(K, s);
    };
    // Spec 6.33 (kern.mjs /k/tempo/rampe ruft es für jede Rampe im Bereich, gleich von welcher Quelle): bricht den Freeze ab
    K.arrTempoRampe = (s) => {
      const a = K.arr;
      if (!a.freeze || K.mutation.has('arr_freeze_rampe_ohne_abbruch')) return;
      a.status = 0;
      freezeEnde(K, s, false);
      melde(K, s);
    };
  },
  // Fix L1 wie der Kern: /k/set/neu (kern.mjs ruft es am Anfang der neuen Achse) bricht einen wartenden oder laufenden
  // Freeze ab; mit der Mutation arr_freeze_set_neu_bleibt liefe er auf der neuen Achse weiter
  setNeu(K) {
    const a = K.arr;
    if (!a.freeze || K.mutation.has('arr_freeze_set_neu_bleibt')) return;
    a.status = 0;
    freezeEnde(K, 0, false);
    melde(K, 0);
  },
  befehle: {
    '/k/arr/laden': (K, a, b) => {
      if (!(a.nr >= 0)) return K.q(b, 6, 'ausserhalb_bereich');
      beidesQ(K, b, (s) => { K.arr.nr = a.nr; if (K.arr.freeze) { K.arr.status = 0; freezeEnde(K, s, false); } });
    },
    '/k/arr/start': (K, a, b) => {
      if (!(a.start_beat >= 0) || !(a.quant >= 0 && a.quant <= 2)) return K.q(b, 6, 'ausserhalb_bereich');
      if (K.arr.nr < 0) return K.q(b, 6, 'nicht_geladen');
      freezeEnde(K, K.jetzt, false);   // Paket K3: ein neuer Start bricht den Freeze ab
      K.q(b, 1);
      const bmin = K.uhr.beat(K.jetzt + VORHALT + N);
      let kb = bmin;
      if (a.quant === 1) kb = Math.ceil(bmin - 1e-9);
      if (a.quant === 2) kb = a.start_beat + 4 * Math.ceil((bmin - a.start_beat) / 4 - 1e-9);
      startAbbrechen(K, K.jetzt, 'abbruch');   // ein noch wartender Start endet hier
      Object.assign(K.arr, { status: 1, start_beat: a.start_beat, ursprung: kb, start_s: llround(K.uhr.sample(kb)), b_start: b,
        cypher: a.quelle === 'cypher' });
      melde(K, K.jetzt);
    },
    '/k/arr/stopp': (K, a, b) => {
      if (!(a.quant >= 0 && a.quant <= 2)) return K.q(b, 6, 'ausserhalb_bereich');
      beidesQ(K, b, (s) => { startAbbrechen(K, s, 'abbruch'); K.arr.status = 0; freezeEnde(K, s, false); });
    },
    '/k/arr/loop': (K, a, b) => {
      if ((a.an !== 0 && a.an !== 1) || !(a.von_beat >= 0) || !(a.bis_beat - a.von_beat >= 1)) return K.q(b, 6, 'ausserhalb_bereich');
      beidesQ(K, b, () => { K.arr.loop = { an: a.an === 1, von: a.von_beat, bis: a.bis_beat }; });
    },
    '/k/arr/metronom': (K, a, b) => {
      if ((a.an !== 0 && a.an !== 1) || !(a.pegel_db >= -60 && a.pegel_db <= 0) || (a.ziel !== 0 && a.ziel !== 1))
        return K.q(b, 6, 'ausserhalb_bereich');
      beidesQ(K, b, () => { K.arr.metro = { an: a.an === 1, pegel_db: a.pegel_db, ziel: a.ziel }; });
    },
    '/k/arr/freeze': (K, a, b) => {   // Paket K3 (KI-Stopp für cypher prüft kern.mjs vor allem anderen)
      if (!(a.spur >= 1 && a.spur <= 8) || !(a.von_beat >= 0) || !(a.bis_beat - a.von_beat >= 1) ||
          !(a.bis_beat - a.von_beat <= 256) || !(a.kennung >= 0))
        return K.q(b, 6, 'ausserhalb_bereich');
      const A = K.arr;
      if (A.nr < 0) return K.q(b, 6, 'nicht_geladen');
      if (A.status !== 0) return K.q(b, 6, 'ueberlappung');
      if (rampeOffen(K) && !K.mutation.has('arr_freeze_ohne_rampenpruefung')) return K.q(b, 6, 'tempo_rampe');
      K.q(b, 1);
      const kb = K.uhr.beat(K.jetzt + VORHALT + N);   // Quant 0: die Attrappe kennt keinen laufenden DJ-Teil
      const start_s = llround(K.uhr.sample(kb));
      const ende = llround(K.uhr.sample(kb + (a.bis_beat - a.von_beat) + 2));
      Object.assign(A, { status: 1, start_beat: a.von_beat, ursprung: kb, start_s, b_start: null, cypher: a.quelle === 'cypher',
        freeze: { b, spur: a.spur, kennung: a.kennung, ende, frames: ende - start_s } });
      melde(K, K.jetzt);
    },
  },
  ausgaben(K, s0, s1) {
    const abstand = K.arr.status === 1 || K.arr.status === 2 ? 960 : 24000;
    if (Math.ceil(s0 / abstand) * abstand < s1) melde(K, s0);
  },
  punkte(K, s0, s1) {
    const a = K.arr;
    if (a.freeze && a.status === 2 && a.freeze.ende < s1) {   // Paket K3: Ende des Nachlaufs
      const s = Math.max(a.freeze.ende, s0);
      return [{ s, prio: 2, seq: 0, tu: () => { if (!a.freeze) return; a.status = 0; freezeEnde(K, s, true); melde(K, s); } }];
    }
    if (a.status !== 1 || a.start_s >= s1) return [];
    const s = Math.max(a.start_s, s0);
    return [{ s, prio: 2, seq: 0, tu: () => {
      if (a.status !== 1) return;
      a.status = 2;
      if (a.b_start) K.q(a.b_start, 2, '', s);
      if (a.freeze) K.q(a.freeze.b, 2, '', s);   // Paket K3: Einsatz des Freeze
      a.b_start = null;
      melde(K, s);
    } }];
  },
};
