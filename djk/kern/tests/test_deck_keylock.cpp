// Keylock in Echtzeit, Task 2 (Plan docs/superpowers/plans/2026-10-06-keylock-echtzeit.md): das Deck spielt den Ring.
// Dehner synchron: der Test spielt den Callback (Deck::block je 256er-Block), danach den Vorbereiter (StreckPost::takt)
// und den Arbeits-Thread (fuelle_synchron), in dieser Reihenfolge. Messgrößen: keylock_mess.h (wie test_dehner).
//
// Tests (Aufruf ohne Argument: alle; mit Namen nur einer, z. B. `test_deck_keylock lebensdauer` für den TSan-Bau):
//   1 keylock_tonhoehe_in_rampe   Sinus, 128 -> 132 über 8 Beats ab Beat 4: jedes 100-ms-Fenster ab s_h ±2 ct, 0 Null-Läufe
//   2 keylock_lage_in_rampe       Klick, 128 -> 132 über 32 Beats ab Beat 8: Lage (a) Mittel (seit 4.6 ausgewiesen) und (b) je Klick ±12
//   3 keylock_bruecke             Start aus dem Stand bei 132, 100 Samples im Block: bis s_e = s_h + EINSCHWING Varispeed
//                                 (1031,25 Hz), ab s_e + 960 1000 Hz; Blende <= 0,02 gegen den idealen Übergang (die Blende
//                                 beginnt nach dem Einschwingen des Rings, deck.h DECK_KEYLOCK_EINSCHWING, gemessen)
//   4 keylock_basis_bitgleich     Karte 128: bitgleich zum Deck ohne Keylock, Ring warm (gelesen, nicht hörbar)
//   5 keylock_aus_ist_varispeed   Schalter aus: bitgleich zum Deck ohne Keylock; an -> aus im Ring: nach der Blende bitgleich
//   6 keylock_sprung              Sprung 4 Beats bei 132 im Ring: Blende alte Epoche -> Brücke <= 0,02, danach (a)/(b), ±2 ct
//   7 keylock_stopp_rampe         10-ms-Rampe auf der Ring-Ausgabe, danach Stille und Leer-Epoche
//   8 keylock_neustart            Kern: Zustand mitten in der Rampe, neuer Kern mit Material: Ansatz, danach (a)/(b)
//   9 keylock_lebensdauer         Vertrag 4: Vorbereiter und Arbeits-Thread echt, 2000 Ereignisse (TSan 300; Tausch, Laden, Entladen,
//                                 Sprung, Start, Stopp, Loop, Schalter); Material nach der Rückgabe mprotect(PROT_NONE)
//  10 keylock_frist_verpasst      Vertrag 5: ohne Vorbereiter wandert s_h 8 Mal, dann aufgegeben (Varispeed)
//  11 keylock_allokation          0 Allokationen in Deck::block mit Keylock (Positiv-Kontrolle)
//  12 keylock_unterlauf           Vertrag 2: Arbeits-Thread setzt aus, der Ring reißt: sofort Varispeed (bitgleich zum
//                                 Varispeed-Weg), Zähler 1, neuer Ansatz, danach klingt wieder der Ring
//  14 keylock_einschwingen_klick  Einschwingen am Klick-Material gemessen; DECK_KEYLOCK_EINSCHWING >= 1408 (Task 2c)
//  15 keylock_ereignis_in_blende  Prüfung M1: 16tel-Jonglage und Doppelsprung in der Blende, kein Knack
//  16 keylock_stopp_in_blende     Prüfung m3: Stopp-Rampe auch auf dem Eingefrorenen
//  17 keylock_rueck_warten        Prüfung m4, Vertrag 4 (Kern): 9 und 12 Wechsel ohne Quittung, Laden/Entladen warten
//  18 keylock_stems               Prüfung F8: Stem-Griff wirkt im Ring, Verzögerung gemessen
//  19 keylock_leser_grenzen      StreckLeser allein: Einfrieren erst ab 128 Frames (Vertrag 8), Block über 1024 (N5)
//  20 keylock_stopp_laden         Nachprüfung N1: Laden/Entladen/Tausch in der Stopp-Rampe bei hörbarem Ring
//  22 keylock_frist_erfolg        Vertrag 5 Erfolgsweg: s_h wandert einmal, dann klingt der Ring
//  23 keylock_loop              Task 5: Loop 4 Beats bei 132, drei Durchläufe: ±2 ct, Blende an jeder Naht <= 0,02, Klick am
//                                 Loop-Anfang ±12 gegen das Soll aus Karte und Loop, Lage (a) Mittel (seit 4.6 ausgewiesen), (b) je Klick ±12
//  24 keylock_loop_laengen       Task 5: dasselbe mit 1 und 16 Beats
//  25 keylock_loop_basis         Task 5: Loop bei Basis 128 bitgleich zum Direktweg, Ring warm mit dem Loop-Band
//  26 keylock_loop_rampe         Task 5: Loop in der Rampe 128 -> 132: Lage hält, ±2 ct
//  27 keylock_loop_an_aus        Task 5, Vertrag 6: Loop an und aus bei klingendem Ring: Blende <= 0,02 auf die Brücke, Ring danach
//  28 keylock_loop_band          Task 5: DeckBand mit Loop bitgleich zum Direktweg-Strom (Naht samt 128-Frame-Blende)
//  29 keylock_loop_raster        Task 5b: Raster schiebt den Loop aus dem Material bei klingendem Ring: Ton wie Varispeed
//  30 keylock_loop_drift         Task 5b: Loop aus nach 60 (4 Beats) bzw. 200 (1/4 Beat) Durchläufen: Klick ±12 gegen das
//                                 Ideal, Keylock und Varispeed (Naht ohne Rundungsverlust)
//  31 keylock_loop_naht          Task 5b: Naht im Ring mit Rauschen, bitgleich zu einem Bezug-Dehner mit dem Direktweg-Strom
//  32 keylock_basis_nach_rampe Keylock 7b.1: Rampe auf die Basis 128 bei klingendem Ring: der Ring bleibt hörbar (Pegel
//                                 ≥ −0,5 dB, ±2 ct), nach einem Ereignis auf der Basis bitgleich zum Direktweg
//  33 keylock_loop_beatraster  Loop-Drift: Basis 125,3 und 130, Loop 4 und 1 Beat, 64 Durchläufe: Lage des Loop-Anfangs
//                                 gegen das Beat-Raster ≤ 1 Frame, Direktweg, Varispeed und Ring (Band über den Anker)
//  34 keylock_loop_basis128_alt Loop-Drift, Negativ-Kontrolle: Basis 128 bitgleich zum Stand vor dem Fix (Prüfsummen)
//  35 keylock_loop_ansatz_band  Loop-Drift (Prüfung F1, F4): Band eines Ansatzes mitten im Loop (Keylock aus/an, Play mit
//                                 gehaltenem Loop vor a0, in [a0, A), im Loop) bitgleich zum Direktweg, Basis 125,3 und 128
//  36 keylock_loop_tausch       Loop-Drift (Prüfung F3): Fassungstausch 125,3 -> 130 im Loop: Spanne der Lage ≤ 1, Lage ≤ 1,5 Frames
//  13 keylock_fuellen_abbruch     Dehner-Füllschleife: verwirft die Quelle die alte Epoche, während der Thread füllt, kehrt
//                                 fuelle_synchron() nach höchstens Ringgröße Abschnitten zurück und übernimmt den neuen
//                                 Ansatz (vorher Livelock unter Last, task-02/tsan_haenger_beobachtet.txt); deterministisch gestellt
// Fehlerfälle (CMake deck_keylock_mutation, WILL_FAIL): CYPHERDJ_MUTATION_KEYLOCK_OHNE_BRUECKE (Ring nach dem Einschwingen
// ohne Blende) -> nur Test 3 rot; CYPHERDJ_MUTATION_KEYLOCK_NEUSTART_OHNE_ANSATZ (kein Ansatz nach dem Neustart) -> Test 8 rot.
#include <signal.h>
#include <sys/mman.h>
#include <sys/wait.h>
#include <unistd.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <memory>
#include <random>
#include <string>
#include <thread>
#include <vector>

#include "keylock_mess.h"
#include "cypherdj/deck.h"
#include "cypherdj/dehner.h"
#include "cypherdj/kern.h"
#include "cypherdj/neustart.h"
#include "cypherdj/streck_quelle.h"
#include "cypherdj/zustand.h"
#include "pruef.h"
// zuletzt: Rubber Band und kern.h binden mm_malloc.h (posix_memalign ohne noexcept), der Abfang definiert es danach
#include "alloc_abfang.h"

