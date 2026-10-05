// Scheibe 08: Lückenzähler und /zustand/kern-Werte aus synthetischen Zyklen (ohne JACK).
// Fehlerfall: die Frame-Zeit springt um eine Periode -> gezählt und gemeldet. Negativ-Kontrolle: lückenlos -> 0.
#include <vector>

#include "cypherdj/telemetrie.h"
#include "pruef.h"

int main() {
  auto* aus = new cdj::Ereignisring();
  cdj::Zyklusmesser z(aus);
  cdj::Zustandsfenster f;
  const int64_t T0 = 1000000000000LL;  // ns
  uint32_t frames = 7000;
  int64_t sample = 0;
  auto zyklus = [&](uint32_t n, int dauer_us, int aufwach_us) {
    const int64_t start = T0 + sample * 1000000000LL / 48000 + aufwach_us * 1000LL;
    const uint64_t zyklus_us = static_cast<uint64_t>((start / 1000) - aufwach_us);
    z.anfang(frames, zyklus_us, start, n, sample);
    z.ende(start + dauer_us * 1000LL, 0, 0, sample);
    frames += n;
    sample += n;
  };
  // Negativ-Kontrolle: 1000 lückenlose Zyklen zu 256
  for (int i = 0; i < 1000; ++i) zyklus(256, 5, 10);
  PRUEF(z.frame_luecken() == 0);
  PRUEF(z.ausgelassene_perioden() == 0);
  // Fehlerfall: der Treiber hat einen Zyklus ohne uns weitergezählt (ausgelassene Periode)
  frames += 256;
  zyklus(256, 5, 10);
  PRUEF(z.frame_luecken() == 1);
  PRUEF(z.ausgelassene_perioden() == 1);
  // zwei Perioden auf einmal
  frames += 512;
  zyklus(256, 5, 10);
  PRUEF(z.frame_luecken() == 2);
  PRUEF(z.ausgelassene_perioden() == 3);
  // Quantum-Wechsel 256 -> 128 ist keine Lücke, aber ein Ereignis
  zyklus(128, 5, 10);
  PRUEF(z.frame_luecken() == 2);
  // Treiberwechsel: die Frame-Zeit springt weit (gemessen am 2026-09-23 beim Verbinden: 2 267 342 Frames) -> eine
  // Lücke, aber keine ausgelassenen Perioden
  frames += 2267342;
  zyklus(128, 5, 10);
  PRUEF(z.frame_luecken() == 3);
  PRUEF(z.ausgelassene_perioden() == 3);

  std::vector<cdj::Ereignis> luecken, quanten;
  cdj::Ereignis e;
  int zyklen = 0;
  while (aus->hole(e)) {
    if (e.art == cdj::Ereignis::LUECKE) luecken.push_back(e);
    if (e.art == cdj::Ereignis::QUANTUM) quanten.push_back(e);
    if (e.art == cdj::Ereignis::ZYKLUS) {
      ++zyklen;
      f.zyklus(e);
    }
  }
  PRUEF(zyklen == 1004);
  PRUEF(luecken.size() == 3);
  if (luecken.size() == 3) {
    PRUEF(luecken[0].frames == 256 && luecken[0].zyklen == 1);
    PRUEF(luecken[1].frames == 512 && luecken[1].zyklen == 2);
    PRUEF(luecken[2].frames == 2267342 && luecken[2].zyklen == 0);
  }
  PRUEF(quanten.size() == 1 && quanten[0].alt == 256 && quanten[0].neu == 128);

  // Zustandsfenster: letzte Sekunde. Ein Ausreißer von 900 µs erscheint als Maximum, p99 bleibt 5.
  cdj::KernZustand w = f.werte(T0 + sample * 1000000000LL / 48000);
  PRUEF(w.frame_luecken == 3 && w.ausgelassene_perioden == 3);
  PRUEF(w.quantum == 128);
  PRUEF(w.cb_max_us == 5 && w.cb_p99_us == 5);
  PRUEF(w.aufwach_max_us == 10);
  zyklus(256, 900, 40);
  while (aus->hole(e))
    if (e.art == cdj::Ereignis::ZYKLUS) f.zyklus(e);
  w = f.werte(T0 + sample * 1000000000LL / 48000);
  PRUEF(w.cb_max_us == 900);
  PRUEF(w.cb_p99_us == 5);
  PRUEF(w.aufwach_max_us == 40);
  // Fenster läuft ab: 2 s später ist nichts mehr in der letzten Sekunde
  w = f.werte(T0 + sample * 1000000000LL / 48000 + 2000000000LL);
  PRUEF(w.cb_max_us == 0 && w.cb_p99_us == 0);
  // neue Generation setzt die Zähler seit Generationsstart zurück, die Gesamtzähler nicht
  z.neue_generation();
  PRUEF(z.frame_luecken() == 0);
  PRUEF(z.luecken_gesamt() == 3 && z.ausgelassen_gesamt() == 3);
  // Prüf-Last: jeder 2. Zyklus verbrennt 0,1 Perioden (läuft wirklich, gezählt)
  z.setze_pruef_last(2, 0.1);
  for (int i = 0; i < 4; ++i) zyklus(256, 5, 10);
  PRUEF(z.verbrannt() == 2);
  delete aus;
  PRUEF_ENDE();
}
