// D1 K1 Slice 6: Noten des Moduls Arrangement an Senken (Spec D1 2.2, A3, A4). Vorausblick um den Vorhalt der Senke
// (Wirt 537 bei Quantum 256), über die Loop-Klammer hinweg; Off vor On am selben Sample; Off an der Naht gekappt;
// kurze Noten an und aus im selben Block; Tausch (gelöscht, anderes Ende: Off sofort; unverändert: bleibt); Stopp
// (Offs, All-Notes-Off); Stopp vor dem Einsatz; Liste voll. Transport-Start meldet sich bei jeder Senke.
// Mutationen: ARR_OHNE_VORAUSBLICK (Fall 1), ARR_TAUSCH_OHNE_NOTE_AUS (Fall 4), ARR_FENSTER_LINEAR (Fall 7: das
// Vorausblick-Fenster hinter der Naht linear statt über die Klammer) machen den Test rot.
#include <cstdio>
#include <vector>

#include "arr_bau.h"
#include "pruef.h"

using namespace arrtest;
using cdj::ArrArt;
using cdj::ArrStatus;

static constexpr int64_t V = 537;
static const double MITTE = 0.70710677;

// Block, in dem eine Note mit Ziel z bei Vorhalt v ankommen muss
static bool rechtzeitig(const PruefSenke::Ev& e, int64_t v) {
  return e.block_s0 <= e.ziel - v && e.ziel - v < e.block_s0 + 256;
}

