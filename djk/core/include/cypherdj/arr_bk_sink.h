// Baukasten S20: a Baukasten graph as the sink of an internal instrument track of the arrangement (modelled on arr_rb_sink.h).
// The graph instance (CypherBk) is built by the loader thread and arrives inside the snapshot (ArrSpur::bk, bk_gen); this sink owns
// none of them. Per track slot it keeps an event queue, the instance it plays (h_last, gen_last) and some state; notes arrive with their
// target sample (lead 0) and go to the instance with an offset inside the block; the output is added to the track input.
//   Knobs: k1..k64 of the track (absent = the graph's `vorgabe` of the knob, 0.5 for a graph without one) are set on the instance in every block, also while the transport stands. When the sink takes
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
//   Pin matrix (graph with a `matrix` block, kraken patch field): the pins of the snapshot (ArrSpur::stifte_da, ArrSnapshot::stifte) are applied at a take-over and whenever the serial of the snapshot (ArrSnapshot::folge)
//   differs from the one this slot applied last (the start value of stift_folge is UINT64_MAX, a sentinel that no snapshot has, so the first block always applies), before the knob loop and so before the FFI block; at once
//   (sofort) where the knobs jump (take-over, transport start), else smoothed. A track without `stifte` plays the graph's own pins, a track with `stifte` only the listed ones. A live pin (stift(), from ARR_STIFT) waits
//   in a dense array of the slot (512 values, a 512-bit mask, the last write of a position wins; no event queue, nothing can overflow) with the generation stamp it was sent under; the next block applies it after the pins
//   of the snapshot, except a pin whose stamp is older than Arrangement::snapshot_generation() (a swap came between: the newer snapshot decides). A transport start keeps all pins.
// Real-time: apart from the constructor and destructor no allocation, no lock, no I/O.
#pragma once

#include <atomic>
#include <cstdint>

#include "cypherdj/arr_playback.h"
#include "cypherdj/arrangement.h"
#include "cypherdj/cypher_bk_ffi.h"

namespace cdj {

constexpr int ARR_BK_WARTE = 256;          // events per track until the next block (= BK_MAX_EREIGNISSE of the FFI)
constexpr int BK_STIFTE_SATZ = 256;           // pins per set of the matrix (16 x 16); the slot keeps 2 sets
constexpr int64_t ARR_BK_RUHE = 48000;     // 1 s of exact silence with the transport standing, then the instance rests

class ArrBkSenke final : public ArrSenke, public ArrBkLeser {
 public:
  explicit ArrBkSenke(const Arrangement& arr) : arr_(arr) {}
  ArrBkSenke(const ArrBkSenke&) = delete;
  ArrBkSenke& operator=(const ArrBkSenke&) = delete;

  int64_t vorhalt() const noexcept override { return 0; }
  void note(int spur, int64_t ziel, uint8_t ton, uint8_t vel, bool an) noexcept override;
  void alle_aus(int spur, int64_t ziel) noexcept override;
  // Callback thread, before block() of the track (the same order as note()); the value waits in the slot and goes to the instance in the next block. Out of range or NaN: ignored.
  void stift(int spur, int satz, int zeile, int spalte, float wert, uint64_t gen) noexcept override;
  void transport_start(int spur, int64_t ziel) noexcept override;
  void transport_abbruch(int spur) noexcept override;   // audit U33: a stop while the start waits cancels it (start and fade state)
  void block(int spur, int64_t s0, int m, float* l, float* r) noexcept override;   // = block_bahn on the own lane-0 struct
  // Track phase on the pool lanes: touches only the track's own slot sp_[spur], the relaxed counter verloren_ and the scratch of `a`; another bk track may run on another lane meanwhile.
  void block_bahn(int spur, int64_t s0, int m, float* l, float* r, ArrArbeit& a) noexcept override;
  // A lane unit only when the track plays an instance (aktiv) and no change of instance is due or in flight: the snapshot holds that very instance in that generation, the track is
  // not told to leave (spur_weg) and no fade is running (blende). Until the first block took the instance over, and in the block of a swap, the track runs in the serial remainder;
  // after that block the Arrangement asks again (spur_nach_join) and the track joins a lane list. Caller thread only, while no lane unit runs (plan builder, after the join).
  bool parallel_faehig(int spur) const noexcept override;
  // No work at all in the next block: no instance in use, or an instance at rest (reset after 1 s of silence) with no event and no start pending. A woken or fading track counts as load.
  bool leer(int spur) const noexcept override;
  bool spur_weg(int spur, int64_t s, bool andere_spur) noexcept override;   // true: this track still has an instance to fade out
  // 1.9 U8 T9 (E12): the value of knob `param` (0..63 = k1..k64) of the slot for the next block(): a value reported in a block wins over the knob of the snapshot in that block (also at a
  // take-over and a transport start); no report in a block: the snapshot's knob is used again. Caller thread, before block() (the macro hook of the rack); never from a lane unit.
  void auto_parameter(int spur, int param, float wert) noexcept override;
  // 1.12 slice 7: a knob with a RELATIVE lane (a clip envelope) and no absolute one: `delta` is added to the knob of the snapshot (clamped 0..1) for the next block, under the same rules
  // as auto_parameter (a value reported in a block wins; no report: the snapshot knob alone).
  void auto_parameter_summand(int spur, int param, float delta) noexcept override;
  // strand 6 task 1.4: the modulator offset of knob `param` (0..63) for the next block(): added after the whole stack (reported value or snapshot knob, plus a relative summand), also to
  // the per-note values of a latched knob (note_regler), clamped 0..1. Taken and cleared by that block like the summand.
  void mod_summand(int spur, int param, float delta) noexcept override;
  // sampler A2: the value of a latched knob (param 0..63) for the note-on at sample `ziel`, handed by the core right before that note. Kept in a queue of its own, separate from the notes: the
  // notes go to the instance first, the knob values after them, so a block with more events than the FFI takes loses knob values and never a note (a lost value counts in verloren()).
  // `relativ`: wert is a summand on the knob of the snapshot (clamped 0..1), as in the block loop; otherwise the final value. The instance sets it at the offset of the note, before the note.
  void note_regler(int spur, int64_t ziel, int param, float wert, bool relativ) noexcept override;
  // Tracker task 16: a pitch (bend, semitones) or level (pegel, factor) event at sample `ziel`, `gleit_samples` 0 = jump, else linear to the value over that many samples. Own queue per track like
  // the knob values: the instance gets it after all notes of the block (a surplus costs these events, never notes) and puts it, at one sample, after all-off and note-off and before note-on
  // (cypher_bk_bend_bei / cypher_bk_pegel_bei). A transport start and all-off set the instance neutral (bend 0, pegel 1).
  void fx(int spur, int64_t ziel, bool pegel, float wert, int64_t gleit_samples) noexcept override;

