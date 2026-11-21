// Baukasten S16 (INTERFACES §4.10 `/k/graph/frage`, §5.12 `/e/graph`): the fake kern holds no graphs (its /erz/strom
// takes only midi:/bk: targets and it has no /k/kanal/graph handler), so it reports every graph-capable slot as empty.
import { QUELLEN, SPIELKANAELE } from './contract.mjs';
import { ALLE_STROEME } from '../streams.ts';

export const SLOTS = [...SPIELKANAELE, 'fx/3', 'fx/4', 'master', ...ALLE_STROEME.filter((s) => s !== 1).map((s) => `strom/${s}`)];   // = osc.json graph_platz

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
