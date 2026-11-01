// 1.10 Slice 3 (P1): the return strips ret/1..4 of the arrangement mixer. Holds the return inputs (the sum of the sends of the tracks and groups,
// post fader), the fade that lets a return appear and disappear without a click, and one Cypher Hall per return. The arrangement mixer
// (arr_ausgang.cpp) writes into the inputs and reads the strip output back. All Hall objects are created in the constructor (outside the
// callback); everything else runs in the callback without allocation.
//
// Hall parameters (P8): the 6 hall controls of a return are normalised 0..1 (arr_hall_einstellung maps them to units). Hall::setze costs about
// 0.33 ms (task 1), so it is rationed: the first application after the Hall wakes is immediate, while it is awake a change is applied only after the
// target stood still for one block and at most every HALL_SETZE_BLOECKE blocks, and over all returns at most ONE setze runs per block.
#pragma once

#include <cstdint>
#include <cstring>

#include "cypherdj/arr_wiedergabe.h"
#include "cypherdj/hall.h"

namespace cdj {

constexpr int ARR_RET_BLOCK = 1024;             // = ARR_BLOCK (arrangement.h), checked by a static_assert there
constexpr int ARR_RET_BLENDE = 480;             // appear, disappear, mute, solo, hall on: 10 ms (P9)
constexpr int ARR_HALL_PARAM = 6;               // pre, decay, size, low, highcut, tail
constexpr int HALL_SETZE_BLOECKE = 4;           // an awake Hall takes a changed target at most every 4 blocks (and only after one still block)
constexpr int ARR_HALL_RUHE_SAMPLES = 65536;        // input quiet for longer than the longest feedback line (as the old send-2 hall)
constexpr int ARR_HALL_RUHE_MAX = 1 << 30;          // saturation of the quiet counter (no int overflow)

// normalised controls x[0..5] = pre, decay, size, low, highcut, tail -> Cypher Hall setting. Pure function, pinned by hall_abbildung_ref.json.
// pre linear 0..250 ms; size linear 5..200 ms; decay log 0.1..30 s; low log 0.25..4; highcut log 1 kHz..22 kHz; tail linear -24..+12 dB.
// Fixed as in BeatFx (early 0.5, high factor 0.6, lowcut 80 Hz, no duck, no freeze); frame index 1 (1024), chosen by the task 1 gate G1.
CypherHallEinstellung arr_hall_einstellung(const float x[ARR_HALL_PARAM]);

class ArrReturns {
 public:
  explicit ArrReturns(bool mit_hall = true);   // false: test seam without Halls (see Arrangement)
  ~ArrReturns();
  ArrReturns(const ArrReturns&) = delete;
  ArrReturns& operator=(const ArrReturns&) = delete;

  // ---- per block, written by the mixer
  float* ein_l(int r) { return ein_l_[r]; }
  float* ein_r(int r) { return ein_r_[r]; }
  void leere_eingang(int r, int m) {
    std::memset(ein_l_[r], 0, sizeof(float) * static_cast<size_t>(m));
    std::memset(ein_r_[r], 0, sizeof(float) * static_cast<size_t>(m));
  }

  // ---- presence: 1 = the playback knows the return, ramps over ARR_RET_BLENDE samples. 0 and no ramp running: the strip does not compute.
  float& da_g(int r) { return da_g_[r]; }
  bool rechnet(int r, bool da) const { return da || da_g_[r] > 0.0f; }
  // true while a strip fades in or out (the arrangement then does not take the quiet path, P15)
  bool blendet() const {
    for (float g : da_g_)
      if (g > 0.0f) return true;
    return false;
  }
  // the input of a return that was sent to in this block (the zeroing is lazy)
  bool& benutzt(int r) { return benutzt_[r]; }
  float& an_g(int r) { return an_g_[r]; }   // hall on: 1 = wet only, 0 = dry pass-through, ramps over ARR_RET_BLENDE samples

  // ---- Hall
  // Before the strip loop of a block, after the sends were summed: x[r] = the hall controls at the end of the block, an[r] = hall on, rechnet[r] = the strip
  // computes. Notes changes of the target, decides which returns wake, and hands out the one setze credit of the block (P8 c).
  void hall_vorlauf(int m, const float (*x)[ARR_HALL_PARAM], const bool* an, const bool* rechnet);
  bool hall_laeuft(int r) const { return laeuft_[r]; }   // the Hall of return r computed in the last block
  // computes the wet signal of return r from its input (valid after hall_vorlauf said hall_laeuft(r)); nass_l/nass_r hold m samples
  void hall_block(int r, int m);
  const float* nass_l(int r) const { return nass_l_[r]; }
  const float* nass_r(int r) const { return nass_r_[r]; }
  // the strip is gone (P9) or the hall is off with its fade finished: state to zero, the Hall sleeps
  void schlafen(int r);
  // main thread, kernel not running: apply x[r] at once to every Hall whose applied setting differs (initial state and the render start, P8 a)
  void hall_sofort(const float (*x)[ARR_HALL_PARAM]);

  // ---- counters and test seams
  uint64_t setze_gesamt() const { return setze_n_; }
  int setze_max_je_block() const { return setze_max_; }
  uint64_t start_alt() const { return start_alt_; }   // a waking Hall got no credit and ran one block on its old setting
  uint64_t nan_treffer() const { return nan_; }
  const float* angewendet(int r) const { return angew_[r]; }   // the setting the Hall of return r holds
  bool wach(int r) const { return wach_[r]; }
  bool hat_hall(int r) const { return hall_[r] != nullptr; }

 private:
  void anwenden(int r);

  float ein_l_[ARR_RETURNS][ARR_RET_BLOCK] = {};
  float ein_r_[ARR_RETURNS][ARR_RET_BLOCK] = {};
  float nass_l_[ARR_RETURNS][ARR_RET_BLOCK] = {};
  float nass_r_[ARR_RETURNS][ARR_RET_BLOCK] = {};
  float da_g_[ARR_RETURNS] = {};
  float an_g_[ARR_RETURNS];
  bool benutzt_[ARR_RETURNS] = {};
  Hall* hall_[ARR_RETURNS] = {};
  bool wach_[ARR_RETURNS] = {};
  bool laeuft_[ARR_RETURNS] = {};
  bool speist_[ARR_RETURNS] = {};
  int ruhe_[ARR_RETURNS] = {};                          // samples the input has been quiet while awake
  float ziel_[ARR_RETURNS][ARR_HALL_PARAM] = {};        // target of the last block
  float angew_[ARR_RETURNS][ARR_HALL_PARAM] = {};       // what the Hall holds
  int ruhig_[ARR_RETURNS] = {};                         // blocks the target has stood still
  int seit_[ARR_RETURNS] = {};                          // blocks since the last setze
  uint64_t setze_n_ = 0, start_alt_ = 0, nan_ = 0;
  int setze_block_ = 0, setze_max_ = 0;
};

}  // namespace cdj
