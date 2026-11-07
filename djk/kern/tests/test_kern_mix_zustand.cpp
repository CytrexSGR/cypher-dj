// 1.15 A6: the kern publishes Ereignis::MIX_ZUSTAND (-> /zustand/mix) like komp_zustand: 10 Hz per channel, only where a tool runs.
//  (Z1) nothing runs: no event at all (negative control, 150 cycles)
//  Everything runs twice: blocks of 256 samples and of 240 (240 divides 4800, so there every gap must be exactly 4800).
//  (Z2) gate on erz/1 (noise under threshold) and multiband on bus/1 (1 kHz sine over the mid threshold): per channel exactly 40 events in 192 000 samples (10 Hz), none for any other channel, pegel[0] = gate reduction (> 40 dB) on erz/1 only, pegel[1..3] =
//       low/mid/high multiband reduction (mid > 3 dB) on bus/1 only, pegel[4] = 0 (limiter not built), all >= 0
//  (Z3) gate switched off: erz/1 stops publishing, bus/1 goes on (positive control)
//  (Z4) multiband switched off as well: the stream ends, no event in the last 300 cycles
//  A5c, limiter as a criterion (own kern per case, bus/2 carries a 1 kHz sine at -6 dBFS, no gate, no multiband):
//  (Z5) limiter built, lim/an 1, bus fader open (hand only), ceiling -20 dBFS: bus/2 publishes 40 events in 192 000 samples with pegel[4] about 14 dB (13..15), nothing else does
//  (Z6) negative control, limiter built but lim/an 0: no event at all
//  (Z7) negative control, limiter NOT built (lim/an 1 sent, does nothing): no event at all
//  (Z8) lim/an switched off again after Z5: the stream ends (the crossfade of 480 samples is over long before the last 300 cycles)
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <map>
#include <memory>
#include <string>
#include <vector>

#include "cypherdj/kern.h"
#include "pruef.h"

static void teil(cdj::Befehlsring& bef, int id, const char* pfad, float wert, const char* quelle = "pruefstand") {
  cdj::Befehl b{};
  b.art = cdj::Befehl::TEIL;
  b.id = id;
  std::snprintf(b.quelle, sizeof b.quelle, "%s", quelle);
  std::snprintf(b.pfad, sizeof b.pfad, "%s", pfad);
  b.ab_beat = 1.0;
  b.wert = wert;
  b.politik = 1;
  PRUEF(bef.schiebe(b));
}

struct Mess {
  std::map<std::string, std::vector<cdj::Ereignis>> je_kanal;
  int gesamt = 0;
};

