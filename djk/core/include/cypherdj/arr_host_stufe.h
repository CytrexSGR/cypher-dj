// Plan 1.11 T4: the effect-host stage of the arrangement mixer (insert kind `host`, pool ins/host/1..ARR_INS_HOST).
//
// A host stage sends the input of its strip out of the core on the JACK ports arr_ins_<h>_L/R, an effect plugin in a host process (Carla, plan 1.11 T2) processes it, and the result comes back on
// arr_insret_<h>_L/R. The round trip is a fixed number of samples (measured in T1: exactly 2 x quantum plus the latency the plugin reports); the loader puts it into ArrStufe::latenz (D4) and the
// delay compensation (arr_pdc.h) accounts for it like for a native stage, so the return of cycle k is simply mixed in at the same sample positions: there is no offset arithmetic here.
//
// block() does, for one host h = 1..ARR_INS_HOST and m samples (m <= ARR_HOST_BLOCK):
//  * the input goes to the send buffer (a copy, the send buffer was zeroed by main.cpp this cycle);
//  * the input is kept in a dry ring of `latenz` samples (own storage of ARR_HOST_LAT_MAX per channel and host, fixed, no allocation anywhere);
//  * the return passes the guard before anything uses it: a non-finite sample reads as 0, a sample beyond +/- 8 is clamped (the bounds of the Wirt return, arr_instrument_host_sink.cpp); each frame in which the
//    guard acted counts once in wachter_zaehler() (a counter, no log in the callback);
//  * the output is the return when the stage is on (an) and the host is healthy (gesund), else the dry signal delayed by latenz, so a bypassed, missing or hung host never moves the strip in time (D6).
//    The two states are one weight that ramps over HOST_BLENDE samples (integer counter, reaches its ends exactly) in both directions: the fade between return and delayed dry is the only health fade
//    (D7: the flag alone switches, no exact-zero rule here). A frame is therefore always a convex combination of the return and the delayed dry signal: two switches at once never open a gap.
// The stage starts on the dry path (weight 0) and fades the return in. A host that has no return pointer (port missing) stays on the dry path.
//
// Threads. Everything except the setters of setze_zeiger() (callback thread, before the block) and setze_gesund() (any thread, an atomic) runs in the callback. A host belongs to exactly one strip of
// a playback, so two lanes never call block() for the same h; the state of one host is its own. Counters are relaxed atomics so that a reader thread may sum them.
#pragma once

#include <atomic>
#include <cstdint>

#include "cypherdj/arr_playback.h"

namespace cdj {

constexpr int HOST_BLENDE = 480;      // fade between return and delayed dry, samples (= INS_BLENDE, 10 ms)
constexpr int ARR_HOST_BLOCK = 1024;  // longest block (= ARR_BLOCK)
constexpr int HOST_GESUND_HALTE = 48000;   // healthy samples before the return fades in again after an outage (1 s, plan 1.11 D6)
constexpr float HOST_RUECK_MAX = 8.0f;   // return guard: |sample| <= 8 (as arr_instrument_host_sink.cpp)
static_assert((ARR_HOST_LAT_MAX & (ARR_HOST_LAT_MAX - 1)) == 0, "the dry ring is indexed with a mask");

class ArrHostStufe {
 public:
  ArrHostStufe();

  // The port buffers of this sub-block, already offset to its first sample (the core hands them from Kern::audio before every arr_->block()); nullptr = port missing. The pointers stay valid for
  // the calls of this block only. aus_*: the writable send buffers, rueck_*: the return. Callback thread only.
  void setze_zeiger(int h, float* aus_l, float* aus_r, const float* rueck_l, const float* rueck_r) noexcept {
    if (h < 1 || h > ARR_INS_HOST) return;
    Wirt& w = h_[h - 1];
    w.aus_l = aus_l;
    w.aus_r = aus_r;
    w.rueck_l = rueck_l;
    w.rueck_r = rueck_r;
  }
  // The health of host h (plan 1.11 T5, D7): ONE atomic per host with two sources, bit 0 = the core's own edge check (setze_kante, main thread, every 500 ms), bit 1 = the server's flag
  // (setze_server, /k/arr/ins_host). gesund = both set. Default 0: a host nobody has declared healthy plays the dry path. Any thread, lock free. A setter that clears a bit also leaves a
  // mark ("fehl"), so that an outage shorter than one block (fall and rise between two blocks) still restarts the hold-off in block(). setze_gesund sets or clears both (direct callers, tests).
  void setze_kante(int h, bool ok) noexcept { setze_quelle(h, 1, ok); }
  void setze_server(int h, bool ok) noexcept { setze_quelle(h, 2, ok); }
  void setze_gesund(int h, bool g) noexcept {
    setze_quelle(h, 1, g);
    setze_quelle(h, 2, g);
  }
  bool gesund(int h) const noexcept { return h >= 1 && h <= ARR_INS_HOST && h_[h - 1].quellen.load(std::memory_order_acquire) == 3; }
  bool kante_ok(int h) const noexcept { return h >= 1 && h <= ARR_INS_HOST && (h_[h - 1].quellen.load(std::memory_order_acquire) & 1) != 0; }
  bool server_ok(int h) const noexcept { return h >= 1 && h <= ARR_INS_HOST && (h_[h - 1].quellen.load(std::memory_order_acquire) & 2) != 0; }
  // The round-trip measurement of host h runs (ArrHostMessung): the stage plays the dry path meanwhile. Any thread.
  void setze_messung(int h, bool an) noexcept {
    if (h >= 1 && h <= ARR_INS_HOST) h_[h - 1].messung.store(an, std::memory_order_release);
  }

