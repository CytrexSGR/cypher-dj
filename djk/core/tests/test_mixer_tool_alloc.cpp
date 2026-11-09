// 1.15 A3, test (A): real-time discipline of gate and utility in the channel strip. 10^5 blocks of sizes 1..1024 through the
// Stellwerk path of Kern::audio (sw_->hand, sw_->prozess, aenderungen -> mixer_->verlauf, mixer_->verarbeite), parameters of
// all 333 gate, utility, multiband and spectrum-source rows (and the spectrum source) changing by hand grips, tools switching on and off. Counted in the
// window: allocations, frees, blocking locks, sleeps (alloc_intercept.h): all four must be 0.
// Positive control FIRST: the watcher must see a vector allocation and a mutex lock, else the zero is worthless. The run is also
// checked to have exercised the tools (gate and utility in use in a good part of the blocks, outputs finite).
// Under ASan/TSan the interception is missing: "skipped", never "passed".
#include <cstdint>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

#include "cypherdj/mixer.h"
#include "cypherdj/signalbox/signalbox.h"
#include "check.h"
#include "alloc_intercept.h"   // last: replaces malloc and relatives

namespace sw = cypherdj::stellwerk;

namespace {
struct Uhr128 final : sw::Uhr {
  double beat(int64_t s) const override { return static_cast<double>(s) / 22500.0; }
  double sample_genau(double b) const override { return b * 22500.0; }
  double bpm(int64_t) const override { return 128.0; }
};
uint32_t zufall(uint32_t& x) {
  x ^= x << 13;
  x ^= x >> 17;
  x ^= x << 5;
  return x;
}
}  // namespace

