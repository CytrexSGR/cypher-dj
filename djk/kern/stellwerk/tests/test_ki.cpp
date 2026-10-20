// Scheibe 11, Task 9: KI-Stopp, KI-Frei und KI-Spur nach SCHNITTSTELLEN §4.7 und §7.3 Punkt 8.
#include <cstring>

#include "pruef.h"
#include "szenario.h"

using namespace probe;

namespace {
struct Aufbau {
  Lauf l;
  int64_t c_lauf, c_wart, s_lauf;
  Aufbau() {
    l.sw->ki_spur(1, Quelle::leitstand, "deck/3,deck/4");
    l.sw->setze_direkt(l.r("deck/3/fader"), -3.0f);
    l.sw->setze_direkt(l.r("deck/4/fader"), -6.0f);
    l.beobachte("deck/3/fader");
    l.beobachte("deck/4/fader");
    l.beobachte("deck/2/fader");
    c_lauf = l.teil("deck/1/eq/hoch", 64, 32, -20, "k1", 0);
    c_wart = l.teil("deck/1/eq/mitte", 128, 0, -10, "k1", 1);
    s_lauf = l.teil("deck/2/eq/hoch", 64, 32, -20, "l1", 0, "", Quelle::leitstand);
    l.nachlese_ereignisse();
  }
};
}  // namespace

FALL(stopp_bricht_cypher_teile_ab_andere_laufen) {
  Aufbau a;
  Lauf& l = a.l;
  l.bis(1620224);
  l.sw->ki_stopp(46, Quelle::andreas);
  l.bis(2200000);
  PRUEFE_GLEICH(l.bei(a.c_lauf, Status::abgebrochen), 1620224);
  PRUEFE(l.grund(a.c_lauf, Status::abgebrochen) == Grund::ki_stopp);
  PRUEFE_GLEICH(l.bei(a.c_wart, Status::abgebrochen), 1620224);
  PRUEFE_GLEICH(l.bei(a.s_lauf, Status::fertig), 2160000);   // Quelle leitstand läuft weiter
  PRUEFE_GLEICH(l.bei(46, Status::fertig), 1620224);
  PRUEFE(l.sw->ki_gestoppt());
  int ki = 0;
  for (const Ereignis& e : l.ereignisse) ki += e.art == EreignisArt::ki && e.gestoppt && e.grund == Grund::ki_stopp && e.sample == 1620224;
  PRUEFE_GLEICH(ki, 1);
}

FALL(ki_spur_ueber_4_beats_stumm) {
  Aufbau a;
  Lauf& l = a.l;
  l.sw->setze_direkt(l.r("deck/2/fader"), -1.0f);   // nicht in der KI-Spur
  l.bis(1620224);
  l.sw->ki_stopp(46, Quelle::andreas);
  l.bis(1800000);
  PRUEFE_NAH(l.wert_bei("deck/3/fader", 1620224), -3, 1e-6);
  PRUEFE_NAH(l.wert_bei("deck/3/fader", 1620224 + 45000), -31.5, 1e-3);
  PRUEFE_NAH(l.wert_bei("deck/4/fader", 1620224 + 45000), -33, 1e-3);
  PRUEFE_NAH(l.wert_bei("deck/3/fader", 1620224 + 90000), -200, 0);
  PRUEFE_NAH(l.wert_bei("deck/4/fader", 1620224 + 90000), -200, 0);
  PRUEFE_NAH(l.wert_bei("deck/2/fader", 1700000), -1, 0);   // Negativ-Kontrolle
}

FALL(ki_spur_mit_spur_reglern_ueber_4_beats_stumm) {
  // D1 K1 (Spec 2.3): spur/<n> in der KI-Spur (eigene Liste): ihr Fader fällt wie ein Kanal-Fader; eine Spur außerhalb bleibt
  Lauf l;
  l.sw->ki_spur(1, Quelle::leitstand, "erz/4,spur/2");
  l.sw->setze_direkt(l.r("spur/2/fader"), -3.0f);
  l.sw->setze_direkt(l.r("spur/3/fader"), -1.0f);
  l.beobachte("spur/2/fader");
  l.beobachte("spur/3/fader");
  l.nachlese_ereignisse();
  l.bis(1620224);
  l.sw->ki_stopp(46, Quelle::andreas);
  l.bis(1800000);
  PRUEFE_NAH(l.wert_bei("spur/2/fader", 1620224), -3, 1e-6);
  PRUEFE_NAH(l.wert_bei("spur/2/fader", 1620224 + 45000), -31.5, 1e-3);
  PRUEFE_NAH(l.wert_bei("spur/2/fader", 1620224 + 90000), -200, 0);
  PRUEFE_NAH(l.wert_bei("spur/3/fader", 1700000), -1, 0);   // Negativ-Kontrolle: nicht in der KI-Spur
}

