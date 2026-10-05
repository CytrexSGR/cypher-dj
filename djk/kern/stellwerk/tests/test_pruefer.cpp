// Scheibe 11, Task 11: die Prüfer-Schnittstelle trägt, was Scheibe 20 braucht. Ein Probe-Prüfer (nur Test, keine
// echte Invariante) nutzt alle Haken: vor_teilstart lehnt ab (I3a-artig, mit Öffner nach Startfolge), je_zyklus bricht
// ab und hält an (I1- und I2-artig, mit Vorschau auf das Zyklusende), nach_handgriff sieht den Handwert und greift ein,
// gruppe_gefallen und gruppe_abbrechen tragen Deck-Teile außerhalb der Regler-Tabelle.
#include "probe_pruefer.h"
#include "pruef.h"
#include "szenario.h"

using namespace probe;

FALL(leerer_standard_pruefer_aendert_nichts) {
  Pruefer leer;
  Lauf a, b(128.0, &leer);
  for (Lauf* l : {&a, &b}) {
    l->sw->setze_direkt(l->r("deck/2/fader"), -15.0f);
    l->beobachte("deck/2/fader");
    l->teil("deck/2/fader", 64, 32, 0, "p1", 0);
    l->bis(2200000);
  }
  for (int64_t s : {1440000, 1800000, 2160000}) PRUEFE_NAH(a.wert_bei("deck/2/fader", s), b.wert_bei("deck/2/fader", s), 0);
  PRUEFE_GLEICH(a.ereignisse.size(), b.ereignisse.size());
}

FALL(vor_teilstart_lehnt_ab_und_die_gruppe_faellt) {
  ProbePruefer p;
  Lauf l(128.0, &p);
  l.beobachte("deck/2/fader");
  const int64_t f = l.teil("deck/2/fader", 64, 32, -10, "pB", 0, "b_rein");
  const int64_t q = l.teil("deck/2/eq/tief", 60, 8, -30, "pB", 1, "b_rein");   // läuft schon, fällt mit
  l.bis(1500000);
  PRUEFE(l.grund(f, Status::abgelehnt) == Grund::kein_hoerschein);
  PRUEFE_GLEICH(l.bei(f, Status::abgelehnt), 1440000);
  PRUEFE_GLEICH(l.bei(q, Status::abgebrochen), 1440000);
  PRUEFE(l.grund(q, Status::abgebrochen) == Grund::kein_hoerschein);
  PRUEFE_NAH(l.wert_bei("deck/2/fader", 1499999), -200, 0);   // nichts wurde hörbar
  PRUEFE_GLEICH(p.gefallen.size(), 1);                         // gruppe_gefallen einmal, am Start-Sample
  if (p.gefallen.size() == 1) PRUEFE(p.gefallen[0] == "pB/b_rein/kein_hoerschein@1440000");
}

FALL(vor_teilstart_mit_hoerschein_und_negativ_kontrolle) {
  auto lauf = [](const char* hs, double bpm, double gueltig, double tempo_danach) {
    ProbePruefer p;
    p.scheine["h12"] = Schein{"deck/2", bpm, gueltig};
    Lauf l(128.0, &p);
    TeilBefehl b{77, Quelle::cypher, "pB", 0, "deck/2/fader", 64, 32, -10, 0, 0, "", hs};
    l.sw->teil(b);
    if (tempo_danach > 0) {
      l.bis(1000192);
      l.uhr.konstant_ab(1000192, tempo_danach);   // Tempo nach der Annahme: Prüfung am Start
    }
    l.bis(1500000);
    l.nachlese_ereignisse();
    return l.bei(77, Status::gestartet) >= 0 ? Grund::kein : l.grund(77, Status::abgelehnt);
  };
  PRUEFE(lauf("h12", 128, 200, 0) == Grund::kein);                          // Negativ-Kontrolle: gültig, startet
  PRUEFE(lauf("h99", 128, 200, 0) == Grund::kein_hoerschein);
  PRUEFE(lauf("h12", 126, 200, 0) == Grund::hoerschein_anderes_tempo);
  PRUEFE(lauf("h12", 128, 60, 0) == Grund::hoerschein_abgelaufen);
  PRUEFE(lauf("h12", 128, 200, 132) == Grund::hoerschein_anderes_tempo);    // Zweitprüfung am Start
}

FALL(pruefwert_vor_und_mit_bestimmen_den_oeffner) {
  // §14.1 Teile 2 und 3: Teil 2 öffnet (mit Hörschein), Teil 3 beginnt bei dessen Zielwert und öffnet nicht mehr
  ProbePruefer p;
  p.scheine["h12"] = Schein{"deck/2", 128, 200};
  Lauf l(128.0, &p);
  TeilBefehl t2{20, Quelle::cypher, "p17", 2, "deck/2/fader", 64, 0, -15, 0, 0, "b_rein", "h12"};
  TeilBefehl t3{21, Quelle::cypher, "p17", 3, "deck/2/fader", 64, 32, 0, 0, 0, "b_rein", ""};
  l.sw->teil(t2);
  l.sw->teil(t3);
  l.bis(1500000);
  l.nachlese_ereignisse();
  PRUEFE_GLEICH(l.bei(20, Status::gestartet), 1440000);
  PRUEFE_GLEICH(l.bei(21, Status::gestartet), 1440000);
  // Negativ-Kontrolle: Teil 3 allein öffnet den Kanal selbst und braucht dann einen Hörschein
  ProbePruefer p2;
  Lauf m(128.0, &p2);
  m.sw->teil(t3);
  m.bis(1500000);
  m.nachlese_ereignisse();
  PRUEFE(m.grund(21, Status::abgelehnt) == Grund::kein_hoerschein);
}

