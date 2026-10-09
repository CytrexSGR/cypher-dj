// Umbauplan 2026-10-09-bungee-umbau, S2: der Kern mit keylock_maschine = bungee. Bungee fährt synchron im Callback am Zyklusende
// (Kern::keylock_antrieb), ohne Vorbereiter, Arbeits-Threads und Wächter. Der Test spielt nur den Callback, ohne JACK und ohne
// Takt (kein Faden: Kern::zyklus in einer Schleife ist hier der ganze Antrieb). Gebaut nur mit -DCYPHERDJ_BUNGEE=ON.
// Tests (Aufruf ohne Argument: alle):
//   deck      Deck 1 (Sinus 1000 Hz links) spielt bei 128, Rampe auf 135 über 2 Beats, danach 5 s bei 135: Weg wie im Betrieb
//             (keylock_ankuendigen, keylock_bauen), keine Fäden (keylock_faeden_laufen() false), 6 Dehner, die Epochen
//             quittiert; ab dem Ring in jedem Zyklus keylock_hoerweg() = 1, Unterläufe 0, aufgegeben 0, Tonhöhe je 100-ms-Fenster
//             ±2 ct, kein Null-Lauf (die Gegenprobe ist der Fehlerfall: ohne Antrieb spielt das Deck Varispeed, +90 ct)
//   rueckfall keylock_maschine r3: derselbe Weg startet die Fäden (keylock_faeden_laufen() true), Bungee nicht
// Fehlerfall (CMake test_mutation, WILL_FAIL): CYPHERDJ_MUTATION_KEIN_ANTRIEB (niemand treibt die Dehner: der Ring wird nie
// hörbar, deck rot).
#include <unistd.h>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <memory>
#include <string>
#include <vector>

#include "cypherdj/kern.h"
#include "cypherdj/lader.h"
#include "keylock_mess.h"
#include "pruef.h"

