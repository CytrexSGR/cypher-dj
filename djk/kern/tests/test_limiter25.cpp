// Scheibe 25: Master-Limiter aus 14 (djk/kern/dsp/messer, MasterLimiter, Decke limiter_dbtp −1 dBTP) am Ende des
// Masters im Mixer (MVP „Lücken und Entscheide“: „Limiter aus 14 in den Master: 25“; ADR 008 Punkt 2 und 3).
// 1. Fehlerfall-Signal: deck/1 mit Trim +12 dB und EQ +6 dB in allen drei Bändern, Sinus bei fs/4 mit 45° Phase
//    (Abtastspitze 0,636, Echtspitze 0,9, also nach Trim und EQ weit über 0 dBTP): Echtspitze am Master
//    (libebur128, 4-fach) ≤ −1 dBTP. Gegen die Mutation ohne Limiter scheitert dieser Punkt (WILL_FAIL).
// 2. Negativ-Kontrolle: leiser Sinus (−20 dBFS) ohne Trim und EQ: Master = derselbe Kanalzug allein gerechnet, nur um
//    den Vorhalt verschoben, exakt (Limiter-Verstärkung 1).
// 3. Cue hört den Master so wie der Saal: cue/mix +1 → Cue bitgleich zum Master; PFL um denselben Vorhalt verzögert
//    (cue/mix 0, deck/1 mit PFL und Fader 0 dB: Cue = ½ PFL + ½ Master = Master).
// 4. Prüfklick master (Z1) geht am Limiter vorbei: bitgleich und ohne Vorhalt (01, 08, 18 messen den Versatz).
#include <cmath>
#include <cstdio>
#include <cstring>
#include <memory>
#include <vector>

#include "cypherdj/mixer.h"
#include "ebur128.h"
#include "pruef.h"

namespace sw = cypherdj::stellwerk;

struct Pruefling {
  sw::ReglerTabelle tab;
  std::unique_ptr<cdj::Mixer> m;
  float ml[256], mr[256], cl[256], cr[256];
  std::vector<float> master, cue;
  Pruefling() : m(std::make_unique<cdj::Mixer>(tab)) {}
  void setze(const char* pfad, float w) { m->setze_sofort(tab.suche(pfad), w); }
  void block(int k, const float* x, const float* klick = nullptr) {
    if (k >= 0) {
      std::memcpy(m->eingang_l(k), x, sizeof(float) * 256);
      std::memcpy(m->eingang_r(k), x, sizeof(float) * 256);
    }
    if (klick) {
      std::memcpy(m->master_eingang_l(), klick, sizeof(float) * 256);
      std::memcpy(m->master_eingang_r(), klick, sizeof(float) * 256);
    }
    m->verarbeite(256, ml, mr, cl, cr);
    master.insert(master.end(), ml, ml + 256);
    cue.insert(cue.end(), cl, cl + 256);
  }
};

static double echtspitze_dbtp(const std::vector<float>& x, size_t ab) {
  ebur128_state* st = ebur128_init(1, 48000, EBUR128_MODE_TRUE_PEAK);
  ebur128_add_frames_float(st, x.data() + ab, x.size() - ab);
  double p = 0.0;
  ebur128_true_peak(st, 0, &p);
  ebur128_destroy(&st);
  return p > 0.0 ? 20.0 * std::log10(p) : -200.0;
}