namespace {

using cdj::DehnerAnker;
using cdj::Karte;
using km::B;
using km::FPB;
using km::PI;

int test_fehler_vorher = 0;
void ergebnis(const char* name) {
  std::printf("TEST %s: %s\n", name, pruef_fehler == test_fehler_vorher ? "gruen" : "ROT");
  std::fflush(stdout);
  test_fehler_vorher = pruef_fehler;
}

// Ein Deck mit eigenem Dehner, synchron gefahren. Ausgabe links je Kern-Sample (Index = Sample).
struct DeckLauf {
  Karte k;
  uint32_t gen = 1;
  std::unique_ptr<cdj::DehnerBasis> d;
  cdj::StreckPost post;
  cdj::Deck deck;
  std::vector<float> L;
  int64_t s = 0;  // nächstes Sample
  struct Faktor {
    uint32_t e;
    int64_t gb;
    double f;
  };
  std::vector<Faktor> fk;  // Faktorfolge je Pumpen: Epoche des Threads, geschrieben bis, gesetzter Faktor
  DeckLauf(const Karte& karte, int64_t laenge, bool mit_dehner = true) : k(karte), L((size_t)laenge, 0.0f) {
    deck.setze_karte(&k, &gen);
    if (mit_dehner) {
      d = cdj::dehner_neu(1);
      deck.setze_keylock(d.get(), &post);
    }
  }
  bool takt = true;  // false: der Vorbereiter setzt aus
  void pumpe() {
    if (!d) return;
    if (takt) post.takt(*d);
    d->fuelle_synchron();
    fk.push_back({d->quittiert_e(), d->geschrieben_bis(), d->faktor_gesetzt()});
  }
  // n Samples ab s (n <= 1024), dann pumpen
  void teil(int n) {
    float l[1024] = {}, r[1024] = {};
    deck.block(s, n, l, r, 0);
    for (int i = 0; i < n; ++i)
      if (s + i < (int64_t)L.size()) L[(size_t)(s + i)] = l[i];
    s += n;
    pumpe();
  }
  void bis(int64_t ende) {
    while (s < ende) teil((int)std::min<int64_t>(B, ende - s));
  }
  // Faktorfolge je 43er-Fenster der Epoche e ab s_h (wie test_dehner Lauf::block)
  std::vector<double> faktoren(uint32_t e, int64_t s_h) const {
    std::vector<double> f;
    for (const Faktor& x : fk) {
      if (x.e != e || x.gb <= s_h) continue;
      const size_t w = (size_t)((x.gb - 1 - s_h) / cdj::DEHNER_REGEL_TAKT);
      if (f.size() <= w) f.resize(w + 1, x.f);
      f[w] = x.f;
    }
    return f;
  }
};

// Varispeed-Deck ohne Dehner, sonst gleich (Bezug)
std::vector<float> varispeed(const cdj::Material& m, const Karte& k, int64_t laenge, int64_t start_s, int64_t start_f) {
  DeckLauf v(k, laenge, false);
  v.deck.lade(&m, 0);
  v.bis(start_s);
  v.deck.start(start_s, start_f);
  v.bis(laenge);
  return v.L;
}

// Tonhöhe je 100-ms-Fenster in [a, b): max |ct| gegen 1000 Hz; zählt Fenster über 2 ct. Null-Läufe >= 32 exakte Nullen.
struct Ton {
  double max_ct = 0;
  int fenster = 0, ueber = 0, null_laeufe = 0;
};
Ton ton_messen(const std::vector<float>& x, int64_t a, int64_t b) {
  Ton t;
  for (int64_t s = a; s + 4800 <= b; s += 4800) {
    const double ct = 1200.0 * std::log2(km::freq(x, s, s + 4800) / 1000.0);
    t.max_ct = std::max(t.max_ct, std::fabs(ct));
    if (std::fabs(ct) > 2.0) {
      ++t.ueber;
      std::printf("    Fenster ab %lld: %+.3f ct\n", (long long)s, ct);
    }
    ++t.fenster;
  }
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

// ------------------------------------------------------------------------------------------ Test 1
void test_tonhoehe_in_rampe() {
  static km::MatProbe p(24, 1);
  Karte k(128.0, 0);
  PRUEF(k.rampe(4.0, 132.0, 8.0));
  DeckLauf l(k, (int64_t)k.sample_at(20.0));
  l.deck.lade(&p.m, 0);
  l.deck.start(0, 0);
  const int64_t s_h = l.deck.keylock_s_h();
  PRUEF(s_h == cdj::ANSATZ_FRIST);
  l.bis((int64_t)l.L.size());
  const Ton t = ton_messen(l.L, s_h, (int64_t)l.L.size() - B);
  std::printf("  test1: s_h %lld, %d Fenster, max |Tonhöhe| %.3f ct, Null-Läufe %d, Ring hörbar %d, Unterläufe %llu\n",
              (long long)s_h, t.fenster, t.max_ct, t.null_laeufe, (int)l.deck.keylock_ring_hoerbar(),
              (unsigned long long)l.deck.keylock_unterlauf());
  PRUEF(t.fenster >= 80);
  PRUEF(t.ueber == 0);
  PRUEF(t.null_laeufe == 0);
  PRUEF(l.deck.keylock_ring_hoerbar());
  PRUEF(l.deck.keylock_unterlauf() == 0);
  // Gegenprobe am selben Fall: ohne Keylock (Varispeed) steigt die Tonhöhe mit der Karte (+53,3 ct bei 132)
  const std::vector<float> v = varispeed(p.m, k, (int64_t)l.L.size(), 0, 0);
  const int64_t a = (int64_t)k.sample_at(14.0);
  const double ct_v = 1200.0 * std::log2(km::freq(v, a, a + 4800) / 1000.0);
  std::printf("  test1: Gegenprobe Varispeed bei Beat 14: %+.2f ct\n", ct_v);
  PRUEF(std::fabs(ct_v - 1200.0 * std::log2(132.0 / 128.0)) < 1.0);
  ergebnis("keylock_tonhoehe_in_rampe");
}

// ------------------------------------------------------------------------------------------ Test 2
void test_lage_in_rampe() {
  static km::MatProbe p(64, 0);
  static km::MatQuelle q(&p.m);
  Karte k(128.0, 0);
  PRUEF(k.rampe(8.0, 132.0, 32.0));
  DeckLauf l(k, (int64_t)k.sample_at(58.0));
  l.deck.lade(&p.m, 0);
  l.deck.start(0, 0);
  const int64_t s_h = l.deck.keylock_s_h();
  l.bis(2 * B);
  const uint32_t e = l.deck.keylock_epoche();
  PRUEF(e != cdj::EPOCHE_KEINE);
  // Prüfung MAJOR 1: das Soll kommt aus Karte und Ereignis im Test (Start bei Sample 0 auf Quellframe 0), nicht aus dem
  // Anker, den das Deck meldet
  const DehnerAnker a{k.beat_at(0.0), 0.0};
  l.bis((int64_t)l.L.size());
  const std::vector<double> f = l.faktoren(e, s_h);
  PRUEF(!f.empty());
  // Ring hörbar ab Beat 8 (Rampenbeginn) + 960: Klicks ab Quell-Beat 9
  const km::Lage m = km::lage_messen(l.L, q, k, a, km::band_start(k, a, s_h, f.at(0)), f, s_h, 9, 57);
  std::printf("  test2: %d Klicks, (a) Mittel %+.2f, (b) max |Deck − rohes R3| %.2f (Klick %d), max |Lage| %.2f, "
              "Unterläufe %llu\n",
              m.n, m.mittel, m.max_roh, m.q_roh, m.max_soll, (unsigned long long)l.deck.keylock_unterlauf());
  PRUEF(m.n == 48);
  // Keylock 4.6: das absolute Mittel wird nur ausgewiesen (Deck-Versatz 0; Hann-Klick liegt um die R3-eigene Lage daneben)
  PRUEF(m.max_roh <= 12.0);
  PRUEF(m.max_soll <= 12.0);  // je Klick gegen das Soll (Messgröße Lage, ±12 in Rampen)
  PRUEF(l.deck.keylock_unterlauf() == 0);
  ergebnis("keylock_lage_in_rampe");
}

// ------------------------------------------------------------------------------------------ Blende (Test 3, 6)
// Größte Abweichung der Ausgabe im Fenster [s0, s0 + 960) vom idealen Übergang (1 − w) · aus(s) + w · ein(s),
// w = (j + 1) / 960 wie im Deck.
template <class FA, class FB>
double blende_abweichung(const std::vector<float>& x, int64_t s0, FA aus, FB ein) {
  double m = 0;
  for (int j = 0; j < cdj::DECK_KEYLOCK_BLENDE; ++j) {
    const double w = (double)(j + 1) / cdj::DECK_KEYLOCK_BLENDE;
    const double ideal = (1 - w) * aus((double)(s0 + j)) + w * ein((double)(s0 + j));
    m = std::max(m, std::fabs((double)x[(size_t)(s0 + j)] - ideal));
  }
  return m;
}

// ------------------------------------------------------------------------------------------ Test 3
void test_bruecke() {
  static km::MatProbe p(24, 1);
  const Karte k(132.0, 0);
  const int64_t s_start = 4 * B + 100;  // 100 Samples im Block
  DeckLauf l(k, s_start + 6 * 48000 / 10 + 20000);
  l.deck.lade(&p.m, 0);
  l.bis(4 * B);
  l.teil(100);
  l.deck.start(s_start, 0);
  const int64_t s_h = l.deck.keylock_s_h();
  const int64_t s_e = s_h + cdj::DECK_KEYLOCK_EINSCHWING;  // hier beginnt die Blende
  l.bis((int64_t)l.L.size());
  PRUEF(s_h == s_start + cdj::ANSATZ_FRIST);
  // Varispeed bis s_e: der analytische Sinus am Kopf kopf(s) = (beat(s) − beat(s_start)) · fpb
  const double b0 = k.beat_at((double)s_start);
  auto vari = [&](double s) { return 0.5 * std::sin(2 * PI * 1000.0 * (k.beat_at(s) - b0) * FPB / 48000.0); };
  double max_vari = 0;
  for (int64_t s = s_start + 64; s < s_e; ++s) max_vari = std::max(max_vari, std::fabs((double)l.L[(size_t)s] - vari((double)s)));
  const double f_vari = km::freq(l.L, s_start + 64, s_e);
  // Ring ab s_e + 960: 1000 Hz; Sinus eingepasst aus den 2000 Samples nach der Blende (Vertrag 16)
  const int64_t s_r = s_e + cdj::DECK_KEYLOCK_BLENDE;
  const km::Sinus ring = km::sinus_einpassen(l.L, s_r, s_r + 2000, 1000.0);
  const Ton t = ton_messen(l.L, s_r, (int64_t)l.L.size() - B);
  const double bl = blende_abweichung(l.L, s_e, vari, ring);
  if (std::getenv("KL_DIAG"))
    for (int j = -8; j < 1200; j += (j < 16 ? 1 : 40)) {
      const double w = j < 0 ? 0 : std::min(1.0, (double)(j + 1) / 960), x = l.L[(size_t)(s_e + j)];
      std::printf("    j %5d x %+.4f vari %+.4f ring %+.4f ideal %+.4f\n", j, x, vari((double)(s_e + j)), ring((double)(s_e + j)),
                  (1 - w) * vari((double)(s_e + j)) + w * ring((double)(s_e + j)));
    }
  std::printf("  test3: s_h %lld, Blende ab %lld; Brücke %.3f Hz, max |Brücke − Varispeed| %.2e; Ring %.3f Hz (Rest %.2e), "
              "%d Fenster max %.3f ct; Blende max %.4f\n",
              (long long)s_h, (long long)s_e, f_vari, max_vari, ring.f, ring.rest, t.fenster, t.max_ct, bl);
  PRUEF(std::fabs(f_vari - 1031.25) < 0.1);
  PRUEF(max_vari < 1e-3);
  PRUEF(std::fabs(ring.f - 1000.0) < 1000.0 * (std::pow(2.0, 2.0 / 1200.0) - 1.0));
  PRUEF(t.ueber == 0 && t.fenster >= 4);
  PRUEF(bl <= 0.02);
  // Positiv-Kontrolle der Messung: der harte Übergang (Ring ab s_e ohne Blende) wiche vom selben Ideal ab
  double hart = 0;
  for (int j = 0; j < cdj::DECK_KEYLOCK_BLENDE; ++j) {
    const double w = (double)(j + 1) / cdj::DECK_KEYLOCK_BLENDE, s = (double)(s_e + j);
    hart = std::max(hart, std::fabs(ring(s) - ((1 - w) * vari(s) + w * ring(s))));
  }
  std::printf("  test3: Positiv-Kontrolle harter Übergang gegen dasselbe Ideal: %.3f\n", hart);
  PRUEF(hart > 0.1);
  // b) dasselbe mit Klick-Material: Lage nach der Blende absolut (Prüfung MAJOR 1; der Sinus sieht ganze Perioden nicht)
  {
    static km::MatProbe pk(24, 0);
    static km::MatQuelle q(&pk.m);
    DeckLauf lk(k, s_start + 20 * 22500);
    lk.deck.lade(&pk.m, 0);
    lk.bis(4 * B);
    lk.teil(100);
    lk.deck.start(s_start, 0);
    lk.bis(s_start + 2 * B);
    const uint32_t e = lk.deck.keylock_epoche();
    lk.bis((int64_t)lk.L.size());
    const DehnerAnker a{k.beat_at((double)s_start), 0.0};  // Soll aus dem Ereignis im Test
    const std::vector<double> f = lk.faktoren(e, s_h);
    PRUEF(!f.empty());
    if (!f.empty()) {
      const int q0 = (int)std::ceil(k.beat_at((double)s_r) - a.b) + 1, q1 = 18;
      const km::Lage m = km::lage_messen(lk.L, q, k, a, km::band_start(k, a, s_h, f.at(0)), f, s_h, q0, q1);
      std::printf("  test3b: Klick, Klicks %d..%d: %d gemessen, (a) Mittel %+.2f, (b) max %.2f, max |Lage gegen Soll| %.2f\n",
                  q0, q1 - 1, m.n, m.mittel, m.max_roh, m.max_soll);
      PRUEF(m.n == q1 - q0 && m.n >= 12);
      // Keylock 4.6: das absolute Mittel wird nur ausgewiesen (Deck-Versatz 0; Hann-Klick liegt um die R3-eigene Lage daneben)
      PRUEF(m.max_roh <= 12.0);
      PRUEF(m.max_soll <= 12.0);
    }
  }
  ergebnis("keylock_bruecke");
}

// ------------------------------------------------------------------------------------------ Test 4
void test_basis_bitgleich() {
  static km::MatProbe p(40, 0);
  const Karte k(128.0, 0);
  const int64_t n = 3 * 48000;
  DeckLauf l(k, n);
  l.deck.lade(&p.m, 0);
  l.deck.start(0, 1000);
  l.bis(n);
  const std::vector<float> v = varispeed(p.m, k, n, 0, 1000);
  int64_t ungleich = 0;
  for (int64_t s = 0; s < n; ++s) ungleich += l.L[(size_t)s] != v[(size_t)s];
  std::printf("  test4: %lld von %lld Samples ungleich; Ring gelesen %llu Frames, Epoche %u, hörbar %d\n",
              (long long)ungleich, (long long)n, (unsigned long long)l.deck.keylock_gelesen(), l.deck.keylock_epoche(),
              (int)l.deck.keylock_ring_hoerbar());
  PRUEF(ungleich == 0);
  PRUEF(!l.deck.keylock_ring_hoerbar());
  PRUEF(l.deck.keylock_gelesen() > (uint64_t)(n - cdj::ANSATZ_FRIST - 2 * B));  // warm: der Ring lief mit
  ergebnis("keylock_basis_bitgleich");
}

// ------------------------------------------------------------------------------------------ Test 5
void test_aus_ist_varispeed() {
  static km::MatProbe p(40, 1);
  Karte k(128.0, 0);
  PRUEF(k.rampe(2.0, 132.0, 4.0));
  const int64_t n = (int64_t)k.sample_at(24.0);
  const std::vector<float> v = varispeed(p.m, k, n, 0, 0);
  // a) Schalter aus von Anfang an
  {
    DeckLauf l(k, n);
    l.deck.keylock(0, false);
    l.deck.lade(&p.m, 0);
    l.deck.start(0, 0);
    l.bis(n);
    int64_t ungleich = 0;
    for (int64_t s = 0; s < n; ++s) ungleich += l.L[(size_t)s] != v[(size_t)s];
    std::printf("  test5a: aus: %lld Samples ungleich zum Varispeed, Ring gelesen %llu\n", (long long)ungleich,
                (unsigned long long)l.deck.keylock_gelesen());
    PRUEF(ungleich == 0);
    PRUEF(l.deck.keylock_gelesen() == 0);
  }
  // b) an, Ring klingt bei 132; bei Beat 12 aus: nach der Blende bitgleich zum Varispeed
  {
    DeckLauf l(k, n);
    l.deck.lade(&p.m, 0);
    l.deck.start(0, 0);
    const int64_t s_aus = (int64_t)k.sample_at(12.0) / B * B;
    l.bis(s_aus);
    PRUEF(l.deck.keylock_ring_hoerbar());
    l.deck.keylock(s_aus, false);
    l.bis(n);
    int64_t ungleich = 0, vorher = 0;
    for (int64_t s = s_aus + cdj::DECK_KEYLOCK_BLENDE; s < n; ++s) ungleich += l.L[(size_t)s] != v[(size_t)s];
    for (int64_t s = (int64_t)k.sample_at(8.0); s < s_aus; ++s) vorher += l.L[(size_t)s] != v[(size_t)s];
    std::printf("  test5b: an -> aus bei %lld: danach %lld ungleich; vorher (Ring) %lld ungleich\n", (long long)s_aus,
                (long long)ungleich, (long long)vorher);
    PRUEF(ungleich == 0);
    PRUEF(vorher > 10000);  // Positiv: vorher klang wirklich der Ring
  }
  ergebnis("keylock_aus_ist_varispeed");
}

// ------------------------------------------------------------------------------------------ Test 6
// Karte 128 -> 132 über 8 Beats ab Beat 4; bei Beat 20 (konstant 132, Ring hörbar) Sprung um 4 Beats.
void test_sprung() {
  Karte k(128.0, 0);
  PRUEF(k.rampe(4.0, 132.0, 8.0));
  const int64_t s_j = (int64_t)k.sample_at(20.0) / B * B;
  const int64_t n = (int64_t)k.sample_at(40.0);
  const int64_t d_f = (int64_t)(4 * FPB);
  // a) Sinus: Blende der alten Epoche gegen die Brücke, danach Tonhöhe
  {
    static km::MatProbe p(48, 1);
    DeckLauf l(k, n);
    l.deck.lade(&p.m, 0);
    l.deck.start(0, 0);
    l.bis(s_j);
    PRUEF(l.deck.keylock_ring_hoerbar());
    l.deck.springe(s_j, d_f);
    const int64_t s_h = l.deck.keylock_s_h();
    const double ab = l.deck.anker_b();
    const double af = (double)l.deck.anker_f();
    l.bis(n);
    PRUEF(s_h == s_j + cdj::ANSATZ_FRIST);
    const km::Sinus alt = km::sinus_einpassen(l.L, s_j - 2000, s_j, 1000.0);
    auto bruecke = [&](double s) { return 0.5 * std::sin(2 * PI * 1000.0 * (af + (k.beat_at(s) - ab) * FPB) / 48000.0); };
    const double bl = blende_abweichung(l.L, s_j, alt, bruecke);
    double max_b = 0;
    for (int64_t s = s_j + cdj::DECK_KEYLOCK_BLENDE; s < s_h; ++s)
      max_b = std::max(max_b, std::fabs((double)l.L[(size_t)s] - bruecke((double)s)));
    const Ton t = ton_messen(l.L, s_h + cdj::DECK_KEYLOCK_EINSCHWING + cdj::DECK_KEYLOCK_BLENDE, n - B);
    std::printf("  test6a: Sprung bei %lld, s_h %lld; Blende alt -> Brücke max %.4f (alt %.3f Hz); Brücke max %.2e; "
                "danach %d Fenster max %.3f ct\n",
                (long long)s_j, (long long)s_h, bl, alt.f, max_b, t.fenster, t.max_ct);
    PRUEF(bl <= 0.02);
    PRUEF(max_b < 1e-3);
    PRUEF(t.fenster >= 50 && t.ueber == 0 && t.null_laeufe == 0);
    PRUEF(l.deck.keylock_ring_hoerbar());
  }
  // b) Klick: Lage nach dem Sprung
  {
    static km::MatProbe p(48, 0);
    static km::MatQuelle q(&p.m);
    DeckLauf l(k, n);
    l.deck.lade(&p.m, 0);
    l.deck.start(0, 0);
    l.bis(s_j);
    l.deck.springe(s_j, d_f);
    const int64_t s_h = l.deck.keylock_s_h();
    l.bis(s_j + 2 * B);
    const uint32_t e = l.deck.keylock_epoche();
    // Soll aus Karte und Ereignis: Start bei 0 auf Frame 0, Sprung um d_f bei s_j (nicht der Anker des Decks)
    const DehnerAnker a{k.beat_at((double)s_j), k.beat_at((double)s_j) * FPB + (double)d_f};
    l.bis(n);
    const std::vector<double> f = l.faktoren(e, s_h);
    PRUEF(e != cdj::EPOCHE_KEINE && !f.empty());
    // Quell-Beat am Ansatz: 4 + Master-Beat; ab dem Ende der Blende Brücke -> Ring bis Beat 39
    const int64_t s_r = s_h + cdj::DECK_KEYLOCK_EINSCHWING + cdj::DECK_KEYLOCK_BLENDE;
    const int q0 = (int)std::ceil(a.f / FPB + k.beat_at((double)s_r) - a.b) + 1;
    const int q1 = (int)(a.f / FPB + 39.0 - a.b);
    const km::Lage m = km::lage_messen(l.L, q, k, a, km::band_start(k, a, s_h, f.at(0)), f, s_h, q0, q1);
    std::printf("  test6b: Klicks %d..%d: %d gemessen, (a) Mittel %+.2f, (b) max %.2f (Klick %d), max |Lage| %.2f\n", q0,
                q1 - 1, m.n, m.mittel, m.max_roh, m.q_roh, m.max_soll);
    PRUEF(m.n == q1 - q0 && m.n >= 14);
    // Keylock 4.6: das absolute Mittel wird nur ausgewiesen (Deck-Versatz 0; Hann-Klick liegt um die R3-eigene Lage daneben)
    PRUEF(m.max_roh <= 12.0);
    PRUEF(m.max_soll <= 12.0);
  }
  ergebnis("keylock_sprung");
}

// ------------------------------------------------------------------------------------------ Test 7
void test_stopp_rampe() {
  static km::MatProbe p(24, 1);
  const Karte k(132.0, 0);
  const int64_t s_st = 48000 / B * B;
  const int64_t n = s_st + 10 * B;
  DeckLauf a(k, n), b(k, n);
  for (DeckLauf* x : {&a, &b}) {
    x->deck.lade(&p.m, 0);
    x->deck.start(0, 0);
    x->bis(s_st);
  }
  PRUEF(b.deck.keylock_ring_hoerbar());
  const uint32_t nr_vor = b.deck.keylock_anfrage();
  b.deck.stopp(s_st);
  a.bis(n);
  b.bis(n);
  double max_d = 0, max_nach = 0;
  for (int i = 0; i < cdj::DECK_STOPP_RAMPE; ++i) {
    const double soll = (double)a.L[(size_t)(s_st + i)] * (double)(cdj::DECK_STOPP_RAMPE - 1 - i) / cdj::DECK_STOPP_RAMPE;
    max_d = std::max(max_d, std::fabs((double)b.L[(size_t)(s_st + i)] - soll));
  }
  for (int64_t s = s_st + cdj::DECK_STOPP_RAMPE; s < n; ++s) max_nach = std::max(max_nach, std::fabs((double)b.L[(size_t)s]));
  double max_a = 0;
  for (int i = 0; i < cdj::DECK_STOPP_RAMPE; ++i) max_a = std::max(max_a, std::fabs((double)a.L[(size_t)(s_st + i)]));
  std::printf("  test7: Rampe max |Ist − Ring · Gain| %.2e (Ring ohne Stopp bis %.3f), danach max %.2e; Leer-Epoche: "
              "Anfrage %u -> %u, s_h %s\n",
              max_d, max_a, max_nach, nr_vor, b.deck.keylock_anfrage(),
              b.deck.keylock_s_h() == INT64_MAX ? "keins" : "gesetzt");
  PRUEF(max_a > 0.4);  // Positiv: in der Rampe klang wirklich Ton
  PRUEF(max_d < 1e-6);
  PRUEF(max_nach == 0.0);
  PRUEF(b.deck.keylock_anfrage() == nr_vor + 1 && b.deck.keylock_s_h() == INT64_MAX);
  PRUEF(!b.deck.laeuft());
  ergebnis("keylock_stopp_rampe");
}

// ------------------------------------------------------------------------------------------ Test 10
void test_frist_verpasst() {
  static km::MatProbe p(24, 1);
  const Karte k(132.0, 0);
  const int64_t n = 48000 / B * B;
  auto d = cdj::dehner_neu(1);
  cdj::StreckPost post;
  cdj::Deck deck;
  Karte kk = k;
  uint32_t gen = 1;
  deck.setze_karte(&kk, &gen);
  deck.setze_keylock(d.get(), &post);
  deck.lade(&p.m, 0);
  deck.start(0, 0);
  std::vector<float> L((size_t)n, 0.0f);
  for (int64_t s = 0; s < n; s += B) {  // kein Vorbereiter, kein Thread: der Ring bleibt leer
    float l[B] = {}, r[B] = {};
    deck.block(s, B, l, r, 0);
    for (int i = 0; i < B; ++i) L[(size_t)(s + i)] = l[i];
  }
  const std::vector<float> v = varispeed(p.m, k, n, 0, 0);
  int64_t ungleich = 0;
  for (int64_t s = 0; s < n; ++s) ungleich += L[(size_t)s] != v[(size_t)s];
  std::printf("  test10: verpasst %llu, aufgegeben %llu, Anfragen %u, %lld Samples ungleich zum Varispeed\n",
              (unsigned long long)deck.keylock_verpasst(), (unsigned long long)deck.keylock_aufgegeben(),
              deck.keylock_anfrage(), (long long)ungleich);
  PRUEF(deck.keylock_verpasst() == cdj::DECK_KEYLOCK_VERPASST);
  PRUEF(deck.keylock_aufgegeben() == 1);
  PRUEF(deck.keylock_anfrage() == 2 + cdj::DECK_KEYLOCK_VERPASST);  // Leer (Laden), Ansatz (Start), 8 Mal gewandert
  PRUEF(ungleich == 0);  // die Brücke ist der Varispeed-Weg
  ergebnis("keylock_frist_verpasst");
}

// ------------------------------------------------------------------------------------------ Test 11
void test_allokation() {
  static km::MatProbe p(24, 1);
  Karte k(128.0, 0);
  PRUEF(k.rampe(2.0, 132.0, 4.0));
  DeckLauf l(k, (int64_t)k.sample_at(16.0));
  l.deck.lade(&p.m, 0);
  l.deck.start(0, 0);
  long n_block = 0;
  float lb[B], rb[B];
  int sprung = 0;
  while (l.s + B <= (int64_t)l.L.size()) {
    abfang_an();
    l.deck.block(l.s, B, lb, rb, 0);
    if (l.s == 40 * B) l.deck.springe(l.s + B, 1000), ++sprung;  // auch Ereignis und ALT-Fassen
    while (l.deck.rueckgabe()) {
    }
    n_block += abfang_aus();
    l.s += B;
    l.pumpe();
  }
  abfang_an();
  void* x = std::malloc(64);
  const long kontrolle = abfang_aus();
  std::free(x);
  std::printf("  test11: %s Allokationen in Deck::block mit Keylock: %ld (Positiv-Kontrolle malloc: %ld), Ring hörbar %d\n",
              ALLOC_ABFANG_VERFUEGBAR ? "" : "(übersprungen: Sanitizer)", n_block, kontrolle,
              (int)l.deck.keylock_ring_hoerbar());
  if (ALLOC_ABFANG_VERFUEGBAR) {
    PRUEF(kontrolle == 1);
    PRUEF(n_block == 0);
  }
  PRUEF(l.deck.keylock_ring_hoerbar() && sprung == 1);
  ergebnis("keylock_allokation");
}

// ------------------------------------------------------------------------------------------ Knack-Maß (Test 12, 15, 16)
// Größter Sprung von Sample zu Sample in [a, b): das Maß der Prüfung für einen Knack (Grundlinie Sinus 0,5 bei 1000 Hz:
// 0,0654, bei 1031,25 Hz: 0,0675).
double max_dx(const std::vector<float>& x, int64_t a, int64_t b) {
  double m = 0;
  for (int64_t i = std::max<int64_t>(a, 1); i < b && i < (int64_t)x.size(); ++i)
    m = std::max(m, std::fabs((double)x[(size_t)i] - (double)x[(size_t)i - 1]));
  return m;
}

// ------------------------------------------------------------------------------------------ Test 12
// Vertrag 2, Prüfung m2: der Arbeits-Thread setzt aus, der Ring reißt. Am Blockanfang erkennt das Deck, dass nach dem
// Block weniger als 128 Frames bereitliegen, und blendet das, was klang, über die vorhandenen Frames gegen den Varispeed-
// Weg aus. 24 Phasenlagen (Startframe 7 · p): größter Sprung höchstens der des Varispeed-Wegs derselben Folge + 0,05.
void test_unterlauf() {
  static km::MatProbe p(40, 1);
  const Karte k(132.0, 0);
  const int64_t n = 3 * 48000 / B * B;
  double max_kl = 0, max_v = 0;
  int fehl = 0;
  for (int ph = 0; ph < 24; ++ph) {
    const int64_t f0 = 7 * ph;
    DeckLauf l(k, n);
    l.deck.lade(&p.m, 0);
    l.deck.start(0, f0);
    const int64_t s_aus = 48000 / B * B;
    l.bis(s_aus);
    const bool ring_vor = l.deck.keylock_ring_hoerbar();
    const uint32_t nr_vor = l.deck.keylock_anfrage();
    float lb[B], rb[B];
    int64_t s_riss = -1;
    for (int i = 0; i < 12; ++i) {  // 12 Blöcke ohne Vorbereiter und Thread: der Vorlauf (4 Blöcke) ist aufgebraucht
      std::fill(lb, lb + B, 0.0f);
      l.deck.block(l.s, B, lb, rb, 0);
      for (int j = 0; j < B; ++j) l.L[(size_t)(l.s + j)] = lb[j];
      if (s_riss < 0 && !l.deck.keylock_ring_hoerbar()) s_riss = l.s;
      l.s += B;
    }
    const int64_t s_h = l.deck.keylock_s_h();
    l.bis(n);
    const std::vector<float> v = varispeed(p.m, k, n, 0, f0);
    const double dk = max_dx(l.L, s_aus, s_h + cdj::DECK_KEYLOCK_EINSCHWING), dv = max_dx(v, s_aus, s_h + cdj::DECK_KEYLOCK_EINSCHWING);
    int64_t ungleich = 0;  // nach dem Ausblenden (höchstens ein Block) genau der Varispeed-Weg bis zur neuen Blende
    for (int64_t x = s_riss + B; x < s_h + cdj::DECK_KEYLOCK_EINSCHWING; ++x) ungleich += l.L[(size_t)x] != v[(size_t)x];
    max_kl = std::max(max_kl, dk);
    max_v = std::max(max_v, dv);
    const bool ok = ring_vor && dk <= dv + 0.05 && ungleich == 0 && l.deck.keylock_unterlauf() == 1 &&
                    l.deck.keylock_hart() == 0 && l.deck.keylock_anfrage() == nr_vor + 1 && l.deck.keylock_ring_hoerbar() &&
                    s_riss >= s_aus + 2 * B && s_riss <= s_aus + 4 * B;
    if (!ok || ph == 0)
      std::printf("  test12 Phase %d: Riss bei %lld, max |dx| Keylock %.4f / Varispeed %.4f, danach %lld ungleich, Unterläufe "
                  "%llu, hart %llu, Anfrage %u -> %u, am Ende Ring hörbar %d\n",
                  ph, (long long)s_riss, dk, dv, (long long)ungleich, (unsigned long long)l.deck.keylock_unterlauf(),
                  (unsigned long long)l.deck.keylock_hart(), nr_vor, l.deck.keylock_anfrage(), (int)l.deck.keylock_ring_hoerbar());
    fehl += ok ? 0 : 1;
  }
  std::printf("  test12: 24 Phasen, max |dx| Keylock %.4f, Varispeed %.4f, gescheitert %d\n", max_kl, max_v, fehl);
  PRUEF(fehl == 0);
  ergebnis("keylock_unterlauf");
}

// ------------------------------------------------------------------------------------------ Test 15
// Prüfung M1: Ereignisse während einer laufenden Keylock-Blende. a) Sprung-Folge bei 132 BPM, Abstand aus den Konstanten
// so, dass jedes Ereignis in die Blende Brücke -> Ring des vorigen fällt (drei Lagen), 24 Sprünge, 24 Phasenlagen;
// b) Doppelsprung 64 Frames auseinander, 24 Lagen in der Blende Brücke -> Ring. Je Fall: größter Sprung von Sample zu
// Sample im Fenster der Ereignisse höchstens der des Varispeed-Decks derselben Folge + 0,05.
void test_ereignis_in_blende() {
  static km::MatProbe p(800, 1);
  const Karte k(132.0, 0);
  int in_blende = 0;  // Ereignisse, die eine laufende Blende mit Ring-Anteil treffen (Keylock-Läufe)
  auto lauf = [&](bool kl, int64_t erstes, int64_t abstand, int zahl, int64_t schritt, std::vector<int64_t>& ev) {
    DeckLauf l(k, erstes + zahl * abstand + 3 * 48000 / 2, kl);
    l.deck.lade(&p.m, 0);
    l.deck.start(0, 20000);
    l.bis(erstes);
    ev.clear();
    for (int j = 0; j < zahl; ++j) {
      const int64_t e = l.s;
      ev.push_back(e);
      if (kl && l.deck.keylock_blendet() && l.deck.keylock_ring_beteiligt()) ++in_blende;
      l.deck.springe(e, (j % 2 ? -1 : 1) * schritt);
      l.bis(e + abstand);
    }
    l.bis((int64_t)l.L.size() - 2 * B);
    return l.L;
  };
  // a) Jonglage: der Abstand legt jedes Ereignis in die Blende Brücke -> Ring des vorigen (Ereignis + ANSATZ_FRIST +
  // EINSCHWING bis + BLENDE), aus den Konstanten abgeleitet (Nachprüfung MAJOR A: ein fester Abstand 5454 lag seit 2c
  // davor). Drei Lagen in der Blende: w = 0,13 / 0,62 / 0,93. Geprüft wird auch, dass die Ereignisse sie wirklich treffen.
  const int64_t bl0 = cdj::ANSATZ_FRIST + cdj::DECK_KEYLOCK_EINSCHWING;
  double a_kl = 0, a_v = 0;
  int a_fehl = 0, a_ereignisse = 0, a_in_min = 1 << 30;
  for (const int64_t abstand : {bl0 + 121, bl0 + 596, bl0 + 896}) {
    in_blende = 0;
    for (int ph = 0; ph < 24; ++ph) {
      std::vector<int64_t> ev;
      const int64_t erstes = 48000 + 227 * ph;
      const std::vector<float> xk = lauf(true, erstes, abstand, 24, 22500 / 4 * 3, ev);
      const std::vector<float> xv = lauf(false, erstes, abstand, 24, 22500 / 4 * 3, ev);
      double mk = 0, mv = 0;
      for (int64_t e : ev) {
        mk = std::max(mk, max_dx(xk, e - 2, e + cdj::DECK_KEYLOCK_BLENDE + 2));
        mv = std::max(mv, max_dx(xv, e - 2, e + cdj::DECK_KEYLOCK_BLENDE + 2));
      }
      a_kl = std::max(a_kl, mk);
      a_v = std::max(a_v, mv);
      a_ereignisse += (int)ev.size();
      if (mk > mv + 0.05) {
        ++a_fehl;
        std::printf("  test15a Abstand %lld Phase %d: max |dx| Keylock %.4f, Varispeed %.4f\n", (long long)abstand, ph, mk, mv);
      }
    }
    std::printf("  test15a Abstand %lld: %d von %d Ereignissen in einer laufenden Blende mit Ring\n", (long long)abstand,
                in_blende, 24 * 24);
    a_in_min = std::min(a_in_min, in_blende);
  }
  PRUEF(a_in_min >= 24 * 24 * 8 / 10);  // der Fall wird wirklich getroffen (sonst wäre der Test blind)
  // b) Doppelsprung 64 Frames auseinander, beginnend in der Blende Brücke -> Ring (s_e = s_h + DECK_KEYLOCK_EINSCHWING nach dem Start)
  double b_kl = 0, b_v = 0;
  int b_fehl = 0;
  const int64_t s_e = cdj::ANSATZ_FRIST + cdj::DECK_KEYLOCK_EINSCHWING;
  for (int ph = 0; ph < 24; ++ph) {
    const int64_t e1 = (s_e + 40 * ph) / 64 * 64;
    for (int kl = 0; kl < 2; ++kl) {
      DeckLauf l(k, e1 + 3 * 48000 / 2, kl == 1);
      l.deck.lade(&p.m, 0);
      l.deck.start(0, 20000);
      l.bis(e1);
      l.deck.springe(e1, 16875 + 7 * ph);
      l.bis(e1 + 64);
      l.deck.springe(e1 + 64, -11250 - 5 * ph);
      l.bis((int64_t)l.L.size() - 2 * B);
      const double m = max_dx(l.L, e1 - 2, e1 + 64 + cdj::DECK_KEYLOCK_BLENDE + 2);
      (kl ? b_kl : b_v) = std::max(kl ? b_kl : b_v, m);
      static double mv_ph = 0;
      if (!kl) mv_ph = m;
      else if (m > mv_ph + 0.05) {
        ++b_fehl;
        std::printf("  test15b Phase %d (Sprung bei %lld): max |dx| Keylock %.4f, Varispeed %.4f\n", ph, (long long)e1, m, mv_ph);
      }
    }
  }
  std::printf("  test15: a) Jonglage 3 Abstände x 24 Phasen x 24 Sprünge (%d), je mindestens %d in der Blende: max |dx| "
              "Keylock %.4f, Varispeed %.4f, über Grenze %d; b) Doppelsprung 64 Frames, 24 Lagen: Keylock %.4f, Varispeed %.4f, "
              "über Grenze %d\n",
              a_ereignisse, a_in_min, a_kl, a_v, a_fehl, b_kl, b_v, b_fehl);
  PRUEF(a_fehl == 0);
  PRUEF(b_fehl == 0);
  ergebnis("keylock_ereignis_in_blende");
}

// ------------------------------------------------------------------------------------------ Test 16
// Prüfung m3: Stopp während einer Keylock-Blende. Lauf B stoppt 50 Samples nach dem Ereignis, Lauf A nicht: in der Rampe
// muss B = A · Gain der Rampe sein, auch für den eingefrorenen Anteil; danach Stille. Fälle: i) Sprung bei hörbarem Ring
// (Eingefrorenes -> Brücke), ii) Stopp in der Blende Brücke -> Ring.
void test_stopp_in_blende() {
  static km::MatProbe p(40, 1);
  const Karte k(132.0, 0);
  double max_i[2] = {0, 0}, nach[2] = {0, 0}, ton[2] = {0, 0};
  for (int fall = 0; fall < 2; ++fall) {
    const int64_t s_e = cdj::ANSATZ_FRIST + cdj::DECK_KEYLOCK_EINSCHWING;
    const int64_t e = fall == 0 ? 48000 / B * B : s_e + 300;
    const int64_t s_st = fall == 0 ? e + 50 : e;
    const int64_t n = s_st + 6 * B;
    DeckLauf a(k, n), b(k, n);
    for (DeckLauf* x : {&a, &b}) {
      x->deck.lade(&p.m, 0);
      x->deck.start(0, 0);
      x->bis(e);
      if (fall == 0) {
        PRUEF(x->deck.keylock_ring_hoerbar());
        x->deck.springe(e, 3000);
      }
    }
    a.bis(n);
    b.bis(s_st);
    PRUEF(b.deck.keylock_blendet());
    b.deck.stopp(s_st);
    b.bis(n);
    for (int i = 0; i < cdj::DECK_STOPP_RAMPE; ++i) {
      const double g = (double)(cdj::DECK_STOPP_RAMPE - 1 - i) / cdj::DECK_STOPP_RAMPE;
      max_i[fall] = std::max(max_i[fall], std::fabs((double)b.L[(size_t)(s_st + i)] - g * (double)a.L[(size_t)(s_st + i)]));
      ton[fall] = std::max(ton[fall], std::fabs((double)a.L[(size_t)(s_st + i)]));
    }
    nach[fall] = max_dx(b.L, s_st + cdj::DECK_STOPP_RAMPE, n) + std::fabs(b.L[(size_t)(s_st + cdj::DECK_STOPP_RAMPE)]);
  }
  std::printf("  test16: i) Sprung im Ring, Stopp 50 danach: max |B − A · Gain| %.2e (Ton %.3f), danach %.2e; ii) Stopp in "
              "der Blende Brücke -> Ring: %.2e (Ton %.3f), danach %.2e\n",
              max_i[0], ton[0], nach[0], max_i[1], ton[1], nach[1]);
  for (int f = 0; f < 2; ++f) {
    PRUEF(ton[f] > 0.3);
    PRUEF(max_i[f] < 1e-5);
    PRUEF(nach[f] == 0.0);
  }
  ergebnis("keylock_stopp_in_blende");
}

// ------------------------------------------------------------------------------------------ Test 13
// Die Quelle spielt in band() den Callback und stört die Füllschleife des Dehners (dehner.cpp fuelle_synchron):
//  a) zwischen zwei Abschnitten wird eine Leer-Epoche angesetzt und der Ring auf sie umgestellt (alles Alte weg): der
//     Abbruch bei wartendem Ansatz muss nach höchstens 2 Abschnitten zurückkehren (ohne Abbruch: bis zur Grenze, 16);
//  b) derselbe Leser verbraucht alles sofort, ohne neuen Ansatz: nur die Obergrenze (Ringgröße / Abschnitt + 1 = 16)
//     beendet die Schleife (ohne Grenze: bis die Störung nach 200 Abschnitten aufhört).
// So wird das Entfernen von Grenze oder Abbruch je für sich rot (Mutationen DEHNER_FUELLEN_OHNE_GRENZE / _OHNE_ABBRUCH).
struct StoerQuelle : cdj::DehnerQuelle {
  cdj::DehnerBasis* d = nullptr;
  mutable int aufrufe = 0;
  mutable int art = 0;  // 0 aus, 1 neue Leer-Epoche ansetzen, 2 nur verbrauchen
  mutable uint32_t leer_e = 0;
  void band(int64_t, int n, float* l, float* r) const noexcept override {
    for (int i = 0; i < n; ++i) l[i] = r[i] = 0.1f;
    if (art == 0 || ++aufrufe > 200) return;
    if (art == 1) {
      if (leer_e == 0) leer_e = d->ansetzen(cdj::AnsatzAuftrag{});  // Leer-Epoche (Vorbereiter)
      d->ring().setze_epoche(leer_e);                              // Callback: neue Epoche, Altes weg
    }
    d->ring().bereit_ab(1 << 30);  // Callback verbraucht alles, was da ist
  }
  double basis_bpm() const noexcept override { return 128.0; }
};
void test_fuellen_abbruch() {
  const Karte k(132.0, 0);
  int auf[2] = {0, 0};
  uint32_t q_nach = 0, leer_e = 0;
  for (int fall = 1; fall <= 2; ++fall) {
    StoerQuelle q;
    auto d = cdj::dehner_neu(1);
    q.d = d.get();
    const uint32_t e1 = d->ansetzen(cdj::AnsatzAuftrag{&q, 4096, DehnerAnker{0, 0}, k, 1});
    d->fuelle_synchron();  // übernimmt e1, füllt den Vorlauf (ungestört)
    PRUEF(d->quittiert_e() == e1);
    q.art = fall;
    d->ring().setze_epoche(e1);
    d->ring().bereit_ab(1 << 30);  // der Callback hat verbraucht: der Thread muss nachfüllen
    d->fuelle_synchron();          // gestörter Aufruf
    auf[fall - 1] = q.aufrufe;
    q.art = 0;
    if (fall == 1) {
      d->fuelle_synchron();  // übernimmt die Leer-Epoche
      q_nach = d->quittiert_e();
      leer_e = q.leer_e;
    }
    PRUEF(d->ring_voll() == 0);
  }
  std::printf("  test13: a) neuer Ansatz während des Füllens: band() im gestörten Aufruf %d (Abbruch <= 2), danach quittiert "
              "%u (Leer-Epoche %u); b) Leser verbraucht alles: %d Abschnitte (Grenze 16, ohne Grenze bis 200)\n",
              auf[0], q_nach, leer_e, auf[1]);
  PRUEF(auf[0] >= 1 && auf[0] <= 2);
  PRUEF(q_nach == leer_e && leer_e != 0);
  PRUEF(auf[1] >= 4 && auf[1] <= 16);
  ergebnis("keylock_fuellen_abbruch");
}

// ------------------------------------------------------------------------------------------ Test 14
// Einschwingen am Klick-Material (Task 2b gemessen, Task 2c: DECK_KEYLOCK_EINSCHWING = 1408 danach). Der Dehner
// allein, Karte konstant: Ansatz bei s_h mit einem Klick, der d Samples nach s_h beginnt, gegen einen Bezug mit derselben
// Kopf-Zuordnung, 32 845 Samples früher angesetzt (eingeschwungen, anderes Abschnittsraster: kein bitgleicher Bezug).
// Maß je Klick: größte normierte Kreuzkorrelation in ±300 Samples (Form, verschiebungsfrei); Energie nur ausgewiesen (zwei
// eingeschwungene Bezüge weichen darin bis 30 % voneinander ab, task-02-fix/einschwingen_klick_probe.txt).
// GEMESSEN 07.10.: unter 0,95 bis d = 1024 bei 110, 132 und 170 BPM, bei 110 BPM noch bei d = 1280 (0,72); ab d = 1408
// überall >= 0,98. Der Test prüft: ab d = 1408 Korrelation >= 0,95, und DECK_KEYLOCK_EINSCHWING >= 1408 (Task 2c).
std::vector<float> dehner_lauf(const cdj::DehnerQuelle& q, const Karte& k, int64_t s_h, DehnerAnker a, int64_t ende) {
  auto d = cdj::dehner_neu(1);
  std::vector<float> L((size_t)ende, 0.0f);
  d->ansetzen(cdj::AnsatzAuftrag{&q, s_h, a, k, 1});
  for (int64_t b = 0; b + B <= ende; b += B) {
    cdj::KartenStand st;
    st.karte = k;
    st.anker = a;
    st.generation = 1;
    st.s_jetzt = b;
    d->karte_veroeffentlichen(st);
    d->fuelle_synchron();
    cdj::StreckRing& r = d->ring();
    r.setze_epoche(d->epoche());
    float l[B], rr[B];
    const int64_t ab = r.bereit_ab(b);
    if (ab < 0 || ab >= b + B) continue;
    const int n = r.lies_bis(ab, (int)(b + B - ab), l, rr);
    for (int i = 0; i < n; ++i) L[(size_t)(ab + i)] = l[i];
  }
  return L;
}
void test_einschwingen_klick() {
  static km::MatProbe p(80, 0);
  static km::MatQuelle q(&p.m);
  const int64_t s_h = 40000, ende = s_h + 6000;
  constexpr int SICHER = 1408;  // gemessen: ab hier eingeschwungen
  int fehl = 0, n_pruef = 0, zwischen_schlecht = 0, zwischen = 0;
  double c_min = 9;
  for (double bpm : {110.0, 132.0, 170.0}) {
    const Karte k(bpm, 0);
    const double schritt = bpm / 128.0;  // Quellframes je Sample
    std::printf("  test14 %.0f BPM: d Energie/Bezug Korrelation\n", bpm);
    for (int d = 0; d <= 2560; d += 128) {
      const int64_t klick = 8 * (int64_t)FPB;  // Klick von Quell-Beat 8 beginnt bei s_h + d
      const DehnerAnker a{k.beat_at((double)s_h), (double)klick - d * schritt};
      const std::vector<float> x = dehner_lauf(q, k, s_h, a, ende);
      const std::vector<float> y = dehner_lauf(q, k, s_h - 32768 - 77, a, ende);
      const int64_t m0 = s_h + d + 72, w = 300;
      double ex = 0, ey = 0;
      for (int64_t t = m0 - w; t < m0 + w; ++t) {
        ex += (double)x[(size_t)t] * x[(size_t)t];
        ey += (double)y[(size_t)t] * y[(size_t)t];
      }
      double cmax = 0;
      for (int lag = -100; lag <= 100; ++lag) {
        double c = 0;
        for (int64_t t = m0 - w; t < m0 + w; ++t) c += (double)x[(size_t)t] * y[(size_t)(t + lag)];
        cmax = std::max(cmax, c / std::sqrt(ex * ey + 1e-30));
      }
      const bool gut = cmax >= 0.95;
      if (d >= SICHER) {
        ++n_pruef;
        fehl += gut ? 0 : 1;
        c_min = std::min(c_min, cmax);
      } else if (d >= 768) {
        ++zwischen;
        zwischen_schlecht += gut ? 0 : 1;
      }
      std::printf("    d %4d: %.3f %.4f%s\n", d, ex / (ey + 1e-30), cmax, gut ? "" : "  <- Form gestört");
    }
  }
  std::printf("  test14: ab %d: %d Klicks, Korrelation min %.4f, gescheitert %d; zwischen 768 und %d: %d von %d gestört\n",
              SICHER, n_pruef, c_min, fehl, SICHER, zwischen_schlecht, zwischen);
  PRUEF(n_pruef == 3 * 10);
  PRUEF(fehl == 0);
  // b) Nachprüfung MINOR B: dasselbe an der AUSGABE DES DECKS. Start so, dass ein Klick d Samples nach s_h beginnt; Soll
  // ist der ideale Übergang (1 − w) · Varispeed-Deck + w · eingeschwungener Ring (Bezug wie oben, Anker = Start), w ab
  // s_h + DECK_KEYLOCK_EINSCHWING über 960 Samples. Korrelation der Deck-Ausgabe mit dem Soll im Klickfenster >= 0,95.
  // Mit Einschwingen 768 mischt die Blende den noch gestörten Ring ins Hörbare (Mutation KEYLOCK_EINSCHWING_768).
  int b_fehl = 0, b_n = 0;
  double b_min = 9;
  for (double bpm : {110.0, 132.0}) {
    const Karte k(bpm, 0);
    for (int d = 768; d <= 2048; d += 128) {
      const int64_t s0 = 160 * B, s_hd = s0 + cdj::ANSATZ_FRIST, n = s_hd + 4000;  // Bezug 32 845 früher: noch > 0
      const double f = 8.0 * FPB - (k.beat_at((double)(s_hd + d)) - k.beat_at((double)s0)) * FPB;
      DeckLauf l(k, n);
      l.deck.lade(&p.m, 0);
      l.bis(s0);
      l.deck.start(s0, (int64_t)std::llround(f));
      l.bis(n);
      const DehnerAnker a{k.beat_at((double)s0), (double)std::llround(f)};
      const std::vector<float> v = varispeed(p.m, k, n, s0, (int64_t)std::llround(f));
      const std::vector<float> y = dehner_lauf(q, k, s_hd - 32768 - 77, a, n);
      const int64_t s_e = s_hd + cdj::DECK_KEYLOCK_EINSCHWING, m0 = s_hd + d + 72, w = 300;
      // der Ring-Anteil des Solls darf um bis zu ±100 Samples verschoben sein: zwei eingeschwungene R3-Läufe mit anderem
      // Abschnittsraster streuen je Klick in der Lage (Lage misst Test 3b); hier zählt die Form
      double c = -1;
      for (int lag = -100; lag <= 100; ++lag) {
        double xx = 0, ii = 0, xi = 0;
        for (int64_t t = m0 - w; t < m0 + w; ++t) {
          const double g = t < s_e ? 0.0 : std::min(1.0, (double)(t - s_e + 1) / cdj::DECK_KEYLOCK_BLENDE);
          const double soll = (1 - g) * v[(size_t)t] + g * y[(size_t)(t + lag)];
          xx += (double)l.L[(size_t)t] * l.L[(size_t)t];
          ii += soll * soll;
          xi += (double)l.L[(size_t)t] * soll;
        }
        c = std::max(c, xi / std::sqrt(xx * ii + 1e-30));
      }
      ++b_n;
      b_min = std::min(b_min, c);
      if (c < 0.95) {
        ++b_fehl;
        std::printf("    14b %.0f BPM d %d: Korrelation Deck-Ausgabe gegen Soll %.4f  <- gestört\n", bpm, d, c);
      }
    }
  }
  std::printf("  test14b: Deck-Ausgabe, 2 Tempi x %d Lagen ab 768: Korrelation min %.4f, gestört %d\n", b_n / 2, b_min, b_fehl);
  PRUEF(b_n == 2 * 11);
  PRUEF(b_fehl == 0);
  // Task 2c: die Konstante des Lesers darf nicht unter dem hier gemessenen Wert liegen (rot, wenn sie wieder 768 wäre)
  std::printf("  test14: DECK_KEYLOCK_EINSCHWING %d, gemessen eingeschwungen ab %d\n", cdj::DECK_KEYLOCK_EINSCHWING, SICHER);
  PRUEF(cdj::DECK_KEYLOCK_EINSCHWING >= SICHER);
  ergebnis("keylock_einschwingen_klick");
}

// ------------------------------------------------------------------------------------------ Test 18
// Prüfung F8, Vertrag 9 (Architektur 8): Stem-Gewichte im Ring. Material mit 4 Stems (Stem 0: Sinus 1000 Hz, Stem 1:
// 1500 Hz, je 0,4), Karte 132, Ring hörbar; Stem 0 wird stumm geschaltet. Gemessen wird die Amplitude von Stem 0 (Lock-in
// über 480 Samples bei seiner gehörten Frequenz): Verzögerung bis unter die Hälfte, gegen das Varispeed-Deck.
// Grenze (dokumentiert, nicht behoben, Plan Architektur 8): der Griff wirkt erst mit Ring-Vorlauf und R3-Verzögerung.
struct StemProbe {
  std::vector<float> d[4];
  cdj::Material m{};
  explicit StemProbe(double beats) {
    const int64_t frames = (int64_t)std::ceil(beats * FPB);
    std::snprintf(m.material_id, sizeof m.material_id, "c1c0000000000a01");
    m.basis_bpm = 128.0;
    m.fassung = 1;
    m.mit_stems = 1;
    m.n_quellen = 4;
    m.frames = frames;
    for (int k = 0; k < 4; ++k) {
      d[k].assign((size_t)(2 * frames), 0.0f);
      const double f = k == 0 ? 1000.0 : k == 1 ? 1500.0 : 0.0;
      if (f > 0)
        for (int64_t i = 0; i < frames; ++i)
          d[k][(size_t)(2 * i)] = d[k][(size_t)(2 * i + 1)] = (float)(0.4 * std::sin(2 * PI * f * (double)i / 48000.0));
      m.quelle[k] = d[k].data();
    }
  }
};
// Lock-in bei f über [a, a + 480): Varispeed spielt Stem 0 bei 1000 · 132/128 Hz, der Ring bei 1000 Hz
double amp_bei(const std::vector<float>& x, int64_t a, double f) {
  double c = 0, sn = 0;
  for (int64_t t = a; t < a + 480; ++t) {
    c += x[(size_t)t] * std::cos(2 * PI * f * (double)t / 48000.0);
    sn += x[(size_t)t] * std::sin(2 * PI * f * (double)t / 48000.0);
  }
  return 2.0 / 480.0 * std::hypot(c, sn);
}
void test_stems() {
  static StemProbe p(40);
  const Karte k(132.0, 0);
  const int64_t s_x = 48000 / B * B, n = s_x + 24000;
  double verz[2] = {0, 0}, vorher[2] = {0, 0}, rest[2] = {0, 0};
  for (int kl = 0; kl < 2; ++kl) {
    DeckLauf l(k, n, kl == 1);
    l.deck.lade(&p.m, 0);
    l.deck.start(0, 0);
    l.bis(s_x);
    if (kl) PRUEF(l.deck.keylock_ring_hoerbar());
    l.deck.stem_db(0, -120.0f);
    l.bis(n);
    const double f = kl ? 1000.0 : 1000.0 * 132.0 / 128.0;
    auto amp1k = [&](const std::vector<float>& x, int64_t a) { return amp_bei(x, a, f); };
    vorher[kl] = amp1k(l.L, s_x - 960);
    verz[kl] = -1;
    for (int64_t t = s_x - 240; t + 480 < n; t += 24)
      if (amp1k(l.L, t) < 0.5 * vorher[kl]) {
        verz[kl] = (double)(t + 240 - s_x) / 48.0;  // Mitte des Fensters, in ms
        break;
      }
    rest[kl] = amp1k(l.L, n - 2000) / vorher[kl];
  }
  std::printf("  test18: Stem 0 stumm: Varispeed unter die Hälfte nach %.2f ms (Amplitude vorher %.3f, Rest %.4f); Keylock "
              "nach %.2f ms (vorher %.3f, Rest %.4f)\n",
              verz[0], vorher[0], rest[0], verz[1], vorher[1], rest[1]);
  PRUEF(vorher[0] > 0.35 && vorher[1] > 0.35);
  PRUEF(verz[0] >= -5.1 && verz[0] < 5.0);
  PRUEF(verz[1] > 5.0 && verz[1] < 150.0);  // dokumentierte Grenze: verzögert, aber unter 150 ms
  // Varispeed-Rest: Stem 1 (1546,9 Hz) leckt ins 480er-Fenster bei 1031,25 Hz (5,16 Perioden Abstand), kein Stem-0-Rest
  PRUEF(rest[0] < 0.06 && rest[1] < 0.02);  // der Griff wirkt im Ring
  ergebnis("keylock_stems");
}

// ------------------------------------------------------------------------------------------ Test 19
// StreckLeser allein (wie eine Loop-Box ihn fahren würde): Grenzen.
//  a) Vertrag 8 (Spec MINOR C): liegen beim Einfrieren weniger als STRECK_ALT_MIN Frames vor, friert er nicht ein (die Quelle
//     blendet aus dem Material); mit 200 Frames friert er ein. Der Ring wird dafür ohne Thread bis auf 100 bzw. 200 geleert.
//  b) Nachprüfung N5: block_anfang mit n > STRECK_MAX_BLOCK liest höchstens STRECK_MAX_BLOCK und zählt.
void test_leser_grenzen() {
  static km::MatProbe p(40, 1);
  static km::MatQuelle q(&p.m);
  const Karte k(132.0, 0);
  const uint32_t gen = 1;
  bool ergebnis_a[2] = {false, false};
  uint64_t kurz[2] = {0, 0};
  int64_t vor[2] = {0, 0};
  for (int fall = 0; fall < 2; ++fall) {
    auto d = cdj::dehner_neu(1);
    cdj::StreckPost post;
    cdj::StreckLeser L;
    L.verbinde(d.get(), &post, &k, &gen);
    L.ansetzen(0, &q, DehnerAnker{0.0, 0.0});
    int64_t s = 0;
    auto block = [&](int n, bool pumpen) {
      L.block_anfang(s, n);  // die Warnung „Unterlauf droht“ wird hier bewusst nicht befolgt
      for (int i = 0; i < n; ++i) {
        float a = 0.0f, b = 0.0f;
        L.mische(i, s + i, true, 1.0f, false, 1.0f, false, a, b);
      }
      s += n;
      if (pumpen) {
        post.takt(*d);
        d->fuelle_synchron();
      }
    };
    while (s < 24000) block(B, true);
    PRUEF(L.ring_hoerbar());
    const int64_t ziel = fall == 0 ? 100 : 200;
    int64_t da = d->ring().verfuegbar(s);
    while (da > ziel) {
      block((int)std::min<int64_t>(B, da - ziel), false);
      da = d->ring().verfuegbar(s);
    }
    vor[fall] = da;
    ergebnis_a[fall] = L.einfrieren(s, 1.0f, 1.0f, nullptr, nullptr, 0);
    kurz[fall] = L.kurz_n();
    if (fall == 1) {  // b) an diesem Leser: Block über der Grenze
      while (s < 60000) block(B, true);
      const uint64_t g0 = L.gelesen();
      L.block_anfang(s, 2048);
      std::printf("  test19b: block_anfang(2048): gelesen %llu Frames, zu groß gezählt %llu\n",
                  (unsigned long long)(L.gelesen() - g0), (unsigned long long)L.zu_gross_n());
      PRUEF(L.gelesen() - g0 <= (uint64_t)cdj::STRECK_MAX_BLOCK);
      PRUEF(L.zu_gross_n() == 1);
    }
  }
  std::printf("  test19a: Einfrieren bei %lld Frames: %s (kurz %llu); bei %lld Frames: %s\n", (long long)vor[0],
              ergebnis_a[0] ? "eingefroren" : "abgelehnt", (unsigned long long)kurz[0], (long long)vor[1],
              ergebnis_a[1] ? "eingefroren" : "abgelehnt");
  PRUEF(vor[0] == 100 && vor[1] == 200);
  PRUEF(!ergebnis_a[0] && kurz[0] == 1);
  PRUEF(ergebnis_a[1] && kurz[1] == 0);
  ergebnis("keylock_leser_grenzen");
}

// ------------------------------------------------------------------------------------------ Test 20
// Nachprüfung N1 (Probe stopplade): Laden, Entladen, Tausch in der Stopp-Rampe bei hörbarem Ring. Das Eingefrorene trägt
// Stopp × Einblende wie blende_von. Maß je Fall über 24 Lagen und dt 0/100/240/400 nach dem Stopp: Pegel nach dem Ereignis
// (Samples 24 bis 72) gegen davor (48 Samples) höchstens 1,05; größter Sprung höchstens 0,135 (2 × Grundlinie).
void test_stopp_laden() {
  static km::MatProbe p(400, 1), q2(400, 1, "c1c0000000000502");
  const Karte k(132.0, 0);
  const int64_t t_hoer = 1000 + cdj::ANSATZ_FRIST + cdj::DECK_KEYLOCK_EINSCHWING + 960 + 4000;
  const char* name[] = {"lade", "entlade", "tausche"};
  int fehl = 0;
  double f_max = 0, dx_max = 0;
  for (int art = 0; art < 3; ++art)
    for (int dt : {0, 100, 240, 400}) {
      double vm = 0, nm = 0, dm = 0;
      int hoer = 0;
      for (int off = 0; off < 24; ++off) {
        DeckLauf r(k, 200000);
        r.deck.lade(&p.m, 0);
        r.bis(1000);
        r.deck.start(1000, 20000);
        r.bis(t_hoer + off * 13);
        hoer += r.deck.keylock_ring_hoerbar() ? 1 : 0;
        const int64_t e1 = r.s;
        r.deck.stopp(e1);
        while (r.s < e1 + dt) r.teil((int)std::min<int64_t>(16, e1 + dt - r.s));
        const int64_t e2 = r.s;
        if (art == 0) r.deck.lade(&q2.m, e2);
        else if (art == 1) r.deck.entlade(e2);
        else r.deck.tausche(e2, &q2.m);
        r.bis(e2 + 3000);
        double v = 0, n = 0;
        for (int64_t t = e2 - 48; t < e2; ++t) v = std::max(v, (double)std::fabs(r.L[(size_t)t]));
        for (int64_t t = e2 + 24; t < e2 + 72; ++t) n = std::max(n, (double)std::fabs(r.L[(size_t)t]));
        vm = std::max(vm, v);
        nm = std::max(nm, n);
        dm = std::max(dm, max_dx(r.L, e2 - 2, e2 + 1200));
        while (r.deck.rueckgabe()) {
        }
      }
      const double f = vm > 0 ? nm / vm : 0;
      const bool ok = hoer == 24 && f <= 1.05 && dm <= 0.135;
      fehl += ok ? 0 : 1;
      f_max = std::max(f_max, f);
      dx_max = std::max(dx_max, dm);
      std::printf("    %-7s dt %3d: Ring hörbar %d/24, Pegel nach/vor %.3f, max |dx| %.4f%s\n", name[art], dt, hoer, f, dm,
                  ok ? "" : "  <- über der Grenze");
    }
  std::printf("  test20: 12 Fälle x 24 Lagen: Pegel nach/vor max %.3f, max |dx| %.4f, über der Grenze %d\n", f_max, dx_max, fehl);
  PRUEF(fehl == 0);
  ergebnis("keylock_stopp_laden");
}

// ------------------------------------------------------------------------------------------ Test 22
// Spec MINOR 7, Vertrag 5 Erfolgsweg: der Vorbereiter antwortet erst nach der Frist. s_h wandert (einmal), danach ist der
// Ring bereit und klingt; Tonhöhe danach ±2 ct, nichts aufgegeben.
void test_frist_erfolg() {
  static km::MatProbe p(40, 1);
  const Karte k(132.0, 0);
  const int64_t n = 3 * 48000 / B * B;
  DeckLauf l(k, n);
  l.deck.lade(&p.m, 0);
  l.deck.start(0, 0);
  const int64_t s_h0 = l.deck.keylock_s_h();
  l.takt = false;
  l.bis(s_h0 + cdj::DECK_KEYLOCK_EINSCHWING + 2 * B);  // die Frist läuft ab, ohne Antwort
  const uint64_t verpasst_bei_frist = l.deck.keylock_verpasst();
  const int64_t s_h1 = l.deck.keylock_s_h();
  l.takt = true;
  l.bis(n);
  const Ton t = ton_messen(l.L, s_h1 + cdj::DECK_KEYLOCK_EINSCHWING + cdj::DECK_KEYLOCK_BLENDE, n - B);
  std::printf("  test22: s_h %lld -> %lld (Raster %lld), verpasst %llu (bei Fristende %llu), aufgegeben %llu, Ring hörbar %d, "
              "%d Fenster max %.3f ct, Unterläufe %llu\n",
              (long long)s_h0, (long long)s_h1, (long long)(s_h1 % 1024), (unsigned long long)l.deck.keylock_verpasst(),
              (unsigned long long)verpasst_bei_frist, (unsigned long long)l.deck.keylock_aufgegeben(),
              (int)l.deck.keylock_ring_hoerbar(), t.fenster, t.max_ct, (unsigned long long)l.deck.keylock_unterlauf());
  PRUEF(verpasst_bei_frist == 1 && l.deck.keylock_verpasst() == 1);
  PRUEF(s_h1 > s_h0 && s_h1 % 1024 == 0);
  PRUEF(l.deck.keylock_aufgegeben() == 0 && l.deck.keylock_ring_hoerbar() && l.deck.keylock_unterlauf() == 0);
  PRUEF(t.fenster >= 15 && t.ueber == 0);
  ergebnis("keylock_frist_erfolg");
}

// ------------------------------------------------------------------------------------------ Test 9 (Vertrag 4)
// Material in eigenen Seiten; nach der Rückgabe: Seiten freigeben (MADV_DONTNEED) und sperren (PROT_NONE). Jeder Zugriff
// danach, von welchem Faden auch immer, ist ein SIGSEGV und beendet den Test rot.
struct SeitenMat {
  cdj::Material m{};
  void* p = nullptr;
  size_t bytes = 0;
  bool gesperrt = false;
};
SeitenMat* seiten_material(int64_t frames, int nr) {
  SeitenMat* s = new SeitenMat;
  s->bytes = (size_t)(2 * frames) * sizeof(float);
  s->p = mmap(nullptr, s->bytes, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
  if (s->p == MAP_FAILED) std::abort();
  float* d = static_cast<float*>(s->p);
  for (int64_t f = 0; f < frames; ++f) d[2 * f] = d[2 * f + 1] = (float)(0.3 * std::sin(2 * PI * 440.0 * (double)f / 48000.0));
  std::snprintf(s->m.material_id, sizeof s->m.material_id, "c1c00000000%05d", nr);
  s->m.basis_bpm = 128.0;
  s->m.fassung = 1;
  s->m.n_quellen = 1;
  s->m.frames = frames;
  s->m.quelle[0] = d;
  return s;
}
void sperren(SeitenMat* s) {
  madvise(s->p, s->bytes, MADV_DONTNEED);
  if (mprotect(s->p, s->bytes, PROT_NONE) != 0) std::abort();
  s->gesperrt = true;
}

void test_lebensdauer() {
  // Positiv-Kontrolle des Instruments: ein Zugriff auf gesperrtes Material endet mit SIGSEGV (im Kindprozess)
  {
    SeitenMat* s = seiten_material(4096, 0);
    sperren(s);
    const pid_t kind = fork();
    if (kind == 0) {
      volatile float x = s->m.quelle[0][100];
      (void)x;
      _exit(0);
    }
    int st = 0;
    waitpid(kind, &st, 0);
    // ohne Sanitizer: SIGSEGV; unter TSan fängt dessen Laufzeit das Signal und beendet mit Code 66 (DEADLYSIGNAL).
    // Entscheidend: das Kind kam nach dem Zugriff nicht zu _exit(0).
    const bool zugriff_scheitert = WIFSIGNALED(st) || (WIFEXITED(st) && WEXITSTATUS(st) != 0);
    std::printf("  test9: Positiv-Kontrolle: Zugriff auf gesperrtes Material -> %s (Signal %d, Code %d)\n",
                zugriff_scheitert ? "abgebrochen" : "KEIN ABBRUCH", WIFSIGNALED(st) ? WTERMSIG(st) : 0,
                WIFEXITED(st) ? WEXITSTATUS(st) : -1);
    PRUEF(zugriff_scheitert);
  }
  Karte k(128.0, 0);
  PRUEF(k.rampe(4.0, 136.0, 64.0));  // meist außerhalb der Basis: der Ring klingt
  uint32_t gen = 1;
  auto d = cdj::dehner_neu(1);
  cdj::StreckPost post;
  cdj::Deck deck;
  deck.setze_karte(&k, &gen);
  deck.setze_keylock(d.get(), &post);
  std::atomic<bool> halt{false};
  std::thread vorbereiter([&] {
    while (!halt.load(std::memory_order_acquire)) {
      post.takt(*d);
      std::this_thread::sleep_for(std::chrono::microseconds(700));
    }
  });
  std::thread arbeiter([&] {
    while (!halt.load(std::memory_order_acquire)) {
      d->fuelle_synchron();
      std::this_thread::sleep_for(std::chrono::microseconds(300));
    }
  });
  std::vector<SeitenMat*> alle;
  int nr = 1;
  auto neues = [&] {
    alle.push_back(seiten_material(1 << 16, nr++));
    return alle.back();
  };
  // Unter TSan rechnet R3 um ein Vielfaches langsamer: weniger Ereignisse, langsamerer Takt (geprüft werden Wettläufe)
#if defined(__SANITIZE_THREAD__)
  const int N_EREIGNISSE = 600, TAKT_US = 3000;  // Nachprüfung N7: 300 gaben 114 hörbare Blöcke gegen die Schwelle 100
#else
  const int N_EREIGNISSE = 2000, TAKT_US = 200;
#endif
  std::mt19937 zufall(20261007);
  int64_t s = 0;
  int ereignisse = 0, zurueck = 0, hoerbar_bloecke = 0, mat_wechsel = 0;
  deck.lade(&neues()->m, 0);
  deck.start(0, 0);
  auto rueck = [&] {
    while (const cdj::Material* m = deck.rueckgabe()) {
      for (SeitenMat* x : alle)
        if (&x->m == m) {
          PRUEF(!x->gesperrt);
          sperren(x);
          ++zurueck;
        }
    }
  };
  const auto t0 = std::chrono::steady_clock::now();
  float l[B], r[B];
  while (ereignisse < N_EREIGNISSE) {
    const int bloecke = 1 + (int)(zufall() % 40);  // auch länger als die Frist (16 Blöcke): der Ring klingt dazwischen
    for (int i = 0; i < bloecke; ++i) {
      deck.block(s, B, l, r, 0);
      s += B;
      hoerbar_bloecke += deck.keylock_ring_hoerbar() ? 1 : 0;
      rueck();
      std::this_thread::sleep_for(std::chrono::microseconds(TAKT_US));
    }
    const cdj::Material* m = deck.material();
    switch (zufall() % 10) {
      case 0: deck.tausche(s, &neues()->m); ++mat_wechsel; break;
      case 1: deck.lade(&neues()->m, s); ++mat_wechsel; break;
      case 2: deck.entlade(s); deck.lade(&neues()->m, s); mat_wechsel += 2; break;
      case 3: deck.springe(s, (int64_t)(zufall() % 20000) - 10000); break;
      case 4: if (m) deck.start(s, (int64_t)(zufall() % 40000)); break;
      case 5: deck.stopp(s); break;
      case 6: if (m) deck.setze_kopf(s, (int64_t)(zufall() % 40000)); break;
      case 7: if (m && deck.laeuft()) deck.loop_an(s, deck.frame_bei(s), 22500); else deck.loop_aus(s); break;
      case 8: deck.keylock(s, !deck.keylock_an()); break;
      default: if (m && !deck.laeuft()) deck.start(s, 0); break;
    }
    ++ereignisse;
  }
  // Ende: entladen, weiterlaufen, bis alles zurück ist
  deck.entlade(s);
  const auto t_ende = std::chrono::steady_clock::now();
  while (zurueck < (int)alle.size() && std::chrono::steady_clock::now() - t_ende < std::chrono::seconds(30)) {
    deck.block(s, B, l, r, 0);
    s += B;
    rueck();
    std::this_thread::sleep_for(std::chrono::microseconds(500));
  }
  if (zurueck < (int)alle.size()) {  // Diagnose: was hält die Leihe noch
    const uint64_t ant = post.antwort();
    std::printf("  test9: offen: Antwort nr %u e %u, quittiert %u, Anfrage des Decks %u, Rückgaben im Deck?\n",
                cdj::StreckPost::antwort_nr(ant), cdj::StreckPost::antwort_e(ant), d->quittiert_e(), deck.keylock_anfrage());
    deck.keylock_leihe().jeder([](const cdj::DeckBand& b, uint32_t nr_ab, uint32_t e_ab) {
      std::printf("    Platz: Material %s, nr_ab %u, e_ab %u\n", b.m ? b.m->material_id : "-", nr_ab, e_ab);
    });
  }
  halt.store(true, std::memory_order_release);
  vorbereiter.join();
  arbeiter.join();
  const double sek = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
  std::printf("  test9: %.1f s, %d Ereignisse, %d Materialwechsel, %zu Materialien, %d zurück und gesperrt, Ring hörbar in "
              "%d Blöcken, Unterläufe %llu, kein Platz %llu, besetzt %llu, verliehen am Ende %d\n",
              sek, ereignisse, mat_wechsel, alle.size(), zurueck, hoerbar_bloecke,
              (unsigned long long)deck.keylock_unterlauf(), (unsigned long long)deck.keylock_kein_platz(),
              (unsigned long long)post.besetzt(), deck.keylock_verliehen());
  PRUEF(zurueck == (int)alle.size());  // alles kam zurück (kein Leck), und erst nach der Quittung (sonst SIGSEGV)
  PRUEF(deck.keylock_verliehen() == 0);
  PRUEF(hoerbar_bloecke > 100);  // Positiv: der Ring lief wirklich und las aus dem Material
  PRUEF(mat_wechsel > N_EREIGNISSE / 7);
  ergebnis("keylock_lebensdauer");
}


// ================================================================================== Task 5: Loop auf dem Deck im Keylock
// Bezug für den Loop: der Strom, den das Deck OHNE Dehner bei Basis 128 im Direktweg spielt (Naht mit 128-Frame-Blende vor
// dem Loop-Ende, deck.cpp Deck::block), als DehnerQuelle über die UNGEWICKELTE Quellposition p: band(p) = Direktweg-Ausgabe
// am Sample p − f0. Er kommt aus Deck::block ohne Keylock, nicht aus DeckBand: Bezug des Bandes (Test 28, bitgleich) und
// Quelle des rohen R3 für die Lage (b).
struct LoopStrom : cdj::DehnerQuelle {
  std::vector<float> x;
  int64_t f0 = 0;
  void band(int64_t ab, int n, float* l, float* r) const noexcept override {
    for (int i = 0; i < n; ++i) {
      const int64_t j = ab + i - f0;
      l[i] = r[i] = (j >= 0 && j < (int64_t)x.size()) ? x[(size_t)j] : 0.0f;
    }
  }
  double basis_bpm() const noexcept override { return 128.0; }
};
LoopStrom loop_strom(const cdj::Material& m, int64_t f0, int64_t a_f, int64_t l_f, int64_t frames) {
  LoopStrom q;
  q.f0 = f0;
  DeckLauf v(Karte(128.0, 0), frames, false);
  v.deck.lade(&m, 0);
  v.deck.start(0, f0);
  v.deck.loop_an(0, a_f, l_f);
  v.bis(frames);
  q.x = v.L;
  return q;
}

// Kern-Sample, an dem die ungewickelte Quellposition p klingt (Anker a: Master-Beat und Quellframe des Starts)
double s_von(const Karte& k, DehnerAnker a, double p) { return k.sample_at(a.b + (p - a.f) / FPB); }

// Tonhöhe wie ton_messen, aber die Fenster liegen zwischen den Nähten mit Abstand rand (für Loops, deren Länge kein
// Vielfaches der Sinus-Periode ist: dort springt die Phase an der Naht schon im Direktweg, ein Fenster darüber misst den
// Sprung und nicht die Tonhöhe).
Ton ton_zwischen(const std::vector<float>& x, int64_t a, int64_t b, std::vector<int64_t> naehte, int64_t rand) {
  Ton t;
  naehte.push_back(b + rand);
  int64_t von = a;
  for (int64_t n : naehte) {
    const int64_t bis = std::min(b, n - rand);
    for (int64_t s = von; s + 4800 <= bis; s += 4800) {
      const double ct = 1200.0 * std::log2(km::freq(x, s, s + 4800) / 1000.0);
      t.max_ct = std::max(t.max_ct, std::fabs(ct));
      if (std::fabs(ct) > 2.0) {
        ++t.ueber;
        std::printf("    Fenster ab %lld: %+.3f ct\n", (long long)s, ct);
      }
      ++t.fenster;
    }
    von = std::max(von, n + rand);
  }
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

// Blende an der Naht (Messgröße Blende, Vertrag 16): Fenster von 960 Samples um das Sample s_n, an dem die Mitte der
// 128-Frame-Blende klingt; Sinus vor dem Fenster und nach dem Fenster je aus 2000 Samples eingepasst, Abweichung vom idealen
// Übergang (1 − w) · vor + w · nach.
double naht_abweichung(const std::vector<float>& x, int64_t s_n) {
  const int64_t a = s_n - cdj::DECK_KEYLOCK_BLENDE / 2;
  const km::Sinus vor = km::sinus_einpassen(x, a - 2000, a, 1000.0);
  const km::Sinus nach = km::sinus_einpassen(x, a + cdj::DECK_KEYLOCK_BLENDE, a + cdj::DECK_KEYLOCK_BLENDE + 2000, 1000.0);
  return blende_abweichung(x, a, vor, nach);
}

// Rauschen als Material (jede Abweichung sichtbar, nichts periodisch), Basis 128, L = R
struct MatRausch {
  std::vector<float> d;
  cdj::Material m{};
  explicit MatRausch(double beats) {
    const int64_t frames = (int64_t)std::ceil(beats * FPB);
    std::snprintf(m.material_id, sizeof m.material_id, "%s", "c1c0000000000528");
    m.basis_bpm = 128.0;
    m.fassung = 1;
    m.n_quellen = 1;
    m.frames = frames;
    d.assign((size_t)(2 * frames), 0.0f);
    uint32_t z = 12345;
    for (int64_t f = 0; f < frames; ++f) {
      z = z * 1664525u + 1013904223u;
      d[(size_t)(2 * f)] = d[(size_t)(2 * f + 1)] = (float)((double)(z >> 8) / 16777216.0 - 0.5);
    }
    m.quelle[0] = d.data();
  }
};

// Ergebnis eines Loop-Laufs
struct LoopMass {
  Ton t;
  std::vector<double> naht;  // Abweichung je Naht (Sinus: vom idealen Übergang; Rauschen: vom rohen R3 des Loop-Stroms)
  std::vector<double> grund;  // Rauschen: dasselbe Maß mitten im Durchlauf (Grundlinie)
  int64_t ungleich = 0, geprueft = 0;  // Rauschen: Samples ab s_r ungleich zum Bezug-Dehner
  km::Lage lage;
  std::vector<double> anfang;  // Lage des Klicks am Loop-Anfang je Durchlauf gegen das Soll
  std::vector<std::pair<int, double>> je_klick;  // (ungewickelter Quell-Beat, Lage gegen das Soll)
  int64_t hoer = 0, hoer_soll = 0;
  uint64_t unterlauf = 0, hart = 0, verpasst = 0;
};

// Ein Loop von n Beats auf dem Deck bei Karte k: Start bei Sample 0 auf Quell-Beat 4, bei s_L (Master-Beat 2, Kopf bei
// Quell-Beat 6, VOR dem Loop) Loop [8, 8 + n) Quell-Beats; D Durchläufe (Vorgabe drei) und 1,5 Beats. art 1 Sinus: Tonhöhe ab dem
// Ende der Blende des Loop-Ansatzes, Blende an jeder Naht. art 0 Klick: Lage aller Klicks (a)/(b) und der Klicks am
// Loop-Anfang je Durchlauf gegen das Soll. Soll aus Karte und Loop: ungewickelte Quellposition ab dem Start (Anker des
// Starts im Test), gewickelt nur im Bezugsstrom; nicht der Anker, den das Deck meldet. s_r_min: der Ring klingt nicht vor
// diesem Sample (Basis 128 vor einer Rampe: Direktweg).
LoopMass loop_lauf(const Karte& k, int n_beats, int art, int64_t s_r_min = 0, int D = 3) {
  static km::MatProbe* mat[2][17] = {};
  static MatRausch* rausch[17] = {};
  if (art < 2 && !mat[art][n_beats]) mat[art][n_beats] = new km::MatProbe(8 + n_beats, art);
  if (art == 2 && !rausch[n_beats]) rausch[n_beats] = new MatRausch(8 + n_beats);
  const cdj::Material& m = art == 2 ? rausch[n_beats]->m : mat[art][n_beats]->m;
  const int64_t F0 = (int64_t)(4 * FPB), A = (int64_t)(8 * FPB), L = (int64_t)(n_beats * FPB);
  const DehnerAnker a{0.0, (double)F0};
  const int64_t s_L = (int64_t)k.sample_at(2.0) / B * B;
  const int64_t n = (int64_t)k.sample_at(4.0 + (double)D * n_beats + 1.5);
  LoopMass r;
  DeckLauf l(k, n);
  l.deck.lade(&m, 0);
  l.deck.start(0, F0);
  l.bis(s_L);
  l.deck.loop_an(s_L, A, L);
  const int64_t s_h = l.deck.keylock_s_h();
  PRUEF(s_h == s_L + cdj::ANSATZ_FRIST);
  const int64_t s_r = std::max(s_h + cdj::DECK_KEYLOCK_EINSCHWING + cdj::DECK_KEYLOCK_BLENDE, s_r_min);
  l.bis(s_L + 2 * B);
  const uint32_t e = l.deck.keylock_epoche();
  while (l.s < n) {
    l.teil((int)std::min<int64_t>(B, n - l.s));
    if (l.s > s_r + B) {
      ++r.hoer_soll;
      r.hoer += l.deck.keylock_ring_hoerbar() ? 1 : 0;
    }
  }
  r.unterlauf = l.deck.keylock_unterlauf();
  r.hart = l.deck.keylock_hart();
  r.verpasst = l.deck.keylock_verpasst();
  std::vector<int64_t> naehte;  // Kern-Sample der Mitte der Naht-Blende, jede im Lauf (die drei Durchläufe und was danach kommt)
  for (int j = 1; s_von(k, a, (double)(A + j * L)) < (double)n; ++j)
    naehte.push_back(std::llround(s_von(k, a, (double)(A + j * L - cdj::DECK_BLENDE / 2))));
  PRUEF(naehte.size() >= 3);
  if (art == 1) {
    const bool sprung = L % 48 != 0;  // 1000 Hz: 48 Samples je Periode
    r.t = ton_zwischen(l.L, s_r, n - B, sprung ? naehte : std::vector<int64_t>{}, 2400);
    for (int j = 0; j < 3; ++j) r.naht.push_back(naht_abweichung(l.L, naehte[(size_t)j]));
  } else if (art == 2) {
    // Task 5b (Prüfung MINOR): Naht im Ring mit Material, das sich nicht wiederholt, durch R3. Bezug: ein zweiter Dehner
    // desselben Codes, gespeist mit dem Loop-Strom des Direktwegs (LoopStrom, aus Deck::block ohne Keylock, nicht aus
    // DeckBand), derselbe Ansatz (s_h, Anker, Karte). Der Ring klingt ab s_r allein: das Deck muss dort bitgleich zu diesem
    // Bezug sein. Rohes R3 (km::r3_roh) war hier kein Bezug, solange es in festen 256er-Blöcken speiste (mit Rauschen 0,40 bis
    // 0,78 Abweichung auch mitten im Durchlauf, task-05b/naht_rauschen_roh.txt); seit Keylock 7b.7 speist es wie der Dehner
    // nach getSamplesRequired. Der zweite Dehner bleibt der Bezug, weil er denselben Code samt Ring fährt (bitgleich prüfbar).
    // Maß je Naht: größte Abweichung in 960 Samples um die Naht, daneben mitten im Durchlauf.
    PRUEF(s_h < n);  // Leer-Epoche (s_h INT64_MAX): kein Ring, rot statt Überlauf
    if (s_h >= n) return r;
    const LoopStrom q = loop_strom(m, F0, A, L, (int64_t)((8.0 + (double)D * n_beats + 3.0) * FPB) - F0 + 40000);
    std::unique_ptr<cdj::DehnerBasis> d2 = cdj::dehner_neu(2);
    cdj::AnsatzAuftrag a2;
    a2.quelle = &q;
    a2.s_h = s_h;
    a2.anker = l.deck.keylock_anker();
    a2.karte = k;
    a2.generation = l.gen;
    const uint32_t e2 = d2->ansetzen(a2);
    d2->ring().setze_epoche(e2);
    std::vector<float> R((size_t)n, 0.0f);
    float rl[B], rr[B];
    for (int64_t t = s_h; t + B <= n; t += B) {
      cdj::KartenStand ks;
      ks.karte = k;
      ks.anker = a2.anker;
      ks.generation = l.gen;
      ks.s_jetzt = t;
      d2->karte_veroeffentlichen(ks);
      d2->fuelle_synchron();
      d2->ring().bereit_ab(t);
      const int got = d2->ring().lies_bis(t, B, rl, rr);
      for (int j = 0; j < got; ++j) R[(size_t)(t + j)] = rl[j];
    }
    for (int64_t t = s_r; t < n - B; ++t) r.ungleich += l.L[(size_t)t] != R[(size_t)t] ? 1 : 0;
    r.geprueft = n - B - s_r;
    auto abw = [&](int64_t mitte) {
      double mx = 0;
      for (int64_t t = mitte - 480; t < mitte + 480; ++t) mx = std::max(mx, (double)std::fabs(l.L[(size_t)t] - R[(size_t)t]));
      return mx;
    };
    for (int j = 0; j < 3; ++j) {
      r.naht.push_back(abw(naehte[(size_t)j]));
      r.grund.push_back(abw(std::llround(s_von(k, a, (double)(A + j * L + L / 2)))));
    }
  } else {
    static const std::vector<float> tpl = km::klick_vorlage();
    const std::vector<double> f = l.faktoren(e, s_h);
    PRUEF(e != cdj::EPOCHE_KEINE && !f.empty());
    if (f.empty()) return r;
    const LoopStrom q = loop_strom(m, F0, A, L, (int64_t)((8.0 + (double)D * n_beats + 3.0) * FPB) - F0 + 40000);
    const int q0 = (int)std::ceil(4.0 + k.beat_at((double)s_r)), q1 = 8 + D * n_beats + 1;
    r.lage = km::lage_messen(l.L, q, k, a, km::band_start(k, a, s_h, f.at(0)), f, s_h, q0, q1);
    for (int i = q0; i < q1; ++i) {
      double ei = 999;
      if (km::klick_lage(l.L, k, a, i, ei, tpl, km::MITTE)) r.je_klick.push_back({i, ei});
    }
    for (int j = 1; j <= D; ++j) {
      double ej = 999;
      PRUEF(km::klick_lage(l.L, k, a, 8 + j * n_beats, ej, tpl, km::MITTE));
      r.anfang.push_back(ej);
    }
    PRUEF(r.lage.n == q1 - q0);
  }
  return r;
}

void loop_drucken(const char* name, const LoopMass& r) {
  std::printf("  %s: Ring hörbar %lld/%lld Blöcke, Unterläufe %llu (hart %llu), verpasst %llu\n", name, (long long)r.hoer,
              (long long)r.hoer_soll, (unsigned long long)r.unterlauf, (unsigned long long)r.hart,
              (unsigned long long)r.verpasst);
  if (r.t.fenster)
    std::printf("  %s: Sinus %d Fenster, max |Tonhöhe| %.3f ct, über 2 ct %d, Null-Läufe %d; Naht-Blende", name, r.t.fenster,
                r.t.max_ct, r.t.ueber, r.t.null_laeufe);
  if (!r.grund.empty())
    std::printf("  %s: %lld von %lld Samples ungleich zum Bezug-Dehner; |Ring − Bezug| an der Naht", name,
                (long long)r.ungleich, (long long)r.geprueft);
  for (double x : r.naht) std::printf(" %.4f", x);
  if (r.t.fenster) std::printf("\n");
  if (!r.grund.empty()) {
    std::printf("; mitten im Durchlauf");
    for (double x : r.grund) std::printf(" %.4f", x);
    std::printf("\n");
  }
  if (r.lage.n)
    std::printf("  %s: Klick %d Klicks, (a) Mittel %+.2f, (b) max |Deck − rohes R3| %.2f (Klick %d), max |Lage| %.2f; "
                "Loop-Anfang je Durchlauf",
                name, r.lage.n, r.lage.mittel, r.lage.max_roh, r.lage.q_roh, r.lage.max_soll);
  for (double x : r.anfang) std::printf(" %+.2f", x);
  if (r.lage.n) std::printf("\n");
  if (std::getenv("KL_DIAG"))
    for (const auto& x : r.je_klick) std::printf("    Klick %d (ungewickelt): %+.2f\n", x.first, x.second);
}

void loop_grenzen(const LoopMass& r, bool naht) {
  PRUEF(r.hoer_soll > 100 && r.hoer == r.hoer_soll);  // nach dem Ansatz durchgehend der Ring, auch über die Nähte
  PRUEF(r.unterlauf == 0 && r.hart == 0);
  if (r.t.fenster || !r.naht.empty()) {
    PRUEF(r.t.fenster >= 6 && r.t.ueber == 0 && r.t.null_laeufe == 0);
    if (naht)
      for (double x : r.naht) PRUEF(x <= 0.02);
  }
  if (!r.anfang.empty()) {
    // Keylock 4.6: das absolute Mittel wird nur ausgewiesen (Deck-Versatz 0; Hann-Klick liegt um die R3-eigene Lage daneben)
    PRUEF(r.lage.max_roh <= 12.0);
    PRUEF(r.lage.max_soll <= 12.0);
    for (double x : r.anfang) PRUEF(std::fabs(x) <= 12.0);
  }
}

// ------------------------------------------------------------------------------------------ Test 23
// Task 5: Loop 4 Beats bei 132 im Keylock, drei Durchläufe: Tonhöhe ±2 ct, Blende an jeder Naht <= 0,02, Klick am
// Loop-Anfang je Durchlauf ±12 gegen das Soll, Lage (a) Mittel (seit 4.6 ausgewiesen) und (b) je Klick ±12 gegen rohes R3 des Loop-Stroms.
void test_loop() {
  const Karte k(132.0, 0);
  const LoopMass s = loop_lauf(k, 4, 1), c = loop_lauf(k, 4, 0);
  loop_drucken("test23 Sinus", s);
  loop_drucken("test23 Klick", c);
  loop_grenzen(s, true);
  loop_grenzen(c, true);
  // Positiv-Kontrolle des Naht-Maßes: ein harter Phasensprung von 90° in der Mitte des Fensters wiche vom Ideal ab
  std::vector<float> x(20000);
  for (int64_t i = 0; i < 20000; ++i)
    x[(size_t)i] = (float)(0.5 * std::sin(2 * PI * 1000.0 * (double)i / 48000.0 + (i >= 10000 ? PI / 2 : 0.0)));
  const double hart = naht_abweichung(x, 10000);
  std::printf("  test23: Positiv-Kontrolle Naht-Maß, harter 90°-Sprung: %.3f\n", hart);
  PRUEF(hart > 0.1);
  ergebnis("keylock_loop");
}

// ------------------------------------------------------------------------------------------ Test 24
// Task 5: Loop-Länge 1 und 16 Beats bei 132 (4 Beats: Test 23), je drei Durchläufe, dieselben Grenzen. Beim 1-Beat-Loop
// springt die Phase des 1000-Hz-Sinus an der Naht schon im Material (22 500 Frames sind 468,75 Perioden): Tonhöhe dort in
// Fenstern zwischen den Nähten, die Naht-Blende nur ausgewiesen (ihr Ideal ist eine lineare Blende über 960 Samples, R3
// verschmiert den Sprung anders).
void test_loop_laengen() {
  const Karte k(132.0, 0);
  for (int nb : {1, 16}) {
    char name[32];
    std::snprintf(name, sizeof name, "test24 %d Beat Sinus", nb);
    const LoopMass s = loop_lauf(k, nb, 1);
    loop_drucken(name, s);
    std::snprintf(name, sizeof name, "test24 %d Beat Klick", nb);
    const LoopMass c = loop_lauf(k, nb, 0);
    loop_drucken(name, c);
    loop_grenzen(s, nb != 1);
    loop_grenzen(c, true);
    if (nb == 1) {  // Einordnung: dasselbe Maß an der Naht des Direktwegs bei 128 (ohne R3), derselbe Phasensprung
      static km::MatProbe ps(9, 1);
      const int64_t F0 = (int64_t)(4 * FPB), A = (int64_t)(8 * FPB), L = (int64_t)FPB;
      const LoopStrom q = loop_strom(ps.m, F0, A, L, A - F0 + 3 * L);
      std::printf("  test24 1 Beat: Naht-Maß am Direktweg bei 128 (ohne R3): %.4f\n",
                  naht_abweichung(q.x, A + L - cdj::DECK_BLENDE / 2 - F0));
    }
  }
  ergebnis("keylock_loop_laengen");
}

// ------------------------------------------------------------------------------------------ Test 25
// Task 5: Loop bei Basis 128 bitgleich zum Deck ohne Keylock (Direktweg), der Ring läuft warm mit dem Loop-Band (keine
// Leer-Epoche: gelesen wächst, Vorlauf gemeldet).
void test_loop_basis() {
  static km::MatProbe p(12, 1);
  const Karte k(128.0, 0);
  const int64_t F0 = (int64_t)(4 * FPB), A = (int64_t)(8 * FPB), L = (int64_t)(4 * FPB);
  const int64_t s_L = (int64_t)k.sample_at(2.0) / B * B, n = (int64_t)k.sample_at(4.0 + 12.0 + 1.5);
  DeckLauf l(k, n), v(k, n, false);
  for (DeckLauf* x : {&l, &v}) {
    x->deck.lade(&p.m, 0);
    x->deck.start(0, F0);
    x->bis(s_L);
    x->deck.loop_an(s_L, A, L);
  }
  const int64_t s_m = s_L + cdj::ANSATZ_FRIST + 4 * B;
  l.bis(s_m);
  const uint64_t g0 = l.deck.keylock_gelesen();
  const int vorlauf = l.deck.keylock_vorlauf_bloecke();
  l.bis(n);
  v.bis(n);
  int64_t ungleich = 0;
  for (int64_t s = 0; s < n; ++s) ungleich += l.L[(size_t)s] != v.L[(size_t)s];
  const uint64_t g = l.deck.keylock_gelesen() - g0;
  std::printf("  test25: %lld von %lld Samples ungleich; im Loop Ring gelesen %llu Frames (Soll > %lld), Vorlauf %d Blöcke, "
              "leer %d, hörbar %d\n",
              (long long)ungleich, (long long)n, (unsigned long long)g, (long long)(n - s_m - 2 * B), vorlauf,
              (int)l.deck.keylock_leser().ist_leer(), (int)l.deck.keylock_ring_hoerbar());
  PRUEF(ungleich == 0);
  PRUEF(!l.deck.keylock_ring_hoerbar());
  PRUEF(!l.deck.keylock_leser().ist_leer() && vorlauf >= 0);
  PRUEF(g > (uint64_t)(n - s_m - 2 * B));
  ergebnis("keylock_loop_basis");
}

// ------------------------------------------------------------------------------------------ Test 26
// Task 5: Loop 4 Beats, angesetzt bei Basis 128, darin die Rampe 128 -> 132 über 8 Beats ab Master-Beat 6, fünf
// Durchläufe: Lage hält. Grenzen nach der Messgrößen-Tabelle des Plans: in der Rampe je Klick ±12 (gegen das Soll und
// gegen rohes R3, Loop-Anfang je Durchlauf), das Mittel bei festem Tempo (Klicks nach dem Ende der Rampe) seit 4.6 nur ausgewiesen.
// Über alle Klicks ab dem Ring liegt das Mittel bei −3,86, mit wie ohne Loop gleich (gemessen 08.10.,
// task-05/rampe_mit_ohne_loop.txt): Eigenschaft von R3 und Regler in einer 8-Beat-Rampe, nicht des Loops.
// Tonhöhe ±2 ct ab der Rampe.
void test_loop_rampe() {
  Karte k(128.0, 0);
  PRUEF(k.rampe(6.0, 132.0, 8.0));
  const int64_t s_ring = (int64_t)k.sample_at(6.0) + 2 * cdj::DECK_KEYLOCK_BLENDE + B;
  const LoopMass s = loop_lauf(k, 4, 1, s_ring, 5), c = loop_lauf(k, 4, 0, s_ring, 5);
  loop_drucken("test26 Sinus", s);
  loop_drucken("test26 Klick", c);
  double summe = 0;
  int n_fest = 0;
  for (const auto& x : c.je_klick)
    if (x.first - 4 >= 14) {  // Master-Beat des Klicks = Quell-Beat − 4; Rampe endet bei 14
      summe += x.second;
      ++n_fest;
    }
  const double mittel_fest = n_fest ? summe / n_fest : NAN;
  std::printf("  test26: nach der Rampe (132 fest) %d Klicks, Mittel %+.2f; über alle %d Klicks %+.2f\n", n_fest, mittel_fest,
              c.lage.n, c.lage.mittel);
  loop_grenzen(s, true);
  PRUEF(c.hoer_soll > 100 && c.hoer == c.hoer_soll && c.unterlauf == 0 && c.hart == 0);
  PRUEF(c.lage.max_roh <= 12.0 && c.lage.max_soll <= 12.0);
  for (double x : c.anfang) PRUEF(std::fabs(x) <= 12.0);
  PRUEF(n_fest >= 10);
  // Keylock 4.6: das absolute Mittel wird nur ausgewiesen (Deck-Versatz 0; Hann-Klick liegt um die R3-eigene Lage daneben)
  ergebnis("keylock_loop_rampe");
}

// ------------------------------------------------------------------------------------------ Test 27
// Task 5, Vertrag 6: Loop an und aus während der Ring klingt (bei 132), wie der Kern es tut (Loop ab dem Kopf, Länge
// 4 Beats). Jedes ist ein Ereignis: was klang (Ring), blendet in 960 Frames gegen die Varispeed-Brücke aus (<= 0,02 gegen
// den idealen Übergang, Brücke analytisch aus dem Varispeed-Kopf des Decks), Ansatz auf s + ANSATZ_FRIST, danach wieder der
// Ring (±2 ct, auch über die Nähte), ohne harten Rückfall.
void test_loop_an_aus() {
  static km::MatProbe p(40, 1);
  const Karte k(132.0, 0);
  const int64_t s_an = (int64_t)k.sample_at(8.0) / B * B;
  const int64_t L = (int64_t)(4 * FPB);
  const int64_t s_aus = (int64_t)k.sample_at(8.0 + 4.0 * 2.5) / B * B;  // zweieinhalb Durchläufe: Kopf gewickelt, mitten im Loop
  const int64_t n = (int64_t)k.sample_at(26.0);
  DeckLauf l(k, n);
  l.deck.lade(&p.m, 0);
  l.deck.start(0, 0);
  l.bis(s_an);
  PRUEF(l.deck.keylock_ring_hoerbar());
  auto bruecke_bei = [&](int64_t s0) {
    (void)s0;
    const double ab = l.deck.anker_b(), af = (double)l.deck.anker_f();
    return [=](double s) { return 0.5 * std::sin(2 * PI * 1000.0 * (af + (k.beat_at(s) - ab) * FPB) / 48000.0); };
  };
  // an
  const auto br_an = bruecke_bei(s_an);
  l.deck.loop_an(s_an, l.deck.frame_bei(s_an), L);
  const int64_t s_h_an = l.deck.keylock_s_h();
  l.bis(s_aus);
  PRUEF(l.deck.loop_aktiv() && l.deck.keylock_ring_hoerbar());
  const uint64_t hart_an = l.deck.keylock_hart();
  // aus
  const auto br_aus = bruecke_bei(s_aus);
  l.deck.loop_aus(s_aus);
  const int64_t s_h_aus = l.deck.keylock_s_h();
  l.bis(n);
  const km::Sinus alt_an = km::sinus_einpassen(l.L, s_an - 2000, s_an, 1000.0);
  const km::Sinus alt_aus = km::sinus_einpassen(l.L, s_aus - 2000, s_aus, 1000.0);
  const double bl_an = blende_abweichung(l.L, s_an, alt_an, br_an), bl_aus = blende_abweichung(l.L, s_aus, alt_aus, br_aus);
  double max_b_an = 0, max_b_aus = 0;
  for (int64_t s = s_an + cdj::DECK_KEYLOCK_BLENDE; s < std::min(s_h_an, s_aus); ++s)  // leer: s_h INT64_MAX
    max_b_an = std::max(max_b_an, std::fabs((double)l.L[(size_t)s] - br_an((double)s)));
  for (int64_t s = s_aus + cdj::DECK_KEYLOCK_BLENDE; s < std::min(s_h_aus, n); ++s)
    max_b_aus = std::max(max_b_aus, std::fabs((double)l.L[(size_t)s] - br_aus((double)s)));
  const int64_t r_an = std::min(s_h_an, s_aus) + cdj::DECK_KEYLOCK_EINSCHWING + cdj::DECK_KEYLOCK_BLENDE;
  const int64_t r_aus = std::min(s_h_aus, n) + cdj::DECK_KEYLOCK_EINSCHWING + cdj::DECK_KEYLOCK_BLENDE;
  const Ton t_loop = ton_messen(l.L, std::min(r_an, s_aus), s_aus), t_nach = ton_messen(l.L, std::min(r_aus, n - B), n - B);
  std::printf("  test27: an bei %lld (s_h %lld): Blende Ring -> Brücke %.4f, Brücke max %.2e; im Loop %d Fenster max %.3f ct, "
              "Null-Läufe %d\n",
              (long long)s_an, (long long)s_h_an, bl_an, max_b_an, t_loop.fenster, t_loop.max_ct, t_loop.null_laeufe);
  std::printf("  test27: aus bei %lld (s_h %lld): Blende Ring -> Brücke %.4f, Brücke max %.2e; danach %d Fenster max %.3f ct, "
              "Null-Läufe %d; hart %llu (bis zum Aus %llu), Unterläufe %llu, Ring hörbar am Ende %d\n",
              (long long)s_aus, (long long)s_h_aus, bl_aus, max_b_aus, t_nach.fenster, t_nach.max_ct, t_nach.null_laeufe,
              (unsigned long long)l.deck.keylock_hart(), (unsigned long long)hart_an,
              (unsigned long long)l.deck.keylock_unterlauf(), (int)l.deck.keylock_ring_hoerbar());
  PRUEF(s_h_an == s_an + cdj::ANSATZ_FRIST && s_h_aus == s_aus + cdj::ANSATZ_FRIST);
  PRUEF(bl_an <= 0.02 && bl_aus <= 0.02);
  PRUEF(max_b_an < 1e-3 && max_b_aus < 1e-3);
  PRUEF(t_loop.fenster >= 40 && t_loop.ueber == 0 && t_loop.null_laeufe == 0);
  PRUEF(t_nach.fenster >= 20 && t_nach.ueber == 0 && t_nach.null_laeufe == 0);
  PRUEF(l.deck.keylock_hart() == 0 && l.deck.keylock_unterlauf() == 0);
  PRUEF(!l.deck.loop_aktiv() && l.deck.keylock_ring_hoerbar());
  ergebnis("keylock_loop_an_aus");
}

// ------------------------------------------------------------------------------------------ Test 28
// Task 5: das Band des Loops (DeckBand mit loop_a, loop_l) liefert über die ungewickelte Quellposition genau den Strom, den
// das Deck im Direktweg spielt, Naht samt 128-Frame-Blende eingeschlossen: bitgleich zum Bezug (LoopStrom), über vier
// Durchläufe, in Aufrufen von 1 bis 32 768 Frames (länger als ein 1-Beat-Loop, wie der Dehner sie macht). Material:
// Sinus (1-Beat-Loop: Phasensprung an der Naht, die Blende ist hörbar) und Rauschen (jede Abweichung sichtbar).


// ------------------------------------------------------------------------------------------ Test 29
// Task 5b (Prüfung MAJOR, Regression Task 5): das Raster schiebt den Loop aus dem Material (Audit F09: der Loop endet), bei
// klingendem Ring. Material: 1000 Hz bis Quell-Beat 6, danach 1500 Hz (Ton zeigt die Position). Loop [1, 5) Beats, bei
// Master-Beat 10 Raster −1,5 Beats: Loop-Anfang −0,5 Beats, der Loop endet, der Kopf springt um −1,5 Beats und läuft
// linear in den hohen Ton. Soll: in jedem Beat-Fenster ab dem Ende der Blende auf den Ring derselbe Ton wie der Varispeed-
// Bezug (ohne Keylock), ±2 ct; vorher wickelte der Ring weiter den alten Loop (Probe task-05-pruefung/spec/pruef_raster.txt:
// 0 von 15 Fenstern mit dem hohen Ton).
struct MatZweiTon {
  std::vector<float> d;
  cdj::Material m{};
  MatZweiTon(double beats, double grenze_beats) {
    const int64_t frames = (int64_t)std::ceil(beats * FPB);
    std::snprintf(m.material_id, sizeof m.material_id, "%s", "c1c0000000000529");
    m.basis_bpm = 128.0;
    m.fassung = 1;
    m.n_quellen = 1;
    m.frames = frames;
    d.assign((size_t)(2 * frames), 0.0f);
    for (int64_t f = 0; f < frames; ++f) {
      const double hz = (double)f < grenze_beats * FPB ? 1000.0 : 1500.0;
      d[(size_t)(2 * f)] = d[(size_t)(2 * f + 1)] = (float)(0.5 * std::sin(2 * PI * hz * (double)f / 48000.0));
    }
    m.quelle[0] = d.data();
  }
};

void test_loop_raster() {
  static MatZweiTon mt(40.0, 6.0);
  const Karte k(132.0, 0);
  const int64_t n = (int64_t)k.sample_at(26.0);
  DeckLauf l(k, n), v(k, n, false);
  int64_t s_ev = 0;
  for (DeckLauf* x : {&l, &v}) {
    x->deck.lade(&mt.m, 0);
    x->deck.start(0, 0);
    x->bis((int64_t)k.sample_at(2.0) / B * B);
    x->deck.loop_an(x->s, (int64_t)FPB, (int64_t)(4 * FPB));
    x->bis((int64_t)k.sample_at(10.0) / B * B);
    s_ev = x->s;
  }
  PRUEF(l.deck.keylock_ring_hoerbar());
  for (DeckLauf* x : {&l, &v}) x->deck.setze_raster(s_ev, -(int64_t)(1.5 * FPB));
  PRUEF(!l.deck.loop_aktiv() && !v.deck.loop_aktiv());
  const int64_t s_r = s_ev + cdj::ANSATZ_FRIST + cdj::DECK_KEYLOCK_EINSCHWING + cdj::DECK_KEYLOCK_BLENDE + B;
  l.bis(n);
  v.bis(n);
  int hoch = 0, tief = 0, falsch = 0;
  double max_ct = 0;
  std::printf("  test29: je Beat ab dem Ring (Keylock / Varispeed-Bezug, Hz):");
  for (double b = k.beat_at((double)s_r); k.sample_at(b + 1.0) < (double)(n - B); b += 1.0) {
    const int64_t a = (int64_t)k.sample_at(b);
    const double hl = km::freq(l.L, a, a + 4800), hv = km::freq(v.L, a, a + 4800);
    std::printf(" %.0f/%.0f", hl, hv);
    double soll = 0;
    if (std::fabs(hv - 1500.0 * 132.0 / 128.0) < 20.0) soll = 1500.0, ++hoch;
    else if (std::fabs(hv - 1000.0 * 132.0 / 128.0) < 20.0) soll = 1000.0, ++tief;
    else continue;  // Fenster über der Tongrenze
    const double ct = 1200.0 * std::log2(hl / soll);
    max_ct = std::max(max_ct, std::fabs(ct));
    if (std::fabs(ct) > 2.0) ++falsch;
  }
  std::printf("\n  test29: Bezug hoch %d, tief %d Fenster; Keylock falsch %d, max |Tonhöhe| %.3f ct; Ring hörbar am Ende %d\n", hoch,
              tief, falsch, max_ct, (int)l.deck.keylock_ring_hoerbar());
  PRUEF(hoch >= 8 && tief >= 1);  // Zählprobe: der hohe Ton kam an (vorher 0 von 15 Fenstern)
  PRUEF(falsch == 0);
  PRUEF(l.deck.keylock_ring_hoerbar() && l.deck.keylock_unterlauf() == 0 && l.deck.keylock_hart() == 0);
  ergebnis("keylock_loop_raster");
}

// ------------------------------------------------------------------------------------------ Test 30
// Task 5b (Prüfung MAJOR): Loop lange laufen lassen, dann aus; der Kopf danach muss am idealen Ort liegen. Vorher wickelte die
// Naht des Varispeed-Wegs auf das gerundete Frame (132 BPM: −0,266 Frames je Durchlauf bei 4 Beats, −0,463 bei 1/4 Beat), der
// Ansatz nach dem Aus setzt mit diesem Kopf an (Probe p_aus_sprung.txt: +19,6 bis +25,6 nach 85 Durchläufen). Klick-Material,
// Start bei 0 auf Quell-Beat 4, Loop ab Quell-Beat 8 (Kopf bei 6), aus mitten im Durchlauf D. Ideal: ungewickelter Kopf aus
// Karte und Start, gewickelt im Loop (a + (u − a) mod L), danach linear. Je Klick nach dem Aus (Brücke und Ring) ±12 gegen
// das Ideal, im Keylock UND im Varispeed (ohne Dehner). Mutation DECK_NAHT_RUNDET (alte Rundung) rot.
double drift_lauf(const Karte& k, double l_beats, int durchl, bool keylock, int& n_klicks) {
  static km::MatProbe p(24, 0);
  static const std::vector<float> tpl = km::klick_vorlage();
  const int64_t F0 = (int64_t)(4 * FPB), A = (int64_t)(8 * FPB), L = std::llround(l_beats * FPB);
  const DehnerAnker a{0.0, (double)F0};
  const double u_aus = (double)A + (double)durchl * (double)L + 0.5 * (double)L;
  const int64_t s_aus = (int64_t)s_von(k, a, u_aus) / B * B;
  const int64_t n = s_aus + (int64_t)(6.0 * 48000.0 * 60.0 / 132.0);
  DeckLauf l(k, n, keylock);
  l.deck.lade(&p.m, 0);
  l.deck.start(0, F0);
  l.bis((int64_t)k.sample_at(2.0) / B * B);
  l.deck.loop_an(l.s, A, L);
  l.bis(s_aus);
  const double u = (double)F0 + k.beat_at((double)s_aus) * FPB;
  const double h = (double)A + std::fmod(u - (double)A, (double)L);  // idealer Kopf beim Aus
  const double kopf_deck = l.deck.kopf_bei(s_aus);
  l.deck.loop_aus(s_aus);
  l.bis(n);
  const DehnerAnker a2{k.beat_at((double)s_aus), h};
  double mx = 0;
  n_klicks = 0;
  for (int q = (int)std::ceil(h / FPB); q < 20; ++q) {
    double e = 999;
    if (!km::klick_lage(l.L, k, a2, q, e, tpl, km::MITTE)) break;
    ++n_klicks;
    mx = std::max(mx, std::fabs(e));
  }
  std::printf("  test30 %s, %.2f Beats, %d Durchläufe: Kopf beim Aus %.3f, ideal %.3f (%+.3f Frames); %d Klicks danach, max |Lage| "
              "%.2f\n",
              keylock ? "Keylock" : "Varispeed", l_beats, durchl, kopf_deck, h, kopf_deck - h, n_klicks, mx);
  return mx;
}

void test_loop_drift() {
  const Karte k(132.0, 0);
  for (bool kl : {true, false}) {
    int n4 = 0, n14 = 0;
    const double m4 = drift_lauf(k, 4.0, 60, kl, n4), m14 = drift_lauf(k, 0.25, 200, kl, n14);
    PRUEF(n4 >= 4 && n14 >= 4);
    PRUEF(m4 <= 12.0 && m14 <= 12.0);
  }
  ergebnis("keylock_loop_drift");
}

// ------------------------------------------------------------------------------------------ Test 31
// Task 5b (Prüfung MINOR: die Naht-Tests mit 1-kHz-Sinus waren blind, 4 und 16 Beats sind Vielfache der Periode): die
// Naht im Ring mit Rauschen, 1 und 4 Beats bei 132, durch R3. Bezug ist ein zweiter Dehner mit dem Loop-Strom des
// Direktwegs (loop_lauf art 2): ab dem Ende der Blende auf den Ring bitgleich, an jeder Naht Abweichung 0.
// LOOP_NAHT_HART (hart gewickelt) macht diesen Test rot.
void test_loop_naht() {
  const Karte k(132.0, 0);
  for (int nb : {1, 4}) {
    char name[32];
    std::snprintf(name, sizeof name, "test31 %d Beat Rauschen", nb);
    const LoopMass r = loop_lauf(k, nb, 2);
    loop_drucken(name, r);
    PRUEF(r.hoer_soll > 100 && r.hoer == r.hoer_soll && r.unterlauf == 0 && r.hart == 0);
    PRUEF(r.geprueft > 3 * (int64_t)(nb * FPB) && r.ungleich == 0);
    for (double x : r.naht) PRUEF(x <= 0.02);
  }
  ergebnis("keylock_loop_naht");
}

void test_loop_band() {
  static km::MatProbe sinus(10, 1);
  static MatRausch rausch(14);
  struct Fall {
    const char* name;
    const cdj::Material* m;
    int beats;
    int64_t a_f;
  };
  const Fall faelle[] = {{"Sinus 1 Beat", &sinus.m, 1, (int64_t)(8 * FPB)},
                         {"Rauschen 1 Beat", &rausch.m, 1, (int64_t)(8 * FPB) + 333},
                         {"Rauschen 4 Beats", &rausch.m, 4, (int64_t)(9 * FPB) + 777}};
  const int stuecke[] = {1, 255, 256, 4096, 22501, 32768, 7};
  for (const Fall& fa : faelle) {
    const int64_t F0 = (int64_t)(6 * FPB), L = (int64_t)(fa.beats * FPB);
    const int64_t frames = fa.a_f - F0 + 4 * L + 40000;
    const LoopStrom q = loop_strom(*fa.m, F0, fa.a_f, L, frames);
    cdj::DeckBand b;
    b.m = fa.m;
    b.loop_a = fa.a_f;
    b.loop_l = L;
    std::vector<float> l(32768), r(32768);
    int64_t p = F0 + cdj::DECK_START_EIN, ungleich = 0, geprueft = 0, naht_ungleich = 0;
    double max_d = 0;
    for (int i = 0; p + 32768 < F0 + frames; ++i) {
      const int nn = stuecke[i % 7];
      b.band(p, nn, l.data(), r.data());
      for (int j = 0; j < nn; ++j) {
        const float soll = q.x[(size_t)(p + j - F0)];
        const bool u = l[(size_t)j] != soll || r[(size_t)j] != soll;
        ungleich += u ? 1 : 0;
        max_d = std::max(max_d, (double)std::fabs(l[(size_t)j] - soll));
        // in der Naht-Blende (ungewickelt [a + k L − 128, a + k L))
        const int64_t u_rel = p + j - (fa.a_f - cdj::DECK_BLENDE);
        if (u && u_rel >= L && (u_rel % L) < cdj::DECK_BLENDE) ++naht_ungleich;
        ++geprueft;
      }
      p += nn;
    }
    // Positiv-Kontrolle: das Material ohne Loop (linear) wiche vom Bezug ab
    cdj::DeckBand lin;
    lin.m = fa.m;
    int64_t lin_ungleich = 0;
    for (int64_t pp = F0 + cdj::DECK_START_EIN; pp < F0 + frames - 32768; pp += 4096) {
      lin.band(pp, 4096, l.data(), r.data());
      for (int j = 0; j < 4096; ++j) lin_ungleich += l[(size_t)j] != q.x[(size_t)(pp + j - F0)] ? 1 : 0;
    }
    std::printf("  test28 %s: %lld Frames geprüft, %lld ungleich (in der Naht-Blende %lld), max |d| %.3e; linear ohne Loop "
                "%lld ungleich\n",
                fa.name, (long long)geprueft, (long long)ungleich, (long long)naht_ungleich, max_d, (long long)lin_ungleich);
    PRUEF(geprueft > 3 * L);
    PRUEF(ungleich == 0);
    PRUEF(lin_ungleich > 1000);
  }
  ergebnis("keylock_loop_band");
}

// ------------------------------------------------------------------------------------------ Test 32
// Keylock 7b.1 (Entscheidung der Hauptinstanz 08.10., Prüfung F1): Rampe auf die Basis 128 bei klingendem Ring. Dazu 7c.4
// (unten): Knopf aus auf der Basis hält den Ring, Sprung auf der Basis blendet gleich laut. Vorher blendete
// der Ring linear über 960 Frames in den Direktweg; R3 hält die Phase eines stehenden Tons nicht (Deck, 140 -> 128: 213 Hz
// −12,6 dB, 1000 Hz −8,4 dB, task-07-pruefung/qualitaet/proben/probe_deck.txt). Jetzt bleibt der Ring hörbar bis zum nächsten
// Ereignis. Gewertet: Pegel (gleitende Spitze je Periode) ab der Basis ≥ −0,5 dB gegen die Spitze vor der Rampe, bei 1000 Hz
// jedes 100-ms-Fenster ab dem Ende der Brücke ±2 ct (Wechselfenster eingeschlossen), Ring hörbar auf der Basis. Ausgewiesen:
// der Pegel um das Ereignis (dort blendet das Eingefrorene wie bei jedem Ereignis linear in den neuen Weg). Danach ein Ereignis auf der Basis
// (Sprung): ab dem Ende der Blende bitgleich zum Deck ohne Dehner (Direktweg wie immer).
struct SinusMat {
  std::vector<float> d;
  cdj::Material m{};
  SinusMat(double beats, double hz) {
    const int64_t frames = (int64_t)std::ceil(beats * FPB);
    std::snprintf(m.material_id, sizeof m.material_id, "%s", "c1c0000000000532");
    m.basis_bpm = 128.0;
    m.fassung = 1;
    m.n_quellen = 1;
    m.frames = frames;
    m.erster_schlag_frame = 0;
    d.assign((size_t)(2 * frames), 0.0f);
    for (int64_t f = 0; f < frames; ++f)
      d[(size_t)(2 * f)] = d[(size_t)(2 * f + 1)] = (float)(0.5 * std::sin(2 * PI * hz * (double)f / 48000.0));
    m.quelle[0] = d.data();
  }
};
double spitze_min_db(const std::vector<float>& x, int64_t a, int64_t b, int per, double ref) {
  double tief = 1e9;
  for (int64_t p = a; p + per <= b && p + per <= (int64_t)x.size(); p += per / 2) {
    double sp = 0;
    for (int64_t i = p; i < p + per; ++i) sp = std::max(sp, (double)std::fabs(x[(size_t)i]));
    tief = std::min(tief, sp);
  }
  return 20.0 * std::log10(tief / ref);
}
void test_basis_nach_rampe() {
  struct Fall {
    double von, hz;
  } faelle[] = {{140.0, 1000.0}, {140.0, 213.333}, {130.0, 1000.0}, {150.0, 1000.0}};
  for (const Fall& f : faelle) {
    SinusMat mt(48.0, f.hz);
    Karte k(f.von, 0);
    PRUEF(k.rampe(8.0, 128.0, 8.0));
    const int64_t n = (int64_t)k.sample_at(28.0);
    const int64_t S = std::llround(k.sample_at(16.0));  // Ende der Rampe: ab hier Direktweg (direkt_)
    const int64_t s_ev = (int64_t)k.sample_at(24.0) / B * B;
    DeckLauf l(k, n), v(k, n, false);
    for (DeckLauf* x : {&l, &v}) {
      x->deck.lade(&mt.m, 0);
      x->deck.start(0, 0);
      x->bis(s_ev);
    }
    const bool hoer_basis = l.deck.keylock_ring_hoerbar();
    const int64_t s_h = l.deck.keylock_s_h();  // Ansatz des Starts (das Ereignis unten setzt neu an)
    const int per = (int)std::ceil(48000.0 / f.hz) + 1;
    double ref = 0;
    for (int64_t p = S - 9600; p < S - 4800; ++p) ref = std::max(ref, (double)std::fabs(l.L[(size_t)p]));
    const double tief = spitze_min_db(l.L, S - 4800, s_ev, per, ref);
    // Ereignis auf der Basis: Sprung um 4 Beats, beide Decks gleich
    const int64_t f_neu = l.deck.frame_bei(s_ev) + (int64_t)(4 * FPB);
    l.deck.setze_kopf(s_ev, f_neu);
    v.deck.setze_kopf(s_ev, f_neu);
    l.bis(n);
    v.bis(n);
    int64_t u = 0;
    for (int64_t i = s_ev + cdj::STRECK_BLENDE; i < n; ++i) u += l.L[(size_t)i] != v.L[(size_t)i] ? 1 : 0;
    const double tief_ev = spitze_min_db(l.L, s_ev - 2400, s_ev + 2400, per, ref);
    std::printf("  test32 %.0f -> 128, Sinus %.1f Hz: Ring hörbar auf der Basis %d; Pegel ab der Basis bis zum Ereignis min "
                "%+.2f dB (Bezug %.4f); nach dem Sprung auf der Basis Ring %d, %lld von %lld Samples ungleich zum Deck ohne "
                "Dehner; Pegel um den Sprung min %+.2f dB (ausgewiesen)\n",
                f.von, f.hz, (int)hoer_basis, tief, ref, (int)l.deck.keylock_ring_hoerbar(), (long long)u,
                (long long)(n - s_ev - cdj::STRECK_BLENDE), tief_ev);
    PRUEF(hoer_basis && tief >= -0.5);
    PRUEF(!l.deck.keylock_ring_hoerbar() && u == 0);
    if (f.hz == 1000.0) {
      const int64_t s_r = s_h + cdj::STRECK_EINSCHWING + cdj::STRECK_BLENDE;  // ab dem Ende der Brücke (Start bei f.von)
      const Ton t = ton_messen(l.L, s_r, s_ev);
      std::printf("  test32 %.0f -> 128: %d Fenster bis zum Ereignis, max |Tonhöhe| %.3f ct, über 2 ct %d, Null-Läufe %d\n",
                  f.von, t.fenster, t.max_ct, t.ueber, t.null_laeufe);
      PRUEF(t.fenster >= 60 && t.ueber == 0 && t.null_laeufe == 0);
    }
  }
  // Keylock 7c.4 (Entscheidung der Hauptinstanz 08.10.): (a) Knopf aus auf der Basis bei gehaltenem Ring: der Ring bleibt
  // hörbar (kein Einbruch), verlässt das Tempo danach die Basis, spielt das Deck Varispeed. (b) Ein Sprung auf der Basis
  // blendet das Eingefrorene gleich laut in den Direktweg: Rauschen tiefstes 240er-Fenster >= −1,5 dB (linear: Mutation
  // KEYLOCK_BASIS_LINEAR). Sinus ausgewiesen (Gegenphase, ADR 029).
  for (int art = 0; art < 2; ++art) {
    for (int fall = 0; fall < 2; ++fall) {  // 0 Knopf aus, 1 Sprung
      SinusMat mt(64.0, 1000.0);
      if (art == 1) {
        std::mt19937 g(11);
        std::normal_distribution<float> nd(0.0f, 0.15f);
        for (int64_t f = 0; f < mt.m.frames; ++f) mt.d[(size_t)(2 * f)] = mt.d[(size_t)(2 * f + 1)] = nd(g);
      }
      Karte k(140.0, 0);
      PRUEF(k.rampe(8.0, 128.0, 8.0));
      PRUEF(k.rampe(24.0, 135.0, 2.0));
      const int64_t n = (int64_t)k.sample_at(32.0);
      const int64_t s_ev = (int64_t)k.sample_at(20.0) / B * B;
      DeckLauf l(k, n);
      l.deck.lade(&mt.m, 0);
      l.deck.start(0, 0);
      l.bis(s_ev);
      const bool vorher = l.deck.keylock_ring_hoerbar();
      if (fall == 0) l.deck.keylock(s_ev, false);
      else l.deck.setze_kopf(s_ev, l.deck.frame_bei(s_ev) + (int64_t)(4 * FPB));
      l.bis((int64_t)k.sample_at(23.0));
      const bool danach = l.deck.keylock_ring_hoerbar();
      l.bis(n);
      auto rms = [&](int64_t a, int64_t m) {
        double q = 0;
        for (int64_t i = a; i < a + m; ++i) q += (double)l.L[(size_t)i] * l.L[(size_t)i];
        return std::sqrt(q / (double)m);
      };
      const double ref = rms(s_ev - 4800, 4320);
      double tief = 1e9;
      for (int64_t p = s_ev - 480; p + 240 <= s_ev + 1440; p += 60) tief = std::min(tief, 20.0 * std::log10(rms(p, 240) / ref));
      const double ct_ende = art == 0 ? 1200.0 * std::log2(km::freq(l.L, n - 9600, n - 4800) / 1000.0) : NAN;
      std::printf("  test32 %s, %s auf der Basis: Ring vorher %d, 3 Beats danach %d; tiefstes 240er-Fenster %+.2f dB; am Ende "
                  "(135 BPM) %+.2f ct\n",
                  art ? "Rauschen" : "Sinus 1000", fall ? "Sprung" : "Knopf aus", (int)vorher, (int)danach, tief, ct_ende);
      PRUEF(vorher);
      if (fall == 0) {
        PRUEF(danach && tief >= -1.5);
        if (art == 0) PRUEF(std::fabs(ct_ende - 1200.0 * std::log2(135.0 / 128.0)) < 1.0);
      } else if (art == 1) {
        PRUEF(!danach && tief >= -1.5);
      }
    }
  }
  ergebnis("keylock_basis_nach_rampe");
}

// ------------------------------------------------------------------------------------------ Test 33
// Loop-Drift (Plan „Offen aus 5b, nicht Keylock“; Andreas 08.10.: „Ja, reparieren“; Rechnung
// ~/messungen/2026-10-07-keylock-echtzeit/task-05b/p5_looplaenge_rundung.txt): bei krummem fpb (Basis 125,3 und 130) wickelte
// jeder Durchlauf um die gerundete Länge round(L_beats · fpb), der Loop-Anfang lief gegen das Beat-Raster weg (125,3,
// 4 Beats: −0,35 Frames je Durchlauf). Soll: Lage des Loop-Anfangs in jedem Durchlauf gegen das Ideal b_a + j · L_beats
// ≤ 1 Frame über 64 Durchläufe, im Direktweg (Karte = Basis), im Varispeed (Karte 132, ohne Dehner) und im Ring: das Band
// des Ansatzes über die Quellposition, die der Dehner aus dem Anker rechnet (dehner.cpp kopf()), einmal vom Ansatz beim
// Loop an, einmal vom Ansatz nach Keylock aus/an mitten in Durchlauf 8 (Anker im 9. Durchlauf). Material: Rampe, Frame f
// trägt f. Mutation LOOP_RUNDUNG_FEST (alte Rundung) rot.
struct MatRampe {
  std::vector<float> d;
  cdj::Material m{};
  MatRampe(double basis, int64_t frames) {
    std::snprintf(m.material_id, sizeof m.material_id, "%s", "c1c0000000000533");
    m.basis_bpm = basis;
    m.fassung = 1;
    m.n_quellen = 1;
    m.frames = frames;
    m.erster_schlag_frame = 0;
    d.resize((size_t)(2 * frames));
    for (int64_t f = 0; f < frames; ++f) d[(size_t)(2 * f)] = d[(size_t)(2 * f + 1)] = (float)f;
    m.quelle[0] = d.data();
  }
};

// Sample (gebrochen), an dem der Kopf nach jeder Naht den Loop-Anfang a erreicht: die erste fallende Stelle ist der Beginn
// der Naht-Blende; aus der Geraden über [n + 300, n + 1300] nach der Naht auf a zurückgerechnet (in der Blende mischen
// zwei Köpfe, im Varispeed erreicht der neue Kopf a noch in ihr).
std::vector<double> naht_anfaenge(const std::vector<float>& x, double a) {
  std::vector<double> r;
  for (int64_t s = 1; s + 1300 < (int64_t)x.size(); ++s) {
    if (!(x[(size_t)s] < x[(size_t)(s - 1)] - 0.5f)) continue;
    const int64_t s1 = s + 300, s2 = s + 1300;
    const double v1 = x[(size_t)s1], v2 = x[(size_t)s2], m = (v2 - v1) / (double)(s2 - s1);
    r.push_back((double)s1 + (a - v1) / m);
    s += 1300;
  }
  return r;
}

struct DriftMass {
  int n = 0, j_min = 1 << 30, j_max = -1;
  double max = 0.0, letzt = 0.0, lo = 1e30, hi = -1e30;  // lo, hi: kleinste und größte Lage (Spanne = Drift)
};
void drift_buche(DriftMass& d, double b, double b_a, double lb, double fpb) {
  const double x = (b - b_a) / lb;
  const int j = (int)std::llround(x);
  const double e = (x - (double)j) * lb * fpb;  // Frames gegen das Ideal
  ++d.n;
  d.j_min = std::min(d.j_min, j);
  d.j_max = std::max(d.j_max, j);
  d.max = std::max(d.max, std::fabs(e));
  d.lo = std::min(d.lo, e);
  d.hi = std::max(d.hi, e);
  d.letzt = e;
}

// Ring: Durchgänge des Bandes durch a über die ungewickelte Quellposition ab dem Anker (exakt: Rampe, a − 1 dann a), als
// Master-Beat b = Anker.b + (p − Anker.f) / fpb
DriftMass ring_drift(const cdj::DehnerQuelle& q, DehnerAnker an, int64_t a, double lx, int durchl, double b_a, double lb,
                     double fpb) {
  DriftMass d;
  const int64_t p0 = (int64_t)std::floor(an.f), p1 = p0 + (int64_t)((durchl + 0.6) * lx);
  std::vector<float> l(4097), r(4097);
  float vor = -1.0f;
  for (int64_t p = p0; p < p1; p += 4096) {
    q.band(p, 4096, l.data(), r.data());
    for (int i = 0; i < 4096; ++i) {
      if (l[(size_t)i] == (float)a && vor == (float)(a - 1)) drift_buche(d, an.b + ((double)(p + i) - an.f) / fpb, b_a, lb, fpb);
      vor = l[(size_t)i];
    }
  }
  return d;
}

const cdj::DehnerQuelle* deck_band(const cdj::Deck& dk) {
  const cdj::DeckBand* b = nullptr;
  dk.keylock_leihe().jeder([&](const cdj::DeckBand& x, uint32_t nr_ab, uint32_t) {
    if (nr_ab == 0 && x.m == dk.material()) b = &x;
  });
  return b;
}

// art 0 Direktweg, 1 Varispeed, 2 Ring (Band und Anker). Start bei 0 auf Frame F0 = 1 Beat, Loop [A, A + L) mit A = 2 Beats,
// gesetzt bei Master-Beat 0,5 (Kopf vor dem Loop); der ungewickelte Kopf erreicht A bei Master-Beat b_a = 1.
void beatraster_lauf(double basis, double lb, int art, int D, DriftMass* aus) {
  const double fpb = cdj::FRAMES_JE_MINUTE / basis, lx = lb * fpb;
  const int64_t F0 = std::llround(fpb), A = std::llround(2.0 * fpb), L = std::llround(lx);
  MatRampe* mr = new MatRampe(basis, A + (int64_t)std::ceil(lx) + 512);  // lebt bis zum Testende (Deck und Leihe)
  const Karte k(art == 0 ? basis : 132.0, 0);
  const double b_a = (double)(A - F0) / fpb;
  const int64_t s_L = (int64_t)k.sample_at(0.5) / B * B;
  const char* wname[] = {"Direktweg", "Varispeed", "Ring"};
  if (art < 2) {
    const int64_t n = (int64_t)k.sample_at(b_a + (D + 0.6) * lb) + 2000;
    DeckLauf l(k, n, false);
    l.deck.lade(&mr->m, 0);
    l.deck.start(0, F0);
    l.bis(s_L);
    l.deck.loop_an(s_L, A, L, lx);
    l.bis(n);
    DriftMass d;
    for (double s : naht_anfaenge(l.L, (double)A)) drift_buche(d, k.beat_at(s), b_a, lb, fpb);
    std::printf("  test33 Basis %.1f, %.0f Beat, %s: %d Durchläufe (j %d..%d), Lage zuletzt %+.3f, max |Lage| %.3f Frames\n",
                basis, lb, wname[art], d.n, d.j_min, d.j_max, d.letzt, d.max);
    if (art == 0) {  // Ring und Deck wickeln gleich: das Band über p = F0 + s ist bitgleich zum Direktweg (ab dem Loop an)
      cdj::DeckBand bd;
      bd.m = &mr->m;
      bd.loop_a = A;
      bd.loop_l = L;
      bd.loop_lx = lx;
      std::vector<float> bl((size_t)n), br((size_t)n);
      bd.band(F0, (int)n, bl.data(), br.data());
      int64_t ungleich = 0;
      for (int64_t s = s_L; s < n; ++s) ungleich += bl[(size_t)s] != l.L[(size_t)s] ? 1 : 0;
      std::printf("  test33 Basis %.1f, %.0f Beat: Band gegen Direktweg, %lld von %lld Samples ungleich\n", basis, lb,
                  (long long)ungleich, (long long)(n - s_L));
      PRUEF(ungleich == 0);
    }
    aus[0] = d;
    return;
  }
  const int64_t s_ev = (int64_t)k.sample_at(b_a + 8.5 * lb) / B * B;
  DeckLauf l(k, s_ev + B);
  l.deck.lade(&mr->m, 0);
  l.deck.start(0, F0);
  l.bis(s_L);
  l.deck.loop_an(s_L, A, L, lx);
  const DehnerAnker a0 = l.deck.keylock_anker();
  const cdj::DehnerQuelle* q0 = deck_band(l.deck);
  PRUEF(q0 != nullptr);
  if (!q0) return;
  aus[0] = ring_drift(*q0, a0, A, lx, D, b_a, lb, fpb);
  l.bis(s_ev);
  PRUEF(l.deck.keylock_ring_hoerbar());
  l.deck.keylock(s_ev, false);
  l.deck.keylock(s_ev, true);
  const DehnerAnker a1 = l.deck.keylock_anker();
  const cdj::DehnerQuelle* q1 = deck_band(l.deck);
  PRUEF(q1 != nullptr);
  if (!q1) return;
  aus[1] = ring_drift(*q1, a1, A, lx, D, b_a, lb, fpb);
  for (int i = 0; i < 2; ++i)
    std::printf("  test33 Basis %.1f, %.0f Beat, Ring (Ansatz %s): %d Durchläufe (j %d..%d), Lage zuletzt %+.3f, max |Lage| "
                "%.3f Frames\n",
                basis, lb, i ? "nach Keylock aus/an in Durchlauf 8" : "Loop an", aus[i].n, aus[i].j_min, aus[i].j_max,
                aus[i].letzt, aus[i].max);
}

void test_loop_beatraster() {
  const int D = 64;
  for (double basis : {125.3, 130.0})
    for (double lb : {4.0, 1.0}) {
      for (int art = 0; art < 3; ++art) {
        DriftMass d[2];
        beatraster_lauf(basis, lb, art, D, d);
        for (int i = 0; i < (art == 2 ? 2 : 1); ++i) {
          PRUEF(d[i].n >= (art == 2 && i == 1 ? D - 9 : D));  // Zählprobe: jeder Durchlauf gefunden
          PRUEF(d[i].max <= 1.0);
        }
      }
    }
  ergebnis("keylock_loop_beatraster");
}

// ------------------------------------------------------------------------------------------ Test 34
// Loop-Drift, Negativ-Kontrolle: bei Basis 128 (fpb 22 500, L · fpb ganzzahlig für 4, 1 und 1/4 Beat) bleibt alles
// bitgleich zum Stand vor dem Fix (Prüfsummen aufgenommen am Stand 7eb0c137 mit diesem Test): Ausgabe des Decks im
// Direktweg (Karte 128) und im Varispeed (Karte 132) über 20 Durchläufe, und das Band des Rings über die Quellposition ab
// dem Anker, einmal vom Ansatz beim Loop an, einmal nach Keylock aus/an mitten in Durchlauf 5.
uint64_t fnv(uint64_t h, const float* x, size_t n) {
  for (size_t i = 0; i < n; ++i) {
    uint32_t u;
    std::memcpy(&u, &x[i], 4);
    for (int k = 0; k < 4; ++k) h = (h ^ ((u >> (8 * k)) & 0xff)) * 1099511628211ull;
  }
  return h;
}

uint64_t band_summe(const cdj::DehnerQuelle& q, DehnerAnker an, int64_t n) {
  std::vector<float> l((size_t)n), r((size_t)n);
  q.band((int64_t)std::floor(an.f), (int)n, l.data(), r.data());
  return fnv(fnv(14695981039346656037ull, l.data(), l.size()), r.data(), r.size());
}

void test_loop_basis128_alt() {
  const double fpb = 22500.0;
  uint64_t h[3][4] = {};
  const double lbs[3] = {4.0, 1.0, 0.25};
  for (int z = 0; z < 3; ++z) {
    const double lb = lbs[z], lx = lb * fpb;
    const int64_t F0 = (int64_t)fpb, A = (int64_t)(2 * fpb), L = (int64_t)lx;
    MatRampe* mr = new MatRampe(128.0, A + L + 512);
    for (int art = 0; art < 2; ++art) {
      const Karte k(art == 0 ? 128.0 : 132.0, 0);
      const int64_t n = (int64_t)k.sample_at(1.0 + 20.6 * lb);
      DeckLauf l(k, n, false);
      l.deck.lade(&mr->m, 0);
      l.deck.start(0, F0);
      l.bis((int64_t)k.sample_at(0.5) / B * B);
      l.deck.loop_an(l.s, A, L, lx);
      l.bis(n);
      h[z][art] = fnv(14695981039346656037ull, l.L.data(), l.L.size());
    }
    const Karte k(132.0, 0);
    const int64_t s_ev = (int64_t)k.sample_at(1.0 + 5.5 * lb) / B * B;
    DeckLauf l(k, s_ev + B);
    l.deck.lade(&mr->m, 0);
    l.deck.start(0, F0);
    l.bis((int64_t)k.sample_at(0.5) / B * B);
    l.deck.loop_an(l.s, A, L, lx);
    const cdj::DehnerQuelle* q0 = deck_band(l.deck);
    PRUEF(q0 != nullptr);
    if (q0) h[z][2] = band_summe(*q0, l.deck.keylock_anker(), 10 * L);
    l.bis(s_ev);
    l.deck.keylock(s_ev, false);
    l.deck.keylock(s_ev, true);
    const cdj::DehnerQuelle* q1 = deck_band(l.deck);
    PRUEF(q1 != nullptr);
    if (q1) h[z][3] = band_summe(*q1, l.deck.keylock_anker(), 10 * L);
  }
  // Stand 7eb0c137 (vor dem Fix), mit diesem Test aufgenommen: ~/messungen/2026-10-08-loop-drift/vorher_test33_34.txt
  static const uint64_t soll[3][4] = {
      {0x2d991262034ee34dull, 0xfc2e729263e0af44ull, 0x286a018002eb11fdull, 0xdd619d911a87ace5ull},
      {0xade47a0afa60153dull, 0x4e1a0c5086eb9838ull, 0xf471ed84f25d5d65ull, 0x0ef10524d3ad72f5ull},
      {0x57699dc771bc8cd9ull, 0x4a5c6d51e5ce5d1full, 0xfd0409474d35e1e5ull, 0x71af3ddbc3dce2d5ull}};
  for (int z = 0; z < 3; ++z) {
    std::printf("  test34 Basis 128, %.2f Beat: Direktweg %016llx, Varispeed %016llx, Band (Loop an) %016llx, Band (nach "
                "aus/an) %016llx\n",
                lbs[z], (unsigned long long)h[z][0], (unsigned long long)h[z][1], (unsigned long long)h[z][2],
                (unsigned long long)h[z][3]);
    for (int i = 0; i < 4; ++i) PRUEF(h[z][i] == soll[z][i]);
  }
  ergebnis("keylock_loop_basis128_alt");
}

// ------------------------------------------------------------------------------------------ Test 35
// Loop-Drift, Prüfung F1 und F4 (08.10.): das Band eines Ansatzes MITTEN im Loop ist bitgleich zum Strom, den das Deck ab
// dort im Direktweg spielt (Karte = Basis, Ring warm; das Band hängt nicht vom Tempo ab, eine Rampe entscheidet nur, ob
// es klingt). Fälle je Basis 125,3 und 128, Loop 4 Beats ab A:
//   (a) Keylock aus/an in Durchlauf 8 (F4: der Anker muss ungewickelt sein; Mutation KEYLOCK_ANKER_OHNE_WICKEL rot)
//   (b) nach 3 Nähten Pause der Hand (stopp mit loop_halten), Play mit loop_halten auf A − 8768, VOR a0 = A − 128 (F1)
//   (c) dasselbe auf A − 50, in [a0, A) (F1: dort mischte das Band einen fremden Kopf ein)
//   (d) dasselbe auf A + 1000 (Negativ-Kontrolle, im Loop: war schon richtig)
// Verglichen wird ab 48 Samples nach dem Ereignis (Einblende aus dem Stand) über 3 bzw. 10 Durchläufe.
int64_t band_gegen_deck(DeckLauf& l, const cdj::DehnerQuelle* q, DehnerAnker an, int64_t s_ev, int64_t t0, int64_t n) {
  l.bis(s_ev + n);
  std::vector<float> bl((size_t)n), br((size_t)n);
  q->band((int64_t)std::floor(an.f), (int)n, bl.data(), br.data());
  int64_t ungleich = 0, erstes = -1;
  for (int64_t t = t0; t < n; ++t)
    if (bl[(size_t)t] != l.L[(size_t)(s_ev + t)]) {
      if (erstes < 0) erstes = t;
      ++ungleich;
    }
  if (erstes >= 0)
    std::printf("    erstes ungleich bei t = %lld: Band %.1f, Deck %.1f\n", (long long)erstes, (double)bl[(size_t)erstes],
                (double)l.L[(size_t)(s_ev + erstes)]);
  return ungleich;
}

void test_loop_ansatz_band() {
  for (double basis : {125.3, 128.0}) {
    const double fpb = cdj::FRAMES_JE_MINUTE / basis, lb = 4.0, lx = lb * fpb;
    const int64_t F0 = std::llround(fpb), A = std::llround(2.0 * fpb), L = std::llround(lx);
    MatRampe* mr = new MatRampe(basis, A + (int64_t)std::ceil(lx) + 512);
    const Karte k(basis, 0);
    const double b_a = (double)(A - F0) / fpb;
    const int64_t s_L = (int64_t)k.sample_at(0.5) / B * B;
    for (int fall = 0; fall < 4; ++fall) {
      const int64_t n = fall == 0 ? 10 * L : 3 * L;
      const int64_t s_ev0 = (int64_t)k.sample_at(b_a + (fall == 0 ? 8.5 : 3.5) * lb) / B * B;
      DeckLauf l(k, s_ev0 + 8 * B + n + B);
      l.deck.lade(&mr->m, 0);
      l.deck.start(0, F0);
      l.bis(s_L);
      l.deck.loop_an(s_L, A, L, lx);
      l.bis(s_ev0);
      int64_t s_ev = s_ev0, kopf = 0;
      if (fall == 0) {
        l.deck.keylock(s_ev, false);
        l.deck.keylock(s_ev, true);
        kopf = l.deck.frame_bei(s_ev);
      } else {
        l.deck.stopp(s_ev0, true);
        l.bis(s_ev0 + 8 * B);
        s_ev = l.s;
        kopf = A + (fall == 1 ? -8768 : fall == 2 ? -50 : 1000);
        l.deck.start(s_ev, kopf, true);
      }
      const int64_t j = l.deck.loop_durchlauf();
      const DehnerAnker an = l.deck.keylock_anker();
      const cdj::DehnerQuelle* q = deck_band(l.deck);
      PRUEF(q != nullptr && l.deck.loop_aktiv());
      if (!q) continue;
      const int64_t u = band_gegen_deck(l, q, an, s_ev, 48, n);
      const char* name[] = {"Keylock aus/an in Durchlauf 8", "Play vor a0 (A - 8768)", "Play in [a0, A) (A - 50)",
                            "Play im Loop (A + 1000)"};
      std::printf("  test35 Basis %.1f, %s: Kopf A%+lld, Durchlauf %lld, Anker.f %.1f; Band gegen Deck %lld von %lld "
                  "Samples ungleich\n",
                  basis, name[fall], (long long)(kopf - A), (long long)j, an.f, (long long)u, (long long)(n - 48));
      PRUEF(u == 0);
    }
  }
  ergebnis("keylock_loop_ansatz_band");
}

// ------------------------------------------------------------------------------------------ Test 36
// Loop-Drift, Prüfung F3: Fassungstausch im Loop (Deck::tausche) rechnet die exakte Länge in die neue Basis um. Loop 4 Beats
// auf der Fassung Basis 125,3, Tausch in Durchlauf 5 auf Basis 130 (Rampe, Frame f trägt f), Karte 125,3: danach Lage des
// Loop-Anfangs a' (in Frames der neuen Fassung) gegen das Beat-Raster über 60 Durchläufe ≤ 1 Frame. Mutation TAUSCH_OHNE_LX
// (die alte Frame-Länge bleibt) rot. Grenzen: Spanne der Lage ≤ 1 Frame (Drift), Lage ≤ 1,5 (fester Versatz des Tauschs, unten).
void test_loop_tausch() {
  const double b1 = 125.3, b2 = 130.0, fpb1 = cdj::FRAMES_JE_MINUTE / b1, fpb2 = cdj::FRAMES_JE_MINUTE / b2, lb = 4.0;
  const int64_t F0 = std::llround(fpb1), A = std::llround(2.0 * fpb1), L = std::llround(lb * fpb1);
  const int64_t A2 = std::llround(2.0 * fpb2);  // Loop-Anfang in der neuen Fassung (deck.cpp tausche: Quell-Beat 2)
  MatRampe* m1 = new MatRampe(b1, A + (int64_t)std::ceil(lb * fpb1) + 512);
  MatRampe* m2 = new MatRampe(b2, A2 + (int64_t)std::ceil(lb * fpb2) + 512);
  const Karte k(b1, 0);
  const double b_a = 1.0;  // Quell-Beat 2 klingt beim Start auf Quell-Beat 1 bei Master-Beat 0 ab Master-Beat 1
  const int D = 60;
  const int64_t s_t = (int64_t)k.sample_at(b_a + 5.5 * lb) / B * B;
  const int64_t n = (int64_t)k.sample_at(b_a + (5.5 + D + 0.6) * lb) + 2000;
  DeckLauf l(k, n, false);
  l.deck.lade(&m1->m, 0);
  l.deck.start(0, F0);
  l.bis((int64_t)k.sample_at(0.5) / B * B);
  l.deck.loop_an(l.s, A, L, lb * fpb1);
  l.bis(s_t);
  l.deck.tausche(s_t, &m2->m);
  PRUEF(l.deck.loop_aktiv() && l.deck.loop_anfang() == A2);
  l.bis(n);
  std::vector<float> nach(l.L.begin() + (s_t + 2000), l.L.end());
  DriftMass d;
  for (double s : naht_anfaenge(nach, (double)A2)) drift_buche(d, k.beat_at(s + (double)(s_t + 2000)), b_a, lb, fpb2);
  std::printf("  test36 Tausch 125,3 -> 130 in Durchlauf 5: %d Durchläufe danach (j %d..%d), Lage zuletzt %+.3f, Lage %+.3f bis "
              "%+.3f (Spanne %.3f), max |Lage| %.3f Frames (Länge im Deck %lld, exakt %.3f)\n",
              d.n, d.j_min, d.j_max, d.letzt, d.lo, d.hi, d.hi - d.lo, d.max, (long long)l.deck.loop_laenge(), lb * fpb2);
  PRUEF(d.n >= D - 1);
  // Drift: die Spanne über alle Durchläufe (nur die Naht-Rundung R(j) − j · lx, ±0,5). Dazu kommt ein fester Versatz aus dem
  // Tausch selbst: Kopf (anker_f_ = llround(f_neu)) und Loop-Anfang (llround) je auf ganze Frames der neuen Fassung, je
  // ≤ 0,5 (gemessen 08.10. auf 8ca44597: max 1,325, fix1/vorher_8ca44597_test35_36.txt). Darum Lage ≤ 1,5, Spanne ≤ 1.
  PRUEF(std::isfinite(d.lo) && std::isfinite(d.hi) && d.lo <= d.hi);  // Mutation: Durchlauf liest hinter das Material (Stille)
  PRUEF(d.hi - d.lo <= 1.0);
  PRUEF(d.max <= 1.5);
  ergebnis("keylock_loop_tausch");
}

}  // namespace

void test_neustart();       // Test 8, unten (Kern)
void test_rueck_warten();  // Test 17, unten (Kern)

int main(int argc, char** argv) {
  struct T {
    const char* name;
    void (*f)();
  };
  const T tests[] = {{"tonhoehe", test_tonhoehe_in_rampe}, {"lage", test_lage_in_rampe}, {"bruecke", test_bruecke},
                     {"basis", test_basis_bitgleich},      {"aus", test_aus_ist_varispeed}, {"sprung", test_sprung},
                     {"stopp", test_stopp_rampe},          {"neustart", test_neustart},     {"lebensdauer", test_lebensdauer},
                     {"frist", test_frist_verpasst},       {"allokation", test_allokation},
                     {"unterlauf", test_unterlauf},        {"fuellen", test_fuellen_abbruch},
                     {"ereignis_blende", test_ereignis_in_blende}, {"stopp_blende", test_stopp_in_blende},
                     {"rueck", test_rueck_warten},         {"einschwingen", test_einschwingen_klick},
                     {"stems", test_stems},                {"leser", test_leser_grenzen},
                     {"stopp_laden", test_stopp_laden},    {"frist_erfolg", test_frist_erfolg},
                     {"loop", test_loop},                  {"loop_laengen", test_loop_laengen},
                     {"loop_basis", test_loop_basis},      {"loop_rampe", test_loop_rampe},
                     {"loop_an_aus", test_loop_an_aus},    {"loop_band", test_loop_band},
                     {"loop_naht", test_loop_naht},        {"loop_raster", test_loop_raster},
                     {"loop_drift", test_loop_drift},      {"basis_nach_rampe", test_basis_nach_rampe},
                     {"loop_beatraster", test_loop_beatraster}, {"loop_basis128_alt", test_loop_basis128_alt},
                     {"loop_ansatz_band", test_loop_ansatz_band}, {"loop_tausch", test_loop_tausch}};
  for (const T& t : tests)
    if (argc < 2 || !std::strcmp(argv[1], t.name)) t.f();
  PRUEF_ENDE();
}

// ------------------------------------------------------------------------------------------ Test 8 (Kern)
// Aufbau wie test_kern_deck_neustart: k1 mit Zustandsdatei bis zum „kill -9“ mitten in der Rampe 128 -> 132 (Beat 16 bis
// 48, Absturz bei Beat 28); k2 setzt nach 40 ms aus dem Zustand fort, blendet das Material ein (decks_nachladen) und setzt
// am ersten Block an. Gemessen am Master (um den Vorhalt des Limiters zurückgerechnet), Klick-Material aus klick_fassung.py
// (Klickform exp(−i/12) · cos(2π · 2000 · i / 48000), 96 Samples, Bezugspunkt Klick-Anfang).
namespace {
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
struct KLauf {
  KRing& ring;
  std::unique_ptr<cdj::Befehlsring> bef{new cdj::Befehlsring()};
  std::unique_ptr<cdj::Ereignisring> ere{new cdj::Ereignisring()};
  std::unique_ptr<cdj::LaderRinge> lr{new cdj::LaderRinge()};
  cdj::Lader lader;
  std::unique_ptr<cdj::Kern> kern;
  std::unique_ptr<cdj::Betrieb> betrieb;
  int64_t W;
  int64_t id = 100;
  std::vector<float> master;  // je Kern-Sample
  std::vector<DeckLauf::Faktor> fk;
  int64_t n0_erst = -1;  // Kern-Sample des ersten Zyklus (nach fortsetzen)
  bool faden = true;     // false: der Arbeits-Thread setzt aus (keine Quittung des Dehners)
  int hoerweg = -9, fuell = -9;  // zuletzt gemeldet in /zustand/deck (Deck 1)
  std::vector<std::pair<int64_t, int>> quittungen;  // (id, status)
  KLauf(KRing& r, int64_t w, const std::string& ab, bool keylock) : ring(r), lader(ab, 3800LL << 20), W(w) {
    kern.reset(new cdj::Kern(128.0, ring.k, bef.get(), ere.get()));
    kern->verbinde_lader(lr.get());
    if (keylock) kern->setze_keylock_vorgabe(true);
  }
  void befehl(cdj::Befehl b) {
    b.id = ++id;
    std::snprintf(b.quelle, sizeof b.quelle, "andreas");
    PRUEF(bef->schiebe(b));
  }
  void aufbau() {
    cdj::Befehl l{};
    l.art = cdj::Befehl::DECK_LADEN;
    l.deck = 1;
    std::snprintf(l.material_id, sizeof l.material_id, "c1c0000000000801");
    l.bpm = 128.0;
    l.fassung = 1;
    befehl(l);
    cdj::Befehl f{};
    f.art = cdj::Befehl::TEIL;
    std::snprintf(f.pfad, sizeof f.pfad, "deck/1/fader");
    f.ab_beat = 2.0;
    f.wert = 0.0f;
    f.politik = 1;
    befehl(f);
    cdj::Befehl st{};
    st.art = cdj::Befehl::DECK_START;
    st.deck = 1;
    st.ab_beat = 4.0;
    st.quell_beat = 0.0;
    befehl(st);
    cdj::Befehl r{};
    r.art = cdj::Befehl::TEMPO_RAMPE;
    r.ab_beat = 16.0;
    r.ziel_bpm = 132.0;
    r.dauer_beats = 32.0;
    befehl(r);
  }
  void zyklus() {
    const uint64_t w0 = cdj_lade(&ring.k->w);
    const uint32_t F = (uint32_t)W;
    const int64_t mono = (int64_t)std::llround((double)W * 1e9 / 48000.0);
    if (betrieb) betrieb->zyklus_anfang(F, mono, *kern);
    kern->zyklus(B, mono);
    if (n0_erst < 0) n0_erst = kern->sample() - B;
    if (betrieb) betrieb->zyklus_ende(F, mono, B, *kern);
    lader.einmal(*lr);
    kern->keylock_vorbereiten();  // Vorbereiter und Arbeits-Thread synchron
    if (faden) kern->keylock_fuellen(1);
    if (cdj::DehnerBasis* d = kern->keylock_dehner(1))
      fk.push_back({d->quittiert_e(), d->geschrieben_bis(), d->faktor_gesetzt()});
    const int64_t n0 = kern->sample() - B;
    const float* x = cdj_ring_daten_c(ring.k);
    const int vh = kern->mixer().limiter_vorhalt();
    if ((int64_t)master.size() < n0 + B) master.resize((size_t)(n0 + B), 0.0f);
    for (int i = 0; i < B; ++i)
      if (n0 + i - vh >= 0) master[(size_t)(n0 + i - vh)] = x[((w0 + (uint64_t)i) % CDJ_RING_CAP) * 4];
    cdj::Ereignis e;
    while (ere->hole(e)) {
      if (e.art == cdj::Ereignis::QUITTUNG) quittungen.push_back({e.id, e.status});
      if (e.art == cdj::Ereignis::DECK && e.deck == 1) {
        hoerweg = e.hoerweg;
        fuell = e.stretcher_fuell;
      }
    }
    W += B;
  }
  std::vector<double> faktoren(uint32_t e, int64_t s_h) const {
    std::vector<double> f;
    for (const DeckLauf::Faktor& x : fk) {
      if (x.e != e || x.gb <= s_h) continue;
      const size_t w = (size_t)((x.gb - 1 - s_h) / cdj::DEHNER_REGEL_TAKT);
      if (f.size() <= w) f.resize(w + 1, x.f);
      f[w] = x.f;
    }
    return f;
  }
};
std::vector<float> fassung_klick() {
  std::vector<float> t(96);
  for (int i = 0; i < 96; ++i) t[i] = (float)(std::exp(-i / 12.0) * std::cos(2 * PI * 2000.0 * i / 48000.0));
  return t;
}
}  // namespace

// ------------------------------------------------------------------------------------------ Test 17 (Kern)
// Prüfung m4, Vertrag 4: 9 und 12 Materialwechsel, ohne dass der Arbeits-Thread quittiert. Die Rückgabeliste des Decks
// läuft voll; dann wartet das Laden (bzw. ein noch älteres wartendes fällt mit Quittung 7) und das Entladen, statt
// Material liegen zu lassen. Danach quittiert der Thread wieder: alles kommt zurück (Lader-Budget 0), die Entladen-
// Quittung 3 kommt. Dazu Prüfung m5: setze_keylock_vorgabe nach dem ersten Zyklus abgelehnt.
void test_rueck_warten() {
  namespace fs = std::filesystem;
  const std::string ab = "/dev/shm/test_deck_keylock_rueck_" + std::to_string(getpid());
  fs::create_directories(ab);
  const std::string c = "python3 " + std::string(CYPHERDJ_DJK) + "/kern/tests/deck/klick_fassung.py --ziel " + ab +
                        " --material-id c1c0000000000901 --beats 32 > /dev/null";
  PRUEF(std::system(c.c_str()) == 0);
  for (int wechsel : {9, 12}) {
    KRing r;
    KLauf k(r, 1'000'000, ab, true);
    const bool zweimal = !k.kern->setze_keylock_vorgabe(true);  // Task 2d: nur einmal
    k.zyklus();
    const bool abgelehnt = !k.kern->setze_keylock_vorgabe(false) && zweimal;
    PRUEF(abgelehnt && k.kern->keylock_vorgabe());
    k.faden = false;
    std::vector<int64_t> laden;
    for (int i = 0; i < wechsel; ++i) {
      cdj::Befehl l{};
      l.art = cdj::Befehl::DECK_LADEN;
      l.deck = 1;
      std::snprintf(l.material_id, sizeof l.material_id, "c1c0000000000901");
      l.bpm = 128.0;
      l.fassung = 1;
      k.befehl(l);
      laden.push_back(k.id);
      for (int j = 0; j < 3; ++j) k.zyklus();
      cdj::Befehl st{};
      st.art = cdj::Befehl::DECK_START;
      st.deck = 1;
      st.ab_beat = k.kern->karte().beat_at((double)k.kern->sample()) + 0.05;  // 1125 Samples: in den 12 Zyklen danach
      st.quell_beat = 0.0;
      st.politik = 1;
      k.befehl(st);
      for (int j = 0; j < 12; ++j) k.zyklus();
      if (std::getenv("KL_DIAG"))
        std::printf("    Wechsel %d: läuft %d, geladen %d, Anfrage %u, verliehen %d, Quittungen %zu\n", i,
                    (int)k.kern->deck(1).laeuft(), (int)k.kern->deck(1).geladen(), k.kern->deck(1).keylock_anfrage(),
                    k.kern->deck(1).keylock_verliehen(), k.quittungen.size());
    }
    auto hat = [&](int64_t id, int st) {
      for (auto& q : k.quittungen)
        if (q.first == id && q.second == st) return true;
      return false;
    };
    int fertig_vorher = 0;  // vor dem Entladen erledigte Laden (3 oder 7); eins weniger als Wechsel: eins wartet
    for (int64_t id : laden) fertig_vorher += hat(id, 3) || hat(id, 7) ? 1 : 0;
    cdj::Befehl en{};
    en.art = cdj::Befehl::DECK_ENTLADEN;
    en.deck = 1;
    k.befehl(en);
    const int64_t en_a = k.id;
    k.zyklus();
    k.befehl(en);  // Nachprüfung N2: ein zweites Entladen, während das erste wartet
    const int64_t en_id = k.id;
    for (int j = 0; j < 20; ++j) k.zyklus();
    const bool en3_vorher = hat(en_id, 3);
    const int64_t gesperrt_vorher = k.lader.gesperrt();
    const int verliehen_vorher = k.kern->deck(1).keylock_verliehen();
    k.faden = true;
    for (int j = 0; j < 200; ++j) k.zyklus();
    int fertig = 0, abbruch = 0;
    for (int64_t id : laden) {
      fertig += hat(id, 3) ? 1 : 0;
      abbruch += hat(id, 7) ? 1 : 0;
    }
    std::printf("  test17: %d Wechsel ohne Quittung: verliehen %d, Laden erledigt %d, Lader gesperrt %lld Bytes, Entladen-"
                "Quittung 3 %s; danach mit Thread: Laden fertig %d, abgebrochen %d, Entladen 2 %d / 3 %d, gesperrt %lld, "
                "verloren %llu\n",
                wechsel, verliehen_vorher, fertig_vorher, (long long)gesperrt_vorher, en3_vorher ? "schon da" : "wartet",
                fertig, abbruch,
                (int)hat(en_id, 2), (int)hat(en_id, 3), (long long)k.lader.gesperrt(),
                (unsigned long long)k.kern->deck(1).rueck_voll_verloren());
    PRUEF(verliehen_vorher >= 6);   // Positiv: der Dehner hielt wirklich Material
    PRUEF(!en3_vorher);
    PRUEF(fertig + abbruch == wechsel);
    PRUEF(fertig_vorher < wechsel);  // die Rückgabeliste lief voll: es wurde gewartet
    PRUEF(hat(en_id, 2) && hat(en_id, 3));
    PRUEF(hat(en_a, 7) && !hat(en_a, 2));  // das erste fällt mit Quittung 7 statt still zu bleiben
    std::printf("  test17: zweites Entladen: erstes Quittung 7 %d, zweites 2 %d / 3 %d\n", (int)hat(en_a, 7), (int)hat(en_id, 2),
                (int)hat(en_id, 3));
    PRUEF(k.lader.gesperrt() == 0);
    PRUEF(k.kern->deck(1).rueck_voll_verloren() == 0);
  }
  fs::remove_all(ab);
  ergebnis("keylock_rueck_warten");
}

void test_neustart() {
  namespace fs = std::filesystem;
  const std::string ab = "/dev/shm/test_deck_keylock_" + std::to_string(getpid());
  fs::create_directories(ab);
  const std::string c = "python3 " + std::string(CYPHERDJ_DJK) + "/kern/tests/deck/klick_fassung.py --ziel " + ab +
                        " --material-id c1c0000000000801 --beats 96 > /dev/null";
  PRUEF(std::system(c.c_str()) == 0);
  const std::string pfad = ab + "/zustand";
  const int64_t W_START = 1'000'000;
  const Karte k_soll = [] {
    Karte k(128.0, 0);
    k.rampe(16.0, 132.0, 32.0);
    return k;
  }();
  const int64_t absturz = (int64_t)k_soll.sample_at(28.0);
  KRing r1;
  int64_t W_absturz = 0;
  {
    KLauf k1(r1, W_START, ab, true);
    k1.betrieb.reset(new cdj::Betrieb());
    PRUEF(k1.betrieb->starte(pfad, *k1.kern).datei_ok);
    k1.aufbau();
    while (k1.kern->sample() < absturz) k1.zyklus();
    W_absturz = k1.W;
    PRUEF(k1.kern->deck(1).laeuft() && k1.kern->deck(1).keylock_ring_hoerbar());  // vor dem Absturz klang der Ring
  }
  KLauf k2(r1, W_absturz + 1920, ab, true);
  k2.betrieb.reset(new cdj::Betrieb());
  const cdj::Wiederaufnahme w = k2.betrieb->starte(pfad, *k2.kern);
  PRUEF(w.fortgesetzt);
  PRUEF(k2.kern->decks_nachladen(k2.lader) == 1);
  const cdj::Deck& dk = k2.kern->deck(1);
  PRUEF(dk.laeuft() && dk.keylock_anfrage() == 0);  // Keylock hängt der erste Zyklus an (Task 2d), der Ansatz kommt dann
  k2.zyklus();
  const int64_t s0 = k2.n0_erst;
  const int64_t s_h = dk.keylock_s_h();
  k2.zyklus();
  const uint32_t e = dk.keylock_epoche();
  // Soll aus dem Aufbau (Start bei Beat 4 auf Quell-Beat 0, phasenstarr über den Neustart), nicht aus dem Anker des Decks
  const DehnerAnker a{4.0, 0.0};
  const Karte k_ansatz = k2.kern->karte();
  const int64_t ende = (int64_t)k_soll.sample_at(46.0);
  while (k2.kern->sample() < ende) k2.zyklus();
  std::printf("  test8: Neustart bei Kern-Sample %lld (Beat %.2f), s_h %lld, Epoche %u (am Ende %u, erneuert %d), Ring "
              "hörbar %d, Unterläufe %llu, Vorhalt %d\n",
              (long long)s0, k_soll.beat_at((double)s0), (long long)s_h, e, dk.keylock_epoche(),
              k2.kern->keylock_dehner(1)->ansatz_erneuert(), (int)dk.keylock_ring_hoerbar(),
              (unsigned long long)dk.keylock_unterlauf(), k2.kern->mixer().limiter_vorhalt());
  PRUEF(s_h == s0 + cdj::ANSATZ_FRIST);
  PRUEF(e != cdj::EPOCHE_KEINE && dk.keylock_ring_hoerbar() && dk.keylock_unterlauf() == 0);
  std::printf("  test8: /zustand/deck zuletzt: hoerweg %d, stretcher_fuell %d\n", k2.hoerweg, k2.fuell);
  PRUEF(k2.hoerweg == 1 && k2.fuell >= 1 && k2.fuell <= 8);  // §5.5: Stretcher hörbar, Arbeitsvorlauf in Blöcken
  PRUEF(std::fabs(k2.kern->karte().bpm_at((double)s_h) - k_soll.bpm_at((double)s_h)) < 1e-9);  // Karte mitten in der Rampe
  const std::vector<double> f = k2.faktoren(e, s_h);
  PRUEF(!f.empty());
  if (f.empty()) {  // kein Ansatz gehört (Fehlerfall): nichts zu messen
    fs::remove_all(ab);
    ergebnis("keylock_neustart");
    return;
  }
  // Lage (a) und (b) über die Klicks nach der Blende Brücke -> Ring bis Beat 46
  const std::vector<float> tpl = fassung_klick();
  km::MatQuelle q(dk.material());
  const int64_t p0 = km::band_start(k_ansatz, a, s_h, f.at(0));
  std::vector<float> x = k2.master;
  x.resize((size_t)ende, 0.0f);
  const std::vector<float> R = km::r3_roh(q, p0, f, s_h, (int64_t)x.size());
  const int64_t s_r = s_h + cdj::DECK_KEYLOCK_EINSCHWING + cdj::DECK_KEYLOCK_BLENDE;
  const int q0 = (int)std::ceil(a.f / FPB + k_ansatz.beat_at((double)s_r) - a.b);
  const int q1 = (int)(a.f / FPB + 45.0 - a.b);
  // Die Kette des Kerns (Kanalzug, Limiter) verschiebt einen Klick dieser Form um einen festen Betrag (gemessen: der
  // phasenstarre Varispeed-Weg liegt am Master um rund +16,6 Samples hinter dem Soll, obwohl der Vorhalt des Limiters
  // schon abgezogen ist). Darum je Klick gegen den Bezug am selben Fall: derselbe Kern ohne Keylock und ohne Absturz.
  KRing r0;
  KLauf k0(r0, W_START, ab, false);
  k0.aufbau();
  while (k0.kern->sample() < ende) k0.zyklus();
  PRUEF(k0.hoerweg == 0 && k0.fuell == -1);  // ohne Keylock wie bisher
  std::vector<float> x0 = k0.master;
  x0.resize((size_t)ende, 0.0f);
  int n = 0;
  double summe = 0, max_roh = 0, max_soll = 0, kette = 0;
  for (int i = q0; i < q1; ++i) {
    double ei = 999, er = 999, ev = 999;
    if (!km::klick_lage(x, k_ansatz, a, i, ei, tpl, 0.0) || !km::klick_lage(R, k_ansatz, a, i, er, tpl, 0.0) ||
        !km::klick_lage(x0, k_ansatz, a, i, ev, tpl, 0.0))
      continue;
    const double d = ei - ev;  // Lage gegen das Soll, die Kette herausgerechnet
    ++n;
    summe += d;
    kette += ev;
    max_soll = std::max(max_soll, std::fabs(d));
    max_roh = std::max(max_roh, std::fabs(d - er));
  }
  const double mittel = n ? summe / n : NAN;
  std::printf("  test8: Klicks %d..%d: %d gemessen, Kette (Bezug Varispeed) im Mittel %+.2f; ohne sie: (a) Mittel %+.2f, "
              "(b) max |Kern − rohes R3| %.2f, max |Lage| %.2f\n",
              q0, q1 - 1, n, n ? kette / n : NAN, mittel, max_roh, max_soll);
  PRUEF(n == q1 - q0 && n >= 12);
  // Keylock 4.6: das absolute Mittel wird nur ausgewiesen (Deck-Versatz 0; Hann-Klick liegt um die R3-eigene Lage daneben)
  PRUEF(max_roh <= 12.0);
  PRUEF(max_soll <= 12.0);
  fs::remove_all(ab);
  ergebnis("keylock_neustart");
}
