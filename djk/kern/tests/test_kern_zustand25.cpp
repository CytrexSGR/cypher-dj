// Scheibe 25: Neustart-Zustand mit Reglern, Planteilen, KI und Prüfklicks je Kanal (SCHNITTSTELLEN §6.3, §19.3
// neustart), offline: Kern A fährt teil_rampe bis Beat 72 und schreibt sein Echtzeit-Fach; Kern B übernimmt es und setzt
// 4 096 Samples später fort (simulierter Ausfall).
// Erwartet: im Fach Teil 6 (läuft, Start 1 440 000), Teil 7 (wartet, Ziel 1 980 000), Prüfklick deck/2, Regler mit Wert
// und Halter; in B keine zweite Quittung 1 oder 2 für Teil 6, Quittung 3 bei 2 160 000 (unveränderter Ende-Beat),
// deck/2/fader bei Beat 80 wieder −7,5 dB und der Klick bei Beat 80 am Master um 7,5 dB unter Beat 96; Teil 7 startet
// mit Quittung 2 bei 1 980 000; der Halter mensch kommt zurück. Fehlerfall: ein frischer Kern ohne Übernahme bleibt stumm.
// KI: ein gestoppter Kern ist nach der Übernahme wieder gestoppt (cypher-Teile abgelehnt). S-Kurve: nur angenähert
// (Befund B2), die Abweichung bei Beat 80 steht in der Ausgabe.
#include <cstdio>

#include "cypherdj/zustand.h"
#include "kern25.h"
#include "pruef.h"

using B = cdj::Befehl;

static std::unique_ptr<cdj_z_echtzeit> fach_von(const Kern25& a) {
  auto f = std::make_unique<cdj_z_echtzeit>();
  std::memset(f.get(), 0, sizeof *f);
  a.kern->abbild(*f);
  f->anker_sample = a.kern->sample() - 256;  // wie Betrieb::zyklus_ende: Anfang des zuletzt geschriebenen Blocks
  f->quantum = 256;
  return f;
}

static double neustart_s_form(int form) {
  Kern25 a;
  a.teil(5, "cypher", "p1", 1, "deck/2/fader", 64.0, 0.0, -15.0f, 0, 0, "b_rein", "h2");
  a.teil(6, "cypher", "p1", 2, "deck/2/fader", 64.0, 32.0, 0.0f, form, 0, "b_rein", "h2");
  a.bis(1'620'000);
  auto f = fach_von(a);
  Kern25 b;
  if (!b.kern->wiederherstellen(*f)) return NAN;
  b.kern->fortsetzen(1'624'096);
  b.bis(1'850'000);
  return b.wert_bei("deck/2/fader", 1'800'000);
}

