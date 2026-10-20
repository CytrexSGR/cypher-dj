// D1 K1 Slice 5: Spur-Mixer des Moduls Arrangement (Spec D1 2.3, A6). Fader, Pan −3 dB, Mute und Solo mit 10-ms-Blende,
// Spitze nach dem Fader, Verlauf je Sample. Gleichwert 0,5 auf Spur 1 (und Spur 2), Start ab Takt (90 000).
// Mutationen: ARR_MUTE_HART (Fall 3), ARR_PAN_LINEAR (Fall 2) machen den Test rot.
#include "arr_bau.h"
#include "pruef.h"

using namespace arrtest;
using cdj::ArrArt;

static constexpr int64_t V = 537;
static const double MITTE = 0.70710677;

static void aufbau(Treiber& t, const cdj::ArrAudio* a, bool zwei = false) {
  Bau b;
  b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 8.0, a);
  if (zwei) b.spur(2, ArrArt::audio).clip(2, "c2", 0.0, 8.0, a);
  t.laden(b.fertig());
  t.arr.start(0.0, 2, false, 0, V, 256, t.k);
  t.lauf(99840);
}

int main() {
  auto a = Audio::gleich(400000);
  {  // 1: Fader −6,0206 dB (Faktor 0,5)
    Treiber t;
    aufbau(t, &a->a);
    t.arr.setze_sofort(t.tab.suche("spur/1/fader"), -6.0206f);
    t.lauf(100352);
    PRUEF_NAH(t.l[100000], 0.25 * MITTE, 1e-5);
    PRUEF_NAH(t.arr.wert(0, 0), -6.0206, 1e-6);
  }
  {  // 2: Pan: Mitte −3 dB je Seite, ganz rechts L 0 und R voll, ganz links umgekehrt
    Treiber t;
    aufbau(t, &a->a);
    PRUEF_NAH(t.l[99000], 0.5 * MITTE, 1e-6);
    PRUEF_NAH(t.r[99000], 0.5 * MITTE, 1e-6);
    t.arr.setze_sofort(t.tab.suche("spur/1/pan"), 1.0f);
    t.lauf(100352);
    PRUEF_NAH(t.l[100000], 0.0, 1e-6);
    PRUEF_NAH(t.r[100000], 0.5, 1e-6);
    t.arr.setze_sofort(t.tab.suche("spur/1/pan"), -1.0f);
    t.lauf(100864);
    PRUEF_NAH(t.l[100500], 0.5, 1e-6);
    PRUEF_NAH(t.r[100500], 0.0, 1e-6);
  }
  {  // 3: Mute ab 99 840 über 480 Samples linear auf 0, danach still; zurück ebenso
    Treiber t;
    aufbau(t, &a->a);
    t.arr.setze_sofort(t.tab.suche("spur/1/mute"), 1.0f);
    t.lauf(101000);
    PRUEF_NAH(t.l[99839], 0.5 * MITTE, 1e-6);
    PRUEF_NAH(t.l[99840], 0.5 * MITTE * (1.0 - 1.0 / 480.0), 1e-6);
    PRUEF_NAH(t.l[100079], 0.5 * MITTE * 0.5, 1e-5);
    PRUEF_NAH(t.l[100319], 0.0, 0.0);
    PRUEF_NAH(t.l[100500], 0.0, 0.0);
  }
  {  // 4: Solo auf Spur 2: Spur 1 blendet aus, Spur 2 bleibt (Summe = nur Spur 2)
    Treiber t;
    aufbau(t, &a->a, true);
    PRUEF_NAH(t.l[99000], 1.0 * MITTE, 1e-6);
    t.arr.setze_sofort(t.tab.suche("spur/2/solo"), 1.0f);
    t.lauf(101000);
    PRUEF_NAH(t.l[100500], 0.5 * MITTE, 1e-6);
  }
  {  // 5: Spitze nach dem Fader, beim Lesen zurückgesetzt; leere Spur 0
    Treiber t;
    aufbau(t, &a->a);
    PRUEF_NAH(t.arr.spitze_lesen(0), 0.5 * MITTE, 1e-6);
    PRUEF_NAH(t.arr.spitze_lesen(0), 0.0, 0.0);
    PRUEF_NAH(t.arr.spitze_lesen(1), 0.0, 0.0);
    PRUEF(t.arr.spur_belegt(0) && !t.arr.spur_belegt(1));
  }
  {  // 6: Verlauf je Sample: Fader stumm in der ersten Blockhälfte, 0 dB in der zweiten
    Treiber t;
    aufbau(t, &a->a);
    float vl[256];
    for (int i = 0; i < 256; ++i) vl[i] = i < 128 ? -200.0f : 0.0f;
    t.arr.verlauf(t.tab.suche("spur/1/fader"), vl);
    t.lauf(100096);
    PRUEF_NAH(t.l[99840 + 127], 0.0, 0.0);
    PRUEF_NAH(t.l[99840 + 128], 0.5 * MITTE, 1e-6);
    PRUEF_NAH(t.arr.wert(0, 0), 0.0, 0.0);   // nach dem Block der letzte Verlaufswert
  }
  PRUEF_ENDE();
}