FALL(basstausch_als_paar_am_selben_sample_gueltig) {
  // §17 Reihenfolge: die Prüfung sieht den Zustand nach ALLEN Teilen des Samples. A gibt den Bass ab, B nimmt ihn.
  for (const bool mit_a : {true, false}) {
    ProbePruefer p;
    p.i1_start = true;
    Lauf l(128.0, &p);
    l.sw->setze_direkt(l.r("deck/1/fader"), 0.0f);
    l.sw->setze_direkt(l.r("deck/2/fader"), 0.0f);
    l.sw->setze_direkt(l.r("deck/2/kill/tief"), 1.0f);
    const int64_t b = l.teil("deck/2/kill/tief", 64, 0, 0, "pT", 1, "basstausch");   // B öffnet den Bass
    int64_t a = -1;
    if (mit_a) a = l.teil("deck/1/kill/tief", 64, 0, 1, "pT", 2, "basstausch");       // A schließt, höhere Nummer
    l.bis(1500000);
    if (mit_a) {
      PRUEFE_GLEICH(l.bei(b, Status::gestartet), 1440000);
      PRUEFE_GLEICH(l.bei(a, Status::gestartet), 1440000);
    } else {   // Negativ-Kontrolle: ohne A-Teil wären zwei Kanäle tief offen
      PRUEFE(l.grund(b, Status::abgelehnt) == Grund::invariante_sub_doppelt);
    }
  }
}

FALL(je_zyklus_bricht_vor_dem_oeffnen_ab) {
  for (const bool a_offen : {true, false}) {
    ProbePruefer p;
    p.i1 = true;
    Lauf l(128.0, &p);
    l.sw->setze_direkt(l.r("deck/1/fader"), 0.0f);
    l.sw->setze_direkt(l.r("deck/1/eq/tief"), a_offen ? 0.0f : -30.0f);
    l.sw->setze_direkt(l.r("deck/2/fader"), 0.0f);
    l.sw->setze_direkt(l.r("deck/2/eq/tief"), -30.0f);
    l.beobachte("deck/2/eq/tief");
    const int64_t id = l.teil("deck/2/eq/tief", 64, 4, 0, "p", 0);
    l.bis(1600000);
    if (a_offen) {
      PRUEFE_GLEICH(l.bei(id, Status::abgebrochen), 1493760);   // Zyklus, an dessen Ende B die -12 dB überschritte
      PRUEFE(l.grund(id, Status::abgebrochen) == Grund::invariante_sub_doppelt);
      PRUEFE(l.wert_bei("deck/2/eq/tief", 1599999) <= -12.0f);
      PRUEFE_GLEICH(l.zahl(EreignisArt::invariante), 1);
    } else {
      PRUEFE_GLEICH(l.bei(id, Status::fertig), 1530000);         // Negativ-Kontrolle: A zu, B darf auf
      PRUEFE_GLEICH(l.zahl(EreignisArt::invariante), 0);
    }
  }
}

FALL(je_zyklus_haelt_an_und_setzt_fort) {
  ProbePruefer p;
  p.i2 = true;
  Lauf l(128.0, &p);
  l.sw->setze_direkt(l.r("deck/1/fader"), 0.0f);
  l.beobachte("deck/1/fader");
  const int64_t id = l.teil("deck/1/fader", 64, 8, -200, "a", 0);   // A läuft aus, B ist zu
  l.bis(1600000);
  PRUEFE(l.wert_bei("deck/1/fader", 1599999) > -26.0f);             // angehalten, Master nie leer
  PRUEFE_GLEICH(l.bei(id, Status::fertig), -1);
  PRUEFE_GLEICH(l.zahl(EreignisArt::invariante), 1);
  l.sw->setze_direkt(l.r("deck/2/fader"), 0.0f);                    // B wird hörbar
  l.bis(1700000);
  PRUEFE_GLEICH(l.bei(id, Status::fertig), 1620000);                // unveränderter Ende-Beat 72
  PRUEFE_NAH(l.wert_bei("deck/1/fader", 1620000), -200, 0);
}

