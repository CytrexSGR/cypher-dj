// Plan 1.11 T5 (D17 variant B): the round-trip measurement of an effect host, a small state machine in the callback.
//
// The server orders it with /k/arr/ins_mess <h> while the host has an EMPTY rack (no plugin loaded yet); the core sends ONE impulse of 0.5 on arr_ins_<h>_L, counts the samples until the return
// (arr_insret_<h>_L or _R) exceeds 0.05 in magnitude and reports that count as the round trip; it gives up after 16384 samples. The round trip of an empty rack is exactly 2 x quantum.
// While it runs the measurement owns the send buffers of the host (zero except the impulse) and the stage of the host plays the dry path (ArrHostStufe::setze_messung, set by the kern).
//
// Everything runs in the callback (starte() from the command, block() per sub-block); results are atomics that any thread may read (rundweg, grund, aktiv). Nothing allocates, locks or
// calls out: fixed storage for ARR_INS_HOST hosts. A measurement ends with one of
//   ok            rundweg = the samples from the impulse to the first return sample above the threshold (0 when the return is already above it: the impulse has nothing to do with it)
//   laeuft        the transport runs (at the start: refused; later: it started, the measurement ends, the keyed answer is the transport)
//   host_fehlt    the host is not healthy (at the start refused; later: it fell)
//   kein_rueckweg 16384 samples without a return
#pragma once

#include <atomic>
#include <cstdint>

#include "cypherdj/arr_playback.h"

namespace cdj {

constexpr float HOST_MESS_IMPULS = 0.5f;
constexpr float HOST_MESS_SCHWELLE = 0.05f;
constexpr int HOST_MESS_MAX = 16384;

class ArrHostMessung {
 public:
  enum class Grund : int32_t { ok = 0, laeuft = 1, host_fehlt = 2, kein_rueckweg = 3 };
  // The wire name of a reason ("" for ok), as /e/ins_mess carries it.
  static const char* name(Grund g) noexcept {
    switch (g) {
      case Grund::laeuft: return "laeuft";
      case Grund::host_fehlt: return "host_fehlt";
      case Grund::kein_rueckweg: return "kein_rueckweg";
      default: return "";
    }
  }

  // Arm a measurement of host h. Callback thread. ok: armed (aktiv(h) is true, the impulse goes out with the next block()). Otherwise the named refusal and nothing is armed; the previous result is
  // kept. Order: the transport first (laeuft, also when a measurement of this host already runs), then the host (host_fehlt, also an h outside 1..ARR_INS_HOST).
  Grund starte(int h, bool laeuft, bool gesund) noexcept;
  // One sub-block of host h, after the stage wrote its send. m samples, aus_* are the writable send buffers (the measurement zeroes them and writes the impulse), rueck_* the return of the same
  // samples (nullptr = port missing: reads as silence). Returns true in the call that ends the measurement; the result is then readable. Without a running measurement it touches nothing.
  bool block(int h, float* aus_l, float* aus_r, const float* rueck_l, const float* rueck_r, int m, bool laeuft, bool gesund) noexcept;

  bool aktiv(int h) const noexcept { return ok_h(h) && s_[h - 1].aktiv.load(std::memory_order_acquire); }
  int rundweg(int h) const noexcept { return ok_h(h) ? s_[h - 1].rundweg.load(std::memory_order_acquire) : -1; }   // the last result, -1 without one or when it failed
  Grund grund(int h) const noexcept { return ok_h(h) ? static_cast<Grund>(s_[h - 1].grund.load(std::memory_order_acquire)) : Grund::host_fehlt; }

 private:
  static bool ok_h(int h) noexcept { return h >= 1 && h <= ARR_INS_HOST; }
  struct Stand {
    std::atomic<bool> aktiv{false};
    std::atomic<int> rundweg{-1};
    std::atomic<int32_t> grund{0};
    int gezaehlt = 0;      // samples since the impulse (callback only)
    bool impuls = false;   // the impulse is still to be sent (callback only)
  };
  Stand s_[ARR_INS_HOST];
  void ende(Stand& s, int rundweg, Grund g) noexcept {
    s.rundweg.store(rundweg, std::memory_order_release);
    s.grund.store(static_cast<int32_t>(g), std::memory_order_release);
    s.aktiv.store(false, std::memory_order_release);
  }
};

}  // namespace cdj