// Runs the whole scenario with blocks of N samples. 256 does not divide 4800 (a gap varies by up to one block); 240 does (every gap is exactly 4800).
static void szenario(const int N) {
  std::printf("-- block size %d\n", N);
  const int ZYK_192000 = 192000 / N;   // cycles for exactly 192 000 samples = 40 periods of 4800
  auto zyk = [&](int c256) { return c256 * 256 / N; };   // the other phases are scaled from 256-sample cycles
  std::unique_ptr<unsigned char[]> mem{new unsigned char[CDJ_RING_BYTES]()};
  auto* ring = reinterpret_cast<cdj_ring_kopf*>(mem.get());
  ring->version = CDJ_RING_VERSION;
  ring->rate = CDJ_RING_RATE;
  ring->kanaele = CDJ_RING_KANAELE;
  ring->cap = CDJ_RING_CAP;
  std::memcpy(ring->magic, "CDJB", 4);
  auto bef = std::make_unique<cdj::Befehlsring>();
  auto ere = std::make_unique<cdj::Ereignisring>();
  auto kern = std::make_unique<cdj::Kern>(128.0, ring, bef.get(), ere.get());
  cdj::Mixer& mix = const_cast<cdj::Mixer&>(kern->mixer());   // test only: the bus input has no other door
  const int BUS1 = cdj::Mixer::kanal_index("bus/1");

  std::vector<float> l(N), r(N);
  uint32_t z = 7;
  long t = 0;
  Mess m;
  int id = 1;
  auto lauf = [&](int zyklen, bool wieder_leeren) {
    if (wieder_leeren) m = Mess{};
    for (int zyk = 0; zyk < zyklen; ++zyk) {
      for (int i = 0; i < N; ++i) {
        z = z * 1664525u + 1013904223u;
        l[i] = r[i] = 0.002f * (static_cast<float>(z >> 8) / 16777216.0f - 0.5f);   // peak 0.001 = -60 dBFS
        const float s = 0.3f * static_cast<float>(std::sin(2.0 * 3.14159265358979323846 * 1000.0 * static_cast<double>(t + i) / 48000.0));
        mix.eingang_l(BUS1)[i] = s;
        mix.eingang_r(BUS1)[i] = s;
      }
      t += N;
      kern->rueck(1, l.data(), r.data());
      const int64_t n0 = kern->sample();
      kern->zyklus(N, n0 * 20833);
      cdj::Ereignis e;
      while (ere->hole(e)) {
        if (e.art != cdj::Ereignis::MIX_ZUSTAND) continue;
        m.je_kanal[e.pfad].push_back(e);
        ++m.gesamt;
      }
    }
  };
  auto n_von = [&](const char* k) { return m.je_kanal.count(k) ? static_cast<int>(m.je_kanal[k].size()) : 0; };

  // (Z1)
  lauf(zyk(150), true);
  std::printf("Z1: nothing runs: %d events in 150 cycles\n", m.gesamt);
  PRUEF(m.gesamt == 0);

  // (Z2)
  teil(*bef, id++, "erz/1/gate/an", 1.0f);
  teil(*bef, id++, "bus/1/mb/an", 1.0f);
  teil(*bef, id++, "bus/1/mb/mitte/schwelle", -30.0f);
  teil(*bef, id++, "bus/1/mb/mitte/ratio", 8.0f);
  lauf(zyk(100), true);   // settle (the commands take effect, gate and band settle)
  lauf(ZYK_192000, true);   // 192 000 samples = 40 periods of 4800
  const int ne = n_von("erz/1"), nb = n_von("bus/1");
  std::printf("Z2: erz/1 %d events, bus/1 %d events, total %d (expected 40 each, none else)\n", ne, nb, m.gesamt);
  PRUEF(ne == 40);   // any 192 000-sample window holds exactly 40 multiples of 4800
  PRUEF(nb == 40);
  PRUEF(m.gesamt == ne + nb);   // no other channel
  for (const auto& e : m.je_kanal["erz/1"]) {
    PRUEF(e.pegel[0] > 40.0f && std::isfinite(e.pegel[0]));
    PRUEF(e.pegel[1] == 0.0f && e.pegel[2] == 0.0f && e.pegel[3] == 0.0f && e.pegel[4] == 0.0f);
  }
  for (const auto& e : m.je_kanal["bus/1"]) {
    PRUEF(e.pegel[0] == 0.0f);
    PRUEF(e.pegel[1] >= 0.0f && e.pegel[1] < 0.1f);
    PRUEF(e.pegel[2] > 3.0f && std::isfinite(e.pegel[2]));
    PRUEF(e.pegel[3] >= 0.0f && e.pegel[3] < 0.1f);
    PRUEF(e.pegel[4] == 0.0f);
  }
  // cadence: consecutive events of one channel are 4800 samples apart, give or take one block
  for (const char* k : {"erz/1", "bus/1"}) {
    const auto& v = m.je_kanal[k];
    for (size_t i = 1; i < v.size(); ++i) {
      const int64_t d = v[i].sample - v[i - 1].sample;
      if (4800 % N == 0) PRUEF(d == 4800);   // blocks that divide 4800: the event sits on the multiple itself
      else PRUEF(d >= 4800 - N && d <= 4800 + N);
    }
  }

  // (Z3)
  teil(*bef, id++, "erz/1/gate/an", 0.0f);
  lauf(zyk(10), true);    // the switch-off and the last block with the gate
  lauf(zyk(400), true);
  std::printf("Z3: gate off: erz/1 %d events, bus/1 %d events\n", n_von("erz/1"), n_von("bus/1"));
  PRUEF(n_von("erz/1") == 0);
  PRUEF(n_von("bus/1") >= 21);   // a window of 102 400 samples (240-sample blocks: 102 240) holds at least floor(102240 / 4800) = 21 multiples of 4800; measured 22

  // (Z4)
  teil(*bef, id++, "bus/1/mb/an", 0.0f);
  lauf(zyk(10), true);
  lauf(zyk(300), true);
  std::printf("Z4: multiband off too: %d events in 300 cycles\n", m.gesamt);
  PRUEF(m.gesamt == 0);
}

