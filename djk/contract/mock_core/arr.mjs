// Arrangement (INTERFACES §4.11, §5.13; D1 K1) in der Attrappe: Zustand, Quittungen und /zustand/arr wie der Kern,
// ohne Ton. Die Attrappe liest keine Wiedergabe-Datei: /k/arr/laden merkt sich nur nr (Quittung 1 und 3). Der Einsatz
// folgt der Start-Regel des Kerns bei Quantum 256 (jetzt + Vorhalt 512 + 256, dann Quant: 0 sofort, 1 Beat, 2 Takt mit
// (Kern-Beat − start_beat) ≡ 0 mod 4), Quittung 2 am Einsatz-Sample. Stopp gilt sofort (Quittung 1 und 3), ohne Quant.
// /zustand/arr geht bei jeder Änderung hinaus und, wie im Kern (core_arr.cpp arr_zustand), im Takt: 50 Hz (je 960 Samples), solange er
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
// Der Vertragstest in tests/arr.test.mjs liest jede Meldung nach den Feldern aus osc_addresses.ts (K1-Fix 12).
// Wie der Kern (Review): ein wartender Start, der ohne Einsatz endet, bekommt 7 (abbruch, hand, ki_stopp); der KI-Stopp
// beendet einen laufenden Transport von Cypher nicht mehr (Entscheidung E-a, vorher Spec 2.12), wohl aber ihren wartenden Start
// (7 ki_stopp) und ihren Freeze. Während des KI-Stopps lehnt core.mjs alle cypher-Befehle
// ab außer /k/arr/stopp (Spec 6.27, gemeinsamer Fall djk/contract/cases/arr_ki_stopp.json).
import { llround } from './clock.mjs';
import { AUTO_ZIELE } from './contract.mjs';   // field 0..3 of the lane override (§4.11 /k/arr/auto)

const N = 256;
const VORHALT = 2 * N;   // the core: erz_midi_vorhalt(n), exactly the host round trip (was 2 * N + 25 until 2026-11-10)

// Project beat at sample s while playing. With the loop on (bis > von) the beat wraps like the core's: after the loop end it continues at the loop start.
export function projektBeat(K, s) {
  const a = K.arr;
  const p = K.uhr.beat(s) - a.ursprung + a.start_beat;
  const l = a.loop;
  return l.an && l.bis > l.von && p >= l.bis ? l.von + ((p - l.von) % (l.bis - l.von)) : p;
}

