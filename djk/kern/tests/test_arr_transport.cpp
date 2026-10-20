// D1 K1 Slice 4: Transport des Moduls Arrangement (Spec D1 2.2). Start-Regel (jetzt + Vorhalt 2n + 25 + 1 Zyklus),
// Quantisierung (sofort, Beat, Takt mit (Kern-Beat − start_beat) ≡ 0 mod 4), Stopp mit Quant, Loop-Klammer mit Wrap am
// Sample der Naht, Neustart eines laufenden Transports, KI-Stopp. 128 BPM: 22 500 Samples je Beat, Blöcke zu 256.
// Mutationen: CYPHERDJ_MUTATION_ARR_START_OHNE_VORHALT (Fall 1 rot), CYPHERDJ_MUTATION_ARR_NAHT_BLOCKANFANG (Fall 5 rot),
// CYPHERDJ_MUTATION_ARR_KLAMMER_OHNE_START (Fall 10 rot: Start auf oder hinter bis springt in die Klammer),
// CYPHERDJ_MUTATION_ARR_KLAMMER_HINTER_KOPF (Fall 11 rot: eine Klammer hinter dem Kopf greift, die Naht liegt in der
// Vergangenheit), CYPHERDJ_MUTATION_ARR_KLAMMER_NAHT_ZYKLUS (Fall 11c rot: die gleiche Klammer, im Naht-Zyklus erneut
// gesetzt, schaltet über p < bis ab und der Transport läuft linear).
#include <algorithm>
#include <cstdio>
#include <string>
#include <vector>

#include "arr_bau.h"
#include "pruef.h"

using namespace arrtest;
using cdj::ArrArt;
using cdj::ArrStatus;

static constexpr int64_t V = 2 * 256 + 25;   // Vorhalt bei Quantum 256: 537

