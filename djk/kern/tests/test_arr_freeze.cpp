// Paket K3 (Spec D1 2.5, 3.1 /k/arr/freeze): Freeze am Modul Arrangement allein. Ein Freeze schneidet das Spur-Signal vor
// dem Fader ab dem Einsatz-Sample (bis − von + 2) Beats lang mit, setzt die Loop-Klammer aus und stellt sie danach
// wieder her, meldet Status 3 und endet mit Stopp. Abbruch durch Stopp (wartend und spielend) und Tausch, Ablehnungen.
// Mutationen: ARR_FREEZE_NACH_FADER (Fall 1 rot: Abgriff nach dem Fader), ARR_FREEZE_LOOP_BLEIBT (Fall 2 rot),
// ARR_FREEZE_START_BEAT_BLEIBT (Fall 6 rot, Fix L10).
#include <cstdio>
#include <cstring>

#include "arr_bau.h"
#include "pruef.h"

using arrtest::SPB;

namespace {

cdj::ArrFreeze auftrag(int spur, double von, double bis, double kap_beats = 64.0) {
  cdj::ArrFreeze f;
  f.spur = spur;
  f.kennung = 7;
  f.von_beat = von;
  f.bis_beat = bis;
  f.kap = static_cast<int64_t>(kap_beats * 48000.0);
  f.daten.assign(static_cast<size_t>(f.kap) * 2, -9.0f);   // vorbelegt: was nicht geschrieben wurde, fällt auf
  return f;
}

}  // namespace

