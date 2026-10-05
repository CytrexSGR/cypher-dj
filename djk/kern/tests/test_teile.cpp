// Scheibe 25: Buchführung neben dem Stellwerk (teile.h). Offline.
//  1. TeilSchatten: Stand aus den Quittungen (1 wartet, 2 läuft, 3/4/6/7/8 weg); Quittung 5 verlegt den Kurvenanfang;
//     nach einem Neustart schluckt er die Quittungen 1 (und 2/5), die die alte Generation schon gemeldet hat.
//  2. HandSchlange: nach Sample sortiert, heraus nur, was vor der Grenze liegt.
//  3. fortsetzwert: linear exakt gegen die Formel des Stellwerks (§4.3), S-Kurve aus dem Schnappschuss
//     zurückgerechnet, Rampe nach stumm bis −60 dB (§1.2). Fehlerfall zum Vergleich: der Wert am Schnappschuss
//     (ohne Fortschreiben) liegt bei Beat 80 um 0,061 dB neben −7,5 (teil_rampe, Neustart 4 096 Samples nach Beat 72).
#include <cmath>
#include <cstring>

#include "cypherdj/teile.h"
#include "pruef.h"

static double linear(double w0, double nach, double b0, double ende, double b) {
  return w0 + (nach - w0) * (b - b0) / (ende - b0);
}
static double s_form(double w0, double nach, double b0, double ende, double b) {
  const double u = (b - b0) / (ende - b0);
  return w0 + (nach - w0) * u * u * (3.0 - 2.0 * u);
}

