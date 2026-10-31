// /k/deck/loop_laenge (INTERFACES §4.4, 2026-10-21): Loop-Länge ändern, der Start BLEIBT (Traktor). Rahmen wie test_kern_deck_e9
// (Klick-Material 64 Beats, Master links am Kern-Sample). Gemessen wird die Quellposition aus /zustand/deck während des Laufs.
//   1) Loop 4 ab Quell 8 (läuft ab Master-Beat 16), Länge 8 bei festem Start 8: der Loop läuft [8, 16). Der Fehlerfall davor:
//      /k/deck/loop mit 8 setzt den Start an den Kopf (hier 10 + ...) und liefe [x, x + 8) mit x > 8.
//   2) Verkürzen auf 2 bei festem Start 8, Kopf hinter dem neuen Ende: der Kopf wickelt in [8, 10).
//   3) Negativ: Start außerhalb des Materials und nicht endlicher Start: Quittung 6 bzw. nichts, der alte Loop läuft weiter.
#include <unistd.h>

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <memory>
#include <new>
#include <string>
#include <vector>

#include "cypherdj/kern.h"
#include "cypherdj/zustand.h"
#include "pruef.h"

static bool g_waechter = false;

namespace fs = std::filesystem;
static const std::string DJK = CYPHERDJ_DJK;
static std::string AB;
constexpr int N = 256;
constexpr int64_t SPB = 22500;  // Samples je Beat bei 128

static void klick(const std::string& args) {
  const std::string c = "python3 " + DJK + "/kern/tests/deck/klick_fassung.py --ziel " + AB + " " + args + " > /dev/null";
  PRUEF(std::system(c.c_str()) == 0);
}

struct Q {
  int64_t id;
  int32_t status;
  int64_t sample;
  std::string grund;
};

