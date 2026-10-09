// Keylock Task 2.5 (Plan docs/superpowers/plans/2026-10-06-keylock-echtzeit.md, Fassung 4.1 Punkt 2; Übergabe-Vertrag 3,
// 5, 12, 14, 18): die Fäden im Kern. Der Kern fährt Vorbereiter, je Deck einen Arbeits-Thread und den Wächter selbst
// (Kern::keylock_faeden_starten). Der Test spielt nur den Callback, ohne JACK, als Schleife im 5,33-ms-Takt
// (clock_nanosleep auf absolute Zeitpunkte, 256 Samples je Zyklus), und einen Lade-Faden (Lader::laufen).
//
// Tests (Aufruf ohne Argument: alle; mit Namen nur einer, z. B. `test_kern_keylock_faeden quittung`):
//   rampe     4 Decks laufen im Keylock, Rampe 128 -> 132 über 8 Beats: Ring hörbar je Deck, Tonhöhe je 100-ms-Fenster
//             ±2 ct (Sinus links), Lage je Klick (Klick rechts) Mittel (seit 4.6 ausgewiesen) und je Klick ±12 gegen das Soll, die Kette des
//             Kerns per Bezug herausgerechnet (derselbe Kern synchron ohne Keylock, wie test_deck_keylock Test 8).
//             Zwei Läufe: der Master hört Deck 1 bzw. 3, der Cue (PFL) Deck 2 bzw. 4; alle vier rechnen in jedem Lauf.
//             Unterläufe je Deck gezählt und ausgewiesen.
//   quittung  Fassung 4.1 Punkt 2 (Pflicht aus der Nachprüfung, N3): nach Spielen und Stopp, bei STEHENDEM Deck, bekommen
//             Entladen, Laden und Tausch ihre Quittung binnen 2 s, und alles Material kommt zurück (gesperrt 0).
//             Vertrag 18: im Stand ruht der R3 (der Ring bekommt keinen Frame mehr), beim Spielen läuft er.
//   waechter  gesunder Lauf: keine Meldung; Arbeits-Thread von Deck 1 angehalten (keylock_test_halte): Meldung nach
//             500 ms, danach (wieder frei) Quittung und keine weitere Meldung.
//   stopp     Herunterfahren mit laufenden Fäden (4 Decks spielen) binnen 2 s, gemessen (TimeoutStopSec 2 s).
//   prio      Vertrag 12: ohne Aufruf (ohne JACK) SCHED_OTHER; mit Recht SCHED_FIFO = JACK-Priorität − 5; ohne Recht
//             (RLIMIT_RTPRIO 0) gemeldet und gezählt, die Fäden laufen mit SCHED_OTHER weiter (der Ring klingt).
//   startfehler  2.5b (Prüfung F1): Faden nicht anlegbar -> Keylock wirklich aus, Varispeed, alle Quittungen, nichts gesperrt.
//   spaet     2.5b (F2): Betriebsweg, Bau während das Deck schon spielt: Varispeed lückenlos, danach Ring.
//   neustart  2.5b (F2): Zeit bis zum ersten Zyklus nach einem Neustart (ohne, Stand 2.5, Betriebsweg); bitgleich bis zum
//             Anhängen.
//   knopf     Task 3 (Fassung 4): globaler Regler keylock zur Laufzeit, laufendes Deck, Rampe: aus -> Varispeed (bitgleich
//             zum Kern ohne Keylock), an -> Ansatz am Sample, Ring nach s_h; die Loop-Boxen folgen dem Knopf.
//   loop      Task 5: Loop auf dem Deck (/k/deck/loop, 4 Beats bei 132), an und aus: im Loop der Ring über die Nähte, ±2 ct,
//             Klick am Loop-Anfang je Durchlauf ±12 gegen das Soll aus Karte und Loop; Fehlerfall LOOP_LEER -> loop rot.
//   box       Task 7 (K1): Loop-Box mit Dehner und echten Fäden (8 Fäden, 7 SCHED_FIFO, siehe prio): Ring der Box hörbar,
//             ±2 ct; Arbeits-Thread der Box angehalten -> Wächter meldet, der abgelöste Loop bleibt verliehen; nach
//             keylock_faeden_stoppen kommt er heraus (kein Faden liest mehr).
// Fehlerfälle (CMake kern_keylock_faeden_mutation, WILL_FAIL): FUELLE_NUR_LAUFEND (der Arbeits-Thread füllt nur bei
// spielendem Deck: Pflicht verletzt) -> quittung rot; OHNE_WAECHTER -> waechter rot; FADEN_HAELT (Arbeits-Thread von
// Deck 1 hält nach rund 1 s an) -> waechter rot; STOPP_OHNE_WECKEN -> stopp rot; PRIO_STILL -> prio rot;
// VORGABE_VOR_FAEDEN (Stand 2.5: Dehner gestellt, obwohl kein Faden lief) -> startfehler rot; SPAET_OHNE_ANSATZ (ein
// laufendes Deck setzt beim späten Anhängen nicht an) -> spaet rot.
#include <pthread.h>
#include <sched.h>
#include <sys/mman.h>
#include <sys/resource.h>
#include <time.h>
#include <unistd.h>

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <functional>
#include <memory>
#include <string>
#include <thread>
#include <vector>

#include "keylock_mess.h"
#include "cypherdj/kern.h"
#include "cypherdj/konfig.h"
#include "cypherdj/lader.h"
#include "cypherdj/neustart.h"
#include "cypherdj/zustand.h"
#include "pruef.h"

