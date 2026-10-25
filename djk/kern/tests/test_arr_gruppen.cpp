// 1.10 Slice 1: Gruppen und Produktions-Master im Modul Arrangement (Spec 1.10 5.4; AK1 Negativ-Kontrolle, AK4, AK5, AK6, AK20).
// Gleichwert 0,25 je Spur, Spuren in Mitte (je 0,25·MITTE), Start ab Takt (90 000), Blöcke zu 256.
// Mutationen: ARR_ZIEL_IGNORIERT (Fälle 2, 3, 3c, 3d, 5 und 6 rot, gemessen in Task 6: die Spur bleibt auf master. Fall 1 bleibt grün: bei 0 dB und Balance-Mitte ist die Summe dieselbe und `gruppe_belegt` kommt aus dem Schnappschuss, nicht aus dem Ziel; Fall 4 benutzt keine Gruppe und bleibt grün, er ist die Negativ-Kontrolle), ARR_ZIEL_HART (Fall 6 rot: Ziel-Wechsel ohne Blende; Fall 6b bleibt grün, siehe dort),
// ARR_PM_FADER_AUS (Fall 7 rot), ARR_MUTE_HART (Fall 3 rot: Gruppen-Mute ohne Blende).
#include <algorithm>
#include <cmath>
#include <cstring>
#include <string>
#include <vector>

#include "arr_bau.h"
#include "pruef.h"

using namespace arrtest;
using cdj::ArrArt;

static constexpr int64_t V = 537;
static const double MITTE = 0.70710677;

// Schnappschuss mit Audio-Spuren 1..n (je ein Clip, 8 Beats); ziele[i] = Gruppe der Spur i+1 (0 = master)
static cdj::ArrSnapshot* snap(const cdj::ArrAudio* a, const std::vector<int>& ziele, int64_t nr = 1) {
  Bau b(nr);
  for (size_t i = 0; i < ziele.size(); ++i) {
    const std::string id = "c" + std::to_string(i + 1);
    const int sp = static_cast<int>(i) + 1;
    b.spur(sp, ArrArt::audio).clip(sp, id.c_str(), 0.0, 8.0, a).ausgang(sp, ziele[i]);
  }
  return b.fertig();
}
static void spiele(Treiber& t, cdj::ArrSnapshot* s, int64_t bis = 99840) {
  t.laden(s);
  t.arr.start(0.0, 2, false, 0, V, 256, t.k);
  t.lauf(bis);
}
static int reg(Treiber& t, const char* pfad) {
  const int r = t.tab.suche(pfad);
  PRUEF(r >= 0);
  return r;
}

