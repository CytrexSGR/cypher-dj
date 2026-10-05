// Plan E9 (Deck-Bedienung): Sprung, Hotcue, Loop im Kern ohne JACK (SCHNITTSTELLEN §4.4, §5.5, §5.9 /e/hotcue, §16.1
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
  AB = "/dev/shm/test_kern_deck_e9_" + std::to_string(::getpid());
  fs::create_directories(AB);
  klick("--material-id e9e9000000000001 --beats 64");

  // 1) Sprung +2 Beats bei Beat 16 (Deck läuft ab Beat 8 mit Quell-Beat 0, Takt-Eins bei Quell 0, 4, 8, …): ab 16 klingt
  //    Quell-Beat 10 statt 8, die Takt-Eins (Quell 12) liegt dann bei Master-Beat 18 statt 20.
  Lauf a;
  a.zyklen(10 * N);
  a.laden(1, "e9e9000000000001");
  a.zyklen(20 * N);
  a.fader(1, 0.0f, 2.0);
  a.start(1, 8.0, 0.0);
  const int64_t sp = a.sprung(1, 16.0, 2.0, 2, 1.0);
  a.bewachen = true;
  a.zyklen(30 * SPB);
  a.bewachen = false;
  PRUEF(a.quittung(sp, 1) && a.quittung(sp, 2) && a.quittung(sp, 2)->sample == 16 * SPB);
  // Am Master (Trim, Pegel, Limiter) klingt die Takt-Eins bei 0,264 und der Viertel-Klick bei 0,132 (gemessen): gezählt
  // wird darum das Verhältnis zu einem Viertel-Klick vor dem Sprung (Beat 9).
  const float viertel = a.spitze(9 * SPB, 9 * SPB + 200);
  auto betont = [&](int bt) { return a.spitze(bt * SPB, bt * SPB + 200) > 1.8f * viertel; };
  PRUEF(viertel > 0.05f);
  PRUEF(betont(12));                            // vor dem Sprung: Takt-Eins bei 12
  PRUEF(betont(18) && betont(22) && betont(26));  // danach bei 18, 22, 26
  PRUEF(!betont(20) && !betont(24));            // Negativ: bei 20 und 24 nur noch ein Viertel-Klick
  bool raster = true;
  for (int64_t e : a.einsaetze(16 * SPB + 200, 28 * SPB)) raster = raster && (e % SPB) < 3;
  PRUEF(raster);   // Phase zum Master unverändert
  PRUEF(g_allokationen == 0);

  // 2) Politik 2 zu spät: ab_beat liegt zurück, Raster 4 → am nächsten erreichbaren Vielfachen von 4, Quittung 5
  const int64_t jetzt_s = a.kern->sample();
  const int64_t sp2 = a.sprung(1, std::floor(jetzt_s / double(SPB)) - 1.0, 4.0, 2, 4.0);
  a.zyklen(jetzt_s + 10 * SPB);
  const Q* q2 = a.quittung(sp2, 5);
  PRUEF(q2 && q2->sample % (4 * SPB) == 0 && q2->sample >= jetzt_s && q2->sample < jetzt_s + 5 * SPB);
  PRUEF(!a.quittung(sp2, 4));   // nicht verworfen
  // Negativ: dieselbe Verspätung mit Politik 0 wird verworfen (Quittung 4 zu_spaet)
  const int64_t sp3 = a.sprung(1, std::floor(a.kern->sample() / double(SPB)) - 1.0, 4.0, 0, 0.0);
  a.zyklen(a.kern->sample() + 4 * N);
  PRUEF(a.quittung(sp3, 4) && a.quittung(sp3, 4)->grund == "zu_spaet");

  // 3) Steht das Deck, verschiebt der Sprung nur die Position: quell_beat in /zustand/deck um delta, kein Ton
  const double b_stopp = std::ceil(a.kern->sample() / double(SPB)) + 1.0;
  a.stopp(1, b_stopp);
  a.zyklen(std::llround((b_stopp + 2.0) * SPB));
  const cdj::Ereignis* z0 = a.letzter_zustand(1);
  PRUEF(z0 && z0->status == 1);
  const double q_vor = z0->quell_beat;
  const int64_t sp4 = a.sprung(1, b_stopp + 3.0, -4.0, 1, 0.0);
  a.zyklen(std::llround((b_stopp + 5.0) * SPB));
  const cdj::Ereignis* z1 = a.letzter_zustand(1);
  PRUEF(a.quittung(sp4, 2) && z1 && z1->status == 1);
  PRUEF_NAH(z1->quell_beat, q_vor - 4.0, 1e-9);
  PRUEF(a.spitze(std::llround((b_stopp + 1.0) * SPB), std::llround((b_stopp + 5.0) * SPB)) <= 1e-6f);

  // 4) Hotcues (Plan E9 T7): setzen meldet /e/hotcue; spielen springt phasentreu; leerer Platz 6; Laden leert die Plätze
  {
    Lauf h;
    h.zyklen(10 * N);
    h.laden(1, "e9e9000000000001");
    h.zyklen(20 * N);
    h.fader(1, 0.0f, 2.0);
    const int64_t hs = h.hotcue_setzen(1, 1, 13.0);   // Quell-Beat 13: ein Viertel-Klick, die Takt-Eins folgt bei 16
    h.zyklen(40 * N);
    PRUEF(h.quittung(hs, 1) && h.quittung(hs, 2) && h.quittung(hs, 3));
    PRUEF(h.hotcues.size() == 1 && h.hotcues[0].status == 1 && h.hotcues[0].quell_beat == 13.0 &&
          !std::strcmp(h.hotcues[0].material_id, "e9e9000000000001"));
    h.start(1, 8.0, 0.0);
    const int64_t hp = h.hotcue(1, 16.0, 1, 2, 1.0);   // bei 16 klingt Quell 13, die Takt-Eins (16) dann bei Master 19
    h.zyklen(26 * SPB);
    PRUEF(h.quittung(hp, 2) && h.quittung(hp, 2)->sample == 16 * SPB);
    const float viertel = h.spitze(9 * SPB, 9 * SPB + 200);
    auto betont = [&](int bt) { return h.spitze(bt * SPB, bt * SPB + 200) > 1.8f * viertel; };
    PRUEF(betont(12) && betont(19) && betont(23));
    PRUEF(!betont(20) && !betont(24));             // Negativ: ohne Hotcue wäre die Takt-Eins bei 20 und 24
    // Phasentreue (§4.4 Beispiel): Position mit Phase 0,3 → Ziel = Hotcue + 0,3
    const int64_t hs2 = h.hotcue_setzen(1, 2, 40.0);
    h.start(1, 28.0, 20.3);                          // ab 28 klingt Quell 20,3 (Phase 0,3 zum Master)
    const int64_t hp2 = h.hotcue(1, 30.0, 2, 1, 0.0);
    h.zyklen(31 * SPB);
    PRUEF(h.quittung(hs2, 3) && h.quittung(hp2, 2));
    const cdj::Ereignis* z = h.letzter_zustand(1);
    const double erwartet = 40.3 + (z->beat - 30.0);  // danach läuft das Deck mit Faktor 1 weiter
    PRUEF(z && std::fabs(z->quell_beat - erwartet) < 1e-6);
    // leerer Platz → 6 ausserhalb_bereich
    const int64_t hl = h.hotcue(1, 32.0, 5, 1, 0.0);
    h.zyklen(33 * SPB);
    PRUEF(h.quittung(hl, 6) && h.quittung(hl, 6)->grund == "ausserhalb_bereich");
    // neu laden leert die Plätze: Hotcue 1 danach leer
    h.stopp(1, 34.0);
    h.zyklen(35 * SPB);
    // stehend (Position mit Bruchteil nach dem Stopp): genau auf den Hotcue, nicht phasentreu (Review E9 F7)
    const int64_t hst = h.hotcue(1, 35.5, 2, 1, 0.0);
    h.zyklen(std::llround(35.9 * SPB));
    const cdj::Ereignis* zs = h.letzter_zustand(1);
    PRUEF(h.quittung(hst, 2) && zs && zs->status == 1 && zs->quell_beat == 40.0);
    h.laden(1, "e9e9000000000001");
    h.zyklen(36 * SPB);
    const int64_t hn = h.hotcue(1, 38.0, 1, 1, 0.0);
    h.zyklen(39 * SPB);
    PRUEF(h.quittung(hn, 6));
  }

  // 5) /e/frist nach einem Sprung zurück (Plan-Review E9 Befund 3): ab Quell 50 von 64 sind alle Schwellen vorbei; ein
  //    Sprung um −48 (Quell ≈ 6, 58 Beats Rest) muss 32 und 16 wieder melden, wenn sie dann erreicht werden.
  {
    Lauf f;
    f.zyklen(10 * N);
    f.laden(1, "e9e9000000000001");
    f.zyklen(20 * N);
    f.fader(1, 0.0f, 2.0);
    f.start(1, 4.0, 50.0);
    f.zyklen(6 * SPB);
    const size_t vorher = f.frist.size();
    PRUEF(vorher == 0);                              // Start mit 15 Beats Rest: Schwellen gelten als vorbei, keine Meldung
    const int64_t fs1 = f.sprung(1, 8.0, -48.0, 1, 0.0);
    f.zyklen(60 * SPB);   // 32 fällt bei Master ≈ 35, 16 bei ≈ 51
    PRUEF(f.quittung(fs1, 2));
    bool f32 = false, f16 = false, f64 = false;
    for (const auto& e : f.frist) { f32 = f32 || e.beats_bis_ende == 32.0; f16 = f16 || e.beats_bis_ende == 16.0; f64 = f64 || e.beats_bis_ende == 64.0; }
    PRUEF(f32 && f16);                               // nach dem Sprung wieder erreicht und gemeldet
    PRUEF(!f64);                                     // 64 lag schon beim Sprung unterschritten (58 Rest): nicht melden
  }

  // 6) Loop (Plan E9 T12): 2 Beats ab 16 (Quell 8, 9): Takt-Eins alle 2 Beats, Status 3, kein Ende; aus bei 24 → linear,
  //    Status 2; ein Stopp im Loop hält das Deck an (Plan-Review Befund 1), ein Hotcue beendet den Loop.
  {
    Lauf l;
    l.zyklen(10 * N);
    l.laden(1, "e9e9000000000001");
    l.zyklen(20 * N);
    l.fader(1, 0.0f, 2.0);
    l.start(1, 8.0, 0.0);
    const int64_t lp = l.loop(1, 16.0, 2.0, 2, 1.0);
    l.zyklen(23 * SPB);
    PRUEF(l.quittung(lp, 2) && l.quittung(lp, 2)->sample == 16 * SPB);
    const float viertel = l.spitze(9 * SPB, 9 * SPB + 200);
    auto betont = [&](int bt) { return l.spitze(bt * SPB, bt * SPB + 200) > 1.8f * viertel; };
    PRUEF(betont(16) && betont(18) && betont(20) && betont(22));
    PRUEF(!betont(17) && !betont(19) && !betont(21));   // Negativ: die Zwischenschläge bleiben Viertel
    const cdj::Ereignis* z = l.letzter_zustand(1);
    PRUEF(z && z->status == 3 && std::isinf(z->beats_bis_ende) && z->quell_beat >= 8.0 && z->quell_beat < 10.0);
    const int64_t la = l.loop(1, 24.0, 0.0, 1, 0.0);
    l.zyklen(33 * SPB);
    z = l.letzter_zustand(1);
    PRUEF(l.quittung(la, 2) && z && z->status == 2 && z->quell_beat > 14.0);
    PRUEF(betont(24) && !betont(26) && betont(28) && betont(32));   // wieder alle 4 Beats
    // Stopp im Loop
    l.loop(1, 34.0, 1.0, 1, 0.0);
    const int64_t st = l.stopp(1, 36.5);
    l.zyklen(40 * SPB);
    z = l.letzter_zustand(1);
    PRUEF(l.quittung(st, 3) && z && z->status == 1);
    PRUEF(l.spitze(std::llround(37.0 * SPB), 40 * SPB) <= 1e-6f);
    // Hotcue beendet den Loop
    l.hotcue_setzen(1, 1, 4.0);
    l.start(1, 41.0, 20.0);
    l.loop(1, 42.0, 2.0, 1, 0.0);
    const int64_t hq = l.hotcue(1, 45.0, 1, 1, 0.0);
    l.zyklen(48 * SPB);
    z = l.letzter_zustand(1);
    PRUEF(l.quittung(hq, 2) && z && z->status == 2);
  }

  // 7) Abschluss-Review E9 F2: LOOP auf stehendem Deck, dann Play per Hand → der Loop läuft (Status 3); Pause und Play
  //    behalten ihn, CUE löscht ihn. F1: eine Transport-Taste verwirft wartende Sprünge dieses Decks (Quittung 7).
  {
    Lauf h;
    h.zyklen(10 * N);
    h.laden(1, "e9e9000000000001");
    h.zyklen(20 * N);
    h.fader(1, 0.0f, 2.0);
    const int64_t lp = h.loop(1, 4.0, 2.0, 1, 0.0);   // stehend am Cue-Punkt (Quell 0): Loop [0, 2)
    h.zyklen(5 * SPB);
    PRUEF(h.quittung(lp, 2) && h.letzter_zustand(1)->status == 1);
    h.test_hand("deck/1/play", 1.0f, 6 * SPB);
    h.zyklen(12 * SPB);
    const cdj::Ereignis* z = h.letzter_zustand(1);
    PRUEF(z && z->status == 3 && z->quell_beat < 2.0);   // läuft im Loop
    h.test_hand("deck/1/play", 1.0f, 12 * SPB);          // Pause
    h.zyklen(14 * SPB);
    PRUEF(h.letzter_zustand(1)->status == 1);
    h.test_hand("deck/1/play", 1.0f, 14 * SPB);          // weiter: der Loop ist noch da
    h.zyklen(20 * SPB);
    z = h.letzter_zustand(1);
    PRUEF(z && z->status == 3 && z->quell_beat < 2.0);
    // F1: wartender Sprung (Ziel Beat 28), Pause per Hand bei 21 → der Sprung wird verworfen
    const int64_t sp = h.sprung(1, 28.0, 8.0, 1, 0.0);
    h.zyklen(21 * SPB);
    h.test_hand("deck/1/play", 1.0f, 21 * SPB);
    h.zyklen(30 * SPB);
    PRUEF(h.quittung(sp, 7) && h.quittung(sp, 7)->grund == "abbruch" && !h.quittung(sp, 2));
    // CUE löscht den Loop: danach Play → Status 2
    h.test_hand("deck/1/cue", 1.0f, 30 * SPB);
    h.zyklen(31 * SPB);
    h.test_hand("deck/1/cue", 0.0f, 31 * SPB);
    h.zyklen(32 * SPB);
    h.test_hand("deck/1/play", 1.0f, 32 * SPB);
    h.zyklen(38 * SPB);
    z = h.letzter_zustand(1);
    PRUEF(z && z->status == 2 && z->quell_beat > 3.0);
  }

  // 8) Review E9 F9: Neustart-Abbild ohne E9-Teile (sonst würden sie als Stopp wiederhergestellt); Frist nach Hotcue
  {
    Lauf n;
    n.zyklen(10 * N);
    n.laden(1, "e9e9000000000001");
    n.zyklen(20 * N);
    n.fader(1, 0.0f, 2.0);
    n.start(1, 4.0, 50.0);                             // Quell 50 von 64: alle Frist-Schwellen gelten als vorbei
    n.hotcue_setzen(1, 1, 2.0);
    const int64_t st = n.stopp(1, 60.0);               // wartender Stopp (gehört ins Abbild)
    const int64_t sp = n.sprung(1, 40.0, 4.0, 1, 0.0); // wartender Sprung (gehört nicht hinein)
    n.zyklen(6 * SPB);
    auto f = std::make_unique<cdj_z_echtzeit>();
    n.kern->abbild(*f);
    int stopps = 0, andere = 0;
    for (int i = 0; i < f->n_befehle; ++i) {
      if (f->befehle[i].id == st && f->befehle[i].art == CDJ_Z_ART_DECK_STOPP) ++stopps;
      if (f->befehle[i].id == sp) ++andere;
    }
    PRUEF(stopps == 1 && andere == 0);
    // Frist nach Hotcue: zurück auf Quell 2 → 32 und 16 fallen später wieder und werden gemeldet
    const size_t f0 = n.frist.size();
    const int64_t hq = n.hotcue(1, 8.0, 1, 1, 0.0);
    n.zyklen(58 * SPB);
    PRUEF(n.quittung(hq, 2));
    bool f32 = false, f16 = false;
    for (size_t i = f0; i < n.frist.size(); ++i) { f32 = f32 || n.frist[i].beats_bis_ende == 32.0; f16 = f16 || n.frist[i].beats_bis_ende == 16.0; }
    PRUEF(f32 && f16);
  }

  // 9) Audit 2026-10-01 F09 (Paket „Nie still"): ein Sprung im Loop darf den Loop nicht aus dem Material schieben (sonst
  //    läuft das Deck mit Status 3 endlos still), ein Loop nicht über das Material hinaus angelegt werden: beides
  //    Quittung 6 ausserhalb_bereich, das Deck klingt weiter. Negativ-Kontrolle: Sprung +2 im Loop bleibt erlaubt.
  {
    Lauf s;
    s.zyklen(10 * N);
    s.laden(1, "e9e9000000000001");   // 64 Beats
    s.zyklen(20 * N);
    s.fader(1, 0.0f, 2.0);
    s.start(1, 8.0, 0.0);
    s.loop(1, 16.0, 2.0, 2, 1.0);     // Loop [8, 10) in Quell-Beats
    const int64_t ok = s.sprung(1, 20.0, 2.0, 1, 0.0);
    const int64_t weit = s.sprung(1, 24.0, 100.0, 1, 0.0);
    s.zyklen(32 * SPB);
    PRUEF(s.quittung(ok, 2));
    PRUEF(s.quittung(weit, 6) && s.quittung(weit, 6)->grund == "ausserhalb_bereich");
    PRUEF(s.spitze(28 * SPB, 32 * SPB) > 0.05f);  // klingt weiter im Loop (Quell 10..12, unbetont 0,13; still wäre 0)
    // Loop über das Ende: Quell ≈ 60 bei Beat 36, 8 Beats bis 68 > 64
    const int64_t lp_aus = s.loop(1, 34.0, 0.0, 1, 0.0);
    const int64_t st = s.start(1, 36.0, 60.0);
    const int64_t lang = s.loop(1, 37.0, 8.0, 1, 0.0);
    s.zyklen(38 * SPB);
    PRUEF(s.quittung(lp_aus, 2) && s.quittung(st, 2));
    PRUEF(s.quittung(lang, 6) && s.quittung(lang, 6)->grund == "ausserhalb_bereich");
  }

  fs::remove_all(AB);
  PRUEF_ENDE();
}
