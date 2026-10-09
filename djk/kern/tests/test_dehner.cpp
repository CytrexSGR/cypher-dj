// Keylock in Echtzeit, Task 1 (Plan docs/superpowers/plans/2026-10-06-keylock-echtzeit.md): der Dehner offline, ohne JACK.
// Der Arbeits-Thread wird synchron gefahren (fuelle_synchron(), derselbe Aufruf wie in der Thread-Schleife); der Test
// spielt den Callback: Karte veröffentlichen, füllen, Ring je 256er-Block lesen. Fix-Runde 1b nach der Prüfung (F1 bis F8).
//
// Lage-Messgröße (Prüfung F3), für alle Lage-Tests:
//   (a) Mittel über die Klicks gegen das Soll (sample_at(beat)): seit Keylock 4.6 (Deck-Versatz 0) nur ausgewiesen; tragend
//       statt dessen je Klick ±12 gegen das Soll (lage_pruefen soll12, lage_haelt), außer Test 11 und 12;
//   (b) jeder Klick ±12 gegen ROHES R3: dieselbe Quelle durch eine nackte Rubber-Band-Instanz (eigene Speisung in festen
//       256er-Blöcken, Pad, Startverzögerung verworfen), mit derselben Faktorfolge je 43er-Fenster, die der Dehner gesetzt
//       hat, ab demselben, um den Versatz korrigierten Band-Start kopf(s_h) + VERSATZ(f0) · f0.
//   R3 streut je Klick selbst um bis zu rund 60 Samples um sein Mittel (task-01-fix/f3_versatz_roh.txt); ±12 gegen das
//   Soll ist jenseits von ±9 % Faktor darum nicht erreichbar. (b) zeigt, dass der Dehner zur Streuung von R3 nichts
//   hinzufügt; (a), dass Versatz und Regler die Lage im Mittel halten. Ein Start der Referenz am UNkorrigierten Kopf mit
//   nachträglichem Abzug des Versatzes trägt nicht: der verschobene Start ändert die Streuung von R3 selbst (bis 58,6
//   Samples bei 170 BPM, task-01-fix/f3b_roh_prototyp.txt, Variante 2).
// Klick-Lage gemessen wie M4 (messungen/M04-tempo-rampen/auswerten.py phase()): Kreuzkorrelation mit der Klick-Vorlage in
// ±3000 Samples um das Soll, parabolisch, auf die Klick-Mitte bezogen (71,5 Samples). Positiv: zu spät.
//
// Aufruf ohne Argument: alle Tests. `test_dehner faeden`: nur Test 7 (TSan-Bau build-tsan). `test_dehner einmessen`:
// Abschnitt 0, Versatz an den 18 Tempi der früheren Tabelle (bis c06b2b8) ohne und mit Korrektur (seit 4.6 beide gleich, Korrektur 0) (druckt nur).
// Tests:
//   1 dehner_ansatz_auf_dem_sample  s_h = 1000 mitten im Block: Ring ab genau 1000, bitgleich zum Ansatz bei 4096 (Kern-
//                                   beweis), Lage (a) und (b) über die ersten 8 Klicks (Karte 132)
//   2 dehner_lage_rampe             128 -> 132 über 32 Beats ab Beat 8, Vorhalt-Vorgabe: Lage (a) und (b) bis 16 Beats
//                                   nach der Rampe
//   3 dehner_tonhoehe               Sinus 1000 Hz, 128 -> 132 über 8 Beats: 100-ms-Fenster ±2 ct, Null-Läufe 0
//   4 dehner_faktor_nie_eins        Karte 128: jeder gesetzte Faktor mindestens 1e-6 von 1,0 weg
//   5 dehner_karte_neu_vor_s_h      Rampe (4 Beats) angenommen bzw. Karte neu zwischen Ansatz und s_h: ansatz_erneuert()
//                                   = 1, Lage (a) und (b); Gegenproben ohne Erneuerung reißen (a)
//   6 dehner_allokation             0 Allokationen in fuelle_synchron nach dem Anlegen, in ansetzen nur die 2 aus
//                                   R3Stretcher::reset (Rubber Band 3.3.0); Positiv-Kontrolle
//   7 dehner_zwei_faeden            Vorbereiter und Arbeits-Thread in echten Fäden, 2 s (unter TSan: 0 Befunde)
//   8 dehner_epochen                Epochen vergibt nur der Dehner; epoche() für den Leser
//   9 dehner_stand_veraltet         erneuert nur bei neuerer Generation
//  10 dehner_kurze_rampen           Rampen 4, 8, 16 Beats und die Folge 128 -> 132 -> 126 -> 134 -> 128: Lage (a) und (b);
//                                   1 und 2 Beats nur gemessen (dokumentierte Grenze)
//  11 dehner_versatz_bereich        konstant 96 bis 170 BPM (Faktor 0,75 bis 1,33), 64 Klicks: (b), Mittel ausgewiesen
//                                   (seit 4.6 die R3-eigene Lage des Hann-Klicks, −96 bis +36)
//  12 dehner_regler_in_rampe        Ansatz mitten in einer laufenden Rampe 128 -> 136 (8 und 16 Beats): (b), und das Mittel
//                                   ±3 gegen das Ideal gleicher Klickform (einmessen im Faktor des Ansatzes, 4.6b); der
//                                   Fall, in dem der Regler das Totband verlässt
//  13 dehner_versatz_null           4.6b: dehner_versatz() = 0 im Faktorbereich, Hann-Klick 96 BPM bei −96,2 ±3
//  W1a bis W5 (Task 6b)           Wechsel des Bandes in der laufenden Epoche und Gegenwechsel (Plan Task 6, 3.2, 3.7, 7);
//                                 Beschreibung je Test unten. `test_dehner wechsel`, `test_dehner wechsel_faeden [n]`.
// Fehlerfälle (CMake test_mutation, WILL_FAIL), gemessen in der Fix-Runde (task-01-fix/mutation_*.txt):
//   CYPHERDJ_MUTATION_DEHNER_FAKTOR_ANFANG: Tests 2, 5, 10 rot (vor 4.6 über (a), Test 2 +92,23; seit 4.6 über je Klick
//   ±12 gegen das Soll, Test 2 max 167,09).
//   CYPHERDJ_MUTATION_DEHNER_OHNE_REGLER: Tests 5 und 12 rot (Ansatz in einer laufenden Rampe; seit 4.6 Test 5 über je
//   Klick ±12 gegen das Soll, Test 12 über das Mittel gegen das Ideal gleicher Klickform, 4.6b). Mit der Vorhalt-Vorgabe
//   2400 bleibt der Regler in Rampen, die nach dem Ansatz beginnen, im Totband (Test 2 mit und ohne Regler gleich, (a)
//   −0,37); er wirkt, wenn der Ansatz in eine laufende Rampe fällt (task-01-fix/f1c_regler_sweep.txt).
//
// Geltungsgrenzen (Task 1b, Entscheidung der Hauptinstanz: nur festgehalten):
//   - Die Versatz-Tabelle (bis c06b2b8) war an EINEM Fall eingepasst: Klick-Material Basis 128, Band-Start auf Quell-Beat 4,
//     Mittel über 64 Klicks. Seit Keylock 4.6 ist sie für die Decks 0 (Andreas 08.10., drums2/BERICHT.md).
//   - (b) bekommt die Faktorfolge des Dehners. Es zeigt Fehler in Platzierung, Ring, Epochen und Vorbereiten, aber
//     keine Fehler von Regler oder Versatz; die deckt seit 4.6 je Klick ±12 gegen das Soll (vorher (a)).
#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <thread>
#include <vector>

#include <rubberband/RubberBandStretcher.h>

#include "keylock_mess.h"  // die Messhilfen (Task 2b, Prüfung F8: eine Quelle für test_dehner und test_deck_keylock)
#include "alloc_abfang.h"
#include "cypherdj/dehner.h"
#include "cypherdj/fassung.h"  // FRAMES_JE_MINUTE
#include "cypherdj/uhr.h"
#include "pruef.h"

namespace {

using cdj::DehnerAnker;
using cdj::DehnerBasis;
using cdj::DehnerOptionen;
using cdj::Karte;

using km::B;
using km::FPB;
using km::freq;
using km::klick_vorlage;
using km::Lage;
using km::MITTE;
using km::PI;
using km::r3_roh;

// Testquelle mit Band (der Dehner kennt kein Material, nur DehnerQuelle; Basis 128, erster Schlag auf Frame 0)
struct Probe : cdj::DehnerQuelle {
  std::vector<float> d;
  int64_t frames = 0;
  // art 0: Klick je Quell-Beat (M4 klick), art 1: Sinus 1000 Hz, Spitze 0,5
  Probe(double beats, int art) {
    frames = (int64_t)std::ceil(beats * FPB);
    d.assign((size_t)(2 * frames), 0.0f);
    if (art == 0) {
      const std::vector<float> tpl = klick_vorlage();
      for (int64_t q = 0; (double)q * FPB + 144 < (double)frames; ++q)
        for (int i = 0; i < 144; ++i) {
          const int64_t f = q * (int64_t)FPB + i;
          d[(size_t)(2 * f)] = d[(size_t)(2 * f + 1)] = tpl[(size_t)i];
        }
    } else {
      for (int64_t f = 0; f < frames; ++f)
        d[(size_t)(2 * f)] = d[(size_t)(2 * f + 1)] = (float)(0.5 * std::sin(2 * PI * 1000.0 * (double)f / 48000.0));
    }
  }
  void band(int64_t ab, int n, float* l, float* r) const noexcept override {
    for (int i = 0; i < n; ++i) {
      const int64_t f = ab + i;
      const bool drin = f >= 0 && f < frames;
      l[i] = drin ? d[(size_t)(2 * f)] : 0.0f;
      r[i] = drin ? d[(size_t)(2 * f + 1)] : 0.0f;
    }
  }
  double basis_bpm() const noexcept override { return 128.0; }
};

// Spielt den Callback. Ausgabe je Kern-Sample (Index = Sample), was der Ring nicht liefert, bleibt 0.
struct Lauf {
  std::unique_ptr<DehnerBasis> d;
  std::vector<float> L;
  int64_t erstes = -1;  // erstes Sample, das der Ring lieferte
  int unterlauf = 0;    // Blöcke ab s_h ohne lückenlosen Ring
  int64_t s_h = 0;
  std::vector<double> f;  // Faktor je 43er-Fenster ab s_h, wie der Dehner ihn gesetzt hat (für die Referenz rohes R3)
  Lauf(const DehnerOptionen& o, int64_t laenge) : d(cdj::dehner_neu(1, o)), L((size_t)laenge, 0.0f) {}

