// Scheibe 35 (Vorgriff aus 43, Auftrag der Hauptinstanz): /pegel am Kern (SCHNITTSTELLEN §5.6), ohne JACK. Sinus 1 kHz mit
// Amplitude 0,25 auf Deck 1, Fader −6 dB: erwartet deck/1 und master −18,06 dB (20 log10 0,25 − 6,02) ±0,1 dB, cue −200
// (keine PFL), kein Ereignis für nicht geladene Decks (kein Übersprechen); Rate 20 Hz (alle 2 400 Samples); Fader ganz
// unten: deck/1 −200. Fehlerfall: die Mutation „kein /pegel“ (test_kern_pegel_mutation, WILL_FAIL) meldet nichts.
#include <cmath>

#include "kern35.h"

bool g_waechter = false;

using namespace k35;

int main() {
  Arbeitsbestand ab("test_kern_pegel");
  traeger(ab.pfad, "c1c0000000000035", "--freq 1000 --ohne-klick --traeger 0.25");
  Lauf x(ab.pfad, "konfig/controller/softcontroller.json");
  x.laden(1, "c1c0000000000035");
  x.zyklen(10 * N);
  x.teil("deck/1/fader", -6.0f, 1.0, 0.0);
  x.start(1, 2.0);
  x.zyklen(8 * SPB);
  const double soll = 20.0 * std::log10(0.25) - 6.0206;
  auto letzter = [&](const char* kanal, int64_t ab_sample) {
    float w = 999.0f;
    for (const auto& e : x.alle(cdj::Ereignis::PEGEL, kanal))
      if (e.sample >= ab_sample) w = e.pegel[0];
    return w;
  };
  const float d1 = letzter("deck/1", 4 * SPB), ma = letzter("master", 4 * SPB), cu = letzter("cue", 4 * SPB);
  std::printf("pegel: deck/1 %.3f dB, master %.3f dB, cue %.1f dB, erwartet %.3f dB\n", d1, ma, cu, soll);
  PRUEF(std::fabs(d1 - soll) <= 0.1);
  PRUEF(std::fabs(ma - soll) <= 0.1);
  PRUEF(cu <= -199.0f);
  // Rate: zwischen Beat 4 und 8 alle 2 400 Samples
  int64_t vor = -1;
  int n = 0;
  for (const auto& e : x.alle(cdj::Ereignis::PEGEL, "deck/1")) {
    if (e.sample < 4 * SPB) continue;
    if (vor >= 0) PRUEF(e.sample - vor >= 2400 - 256 && e.sample - vor <= 2400 + 256);
    vor = e.sample;
    ++n;
  }
  PRUEF(n >= 4 * SPB / 2400 - 1 && n <= 4 * SPB / 2400 + 1);
  // kein Übersprechen: deck/2 bis deck/4 sind leer, keine Meldung
  for (const char* k : {"deck/2", "deck/3", "deck/4"}) PRUEF(x.alle(cdj::Ereignis::PEGEL, k).empty());
  // die weiteren Felder sind unbelegt (−200), nicht erfunden
  const auto pe = x.alle(cdj::Ereignis::PEGEL, "deck/1");
  PRUEF(!pe.empty() && pe.back().pegel[1] <= -199.0f && pe.back().pegel[6] <= -199.0f);
  // Fader ganz unten: deck/1 unter die Hörschwelle
  x.teil("deck/1/fader", -200.0f, 9.0, 0.0);
  x.zyklen(12 * SPB);
  const float unten = letzter("deck/1", 11 * SPB);
  const float m_unten = letzter("master", 11 * SPB);
  std::printf("pegel: Fader unten deck/1 %.1f dB, master %.1f dB\n", unten, m_unten);
  PRUEF(unten <= -199.0f && m_unten <= -199.0f);
  PRUEF_ENDE();
}
