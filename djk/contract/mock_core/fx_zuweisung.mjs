// FX assignment (INTERFACES §4.10 `/k/fx/zuweisung`, §5.12 `/e/fx/zuweisung`): channel on or off a unit.
// Units 1 and 2 are the Beat FX (channels of fx_kanal_12, with master); unit 3 is FX3, the insert on fx/3 that carries the remix graph
// (every source channel of fx_kanal_3, never master). The fake core holds the flags and reports each change; the audio side
// (blend, fallback without a graph) belongs to the real core. A restart forgets all assignments, as the real core does.
import { QUELLEN } from './contract.mjs';

export const KANAL_12 = ['deck/1', 'deck/2', 'deck/3', 'deck/4', 'erz/1', 'erz/2', 'erz/3', 'pad/1', 'pad/2', 'master'];
export const KANAL_3 = ['deck/1', 'deck/2', 'deck/3', 'deck/4', 'erz/1', 'erz/2', 'erz/3', 'erz/4', 'erz/5', 'erz/6', 'erz/7', 'erz/8', 'pad/1', 'pad/2'];

export default {
  name: 'fx_zuweisung',
  init(K) { K.fxZuweisung = new Map(); },
  befehle: {
    '/k/fx/zuweisung': (K, a, b) => {
      const liste = a.einheit === 3 ? KANAL_3 : KANAL_12;
      if (!QUELLEN.includes(a.quelle) || ![1, 2, 3].includes(a.einheit) || !liste.includes(a.kanal) || (a.an !== 0 && a.an !== 1)) {
        return K.q(b, 6, 'ausserhalb_bereich');
      }
      K.sofort(b, () => {
        K.fxZuweisung.set(`${a.einheit}|${a.kanal}`, a.an === 1);
        K.aus('/e/fx/zuweisung', [a.einheit, a.kanal, a.an]);
        return null;
      });
    },
  },
};