FALL(nach_handgriff_sieht_den_handwert_und_greift_ein) {
  ProbePruefer p;
  p.hand_greift = true;
  p.deckteil_gruppe = "b_rein";
  p.deckteil_offen = true;   // wie 20: ein Deck-Teil der Gruppe b_rein liegt außerhalb der Regler-Tabelle
  Lauf l(128.0, &p);
  const int64_t b = l.teil("deck/2/eq/tief", 64, 16, 0, "p", 1);
  const int64_t c = l.teil("deck/2/fader", 70, 8, -10, "pD", 0, "b_rein");
  l.griff(1000, "deck/1/eq/tief", 0.8125f);
  l.griff(1500000, "deck/1/eq/tief", 0.8125f + 5.0f / 128);
  l.bis(1600000);
  PRUEFE_GLEICH(p.hand_gesehen.size(), 1);   // die Stellung allein ist kein Handgriff
  if (p.hand_gesehen.size() == 1) {
    PRUEFE_GLEICH(p.hand_gesehen[0].first, 1500000);
    PRUEFE_NAH(p.hand_gesehen[0].second, l.sw->wert(l.r("deck/1/eq/tief")), 0);
  }
  PRUEFE_GLEICH(l.bei(b, Status::abgebrochen), 1500000);
  PRUEFE_GLEICH(l.bei(c, Status::abgebrochen), 1500000);   // gruppe_abbrechen nahm den Regler-Teil der Gruppe mit
  PRUEFE(!p.deckteil_offen);                               // und gruppe_gefallen den Deck-Teil
}

FALL(nach_handgriff_auch_fuer_die_transport_taste) {
  ProbePruefer p;
  Lauf l(128.0, &p);
  l.sw->deck_taste(2, 5000);
  l.bis(6000);
  PRUEFE_GLEICH(p.hand_gesehen.size(), 1);   // 20 braucht das für den Frist-Wächter (§17: jeder Griff an das Deck)
  if (!p.hand_gesehen.empty()) PRUEFE_GLEICH(p.hand_gesehen[0].first, 5000);
}

FALL(gruppe_gefallen_bei_hand_und_abbruch_nicht_ohne_gruppe) {
  ProbePruefer p;
  Lauf l(128.0, &p);
  l.teil("deck/1/fader", 64, 32, -30, "p", 0, "a_raus");
  l.teil("deck/1/eq/mitte", 64, 32, -26, "p", 1, "a_raus");
  l.teil("deck/1/eq/hoch", 64, 32, -26, "p", 2, "");
  l.griff(1000, "deck/1/fader", 0.5f, GriffArt::beruehrung);   // Berührung: übernimmt sofort
  l.bis(2048);
  PRUEFE_GLEICH(p.gefallen.size(), 1);
  if (!p.gefallen.empty()) PRUEFE(p.gefallen[0] == "p/a_raus/hand@1000");
  l.sw->abbruch(9, Quelle::leitstand, "p", nullptr, -1);   // übrig: eq/hoch ohne Gruppe
  l.bis(4096);
  PRUEFE_GLEICH(p.gefallen.size(), 1);                     // Negativ-Kontrolle: ohne Gruppe keine Meldung
}

FALL(intern_teile_werden_nicht_vorgelegt) {
  ProbePruefer p;   // lehnt jedes Öffnen ohne Hörschein ab; die KI-Stopp-Blende öffnet nichts, wird aber gar nicht gefragt
  p.i1_start = true;
  Lauf l(128.0, &p);
  l.sw->ki_spur(1, Quelle::leitstand, "deck/1,deck/2");
  l.sw->setze_direkt(l.r("deck/1/fader"), 0.0f);
  l.sw->setze_direkt(l.r("deck/2/fader"), 0.0f);   // beide tief offen: i1_start würde jeden vorgelegten Teil ablehnen
  l.bis(25600);
  l.sw->ki_stopp(2, Quelle::andreas);
  l.bis(25600 + 100000);
  PRUEFE_NAH(l.sw->wert(l.r("deck/1/fader")), -200, 0);   // Blende lief trotz Prüfer
  PRUEFE_NAH(l.sw->wert(l.r("deck/2/fader")), -200, 0);
}

FALL(vorschau_stimmt_mit_dem_ablauf_ueberein) {
  ProbePruefer p;
  Lauf l(128.0, &p);
  p.beobachtet = l.r("deck/2/fader");
  l.beobachte("deck/2/fader");
  l.teil("deck/2/fader", 10, 0, -15, "v", 0);          // Setzen aus stumm, Schaltrampe über Zyklusgrenzen
  l.teil("deck/2/fader", 20.1, 0, -6, "v", 1);         // Setzen mitten im Zyklus
  l.teil("deck/2/fader", 20.1, 8, -40, "v", 2);        // Rampe ab dessen Zielwert
  l.teil("deck/2/fader", 28.1, 2, -200, "v", 3);       // nach stumm
  l.bis(800000);
  int verglichen = 0, falsch = 0;
  for (const auto& [s, v] : p.vorschau_ende) {
    verglichen++;
    if (std::fabs(l.wert_bei("deck/2/fader", s) - v) > 1e-5) falsch++;
  }
  PRUEFE(verglichen > 3000);
  PRUEFE_GLEICH(falsch, 0);
}

PRUEF_MAIN
