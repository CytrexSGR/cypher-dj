// KI-Stopp und -Freigabe, KI-Spur, Stufe, Vorschlagskanal, LEDs, Kiste, Mapping, Latenz (SCHNITTSTELLEN §4.7) und der
// Prüfklick /test/klick (ROADMAP Z1). Die Attrappe hat weder Controller noch Ton: LEDs, Kiste, Mapping und Latenz
// werden angenommen und gespeichert, sonst ohne Wirkung. Entscheidung E-a (2026-10-20): der KI-Stopp hält nur Cyphers Hand an (Teile ab,
// ihr wartender Start und ihr Freeze enden, weitere Befehle abgelehnt; ein laufender Transport läuft weiter) und senkt keinen Fader; die KI-Spur-Listen werden geführt und senken nichts.

import { SPIELKANAELE, KANALZUG_KANAELE, LEDS } from './vertrag.mjs';

function kiStopp(K, s, quelle, grund) {
  for (const t of K.offeneTeile().filter((x) => x.quelle === 'cypher')) K.abbrechen(t, s, 'ki_stopp');
  K.arrKiStopp?.(s);   // E-a: Cyphers wartender Start und ihr Freeze enden, ein laufender Transport nicht (vorher D1 K1 Spec 2.12: jeder)
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
    K.ki = { gestoppt: false, kanaele: [], spuren: [], stufe: 1, vorschlag: '' };   // D1 Spec 6.15: zwei Listen
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
      const liste = a.kanaele === '' ? [] : a.kanaele.split(',').map((x) => x.trim()).filter((x) => x !== '');
      // D1 K1, Spec 6.15: auch spur/<ziffern> (spur/2, spur/135; spur/0 = keine); seit E-a nur geführt, der Stopp senkt nichts.
      // Spur-Einträge ersetzen nur die Spur-Liste (S2 sendet nur spur/0), Kanal-Einträge nur die Kanal-Liste (Leitstand); leer: Kanäle.
      const spurEintrag = (k) => k.startsWith('spur/');
      if (liste.some((k) => (spurEintrag(k) ? !/^spur\/(0|[1-8]+)$/.test(k) : !SPIELKANAELE.includes(k)))) {
        return K.q(b, 6, 'unbekannter_regler');
      }
      const spuren = [...new Set(liste.filter(spurEintrag).flatMap((k) => (k === 'spur/0' ? [] : [...k.slice(5)].map((z) => `spur/${z}`))))];
      const kanaele = liste.filter((k) => !spurEintrag(k));
      const mitSpuren = liste.some(spurEintrag);
      K.sofort(b, () => {
        if (kanaele.length > 0 || !mitSpuren) K.ki.kanaele = kanaele;
        if (mitSpuren) K.ki.spuren = spuren;
        return null;
      });
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