FALL(ki_spur_leitstand_und_s2_getrennt) {
  // D1 Spec 6.15: S2 trägt Cyphers Spuren mit spur/<n> ein, der Leitstand seine Kanäle; keiner löscht die Liste des anderen.
  // Kurzform spur/<ziffern> (spur/135 = Spuren 1, 3, 5), weil acht Einträge spur/<n> nicht in 47 Bytes passen.
  Lauf l;
  l.sw->ki_spur(1, Quelle::leitstand, "deck/3");
  l.sw->ki_spur(2, Quelle::andreas, "spur/1,spur/3");   // S2
  l.sw->ki_spur(3, Quelle::leitstand, "deck/3,deck/4");  // Leitstand erneuert seine Kanäle, die Spuren bleiben
  l.sw->ki_spur(4, Quelle::andreas, "spur/135");         // S2 erneuert seine Spuren, die Kanäle bleiben
  char t[128];
  l.sw->ki_spur_text(t, sizeof t);
  PRUEFE(std::strcmp(t, "deck/3,deck/4,spur/135") == 0);
  l.sw->setze_direkt(l.r("deck/3/fader"), -3.0f);
  l.sw->setze_direkt(l.r("deck/4/fader"), -6.0f);
  for (const char* p : {"spur/1/fader", "spur/2/fader", "spur/3/fader", "spur/5/fader"}) l.sw->setze_direkt(l.r(p), -2.0f);
  for (const char* p : {"deck/3/fader", "deck/4/fader", "spur/1/fader", "spur/2/fader", "spur/3/fader", "spur/5/fader"})
    l.beobachte(p);
  l.nachlese_ereignisse();
  l.bis(1620224);
  l.sw->ki_stopp(46, Quelle::andreas);
  l.bis(1800000);
  for (const char* p : {"deck/3/fader", "deck/4/fader", "spur/1/fader", "spur/3/fader", "spur/5/fader"})
    PRUEFE_NAH(l.wert_bei(p, 1790000), -200, 0);
  PRUEFE_NAH(l.wert_bei("spur/2/fader", 1790000), -2, 0);   // Andreas' Spur bleibt laut
}

FALL(ki_spur_leeren_je_art) {
  // spur/0 leert nur die Spuren, die leere Liste nur die Kanäle (Bestand des Leitstands), gemischt ersetzt beides
  Lauf l;
  char t[128];
  l.sw->ki_spur(1, Quelle::leitstand, "deck/3,spur/2");
  l.sw->ki_spur_text(t, sizeof t);
  PRUEFE(std::strcmp(t, "deck/3,spur/2") == 0);
  l.sw->ki_spur(2, Quelle::andreas, "spur/0");
  l.sw->ki_spur_text(t, sizeof t);
  PRUEFE(std::strcmp(t, "deck/3") == 0);
  l.sw->ki_spur(3, Quelle::andreas, "spur/48");
  l.sw->ki_spur(4, Quelle::leitstand, "");
  l.sw->ki_spur_text(t, sizeof t);
  PRUEFE(std::strcmp(t, "spur/48") == 0);
}

FALL(ki_spur_kurzform_falsch_abgelehnt) {
  Lauf l;
  l.sw->ki_spur(1, Quelle::andreas, "spur/13");
  l.sw->ki_spur(2, Quelle::andreas, "spur/");
  l.sw->ki_spur(3, Quelle::andreas, "spur/19");
  l.sw->ki_spur(4, Quelle::andreas, "spur/1a");
  l.nachlese_ereignisse();
  for (int id = 2; id <= 4; id++) PRUEFE(l.grund(id, Status::abgelehnt) == Grund::unbekannter_regler);
  char t[128];
  l.sw->ki_spur_text(t, sizeof t);
  PRUEFE(std::strcmp(t, "spur/13") == 0);   // eine abgelehnte Liste ändert nichts
}

FALL(ki_spur_mit_spur_9_abgelehnt) {
  Lauf l;
  l.sw->ki_spur(7, Quelle::leitstand, "spur/9");
  l.nachlese_ereignisse();
  PRUEFE(l.grund(7, Status::abgelehnt) == Grund::unbekannter_regler);
}