int main() {
  const double pi = 3.14159265358979323846;
  // 1. heißes Signal
  {
    Pruefling p;
    p.setze("deck/1/fader", 0.0f);
    p.setze("deck/1/trim", 12.0f);
    p.setze("deck/1/eq/tief", 6.0f);
    p.setze("deck/1/eq/mitte", 6.0f);
    p.setze("deck/1/eq/hoch", 6.0f);
    float x[256];
    for (int b = 0; b < 400; ++b) {
      for (int i = 0; i < 256; ++i) x[i] = 0.9f * (float)std::sin(pi / 2 * (b * 256 + i) + pi / 4);
      p.block(0, x);
    }
    const double tp = echtspitze_dbtp(p.master, 4800);
    std::printf("heiß: Echtspitze Master %.3f dBTP (Decke -1), Vorhalt %d Samples\n", tp, p.m->limiter_vorhalt());
    PRUEF(tp <= -1.0);
  }
  // 2. Negativ-Kontrolle: leise, Limiter greift nicht, nur Vorhalt (Bezug: derselbe Kanalzug allein gerechnet)
  auto bezug = [](const std::vector<float>& ein) {
    auto kz = std::make_unique<cypherdj::dsp::Kanalzug>();
    kz->zuruecksetzen();
    kz->setze_sofort(cypherdj::dsp::Regler::fader, 0.0f);
    std::vector<float> r(ein.size()), rr(256);
    cypherdj::dsp::KanalzugAusgang a;
    for (size_t b = 0; b < ein.size(); b += 256) {
      a.haupt_l = r.data() + b;
      a.haupt_r = rr.data();
      kz->verarbeite(ein.data() + b, ein.data() + b, 256, a);
    }
    return r;
  };
  {
    Pruefling p;
    p.setze("deck/1/fader", 0.0f);
    float x[256];
    std::vector<float> ein;
    for (int b = 0; b < 40; ++b) {
      for (int i = 0; i < 256; ++i) x[i] = 0.1f * (float)std::sin(2 * pi * 997.0 * (b * 256 + i) / 48000.0);
      ein.insert(ein.end(), x, x + 256);
      p.block(0, x);
    }
    const auto r = bezug(ein);
    const int v = p.m->limiter_vorhalt();
    double abw = 0.0;
    for (size_t i = 0; i + v < p.master.size(); ++i) abw = std::fmax(abw, std::fabs(p.master[i + v] - r[i]));
    double vorher = 0.0;
    for (int i = 0; i < v; ++i) vorher = std::fmax(vorher, std::fabs(p.master[i]));
    std::printf("leise: Abweichung nach Vorhalt %.3g, vor dem Vorhalt Spitze %.3g, Absenkung %.3f dB\n", abw, vorher,
                p.m->limiter_absenkung_db());
    PRUEF(v > 0 && abw == 0.0 && vorher == 0.0);
  }
  // 3. Cue: cue/mix +1 gleich Master; PFL im Takt des Masters (cue/mix 0: Cue = ½ PFL + ½ Master = Master)
  {
    Pruefling p;
    p.setze("deck/1/fader", 0.0f);
    p.setze("cue/mix", 1.0f);
    p.setze("cue/pegel", 0.0f);
    float x[256];
    for (int b = 0; b < 40; ++b) {
      for (int i = 0; i < 256; ++i) x[i] = 1.5f * (float)std::sin(2 * pi * 997.0 * (b * 256 + i) / 48000.0);
      p.block(0, x);
    }
    bool gleich = true;
    for (size_t i = 0; i < p.master.size(); ++i) gleich = gleich && p.cue[i] == p.master[i];
    PRUEF(gleich);
    Pruefling q;
    q.setze("deck/1/fader", 0.0f);
    q.setze("deck/1/pfl", 1.0f);
    q.setze("cue/mix", 0.0f);
    q.setze("cue/pegel", 0.0f);
    for (int b = 0; b < 40; ++b) {
      for (int i = 0; i < 256; ++i) x[i] = 0.2f * (float)std::sin(2 * pi * 997.0 * (b * 256 + i) / 48000.0);
      q.block(0, x);
    }
    double abw = 0.0, spitze = 0.0;
    for (size_t i = 0; i < q.cue.size(); ++i) {
      abw = std::fmax(abw, std::fabs(q.cue[i] - q.master[i]));
      spitze = std::fmax(spitze, std::fabs(q.cue[i]));
    }
    std::printf("Cue mit PFL gegen Master: Abweichung %.3g (Spitze %.3f)\n", abw, spitze);
    PRUEF(spitze > 0.1 && abw < 1e-6);
  }
  // 4. Prüfklick master am Limiter vorbei
  {
    Pruefling p;
    float x[256], k[256];
    std::memset(x, 0, sizeof x);
    for (int b = 0; b < 4; ++b) {
      std::memset(k, 0, sizeof k);
      if (b == 1) k[7] = 0.9f;
      p.block(-1, x, k);
    }
    PRUEF(p.master[256 + 7] == 0.9f);
  }
  PRUEF_ENDE();
}
