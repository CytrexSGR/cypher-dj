// Messwerkzeug für die Keylock-Tests an der Quelle (Plan 2026-10-06-keylock-echtzeit.md, Task 2), dieselben Messgrößen wie
// test_dehner.cpp (Task 1, dort im eigenen Namensraum; hier nachgebaut, test_dehner bleibt unverändert):
//   Lage (a)  Mittel über die Klicks gegen das Soll (sample_at(beat)); seit Keylock 4.6 (Deck-Versatz 0) nur
//             ausgewiesen, tragend je Klick ±12 gegen das Soll (max_soll) und (b);
//   Lage (b)  jeder Klick ±12 gegen ROHES R3: dieselbe Quelle durch eine nackte Rubber-Band-Instanz mit derselben
//             Faktorfolge, ab demselben um den Versatz korrigierten Band-Start (test_dehner.cpp Kopf, Prüfung F3).
//   Tonhöhe   Nulldurchgänge je 100-ms-Fenster, ±2 ct.
//   Blende    Abweichung vom idealen Übergang im Blendenfenster; ideale Sinus aus der Karte (Varispeed, analytisch) bzw.
//             eingepasst (Ring: Frequenz, Amplitude, Phase nach kleinsten Quadraten aus 2000 Samples neben der Blende,
//             Vertrag 16).
#pragma once

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <vector>

#include <rubberband/RubberBandStretcher.h>

#include "cypherdj/dehner.h"
#include "cypherdj/fassung.h"
#include "cypherdj/lader.h"
#include "cypherdj/uhr.h"