namespace {

namespace fs = std::filesystem;
using cdj::DehnerAnker;
using cdj::Karte;
using km::B;
using km::PI;

constexpr const char* MAT = "c1c0000000002501";  // Sinus 1000 Hz links, Klick rechts, Basis 128 (+ Fassung 132)
constexpr const char* MAT_B = "c1c0000000002502";  // Klick, Basis 128
std::string AB;

int test_fehler_vorher = 0;
void ergebnis(const char* name) {
  std::printf("TEST %s: %s\n", name, pruef_fehler == test_fehler_vorher ? "gruen" : "ROT");
  std::fflush(stdout);
  test_fehler_vorher = pruef_fehler;
}

int64_t jetzt_ns() {
  timespec t;
  clock_gettime(CLOCK_MONOTONIC, &t);
  return (int64_t)t.tv_sec * 1000000000LL + t.tv_nsec;
}

struct KRing {
  std::unique_ptr<unsigned char[]> mem{new unsigned char[CDJ_RING_BYTES]()};
  cdj_ring_kopf* k = reinterpret_cast<cdj_ring_kopf*>(mem.get());
  KRing() {
    k->version = CDJ_RING_VERSION;
    k->rate = CDJ_RING_RATE;
    k->kanaele = CDJ_RING_KANAELE;
    k->cap = CDJ_RING_CAP;
    std::memcpy(k->magic, "CDJB", 4);
  }
};

struct Q {
  int64_t id;
  int32_t status;
  int64_t sample;
};

// Ein Kern. echt: Fäden des Kerns, Callback im 5,33-ms-Takt, Lader im eigenen Faden. Sonst synchron ohne Takt (Bezug).
// Alles hier (Zyklus, Befehle, Ereignisse, Deck-Diagnose) läuft in EINEM Faden, dem „Callback“ des Tests.
// Wie der Kern zum Keylock kommt. BETRIEB: der Weg von main.cpp (keylock_ankuendigen, dann keylock_bauen, hier
// synchron vor dem ersten Zyklus); ANGEKUENDIGT: nur angekündigt, der Test baut selbst (auch während Zyklen laufen);
// ALT: setze_keylock_vorgabe(true) synchron im Startpfad (Stand 2.5, nur zum Messen der Startzeit, ohne Fäden); OHNE.
enum class Weg { OHNE, BETRIEB, ANGEKUENDIGT, ALT };

struct Lauf {
  std::unique_ptr<KRing> eigener_ring{new KRing()};
  KRing& ring;
  std::unique_ptr<cdj::Befehlsring> bef{new cdj::Befehlsring()};
  std::unique_ptr<cdj::Ereignisring> ere{new cdj::Ereignisring()};
  std::unique_ptr<cdj::LaderRinge> lr{new cdj::LaderRinge()};
  cdj::Lader lader;
  std::unique_ptr<cdj::Kern> kern;
  bool echt;
  std::atomic<bool> lader_stop{false};
  std::thread lader_faden;
  std::vector<float> ch[4];  // Master L, R, Cue L, R je Kern-Sample (um den Vorhalt des Limiters zurückgerechnet)
  std::vector<Q> q;
  std::vector<std::pair<int64_t, float>> knopf_regler;  // Task 3: /e/regler keylock (Sample, Wert)
  int32_t uhr_keylock_aus = -1;                          // Task 3: zuletzt in /uhr (Ereignis::keylock_aus)
  int32_t deck1_unterlauf = -1, deck1_aufgegeben = -1;   // Task 3b: zuletzt im DECK-Ereignis von Deck 1
  std::vector<const void*> loop_alt;                     // Task 7: Loops, die der Kern über LOOP_ALT zurückgab
  int64_t id = 100;
  int64_t t0 = 0, zyklen = 0, spaet = 0, cb_max_ns = 0;
  std::function<void()> je_zyklus;  // nach jedem Zyklus (im selben Faden)
  std::unique_ptr<cdj::Betrieb> betrieb;  // Neustart-Zustand (wie test_deck_keylock Test 8)
  int64_t W = 0;                          // Treiber-Frames (Betrieb::zyklus_anfang)
  int64_t t_anfang = 0, t_erster = 0;     // ns: Konstruktor begonnen, erster Zyklus beginnt
  Lauf(Weg weg, bool echt_, KRing* r = nullptr, int64_t w0 = 0)
      : ring(r ? *r : *eigener_ring), lader(AB, 3800LL << 20), echt(echt_), W(w0) {
    t_anfang = jetzt_ns();
    kern.reset(new cdj::Kern(128.0, ring.k, bef.get(), ere.get()));
    kern->verbinde_lader(lr.get());
    if (weg == Weg::BETRIEB || weg == Weg::ANGEKUENDIGT) PRUEF(kern->keylock_ankuendigen());
    if (weg == Weg::BETRIEB) PRUEF(kern->keylock_bauen(0));
    if (weg == Weg::ALT) PRUEF(kern->setze_keylock_vorgabe(true));
    for (auto& c : ch) c.reserve(48000 * 40);
  }
  Lauf(bool keylock, bool echt_) : Lauf(keylock ? Weg::BETRIEB : Weg::OHNE, echt_) {}
  ~Lauf() {
    lader_stop = true;
    if (lader_faden.joinable()) lader_faden.join();
  }
  // Quelle pruefstand: der Test gibt sich nicht als Andreas' Hand aus (Ausnahme PFL, siehe rampe_befehle)
  cdj::Befehl neu(int art, const char* quelle = "pruefstand") {
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
  int64_t laden(int d, const char* mid) {
    cdj::Befehl b = neu(cdj::Befehl::DECK_LADEN, "leitstand");
    b.deck = d;
    std::snprintf(b.material_id, sizeof b.material_id, "%s", mid);
    b.bpm = 128.0;
    b.fassung = 1;
    return sende(b);
  }
  int64_t entladen(int d) {
    cdj::Befehl b = neu(cdj::Befehl::DECK_ENTLADEN, "leitstand");
    b.deck = d;
    return sende(b);
  }
  int64_t tausch(int d, double bpm, double ab) {
    cdj::Befehl b = neu(cdj::Befehl::DECK_TAUSCH, "werkstatt");
    b.deck = d;
    b.bpm = bpm;
    b.fassung = 1;
    b.ab_beat = ab;
    return sende(b);
  }
  int64_t start(int d, double ab, double quell) {
    cdj::Befehl b = neu(cdj::Befehl::DECK_START);
    b.deck = d;
    b.ab_beat = ab;
    b.quell_beat = quell;
    return sende(b);
  }
  int64_t stopp(int d, double ab) {
    cdj::Befehl b = neu(cdj::Befehl::DECK_STOPP);
    b.deck = d;
    b.ab_beat = ab;
    b.politik = 1;
    return sende(b);
  }
  int64_t teil(const char* pfad, float wert, double ab, const char* quelle = "pruefstand") {
    cdj::Befehl b = neu(cdj::Befehl::TEIL, quelle);
    std::snprintf(b.pfad, sizeof b.pfad, "%s", pfad);
    b.ab_beat = ab;
    b.wert = wert;
    b.politik = 1;
    return sende(b);
  }
  int64_t rampe(double ab, double ziel, double dauer) {
    cdj::Befehl b = neu(cdj::Befehl::TEMPO_RAMPE);
    b.ab_beat = ab;
    b.ziel_bpm = ziel;
    b.dauer_beats = dauer;
    return sende(b);
  }
  double beat() const { return kern->karte().beat_at((double)kern->sample()); }
  // Karte auf 132: bei Basis 128 klingt der Direktweg, nicht der Ring (Architektur 7); vor dem ersten Zyklus aufrufen
  void auf_132() { rampe(0.25, 132.0, 0.5); }
  void zyklus() {
    if (zyklen == 0) t_erster = jetzt_ns();
    if (echt && !lader_faden.joinable()) lader_faden = std::thread([this] { lader.laufen(*lr, lader_stop); });
    if (echt) {
      if (zyklen == 0) t0 = jetzt_ns();
      const int64_t ziel = t0 + (int64_t)std::llround((double)zyklen * B * 1e9 / 48000.0);
      timespec t{(time_t)(ziel / 1000000000LL), (long)(ziel % 1000000000LL)};
      while (clock_nanosleep(CLOCK_MONOTONIC, TIMER_ABSTIME, &t, nullptr) != 0) {}
      if (jetzt_ns() > ziel + (int64_t)(B * 1e9 / 48000.0)) ++spaet;  // eine Periode zu spät aufgewacht
    }
    const int64_t n0 = kern->sample();
    const uint64_t w0 = cdj_lade(&ring.k->w);
    const uint32_t F = (uint32_t)W;
    const int64_t mono = (int64_t)std::llround((double)W * 1e9 / 48000.0);
    if (betrieb) betrieb->zyklus_anfang(F, mono, *kern);
    const int64_t a = jetzt_ns();
    kern->zyklus(B, mono);
    cb_max_ns = std::max(cb_max_ns, jetzt_ns() - a);
    if (betrieb) betrieb->zyklus_ende(F, mono, B, *kern);
    W += B;
    ++zyklen;
    if (!echt) lader.einmal(*lr);
    const float* x = cdj_ring_daten_c(ring.k);
    const int vh = kern->mixer().limiter_vorhalt();
    for (auto& c : ch)
      if ((int64_t)c.size() < n0 + B) c.resize((size_t)(n0 + B), 0.0f);
    for (int i = 0; i < B; ++i)
      if (n0 + i - vh >= 0)
        for (int c = 0; c < 4; ++c) ch[c][(size_t)(n0 + i - vh)] = x[((w0 + (uint64_t)i) % CDJ_RING_CAP) * 4 + c];
    cdj::Ereignis e;
    while (ere->hole(e)) {
      if (e.art == cdj::Ereignis::QUITTUNG) q.push_back({e.id, e.status, e.sample});
      if (e.art == cdj::Ereignis::REGLER && !std::strcmp(e.pfad, "keylock")) knopf_regler.push_back({e.sample, e.wert});  // Task 3
      if (e.art == cdj::Ereignis::UHR) uhr_keylock_aus = e.keylock_aus;
      if (e.art == cdj::Ereignis::LOOP_ALT) loop_alt.push_back(e.zeiger);  // Task 7
      if (e.art == cdj::Ereignis::DECK && e.deck == 1) {  // Task 3b: Zähler aus /zustand/deck (Kern-Ereignis)
        deck1_unterlauf = e.keylock_unterlauf;
        deck1_aufgegeben = e.keylock_aufgegeben;
      }
    }
    if (je_zyklus) je_zyklus();
  }
  void bis(int64_t s) {
    while (kern->sample() < s) zyklus();
  }
  void sekunden(double t) { bis(kern->sample() + (int64_t)(t * 48000.0)); }
  const Q* quittung(int64_t i, int32_t st) const {
    for (const Q& x : q)
      if (x.id == i && x.status == st) return &x;
    return nullptr;
  }
  // Zyklen, bis die Quittung da ist oder frist_s Kern-Zeit vergangen ist. Rückgabe: Kern-Zeit bis zur Quittung in ms, −1 ohne.
  double warte(int64_t i, int32_t st, double frist_s) {
    const int64_t s0 = kern->sample(), ende = s0 + (int64_t)(frist_s * 48000.0);
    while (!quittung(i, st) && kern->sample() < ende) zyklus();
    return quittung(i, st) ? (double)(kern->sample() - s0) / 48.0 : -1.0;
  }
};

void klick(const std::string& args) {
  const std::string c = "/usr/bin/python3 " + std::string(CYPHERDJ_DJK) + "/kern/tests/deck/klick_fassung.py --ziel " + AB +
                        " " + args + " > /dev/null";
  PRUEF(std::system(c.c_str()) == 0);
}

// Tonhöhe je 100-ms-Fenster in [a, b) gegen 1000 Hz; Null-Läufe >= 32 exakte Nullen (wie test_deck_keylock).
// Keylock 4.6: klick (der andere Kanal desselben Materials, Klick rechts) gesetzt: Fenster, in denen dort ±512 Samples um das
// Fenster ein Klick liegt (|x| > 0,01), zählen getrennt (k_fenster, k_max_ct) und nicht als „über 2 ct“. R3 rechnet die
// Kanäle zusammen; der Klick rechts stört den Sinus links für einige Millisekunden (am Ziel: 1 von 288 Fenstern 17,4 ct, ein
// 10-ms-Stück 182 ct, Phase davor und danach gleich, task-04/BERICHT.md Bedenken 1). Mit Versatz 0 trifft die Störung hier
// ein Messfenster (17,40 ct in knopf und loop, task-04/v46/ctest1_tests_unveraendert.txt); vorher lag sie zufällig daneben.
// Die Tonhöhe ohne Klick daneben prüfen test_dehner Test 3 und test_deck_keylock Test 1 (reiner Sinus).
// Lose Grenze für diese Fenster (4.6b): höchstens 25 ct (gemessen 17,40; ein Varispeed-Fehler läge bei 53).
struct Ton {
  double max_ct = 0, k_max_ct = 0;
  int fenster = 0, ueber = 0, null_laeufe = 0, k_fenster = 0;
};
Ton ton_messen(const std::vector<float>& x, int64_t a, int64_t b, const char* name,
               const std::vector<float>* klick = nullptr) {
  Ton t;
  for (int64_t s = a; s + 4800 <= b; s += 4800) {
    const double ct = 1200.0 * std::log2(km::freq(x, s, s + 4800) / 1000.0);
    bool mit_klick = false;
    if (klick)
      for (int64_t i = std::max<int64_t>(s - 512, 0); i < s + 4800 + 512 && i < (int64_t)klick->size() && !mit_klick; ++i)
        mit_klick = std::fabs((*klick)[(size_t)i]) > 0.01f;
    if (mit_klick) {
      ++t.k_fenster;
      t.k_max_ct = std::max(t.k_max_ct, std::fabs(ct));
      continue;
    }
    t.max_ct = std::max(t.max_ct, std::fabs(ct));
    if (std::fabs(ct) > 2.0) {
      ++t.ueber;
      if (t.ueber <= 5) std::printf("    %s: Fenster ab %lld: %+.3f ct\n", name, (long long)s, ct);
    }
    ++t.fenster;
  }
  if (klick) std::printf("    %s: %d Fenster mit Klick daneben (ausgewiesen), max %.3f ct\n", name, t.k_fenster, t.k_max_ct);
  int lauf = 0;
  for (int64_t s = a; s < b; ++s) {
    if (x[(size_t)s] == 0.0f) {
      if (++lauf == 32) ++t.null_laeufe;
    } else {
      lauf = 0;
    }
  }
  return t;
}

std::vector<float> fassung_klick() {  // Klickform aus klick_fassung.py (96 Samples), Bezugspunkt Klick-Anfang
  std::vector<float> t(96);
  for (int i = 0; i < 96; ++i) t[(size_t)i] = (float)(std::exp(-i / 12.0) * std::cos(2 * PI * 2000.0 * i / 48000.0));
  return t;
}

// ------------------------------------------------------------------------------------------ rampe
constexpr double START_BEAT = 8.0, RAMPE_AB = 12.0, RAMPE_BEATS = 8.0, ENDE_BEAT = 31.0;

void rampe_befehle(Lauf& k, int master, int cue) {
  for (int d = 1; d <= 4; ++d) k.laden(d, MAT);
  char p[32];
  std::snprintf(p, sizeof p, "deck/%d/fader", master);
  k.teil(p, 0.0f, 6.0);  // nach dem Laden (das setzt Fader −200 und PFL 0)
  std::snprintf(p, sizeof p, "deck/%d/pfl", cue);
  // PFL ist nur_hand (stellwerk/src/regler.cpp:83, nur_hand = true) und das Stellwerk lehnt jede andere Quelle ab
  // (stellwerk/src/einsortieren.cpp:38 `if (d.nur_hand && b.quelle != Quelle::andreas) return ablehnen(Grund::nur_hand)`);
  // einen Hörschein-Weg wie für Fader und Trim (I3a) gibt es dafür nicht. Darum hier, und nur hier, Quelle andreas.
  k.teil(p, 1.0f, 6.0, "andreas");
  for (int d = 1; d <= 4; ++d) k.start(d, START_BEAT, 0.0);
  k.rampe(RAMPE_AB, 132.0, RAMPE_BEATS);
}

void test_rampe() {
  Karte k_soll(128.0, 0);
  PRUEF(k_soll.rampe(RAMPE_AB, 132.0, RAMPE_BEATS));
  const int64_t ende = (int64_t)k_soll.sample_at(ENDE_BEAT);
  const int64_t s_start = std::llround(k_soll.sample_at(START_BEAT));
  const int64_t s_h = s_start + cdj::ANSATZ_FRIST;
  const int64_t s_r = s_h + cdj::DECK_KEYLOCK_EINSCHWING + cdj::DECK_KEYLOCK_BLENDE;  // Ring (bzw. Direktweg) ab hier
  // bis zur Rampe Basis 128: der Direktweg klingt (Architektur 7); der Ring allein ab der Rampe nach seiner Blende
  const int64_t s_ring = std::llround(k_soll.sample_at(RAMPE_AB)) + 2 * cdj::DECK_KEYLOCK_BLENDE + B;
  const DehnerAnker a{START_BEAT, 0.0};  // Start bei Beat 8 auf Quell-Beat 0, phasenstarr
  const std::vector<float> tpl = fassung_klick();
  const int q0 = (int)std::ceil(k_soll.beat_at((double)s_r) - START_BEAT);
  const int q1 = (int)(ENDE_BEAT - 1.0 - START_BEAT);

  // Bezug: derselbe Kern synchron ohne Keylock (Varispeed): Kette des Kerns je Klick, Gegenprobe der Tonhöhe
  Lauf ref(false, false);
  rampe_befehle(ref, 1, 2);
  ref.bis(ende);
  const double ct_v = 1200.0 * std::log2(km::freq(ref.ch[0], (int64_t)k_soll.sample_at(24.0),
                                                  (int64_t)k_soll.sample_at(24.0) + 4800) / 1000.0);
  std::printf("  rampe: Gegenprobe Varispeed bei Beat 24: %+.2f ct (Master), Klicks %d..%d\n", ct_v, q0, q1 - 1);
  PRUEF(std::fabs(ct_v - 1200.0 * std::log2(132.0 / 128.0)) < 1.0);

  for (int lauf = 0; lauf < 2; ++lauf) {
    const int dm = 2 * lauf + 1, dc = dm + 1;  // Master hört dm, Cue hört dc
    Lauf k(true, true);
    int64_t hoer[4] = {}, hoer_soll = 0;
    k.je_zyklus = [&] {
      if (k.kern->sample() > s_ring) {
        ++hoer_soll;
        for (int d = 0; d < 4; ++d) hoer[d] += k.kern->deck(d + 1).keylock_ring_hoerbar() ? 1 : 0;
      }
    };
    rampe_befehle(k, dm, dc);
    k.bis(ende);
    k.je_zyklus = nullptr;
    std::printf("  rampe Lauf %d (Master Deck %d, Cue Deck %d): %lld Zyklen, %lld zu spät, Callback max %.0f µs\n", lauf + 1,
                dm, dc, (long long)k.zyklen, (long long)k.spaet, k.cb_max_ns / 1000.0);
    for (int d = 1; d <= 4; ++d) {
      const cdj::Deck& dk = k.kern->deck(d);
      std::printf("    Deck %d: s_h %lld, Ring hörbar %lld/%lld Zyklen, Unterläufe %llu (hart %llu), verpasst %llu, "
                  "aufgegeben %llu, laeuft %d\n",
                  d, (long long)dk.keylock_s_h(), (long long)hoer[d - 1], (long long)hoer_soll,
                  (unsigned long long)dk.keylock_unterlauf(), (unsigned long long)dk.keylock_hart(),
                  (unsigned long long)dk.keylock_verpasst(), (unsigned long long)dk.keylock_aufgegeben(), (int)dk.laeuft());
      PRUEF(dk.laeuft() && dk.keylock_ring_hoerbar());
      PRUEF(hoer_soll > 1000 && hoer[d - 1] == hoer_soll);  // ab der Rampe durchgehend der Ring, je Deck
    }
    for (int seite = 0; seite < 2; ++seite) {
      const int d = seite ? dc : dm;
      const std::vector<float>& L = k.ch[2 * seite];
      const std::vector<float>& R = k.ch[2 * seite + 1];
      const Ton t = ton_messen(L, s_r, ende - 4800, seite ? "Cue" : "Master", &R);
      // Prüfung F2 (Spec): Mittel und Maximum nur über Klicks, an denen der Ring allein klingt (ab s_ring); die Klicks
      // davor (Basis 128) klingen im Direktweg und müssen bitgleich zum Bezug liegen (dd == 0); dazwischen die Blende
      int n = 0, n_direkt = 0, n_direkt_ab = 0, n_blende = 0;
      double summe = 0, max_soll = 0;
      for (int i = q0; i < q1; ++i) {
        double ei = 999, ev = 999;
        if (!km::klick_lage(R, k_soll, a, i, ei, tpl, 0.0) || !km::klick_lage(ref.ch[2 * seite + 1], k_soll, a, i, ev, tpl, 0.0))
          continue;
        const double dd = ei - ev;  // Lage gegen das Soll, die Kette des Kerns herausgerechnet
        const double s_klick = k_soll.sample_at(START_BEAT + i);
        if (START_BEAT + i < RAMPE_AB) {
          ++n_direkt;
          n_direkt_ab += dd != 0.0 ? 1 : 0;
        } else if (s_klick >= (double)s_ring) {
          ++n;
          summe += dd;
          max_soll = std::max(max_soll, std::fabs(dd));
        } else {
          ++n_blende;
        }
      }
      const double mittel = n ? summe / n : NAN;
      std::printf("    Deck %d (%s): %d Fenster, max |Tonhöhe| %.3f ct, über 2 ct %d, Null-Läufe %d; Ring: %d Klicks, "
                  "Lage Mittel %+.2f, max |Lage| %.2f; Direktweg: %d Klicks, %d nicht bitgleich; in der Blende %d\n",
                  d, seite ? "Cue" : "Master", t.fenster, t.max_ct, t.ueber, t.null_laeufe, n, mittel, max_soll,
                  n_direkt, n_direkt_ab, n_blende);
      PRUEF(n_direkt >= 3 && n_direkt_ab == 0);
      PRUEF(t.k_max_ct <= 25.0 && t.fenster + t.k_fenster >= 100 && t.fenster >= 100 / 2);  // Beat 8,3 bis 31 bei 128 bis 132 BPM: 103 Fenster zu 100 ms
      PRUEF(t.ueber == 0);
      PRUEF(t.null_laeufe == 0);
      PRUEF(n + n_direkt + n_blende == q1 - q0 && n >= 15);
      // Keylock 4.6: das absolute Mittel wird nur ausgewiesen (Deck-Versatz 0; Hann-Klick liegt um die R3-eigene Lage daneben)
      PRUEF(max_soll <= 12.0);
    }
  }
  ergebnis("faeden_rampe");
}

// ------------------------------------------------------------------------------------------ knopf
// Keylock Task 3 (Fassung 4: EIN Knopf für alle Quellen, Regler `keylock`, Quelle cypher): zur Laufzeit bei laufendem Deck.
// Deck 1 spielt ab Beat 8 (Sinus links), Rampe 128 -> 132 ab Beat 12 über 8 Beats; Knopf aus bei Beat 16 (mitten in der
// Rampe), an bei Beat 24 (132 fest). Soll: bis 16 klingt der Ring (±2 ct); nach dem Aus und seiner Blende klingt der
// Varispeed, BITGLEICH zum selben Kern ohne Keylock (Bezug) und ab Beat 20 bei +53,2 ct; nach dem An setzt das Deck am
// Sample an (s_h = Sample des Knopfs + ANSATZ_FRIST, Varispeed-Brücke bis dahin, bitgleich zum Bezug) und klingt nach
// Einschwingen und Blende wieder ±2 ct. Die Loop-Boxen folgen dem Knopf (Kern::keylock_boxen), die Zähler bleiben 0.
constexpr double K_START = 8.0, K_RAMPE = 12.0, K_AUS = 16.0, K_AN = 24.0, K_ENDE = 34.0;

void knopf_befehle(Lauf& k) {
  k.laden(1, MAT);
  k.teil("deck/1/fader", 0.0f, 6.0);
  k.start(1, K_START, 0.0);
  k.rampe(K_RAMPE, 132.0, 8.0);
  k.teil("keylock", 0.0f, K_AUS, "cypher");  // Fassung 4: Quelle cypher darf (kein nur_hand)
  k.teil("keylock", 1.0f, K_AN, "cypher");
}

void test_knopf() {
  Karte k_soll(128.0, 0);
  PRUEF(k_soll.rampe(K_RAMPE, 132.0, 8.0));
  const int64_t ende = (int64_t)k_soll.sample_at(K_ENDE);
  const int64_t s_aus = std::llround(k_soll.sample_at(K_AUS)), s_an = std::llround(k_soll.sample_at(K_AN));
  const int64_t s_ring = std::llround(k_soll.sample_at(K_RAMPE)) + 2 * cdj::DECK_KEYLOCK_BLENDE + B;
  Lauf ref(false, false);
  knopf_befehle(ref);
  ref.bis(ende);
  Lauf k(true, true);
  int64_t hoer_vor = 0, hoer_aus = 0, hoer_nach = 0, n_vor = 0, n_nach = 0, knopf_falsch = 0, boxen_falsch = 0;
  int64_t s_h_an = -1, uhr_aus = 0;
  k.je_zyklus = [&] {
    uhr_aus += k.uhr_keylock_aus == 1 ? 1 : 0;
    const int64_t s = k.kern->sample();  // nach dem Zyklus: erstes Sample des nächsten
    const cdj::Deck& dk = k.kern->deck(1);
    const bool soll = !(s > s_aus && s <= s_an);  // Stand nach dem Block, der s - 1 enthielt
    if (k.kern->keylock_knopf() != soll) ++knopf_falsch;
    if (k.kern->keylock_boxen() != soll) ++boxen_falsch;
    if (s > s_ring && s <= s_aus) { ++n_vor; hoer_vor += dk.keylock_ring_hoerbar() ? 1 : 0; }
    if (s > s_aus + cdj::DECK_KEYLOCK_BLENDE + B && s <= s_an) hoer_aus += dk.keylock_ring_beteiligt() ? 1 : 0;
    if (s > s_an && s_h_an < 0) s_h_an = dk.keylock_s_h();
    if (s > s_an + cdj::ANSATZ_FRIST + cdj::DECK_KEYLOCK_EINSCHWING + cdj::DECK_KEYLOCK_BLENDE + B) {
      ++n_nach;
      hoer_nach += dk.keylock_ring_hoerbar() ? 1 : 0;
    }
  };
  knopf_befehle(k);
  k.bis(ende);
  k.je_zyklus = nullptr;
  const cdj::Deck& dk = k.kern->deck(1);
  const std::vector<float>& L = k.ch[0];
  const std::vector<float>& LR = ref.ch[0];
  // /e/regler meldet den Knopf (Seite und Leitstand zeigen ihn daraus), /uhr trägt ihn an das Netz (Loop-Varianten)
  std::printf("  knopf: /e/regler keylock %zu Meldungen:", k.knopf_regler.size());
  for (const auto& m : k.knopf_regler) std::printf(" (%lld, %.0f)", (long long)m.first, m.second);
  std::printf("; /uhr keylock_aus zuletzt %d\n", k.uhr_keylock_aus);
  PRUEF(k.knopf_regler.size() >= 2 && k.knopf_regler.front().second == 0.0f && k.knopf_regler.back().second == 1.0f);
  std::printf("  knopf: /uhr mit keylock_aus 1 in %lld Zyklen (Soll etwa %lld)\n", (long long)uhr_aus, (long long)((s_an - s_aus) / B));
  PRUEF(k.uhr_keylock_aus == 0 && std::llabs(uhr_aus - (s_an - s_aus) / B) <= 1);
  // aus: ab dem Ende der Blende bis zum An-Knopf; an: Brücke bis s_h, also bis s_h bitgleich zum Bezug
  const int64_t s_vari = s_aus + cdj::DECK_KEYLOCK_BLENDE;
  const int64_t s_h = s_an + cdj::ANSATZ_FRIST;
  int64_t ungleich_aus = 0, ungleich_bruecke = 0, gleich_vor = 0;
  // Das Deck ist nach der Blende bitgleich zum Varispeed (test_deck_keylock Test 5b); am Master klingt der Unterschied davor im
  // Gedächtnis der Kette nach (gemessen 08.10.: 1291 Samples nach dem Blendenende, |dx| höchstens 5,3e-4). Darum: bitgleich ab
  // KETTE Samples nach der Blende, davor nur klein.
  constexpr int64_t KETTE = 2048;
  int64_t erst_ungleich = -1, letzt_ungleich = -1;
  double max_dx = 0.0;
  for (int64_t s = s_vari; s < s_h; ++s) {
    const bool u = L[(size_t)s] != LR[(size_t)s];
    if (s < s_vari + KETTE) {
      max_dx = std::max(max_dx, (double)std::fabs(L[(size_t)s] - LR[(size_t)s]));
      continue;
    }
    (s < s_an ? ungleich_aus : ungleich_bruecke) += u ? 1 : 0;
    if (u && erst_ungleich < 0) erst_ungleich = s;
    if (u) letzt_ungleich = s;
  }
  std::printf("  knopf: Kette nach der Blende (%lld Samples) max |dx| %.3e; ungleich danach ab %lld bis %lld\n", (long long)KETTE,
              max_dx, (long long)erst_ungleich, (long long)letzt_ungleich);
  for (int64_t s = s_ring; s < s_aus; ++s) gleich_vor += L[(size_t)s] == LR[(size_t)s] ? 1 : 0;
  const int64_t s_ton = std::llround(k_soll.sample_at(K_RAMPE + 8.0)) + 4800;  // Varispeed bei 132 fest
  double vari_ct_min = 1e9, vari_ct_max = -1e9;
  for (int64_t s = s_ton; s + 4800 <= s_an; s += 4800) {
    const double ct = 1200.0 * std::log2(km::freq(L, s, s + 4800) / 1000.0);
    vari_ct_min = std::min(vari_ct_min, ct);
    vari_ct_max = std::max(vari_ct_max, ct);
  }
  const Ton t_vor = ton_messen(L, s_ring, s_aus, "vor dem Aus", &k.ch[1]);
  const int64_t s_r2 = s_h + cdj::DECK_KEYLOCK_EINSCHWING + cdj::DECK_KEYLOCK_BLENDE;
  const Ton t_nach = ton_messen(L, s_r2, ende - 4800, "nach dem An", &k.ch[1]);
  std::printf("  knopf: aus bei %lld, an bei %lld; Knopf falsch %lld, Boxen falsch %lld; Ring vor dem Aus hörbar %lld/%lld "
              "(%lld Samples gleich dem Bezug), nach der Blende beteiligt %lld\n",
              (long long)s_aus, (long long)s_an, (long long)knopf_falsch, (long long)boxen_falsch, (long long)hoer_vor,
              (long long)n_vor, (long long)gleich_vor, (long long)hoer_aus);
  std::printf("  knopf: aus: %lld Samples ungleich zum Bezug (Varispeed), Tonhöhe bei 132 %+.2f bis %+.2f ct (Soll +53,2); "
              "an: s_h %lld (Soll %lld), Brücke %lld ungleich, Ring hörbar %lld/%lld\n",
              (long long)ungleich_aus, vari_ct_min, vari_ct_max, (long long)s_h_an, (long long)s_h, (long long)ungleich_bruecke,
              (long long)hoer_nach, (long long)n_nach);
  std::printf("  knopf: Tonhöhe vor dem Aus max %.3f ct (%d Fenster, über 2 ct %d), nach dem An max %.3f ct (%d Fenster, über 2 ct "
              "%d, Null-Läufe %d); Unterläufe %llu, aufgegeben %llu, %lld Zyklen zu spät, Callback max %.0f µs\n",
              t_vor.max_ct, t_vor.fenster, t_vor.ueber, t_nach.max_ct, t_nach.fenster, t_nach.ueber, t_nach.null_laeufe,
              (unsigned long long)dk.keylock_unterlauf(), (unsigned long long)dk.keylock_aufgegeben(), (long long)k.spaet,
              k.cb_max_ns / 1000.0);
  PRUEF(knopf_falsch == 0 && boxen_falsch == 0);
  PRUEF(n_vor > 100 && hoer_vor == n_vor);    // vor dem Aus: der Ring (Keylock an, Vorgabe)
  PRUEF(gleich_vor < (s_aus - s_ring) / 2);   // und der klingt anders als der Varispeed des Bezugs
  PRUEF(t_vor.k_max_ct <= 25.0 && t_vor.fenster + t_vor.k_fenster >= 10 && t_vor.fenster >= 10 / 2 && t_vor.ueber == 0);
  PRUEF(hoer_aus == 0 && ungleich_aus == 0 && max_dx < 1e-3);  // aus: Varispeed, bitgleich zum Kern ohne Keylock
  PRUEF(vari_ct_min > 52.2 && vari_ct_max < 54.2);
  PRUEF(s_h_an == s_h && ungleich_bruecke == 0);  // an: Ansatz am Sample, Varispeed-Brücke bis s_h
  PRUEF(n_nach > 100 && hoer_nach == n_nach && dk.keylock_an());
  PRUEF(t_nach.k_max_ct <= 25.0 && t_nach.fenster + t_nach.k_fenster >= 30 && t_nach.fenster >= 30 / 2 && t_nach.ueber == 0 && t_nach.null_laeufe == 0);
  PRUEF(dk.keylock_unterlauf() == 0 && dk.keylock_aufgegeben() == 0);
  ergebnis("faeden_knopf");
}


// ------------------------------------------------------------------------------------------ loop
// Keylock Task 5: Loop auf dem Deck im Kern, mit echten Fäden. Deck 1 spielt ab Beat 8 auf Quell-Beat 0 bei 132 (Sinus
// links, Klick rechts); bei Beat 12 Loop 4 Beats ab dem Kopf (/k/deck/loop wie die Hand, Kern: Anfang = Kopf), drei
// Durchläufe und mehr, bei Beat 26 Loop aus. Soll: nach Brücke, Einschwingen und Blende klingt im Loop in jedem Zyklus der
// Ring, Tonhöhe ±2 ct über die Nähte, jeder Klick im Loop ±12 (das Mittel ausgewiesen) gegen das Soll aus Karte und Loop
// (ungewickelter Quell-Beat ab dem Start; die Kette des Kerns per Bezug ohne Keylock herausgerechnet, wie rampe), der Klick
// am Loop-Anfang je Durchlauf ±12; nach dem Aus wieder der Ring, ±2 ct; Unterläufe 0, kein harter Rückfall. Gegenprobe:
// der Bezug ohne Keylock klingt im Loop bei +53 ct.
// Das Mittel gegen das Soll wird hier nur ausgewiesen, nicht begrenzt: mit dieser Klickform (klick_fassung.py, Bezugspunkt
// Klick-Anfang) liegt die Lage des Rings im Kern auch OHNE Loop als Sägezahn um rund −2,5 (−1,1 Samples je Beat, Sprung +6,7
// alle rund 8 Beats; gemessen 08.10., task-05/kern_ohne_loop_lage.txt), das Mittel über 13 Klicks hängt an dessen Phase.
// Begrenzt wird stattdessen, was der Loop ändern könnte: Vergleichslauf mit einem 32-Beat-Loop an denselben Beats (gleicher
// Ansatz und Anker, gleiche Phase des Sägezahns, dessen Naht hinter dem Messfenster liegt; Klicks samt Akzent und Sinus
// wiederholen sich alle 4 Beats, der 4-Beat-Loop speist R3 also mit demselben Strom): je Klick |Loop − Vergleich| <= 0,5.
// Ein Sprung um 0 taugt nicht als Vergleich: er rundet den Anker auf ein ganzes Frame (gemessen: 0,8 bis 1,35 Samples
// Versatz an jedem Klick, auch vor der ersten Naht). Das Mittel gegen das Soll weist test_deck_keylock (Test 23, 24) aus (seit 4.6, vorher ±3) mit der Klickform,
// auf die der Versatz des Dehners bis 4.6 eingemessen war (seit 4.6 ist er 0).
constexpr double L_START = 8.0, L_AN = 12.0, L_BEATS = 4.0, L_AUS = 26.0, L_ENDE = 33.0;

// laenge: Loop-Länge in Beats. Vergleichslauf: 32 Beats an denselben Beats (dasselbe Ereignis, derselbe Anker, die Naht
// liegt hinter dem Messfenster: bis dahin das Material linear).
void loop_befehle(Lauf& k, double laenge = L_BEATS) {
  k.auf_132();
  k.laden(1, MAT);
  k.teil("deck/1/fader", 0.0f, 6.0);
  k.start(1, L_START, 0.0);
  for (double l : {laenge, 0.0}) {
    cdj::Befehl b = k.neu(cdj::Befehl::DECK_LOOP);
    b.deck = 1;
    b.ab_beat = l > 0.0 ? L_AN : L_AUS;
    b.wert_beats = l;
    b.politik = 1;
    k.sende(b);
  }
}

void test_loop() {
  Karte k_soll(128.0, 0);
  PRUEF(k_soll.rampe(0.25, 132.0, 0.5));
  const int64_t ende = (int64_t)k_soll.sample_at(L_ENDE);
  const int64_t s_an = std::llround(k_soll.sample_at(L_AN)), s_aus = std::llround(k_soll.sample_at(L_AUS));
  const int64_t r_an = s_an + cdj::ANSATZ_FRIST + cdj::DECK_KEYLOCK_EINSCHWING + cdj::DECK_KEYLOCK_BLENDE + B;
  const int64_t r_aus = s_aus + cdj::ANSATZ_FRIST + cdj::DECK_KEYLOCK_EINSCHWING + cdj::DECK_KEYLOCK_BLENDE + B;
  Lauf ref(false, false);
  loop_befehle(ref);
  ref.bis(ende);
  Lauf vgl(true, true);
  loop_befehle(vgl, 32.0);
  vgl.bis(ende);
  Lauf k(true, true);
  int64_t hoer = 0, hoer_soll = 0, loop_zyklen = 0;
  k.je_zyklus = [&] {
    const int64_t s = k.kern->sample();
    const cdj::Deck& dk = k.kern->deck(1);
    if ((s > r_an && s <= s_aus) || s > r_aus) {
      ++hoer_soll;
      hoer += dk.keylock_ring_hoerbar() ? 1 : 0;
    }
    loop_zyklen += (s > s_an + B && s <= s_aus && dk.loop_aktiv()) ? 1 : 0;
  };
  loop_befehle(k);
  k.bis(ende);
  k.je_zyklus = nullptr;
  const cdj::Deck& dk = k.kern->deck(1);
  const Ton t_loop = ton_messen(k.ch[0], r_an, s_aus, "im Loop", &k.ch[1]),
            t_nach = ton_messen(k.ch[0], r_aus, ende - 4800, "nach dem Aus", &k.ch[1]);
  const int64_t s_v = (int64_t)k_soll.sample_at(L_AN + 6.0);
  const double ct_v = 1200.0 * std::log2(km::freq(ref.ch[0], s_v, s_v + 4800) / 1000.0);
  // Lage im Loop: ungewickelter Quell-Beat q (Start bei Beat 8 auf Quell-Beat 0), Loop-Anfang bei Quell-Beat 4 = Beat 12
  const DehnerAnker a{L_START, 0.0};
  const std::vector<float> tpl = fassung_klick();
  const int q0 = (int)std::ceil(k_soll.beat_at((double)r_an) - L_START), q1 = (int)(L_AUS - L_START);
  int n = 0;
  double summe = 0, max_l = 0, summe_vgl = 0, max_vgl = 0;
  std::vector<double> anfang;
  for (int q = q0; q < q1; ++q) {
    double ei = 999, ev = 999, ec = 999;
    if (!km::klick_lage(k.ch[1], k_soll, a, q, ei, tpl, 0.0) || !km::klick_lage(ref.ch[1], k_soll, a, q, ev, tpl, 0.0) ||
        !km::klick_lage(vgl.ch[1], k_soll, a, q, ec, tpl, 0.0))
      continue;
    ++n;
    summe += ei - ev;
    summe_vgl += ec - ev;
    max_l = std::max(max_l, std::fabs(ei - ev));
    max_vgl = std::max(max_vgl, std::fabs(ei - ec));
    if (q >= 8 && q % 4 == 0) anfang.push_back(ei - ev);
    if (std::getenv("KL_DIAG")) std::printf("    Klick %d: Loop %+.2f, Vergleich (32-Beat-Loop) %+.2f, Bezug %+.2f\n", q, ei, ec, ev);
  }
  const double mittel = n ? summe / n : NAN, mittel_vgl = n ? summe_vgl / n : NAN;
  std::printf("  loop: an bei %lld, aus bei %lld; im Loop %lld Zyklen; Ring hörbar %lld/%lld Zyklen; Unterläufe %llu (hart %llu), "
              "verpasst %llu, aufgegeben %llu; %lld Zyklen zu spät, Callback max %.0f µs\n",
              (long long)s_an, (long long)s_aus, (long long)loop_zyklen, (long long)hoer, (long long)hoer_soll,
              (unsigned long long)dk.keylock_unterlauf(), (unsigned long long)dk.keylock_hart(),
              (unsigned long long)dk.keylock_verpasst(), (unsigned long long)dk.keylock_aufgegeben(), (long long)k.spaet,
              k.cb_max_ns / 1000.0);
  std::printf("  loop: Tonhöhe im Loop %d Fenster max %.3f ct (über 2 ct %d, Null-Läufe %d), nach dem Aus %d Fenster max %.3f ct "
              "(über 2 ct %d); Gegenprobe Bezug im Loop %+.2f ct\n",
              t_loop.fenster, t_loop.max_ct, t_loop.ueber, t_loop.null_laeufe, t_nach.fenster, t_nach.max_ct, t_nach.ueber, ct_v);
  std::printf("  loop: Lage Klicks %d..%d: %d gemessen, Mittel %+.2f (Vergleich 32-Beat-Loop %+.2f), max %.2f, max |Loop − Vergleich| "
              "%.2f; Loop-Anfang je Durchlauf",
              q0, q1 - 1, n, mittel, mittel_vgl, max_l, max_vgl);
  for (double x : anfang) std::printf(" %+.2f", x);
  std::printf("\n");
  PRUEF(loop_zyklen > 1000);           // der Loop lief wirklich (Status 3 im Kern)
  PRUEF(hoer_soll > 1000 && hoer == hoer_soll);
  PRUEF(t_loop.k_max_ct <= 25.0 && t_loop.fenster + t_loop.k_fenster >= 60 && t_loop.fenster >= 60 / 2 && t_loop.ueber == 0 && t_loop.null_laeufe == 0);
  PRUEF(t_nach.k_max_ct <= 25.0 && t_nach.fenster + t_nach.k_fenster >= 20 && t_nach.fenster >= 20 / 2 && t_nach.ueber == 0 && t_nach.null_laeufe == 0);
  PRUEF(std::fabs(ct_v - 1200.0 * std::log2(132.0 / 128.0)) < 1.0);
  PRUEF(n == q1 - q0 && n >= 12);
  PRUEF(max_vgl <= 0.5);
  PRUEF(max_l <= 12.0);
  PRUEF(anfang.size() >= 3);
  for (double x : anfang) PRUEF(std::fabs(x) <= 12.0);
  PRUEF(dk.keylock_unterlauf() == 0 && dk.keylock_hart() == 0 && dk.keylock_aufgegeben() == 0);
  ergebnis("faeden_loop");
}

// ------------------------------------------------------------------------------------------ konfig
// Keylock Task 3: kern.toml `keylock = false` -> Kern ohne Dehner (der Weg von main.cpp: keylock_nach_konfig vor dem ersten
// Zyklus, keylock_bauen danach). Gegenprobe: ohne Schlüssel (Vorgabe true) hängen die Dehner.
void test_konfig() {
  for (int an = 0; an < 2; ++an) {
    const cdj::KernKonfig konf = cdj::lies_kern_toml_text(an ? "version = 1\n" : "version = 1\nkeylock = false\n", "test");
    Lauf k(Weg::OHNE, false);
    const bool angekuendigt = k.kern->keylock_nach_konfig(konf.keylock);
    const bool gebaut = angekuendigt && k.kern->keylock_bauen(0);
    k.laden(1, MAT);
    k.start(1, 2.0, 0.0);
    k.sekunden(1.5);
    const cdj::DehnerBasis* d = k.kern->keylock_dehner(1);
    std::printf("  konfig %s: keylock %d, angekündigt %d, gebaut %d, Dehner Deck 1 %s, Keylock an %d, Fäden %d\n",
                an ? "ohne Schlüssel" : "keylock = false", (int)konf.keylock, (int)angekuendigt, (int)gebaut, d ? "da" : "fehlt",
                (int)k.kern->deck(1).keylock_an(), (int)k.kern->keylock_faeden_laufen());
    PRUEF(konf.keylock == (an == 1));
    PRUEF(angekuendigt == (an == 1) && gebaut == (an == 1));
    PRUEF((d != nullptr) == (an == 1) && k.kern->deck(1).keylock_an() == (an == 1) && k.kern->keylock_faeden_laufen() == (an == 1));
    k.kern->keylock_faeden_stoppen();
  }
  ergebnis("faeden_konfig");
}

// ------------------------------------------------------------------------------------------ quittung
// Je Runde: Laden, Start, 0,4 s spielen (Ring hörbar), Stopp; im Stand 0,3 s: der Ring bekommt keinen Frame (R3 ruht);
// dann Entladen im Stand. Zuletzt: Laden, spielen, Stopp, Tausch auf die 132er Fassung im Stand, Entladen. Jede Quittung
// (Laden 3, Stopp 3, Tausch 3, Entladen 3) binnen 2 s Kern-Zeit; am Ende alles Material zurück (Lader gesperrt 0).
void test_quittung() {
  constexpr double FRIST = 2.0;
  Lauf k(true, true);
  k.auf_132();
  const cdj::Deck& dk = k.kern->deck(1);
  bool ok = true;
  double ms_max = 0;
  auto pruef_q = [&](int64_t id, int st, const char* was, int runde) {
    if (!ok) return;
    const double ms = k.warte(id, st, FRIST);
    if (ms < 0) {
      std::printf("    Runde %d: %s (id %lld) ohne Quittung %d nach %.1f s; Quittungen von ihr:", runde, was, (long long)id, st,
                  FRIST);
      for (const Q& x : k.q)
        if (x.id == id) std::printf(" %d", x.status);
      std::printf("; verliehen %d, gesperrt %lld Bytes\n", dk.keylock_verliehen(), (long long)k.lader.gesperrt());
      ok = false;
    }
    ms_max = std::max(ms_max, ms);
  };
  int ruht_ok = 0, lief_ok = 0;
  constexpr int RUNDEN = 6;
  for (int r = 0; r < RUNDEN && ok; ++r) {
    pruef_q(k.laden(1, r % 2 ? MAT_B : MAT), 3, "Laden", r);
    if (!ok) break;
    const uint64_t g0 = dk.keylock_gelesen();
    k.start(1, std::ceil(k.beat() * 4.0) / 4.0 + 0.25, 0.0);
    k.sekunden(0.4);
    const bool hoerbar = dk.keylock_ring_hoerbar();
    const uint64_t g1 = dk.keylock_gelesen();
    pruef_q(k.stopp(1, k.beat() + 0.05), 3, "Stopp", r);
    k.sekunden(0.05);
    const uint64_t g2 = dk.keylock_gelesen();
    k.sekunden(0.3);
    const uint64_t g3 = dk.keylock_gelesen();
    if (hoerbar && g1 > g0) ++lief_ok;
    if (!dk.laeuft() && g3 == g2) ++ruht_ok;
    std::printf("    Runde %d: Ring hörbar %d, gelesen beim Spielen +%llu, im Stand +%llu\n", r, (int)hoerbar,
                (unsigned long long)(g1 - g0), (unsigned long long)(g3 - g2));
    pruef_q(k.entladen(1), 3, "Entladen", r);
  }
  if (ok) {  // Tausch im Stand
    pruef_q(k.laden(1, MAT), 3, "Laden", RUNDEN);
    k.start(1, std::ceil(k.beat() * 4.0) / 4.0 + 0.25, 0.0);
    k.sekunden(0.4);
    PRUEF(dk.keylock_ring_hoerbar());
    pruef_q(k.stopp(1, k.beat() + 0.05), 3, "Stopp", RUNDEN);
    pruef_q(k.tausch(1, 132.0, k.beat() + 0.5), 3, "Tausch", RUNDEN);
    PRUEF(dk.geladen() && dk.material()->basis_bpm == 132.0);
    pruef_q(k.entladen(1), 3, "Entladen", RUNDEN);
  }
  const int64_t s0 = k.kern->sample();
  while (k.lader.gesperrt() != 0 && k.kern->sample() < s0 + (int64_t)(FRIST * 48000)) k.zyklus();
  std::printf("  quittung: %s, längste Wartezeit %.1f ms, R3 lief beim Spielen %d/%d, ruhte im Stand %d/%d, am Ende "
              "gesperrt %lld Bytes, verliehen %d, Wächter-Meldungen %llu\n",
              ok ? "alle Quittungen binnen 2 s" : "Quittung fehlt", ms_max, lief_ok, RUNDEN, ruht_ok, RUNDEN,
              (long long)k.lader.gesperrt(), dk.keylock_verliehen(), (unsigned long long)k.kern->keylock_waechter_meldungen());
  PRUEF(ok);
  PRUEF(lief_ok == RUNDEN && ruht_ok == RUNDEN);
  PRUEF(k.lader.gesperrt() == 0);
  PRUEF(dk.keylock_verliehen() == 0);
  ergebnis("faeden_quittung");
}

// ------------------------------------------------------------------------------------------ waechter
void test_waechter() {
  Lauf k(true, true);
  k.auf_132();
  cdj::DehnerBasis* d1 = k.kern->keylock_dehner(1);
  PRUEF(d1 != nullptr);
  if (!d1) return ergebnis("faeden_waechter");
  PRUEF(k.warte(k.laden(1, MAT), 3, 2.0) >= 0);
  k.start(1, std::ceil(k.beat()) + 0.5, 0.0);
  k.sekunden(2.0);
  const uint64_t m_gesund = k.kern->keylock_waechter_meldungen();
  const bool hoerbar = k.kern->deck(1).keylock_ring_hoerbar();
  // angehalten: der Stopp setzt die Leer-Epoche an, der Thread quittiert sie nicht
  k.kern->keylock_test_halte(1, true);
  k.sekunden(0.1);
  k.stopp(1, k.beat() + 0.05);
  k.sekunden(0.3);
  const uint64_t m_300 = k.kern->keylock_waechter_meldungen();
  k.sekunden(0.5);
  const uint64_t m_800 = k.kern->keylock_waechter_meldungen();
  const uint32_t e_halt = d1->epoche(), q_halt = d1->quittiert_e();
  k.kern->keylock_test_halte(1, false);
  k.sekunden(0.5);
  const uint32_t e_frei = d1->epoche(), q_frei = d1->quittiert_e();
  const uint64_t m_frei = k.kern->keylock_waechter_meldungen();
  std::printf("  waechter: gesund 2 s: %llu Meldungen (Ring hörbar %d); angehalten: nach 0,3 s %llu, nach 0,8 s %llu "
              "(Epoche %u, quittiert %u); wieder frei: Epoche %u, quittiert %u, Meldungen %llu\n",
              (unsigned long long)m_gesund, (int)hoerbar, (unsigned long long)m_300, (unsigned long long)m_800, e_halt,
              q_halt, e_frei, q_frei, (unsigned long long)m_frei);
  PRUEF(m_gesund == 0 && hoerbar);
  PRUEF(m_300 == 0);  // vor der Frist (500 ms) nicht
  PRUEF(m_800 == 1);  // danach genau eine Meldung
  PRUEF(e_halt != q_halt);
  PRUEF(e_frei == q_frei && m_frei == 1);
  ergebnis("faeden_waechter");
}

// ------------------------------------------------------------------------------------------ stopp
void test_stopp() {
  Lauf k(true, true);
  k.auf_132();
  for (int d = 1; d <= 4; ++d) k.laden(d, MAT);
  for (int d = 1; d <= 4; ++d) k.start(d, 4.0, 0.0);
  k.bis((int64_t)(5.5 * 22500));
  int hoerbar = 0;
  for (int d = 1; d <= 4; ++d) hoerbar += k.kern->deck(d).keylock_ring_hoerbar() ? 1 : 0;
  PRUEF(hoerbar == 4 && k.kern->keylock_faeden_laufen());
  // Herunterfahren in einem eigenen Faden mit Frist: hängt es, ist der Test rot und endet (statt zu hängen)
  std::atomic<int64_t> dauer_faeden{-1}, dauer_kern{-1};
  const int64_t t0 = jetzt_ns();
  std::thread t([&] {
    k.kern->keylock_faeden_stoppen();
    dauer_faeden = jetzt_ns() - t0;
    k.kern.reset();  // der Kern samt Dehnern; ~Kern stoppt auch selbst
    dauer_kern = jetzt_ns() - t0;
  });
  while (dauer_kern.load() < 0 && jetzt_ns() - t0 < 2'000'000'000LL) usleep(1000);
  std::printf("  stopp: 4 Decks im Ring; Fäden gestoppt nach %.2f ms, Kern abgebaut nach %.2f ms (Frist 2000 ms)\n",
              dauer_faeden.load() / 1e6, dauer_kern.load() / 1e6);
  if (dauer_kern.load() < 0) {
    std::printf("  stopp: Herunterfahren hängt nach 2 s\nTEST faeden_stopp: ROT\n");
    std::fflush(stdout);
    std::_Exit(1);
  }
  t.join();
  PRUEF(dauer_kern.load() < 2'000'000'000LL);
  ergebnis("faeden_stopp");
}

// ------------------------------------------------------------------------------------------ box (Task 7, K1)
// Loop-Box mit Dehner und echten Fäden: der Arbeits-Thread der Box (Platz 5) rechnet, der Ring der Box klingt; hält er an
// (keylock_test_halte(5)), meldet der Wächter die Box, und der abgelöste Loop bleibt verliehen (kein LOOP_ALT); nach
// keylock_faeden_stoppen liest kein Faden mehr, der Loop kommt heraus.
void test_box() {
  auto sinus = [](double hz, const char* name) {
    auto* l = new cdj::Loop();
    l->name = name;
    l->beats = 1;
    l->frames = cdj::LOOP_SPB;
    l->daten.assign((size_t)(2 * l->frames), 0.0f);
    for (int64_t f = 0; f < l->frames; ++f)
      l->daten[(size_t)(2 * f)] = l->daten[(size_t)(2 * f + 1)] = (float)(0.3 * std::sin(2 * PI * hz * (double)f / 48000.0));
    return l;
  };
  cdj::Loop* a = sinus(416.0, "a");
  cdj::Loop* b = sinus(832.0, "b");
  Lauf k(true, true);
  k.auf_132();
  auto loop_befehl = [&](int art, const cdj::Loop* l) {
    cdj::Befehl x = k.neu(art);
    x.deck = 1;
    x.zeiger = l;
    return k.sende(x);
  };
  loop_befehl(cdj::Befehl::LOOP_LADEN, a);
  k.teil("pad/1/fader", 0.0f, 0.5);
  k.sekunden(0.3);
  loop_befehl(cdj::Befehl::LOOP_START, nullptr);
  k.sekunden(3.5);  // Einsatz auf der nächsten Eins (Beat 4 bei 132 BPM, 1,82 s), dann Brücke und Ring
  const cdj::StreckLeser& les = *k.kern->loopboxen().keylock_leser(1);
  const bool hoer = les.ring_hoerbar();
  const int64_t s_a = k.kern->sample();
  Ton t;  // ton_messen dieses Tests misst gegen 1000 Hz; die Box spielt 416 Hz
  for (int64_t s = s_a - 48000 - 1024; s + 4800 <= s_a - 1024; s += 4800) {  // ch ist um den Vorhalt des Limiters versetzt gefüllt
    const double ct = 1200.0 * std::log2(km::freq(k.ch[0], s, s + 4800) / 416.0);
    t.max_ct = std::max(t.max_ct, std::fabs(ct));
    t.ueber += std::fabs(ct) > 2.0 ? 1 : 0;
    ++t.fenster;
    if (std::fabs(ct) > 2.0) std::printf("    box: Fenster ab %lld: %+.3f ct\n", (long long)s, ct);
  }
  std::printf("  box: s_h %lld, verpasst %llu, unterlauf %llu, hart %llu, Einsatz bei Beat 4 = Sample %.0f\n",
              (long long)les.s_h(), (unsigned long long)les.verpasst_n(), (unsigned long long)les.unterlauf_n(),
              (unsigned long long)les.hart_n(), k.kern->karte().sample_at(4.0));
  int pol = -1, prio = -1;
  const bool faden5 = k.kern->keylock_faden_sched(5, pol, prio);
  std::printf("  box: Ring der Box hörbar %d, Ton %d Fenster max %.3f ct, Arbeits-Thread Box 1 angelegt %d, gelesen %llu\n",
              (int)hoer, t.fenster, t.max_ct, (int)faden5, (unsigned long long)les.gelesen());
  PRUEF(hoer && faden5 && t.fenster >= 9 && t.ueber == 0);
  const uint64_t w0 = k.kern->keylock_waechter_meldungen();
  k.kern->keylock_test_halte(5, true);
  k.sekunden(0.05);
  loop_befehl(cdj::Befehl::LOOP_LADEN, b);  // a wird abgelöst, der neue Ansatz wird nicht quittiert
  k.sekunden(1.0);
  const uint64_t w1 = k.kern->keylock_waechter_meldungen();
  bool a_raus = std::find(k.loop_alt.begin(), k.loop_alt.end(), (const void*)a) != k.loop_alt.end();
  std::printf("  box: Arbeits-Thread Box 1 angehalten: Wächter-Meldungen %llu -> %llu, a zurück %d\n", (unsigned long long)w0,
              (unsigned long long)w1, (int)a_raus);
  PRUEF(w1 > w0 && !a_raus);
  k.kern->keylock_faeden_stoppen();
  k.sekunden(0.1);
  a_raus = std::find(k.loop_alt.begin(), k.loop_alt.end(), (const void*)a) != k.loop_alt.end();
  std::printf("  box: nach keylock_faeden_stoppen a zurück %d\n", (int)a_raus);
  PRUEF(a_raus);
  loop_befehl(cdj::Befehl::LOOP_LADEN, nullptr);
  k.sekunden(0.1);
  const bool b_raus = std::find(k.loop_alt.begin(), k.loop_alt.end(), (const void*)b) != k.loop_alt.end();
  PRUEF(b_raus);
  if (a_raus) delete a;
  if (b_raus) delete b;
  ergebnis("faeden_box");
}

// ------------------------------------------------------------------------------------------ prio
// Task 7 (7a 3.6, K1): 8 Fäden (Vorbereiter, 4 Decks, 2 Boxen, Wächter), davon 7 SCHED_FIFO; der Wächter bleibt SCHED_OTHER
constexpr int NF = cdj::KEYLOCK_FAEDEN, NFIFO = cdj::KEYLOCK_FAEDEN - 1;
void sched_aller(cdj::Kern& kern, int pol[NF], int prio[NF]) {
  for (int i = 0; i < NF; ++i) {
    pol[i] = prio[i] = -1;
    kern.keylock_faden_sched(i, pol[i], prio[i]);
  }
}

void test_prio() {
  int pol[NF], prio[NF];
  {  // a) ohne JACK, ohne Aufruf: SCHED_OTHER
    Lauf k(true, true);
    sched_aller(*k.kern, pol, prio);
    int other = 0;
    for (int i = 0; i < NF; ++i) other += pol[i] == SCHED_OTHER ? 1 : 0;
    std::printf("  prio a) ohne JACK: %d von %d Fäden SCHED_OTHER\n", other, NF);
    PRUEF(other == NF);
  }
  rlimit rl{};
  PRUEF(getrlimit(RLIMIT_RTPRIO, &rl) == 0);
  const int jack = 20;  // JACK-Priorität im Test (am Ziel: aus dem JACK-Faden gelesen, main.cpp)
  if (rl.rlim_cur != RLIM_INFINITY && (int)rl.rlim_cur < jack - 5) {
    std::printf("  prio b) übersprungen: RLIMIT_RTPRIO %ld erlaubt SCHED_FIFO %d nicht\n", (long)rl.rlim_cur, jack - 5);
  } else {  // b) mit Recht: Vorbereiter und Arbeits-Threads SCHED_FIFO JACK − 5, der Wächter bleibt SCHED_OTHER
    Lauf k(true, true);
    const int fehl = k.kern->keylock_prioritaet(jack);
    sched_aller(*k.kern, pol, prio);
    int fifo = 0;
    for (int i = 0; i < NFIFO; ++i) fifo += pol[i] == SCHED_FIFO && prio[i] == jack - 5 ? 1 : 0;
    std::printf("  prio b) mit Recht (RLIMIT_RTPRIO %ld): %d Fehler, %d von %d SCHED_FIFO %d, Wächter Politik %d\n",
                (long)rl.rlim_cur, fehl, fifo, NFIFO, jack - 5, pol[NF - 1]);
    PRUEF(fehl == 0 && fifo == NFIFO && pol[NF - 1] == SCHED_OTHER);
    PRUEF(k.kern->keylock_prio_fehler() == 0);
  }
  {  // c) ohne Recht: gemeldet, gezählt, SCHED_OTHER, und der Keylock läuft (Ring hörbar)
    rlimit null = rl;
    null.rlim_cur = 0;
    PRUEF(setrlimit(RLIMIT_RTPRIO, &null) == 0);
    Lauf k(true, true);
    const int fehl = k.kern->keylock_prioritaet(jack);
    PRUEF(setrlimit(RLIMIT_RTPRIO, &rl) == 0);
    k.auf_132();
    sched_aller(*k.kern, pol, prio);
    int other = 0;
    for (int i = 0; i < NF; ++i) other += pol[i] == SCHED_OTHER ? 1 : 0;
    PRUEF(k.warte(k.laden(1, MAT), 3, 2.0) >= 0);
    k.start(1, std::ceil(k.beat()) + 0.5, 0.0);
    k.sekunden(1.5);
    const bool hoerbar = k.kern->deck(1).keylock_ring_hoerbar();
    std::printf("  prio c) ohne Recht (RLIMIT_RTPRIO 0): %d Fehler, Zähler %llu, %d von 8 SCHED_OTHER, Ring hörbar %d\n",
                fehl, (unsigned long long)k.kern->keylock_prio_fehler(), other, (int)hoerbar);
    PRUEF(fehl == NFIFO && k.kern->keylock_prio_fehler() == (uint64_t)NFIFO);
    PRUEF(other == NF && hoerbar);
  }
  {  // d) Keylock aus (keine Dehner): keine Fäden, nichts zu setzen
    Lauf k(false, true);
    PRUEF(!k.kern->keylock_bauen(jack) && !k.kern->keylock_faeden_laufen());  // nicht angekündigt
    PRUEF(k.kern->keylock_prioritaet(jack) == 0);
  }
  ergebnis("faeden_prio");
}

// ------------------------------------------------------------------------------------------ startfehler (2.5b, F1)
// Ist ein Faden nicht anlegbar (hier: RLIMIT_NPROC 1 nur um keylock_bauen), bleibt der Keylock wirklich aus: kein Dehner an
// den Decks, keine Fäden; das Deck spielt Varispeed (1031,25 Hz bei 132), Laden, Stopp und Entladen quittieren, alles
// Material kommt zurück. Stand 2.5 (Mutation VORGABE_VOR_FAEDEN): Dehner hingen trotzdem an, Entladen ohne Quittung 3.
void test_startfehler() {
  Lauf k(Weg::ANGEKUENDIGT, true);
  rlimit rl{};
  PRUEF(getrlimit(RLIMIT_NPROC, &rl) == 0);
  rlimit eins = rl;
  eins.rlim_cur = 1;
  PRUEF(setrlimit(RLIMIT_NPROC, &eins) == 0);
  const bool gebaut = k.kern->keylock_bauen(0);
  PRUEF(setrlimit(RLIMIT_NPROC, &rl) == 0);
  k.auf_132();
  const int64_t l = k.laden(1, MAT);
  const double ms_laden = k.warte(l, 3, 2.0);
  k.teil("deck/1/fader", 0.0f, std::ceil(k.beat()) + 0.25);
  k.start(1, std::ceil(k.beat()) + 0.5, 0.0);
  k.sekunden(1.5);
  const cdj::Deck& dk = k.kern->deck(1);
  const int64_t s = k.kern->sample() - 9600;
  const double hz = km::freq(k.ch[0], s, s + 4800);
  const bool vari = dk.laeuft() && !dk.keylock_ring_hoerbar() && std::fabs(hz - 1031.25) < 0.5;
  const double ms_stopp = k.warte(k.stopp(1, k.beat() + 0.05), 3, 2.0);
  k.sekunden(0.05);
  const double ms_entladen = k.warte(k.entladen(1), 3, 2.0);
  const int64_t s0 = k.kern->sample();
  while (k.lader.gesperrt() != 0 && k.kern->sample() < s0 + 96000) k.zyklus();
  std::printf("  startfehler (RLIMIT_NPROC 1): keylock_bauen %d, Fäden %d, Dehner Deck 1 %s, Keylock an den Decks %d; "
              "Laden %.1f ms, Varispeed %.2f Hz, Stopp %.1f ms, Entladen %.1f ms (−1: keine Quittung 3), gesperrt %lld\n",
              (int)gebaut, (int)k.kern->keylock_faeden_laufen(), k.kern->keylock_dehner(1) ? "da" : "keiner",
              (int)k.kern->keylock_vorgabe(), ms_laden, hz, ms_stopp, ms_entladen, (long long)k.lader.gesperrt());
  PRUEF(!gebaut && !k.kern->keylock_faeden_laufen());
  PRUEF(k.kern->keylock_dehner(1) == nullptr && !k.kern->keylock_vorgabe());
  PRUEF(ms_laden >= 0 && ms_stopp >= 0 && ms_entladen >= 0);
  PRUEF(vari);
  PRUEF(k.lader.gesperrt() == 0);
  ergebnis("faeden_startfehler");
}

// ------------------------------------------------------------------------------------------ spaet (2.5b, F2)
// Betriebsweg: angekündigt, das Deck spielt schon (Varispeed, 132), dann baut ein eigener Faden Dehner und Fäden (wie
// main.cpp nach READY). Bis zum Anhängen klingt der Varispeed lückenlos, danach setzt das laufende Deck neu an und der
// Ring klingt (1000 Hz). Gemessen: Dauer des Baus, Zeit vom Anhängen bis zum Ring.
void test_spaet() {
  Lauf k(Weg::ANGEKUENDIGT, true);
  k.auf_132();
  PRUEF(k.warte(k.laden(1, MAT), 3, 2.0) >= 0);
  k.teil("deck/1/fader", 0.0f, std::ceil(k.beat()) + 0.25);
  k.start(1, std::ceil(k.beat()) + 0.5, 0.0);
  k.sekunden(1.5);  // Start bei Beat 1,5 bis 2,5 (rund 0,7 bis 1,1 s), danach spielt das Deck mindestens 0,4 s
  const cdj::Deck& dk = k.kern->deck(1);
  PRUEF(dk.laeuft() && !dk.keylock_ring_hoerbar());
  std::atomic<int64_t> bau_ns{-1};
  std::atomic<bool> gebaut{false};
  const int64_t s_bau = k.kern->sample();
  std::thread bau([&] {
    const int64_t t = jetzt_ns();
    gebaut = k.kern->keylock_bauen(0);
    bau_ns = jetzt_ns() - t;
  });
  int64_t s_ring = -1;
  k.je_zyklus = [&] {
    if (s_ring < 0 && dk.keylock_ring_hoerbar()) s_ring = k.kern->sample();
  };
  k.sekunden(2.0);
  k.je_zyklus = nullptr;
  bau.join();
  const int64_t ab = k.kern->keylock_ab();
  const Ton vor = ton_messen(k.ch[0], s_bau - 9600, ab > 0 ? ab : s_bau, "vor dem Anhängen (Varispeed, Soll +53,3)");
  const int64_t e = k.kern->sample() - 4800;
  const double ct_nach = 1200.0 * std::log2(km::freq(k.ch[0], e - 4800, e) / 1000.0);
  int null_laeufe = 0, lauf = 0;
  for (int64_t i = s_bau - 9600; i < e; ++i) {
    if (k.ch[0][(size_t)i] == 0.0f) {
      if (++lauf == 32) ++null_laeufe;
    } else {
      lauf = 0;
    }
  }
  std::printf("  spaet: Bau %.1f ms, angehängt %.1f ms nach Baubeginn, Ring hörbar %.1f ms nach dem Anhängen; vor dem "
              "Anhängen %d Fenster bei %+.1f ct (Varispeed), danach %+.3f ct; Null-Läufe %d, Unterläufe %llu\n",
              bau_ns.load() / 1e6, ab >= 0 ? (ab - s_bau) / 48.0 : -1.0, s_ring >= 0 && ab >= 0 ? (s_ring - ab) / 48.0 : -1.0,
              vor.fenster, vor.max_ct, ct_nach, null_laeufe, (unsigned long long)dk.keylock_unterlauf());
  PRUEF(gebaut && ab > s_bau && s_ring > ab);
  PRUEF(vor.fenster >= 3 && std::fabs(vor.max_ct - 1200.0 * std::log2(132.0 / 128.0)) < 1.0);
  PRUEF(std::fabs(ct_nach) < 2.0);
  PRUEF(null_laeufe == 0);
  PRUEF(s_ring - ab < 48000);  // binnen 1 s nach dem Anhängen (ANSATZ_FRIST + Einschwingen + Blende: rund 135 ms)
  ergebnis("faeden_spaet");
}

// ------------------------------------------------------------------------------------------ zaehler (Task 3b)
// Prüfung 3 (MINOR 3): keylock_unterlauf und keylock_aufgegeben im DECK-Ereignis (§5.5), getrennt. Deck 1 spielt bei 132 im
// Ring; der Arbeits-Thread setzt lange aus (keylock_test_halte): Unterlauf, der neue Ansatz verpasst 8 Fristen ->
// aufgegeben. Wieder frei, Knopf aus und an (neuer Ansatz, Ring); dann nur 40 ms aus: noch ein Unterlauf, der Ansatz danach
// gelingt. Soll: Unterlauf 2, aufgegeben 1, im Ereignis wie am Deck.
void test_zaehler() {
  Lauf k(Weg::BETRIEB, true);
  k.auf_132();
  k.laden(1, MAT);
  k.teil("deck/1/fader", 0.0f, 1.5);
  k.start(1, 2.0, 0.0);
  const cdj::Deck& dk = k.kern->deck(1);
  k.sekunden(2.0);
  const bool ring0 = dk.keylock_ring_hoerbar();
  k.kern->keylock_test_halte(1, true);
  k.sekunden(1.0);  // Unterlauf, dann 8 verpasste Fristen (8 · 1024 Samples) -> aufgegeben
  const uint64_t u1 = dk.keylock_unterlauf(), a1 = dk.keylock_aufgegeben();
  k.kern->keylock_test_halte(1, false);
  k.teil("keylock", 0.0f, k.beat() + 0.25, "cypher");
  k.sekunden(0.3);
  k.teil("keylock", 1.0f, k.beat() + 0.25, "cypher");
  k.sekunden(1.0);
  const bool ring1 = dk.keylock_ring_hoerbar();
  k.kern->keylock_test_halte(1, true);
  k.sekunden(0.04);
  k.kern->keylock_test_halte(1, false);
  k.sekunden(1.0);
  std::printf("  zaehler: Ring %d / %d / %d; nach langem Aussetzen Unterlauf %llu, aufgegeben %llu; am Ende Deck %llu / %llu, "
              "Ereignis %d / %d\n", (int)ring0, (int)ring1, (int)dk.keylock_ring_hoerbar(), (unsigned long long)u1,
              (unsigned long long)a1, (unsigned long long)dk.keylock_unterlauf(), (unsigned long long)dk.keylock_aufgegeben(),
              k.deck1_unterlauf, k.deck1_aufgegeben);
  PRUEF(ring0 && ring1 && u1 == 1 && a1 == 1);
  PRUEF(dk.keylock_unterlauf() == 2 && dk.keylock_aufgegeben() == 1);
  PRUEF(k.deck1_unterlauf == 2 && k.deck1_aufgegeben == 1);
  ergebnis("faeden_zaehler");
}

// ------------------------------------------------------------------------------------------ knopf_spaet (Task 3b)
// Prüfung 3 (MINOR 2): der Knopf steht schon aus, BEVOR die Dehner hängen (keylock_uebernehmen, kern_deck.cpp `an &&
// w.knopf`). a) Betriebsweg, Knopf aus vor keylock_bauen: nach dem Anhängen nie Ring, Varispeed (+53,3 ct); Gegenprobe Knopf
// an -> Ring. b) Neustart mit gespeichertem keylock 0 (Zustandsdatei), Bau danach: nie Ring.
void test_knopf_spaet() {
  {
    Lauf k(Weg::ANGEKUENDIGT, true);
    k.auf_132();
    PRUEF(k.warte(k.laden(1, MAT), 3, 2.0) >= 0);
    k.teil("deck/1/fader", 0.0f, std::ceil(k.beat()) + 0.25);
    k.teil("keylock", 0.0f, std::ceil(k.beat()) + 0.25, "cypher");
    k.start(1, std::ceil(k.beat()) + 0.5, 0.0);
    k.sekunden(1.5);
    const cdj::Deck& dk = k.kern->deck(1);
    PRUEF(dk.laeuft() && !k.kern->keylock_knopf());
    std::atomic<bool> gebaut{false};
    std::thread bau([&] { gebaut = k.kern->keylock_bauen(0); });
    int64_t hoer = 0, beteiligt = 0;
    k.je_zyklus = [&] { hoer += dk.keylock_ring_hoerbar() ? 1 : 0; beteiligt += dk.keylock_ring_beteiligt() ? 1 : 0; };
    k.sekunden(2.0);
    bau.join();
    const int64_t e = k.kern->sample() - 4800;
    const double ct_aus = 1200.0 * std::log2(km::freq(k.ch[0], e - 4800, e) / 1000.0);
    const int64_t ab = k.kern->keylock_ab();
    const bool an_aus = dk.keylock_an();
    int64_t s_an = k.kern->sample(), s_ring = -1;
    k.teil("keylock", 1.0f, k.beat() + 0.25, "cypher");  // Gegenprobe: an -> Ring
    k.je_zyklus = [&] { if (s_ring < 0 && dk.keylock_ring_hoerbar()) s_ring = k.kern->sample(); };
    k.sekunden(1.0);
    k.je_zyklus = nullptr;
    std::printf("  knopf_spaet a: gebaut %d, angehängt %lld, Ring hörbar %lld / beteiligt %lld Zyklen bei aus, Keylock an %d, "
                "Tonhöhe %+.2f ct (Soll +53,3); nach an: Ring nach %.1f ms\n", (int)gebaut.load(), (long long)ab,
                (long long)hoer, (long long)beteiligt, (int)an_aus, ct_aus, s_ring >= 0 ? (s_ring - s_an) / 48.0 : -1.0);
    PRUEF(gebaut && ab > 0 && hoer == 0 && beteiligt == 0 && !an_aus);
    PRUEF(std::fabs(ct_aus - 1200.0 * std::log2(132.0 / 128.0)) < 1.0);
    PRUEF(s_ring > 0 && s_ring - s_an < 48000);
  }
  {
    const std::string pfad = AB + "/zustand_knopf";
    KRing r1;
    int64_t W1 = 0;
    {
      Lauf k1(Weg::OHNE, false, &r1, 1'000'000);
      k1.betrieb.reset(new cdj::Betrieb());
      PRUEF(k1.betrieb->starte(pfad, *k1.kern).datei_ok);
      k1.auf_132();
      k1.laden(1, MAT);
      k1.teil("deck/1/fader", 0.0f, 2.0);
      k1.teil("keylock", 0.0f, 2.0, "cypher");
      k1.start(1, 4.0, 0.0);
      k1.bis((int64_t)(14.0 * 22500));
      PRUEF(k1.kern->deck(1).laeuft() && !k1.kern->keylock_knopf());
      W1 = k1.W;
    }
    Lauf k2(Weg::ANGEKUENDIGT, true, &r1, W1 + 1920);
    k2.betrieb.reset(new cdj::Betrieb());
    PRUEF(k2.betrieb->starte(pfad, *k2.kern).fortgesetzt);
    PRUEF(k2.kern->decks_nachladen(k2.lader) == 1);
    k2.zyklus();
    std::atomic<bool> gebaut{false};
    std::thread bau([&] { gebaut = k2.kern->keylock_bauen(0); });
    const cdj::Deck& dk = k2.kern->deck(1);
    int64_t hoer = 0;
    k2.je_zyklus = [&] { hoer += dk.keylock_ring_hoerbar() ? 1 : 0; };
    k2.sekunden(2.0);
    k2.je_zyklus = nullptr;
    bau.join();
    std::printf("  knopf_spaet b: Neustart, Knopf aus gespeichert: Knopf %d, gebaut %d, angehängt %lld, Ring hörbar %lld Zyklen, "
                "Keylock an %d, läuft %d\n", (int)k2.kern->keylock_knopf(), (int)gebaut.load(), (long long)k2.kern->keylock_ab(),
                (long long)hoer, (int)dk.keylock_an(), (int)dk.laeuft());
    PRUEF(!k2.kern->keylock_knopf() && gebaut && k2.kern->keylock_ab() > 0 && hoer == 0 && !dk.keylock_an() && dk.laeuft());
  }
  ergebnis("faeden_knopf_spaet");
}

// ------------------------------------------------------------------------------------------ neustart (2.5b, F2)
// Neustart mitten im Spiel (Zustandsdatei, decks_nachladen wie main.cpp): Zeit vom Anlegen des Kerns bis zum ersten
// Zyklus ohne Keylock, mit dem Weg von Stand 2.5 (setze_keylock_vorgabe synchron) und mit dem Betriebsweg (angekündigt,
// Bau danach im eigenen Faden). Betriebsweg: bis zum Anhängen bitgleich zum Kern ohne Keylock (nicht stiller), dann Ring.
void test_neustart() {
  const std::string pfad = AB + "/zustand_neustart";
  KRing r1;
  int64_t W_absturz = 0;
  {
    Lauf k1(Weg::OHNE, false, &r1, 1'000'000);
    k1.betrieb.reset(new cdj::Betrieb());
    PRUEF(k1.betrieb->starte(pfad, *k1.kern).datei_ok);
    k1.auf_132();
    k1.laden(1, MAT);
    k1.teil("deck/1/fader", 0.0f, 2.0);
    k1.start(1, 4.0, 0.0);
    k1.bis((int64_t)(14.0 * 22500));
    PRUEF(k1.kern->deck(1).laeuft());
    W_absturz = k1.W;
  }
  const std::string ring_kopie(reinterpret_cast<const char*>(r1.mem.get()), CDJ_RING_BYTES);
  fs::copy_file(pfad, pfad + ".k1", fs::copy_options::overwrite_existing);
  struct Erg {
    double ms_erster = 0;
    std::vector<float> L;
    int64_t s0 = 0, ab = -1, s_ring = -1;
    double bau_ms = -1;
  } erg[3];
  const Weg wege[3] = {Weg::OHNE, Weg::ALT, Weg::BETRIEB};
  for (int v = 0; v < 3; ++v) {
    std::memcpy(r1.mem.get(), ring_kopie.data(), CDJ_RING_BYTES);
    fs::copy_file(pfad + ".k1", pfad, fs::copy_options::overwrite_existing);
    // BETRIEB: nur angekündigt im Startpfad, gebaut wird nach dem ersten Zyklus (wie main.cpp nach READY)
    Lauf k2(v == 2 ? Weg::ANGEKUENDIGT : wege[v], v == 2, &r1, W_absturz + 1920);
    k2.betrieb.reset(new cdj::Betrieb());
    const cdj::Wiederaufnahme w = k2.betrieb->starte(pfad, *k2.kern);
    PRUEF(w.fortgesetzt);
    PRUEF(k2.kern->decks_nachladen(k2.lader) == 1);
    k2.zyklus();
    erg[v].ms_erster = (k2.t_erster - k2.t_anfang) / 1e6;
    erg[v].s0 = k2.kern->sample() - B;
    if (v == 1) continue;  // Stand 2.5: nur die Startzeit
    std::thread bau;
    std::atomic<int64_t> bau_ns{-1};
    if (v == 2)
      bau = std::thread([&] {
        const int64_t t = jetzt_ns();
        PRUEF(k2.kern->keylock_bauen(0));
        bau_ns = jetzt_ns() - t;
      });
    const cdj::Deck& dk = k2.kern->deck(1);
    k2.je_zyklus = [&] {
      if (erg[v].s_ring < 0 && dk.keylock_ring_hoerbar()) erg[v].s_ring = k2.kern->sample();
    };
    k2.bis(erg[v].s0 + 96000);
    k2.je_zyklus = nullptr;
    if (bau.joinable()) bau.join();
    erg[v].bau_ms = bau_ns.load() / 1e6;
    erg[v].ab = k2.kern->keylock_ab();
    erg[v].L = k2.ch[0];
  }
  // bitgleich bis zum Anhängen (Kanal Master links), dazu der erste hörbare Block nach dem Neustart
  const int64_t bis = erg[2].ab > 0 ? erg[2].ab - 2 * B : erg[2].s0;  // vor dem Anhängen (Vorhalt des Limiters)
  int64_t ungleich = 0, erstes_ton[2] = {-1, -1};
  for (int64_t i = erg[2].s0; i < bis; ++i)
    ungleich += erg[0].L[(size_t)i] != erg[2].L[(size_t)i] ? 1 : 0;
  for (int v : {0, 2})
    for (int64_t i = erg[v].s0; i < erg[v].s0 + 48000; ++i)
      if (std::fabs(erg[v].L[(size_t)i]) > 0.01f) {
        erstes_ton[v == 2] = i - erg[v].s0;
        break;
      }
  std::printf("  neustart: bis zum ersten Zyklus ohne Keylock %.1f ms, Stand 2.5 (Dehner im Startpfad) %.1f ms, Betriebsweg "
              "%.1f ms; Betriebsweg: Bau %.1f ms, angehängt %.1f ms nach dem ersten Block, Ring hörbar %.1f ms danach; "
              "erster Ton nach %lld bzw. %lld Samples (ohne / Betrieb); bis zum Anhängen %lld von %lld Samples ungleich\n",
              erg[0].ms_erster, erg[1].ms_erster, erg[2].ms_erster, erg[2].bau_ms,
              erg[2].ab >= 0 ? (erg[2].ab - erg[2].s0) / 48.0 : -1.0,
              erg[2].s_ring >= 0 ? (erg[2].s_ring - erg[2].ab) / 48.0 : -1.0, (long long)erstes_ton[0],
              (long long)erstes_ton[1], (long long)ungleich, (long long)(bis - erg[2].s0));
  PRUEF(erg[1].ms_erster > erg[0].ms_erster + 100.0);  // Fehlerfall von Stand 2.5 sichtbar (Dehner im Startpfad)
  PRUEF(erg[2].ms_erster < erg[0].ms_erster + 20.0);   // Betriebsweg: nicht später als ohne Keylock
  PRUEF(erg[2].ab > erg[2].s0 && bis - erg[2].s0 > 4800 && ungleich == 0);
  PRUEF(erstes_ton[0] >= 0 && erstes_ton[1] == erstes_ton[0]);
  PRUEF(erg[2].s_ring > erg[2].ab);
  fs::remove(pfad);
  fs::remove(pfad + ".k1");
  ergebnis("faeden_neustart");
}

// ------------------------------------------------------------------------------------------ sperre (2.5c)
// Nur der Dehner-Speicher wird gesperrt (keylock_bauen sperren = true), nicht ein zweites mlockall(MCL_CURRENT). Wie in
// main.cpp: erst mlockall(MCL_CURRENT) (sperrt alle Bereiche, die es dann gibt; was dort später belegt wird, ist mit
// gesperrt), dann der Bau. Grenze für den Zuwachs: was der Bau berührt hat (VmRSS beim Bau) plus die Stapel der 6
// Keylock-Fäden ganz (6 · KEYLOCK_STAPEL) plus 1 MiB für Seiten anderer Fäden in neuen Bereichen. Vollständig: nach dem
// Bau ist keine residente anonyme Seite ungesperrt (smaps Rss − Locked, Grenze 256 KiB). Gegenproben: ohne sperren bleiben
// die neuen Seiten ungesperrt (das Maß sieht sie); der Weg von Stand 2.5b (zweites mlockall) sperrt mehr; ohne Recht
// (RLIMIT_MEMLOCK 0 während des Baus) gemeldet, Keylock läuft.
int64_t status_kib(const char* feld) {
  FILE* f = std::fopen("/proc/self/status", "r");
  char z[256];
  int64_t v = -1;
  const size_t n = std::strlen(feld);
  while (f && std::fgets(z, sizeof z, f))
    if (!std::strncmp(z, feld, n)) v = std::atoll(z + n);
  if (f) std::fclose(f);
  return v;
}

// Residente, nicht gesperrte Seiten in anonymen rw-Bereichen (smaps: Rss − Locked), KiB
int64_t ungesperrt_kib() {
  FILE* f = std::fopen("/proc/self/smaps", "r");
  char z[512];
  bool anon = false;
  int64_t rss = 0, summe = 0;
  while (f && std::fgets(z, sizeof z, f)) {
    unsigned long a, e, off, ino;
    char perm[8], dev[16], pfad[256] = "";
    if (std::sscanf(z, "%lx-%lx %7s %lx %15s %lu %255s", &a, &e, perm, &off, dev, &ino, pfad) >= 6) {
      anon = perm[0] == 'r' && perm[1] == 'w' && ino == 0 && (!pfad[0] || !std::strcmp(pfad, "[heap]"));
    } else if (!std::strncmp(z, "Rss:", 4)) {
      rss = std::atoll(z + 4);
    } else if (!std::strncmp(z, "Locked:", 7) && anon) {
      summe += rss - std::atoll(z + 7);
    }
  }
  if (f) std::fclose(f);
  return summe;
}

void test_sperre() {
  const int64_t stapel_kib = (int64_t)cdj::KEYLOCK_FAEDEN * (int64_t)(cdj::KEYLOCK_STAPEL >> 10);
  // eigener Prozess (ctest test_kern_keylock_faeden_sperre): im Lauf aller Tests läge der Bau in Speicher, den frühere
  // Tests schon belegt und freigegeben haben (kein neuer Bereich), und das Maß sähe nichts
#if defined(__SANITIZE_THREAD__)
  // gemessen 08.10. (task-025-fix/2_5c_tsan.txt): unter TSan bleibt VmLck auch nach mlockall(MCL_CURRENT) == 0 unverändert
  // (+0 KiB), die Sperre ist dort nicht messbar. Der Weg (keylock_sperren) läuft im Rest des Tests unter TSan mit.
  std::printf("  sperre: unter ThreadSanitizer nicht messbar (mlock ohne Wirkung auf VmLck), übersprungen\n");
  {
    Lauf k(Weg::ANGEKUENDIGT, true);
    PRUEF(k.kern->keylock_bauen(0, true));  // der Weg selbst unter TSan
  }
  ergebnis("faeden_sperre");
  return;
#endif
  int64_t lck_neu = 0, rss_neu = 0;
  {  // a) Betriebsweg
    Lauf k(Weg::ANGEKUENDIGT, true);
    PRUEF(mlockall(MCL_CURRENT) == 0);  // wie main.cpp vor dem Bau
    const int64_t l0 = status_kib("VmLck:"), r0 = status_kib("VmRSS:"), u0 = ungesperrt_kib();
    PRUEF(k.kern->keylock_bauen(0, true));
    lck_neu = status_kib("VmLck:") - l0;
    rss_neu = status_kib("VmRSS:") - r0;
    const int64_t u1 = ungesperrt_kib();
    munlockall();
    const int64_t grenze = rss_neu + stapel_kib + 1024;
    std::printf("  sperre a) Betriebsweg: VmLck +%lld KiB (gemeldet %llu KiB), VmRSS beim Bau +%lld KiB, Stapel %lld KiB, "
                "Grenze %lld KiB, Fehler %d; resident ungesperrt vorher %lld KiB, nachher %lld KiB\n",
                (long long)lck_neu, (unsigned long long)(k.kern->keylock_gesperrt() >> 10), (long long)rss_neu,
                (long long)stapel_kib, (long long)grenze, k.kern->keylock_sperr_fehler(), (long long)u0, (long long)u1);
    PRUEF(k.kern->keylock_sperr_fehler() == 0);
    PRUEF(lck_neu >= stapel_kib && lck_neu <= grenze);
    PRUEF(u1 <= 256);  // vollständig: was der Bau berührt hat, ist gesperrt
  }
  {  // b) ohne sperren: die neuen Seiten bleiben ungesperrt (Gegenprobe für das Maß aus a)
    Lauf k(Weg::ANGEKUENDIGT, true);
    PRUEF(mlockall(MCL_CURRENT) == 0);
    const int64_t l0 = status_kib("VmLck:");
    PRUEF(k.kern->keylock_bauen(0, false));
    const int64_t d = status_kib("VmLck:") - l0, u1 = ungesperrt_kib();
    munlockall();
    std::printf("  sperre b) ohne sperren: VmLck +%lld KiB, resident ungesperrt %lld KiB\n", (long long)d, (long long)u1);
    PRUEF(u1 > 4096);  // ohne gezieltes Sperren sieht das Maß den Dehner-Speicher
  }
  {  // c) ohne Recht: RLIMIT_MEMLOCK auf den Stand, der Keylock läuft trotzdem
    Lauf k(Weg::ANGEKUENDIGT, true);
    rlimit rl{};
    PRUEF(getrlimit(RLIMIT_MEMLOCK, &rl) == 0);
    rlimit eng = rl;
    eng.rlim_cur = 0;  // jedes mlock scheitert (EPERM); nur um den Bau, das Laden danach sperrt wieder
    PRUEF(setrlimit(RLIMIT_MEMLOCK, &eng) == 0);
    const bool gebaut = k.kern->keylock_bauen(0, true);
    PRUEF(setrlimit(RLIMIT_MEMLOCK, &rl) == 0);
    k.auf_132();
    PRUEF(k.warte(k.laden(1, MAT), 3, 2.0) >= 0);
    k.start(1, std::ceil(k.beat()) + 0.5, 0.0);
    k.sekunden(1.5);
    std::printf("  sperre c) RLIMIT_MEMLOCK eng: gebaut %d, Fehler %d (%s), gesperrt %llu KiB, Ring hörbar %d\n", (int)gebaut,
                k.kern->keylock_sperr_fehler(), std::strerror(k.kern->keylock_sperr_fehler()),
                (unsigned long long)(k.kern->keylock_gesperrt() >> 10), (int)k.kern->deck(1).keylock_ring_hoerbar());
    PRUEF(gebaut && k.kern->keylock_sperr_fehler() != 0 && k.kern->deck(1).keylock_ring_hoerbar());
  }
  ergebnis("faeden_sperre");
}

// Vergleich in eigenem Prozess (ctest test_kern_keylock_faeden_sperre_alt): Stand 2.5b sperrte nach dem Bau mit einem
// zweiten mlockall(MCL_CURRENT). Nur ausgewiesen, nicht geprüft (Zahl der Nachprüfung im Kern-Prozess: +74 828 KiB).
void test_sperre_alt() {
  {  // d) Vergleich: Stand 2.5b (mlockall vor und noch einmal nach dem Bau), danach munlockall
    Lauf k(Weg::ANGEKUENDIGT, true);
    PRUEF(mlockall(MCL_CURRENT) == 0);
    const int64_t l0 = status_kib("VmLck:");
    PRUEF(k.kern->keylock_bauen(0, false));
    PRUEF(mlockall(MCL_CURRENT) == 0);
    const int64_t d = status_kib("VmLck:") - l0;
    munlockall();
    std::printf("  sperre d) Vergleich mlockall(MCL_CURRENT) nach dem Bau: VmLck +%lld KiB\n", (long long)d);
  }
  ergebnis("faeden_sperre_alt");
}

}  // namespace

int main(int argc, char** argv) {
  AB = "/dev/shm/test_kern_keylock_faeden_" + std::to_string(getpid());
  fs::create_directories(AB);
  klick(std::string("--material-id ") + MAT + " --beats 40 --sinus-links 1000");
  klick(std::string("--material-id ") + MAT_B + " --beats 40");
  {  // 132er Fassung von MAT für den Tausch (wie test_kern_deck 11)
    const std::string ab2 = AB + "_132";
    const std::string c = "/usr/bin/python3 " + std::string(CYPHERDJ_DJK) + "/kern/tests/deck/klick_fassung.py --ziel " + ab2 +
                          " --material-id " + MAT + " --beats 40 --bpm 132 --sinus-links 1000 > /dev/null && mv " + ab2 + "/" +
                          MAT + "/fassungen/132000_r1 " + AB + "/" + MAT + "/fassungen/ && rm -rf " + ab2;
    PRUEF(std::system(c.c_str()) == 0);
  }
  struct T {
    const char* name;
    void (*f)();
  };
  const T tests[] = {{"rampe", test_rampe}, {"quittung", test_quittung}, {"waechter", test_waechter},
                     {"stopp", test_stopp}, {"prio", test_prio}, {"startfehler", test_startfehler},
                     {"spaet", test_spaet}, {"neustart", test_neustart}, {"knopf", test_knopf},
                     {"konfig", test_konfig}, {"sperre", test_sperre}, {"sperre_alt", test_sperre_alt},
                     {"loop", test_loop}, {"box", test_box},
                     {"knopf_spaet", test_knopf_spaet}, {"zaehler", test_zaehler}};
  for (const T& t : tests) {
    const bool allein = !std::strncmp(t.name, "sperre", 6);  // nur in eigenem Prozess (frischer Speicher)
    if ((argc < 2 && !allein) || (argc >= 2 && !std::strcmp(argv[1], t.name))) t.f();
  }
  fs::remove_all(AB);
  PRUEF_ENDE();
}