  // ArrBkLeser: does the callback still use this instance (play it or fade it)? Called from the loader thread.
  bool nutzt(const CypherBk* h) const noexcept override;   // true also when the second reader (the insert stages, arr-bk slice 3) uses it
  // arr-bk slice 3: the graph store has one reader, so the sink answers for the insert stages as well. Before the loader thread starts.
  void setze_zweiten_leser(const ArrBkLeser* l) noexcept { zweiter_ = l; }
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
  struct Rev {   // a per-note knob value (note_regler)
    int64_t ziel;
    float wert;
    uint8_t param;   // 0..63
    bool relativ;
  };
  struct Fev {   // a bend or pegel event (fx)
    int64_t ziel;
    float wert;
    uint32_t gleit;   // samples
    bool pegel;
  };
  struct Spur {
    Ev ev[ARR_BK_WARTE];
    int n = 0;
    Fev fev[ARR_BK_WARTE];   // bend and pegel events until the next block, applied after all notes of the block
    int n_fev = 0;
    Rev rev[ARR_BK_WARTE];   // per-note knob values until the next block, applied after all notes of the block
    int n_rev = 0;
    int64_t start = -1;                 // start sample of a pending transport start, -1: none
    CypherBk* h_last = nullptr;         // the instance this slot plays (owned by the cache of the loader)
    uint64_t gen_last = 0;
    bool weg = false;                   // the track left the sink: the next block fades the instance out
    bool stumm = false;                 // short fade done, silent until the block of the start
    bool ruht = false;                  // reset after 1 s of silence, not computed until a note or a start
    int64_t still = 0;                  // samples of exact silence in a row
    bool neu = false;                   // an instance was just taken over: the knobs jump to their values
    float stift_wert[2 * BK_STIFTE_SATZ];       // pending live pins by index satz * 256 + zeile * 16 + spalte (stift())
    uint64_t stift_gen[2 * BK_STIFTE_SATZ];     // the generation each pending pin was sent under
    uint64_t stift_offen[2 * BK_STIFTE_SATZ / 64] = {};   // bit i: stift_wert[i] is pending
    uint64_t stift_folge = UINT64_MAX;  // folge of the snapshot whose pins this slot applied last; UINT64_MAX = none yet (a hand-built snapshot has folge 0)
    float knopf_wert[BK_KNOEPFE] = {};           // knobs reported for the next block (auto_parameter)
    bool knopf_da[BK_KNOEPFE] = {};
    float knopf_delta[BK_KNOEPFE] = {};          // summands reported for the next block (auto_parameter_summand)
    bool delta_da[BK_KNOEPFE] = {};
    float mod_delta[BK_KNOEPFE] = {};            // modulator offsets reported for the next block (mod_summand, strand 6)
    bool mod_da[BK_KNOEPFE] = {};
    float knopf_vorgabe[BK_KNOEPFE];             // the start position of every knob in the graph the slot plays (`vorgabe`, 0.5 where the graph has none); read at the take-over (cypher_bk_regler_vorgabe)
    std::atomic<const CypherBk*> aktiv{nullptr};    // published with release order: the instance this slot plays
    std::atomic<const CypherBk*> blende{nullptr};   // the instance this slot fades out in the current block
  };
  void schiebe(Spur& p, const Ev& e) noexcept;
  static void lade_vorgaben(Spur& p, const CypherBk* h) noexcept;   // knopf_vorgabe from the graph of the instance (take-over only)

  const Arrangement& arr_;
  const ArrBkLeser* zweiter_ = nullptr;
  Spur sp_[ARR_SENKEN_PLAETZE];
  double beat0_ = 0.0, bps_ = 0.0;
  std::atomic<uint64_t> verloren_{0};
  ArrArbeit arbeit0_;   // lane 0 struct of block()
};

}  // namespace cdj
