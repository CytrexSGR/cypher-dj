// Package 1.9 U1b (T1.5): a Kit as the sink of an internal project track (arr_kit_sink.h).
//   a onset sample exact (AK-K1 at unit level): the repo test kit kit_impuls (one impulse, 1.0 on frame 0) through the arrangement, 12 notes
//     on 16ths: every impulse lies on the sample of its note, at three block sizes
//   b velocity (AK-K3): vel 127 and vel 64 on the same sound, peak ratio 64/127 within 0.01 dB; a note off changes nothing
//   c steal (AK-K4): 17 overlapping notes, the 17th ends the OLDEST voice in a 5 ms fade (no step beyond the input step), 16 voices sound
//   d start rule (AK-K5): a transport start while a long sound plays gives, from the start on, bit for bit the output of a sink that was idle
//     (d1 the sink alone, where only the clear of the start can end the sound; d2 through the arrangement, where the stop of the old run also
//     lets the voices fade out by all-notes-off, so the result is the same with or without the clear: the end-to-end control of AK-K5)
//   e no allocation in note/block/all-off/start/kit change (AK-G2) with a counting operator new and a positive control
//   f nutzt(): true while a Kit is played or faded, false once it is let go, never false while the swap block still reads the old Kit
//     (f1 between blocks, f2 a reader thread against the swap block, with the sound data of the old Kit poisoned the moment nutzt says no)
//   g negative control: a track without notes outputs exact zeros; a track that is not a kit track stays silent and unused
//   h change of Kit: the old voices fade out linearly over one block, the new Kit plays its note, then exact silence of the old one
// Mutations: ARR_KIT_BLOCKANFANG (a), ARR_KIT_RAUB_JUENGSTE (c), ARR_KIT_START_OHNE_LEEREN (d), ARR_KIT_NUTZT_FALSCH (f2).
#include <atomic>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <new>
#include <string>
#include <thread>
#include <vector>

#include "arr_build.h"
#include "cypherdj/arr_kit_sink.h"
#include "cypherdj/kit.h"
#include "check.h"

using namespace arrtest;
using cdj::ArrArt;

// allocation guard (AK-G2): counts every operator new while a watch window is open
static std::atomic<bool> g_waechter{false};
static std::atomic<long> g_allokationen{0};
void* operator new(std::size_t n) {
  if (g_waechter.load(std::memory_order_relaxed)) g_allokationen.fetch_add(1, std::memory_order_relaxed);
  void* p = std::malloc(n ? n : 1);
  if (!p) throw std::bad_alloc();
  return p;
}
void operator delete(void* p) noexcept { std::free(p); }
void operator delete(void* p, std::size_t) noexcept { std::free(p); }