FALL(fader_in_andreas_hand_bleibt_bei_ihm) {
  Aufbau a;
  Lauf& l = a.l;
  l.griff(1000, "deck/3/fader", 0.5f);
  l.griff(1600000, "deck/3/fader", 0.6f);   // Andreas hält den Fader (Rückgabe erst 32 Beats später)
  l.bis(1620224);
  const float gehalten = l.sw->wert(l.r("deck/3/fader"));
  l.sw->ki_stopp(46, Quelle::andreas);
  l.bis(1800000);
  PRUEFE_NAH(l.wert_bei("deck/3/fader", 1790000), gehalten, 0);
  PRUEFE_NAH(l.wert_bei("deck/4/fader", 1790000), -200, 0);
}

FALL(nach_dem_stopp_cypher_abgelehnt_bis_frei_von_andreas) {
  Aufbau a;
  Lauf& l = a.l;
  l.bis(1620224);
  l.sw->ki_stopp(46, Quelle::andreas);
  l.bis(1800192);
  const int64_t x = l.teil("deck/1/fader", 100, 4, -10, "k2", 0);
  PRUEFE(l.grund(x, Status::abgelehnt) == Grund::ki_gestoppt);
  const int64_t y = l.teil("deck/1/fader", 100, 4, -10, "l2", 0, "", Quelle::leitstand);   // Negativ-Kontrolle
  PRUEFE_GLEICH(l.bei(y, Status::angenommen), 1800192);
  l.sw->ki_frei(48, Quelle::cypher);
  l.nachlese_ereignisse();
  PRUEFE(l.grund(48, Status::abgelehnt) == Grund::nur_hand);
  PRUEFE(l.sw->ki_gestoppt());
  l.sw->ki_frei(49, Quelle::andreas);
  l.nachlese_ereignisse();
  PRUEFE(!l.sw->ki_gestoppt());
  const int64_t z = l.teil("deck/1/eq/tief", 100, 4, -10, "k3", 0);
  PRUEFE_GLEICH(l.bei(z, Status::angenommen), 1800192);
}

FALL(stopp_taste_ohne_quittung_mit_wirkung) {
  Aufbau a;
  Lauf& l = a.l;
  l.bis(1620224);
  const size_t vorher = l.ereignisse.size();
  l.sw->ki_stopp(0, Quelle::andreas);
  l.nachlese_ereignisse();
  int quittungen_id0 = 0;
  for (size_t k = vorher; k < l.ereignisse.size(); k++) quittungen_id0 += l.ereignisse[k].art == EreignisArt::quittung && l.ereignisse[k].id == 0;
  PRUEFE_GLEICH(quittungen_id0, 0);
  PRUEFE(l.sw->ki_gestoppt());
  PRUEFE_GLEICH(l.bei(a.c_lauf, Status::abgebrochen), 1620224);
}

FALL(quittungen_angenommen_und_fertig_taste_ohne_quittung) {
  Lauf l;
  l.sw->ki_spur(11, Quelle::leitstand, "deck/3");
  l.sw->ki_stopp(12, Quelle::andreas);
  l.sw->ki_frei(13, Quelle::andreas);
  l.nachlese_ereignisse();
  for (int64_t id : {11, 12, 13}) {
    PRUEFE_GLEICH(l.bei(id, Status::angenommen), 0);
    PRUEFE_GLEICH(l.bei(id, Status::fertig), 0);
  }
  l.sw->ki_stopp(0, Quelle::andreas);   // Stopp-Taste
  l.sw->ki_frei(0, Quelle::andreas);    // Freigabe plus Stopp (§7.3 Punkt 8)
  l.nachlese_ereignisse();
  PRUEFE(!l.sw->ki_gestoppt());
  int id0 = 0;
  for (const Ereignis& e : l.ereignisse) id0 += e.art == EreignisArt::quittung && e.id == 0;
  PRUEFE_GLEICH(id0, 0);
}

FALL(ki_spur_mit_unbekanntem_kanal_abgelehnt) {
  Lauf l;
  l.sw->ki_spur(7, Quelle::leitstand, "deck/3,deck/9");
  l.sw->setze_direkt(l.r("deck/3/fader"), -3.0f);
  l.nachlese_ereignisse();
  PRUEFE(l.grund(7, Status::abgelehnt) == Grund::unbekannter_regler);
  l.sw->ki_stopp(8, Quelle::andreas);
  l.bis(300000);
  PRUEFE_NAH(l.sw->wert(l.r("deck/3/fader")), -3, 0);   // Spur blieb leer
}

PRUEF_MAIN