int main() {
  {  // 1: Wirt-Slot 1, Loop 0..4 ab Takt (90 000): Note 0..0,5 und Note 3,5..4,5 (über die Naht)
    Treiber t;
    PruefSenke w(V);
    t.senken.push_back(&w);
    t.arr.setze_senke_wirt(1, &w);
    t.laden(Bau().spur(2, ArrArt::wirt, 1).note(2, "m/n1", 0.0, 0.5, 60).note(2, "m/n2", 3.5, 1.0, 62).fertig());
    t.arr.loop(true, 0.0, 4.0, t.s, t.k);
    t.arr.start(0.0, 2, false, 0, V, 256, t.k);
    t.lauf(300000);
    PRUEF(w.start_ev.size() == 1 && w.start_ev[0].first == 1 && w.start_ev[0].second == 90000);
    const auto on = w.ons(), off = w.offs();
    const int64_t on_soll[] = {90000, 168750, 180000, 258750, 270000};
    const int64_t off_soll[] = {101250, 180000, 191250, 270000, 281250};
    PRUEF(on.size() == 5 && off.size() == 5);
    for (size_t i = 0; i < on.size() && i < 5; ++i) {
      PRUEF(on[i].ziel == on_soll[i]);
      PRUEF(rechtzeitig(on[i], V));
    }
    for (size_t i = 0; i < off.size() && i < 5; ++i) {
      PRUEF(off[i].ziel == off_soll[i]);
      PRUEF(rechtzeitig(off[i], V));
    }
    // an der Naht 180 000: Off der Note 3,5 (Ton 62) vor dem On der Note 0 des nächsten Durchlaufs (Ton 60)
    size_t i_off = 0, i_on = 0;
    for (size_t i = 0; i < w.ev.size(); ++i) {
      if (w.ev[i].ziel == 180000 && !w.ev[i].an) i_off = i;
      if (w.ev[i].ziel == 180000 && w.ev[i].an) i_on = i;
    }
    PRUEF(w.ev[i_off].ton == 62 && w.ev[i_on].ton == 60 && i_off < i_on);
    PRUEF_NAH(t.l[90000], 0.25 * MITTE, 1e-6);   // Prüfsenke rendert den Impuls auf das Ziel-Sample
    PRUEF_NAH(t.l[89999], 0.0, 0.0);
  }
  {  // 2: interne Senke (Vorhalt 0): Note von 23 Samples geht im selben Block an und aus, Off nach On
    Treiber t;
    PruefSenke rb(0);
    t.senken.push_back(&rb);
    t.arr.setze_senke_intern(&rb);
    t.laden(Bau().spur(3, ArrArt::intern).note(3, "b/n1", 0.5, 0.001, 36).fertig());
    t.arr.start(0.0, 2, false, 0, V, 256, t.k);
    t.lauf(102400);
    PRUEF(rb.ev.size() == 2 && rb.ev[0].an && rb.ev[0].ziel == 101250 && !rb.ev[1].an && rb.ev[1].ziel == 101273);
    PRUEF(rb.ev.size() == 2 && rb.ev[0].block_s0 == 101120 && rb.ev[1].block_s0 == 101120);
  }
  {  // 3: Tausch bei 99 840: gelöscht und anderes Ende -> Off bei 99 840 + 537; unverändert -> kein Off
    for (int fall = 0; fall < 3; ++fall) {
      Treiber t;
      PruefSenke w(V);
      t.senken.push_back(&w);
      t.arr.setze_senke_wirt(1, &w);
      t.laden(Bau().spur(2, ArrArt::wirt, 1).note(2, "m/n1", 0.0, 4.0, 60).fertig());
      t.arr.start(0.0, 2, false, 0, V, 256, t.k);
      t.lauf(99840);
      Bau neu(2);
      neu.spur(2, ArrArt::wirt, 1);
      if (fall == 1) neu.note(2, "m/n1", 0.0, 3.0, 60);   // anderes Ende
      if (fall == 2) neu.note(2, "m/n1", 0.0, 4.0, 60);   // unverändert
      t.laden(neu.fertig());
      const auto off = w.offs();
      if (fall < 2) {
        PRUEF(off.size() == 1 && off[0].ziel == 99840 + V && off[0].ton == 60);
        PRUEF(t.arr.offene_noten() == 0);
      } else {
        PRUEF(off.empty() && t.arr.offene_noten() == 1);
        t.lauf(200000);
        PRUEF(w.offs().size() == 1 && w.offs()[0].ziel == 180000);
      }
    }
  }
  {  // 4: Stopp sofort bei 99 840: Off der offenen Note dort, All-Notes-Off der Spur
    Treiber t;
    PruefSenke w(V);
    t.senken.push_back(&w);
    t.arr.setze_senke_wirt(1, &w);
    t.laden(Bau().spur(2, ArrArt::wirt, 1).note(2, "m/n1", 0.0, 4.0, 60).fertig());
    t.arr.start(0.0, 2, false, 0, V, 256, t.k);
    t.lauf(99840);
    t.arr.stopp(0, t.s, t.k);
    t.lauf(100352);
    PRUEF(w.offs().size() == 1 && w.offs()[0].ziel == 99840);
    PRUEF(w.alle_aus_ev.size() == 1 && w.alle_aus_ev[0].first == 1 && w.alle_aus_ev[0].second == 99840);
    PRUEF(t.arr.offene_noten() == 0);
  }
  {  // 5: Stopp vor dem Einsatz: die vorab gesendete Note bekommt ihr Off auf ihr On (90 000)
    Treiber t;
    PruefSenke w(V);
    t.senken.push_back(&w);
    t.arr.setze_senke_wirt(1, &w);
    t.laden(Bau().spur(2, ArrArt::wirt, 1).note(2, "m/n1", 0.0, 1.0, 60).fertig());
    t.arr.start(0.0, 2, false, 0, V, 256, t.k);
    t.lauf(89600);
    PRUEF(w.ons().size() == 1 && t.arr.status() == ArrStatus::wartet);
    t.arr.stopp(0, t.s, t.k);
    PRUEF(w.offs().size() == 1 && w.offs()[0].ziel == 90000);
    PRUEF(t.arr.status() == ArrStatus::steht);
  }
  {  // 6: Liste voll: 300 gleichzeitige Noten -> 256 offen, 44 gezählt verloren, keine hängende Note
    Treiber t;
    PruefSenke rb(0);
    t.senken.push_back(&rb);
    t.arr.setze_senke_intern(&rb);
    Bau b;
    b.spur(3, ArrArt::intern);
    for (int i = 0; i < 300; ++i) b.note(3, ("b/n" + std::to_string(i)).c_str(), 0.0, 1.0, i % 128);
    t.laden(b.fertig());
    t.arr.start(0.0, 2, false, 0, V, 256, t.k);
    t.lauf(90112);
    PRUEF(t.arr.offene_noten() == 256);
    PRUEF(t.arr.noten_verloren() == 44);
    t.lauf(113000);
    PRUEF(rb.ons().size() == 256 && rb.offs().size() == 256);
  }
  {  // 7: K1-Fix 2 (Spec 2.2, §4.11): Vorausblick über die Naht. Loop 0..4 ab Takt (Einsatz 90 000, Nähte 180 000 und
     // 270 000), Wirt-Vorhalt 537. Die Fenster der Blöcke kurz vor der Naht liegen schon hinter bis; sie bilden über die
     // Klammer ab. Note A auf 0,02 und 0,016 (450 bzw. 360 Samples nach jeder Naht, also im Bereich (Naht, Naht + V)),
     // Note B auf 4,02 (knapp hinter bis) klingt nie. Gegenprobe: Note auf 0,25 (weit hinter dem Vorhalt).
    for (const double a : {0.02, 0.016, 0.25}) {
      Treiber t;
      PruefSenke w(V);
      t.senken.push_back(&w);
      t.arr.setze_senke_wirt(1, &w);
      t.laden(Bau().spur(2, ArrArt::wirt, 1).note(2, "m/a", a, 0.1, 60).note(2, "m/b", 4.0 + a, 0.1, 70).fertig());
      t.arr.loop(true, 0.0, 4.0, t.s, t.k);
      t.arr.start(0.0, 2, false, 0, V, 256, t.k);
      t.lauf(300000);
      const int64_t d = std::llround(a * SPB);
      std::vector<int64_t> soll{90000 + d, 180000 + d, 270000 + d}, ist;
      int n70 = 0;
      for (const auto& e : w.ons()) {
        if (e.ton == 60) ist.push_back(e.ziel);
        if (e.ton == 70) ++n70;
        PRUEF(rechtzeitig(e, V));
      }
      if (ist != soll || n70) {
        std::printf("Fall 7 a=%.3f: Ton 60 an", a);
        for (const int64_t z : ist) std::printf(" %lld", static_cast<long long>(z));
        std::printf(", Ton 70 %d mal\n", n70);
      }
      PRUEF(ist == soll);
      PRUEF(n70 == 0);
      PRUEF(w.offs().size() == w.ons().size());   // jedes On bekommt sein Off
    }
  }
  PRUEF_ENDE();
}