int main() {
  auto imp = arrtest::Audio::impuls(4800);
  // 1: Abgriff vor dem Fader, Einsatz-Sample, Länge mit Nachlauf, Status 3, Ende mit Stopp
  {
    arrtest::Treiber t;
    arrtest::Bau b;
    b.spur(1, cdj::ArrArt::audio).clip(1, "c0", 0.0, 1.0, &imp->a).clip(1, "c4", 4.0, 1.0, &imp->a)
        .clip(1, "c5", 5.0, 1.0, &imp->a);
    b.spur(2, cdj::ArrArt::audio).clip(2, "d0", 0.0, 1.0, &imp->a);
    t.laden(b.fertig());
    t.arr.setze_sofort(t.tab.suche("spur/1/fader"), -6.0f);
    cdj::ArrFreeze f = auftrag(1, 0.0, 4.0);
    const char* grund = "";
    PRUEF(t.arr.freeze(&f, 0, false, 0, 0, t.n, t.k, grund));
    PRUEF(f.start_s == 256 && f.frames == 6 * SPB);
    PRUEF(t.arr.zustand(t.k, 0).status == cdj::ArrStatus::freeze);
    t.lauf(256 + 6 * SPB + 4096);
    PRUEF(f.daten[0] == 1.0f && f.daten[1] == 1.0f);                    // Einsatz-Sample, vor dem Fader (−6 dB wäre 0,5)
    PRUEF(f.daten[2] == 0.0f);
    PRUEF(f.daten[2 * 4 * SPB] == 1.0f && f.daten[2 * 5 * SPB] == 1.0f);  // Beat 4 (bis) und 5 im Nachlauf
    PRUEF(f.daten[2 * 6 * SPB] == -9.0f);                                 // hinter dem Ende nichts geschrieben
    PRUEF_NAH(t.l[256], (0.5011872 + 1.0) * 0.70710678, 1e-5);          // Ausgang: Spur 1 mit −6 dB, Spur 2 mit 0 dB, Pan Mitte
    PRUEF(t.arr.hole_freeze_gestartet() == 256 && t.arr.hole_freeze_gestartet() == -1);
    cdj::ArrFreeze* fertig = t.arr.hole_freeze_fertig();
    PRUEF(fertig == &f && f.status == 0 && f.ende_s == 256 + 6 * SPB && !t.arr.hole_freeze_fertig());
    PRUEF(t.arr.status() == cdj::ArrStatus::steht && t.arr.zustand(t.k, t.s).status == cdj::ArrStatus::steht);
  }
  // 2: Loop-Klammer ist während des Freeze ausgesetzt und gilt danach wieder; /zustand/arr meldet sie unverändert
  {
    arrtest::Treiber t;
    arrtest::Bau b;
    b.spur(1, cdj::ArrArt::audio).clip(1, "c0", 0.0, 1.0, &imp->a).clip(1, "c4", 4.0, 1.0, &imp->a);
    t.laden(b.fertig());
    t.arr.loop(true, 0.0, 2.0, t.s, t.k);
    cdj::ArrFreeze f = auftrag(1, 0.0, 6.0);
    const char* grund = "";
    PRUEF(t.arr.freeze(&f, 0, false, 0, 0, t.n, t.k, grund));
    PRUEF(t.arr.zustand(t.k, 0).loop_an);
    t.lauf(256 + 8 * SPB + 4096);
    PRUEF(f.daten[2 * 2 * SPB] == 0.0f);   // keine Naht bei Beat 2 (dort setzte c0 sonst wieder ein)
    PRUEF(f.daten[2 * 4 * SPB] == 1.0f);   // linear über die Klammer hinaus
    PRUEF(t.arr.hole_freeze_fertig() == &f && f.status == 0);
    PRUEF(t.arr.zustand(t.k, t.s).loop_an);
    t.arr.loop(false, 0.0, 2.0, t.s, t.k);
    PRUEF(!t.arr.zustand(t.k, t.s).loop_an);
  }
  // 3: Abbruch durch Stopp, spielend (am Stopp-Sample) und wartend (sofort)
  {
    arrtest::Treiber t;
    arrtest::Bau b;
    b.spur(1, cdj::ArrArt::audio).clip(1, "c0", 0.0, 1.0, &imp->a);
    t.laden(b.fertig());
    cdj::ArrFreeze f = auftrag(1, 0.0, 8.0);
    const char* grund = "";
    PRUEF(t.arr.freeze(&f, 0, false, 0, 0, t.n, t.k, grund));
    t.lauf(2 * SPB);
    const int64_t s_stopp = t.s;
    t.arr.stopp(0, t.s, t.k);
    t.lauf(t.s + 4096);
    cdj::ArrFreeze* x = t.arr.hole_freeze_fertig();
    PRUEF(x == &f && f.status == 1 && f.ende_s == s_stopp);
    PRUEF(t.arr.status() == cdj::ArrStatus::steht);
    cdj::ArrFreeze g = auftrag(1, 0.0, 8.0);
    PRUEF(t.arr.freeze(&g, 0, false, t.s, 0, t.n, t.k, grund));
    t.arr.stopp(0, t.s, t.k);   // noch vor dem Einsatz
    PRUEF(t.arr.hole_freeze_fertig() == &g && g.status == 1 && g.ende_s == t.s);
    PRUEF(t.arr.hole_freeze_gestartet() == -1);
  }
  // 4: Tausch der Wiedergabe bricht ab
  {
    arrtest::Treiber t;
    arrtest::Bau b1, b2;
    b1.spur(1, cdj::ArrArt::audio).clip(1, "c0", 0.0, 1.0, &imp->a);
    b2.spur(1, cdj::ArrArt::audio).clip(1, "c0", 0.0, 1.0, &imp->a);
    t.laden(b1.fertig());
    cdj::ArrFreeze f = auftrag(1, 0.0, 8.0);
    const char* grund = "";
    PRUEF(t.arr.freeze(&f, 0, false, 0, 0, t.n, t.k, grund));
    t.lauf(SPB);
    const int64_t s_tausch = t.s;
    t.laden(b2.fertig());
    t.lauf(t.s + 4096);
    PRUEF(t.arr.hole_freeze_fertig() == &f && f.status == 1 && f.ende_s == s_tausch);
  }
  // 5: Ablehnungen: nicht geladen, Spur leer, Überlappung (Transport läuft, Freeze läuft), Puffer zu klein
  {
    arrtest::Treiber t;
    cdj::ArrFreeze f = auftrag(1, 0.0, 4.0);
    const char* grund = "";
    PRUEF(!t.arr.freeze(&f, 0, false, 0, 0, t.n, t.k, grund) && !std::strcmp(grund, "nicht_geladen"));
    arrtest::Bau b;
    b.spur(1, cdj::ArrArt::audio).clip(1, "c0", 0.0, 1.0, &imp->a);
    t.laden(b.fertig());
    cdj::ArrFreeze leer = auftrag(3, 0.0, 4.0);
    PRUEF(!t.arr.freeze(&leer, 0, false, 0, 0, t.n, t.k, grund) && !std::strcmp(grund, "spur_bereich"));
    cdj::ArrFreeze klein = auftrag(1, 0.0, 4.0, 5.0);   // 5 Beats bei 60 BPM sind 240 000 Frames, gebraucht 6 · 22 500
    PRUEF(t.arr.freeze(&klein, 0, false, 0, 0, t.n, t.k, grund));
    t.arr.stopp(0, 0, t.k);
    PRUEF(t.arr.hole_freeze_fertig() == &klein);
    cdj::ArrFreeze winzig = auftrag(1, 0.0, 4.0, 2.0);  // 96 000 Frames < 135 000
    PRUEF(!t.arr.freeze(&winzig, 0, false, 0, 0, t.n, t.k, grund) && !std::strcmp(grund, "zu_gross"));
    PRUEF(t.arr.status() == cdj::ArrStatus::steht && !t.arr.freeze_laeuft() && !t.arr.hole_freeze_fertig());
    PRUEF(t.arr.start(0.0, 0, false, 0, 0, t.n, t.k));
    PRUEF(!t.arr.freeze(&f, 0, false, 0, 0, t.n, t.k, grund) && !std::strcmp(grund, "ueberlappung"));
  }
  // 6 (Fix L10): ein Freeze lässt den start_beat des Nutzers stehen wie die Loop-Klammer, nach dem Ende (a) und nach einem
  // Abbruch (b); /zustand/arr meldet ihn auch während des Freeze. Gemessen vor dem Fix: 8,0 -> 2,0. Mutation
  // ARR_FREEZE_START_BEAT_BLEIBT (der Freeze-Start bleibt stehen) macht den Fall rot.
  {
    arrtest::Treiber t;
    arrtest::Bau b;
    b.spur(1, cdj::ArrArt::audio).clip(1, "c0", 0.0, 1.0, &imp->a);
    t.laden(b.fertig());
    PRUEF(t.arr.start(8.0, 0, false, 0, 4096, t.n, t.k));   // der Nutzer setzt start_beat 8 und stoppt vor dem Einsatz
    t.arr.stopp(0, 0, t.k);
    PRUEF(t.arr.status() == cdj::ArrStatus::steht && t.arr.start_beat() == 8.0);
    cdj::ArrFreeze f = auftrag(1, 2.0, 3.0);
    const char* grund = "";
    PRUEF(t.arr.freeze(&f, 0, false, t.s, 0, t.n, t.k, grund));
    PRUEF(t.arr.zustand(t.k, t.s).start_beat == 8.0);
    t.lauf(t.s + 256 + 3 * SPB + 4096);
    PRUEF(t.arr.hole_freeze_fertig() == &f && f.status == 0);
    std::printf("Fall 6a: start_beat nach dem Freeze %.1f (Freeze ab Beat 2)\n", t.arr.start_beat());
    PRUEF(t.arr.start_beat() == 8.0 && t.arr.zustand(t.k, t.s).start_beat == 8.0);
    cdj::ArrFreeze g = auftrag(1, 2.0, 6.0);
    PRUEF(t.arr.freeze(&g, 0, false, t.s, 0, t.n, t.k, grund));
    t.lauf(t.s + SPB);
    t.arr.stopp(0, t.s, t.k);
    t.lauf(t.s + 4096);
    PRUEF(t.arr.hole_freeze_fertig() == &g && g.status == 1);
    std::printf("Fall 6b: start_beat nach dem Abbruch %.1f\n", t.arr.start_beat());
    PRUEF(t.arr.start_beat() == 8.0);
  }
  PRUEF_ENDE();
}