// A5c: one kern, the limiter built or not (before the first block, as main.cpp does), bus/2 loaded with a sine above the ceiling.
struct LimKern {
  std::unique_ptr<unsigned char[]> mem{new unsigned char[CDJ_RING_BYTES]()};
  std::unique_ptr<cdj::Befehlsring> bef = std::make_unique<cdj::Befehlsring>();
  std::unique_ptr<cdj::Ereignisring> ere = std::make_unique<cdj::Ereignisring>();
  std::unique_ptr<cdj::Kern> kern;
  std::map<std::string, std::vector<cdj::Ereignis>> je_kanal;
  int gesamt = 0, id = 1;
  long t = 0;
  explicit LimKern(bool gebaut) {
    auto* ring = reinterpret_cast<cdj_ring_kopf*>(mem.get());
    ring->version = CDJ_RING_VERSION;
    ring->rate = CDJ_RING_RATE;
    ring->kanaele = CDJ_RING_KANAELE;
    ring->cap = CDJ_RING_CAP;
    std::memcpy(ring->magic, "CDJB", 4);
    kern = std::make_unique<cdj::Kern>(128.0, ring, bef.get(), ere.get());
    if (gebaut) kern->setze_kanal_limiter(0.5, false);
  }
  void lauf(int N, int zyklen, bool leeren) {
    if (leeren) { je_kanal.clear(); gesamt = 0; }
    cdj::Mixer& mix = const_cast<cdj::Mixer&>(kern->mixer());   // test only: the bus input has no other door
    const int BUS2 = cdj::Mixer::kanal_index("bus/2");
    std::vector<float> l(N, 0.0f), r(N, 0.0f);
    for (int zyk = 0; zyk < zyklen; ++zyk) {
      for (int i = 0; i < N; ++i) {
        const float s = 0.5f * static_cast<float>(std::sin(2.0 * 3.14159265358979323846 * 1000.0 * static_cast<double>(t + i) / 48000.0));
        mix.eingang_l(BUS2)[i] = s;
        mix.eingang_r(BUS2)[i] = s;
      }
      t += N;
      kern->rueck(1, l.data(), r.data());
      const int64_t n0 = kern->sample();
      kern->zyklus(N, n0 * 20833);
      cdj::Ereignis e;
      while (ere->hole(e)) {
        if (e.art != cdj::Ereignis::MIX_ZUSTAND) continue;
        je_kanal[e.pfad].push_back(e);
        ++gesamt;
      }
    }
  }
  int n_von(const char* k) { return je_kanal.count(k) ? static_cast<int>(je_kanal[k].size()) : 0; }
};

static void limiter_szenario(const int N) {
  std::printf("-- limiter criterion, block size %d\n", N);
  const int ZYK_192000 = 192000 / N;
  auto zyk = [&](int c256) { return c256 * 256 / N; };
  {   // Z5, Z8
    LimKern k(true);
    teil(*k.bef, k.id++, "bus/2/lim/an", 1.0f);
    teil(*k.bef, k.id++, "bus/2/fader", 0.0f, "andreas");   // the limiter sits behind the fader; a channel is closed by default, the fader is hand only
    teil(*k.bef, k.id++, "bus/2/lim/decke", -20.0f);
    k.lauf(N, zyk(100), true);   // settle: the commands take effect, the unheard warm-up of L samples runs out, the crossfade finishes
    k.lauf(N, ZYK_192000, true);
    std::printf("Z5: limiter only: bus/2 %d events, total %d (expected 40, none else)\n", k.n_von("bus/2"), k.gesamt);
    PRUEF(k.n_von("bus/2") == 40);
    PRUEF(k.gesamt == 40);
    float rmin = 1e9f, rmax = -1e9f;
    for (const auto& e : k.je_kanal["bus/2"]) { rmin = std::min(rmin, e.pegel[4]); rmax = std::max(rmax, e.pegel[4]); }
    std::printf("Z5: pegel[4] min %.3f max %.3f dB\n", rmin, rmax);
    for (const auto& e : k.je_kanal["bus/2"]) {
      PRUEF(e.pegel[0] == 0.0f && e.pegel[1] == 0.0f && e.pegel[2] == 0.0f && e.pegel[3] == 0.0f);
      PRUEF(e.pegel[4] > 13.0f && e.pegel[4] < 15.0f);   // -6.02 dBFS against a -20 dBFS ceiling: about 14 dB (measured 13.965)
    }
    teil(*k.bef, k.id++, "bus/2/lim/an", 0.0f);
    k.lauf(N, zyk(10), true);
    k.lauf(N, zyk(300), true);
    std::printf("Z8: lim/an off again: %d events in 300 cycles\n", k.gesamt);
    PRUEF(k.gesamt == 0);
  }
  {   // Z6
    LimKern k(true);
    teil(*k.bef, k.id++, "bus/2/lim/an", 0.0f);
    teil(*k.bef, k.id++, "bus/2/fader", 0.0f, "andreas");   // the limiter sits behind the fader; a channel is closed by default, the fader is hand only
    teil(*k.bef, k.id++, "bus/2/lim/decke", -20.0f);
    k.lauf(N, zyk(100), true);
    k.lauf(N, ZYK_192000, true);
    std::printf("Z6: built, lim/an 0: %d events\n", k.gesamt);
    PRUEF(k.gesamt == 0);
  }
  {   // Z7
    LimKern k(false);
    teil(*k.bef, k.id++, "bus/2/lim/an", 1.0f);
    teil(*k.bef, k.id++, "bus/2/fader", 0.0f, "andreas");   // the limiter sits behind the fader; a channel is closed by default, the fader is hand only
    teil(*k.bef, k.id++, "bus/2/lim/decke", -20.0f);
    k.lauf(N, zyk(100), true);
    k.lauf(N, ZYK_192000, true);
    std::printf("Z7: not built, lim/an 1: %d events\n", k.gesamt);
    PRUEF(k.gesamt == 0);
  }
}

int main() {
  szenario(256);
  szenario(240);
  limiter_szenario(256);
  limiter_szenario(240);
  PRUEF_ENDE();
}
