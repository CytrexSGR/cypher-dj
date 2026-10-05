// Scheibe 25, Befund B7 aus 18: der eingeschaltete Prüfklick (ROADMAP Z1, nur mit Prüfmodus) darf einen Neustart nur in
// einen Kern mit Prüfmodus überleben. Kern A (Prüfmodus) schaltet den Klick im master und in deck/2 (Fader auf 0 dB) ein
// und schreibt sein Echtzeit-Fach; Kern B ohne Prüfmodus übernimmt es: Master exakt still, die Regler kommen trotzdem
// zurück (deck/2/fader 0 dB). Negativ-Kontrolle: Kern C mit Prüfmodus übernimmt dasselbe Fach und klickt weiter.
#include <cstdio>

#include "cypherdj/zustand.h"
#include "kern25.h"
#include "pruef.h"

static std::unique_ptr<cdj_z_echtzeit> fach_von(const Kern25& a) {
  auto f = std::make_unique<cdj_z_echtzeit>();
  std::memset(f.get(), 0, sizeof *f);
  a.kern->abbild(*f);
  f->anker_sample = a.kern->sample() - 256;
  f->quantum = 256;
  return f;
}

static double nach_neustart(const cdj_z_echtzeit& f, bool pruefmodus, float* fader) {
  Kern25 b;
  b.kern->setze_pruefmodus(pruefmodus);
  b.mitschreiben = true;
  if (!b.kern->wiederherstellen(f)) return -1.0;
  b.kern->fortsetzen(404'096);
  b.bis(600'000);
  *fader = b.kern->stellwerk().wert(b.kern->stellwerk().tabelle().suche("deck/2/fader"));
  return b.spitze(404'096, 600'000);
}

int main() {
  Kern25 a;
  a.kern->setze_pruefmodus(true);
  a.teil(1, "leitstand", "l1", 0, "deck/2/fader", 1.0, 0.0, 0.0f, 0, 0, "", "");
  a.klick(2, "master", 1);
  a.klick(3, "deck/2", 1);
  a.bis(400'000);
  auto f = fach_von(a);
  int klicks = 0;
  for (int i = 0; i < f->n_befehle; ++i) klicks += f->befehle[i].art == CDJ_Z_ART_KLICK;
  PRUEF(klicks == 2);

  float fader_b = -1.0f, fader_c = -1.0f;
  const double ohne = nach_neustart(*f, false, &fader_b);
  const double mit = nach_neustart(*f, true, &fader_c);
  std::printf("nach Neustart: ohne Prüfmodus Spitze %.6f, mit Prüfmodus %.6f; deck/2/fader %.2f bzw. %.2f dB\n", ohne,
              mit, fader_b, fader_c);
  PRUEF(ohne == 0.0);           // B7: kein Prüfklick ohne Prüfmodus
  PRUEF(fader_b == 0.0f);       // die Regler kommen trotzdem zurück
  PRUEF(mit > 0.1);             // Negativ-Kontrolle: mit Prüfmodus klickt er weiter
  PRUEF(fader_c == 0.0f);

  // nur der Kanal-Klick (deck/2), ohne master: ebenso still
  Kern25 d;
  d.kern->setze_pruefmodus(true);
  d.teil(1, "leitstand", "l1", 0, "deck/2/fader", 1.0, 0.0, 0.0f, 0, 0, "", "");
  d.klick(3, "deck/2", 1);
  d.bis(400'000);
  auto g = fach_von(d);
  float fd = -1.0f;
  PRUEF(nach_neustart(*g, false, &fd) == 0.0);
  PRUEF(nach_neustart(*g, true, &fd) > 0.1);
  PRUEF_ENDE();
}
