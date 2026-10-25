// I08 Task 4: Eingänge im Kern. ein/<k> im Pegel (−200 ohne Signal), MIDI mit Kern-Sample, /zustand/ein (verbunden, MIDI-Zähler, Flanke).
#include <cmath>

#include "kern35.h"

bool g_waechter = false;

int main() {
  k35::Arbeitsbestand ab("test_kern_ein");
  k35::Lauf x(ab.pfad);
  x.ein_quelle[2] = [](int64_t s) { return s >= 3000 ? 0.5f : 0.0f; };   // Paar 2: ab 3000 konstant 0,5
  x.ein_quelle[1] = [](int64_t s) { return s == 7001 ? 1.0f : 0.0f; };   // Paar 1: ein Impuls bei 7001
  x.midi_ein_bei(5037, 0x90, 60, 100);                                    // Paar 3 und 4: keine Quelle
  x.kern->ein_verbunden(0b101);
  x.kern->midi_ein_extern(true);   // dieser Test liest den Ring selbst (hole unten); ohne Leser räumt ihn der Kern
  x.zyklen(12000);

  int p2_still = 0, p2_laut = 0;
  for (const cdj::Ereignis& e : x.alle(cdj::Ereignis::PEGEL, "ein/2")) {
    if (e.sample <= 2400) { PRUEF(e.pegel[0] <= -199.0f); ++p2_still; }
    if (e.sample >= 4000) { PRUEF_NAH(e.pegel[0], 20.0 * std::log10(0.5), 0.05); ++p2_laut; }
  }
  PRUEF(p2_still >= 1 && p2_laut >= 3);   // der Test ist nicht leer
  int impuls = 0, p1_n = 0;
  for (const cdj::Ereignis& e : x.alle(cdj::Ereignis::PEGEL, "ein/1")) { ++p1_n; if (e.pegel[0] > -1.0f) ++impuls; else PRUEF(e.pegel[0] <= -199.0f); }
  PRUEF(p1_n >= 3 && impuls == 1);       // genau ein Bericht trägt den Impuls
  for (const char* n : {"ein/3", "ein/4"}) {  // Negativ-Kontrolle: Paare ohne Quelle bleiben bei −200, melden aber
    const auto v = x.alle(cdj::Ereignis::PEGEL, n);
    PRUEF(v.size() >= 3);
    for (const cdj::Ereignis& e : v) PRUEF(e.pegel[0] <= -199.0f);
  }
  cdj::MidiEinEreignis m{};
  PRUEF(x.kern->midi_ein_ring().hole(m));
  PRUEF(m.sample == 5037 && m.b[0] == 0x90 && m.b[1] == 60 && m.n == 3);   // Zyklusanfang 4864 + Versatz 173
  PRUEF(!x.kern->midi_ein_ring().hole(m));
  const auto z = x.alle(cdj::Ereignis::EIN_ZUSTAND);
  PRUEF(z.size() >= 3);
  if (z.size() >= 3) {
    PRUEF(z.front().ein_midi_sample == -1 && z.front().ein_flanke == -1 && z.front().ein_gesehen == 0);  // vorher: nichts gesehen
    PRUEF(z.back().status == 5 && z.back().ein_midi_sample == 5037 && z.back().ein_flanke == 7001 && z.back().ein_gesehen == 1);
    PRUEF(z.back().ein_verloren == 0);
  }
  {  // Review-Nachzug (MAJOR 1): ohne Leser darf der MIDI-Ring nie vollaufen. 5100 Ereignisse (3 je Zyklus) sind mehr als KAP = 4096.
    k35::Lauf y(ab.pfad);
    for (int i = 0; i < 1700; ++i)
      for (int j = 0; j < 3; ++j) y.midi_ein_bei(int64_t{i} * k35::N + 10 + j * 20, 0x90, uint8_t(i % 100), 1);
    y.zyklen(1700 * k35::N + 4096);
    PRUEF(y.kern->midi_ein_ring().gesehen() == 5100);
    PRUEF(y.kern->midi_ein_ring().verloren() == 0);                      // der Kern räumt: kein erfundener Verlust
    PRUEF(y.kern->midi_ein_ring().letztes_sample() == int64_t{1699} * k35::N + 50);
    const auto z2 = y.alle(cdj::Ereignis::EIN_ZUSTAND);
    PRUEF(!z2.empty() && z2.back().ein_verloren == 0 && z2.back().ein_gesehen == 5100);
  }
  {  // Negativ-Kontrolle: mit externem Leser, der nicht liest, läuft der Ring über und der Verlust wird gezählt (5100 - 4096)
    k35::Lauf y(ab.pfad);
    y.kern->midi_ein_extern(true);
    for (int i = 0; i < 1700; ++i)
      for (int j = 0; j < 3; ++j) y.midi_ein_bei(int64_t{i} * k35::N + 10 + j * 20, 0x90, uint8_t(i % 100), 1);
    y.zyklen(1700 * k35::N + 4096);
    PRUEF(y.kern->midi_ein_ring().verloren() == 5100 - cdj::MidiEin::KAP);
  }
  {  // Review-Nachzug (MINOR 4): Achsenwechsel /k/set/neu im selben Zyklus. MIDI und Flanke tragen die NEUE Achse, alte Stände sind weg.
    k35::Lauf y(ab.pfad);
    y.kern->midi_ein_extern(true);
    bool neue_achse = false;
    y.ein_quelle[1] = [&](int64_t s) { return !neue_achse && s == 3001 ? 1.0f : 0.0f; };   // Impuls nur auf der alten Achse
    y.zyklen(5000);
    const int64_t s0 = y.kern->sample();
    y.midi_ein_bei(s0 + 10, 0x90, 61, 90);
    neue_achse = true;
    cdj::Befehl b = y.neu(cdj::Befehl::SET_NEU, "andreas");
    b.bpm = 128.0;
    y.sende(b);
    y.zyklen(s0 + k35::N);
    cdj::MidiEinEreignis m{};
    PRUEF(y.kern->midi_ein_ring().hole(m));
    PRUEF(m.sample == 10 && m.b[1] == 61);                                // vorher: s0 + 10 (alte Achse)
    y.zyklen(6000);
    const auto z3 = y.alle(cdj::Ereignis::EIN_ZUSTAND);
    PRUEF(z3.size() >= 3);
    if (!z3.empty()) {
      PRUEF(z3.back().ein_midi_sample == 10);
      PRUEF(z3.back().ein_flanke == -1);                                  // die Flanke 3001 gehört zur alten Achse
    }
    bool alte_flanke_gesehen = false;                                     // Negativ-Kontrolle: vor dem Wechsel stand sie da
    for (const cdj::Ereignis& e : z3) alte_flanke_gesehen = alte_flanke_gesehen || e.ein_flanke == 3001;
    PRUEF(alte_flanke_gesehen);
  }
  {  // dasselbe für das MIDI-Sample: ein Ereignis nur auf der alten Achse, danach keins mehr -> nach dem Wechsel „nichts gesehen“ (−1)
    k35::Lauf y(ab.pfad);
    y.kern->midi_ein_extern(true);
    y.midi_ein_bei(1000, 0x90, 62, 90);
    y.zyklen(5000);
    cdj::Befehl b = y.neu(cdj::Befehl::SET_NEU, "andreas");
    b.bpm = 128.0;
    y.sende(b);
    y.zyklen(y.kern->sample() + 6000);
    const auto z4 = y.alle(cdj::Ereignis::EIN_ZUSTAND);
    bool alt_gesehen = false;
    for (const cdj::Ereignis& e : z4) alt_gesehen = alt_gesehen || e.ein_midi_sample == 1000;   // Negativ-Kontrolle: vorher stand es da
    PRUEF(alt_gesehen);
    PRUEF(!z4.empty() && z4.back().ein_midi_sample == -1 && z4.back().ein_gesehen == 1);   // der Zähler bleibt, das Sample der alten Achse nicht
  }
  PRUEF_ENDE();
}
