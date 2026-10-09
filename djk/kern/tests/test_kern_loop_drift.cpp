// Loop-Drift am Weg, den Andreas hört (Prüfung F2 und F5 vom 08.10. zu 8ca44597): /k/deck/loop im Kern bei krummem
// Basis-Tempo. Rahmen wie test_kern_deck_e9 (Lader im selben Faden, Klick-Material aus klick_fassung.py, Master links am
// Kern-Sample, um den Vorhalt des Limiters zurückgerechnet).
//   1) Lage: Kern bei 125,3 BPM, Material Basis 125,3 (Direktweg), Start bei Beat 4 auf Quell 0, Loop 4 Beats bei Beat 12
//      (Quell 8, Takt-Eins). Der Klick am Loop-Anfang in Durchlauf j liegt bei e_0 + j · L_beats · fpb, ±1 Frame, über 64
//      Durchläufe (e_0: derselbe Klick beim ersten Erreichen). Mutation KERN_LOOP_OHNE_LX (kern_deck.cpp ruft loop_an ohne die
//      exakte Länge, Stand vor dem Fix am Kern-Weg) rot.
//   2) Grenze (F5): der Loop endet mit gebrochener Länge genau am Materialende. lx = Rest + 0,3: round(lx) passt gerade
//      noch hinein, der längste Durchlauf ceil(lx) nicht: Quittung 6 ausserhalb_bereich. Negativ-Kontrolle lx = Rest − 0,3
//      (ceil passt): Quittung 2. Mutation KERN_LOOP_GRENZE_LF (Prüfung mit round statt ceil) rot.
#include <unistd.h>

#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <memory>
#include <string>
#include <vector>

#include "cypherdj/kern.h"
#include "cypherdj/zustand.h"
#include "pruef.h"

namespace fs = std::filesystem;
static const std::string DJK = CYPHERDJ_DJK;
static std::string AB;
constexpr int N = 256;
constexpr double BPM = 125.3;
const double FPB = 2880000.0 / BPM;

// Klick-Material schreiben, frames aus der JSON-Zeile des Werkzeugs
static int64_t klick(const std::string& args) {
  const std::string c = "python3 " + DJK + "/kern/tests/deck/klick_fassung.py --ziel " + AB + " " + args;
  FILE* p = popen(c.c_str(), "r");
  PRUEF(p != nullptr);
  if (!p) return 0;
  char buf[4096] = {};
  std::string aus;
  while (std::fgets(buf, sizeof buf, p)) aus += buf;
  PRUEF(pclose(p) == 0);
  const size_t i = aus.find("\"frames\":");
  PRUEF(i != std::string::npos);
  return i == std::string::npos ? 0 : std::atoll(aus.c_str() + i + 9);
}

struct Q {
  int64_t id;
  int32_t status;
  int64_t sample;
  std::string grund;
};

struct Lauf {
  std::unique_ptr<unsigned char[]> mem{new unsigned char[CDJ_RING_BYTES]()};
  cdj_ring_kopf* ring = reinterpret_cast<cdj_ring_kopf*>(mem.get());
  std::unique_ptr<cdj::Befehlsring> bef{new cdj::Befehlsring()};
  std::unique_ptr<cdj::Ereignisring> ere{new cdj::Ereignisring()};
  std::unique_ptr<cdj::LaderRinge> lr{new cdj::LaderRinge()};
  cdj::Lader lader{AB, 3800LL << 20};
  std::unique_ptr<cdj::Kern> kern;
  std::vector<float> master;
  std::vector<Q> q;
  int64_t id = 100;
  Lauf() {
    ring->version = CDJ_RING_VERSION;
    ring->rate = CDJ_RING_RATE;
    ring->kanaele = CDJ_RING_KANAELE;
    ring->cap = CDJ_RING_CAP;
    std::memcpy(ring->magic, "CDJB", 4);
    kern.reset(new cdj::Kern(BPM, ring, bef.get(), ere.get()));
    kern->verbinde_lader(lr.get());
    master.reserve(7'000'000);
  }
  cdj::Befehl neu(int art, const char* quelle = "leitstand") {
    cdj::Befehl b{};
    b.art = art;
    b.id = ++id;
    std::snprintf(b.quelle, sizeof b.quelle, "%s", quelle);
    return b;
  }
  int64_t sende(const cdj::Befehl& b) {
    PRUEF(bef->schiebe(b));
    return b.id;
  }
  void laden(int deck, const char* mid) {
    cdj::Befehl b = neu(cdj::Befehl::DECK_LADEN);
    b.deck = deck;
    std::snprintf(b.material_id, sizeof b.material_id, "%s", mid);
    b.bpm = BPM;
    b.fassung = 1;
    sende(b);
  }
  int64_t start(int deck, double ab, double quell) {
    cdj::Befehl b = neu(cdj::Befehl::DECK_START, "andreas");
    b.deck = deck;
    b.ab_beat = ab;
    b.quell_beat = quell;
    return sende(b);
  }
  void fader(int deck, float db, double ab) {
    cdj::Befehl b = neu(cdj::Befehl::TEIL, "pruefstand");
    std::snprintf(b.pfad, sizeof b.pfad, "deck/%d/fader", deck);
    b.ab_beat = ab;
    b.wert = db;
    b.politik = 1;
    sende(b);
  }
  int64_t loop(int deck, double ab, double laenge) {
    cdj::Befehl b = neu(cdj::Befehl::DECK_LOOP, "andreas");
    b.deck = deck;
    b.ab_beat = ab;
    b.politik = 1;
    b.raster_beats = 0.0;
    b.wert_beats = laenge;
    return sende(b);
  }
  void zyklen(int64_t bis_sample) {
    while (kern->sample() < bis_sample) {
      const int64_t n0 = kern->sample();
      const uint64_t w0 = cdj_lade(&ring->w);
      kern->zyklus(N, n0 * 20833);
      lader.einmal(*lr);
      const float* d = cdj_ring_daten_c(ring);
      const int vh = kern->mixer().limiter_vorhalt();
      if ((int64_t)master.size() < n0 + N) master.resize(n0 + N);
      for (int i = 0; i < N; ++i)
        if (n0 + i - vh >= 0) master[n0 + i - vh] = d[((w0 + (uint64_t)i) % CDJ_RING_CAP) * 4];
      cdj::Ereignis e;
      while (ere->hole(e))
        if (e.art == cdj::Ereignis::QUITTUNG) q.push_back({e.id, e.status, e.sample, e.grund});
    }
  }
  const Q* quittung(int64_t i, int32_t st) const {
    for (const auto& x : q)
      if (x.id == i && x.status == st) return &x;
    return nullptr;
  }
  // erstes Sample über der Schwelle in [von, bis) nach mindestens 1000 Samples darunter; −1: keins
  int64_t einsatz(int64_t von, int64_t bis, float schwelle = 0.05f) const {
    int64_t still = 0;
    for (int64_t s = von - 1000; s < bis && s < (int64_t)master.size(); ++s) {
      if (s < 0) continue;
      if (std::fabs(master[(size_t)s]) > schwelle) {
        if (still >= 1000 && s >= von) return s;
        still = 0;
      } else {
        ++still;
      }
    }
    return -1;
  }
};