int main() {
  Kern25 a;
  a.klick(2, "deck/2", 1);
  a.teil(5, "cypher", "p1", 1, "deck/2/fader", 64.0, 0.0, -15.0f, 0, 0, "b_rein", "h2");
  a.teil(6, "cypher", "p1", 2, "deck/2/fader", 64.0, 32.0, 0.0f, 0, 0, "b_rein", "h2");
  a.teil(7, "leitstand", "l1", 0, "deck/1/eq/mitte", 88.0, 4.0, -6.0f, 0, 0, "", "");  // deck/1 klickt nicht
  a.einfach(B::KI_SPUR, 8, "leitstand", "deck/3");
  a.bis(1'480'000);
  a.hand("deck/1/eq/hoch", 0.2f, 1'500'000);  // Stellung
  a.hand("deck/1/eq/hoch", 0.4f, 1'510'000);  // wirksam: Halter mensch für 32 Beats
  a.bis(1'620'000);                            // Beat 72: hier stirbt A
  auto f = fach_von(a);

  // Fach
  PRUEF(f->n_befehle == 3);
  int teil6 = -1, teil7 = -1, klick = -1;
  for (int i = 0; i < f->n_befehle; ++i) {
    const cdj_z_befehl& b = f->befehle[i];
    if (b.art == CDJ_Z_ART_TEIL && b.id == 6) teil6 = i;
    if (b.art == CDJ_Z_ART_TEIL && b.id == 7) teil7 = i;
    if (b.art == CDJ_Z_ART_KLICK && !std::strcmp(b.d.klick.kanal, "deck/2")) klick = i;
  }
  PRUEF(teil6 >= 0 && f->befehle[teil6].stand == 2 && f->befehle[teil6].ist_sample == 1'440'000);
  PRUEF(teil6 >= 0 && !std::strcmp(f->befehle[teil6].d.teil.gruppe, "b_rein") &&
        f->befehle[teil6].d.teil.dauer_beats == 32.0);
  PRUEF(teil7 >= 0 && f->befehle[teil7].stand == 1 && f->befehle[teil7].ist_sample == 1'980'000);
  PRUEF(klick >= 0 && f->befehle[klick].stand == 2);
  bool fader = false, hoch = false;
  for (int i = 0; i < f->n_regler; ++i) {
    if (!std::strcmp(f->regler[i].pfad, "deck/2/fader"))
      fader = !std::strcmp(f->regler[i].halter, "plan:p1") && std::fabs(f->regler[i].wert + 11.25f) < 0.01f;
    if (!std::strcmp(f->regler[i].pfad, "deck/1/eq/hoch")) hoch = !std::strcmp(f->regler[i].halter, "mensch");
  }
  PRUEF(fader && hoch);
  PRUEF(!std::strcmp(f->ki_spur, "deck/3") && f->ki_gestoppt == 0);

  // Übernahme in B, 4 096 Samples Ausfall
  Kern25 b;
  b.mitschreiben = true;
  PRUEF(b.kern->wiederherstellen(*f));
  PRUEF(b.kern->generation() == 1 && b.kern->wartend() == 1);
  b.kern->fortsetzen(1'624'096);
  b.bis(2'200'000);
  PRUEF(!b.ev.empty() && b.ev.front().art == cdj::Ereignis::NEUSTART && b.ev.front().sample == 1'624'096);
  PRUEF(b.q(6, 1) == nullptr && b.q(6, 2) == nullptr && b.q(6, 5) == nullptr);
  const cdj::Ereignis* q;
  PRUEF((q = b.q(6, 3)) && q->sample == 2'160'000 && q->beat == 96.0);
  PRUEF(b.q(7, 1) == nullptr && (q = b.q(7, 2)) && q->sample == 1'980'000);
  PRUEF_NAH(b.wert_bei("deck/2/fader", 1'800'000), -7.5, 0.01);
  const double e80 = b.energie_db(1'800'000), e96 = b.energie_db(2'160'000);
  std::printf("nach dem Neustart: Klick Beat 80 gegen 96 %.4f dB, deck/2/fader bei Beat 80 %.4f dB\n", e80 - e96,
              b.wert_bei("deck/2/fader", 1'800'000));
  PRUEF_NAH(e80 - e96, -7.5, 0.01);
  bool mensch = false;
  for (const auto& e : b.ev)
    if (e.art == cdj::Ereignis::HALTER && !std::strcmp(e.pfad, "deck/1/eq/hoch") && !std::strcmp(e.text, "mensch"))
      mensch = true;
  PRUEF(mensch);
  const float hoch_a = a.kern->stellwerk().wert(a.kern->stellwerk().tabelle().suche("deck/1/eq/hoch"));
  const float hoch_b = b.kern->stellwerk().wert(b.kern->stellwerk().tabelle().suche("deck/1/eq/hoch"));
  PRUEF(hoch_a == hoch_b && hoch_a != 0.0f);

  // Fehlerfall: frischer Kern ohne Übernahme
  Kern25 c;
  c.mitschreiben = true;
  c.kern->fortsetzen(1'624'096);
  c.bis(2'200'000);
  PRUEF(c.spitze(1'624'096, 2'200'000) == 0.0 && c.q(6, 3) == nullptr);

  // KI-Stopp über den Neustart
  Kern25 d;
  d.einfach(B::KI_SPUR, 1, "leitstand", "deck/3");
  d.einfach(B::KI_STOPP, 2, "andreas");
  d.bis(100'000);
  auto g = fach_von(d);
  PRUEF(g->ki_gestoppt == 1);
  Kern25 e;
  PRUEF(e.kern->wiederherstellen(*g));
  e.kern->fortsetzen(104'096);
  e.bis(110'000);
  e.teil(3, "cypher", "x", 0, "deck/1/eq/tief", 100.0, 0.0, -6.0f, 0, 0, "", "");
  e.bis(120'000);
  PRUEF(e.kern->ki_gestoppt() && e.q(3, 6) && !std::strcmp(e.q(3, 6)->grund, "ki_gestoppt"));

  // S-Kurve (Form 1): nur angenähert fortgesetzt (Befund B2)
  const double lin = neustart_s_form(0), s = neustart_s_form(1);
  std::printf("Form 0 nach Neustart bei Beat 80: %.4f dB; Form 1: %.4f dB (ohne Neustart: -7,5)\n", lin, s);
  PRUEF_NAH(lin, -7.5, 0.01);
  PRUEF(std::isfinite(s) && std::fabs(s + 7.5) < 3.0);
  PRUEF_ENDE();
}