  // One block of host h. ein_* and aus_* may be the same buffers (in place). latenz: samples, 0..ARR_HOST_LAT_MAX - 1 (clamped). trocken_*: when not nullptr the delayed dry signal is
  // also written there (the caller blends against it, ArrInserts); same length m.
  // drin: the stage is in the chain (false: it left it and is a tail that fades out). The entry/exit blend (below) is part of block(): the output is the stage output y blended with the undelayed input x,
  // out = x + c (y - x), c = 0..HOST_BLENDE. A stage that enters (trocken_leere(h, latenz): its dry ring is empty and its return carries nothing yet) holds c = 0 for `latenz` samples, until its own output has
  // history, then c rises to the end over HOST_BLENDE samples; a stage that leaves (drin = false) lets c fall back to 0 over HOST_BLENDE samples. Live material is never cut: the strip may repeat or skip
  // `latenz` samples in time at the edit, it never goes silent. A fresh object has c at the end (steady), so a stage that was never "entered" (a direct call) has no blend.
  void block(int h, const float* ein_l, const float* ein_r, float* aus_l, float* aus_r, int m, int latenz, bool an, bool gesund,
             float* trocken_l = nullptr, float* trocken_r = nullptr, bool drin = true) noexcept;

  // The two halves of "cleared", as the native stages have them (ArrInserts::leere / trocken_leere): leere() takes the stage state, weight 0 (the return fades in again); trocken_leere() empties the
  // dry ring. A stage that is switched off is leere()d but keeps its ring, so that the strip does not lose `latenz` samples on the way to the bypass; a stage that enters gets both.
  void leere(int h) noexcept;
  void trocken_leere(int h, int latenz = -1) noexcept;   // latenz >= 0: the latency of the entering stage (the length of the warm-up of its entry blend)
  // The entry/exit blend has run out: no weight on the return and c back at 0 (a tail may end).
#ifdef CYPHERDJ_MUTATION_HOST_OHNE_EIN_AUSBLENDUNG
  bool ruhig(int h) const noexcept { return h >= 1 && h <= ARR_INS_HOST && h_[h - 1].pos == 0; }   // error case: a tail ends when the return weight is gone, c is not waited for
#else
  bool ruhig(int h) const noexcept { return h >= 1 && h <= ARR_INS_HOST && h_[h - 1].c == 0 && h_[h - 1].pos == 0; }
#endif
  int mischung(int h) const noexcept { return h >= 1 && h <= ARR_INS_HOST ? h_[h - 1].c : 0; }   // test seam: c, 0..HOST_BLENDE

  // Counts of frames in which the return guard acted (non-finite or clamped), all hosts / host h.
  uint64_t wachter_zaehler() const noexcept;
  uint64_t wachter_zaehler(int h) const noexcept {
    return h >= 1 && h <= ARR_INS_HOST ? h_[h - 1].wachter.load(std::memory_order_relaxed) : 0;
  }
  int ruhe(int h) const noexcept { return h >= 1 && h <= ARR_INS_HOST ? h_[h - 1].ruhe : 0; }   // test seam: healthy samples counted towards the hold-off, 0..HOST_GESUND_HALTE
  int gewicht(int h) const noexcept { return h >= 1 && h <= ARR_INS_HOST ? h_[h - 1].pos : 0; }   // test seam: 0..HOST_BLENDE

 private:
  void setze_quelle(int h, uint8_t bit, bool ok) noexcept {
    if (h < 1 || h > ARR_INS_HOST) return;
    Wirt& w = h_[h - 1];
    if (ok) {
      w.quellen.fetch_or(bit, std::memory_order_acq_rel);
    } else {
      w.fehl.store(true, std::memory_order_release);
      w.quellen.fetch_and(static_cast<uint8_t>(~bit), std::memory_order_acq_rel);
    }
  }
  struct Wirt {
    float ring_l[ARR_HOST_LAT_MAX] = {};
    float ring_r[ARR_HOST_LAT_MAX] = {};
    int w = 0;           // write position
    int pos = 0;         // weight of the return, 0..HOST_BLENDE
    int c = HOST_BLENDE; // entry/exit blend: weight of the stage output against the undelayed input
    int vor = 0;         // samples of the warm-up left (c held at 0) of an entering stage
    int lat = 0;         // the latency of the last block / of the entering stage
#ifdef CYPHERDJ_MUTATION_HOST_STILLSTAND_REGEL
    int still_n = 0;
#endif
    float* aus_l = nullptr;
    float* aus_r = nullptr;
    const float* rueck_l = nullptr;
    const float* rueck_r = nullptr;
    std::atomic<uint8_t> quellen{0};      // bit 0 edge check, bit 1 server flag
    std::atomic<bool> fehl{false};        // a source was cleared since the last block
    std::atomic<bool> messung{false};
    int ruhe = HOST_GESUND_HALTE;         // healthy samples since the last outage; a fresh stage has no hold-off (a stage nobody ever saw unhealthy), the unhealthy default zeroes it in the first block
    std::atomic<uint64_t> wachter{0};
  };
  Wirt h_[ARR_INS_HOST];
};

}  // namespace cdj
