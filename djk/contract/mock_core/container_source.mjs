// Container input source (INTERFACES §4.10 `/k/container/quelle`, §5.12 `/e/container/quelle`): what feeds container A..D (1..4).
// art 0 = empty, 1 = player (player N feeds container N), 2 = module. The mock only holds the wish and reports it; the switch into the strip belongs
// to the real core. At start all four containers are `player` (container core C5). The state does not survive a restart (the page server sets it again).
// A container is hörbar when art is 2, or art is 1 and its player runs (level.mjs); art 0 is never hörbar.

import { SPIELKANAELE } from './contract.mjs';

export const MELDE_CONTAINER = (K, port) => {
  for (let i = 0; i < SPIELKANAELE.length; i++) K.aus('/e/container/quelle', [i + 1, K.container[i].art], port);
};

export default {
  name: 'container_quelle',
  init(K) {
    K.container = SPIELKANAELE.map(() => ({ art: 1 }));
    K.containerQuelleMelden = (port) => MELDE_CONTAINER(K, port);
  },
  befehle: {
    '/k/container/quelle': (K, a, b) => {
      if (!Number.isInteger(a.container) || a.container < 1 || a.container > 4 || !Number.isInteger(a.art) || a.art < 0 || a.art > 2) return K.q(b, 6, 'ausserhalb_bereich');
      K.sofort(b, () => {
        K.container[a.container - 1].art = a.art;
        K.aus('/e/container/quelle', [a.container, a.art]);
        return null;
      });
    },
  },
};