// Ein Kern mit Lader im selben Faden; master[s] ist Master links am Kern-Sample s.
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
  std::vector<cdj::Ereignis> deck, geladen, frist, hotcues;
  int64_t id = 100;
  bool bewachen = false;
  Lauf() {
    ring->version = CDJ_RING_VERSION;
    ring->rate = CDJ_RING_RATE;
    ring->kanaele = CDJ_RING_KANAELE;
    ring->cap = CDJ_RING_CAP;
    std::memcpy(ring->magic, "CDJB", 4);
    kern.reset(new cdj::Kern(128.0, ring, bef.get(), ere.get()));
    kern->verbinde_lader(lr.get());
    master.reserve(8'000'000);
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
  int64_t laden(int deck, const char* mid, int stems = 0) {
    cdj::Befehl b = neu(cdj::Befehl::DECK_LADEN);
    b.deck = deck;
    std::snprintf(b.material_id, sizeof b.material_id, "%s", mid);
    b.bpm = 128.0;
    b.fassung = 1;
    b.mit_stems = stems;
    return sende(b);
  }
  int64_t start(int deck, double ab, double quell, int politik = 0, const char* quelle = "andreas") {
    cdj::Befehl b = neu(cdj::Befehl::DECK_START, quelle);
    b.deck = deck;
    b.ab_beat = ab;
    b.quell_beat = quell;
    b.politik = politik;
    return sende(b);
  }
  int64_t stopp(int deck, double ab) {
    cdj::Befehl b = neu(cdj::Befehl::DECK_STOPP, "andreas");
    b.deck = deck;
    b.ab_beat = ab;
    b.politik = 1;
    return sende(b);
  }
  int64_t fader(int deck, float db, double ab) {  // §4.3 Setzen mit Schaltrampe
    cdj::Befehl b = neu(cdj::Befehl::TEIL, "pruefstand");
    std::snprintf(b.pfad, sizeof b.pfad, "deck/%d/fader", deck);
    b.ab_beat = ab;
    b.wert = db;
    b.politik = 1;
    return sende(b);
  }
  cdj::Befehl teil_e9(int art, int deck, double ab, int politik, double raster, const char* quelle = "andreas") {
    cdj::Befehl b = neu(art, quelle);
    b.deck = deck;
    b.ab_beat = ab;
    b.politik = politik;
    b.raster_beats = raster;
    return b;
  }
  int64_t sprung(int deck, double ab, double delta, int politik, double raster) {
    cdj::Befehl b = teil_e9(cdj::Befehl::DECK_SPRUNG, deck, ab, politik, raster);
    b.wert_beats = delta;
    return sende(b);
  }
  int64_t loop(int deck, double ab, double laenge, int politik, double raster) {
    cdj::Befehl b = teil_e9(cdj::Befehl::DECK_LOOP, deck, ab, politik, raster);
    b.wert_beats = laenge;
    return sende(b);
  }
  int64_t loop_laenge(int deck, double ab, double start, double laenge, int politik = 1, double raster = 0.0) {
    cdj::Befehl b = teil_e9(cdj::Befehl::DECK_LOOP_LAENGE, deck, ab, politik, raster);
    b.quell_beat = start;
    b.wert_beats = laenge;
    return sende(b);
  }
  int64_t hotcue(int deck, double ab, int nr, int politik, double raster) {
    cdj::Befehl b = teil_e9(cdj::Befehl::DECK_HOTCUE, deck, ab, politik, raster);
    b.nr = nr;
    return sende(b);
  }
  int64_t hotcue_setzen(int deck, int nr, double q) {
    cdj::Befehl b = neu(cdj::Befehl::DECK_HOTCUE_SETZEN, "andreas");
    b.deck = deck;
    b.nr = nr;
    b.quell_beat = q;
    return sende(b);
  }
  void test_hand(const char* pfad, float midi_roh, int64_t sample) {   // /test/hand wie aus dem Netz (kern35.h)
    cdj::Befehl b = neu(cdj::Befehl::HAND, "andreas");
    b.id = 0;
    std::snprintf(b.pfad, sizeof b.pfad, "%s", pfad);
    b.wert = midi_roh;
    b.sample = sample;
    sende(b);
  }
  const cdj::Ereignis* letzter_zustand(int deck) const {
    for (auto it = this->deck.rbegin(); it != this->deck.rend(); ++it)
      if (it->deck == deck) return &*it;
    return nullptr;
  }
  void zyklen(int64_t bis_sample) {
    while (kern->sample() < bis_sample) {
      const int64_t n0 = kern->sample();
      const uint64_t w0 = cdj_lade(&ring->w);
      g_waechter = bewachen;  // nur der Zyklus des Kerns, nicht der Lader und nicht dieses Protokoll
      kern->zyklus(N, n0 * 20833);
      g_waechter = false;
      lader.einmal(*lr);
      const float* d = cdj_ring_daten_c(ring);
      // Stand 25: der Master liegt um den Vorhalt des Master-Limiters hinter dem Kern-Sample (fester Versatz, bekannt)
      const int vh = kern->mixer().limiter_vorhalt();
      if ((int64_t)master.size() < n0 + N) master.resize(n0 + N);
      for (int i = 0; i < N; ++i)
        if (n0 + i - vh >= 0) master[n0 + i - vh] = d[((w0 + (uint64_t)i) % CDJ_RING_CAP) * 4];
      cdj::Ereignis e;
      while (ere->hole(e)) {
        if (e.art == cdj::Ereignis::QUITTUNG) q.push_back({e.id, e.status, e.sample, e.grund});
        if (e.art == cdj::Ereignis::DECK) deck.push_back(e);
        if (e.art == cdj::Ereignis::GELADEN) geladen.push_back(e);
        if (e.art == cdj::Ereignis::FRIST) frist.push_back(e);
        if (e.art == cdj::Ereignis::HOTCUE) hotcues.push_back(e);
      }
    }
  }
  const Q* quittung(int64_t i, int32_t st) const {
    for (const auto& x : q)
      if (x.id == i && x.status == st) return &x;
    return nullptr;
  }
  // Einsätze: erstes Sample über der Schwelle nach mindestens 1000 Samples darunter
  std::vector<int64_t> einsaetze(int64_t von, int64_t bis, float schwelle = 0.05f) const {
    std::vector<int64_t> e;
    int64_t still = 1000;
    for (int64_t s = von; s < bis && s < (int64_t)master.size(); ++s) {
      if (std::fabs(master[s]) > schwelle) {
        if (still >= 1000) e.push_back(s);
        still = 0;
      } else {
        ++still;
      }
    }
    return e;
  }
  float spitze(int64_t von, int64_t bis) const {
    float m = 0.0f;
    for (int64_t s = von; s < bis && s < (int64_t)master.size(); ++s) m = std::max(m, std::fabs(master[s]));
    return m;
  }
};

