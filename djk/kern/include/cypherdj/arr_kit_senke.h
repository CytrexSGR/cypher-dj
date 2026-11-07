// Package 1.9 (E4): a Kit as the sink of an internal instrument track of the arrangement (device "kit", modelled on arr_bk_senke.h).
// The Kit is loaded by the loader thread and arrives inside the snapshot (ArrSpur::kit_ptr, kit_gen); this sink owns none of it. Per track
// slot it keeps an event queue, up to ARR_KIT_STIMMEN voices and a pool of fading voices.
//   Notes: a note on starts the sound klang[ton] of the Kit at its target sample (lead 0, offset inside the block), once, from its first frame
//   (one-shot); the gain is vel/127; a note off is ignored (no choke). The output of all voices is added to the track input.
//   Steal: with all ARR_KIT_STIMMEN voices sounding the oldest one ends in a linear 5 ms fade (ARR_KIT_AUSKLANG samples, the shape of
//   Erzeuger::ausklingen) while the new note starts; a fading voice sits in the pool of fading voices, not in a voice slot. All-notes-off
//   (stop of the arrangement) lets every voice of the track end with the same fade.
//   Transport start (RB-338 rule A3): in the block that holds the start sample all voices are cleared, so the output from the start on does
//   not depend on what played before. A short fade (6.28) ends the sound without a step when the start lies in the next block.
//   Change of Kit (another Kit, a reloaded kit.json, the track leaves the sink): the old voices are rendered for one more block with a linear
//   fade to 0, then dropped. The block publishes the Kit in use (nutzt): the loader frees a Kit only when no snapshot holds it and the sink
//   does not use it. The slot publishes the Kit it plays (aktiv) and, during the fade block, the Kit it fades out (blende), with release order;
//   nutzt reads both with acquire order (the pattern of ArrBkSenke).
// Real-time: apart from the constructor and destructor no allocation, no lock, no I/O.
#pragma once

#include <atomic>
#include <cstdint>

#include "cypherdj/arr_wiedergabe.h"
#include "cypherdj/arrangement.h"
#include "cypherdj/kit.h"

namespace cdj {

constexpr int ARR_KIT_WARTE = 256;        // events per track until the next block
constexpr int ARR_KIT_STIMMEN = 16;       // voices per track (spec E4)
constexpr int ARR_KIT_AUSKLANG = 240;     // 5 ms at 48 kHz: the fade of a stolen voice
constexpr int ARR_KIT_AUS_PLAETZE = 32;   // fading voices per track (steals and all-notes-off); a full pool cuts the one nearest its end

class ArrKitSenke final : public ArrSenke, public ArrKitLeser {
 public:
  explicit ArrKitSenke(const Arrangement& arr) : arr_(arr) {}
  ArrKitSenke(const ArrKitSenke&) = delete;
  ArrKitSenke& operator=(const ArrKitSenke&) = delete;

  int64_t vorhalt() const noexcept override { return 0; }
  void note(int spur, int64_t ziel, uint8_t ton, uint8_t vel, bool an) noexcept override;
  void alle_aus(int spur, int64_t ziel) noexcept override;
  void transport_start(int spur, int64_t ziel) noexcept override;
  void block(int spur, int64_t s0, int m, float* l, float* r) noexcept override;
  bool spur_weg(int spur, int64_t s, bool andere_spur) noexcept override;   // true: this track still has voices to fade out

  // ArrKitLeser: does the callback still use this Kit (play it or fade it)? Called from the loader thread.
  bool nutzt(const Kit* k) const noexcept override;

  uint64_t verloren() const { return verloren_; }   // events over ARR_KIT_WARTE
  uint64_t einsaetze() const { return einsaetze_; }   // voices started since construction (self-check of the cost lane arr32kit)
  uint64_t abgeschnitten() const { return abgeschnitten_; }   // fading voices cut short because the pool of fading voices was full
  int stimmen(int spur) const;                      // voices of the track that sound (without the fading ones)
  int ausklingend(int spur) const;                  // fading voices of the track
  int spielend() const;                             // tracks that hold a Kit

 private:
  struct Ev {
    int64_t ziel;
    uint8_t art;   // 0 note on, 2 all off (a note off is not queued)
    uint8_t ton, vel;
  };
  struct Stimme {
    const KitKlang* klang = nullptr;   // nullptr: free slot
    int64_t pos = 0;                   // next frame of the sound
    float g = 0.0f;                    // vel / 127
    uint64_t nr = 0;                   // order of the starts of the track, the smallest is stolen
    int aus = 0;                       // fading voices: samples of the fade done
  };
  struct Spur {
    Ev ev[ARR_KIT_WARTE];
    int n = 0;
    int64_t start = -1;                // start sample of a pending transport start, -1: none
    const Kit* kit = nullptr;          // the Kit this slot plays (owned by the cache of the loader)
    uint64_t gen = 0;
    bool weg = false;                  // the track left the sink: the next block fades the voices out
    bool stumm = false;                // short fade done, silent until the block of the start
    uint64_t zaehler = 0;
    Stimme sti[ARR_KIT_STIMMEN];
    Stimme ak[ARR_KIT_AUS_PLAETZE];
    std::atomic<const Kit*> aktiv{nullptr};    // published with release order: the Kit this slot plays
    std::atomic<const Kit*> blende{nullptr};   // the Kit this slot fades out in the current block
  };
  void schiebe(Spur& p, const Ev& e) noexcept;
  void mische(Spur& p, int von, int bis) noexcept;             // adds the voices for [von, bis) of the block to the work buffers
  void ausklingen(Spur& p, Stimme& v) noexcept;                // moves a voice to the pool of fading voices
  static void leeren(Spur& p) noexcept;                        // drops every voice
  void einsatz(Spur& p, const Ev& e) noexcept;

  const Arrangement& arr_;
  Spur sp_[ARR_SENKEN_PLAETZE];
  uint64_t verloren_ = 0;
  uint64_t abgeschnitten_ = 0;
  uint64_t einsaetze_ = 0;
  float puf_l_[ARR_BLOCK] = {};
  float puf_r_[ARR_BLOCK] = {};
};

}  // namespace cdj
