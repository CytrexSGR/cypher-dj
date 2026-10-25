// D1 K1 Slice 5: Spur-Mixer des Moduls Arrangement (Spec D1 2.3, A6). Fader, Pan −3 dB, Mute und Solo mit 10-ms-Blende,
// Spitze nach dem Fader, Verlauf je Sample. Gleichwert 0,5 auf Spur 1 (und Spur 2), Start ab Takt (90 000).
// Mutationen: ARR_MUTE_HART (Fall 3), ARR_PAN_LINEAR (Fall 2) machen den Test rot.
#include <cstdlib>
#include <cstring>
#include <string>

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
  {  // E3 S1: Ausdrucksvergleich; der Verhaltensfall (regler_binden mit spur/10) folgt in Task 6, sobald die Tabelle spur/10 hat.
     // "spur/10/fader" ergäbe mit pfad[5] - '1' den Index 0 (Spur 1), spur_nr() - 1 den Index 9.
    const char* pfad = "spur/10/fader";
    PRUEF(pfad[5] - '1' == 0);                          // der alte Ausdruck: falsch
    PRUEF(cypherdj::stellwerk::spur_nr(pfad) - 1 == 9);  // richtig
    PRUEF(cypherdj::stellwerk::spur_nr("spur/3/pan") - 1 == 2);   // Negativ-Kontrolle: einstellig unverändert
  }
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
  {  // 6b: E3 Task 6, Verhaltensfall zu Task 1: regler_binden mit der ECHTEN Tabelle bindet spur/10/fader an Index 9
     // (Mutante pfad[5] - '1' in arr_ausgang.cpp ergäbe Index 0: Spur 10 bliebe bei 0 dB, Spur 1 bekäme den Wert).
    Treiber t;
    Bau b;
    b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 8.0, &a->a);
    t.laden(b.fertig());
    const int r10 = t.tab.suche("spur/10/fader"), r32 = t.tab.suche("spur/32/pan");
    PRUEF(r10 >= 0 && r32 >= 0);   // die Tabelle kennt Spur 10 und 32 (T03)
    t.arr.setze_sofort(r10, -12.0f);
    t.arr.setze_sofort(r32, 0.5f);
    PRUEF_NAH(t.arr.wert(9, 0), -12.0, 0.0);    // Spur 10 = Index 9
    PRUEF_NAH(t.arr.wert(0, 0), 0.0, 0.0);      // Negativ-Kontrolle: Spur 1 unberührt
    PRUEF_NAH(t.arr.wert(31, 1), 0.5, 0.0);     // Spur 32 = Index 31
    PRUEF_NAH(t.arr.wert(2, 1), 0.0, 0.0);      // Negativ-Kontrolle: Spur 3 unberührt
  }
  for (int verlauf = 0; verlauf < 2; ++verlauf) {   // 6c: Solo auf Spur 20 (E3 Task 6, Mutante j < 8 im Verlaufs-Scan)
    // Spur 1, 20 und 32 belegt, je 0,5. Solo auf Spur 20 stummt Spur 1 und 32 (beide über 8). verlauf = 1: Solo als
    // Verlauf (Vorberechnung je Block, solo_vl), verlauf = 0: festes Solo (solo_fest). Nicht binär zur alten Referenz,
    // die nur Spur 1 bis 8 kennt.
    Treiber t;
    Bau b;
    for (int sp : {1, 20, 32}) {
      const std::string id = "c" + std::to_string(sp);
      b.spur(sp, ArrArt::audio).clip(sp, id.c_str(), 0.0, 8.0, &a->a);
    }
    t.laden(b.fertig());
    t.arr.start(0.0, 2, false, 0, V, 256, t.k);
    t.lauf(99840);
    PRUEF_NAH(t.l[99000], 1.5 * MITTE, 1e-6);   // vor dem Solo klingen alle drei
    static float ein[256];
    for (float& x : ein) x = 1.0f;
    if (verlauf) t.arr.verlauf(t.tab.suche("spur/20/solo"), ein);
    else t.arr.setze_sofort(t.tab.suche("spur/20/solo"), 1.0f);
    t.lauf(101000);
    PRUEF_NAH(t.l[100500], 0.5 * MITTE, 1e-6);   // nur Spur 20 bleibt
  }
  {  // 7: E3 S1 Task 5 (P5): Solo-Scan je Block vorberechnet, bitgleich zum Scan je Spur und Sample.
     // 8 belegte Spuren, Solo-Verläufe auf Spur 2, 5 und 7 (Spur 7: Stufe genau 0,5, die Schwelle),
     // Fader- und Pan-Verlauf auf Spur 1 und 4. Ab Block 4 hat Spur 3 festes Solo neben den Verläufen
     // (Verlauf und fest gemischt), ab Block 8 gibt es keinen Verlauf mehr (nur festes Solo auf 3 und 6).
     // Zehn Blöcke zu 256. Vergleich per memcmp mit tests/daten/arr_mixer_solo_ref.bin (L dann R, rohe Floats),
     // erzeugt mit dem ALTEN Code (ERZEUGE_REF=1; der Lauf scheitert dann absichtlich).
     // Die Referenz gilt nur für x86-64 ohne FMA-Kontraktion: mit FMA (-march=x86-64-v3 oder native) rechnet
     // GCC Fader und Pan anders (bis 2 ulp, auch mit altem Code). Dann wird der Fall übersprungen und gemeldet,
     // er gilt nicht als geprüft.
#if defined(__FMA__)
    std::fprintf(stderr, "übersprungen: Referenz gilt nur für x86-64 ohne FMA-Kontraktion (Fall 7 nicht geprüft)\n");
  }
