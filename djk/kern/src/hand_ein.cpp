// Scheibe 35: MIDI vom Eingang hand_in -> Aktion des Kerns (hand_ein.h). Echtzeitfest.
#include "cypherdj/hand_ein.h"

#include <cstring>

#include "hand/naht_stellwerk.h"

namespace cdj {

namespace sw = cypherdj::stellwerk;

int HandEin::ereignis(const uint8_t* daten, size_t groesse, uint32_t versatz, int64_t s0, uint32_t n,
                      const sw::Stellwerk& st, HandAktion* aus) {
  hand::Ausgabe a;
  if (!ueb_.ereignis(daten, groesse, s0, versatz, n, &a)) return 0;
#ifdef CYPHERDJ_MUTATION_HAND_FOLGEBLOCK
  // Fehlerfall der Abnahme (Plan 35 E2): das Ereignis wirkt am Anfang des Folgeblocks statt an seinem Versatz (wie 19
  // Mutation M01 blockgrenze, 09 Probe b naiv_block): sample = Zyklusanfang + n
  a.sample = s0 + static_cast<int64_t>(n);
#endif
  const hand::Mapping& m = *ueb_.mapping();
  const hand::Eintrag& e = m.eintrag[a.eintrag];
#ifdef CYPHERDJ_MUTATION_HAND_KODIERUNG
  // Fehlerfall Plan 35 Task 3: Kodierung des Encoders vertauscht (zweierkomplement <-> versatz64), die Raste läuft in
  // die falsche Richtung
  if (a.art == hand::AusgabeArt::regler_relativ && groesse >= 3) {
    const hand::Kodierung k = e.kodierung == hand::Kodierung::zweierkomplement ? hand::Kodierung::versatz64
                                                                               : hand::Kodierung::zweierkomplement;
    a.wert = hand::rasten(k, daten[2]);
    a.x = static_cast<float>(a.wert * hand::SCHRITT_RELATIV);
  }
#endif
  *aus = HandAktion{};
  aus->sample = a.sample;
  aus->wert = a.wert;
  switch (a.art) {
    case hand::AusgabeArt::regler_absolut:
    case hand::AusgabeArt::regler_relativ:
    case hand::AusgabeArt::regler_beruehrung:
    case hand::AusgabeArt::regler_umschalten: {
      const float jetzt = e.regler >= 0 ? st.wert_fest(e.regler) : 0.0f;  // F18: Umschalten nach dem Ziel der Rampe
      if (!hand::zu_griff(a, m, jetzt, &aus->griff)) return 0;
      aus->art = HandArt::griff;
      return 1;
    }
    case hand::AusgabeArt::deck:
      aus->art = HandArt::deck;
      aus->deck = e.deck;
      aus->aktion = e.aktion;
      aus->quant = e.quant;
      return 1;
    case hand::AusgabeArt::tempo:
      aus->art = HandArt::tempo;
      return 1;
    case hand::AusgabeArt::taste:
      if (e.art == hand::Art::taste && a.wert == 0) return 0;  // Loslassen einer Taste: keine Meldung, keine Wirkung
      aus->art = HandArt::taste;
      aus->taste = e.taste;
      return 1;
  }
  return 0;
}

bool hand_port_name(const char* name, const char* instanz, char* aus, size_t max) {
  const size_t ln = std::strlen(name);
  if (!instanz || !instanz[0]) {
    if (ln + 1 > max) return false;
    std::memcpy(aus, name, ln + 1);
    return true;
  }
  // Client-Teil: nach dem ersten ':' bis zum nächsten ':'; nur eigene Clients ("cypherdj-...") bekommen die Instanz
  const char* c = std::strchr(name, ':');
  const char* ende = c ? std::strchr(c + 1, ':') : nullptr;
  if (!c || !ende || std::strncmp(c + 1, "cypherdj-", 9) != 0) {
    if (ln + 1 > max) return false;
    std::memcpy(aus, name, ln + 1);
    return true;
  }
  const size_t li = std::strlen(instanz);
  const size_t vorn = static_cast<size_t>(ende - name);
  if (ln + li + 2 > max) return false;
  std::memcpy(aus, name, vorn);
  aus[vorn] = '-';
  std::memcpy(aus + vorn + 1, instanz, li);
  std::memcpy(aus + vorn + 1 + li, ende, ln - vorn + 1);
  return true;
}

}  // namespace cdj
