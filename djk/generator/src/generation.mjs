// S17 race: the kern sends /e/neustart TWICE per generation to every stored subscriber (once as a broadcast at its start,
// once on the subscriber's next heartbeat, net.cpp erstes_in_generation). Announcing the stream on both lets the second
// announcement replace a graph that the page server restored in between (the kern applies /erz/strom in arrival order).
// This rule makes the erzeuger announce once per kern generation.
//
// neustart(g): true when this /e/neustart is the first of generation g (announce, forget the queue, wake up);
//              false for the repeat of the same generation (do nothing).
// willkommen(w): a /k/willkommen carrying another generation than the one announced means a different kern (for example a
//              braked start with generation 0): forget the announced one, so a later /e/neustart of any number announces.
export class NeustartRegel {
  #angemeldet = null;

  neustart(generation) {
    if (generation === this.#angemeldet) return false;
    this.#angemeldet = generation;
    return true;
  }

  willkommen(generation) {
    if (generation !== this.#angemeldet) this.#angemeldet = null;
  }
}