int main() {
  if (!ALLOC_ABFANG_VERFUEGBAR) {
    std::printf("skipped (sanitizer build): allocation watcher not available\n");
    return 0;
  }
  // positive control
  {
    abfang_an();
    { std::vector<float> v(1000); v[1] = 1.0f; }
    std::mutex mu;
    mu.lock();
    mu.unlock();
    const AbfangZahlen pk = abfang_zahlen();
    abfang_aus();
    std::printf("positive control: %ld allocations, %ld frees, %ld locks\n", pk.alloc, pk.frei, pk.sperren);
    PRUEF(pk.alloc >= 1 && pk.sperren >= 1);
  }
  Uhr128 uhr;
  auto st = std::make_unique<sw::Stellwerk>(uhr, nullptr);
  auto m = std::make_unique<cdj::Mixer>(st->tabelle());
  std::vector<int> zeilen;
  for (int k = 0; k < cdj::MIX_KANAELE; ++k) {
    if (k == 11) continue;   // erz/8 has no tool rows
    const std::string kn = cdj::Mixer::kanal_name(k);
    if (k < cdj::MIX_QUELLEN)
      for (const char* s : {"gate/an", "gate/schwelle", "gate/hysterese", "gate/ratio", "gate/bereich", "gate/attack", "gate/hold", "gate/release", "gate/sc"})
        zeilen.push_back(st->tabelle().suche((kn + "/" + s).c_str()));
    if (k >= cdj::MIX_QUELLEN) {   // 1.15 A4: the 24 multiband rows of the buses
      for (const char* s : {"mb/an", "mb/grenze_tief", "mb/grenze_hoch"}) zeilen.push_back(st->tabelle().suche((kn + "/" + s).c_str()));
      for (const char* bnd : {"tief", "mitte", "hoch"})
        for (const char* f : {"schwelle", "ratio", "attack", "release", "knie", "makeup", "umgehen"})
          zeilen.push_back(st->tabelle().suche((kn + "/mb/" + bnd + "/" + f).c_str()));
    }
    for (const char* s : {"util/balance", "util/breite", "util/bassmono", "util/phase_l", "util/phase_r", "util/tausch", "util/dc"})
      zeilen.push_back(st->tabelle().suche((kn + "/" + s).c_str()));
  }
  zeilen.push_back(st->tabelle().suche("spektrum/kanal"));
  for (int z : zeilen) PRUEF(z >= 0);
  PRUEF(zeilen.size() == 13 * 9 + 17 * 7 + 4 * 24 + 1);   // 117 gate + 119 utility + 96 multiband + the spectrum source
  for (int z : zeilen) {   // the stellwerk and the mixer start from the same values
    m->setze_sofort(z, st->wert(z));
  }
  static float ml[cdj::MIX_BLOCK], mr[cdj::MIX_BLOCK], cl[cdj::MIX_BLOCK], cr[cdj::MIX_BLOCK];
  uint32_t zz = 2463534242u;
  int64_t s0 = 0;
  // warm-up outside the window: teach every row its position (the first absolute grip is swallowed), several blocks
  for (int blk = 0; blk < 4; ++blk) {
    for (int z : zeilen) st->hand(sw::Griff{s0 + 5, static_cast<int16_t>(z), sw::GriffArt::absolut, 0.3f, nullptr});
    st->prozess(s0, 64);
    s0 += 64;
  }
  const long BLOECKE = 100000;
  const int groessen[] = {1, 256, 17, 1024, 64, 255, 512, 3, 128, 1000, 33, 256, 800, 2, 129};
  AbfangZahlen summe;
  long gate_bloecke = 0, util_bloecke = 0, mb_bloecke = 0, mb_ausgeblendet = 0, mb_gblenden = 0, nicht_endlich = 0;
  for (long b = 0; b < BLOECKE; ++b) {
    const int n = groessen[b % 15];
    for (int k = 0; k < cdj::MIX_KANAELE; ++k)
      for (int i = 0; i < n; ++i) {   // fill the inputs (not counted: plain stores)
        const float x = 0.3f * static_cast<float>(static_cast<int>(zufall(zz) & 0xffff) - 32768) / 32768.0f;
        m->eingang_l(k)[i] = x;
        m->eingang_r(k)[i] = 0.5f * x;
      }
    abfang_an();
    for (int g = 0; g < 2; ++g) {
      const int z = zeilen[zufall(zz) % zeilen.size()];
      st->hand(sw::Griff{s0 + n / 2, static_cast<int16_t>(z), sw::GriffArt::absolut, static_cast<float>(zufall(zz) & 1023) / 1023.0f, nullptr});
    }
    st->prozess(s0, n);
    const sw::Aenderung* a;
    const int na = st->aenderungen(&a);
    for (int i = 0; i < na; ++i) m->verlauf(a[i].regler, a[i].verlauf);
    m->verarbeite(n, ml, mr, cl, cr);
    abfang_aus();
    summe += abfang_zahlen();
    s0 += n;
    int gk = 0, uk = 0, mk = 0, mf = 0;
    for (int k = 0; k < cdj::MIX_KANAELE; ++k) {
      gk += m->gate_aktiv(k);
      uk += m->util_aktiv(k);
      mk += m->mb_aktiv(k);
      mf += m->mb_aktiv(k) && m->mb_blende(k) > 0 && m->mb_blende(k) < 480;   // caught in the middle of a crossfade (it copies the dry signal)
    }
    mb_gblenden += m->mb_grenzblende(14) + m->mb_grenzblende(15) + m->mb_grenzblende(16) + m->mb_grenzblende(17) > 0;   // crossover crossfade running
    mb_bloecke += mk > 0;
    mb_ausgeblendet += mf > 0;
    gate_bloecke += gk > 0;
    util_bloecke += uk > 0;
    bool endlich = true;
    for (int i = 0; i < n; ++i) endlich = endlich && std::isfinite(ml[i]) && std::isfinite(mr[i]);
    nicht_endlich += !endlich;
  }
  std::printf("%ld blocks: %ld allocations, %ld frees, %ld locks, %ld sleeps; gate in use in %ld blocks, utility in %ld, multiband in %ld (of those mid-crossfade %ld, with a crossover crossfade running %ld, crossfades started %u); blocks with non-finite output %ld\n",
              BLOECKE, summe.alloc, summe.frei, summe.sperren, summe.schlafen, gate_bloecke, util_bloecke, mb_bloecke, mb_ausgeblendet, mb_gblenden, m->mb_blenden(14) + m->mb_blenden(15) + m->mb_blenden(16) + m->mb_blenden(17), nicht_endlich);
  // 1.15 A4 fix round (M7 with continuous turning): all eight crossover rows of the four buses are moved a little in EVERY block, as a
  // knob dragged by hand does (the warm-up of the second object gets a new target in place in nearly every block, the crossfades run one
  // after the other), the multiband on. Counted like the run above.
  {
    std::vector<int> an_zeilen, dreh_zeilen;
    for (int k = cdj::MIX_QUELLEN; k < cdj::MIX_KANAELE; ++k) {
      const std::string kn = k == 14 ? "bus/1" : k == 15 ? "bus/2" : k == 16 ? "bus/3" : "bus/4";
      an_zeilen.push_back(st->tabelle().suche((kn + "/mb/an").c_str()));
      for (const char* f : {"mb/grenze_tief", "mb/grenze_hoch"}) dreh_zeilen.push_back(st->tabelle().suche((kn + "/" + f).c_str()));
    }
    for (int z : an_zeilen) {
      PRUEF(z >= 0);
      st->hand(sw::Griff{s0 + 5, static_cast<int16_t>(z), sw::GriffArt::absolut, 1.0f, nullptr});
    }
    for (int z : dreh_zeilen) PRUEF(z >= 0);
    st->prozess(s0, 64);
    s0 += 64;
  for (const bool zufall_modus : {false, true}) {
    const unsigned vorher = m->mb_blenden(14) + m->mb_blenden(15) + m->mb_blenden(16) + m->mb_blenden(17);
    AbfangZahlen dreh;
    long dreh_gblenden = 0, dreh_nicht_endlich = 0;
    const long DREH_BLOECKE = 20000;
    for (long b = 0; b < DREH_BLOECKE; ++b) {
      const int n = groessen[b % 15];
      for (int k = 0; k < cdj::MIX_KANAELE; ++k)
        for (int i = 0; i < n; ++i) {
          const float x = 0.3f * static_cast<float>(static_cast<int>(zufall(zz) & 0xffff) - 32768) / 32768.0f;
          m->eingang_l(k)[i] = x;
          m->eingang_r(k)[i] = 0.5f * x;
        }
      abfang_an();
      const float phase = static_cast<float>(b % 1000) / 1000.0f;   // a triangle wave over the knob range, 1000 blocks per sweep
      const float w = 0.2f + 0.6f * (phase < 0.5f ? 2.0f * phase : 2.0f - 2.0f * phase);
      for (int z : dreh_zeilen) {
        if (!zufall_modus) {
          st->hand(sw::Griff{s0 + n / 2, static_cast<int16_t>(z), sw::GriffArt::absolut, w, nullptr});
        } else if (zufall(zz) % 3 == 0) {   // random walk: a new target for this row in about every third block, anywhere in the knob range
          st->hand(sw::Griff{s0 + n / 2, static_cast<int16_t>(z), sw::GriffArt::absolut, static_cast<float>(zufall(zz) & 1023) / 1023.0f, nullptr});
        }
      }
      st->prozess(s0, n);
      const sw::Aenderung* a;
      const int na = st->aenderungen(&a);
      for (int i = 0; i < na; ++i) m->verlauf(a[i].regler, a[i].verlauf);
      m->verarbeite(n, ml, mr, cl, cr);
      abfang_aus();
      dreh += abfang_zahlen();
      s0 += n;
      dreh_gblenden += m->mb_grenzblende(14) + m->mb_grenzblende(15) + m->mb_grenzblende(16) + m->mb_grenzblende(17) > 0;
      bool endlich = true;
      for (int i = 0; i < n; ++i) endlich = endlich && std::isfinite(ml[i]) && std::isfinite(mr[i]);
      dreh_nicht_endlich += !endlich;
    }
    const unsigned danach = m->mb_blenden(14) + m->mb_blenden(15) + m->mb_blenden(16) + m->mb_blenden(17);
    std::printf("continuous turning (%s), %ld blocks: %ld allocations, %ld frees, %ld locks, %ld sleeps; %u crossfades started, running in %ld blocks; non-finite blocks %ld\n",
                zufall_modus ? "random targets" : "triangle sweep", DREH_BLOECKE, dreh.alloc, dreh.frei, dreh.sperren, dreh.schlafen, danach - vorher, dreh_gblenden, dreh_nicht_endlich);
    PRUEF(dreh.alloc == 0);
    PRUEF(dreh.frei == 0);
    PRUEF(dreh.sperren == 0);
    PRUEF(dreh.schlafen == 0);
    PRUEF(danach - vorher > 200);   // the turning really started crossfades (in the second object)
    PRUEF(dreh_gblenden > 1000);
    PRUEF(dreh_nicht_endlich == 0);
  }
  }
  PRUEF(summe.alloc == 0);
  PRUEF(summe.frei == 0);
  PRUEF(summe.sperren == 0);
  PRUEF(summe.schlafen == 0);
  PRUEF(gate_bloecke > BLOECKE / 4);   // the run really exercised the tools
  PRUEF(util_bloecke > BLOECKE / 4);
  PRUEF(mb_bloecke > BLOECKE / 4);   // 1.15 A4: the multiband ran in a good part of the blocks, and some of them inside a crossfade
  PRUEF(mb_ausgeblendet > 100);
  PRUEF(mb_gblenden > 100);   // 1.15 A4 M5 fix: crossover crossfades (the second object, the dry copy) ran during hand grips on the crossover rows
  PRUEF(nicht_endlich == 0);
  PRUEF_ENDE();
}