int main() {
  auto a = Audio::impuls(1000);
  auto schnapp = [&] { return Bau().spur(1, ArrArt::audio).clip(1, "c1", 0.0, 1.0, &a->a).fertig(); };
  {  // 1: sofort aus dem Stand: Einsatz = 0 + 537 + 256 = 793
    Treiber t;
    t.laden(schnapp());
    PRUEF(t.arr.start(0.0, 0, false, 0, V, 256, t.k));
    PRUEF(t.arr.status() == ArrStatus::wartet);
    t.lauf(2048);
    PRUEF(t.arr.hole_gestartet() == 793);
    PRUEF(t.arr.status() == ArrStatus::spielt);
    const cdj::ArrZustand z = t.arr.zustand(t.k, 793);
    PRUEF(z.ursprung_sample == 793 && z.nr == 1 && z.status == ArrStatus::spielt);
    PRUEF_NAH(z.projekt_beat, 0.0, 1e-9);
    PRUEF_NAH(t.arr.zustand(t.k, 793 + SPB).projekt_beat, 1.0, 1e-9);
  }
  {  // 2: quant 1 bei s = 1000: frühestens 1793 (Beat 0,0797) -> Kern-Beat 1 = 22 500
    Treiber t;
    t.laden(schnapp());
    t.lauf(1024);
    PRUEF(t.arr.start(0.0, 1, false, 1024, V, 256, t.k));
    t.lauf(30000);
    PRUEF(t.arr.hole_gestartet() == 22500);
  }
  {  // 3: quant 2: start_beat 0 -> Kern-Beat 4; start_beat 2 -> Kern-Beat 2; start_beat 1,5 -> Kern-Beat 1,5
    const double sb[] = {0.0, 2.0, 1.5};
    const int64_t soll[] = {90000, 45000, 33750};
    for (int i = 0; i < 3; ++i) {
      Treiber t;
      t.laden(schnapp());
      PRUEF(t.arr.start(sb[i], 2, false, 0, V, 256, t.k));
      t.lauf(100000);
      const int64_t g = t.arr.hole_gestartet();
      PRUEF(g == soll[i]);
      PRUEF_NAH(std::fmod(t.k.beat_at(static_cast<double>(g)) - sb[i], 4.0), 0.0, 1e-9);   // Invariante mod 4
    }
  }
  {  // 4: ohne Schnappschuss kein Start (Kern: nicht_geladen)
    Treiber t;
    PRUEF(!t.arr.start(0.0, 0, false, 0, V, 256, t.k));
    PRUEF(t.arr.status() == ArrStatus::steht);
  }
  {  // 5: Loop 0..4 ab Takt: Nähte genau bei 180 000 und 270 000, danach p wieder ab 0
    Treiber t;
    t.laden(schnapp());
    t.arr.loop(true, 0.0, 4.0, t.s, t.k);
    PRUEF(t.arr.start(0.0, 2, false, 0, V, 256, t.k));
    t.lauf(180224);
    PRUEF(t.arr.letzte_naht() == 180000);
    PRUEF_NAH(t.arr.zustand(t.k, 180000).projekt_beat, 0.0, 1e-9);
    t.lauf(270336);
    PRUEF(t.arr.letzte_naht() == 270000);
    PRUEF_NAH(t.arr.zustand(t.k, 270000 + 11250).projekt_beat, 0.5, 1e-9);
    // Negativ-Kontrolle: Loop aus, keine weitere Naht
    t.arr.loop(false, 0.0, 4.0, t.s, t.k);
    t.lauf(400000);
    PRUEF(t.arr.letzte_naht() == 270000);
  }
  {  // 6: Stopp mit Quant: Start 90 000, Stopp bei 99 840 -> Beat (112 500), Takt (180 000), sofort (99 840)
    const int q[] = {1, 2, 0};
    const int64_t soll[] = {112500, 180000, 99840};
    for (int i = 0; i < 3; ++i) {
      Treiber t;
      t.laden(schnapp());
      t.arr.start(0.0, 2, false, 0, V, 256, t.k);
      t.lauf(99840);
      t.arr.hole_gestartet();
      t.arr.stopp(q[i], t.s, t.k);
      PRUEF(t.arr.status() == ArrStatus::spielt);
      t.lauf(200000);
      PRUEF(t.arr.hole_gestoppt() == soll[i]);
      PRUEF(t.arr.status() == ArrStatus::steht);
    }
  }
  {  // 7: Stopp auf den Takt, die Naht kommt vorher: Loop 0..2, Naht 135 000, Stopp an der Naht
    Treiber t;
    t.laden(schnapp());
    t.arr.loop(true, 0.0, 2.0, t.s, t.k);
    t.arr.start(0.0, 2, false, 0, V, 256, t.k);
    t.lauf(120064);
    t.arr.stopp(2, t.s, t.k);
    t.lauf(200000);
    PRUEF(t.arr.hole_gestoppt() == 135000);
  }
  {  // 8: Start während er läuft: endet sofort, neuer Einsatz nach der Regel
    Treiber t;
    t.laden(schnapp());
    t.arr.start(0.0, 2, false, 0, V, 256, t.k);
    t.lauf(99840);
    t.arr.hole_gestartet();
    PRUEF(t.arr.start(0.0, 0, false, t.s, V, 256, t.k));
    PRUEF(t.arr.hole_gestoppt() == 99840);
    t.lauf(110000);
    PRUEF(t.arr.hole_gestartet() == 99840 + 793);
  }
  {  // 9: E-a (2026-10-20): der KI-Stopp beendet einen LAUFENDEN Transport nicht, auch keinen von cypher gestarteten (vorher steht bei cy == 1, gestoppt bei 99840;
     // der Einsatz war bei 90 000)
    for (int cy = 0; cy < 2; ++cy) {
      Treiber t;
      t.laden(schnapp());
      t.arr.start(0.0, 2, cy == 1, 0, V, 256, t.k);
      t.lauf(99840);
      t.arr.ki_stopp(t.s, t.k);
      t.lauf(100352);
      PRUEF(t.arr.status() == ArrStatus::spielt);
      PRUEF(t.arr.hole_gestoppt() == -1);
    }
  }
  {  // 9b: E-a: ein noch WARTENDER Start von cypher (Einsatz bei 90 000 steht aus) endet beim KI-Stopp sofort, wie vorher; ein wartender von Andreas nicht
    for (int cy = 0; cy < 2; ++cy) {
      Treiber t;
      t.laden(schnapp());
      t.arr.start(0.0, 2, cy == 1, 0, V, 256, t.k);
      t.lauf(40000);
      PRUEF(t.arr.status() == ArrStatus::wartet);
      const int64_t s0 = t.s;
      t.arr.ki_stopp(t.s, t.k);
      PRUEF(t.arr.status() == (cy == 1 ? ArrStatus::steht : ArrStatus::wartet));
      t.lauf(100352);
      if (cy == 1) {
        PRUEF(t.arr.hole_gestoppt() == s0);
        PRUEF(t.arr.hole_gestartet() == -1);
      } else {
        PRUEF(t.arr.hole_gestoppt() == -1);
        PRUEF(t.arr.hole_gestartet() == 90000);
      }
    }
  }
  {  // 10: Spec 2.2: start_beat auf oder hinter bis (Loop 0..8 an) spielt linear, die Klammer greift nicht. Audio-Impuls
     // auf Beat sb + 1, Note (interne Spur) auf sb + 1,5, Metronom: Einsatz sofort bei 793 (p = sb), dann je Beat weiter.
     // Gegenprobe sb = 4 (in der Klammer): Naht bei p = 8.
    for (const double sb : {8.0, 9.0, 4.0}) {
      auto a = Audio::impuls(1000);
      Treiber t;
      PruefSenke rb(0);
      t.senken.push_back(&rb);
      t.arr.setze_senke_intern(&rb);
      t.laden(Bau().spur(1, ArrArt::audio).clip(1, "c0", 0.0, 1.0, &a->a).clip(1, "c1", sb + 1.0, 1.0, &a->a)
                  .spur(2, ArrArt::intern).note(2, "m/n0", 0.0, 0.25, 36).note(2, "m/n1", sb + 1.5, 0.25, 38).fertig());
      t.arr.loop(true, 0.0, 8.0, t.s, t.k);
      t.arr.metronom(true, 0.0f, 0);
      PRUEF(t.arr.start(sb, 0, false, 0, V, 256, t.k));
      t.lauf(793 + 3 * SPB);
      const auto on = rb.ons();
      std::vector<int64_t> klick;
      for (int64_t i = 0; i < static_cast<int64_t>(t.ml.size()); ++i)
        if (std::fabs(t.ml[i]) > 0.05f && (klick.empty() || i - klick.back() > 1000)) klick.push_back(i);
      if (sb >= 8.0) {
        PRUEF(t.arr.letzte_naht() == -1);
        PRUEF_NAH(t.arr.zustand(t.k, 793 + SPB).projekt_beat, sb + 1.0, 1e-9);
        const std::vector<int64_t> soll_l{793 + SPB, 793 + SPB + SPB / 2};   // Clip c1, Note m/n1 (Impuls der Senke)
        PRUEF(t.treffer(0, 793 + 3 * SPB) == soll_l);
        PRUEF(on.size() == 1 && on[0].ton == 38 && on[0].ziel == 793 + SPB + SPB / 2);
        const std::vector<int64_t> soll_k{793, 793 + SPB, 793 + 2 * SPB, 793 + 3 * SPB};
        PRUEF(klick == soll_k);
      } else {   // Gegenprobe: Start in der Klammer, Naht bei p = 8 (793 + 4 Beats), dort wieder c0 und m/n0
        t.lauf(793 + 5 * SPB);
        PRUEF(t.arr.letzte_naht() == 793 + 4 * SPB);
        const auto on2 = rb.ons();   // m/n1 auf p = 5,5 im ersten Durchlauf, m/n0 auf der Naht (p = 0)
        PRUEF(on2.size() == 2 && on2[0].ton == 38 && on2[0].ziel == 793 + SPB + SPB / 2 && on2[1].ton == 36 &&
              on2[1].ziel == 793 + 4 * SPB);
      }
    }
  }
  {  // 11: Spec 2.2 (K1-Fix 1): die Loop-Klammer 0..4 wird eingeschaltet, während der Kopf schon hinter bis steht (p ~ 6).
     // Der Transport läuft linear weiter: kein Wrap, die Spitze bleibt beim Clip-Pegel (0,35 nach Pan-Gesetz), spätere
     // Clips setzen ein, Noten gehen hinaus, das Metronom klickt. Gegenprobe: dieselbe Klammer bei p ~ 2 (vor bis) greift.
    static const double MITTE = 0.70710677;
    for (const bool hinter : {true, false}) {
      const int64_t setzen = 793 + (hinter ? 6 : 2) * SPB + 1000;
      {  // a: Pegel. Ein Clip mit 0,35 über 16 Beats
        auto g = Audio::gleich(16 * SPB + 1000, 0.35f);
        Treiber t;
        t.laden(Bau().spur(1, ArrArt::audio).clip(1, "lang", 0.0, 16.0, &g->a).fertig());
        PRUEF(t.arr.start(0.0, 0, false, 0, V, 256, t.k));
        t.lauf(setzen);
        t.arr.loop(true, 0.0, 4.0, t.s, t.k);
        t.lauf(793 + 13 * SPB);
        float spitze = 0.0f;
        for (const float x : t.l) spitze = std::max(spitze, std::fabs(x));
        PRUEF(spitze <= 0.35f * MITTE + 1e-6f);
        if (spitze > 0.35f * MITTE + 1e-6f) std::printf("Fall 11 hinter=%d: Spitze %.4f (Soll <= %.4f)\n", hinter, spitze, 0.35 * MITTE);
        if (hinter) {
          PRUEF(t.arr.letzte_naht() == -1);
          PRUEF_NAH(t.arr.zustand(t.k, 793 + 12 * SPB).projekt_beat, 12.0, 1e-9);   // linear
          PRUEF_NAH(t.l[793 + 10 * SPB], 0.35 * MITTE, 1e-6);                        // der Clip klingt weiter
        } else {
          PRUEF(t.arr.letzte_naht() == 793 + 12 * SPB);   // die Naht greift (Nähte bei 4, 8, 12 Beats nach dem Einsatz)
          PRUEF_NAH(t.arr.zustand(t.k, 793 + 12 * SPB + SPB / 2).projekt_beat, 0.5, 1e-9);
        }
      }
      if (hinter) {  // b: Einsätze. Impuls-Clip, Note (interne Senke) und Klick auf jedem Beat 0..15; Beats 7..12 zählen
        auto imp = Audio::impuls(4800);
        Treiber t;
        PruefSenke rb(0);
        t.senken.push_back(&rb);
        t.arr.setze_senke_intern(&rb);
        Bau b;
        b.spur(1, ArrArt::audio).spur(2, ArrArt::intern);
        for (int i = 0; i < 16; ++i) {
          b.clip(1, ("c" + std::to_string(i)).c_str(), i, 0.1, &imp->a);
          b.note(2, ("m/n" + std::to_string(i)).c_str(), i, 0.1, 60);
        }
        t.laden(b.fertig());
        t.arr.metronom(true, 0.0f, 0);
        PRUEF(t.arr.start(0.0, 0, false, 0, V, 256, t.k));
        t.lauf(setzen);
        t.arr.loop(true, 0.0, 4.0, t.s, t.k);
        t.lauf(793 + 13 * SPB);
        int clips = 0, noten = 0, klicks = 0;
        for (int p = 7; p <= 12; ++p) {
          const int64_t s = 793 + p * SPB;
          clips += std::fabs(t.l[s]) > 0.5f ? 1 : 0;
          klicks += std::fabs(t.ml[s]) > 0.05f ? 1 : 0;
          for (const auto& e : rb.ons()) noten += e.ziel == s ? 1 : 0;
        }
        if (clips != 6 || noten != 6 || klicks != 6) std::printf("Fall 11b: Clips %d/6, Noten %d/6, Klicks %d/6\n", clips, noten, klicks);
        PRUEF(clips == 6 && noten == 6 && klicks == 6);
      }
    }
  }
  {  // 11c: K1-Fix-2 Punkt 1, gleiche Klammer im Naht-Zyklus. Die laufende Klammer 0..4 kommt noch einmal (S2 schickt
     // sie bei jeder Änderung), und zwar in dem Zyklus, dessen Anfang genau das Naht-Sample ist (p == bis). Der Kopf
     // erreicht bis gerade von unten: die Klammer greift weiter, die Naht fällt auf ihr Sample, p bleibt unter 4.
     // Kontrollen: nicht neu gesetzt, einen Zyklus vor und einen nach der Naht; jeweils einmal und doppelt gesendet.
    struct Takt { double bpm; int n; };
    for (const Takt tk : {Takt{120.0, 256}, Takt{128.0, 250}}) {
      for (const int versatz : {-1, 0, 1}) {
        for (const int sendungen : {0, 1, 2}) {
          if (sendungen == 0 && versatz != 0) continue;
          auto g = Audio::gleich(48000 * 40, 0.35f);
          Treiber t;
          t.n = tk.n;
          t.k = cdj::Karte(tk.bpm, 0);
          t.laden(Bau().spur(1, ArrArt::audio).clip(1, "lang", 0.0, 64.0, &g->a).fertig());
          t.arr.loop(true, 0.0, 4.0, t.s, t.k);
          PRUEF(t.arr.start(0.0, 2, false, 0, 2 * tk.n + 25, tk.n, t.k));
          t.lauf(4 * tk.n);
          const int64_t urs = t.arr.zustand(t.k, 0).ursprung_sample;
          const int64_t spb = std::llround(48000.0 * 60.0 / tk.bpm);
          const int64_t naht1 = urs + 4 * spb;
          t.lauf(naht1 + versatz * tk.n);
          const double p_cmd = t.arr.zustand(t.k, t.s).projekt_beat;
          for (int i = 0; i < sendungen; ++i) t.arr.loop(true, 0.0, 4.0, t.s, t.k);
          t.lauf(naht1 + 6 * spb);
          const double p_end = t.arr.zustand(t.k, t.s).projekt_beat;
          const bool ok = t.arr.letzte_naht() == naht1 + 4 * spb && p_end < 4.0;
          if (!ok)
            std::printf("Fall 11c bpm %.0f n %d versatz %d sendungen %d: Befehl bei s=%lld (p=%.9f), letzte_naht %lld "
                        "(Soll %lld), p nach 6 Beats %.3f\n",
                        tk.bpm, tk.n, versatz, sendungen, static_cast<long long>(naht1 + versatz * tk.n), p_cmd,
                        static_cast<long long>(t.arr.letzte_naht()), static_cast<long long>(naht1 + 4 * spb), p_end);
          PRUEF(ok);
        }
      }
    }
  }
  PRUEF_ENDE();
}
