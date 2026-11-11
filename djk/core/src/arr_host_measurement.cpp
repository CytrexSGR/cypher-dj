// Plan 1.11 T5: the round-trip measurement of an effect host, see arr_host_measurement.h.
#include "cypherdj/arr_host_measurement.h"

#include <cmath>

namespace cdj {

ArrHostMessung::Grund ArrHostMessung::starte(int h, bool laeuft, bool gesund) noexcept {
  if (laeuft) return Grund::laeuft;
  if (!ok_h(h) || !gesund) return Grund::host_fehlt;
  Stand& s = s_[h - 1];
  if (s.aktiv.load(std::memory_order_acquire)) return Grund::laeuft;   // one measurement per host at a time
  s.gezaehlt = 0;
  s.impuls = true;
  s.aktiv.store(true, std::memory_order_release);
  return Grund::ok;
}

bool ArrHostMessung::block(int h, float* aus_l, float* aus_r, const float* rueck_l, const float* rueck_r, int m, bool laeuft, bool gesund) noexcept {
  if (!ok_h(h) || m <= 0) return false;
  Stand& s = s_[h - 1];
  if (!s.aktiv.load(std::memory_order_acquire)) return false;
  if (laeuft) {
    ende(s, -1, Grund::laeuft);
    return true;
  }
  if (!gesund) {
    ende(s, -1, Grund::host_fehlt);
    return true;
  }
  for (int t = 0; t < m; ++t) {   // the send: zero, with the impulse on the first sample of the measurement
    if (aus_l) aus_l[t] = 0.0f;
    if (aus_r) aus_r[t] = 0.0f;
  }
  if (s.impuls) {
    if (aus_l) aus_l[0] = HOST_MESS_IMPULS;
    s.impuls = false;
  }
#ifdef CYPHERDJ_MUTATION_HOST_MESS_SCHWELLE
  constexpr float schwelle = 0.0f;   // error case: the threshold is gone, any hum on the return counts as the answer
#else
  constexpr float schwelle = HOST_MESS_SCHWELLE;
#endif
  for (int t = 0; t < m; ++t) {
    const int idx = s.gezaehlt + t;
    if (idx >= HOST_MESS_MAX) {
      ende(s, -1, Grund::kein_rueckweg);
      return true;
    }
    const float a = rueck_l ? rueck_l[t] : 0.0f, b = rueck_r ? rueck_r[t] : 0.0f;
    if ((std::isfinite(a) && std::fabs(a) > schwelle) || (std::isfinite(b) && std::fabs(b) > schwelle)) {
      ende(s, idx, Grund::ok);
      return true;
    }
  }
  s.gezaehlt += m;
  if (s.gezaehlt >= HOST_MESS_MAX) {   // 16384 samples seen, no return
    ende(s, -1, Grund::kein_rueckweg);
    return true;
  }
  return false;
}

}  // namespace cdj
