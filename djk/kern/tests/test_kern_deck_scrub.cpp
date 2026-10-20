// Hörbares Ziehen (Scrub) im Kern ohne JACK (SCHNITTSTELLEN §4.4 /k/deck/scrub). Rahmen wie test_kern_deck_e9.cpp. Material:
// linker Kanal ein Dauer-Sinus 440 Hz, rechts die Klicks. Geprüft am Master: ein gezogenes stehendes Deck klingt (vorwärts wie
// rückwärts), ein gehaltenes ist still (Negativ-Kontrolle), beim Loslassen bleibt der Kopf (quell_beat in /zustand/deck), ein
// laufendes Deck läuft um die Strecke versetzt weiter, nichts im Zyklus allokiert, ein nicht geladenes Deck ignoriert den Befehl.
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
  int64_t sprung(int deck, double ab, double delta, int politik, double raster) {
    cdj::Befehl b = neu(cdj::Befehl::DECK_SPRUNG, "andreas");
    b.deck = deck;
    b.ab_beat = ab;
    b.politik = politik;
    b.raster_beats = raster;
    b.wert_beats = delta;
    return sende(b);
  }
  int64_t scrub(int deck, int phase, double delta_beats, const char* quelle = "andreas") {   // Hörbares Ziehen, ohne Quittung
    cdj::Befehl b = neu(cdj::Befehl::DECK_SCRUB, quelle);
    b.deck = deck;
    b.nr = phase;
    b.wert_beats = delta_beats;
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



// Hand zieht: alle 768 Samples (≈ 62,5 Hz) eine neue Strecke, `schritt` Beats je Meldung, n Meldungen; dann Loslassen.
static void ziehen(Lauf& L, int deck, double schritt, int n, bool los = true) {
  L.scrub(deck, 1, 0.0);
  L.zyklen(L.kern->sample() + 768);
  for (int k = 1; k <= n; ++k) {
    L.scrub(deck, 2, schritt * k);
    L.zyklen(L.kern->sample() + 768);
  }
  if (los) L.scrub(deck, 0, schritt * n);
}

int main() {
  AB = "/dev/shm/test_kern_deck_scrub_" + std::to_string(::getpid());
  fs::create_directories(AB);
  klick("--material-id 5c5c000000000001 --beats 64 --sinus-links 440");

  // 0) Bezugspegel: das Deck spielt normal; der Sinus am Master ist P_ref
  float p_ref = 0.0f;
  {
    Lauf r;
    r.zyklen(10 * N);
    r.laden(1, "5c5c000000000001");
    r.zyklen(20 * N);
    r.fader(1, 0.0f, 2.0);
    r.start(1, 8.0, 0.0);
    r.zyklen(12 * SPB);
    p_ref = r.spitze(10 * SPB, 12 * SPB);
    PRUEF(p_ref > 0.05f);
  }

  // 1) Stehendes Deck, Hand zieht vorwärts: vorher und nachher Stille, dazwischen klingt es, der Kopf bleibt an der Zugstelle
  {
    Lauf a;
    a.zyklen(10 * N);
    a.laden(1, "5c5c000000000001");
    a.zyklen(20 * N);
    a.fader(1, 0.0f, 2.0);
    a.zyklen(6 * SPB);
    const cdj::Ereignis* z0 = a.letzter_zustand(1);
    PRUEF(z0 && z0->status == 1);
    const double q0 = z0->quell_beat;
    const int64_t s_griff = a.kern->sample();
    a.bewachen = true;                    // Zugweg im Zyklus: keine Allokation
    ziehen(a, 1, 0.05, 60);               // 3 Beats in ≈ 0,96 s (≈ 1,2 Frames je Sample)
    const int64_t s_los = a.kern->sample();
    a.zyklen(s_los + 4800);               // Ausschwingen
    a.bewachen = false;
    a.zyklen(s_los + 24000);
    PRUEF(a.spitze(s_los + 8000, a.kern->sample()) <= 1e-6f);   // danach Stille, das Deck steht
    PRUEF(a.spitze(s_griff - 6 * SPB, s_griff) <= 1e-6f);                      // vorher Stille
    PRUEF(a.spitze(s_griff + 8000, s_los) > 0.5f * p_ref);                     // gezogen klingt es
    const cdj::Ereignis* z1 = a.letzter_zustand(1);
    PRUEF(z1 && z1->status == 1);
    PRUEF_NAH(z1->quell_beat, q0 + 3.0, 0.002);   // der Kopf bleibt an der gezogenen Stelle
    PRUEF(g_allokationen == 0);
  }

  // 2) Rückwärts: negative Strecke, der Kopf liegt danach davor, es klingt
  {
    Lauf b;
    b.zyklen(10 * N);
    b.laden(1, "5c5c000000000001");
    b.zyklen(20 * N);
    b.fader(1, 0.0f, 2.0);
    const int64_t sp = b.sprung(1, 4.0, 10.0, 1, 0.0);    // erst auf Quell-Beat 10 (stehend: nur die Position)
    (void)sp;
    b.zyklen(6 * SPB);
    const double q0 = b.letzter_zustand(1)->quell_beat;
    const int64_t s_griff = b.kern->sample();
    ziehen(b, 1, -0.05, 60);
    const int64_t s_los = b.kern->sample();
    b.zyklen(s_los + 24000);
    PRUEF(b.spitze(s_griff + 8000, s_los) > 0.5f * p_ref);
    PRUEF_NAH(b.letzter_zustand(1)->quell_beat, q0 - 3.0, 0.002);
    PRUEF(b.spitze(s_los + 8000, b.kern->sample()) <= 1e-6f);
  }

  // 3) Negativ-Kontrolle: die Hand fasst an und hält still (mit Lebenszeichen alle 250 ms): Stille, Kopf unverändert
  {
    Lauf h;
    h.zyklen(10 * N);
    h.laden(1, "5c5c000000000001");
    h.zyklen(20 * N);
    h.fader(1, 0.0f, 2.0);
    h.zyklen(4 * SPB);
    const double q0 = h.letzter_zustand(1)->quell_beat;
    const int64_t s_griff = h.kern->sample();
    h.scrub(1, 1, 0.0);
    for (int k = 0; k < 8; ++k) {
      h.zyklen(h.kern->sample() + 12000);
      h.scrub(1, 2, 0.0);
    }
    h.scrub(1, 0, 0.0);
    h.zyklen(h.kern->sample() + 24000);
    PRUEF(h.spitze(s_griff, h.kern->sample()) <= 1e-6f);
    PRUEF_NAH(h.letzter_zustand(1)->quell_beat, q0, 1e-9);
  }

  // 4) Laufendes Deck: die Hand schiebt um 2 Beats, danach läuft das Deck um 2 Beats versetzt weiter (wie der Sprung der Seite).
  //    Negativ-Kontrolle davor: ein Griff ohne Strecke ändert die Phase nicht.
  {
    Lauf l;
    l.zyklen(10 * N);
    l.laden(1, "5c5c000000000001");
    l.zyklen(20 * N);
    l.fader(1, 0.0f, 2.0);
    l.start(1, 8.0, 0.0);
    l.zyklen(12 * SPB);
    const cdj::Ereignis* z0 = l.letzter_zustand(1);
    PRUEF(z0 && z0->status >= 2);
    const double d0 = z0->quell_beat - z0->beat;           // Phase vor dem Griff
    l.scrub(1, 1, 0.0);
    l.zyklen(l.kern->sample() + 8000);
    l.scrub(1, 0, 0.0);
    l.zyklen(l.kern->sample() + 12000);
    const cdj::Ereignis* z1 = l.letzter_zustand(1);
    PRUEF(z1 && z1->status >= 2 && std::fabs((z1->quell_beat - z1->beat) - d0) < 0.002);   // Griff ohne Strecke: Phase gleich
    const int64_t s_griff = l.kern->sample();
    l.bewachen = true;
    ziehen(l, 1, 0.05, 40);                                 // +2 Beats in ≈ 0,64 s
    l.zyklen(l.kern->sample() + 12000);
    l.bewachen = false;
    const cdj::Ereignis* z2 = l.letzter_zustand(1);
    PRUEF(z2 && z2->status >= 2 && std::fabs((z2->quell_beat - z2->beat) - (d0 + 2.0)) < 0.002);
    PRUEF(l.spitze(s_griff, l.kern->sample()) > 0.5f * p_ref);   // es klang durchgehend (Nudge, nie Stille)
    PRUEF(g_allokationen == 0);
  }

  // 5) Nicht geladenes Deck: der Befehl wird ignoriert (kein Absturz, keine Quittung, Stille)
  {
    Lauf n;
    n.zyklen(10 * N);
    const int64_t id = n.scrub(2, 1, 0.0);
    n.scrub(2, 2, 1.0);
    n.scrub(2, 0, 1.0);
    n.zyklen(n.kern->sample() + 4800);
    PRUEF(!n.quittung(id, 6) && !n.quittung(id, 1));
    PRUEF(n.spitze(0, n.kern->sample()) <= 1e-6f);
  }

  fs::remove_all(AB);
  PRUEF_ENDE();
}
