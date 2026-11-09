// Baukasten S20: a Baukasten graph as the sink of an internal instrument track of the arrangement (modelled on arr_rb_sink.h).
// The graph instance (CypherBk) is built by the loader thread and arrives inside the snapshot (ArrSpur::bk, bk_gen); this sink owns
// none of them. Per track slot it keeps an event queue, the instance it plays (h_last, gen_last) and some state; notes arrive with their
// target sample (lead 0) and go to the instance with an offset inside the block; the output is added to the track input.
//   Knobs: k1..k8 of the track (absent = 0.5) are set on the instance in every block, also while the transport stands. When the sink takes
//   over an instance and at a transport start they are set at once (cypher_bk_regler_sofort), so live and the offline render begin on the
//   same values whatever the pre-roll; later changes are smoothed over 20 ms by the instance.
//   Transport start: in the block that holds the start sample the instance is reset (cypher_bk_zuruecksetzen), all notes off at the start
//   sample, then the notes of the run (RB-338 rule A3: the output from the start on does not depend on what played before). A short fade
//   (6.28) ends a sounding tail without a step when the start lies in the next block.
//   Change of instance (another graph, a changed graph file, the track leaves bk or the sink): the old instance is rendered for one more
//   block with a linear fade to 0, then released. The block publishes the instance in use (nutzt): the loader frees an instance only when no
//   snapshot holds it and the sink does not use it. A tail inside the graph (delay, reverb) is cut by this fade.
//   Rest: with the transport standing and 1 s of exact silence the instance is reset and not computed any more until a note or a start.
//   The takt (beat at the block start, beats per sample) comes from the kern before the arrangement block.
// Real-time: apart from the constructor and destructor no allocation, no lock, no I/O.
#pragma once

#include <atomic>
#include <cstdint>

#include "cypherdj/arr_playback.h"
#include "cypherdj/arrangement.h"
#include "cypherdj/cypher_bk_ffi.h"

namespace cdj {

constexpr int ARR_BK_WARTE = 256;          // events per track until the next block (= BK_MAX_EREIGNISSE of the FFI)
constexpr int64_t ARR_BK_RUHE = 48000;     // 1 s of exact silence with the transport standing, then the instance rests

class ArrBkSenke final : public ArrSenke, public ArrBkLeser {
 public:
  explicit ArrBkSenke(const Arrangement& arr) : arr_(arr) {}
  ArrBkSenke(const ArrBkSenke&) = delete;
  ArrBkSenke& operator=(const ArrBkSenke&) = delete;

  int64_t vorhalt() const noexcept override { return 0; }
  void note(int spur, int64_t ziel, uint8_t ton, uint8_t vel, bool an) noexcept override;
  void alle_aus(int spur, int64_t ziel) noexcept override;
  void transport_start(int spur, int64_t ziel) noexcept override;
  void block(int spur, int64_t s0, int m, float* l, float* r) noexcept override;   // = block_bahn on the own lane-0 struct
  void block_bahn(int spur, int64_t s0, int m, float* l, float* r, ArrArbeit& a) noexcept override;   // scratch from `a`; parallel_faehig stays false (bk runs serial in this plan)
  bool spur_weg(int spur, int64_t s, bool andere_spur) noexcept override;   // true: this track still has an instance to fade out
  // 1.9 U8 T9 (E12): the value of knob `param` (0..7 = k1..k8) of the slot for the next block(): a value reported in a block wins over the knob of the snapshot in that block (also at a
  // take-over and a transport start); no report in a block: the snapshot's knob is used again. Caller thread, before block() (the macro hook of the rack); never from a lane unit.
  void auto_parameter(int spur, int param, float wert) noexcept override;

  // ArrBkLeser: does the callback still use this instance (play it or fade it)? Called from the loader thread.
  bool nutzt(const CypherBk* h) const noexcept override;
  // beat of the first sample of the next block and beats per sample, set by the kern before the arrangement block
  void takt(double beat0, double bps) noexcept {
    beat0_ = beat0;
    bps_ = bps;
  }
  uint64_t verloren() const { return verloren_.load(std::memory_order_relaxed); }   // events over ARR_BK_WARTE or refused by the FFI
  int ruhend() const;                                // tracks whose instance rests (reset after 1 s of silence)
  int spielend() const;                              // tracks that hold an instance

 private:
  struct Ev {
    int64_t ziel;
    uint8_t art;   // 0 note on, 1 note off, 2 all off
    uint8_t ton, vel;
  };
  struct Spur {
    Ev ev[ARR_BK_WARTE];
    int n = 0;
    int64_t start = -1;                 // start sample of a pending transport start, -1: none
    CypherBk* h_last = nullptr;         // the instance this slot plays (owned by the cache of the loader)
    uint64_t gen_last = 0;
    bool weg = false;                   // the track left the sink: the next block fades the instance out
    bool stumm = false;                 // short fade done, silent until the block of the start
    bool ruht = false;                  // reset after 1 s of silence, not computed until a note or a start
    int64_t still = 0;                  // samples of exact silence in a row
    bool neu = false;                   // an instance was just taken over: the knobs jump to their values
    float knopf_wert[8] = {};           // knobs reported for the next block (auto_parameter)
    bool knopf_da[8] = {};
    std::atomic<const CypherBk*> aktiv{nullptr};    // published with release order: the instance this slot plays
    std::atomic<const CypherBk*> blende{nullptr};   // the instance this slot fades out in the current block
  };
  void schiebe(Spur& p, const Ev& e) noexcept;

  const Arrangement& arr_;
  Spur sp_[ARR_SENKEN_PLAETZE];
  double beat0_ = 0.0, bps_ = 0.0;
  std::atomic<uint64_t> verloren_{0};
  ArrArbeit arbeit0_;   // lane 0 struct of block()
};

}  // namespace cdj