#else
    std::unique_ptr<Audio> au[8];
    Bau b;
    for (int i = 0; i < 8; ++i) {
      au[i] = Audio::gleich(400000, 0.05f * static_cast<float>(i + 1));
      static const char* const ID[8] = {"c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8"};
      b.spur(i + 1, ArrArt::audio).clip(i + 1, ID[i], 0.0, 8.0, &au[i]->a);
    }
    Treiber t;
    t.laden(b.fertig());
    t.arr.start(0.0, 2, false, 0, V, 256, t.k);
    t.lauf(99840);
    const size_t v0 = t.l.size();
    constexpr int BL = 10, N = 256;
    auto reg = [&](const char* name) { return t.tab.suche(name); };
    static float fa[N], pa[N], s2[N], s5[N], s7[N], f4[N], p4[N];
    for (int k = 0; k < BL; ++k) {
      if (k < 8) {
        for (int i = 0; i < N; ++i) {
          const int g = k * N + i;   // Index im Zehn-Block-Lauf
          fa[i] = -24.0f + 24.0f * static_cast<float>(g) / (8.0f * N);
          pa[i] = std::sin(static_cast<float>(g) * 0.01f);
          f4[i] = -3.0f - 0.002f * static_cast<float>(g);
          p4[i] = -0.8f + 1.6f * static_cast<float>(g % 700) / 700.0f;
          s2[i] = (g >= 40 && g < 200) ? 1.0f : 0.0f;
          s5[i] = (g >= 128 && g < 1000) ? 1.0f : 0.0f;
          s7[i] = (g >= 1004 && g < 1020) ? 0.5f : 0.0f;   // allein: nur die Schwelle hält hier Solo
        }
        t.arr.verlauf(reg("spur/1/fader"), fa);
        t.arr.verlauf(reg("spur/1/pan"), pa);
        t.arr.verlauf(reg("spur/4/fader"), f4);
        t.arr.verlauf(reg("spur/4/pan"), p4);
        t.arr.verlauf(reg("spur/2/solo"), s2);
        t.arr.verlauf(reg("spur/5/solo"), s5);
        t.arr.verlauf(reg("spur/7/solo"), s7);
      } else if (k == 8) {
        t.arr.setze_sofort(reg("spur/6/solo"), 1.0f);   // fest, ohne Verlauf: der solo_fest-Zweig
      }
      if (k == 4) t.arr.setze_sofort(reg("spur/3/solo"), 1.0f);   // fest neben den Verläufen (Mischfall)
      t.lauf(99840 + static_cast<int64_t>(k + 1) * N);
    }
    PRUEF(t.l.size() == v0 + static_cast<size_t>(BL) * N);
    std::vector<float> ist(t.l.begin() + static_cast<long>(v0), t.l.end());
    ist.insert(ist.end(), t.r.begin() + static_cast<long>(v0), t.r.end());
    const std::string ref = std::string(CYPHERDJ_DJK) + "/kern/tests/daten/arr_mixer_solo_ref.bin";
    if (std::getenv("ERZEUGE_REF")) {
      std::FILE* f = std::fopen(ref.c_str(), "wb");
      PRUEF(f != nullptr);
      if (f) {
        PRUEF(std::fwrite(ist.data(), sizeof(float), ist.size(), f) == ist.size());
        std::fclose(f);
      }
      PRUEF(!"Referenz geschrieben, nicht geprüft (ERZEUGE_REF ist gesetzt)");
    } else {
      std::vector<float> soll(ist.size());
      std::FILE* f = std::fopen(ref.c_str(), "rb");
      PRUEF(f != nullptr);   // fehlt die Referenz, ist der Test rot, nicht still grün
      if (f) {
        PRUEF(std::fread(soll.data(), sizeof(float), soll.size(), f) == soll.size());
        std::fclose(f);
        PRUEF(std::memcmp(ist.data(), soll.data(), ist.size() * sizeof(float)) == 0);
      }
    }
    float spanne = 0.0f;   // Kontrolle, dass der Aufbau Solo wirklich bewegt: die Summe schwankt
    for (float x : ist) spanne = std::max(spanne, std::fabs(x));
    PRUEF(spanne > 0.1f);
  }
#endif
  PRUEF_ENDE();
}