namespace {

namespace fs = std::filesystem;
using cdj::Karte;
using km::B;

constexpr const char* MAT = "c1c0000000003501";  // Sinus 1000 Hz links, Klick rechts, Basis 128
std::string AB;

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

struct Lauf {
  KRing ring;
  std::unique_ptr<cdj::Befehlsring> bef{new cdj::Befehlsring()};
  std::unique_ptr<cdj::Ereignisring> ere{new cdj::Ereignisring()};
  std::unique_ptr<cdj::LaderRinge> lr{new cdj::LaderRinge()};
  cdj::Lader lader;
  std::unique_ptr<cdj::Kern> kern;
  std::vector<float> L;  // Master links je Kern-Sample (um den Vorhalt des Limiters zurückgerechnet)
  int64_t id = 100;
  Lauf(cdj::DehnerMaschine m, bool fein = false) : lader(AB, 3800LL << 20) {
    kern.reset(new cdj::Kern(128.0, ring.k, bef.get(), ere.get()));
    kern->verbinde_lader(lr.get());
    kern->setze_keylock_maschine(m, fein);
    PRUEF(kern->keylock_ankuendigen());
    PRUEF(kern->keylock_bauen(0));  // wie main.cpp (ohne JACK-Priorität und ohne Sperre)
    L.reserve(48000 * 20);
  }
  cdj::Befehl neu(int art, const char* quelle = "pruefstand") {  // nie als Andreas' Hand
    cdj::Befehl b{};
    b.art = art;
    b.id = ++id;
    std::snprintf(b.quelle, sizeof b.quelle, "%s", quelle);
    return b;
  }
  void sende(const cdj::Befehl& b) { PRUEF(bef->schiebe(b)); }
  void laden(int d, const char* mid) {
    cdj::Befehl b = neu(cdj::Befehl::DECK_LADEN, "leitstand");
    b.deck = d;
    std::snprintf(b.material_id, sizeof b.material_id, "%s", mid);
    b.bpm = 128.0;
    b.fassung = 1;
    sende(b);
  }
  void start(int d, double ab, double quell) {
    cdj::Befehl b = neu(cdj::Befehl::DECK_START);
    b.deck = d;
    b.ab_beat = ab;
    b.quell_beat = quell;
    sende(b);
  }
  void teil(const char* pfad, float wert, double ab) {
    cdj::Befehl b = neu(cdj::Befehl::TEIL);
    std::snprintf(b.pfad, sizeof b.pfad, "%s", pfad);
    b.ab_beat = ab;
    b.wert = wert;
    b.politik = 1;
    sende(b);
  }
  void rampe(double ab, double ziel, double dauer) {
    cdj::Befehl b = neu(cdj::Befehl::TEMPO_RAMPE);
    b.ab_beat = ab;
    b.ziel_bpm = ziel;
    b.dauer_beats = dauer;
    sende(b);
  }
  void zyklus() {
    const int64_t n0 = kern->sample();
    const uint64_t w0 = cdj_lade(&ring.k->w);
    kern->zyklus(B, n0 * 20833);  // monotone Zeit in ns (nur für die Kern-Uhr)
    lader.einmal(*lr);
    const float* x = cdj_ring_daten_c(ring.k);
    const int vh = kern->mixer().limiter_vorhalt();
    if (static_cast<int64_t>(L.size()) < n0 + B) L.resize(static_cast<std::size_t>(n0 + B), 0.0f);
    for (int i = 0; i < B; ++i)
      if (n0 + i - vh >= 0) L[static_cast<std::size_t>(n0 + i - vh)] = x[((w0 + static_cast<uint64_t>(i)) % CDJ_RING_CAP) * 4];
    cdj::Ereignis e;
    while (ere->hole(e)) {
    }
  }
  void bis(int64_t s) {
    while (kern->sample() < s) zyklus();
  }
};

void klick(const std::string& args) {
  const std::string c = "/usr/bin/python3 " + std::string(CYPHERDJ_DJK) + "/kern/tests/deck/klick_fassung.py --ziel " + AB + " " + args +
                        " > /dev/null";
  PRUEF(std::system(c.c_str()) == 0);
}

void test_deck() {
  std::printf("-- deck\n");
  constexpr double START = 8.0, RAMPE_AB = 12.0, RAMPE_BEATS = 2.0;
  Karte soll(128.0, 0);
  PRUEF(soll.rampe(RAMPE_AB, 135.0, RAMPE_BEATS));
  const int64_t s_rampe_ende = static_cast<int64_t>(soll.sample_at(RAMPE_AB + RAMPE_BEATS));
  const int64_t ende = s_rampe_ende + 5 * 48000;
  // der Ring wird erst nach der Rampe vorausgesetzt: Ereignis (Rampe) + Frist + Einschwingen + Blende + Reserve
  const int64_t s_ring = s_rampe_ende + cdj::ANSATZ_FRIST + cdj::DECK_KEYLOCK_EINSCHWING + 2 * cdj::DECK_KEYLOCK_BLENDE + 4 * B;

  Lauf k(cdj::DehnerMaschine::Bungee);
  PRUEF(!k.kern->keylock_faeden_laufen());  // Kern ohne Fäden
  for (int d = 1; d <= 6; ++d) PRUEF(k.kern->keylock_dehner(d) != nullptr);
  k.laden(1, MAT);
  k.teil("deck/1/fader", 0.0f, 6.0);
  k.start(1, START, 0.0);
  k.rampe(RAMPE_AB, 135.0, RAMPE_BEATS);
  int64_t zyklen = 0, hoer = 0, hoer_soll = 0;
  while (k.kern->sample() < ende) {
    k.zyklus();
    ++zyklen;
    if (k.kern->sample() > s_ring) {
      ++hoer_soll;
      hoer += k.kern->deck(1).keylock_hoerweg();
    }
  }
  const cdj::Deck& dk = k.kern->deck(1);
  std::printf("   %lld Zyklen, hoerweg %lld/%lld, Unterlaeufe %llu, aufgegeben %llu, Faeden %d, Deck laeuft %d\n",
              static_cast<long long>(zyklen), static_cast<long long>(hoer), static_cast<long long>(hoer_soll),
              static_cast<unsigned long long>(dk.keylock_unterlauf()), static_cast<unsigned long long>(dk.keylock_aufgegeben()),
              k.kern->keylock_faeden_laufen() ? 1 : 0, dk.laeuft() ? 1 : 0);
  PRUEF(dk.laeuft());
  PRUEF(hoer_soll > 200 && hoer == hoer_soll);  // ab dem Ring in jedem Zyklus der Ring
  PRUEF(dk.keylock_unterlauf() == 0);
  PRUEF(dk.keylock_aufgegeben() == 0);
  // alle sechs Dehner haben ihre Leer-Epoche oder ihren Ansatz quittiert (kein Faden, der es sonst täte)
  for (int d = 1; d <= 6; ++d) {
    const cdj::DehnerBasis* dh = k.kern->keylock_dehner(d);
    PRUEF(dh->quittiert_e() == dh->epoche());
  }
  // Tonhöhe je 100-ms-Fenster ab dem Ring bis zum Ende
  double max_ct = 0;
  int fenster = 0, ueber = 0, null_laeufe = 0;
  for (int64_t s = s_ring; s + 4800 <= ende; s += 4800) {
    const double ct = 1200.0 * std::log2(km::freq(k.L, s, s + 4800) / 1000.0);
    max_ct = std::max(max_ct, std::fabs(ct));
    if (std::fabs(ct) > 2.0) ++ueber;
    ++fenster;
  }
  int lauf = 0;
  for (int64_t s = s_ring; s < ende; ++s) {
    if (k.L[static_cast<std::size_t>(s)] == 0.0f) {
      if (++lauf == 32) ++null_laeufe;
    } else {
      lauf = 0;
    }
  }
  std::printf("   Tonhoehe: %d Fenster, max |Abweichung| %.3f ct, ueber 2 ct: %d, Null-Laeufe %d\n", fenster, max_ct, ueber, null_laeufe);
  PRUEF(fenster >= 40);
  PRUEF(ueber == 0 && null_laeufe == 0);
}

void test_rueckfall() {
  std::printf("-- rueckfall\n");
  Lauf k(cdj::DehnerMaschine::R3);  // der alte Weg: Vorbereiter, Arbeits-Threads, Wächter
  PRUEF(k.kern->keylock_faeden_laufen());
  k.kern->keylock_faeden_stoppen();
  PRUEF(!k.kern->keylock_faeden_laufen());
}

}  // namespace

int main(int argc, char** argv) {
  AB = "/dev/shm/test_kern_keylock_bungee_" + std::to_string(getpid());
  fs::create_directories(AB);
  klick(std::string("--material-id ") + MAT + " --beats 40 --sinus-links 1000");
  const std::string was = argc > 1 ? argv[1] : "alle";
  if (was == "alle" || was == "deck") test_deck();
  if (was == "alle" || was == "rueckfall") test_rueckfall();
  fs::remove_all(AB);
  PRUEF_ENDE();
}
