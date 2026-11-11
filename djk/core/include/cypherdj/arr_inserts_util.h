// arr-fx slice 1: the utility stage kind of the arrangement mixer (ins/utility/<n>/{an,breite,mono_unter,gain,balance}), the 1.15 module cypherdj::dsp::Utility.
// This header holds the only logic that is specific to the kind: the rows of one slot (real units, the order of the contract kind "utility" in
// docs/interfaces/insert_module.json) become the module's parameter struct. The stage life (blend, tail, NaN guard, PDC) is ArrInserts' (arr_inserts.h).
//   row 1 breite      0..4, 1 = unchanged, 0 = mono, 2 = side doubled, 4 = side x4 (+12 dB); the module takes percent (clamp 400)
//   row 2 mono_unter  Hz, 0 = off, else the module clamps to 20..500 Hz (1..19 act as 20)
//   row 3 gain        dB, -60..+24
//   row 4 balance     -1..+1, linear balance law
// Latency 0 (the module is IIR only). No allocation, no lock: the module call and this conversion run in the audio callback.
#pragma once

#include <cypherdj/dsp/utility.h>

namespace cdj {

constexpr int INS_UTIL_PARAM = 5;   // an, breite, mono_unter, gain, balance (the order of the roles ins_util_*)

// e[1..4] = the rows breite, mono_unter, gain, balance (e[0], the stage switch, is not a module setting)
inline cypherdj::dsp::UtilityParameter util_einstellung(const float* e) {
  cypherdj::dsp::UtilityParameter p;
  p.breite_prozent = e[1] * 100.0f;
  p.bass_mono_hz = e[2];
  p.gain_db = e[3];
  p.balance = e[4];
  return p;
}

}  // namespace cdj
