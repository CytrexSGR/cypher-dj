// Scheibe 18: Fortsetzen auf dem Anker (ADR 004 Regel 3). Der neue Kern steht nach der Pause genau um die vergangenen
// Treiber-Frames weiter; der Zähler darf nach 2^32 überlaufen; passen Treiber-Frames und monotone Uhr nicht zusammen
// (Treiberwechsel, PipeWire-Neustart), gilt die Uhr. Den Fehlerfall am ganzen Kern (ohne Zustand, ohne Anker) zeigt
// test_kern_neustart.
#include "cypherdj/anker.h"
#include "pruef.h"

int main() {
  using cdj::Anker;
  using cdj::AnkerQuelle;
  const Anker a{1'532'800, 5'000'000'000'000LL, 700'000'000u};  // Kern-Sample, mono_ns, Treiber-Frame

  // 1) Negativ-Kontrolle: keine Pause, derselbe Blockanfang -> dasselbe Sample
  cdj::Fortsetzung f = cdj::setze_fort(a, a.frames, a.mono_ns);
  PRUEF(f.sample == a.sample && f.quelle == AnkerQuelle::frames && f.d_frames == 0 && f.d_mono == 0);

  // 2) Absturz, 40 ms Pause (10 Probe c: erster Block nach 19 bis 48 ms): 1 920 Frames weiter, Uhr stimmt überein
  f = cdj::setze_fort(a, a.frames + 1920, a.mono_ns + 40'000'000);
  PRUEF(f.sample == a.sample + 1920 && f.quelle == AnkerQuelle::frames);

  // 3) Treiber-Frames und Uhr weichen um 5 Samples ab (Quarz gegen Systemuhr): der Treiber zählt
  f = cdj::setze_fort(a, a.frames + 1925, a.mono_ns + 40'000'000);
  PRUEF(f.sample == a.sample + 1925 && f.quelle == AnkerQuelle::frames && f.d_mono == 1920);

  // 4) Überlauf des 32-Bit-Frame-Zählers zwischen Anker und Neustart
  const Anker b{9'000'000, 7'000'000'000'000LL, 0xFFFFFF00u};
  f = cdj::setze_fort(b, 0x00000100u, b.mono_ns + (int64_t)(512 * 1e9 / 48000.0));
  PRUEF(f.d_frames == 512 && f.sample == b.sample + 512 && f.quelle == AnkerQuelle::frames);

  // 5) PipeWire-Neustart: der Treiber zählt neu ab 0, 3 s sind vergangen -> die Uhr gilt
  f = cdj::setze_fort(a, 4096u, a.mono_ns + 3'000'000'000LL);
  PRUEF(f.quelle == AnkerQuelle::mono && f.sample == a.sample + 144'000);

  // 6) Grenze: Abweichung genau ANKER_TOLERANZ -> Treiber, eine mehr -> Uhr
  f = cdj::setze_fort(a, a.frames + 48'000 + (uint32_t)cdj::ANKER_TOLERANZ, a.mono_ns + 1'000'000'000);
  PRUEF(f.quelle == AnkerQuelle::frames);
  f = cdj::setze_fort(a, a.frames + 48'000 + (uint32_t)cdj::ANKER_TOLERANZ + 1, a.mono_ns + 1'000'000'000);
  PRUEF(f.quelle == AnkerQuelle::mono && f.sample == a.sample + 48'000);

  // 7) Anker aus der Zukunft (kaputte Uhr): nie rückwärts
  f = cdj::setze_fort(a, a.frames, a.mono_ns - 1'000'000);
  PRUEF(f.d_mono == 0 && f.sample == a.sample);

  PRUEF_ENDE();
}
