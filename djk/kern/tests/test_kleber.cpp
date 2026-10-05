// K2 Task 3.1: Kleber = Faust co.compressor_stereo(2, schwelle, 0.03, 0.2), Schwelle per setze_schwelle() (Vorgabe +6 =
// nie erreicht, der Mixer setzt 6 - 36 * master/kleber). Detektor ist |L|+|R| (compressors.lib:933-935),
// bei L = R also +6 dB: Schwelle -6 entspricht -12 dBFS je Kanal. Leise geht durch, laut wird bis 2:1 gedrückt.
#include "cypherdj/kleber.h"
#include "pruef.h"
#include <algorithm>
#include <cmath>
#include <cstring>
#include <vector>

static float rms_nach(cdj::Kleber& k, float a, int bloecke, int N = 256) {
  std::vector<float> l(N), r(N);
  double s = 0; int z = 0;
  for (int b = 0; b < bloecke; ++b) {
    for (int i = 0; i < N; ++i) l[i] = r[i] = a * std::sin(2.0f * 3.14159265f * 100.0f * float(b * N + i) / 48000.0f);
    k.block(l.data(), r.data(), N);
    if (b >= bloecke - 20) for (int i = 0; i < N; ++i) { s += l[i] * l[i]; ++z; }
  }
  return std::sqrt(s / z);
}

int main() {
  cdj::Kleber leise, laut;
  leise.setze_schwelle(-6.0f);
  laut.setze_schwelle(-6.0f);
  const float r_leise = rms_nach(leise, 0.05f, 200);     // −26 dBFS Spitze: unter der Schwelle
  const float r_laut = rms_nach(laut, 1.0f, 200);        // 0 dBFS Spitze: 12 dB über der Schwelle
  PRUEF_NAH(r_leise, 0.05f / std::sqrt(2.0f), 0.002f);   // durch
  const float db_laut = 20.0f * std::log10(r_laut / (1.0f / std::sqrt(2.0f)));
  // Nachgerechnet mit ~/messungen/2026-09-30-k2-plan/kleber_sim.py -6: Sinus 1,0 (L = R, 100 Hz) → -5,31 dB
  // (Schwelle -12 ergäbe -8,31 dB). Grenzen: berechneter Wert ±1 dB.
  PRUEF(db_laut < -4.31f && db_laut > -6.31f);

  {   // Schwelle: Vorgabe +6 lässt alles durch, tiefer drückt mehr (-6 -> -5,31 dB, -30 tiefer), unbekanntes Label ist kein Fehler
    cdj::Kleber aus, s6, s30;
    s6.setze_schwelle(-6.0f);
    s30.setze_schwelle(-30.0f);
    const float r_aus = rms_nach(aus, 1.0f, 200), r6 = rms_nach(s6, 1.0f, 200), r30 = rms_nach(s30, 1.0f, 200);
    PRUEF_NAH(r_aus, 1.0f / std::sqrt(2.0f), 0.005f);
    PRUEF(r6 < r_aus && r30 < r6);
    const float d6 = 20.0f * std::log10(r6 / r_aus), d30 = 20.0f * std::log10(r30 / r_aus);
    PRUEF(d6 < -5.11f && d6 > -5.51f);
    PRUEF(d30 < -10.0f);
    cdj::Kleber leer;   // setze_schwelle auf einem Kleber darf setzen: Zone gibt es, Label stimmt
    leer.setze_schwelle(0.0f);
    cdjfaust::UI u;
    PRUEF(u.zone("gibt_es_nicht") == nullptr);
  }
  // Stille rein → exakt 0 raus (der Hall tat das nicht; hier Befund am erzeugten Code)
  cdj::Kleber still;
  std::vector<float> l(256, 0.0f), r(256, 0.0f);
  still.block(l.data(), r.data(), 256);
  bool null = true; for (int i = 0; i < 256; ++i) null = null && l[i] == 0.0f && r[i] == 0.0f;
  PRUEF(null);

  // Block länger als der Innenpuffer (Stücke): gleiches Ergebnis wie in 256er-Blöcken
  cdj::Kleber gross;
  gross.setze_schwelle(-6.0f);
  std::vector<float> gl(3000), gr(3000);
  for (int i = 0; i < 3000; ++i) gl[i] = gr[i] = 0.9f * std::sin(2.0f * 3.14159265f * 100.0f * float(i) / 48000.0f);
  const std::vector<float> ref = gl;
  gross.block(gl.data(), gr.data(), 3000);
  bool endlich = true, gedrueckt = false;
  for (int i = 0; i < 3000; ++i) { endlich = endlich && std::isfinite(gl[i]) && gl[i] == gr[i]; if (std::fabs(ref[i]) > 0.5f && std::fabs(gl[i]) < std::fabs(ref[i]) - 0.01f) gedrueckt = true; }
  PRUEF(endlich);
  {   // Stückelung exakt: 3000 in einem Aufruf == dieselben Samples in 256er-Blöcken (und der Rest 184)
    cdj::Kleber klein;
    klein.setze_schwelle(-6.0f);
    std::vector<float> kl(3000), kr(3000);
    for (int i = 0; i < 3000; ++i) kl[i] = kr[i] = 0.9f * std::sin(2.0f * 3.14159265f * 100.0f * float(i) / 48000.0f);
    for (int o = 0; o < 3000; o += 256) klein.block(kl.data() + o, kr.data() + o, std::min(256, 3000 - o));
    PRUEF(std::memcmp(kl.data(), gl.data(), sizeof(float) * 3000) == 0);
    PRUEF(std::memcmp(kr.data(), gr.data(), sizeof(float) * 3000) == 0);
  }
  PRUEF(gedrueckt);
  PRUEF_ENDE();
}
