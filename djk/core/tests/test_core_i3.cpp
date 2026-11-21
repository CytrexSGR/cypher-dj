// Ohr T14: Prüfer im Kern, am echten Kern belegt (INTERFACES §17 I3a, §4.5). Aufbau aus test_core_deck.cpp (Lauf
// mit Lader im selben Faden). Deck 2 geladen (nicht gestartet: Öffnen prüft I3a am Regler deck/2/fader, unabhängig
// davon, ob das Deck läuft, wie test_core_part.cpp). Quelle cypher öffnet ohne Hörschein -> Quittung 6
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

#include "cypherdj/core.h"
#include "check.h"

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
  const std::string c = "python3 " + DJK + "/core/tests/deck/click_rendition.py --ziel " + AB + " " + args + " > /dev/null";
  PRUEF(std::system(c.c_str()) == 0);
}

struct Q {
  int64_t id;
  int32_t status;
  int64_t sample;
  std::string grund;
};

// Ein Kern mit Lader im selben Faden (wie test_core_deck.cpp Lauf), dazu /k/hoerschein und /k/hoerschein/weg.
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
  // dauer > 0: a ramp of that many beats (S curve), 0 = set
  int64_t fader(int deck, float db, double ab, const char* quelle, const char* hs = "", double dauer = 0.0) {
    cdj::Befehl b = neu(cdj::Befehl::TEIL, quelle);
    // K9: the strips are the four containers; the players 3 and 4 sound through pad/1 and pad/2 (deck/3, deck/4 have no rows)
    if (deck <= 2) std::snprintf(b.pfad, sizeof b.pfad, "deck/%d/fader", deck);
    else std::snprintf(b.pfad, sizeof b.pfad, "pad/%d/fader", deck - 2);
    b.ab_beat = ab;
    b.dauer_beats = dauer;
    b.form = dauer > 0.0 ? 1 : 0;
    b.wert = db;
    b.politik = 1;
    std::snprintf(b.hoerschein, sizeof b.hoerschein, "%s", hs);
    return sende(b);
  }
  // /k/teil on any regler path with plan and coupling group (a ramp when dauer > 0)
  int64_t teil(const char* pfad, float wert, double ab, const char* quelle, const char* plan, int nr, const char* gruppe, double dauer = 0.0) {
    cdj::Befehl b = neu(cdj::Befehl::TEIL, quelle);
    std::snprintf(b.pfad, sizeof b.pfad, "%s", pfad);
    std::snprintf(b.plan, sizeof b.plan, "%s", plan);
    std::snprintf(b.gruppe, sizeof b.gruppe, "%s", gruppe);
    b.nr = nr;
    b.ab_beat = ab;
    b.dauer_beats = dauer;
    b.form = dauer > 0.0 ? 1 : 0;
    b.wert = wert;
    b.politik = 1;
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
  // /k/container/quelle: container nr 1..4 (A..D) takes art 0 leer, 1 player, 2 modul
  int64_t container(int nr, int art) {
    cdj::Befehl b = neu(cdj::Befehl::CONTAINER_QUELLE, "andreas");
    b.nr = nr;
    b.an = art;
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

  // Andreas 2026-11-18 (SEQ deck): a deck channel with nothing loaded is free for I3a; a loaded track keeps the lock.
  const auto wert = [&](const char* pfad) { return a.kern->stellwerk().wert(a.kern->stellwerk().tabelle().suche(pfad)); };
  // e) deck 3 was never loaded (the real adapter Kern::DeckModellImpl::inhalt reports "empty"): cypher opens it without a pass
  PRUEF(!a.kern->deck(3).geladen());
  const int64_t t6 = a.fader(3, 0.0f, 110.0, "cypher");
  a.zyklen(114 * SPB);
  PRUEF(a.quittung(t6, 2));
  PRUEF(!a.quittung(t6, 6));
  PRUEF_NAH(wert("pad/1/fader"), 0.0, 1e-3);
  PRUEF_NAH(wert("deck/2/fader"), -200.0, 1e-6);   // the loaded deck 2 stays closed

  // f) a part queued on the EMPTY deck 4 for a later beat, the track arrives before that beat: I3a is evaluated at the part START, with deck 4 then
  //    loaded and no pass -> Quittung 6 kein_hoerschein, the fader stays closed (the load itself sets -200)
  const int64_t t7 = a.fader(4, 0.0f, 130.0, "cypher");
  a.zyklen(116 * SPB);
  PRUEF(a.quittung(t7, 1));
  const int64_t l4 = a.laden(4, MID);
  a.zyklen(122 * SPB);
  PRUEF(a.quittung(l4, 3));
  a.zyklen(134 * SPB);
  const Q* q7 = a.quittung(t7, 6);
  PRUEF(q7 && q7->grund == "kein_hoerschein");
  PRUEF(!a.quittung(t7, 2));
  PRUEF_NAH(wert("pad/2/fader"), -200.0, 1e-6);

  // g) a RAMP of cypher on the empty deck 1 (-200 -> 0 over 16 beats, started under the exemption), the track arrives in the middle of the ramp.
  //    The load writes -200 once and ends the running part of cypher on that fader (Stellwerk::cypher_fahrt_beenden): the ramp must not drive the
  //    fader up again (before that change it rose back to 0 dB without a pass: -40.96 dB mid-ramp, 0.00 dB afterwards)
  const int64_t t8 = a.fader(1, 0.0f, 140.0, "cypher", "", 16.0);
  a.zyklen(146 * SPB);
  PRUEF(a.quittung(t8, 2));
  const double mitte = wert("deck/1/fader");
  PRUEF(mitte > -200.0 && mitte < 0.0);   // the ramp is running and has moved
  const int64_t l1 = a.laden(1, MID);
  a.zyklen(a.kern->sample() + 64 * 256);
  PRUEF(a.quittung(l1, 3));
  const double nach_laden = wert("deck/1/fader");
  double hoechster = nach_laden;
  while (a.kern->sample() < 162 * SPB) {   // the ramp would end at beat 156
    a.zyklen(a.kern->sample() + 256);
    if (wert("deck/1/fader") > hoechster) hoechster = wert("deck/1/fader");
  }
  std::printf("kern case g: fader mid-ramp %.2f dB, after the load %.2f dB, highest afterwards %.2f dB, at beat 162 %.2f dB\n", mitte, nach_laden,
              hoechster, wert("deck/1/fader"));
  PRUEF_NAH(nach_laden, -200.0, 1e-6);
  PRUEF_NAH(hoechster, -200.0, 1e-6);
  PRUEF_NAH(wert("deck/1/fader"), -200.0, 1e-6);
  PRUEF(a.quittung(t8, 7));   // the part, started before the load, ended by it (abbruch)

  // h) 2026-11-19 (review of seq-fader-frei): the load ends the RUNNING parts of EVERY source but andreas on that fader, and nothing else. Deck 3 is
  //    still empty (open at 0 dB since case d). A ramp of leitstand (not cypher) on pad/1/fader (player 3), 0 -> -100 over 16 beats, is running when a track
  //    arrives. Its coupling-group mate on pad/1/fader (same plan and group, a longer ramp) ends with it (a group falls together), and a
  //    running part of andreas on another regler of the deck (pad/1/trim) is spared.
  const int64_t h1 = a.teil("pad/1/fader", -100.0f, 170.0, "leitstand", "ph", 0, "gh", 16.0);
  const int64_t h2 = a.teil("pad/2/fader", -100.0f, 170.0, "leitstand", "ph", 1, "gh", 64.0);
  const int64_t h3 = a.teil("pad/1/trim", -10.0f, 170.0, "andreas", "pa", 0, "", 16.0);
  a.zyklen(174 * SPB);
  PRUEF(a.quittung(h1, 2) && a.quittung(h2, 2) && a.quittung(h3, 2));
  const double h_mitte = wert("pad/1/fader");
  PRUEF(h_mitte < 0.0 && h_mitte > -100.0);   // the ramp is running
  const int64_t l3 = a.laden(3, MID);
  a.zyklen(a.kern->sample() + 64 * 256);
  PRUEF(a.quittung(l3, 3));
  const Q* qh1 = a.quittung(h1, 7);
  PRUEF(qh1 && qh1->grund == "abbruch");   // the leitstand part on that fader ended
  PRUEF(a.quittung(h2, 7));                // the group mate on another fader ends with it
  PRUEF(!a.quittung(h3, 7));               // andreas is spared
  double h_hoechst = wert("pad/1/fader");
  while (a.kern->sample() < 190 * SPB) {
    a.zyklen(a.kern->sample() + 256);
    if (wert("pad/1/fader") > h_hoechst) h_hoechst = wert("pad/1/fader");
  }
  PRUEF_NAH(h_hoechst, -200.0, 1e-6);   // the fader stayed closed

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

  // K8 review F-B and F-C, on the real kernel: container C (pad/1) with the player 3 behind it.
  //   i)   art player: the key of the pass is the player name (deck/3), not the container path; without a pass cypher is refused on pad/1
  //   ii)  art modul: the strip is free (the player is not heard), cypher opens pad/1 without a pass, the track of player 3 stays loaded
  //   iii) the switch back to player counts like a fresh load on an open channel: it closes the strip, so the track never meets an open fader
  //   iv)  art leer: free again
  {
    Lauf c;
    c.zyklen(10 * 256);
    c.kern->hoerschein_pflicht(true);
    const int64_t l3c = c.laden(3, MID);
    c.zyklen(c.kern->sample() + 40 * 256);
    PRUEF(c.quittung(l3c, 3));
    const auto cw = [&](const char* pfad) { return c.kern->stellwerk().wert(c.kern->stellwerk().tabelle().suche(pfad)); };
    const auto in = [&](double beats) { return static_cast<double>(c.kern->sample()) / static_cast<double>(SPB) + beats; };
    const auto bis = [&](double beat) { c.zyklen(static_cast<int64_t>(beat * static_cast<double>(SPB))); };
    PRUEF(c.kern->container_art(2) == cdj::Kern::CONTAINER_ART_PLAYER);
    // i)
    const int64_t i1 = c.teil("pad/1/fader", 0.0f, in(2.0), "cypher", "", 0, "");
    bis(in(4.0));
    const Q* qi1 = c.quittung(i1, 6);
    PRUEF(qi1 && qi1->grund == "kein_hoerschein");
    PRUEF_NAH(cw("pad/1/fader"), -200.0, 1e-6);
    c.hoerschein("hc", "deck/3", MID, 128.0, 1, 1000.0);
    bis(in(2.0));
    {   // the pass is named after the player (deck/3), the request is on the container strip pad/1
      cdj::Befehl b = c.neu(cdj::Befehl::TEIL, "cypher");
      std::snprintf(b.pfad, sizeof b.pfad, "pad/1/fader");
      b.ab_beat = in(2.0);
      b.wert = 0.0f;
      b.politik = 1;
      std::snprintf(b.hoerschein, sizeof b.hoerschein, "hc");
      c.sende(b);
      bis(in(4.0));
      PRUEF(c.quittung(b.id, 2));
      PRUEF_NAH(cw("pad/1/fader"), 0.0, 1e-3);
    }
    c.teil("pad/1/fader", -200.0f, in(1.0), "andreas", "", 0, "");
    bis(in(3.0));
    PRUEF_NAH(cw("pad/1/fader"), -200.0, 1e-6);
    // ii) container C takes a module
    c.container(3, cdj::Kern::CONTAINER_ART_MODUL);
    bis(in(2.0));
    PRUEF(c.kern->container_art(2) == cdj::Kern::CONTAINER_ART_MODUL);
    c.hoerschein_weg("hc");
    bis(in(2.0));
    const int64_t m1 = c.teil("pad/1/fader", 0.0f, in(2.0), "cypher", "", 0, "");
    bis(in(4.0));
    PRUEF(c.quittung(m1, 2));
    PRUEF(!c.quittung(m1, 6));
    PRUEF_NAH(cw("pad/1/fader"), 0.0, 1e-3);
    // iii) back to player with the track still in player 3 and the fader open: the strip closes, no pass was given
    c.container(3, cdj::Kern::CONTAINER_ART_PLAYER);
    bis(in(3.0));
    PRUEF(c.kern->container_art(2) == cdj::Kern::CONTAINER_ART_PLAYER);
    std::printf("kern case iii: pad/1/fader after the switch to player %.2f dB\n", cw("pad/1/fader"));
    PRUEF_NAH(cw("pad/1/fader"), -200.0, 1e-6);
    // iv) container C takes nothing
    c.container(3, cdj::Kern::CONTAINER_ART_LEER);
    bis(in(2.0));
    const int64_t n1 = c.teil("pad/1/fader", 0.0f, in(2.0), "cypher", "", 0, "");
    bis(in(4.0));
    PRUEF(c.quittung(n1, 2));
    PRUEF_NAH(cw("pad/1/fader"), 0.0, 1e-3);
  }

  std::printf("test_kern_i3: alle Fälle wie erwartet (a kein_hoerschein, b gestartet, c andreas gestartet, "
              "d wieder kein_hoerschein, Negativ-Kontrolle gestartet)\n");
  PRUEF_ENDE();   // the file used to end with "return 0": failed checks were silent
}