  // Der Leser nimmt seine Epoche nur aus d->epoche() (Prüfung F4).
  void block(int64_t b, const Karte& k, uint32_t gen) {
    cdj::KartenStand st;
    st.karte = k;
    st.generation = gen;
    st.s_jetzt = b;
    d->karte_veroeffentlichen(st);
    d->fuelle_synchron();
    // Faktorfolge mitschreiben (faktor_gesetzt() und geschrieben_bis() sind „nur synchron“: hier derselbe Faden). Der
    // Faktor wechselt nur am Anfang eines 43er-Fensters, ein Aufruf schreibt höchstens 5 Abschnitte: der zuletzt gesetzte
    // gilt im Fenster des zuletzt geschriebenen Abschnitts.
    const int64_t gb = d->geschrieben_bis();
    if (gb > s_h) {
      const size_t w = (size_t)((gb - 1 - s_h) / cdj::DEHNER_REGEL_TAKT);
      if (f.size() <= w) f.resize(w + 1, d->faktor_gesetzt());
      f[w] = d->faktor_gesetzt();
    }
    cdj::StreckRing& r = d->ring();
    r.setze_epoche(d->epoche());
    float l[B], rr[B];
    const int64_t ab = r.bereit_ab(b);
    if (ab < 0 || ab >= b + B) {  // nichts für diesen Block (Brücke vor s_h)
      if (b + B > s_h) ++unterlauf;
      return;
    }
    if (ab > b && b >= s_h) ++unterlauf;
    const int n = (int)(b + B - ab);
    if (!r.lies(ab, n, l, rr)) {
      ++unterlauf;
      return;
    }
    if (erstes < 0) erstes = ab;
    for (int i = 0; i < n; ++i)
      if (ab + i < (int64_t)L.size()) L[(size_t)(ab + i)] = l[i];
  }
  void bis(int64_t ende, const Karte& k, uint32_t gen, int64_t von = 0) {
    for (int64_t b = von; b + B <= ende; b += B) block(b, k, gen);
  }
};

cdj::AnsatzAuftrag auftrag(const cdj::DehnerQuelle* m, int64_t s_h, DehnerAnker a, const Karte& k, uint32_t g) {
  cdj::AnsatzAuftrag x;
  x.quelle = m;
  x.s_h = s_h;
  x.anker = a;
  x.karte = k;
  x.generation = g;
  return x;
}

// Lage des Klicks von Quell-Beat q: Ist − Soll in Samples (M4 phase(), keylock_mess.h mit der Klick-Vorlage)
bool klick_lage(const std::vector<float>& x, const Karte& k, DehnerAnker a, int q, double& e) {
  static const std::vector<float> tpl = klick_vorlage();
  return km::klick_lage(x, k, a, q, e, tpl, MITTE);
}


// Lage der Klicks q0 <= q < q1 des Laufs l (Karte k, Anker a) nach (a) und (b). k_ansatz: die Karte, mit der der
// gehörte Ansatz angesetzt wurde (bestimmt den Band-Start p0 wie im Dehner: round(kopf(s_h) + VERSATZ(f0) · f0)).
Lage lage_messen(const Lauf& l, const cdj::DehnerQuelle& q, const Karte& k_ansatz, const Karte& k, DehnerAnker a, int q0,
                 int q1, bool je_klick = false) {
  Lage m;
  const double f0 = l.f.at(0);
  const double kopf_h = a.f + (k_ansatz.beat_at((double)l.s_h) - a.b) * FPB;
  const int64_t p0 = (int64_t)std::round(kopf_h + cdj::dehner_versatz(f0) * f0);
  const std::vector<float> R = r3_roh(q, p0, l.f, l.s_h, (int64_t)l.L.size());
  double summe = 0;
  for (int i = q0; i < q1; ++i) {
    double e = 999, er = 999;
    if (!klick_lage(l.L, k, a, i, e) || !klick_lage(R, k, a, i, er)) continue;
    if (je_klick) std::printf("    Klick %d: Dehner %+.2f, rohes R3 %+.2f\n", i, e, er);
    ++m.n;
    summe += e;
    m.max_soll = std::max(m.max_soll, std::fabs(e));
    if (std::fabs(e - er) > m.max_roh) {
      m.max_roh = std::fabs(e - er);
      m.q_roh = i;
    }
  }
  m.mittel = m.n ? summe / m.n : NAN;
  return m;
}

void lage_drucken(const char* name, const Lage& m) {
  std::printf("  %s: %d Klicks, (a) Mittel %+.2f, (b) max |Dehner − rohes R3| %.2f (Klick %d); max |Lage| %.2f\n", name,
              m.n, m.mittel, m.max_roh, m.q_roh, m.max_soll);
}

// Prüft (a) und (b); n_soll: so viele Klicks müssen gemessen sein (sonst prüfte der Test zu wenig)
// Keylock 4.6: soll12 prüft zusätzlich je Klick ±12 gegen das Soll (tragend für Regler und Faktor-Regel, seit das Mittel
// nur ausgewiesen wird); aus für Test 11 (96 bis 170 BPM: der Hann-Klick liegt ohne Versatz bis −96 neben dem Soll) und
// Test 12 (Ansatz in der Rampe auf 136: bis 16,3).
void lage_pruefen(const char* name, const Lage& m, int n_soll, bool soll12 = true) {
  lage_drucken(name, m);
  PRUEF(m.n == n_soll);
  if (soll12) PRUEF(m.max_soll <= 12.0);
  // Keylock 4.6: das absolute Mittel wird nur ausgewiesen (Deck-Versatz 0; Hann-Klick liegt um die R3-eigene Lage daneben)
  PRUEF(m.max_roh <= 12.0);
}

int test_fehler_vorher = 0;
void ergebnis(const char* name) {
  std::printf("TEST %s: %s\n", name, pruef_fehler == test_fehler_vorher ? "gruen" : "ROT");
  std::fflush(stdout);
  test_fehler_vorher = pruef_fehler;
}

// ------------------------------------------------------------------------------------------ Abschnitt 0: Einmessen
// Mittlerer Versatz der Klicks q = 4..67 (64 Klicks) bei konstantem Tempo, Band-Start auf Quell-Beat 4.
double einmessen(double bpm, bool versatz_anwenden) {
  static Probe p(80, 0);
  DehnerOptionen o;
  o.versatz_anwenden = versatz_anwenden;
  const Karte k(bpm, 0);
  const int64_t s_h = 4096;
  const DehnerAnker a{k.beat_at((double)s_h), 4 * FPB};
  Lauf l(o, (int64_t)k.sample_at(a.b + 66.0));
  l.s_h = s_h;
  l.d->ansetzen(auftrag(&p, s_h, a, k, 1));
  l.bis((int64_t)l.L.size(), k, 1);
  double summe = 0;
  int n = 0;
  for (int q = 4; q < 68; ++q) {
    double e;
    if (klick_lage(l.L, k, a, q, e)) {
      summe += e;
      ++n;
    }
  }
  return n == 64 ? summe / n : NAN;
}

void abschnitt0_einmessen() {
  std::printf("ABSCHNITT 0: Versatz (Mittel der Klicks 4..67 gegen Soll, Samples) ohne und mit Korrektur\n");
  // die 18 Tempi der früheren Tabelle (bis c06b2b8, dehner.h); seit 4.6 ist die Korrektur der Decks 0
  for (const double bpm : {96.0, 100.0, 105.0, 110.0, 115.0, 120.0, 124.0, 128.0, 132.0, 136.0, 140.0, 145.0, 150.0, 155.0,
                           160.0, 165.0, 170.0, 172.8}) {
    std::printf("  bpm %6.1f faktor %.6f: ohne %+8.3f  mit %+7.3f  (Korrektur %+8.3f)\n", bpm, bpm / 128.0,
                einmessen(bpm, false), einmessen(bpm, true), cdj::dehner_versatz(bpm / 128.0));
  }
}

// Dauer des Vorbereitens (Vertrag 5): ansetzen() ganz, 40 Ansätze bei 132 BPM, jeder mit neuer Epoche
void abschnitt0_kosten() {
  static Probe p(40, 0);
  const Karte k(132.0, 0);
  auto d = cdj::dehner_neu(1, {});
  for (int i = 1; i <= 40; ++i) {
    const int64_t s_h = 4096 + (int64_t)i * 10000;
    d->ansetzen(auftrag(&p, s_h, DehnerAnker{0.0, 0.0}, k, 1));
    d->fuelle_synchron();  // Thread übernimmt, gibt die alte Instanz als Reserve zurück
  }
  const cdj::DehnerKosten& ka = d->kosten_ansatz();
  std::printf("ABSCHNITT 0: Vorbereiten (ansetzen) n %llu: p50 %.0f us, p99 %.0f us, max %.1f us, mittel %.1f us\n",
              (unsigned long long)ka.n, ka.quantil_us(0.5), ka.quantil_us(0.99), ka.max_ns / 1000.0,
              ka.n ? ka.summe_ns / 1000.0 / (double)ka.n : 0.0);
  const cdj::DehnerKosten& kr = d->kosten_render();
  std::printf("ABSCHNITT 0: Render je 256er-Abschnitt n %llu: p50 %.0f us, p99 %.0f us, max %.1f us\n",
              (unsigned long long)kr.n, kr.quantil_us(0.5), kr.quantil_us(0.99), kr.max_ns / 1000.0);
}

// ------------------------------------------------------------------------------------------ Test 1
void test_ansatz_auf_dem_sample() {
  static Probe p(20, 0);
  const Karte k(132.0, 0);
  const int64_t s_h = 1000;
  const DehnerAnker a{k.beat_at((double)s_h), 4 * FPB};  // Band-Start auf Quell-Beat 4
  Lauf l({}, (int64_t)k.sample_at(a.b + 9.0));
  l.s_h = s_h;
  PRUEF(l.d->ansetzen(auftrag(&p, s_h, a, k, 1)) != cdj::EPOCHE_KEINE);
  // erster Block [768, 1024): der Ring meldet genau 1000
  l.bis(768, k, 1);
  l.d->fuelle_synchron();
  l.d->ring().setze_epoche(l.d->epoche());
  const int64_t ab = l.d->ring().bereit_ab(768);
  std::printf("  test1: bereit_ab(768) = %lld\n", (long long)ab);
  PRUEF(ab == 1000);
  l.bis((int64_t)l.L.size(), k, 1, 768);
  std::printf("  test1: erstes Sample aus dem Ring %lld, Unterläufe %d\n", (long long)l.erstes, l.unterlauf);
  PRUEF(l.erstes == 1000);
  PRUEF(l.unterlauf == 0);
  for (int64_t s = 0; s < 1000; ++s)
    if (l.L[(size_t)s] != 0.0f) {
      PRUEF(!"Ring lieferte vor s_h");
      break;
    }
  // Lage (a) und (b) über die ersten 8 Klicks
  lage_pruefen("test1 Lage Karte 132", lage_messen(l, p, k, k, a, 4, 12, true), 8);
  // Auf dem Sample: derselbe Ansatz bei s_h = 4096 (Band-Start wieder Quell-Beat 4) liefert dieselben Frames, um genau
  // 3096 Samples verschoben (bitgleich). Ein Ansatz auf der Blockgrenze oder mit Rundung auf Blöcke fiele hier auf.
  const int64_t s_h2 = 4096;
  const DehnerAnker a2{k.beat_at((double)s_h2), 4 * FPB};
  Lauf l2({}, (int64_t)l.L.size() + (s_h2 - s_h));
  l2.s_h = s_h2;
  PRUEF(l2.d->ansetzen(auftrag(&p, s_h2, a2, k, 1)) != cdj::EPOCHE_KEINE);
  l2.bis((int64_t)l2.L.size(), k, 1);
  int64_t ungleich = 0, verglichen = 0;
  for (int64_t s = s_h; s + (s_h2 - s_h) < (int64_t)l2.L.size() && s < (int64_t)l.L.size() - B; ++s, ++verglichen)
    if (l.L[(size_t)s] != l2.L[(size_t)(s + s_h2 - s_h)]) ++ungleich;
  std::printf("  test1: gegen Ansatz bei 4096: %lld von %lld Samples ungleich\n", (long long)ungleich, (long long)verglichen);
  PRUEF(verglichen > 100000);
  PRUEF(ungleich == 0);
  ergebnis("dehner_ansatz_auf_dem_sample");
}

// ------------------------------------------------------------------------------------------ Test 2
// Vorhalt-Vorgabe (DehnerOptionen{}): 2400 Samples für alle Rampen (Prüfung F2)
void test_lage_rampe() {
  static Probe p(64, 0);
  Karte k(128.0, 0);
  PRUEF(k.rampe(8.0, 132.0, 32.0));
  const int64_t s_h = 4096;
  const DehnerAnker a{0.0, 0.0};  // Quell-Beat = Master-Beat
  Lauf l({}, (int64_t)k.sample_at(58.0));
  l.s_h = s_h;
  PRUEF(l.d->ansetzen(auftrag(&p, s_h, a, k, 1)) != cdj::EPOCHE_KEINE);
  l.bis((int64_t)l.L.size(), k, 1);
  PRUEF(l.unterlauf == 0);
  lage_pruefen("test2 Rampe 128 -> 132 über 32 Beats ab 8, Klicks 1..56", lage_messen(l, p, k, k, a, 1, 57), 56);
  std::printf("  test2: c zuletzt %.1f ppm, Unterläufe %d\n", l.d->regler_c() * 1e6, l.unterlauf);
  ergebnis("dehner_lage_rampe");
}

// ------------------------------------------------------------------------------------------ Test 3
void test_tonhoehe() {
  static Probe p(24, 1);
  Karte k(128.0, 0);
  PRUEF(k.rampe(4.0, 132.0, 8.0));
  const int64_t s_h = 4096;
  Lauf l({}, (int64_t)k.sample_at(20.0));
  l.s_h = s_h;
  PRUEF(l.d->ansetzen(auftrag(&p, s_h, DehnerAnker{0.0, 0.0}, k, 1)) != cdj::EPOCHE_KEINE);
  l.bis((int64_t)l.L.size(), k, 1);
  PRUEF(l.unterlauf == 0);
  const int64_t ende = (int64_t)l.L.size() - B;
  double max_ct = 0;
  int fenster = 0;
  for (int64_t a = s_h; a + 4800 <= ende; a += 4800) {
    const double ct = 1200.0 * std::log2(freq(l.L, a, a + 4800) / 1000.0);
    max_ct = std::max(max_ct, std::fabs(ct));
    if (std::fabs(ct) > 2.0) std::printf("  test3: Fenster ab %lld: %+.3f ct\n", (long long)a, ct);
    PRUEF(std::fabs(ct) <= 2.0);
    ++fenster;
  }
  // Null-Samples: Läufe von >= 32 exakten Nullen ab s_h (Messgröße), dazu alle exakten Nullen
  int laeufe = 0, nullen = 0, lauf = 0;
  for (int64_t s = s_h; s < ende; ++s) {
    if (l.L[(size_t)s] == 0.0f) {
      ++nullen;
      if (++lauf == 32) ++laeufe;
    } else {
      lauf = 0;
    }
  }
  std::printf("  test3: %d Fenster, max |Tonhöhe| %.3f ct, Null-Läufe >= 32: %d, exakte Nullen %d\n", fenster, max_ct,
              laeufe, nullen);
  PRUEF(fenster >= 50);
  PRUEF(laeufe == 0);
  ergebnis("dehner_tonhoehe");
}

// ------------------------------------------------------------------------------------------ Test 4
void test_faktor_nie_eins() {
  static Probe p(24, 0);
  const Karte k(128.0, 0);
  const int64_t s_h = 4096;
  Lauf l({}, (int64_t)k.sample_at(20.0));
  l.s_h = s_h;
  PRUEF(l.d->ansetzen(auftrag(&p, s_h, DehnerAnker{0.0, 0.0}, k, 1)) != cdj::EPOCHE_KEINE);
  l.bis((int64_t)l.L.size(), k, 1);
  const double f = l.d->faktor_gesetzt(), amin = l.d->faktor_kleinster_abstand();
  std::printf("  test4: Faktor zuletzt 1%+.3e, kleinster Abstand zu 1,0 %.3e\n", f - 1.0, amin);
  PRUEF(std::fabs(f - 1.0) >= 0.999e-6);
  PRUEF(amin >= 0.999e-6);
  PRUEF(amin < 1.5e-6);  // Positiv: der Basis-Fall wurde wirklich getroffen (sonst prüft der Test nichts)
  ergebnis("dehner_faktor_nie_eins");
}

// ------------------------------------------------------------------------------------------ Test 5
// Ansatz bei s_jetzt = 0 mit Karte 128 (Generation 1), s_h = ANSATZ_FRIST; im ersten Block kommt eine neue Karte
// (Generation 2): a) Rampe 128 -> 132 über 4 Beats ab Beat 0,10 (s_h liegt auf Beat 0,18, also in der Rampe;
// angenommen vor s_h), b) Karte neu bei 132 (SET_NEU, Vertrag 10). Vorhalt-Vorgabe 2400. erneuern = false: Gegenprobe,
// die alte Epoche läuft mit Faktor und Band-Start der Karte 128 an.
// Prüfung F6: die frühere Rampe über 32 Beats trennte nicht (Gegenprobe (a) +0,40, max 7,78; task-01-fix/f6_rot.txt).
// Über 4 Beats reißt die Gegenprobe (a) (+17,99). Rampenbeginn gemessen (task-01-fix/f6_test5_rampenbeginn.txt): mit
// Erneuerung liegt das Mittel in kurzen Rampen bei −1,4 bis −3,1, auch wenn die Rampe erst nach s_h beginnt (ab 1,00
// über 4 Beats −2,33, mit und ohne Erneuerung gleich): ein Frühlauf mit Vorhalt 2400, nicht die Erneuerung. Ab Beat 0,02
// reißt er (a) knapp (−3,11), darum 0,10 (−2,44).
Lage karte_neu(const char* name, const Karte& k2, bool erneuern, int* erneuert) {
  static Probe p(24, 0);
  const Karte k1(128.0, 0);
  const int64_t s_h = cdj::ANSATZ_FRIST;
  const DehnerAnker a{0.0, 0.0};
  Lauf l({}, (int64_t)k2.sample_at(16.0));
  l.s_h = s_h;
  PRUEF(l.d->ansetzen(auftrag(&p, s_h, a, k1, 1)) == 1);
  l.block(0, k1, 1);
  cdj::KartenStand st;
  st.karte = k2;
  st.anker = a;
  st.generation = 2;
  st.s_jetzt = B;
  if (erneuern) l.d->vorbereiter_schritt(st);
  l.bis((int64_t)l.L.size(), k2, 2, B);
  *erneuert = l.d->ansatz_erneuert();
  // Referenz mit dem Band-Start, den der gehörte Ansatz hatte (erneuert: Karte k2, sonst k1)
  const Lage m = lage_messen(l, p, erneuern ? k2 : k1, k2, a, 1, 15);
  char nm[160];
  std::snprintf(nm, sizeof nm, "test5 %s (%s), Epoche %u, erneuert %d, Unterläufe %d", name,
                erneuern ? "mit Erneuerung" : "Gegenprobe ohne", l.d->epoche(), *erneuert, l.unterlauf);
  lage_drucken(nm, m);
  PRUEF(l.unterlauf == 0);
  PRUEF(m.n == 14);
  return m;
}

// Keylock 4.6: statt des Mittels ±3 je Klick ±12 gegen das Soll (max_soll) und gegen rohes R3 (max_roh); das Mittel wird
// ausgewiesen. Bei 132 BPM liegt der Hann-Klick ohne Versatz im Mittel um +4,9 (task-01-fix/f3_versatz_roh.txt).
bool lage_haelt(const Lage& m) { return m.max_soll <= 12.0 && m.max_roh <= 12.0; }

void test_karte_neu_vor_s_h() {
  Karte rampe(128.0, 0);
  PRUEF(rampe.rampe(0.10, 132.0, 4.0));
  const Karte neu(132.0, 0);
  int n = 0;
  PRUEF(lage_haelt(karte_neu("Rampe 4 Beats", rampe, true, &n)));
  PRUEF(n == 1);
  PRUEF(lage_haelt(karte_neu("SET_NEU", neu, true, &n)));
  PRUEF(n == 1);
  // Gegenproben: ohne Erneuerung reißt die Lage (sonst sähe der Test den Fehlerfall nicht), für BEIDE Fälle
  const Lage g_rampe = karte_neu("Rampe 4 Beats", rampe, false, &n);
  PRUEF(!lage_haelt(g_rampe));
  PRUEF(g_rampe.max_soll > 12.0);  // 4.6: die Gegenprobe reißt je Klick gegen das Soll (vorher: Mittel > 3)
  PRUEF(n == 0);
  const Lage g_neu = karte_neu("SET_NEU", neu, false, &n);
  PRUEF(!lage_haelt(g_neu));
  PRUEF(n == 0);
  ergebnis("dehner_karte_neu_vor_s_h");
}

// ------------------------------------------------------------------------------------------ Test 6
void test_allokation() {
#if ALLOC_ABFANG_VERFUEGBAR
  static Probe p(24, 0);
  Karte k(128.0, 0);
  PRUEF(k.rampe(4.0, 132.0, 4.0));
  const int64_t s_h = 4096;
  Lauf l({}, (int64_t)k.sample_at(16.0));
  l.s_h = s_h;
  // Positiv-Kontrolle: ein bewusstes malloc und ein new werden gezählt
  abfang_an();
  void* volatile pm = std::malloc(16);
  std::free(pm);
  int* volatile pn = new int(3);
  delete pn;
  const long kontrolle = abfang_aus();
  std::printf("  test6: Positiv-Kontrolle %ld Allokationen (Soll 2)\n", kontrolle);
  PRUEF(kontrolle == 2);
  // Ansatz, Lauf über die Rampe, zweiter Ansatz mitten im Lauf (Reserve-Weg), Leer-Epoche
  // Rubber Band 3.3.0: R3Stretcher::reset() ruft zweimal posix_memalign (64, 5456), gemessen mit gdb am 07.10.; reset
  // gehört zum Vorbereiten (Architektur 2) und läuft im Vorbereiter, nie im Arbeits-Thread. Erlaubt sind darum genau
  // diese 2 je Ansatz mit Band, 0 für die Leer-Epoche; alles darüber (z. B. die rund 31 000 späten Allokationen beim
  // ersten echten process, die das Anlegen vorwegnimmt) ist rot.
  constexpr long RESET_ALLOK = 2;
  long ansatz1 = 0, ansatz2 = 0, leer = 0, fuellen = 0;
  abfang_an();
  l.d->ansetzen(auftrag(&p, s_h, DehnerAnker{0.0, 0.0}, k, 1));
  ansatz1 = abfang_aus();
  const int64_t mitte = (int64_t)k.sample_at(6.0) / B * B;
  for (int64_t b = 0; b + B <= mitte; b += B) {
    abfang_an();
    l.d->fuelle_synchron();
    fuellen += abfang_aus();
    l.block(b, k, 1);
  }
  abfang_an();
  l.d->ansetzen(auftrag(&p, mitte + cdj::ANSATZ_FRIST, DehnerAnker{6.0, 6.0 * FPB}, k, 1));
  ansatz2 = abfang_aus();
  for (int64_t b = mitte; b + B <= (int64_t)l.L.size(); b += B) {
    abfang_an();
    l.d->fuelle_synchron();
    fuellen += abfang_aus();
    l.block(b, k, 1);
  }
  abfang_an();
  l.d->ansetzen(auftrag(nullptr, (int64_t)l.L.size(), DehnerAnker{}, k, 1));  // Leer-Epoche
  l.d->fuelle_synchron();
  leer = abfang_aus();
  std::printf("  test6: Allokationen in ansetzen %ld und %ld (je %ld aus R3 reset erlaubt), Leer-Epoche %ld, in "
              "fuelle_synchron %ld, quittiert %u\n", ansatz1, ansatz2, RESET_ALLOK, leer, fuellen, l.d->quittiert_e());
  PRUEF(ansatz1 == RESET_ALLOK);
  PRUEF(ansatz2 == RESET_ALLOK);
  PRUEF(leer == 0);
  PRUEF(fuellen == 0);
  PRUEF(l.d->quittiert_e() == 3);
  ergebnis("dehner_allokation");
#else
  std::printf("TEST dehner_allokation: UEBERSPRUNGEN (Sanitizer-Bau, kein Abfang)\n");
#endif
}

// ------------------------------------------------------------------------------------------ Test 7 (Prüfung F1)
// Vorbereiter und Arbeits-Thread in zwei echten Fäden, 2 s: der Vorbereiter ruft ansetzen() (und vorbereiter_schritt()
// mit steigender Generation) in Schleife, der Arbeits-Thread fuelle_synchron() und liest als Leser den Ring. Teilen sie
// einen Arbeitspuffer, meldet ThreadSanitizer das (Bau in djk/kern/build-tsan, Aufruf `setarch -R ./test_dehner
// faeden`); librubberband ist nicht instrumentiert, seine eigenen Zugriffe sieht TSan nur über memmove/memcpy.
// Ohne TSan prüft der Test den Ablauf: Ansätze angenommen, Thread quittiert die letzte Epoche, Ring hörbar.
struct SinusQuelle : cdj::DehnerQuelle {  // ohne Speicher und ohne Zustand: band() rechnet den Sinus am Frame
  void band(int64_t ab, int n, float* l, float* r) const noexcept override {
    for (int i = 0; i < n; ++i) l[i] = r[i] = (float)(0.5 * std::sin(2 * PI * 1000.0 * (double)(ab + i) / 48000.0));
  }
  double basis_bpm() const noexcept override { return 128.0; }
};

void test_zwei_faeden(double sekunden) {
  static SinusQuelle q;
  auto d = cdj::dehner_neu(1, {});
  const Karte k(132.0, 0);
  std::atomic<bool> ende{false};
  std::atomic<int64_t> s_jetzt{0};
  long bloecke = 0, hoerbar = 0;
  std::thread arbeiter([&] {
    float l[B], r[B];
    int64_t s = 0;
    while (!ende.load(std::memory_order_relaxed)) {
      cdj::KartenStand st;
      st.karte = k;
      st.generation = 1;
      st.s_jetzt = s;
      d->karte_veroeffentlichen(st);
      d->fuelle_synchron();
      cdj::StreckRing& ring = d->ring();
      ring.setze_epoche(d->epoche());
      const int64_t ab = ring.bereit_ab(s);
      if (ab == s && ring.lies(s, B, l, r)) ++hoerbar;
      ++bloecke;
      s += B;
      s_jetzt.store(s, std::memory_order_relaxed);
    }
  });
  long ansaetze = 0, besetzt = 0;
  uint32_t gen = 1, letzte = 0;
  const auto t_ende = std::chrono::steady_clock::now() + std::chrono::duration<double>(sekunden);
  while (std::chrono::steady_clock::now() < t_ende) {
    const int64_t s = s_jetzt.load(std::memory_order_relaxed);
    const int64_t s_h = s + cdj::ANSATZ_FRIST;
    const uint32_t e = d->ansetzen(auftrag(&q, s_h, DehnerAnker{k.beat_at((double)s_h), 0.0}, k, gen));
    if (e != cdj::EPOCHE_KEINE) {
      ++ansaetze;
      letzte = e;
    } else {
      ++besetzt;
    }
    cdj::KartenStand st;
    st.karte = k;
    st.generation = ++gen;  // neuere Generation vor s_h: interne Erneuerung im selben Faden
    st.s_jetzt = s;
    d->vorbereiter_schritt(st);
    letzte = d->epoche();  // die Erneuerung hat ggf. die nächste vergeben
    std::this_thread::sleep_for(std::chrono::milliseconds(1));
  }
  ende.store(true);
  arbeiter.join();
  d->fuelle_synchron();  // übernimmt einen noch wartenden Ansatz
  std::printf("  test7: %.1f s, Ansätze %ld (besetzt %ld), Erneuerungen %d, Blöcke %ld, hörbar %ld, epoche %u, "
              "quittiert %u, aufgefüllt kurz %llu zwang %llu\n",
              sekunden, ansaetze, besetzt, d->ansatz_erneuert(), bloecke, hoerbar, d->epoche(), d->quittiert_e(),
              (unsigned long long)d->auffuellen_kurz(), (unsigned long long)d->auffuellen_zwang());
  PRUEF(ansaetze > 100);
  PRUEF(d->ansatz_erneuert() > 100);
  PRUEF(d->quittiert_e() == d->epoche());
  PRUEF(d->epoche() == letzte);
  PRUEF(hoerbar > 0);
  ergebnis("dehner_zwei_faeden");
}

// ------------------------------------------------------------------------------------------ Test 8 (Prüfung F4)
// Der Dehner ist der einzige Vergeber der Epochen: ansetzen() gibt die vergebene zurück (ab 1, 0 = keine), die interne
// Erneuerung vergibt die nächste, ein späteres Ereignis der Quelle bekommt die übernächste (keine Kollision wie in der
// Prüfung P3: Deck zählte selbst, setzte nach der Erneuerung „seine“ 2 an und bekam „veraltet“). epoche() liefert die
// gültige Epoche für den Leser.
void test_epochen() {
  static Probe p(24, 0);
  const Karte k1(128.0, 0), k2(132.0, 0);
  auto d = cdj::dehner_neu(1, {});
  PRUEF(d->epoche() == cdj::EPOCHE_KEINE);
  PRUEF(d->quittiert_e() == cdj::EPOCHE_KEINE);
  const uint32_t e1 = d->ansetzen(auftrag(&p, 4096, DehnerAnker{}, k1, 1));
  PRUEF(e1 == 1);
  PRUEF(d->epoche() == 1);
  d->fuelle_synchron();
  PRUEF(d->quittiert_e() == 1);
  cdj::KartenStand st;
  st.karte = k2;
  st.generation = 2;
  st.s_jetzt = B;
  d->vorbereiter_schritt(st);
  PRUEF(d->ansatz_erneuert() == 1);
  PRUEF(d->epoche() == 2);
  const uint32_t e3 = d->ansetzen(auftrag(&p, 8192, DehnerAnker{}, k2, 2));  // Ereignis der Quelle nach der Erneuerung
  std::printf("  test8: ansetzen %u, nach Erneuerung epoche() %u, Ereignis danach %u, epoche() %u\n", e1, 2u, e3,
              d->epoche());
  PRUEF(e3 == 3);
  PRUEF(d->epoche() == 3);
  d->fuelle_synchron();
  PRUEF(d->quittiert_e() == 3);
  ergebnis("dehner_epochen");
}

// ------------------------------------------------------------------------------------------ Test 9 (Prüfung F5)
// Erneuert wird nur bei NEUERER Generation. Ansatz mit frischer Karte (Generation 5), der Vorbereiter sieht noch den
// Stand mit Generation 4 (älter) und dann 5 (gleich): keine Erneuerung. Positiv-Kontrolle: Generation 6 erneuert.
void test_stand_veraltet() {
  static Probe p(24, 0);
  const Karte alt(128.0, 0), neu(132.0, 0);
  auto d = cdj::dehner_neu(1, {});
  PRUEF(d->ansetzen(auftrag(&p, 4096, DehnerAnker{}, neu, 5)) == 1);
  d->fuelle_synchron();
  cdj::KartenStand st;
  st.karte = alt;
  st.generation = 4;
  st.s_jetzt = B;
  d->vorbereiter_schritt(st);
  const int nach4 = d->ansatz_erneuert();
  st.generation = 5;
  d->vorbereiter_schritt(st);
  const int nach5 = d->ansatz_erneuert();
  const uint32_t e = d->epoche();
  st.karte = neu;
  st.generation = 6;
  d->vorbereiter_schritt(st);
  std::printf("  test9: Stand g4 nach Ansatz g5: erneuert %d, g5: %d, epoche %u; g6 (Kontrolle): erneuert %d, epoche %u\n",
              nach4, nach5, e, d->ansatz_erneuert(), d->epoche());
  PRUEF(nach4 == 0);
  PRUEF(nach5 == 0);
  PRUEF(e == 1);
  PRUEF(d->ansatz_erneuert() == 1);
  PRUEF(d->epoche() == 2);
  ergebnis("dehner_stand_veraltet");
}

// ------------------------------------------------------------------------------------------ Test 10 (Prüfung F2)
// Kurze Rampen mit der Vorhalt-Vorgabe (2400 Samples, 50 ms): 128 -> 132 über 4, 8, 16 Beats ab Beat 8 und die Folge
// 128 -> 132 -> 126 -> 134 -> 128 (je 8 Beats Rampe, 8 Beats Halt), Lage (a) und (b). Ohne Vorhalt (früher Vorgabe 0)
// lag das Mittel bei +30,5 (4 Beats), +26,9 (8), +16,7 (16) und +9,9 (Folge) (task-01-fix/f3b_roh_prototyp.txt).
// Dokumentierte Grenze, kein Prüffall: Rampen über 1 und 2 Beats, Vorhalt 2400 (Fix-Runde 07.10.,
// task-01-fix/gruen_test_dehner.txt, Zeilen „Grenze“):
//   Rampe ab Beat 8 (Ansatz davor):        1 Beat  (a) −0,49  (b) 2,02  max |Lage| 10,65
//                                          2 Beats (a) −0,64  (b) 1,03  max |Lage|  6,37
//   Ansatz IN der Rampe (ab Beat 0,02):    1 Beat  (a) −18,08 (b) 1,04  max |Lage| 41,05
//                                          2 Beats (a) −7,29  (b) 2,00  max |Lage| 23,54
// (b) hält überall (der Dehner fügt R3 nichts hinzu); (a) reißt, wenn der Ansatz in eine Rampe von 1 oder 2 Beats fällt.
Lage kurze_rampe(const Karte& k, int q1, int64_t s_h = 4096) {
  static Probe p(100, 0);
  const DehnerAnker a{0.0, 0.0};
  Lauf l({}, (int64_t)k.sample_at((double)q1 + 2.0));
  l.s_h = s_h;
  PRUEF(l.d->ansetzen(auftrag(&p, s_h, a, k, 1)) != cdj::EPOCHE_KEINE);
  l.bis((int64_t)l.L.size(), k, 1);
  PRUEF(l.unterlauf == 0);
  return lage_messen(l, p, k, k, a, 1, q1);
}

void test_kurze_rampen() {
  for (double beats : {4.0, 8.0, 16.0}) {
    Karte k(128.0, 0);
    PRUEF(k.rampe(8.0, 132.0, beats));
    const int q1 = (int)(8 + beats + 16);
    char nm[96];
    std::snprintf(nm, sizeof nm, "test10 Rampe 128 -> 132 über %.0f Beats ab 8", beats);
    lage_pruefen(nm, kurze_rampe(k, q1), q1 - 1);
  }
  Karte f(128.0, 0);
  PRUEF(f.rampe(8.0, 132.0, 8.0));
  PRUEF(f.rampe(24.0, 126.0, 8.0));
  PRUEF(f.rampe(40.0, 134.0, 8.0));
  PRUEF(f.rampe(56.0, 128.0, 8.0));
  lage_pruefen("test10 Folge 128 -> 132 -> 126 -> 134 -> 128 je 8 Beats", kurze_rampe(f, 80), 79);
  // Grenze (nur gemessen)
  for (double beats : {1.0, 2.0}) {
    Karte k(128.0, 0);
    PRUEF(k.rampe(8.0, 132.0, beats));
    char nm[96];
    std::snprintf(nm, sizeof nm, "test10 Grenze: Rampe %.0f Beat(s) ab 8", beats);
    lage_drucken(nm, kurze_rampe(k, (int)(8 + beats + 16)));
    Karte kin(128.0, 0);
    PRUEF(kin.rampe(0.02, 132.0, beats));
    std::snprintf(nm, sizeof nm, "test10 Grenze: Ansatz in der Rampe %.0f Beat(s) ab 0,02", beats);
    lage_drucken(nm, kurze_rampe(kin, 24));
  }
  ergebnis("dehner_kurze_rampen");
}

// ------------------------------------------------------------------------------------------ Test 11 (Prüfung F3)
// Konstante Tempi über den Bereich der Versatz-Tabelle, Band-Start auf Quell-Beat 4, 64 Klicks: Lage (a) und (b).
void test_versatz_bereich() {
  static Probe p(80, 0);
  for (double bpm : {96.0, 110.0, 120.0, 128.0, 132.0, 140.0, 150.0, 160.0, 170.0}) {
    const Karte k(bpm, 0);
    const int64_t s_h = 4096;
    const DehnerAnker a{k.beat_at((double)s_h), 4 * FPB};
    Lauf l({}, (int64_t)k.sample_at(a.b + 66.0));
    l.s_h = s_h;
    PRUEF(l.d->ansetzen(auftrag(&p, s_h, a, k, 1)) != cdj::EPOCHE_KEINE);
    l.bis((int64_t)l.L.size(), k, 1);
    PRUEF(l.unterlauf == 0);
    char nm[64];
    std::snprintf(nm, sizeof nm, "test11 konstant %.0f BPM (Faktor %.4f)", bpm, bpm / 128.0);
    lage_pruefen(nm, lage_messen(l, p, k, k, a, 4, 68), 64, false);
  }
  ergebnis("dehner_versatz_bereich");
}

// ------------------------------------------------------------------------------------------ Test 12 (Bedenken 1, Task 1c)
// Der Regler muss aus dem Totband, wenn der Ansatz mitten in eine laufende Rampe fällt (Vorhalt-Vorgabe 2400). Rampe
// 128 -> 136 ab Beat 4: über 8 Beats mit Ansatz auf Beat 10 (75 %) und über 16 Beats mit Ansatz auf Beat 12 (50 %);
// Klicks ab dem ersten vollen Beat nach dem Ansatz bis 16 Beats nach der Rampe. Gemessen (task-01-fix/
// f1c_regler_sweep.txt): mit Regler (a) −1,56 / +0,18, ohne Regler (Mutation) −8,03 / −4,61.
void test_regler_in_rampe() {
  static Probe p(100, 0);
  const DehnerAnker a{0.0, 0.0};
  const struct { double dauer, ansatz_beat; } faelle[] = {{8.0, 10.0}, {16.0, 12.0}};
  for (const auto& f : faelle) {
    Karte k(128.0, 0);
    PRUEF(k.rampe(4.0, 136.0, f.dauer));
    const int64_t s_h = (int64_t)k.sample_at(f.ansatz_beat);
    const int q0 = (int)f.ansatz_beat + 1, q1 = (int)(4.0 + f.dauer + 16.0);
    Lauf l({}, (int64_t)k.sample_at((double)q1 + 2.0));
    l.s_h = s_h;
    PRUEF(l.d->ansetzen(auftrag(&p, s_h, a, k, 1)) != cdj::EPOCHE_KEINE);
    l.bis((int64_t)l.L.size(), k, 1);
    PRUEF(l.unterlauf == 0);
    char nm[96];
    std::snprintf(nm, sizeof nm, "test12 Rampe 128 -> 136 über %.0f Beats ab 4, Ansatz auf Beat %.0f", f.dauer,
                  f.ansatz_beat);
    const Lage m = lage_messen(l, p, k, k, a, q0, q1);
    lage_pruefen(nm, m, q1 - q0, false);
    // Keylock 4.6b: tragend gegen das Ideal gleicher Klickform: das Mittel, das derselbe Dehner bei festem Tempo im
    // Faktor des Ansatzes zeigt (R3-eigene Lage des Hann-Klicks, Versatz 0). Regler aus oder falsch gepolt reißt das.
    const double ideal = einmessen(l.f.at(0) * 128.0, false);
    std::printf("    test12: Faktor am Ansatz %.6f, Ideal gleicher Klickform %+.2f, Mittel − Ideal %+.2f (Grenze ±3)\n", l.f.at(0),
                ideal, m.mittel - ideal);
    PRUEF_NAH(m.mittel - ideal, 0.0, 3.0);
  }
  ergebnis("dehner_regler_in_rampe");
}

// ================================================================================== Task 6b: W-Tests (Dehner-Wechsel)
// Plan Task 6, Abschnitte 3.2 (Wechsel), 3.7 (Gegenwechsel, Zonen 1 bis 3) und 7 (W1a bis W5). Regel für alle W-Tests außer
// W1a (Prüfung MAJOR 5): das Neuband weicht ab p_gleich_bis vom Altband ab (Sinus 1000 Hz um eine halbe Periode = 24 Frames
// versetzt), sonst sähe der Test eine falsch oder zu spät angenommene Umschaltung nicht.
// Aufbau W1a bis W4: Karte 132 konstant, Ansatz bei s_h = 4096 auf Quell-Beat 4, Dehner synchron (Lauf); der Auftrag wird vor
// dem Block W_B gestellt (dort ruft block() danach fuelle_synchron, also liest der Thread ihn im selben Block). Ziel s_t =
// W_B + PLAN_VORLAUF(f) + 2048 (Plan 3.2: ⌈3686 + 2176/f⌉), p_sw = kopf(s_t), p_gleich_bis = p_sw − 128 (Blende vor dem Ziel).
constexpr int64_t W_HALB = 24;  // halbe Periode von 1000 Hz bei 48 kHz
constexpr int64_t W_B = 48000 / B * B;  // Block, vor dem der Auftrag gestellt wird (rund 1 s nach s_h)
constexpr int64_t W_LAENGE = 3 * 48000;

// Band mit Wechselstelle: vor ab das Grundband, ab ab dasselbe um versatz verschoben (das PlanBand aus Plan 3.3 im Kleinen)
struct WechselBand : cdj::DehnerQuelle {
  const cdj::DehnerQuelle* grund;
  int64_t ab, versatz;
  WechselBand(const cdj::DehnerQuelle* g, int64_t a, int64_t v) : grund(g), ab(a), versatz(v) {}
  void band(int64_t p, int n, float* l, float* r) const noexcept override {
    int i = 0;
    if (p < ab) {
      i = (int)std::min<int64_t>(n, ab - p);
      grund->band(p, i, l, r);
    }
    if (i < n) grund->band(p + i + versatz, n - i, l + i, r + i);
  }
  double basis_bpm() const noexcept override { return grund->basis_bpm(); }
};

struct WFall {
  const Karte k{132.0, 0};
  const int64_t s_h = 4096;
  const DehnerAnker a{k.beat_at(4096.0), 4 * FPB};
  double kopf(int64_t s) const { return a.f + (k.beat_at((double)s) - a.b) * FPB; }
  int64_t sample_von(double p) const { return (int64_t)std::ceil(k.sample_at(a.b + (p - a.f) / FPB)); }
  int64_t plan_vorlauf() const { return (int64_t)std::ceil(3686.0 + 2176.0 / (132.0 / 128.0)); }
  int64_t s_t() const { return W_B + plan_vorlauf() + 2048; }
  int64_t pgb() const { return (int64_t)std::floor(kopf(s_t())) - 128; }
};

// Ein Lauf über W_LAENGE; vor jedem Block ruft er haken(l, b) (dort stellt der Test seine Aufträge).
template <class H>
Lauf w_lauf(const WFall& w, const cdj::DehnerQuelle* q, H&& haken) {
  Lauf l({}, W_LAENGE);
  l.s_h = w.s_h;
  PRUEF(l.d->ansetzen(auftrag(q, w.s_h, w.a, w.k, 1)) == 1);
  for (int64_t b = 0; b + B <= W_LAENGE; b += B) {
    haken(l, b);
    l.block(b, w.k, 1);
  }
  return l;
}
Lauf w_lauf(const WFall& w, const cdj::DehnerQuelle* q) {
  return w_lauf(w, q, [](Lauf&, int64_t) {});
}
cdj::WechselAuftrag w_auftrag(uint32_t epoche, const cdj::DehnerQuelle* neu, int64_t pgb) {
  cdj::WechselAuftrag x;
  x.epoche = epoche;
  x.neu = neu;
  x.p_gleich_bis = pgb;
  return x;
}
int64_t erster_unterschied(const std::vector<float>& x, const std::vector<float>& y) {
  for (size_t i = 0; i < std::min(x.size(), y.size()); ++i)
    if (x[i] != y[i]) return (int64_t)i;
  return -1;
}
int64_t ungleich(const std::vector<float>& x, const std::vector<float>& y) {
  int64_t n = 0;
  for (size_t i = 0; i < std::min(x.size(), y.size()); ++i) n += x[i] != y[i];
  return n + (int64_t)(std::max(x.size(), y.size()) - std::min(x.size(), y.size()));
}
void w_zaehler(const char* name, const DehnerBasis& d) {
  std::printf("  %s: gelesen %u, verfehlt %u, angenommen %llu, verfehlt_n %llu, ueberschrieben %llu\n", name,
              d.wechsel_gelesen(), d.wechsel_verfehlt(), (unsigned long long)d.wechsel_n_angenommen(),
              (unsigned long long)d.wechsel_n_verfehlt(), (unsigned long long)d.wechsel_ueberschrieben());
}

// Einspeisung vor dem Block b im Lauf ohne Auftrag (deterministisch: hängt nicht vom Bandinhalt ab)
int64_t w_einspeisung_vor(const WFall& w, const cdj::DehnerQuelle* q, int64_t b_ziel) {
  int64_t e = -1;
  w_lauf(w, q, [&](Lauf& l, int64_t b) {
    if (b == b_ziel) e = l.d->einspeisung_bis();
  });
  return e;
}

// ------------------------------------------------------------------------------------------ W1a
// Wechsel auf ein inhaltsgleiches Band (andere Quelle, gleiche Daten): Ring bitgleich zum Lauf ohne Wechsel, gelesen = 1.
// Prüft nur „keine Störung“, nicht „Neuband gelesen“ (das ist W1b).
void test_w1a_wechsel_nahtlos() {
  static Probe p(20, 1);
  static const Probe p2 = p;
  const WFall w;
  const Lauf ohne = w_lauf(w, &p);
  uint32_t nr = 0;
  const Lauf mit = w_lauf(w, &p, [&](Lauf& l, int64_t b) {
    if (b == W_B) nr = l.d->wechsel(w_auftrag(l.d->epoche(), &p2, w.pgb()));
  });
  w_zaehler("W1a", *mit.d);
  const int64_t n = ungleich(ohne.L, mit.L);
  std::printf("  W1a: nr %u, Ring gegen Lauf ohne Wechsel: %lld von %zu Samples ungleich, Unterläufe %d\n", nr, (long long)n,
              mit.L.size(), mit.unterlauf);
  PRUEF(nr == 1);
  PRUEF(mit.d->wechsel_gelesen() == 1);
  PRUEF(mit.d->wechsel_n_angenommen() == 1);
  PRUEF(mit.d->wechsel_n_verfehlt() == 0);
  PRUEF(n == 0);
  PRUEF(mit.unterlauf == 0);
  ergebnis("W1a_wechsel_nahtlos");
}

// ------------------------------------------------------------------------------------------ W1b
// Wechsel auf ein Neuband, das ab p_gleich_bis um eine halbe Periode abweicht. Tragend: (1) Ring bitgleich zum Lauf, der das
// Neuband von Anfang an hat (R3 hat dieselbe Eingabe bekommen, also ist der Wechsel verlustfrei und vollständig); (2) vor
// der Wirkstelle bitgleich zum Lauf ohne Wechsel, danach verschieden; (3) ab p_gleich_bis + R3-Latenz gleich rohem R3 des
// Neubands gleicher Speisung (Korrelation >= 0,999, Lage ±0), der Lauf ohne Wechsel dort gegenphasig (Gegenprobe).
// Mutation DEHNER_WECHSEL_ZAEHLT_NUR (Atom zählt, die Quelle bleibt): (1) und (3) rot.
void test_w1b_wechsel_neues_band() {
  static Probe p(20, 1);
  const WFall w;
  const WechselBand neu(&p, w.pgb(), W_HALB);
  const Lauf ohne = w_lauf(w, &p);
  const Lauf ref = w_lauf(w, &neu);
  const Lauf mit = w_lauf(w, &p, [&](Lauf& l, int64_t b) {
    if (b == W_B) l.d->wechsel(w_auftrag(l.d->epoche(), &neu, w.pgb()));
  });
  w_zaehler("W1b", *mit.d);
  const int64_t s_pgb = w.sample_von((double)w.pgb());
  const int64_t d1 = erster_unterschied(ohne.L, mit.L);
  const int64_t n_ref = ungleich(ref.L, mit.L);
  std::printf("  W1b: s_t %lld, p_gleich_bis %lld (Ausgabe-Sample %lld); erster Unterschied zu ohne Wechsel bei %lld "
              "(%+lld gegen p_gleich_bis); gegen Neuband von Anfang %lld ungleich\n",
              (long long)w.s_t(), (long long)w.pgb(), (long long)s_pgb, (long long)d1, (long long)(d1 - s_pgb),
              (long long)n_ref);
  PRUEF(mit.d->wechsel_gelesen() == 1);
  PRUEF(n_ref == 0);
  PRUEF(d1 > W_B);              // nichts vor dem Auftrag gestört
  PRUEF(d1 >= s_pgb - 4096);    // R3-Fenster: die Abweichung wirkt frühestens ein Analysefenster vor p_gleich_bis
  PRUEF(d1 > 0 && d1 < s_pgb + 8192);
  // (3) rohes R3 des Neubands, gleiche Faktorfolge, gleicher Band-Start
  const int64_t p0 = km::band_start(w.k, w.a, w.s_h, mit.f.at(0));
  const std::vector<float> R = r3_roh(neu, p0, mit.f, w.s_h, W_LAENGE);
  const int64_t a0 = s_pgb + 4096, a1 = W_LAENGE - 4096;
  auto korr = [&](const std::vector<float>& x, int lag) {
    double xy = 0, xx = 0, yy = 0;
    for (int64_t s = a0; s < a1; ++s) {
      const double u = x[(size_t)s], v = R[(size_t)(s + lag)];
      xy += u * v;
      xx += u * u;
      yy += v * v;
    }
    return xy / std::sqrt(xx * yy + 1e-30);
  };
  int best = 0;
  double kb = -2;
  for (int lag = -48; lag <= 48; ++lag) {
    const double c = korr(mit.L, lag);
    if (c > kb) {
      kb = c;
      best = lag;
    }
  }
  const double k0 = korr(mit.L, 0), k_ohne = korr(ohne.L, 0);
  std::printf("  W1b: gegen rohes R3 des Neubands in [%lld, %lld): Korrelation %.6f bei Lage 0, bestes Lag %d (%.6f); "
              "Lauf ohne Wechsel dort %.6f (Gegenprobe)\n", (long long)a0, (long long)a1, k0, best, kb, k_ohne);
  PRUEF(k0 >= 0.999);
  PRUEF(best == 0);
  PRUEF(k_ohne < 0.0);
  PRUEF(mit.unterlauf == 0);
  ergebnis("W1b_wechsel_neues_band");
}

// ------------------------------------------------------------------------------------------ W2
// Zu spät: p_gleich_bis eine Stelle HINTER der Einspeisung (das Neuband weicht ab dort ab). verfehlt = nr, nichts geändert
// (bitgleich zum Lauf ohne Wechsel). Grenze: p_gleich_bis GLEICH der Einspeisung wird angenommen und ist bitgleich zum
// Lauf mit dem Neuband von Anfang (R3 hat noch keinen Frame >= p_gleich_bis). Mutation PLAN_WECHSEL_SPAET_ANNEHMEN rot.
void test_w2_wechsel_zu_spaet() {
  static Probe p(20, 1);
  const WFall w;
  const int64_t e = w_einspeisung_vor(w, &p, W_B);
  const WechselBand spaet(&p, e - 1, W_HALB), grenze(&p, e, W_HALB);
  const Lauf ohne = w_lauf(w, &p);
  uint32_t nr = 0;
  const Lauf mit = w_lauf(w, &p, [&](Lauf& l, int64_t b) {
    if (b == W_B) {
      PRUEF(l.d->einspeisung_bis() == e);
      nr = l.d->wechsel(w_auftrag(l.d->epoche(), &spaet, e - 1));
    }
  });
  w_zaehler("W2 zu spät", *mit.d);
  const int64_t n = ungleich(ohne.L, mit.L);
  std::printf("  W2: Einspeisung vor dem Block %lld: %lld (Kopf dort %.1f, Vorsprung %.0f Quellframes); p_gleich_bis %lld: "
              "%lld Samples ungleich zum Lauf ohne Wechsel\n", (long long)W_B, (long long)e, w.kopf(W_B), (double)e - w.kopf(W_B),
              (long long)(e - 1), (long long)n);
  PRUEF(nr == 1);
  PRUEF(mit.d->wechsel_verfehlt() == 1);
  PRUEF(mit.d->wechsel_gelesen() == 0);
  PRUEF(mit.d->wechsel_n_verfehlt() == 1);
  PRUEF(mit.d->wechsel_n_angenommen() == 0);
  PRUEF(n == 0);
  // Grenze
  const Lauf ref = w_lauf(w, &grenze);
  const Lauf an = w_lauf(w, &p, [&](Lauf& l, int64_t b) {
    if (b == W_B) l.d->wechsel(w_auftrag(l.d->epoche(), &grenze, e));
  });
  w_zaehler("W2 Grenze", *an.d);
  const int64_t n_ref = ungleich(ref.L, an.L), n_ohne = ungleich(ohne.L, an.L);
  std::printf("  W2 Grenze p_gleich_bis = Einspeisung %lld: gegen Neuband von Anfang %lld ungleich, gegen ohne %lld ungleich\n",
              (long long)e, (long long)n_ref, (long long)n_ohne);
  PRUEF(an.d->wechsel_gelesen() == 1);
  PRUEF(n_ref == 0);
  PRUEF(n_ohne > 0);
  ergebnis("W2_wechsel_zu_spaet");
}

// ------------------------------------------------------------------------------------------ W3
// Auftrag für eine ältere Epoche: zweiter Ansatz (Epoche 2, gleiches Band, gleicher Anker) vor dem Auftrag; der Auftrag
// nennt Epoche 1. verfehlt, Ring bitgleich zum Lauf mit beiden Ansätzen ohne Auftrag. Kontrolle: Epoche 2 wird angenommen.
void test_w3_wechsel_falsche_epoche() {
  static Probe p(20, 1);
  const WFall w;
  const WechselBand neu(&p, w.pgb(), W_HALB);
  const int64_t b_ans = 24000 / B * B;
  auto zweiter = [&](Lauf& l, int64_t b) {
    if (b == b_ans) PRUEF(l.d->ansetzen(auftrag(&p, b + cdj::ANSATZ_FRIST, w.a, w.k, 1)) == 2);
  };
  const Lauf ohne = w_lauf(w, &p, zweiter);
  uint32_t ep_alt = 0, quitt = 0;
  const Lauf alt = w_lauf(w, &p, [&](Lauf& l, int64_t b) {
    zweiter(l, b);
    if (b == W_B) {
      quitt = l.d->quittiert_e();
      ep_alt = l.d->epoche() - 1;
      l.d->wechsel(w_auftrag(ep_alt, &neu, w.pgb()));
    }
  });
  w_zaehler("W3 alte Epoche", *alt.d);
  const int64_t n = ungleich(ohne.L, alt.L);
  std::printf("  W3: Auftrag für Epoche %u (quittiert %u): %lld Samples ungleich zum Lauf ohne Auftrag\n", ep_alt, quitt,
              (long long)n);
  PRUEF(quitt == 2);
  PRUEF(ep_alt == 1);
  PRUEF(alt.d->wechsel_verfehlt() == 1);
  PRUEF(alt.d->wechsel_gelesen() == 0);
  PRUEF(n == 0);
  const Lauf kontrolle = w_lauf(w, &p, [&](Lauf& l, int64_t b) {
    zweiter(l, b);
    if (b == W_B) l.d->wechsel(w_auftrag(l.d->epoche(), &neu, w.pgb()));
  });
  w_zaehler("W3 Kontrolle Epoche 2", *kontrolle.d);
  PRUEF(kontrolle.d->wechsel_gelesen() == 1);
  PRUEF(ungleich(ohne.L, kontrolle.L) > 0);
  // Fix-Runde W2 (Prüfung S1): Auftrag für die GERADE angesetzte, noch wartende Epoche 2 (ansetzen, wechsel(epoche()), dann erst
  // fuelle_synchron): angenommen, weil der Thread erst übernimmt und dann holt. Mutation DEHNER_WECHSEL_VOR_UEBERNEHMEN
  // (holen vor übernehmen, Prüfung X3) verfehlt ihn.
  uint32_t ep_wartend = 0, quitt_vor = 0;
  const Lauf wartend = w_lauf(w, &p, [&](Lauf& l, int64_t b) {
    if (b == b_ans) {
      PRUEF(l.d->ansetzen(auftrag(&p, b + cdj::ANSATZ_FRIST, w.a, w.k, 1)) == 2);
      quitt_vor = l.d->quittiert_e();
      ep_wartend = l.d->epoche();
      l.d->wechsel(w_auftrag(ep_wartend, &neu, w.pgb()));
    }
  });
  w_zaehler("W3 wartende Epoche", *wartend.d);
  std::printf("  W3: Auftrag für die wartende Epoche %u (quittiert vor dem Füllen %u): gelesen %u, verfehlt %u\n", ep_wartend,
              quitt_vor, wartend.d->wechsel_gelesen(), wartend.d->wechsel_verfehlt());
  PRUEF(quitt_vor == 1);
  PRUEF(ep_wartend == 2);
  PRUEF(wartend.d->wechsel_gelesen() == 1);
  PRUEF(wartend.d->wechsel_verfehlt() == 0);
  ergebnis("W3_wechsel_falsche_epoche");
}

// ------------------------------------------------------------------------------------------ W3b
// Gegenwechsel (Plan 3.7): (a) Zone 2: Wechsel angenommen, Gegenwechsel (neu = Altband, gleiches p_gleich_bis) 4 Blöcke
// später, Einspeisung noch <= p_gleich_bis: angenommen, Ring bitgleich zum Lauf ohne beide. (b) Zone 3: Gegenwechsel, wenn
// die Einspeisung schon hinter p_gleich_bis liegt: verfehlt, Ring folgt dem Neuband (bitgleich zum Lauf nur mit dem
// Wechsel). (c) Zone 1: Wechsel und Gegenwechsel vor demselben Lesen: der Wechsel wird überschrieben, Ring bitgleich ohne.
void test_w3b_gegenwechsel() {
  static Probe p(20, 1);
  const WFall w;
  const WechselBand neu(&p, w.pgb(), W_HALB);
  const Lauf ohne = w_lauf(w, &p);
  const Lauf nur_w = w_lauf(w, &p, [&](Lauf& l, int64_t b) {
    if (b == W_B) l.d->wechsel(w_auftrag(l.d->epoche(), &neu, w.pgb()));
  });
  // Block für Zone 3: der erste, vor dem die Einspeisung hinter p_gleich_bis liegt
  int64_t b3 = -1;
  w_lauf(w, &p, [&](Lauf& l, int64_t b) {
    if (b3 < 0 && b > W_B && l.d->einspeisung_bis() > w.pgb()) b3 = b;
  });
  int64_t e_a = -1, e_b = -1;
  const Lauf zone2 = w_lauf(w, &p, [&](Lauf& l, int64_t b) {
    if (b == W_B) l.d->wechsel(w_auftrag(l.d->epoche(), &neu, w.pgb()));
    if (b == W_B + 4 * B) {
      e_a = l.d->einspeisung_bis();
      l.d->wechsel(w_auftrag(l.d->epoche(), &p, w.pgb()));
    }
  });
  w_zaehler("W3b Zone 2", *zone2.d);
  const Lauf zone3 = w_lauf(w, &p, [&](Lauf& l, int64_t b) {
    if (b == W_B) l.d->wechsel(w_auftrag(l.d->epoche(), &neu, w.pgb()));
    if (b == b3) {
      e_b = l.d->einspeisung_bis();
      l.d->wechsel(w_auftrag(l.d->epoche(), &p, w.pgb()));
    }
  });
  w_zaehler("W3b Zone 3", *zone3.d);
  const Lauf zone1 = w_lauf(w, &p, [&](Lauf& l, int64_t b) {
    if (b == W_B) {
      l.d->wechsel(w_auftrag(l.d->epoche(), &neu, w.pgb()));
      l.d->wechsel(w_auftrag(l.d->epoche(), &p, w.pgb()));
    }
  });
  w_zaehler("W3b Zone 1", *zone1.d);
  const int64_t n2 = ungleich(ohne.L, zone2.L), n3 = ungleich(nur_w.L, zone3.L), n3o = ungleich(ohne.L, zone3.L),
                n1 = ungleich(ohne.L, zone1.L);
  std::printf("  W3b: p_gleich_bis %lld; Zone 2 Gegenwechsel vor Block %lld bei Einspeisung %lld: %lld ungleich zu ohne; "
              "Zone 3 vor Block %lld (Ziel %lld, %lld Samples davor) bei Einspeisung %lld: %lld ungleich zu nur Wechsel, %lld zu "
              "ohne; Zone 1: %lld ungleich zu ohne\n",
              (long long)w.pgb(), (long long)(W_B + 4 * B), (long long)e_a, (long long)n2, (long long)b3, (long long)w.s_t(),
              (long long)(w.s_t() - b3), (long long)e_b, (long long)n3, (long long)n3o, (long long)n1);
  PRUEF(e_a >= 0 && e_a <= w.pgb());
  PRUEF(zone2.d->wechsel_gelesen() == 2);
  PRUEF(zone2.d->wechsel_n_angenommen() == 2);
  PRUEF(n2 == 0);
  PRUEF(b3 > W_B + 4 * B && e_b > w.pgb());
  PRUEF(zone3.d->wechsel_gelesen() == 1);
  PRUEF(zone3.d->wechsel_verfehlt() == 2);
  PRUEF(n3 == 0);
  PRUEF(n3o > 0);
  PRUEF(zone1.d->wechsel_ueberschrieben() == 1);
  PRUEF(zone1.d->wechsel_gelesen() == 2);
  PRUEF(zone1.d->wechsel_n_angenommen() == 1);
  PRUEF(n1 == 0);
  ergebnis("W3b_gegenwechsel");
}

// ------------------------------------------------------------------------------------------ W4
// 0 Allokationen in wechsel() (Callback) und fuelle_synchron() (Thread) mit Wechsel, Gegenwechsel, zu spätem und
// überschriebenem Auftrag; Positiv-Kontrolle des Abfangs.
void test_w4_wechsel_allokation() {
#if ALLOC_ABFANG_VERFUEGBAR
  static Probe p(20, 1);
  const WFall w;
  const WechselBand neu(&p, w.pgb(), W_HALB);
  abfang_an();
  void* volatile pm = std::malloc(16);
  std::free(pm);
  int* volatile pn = new int(3);
  delete pn;
  const long kontrolle = abfang_aus();
  long im_wechsel = 0, im_fuellen = 0;
  int gestellt = 0;
  auto stelle = [&](Lauf& l, const cdj::DehnerQuelle* q, int64_t pgb) {
    const uint32_t ep = l.d->epoche();
    abfang_an();
    l.d->wechsel(w_auftrag(ep, q, pgb));
    im_wechsel += abfang_aus();
    ++gestellt;
  };
  const Lauf l = w_lauf(w, &p, [&](Lauf& l, int64_t b) {
    if (b == W_B) stelle(l, &neu, w.pgb());
    if (b == W_B + 4 * B) stelle(l, &p, w.pgb());                      // Gegenwechsel, Zone 2
    if (b == W_B + 64 * B) stelle(l, &neu, l.d->einspeisung_bis() - 1);  // zu spät
    if (b == W_B + 80 * B) {                                             // überschrieben
      stelle(l, &neu, w.pgb());
      stelle(l, &p, w.pgb());
    }
    abfang_an();
    l.d->fuelle_synchron();
    im_fuellen += abfang_aus();
  });
  w_zaehler("W4", *l.d);
  std::printf("  W4: Positiv-Kontrolle %ld (Soll 2); Allokationen in wechsel() %ld bei %d Aufträgen, in fuelle_synchron %ld\n",
              kontrolle, im_wechsel, gestellt, im_fuellen);
  PRUEF(kontrolle == 2);
  PRUEF(gestellt == 5);
  PRUEF(l.d->wechsel_n_angenommen() + l.d->wechsel_n_verfehlt() + l.d->wechsel_ueberschrieben() == 5);
  PRUEF(im_wechsel == 0);
  PRUEF(im_fuellen == 0);
  ergebnis("W4_wechsel_allokation");
#else
  std::printf("TEST W4_wechsel_allokation: UEBERSPRUNGEN (Sanitizer-Bau, kein Abfang)\n");
#endif
}

// ------------------------------------------------------------------------------------------ W5
// Echte Fäden (für TSan: `setarch -R ./test_dehner wechsel_faeden 300` im TSan-Bau): Callback (dieser Faden, 1-ms-Takt, je
// Takt 256 Samples: Karte, Ring lesen, Aufträge in Zufallsfolge), Arbeits-Thread (fuelle_synchron je Takt, zweimal),
// Vorbereiter (neuer Ansatz alle 30 ms, damit Aufträge auch die alte Epoche treffen). Aufträge: Ziel 0 bis 12 000 Samples
// voraus (angenommen oder zu spät), jeder zehnte für die Vorgänger-Epoche, jeder fünfte sofort von einem zweiten gefolgt
// (Überschreiben). Die Bänder leben über den ganzen Test (die Lebensdauer im Deck ist Sache der Leihe, Plan 3.6).
// Grenze: Zähler summieren sich (angenommen + verfehlt + überschrieben = gestellt), die zuletzt gelesene Nummer ist die
// zuletzt gestellte, alle drei Wege kamen vor; unter TSan kein Befund.
void test_w5_wechsel_faeden(int auftraege) {
  static SinusQuelle q0;
  static std::vector<std::unique_ptr<WechselBand>> pool;
  if (pool.empty())
    for (int i = 0; i < 8; ++i) pool.push_back(std::make_unique<WechselBand>(&q0, 0, (int64_t)i * 7));
  auto d = cdj::dehner_neu(1, {});
  const Karte k(132.0, 0);
  const DehnerAnker a{0.0, 0.0};
  PRUEF(d->ansetzen(auftrag(pool[0].get(), 4096, a, k, 1)) == 1);
  d->fuelle_synchron();
  std::atomic<bool> ende{false};
  std::atomic<uint64_t> takt{0};
  std::atomic<int64_t> s_jetzt{0};
  std::thread arbeiter([&] {
    uint64_t gesehen = 0;
    while (!ende.load(std::memory_order_acquire)) {
      const uint64_t t = takt.load(std::memory_order_acquire);
      if (t == gesehen) {
        std::this_thread::sleep_for(std::chrono::microseconds(100));
        continue;
      }
      gesehen = t;
      d->fuelle_synchron();
      d->fuelle_synchron();
    }
  });
  std::atomic<long> ansaetze{0};
  // Fix-Runde W2 (Q1): der Vorbereiter erneuert jeden Ansatz einmal vor s_h (neuere Generation), damit die Rückmeldung der
  // Annahmen (Thread -> Vorbereiter) und die Erneuerung mit dem angenommenen Band unter echten Fäden laufen.
  std::atomic<long> erneuert_versuch{0};
  std::thread vorbereiter([&] {
    uint32_t r = 1, gen = 1;
    while (!ende.load(std::memory_order_acquire)) {
      std::this_thread::sleep_for(std::chrono::milliseconds(15));
      const int64_t s_h = s_jetzt.load(std::memory_order_relaxed) + cdj::ANSATZ_FRIST;
      r = r * 1103515245u + 12345u;
      if (d->ansetzen(auftrag(pool[(r >> 16) % 8].get(), s_h, a, k, ++gen)) != cdj::EPOCHE_KEINE) ansaetze.fetch_add(1);
      std::this_thread::sleep_for(std::chrono::milliseconds(4));
      cdj::KartenStand st;
      st.karte = k;
      st.generation = ++gen;
      st.s_jetzt = s_jetzt.load(std::memory_order_relaxed);
      d->vorbereiter_schritt(st);
      erneuert_versuch.fetch_add(1);
    }
  });
  uint64_t rz = 0x9E3779B97F4A7C15ull;
  auto zufall = [&](uint64_t n) {
    rz ^= rz << 13;
    rz ^= rz >> 7;
    rz ^= rz << 17;
    return rz % n;
  };
  int gestellt = 0, alt_epoche = 0, doppelt = 0;
  uint32_t letzte_nr = 0;
  long hoerbar = 0;
  float l[B], r[B];
  for (int64_t b = 0; gestellt < auftraege; b += B) {
    s_jetzt.store(b, std::memory_order_relaxed);
    cdj::KartenStand st;
    st.karte = k;
    st.generation = 1;
    st.s_jetzt = b;
    d->karte_veroeffentlichen(st);
    cdj::StreckRing& ring = d->ring();
    ring.setze_epoche(d->epoche());
    if (ring.bereit_ab(b) == b && ring.lies(b, B, l, r)) ++hoerbar;
    if (b > 8192 && zufall(2) == 0) {
      const int n = zufall(5) == 0 ? 2 : 1;
      doppelt += n == 2;
      for (int j = 0; j < n && gestellt < auftraege; ++j) {
        uint32_t ep = d->epoche();
        if (zufall(10) == 0) {
          --ep;
          ++alt_epoche;
        }
        const int64_t ziel = b + (int64_t)zufall(12000);
        const int64_t pgb = (int64_t)std::floor(k.beat_at((double)ziel) * FPB) - 128;
        letzte_nr = d->wechsel(w_auftrag(ep, pool[zufall(8)].get(), pgb));
        ++gestellt;
      }
    }
    takt.fetch_add(1, std::memory_order_release);
    std::this_thread::sleep_for(std::chrono::milliseconds(1));
  }
  ende.store(true, std::memory_order_release);
  arbeiter.join();
  vorbereiter.join();
  d->fuelle_synchron();  // liest einen noch ungelesenen letzten Auftrag
  const uint64_t ang = d->wechsel_n_angenommen(), verf = d->wechsel_n_verfehlt(), ueb = d->wechsel_ueberschrieben();
  w_zaehler("W5", *d);
  std::printf("  W5: gestellt %d (davon alte Epoche %d, Doppel %d), letzte Nummer %u; angenommen %llu + verfehlt %llu + "
              "überschrieben %llu = %llu; Ansätze %ld, hörbare Blöcke %ld\n", gestellt, alt_epoche, doppelt, letzte_nr,
              (unsigned long long)ang, (unsigned long long)verf, (unsigned long long)ueb,
              (unsigned long long)(ang + verf + ueb), ansaetze.load(), hoerbar);
  PRUEF(letzte_nr == (uint32_t)gestellt);
  PRUEF(ang + verf + ueb == (uint64_t)gestellt);
  PRUEF(std::max(d->wechsel_gelesen(), d->wechsel_verfehlt()) == letzte_nr);
  PRUEF(ang > 0);
  PRUEF(verf > 0);
  PRUEF(ueb > 0);
  std::printf("  W5: Erneuerungen %d (Versuche %ld), bestätigt %u, zurückgenommen %u (n %llu)\n", d->ansatz_erneuert(),
              erneuert_versuch.load(), d->wechsel_bestaetigt(), d->wechsel_zurueckgenommen(),
              (unsigned long long)d->wechsel_n_zurueckgenommen());
  PRUEF(ansaetze.load() > 0);
  PRUEF(d->ansatz_erneuert() > 0);
  PRUEF(d->wechsel_bestaetigt() > 0);
  PRUEF(d->wechsel_bestaetigt() <= d->wechsel_gelesen());
  PRUEF(hoerbar > 0);
  ergebnis("W5_wechsel_faeden");
}

// ------------------------------------------------------------------------------------------ W6 (Fix-Runde W2, Prüfung Q1)
// Angenommener Wechsel A -> B in Epoche 1, danach erneuert der Vorbereiter dieselbe Kette vor s_h (neuere Generation, Rampe):
// die Erneuerung (Epoche 2) muss B tragen, nicht A. Vorher (be2a7ef0) setzte sie mit letzter_.quelle = A an: der Thread las wieder
// A, wechsel_gelesen meldete trotzdem 1, und wer A nach der Annahme freigab, ließ Vorbereiter und Thread freigegebenen Speicher
// lesen (Probe P1, pruef-w2/qualitaet/probe_w2.cpp). Grenze: nach dem Wechsel liest niemand A (0 Aufrufe), der Thread liest B,
// Epoche 2 quittiert, wechsel_bestaetigt() = 1, nichts zurückgenommen. Mutation DEHNER_ERNEUERUNG_ALTE_QUELLE (Rückmeldung an
// den Vorbereiter aus) rot.
struct ZaehlQuelle : cdj::DehnerQuelle {
  mutable std::atomic<long> n{0};
  void band(int64_t ab, int m, float* l, float* r) const noexcept override {
    for (int i = 0; i < m; ++i) l[i] = r[i] = 0.2f * (float)((ab + i) % 97) / 97.0f;
    n.fetch_add(1, std::memory_order_relaxed);
  }
  double basis_bpm() const noexcept override { return 128.0; }
};
void test_w6_wechsel_vor_erneuerung() {
  static ZaehlQuelle A, Bq;
  const Karte k(128.0, 0);
  auto d = cdj::dehner_neu(1, {});
  const int64_t s_h = 40960;
  PRUEF(d->ansetzen(auftrag(&A, s_h, DehnerAnker{}, k, 1)) == 1);
  cdj::KartenStand st;
  st.karte = k;
  st.generation = 1;
  st.s_jetzt = 0;
  d->karte_veroeffentlichen(st);
  d->fuelle_synchron();  // übernimmt Epoche 1
  const uint32_t nr = d->wechsel(w_auftrag(d->epoche(), &Bq, 1000000));
  d->fuelle_synchron();  // nimmt an
  const uint32_t gelesen = d->wechsel_gelesen();
  const long a0 = A.n.load(), b0 = Bq.n.load();
  cdj::KartenStand st2;
  st2.karte = Karte(128.0, 0);
  PRUEF(st2.karte.rampe(32, 132, 8));
  st2.generation = 2;
  st2.s_jetzt = 1024;
  d->vorbereiter_schritt(st2);  // interne Erneuerung vor s_h
  for (int64_t b = s_h - 4096; b < s_h + 8 * B; b += B) {
    st2.s_jetzt = b;
    d->karte_veroeffentlichen(st2);
    cdj::StreckRing& r = d->ring();
    r.setze_epoche(d->epoche());
    float l[B], rr[B];
    const int64_t ab = r.bereit_ab(b);
    if (ab >= 0 && ab < b + B) r.lies_bis(ab, (int)(b + B - ab), l, rr);
    d->fuelle_synchron();
  }
  const long da = A.n.load() - a0, db = Bq.n.load() - b0;
  std::printf("  W6: Wechsel nr %u gelesen %u; nach der Erneuerung epoche %u quittiert %u erneuert %d; band()-Aufrufe danach A %+ld, "
              "B %+ld\n", nr, gelesen, d->epoche(), d->quittiert_e(), d->ansatz_erneuert(), da, db);
#ifndef W6_VORHER
  std::printf("  W6: bestaetigt %u, zurueckgenommen %u\n", d->wechsel_bestaetigt(), d->wechsel_zurueckgenommen());
#endif
  PRUEF(gelesen == nr);
  PRUEF(d->ansatz_erneuert() == 1);
  PRUEF(d->quittiert_e() == 2);
  PRUEF(da == 0);
  PRUEF(db > 0);
#ifndef W6_VORHER
  PRUEF(d->wechsel_bestaetigt() == nr);
  PRUEF(d->wechsel_zurueckgenommen() == 0);
#endif
  ergebnis("W6_wechsel_vor_erneuerung");
}

// ------------------------------------------------------------------------------------------ W7 (Fix-Runde W2, Q3/S5)
// Lücke der Nummern über den Überlauf (0xFFFFFFFF -> 1, die 0 wird nie vergeben), rein rechnerisch ohne 2^32 Aufträge, an der
// Funktion, die wechsel_holen benutzt. Vorher (Mutation DEHNER_LUECKE_ALT, Formel aus be2a7ef0) zählt 0xFFFFFFFF -> 1 ein
// Überschreiben zu viel.
void test_w7_nummer_ueberlauf() {
  struct F { uint32_t letzte, nr, soll; } faelle[] = {
      {0, 1, 0}, {0, 3, 2}, {5, 6, 0}, {5, 8, 2}, {0xFFFFFFFEu, 0xFFFFFFFFu, 0}, {0xFFFFFFFFu, 1, 0}, {0xFFFFFFFEu, 1, 1},
      {0xFFFFFFFFu, 3, 2}, {0xFFFFFFFDu, 2, 3}};
  int falsch = 0;
  for (const F& f : faelle) {
    const uint32_t l = cdj::dehner_wechsel_luecke(f.letzte, f.nr);
    std::printf("  W7: letzte 0x%08X, nr %u: Lücke %u (Soll %u)\n", f.letzte, f.nr, l, f.soll);
    falsch += l != f.soll;
  }
  PRUEF(falsch == 0);
  ergebnis("W7_nummer_ueberlauf");
}

void w_tests(int faeden_auftraege) {
  test_w1a_wechsel_nahtlos();
  test_w1b_wechsel_neues_band();
  test_w2_wechsel_zu_spaet();
  test_w3_wechsel_falsche_epoche();
  test_w3b_gegenwechsel();
  test_w4_wechsel_allokation();
  test_w5_wechsel_faeden(faeden_auftraege);
  test_w6_wechsel_vor_erneuerung();
  test_w7_nummer_ueberlauf();
}


}  // namespace

