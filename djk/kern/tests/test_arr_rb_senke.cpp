// D1 K2b (Spec 2.4, 6.10, 6.13, A3): die RB-338 als Senke der internen Spuren.
//   1 Senke allein gegen die FFI direkt, bitgleich: dieselben Aufrufe im selben Block (Parameter beim ersten Block,
//     beim Einsatz vorgaben -> setze -> zuruecksetzen -> alle_aus, Noten mit Versatz über Blockgrenzen, Tausch mit neuem
//     cutoff mitten im Lauf). Gegenprobe: dieselben Noten mit Vorgabe-Parametern klingen anders.
//   2 A3 im Modul (Kern-Reihenfolge beim Transport-Start): erster Lauf mit einer Vorleben-Note, Stopp, zweiter Start;
//     die Prüfnote auf dem Einsatz + k (k = 0 liegt mit alle_aus auf demselben Sample) ergibt ab der Note bitgleich die um
//     k verschobene Ausgabe von k = 0, vorher Stille ab dem Block des Einsatzes. Gegenprobe: unverschoben verglichen ist
//     k = 1 ein anderes Signal.
//   3 Negativ-Kontrolle: eine interne Spur ohne Noten bleibt bitgleich still (die Stimme ruht, 6.10).
// Mutationen: ARR_RB_REIHENFOLGE und ARR_RB_TAUSCH_OHNE_PARAMETER (Fall 1), ARR_RB_VERSATZ_NULL und
//   5 Kurzblende (Spec 6.28): Neustart bei klingender Note. Die Senke setzt am Anfang des Einsatz-Blocks zurück; ohne
//     Blende springt der Ausklang dort hart auf 0 (Review: 0,00689 gegen 0,00453). Gemessen: der Sprung am Schnitt und der
//     größte Sample-Schritt vom Befehl bis über den Schnitt liegen unter dem größten Schritt im Spiel davor.
//     Negativ-Kontrolle: eine kurze, schon ausgeklungene Note springt um 0, die Blende ändert dort nichts.
//     Fix F3: die Rampe selbst ist gepinnt. Referenz ist derselbe Lauf mit Stopp statt Neustart (gleiche Ereignisse an
//     die Senke, keine Blende): bis zum Blendblock bitgleich, im Blendblock Referenz mal (m − 1 − i) / m.
//   6 Fix F2: eine klingende interne Spur verlässt die Senke per Tausch (wird leer, wird Wirt-Spur). Der Ausklang endet
//     mit einer Blende über einen Block (kein Schritt über dem größten im Spiel davor), danach exakte Stille, die Stimme
//     ruht; wird dieselbe interne Spur später ohne Start zurückgeladen, klingt kein alter Ausklang weiter (Energie 0).
//     Negativ-Kontrolle: ein Tausch auf dieselbe interne Spur ändert die Ausgabe nicht (bitgleich ohne Tausch).
//   7 K2b-Rest (b, Re-Review der Fix-Runde, Probe test_zz_rr2_doppeltausch): eine klingende interne Spur kehrt im selben
//     Zyklus zurück (intern -> leer -> intern, zwei Tausche vor demselben Block), die neue Spur hat eine Note 64 Samples nach
//     dem Tausch. Nur der alte Ausklang blendet aus; die zurückgekehrte Spur spielt: Energie in [T + 256, T + 24000) wie mit
//     einem Tausch intern -> intern (vorher 0 statt 23,05, die ganze neue Note ging verloren), kein Schritt über dem Spiel
//     davor. Mutation ARR_RB_ZURUECK_VERLOREN (Zweig weg blendet die zurückgekehrte Spur aus, wie vorher) macht Fall 7 rot.
// ARR_RB_OHNE_ZURUECKSETZEN (Fall 1 und 2), ARR_RB_RUHE_SOFORT (Fall 4), ARR_RB_OHNE_BLENDE und ARR_RB_BLENDE_HART (Fall 5),
// ARR_SPURWECHSEL_HART (Fall 6) machen den Test rot.
#include <cmath>
#include <cstdio>
#include <vector>

