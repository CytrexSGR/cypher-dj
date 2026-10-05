// K2 Slice 1: Sidechain-Duck aus dem Kick-Ereignis. Header-only, damit mixer.cpp ihn nutzt, ohne dass die explizit
// gelisteten Link-Ziele in kern/CMakeLists.txt eine neue Quelldatei brauchen (Nahtstellen §3c).
// Form: linearer Attack über ATTACK Samples auf das Ziel, exponentielle Erholung: 5 τ = release_ms (≈ 99 %),
// ausgelaufen erst bei 1 − g ≤ 1e-4 (≈ 9 τ ≈ 1,8 · release_ms), damit der letzte Schritt auf 1,0 unhörbar bleibt (≤ −80 dB).
// Die Tiefe gilt je Auslöser: attack_ziel_ wird beim Auslösen festgehalten, eine Änderung mitten im Attack wirkt erst
// beim nächsten Auslöser (sonst spränge g); die Erholung läuft immer gegen 1.
// Tiefe 0 dB: Ziel 1.0f, jeder Wert bleibt bitgleich 1.0f. Keine Allokation, keine Ausnahme.
#pragma once
#include <cmath>
#include <cstdint>

namespace cdj {

class Duck {
 public:
  static constexpr int MAX_WARTEND = 16;
  static constexpr int ATTACK = 240;   // 5 ms bei 48 kHz (Snoman: Attack 5 ms)

  void setze(float tiefe_db, float release_ms, float sr = 48000.0f) {
    ziel_ = tiefe_db >= 0.0f ? 1.0f : std::pow(10.0f, tiefe_db / 20.0f);
    const float tau = std::fmax(release_ms, 1.0f) * 0.001f * sr / 5.0f;   // 5 τ = release_ms
    rel_ = std::exp(-1.0f / tau);
  }
  // versatz: Samples ab dem Anfang des nächsten block(); darf größer als der Block sein (wartet)
  void ausloesen(int64_t versatz) {
    if (versatz >= 0 && n_w_ < MAX_WARTEND) warte_[n_w_++] = versatz;
  }
  bool ruhig() const { return n_w_ == 0 && phase_ == Phase::ruhe; }
  float ziel() const { return ziel_; }

  void block(float* gain, int n) {
    for (int i = 0; i < n; ++i) {
      for (int w = 0; w < n_w_; ++w)
        if (warte_[w] == i) { phase_ = Phase::attack; start_g_ = g_; attack_ziel_ = ziel_; a_ = 0; }
      switch (phase_) {
        case Phase::ruhe: g_ = 1.0f; break;
        case Phase::attack:
          ++a_;
          g_ = a_ >= ATTACK ? attack_ziel_
                                : start_g_ + (attack_ziel_ - start_g_) * (static_cast<float>(a_) / ATTACK);
          if (a_ >= ATTACK) { phase_ = Phase::erholung; e_ = 1.0f - g_; }
          break;
        case Phase::erholung:
          e_ *= rel_;   // Abstand zu 1 mitführen: 1 − g in float bliebe bei langem Release an der Rundung hängen
          g_ = 1.0f - e_;
          if (e_ <= 1e-4f) { g_ = 1.0f; phase_ = Phase::ruhe; }   // Sprung höchstens 1e-4; auch bei Tiefe 0 endet die Erholung
          break;
      }
      gain[i] = g_;
    }
    int k = 0;
    for (int w = 0; w < n_w_; ++w)
      if (warte_[w] >= n) warte_[k++] = warte_[w] - n;
    n_w_ = k;
  }

 private:
  enum class Phase : uint8_t { ruhe, attack, erholung };
  Phase phase_ = Phase::ruhe;
  float e_ = 0.0f, g_ = 1.0f, start_g_ = 1.0f, ziel_ = 1.0f, attack_ziel_ = 1.0f, rel_ = 0.0f;
  int a_ = 0;
  int64_t warte_[MAX_WARTEND] = {};
  int n_w_ = 0;
};

}  // namespace cdj