int main() {
  AB = "/dev/shm/test_kern_loop_drift_" + std::to_string(::getpid());
  fs::create_directories(AB);
  klick("--material-id e9e9000000001253 --bpm 125.3 --beats 16");

  // 1) Lage über 64 Durchläufe
  {
    const int D = 64;
    const double lb = 4.0, lx = lb * FPB;
    Lauf l;
    l.zyklen(10 * N);
    l.laden(1, "e9e9000000001253");
    l.zyklen(20 * N);
    l.fader(1, 0.0f, 2.0);
    const int64_t st = l.start(1, 4.0, 0.0);
    const int64_t lp = l.loop(1, 12.0, lb);
    l.zyklen(std::llround((12.0 + (D + 0.5) * lb) * FPB));
    PRUEF(l.quittung(st, 2) && l.quittung(lp, 2));
    const int64_t e0 = l.einsatz(std::llround(12.0 * FPB) - 200, std::llround(12.0 * FPB) + 200);
    PRUEF(e0 > 0);
    int n = 0;
    double mx = 0.0, letzt = 0.0;
    for (int j = 1; j <= D && e0 > 0; ++j) {
      const double soll = (double)e0 + j * lx;
      const int64_t e = l.einsatz(std::llround(soll) - 100, std::llround(soll) + 100);
      if (e < 0) continue;
      ++n;
      letzt = (double)e - soll;
      mx = std::max(mx, std::fabs(letzt));
    }
    std::printf("  loop_drift Kern /k/deck/loop, Basis 125,3, 4 Beats: Klick am Loop-Anfang in %d von %d Durchläufen, Lage "
                "zuletzt %+.3f, max |Lage| %.3f Frames\n",
                n, D, letzt, mx);
    PRUEF(n == D);
    PRUEF(mx <= 1.0);
  }

  // 2) Grenze: Loop endet mit gebrochener Länge am Materialende
  const int64_t F = klick("--material-id e9e9000000001254 --bpm 125.3 --beats 12");
  const cdj::Karte k(BPM, 0);
  const int64_t s_start = std::llround(k.sample_at(4.0)), s_loop = std::llround(k.sample_at(8.0));
  const int64_t a_f = s_loop - s_start;  // Start auf Quell 0 (erster_schlag_frame 0): der Kopf läuft 1:1
  for (int z = 0; z < 2; ++z) {
    const double lx = (double)(F - a_f) + (z == 0 ? 0.3 : -0.3);
    Lauf l;
    l.zyklen(10 * N);
    l.laden(1, "e9e9000000001254");
    l.zyklen(20 * N);
    const int64_t st = l.start(1, 4.0, 0.0);
    const int64_t lp = l.loop(1, 8.0, lx / FPB);
    l.zyklen(s_loop + 4 * N);
    const Q* qs = l.quittung(st, 2);
    PRUEF(qs && qs->sample == s_start);
    const Q* ok = l.quittung(lp, 2);
    const Q* nein = l.quittung(lp, 6);
    std::printf("  loop_grenze: Material %lld Frames, Loop ab %lld, Länge %.1f (round %lld, ceil %lld): Quittung %s\n",
                (long long)F, (long long)a_f, lx, (long long)std::llround(lx), (long long)std::ceil(lx),
                ok ? "2" : nein ? ("6 " + nein->grund).c_str() : "keine");
    if (z == 0) PRUEF(nein && nein->grund == "ausserhalb_bereich" && !ok);
    else PRUEF(ok && !nein);
  }

  fs::remove_all(AB);
  PRUEF_ENDE();
}
