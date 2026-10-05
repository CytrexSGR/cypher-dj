#include "cypherdj/bremse.h"

namespace cdj {

BremsUrteil bremse(int zaehler_alt, uint64_t stand_alt, uint64_t stand_neu) noexcept {
  BremsUrteil u;
  if (stand_neu == 0) return u;  // B2: Frischstart
  const bool fortschritt = stand_neu >= stand_alt && stand_neu - stand_alt >= BREMSE_FORTSCHRITT;
  const int alt = zaehler_alt < 0 ? 0 : (zaehler_alt > BREMSE_MAX ? BREMSE_MAX : zaehler_alt);
  u.zaehler = fortschritt ? 0 : (alt + 1 > BREMSE_MAX ? BREMSE_MAX : alt + 1);  // gesättigt: kein Überlauf
  u.ohne_zustand = u.zaehler >= BREMSE_SCHWELLE;
  return u;
}

}  // namespace cdj