namespace {

const std::string KITS = std::string(CYPHERDJ_DJK) + "/core/tests/data/kits";   // repo test kits of U0 T0.4

// A synthetic Kit: sound i is the constant (i + 1) * einheit on both channels, frames long (a DC level makes the sum of the voices readable).
std::unique_ptr<cdj::Kit> dc_kit(const char* name, int noten, int64_t frames, float einheit) {
  auto k = std::make_unique<cdj::Kit>();
  k->name = name;
  k->n = noten;
  for (int i = 0; i < noten; ++i) {
    k->klang[i].name = "dc:" + std::to_string(i);
    k->klang[i].frames = frames;
    k->klang[i].daten.assign(static_cast<size_t>(frames) * 2, static_cast<float>(i + 1) * einheit);
  }
  return k;
}

void kit_fuellen(cdj::Kit& k, int noten, float einheit) {   // restores the levels of dc_kit
  for (int i = 0; i < noten; ++i) std::fill(k.klang[i].daten.begin(), k.klang[i].daten.end(), static_cast<float>(i + 1) * einheit);
}

// makes track nr of the snapshot a kit track with the Kit k (generation gen)
void kit_spur(cdj::ArrSnapshot* s, int nr, const cdj::Kit* k, uint64_t gen) {
  cdj::ArrSpur& sp = s->spur[nr - 1];
  std::snprintf(sp.geraet, sizeof sp.geraet, "kit");
  std::snprintf(sp.kit, sizeof sp.kit, "%s", k->name.c_str());
  sp.kit_ptr = k;
  sp.kit_gen = gen;
}

bool null_bits(const std::vector<float>& v, size_t von, size_t bis) {
  for (size_t i = von; i < bis && i < v.size(); ++i)
    if (v[i] != 0.0f) return false;
  return true;
}

// Case a: 12 notes on 16ths of kit_impuls through the arrangement; returns the hit samples of the left output
std::vector<int64_t> fall_a(const cdj::Kit* kit, int block, int vel) {
  Treiber t;
  t.n = block;
  cdj::ArrKitSenke se(t.arr);
  t.arr.setze_senke_intern(&se);
  Bau b;
  b.spur(1, ArrArt::intern);
  for (int i = 0; i < 12; ++i) b.note(1, ("k/n" + std::to_string(i)).c_str(), 0.25 * i, 0.1, 0, vel);
  cdj::ArrSnapshot* s = b.fertig();
  kit_spur(s, 1, kit, 1);
  t.laden(s);
  t.arr.start(0.0, 0, false, t.s, 537, 256, t.k);
  t.lauf(4 * SPB);
  PRUEF(se.verloren() == 0);
  return t.treffer(0, 4 * SPB);
}

// Case d: restart during a sounding sound (X) against an idle sink with the same start (Y)
std::vector<float> fall_d(const cdj::Kit* kit, bool vorleben, int64_t* einsatz) {
  Treiber t;
  cdj::ArrKitSenke se(t.arr);
  t.arr.setze_senke_intern(&se);
  Bau b;
  b.spur(1, ArrArt::intern).note(1, "v/n1", 0.0, 1.5, 3, 127);   // the life before: a long sound (48000 frames)
  b.note(1, "a/n1", 8.0, 1.0, 5, 127);                           // the test note after the start at beat 8
  cdj::ArrSnapshot* s = b.fertig();
  kit_spur(s, 1, kit, 1);
  t.laden(s);
  if (vorleben) t.arr.start(0.0, 0, false, t.s, 537, 256, t.k);
  t.lauf(SPB);   // the first sound plays (X) or the sink idles (Y); both reach the same sample
  const int64_t s_start = t.s;
  t.arr.start(8.0, 0, false, s_start, 537, 256, t.k);
  *einsatz = s_start + 537 + 256;
  t.lauf(s_start + 3 * SPB);
  return t.l;
}

// Case d1: the sink alone. A long sound starts at sample 100 (X) or not (Y); a transport start at 2000, a note at 2100.
std::vector<float> fall_d1(const cdj::Kit* kit, bool vorleben) {
  Treiber t;
  cdj::ArrKitSenke se(t.arr);
  cdj::ArrSnapshot* a = Bau().spur(2, ArrArt::intern).fertig();
  kit_spur(a, 2, kit, 1);
  t.laden(a);
  se.transport_start(1, 2000);
  std::vector<float> l;
  for (int64_t s0 = 0; s0 < 256 * 24; s0 += 256) {
    if (s0 == 0 && vorleben) se.note(1, 100, 3, 127, true);
    if (s0 == 2048) se.note(1, 2100, 5, 127, true);
    std::vector<float> bl(256, 0.0f), br(256, 0.0f);
    se.block(1, s0, 256, bl.data(), br.data());
    l.insert(l.end(), bl.begin(), bl.end());
  }
  return l;
}

}  // namespace

