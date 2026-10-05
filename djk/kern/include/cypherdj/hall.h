// K2 Slice 2: Hall (Faust re.zita_rev1_stereo) für den Rückweg fx/2. Das erzeugte Objekt ist ~860 KB groß: es liegt auf
// dem Heap und wird im Konstruktor angelegt (außerhalb des Callbacks). block() allokiert nicht.
#pragma once
#include <memory>
#include <cypherdj/dsp/denormal.h>
#include "cypherdj/faust_basis.h"
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wunused-parameter"
#include "cypherdj/gen/zita_hall.h"
#pragma GCC diagnostic pop

namespace cdj {

class Hall {
 public:
  explicit Hall(int sr = 48000) : z_(std::make_unique<cdjfaust::ZitaHall>()) { z_->init(sr); }
  void block(const float* ein_l, const float* ein_r, float* aus_l, float* aus_r, int n) {
    cypherdj::dsp::DenormalSchutz schutz;   // Nachhall klingt in Subnormalen aus
    float* ein[2] = {const_cast<float*>(ein_l), const_cast<float*>(ein_r)};
    float* aus[2] = {aus_l, aus_r};
    z_->compute(n, ein, aus);
  }
  void leeren() { z_->instanceClear(); }   // Audit F01: NaN-Riegel; Faust-Zustand auf 0, keine Allokation
 private:
  std::unique_ptr<cdjfaust::ZitaHall> z_;
};

}  // namespace cdj