int main() {
  auto a = Audio::gleich(400000, 0.25f);
  {  // 1: Gruppieren ändert den Pegel nicht (Gruppen-Pan ist eine Balance, Mitte 0 dB; P14); ohne Gruppe bleibt es die alte Summe
    Treiber roh, grp;
    spiele(roh, snap(&a->a, {0, 0, 0}));
    spiele(grp, snap(&a->a, {1, 1, 0}));
    PRUEF_NAH(roh.l[99000], 3 * 0.25 * MITTE, 1e-6);
    PRUEF_NAH(grp.l[99000], roh.l[99000], 1e-6);
    PRUEF_NAH(grp.r[99000], roh.r[99000], 1e-6);
    PRUEF(grp.arr.gruppe_belegt(0) && !grp.arr.gruppe_belegt(1));
    PRUEF(!roh.arr.gruppe_belegt(0));
  }
  {  // 2 (AK4): Gruppen-Fader −6,0206 dB senkt die Summe der Mitglieder um 6,0 dB ±0,1; Spur 3 ohne Gruppe bleibt (Negativ-Kontrolle)
    Treiber t;
    spiele(t, snap(&a->a, {1, 1}));
    PRUEF_NAH(t.l[99000], 2 * 0.25 * MITTE, 1e-6);
    t.arr.setze_sofort(reg(t, "grp/1/fader"), -6.0206f);
    t.lauf(100352);
    PRUEF_NAH(t.l[100000], 0.5 * 2 * 0.25 * MITTE, 1e-5);
    PRUEF_NAH(20.0 * std::log10(t.l[100000] / t.l[99000]), -6.0206, 0.1);
    Treiber u;   // Spur 1 und 2 stumm, nur Spur 3 (direkt) klingt: der Gruppen-Fader berührt sie nicht
    spiele(u, snap(&a->a, {1, 1, 0}));
    u.arr.setze_sofort(reg(u, "spur/1/mute"), 1.0f);
    u.arr.setze_sofort(reg(u, "spur/2/mute"), 1.0f);
    u.arr.setze_sofort(reg(u, "grp/1/fader"), -6.0206f);
    u.lauf(101000);
    PRUEF_NAH(u.l[100800], 0.25 * MITTE, 1e-6);
  }
  {  // 3 (AK5): Gruppen-Mute nullt beide Mitglieder (Blende 480 Samples linear), Spur 3 bleibt
    Treiber t;
    spiele(t, snap(&a->a, {1, 1, 0}));
    PRUEF_NAH(t.l[99000], 3 * 0.25 * MITTE, 1e-6);
    t.arr.setze_sofort(reg(t, "grp/1/mute"), 1.0f);
    t.lauf(101000);
    PRUEF_NAH(t.l[99839], 3 * 0.25 * MITTE, 1e-6);
    PRUEF_NAH(t.l[99840 + 239], 0.25 * MITTE + 2 * 0.25 * MITTE * 0.5, 1e-5);   // Mitte der Blende
    PRUEF_NAH(t.l[100500], 0.25 * MITTE, 1e-6);                                  // nur Spur 3
  }
  {  // 3b (AK5, F2): Solo auf Spur 1 lässt nur Spur 1 und ihre Gruppe klingen (Spur 2 und 3 schweigen)
    Treiber t;
    spiele(t, snap(&a->a, {1, 1, 0}));
    t.arr.setze_sofort(reg(t, "spur/1/solo"), 1.0f);
    t.lauf(101000);
    PRUEF_NAH(t.l[100500], 0.25 * MITTE, 1e-6);
  }
  {  // 3c (AK5): Solo auf der Gruppe lässt alle Mitglieder klingen, Spur 3 schweigt
    Treiber t;
    spiele(t, snap(&a->a, {1, 1, 0}));
    t.arr.setze_sofort(reg(t, "grp/1/solo"), 1.0f);
    t.lauf(101000);
    PRUEF_NAH(t.l[100500], 2 * 0.25 * MITTE, 1e-6);
  }
  {  // 3d (AK5): Gruppen-Balance: ganz rechts L 0 und R voll (0 dB), ganz links umgekehrt, Mitte unverändert
    Treiber t;
    spiele(t, snap(&a->a, {1, 1}));
    t.arr.setze_sofort(reg(t, "grp/1/pan"), 1.0f);
    t.lauf(100352);
    PRUEF_NAH(t.l[100000], 0.0, 1e-6);
    PRUEF_NAH(t.r[100000], 2 * 0.25 * MITTE, 1e-6);
    t.arr.setze_sofort(reg(t, "grp/1/pan"), -1.0f);
    t.lauf(100864);
    PRUEF_NAH(t.l[100500], 2 * 0.25 * MITTE, 1e-6);
    PRUEF_NAH(t.r[100500], 0.0, 1e-6);
  }
  {  // 4: leere Gruppe und Gruppen-Zustand ohne Mitglieder: nichts klingt zusätzlich, Spitze 0, kein Absturz
    Treiber t;
    spiele(t, snap(&a->a, {0, 0}));
    t.arr.setze_sofort(reg(t, "grp/3/fader"), -12.0f);
    t.arr.setze_sofort(reg(t, "grp/3/mute"), 1.0f);
    t.lauf(100352);
    PRUEF_NAH(t.l[100000], 2 * 0.25 * MITTE, 1e-6);
    PRUEF_NAH(t.arr.spitze_gruppe_lesen(2), 0.0, 0.0);
  }
  {  // 5: Spitze der Gruppe nach dem Gruppen-Fader, beim Lesen zurückgesetzt
    Treiber t;
    spiele(t, snap(&a->a, {1, 1}));
    PRUEF_NAH(t.arr.spitze_gruppe_lesen(0), 2 * 0.25 * MITTE, 1e-6);
    PRUEF_NAH(t.arr.spitze_gruppe_lesen(0), 0.0, 0.0);
    PRUEF_NAH(t.arr.spitze_pm_lesen(), 2 * 0.25 * MITTE, 1e-6);
  }
  {  // 6 (AK6): Ziel-Wechsel master → Gruppe (Fader −6,02 dB) bei laufender Wiedergabe, Gleichwert: kein Sprung
    Treiber t;
    spiele(t, snap(&a->a, {0}));
    t.arr.setze_sofort(reg(t, "grp/1/fader"), -6.0206f);
    t.laden(snap(&a->a, {1}, 2));
    t.lauf(101000);
    PRUEF_NAH(t.l[99839], 0.25 * MITTE, 1e-6);
    PRUEF_NAH(t.l[100800], 0.5 * 0.25 * MITTE, 1e-5);   // Blende (480 Samples) zu Ende
    double sprung = 0.0;
    for (int64_t i = 99800; i < 100800; ++i) sprung = std::max(sprung, static_cast<double>(std::fabs(t.l[i + 1] - t.l[i])));
    PRUEF(sprung < 0.001);   // linear: 0,5 · 0,177 / 480 ≈ 0,00018 je Sample; ohne Blende 0,088 (Mutation ARR_ZIEL_HART)
  }
  {  // 6b (AK6, Spec-Form): Sinus 1 kHz, Wechsel bei Gruppen-Fader 0 dB: größter Sprung höchstens das 1,05-fache des Sinus allein.
     // Bei 0 dB und Balance-Mitte ist der Wechsel pegelneutral (l·(1−z) + l·z = l): auch ARR_ZIEL_HART bleibt hier grün, 6b hat keine eigene Gegenprobe (Prüfung 2, C5).
     // Die Gegenprobe zur Blende ist Fall 6 (Gruppen-Fader −6,02 dB, Sprung 0,088 statt 0,00018); 6b belegt nur, dass die Blende einen Sinus nicht verzerrt.
    auto s = Audio::sinus(400000, 1000.0, 0.5f);
    Treiber t;
    spiele(t, snap(&s->a, {0}));
    t.laden(snap(&s->a, {1}, 2));
    t.lauf(101000);
    double allein = 0.0, wechsel = 0.0;
    for (int64_t i = 98000; i < 99800; ++i) allein = std::max(allein, static_cast<double>(std::fabs(t.l[i + 1] - t.l[i])));
    for (int64_t i = 99800; i < 100900; ++i) wechsel = std::max(wechsel, static_cast<double>(std::fabs(t.l[i + 1] - t.l[i])));
    PRUEF(allein > 0.01);   // der Aufbau sieht den Sinus (sonst wäre der Vergleich leer)
    PRUEF(wechsel <= 1.05 * allein);
  }
  {  // 7 (AK20): PM-Fader −6,0206 dB senkt Ausgang und Abgriff um 6,0 dB ±0,1; der Abgriff ist der PM-Ausgang
    Treiber t;
    spiele(t, snap(&a->a, {0, 0}));
    const float vor = t.l[99000];
    PRUEF_NAH(t.pml[99000], vor, 1e-7);   // Abgriff = Ausgang (erz/4-Eingang war +0)
    t.arr.setze_sofort(reg(t, "pm/fader"), -6.0206f);
    t.lauf(100352);
    PRUEF_NAH(20.0 * std::log10(t.l[100000] / vor), -6.0206, 0.1);
    PRUEF_NAH(t.pml[100000], t.l[100000], 1e-7);
  }
  {  // 8 (AK1, Negativ-Kontrolle und Determinismus): PM-Fader 0 dB gibt zweimal dieselben Bits, 0,01 dB gibt andere
    auto lauf = [&](float pm_db) {
      Treiber t;
      spiele(t, snap(&a->a, {0, 0, 0}));
      if (pm_db != 0.0f) t.arr.setze_sofort(reg(t, "pm/fader"), pm_db);
      t.lauf(102400);
      return std::vector<float>(t.l.begin() + 99840, t.l.end());
    };
    const std::vector<float> n1 = lauf(0.0f), n2 = lauf(0.0f), leicht = lauf(0.01f);
    PRUEF(n1.size() == n2.size() && n1.size() == leicht.size() && !n1.empty());
    PRUEF(std::memcmp(n1.data(), n2.data(), n1.size() * sizeof(float)) == 0);
    PRUEF(std::memcmp(n1.data(), leicht.data(), n1.size() * sizeof(float)) != 0);
  }
  PRUEF_ENDE();
}