int main() {
  std::string fe;
  std::unique_ptr<cdj::Kit> impuls = cdj::lade_kit(KITS + "/kit_impuls", &fe);
  PRUEF(impuls != nullptr);
  if (!impuls) {
    std::fprintf(stderr, "kit_impuls: %s\n", fe.c_str());
    PRUEF_ENDE();
  }

  {  // a: onset sample exact at three block sizes
    for (int block : {256, 64, 1000}) {
      const std::vector<int64_t> hit = fall_a(impuls.get(), block, 127);
      PRUEF(hit.size() == 12);
      int genau = 0;
      for (size_t i = 0; i < hit.size() && i < 12; ++i) genau += hit[i] == 537 + 256 + std::llround(0.25 * static_cast<double>(i) * SPB) ? 1 : 0;
      std::printf("onsets on the sample: %d of 12 (block %d)\n", genau, block);
      PRUEF(genau == 12);
    }
  }
  {  // b: velocity ratio; a note off is ignored
    Treiber t;
    cdj::ArrKitSenke se(t.arr);
    t.arr.setze_senke_intern(&se);
    Bau b;
    b.spur(1, ArrArt::intern).note(1, "k/a", 0.0, 0.5, 0, 127).note(1, "k/b", 1.0, 0.5, 0, 64);
    cdj::ArrSnapshot* s = b.fertig();
    kit_spur(s, 1, impuls.get(), 1);
    t.laden(s);
    t.arr.start(0.0, 0, false, t.s, 537, 256, t.k);
    t.lauf(3 * SPB);
    const int64_t e0 = 537 + 256;
    const float pa = t.l[e0], pb = t.l[e0 + SPB];
    const double abw = 20.0 * std::log10(static_cast<double>(pb) / pa) - 20.0 * std::log10(64.0 / 127.0);
    std::printf("vel 64 against vel 127: peak %.6f / %.6f, deviation from 64/127 %.6f dB\n", pb, pa, abw);
    PRUEF_NAH(pa, 0.70710678, 1e-6);   // the arrangement output has the centre pan law (-3 dB)
    PRUEF(std::fabs(abw) < 0.01);
    PRUEF(t.treffer(0, 3 * SPB).size() == 2);   // the note offs at the note ends added nothing
  }
  {  // c: the 17th note steals the OLDEST voice with a 5 ms fade
    auto dc = dc_kit("dc", 17, 48000, 1.0f / 64.0f);
    Treiber t;
    cdj::ArrKitSenke se(t.arr);
    cdj::ArrSnapshot* a = Bau().spur(2, ArrArt::intern).fertig();
    kit_spur(a, 2, dc.get(), 1);
    t.laden(a);
    std::vector<float> l;
    for (int64_t s0 = 0; s0 < 256 * 12; s0 += 256) {
      for (int i = 0; i < 17; ++i)   // note i at 1000 + 10 i, level (i + 1) / 64; each in the block that holds its sample (as the module does)
        if (1000 + 10 * i >= s0 && 1000 + 10 * i < s0 + 256) se.note(1, 1000 + 10 * i, static_cast<uint8_t>(i), 127, true);
      std::vector<float> bl(256, 0.0f), br(256, 0.0f);
      se.block(1, s0, 256, bl.data(), br.data());
      l.insert(l.end(), bl.begin(), bl.end());
      if (s0 == 1024) PRUEF(se.stimmen(1) == 16 && se.ausklingend(1) == 1);   // 16 voices sound, the stolen one fades
    }
    const int64_t T = 1000 + 10 * 16;   // onset of the 17th note
    PRUEF(l[999] == 0.0f);
    PRUEF(l[T - 1] == 136.0f / 64.0f);   // 16 voices: 1 + 2 + ... + 16 in units of 1/64
    const float g0 = 240.0f / 241.0f;    // first sample of the fade of the stolen voice (note 0, level 1/64)
    PRUEF_NAH(l[T], 136.0 / 64.0 - (1.0 - g0) / 64.0 + 17.0 / 64.0, 1e-5);
    PRUEF(l[T + 240] == 152.0f / 64.0f);   // the oldest is gone: 2 + ... + 17 in units of 1/64
    PRUEF(l[T + 1000] == 152.0f / 64.0f);
    float dmax = 0.0f;
    for (int64_t i = T + 1; i < T + 260; ++i) dmax = std::fmax(dmax, std::fabs(l[i] - l[i - 1]));
    const float onset_schritt = l[T] - l[T - 1];
    std::printf("steal: step at the onset %.6f (input step %.6f), largest step in the fade %.6f\n", onset_schritt, 17.0 / 64.0, dmax);
    PRUEF(onset_schritt <= 17.0f / 64.0f);
    PRUEF(dmax < 0.01f);   // a hard cut of the stolen voice would step by 1/64 = 0.0156
    PRUEF(se.stimmen(1) == 16 && se.ausklingend(1) == 0);
  }
  {  // d: start rule
    auto dc = dc_kit("dc", 8, 48000, 1.0f / 32.0f);
    {  // d1
      const std::vector<float> x = fall_d1(dc.get(), true), y = fall_d1(dc.get(), false);
      bool gleich = x.size() == y.size();
      for (size_t i = 2000; gleich && i < x.size(); ++i) gleich = x[i] == y[i];
      PRUEF(x[500] != y[500]);        // before the start the old sound really played in X
      PRUEF(y[2100] == 6.0f / 32.0f);   // the note at the start block plays (note 5, level 6/32)
      std::printf("start rule, sink alone: output from the start on %s\n", gleich ? "bit-identical" : "DIFFERENT");
      PRUEF(gleich);
    }
    int64_t ein_x = 0, ein_y = 0;
    const std::vector<float> x = fall_d(dc.get(), true, &ein_x), y = fall_d(dc.get(), false, &ein_y);
    PRUEF(ein_x == ein_y && x.size() == y.size());
    bool gleich = ein_x == ein_y && x.size() == y.size();
    double laut = 0.0;
    for (size_t i = static_cast<size_t>(ein_x); gleich && i < x.size(); ++i) {
      gleich = x[i] == y[i];
      laut += std::fabs(y[i]);
    }
    PRUEF(laut > 1.0);   // the test note sounds
    // before the start the restarted run really played the old sound (otherwise the comparison proves nothing)
    PRUEF(x[static_cast<size_t>(ein_x) - 4000] != y[static_cast<size_t>(ein_y) - 4000]);
    std::printf("start rule: output from the start on %s\n", gleich ? "bit-identical" : "DIFFERENT");
    PRUEF(gleich);
  }
  {  // e: no allocation (positive control: the guard does count)
    auto dc = dc_kit("dc", 32, 4000, 1.0f / 64.0f);
    auto dc2 = dc_kit("dc2", 32, 4000, 1.0f / 64.0f);
    Treiber t;
    cdj::ArrKitSenke se(t.arr);
    cdj::ArrSnapshot* a = Bau().spur(1, ArrArt::intern).spur(2, ArrArt::intern).fertig();
    kit_spur(a, 1, dc.get(), 1);
    kit_spur(a, 2, dc.get(), 1);
    t.laden(a);
    std::vector<float> bl(256), br(256);
    g_allokationen = 0;
    long gezaehlt_ohne_kontrolle = 0;
    g_waechter = true;
    for (int64_t s0 = 0; s0 < 256 * 80; s0 += 256) {
      for (int i = 0; i < 6; ++i) {   // 6 notes per block on two tracks: the 16 voices overflow, steals every block
        se.note(0, s0 + 20 * i, static_cast<uint8_t>((s0 / 256 + i) % 32), static_cast<uint8_t>(40 + i), true);
        se.note(1, s0 + 30 * i + 5, static_cast<uint8_t>(i), 100, false);
        se.note(1, s0 + 30 * i, static_cast<uint8_t>(i + 7), 100, true);
      }
      if (s0 == 256 * 20) se.alle_aus(0, s0);
      if (s0 == 256 * 40) se.transport_start(1, s0 + 700);
      std::fill(bl.begin(), bl.end(), 0.0f);
      std::fill(br.begin(), br.end(), 0.0f);
      se.block(0, s0, 256, bl.data(), br.data());
      se.block(1, s0, 256, bl.data(), br.data());
    }
    gezaehlt_ohne_kontrolle = g_allokationen.load();
    g_waechter = false;
    // the same with a Kit change and the track leaving (snapshot swaps happen outside the window; the blocks inside it)
    cdj::ArrSnapshot* b2 = Bau(2).spur(1, ArrArt::intern).fertig();
    kit_spur(b2, 1, dc2.get(), 2);
    t.laden(b2);
    g_waechter = true;
    se.note(0, 256 * 80 + 10, 3, 127, true);
    se.block(0, 256 * 80, 256, bl.data(), br.data());   // takes over dc2, fades the voices of dc
    se.block(0, 256 * 81, 256, bl.data(), br.data());
    (void)se.spur_weg(0, 256 * 82, false);
    se.block(0, 256 * 82, 256, bl.data(), br.data());
    g_waechter = false;
    const long mit_wechsel = g_allokationen.load() - gezaehlt_ohne_kontrolle;
    std::printf("allocations in the callback path: %ld in 80 blocks, %ld in the kit change; stolen %d fading\n", gezaehlt_ohne_kontrolle,
                mit_wechsel, se.ausklingend(0));
    PRUEF(gezaehlt_ohne_kontrolle == 0);
    PRUEF(mit_wechsel == 0);
    g_allokationen = 0;   // positive control: the guard counts a real allocation
    g_waechter = true;
    char* p = static_cast<char*>(::operator new(16));
    asm volatile("" : : "r"(p) : "memory");
    ::operator delete(p);
    g_waechter = false;
    PRUEF(g_allokationen.load() == 1);
  }
  {  // g: negative controls
    auto dc = dc_kit("dc", 4, 4000, 1.0f / 64.0f);
    Treiber t;
    cdj::ArrKitSenke se(t.arr);
    t.arr.setze_senke_intern(&se);
    Bau b;
    b.spur(1, ArrArt::intern).spur(2, ArrArt::intern).note(2, "x/n1", 0.0, 1.0, 1, 127);   // track 1: kit, no notes; track 2: no kit device
    cdj::ArrSnapshot* s = b.fertig();
    kit_spur(s, 1, dc.get(), 1);
    t.laden(s);
    t.arr.start(0.0, 0, false, t.s, 537, 256, t.k);
    t.lauf(2 * SPB);
    PRUEF(t.l.size() >= static_cast<size_t>(2 * SPB));
    PRUEF(null_bits(t.l, 0, t.l.size()) && null_bits(t.r, 0, t.r.size()));   // exact zeros, both channels
    PRUEF(se.stimmen(0) == 0 && se.spielend() == 1);   // track 1 holds the Kit, track 2 nothing
    PRUEF(se.nutzt(dc.get()));
  }
  {  // f1: nutzt between blocks: take-over, swap to another Kit, leaving
    auto ka = dc_kit("ka", 8, 48000, 1.0f / 64.0f);
    auto kb = dc_kit("kb", 8, 48000, 1.0f / 64.0f);
    Treiber t;
    cdj::ArrKitSenke se(t.arr);
    t.arr.setze_senke_intern(&se);
    PRUEF(!se.nutzt(ka.get()) && !se.nutzt(nullptr));
    auto projekt = [&](int64_t nr, const cdj::Kit* k, double beat2) {
      Bau b(nr);
      b.spur(1, ArrArt::intern).note(1, "v/n1", 0.0, 4.0, 2, 127);
      if (beat2 > 0.0) b.note(1, "v/n2", beat2, 1.0, 3, 127);
      cdj::ArrSnapshot* s = b.fertig();
      kit_spur(s, 1, k, static_cast<uint64_t>(nr));
      return s;
    };
    t.laden(projekt(1, ka.get(), 0.0));
    PRUEF(!se.nutzt(ka.get()));   // the sink has not run yet
    t.arr.start(0.0, 0, false, t.s, 537, 256, t.k);
    t.lauf(SPB);
    PRUEF(se.nutzt(ka.get()) && !se.nutzt(kb.get()));
    PRUEF(se.stimmen(0) == 1);   // the voice of the first note still sounds (48000 frames)
    t.laden(projekt(2, kb.get(), 0.0));
    t.lauf(t.s + 256);
    PRUEF(!se.nutzt(ka.get()) && se.nutzt(kb.get()));   // one block after the swap the old Kit is let go
    PRUEF(se.stimmen(0) == 0);
    t.laden(Bau(3).fertig());   // the track becomes empty: the dispatcher-less arrangement calls spur_weg and one more block
    t.lauf(t.s + 2 * 256);
    PRUEF(!se.nutzt(kb.get()));
    PRUEF(se.spielend() == 0);
  }
  {  // f2: a reader thread against the swap block; the moment nutzt(old) says no, the old sound data are poisoned (a NaN reaches the output
     // if the swap block still reads them)
    constexpr int NOTEN = 16, BLOCK = 1024, DURCHGAENGE = 300;
    auto ka = dc_kit("fa", NOTEN, 4096, 1.0f / 64.0f);
    auto kb = dc_kit("fb", NOTEN, 4096, 1.0f / 64.0f);
    cdj::Kit* kit[2] = {ka.get(), kb.get()};
    Treiber t;
    cdj::ArrKitSenke se(t.arr);
    std::atomic<uint32_t> folge{0};
    std::atomic<bool> halt{false}, belegt{false};
    std::atomic<cdj::Kit*> alt{nullptr};
    std::atomic<long> vergiftet{0};
    std::thread leser([&] {
      while (!halt.load()) {
        belegt.store(true);
        const uint32_t f1 = folge.load();
        cdj::Kit* k = alt.load();
        if ((f1 & 1u) && k && !se.nutzt(k) && folge.load() == f1) {
          for (int i = 0; i < NOTEN; ++i)
            for (int64_t f = BLOCK; f < 2 * BLOCK; f += 64) k->klang[i].daten[static_cast<size_t>(2 * f)] = std::nanf("");
          vergiftet.fetch_add(1);
        }
        belegt.store(false);
      }
    });
    long nan_durchgaenge = 0;
    int cur = 0;
    std::vector<float> bl(BLOCK), br(BLOCK);
    int64_t s0 = 0;
    for (int d = 0; d < DURCHGAENGE; ++d) {
      kit_fuellen(*kit[0], NOTEN, 1.0f / 64.0f);
      kit_fuellen(*kit[1], NOTEN, 1.0f / 64.0f);
      cdj::ArrSnapshot* a = Bau(2 * d + 1).spur(1, ArrArt::intern).fertig();
      kit_spur(a, 1, kit[cur], static_cast<uint64_t>(2 * d + 1));
      t.laden(a);
      for (int i = 0; i < NOTEN; ++i) se.note(0, s0 + 10 + i, static_cast<uint8_t>(i), 127, true);
      std::fill(bl.begin(), bl.end(), 0.0f);
      std::fill(br.begin(), br.end(), 0.0f);
      se.block(0, s0, BLOCK, bl.data(), br.data());   // takes the Kit over and starts 16 voices
      s0 += BLOCK;
      cdj::ArrSnapshot* b = Bau(2 * d + 2).spur(1, ArrArt::intern).fertig();
      kit_spur(b, 1, kit[1 - cur], static_cast<uint64_t>(2 * d + 2));
      t.laden(b);
      alt.store(kit[cur]);
      folge.fetch_add(1);   // odd: the swap block runs
      std::fill(bl.begin(), bl.end(), 0.0f);
      std::fill(br.begin(), br.end(), 0.0f);
      se.block(0, s0, BLOCK, bl.data(), br.data());   // the swap block: the old voices fade out
      folge.fetch_add(1);   // even
      while (belegt.load()) {}   // the reader is idle now (it acts on odd values only)
      s0 += BLOCK;
      bool nan = false;
      for (int i = 0; i < BLOCK; ++i) nan = nan || !std::isfinite(bl[i]) || !std::isfinite(br[i]);
      nan_durchgaenge += nan ? 1 : 0;
      cur = 1 - cur;
      // the sink holds kit[cur] now; the next pass starts the voices on it and swaps back
    }
    halt.store(true);
    leser.join();
    std::printf("nutzt against the swap block: %ld of %d passes read poisoned data (reader poisoned %ld times, after the block ended)\n",
                nan_durchgaenge, DURCHGAENGE, vergiftet.load());
    PRUEF(nan_durchgaenge == 0);
  }
  {  // h: change of Kit, the old voices fade over one block
    auto ka = dc_kit("ha", 8, 48000, 1.0f / 64.0f);   // note 2: 3/64
    auto kb = dc_kit("hb", 8, 48000, 1.0f / 32.0f);   // note 4: 5/32
    Treiber t;
    cdj::ArrKitSenke se(t.arr);
    t.arr.setze_senke_intern(&se);
    auto projekt = [&](int64_t nr, const cdj::Kit* k, double beat2) {
      Bau b(nr);
      b.spur(1, ArrArt::intern).note(1, "v/n1", 0.0, 4.0, 2, 127);
      if (beat2 > 0.0) b.note(1, "v/n2", beat2, 1.0, 4, 127);
      cdj::ArrSnapshot* s = b.fertig();
      kit_spur(s, 1, k, static_cast<uint64_t>(nr));
      return s;
    };
    t.laden(projekt(1, ka.get(), 0.0));
    t.arr.start(0.0, 0, false, t.s, 537, 256, t.k);
    t.lauf(SPB + 13 * 256);
    const int64_t T = t.s;
    const double beat2 = static_cast<double>(T + 64 - (537 + 256)) / SPB;
    t.laden(projekt(2, kb.get(), beat2));
    t.lauf(T + 3 * 256);
    const float pan = 0.70710678f;   // centre pan law of the arrangement output
    const float alt_pegel = pan * 3.0f / 64.0f, neu_pegel = pan * 5.0f / 32.0f;
    bool davor = true, fade = true, neu_ok = true, danach = true;
    for (int64_t i = T - 2000; i < T; ++i) davor = davor && t.l[i] == alt_pegel;
    for (int i = 0; i < 64; ++i) fade = fade && std::fabs(t.l[T + i] - alt_pegel * (static_cast<float>(255 - i) / 256.0f)) < 1e-6f;
    for (int i = 64; i < 256; ++i)
      neu_ok = neu_ok && std::fabs(t.l[T + i] - (neu_pegel + alt_pegel * (static_cast<float>(255 - i) / 256.0f))) < 1e-6f;
    for (int i = 256; i < 512; ++i) danach = danach && t.l[T + i] == neu_pegel;
    std::printf("kit change: before %d, fade of the old voice %d, new note over the fade %d, afterwards only the new Kit %d\n", davor, fade, neu_ok, danach);
    PRUEF(davor && fade && neu_ok && danach);
  }
  PRUEF_ENDE();
}
