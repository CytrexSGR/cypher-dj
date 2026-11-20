// Loop deck K2: the launcher of the arrangement (own voices, re-pitch, core beat, independent of the transport).
// 128 BPM: 22 500 samples per beat; a 4-beat cell of 90 000 frames plays one frame per sample. Blocks of 256 (the start sample of a launch
// usually lies inside a block). The track bus (spur_bus_l) is recorded per block.
// Case 12 counts allocations only where the allocation watcher exists (not under ASan/TSan: "skipped", never "passed").
#include <cmath>
#include <cstdio>
#include <cstring>
#include <limits>
#include <vector>

#include "arr_build.h"
#include "check.h"
#include "alloc_intercept.h"   // last: replaces malloc and relatives

using namespace arrtest;
using cdj::ArrArt;
using cdj::ArrZelle;
using cdj::ArrZellArt;
using cdj::LaunchGrund;
using cdj::LaunchMeldung;
using cdj::LaunchStand;

static const uint64_t ID = cdj::arr_id("s1");
static constexpr int64_t CELL = 4 * SPB;   // 90 000 frames = 4 beats at 128 BPM

static constexpr ArrZellArt LOOP = ArrZellArt::loop, EINMAL = ArrZellArt::einmal;
static const ArrZelle LEER{};

static ArrZelle zelle(Audio& a, ArrZellArt art, double beats, float gain = 1.0f) {
  ArrZelle z;
  z.art = art;
  z.audio = &a.a;
  z.frames = a.a.frames;
  z.beats = beats;
  z.gain = gain;
  z.modus = art == ArrZellArt::loop ? 2 : 0;
  return z;
}

// A snapshot with one audio track (track 1) that carries the id "s1" and the cells (index i = cell i + 1, leer = empty).
static cdj::ArrSnapshot* bauen(const std::vector<ArrZelle>& zs) {
  cdj::ArrSnapshot* s = Bau().spur(1, ArrArt::audio).fertig();
  cdj::ArrSpur& sp = s->spur[0];
  sp.kennung = ID;
  std::snprintf(sp.kennung_text, sizeof sp.kennung_text, "s1");
  for (size_t i = 0; i < zs.size(); ++i) {
    sp.zellen[i] = zs[i];
    if (zs[i].art != ArrZellArt::leer) ++sp.n_zellen;
  }
  return s;
}

struct Lauf {
  Treiber t;
  std::vector<float> bus;
  void bis(int64_t ziel) {
    while (t.s < ziel) {
      t.lauf(t.s + t.n);
      bus.insert(bus.end(), t.arr.spur_bus_l(0), t.arr.spur_bus_l(0) + t.n);
    }
  }
  float at(int64_t i) const { return bus[static_cast<size_t>(i)]; }
};

static LaunchStand stand(const cdj::Arrangement& a) {
  LaunchStand s[8];
  const int n = a.launch_stand(s, 8);
  return n >= 1 ? s[0] : LaunchStand{};
}

static std::vector<LaunchMeldung> meldungen(cdj::Arrangement& a) {
  LaunchMeldung m[32];
  const int n = a.launch_meldungen(m, 32);
  return std::vector<LaunchMeldung>(m, m + n);
}