// Quellpositionen aus den /zustand/deck-Meldungen ab Kern-Sample s0
static void bereich(const Lauf& l, int64_t s0, double& lo, double& hi) {
  lo = 1e9;
  hi = -1e9;
  for (const auto& e : l.deck)
    if (e.deck == 1 && e.sample >= s0 && e.status == 3) {
      lo = std::min(lo, e.quell_beat);
      hi = std::max(hi, e.quell_beat);
    }
}

int main() {
  AB = "/dev/shm/test_kern_deck_loop_laenge_" + std::to_string(::getpid());
  fs::create_directories(AB);
  klick("--material-id e9e9000000000001 --beats 64");

  // 1) Verlängern bei festem Start
  {
    Lauf l;
    l.zyklen(10 * N);
    l.laden(1, "e9e9000000000001");
    l.zyklen(20 * N);
    l.fader(1, 0.0f, 2.0);
    l.start(1, 8.0, 0.0);
    const int64_t lp = l.loop(1, 16.0, 4.0, 1, 0.0);      // Loop [8, 12)
    l.zyklen(22 * SPB);                                    // Kopf bei Beat 22 = Quell 8 + (6 mod 4) = 10
    PRUEF(l.quittung(lp, 2));
    double lo, hi;
    bereich(l, 17 * SPB, lo, hi);
    PRUEF(lo >= 7.99 && hi < 12.05);                       // Ausgangslage [8, 12)
    const int64_t la = l.loop_laenge(1, 23.0, 8.0, 8.0);
    const int64_t s_neu = 24 * SPB;
    l.zyklen(60 * SPB);
    PRUEF(l.quittung(la, 2));
    bereich(l, s_neu, lo, hi);
    PRUEF(lo >= 7.99);                                     // Start bleibt 8
    PRUEF(hi > 15.0 && hi < 16.05);                        // und der Loop reicht bis 16: Länge 8
    const cdj::Ereignis* z = l.letzter_zustand(1);
    PRUEF(z && z->status == 3 && std::isinf(z->beats_bis_ende));

    // 2) Verkürzen auf 2 bei festem Start 8; der Kopf steht dann bei Quell ~8..16, also hinter [8, 10) oder darin
    const int64_t lv = l.loop_laenge(1, 62.0, 8.0, 2.0);
    const int64_t s_kurz = 63 * SPB;
    l.zyklen(80 * SPB);
    PRUEF(l.quittung(lv, 2));
    bereich(l, s_kurz, lo, hi);
    PRUEF(lo >= 7.85 && hi < 10.05);                       // der Kopf wickelt in den Loop [8, 10)
    PRUEF(hi - lo > 1.0);                                  // und kreist darin

    // 3) Negativ: Start hinter dem Material, Loop läuft unverändert weiter
    const int64_t lx = l.loop_laenge(1, 82.0, 500.0, 4.0);
    l.zyklen(90 * SPB);
    PRUEF(l.quittung(lx, 6) && l.quittung(lx, 6)->grund == "ausserhalb_bereich");
    bereich(l, 84 * SPB, lo, hi);
    PRUEF(lo >= 7.85 && hi < 10.05);
  }

  // Kontrolle: ohne Start-Festhalten (/k/deck/loop) wandert der Start an den Kopf, so wie der Fehlerfall im Alltag war
  {
    Lauf l;
    l.zyklen(10 * N);
    l.laden(1, "e9e9000000000001");
    l.zyklen(20 * N);
    l.fader(1, 0.0f, 2.0);
    l.start(1, 8.0, 0.0);
    l.loop(1, 16.0, 4.0, 1, 0.0);
    l.zyklen(22 * SPB);
    l.loop(1, 23.0, 8.0, 1, 0.0);                          // alter Weg: Start = Kopf (Quell 10)
    l.zyklen(60 * SPB);
    double lo, hi;
    bereich(l, 24 * SPB, lo, hi);
    PRUEF(lo > 9.5);                                       // der Start ist weggewandert
  }

  fs::remove_all(AB);
  PRUEF_ENDE();
}