function melde(K, s) {
  const a = K.arr;
  const p = a.status === 2 ? projektBeat(K, s) : a.start_beat;
  const w = [a.nr, a.status, a.loop.an ? 1 : 0, p, BigInt(a.start_s), a.start_beat, a.metro.an ? 1 : 0, 0.0];   // 1.10 Slice 2: limiter_db (die Attrappe hat keinen Limiter: immer 0)
  if (a.freeze && a.status !== 0) w[1] = 3;   // Paket K3: Status freeze, solange er wartet oder läuft (wie der Kern)
  if (K.mutation.has('arr_zustand_alt')) w.pop();   // Fehlerfall: Form ohne das letzte Feld (limiter_db), der Vertragstest muss es sehen
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

// 1.12 Slice 3 (D6): the lanes change (a load, the test hook). Every overridden field that has no lane any more is cleared and reported as 0 at once.
const schluessel = (k) => k.split('/').map(Number);
function auto_aus(K, key, zustand) { const [sp, fe] = schluessel(key); K.aus('/e/auto', [sp, AUTO_ZIELE[fe], zustand]); }
function lanenTauschen(K, neu) {
  K.arr.lanen = neu;
  const weg = [...K.arr.auto].filter((k) => !neu.has(k)).sort((x, y) => { const [a, b] = schluessel(x), [c, d] = schluessel(y); return a - c || b - d; });
  for (const k of weg) { K.arr.auto.delete(k); auto_aus(K, k, 0); }
}
// the lanes of <arr_ordner>/wiedergabe-<nr>.json (spuren[].nr with spuren[].auto[].ziel); null if the file is not there or unreadable (the lanes stay as they are)
function lanenAusDatei(K, nr) {
  if (!K.cfg.arr_ordner) return null;
  try {
    const j = JSON.parse(fs.readFileSync(path.join(K.cfg.arr_ordner, `wiedergabe-${nr}.json`), 'utf8'));
    const lanen = new Set();
    // 1.12 slice 5 (D9): a lane with `relativ: true` is a summand of the value stack; the core overrides only absolute lanes, so a relative lane makes no field overridable here.
    // `gain_hk` (clip gain envelopes in spuren[].clips[]) is ignored: this stand-in models no clip gain.
    for (const sp of j.spuren ?? []) for (const l of sp.auto ?? []) if (AUTO_ZIELE.includes(l.ziel) && l.relativ !== true) lanen.add(`${sp.nr}/${AUTO_ZIELE.indexOf(l.ziel)}`);
    return lanen;
  } catch {
    return null;
  }
}

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

const PUNKT_ABSTAND = 960;   // 50 Hz per regulator (REGLER_MELDUNG_ABSTAND)
function punktStand(K, spur, ziel) {
  const key = `${spur}/${ziel}`;
  if (!K.arr.punkte.has(key)) K.arr.punkte.set(key, { spur, ziel, gemeldet: -Infinity, halt: null });
  return K.arr.punkte.get(key);
}

export default {
  name: 'arr',
  init(K) {
    K.arr = { nr: -1, status: 0, start_beat: 0, ursprung: 0, start_s: -1, b_start: null, cypher: false,
      loop: { an: false, von: 0, bis: 0 }, metro: { an: false, pegel_db: -12, ziel: 0 },
      auto: new Set(),     // 1.12 Slice 3: overridden fields "spur/feld" (spur 1..32, feld 0..3)
      export: { ungesund: 0, luecken: 0 },   // plan 1.11 T12: the numbers the stand-in reports for /k/arr/export_lauf
      host: { gesund: [0, 0, 0, 0] },   // plan 1.11 T5: the server's health flag per effect host (the stand-in has no edge check: health = the flag)
      arm: new Map(),      // 1.12 Slice 3 (D11): armed tracks, spur 1..32 -> mode (0 touch, 1 latch, 2 write); a new core generation (a new stand-in) starts empty
      punkte: new Map(),   // 1.12 Slice 3 (D12): "spur/ziel" -> { gemeldet: sample of the block end that sent the last point, halt: the held point or null }
      lanen: new Set() };  // the fields that have a lane in the loaded playback, same keys
    // 1.12 Slice 3 test hook: declares the lanes (pairs [spur, ziel]) as a load would; overridden fields without a lane go (D6) with /e/auto 0
    K.arrLanen = (paare) => { lanenTauschen(K, new Set(paare.map(([sp, z]) => `${sp}/${AUTO_ZIELE.indexOf(z)}`))); };
    // 1.12 Slice 3 test hook (D12, INTERFACES 5.13 /e/auto_punkt): a grip of the hand with its project beat and value, as the core sees it inside the current block.
    // Modelled like the core: only an armed track, only while the transport plays (status 2, else false), only the fields of the contract. The point is not sent here but at
    // the end of the block (nachBlock): at once when the 50 Hz window of that regulator (960 samples from the last sent point) is free, else it is HELD and a newer grip replaces
    // it (trailing value, the last value of a gesture arrives). When the transport does not play any more a held point is sent in that block, after the stopped /zustand/arr.
    // A disarm drops the held points of the track but keeps the windows. Returns true if the grip was accepted.
    K.arrProjektBeat = (s) => projektBeat(K, s);
    K.arrPunkt = (spur, ziel, beat, wert) => {
      if (!K.arr.arm.has(spur) || K.arr.status !== 2 || !AUTO_ZIELE.includes(ziel)) return false;
      const p = punktStand(K, spur, ziel);
      p.halt = { beat, wert };
      return true;
    };
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
    K.arrKiStopp = (s) => {   // Entscheidung E-a (2026-10-20), wie Arrangement::ki_stopp: Cyphers wartender Start und ihr Freeze enden, ein laufender Transport nicht
      const a = K.arr;
      if (a.status === 0 || !a.cypher || (a.status !== 1 && !a.freeze)) return;
      startAbbrechen(K, s, 'ki_stopp');
      a.status = 0;
      freezeEnde(K, s, false, 'ki_stopp');   // Paket K3: Cyphers Freeze endet mit dem KI-Stopp (ihr Auftrag, kein Klang für Andreas)
      melde(K, s);
    };
    // Spec 6.33 (core.mjs /k/tempo/rampe ruft es für jede Rampe im Bereich, gleich von welcher Quelle): bricht den Freeze ab
    K.arrTempoRampe = (s) => {
      const a = K.arr;
      if (!a.freeze || K.mutation.has('arr_freeze_rampe_ohne_abbruch')) return;
      a.status = 0;
      freezeEnde(K, s, false);
      melde(K, s);
    };
  },
  // Fix L1 wie der Kern: /k/set/neu (core.mjs ruft es am Anfang der neuen Achse) bricht einen wartenden oder laufenden
  // Freeze ab; mit der Mutation arr_freeze_set_neu_bleibt liefe er auf der neuen Achse weiter
  setNeu(K) {
    const a = K.arr;
    a.punkte.clear();   // the rate windows count in samples of the old axis
    if (!a.freeze || K.mutation.has('arr_freeze_set_neu_bleibt')) return;
    a.status = 0;
    freezeEnde(K, 0, false);
    melde(K, 0);
  },
  befehle: {
    '/k/arr/laden': (K, a, b) => {
      if (!(a.nr >= 0)) return K.q(b, 6, 'ausserhalb_bereich');
      K.q(b, 1);   // like beidesQ, but the lane events of a load follow the receipt 3 (as in the core: events leave at the end of the cycle)
      K.sofortQ.push(() => {
        const s = K.stempel;
        K.arr.nr = a.nr;
        if (K.arr.freeze) { K.arr.status = 0; freezeEnde(K, s, false); }
        K.q(b, 3);
        melde(K, s);
        const lanen = lanenAusDatei(K, a.nr);
        if (lanen) lanenTauschen(K, lanen);
      });
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
      // 1.8 S4b (D7): a recording that waits for its entry brings its count-in; the entry moves 4 * bars core beats behind the first quant point (like Arrangement::start).
      // Test hook ATTRAPPE_EINSATZ_VERZUG_MS (tests only): the entry moves by that many milliseconds more, so a test can make the receipt 2 arrive late.
      if (K.rec?.status === 2 && K.arr.status === 0) kb += 4 * (K.rec.vorzaehler ?? 0);
      const verzug = Number(process.env.ATTRAPPE_EINSATZ_VERZUG_MS ?? 0);
      if (verzug > 0) kb += (verzug / 1000) * K.uhr.bpm(K.jetzt) / 60;
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
    // 1.12 Slice 3 (§4.11): the lane override. Like the core: the filter is the transport (D5: an 0 while stopped is acknowledged, nothing changes, no /e/auto);
    // an 1 clears also while stopped (D6); cypher may not override (D9); the state survives stop and start; without a lane for the field nothing happens (acknowledged).
    '/k/arr/auto': (K, a, b) => {
      const feld = AUTO_ZIELE.indexOf(a.ziel);
      if (!(a.spur >= 0 && a.spur <= 32) || (a.an !== 0 && a.an !== 1)) return K.q(b, 6, 'format');
      if (feld < 0) return K.q(b, 6, 'auto_ziel_unbekannt');
      if (a.spur === 0 && a.an === 0) return K.q(b, 6, 'format');
      if (a.an === 0 && a.quelle === 'cypher' && !K.mutation.has('arr_auto_cypher_uebersteuert')) return K.q(b, 6, 'nur_andreas');
      K.q(b, 1);
      K.sofortQ.push(() => {
        const set = K.arr.auto;
        const aus = (key, zustand) => auto_aus(K, key, zustand);
        const wechsel = [];
        if (a.an === 0) {
          const key = `${a.spur}/${feld}`;
          if (K.arr.status === 2 && K.arr.lanen.has(key) && !set.has(key)) { set.add(key); wechsel.push([key, 1]); }
        } else {
          const keys = a.spur === 0 ? [...set] : [`${a.spur}/${feld}`].filter((k) => set.has(k));
          keys.sort((x, y) => { const [s1, f1] = schluessel(x), [s2, f2] = schluessel(y); return s1 - s2 || f1 - f2; });
          for (const key of keys) { set.delete(key); wechsel.push([key, 0]); }
        }
        K.q(b, 3);
        for (const [key, z] of wechsel) aus(key, z);
      });
    },
    // 1.12 Slice 3 (§4.11, D11): arm a track for automation recording. Only andreas; spur 0 only disarms; the state lives in the stand-in like in the core.
    '/k/arr/arm': (K, a, b) => {
      if (!(a.spur >= 0 && a.spur <= 32) || (a.an !== 0 && a.an !== 1) || !(a.modus >= 0 && a.modus <= 2) || (a.spur === 0 && a.an === 1)) return K.q(b, 6, 'format');
      if (a.quelle !== 'andreas' && !K.mutation.has('arr_arm_cypher')) return K.q(b, 6, 'nur_andreas');
      K.q(b, 1);
      K.sofortQ.push(() => {
        const spuren = a.spur === 0 ? [...K.arr.arm.keys()] : [a.spur];
        for (const sp of spuren) {
          if (a.an === 1) K.arr.arm.set(sp, a.modus);
          else {
            K.arr.arm.delete(sp);
            for (const p of K.arr.punkte.values()) if (p.spur === sp) p.halt = null;   // the held point goes, the rate window stays
          }
        }
        K.q(b, 3);
      });
    },
    // plan 1.11 T5 (§4.11): the server's health flag of an effect host. Answered by /e/ins_host (h, health). The stand-in has no JACK edges, so health is the flag alone.
    '/k/arr/ins_host': (K, a, b) => {
      if (!(a.h >= 1 && a.h <= 4) || (a.gesund !== 0 && a.gesund !== 1)) return K.q(b, 6, 'ausserhalb_bereich');
      K.arr.host.gesund[a.h - 1] = a.gesund;
      K.aus('/e/ins_host', [a.h, a.gesund]);
    },
    // plan 1.11 T5 (§4.11): the round trip of an effect host with an empty rack: refused `laeuft` while the transport is not stopped, `host_fehlt` while the host is not healthy,
    // else 2 x quantum (512, measured in T1). Answered by /e/ins_mess (h, rundweg, grund).
    '/k/arr/ins_mess': (K, a, b) => {
      if (!(a.h >= 1 && a.h <= 4)) return K.q(b, 6, 'ausserhalb_bereich');
      if (K.arr.status !== 0) return K.aus('/e/ins_mess', [a.h, -1, 'laeuft']);
      if (!K.arr.host.gesund[a.h - 1]) return K.aus('/e/ins_mess', [a.h, -1, 'host_fehlt']);
      K.aus('/e/ins_mess', [a.h, 2 * N, '']);
    },
    // plan 1.11 T12 (§4.11): the real-time export of the production master. The stand-in plays no audio: the run is answered at once (receipts 1 and 3) with a file of zeros of the exact range
    // length (never replacing: datei_fehlt) and /e/export_lauf; K.arr.export.{ungesund, luecken} are the numbers a test wants the core to report (default 0).
    '/k/arr/export_lauf': (K, a, b) => {
      if (typeof a.pfad !== 'string' || !a.pfad.endsWith('.f32') || !(a.von_beat >= 0) || !(a.bis_beat - a.von_beat >= 1)) return K.q(b, 6, 'ausserhalb_bereich');
      if (!(a.bis_beat - a.von_beat <= 3600)) return K.q(b, 6, 'zu_gross');
      const A = K.arr;
      if (A.nr < 0) return K.q(b, 6, 'nicht_geladen');
      if (A.status !== 0) return K.q(b, 6, 'belegt');
      if (rampeOffen(K)) return K.q(b, 6, 'tempo_rampe');
      K.q(b, 1);
      const kb = K.uhr.beat(K.jetzt + VORHALT + N);
      const frames = llround(K.uhr.sample(kb + (a.bis_beat - a.von_beat))) - llround(K.uhr.sample(kb));
      const z = A.export ?? { ungesund: 0, luecken: 0 };
      let ok = true;
      try { fs.writeFileSync(a.pfad, Buffer.alloc(frames * 8), { flag: 'wx' }); } catch { ok = false; }
      if (ok) K.q(b, 3);
      else K.q(b, 7, 'datei_fehlt');
      K.aus('/e/export_lauf', [BigInt(ok ? frames : 0), 0.0, z.luecken, z.ungesund, ok ? '' : 'datei_fehlt']);
    },
    '/k/arr/freeze': (K, a, b) => {   // Paket K3 (KI-Stopp für cypher prüft core.mjs vor allem anderen)
      if (!(a.spur >= 1 && a.spur <= 32) || !(a.von_beat >= 0) || !(a.bis_beat - a.von_beat >= 1) ||
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
  // 1.12 Slice 3: the points of the block, in the order of the core (spur, then field)
  nachBlock(K, s0, s1) {
    const spielt = K.arr.status === 2;
    const offen = [...K.arr.punkte.values()].filter((p) => p.halt && K.arr.arm.has(p.spur));
    offen.sort((x, y) => x.spur - y.spur || AUTO_ZIELE.indexOf(x.ziel) - AUTO_ZIELE.indexOf(y.ziel));
    for (const p of offen) {
      if (spielt && !K.mutation.has('arr_punkt_ohne_drossel') && s1 - p.gemeldet < PUNKT_ABSTAND) continue;   // held until the window ends
      K.aus('/e/auto_punkt', [`spur/${p.spur}/${p.ziel}`, p.halt.beat, p.halt.wert]);
      p.halt = null;
      p.gemeldet = s1;
    }
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
