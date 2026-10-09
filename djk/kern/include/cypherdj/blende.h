// Welle 2 Slice 2.2 (Audit 2026-10-01, Erhebung ~/messungen/2026-10-01-klickfrei): echtzeitfeste Gain-Hülle für Kanten
// (Deck-Start F10, Loop-Box F13/F15, später Erzeuger F16/F46 und Kit-Tausch F11). Eine Rampe beginnt IMMER beim Ist-Wert,
// auch mitten in einer anderen: ein neues Ziel erzeugt nie einen Sprung (Klasse F27). Kein Heap, keine Sperre, keine
// Ausnahme. Ruhend (offen()) keine Rechnung und bitgleich: anwenden() tut dann nichts, nicht einmal x * 1.0f.
// Kosten (Erhebung proto_blende/pruefe.txt): 32 Stimmen x 256 Samples alle in Rampe median 26,1 us, ruhend 0,03 us.
#pragma once
#include <cmath>
#include <cstdint>

namespace cdj {

class Blende {
 public:
  enum class Form : uint8_t { linear, s_kurve };
  Blende() = default;
  explicit Blende(float start) : g_(start), ziel_(start), von_(start) {}
  // Neues Ziel über samples Samples (erstes Sample: 1/samples des Wegs, letztes: genau z); samples <= 0: sofort.
  void ziel(float z, int samples, Form f = Form::linear) noexcept {
    if (samples <= 0) {
      g_ = ziel_ = z;
      rest_ = 0;
      return;
    }
#ifdef CYPHERDJ_MUTATION_BLENDE_ABBRUCH
    von_ = ziel_;  // Fehlerfall der Abnahme (Klasse F27): die neue Rampe beginnt beim alten Ziel, nicht beim Ist-Wert
#else
    von_ = g_;
#endif
    ziel_ = z;
    n_ = rest_ = samples;
    form_ = f;
  }
  void ein(int samples) noexcept { ziel(1.0f, samples); }
  void aus(int samples) noexcept { ziel(0.0f, samples); }
  bool ruht() const noexcept { return rest_ == 0; }
  bool offen() const noexcept { return rest_ == 0 && g_ == 1.0f; }  // volle Verstärkung, nichts zu tun
  bool stumm() const noexcept { return rest_ == 0 && g_ == 0.0f; }  // fertig ausgeblendet
  float wert() const noexcept { return g_; }
  float schritt() noexcept {  // Gain für das nächste Sample
    if (rest_ == 0) return g_;
    --rest_;
    const float u = 1.0f - static_cast<float>(rest_) / static_cast<float>(n_);  // 1/n ... 1
    const float f = form_ == Form::s_kurve ? u * u * (3.0f - 2.0f * u) : u;
    g_ = rest_ == 0 ? ziel_ : von_ + (ziel_ - von_) * f;
    return g_;
  }
  void anwenden(float* x, int n) noexcept {
    if (offen()) return;
    for (int i = 0; i < n; ++i) x[i] *= schritt();
  }
  void anwenden(float* l, float* r, int n) noexcept {
    if (offen()) return;
    for (int i = 0; i < n; ++i) {
      const float g = schritt();
      l[i] *= g;
      r[i] *= g;
    }
  }

 private:
  float g_ = 1.0f, ziel_ = 1.0f, von_ = 1.0f;
  int n_ = 0, rest_ = 0;
  Form form_ = Form::linear;
};

// Gleich laute Überblendung zweier verschiedener Quellen (Erhebung F81: linear verliert in der Mitte median −2,5 bis
// −2,9 dB, p10 bis −8,8 dB): u in [0, 1] -> alt = cos(u·π/2), neu = sin(u·π/2), alt² + neu² = 1.
inline void gleich_laut(float u, float& alt, float& neu) noexcept {
  const float w = u * 1.57079632679f;
  alt = std::cos(w);
  neu = std::sin(w);
}

}  // namespace cdj
