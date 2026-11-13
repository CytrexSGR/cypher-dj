// Master limiter insert (kind `lim`): the ONE place for the fixed settings of the KanalLimiter behind the stage. The stage (arr_inserts.cpp) and the
// delay compensation (arr_pdc.h) both build their limiter from this, so the latency the PDC accounts for is the latency the stage really has.
// True-peak mode (4x oversampled detection, since the dress rehearsal 2: a sample-peak ceiling of -1 gave -0.67 dBTP and needed -2.0), look-ahead 1.5 ms fixed
// at 48 kHz = 74 samples + 12 of the interpolator = 86 samples. `decke` and `abklingen` are rows
// (setze_decke_db / setze_abklingen_ms); the values below are only the construction defaults.
#pragma once

#include <cypherdj/dsp/channel_limiter.h>

namespace cdj {

constexpr double INS_LIM_FS = 48000.0;   // the core runs at 48 kHz only

inline cypherdj::dsp::KanalLimiterEinstellung ins_lim_einstellung() {
  cypherdj::dsp::KanalLimiterEinstellung e;
  e.decke_db = -1.0f;        // = the default of the row ins/lim/<n>/decke
  e.vorhalt_ms = 1.5f;       // fixed look-ahead
  e.abklingen_ms = 80.0f;    // = the default of the row ins/lim/<n>/abklingen
  e.echtspitze = true;       // true peak: the ceiling is a dBTP value
  return e;
}

// Latency in samples of a limiter stage (86 at 48 kHz), from an instance with the fixed settings.
inline int ins_lim_latenz() {
  static const int n = cypherdj::dsp::KanalLimiter(INS_LIM_FS, ins_lim_einstellung()).latenz_samples();
  return n;
}

}  // namespace cdj
