// K2 Slice 3: Summen-Kleber (Faust co.compressor_stereo(2, schwelle, 0.03, 0.2), Schwelle per setze_schwelle()). Das erzeugte Objekt liegt auf dem Heap und
// wird im Konstruktor angelegt (außerhalb des Callbacks). block() arbeitet in place und allokiert nicht.
#pragma once
#include <algorithm>
#include <memory>
#include <cypherdj/dsp/denormal.h>
#include "cypherdj/faust_basis.h"
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wunused-parameter"
#include "cypherdj/gen/kleber.h"
#pragma GCC diagnostic pop

namespace cdj {

class Kleber {
 public:
  static constexpr int kPuffer = 1024;  // = cypherdj::dsp::kMaxFrames (MIX_BLOCK)
  explicit Kleber(int sr = 48000) : z_(std::make_unique<cdjfaust::KleberDsp>()) {
    z_->init(sr);
    z_->buildUserInterface(&ui_);
    schwelle_ = ui_.zone("schwelle");
  }
  // Schwelle in dB auf dem Detektor |L|+|R| (Faust glättet mit si.smoo, ~20 ms). Nicht während block(); Vorgabe +60 = aus.
  void setze_schwelle(float db) { if (schwelle_) *schwelle_ = db; }
  // Zustand (Hüllkurve) auf Null, wie frisch angelegt; allokiert nicht.
  void leeren() { z_->instanceClear(); }
  // Faust darf Ein- und Ausgang nicht teilen: in die Member-Puffer rechnen, zurückkopieren. n > kPuffer in Stücken.
  void block(float* l, float* r, int n) {
    cypherdj::dsp::DenormalSchutz schutz;   // der Zustand klingt nach Stille in Subnormalen aus (6 statt 0,8 µs je Block)
    for (int o = 0; o < n; o += kPuffer) {
      const int m = std::min(kPuffer, n - o);
      float* ein[2] = {l + o, r + o};
      float* aus[2] = {pl_, pr_};
      z_->compute(m, ein, aus);
      std::copy(pl_, pl_ + m, l + o);
      std::copy(pr_, pr_ + m, r + o);
    }
  }
 private:
  std::unique_ptr<cdjfaust::KleberDsp> z_;
  cdjfaust::UI ui_;
  float* schwelle_ = nullptr;
  float pl_[kPuffer], pr_[kPuffer];
};

}  // namespace cdj