// Task 5b (Prüfung MINOR): die gehörte Quellposition des Reglers (DehnerSumme, wie dehner.cpp chunk) bleibt über 4 h exakt,
// rechnerisch ohne R3: Faktor 128 / 125,3 (nicht dyadisch) und 132 / 128, Abschnitte zu 256 Samples, Bezug long double
// p0 + N · f. Vorher (je Sample in einem double, Mutation DEHNER_P_JE_SAMPLE): −7,1 Frames nach 4 h (Probe p_akku.txt).
// Keylock 4.6b: die Entscheidung Deck-Versatz 0 (Andreas 08.10., drums2/BERICHT.md) als Test. Rot, wenn dehner_versatz()
// irgendwo im Faktorbereich 0,7 bis 1,4 nicht 0 liefert, und an der Lage-Signatur: Hann-Klick bei 96 BPM konstant liegt
// ohne Korrektur bei −96,2 (task-01-fix/f3_versatz_roh.txt Mittel64 −96,228; mit der alten Tabelle aus c06b2b8 bei rund 0).
void test_versatz_null() {
  int nicht_null = 0;
  for (int i = 0; i <= 70; ++i)
    if (cdj::dehner_versatz(0.7 + 0.01 * i) != 0.0) ++nicht_null;
  const double e96 = einmessen(96.0, true);
  std::printf("  test13: dehner_versatz != 0 an %d von 71 Faktoren; Hann-Klick 96 BPM mit Korrektur %+.2f (Soll −96,2 ±3)\n",
              nicht_null, e96);
  PRUEF(nicht_null == 0);
  PRUEF_NAH(e96, -96.2, 3.0);
  ergebnis("dehner_versatz_null");
}