#include "arr_bau.h"
#include "cypherdj/arr_rb_senke.h"
#include "cypherdj/cypher_rb_ffi.h"
#include <cypherdj/dsp/denormal.h>
#include "pruef.h"

using namespace arrtest;
using cdj::ArrArt;

namespace {

void param(cdj::ArrSnapshot* s, int nr, const char* name, float wert) {
  cdj::ArrSpur& sp = s->spur[nr - 1];
  std::snprintf(sp.param[sp.n_param].name, sizeof sp.param[0].name, "%s", name);
  sp.param[sp.n_param++].wert = wert;
}

std::vector<float> ffi_block(CypherRb* h, int n) {
  std::vector<float> l(static_cast<size_t>(n)), r(static_cast<size_t>(n));
  cypherdj::dsp::DenormalSchutz schutz;
  cypher_rb_block(h, l.data(), r.data(), static_cast<size_t>(n));
  return l;
}

// Fall 1: die Senke allein (Spur-Slot 2, Index 1), Blöcke zu 256; Einsatz S = 1000 im Block 768
struct Fall1 {
  std::vector<float> senke, ref;
};
Fall1 fall1(bool mit_parametern) {
  Fall1 f;
  Treiber t;   // hält nur den Schnappschuss (arr.snapshot()), das Modul läuft hier nicht
  cdj::ArrSnapshot* a = Bau().spur(2, ArrArt::intern).fertig();
  if (mit_parametern) {
    param(a, 2, "cutoff", 0.15f);
    param(a, 2, "env_mod", 0.9f);
  }
  t.laden(a);
  cdj::ArrRbSenke se(t.arr);
  PRUEF(se.bereit());
  CypherRb* h = cypher_rb_neu(48000.0);
  auto setze_alle = [&](float cutoff) {
    cypher_rb_vorgaben(h);
    if (mit_parametern) {
      cypher_rb_setze(h, "cutoff", cutoff);
      cypher_rb_setze(h, "env_mod", 0.9f);
    }
  };
  const int64_t S = 1000;
  se.transport_start(1, S);
  for (int64_t s0 = 0; s0 < 256 * 48; s0 += 256) {
    if (s0 == 5120) {   // Tausch mitten im Lauf: cutoff 0,8
      cdj::ArrSnapshot* b = Bau(2).spur(2, ArrArt::intern).fertig();
      if (mit_parametern) {
        param(b, 2, "cutoff", 0.8f);
        param(b, 2, "env_mod", 0.9f);
      }
      t.laden(b);
    }
    // Noten im Block, der ihr Ziel enthält (wie das Modul bei Vorhalt 0)
    if (s0 == 1024) se.note(1, 1300, 36, 100, true);
    if (s0 == 4096) {
      se.note(1, 4300, 36, 0, false);
      se.note(1, 4300, 43, 127, true);
    }
    if (s0 == 6912) se.note(1, 7000, 43, 0, false);
    std::vector<float> l(256, 0.0f), r(256, 0.0f);
    se.block(1, s0, 256, l.data(), r.data());
    f.senke.insert(f.senke.end(), l.begin(), l.end());
    // Referenz: dieselben FFI-Aufrufe direkt
    if (s0 == 0) setze_alle(0.15f);
    if (s0 == 768) {
      setze_alle(0.15f);
      cypher_rb_zuruecksetzen(h);
      cypher_rb_alle_aus(h, static_cast<uint32_t>(S - s0));
    }
    if (s0 == 5120) setze_alle(0.8f);
    if (s0 == 1024) cypher_rb_note_an(h, 1300 - 1024, 36, 100);
    if (s0 == 4096) {
      cypher_rb_note_aus(h, 4300 - 4096, 36);
      cypher_rb_note_an(h, 4300 - 4096, 43, 127);
    }
    if (s0 == 6912) cypher_rb_note_aus(h, 7000 - 6912, 43);
    const auto x = ffi_block(h, 256);
    f.ref.insert(f.ref.end(), x.begin(), x.end());
  }
  cypher_rb_frei(h);
  PRUEF(se.verloren() == 0 && se.parameter_abgelehnt() == 0);
  return f;
}

// Fall 2: Modul mit der Senke, Prüfnote auf Einsatz + k im zweiten Lauf
struct Fall2 {
  std::vector<float> l;
  int64_t einsatz = -1;
};
Fall2 fall2(int k, bool pruefnote = true) {
  Fall2 f;
  Treiber t;
  cdj::ArrRbSenke rb(t.arr);
  t.arr.setze_senke_intern(&rb);
  Bau b;
  b.spur(1, ArrArt::intern).note(1, "v/n1", 0.0, 1.5, 30, 127);   // Vorleben im ersten Lauf
  if (pruefnote) b.note(1, "a/n1", 8.0 + k / static_cast<double>(SPB), 0.25, 36, 100);
  cdj::ArrSnapshot* s = b.fertig();
  param(s, 1, "cutoff", 0.4f);
  param(s, 1, "resonanz", 0.7f);
  t.laden(s);
  t.arr.start(0.0, 0, false, t.s, 537, 256, t.k);
  t.lauf(2 * SPB);
  t.arr.stopp(0, t.s, t.k);
  t.lauf(3 * SPB);
  const int64_t s_start = t.s;
  t.arr.start(8.0, 0, false, s_start, 537, 256, t.k);   // zweiter Lauf ab Projekt-Beat 8
  f.einsatz = s_start + 537 + 256;                      // Start-Regel: jetzt + Vorhalt + ein Zyklus (quant 0)
  t.lauf(s_start + 3 * SPB);
  f.l = t.l;
  PRUEF(rb.verloren() == 0);
  return f;
}

// Fall 6: interne Spur 1 mit langer Note, Tausch während sie klingt. art 0 leer, 1 Wirt-Spur (Prüfsenke auf Slot 1),
// 2 dieselbe interne Spur, 3 interne Spur mit kürzerer Note (Note-Aus am Tausch, keine Blende: Referenz für 0 und 1),
// 4 ohne Tausch. Danach Stopp, 3 s, dieselbe interne Spur ohne Start zurückladen, 1 s: Energie.
struct Fall6 {
  std::vector<float> l;
  int64_t tausch = -1;
  int ruhend = -1;
  double e_zurueck = 0.0;
  uint64_t verloren = 0;
};
Fall6 fall6(int art) {
  Fall6 f;
  Treiber t;
  cdj::ArrRbSenke rb(t.arr);
  PruefSenke wirt;
  t.arr.setze_senke_intern(&rb);
  t.arr.setze_senke_wirt(1, &wirt);
  t.laden(Bau(1).spur(1, ArrArt::intern).note(1, "v/n1", 0.0, 4.0, 36, 127).fertig());
  t.arr.start(0.0, 0, false, t.s, 537, 256, t.k);
  t.lauf(SPB + SPB / 2 + 13 * 256);
  f.tausch = t.s;
  if (art == 0) t.laden(Bau(2).fertig());
  else if (art == 1) t.laden(Bau(2).spur(1, ArrArt::wirt, 1).fertig());
  else if (art == 2) t.laden(Bau(2).spur(1, ArrArt::intern).note(1, "v/n1", 0.0, 4.0, 36, 127).fertig());
  else if (art == 3) t.laden(Bau(2).spur(1, ArrArt::intern).note(1, "v/n1", 0.0, 3.5, 36, 127).fertig());
  t.lauf(f.tausch + 2048);
  f.ruhend = rb.ruhend();
  t.arr.stopp(0, t.s, t.k);
  t.lauf(t.s + 3 * 48000);
  const int64_t zurueck = t.s;
  t.laden(Bau(3).spur(1, ArrArt::intern).note(1, "v/n1", 0.0, 4.0, 36, 127).fertig());
  t.lauf(zurueck + 48000);
  for (int64_t i = zurueck; i < zurueck + 48000; ++i) f.e_zurueck += static_cast<double>(t.l[i]) * t.l[i];
  f.l = t.l;
  f.verloren = rb.verloren();
  return f;
}

}  // namespace