int main() {
  // 1. Schatten
  cdj::TeilSchatten s;
  cdj::SchattenTeil* t = s.neu();
  t->id = 6;
  std::strcpy(t->quelle, "cypher");
  t->ab_beat = 64.0;
  t->dauer_beats = 32.0;
  PRUEF(!s.quittung(6, "cypher", 1, 1'080'000, 48.0));
  PRUEF(t->stand == 1 && s.wartend() == 1);
  PRUEF(!s.quittung(6, "leitstand", 2, 1'440'000, 64.0));  // andere Quelle: nicht dieser Teil
  PRUEF(t->stand == 1);
  PRUEF(!s.quittung(6, "cypher", 2, 1'440'000, 64.0));
  PRUEF(t->stand == 2 && t->ist_sample == 1'440'000 && s.wartend() == 0);
  PRUEF(!s.quittung(6, "cypher", 3, 2'160'000, 96.0));
  PRUEF(!t->belegt && s.finde(6, "cypher") == nullptr);
  // Quittung 5: später Start bei Beat 64, Ende 76 bleibt
  t = s.neu();
  t->id = 3;
  std::strcpy(t->quelle, "leitstand");
  t->ab_beat = 60.0;
  t->dauer_beats = 16.0;
  PRUEF(!s.quittung(3, "leitstand", 5, 1'440'256, 64.011378));
  PRUEF(t->stand == 2 && t->ab_beat == 64.011378);
  PRUEF_NAH(t->ab_beat + t->dauer_beats, 76.0, 1e-12);
  PRUEF(!s.quittung(3, "leitstand", 7, 1'500'000, 66.7));
  PRUEF(!t->belegt);
  // Neustart: lief (wieder 2) → 1 und 2 geschluckt, 3 geht hinaus; wartete (wieder 1) → nur 1 geschluckt
  t = s.neu();
  t->id = 9;
  std::strcpy(t->quelle, "cypher");
  t->stand = 2;
  t->wieder = 2;
  PRUEF(s.quittung(9, "cypher", 1, 1'624'096, 72.18));
  PRUEF(s.quittung(9, "cypher", 2, 1'624'096, 72.18));
  PRUEF(t->wieder == 0 && t->belegt);
  PRUEF(!s.quittung(9, "cypher", 3, 2'160'000, 96.0));
  cdj::SchattenTeil* w = s.neu();
  w->id = 10;
  std::strcpy(w->quelle, "cypher");
  w->stand = 1;
  w->wieder = 1;
  PRUEF(s.quittung(10, "cypher", 1, 1'624'096, 72.18));
  PRUEF(!s.quittung(10, "cypher", 2, 1'800'000, 80.0));  // der Start ist neu: hinaus
  // Negativ-Kontrolle: ohne Neustart wird nichts geschluckt
  cdj::SchattenTeil* n = s.neu();
  n->id = 11;
  std::strcpy(n->quelle, "leitstand");
  PRUEF(!s.quittung(11, "leitstand", 1, 0, 0.0) && !s.quittung(11, "leitstand", 2, 10, 0.0));
  s.leeren();
  PRUEF(s.wartend() == 0 && s.finde(10, "cypher") == nullptr);

  // 2. HandSchlange
  cdj::HandSchlange h;
  PRUEF(h.rein({1'620'000, 5, 0.53125f}) && h.rein({1'500'000, 5, 0.5f}) && h.rein({1'620'000, 7, 0.1f}));
  cdj::HandGriff g{};
  PRUEF(!h.raus_vor(1'500'000, g));  // Grenze exklusiv
  PRUEF(h.raus_vor(1'500'001, g) && g.sample == 1'500'000 && g.x == 0.5f);
  PRUEF(h.raus_vor(1'620'032, g) && g.sample == 1'620'000 && g.regler == 5);  // stabil: zuerst der frühere
  PRUEF(h.raus_vor(1'620'032, g) && g.regler == 7);
  PRUEF(!h.raus_vor(9'000'000, g) && h.anzahl() == 0);

  // 3. fortsetzwert
  cdj::SchattenTeil r{};
  r.ab_beat = 64.0;
  r.dauer_beats = 32.0;
  r.nach = 0.0f;
  r.form = 0;
  r.b_s = 72.0 - 256.0 / 22500.0;  // letzter Schnappschuss vor dem Abschuss bei Beat 72
  r.w_s = static_cast<float>(linear(-15.0, 0.0, 64.0, 96.0, r.b_s));
  const double b_r = 72.0 + 4096.0 / 22500.0;  // 4 096 Samples Ausfall
  PRUEF_NAH(cdj::fortsetzwert(r, true, b_r), linear(-15.0, 0.0, 64.0, 96.0, b_r), 1e-5);
  // weiter ab b_r bis 96 linear: bei Beat 80 wieder −7,5
  const double v_r = cdj::fortsetzwert(r, true, b_r);
  PRUEF_NAH(linear(v_r, 0.0, b_r, 96.0, 80.0), -7.5, 1e-5);
  const double ohne = linear(r.w_s, 0.0, b_r, 96.0, 80.0);  // Fehlerfall: am Schnappschuss stehen geblieben
  std::printf("Fehlerfall ohne Fortschreiben: Beat 80 = %.4f dB (soll -7,5)\n", ohne);
  PRUEF(std::fabs(ohne + 7.5) > 0.02);
  // S-Kurve: aus dem Schnappschuss zurückgerechnet trifft sie die Originalkurve am Neustart
  r.form = 1;
  r.w_s = static_cast<float>(s_form(-15.0, 0.0, 64.0, 96.0, r.b_s));
  PRUEF_NAH(cdj::fortsetzwert(r, true, b_r), s_form(-15.0, 0.0, 64.0, 96.0, b_r), 1e-4);
  // Rampe nach stumm (§1.2): bis −60 dB, am Ende stumm; unter −60 hält sie
  r.form = 0;
  r.nach = -200.0f;
  r.w_s = static_cast<float>(linear(0.0, -60.0, 64.0, 96.0, r.b_s));
  PRUEF_NAH(cdj::fortsetzwert(r, true, b_r), linear(0.0, -60.0, 64.0, 96.0, b_r), 1e-4);
  PRUEF(cdj::fortsetzwert(r, true, 96.0) == -200.0);
  r.w_s = -80.0f;
  PRUEF(cdj::fortsetzwert(r, true, b_r) == -80.0);
  // Negativ-Kontrolle: kein dB-Regler (Filter) mit nach −1: gewöhnliche Gerade
  r.nach = -1.0f;
  r.w_s = static_cast<float>(linear(0.0, -1.0, 64.0, 96.0, r.b_s));
  PRUEF_NAH(cdj::fortsetzwert(r, false, b_r), linear(0.0, -1.0, 64.0, 96.0, b_r), 1e-6);
  PRUEF_ENDE();
}
