// Baukasten S16 (INTERFACES §4.10 `/k/graph/frage`, §5.12 `/e/graph`): the fake kern holds no graphs (its /erz/strom
// takes only midi:/pad: targets and it has no /k/kanal/graph handler), so it reports every graph-capable slot as empty.
import { QUELLEN } from './vertrag.mjs';

export const SLOTS = ['deck/1', 'deck/2', 'deck/3', 'deck/4', 'fx/3', 'fx/4', 'erz/1', 'erz/2', 'erz/3', 'erz/5', 'erz/6', 'erz/7', 'pad/1', 'pad/2'];

export default {
  name: 'graph',
  init() {},
  befehle: {
    '/k/graph/frage': (K, a, b) => {
      if (!QUELLEN.includes(a.quelle)) return K.q(b, 6, 'ausserhalb_bereich');
      for (const s of SLOTS) K.aus('/e/graph', [s, '']);
      K.q(b, 1);
      K.q(b, 3);
    },
  },
};