int main() {
  {  // 1: Senke gegen die FFI direkt, bitgleich; Gegenprobe ohne Parameter
    const Fall1 f = fall1(true);
    PRUEF(f.senke.size() == f.ref.size());
    bool gleich = f.senke == f.ref, klingt = false;
    for (float v : f.senke) klingt = klingt || v != 0.0f;
    PRUEF(gleich);
    PRUEF(klingt);
    if (!gleich)
      for (size_t i = 0; i < f.senke.size(); ++i)
        if (f.senke[i] != f.ref[i]) {
          std::fprintf(stderr, "Fall 1: erste Abweichung bei Sample %zu: Senke %.9g, FFI %.9g\n", i, f.senke[i], f.ref[i]);
          break;
        }
    for (size_t i = 0; i < 1000 && i < f.senke.size(); ++i) PRUEF(f.senke[i] == 0.0f);   // vor dem Einsatz still
    PRUEF(fall1(false).senke != f.senke);   // Gegenprobe: die Parameter der Wiedergabe wirken
  }
  {  // 2: A3 im Modul, alle_aus und Prüfnote (k = 0) auf demselben Sample
    const Fall2 r0 = fall2(0);
    const int64_t S = r0.einsatz, blockanfang = S / 256 * 256, L = 2 * SPB;
    double e = 0.0;
    for (int64_t i = 0; i < L; ++i) e += static_cast<double>(r0.l[S + i]) * r0.l[S + i];
    PRUEF(e > 1e-3);   // die Prüfnote klingt (alle_aus am selben Sample löscht sie nicht)
    for (int k : {1, 100, 255, 256, 257, 511}) {
      const Fall2 rk = fall2(k);
      PRUEF(rk.einsatz == S);
      bool still = true, gleich = true;
      for (int64_t j = blockanfang; j < S + k; ++j) still = still && rk.l[j] == 0.0f;
      for (int64_t i = 0; i < L - k; ++i) gleich = gleich && rk.l[S + k + i] == r0.l[S + i];
      PRUEF(still);
      PRUEF(gleich);
      if (!still || !gleich) std::fprintf(stderr, "Fall 2: Versatz %d: still %d, verschoben gleich %d\n", k, still, gleich);
    }
    const Fall2 r1 = fall2(1);
    bool anders = false;
    for (int64_t i = 0; i < L; ++i) anders = anders || r1.l[S + i] != r0.l[S + i];
    PRUEF(anders);   // Gegenprobe: unverschoben verglichen ist k = 1 ein anderes Signal
  }
  {  // 3: Negativ-Kontrolle: Spur ohne Noten (nach dem Vorleben ohne Prüfnote) bleibt ab dem zweiten Einsatz still
    const Fall2 r = fall2(0, false);
    bool still = true;
    for (int64_t j = r.einsatz / 256 * 256; j < static_cast<int64_t>(r.l.size()); ++j) still = still && r.l[j] == 0.0f;
    PRUEF(still);
  }
  {  // 4: Ruhe nach dem Stopp: der Ausklang bleibt (Energie in den ersten 100 ms nach dem Stopp), nach 1 s exakter Stille
     //    ruht die Stimme (ruhend() zählt sie); solange der Transport läuft, nie
    Treiber t;
    cdj::ArrRbSenke rb(t.arr);
    t.arr.setze_senke_intern(&rb);
    t.laden(Bau().spur(1, ArrArt::intern).note(1, "v/n1", 0.0, 4.0, 36, 127).note(1, "v/n2", 5.0, 0.25, 40, 100).fertig());
    PRUEF(rb.ruhend() == cdj::ARR_SPUREN);
    t.arr.start(0.0, 0, false, t.s, 537, 256, t.k);
    t.lauf(SPB / 2);
    PRUEF(rb.ruhend() == cdj::ARR_SPUREN - 1);   // die Spur klingt
    t.lauf(2 * SPB);
    t.arr.stopp(0, t.s, t.k);                     // mitten in der Note: All-Off, der Ausklang folgt
    const int64_t stopp = t.s;
    t.lauf(stopp + 4800);
    double e = 0.0;
    for (int64_t i = stopp + 512; i < stopp + 4800; ++i) e += static_cast<double>(t.l[i]) * t.l[i];
    PRUEF(e > 1e-4);                              // der Ausklang nach dem Stopp bleibt
    PRUEF(rb.ruhend() == cdj::ARR_SPUREN - 1);   // noch nicht 1 s still
    t.lauf(stopp + 2 * 48000);
    PRUEF(rb.ruhend() == cdj::ARR_SPUREN);
    bool still = true;
    for (int64_t i = stopp + 48000; i < static_cast<int64_t>(t.l.size()); ++i) still = still && t.l[i] == 0.0f;
    PRUEF(still);
    // Negativ-Kontrolle: läuft der Transport, ruht die Stimme in einer langen Pause nie (Note 1, 3 s Pause, Note 2)
    t.arr.start(0.0, 0, false, t.s, 537, 256, t.k);
    t.lauf(t.s + 4 * SPB + SPB / 2);
    PRUEF(rb.ruhend() == cdj::ARR_SPUREN - 1);
  }
  for (double laenge : {4.0, 0.5}) {   // 5: Kurzblende vor dem Zurücksetzen (Spec 6.28); 0,5: Negativ-Kontrolle
    // neustart false: Referenz für die Rampe (F3), Stopp statt Neustart am selben Sample, keine Blende
    auto fahre = [&](Treiber& t, cdj::ArrRbSenke& rb, bool neustart) {
      t.arr.setze_senke_intern(&rb);
      t.laden(Bau().spur(1, ArrArt::intern).note(1, "v/n1", 0.0, laenge, 36, 127).fertig());
      t.arr.start(0.0, 0, false, t.s, 537, 256, t.k);
      t.lauf(SPB + SPB / 2);                                // die lange Note klingt noch, die kurze ist aus
      if (neustart) t.arr.start(0.0, 0, false, t.s, 537, 256, t.k);   // Neustart während des Laufs
      else t.arr.stopp(0, t.s, t.k);
      return t.s;
    };
    Treiber t;
    cdj::ArrRbSenke rb(t.arr);
    const int64_t befehl = fahre(t, rb, true);
    const int64_t einsatz = befehl + 537 + 256, c = einsatz / 256 * 256;   // Schnitt am Blockanfang des Einsatzes
    t.lauf(einsatz + 4 * 256);
    Treiber ref;
    cdj::ArrRbSenke rb_ref(ref.arr);
    PRUEF(fahre(ref, rb_ref, false) == befehl);
    ref.lauf(einsatz + 4 * 256);
    bool gleich_davor = true, rampe = true;
    for (int64_t i = 0; i < c - 256; ++i) gleich_davor = gleich_davor && t.l[i] == ref.l[i];
    float abw = 0.0f, ref_spitze = 0.0f;
    for (int i = 0; i < 256; ++i) {   // Blendblock [c − 256, c): Referenz mal (256 − 1 − i) / 256
      ref_spitze = std::fmax(ref_spitze, std::fabs(ref.l[c - 256 + i]));
      const float soll = ref.l[c - 256 + i] * (static_cast<float>(256 - 1 - i) / 256.0f);
      const float d = std::fabs(t.l[c - 256 + i] - soll);
      abw = std::fmax(abw, d);
      rampe = rampe && d <= 1e-6f * std::fabs(ref.l[c - 256 + i]) + 1e-9f;
    }
    std::printf("Fall 5 (Note %.1f Beats): Rampe gegen die Referenz ohne Blende: bitgleich davor %d, größte Abweichung im"
                " Blendblock %.3g, Referenz am Blendanfang %.6f\n", laenge, gleich_davor, abw, ref.l[c - 256]);
    PRUEF(gleich_davor);
    PRUEF(rampe);
    if (laenge > 1.0) PRUEF(ref_spitze > 1e-3f);   // im Blendblock klingt die Referenz (die Rampe ist nicht trivial)
    float dmax_spiel = 0.0f, dmax_blende = 0.0f, pegel = 0.0f;
    for (int64_t i = befehl - 4000; i < befehl; ++i) {
      dmax_spiel = std::fmax(dmax_spiel, std::fabs(t.l[i] - t.l[i - 1]));
      pegel = std::fmax(pegel, std::fabs(t.l[i]));
    }
    for (int64_t i = befehl; i <= c; ++i) dmax_blende = std::fmax(dmax_blende, std::fabs(t.l[i] - t.l[i - 1]));
    const float sprung = std::fabs(t.l[c] - t.l[c - 1]);
    std::printf("Fall 5 (Note %.1f Beats): Befehl %lld, Einsatz %lld, Schnitt %lld | l[c-1] %.6f, l[c] %.6f, Sprung %.6f |"
                " größter Schritt im Spiel davor %.6f (Pegel %.5f), vom Befehl bis zum Schnitt %.6f\n",
                laenge, (long long)befehl, (long long)einsatz, (long long)c, t.l[c - 1], t.l[c], sprung, dmax_spiel, pegel,
                dmax_blende);
    if (laenge > 1.0) {
      PRUEF(pegel > 0.01f);                // die Note klingt beim Befehl wirklich
      PRUEF(sprung < dmax_spiel);
      PRUEF(dmax_blende < dmax_spiel);     // auch die Blende selbst macht keinen neuen Sprung
    } else {
      PRUEF(sprung == 0.0f);               // Negativ-Kontrolle: ausgeklungen, nichts zu blenden
    }
    bool still = true;                      // zwischen Schnitt und Einsatz ruht die Stimme (6.10, A3 unverändert)
    for (int64_t i = c; i < einsatz; ++i) still = still && t.l[i] == 0.0f;
    PRUEF(still);
  }
  {  // 6: Spurwechsel weg von intern (Fix F2)
    static const char* name[] = {"intern -> leer", "intern -> wirt", "intern -> intern (gleich)"};
    const Fall6 ohne = fall6(4), aus = fall6(3);   // Referenzen: ohne Tausch; Note-Aus am Tausch ohne Blende
    const int64_t T = ohne.tausch;
    for (int variante = 0; variante < 3; ++variante) {
      const Fall6 f = fall6(variante);
      const Fall6& ref = variante < 2 ? aus : ohne;   // 0, 1: dieselben Ereignisse an die Stimme wie aus, nur die Blende
      float dmax_spiel = 0.0f, dmax_tausch = 0.0f, pegel = 0.0f, abw = 0.0f, ref_spitze = 0.0f;
      for (int64_t i = T - 4000; i < T; ++i) {
        dmax_spiel = std::fmax(dmax_spiel, std::fabs(f.l[i] - f.l[i - 1]));
        pegel = std::fmax(pegel, std::fabs(f.l[i]));
      }
      for (int64_t i = T; i <= T + 256; ++i) dmax_tausch = std::fmax(dmax_tausch, std::fabs(f.l[i] - f.l[i - 1]));
      bool gleich_davor = true, rampe = true, gleich = true, still = true;
      for (int64_t i = 0; i < T; ++i) gleich_davor = gleich_davor && f.l[i] == ref.l[i];
      for (int i = 0; i < 256; ++i) {   // Blendblock [T, T + 256): Referenz mal (256 − 1 − i) / 256
        ref_spitze = std::fmax(ref_spitze, std::fabs(ref.l[T + i]));
        const float soll = ref.l[T + i] * (static_cast<float>(256 - 1 - i) / 256.0f);
        const float d = std::fabs(f.l[T + i] - soll);
        abw = std::fmax(abw, d);
        rampe = rampe && d <= 1e-6f * std::fabs(ref.l[T + i]) + 1e-9f;
      }
      for (int64_t i = T; i < T + 2048; ++i) gleich = gleich && f.l[i] == ref.l[i];
      for (int64_t i = T + 256; i < T + 2048; ++i) still = still && f.l[i] == 0.0f;
      std::printf("Fall 6 (%s): Pegel vor dem Tausch %.5f, größter Schritt im Spiel davor %.6f, ab dem Tausch %.6f, Rampe"
                  " gegen die Referenz %.3g (Referenz-Spitze im Block %.5f), danach still %d, ruhend %d | Energie nach"
                  " Zurückladen ohne Start %.6g (Referenz: %.6g)\n", name[variante], pegel, dmax_spiel, dmax_tausch, abw,
                  ref_spitze, still, f.ruhend, f.e_zurueck, aus.e_zurueck);
      PRUEF(pegel > 0.01f);   // die Note klingt beim Tausch wirklich
      PRUEF(gleich_davor);
      PRUEF(f.verloren == 0);
      if (variante < 2) {
        PRUEF(ref_spitze > 1e-3f);   // die Rampe ist nicht trivial
        PRUEF(rampe);
        PRUEF(dmax_tausch < dmax_spiel);
        PRUEF(still);
        PRUEF(f.ruhend == cdj::ARR_SPUREN);
        PRUEF(f.e_zurueck == 0.0);
      } else {   // Negativ-Kontrolle: bitgleich mit demselben Lauf ohne Tausch
        PRUEF(gleich);
        PRUEF(f.ruhend == cdj::ARR_SPUREN - 1);
      }
    }
  }
  {  // 7: intern -> leer -> intern im selben Zyklus, neue Note 64 Samples nach dem Tausch (K2b-Rest b)
    auto lauf = [](bool doppelt, double& e_nach, float& dmax_spiel, float& dmax_t) {
      arrtest::Treiber t;
      cdj::ArrRbSenke rb(t.arr);
      t.arr.setze_senke_intern(&rb);
      t.laden(arrtest::Bau(1).spur(1, cdj::ArrArt::intern).note(1, "v/n1", 0.0, 4.0, 36, 127).fertig());
      t.arr.start(0.0, 0, false, t.s, 537, 256, t.k);   // Einsatz bei 793
      t.lauf(arrtest::SPB + arrtest::SPB / 2 + 13 * 256);
      const int64_t T = t.s;
      const double b = static_cast<double>(T + 64 - 793) / static_cast<double>(arrtest::SPB);
      if (doppelt) t.laden(arrtest::Bau(2).fertig());   // leer
      t.laden(arrtest::Bau(3).spur(1, cdj::ArrArt::intern).note(1, "v/n2", b, 1.0, 48, 127).fertig());
      t.lauf(T + 24000);
      dmax_spiel = dmax_t = 0.0f;
      for (int64_t i = T - 4000; i < T; ++i) dmax_spiel = std::fmax(dmax_spiel, std::fabs(t.l[i] - t.l[i - 1]));
      for (int64_t i = T; i <= T + 256; ++i) dmax_t = std::fmax(dmax_t, std::fabs(t.l[i] - t.l[i - 1]));
      e_nach = 0.0;
      for (int64_t i = T + 256; i < T + 24000; ++i) e_nach += static_cast<double>(t.l[i]) * t.l[i];
    };
    double e2 = 0.0, e1 = 0.0;
    float sp2 = 0.0f, t2 = 0.0f, sp1 = 0.0f, t1 = 0.0f;
    lauf(true, e2, sp2, t2);
    lauf(false, e1, sp1, t1);
    std::printf("rb Fall 7: intern -> leer -> intern: Energie [T+256,T+24000) %.6g, Schritt im Spiel %.6f, ab T %.6f | "
                "Referenz intern -> intern: Energie %.6g, Schritt ab T %.6f\n", e2, sp2, t2, e1, t1);
    PRUEF(e1 > 1.0);                                  // die neue Note klingt in der Referenz
    PRUEF(e2 > 0.0 && std::fabs(e2 - e1) < 0.1 * e1); // und nach der Rückkehr (vorher 0)
  }
  PRUEF_ENDE();
}
