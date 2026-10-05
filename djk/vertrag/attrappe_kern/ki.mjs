// KI-Stopp und -Freigabe, KI-Spur, Stufe, Vorschlagskanal, LEDs, Kiste, Mapping, Latenz (SCHNITTSTELLEN §4.7) und der
// Prüfklick /test/klick (ROADMAP Z1). Die Attrappe hat weder Controller noch Ton: LEDs, Kiste, Mapping und Latenz
// werden angenommen und gespeichert, sonst ohne Wirkung. Die Ausblende der KI-Spur ist ein kerninterner Teil ohne
// Quittung; I2 hält sie nicht an (die Stopp-Taste nimmt der KI sofort alles, ADR 013).

import { SPIELKANAELE, KANALZUG_KANAELE, LEDS } from './vertrag.mjs';

const STOPP_BEATS = 4;

function kiStopp(K, s, quelle, grund) {
  for (const t of K.offeneTeile().filter((x) => x.quelle === 'cypher')) K.abbrechen(t, s, 'ki_stopp');
  for (const k of K.ki.spur) {
    const pfad = `${k}/fader`;
    const r = K.r.get(pfad);
    if (r.halter === 'mensch') continue;
    const t = { b: { key: `kern:ki_stopp:${k}:${s}`, intern: true }, art: 'regler', quelle, plan: '', teil: 0, gruppe: '', hoerschein: '',
      pfad, nach: -200, form: 0, ab: K.uhr.beat(s), dauer: STOPP_BEATS, politik: 1, raster: 0, seq: ++K.seq };
    t.ab_eff = t.ab;
    t.dauer_eff = t.dauer;
    t.status = 'wartet';
    K.teile.push(t);
    K.starte(t, s);
  }
  K.ki.gestoppt = true;
  K.leds.ki_gestoppt = 1;
  K.aus('/e/ki', [1, grund, BigInt(s)]);
}

function kiFrei(K, s, grund) {
  K.ki.gestoppt = false;
  K.leds.ki_gestoppt = 0;
  K.aus('/e/ki', [0, grund, BigInt(s)]);
}

export default {
  name: 'ki',
  init(K) {
    K.ki = { gestoppt: false, spur: [], stufe: 1, vorschlag: '' };
    K.leds = K.leds ?? {};
    K.latenz = {};
    K.kiStopp = (s, quelle, grund) => kiStopp(K, s, quelle, grund);
    K.kiFrei = (s, grund) => kiFrei(K, s, grund);
  },
  befehle: {
    '/k/ki/stopp': (K, a, b) => K.sofort(b, (s) => { kiStopp(K, s, a.quelle, 'ki_stopp'); return null; }),
    '/k/ki/frei': (K, a, b) => {
      if (a.quelle !== 'andreas') return K.q(b, 6, 'nur_hand');
      K.sofort(b, (s) => { kiFrei(K, s, 'frei'); return null; });
    },
    '/k/ki/spur': (K, a, b) => {
      const liste = a.kanaele === '' ? [] : a.kanaele.split(',').map((x) => x.trim());
      if (liste.some((k) => !SPIELKANAELE.includes(k))) return K.q(b, 6, 'unbekannter_regler');
      K.sofort(b, () => { K.ki.spur = liste; return null; });
    },
    '/k/ki/stufe': (K, a, b) => {
      if (!(a.stufe >= 0 && a.stufe <= 3)) return K.q(b, 6, 'ausserhalb_bereich');
      K.sofort(b, () => { K.ki.stufe = a.stufe; return null; });
    },
    '/k/vorschlag_kanal': (K, a, b) => {
      if (a.kanal !== '' && !SPIELKANAELE.includes(a.kanal)) return K.q(b, 6, 'unbekannter_regler');
      K.sofort(b, () => { K.ki.vorschlag = a.kanal; return null; });
    },
    '/k/led': (K, a, b) => {
      if (!LEDS.has(a.name) || !(a.zustand >= 0 && a.zustand <= 3)) return K.q(b, 6, 'ausserhalb_bereich');
      K.sofort(b, () => { K.leds[a.name] = a.zustand; return null; });
    },
    '/k/kiste': (K, a, b) => K.sofort(b, () => null),
    '/k/mapping': (K, a, b) => K.sofort(b, () => null),
    '/k/latenz': (K, a, b) => {
      if (!/^(erz\/[1-8]|fx\/[1-4])$/.test(a.ziel) || a.samples < 0) return K.q(b, 6, 'ausserhalb_bereich');
      K.sofort(b, () => { K.latenz[a.ziel] = a.samples; return null; });
    },
    '/test/klick': (K, a, b) => {
      if (a.kanal !== 'master' && !KANALZUG_KANAELE.includes(a.kanal)) return K.q(b, 6, 'unbekannter_regler');
      if (a.an === 0) {
        return K.sofort(b, (s) => {
          for (const t of K.teile.filter((x) => x.art === 'klick' && x.kanal === a.kanal && x.status === 'laeuft')) K.beende(t, s);
          return null;
        });
      }
      const t = K.teilNeu(b, { quelle: a.quelle, ab_beat: Math.ceil(K.uhr.beat(K.jetzt) - 1e-9), politik: 1 }, 'klick', { kanal: a.kanal });
      K.einsortieren(t);
    },
  },
  arten: {
    klick: { start: () => 'laeuft', ende() {} },
  },
};
