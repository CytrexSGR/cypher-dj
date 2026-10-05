// Ohr T14: Prüfer im Kern, am echten Kern belegt (SCHNITTSTELLEN §17 I3a, §4.5). Aufbau aus test_kern_deck.cpp (Lauf
// mit Lader im selben Faden). Deck 2 geladen (nicht gestartet: Öffnen prüft I3a am Regler deck/2/fader, unabhängig
// davon, ob das Deck läuft, wie test_kern_teil.cpp). Quelle cypher öffnet ohne Hörschein -> Quittung 6
// kein_hoerschein; mit passendem /k/hoerschein vorher -> Quittung 2; Quelle andreas ohne Schein -> Quittung 2 (§17
// „die Hand wird nie blockiert“); nach /k/hoerschein/weg -> wieder Quittung 6. Negativ-Kontrolle: ohne
// kern.hoerschein_pflicht(true) (Vorgabe der PrueferI3-Instanz: aus) -> Quittung 2 wie heute.
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <memory>
#include <new>
#include <string>
#include <vector>

#include "cypherdj/kern.h"
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
constexpr int64_t SPB = 22500;  // Samples je Beat bei 128 BPM (60/128 * 48000)

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

// Ein Kern mit Lader im selben Faden (wie test_kern_deck.cpp Lauf), dazu /k/hoerschein und /k/hoerschein/weg.
struct Lauf {
  std::unique_ptr<unsigned char[]> mem{new unsigned char[CDJ_RING_BYTES]()};
  cdj_ring_kopf* ring = reinterpret_cast<cdj_ring_kopf*>(mem.get());
  std::unique_ptr<cdj::Befehlsring> bef{new cdj::Befehlsring()};
  std::unique_ptr<cdj::Ereignisring> ere{new cdj::Ereignisring()};
  std::unique_ptr<cdj::LaderRinge> lr{new cdj::LaderRinge()};
  cdj::Lader lader{AB, 3800LL << 20};
  std::unique_ptr<cdj::Kern> kern;
  std::vector<Q> q;
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
  int64_t laden(int deck, const char* mid) {
    cdj::Befehl b = neu(cdj::Befehl::DECK_LADEN);
    b.deck = deck;
    std::snprintf(b.material_id, sizeof b.material_id, "%s", mid);
    b.bpm = 128.0;
    b.fassung = 1;
    return sende(b);
  }
  // /k/teil deck/<deck>/fader -> db, mit oder ohne Hörschein-Feld, Politik 1 (zustand: sofort, kein zu_spaet).
  int64_t fader(int deck, float db, double ab, const char* quelle, const char* hs = "") {
    cdj::Befehl b = neu(cdj::Befehl::TEIL, quelle);
    std::snprintf(b.pfad, sizeof b.pfad, "deck/%d/fader", deck);
    b.ab_beat = ab;
    b.wert = db;
    b.politik = 1;
    std::snprintf(b.hoerschein, sizeof b.hoerschein, "%s", hs);
    return sende(b);
  }
  // /k/hoerschein: registriert hs_id für kanal, material_id/bpm/fassung passend zum geladenen Material.
  int64_t hoerschein(const char* hs, const char* kanal, const char* material_id, double bpm, int fassung,
                      double gueltig_bis_beat) {
    cdj::Befehl b = neu(cdj::Befehl::HOERSCHEIN);
    std::snprintf(b.hoerschein, sizeof b.hoerschein, "%s", hs);
    std::snprintf(b.pfad, sizeof b.pfad, "%s", kanal);
    std::snprintf(b.material_id, sizeof b.material_id, "%s", material_id);
    b.bpm = bpm;
    b.bpm_milli = static_cast<int32_t>(std::llround(bpm * 1000.0));
    b.fassung = fassung;
    b.ab_beat = gueltig_bis_beat;
    b.quell_von = -1e9;
    b.quell_bis = 1e9;
    return sende(b);
  }
  int64_t hoerschein_weg(const char* hs) {
    cdj::Befehl b = neu(cdj::Befehl::HOERSCHEIN_WEG);
    std::snprintf(b.hoerschein, sizeof b.hoerschein, "%s", hs);
    return sende(b);
  }
  void zyklen(int64_t bis_sample, int n = 256) {
    while (kern->sample() < bis_sample) {
      g_waechter = bewachen;
      kern->zyklus(n, 0);
      g_waechter = false;
      lader.einmal(*lr);
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
};

int main() {
  AB = "/dev/shm/test_kern_i3_" + std::to_string(::getpid());
  fs::create_directories(AB);
  const char* MID = "d0000000000000e3";
  klick(std::string("--material-id ") + MID + " --beats 128");  // 128 BPM, Trim 0 dB (−16 LUFS)

  Lauf a;
  a.zyklen(10 * 256);
  const int64_t l2 = a.laden(2, MID);
  a.zyklen(30 * 256);
  PRUEF(a.quittung(l2, 3));                     // Deck 2 geladen (nicht gestartet: I3a prüft unabhängig davon)
  PRUEF(a.kern->deck(2).geladen() && !a.kern->deck(2).laeuft());
  a.kern->hoerschein_pflicht(true);              // Step 1: Prüfer an

  // a) Quelle cypher, ohne Hörschein: Quittung 6 kein_hoerschein, kein gestartet
  const int64_t t1 = a.fader(2, 0.0f, 40.0, "cypher");
  a.zyklen(44 * SPB);
  PRUEF(a.quittung(t1, 1));
  const Q* q1 = a.quittung(t1, 6);
  PRUEF(q1 && q1->grund == "kein_hoerschein");
  PRUEF(!a.quittung(t1, 2));
  PRUEF_NAH(a.kern->stellwerk().wert(a.kern->stellwerk().tabelle().suche("deck/2/fader")), -200.0, 1e-6);

  // b) mit passendem /k/hoerschein vorher: Quittung 2 (gestartet)
  a.hoerschein("h1", "deck/2", MID, 128.0, 1, 200.0);
  a.zyklen(50 * SPB);
  const int64_t t2 = a.fader(2, 0.0f, 56.0, "cypher", "h1");
  a.zyklen(60 * SPB);
  PRUEF(a.quittung(t2, 2));
  PRUEF_NAH(a.kern->stellwerk().wert(a.kern->stellwerk().tabelle().suche("deck/2/fader")), 0.0, 1e-3);
  // wieder zu (für die nächsten Fälle): Schließen öffnet nicht, I3a lässt es immer durch
  a.fader(2, -200.0f, 64.0, "andreas");
  a.zyklen(70 * SPB);

  // c) Quelle andreas ohne Schein: Quittung 2 (§17 „die Hand wird nie blockiert“)
  const int64_t t3 = a.fader(2, 0.0f, 72.0, "andreas");
  a.zyklen(80 * SPB);
  PRUEF(a.quittung(t3, 2));
  a.fader(2, -200.0f, 88.0, "andreas");
  a.zyklen(90 * SPB);

  // d) nach /k/hoerschein/weg: wieder Quittung 6 kein_hoerschein
  a.hoerschein_weg("h1");
  a.zyklen(95 * SPB);
  const int64_t t4 = a.fader(2, 0.0f, 96.0, "cypher", "h1");
  a.zyklen(105 * SPB);
  const Q* q4 = a.quittung(t4, 6);
  PRUEF(q4 && q4->grund == "kein_hoerschein");
  PRUEF(!a.quittung(t4, 2));

  PRUEF(g_allokationen == 0);

  // Negativ-Kontrolle: ohne hoerschein_pflicht(true) (Vorgabe der PrueferI3-Instanz: aus) -> Quittung 2 wie heute
  Lauf b;
  b.zyklen(10 * 256);
  const int64_t l2b = b.laden(2, MID);
  b.zyklen(30 * 256);
  PRUEF(b.quittung(l2b, 3));
  const int64_t t5 = b.fader(2, 0.0f, 40.0, "cypher");  // kein hoerschein_pflicht(true) aufgerufen
  b.zyklen(44 * SPB);
  PRUEF(b.quittung(t5, 2));
  PRUEF(!b.quittung(t5, 6));

  std::printf("test_kern_i3: alle Fälle wie erwartet (a kein_hoerschein, b gestartet, c andreas gestartet, "
              "d wieder kein_hoerschein, Negativ-Kontrolle gestartet)\n");
  return 0;
}
