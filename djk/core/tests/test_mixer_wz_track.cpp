// 1.15 A3, review obligation 1 (A1b): the mix-tool slots (wz_w_, wz_spektrum_kanal_) are carried on at the end of the block like
// every other slot of the Mixer (Mixer::verarbeite, lambda nachfuehren). Same path as Kern::audio (core_signalbox.cpp:623-642):
// sw_->hand, sw_->prozess, aenderungen -> mixer_->verlauf, mixer_->verarbeite.
// After a hand movement of a tool row, the block must leave .w at the new value (the course's last sample) and the course
// pointer cleared (it points into a stellwerk buffer that is rewritten by the next prozess). Rows: gate/schwelle (ramp),
// util/breite (ramp), gate/an (switch, ganz), spektrum/kanal (the global slot). Control: the compressor row komp/schwelle,
// which the Mixer carried on before A1b.
#include <memory>

#include "cypherdj/mixer.h"
#include "cypherdj/signalbox/signalbox.h"
#include "check.h"

namespace sw = cypherdj::stellwerk;

namespace {
struct Uhr128 final : sw::Uhr {
  double beat(int64_t s) const override { return static_cast<double>(s) / 22500.0; }
  double sample_genau(double b) const override { return b * 22500.0; }
  double bpm(int64_t) const override { return 128.0; }
};
constexpr int N = 256;
}  // namespace

int main() {
  Uhr128 uhr;
  auto st = std::make_unique<sw::Stellwerk>(uhr, nullptr);
  auto m = std::make_unique<cdj::Mixer>(st->tabelle());
  float ml[N], mr[N], cl[N], cr[N];
  const char* const pfade[] = {"erz/1/gate/schwelle", "erz/1/util/breite", "erz/1/gate/an", "spektrum/kanal", "erz/1/komp/schwelle"};
  int r[5];
  float vorher[5];
  for (int i = 0; i < 5; ++i) {
    r[i] = st->tabelle().suche(pfade[i]);
    PRUEF(r[i] >= 0);
    vorher[i] = st->wert(r[i]);
    m->setze_sofort(r[i], vorher[i]);
    PRUEF(m->wert(r[i]) == vorher[i]);
  }
  (void)0;
  const float x[5] = {0.9f, 0.2f, 1.0f, 0.5f, 0.3f};
  int64_t s0 = 0;
  // block 0: the teaching grip; block 1: one grip per row at sample 100; the blocks after must not move anything
  for (int blk = 0; blk < 8; ++blk, s0 += N) {
    if (blk == 0)   // the first absolute grip only teaches the stellwerk where the control is (pickup, stellung_bekannt) and is swallowed
      for (int i = 0; i < 5; ++i) st->hand(sw::Griff{s0 + 100, static_cast<int16_t>(r[i]), sw::GriffArt::absolut, 0.05f, nullptr});
    if (blk == 1)
      for (int i = 0; i < 5; ++i) st->hand(sw::Griff{s0 + 100, static_cast<int16_t>(r[i]), sw::GriffArt::absolut, x[i], nullptr});
    st->prozess(s0, N);
    const sw::Aenderung* a;
    const int na = st->aenderungen(&a);
    for (int i = 0; i < na; ++i) m->verlauf(a[i].regler, a[i].verlauf);
    if (blk == 1) {
      bool alle_offen = true;
      for (int i = 0; i < 5; ++i) alle_offen = alle_offen && m->verlauf_offen(r[i]);
      PRUEF(na >= 5);
      PRUEF(alle_offen);   // positive control: the course is set before the block (so "cleared after" means something)
    }
    m->verarbeite(N, ml, mr, cl, cr);
    if (blk >= 1)
      for (int i = 0; i < 5; ++i) {
        std::printf("block %d %-22s stellwerk %.6f  mixer .w %.6f  before %.6f  course open: %d\n", blk, pfade[i], st->wert(r[i]),
                    m->wert(r[i]), vorher[i], m->verlauf_offen(r[i]));
        PRUEF(!m->verlauf_offen(r[i]));
        PRUEF(m->wert(r[i]) == st->wert(r[i]));
        PRUEF(m->wert(r[i]) != vorher[i]);
      }
  }
  PRUEF_ENDE();
}
