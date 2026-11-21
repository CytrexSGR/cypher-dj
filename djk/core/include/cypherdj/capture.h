// Recorder of /k/loop/rec (MVP 2 Scheibe 2, ADR 025, INTERFACES 4.9): copies the Strudel input into a Mitschnitt buffer from the next
// multiple of its beat count on. Container core K1: this is what is left of the loop boxes (the box header is gone). It reads the interim
// input channels of the mixer (erz/1, or the sum erz/1..3) in front of the trim; K3 moves it to stream buffer 1.
// Everything runs in the callback: no allocation, no lock, no I/O. The caller owns the Mitschnitt.
#pragma once

#include <algorithm>
#include <cmath>
#include <cstdint>

#include "cypherdj/loop.h"
#include "cypherdj/clock.h"

namespace cdj {

constexpr int MITSCHNITT_SUMME_KANAELE = 3;  // summe=1: streams 1..3 (buffers 0..2) are added
constexpr int MITSCHNITT_KANAL = 0;          // stream 1 (container core K3, D-V4: the recorder reads the stream buffers of stage 1, buffer index = stream - 1)

class MitschnittAufnahme {
 public:
  // false: one is already running (the caller reports ueberlappung and gives m back untouched).
  bool start(Mitschnitt* m, double beat0, const Karte& k) {
    if (m_) return false;
    const double lang = static_cast<double>(m->beats);
    m->ab_beat = ab_beat(beat0, m->beats);
    m->ab_sample = std::llround(k.sample_at(m->ab_beat));
    // Plan Tempo-Folge: N beats at the tempo of the recording; never more than the buffer holds
    m->roh_frames = std::min<int64_t>(std::llround(k.sample_at(m->ab_beat + lang)) - m->ab_sample, static_cast<int64_t>(m->daten.size()) / 2);
    m->bpm = k.bpm_at(static_cast<double>(m->ab_sample));
    m->gefuellt = 0;
    m_ = m;
    return true;
  }
  // Keylock Slice 4 (F3): the start beat of a recording of `beats` beats requested at beat0: the next multiple of beats from beat0.
  static double ab_beat(double beat0, int beats) {
    const double lang = static_cast<double>(beats);
    return std::ceil(beat0 / lang - 1e-9) * lang;
  }
  // New time axis (4.2): a running recording counts as aborted. The caller frees it outside the callback (as /e/mitschnitt).
  [[nodiscard]] Mitschnitt* leeren() {
    Mitschnitt* m = m_;
    m_ = nullptr;
    return m;
  }
  bool laeuft() const noexcept { return m_ != nullptr; }
  // Samples [n0, n0 + n). ein_l[k], ein_r[k]: the buffer of stream k + 1 (read only; ein_l[MITSCHNITT_KANAL] is stream 1).
  // fertig is set to the recording as soon as its buffer is full or it was aborted (the caller reports /e/mitschnitt and frees it).
  void block(const Karte& k, int64_t n0, int n, float* const* ein_l, float* const* ein_r, Mitschnitt** fertig) {
    if (!m_) return;
    const int64_t ende = n0 + n;
    Mitschnitt& mt = *m_;
    const int64_t ab = mt.ab_sample;
    // MVP 2 Scheibe 3 (E4, Review Scheibe 2 Fund 2) and Plan Tempo-Folge: the tempo of the recording must stay fixed. Before the start the
    // same map (ab_beat at the same sample), to the end the same tempo without a ramp; otherwise the file would be shifted or distorted
    // and still count as done. Only the part of the block that falls into the recording is checked (Code-Review F1).
    const int64_t p0 = std::max(n0, ab), p1 = std::min(ende, ab + mt.roh_frames) - 1;
    const bool tempo_fest = p1 < p0 || (k.k_at(static_cast<double>(p0)) == 0.0 && std::fabs(k.bpm_at(static_cast<double>(p0)) - mt.bpm) < 1e-9 &&
                                        k.k_at(static_cast<double>(p1)) == 0.0 && std::fabs(k.bpm_at(static_cast<double>(p1)) - mt.bpm) < 1e-9);
    if (!tempo_fest || (mt.gefuellt == 0 && std::llround(k.sample_at(mt.ab_beat)) != ab)) {
      mt.abgebrochen = true;
      if (fertig) *fertig = m_;
      m_ = nullptr;
      return;
    }
    if (ab < ende) {
#ifdef CYPHERDJ_MUTATION_MITSCHNITT_BLOCKANFANG
      const int64_t von = n0;  // failure case of the acceptance: start at the block start instead of ab_sample
#else
      const int64_t von = std::max(n0, ab);
#endif
      // bis never beyond the end of the buffer: von + rest is the guard against a failure case like the mutation above
      const int64_t bis = std::min({ende, ab + mt.roh_frames, von + (mt.roh_frames - mt.gefuellt)});
      if (bis > von) {
        const float* el = ein_l[MITSCHNITT_KANAL];
        const float* er = ein_r[MITSCHNITT_KANAL];
        for (int64_t t = von; t < bis; ++t) {
          const int64_t p = mt.gefuellt + (t - von);
          float l = el[t - n0], r = er[t - n0];
          if (mt.summe) {  // erz/1+2+3, float: no clamp, the file is f32
            for (int c = 1; c < MITSCHNITT_SUMME_KANAELE; ++c) {
              l += ein_l[MITSCHNITT_KANAL + c][t - n0];
              r += ein_r[MITSCHNITT_KANAL + c][t - n0];
            }
          }
          mt.daten[static_cast<size_t>(2 * p)] = l;
          mt.daten[static_cast<size_t>(2 * p + 1)] = r;
        }
        mt.gefuellt += bis - von;
      }
      if (mt.gefuellt >= mt.roh_frames) {
        if (fertig) *fertig = m_;
        m_ = nullptr;
      }
    }
  }

 private:
  Mitschnitt* m_ = nullptr;
};

}  // namespace cdj