namespace km {

constexpr int B = 256;
constexpr double FPB = cdj::FRAMES_JE_MINUTE / 128.0;  // Quellframes je Beat bei Basis 128
constexpr double PI = 3.14159265358979323846;
constexpr double MITTE = 71.5;  // Klick-Mitte (144 Samples), wie test_dehner

inline std::vector<float> klick_vorlage() {
  std::vector<float> t(144);
  for (int i = 0; i < 144; ++i)
    t[i] = (float)(0.5 * std::sin(2 * PI * 1000.0 * i / 48000.0) * 0.5 * (1 - std::cos(2 * PI * i / 143.0)));
  return t;
}

// Material für das Deck: art 0 Klick je Quell-Beat (wie test_dehner), art 1 Sinus 1000 Hz, Spitze 0,5. Basis 128,
// erster Schlag Frame 0.
struct MatProbe {
  std::vector<float> d;
  cdj::Material m{};
  MatProbe(double beats, int art, const char* id = "c1c0000000000501") {
    const int64_t frames = (int64_t)std::ceil(beats * FPB);
    std::snprintf(m.material_id, sizeof m.material_id, "%s", id);
    m.basis_bpm = 128.0;
    m.fassung = 1;
    m.n_quellen = 1;
    m.frames = frames;
    m.erster_schlag_frame = 0;
    d.assign((size_t)(2 * frames), 0.0f);
    if (art == 0) {
      const std::vector<float> tpl = klick_vorlage();
      for (int64_t q = 0; (double)q * FPB + 144 < (double)frames; ++q)
        for (int i = 0; i < 144; ++i) {
          const int64_t f = q * (int64_t)FPB + i;
          d[(size_t)(2 * f)] = d[(size_t)(2 * f + 1)] = tpl[(size_t)i];
        }
    } else {
      for (int64_t f = 0; f < frames; ++f)
        d[(size_t)(2 * f)] = d[(size_t)(2 * f + 1)] = (float)(0.5 * std::sin(2 * PI * 1000.0 * (double)f / 48000.0));
    }
    m.quelle[0] = d.data();
  }
};

// DehnerQuelle über ein Material ohne Stems (für die Referenz rohes R3)
struct MatQuelle : cdj::DehnerQuelle {
  const cdj::Material* m;
  explicit MatQuelle(const cdj::Material* x) : m(x) {}
  void band(int64_t ab, int n, float* l, float* r) const noexcept override {
    for (int i = 0; i < n; ++i) {
      const int64_t f = ab + i;
      const bool drin = f >= 0 && f < m->frames;
      l[i] = drin ? m->quelle[0][2 * f] : 0.0f;
      r[i] = drin ? m->quelle[0][2 * f + 1] : 0.0f;
    }
  }
  double basis_bpm() const noexcept override { return m->basis_bpm; }
};

inline double parabel(double a, double b, double c) {
  const double d = a - 2 * b + c;
  return d == 0 ? 0.0 : 0.5 * (a - c) / d;
}

// Lage des Klicks von Quell-Beat q: Ist − Soll in Samples (M4 phase(), wie test_dehner). Vorlage tpl, Mitte mitte
// (Bezugspunkt im Klick), Frames je Quell-Beat fpb; false: Fenster ragt aus der Aufnahme.
inline bool klick_lage(const std::vector<float>& x, const cdj::Karte& k, cdj::DehnerAnker a, int q, double& e,
                       const std::vector<float>& tpl, double mitte, double fpb = FPB) {
  const double beat = a.b + ((double)q * fpb + mitte - a.f) / fpb;
  const double soll = k.sample_at(beat);
  const int n = (int)tpl.size();
  const int64_t lo = std::max<int64_t>(1, (int64_t)(soll - mitte) - 3000), hi = (int64_t)(soll - mitte) + 3000;
  if (hi + n + 1 >= (int64_t)x.size()) return false;
  std::vector<double> cc((size_t)(hi - lo + 1));
  for (int64_t j = 0; j <= hi - lo; ++j) {
    double s = 0;
    for (int i = 0; i < n; ++i) s += (double)x[(size_t)(lo + j + i)] * (double)tpl[(size_t)i];
    cc[(size_t)j] = s;
  }
  const int64_t am = (int64_t)(std::max_element(cc.begin(), cc.end()) - cc.begin());
  double fein = (double)am;
  if (am > 0 && am + 1 < (int64_t)cc.size()) fein += parabel(cc[(size_t)am - 1], cc[(size_t)am], cc[(size_t)am + 1]);
  e = (double)lo + fein + mitte - soll;
  return true;
}

// Referenz „rohes R3“ (Messgröße b): nackte Rubber-Band-Instanz, gespeist wie der Dehner (erzeuge in dehner.cpp): erst
// abholen, nur bei leerem Ausgang getSamplesRequired() Frames speisen (Zwang: 256), Faktor an jedem 43er-Fenster der Ausgabe
// (Chunk-Zählung ab s_h wie chunk()). Rohes R3 heißt weiter: keine Dehner-Klasse, kein Ring, keine Epoche, kein Regler.
// Keylock 7b.7: bis hier speiste r3_roh in festen 256er-Blöcken; R3 ist bei f ≈ 1,48 blockgrößenempfindlich, die Lage „über
// 180 BPM“ (190: 94 Samples gegen rohes R3) war dieses Messartefakt (~/messungen/2026-10-07-keylock-echtzeit/hoch-bpm/).
inline std::vector<float> r3_roh(const cdj::DehnerQuelle& q, int64_t p0, const std::vector<double>& f, int64_t s_h,
                                 int64_t laenge) {
  using RBS = RubberBand::RubberBandStretcher;
  constexpr int GROSS = 1 << 15;
  RBS rb(48000, 2, RBS::OptionProcessRealTime | RBS::OptionEngineFiner | RBS::OptionChannelsTogether |
                       RBS::OptionThreadingNever, 1.0, 1.0);
  rb.setMaxProcessSize(GROSS);
  std::vector<float> L((size_t)laenge, 0.0f), z(GROSS, 0.0f), il(GROSS), ir(GROSS), ob[2] = {std::vector<float>(GROSS), std::vector<float>(GROSS)};
  rb.setTimeRatio(1.0 / f.at(0));
  rb.setPitchScale(1.0);
  size_t pad = rb.getPreferredStartPad();
  const float* zn[2] = {z.data(), z.data()};
  while (pad > 0) {
    const size_t m = std::min<size_t>(pad, GROSS);
    rb.process(zn, m, false);
    pad -= m;
  }
  int64_t pos = p0;
  auto erzeuge = [&](int n, float* out) {
    int got = 0, guard = 0;
    while (got < n) {
      const int av = rb.available();
      if (av > 0) {
        float* o[2] = {ob[0].data() + got, ob[1].data() + got};
        got += (int)rb.retrieve(o, (size_t)std::min(av, n - got));
        continue;
      }
      if (++guard > 64) break;
      int req = (int)rb.getSamplesRequired();
      if (req <= 0) req = B;
      req = std::min(req, GROSS);
      q.band(pos, req, il.data(), ir.data());
      const float* in[2] = {il.data(), ir.data()};
      rb.process(in, (size_t)req, false);
      pos += req;
    }
    for (int i = got; i < n; ++i) ob[0][(size_t)i] = 0.0f;
    if (out) std::memcpy(out, ob[0].data(), (size_t)n * sizeof(float));
  };
  for (int64_t v = (int64_t)rb.getStartDelay(); v > 0;) {
    const int m = (int)std::min<int64_t>(v, GROSS);
    erzeuge(m, nullptr);
    v -= m;
  }
  for (int64_t chunk = 0; s_h + chunk * B + B <= laenge; ++chunk) {
    const int64_t rel = chunk * B;
    if (chunk > 0 && rel % cdj::DEHNER_REGEL_TAKT == 0) {
      const size_t w = (size_t)(rel / cdj::DEHNER_REGEL_TAKT);
      if (w < f.size()) rb.setTimeRatio(1.0 / f[w]);
    }
    erzeuge(B, L.data() + s_h + rel);
  }
  return L;
}

struct Lage {
  int n = 0;
  double mittel = 0;    // (a)
  double max_roh = 0;   // (b)
  double max_soll = 0;  // nur ausgewiesen
  int q_roh = -1;
};

// Lage der Klicks q0 <= q < q1 in x (Karte k, Anker a des gehörten Ansatzes) nach (a) und (b). p0 und f: Band-Start und
// Faktorfolge des Ansatzes (Dehner), s_h sein Ziel-Sample.
inline Lage lage_messen(const std::vector<float>& x, const cdj::DehnerQuelle& q, const cdj::Karte& k, cdj::DehnerAnker a,
                        int64_t p0, const std::vector<double>& f, int64_t s_h, int q0, int q1, bool je_klick = false) {
  static const std::vector<float> tpl = klick_vorlage();
  Lage m;
  const std::vector<float> R = r3_roh(q, p0, f, s_h, (int64_t)x.size());
  double summe = 0;
  for (int i = q0; i < q1; ++i) {
    double e = 999, er = 999;
    if (!klick_lage(x, k, a, i, e, tpl, MITTE) || !klick_lage(R, k, a, i, er, tpl, MITTE)) continue;
    if (je_klick) std::printf("    Klick %d: Deck %+.2f, rohes R3 %+.2f\n", i, e, er);
    ++m.n;
    summe += e;
    m.max_soll = std::max(m.max_soll, std::fabs(e));
    if (std::fabs(e - er) > m.max_roh) {
      m.max_roh = std::fabs(e - er);
      m.q_roh = i;
    }
  }
  m.mittel = m.n ? summe / m.n : NAN;
  return m;
}

// Band-Start wie im Dehner (dehner.cpp ansetzen): round(kopf(s_h) + VERSATZ(f0) · f0)
inline int64_t band_start(const cdj::Karte& k_ansatz, cdj::DehnerAnker a, int64_t s_h, double f0, double fpb = FPB) {
  const double kopf_h = a.f + (k_ansatz.beat_at((double)s_h) - a.b) * fpb;
  return (int64_t)std::round(kopf_h + cdj::dehner_versatz(f0) * f0);
}

// Frequenz über steigende Nulldurchgänge in [a, b)
inline double freq(const std::vector<float>& x, int64_t a, int64_t b) {
  double t0 = -1, t1 = -1;
  int n = 0;
  for (int64_t i = a + 1; i < b && i < (int64_t)x.size(); ++i)
    if (x[(size_t)i - 1] < 0 && x[(size_t)i] >= 0) {
      const double t = (double)(i - 1) + x[(size_t)i - 1] / (x[(size_t)i - 1] - x[(size_t)i]);
      if (t0 < 0) t0 = t;
      t1 = t;
      ++n;
    }
  return n > 1 ? (n - 1) * 48000.0 / (t1 - t0) : 0.0;
}

// Sinus x(t) = A cos(ω (t − t0)) + B sin(ω (t − t0)), eingepasst auf [a, b) (kleinste Quadrate, Frequenz per Gitter um f0).
struct Sinus {
  double f = 0, A = 0, Bs = 0, t0 = 0, rest = 0;
  double operator()(double t) const {
    const double w = 2 * PI * f / 48000.0;
    return A * std::cos(w * (t - t0)) + Bs * std::sin(w * (t - t0));
  }
};
inline Sinus sinus_einpassen(const std::vector<float>& x, int64_t a, int64_t b, double f0) {
  auto pass = [&](double f) {
    Sinus s;
    s.f = f;
    s.t0 = 0.5 * (double)(a + b);
    const double w = 2 * PI * f / 48000.0;
    double cc = 0, ss = 0, cs = 0, xc = 0, xs = 0;
    for (int64_t t = a; t < b; ++t) {
      const double c = std::cos(w * ((double)t - s.t0)), si = std::sin(w * ((double)t - s.t0)), v = x[(size_t)t];
      cc += c * c;
      ss += si * si;
      cs += c * si;
      xc += v * c;
      xs += v * si;
    }
    const double det = cc * ss - cs * cs;
    s.A = (xc * ss - xs * cs) / det;
    s.Bs = (xs * cc - xc * cs) / det;
    double r = 0;
    for (int64_t t = a; t < b; ++t) {
      const double d = x[(size_t)t] - s((double)t);
      r += d * d;
    }
    s.rest = std::sqrt(r / (double)(b - a));
    return s;
  };
  Sinus best = pass(f0);
  for (double schritt : {0.5, 0.02, 0.001}) {
    const double mitte = best.f;
    for (int i = -40; i <= 40; ++i) {
      const Sinus s = pass(mitte + i * schritt);
      if (s.rest < best.rest) best = s;
    }
  }
  return best;
}

}  // namespace km
