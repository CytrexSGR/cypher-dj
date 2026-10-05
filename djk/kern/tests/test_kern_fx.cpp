// Plan 3 (Beat-FX, Spec E8, §4.10): die EINE Beat-FX-Einheit im Mixer ohne JACK. Rahmen wie test_kern_deck_e9.cpp
// (Klick-Material, Master links am Kern-Sample). Echo ½ Beat ohne Rückkopplung macht aus jedem Klick zwei im Abstand
// 11 250; aus: keiner mehr; Fader zu: die Fahne klingt nach (nach dem Fader); an erz/1 bleibt Deck 1 trocken; master.
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
  std::vector<cdj::Ereignis> deck, geladen, frist, hotcues, fxe, fxz;
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
  // AUFTRAG 2026-09-28: zwei Einheiten; deck = Einheit, param2/param3 in raster_beats/quell_beat (kern.h)
  int64_t fx(int einheit, int art, double beats, float wet, float param1, double param2, double param3, int an) {
    cdj::Befehl b = neu(cdj::Befehl::FX, "andreas");
    b.deck = einheit;
    b.nr = art;
    b.dauer_beats = beats;
    b.wert = wet;
    b.wert_beats = param1;
    b.raster_beats = param2;
    b.quell_beat = param3;
    b.an = an;
    return sende(b);
  }
  int64_t fxZuweisung(int einheit, const char* kanal, int an) {
    cdj::Befehl b = neu(cdj::Befehl::FX_ZUWEISUNG, "andreas");
    b.deck = einheit;
    std::snprintf(b.pfad, sizeof b.pfad, "%s", kanal);
    b.an = an;
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
        if (e.art == cdj::Ereignis::FX) fxe.push_back(e);
        if (e.art == cdj::Ereignis::FX_ZUWEISUNG) fxz.push_back(e);
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



int main() {
  AB = "/dev/shm/test_kern_fx_" + std::to_string(::getpid());
  fs::create_directories(AB);
  klick("--material-id f0f0000000000001 --beats 64");
  Lauf a;
  a.zyklen(10 * N);
  a.laden(1, "f0f0000000000001");
  a.zyklen(20 * N);
  a.fader(1, 0.0f, 2.0);
  a.start(1, 8.0, 0.0);
  a.zyklen(10 * SPB);
  const float viertel = a.spitze(9 * SPB, 9 * SPB + 200);
  auto pegel = [&](double bt) { return a.spitze(std::llround(bt * SPB), std::llround(bt * SPB) + 200); };
  PRUEF(viertel > 0.05f && pegel(9.5) < 0.01f * viertel);   // Negativ: ohne FX nichts zwischen den Schlägen

  // 1) FX1 Echo ½ Beat, Wet 1, Rückkopplung 0 (param1); deck/1 an FX1 zuweisen: Klick wiederholt sich, 11 250 später
  const int64_t p1 = a.fx(1, 1, 0.5, 1.0f, 0.0f, 0.5, 0.5, 1);
  const int64_t z1 = a.fxZuweisung(1, "deck/1", 1);
  a.bewachen = true;
  a.zyklen(20 * SPB);
  a.bewachen = false;
  PRUEF(a.quittung(p1, 1) && a.quittung(p1, 3));
  PRUEF(a.quittung(z1, 1) && a.quittung(z1, 3));
  PRUEF(std::fabs(pegel(13.5) - pegel(13)) < 0.1f * viertel);   // Wiederholung so laut wie der Klick
  PRUEF(pegel(16.5) > 1.8f * viertel);                           // die Takt-Eins wiederholt sich betont
  PRUEF(pegel(13.25) < 0.01f * viertel);                         // nichts daneben
  bool raster = true;
  for (int64_t e : a.einsaetze(12 * SPB, 19 * SPB)) raster = raster && (e % (SPB / 2)) < 3;
  PRUEF(raster);
  PRUEF(g_allokationen == 0);
  PRUEF(!a.fxe.empty() && a.fxe.back().deck == 1 && a.fxe.back().fx_art == 1 && a.fxe.back().status == 1 &&
        a.fxe.back().fx_beats == 0.5 && a.fxe.back().beats_bis_ende == 0.5 && a.fxe.back().faktor == 0.5);
  PRUEF(!a.fxz.empty() && a.fxz.back().deck == 1 && !std::strcmp(a.fxz.back().pfad, "deck/1") &&
        a.fxz.back().status == 1);

  // 2) Fader zu bei Beat 20,25: der Klick bei 20 kommt bei 20,5 noch einmal (nach dem Fader), 21 still
  a.fader(1, -200.0f, 20.25);
  a.zyklen(22 * SPB);
  PRUEF(pegel(20.5) > 0.5f * viertel);
  PRUEF(pegel(21) < 0.01f * viertel && pegel(21.5) < 0.01f * viertel);
  a.fader(1, 0.0f, 22.0);

  // 3) Zuweisung ab bei Beat 24 (D4): Eingang zu, Fahne klingt aus (Rückkopplung 0: ein Echo lang)
  a.zyklen(std::llround(23.9 * SPB));
  const int64_t z3 = a.fxZuweisung(1, "deck/1", 0);
  a.zyklen(28 * SPB);
  PRUEF(pegel(25.5) < 0.01f * viertel && pegel(26.5) < 0.01f * viertel);
  PRUEF(pegel(26.0) > 0.5f * viertel);   // der Klick selbst bleibt
  PRUEF(a.fxz.back().status == 0 && a.quittung(z3, 3));

  // 4) erz/1 an FX1 (deck/1 bleibt ab): deck/1 bleibt trocken
  a.fxZuweisung(1, "erz/1", 1);
  a.zyklen(31 * SPB);
  PRUEF(pegel(29.5) < 0.01f * viertel && pegel(30.5) < 0.01f * viertel);
  PRUEF(a.fxz.back().deck == 1 && !std::strcmp(a.fxz.back().pfad, "erz/1") && a.fxz.back().status == 1);

  // 5) deck/1 zusätzlich an FX1 (ersetzt das alte Umhängen): beide Kanäle hängen gleichzeitig an FX1
  a.fxZuweisung(1, "deck/1", 1);
  a.zyklen(35 * SPB);
  PRUEF(pegel(33.5) > 0.5f * viertel && pegel(34.5) > 0.5f * viertel);
  PRUEF(a.kern->mixer().fx_zugewiesen(0, cdj::Mixer::kanal_index("deck/1")));
  PRUEF(a.kern->mixer().fx_zugewiesen(0, cdj::Mixer::kanal_index("erz/1")));
  PRUEF(!a.kern->mixer().fx_zugewiesen(1, cdj::Mixer::kanal_index("deck/1")));

  // 6) unbekannter Kanal bei Zuweisung: Quittung 6
  const int64_t z6 = a.fxZuweisung(1, "deck/3", 1);
  a.zyklen(40 * SPB);
  PRUEF(a.quittung(z6, 6));

  // 7) unbekannte Einheit: Quittung 6, bei Zuweisung und bei den Einheits-Parametern
  const int64_t z7 = a.fxZuweisung(3, "deck/1", 1);
  a.zyklen(41 * SPB);
  PRUEF(a.quittung(z7, 6));
  const int64_t p7 = a.fx(0, 1, 0.5, 1.0f, 0.0f, 0.5, 0.5, 1);
  a.zyklen(42 * SPB);
  PRUEF(a.quittung(p7, 6));

  // 8) Reihenfolge FX1 → FX2 mit einem nicht vertauschbaren Paar: FILTER (FX1, zeitvariant, Wet 1, LFO-Periode
  // 4 Beats) vor ECHO (FX2, 1 Beat, Wet 1, Rückkopplung 0). Läuft FILTER zuerst, ist die Wiederholung bei Beat 49 eine
  // verzögerte Kopie des schon gefilterten Klicks bei Beat 48: Verhältnis 1. Liefe ECHO zuerst, gingen Klick und
  // Wiederholung an zwei verschiedenen LFO-Phasen durch den Filter.
  a.fxZuweisung(1, "deck/1", 0);
  a.fxZuweisung(1, "erz/1", 0);
  a.zyklen(43 * SPB);
  a.fx(1, 4 /* FILTER */, 4.0, 1.0f, 1.0f, 0.5, 0.5, 1);
  a.fx(2, 1 /* ECHO */, 1.0, 1.0f, 0.0f, 0.5, 0.5, 1);
  a.fxZuweisung(1, "deck/1", 1);
  a.fxZuweisung(2, "deck/1", 1);
  a.zyklen(52 * SPB);
  const float original = pegel(48.0);
  const float wiederholung = pegel(49.0);
  std::printf("Fall 8: original %.4f wiederholung %.4f verhaeltnis %.4f\n", original, wiederholung, wiederholung / original);
  PRUEF(original > 0.01f * viertel);   // Negativ-Kontrolle: sonst ist der Beweis leer
  PRUEF(std::fabs(wiederholung / original - 1.0f) < 0.05f);   // gemessen 1,010; vertauscht 46,9

  // 9) Master an FX1 (Echo ½ Beat, Wet 1, Rückkopplung 0): das Echo sitzt auf der Summe; FX2 und deck/1 ab
  a.fxZuweisung(2, "deck/1", 0);
  a.fxZuweisung(1, "deck/1", 0);
  a.fx(1, 1, 0.5, 1.0f, 0.0f, 0.5, 0.5, 1);
  a.zyklen(53 * SPB);
  PRUEF(pegel(52.5) < 0.01f * viertel);   // Negativ: vor der Master-Zuweisung trocken
  const int64_t z9 = a.fxZuweisung(1, "master", 1);
  a.zyklen(57 * SPB);
  PRUEF(a.quittung(z9, 3));
  PRUEF(pegel(55.5) > 0.5f * viertel && pegel(56.5) > 0.5f * viertel);
  PRUEF(a.kern->mixer().fx_zugewiesen(0, cdj::Mixer::FX_MASTER));
  PRUEF(!std::strcmp(a.fxz.back().pfad, "master") && a.fxz.back().status == 1);
  // Master ab: Eingang zu, die Fahne klingt aus
  a.fxZuweisung(1, "master", 0);
  a.zyklen(60 * SPB);
  PRUEF(pegel(58.5) < 0.01f * viertel && pegel(59.5) < 0.01f * viertel);

  fs::remove_all(AB);
  PRUEF_ENDE();
}