void test_p_summe() {
  for (const double f : {128.0 / 125.3, 132.0 / 128.0, 174.0 / 170.04}) {
    cdj::DehnerSumme P;
    P.setze(1.0e6 + 0.375);
    const int64_t abschnitte = 4LL * 3600 * 48000 / cdj::DEHNER_BLOCK;
    for (int64_t a = 0; a < abschnitte; ++a) cdj::dehner_summe_abschnitt(P, cdj::DEHNER_BLOCK, [f](int) { return f; });
    const long double soll = 1.0e6L + 0.375L + (long double)abschnitte * cdj::DEHNER_BLOCK * (long double)f;
    const double fehler = (double)((long double)P.ganz + (long double)P.rest - soll);
    std::printf("  dehner_p_summe: Faktor %.12f, 4 h (%lld Abschnitte): P %.6f, Fehler %+.3e Frames\n", f,
                (long long)abschnitte, P.wert(), fehler);
    PRUEF(std::fabs(fehler) < 1e-3);
  }
  ergebnis("dehner_p_summe");
}

int main(int argc, char** argv) {
  if (argc > 1 && std::strcmp(argv[1], "p_summe") == 0) {
    test_p_summe();
    PRUEF_ENDE();
  }
  // `test_dehner faeden`: nur Test 7 (für den TSan-Bau in build-tsan; der ganze Lauf wäre dort unnötig lang)
  if (argc > 1 && std::strcmp(argv[1], "faeden") == 0) {
    test_zwei_faeden(2.0);
    PRUEF_ENDE();
  }
  // Task 6b: `test_dehner wechsel`: nur W1a bis W5 (W5 mit 2000 Aufträgen); `test_dehner wechsel_faeden [n]`: nur W5 mit n
  // Aufträgen (Vorgabe 300, für den TSan-Bau)
  if (argc > 1 && std::strcmp(argv[1], "wechsel") == 0) {
    w_tests(2000);
    PRUEF_ENDE();
  }
  if (argc > 1 && std::strcmp(argv[1], "wechsel_faeden") == 0) {
    test_w5_wechsel_faeden(argc > 2 ? std::atoi(argv[2]) : 300);
    PRUEF_ENDE();
  }
  if (argc > 1 && std::strcmp(argv[1], "einmessen") == 0) {
    abschnitt0_einmessen();
    return 0;
  }
  abschnitt0_kosten();
  test_ansatz_auf_dem_sample();
  test_lage_rampe();
  test_tonhoehe();
  test_faktor_nie_eins();
  test_karte_neu_vor_s_h();
  test_allokation();
  test_zwei_faeden(2.0);
  test_epochen();
  test_stand_veraltet();
  test_kurze_rampen();
  test_versatz_bereich();
  test_regler_in_rampe();
  test_versatz_null();
  test_p_summe();
  w_tests(2000);
  PRUEF_ENDE();
}
