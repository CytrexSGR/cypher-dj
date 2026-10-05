// Scheibe 25: Filter-Güte aus kern.toml (`filter_guete`, A27 Weg a, Nachtrag 04) bis in alle 18 Kanalzüge des Mixers.
// Erwartet: nach Kern::setze_filter_guete(4) tragen alle 18 Kanalzüge Q 4; mit deck/1/filter −0,5 (Tiefpass, fc rund
// 1,1 kHz) und Rauschen am Eingang ist der Master mit Q 4 ein anderes Signal als mit Q 0,707 (Resonanz), und mit
// Q 0,707 bitgleich zum Kern ohne Aufruf (Vorgabe, Negativ-Kontrolle). NaN ändert nichts (DjFilter verwirft ihn).
#include <cmath>
#include <cstdio>
#include <vector>

#include "kern25.h"
#include "pruef.h"

static std::vector<float> lauf(double q, bool setzen) {
  Kern25 k;
  if (setzen) k.kern->setze_filter_guete(q);
  k.mitschreiben = true;
  k.teil(1, "leitstand", "l1", 0, "deck/1/fader", 1.0, 0.0, 0.0f, 0, 0, "", "");
  k.teil(2, "leitstand", "l1", 1, "deck/1/filter", 1.0, 0.0, -0.5f, 0, 0, "", "");
  k.klick(3, "deck/1", 1);  // Prüfklick als Anregung (breitbandig)
  k.bis(96'000);
  return std::vector<float>(k.master.begin() + 48'000, k.master.begin() + 96'000);
}

int main() {
  Kern25 a;
  a.kern->setze_filter_guete(4.0);
  int mit_q4 = 0;
  for (int i = 0; i < cdj::MIX_KANAELE; ++i) mit_q4 += a.kern->mixer().kanalzug(i).filter_guete() == 4.0;
  PRUEF(mit_q4 == cdj::MIX_KANAELE);
  a.kern->setze_filter_guete(NAN);
  PRUEF(a.kern->mixer().kanalzug(0).filter_guete() == 4.0);

  const auto vorgabe = lauf(0.0, false), q0707 = lauf(0.707, true), q4 = lauf(4.0, true);
  double e0 = 0.0, e4 = 0.0, diff_vorgabe = 0.0;
  for (size_t i = 0; i < vorgabe.size(); ++i) {
    e0 += double(q0707[i]) * q0707[i];
    e4 += double(q4[i]) * q4[i];
    diff_vorgabe = std::fmax(diff_vorgabe, std::fabs(double(vorgabe[i]) - q0707[i]));
  }
  std::printf("Energie Q 0,707 %.4f dB, Q 4 %.4f dB; Vorgabe gegen Q 0,707 max. Abweichung %.3g\n",
              10 * std::log10(e0 + 1e-300), 10 * std::log10(e4 + 1e-300), diff_vorgabe);
  PRUEF(e0 > 1e-6);
  PRUEF(diff_vorgabe == 0.0);                               // Negativ-Kontrolle: Vorgabe ist Q 0,707
  PRUEF(std::fabs(10 * std::log10(e4 / e0)) > 1.0);         // Q 4 hörbar anders
  PRUEF_ENDE();
}
