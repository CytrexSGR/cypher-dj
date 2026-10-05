// Plan Grid T3: Raster-Versatz im Kern ohne JACK (SCHNITTSTELLEN §4.4, §5.5, §5.9 /e/hotcue, §16.1
// Politik 2). Rahmen wie test_kern_deck.cpp (Lader im selben Faden, Klick-Material, Master links am Kern-Sample). Das
// Material betont die Takt-Eins (0,5, sonst 0,25): ein Sprung um 2 Beats verschiebt die Betonung messbar.
#include <unistd.h>

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
static long g_allokationen = 0;
void* operator new(std::size_t n) {
  if (g_waechter) ++g_allokationen;
  void* p = std::malloc(n ? n : 1);
  if (!p) throw std::bad_alloc();
  return p;
}
void operator delete(void* p) noexcept { std::free(p); }
void operator delete(void* p, std::size_t) noexcept { std::free(p); }

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
  std::vector<cdj::Ereignis> raster;
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
        if (e.art == cdj::Ereignis::RASTER) raster.push_back(e);
      }
    }
  }
  int64_t raster_setzen(int deck, const char* mid, int64_t v, int fassung = 1, double bpm = 128.0) {
    cdj::Befehl b = neu(cdj::Befehl::DECK_RASTER, "andreas");
    b.deck = deck;
    std::snprintf(b.material_id, sizeof b.material_id, "%s", mid);
    b.bpm = bpm;
    b.fassung = fassung;
    b.versatz_f = v;
    return sende(b);
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

int main() {
  AB = "/dev/shm/test_kern_deck_raster_" + std::to_string(::getpid());
  fs::create_directories(AB);
  klick("--material-id 9a9a000000000001 --beats 64");

  Lauf a;
  a.zyklen(10 * N);
  a.laden(1, "9a9a000000000001");
  a.zyklen(20 * N);
  a.fader(1, 0.0f, 2.0);
  a.start(1, 8.0, 0.0);
  a.zyklen(16 * SPB);
  const double q_vor = a.letzter_zustand(1)->quell_beat;
  a.bewachen = true;
  const int64_t r1 = a.raster_setzen(1, "9a9a000000000001", 2400);
  a.zyklen(16 * SPB + 4 * N);
  a.bewachen = false;
  PRUEF(g_allokationen == 0);
  PRUEF(a.quittung(r1, 1) && a.quittung(r1, 2) && a.quittung(r1, 3));
  const double q_nach = a.letzter_zustand(1)->quell_beat;
  std::fprintf(stderr, "INFO q_vor=%.9f q_nach=%.9f diff=%.9f soll=%.9f\n", q_vor, q_nach, q_nach - q_vor, (4.0 * N) / SPB);
  PRUEF(std::fabs((q_nach - q_vor) - (4.0 * N) / SPB) < 0.02);   // weitergelaufen, nicht gesprungen
  PRUEF(a.raster.size() == 1 && a.raster[0].deck == 1 && std::fabs(a.raster[0].wert - 50.0f) < 1e-3f &&
        !std::strcmp(a.raster[0].material_id, "9a9a000000000001"));
  a.zyklen(24 * SPB);
  const auto vor = a.einsaetze(12 * SPB - 3000, 15 * SPB);          // vor der Änderung: auf den Master-Beats
  const auto nach = a.einsaetze(18 * SPB - 3000, 23 * SPB);         // danach: 2400 früher
  std::fprintf(stderr, "INFO vor:"); for (auto e : vor) std::fprintf(stderr, " %ld(%ld)", (long)e, (long)(e % SPB)); std::fprintf(stderr, "\n");
  std::fprintf(stderr, "INFO nach:"); for (auto e : nach) std::fprintf(stderr, " %ld(%ld)", (long)e, (long)(e % SPB)); std::fprintf(stderr, "\n");
  PRUEF(vor.size() >= 3 && nach.size() >= 4);
  for (int64_t e : vor) PRUEF(std::llabs((e % SPB + SPB) % SPB) <= 2 || std::llabs((e % SPB + SPB) % SPB - SPB) <= 2);
  for (int64_t e : nach) PRUEF(std::llabs(((e + 2400) % SPB + SPB) % SPB) <= 2 || std::llabs(((e + 2400) % SPB + SPB) % SPB - SPB) <= 2);

  a.hotcue_setzen(1, 1, 16.0);
  const int64_t h = a.hotcue(1, 28.0, 1, 2, 1.0);
  a.zyklen(34 * SPB);
  PRUEF(a.quittung(h, 2));
  const auto nach_hc = a.einsaetze(29 * SPB - 3000, 33 * SPB);
  std::fprintf(stderr, "INFO nach_hc:"); for (auto e : nach_hc) std::fprintf(stderr, " %ld(%ld)", (long)e, (long)(e % SPB)); std::fprintf(stderr, "\n");
  PRUEF(nach_hc.size() >= 3);
  for (int64_t e : nach_hc)
    PRUEF(std::llabs(((e + 2400) % SPB + SPB) % SPB) <= 2 || std::llabs(((e + 2400) % SPB + SPB) % SPB - SPB) <= 2);

  const size_t n_raster = a.raster.size();
  const int64_t f1 = a.raster_setzen(1, "9a9a0000000000ff", 240);
  const int64_t f2 = a.raster_setzen(1, "9a9a000000000001", 240, 2);
  const int64_t f3 = a.raster_setzen(1, "9a9a000000000001", 240, 1, 124.0);
  a.zyklen(35 * SPB);
  for (int64_t f : {f1, f2, f3}) PRUEF(a.quittung(f, 6) && a.quittung(f, 6)->grund == "nicht_geladen");
  PRUEF(a.raster.size() == n_raster);

  a.stopp(1, 36.0);
  a.zyklen(38 * SPB);
  const double q_steh = a.letzter_zustand(1)->quell_beat;
  a.raster_setzen(1, "9a9a000000000001", -960);
  a.zyklen(38 * SPB + 8 * N);
  PRUEF(std::fabs(a.letzter_zustand(1)->quell_beat - q_steh) < 1e-9);
  a.laden(1, "9a9a000000000001");
  a.zyklen(39 * SPB);
  std::fprintf(stderr, "INFO nach laden quell=%.9f cue=%ld\n", a.letzter_zustand(1)->quell_beat, (long)a.kern->cue_punkt(1));
  PRUEF(std::fabs(a.letzter_zustand(1)->quell_beat) < 1e-9);

  // 4b) Review F6: Laden setzt 0 — die nächste Änderung zählt ab 0 (5 ms), nicht ab −960 (25 ms).
  a.raster_setzen(1, "9a9a000000000001", 240);
  a.zyklen(39 * SPB + 4 * N);
  PRUEF(!a.raster.empty() && std::fabs(a.raster.back().wert - 5.0f) < 1e-3f);
  // 4c) Review F4: Cue-Punkt ohne gesetzten Cue = erste Takt-Eins im verschobenen Raster (cue_frame über schlag0)
  PRUEF(a.kern->cue_punkt(1) == 240);
  // 4d) Review F4: Cue-Taste stehend anderswo rastet auf einen Beat des verschobenen Rasters (auf_beat über schlag0)
  a.sprung(1, 40.0, 1.3, 1, 0.0);
  a.zyklen(41 * SPB);
  a.test_hand("deck/1/cue", 1.0f, 41 * SPB + 10);
  a.test_hand("deck/1/cue", 0.0f, 41 * SPB + 20);
  a.zyklen(42 * SPB);
  std::fprintf(stderr, "INFO cue nach Taste=%ld\n", (long)a.kern->cue_punkt(1));
  PRUEF(a.kern->cue_punkt(1) == 240 + SPB);
  // 4e) Review F4: /k/deck/start mit Quell-Beat 2 bei v = 240: die Klicks kommen 240 Samples vor dem Master-Beat
  a.fader(1, 0.0f, 42.5);
  a.start(1, 44.0, 2.0);
  a.zyklen(50 * SPB);
  const auto st = a.einsaetze(45 * SPB - 3000, 49 * SPB);
  std::fprintf(stderr, "INFO start:"); for (auto e : st) std::fprintf(stderr, " %ld(%ld)", (long)e, (long)(e % SPB)); std::fprintf(stderr, "\n");
  PRUEF(st.size() >= 3);
  for (int64_t e : st) PRUEF(std::llabs(((e + 240) % SPB + SPB) % SPB) <= 2 || std::llabs(((e + 240) % SPB + SPB) % SPB - SPB) <= 2);
  a.stopp(1, 50.5);
  a.zyklen(51 * SPB);

  const int64_t leer = a.raster_setzen(2, "9a9a000000000001", 240);
  a.zyklen(52 * SPB);
  PRUEF(a.quittung(leer, 6) && a.quittung(leer, 6)->grund == "nicht_geladen");

  fs::remove_all(AB);
  PRUEF_ENDE();
}
