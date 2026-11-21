// Container core K7: the sink of the `strom` tracks (ArrArt::strom). A strom track has no clips and no notes: it adds the Erzeuger stream buffer strom_l/r[n - 1] (n = ArrSpur::strom, 1..16)
// of the source buffers into its track input. Stage 1 of the audio callback (quellen_block) fills the buffers once per sub-block before the arrangement block runs, so the sound arrives at
// latency 0 and the strip of the track (trim, filter, EQ, kill, fader, groups, DJ outputs) treats it like any other track input. The buffers hold the frames of the current sub-block
// from index 0 on (not from s0).
// Notes, all-notes-off and transport start are no-ops (the Erzeuger owns its notes). No tail, no state in the stream: spur_weg() takes the default (nothing to fade).
// leer(): true while nothing sounds on the stream (the last block was exactly 0 or the stream is outside 1..16); it only feeds the live-load estimate of the track phase.
// Real-time: no allocation, no lock. block_bahn() touches only the track's own flag and its own bus, so a lane may run it (parallel_faehig).
#pragma once

#include <atomic>

#include "cypherdj/arrangement.h"
#include "cypherdj/quellpuffer.h"

namespace cdj {

class ArrStromSenke final : public ArrSenke {
 public:
  ArrStromSenke(const Arrangement& arr, const Quellpuffer& quell) : arr_(arr), q_(quell) {}
  ArrStromSenke(const ArrStromSenke&) = delete;
  ArrStromSenke& operator=(const ArrStromSenke&) = delete;

  int64_t vorhalt() const noexcept override { return 0; }
  void note(int, int64_t, uint8_t, uint8_t, bool) noexcept override {}
  void alle_aus(int, int64_t) noexcept override {}
  void transport_start(int, int64_t) noexcept override {}
  void block(int spur, int64_t s0, int m, float* l, float* r) noexcept override;
  bool parallel_faehig(int) const noexcept override { return true; }
  bool leer(int spur) const noexcept override;

 private:
  int strom_von(int spur) const noexcept;   // the stream index 0..15 of the track, -1 outside
  const Arrangement& arr_;
  const Quellpuffer& q_;
  std::atomic<bool> aktiv_[ARR_SPUREN] = {};   // the last block of the track held a sample that was not 0 (written by the track's own unit, read by the plan builder after the join)
};

}  // namespace cdj
