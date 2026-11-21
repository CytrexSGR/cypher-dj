// Container core K7: see arr_stream_sink.h.
#include "cypherdj/arr_stream_sink.h"

#include <algorithm>

namespace cdj {

int ArrStromSenke::strom_von(int spur) const noexcept {
  if (spur < 0 || spur >= ARR_SPUREN) return -1;
  const ArrSnapshot* s = arr_.snapshot();
  if (!s || s->spur[spur].art != ArrArt::strom) return -1;
  const int n = s->spur[spur].strom;
  return n >= 1 && n <= QP_STROEME ? n - 1 : -1;
}

void ArrStromSenke::block(int spur, int64_t, int m, float* l, float* r) noexcept {
  const int e = strom_von(spur);
  if (e < 0) {
    if (spur >= 0 && spur < ARR_SPUREN) aktiv_[spur].store(false, std::memory_order_relaxed);
    return;
  }
  m = std::min(m, MIX_BLOCK);
  const float* sl = q_.strom_l[e];
  const float* sr = q_.strom_r[e];
  bool laut = false;
  for (int t = 0; t < m; ++t) {
#ifdef CYPHERDJ_MUTATION_STROM_SENKE_EIN_SAMPLE
    const float a = t > 0 ? sl[t - 1] : 0.0f, b = t > 0 ? sr[t - 1] : 0.0f;   // error case: one frame late
#else
    const float a = sl[t], b = sr[t];
#endif
    l[t] += a;
    r[t] += b;
    laut = laut || a != 0.0f || b != 0.0f;
  }
  aktiv_[spur].store(laut, std::memory_order_relaxed);
}

bool ArrStromSenke::leer(int spur) const noexcept {
  if (strom_von(spur) < 0) return true;
  return !aktiv_[spur].load(std::memory_order_relaxed);
}

}  // namespace cdj
