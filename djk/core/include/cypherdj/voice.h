// Voice channel for spoken commentary (cypher-dj demo, 2026-11-07). The voice comes in on one audio input pair ein_<k>
// (kern.toml stimme_eingang, 0 = off, the default). It is summed into the master in front of the master limiter, so the
// sum of music and voice stays under the limiter ceiling (the limiter is the one hard ceiling of the master; with the
// voice behind it, loud music plus voice would pass 0 dBFS and clip at the output and in the recording).
//
// Ducking with look-ahead: the voice is delayed by vorschau samples, the detector looks at the undelayed voice. When it
// hears speech, the music gain falls to duck_db within the look-ahead, so the music is already down when the first
// syllable sounds. It stays down for halten samples after the last loud sample, then rises again with a slow release.
//
// Realtime: no allocation, no lock, no I/O. Header only (the kern has explicit source lists in CMakeLists.txt).
#pragma once

#include <algorithm>
#include <cmath>
#include <cstdint>

namespace cdj {

constexpr int STIMME_VORSCHAU_MAX = 9600;   // 200 ms at 48 kHz

struct StimmEinstellung {
  int eingang = 0;            // 0 off, 1..4 = ein_<k>
  float duck_db = -12.0f;     // music gain while the voice speaks, -40..0 dB
  float pegel_db = 0.0f;      // voice gain, -40..+12 dB
  int vorschau = 4800;        // look-ahead in samples (100 ms), 0..STIMME_VORSCHAU_MAX
  int halten = 14400;         // hold after the last loud voice sample (300 ms)
  float schwelle_db = -45.0f; // detector threshold on the undelayed voice
  float release_ms = 400.0f;  // time constant of the rise back to 0 dB
};

class StimmDucker {
 public:
  void einstellen(const StimmEinstellung& e) noexcept {
    e_ = e;
    e_.vorschau = std::clamp(e_.vorschau, 0, STIMME_VORSCHAU_MAX);
    duck_ = std::pow(10.0f, std::clamp(e_.duck_db, -40.0f, 0.0f) / 20.0f);
    pegel_ = std::pow(10.0f, std::clamp(e_.pegel_db, -40.0f, 12.0f) / 20.0f);
    schwelle_ = std::pow(10.0f, e_.schwelle_db / 20.0f);
    // attack: one pole that covers about 99 % of the way within the look-ahead (5 time constants)
    const float tau_a = std::max(1.0f, e_.vorschau / 5.0f);
    a_ab_ = 1.0f - std::exp(-1.0f / tau_a);
    a_auf_ = 1.0f - std::exp(-1.0f / std::max(1.0f, e_.release_ms * 48.0f));
  }
  bool an() const noexcept { return e_.eingang >= 1 && e_.eingang <= 4; }
  int eingang() const noexcept { return e_.eingang; }
  float gain() const noexcept { return g_; }

  // ml/mr: music of the master (in place). vl/vr: undelayed voice of this block. mg: master/pegel gain per sample (the
  // voice follows Andreas' master fader like the music), nullptr = 1.
  void block(const float* vl, const float* vr, float* ml, float* mr, const float* mg, int n) noexcept {
    for (int i = 0; i < n; ++i) {
      // the input is a foreign JACK port: clamp to +-8 like the return paths (audit F01), NaN/Inf to 0
      const float x = std::isfinite(vl[i]) ? std::clamp(vl[i], -8.0f, 8.0f) : 0.0f;
      const float y = std::isfinite(vr[i]) ? std::clamp(vr[i], -8.0f, 8.0f) : 0.0f;
      const float a = std::fmax(std::fabs(x), std::fabs(y));
      if (a >= schwelle_) halt_ = e_.vorschau + e_.halten;
      else if (halt_ > 0) --halt_;
      const float ziel = halt_ > 0 ? duck_ : 1.0f;
      g_ += (ziel - g_) * (ziel < g_ ? a_ab_ : a_auf_);
      // delay line: write the new sample, read the one vorschau samples back
      float dl = x, dr = y;
      if (e_.vorschau > 0) {
        int lese = pos_ - e_.vorschau;
        if (lese < 0) lese += STIMME_VORSCHAU_MAX;
        dl = puf_l_[lese];
        dr = puf_r_[lese];
        puf_l_[pos_] = x;
        puf_r_[pos_] = y;
        if (++pos_ == STIMME_VORSCHAU_MAX) pos_ = 0;
      }
      const float m = mg ? mg[i] : 1.0f;
      ml[i] = ml[i] * g_ + dl * pegel_ * m;
      mr[i] = mr[i] * g_ + dr * pegel_ * m;
    }
  }

 private:
  StimmEinstellung e_;
  float duck_ = 0.25f, pegel_ = 1.0f, schwelle_ = 0.0056f, a_ab_ = 0.001f, a_auf_ = 0.0001f;
  float g_ = 1.0f;
  int halt_ = 0;
  int pos_ = 0;
  float puf_l_[STIMME_VORSCHAU_MAX] = {};
  float puf_r_[STIMME_VORSCHAU_MAX] = {};
};

}  // namespace cdj
