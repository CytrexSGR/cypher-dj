// Master limiter insert (kind `lim`): the ONE place for the fixed settings of the KanalLimiter behind the stage. The stage (arr_inserts.cpp) and the
// delay compensation (arr_pdc.h) both build their limiter from this, so the latency the PDC accounts for is the latency the stage really has.
// Sample-peak mode (no true peak: it was rejected for cost), look-ahead 1.5 ms fixed at 48 kHz = 74 samples. `decke` and `abklingen` are rows
// (setze_decke_db / setze_abklingen_ms); the values below are only the construction defaults.
#pragma once

#include <cypherdj/dsp/kanal_limiter.h>

namespace cdj {

constexpr double INS_LIM_FS = 48000.0;   // the core runs at 48 kHz only

inline cypherdj::dsp::KanalLimiterEinstellung ins_lim_einstellung() {
  cypherdj::dsp::KanalLimiterEinstellung e;
  e.decke_db = -1.0f;        // = the default of the row ins/lim/<n>/decke
  e.vorhalt_ms = 1.5f;       // fixed look-ahead
  e.abklingen_ms = 80.0f;    // = the default of the row ins/lim/<n>/abklingen
  e.echtspitze = false;      // sample peak only
  return e;
}

// Latency in samples of a limiter stage (74 at 48 kHz), from an instance with the fixed settings.
inline int ins_lim_latenz() {
  static const int n = cypherdj::dsp::KanalLimiter(INS_LIM_FS, ins_lim_einstellung()).latenz_samples();
  return n;
}

}  // namespace cdj
