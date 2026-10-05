// FX-Routing (SCHNITTSTELLEN §4.10 `/k/fx/routing`, §5.12 `/e/fx/routing`, Ohr Task 15): Post Fader (0, Vorgabe)
// oder Insert (1) für beide Beat-FX-Einheiten. Die Attrappe hält nur den Wert und meldet ihn; das Umschalten mit
// Gleiten und die Wirkung auf PFL und Hüllkurven-Ring gehören dem echten Kern (Task 17).
// Die Taste ist Andreas' Hand: Quelle cypher bekommt 6 nur_hand. Der Wunsch überlebt keinen Neustart (Rev. 5).

export default {
  name: 'fx_routing',
  init(K) { K.fxRouting = 0; },
  befehle: {
    '/k/fx/routing': (K, a, b) => {
      if (a.quelle === 'cypher') return K.q(b, 6, 'nur_hand');
      if (a.routing !== 0 && a.routing !== 1) return K.q(b, 6, 'ausserhalb_bereich');
      K.sofort(b, () => {
        K.fxRouting = a.routing;
        K.aus('/e/fx/routing', [a.routing]);
        return null;
      });
    },
  },
};