int main() {
  const double NAN_ = std::numeric_limits<double>::quiet_NaN();
  auto imp = Audio::impuls(CELL);
  auto ram = Audio::rampe(CELL);
  auto g50 = Audio::gleich(CELL, 0.5f);
  auto g25 = Audio::gleich(CELL, 0.25f);
  auto g75 = Audio::gleich(CELL, 0.75f);

  {  // 1: onset exactly on the sample of the beat, transport stopped
    Lauf x;
    x.t.laden(bauen({zelle(*imp, LOOP, 4.0)}));
    PRUEF(x.t.arr.launch_start(ID, 1, 4.0, 0.0, 1, false) == LaunchGrund::ok);
    x.bis(3 * CELL);
    int64_t erster = -1;
    for (int64_t i = 0; i < static_cast<int64_t>(x.bus.size()) && erster < 0; ++i)
      if (std::fabs(x.at(i)) > 1e-6f) erster = i;
    PRUEF(erster == 4 * SPB);
    PRUEF(x.t.arr.status() == cdj::ArrStatus::steht);
    const auto m = meldungen(x.t.arr);
    PRUEF(m.size() == 1 && m[0].id == 1 && m[0].status == 3 && m[0].sample == 4 * SPB && m[0].beat == 4.0);
  }
  {  // 2: versatz
    Lauf x;
    x.t.laden(bauen({zelle(*ram, LOOP, 4.0)}));
    PRUEF(x.t.arr.launch_start(ID, 1, 4.0, 2.0, 1, false) == LaunchGrund::ok);
    x.bis(6 * SPB);
    PRUEF_NAH(x.at(4 * SPB), 2.0 * CELL / 4.0, 1e-4);
    PRUEF_NAH(x.at(4 * SPB + 100), 2.0 * CELL / 4.0 + 100, 1e-3);
  }
  {  // 3: loop wrap without a gap
    Lauf x;
    x.t.laden(bauen({zelle(*ram, LOOP, 4.0)}));
    PRUEF(x.t.arr.launch_start(ID, 1, 4.0, 0.0, 1, false) == LaunchGrund::ok);
    x.bis(10 * SPB);
    PRUEF_NAH(x.at(8 * SPB - 1), CELL - 1, 1e-2);
    PRUEF_NAH(x.at(8 * SPB), 0.0, 1e-4);
    PRUEF_NAH(x.at(8 * SPB + 1), 1.0, 1e-3);
  }
  {  // 4: switch A -> B at beat 8 (both 0.5: the sum stays 0.5; with A = 0.25 only B remains after the fade)
    for (int variante = 0; variante < 2; ++variante) {
      Lauf x;
      x.t.laden(bauen({zelle(variante ? *g25 : *g50, LOOP, 4.0), zelle(*g50, LOOP, 4.0)}));
      PRUEF(x.t.arr.launch_start(ID, 1, 0.0, 0.0, 1, false) == LaunchGrund::ok);
      x.bis(7 * SPB);
      PRUEF(x.t.arr.launch_start(ID, 2, 8.0, 0.0, 2, false) == LaunchGrund::ok);
      x.bis(10 * SPB);
      const int64_t T = 8 * SPB;
      if (!variante)
        for (int64_t i = T - 10; i <= T + cdj::ARR_NAHT + 10; ++i) PRUEF_NAH(x.at(i), 0.5, 0.01);
      for (int64_t i = T + cdj::ARR_NAHT; i < T + cdj::ARR_NAHT + 2000; ++i) PRUEF_NAH(x.at(i), 0.5, 1e-6);
      PRUEF_NAH(x.at(T - 1), variante ? 0.25 : 0.5, 1e-6);
      PRUEF(stand(x.t.arr).zelle == 2);
      PRUEF(x.t.arr.launch_stimmen() == 1);   // the faded voice is gone
    }
  }
  {  // 5: stop
    Lauf x;
    x.t.laden(bauen({zelle(*g50, LOOP, 4.0)}));
    PRUEF(x.t.arr.launch_start(ID, 1, 0.0, 0.0, 1, false) == LaunchGrund::ok);
    x.bis(7 * SPB);
    PRUEF(x.t.arr.launch_stopp(ID, 8.0, 2, false) == LaunchGrund::ok);
    x.bis(10 * SPB);
    const int64_t T = 8 * SPB;
    PRUEF_NAH(x.at(T - 1), 0.5, 1e-6);
    for (int64_t i = T; i < T + cdj::ARR_NAHT; ++i) PRUEF(x.at(i) <= x.at(i - 1) + 1e-7f && x.at(i) > 0.0f);
    for (int64_t i = T + cdj::ARR_NAHT; i < T + cdj::ARR_NAHT + 3000; ++i) PRUEF(x.at(i) == 0.0f);
    PRUEF(stand(x.t.arr).zelle == 0 && x.t.arr.launch_stimmen() == 0 && x.t.arr.launch_ruhig());
  }
  {  // 6: one-shot of 1000 frames at 140 BPM lasts 1000 samples
    Lauf x;
    x.t.k = cdj::Karte(140.0, 0);
    auto os = Audio::gleich(1000, 0.5f);
    x.t.laden(bauen({zelle(*os, EINMAL, 0.0)}));
    PRUEF(x.t.arr.launch_start(ID, 1, 1.0, 0.0, 1, false) == LaunchGrund::ok);
    PRUEF(stand(x.t.arr).wartend == 1 && stand(x.t.arr).zelle == 0);
    const int64_t T = static_cast<int64_t>(std::llround(x.t.k.sample_at(1.0)));
    x.bis(T + 600);
    PRUEF(stand(x.t.arr).zelle == 1 && stand(x.t.arr).wartend == -1);
    x.bis(T + 2000);
    int64_t n = 0, erster = -1, letzter = -1;
    for (int64_t i = 0; i < static_cast<int64_t>(x.bus.size()); ++i)
      if (x.at(i) != 0.0f) {
        ++n;
        if (erster < 0) erster = i;
        letzter = i;
      }
    PRUEF(n == 1000 && erster == T && letzter == T + 999);
    PRUEF(stand(x.t.arr).zelle == 0 && x.t.arr.launch_ruhig());
    PRUEF(x.t.arr.launch_start(ID, 1, 2.0, 0.5, 2, false) == LaunchGrund::ausserhalb_bereich);   // one-shot: versatz must be 0
  }
  {  // 7: one pending launch per track
    Lauf x;
    x.t.laden(bauen({zelle(*g50, LOOP, 4.0), zelle(*g25, LOOP, 4.0), zelle(*g75, LOOP, 4.0)}));
    PRUEF(x.t.arr.launch_start(ID, 1, 0.0, 0.0, 1, false) == LaunchGrund::ok);
    x.bis(7 * SPB);
    meldungen(x.t.arr);
    PRUEF(x.t.arr.launch_start(ID, 2, 8.0, 0.0, 11, false) == LaunchGrund::ok);
    PRUEF(x.t.arr.launch_start(ID, 3, 8.0, 0.0, 12, false) == LaunchGrund::ok);
    auto m = meldungen(x.t.arr);
    PRUEF(m.size() == 1 && m[0].id == 11 && m[0].status == 7);
    PRUEF(stand(x.t.arr).wartend == 3);
    x.bis(10 * SPB);
    m = meldungen(x.t.arr);
    PRUEF(m.size() == 1 && m[0].id == 12 && m[0].status == 3);
    PRUEF_NAH(x.at(8 * SPB + 500), 0.75, 1e-6);
    // a stop replaces a pending start the same way
    PRUEF(x.t.arr.launch_start(ID, 2, 12.0, 0.0, 21, false) == LaunchGrund::ok);
    PRUEF(x.t.arr.launch_stopp(ID, 12.0, 22, false) == LaunchGrund::ok);
    m = meldungen(x.t.arr);
    PRUEF(m.size() == 1 && m[0].id == 21 && m[0].status == 7);
    PRUEF(stand(x.t.arr).wartend == 0);
    x.bis(13 * SPB);
    m = meldungen(x.t.arr);
    PRUEF(m.size() == 1 && m[0].id == 22 && m[0].status == 3);
    PRUEF(x.at(12 * SPB + 500) == 0.0f && stand(x.t.arr).zelle == 0);
  }
  {  // 8: transport independence
    std::vector<float> ohne, mit;
    for (int variante = 0; variante < 2; ++variante) {
      Lauf x;
      x.t.laden(bauen({zelle(*ram, LOOP, 4.0)}));
      bool gestartet = false, gestoppt = false, gelaunched = false;
      x.t.vor_block = [&](int64_t s) {
        if (!gelaunched) {
          gelaunched = true;
          x.t.arr.launch_start(ID, 1, 1.0, 0.5, 1, false);
        }
        if (variante == 1 && !gestartet) {
          gestartet = true;
          x.t.arr.loop(true, 0.0, 2.0, s, x.t.k);
          x.t.arr.start(0.0, 0, false, s, 537, x.t.n, x.t.k);
        }
        if (variante == 1 && !gestoppt && s >= 5 * SPB) {
          gestoppt = true;
          x.t.arr.stopp(0, s, x.t.k);
        }
      };
      x.bis(8 * SPB);
      (variante ? mit : ohne) = x.bus;
      if (variante == 1) PRUEF(x.t.arr.letzte_naht() >= 0);   // the loop really wrapped
    }
    PRUEF(ohne.size() == mit.size() && std::memcmp(ohne.data(), mit.data(), ohne.size() * sizeof(float)) == 0);
    bool klingt = false;
    for (float v : mit) klingt = klingt || v != 0.0f;
    PRUEF(klingt);
  }
  {  // 9: late launch (one beat in the past)
    Lauf x;
    x.t.laden(bauen({zelle(*ram, LOOP, 4.0)}));
    x.bis(2 * SPB);
    const int64_t s0 = x.t.s;
    PRUEF(x.t.arr.launch_start(ID, 1, 1.0, 0.0, 5, false) == LaunchGrund::ok);
    x.bis(s0 + 2000);
    const auto m = meldungen(x.t.arr);
    PRUEF(m.size() == 1 && m[0].status == 5 && m[0].sample == s0);
    PRUEF_NAH(m.empty() ? 0.0 : m[0].beat, x.t.k.beat_at(static_cast<double>(s0)), 1e-9);
    const auto erwartet = [&](int64_t t, int64_t k) { return static_cast<double>((t - SPB) % CELL) * std::min(1.0, static_cast<double>(t - s0) / k); };
    PRUEF(std::fabs(x.at(s0 - 1)) == 0.0f);
    PRUEF_NAH(x.at(s0 + 50), erwartet(s0 + 50, cdj::ARR_NAHT), 1e-2);
    PRUEF_NAH(x.at(s0 + 200), erwartet(s0 + 200, cdj::ARR_NAHT), 1e-2);
    for (int64_t i = s0 + 1; i < s0 + cdj::ARR_NAHT; ++i) PRUEF(x.at(i) > x.at(i - 1) * 0.0f);   // sounds from the first fade-in sample on
  }
  {  // 10: refusals change nothing; a valid start is the positive control
    Lauf x;
    PRUEF(x.t.arr.launch_start(ID, 1, 4.0, 0.0, 1, false) == LaunchGrund::nicht_geladen);
    PRUEF(x.t.arr.launch_stopp(ID, 4.0, 1, false) == LaunchGrund::nicht_geladen);
    x.t.laden(bauen({zelle(*g50, LOOP, 4.0), LEER, zelle(*g50, EINMAL, 0.0)}));
    PRUEF(x.t.arr.launch_start(ID, 1, 4.0, 0.0, 1, false) == LaunchGrund::ok);   // pending, replaced below by nothing: stays
    x.bis(SPB);
    const LaunchStand vor = stand(x.t.arr);
    const uint32_t aend = x.t.arr.launch_aenderung();
    const auto ist_unveraendert = [&] {
      const LaunchStand n = stand(x.t.arr);
      return std::memcmp(&vor, &n, sizeof vor) == 0 && aend == x.t.arr.launch_aenderung() && meldungen(x.t.arr).empty();
    };
    PRUEF(x.t.arr.launch_start(cdj::arr_id("nobody"), 1, 4.0, 0.0, 2, false) == LaunchGrund::spur_bereich);
    PRUEF(ist_unveraendert());
    PRUEF(x.t.arr.launch_stopp(cdj::arr_id("nobody"), 4.0, 2, false) == LaunchGrund::spur_bereich);
    PRUEF(ist_unveraendert());
    PRUEF(x.t.arr.launch_start(0, 1, 4.0, 0.0, 2, false) == LaunchGrund::spur_bereich);
    PRUEF(ist_unveraendert());
    PRUEF(x.t.arr.launch_start(ID, 0, 4.0, 0.0, 2, false) == LaunchGrund::ausserhalb_bereich);
    PRUEF(x.t.arr.launch_start(ID, 9, 4.0, 0.0, 2, false) == LaunchGrund::ausserhalb_bereich);
    PRUEF(x.t.arr.launch_start(ID, 1, 4.0, -1.0, 2, false) == LaunchGrund::ausserhalb_bereich);
    PRUEF(x.t.arr.launch_start(ID, 1, 4.0, NAN_, 2, false) == LaunchGrund::ausserhalb_bereich);
    PRUEF(x.t.arr.launch_start(ID, 1, 4.0, 4.0, 2, false) == LaunchGrund::ausserhalb_bereich);
    PRUEF(x.t.arr.launch_start(ID, 1, NAN_, 0.0, 2, false) == LaunchGrund::ausserhalb_bereich);
    PRUEF(x.t.arr.launch_start(ID, 3, 4.0, 1.0, 2, false) == LaunchGrund::ausserhalb_bereich);
    PRUEF(ist_unveraendert());
    PRUEF(x.t.arr.launch_start(ID, 2, 4.0, 0.0, 2, false) == LaunchGrund::zelle_leer);
    PRUEF(x.t.arr.launch_start(ID, 4, 4.0, 0.0, 2, false) == LaunchGrund::zelle_leer);
    PRUEF(ist_unveraendert());
    PRUEF(x.t.arr.launch_start(ID, 3, 4.0, 0.0, 3, false) == LaunchGrund::ok);   // positive control: the pending launch is replaced (id 1 -> status 7)
    const auto m = meldungen(x.t.arr);
    PRUEF(m.size() == 1 && m[0].id == 1 && m[0].status == 7);
  }
  {  // 11: quiet path: only a launcher voice, no clips: the master sounds; an unload (K5) ends the voice at once and the quiet path is taken again
    Lauf x;
    x.t.laden(bauen({zelle(*g50, LOOP, 4.0)}));
    PRUEF(x.t.arr.launch_ruhig());
    PRUEF(x.t.arr.launch_start(ID, 1, 0.0, 0.0, 1, false) == LaunchGrund::ok);
    PRUEF(!x.t.arr.launch_ruhig());
    x.bis(SPB);
    PRUEF(x.t.arr.stimmen() == 0 && x.t.arr.launch_stimmen() == 1);
    float spitze = 0.0f;
    for (size_t i = 1000; i < x.t.l.size(); ++i) spitze = std::fmax(spitze, std::fabs(x.t.l[i]));
    PRUEF(spitze > 0.1f);
    x.t.laden(nullptr);   // K5: an unload ends the launcher voices (launch_alles_aus sofort)
    const size_t n0 = x.t.l.size();
    x.bis(x.t.s + 2048);
    float spitze2 = 0.0f;
    for (size_t i = n0; i < x.t.l.size(); ++i) spitze2 = std::fmax(spitze2, std::fabs(x.t.l[i]));
    PRUEF(spitze2 == 0.0f);
    PRUEF(x.t.arr.launch_stimmen() == 0 && x.t.arr.launch_ruhig());
  }
  {  // 12: no allocation in launch_block, launch_start, launch_stopp
    if (!ALLOC_ABFANG_VERFUEGBAR) {
      std::printf("case 12 skipped (sanitizer build): allocation watcher not available\n");
    } else {
      Lauf x;
      x.t.laden(bauen({zelle(*g50, LOOP, 4.0), zelle(*g25, LOOP, 4.0)}));
      PRUEF(x.t.arr.launch_start(ID, 1, 0.0, 0.0, 1, false) == LaunchGrund::ok);
      x.bis(2 * SPB);
      long alloc = 0;
      int64_t s = x.t.s;
      for (int i = 0; i < 400; ++i, s += 256) {
        abfang_an();
        if (i == 100) x.t.arr.launch_start(ID, 2, x.t.k.beat_at(static_cast<double>(s)) + 0.25, 0.0, 2, false);
        if (i == 150) x.t.arr.launch_stopp(ID, x.t.k.beat_at(static_cast<double>(s)) + 0.25, 3, true);
        if (i == 200) x.t.arr.launch_start(ID, 1, x.t.k.beat_at(static_cast<double>(s)) - 1.0, 0.0, 4, false);   // late
        x.t.arr.launch_block(x.t.k, s, 256);
        alloc += abfang_aus();
        if (i == 120) PRUEF(x.t.arr.launch_stimmen() >= 1);
      }
      PRUEF(alloc == 0);
      abfang_an();
      int* p = new int(3);
      const long gegenprobe = abfang_aus();
      delete p;
      PRUEF(gegenprobe >= 1);   // positive control: an allocation in the window is counted
    }
  }
  {  // 13: a loop wraps without a click at a tempo with fractional samples per beat (140 BPM, read rate about 2.43): constant and sine cells
    Lauf x;
    x.t.k = cdj::Karte(140.0, 0);
    auto c = Audio::gleich(100000, 0.5f);
    x.t.laden(bauen({zelle(*c, LOOP, 2.0)}));
    PRUEF(x.t.arr.launch_start(ID, 1, 0.0, 0.0, 1, false) == LaunchGrund::ok);
    x.bis(8 * 20571);
    double lo = 1e9, hi = -1e9;
    for (int64_t i = 0; i < 7 * 20571; ++i) {   // more than three passes of 2 beats
      lo = std::fmin(lo, x.at(i));
      hi = std::fmax(hi, x.at(i));
    }
    std::printf("case 13 constant cell: min %.6f max %.6f\n", lo, hi);
    PRUEF(lo > 0.4999 && hi < 0.5001);
    Lauf y;
    y.t.k = cdj::Karte(140.0, 0);
    auto sn = Audio::sinus(96000, 50.0, 0.5f);   // 100 whole periods
    y.t.laden(bauen({zelle(*sn, LOOP, 2.0)}));
    PRUEF(y.t.arr.launch_start(ID, 1, 0.0, 0.0, 1, false) == LaunchGrund::ok);
    y.bis(8 * 20571);
    double sprung = 0.0;
    for (int64_t i = 2; i < 7 * 20571; ++i) sprung = std::fmax(sprung, std::fabs(y.at(i) - y.at(i - 1)));
    std::printf("case 13 sine cell: largest step %.6f (smooth limit 0.0077)\n", sprung);
    PRUEF(sprung < 0.0100);
  }
  {  // 14: the cell gain acts on the voice
    Lauf x;
    x.t.laden(bauen({zelle(*g50, LOOP, 4.0, 0.5f)}));
    PRUEF(x.t.arr.launch_start(ID, 1, 0.0, 0.0, 1, false) == LaunchGrund::ok);
    x.bis(2 * SPB);
    PRUEF_NAH(x.at(5000), 0.25, 1e-6);
  }
  {  // 15: block sizes other than 256
    for (int n : {100, 333, 1024}) {
      Lauf x;
      x.t.n = n;
      x.t.laden(bauen({zelle(*imp, LOOP, 4.0)}));
      PRUEF(x.t.arr.launch_start(ID, 1, 4.0, 0.0, 1, false) == LaunchGrund::ok);
      x.bis(10 * SPB);
      int64_t erster = -1;
      for (int64_t i = 0; i < static_cast<int64_t>(x.bus.size()) && erster < 0; ++i)
        if (std::fabs(x.at(i)) > 1e-6f) erster = i;
      PRUEF(erster == 4 * SPB);
      PRUEF_NAH(x.at(8 * SPB), 1.0, 1e-4);   // the wrap
      PRUEF_NAH(x.at(8 * SPB - 1), 0.0, 1e-4);
    }
  }
  {  // 16: versatz > 0 with a wrap
    Lauf x;
    x.t.laden(bauen({zelle(*ram, LOOP, 4.0)}));
    PRUEF(x.t.arr.launch_start(ID, 1, 4.0, 3.0, 1, false) == LaunchGrund::ok);
    x.bis(8 * SPB);
    PRUEF_NAH(x.at(4 * SPB), 3.0 * SPB, 1e-3);
    PRUEF_NAH(x.at(5 * SPB - 1), CELL - 1, 1e-2);
    PRUEF_NAH(x.at(5 * SPB), 0.0, 1e-4);
    PRUEF_NAH(x.at(5 * SPB + 10), 10.0, 1e-3);
  }
  {  // 17: ab_beat out of range is refused, nothing changes; wartend_ab reads 0 when nothing waits
    Lauf x;
    x.t.laden(bauen({zelle(*g50, LOOP, 4.0)}));
    const LaunchStand vor = stand(x.t.arr);
    const uint32_t aend = x.t.arr.launch_aenderung();
    for (double b : {1e300, -1e300, 2e9, -2e9}) {
      PRUEF(x.t.arr.launch_start(ID, 1, b, 0.0, 1, false) == LaunchGrund::ausserhalb_bereich);
      PRUEF(x.t.arr.launch_stopp(ID, b, 1, false) == LaunchGrund::ausserhalb_bereich);
    }
    const LaunchStand nach = stand(x.t.arr);
    PRUEF(std::memcmp(&vor, &nach, sizeof vor) == 0 && aend == x.t.arr.launch_aenderung() && meldungen(x.t.arr).empty());
    PRUEF(x.t.arr.launch_start(ID, 1, 8.0, 0.0, 2, false) == LaunchGrund::ok);
    PRUEF(stand(x.t.arr).wartend == 1 && stand(x.t.arr).wartend_ab == 8.0);
    x.bis(9 * SPB);
    PRUEF(stand(x.t.arr).wartend == -1 && stand(x.t.arr).wartend_ab == 0.0 && stand(x.t.arr).zelle == 1);
  }
  PRUEF_ENDE();
}
