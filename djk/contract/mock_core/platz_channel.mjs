// Place channel (INTERFACES §4.10 `/k/platz/kanal`, §5.12 `/e/platz/kanal`): the content of DJ view place 3 / 4 sounds through pad/1 / pad/2.
// The mock only holds the wish and reports it; the redirect into the pad input and its blend belong to the real kern (Mixer::platz_kanal_setze).
// It does not survive a restart (the page server sends it again).

export default {
  name: 'platz_kanal',
  init(K) { K.platzKanal = [0, 0]; },
  befehle: {
    '/k/platz/kanal': (K, a, b) => {
      if (!Number.isInteger(a.pad) || a.pad < 1 || a.pad > 2 || !Number.isInteger(a.inhalt) || a.inhalt < 0 || a.inhalt > 3) return K.q(b, 6, 'ausserhalb_bereich');
      K.sofort(b, () => {
        K.platzKanal[a.pad - 1] = a.inhalt;
        K.aus('/e/platz/kanal', [a.pad, a.inhalt]);
        return null;
      });
    },
  },
};
