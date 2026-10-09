// Scheibe 11, Task 8: Hand-Schiedsrichter nach SCHNITTSTELLEN §7.3 Punkte 1 bis 4 und ADR 023 Punkt 2.
#include "pruef.h"
#include "szenario.h"

using namespace probe;

namespace {
// Rampe deck/2/fader -15 -> 0 ab Beat 64 über 32 Beats (teil_rampe), dazu zwei weitere Teile wie in hand_gewinnt
struct Aufbau {
  Lauf l;
  int64_t p0, p1, p2;
  Aufbau() {
    l.sw->setze_direkt(l.r("deck/2/fader"), -15.0f);
    l.sw->setze_direkt(l.r("deck/2/eq/mitte"), -10.0f);
    l.sw->setze_direkt(l.r("deck/2/eq/hoch"), -10.0f);
    l.beobachte("deck/2/fader");
    p0 = l.teil("deck/2/fader", 64, 32, 0, "p", 0, "b_rein");
    p1 = l.teil("deck/2/eq/mitte", 64, 32, 0, "p", 1, "b_rein");
    p2 = l.teil("deck/2/eq/hoch", 64, 32, 0, "p", 2, "anders");
  }
};
}  // namespace

FALL(erster_wert_nur_stellung_dann_totzone_dann_uebernahme) {
  Aufbau a;
  Lauf& l = a.l;
  l.griff(1500000, "deck/2/fader", 0.5f);                   // erster Wert: nur Stellung
  l.griff(1560000, "deck/2/fader", 0.5f + 2.0f / 128);      // in der Totzone
  l.griff(1620000, "deck/2/fader", 0.5f + 4.0f / 128);      // über der Totzone
  l.bis(2200000);
  PRUEFE_NAH(l.wert_bei("deck/2/fader", 1500000), rampe_db(-15, 0, 64, 32, 1500000), 1e-4);
  PRUEFE_NAH(l.wert_bei("deck/2/fader", 1560000), rampe_db(-15, 0, 64, 32, 1560000), 1e-4);
  PRUEFE_GLEICH(l.bei(a.p0, Status::abgebrochen), 1620000);
  PRUEFE(l.grund(a.p0, Status::abgebrochen) == Grund::hand);
  PRUEFE_GLEICH(l.bei(a.p1, Status::abgebrochen), 1620000);   // Gruppe b_rein fällt mit
  PRUEFE_GLEICH(l.bei(a.p2, Status::fertig), 2160000);        // andere Gruppe läuft weiter
  PRUEFE(l.sw->halter(l.r("deck/2/fader")).art == HalterArt::mensch);
  // skaliert ab der letzten Stellung (0,5 + 2/128 aus der Totzone): (1-u)/(1-p) bleibt gleich, kein Sprung
  const double u0 = amp(rampe_db(-15, 0, 64, 32, 1619999));
  const double basis = 0.5 + 2.0 / 128;
  const double u1 = u0 + (0.5 + 4.0 / 128 - basis) * (1 - u0) / (1 - basis);
  PRUEFE_NAH(l.wert_bei("deck/2/fader", 1620000), 20 * std::log10(u1), 1e-3);
  PRUEFE_NAH(l.wert_bei("deck/2/fader", 2160000), 20 * std::log10(u1), 1e-3);
}

FALL(ohne_plan_keine_totzone) {
  Lauf l;
  l.sw->setze_direkt(l.r("deck/1/fader"), dB(0.8));
  l.beobachte("deck/1/fader");
  l.griff(1000, "deck/1/fader", 0.8f);
  l.griff(20000, "deck/1/fader", 0.81f);   // frei, kein Plan: wirkt sofort
  l.bis(30000);
  PRUEFE_NAH(l.wert_bei("deck/1/fader", 20000), dB(0.81), 1e-4);
  PRUEFE(l.sw->halter(l.r("deck/1/fader")).art == HalterArt::mensch);
}

FALL(beruehrung_uebernimmt_sofort_ohne_wert) {
  Aufbau a;
  Lauf& l = a.l;
  l.griff(1620000, "deck/2/fader", 0, GriffArt::beruehrung);
  l.bis(1700000);
  PRUEFE_GLEICH(l.bei(a.p0, Status::abgebrochen), 1620000);
  PRUEFE_NAH(l.wert_bei("deck/2/fader", 1620000), l.wert_bei("deck/2/fader", 1619999), 0);
  PRUEFE_NAH(l.wert_bei("deck/2/fader", 1690000), l.wert_bei("deck/2/fader", 1619999), 0);
  PRUEFE(l.sw->halter(l.r("deck/2/fader")).art == HalterArt::mensch);
}

FALL(hand_bricht_auch_wartende_teile_ab) {
  Lauf l;
  const int64_t w = l.teil("deck/1/eq/tief", 64, 4, -30, "p", 0, "basstausch");
  const int64_t v = l.teil("deck/2/eq/tief", 64, 4, 0, "p", 1, "basstausch");
  l.griff(100000, "deck/1/eq/tief", 0, GriffArt::beruehrung);
  l.bis(1500000);
  PRUEFE_GLEICH(l.bei(w, Status::abgebrochen), 100000);
  PRUEFE_GLEICH(l.bei(v, Status::abgebrochen), 100000);
  PRUEFE_GLEICH(l.bei(w, Status::gestartet), -1);
  PRUEFE_NAH(l.sw->wert(l.r("deck/2/eq/tief")), 0, 0);
}

FALL(hand_am_selben_sample_wie_teilstart_gewinnt) {
  Lauf l;
  l.beobachte("deck/1/kill/tief");
  l.griff(1000, "deck/1/kill/tief", 0.0f);                 // Stellung bekannt
  const int64_t id = l.teil("deck/1/kill/tief", B(21), 0, 1, "p1", 1);
  l.griff(T(21), "deck/1/kill/tief", 4.0f / 128);          // über der Totzone, genau am Start-Sample
  l.bis(T(21) + 1000);
  PRUEFE_GLEICH(l.bei(id, Status::abgebrochen), T(21));
  PRUEFE(l.grund(id, Status::abgebrochen) == Grund::hand);
  PRUEFE_GLEICH(l.bei(id, Status::gestartet), -1);                 // die Hand kommt vor dem Start: nie gestartet
  PRUEFE_NAH(l.wert_bei("deck/1/kill/tief", T(21) + 240), 0, 0);   // Hand (Bass an), nicht Plan (1)
}

// F18 (Audit 2026-10-01, Welle 2 Slice 2.3): ein Kill-Griff der Hand ist keine Stufe, sondern die Schaltrampe des Reglers
// (kill/*: 240 Samples = 5 ms, SCHNITTSTELLEN §1.5) als S-Kurve vom Ist-Wert. Vorher schrieb hand.cpp:139 den Zielwert
// am Griff-Sample (größter Schritt 1,0).
FALL(kill_hand_mit_schaltrampe) {
  Lauf l;
  l.beobachte("deck/1/kill/tief");
  l.griff(1000, "deck/1/kill/tief", 0.0f);   // erster Wert: nur Stellung
  l.griff(50000, "deck/1/kill/tief", 1.0f);  // Kill an
  l.bis(50100);
  const int r = l.r("deck/1/kill/tief");
  PRUEFE_NAH(l.sw->wert_fest(r), 1, 0);                                   // nach außen gilt das Ziel (Neustart, Taste)
  PRUEFE(l.sw->wert(r) > 0.0f && l.sw->wert(r) < 1.0f);                   // innen läuft die Rampe
  l.bis(60000);
  const int n = l.sw->tabelle().def(r).schalt_samples;
  PRUEFE_GLEICH(n, 240);
  PRUEFE_NAH(l.wert_bei("deck/1/kill/tief", 49999), 0, 0);
  PRUEFE_NAH(l.wert_bei("deck/1/kill/tief", 50000), 0, 0);              // Griff-Sample: noch der Ist-Wert (wie ablauf.cpp:32)
  PRUEFE_NAH(l.wert_bei("deck/1/kill/tief", 50000 + n / 2), 0.5, 1e-6);  // S-Kurve: Mitte genau 0,5
  PRUEFE_NAH(l.wert_bei("deck/1/kill/tief", 50000 + n), 1, 0);
  PRUEFE_NAH(l.wert_bei("deck/1/kill/tief", 59999), 1, 0);
  PRUEFE(l.max_schritt("deck/1/kill/tief") <= 1.5 / n + 1e-6);          // S-Kurve: größter Schritt 1,5/n
  PRUEFE(l.sw->halter(r).art == HalterArt::mensch);
}

// F18: Umkehr mitten in der Rampe (Kill an, nach 100 Samples wieder aus) beginnt beim Ist-Wert, kein Sprung.
FALL(kill_hand_umkehr_mitten_in_der_rampe) {
  Lauf l;
  l.beobachte("deck/1/kill/tief");
  l.griff(1000, "deck/1/kill/tief", 0.0f);
  l.griff(50000, "deck/1/kill/tief", 1.0f);
  l.griff(50100, "deck/1/kill/tief", 0.0f);
  l.bis(60000);
  const float umkehr = l.wert_bei("deck/1/kill/tief", 50100);
  PRUEFE(umkehr > 0.3f && umkehr < 0.45f);                              // S(99/240) = 0,37
  PRUEFE_NAH(l.wert_bei("deck/1/kill/tief", 50100 + 240), 0, 0);
  PRUEFE(l.max_schritt("deck/1/kill/tief") <= 1.5 / 240 + 1e-6);
}

// F18 am echten Weg der Taste: regler_umschalten wird ein relativer Griff ±1 (hand_ein.cpp:40, naht_stellwerk.cpp:26-28),
// ohne „erster Wert nur Stellung“. An und wieder aus, je die 5-ms-S-Kurve.
FALL(kill_taste_relativ_mit_schaltrampe) {
  Lauf l;
  l.beobachte("deck/1/kill/tief");
  l.griff(50000, "deck/1/kill/tief", 1.0f, GriffArt::relativ);
  l.griff(80000, "deck/1/kill/tief", -1.0f, GriffArt::relativ);
  l.bis(90000);
  PRUEFE_NAH(l.wert_bei("deck/1/kill/tief", 50000), 0, 0);
  PRUEFE_NAH(l.wert_bei("deck/1/kill/tief", 50120), 0.5, 1e-6);
  PRUEFE_NAH(l.wert_bei("deck/1/kill/tief", 50240), 1, 0);
  PRUEFE_NAH(l.wert_bei("deck/1/kill/tief", 80120), 0.5, 1e-6);
  PRUEFE_NAH(l.wert_bei("deck/1/kill/tief", 80240), 0, 0);
  PRUEFE(l.max_schritt("deck/1/kill/tief") <= 1.5 / 240 + 1e-6);
}

// F18: nach außen ist kill/* ein Schalter 0/1 (§1.5): /e/regler und /e/hand tragen nie einen Zwischenwert der Rampe; die
// erste /e/regler nach dem Griff (Halterwechsel, §5.7) trägt das Ziel 1, nicht den Ist-Wert 0 (test_kern_mixer schalter()).
FALL(kill_hand_meldet_nur_schalterwerte) {
  Lauf l;
  const int r = l.r("deck/1/kill/tief");
  l.griff(50000, "deck/1/kill/tief", 1.0f, GriffArt::relativ);
  l.griff(51000, "deck/1/kill/tief", -1.0f, GriffArt::relativ);
  l.bis(60000);
  int n = 0, schief = 0;
  float erste = -1.0f;
  for (const Ereignis& e : l.ereignisse) {
    if ((e.art != EreignisArt::regler && e.art != EreignisArt::hand) || e.regler != r) continue;
    ++n;
    if (e.wert != 0.0f && e.wert != 1.0f) ++schief;
    if (e.art == EreignisArt::regler && erste < 0.0f && e.sample >= 50000) erste = e.wert;
  }
  PRUEFE(n >= 2);
  PRUEFE_GLEICH(schief, 0);
  PRUEFE_NAH(erste, 1, 0);
}

FALL(relativ_mit_totzone_ueber_die_summe) {
  Lauf l;
  l.sw->setze_direkt(l.r("deck/1/filter"), 0.0f);
  l.beobachte("deck/1/filter");
  const int64_t id = l.teil("deck/1/filter", 64, 32, 1, "p", 0);
  for (int k = 0; k < 5; k++) l.griff(1620000 + k * 1000, "deck/1/filter", 0.01f, GriffArt::relativ);
  l.bis(1700000);
  PRUEFE_GLEICH(l.bei(id, Status::abgebrochen), 1622000);   // Summe 0,03 > 3/128 beim dritten Schritt
  const double u = (rampe_db(0, 1, 64, 32, 1621999) + 1.0) / 2.0;   // Filter linear -1..1
  PRUEFE_NAH(l.wert_bei("deck/1/filter", 1624000), -1.0 + 2.0 * (u + 0.03), 1e-4);
}

FALL(freigabe_gibt_zurueck) {
  Lauf l;
  l.griff(1000, "deck/1/fader", 0.5f);
  l.griff(2000, "deck/1/fader", 0.6f);
  l.griff(50000, "deck/1/fader", 0, GriffArt::freigabe);
  l.bis(3000);
  PRUEFE(l.sw->halter(l.r("deck/1/fader")).art == HalterArt::mensch);
  l.bis(60000);
  PRUEFE(l.sw->halter(l.r("deck/1/fader")).art == HalterArt::frei);
}

FALL(rueckgabe_nach_32_beats_ohne_hand) {
  Lauf l;
  l.griff(1000, "deck/1/fader", 0.5f);
  l.griff(100000, "deck/1/fader", 0.6f);
  l.griff(200000, "deck/2/fader", 0.5f);
  l.griff(300000, "deck/2/fader", 0.6f);
  l.griff(500000, "deck/2/fader", 0.7f);   // bewegt: Frist beginnt neu
  l.bis(1300000);
  int64_t frei1 = -1, frei2 = -1;
  for (const Ereignis& e : l.ereignisse) {
    if (e.art != EreignisArt::halter || std::strcmp(e.halter, "frei") != 0) continue;
    if (e.regler == l.r("deck/1/fader")) frei1 = e.sample;
    if (e.regler == l.r("deck/2/fader")) frei2 = e.sample;
  }
  PRUEFE_GLEICH(frei1, 100000 + 720000);   // 32 Beats bei 128 BPM = 720 000 Samples
  PRUEFE_GLEICH(frei2, 500000 + 720000);
}

FALL(stellung_vergessen_nach_neuverbindung) {
  Lauf l;
  l.sw->setze_direkt(l.r("deck/1/fader"), -6.0f);
  l.beobachte("deck/1/fader");
  l.griff(1000, "deck/1/fader", 0.5f);
  l.bis(2048);
  l.sw->stellung_vergessen();
  l.griff(3000, "deck/1/fader", 0.9f);    // erster Wert nach Neuverbindung: nur Stellung
  l.griff(3600, "deck/1/fader", 0.95f);   // der zweite wirkt, skaliert ab der neuen Stellung 0,9
  l.bis(4096);
  PRUEFE_NAH(l.wert_bei("deck/1/fader", 3500), -6, 0);
  const double u = std::pow(10.0, -6.0 / 20) + (0.95 - 0.9) * (1 - std::pow(10.0, -6.0 / 20)) / (1 - 0.9);
  PRUEFE_NAH(l.wert_bei("deck/1/fader", 3600), 20 * std::log10(u), 1e-3);   // nicht 0,95 der alten Stellung 0,5
}

FALL(deck_halter_32_beats_nach_der_transport_taste) {
  Lauf l;
  l.sw->deck_taste(1, 100000);
  l.bis(100352);
  PRUEFE(l.sw->deck_beruehrt(1));
  PRUEFE(!l.sw->deck_beruehrt(2));                          // Negativ-Kontrolle: anderes Deck
  l.sw->deck_taste(1, 400000);                              // zweite Taste: Frist beginnt neu
  l.bis(1200000);
  PRUEFE(!l.sw->deck_beruehrt(1));
  int64_t mensch = -1, frei = -1;
  int regler = 0, hand = 0;
  const int tr = l.r("deck/1/transport");
  for (const Ereignis& e : l.ereignisse) {
    if (e.regler != tr) continue;
    if (e.art == EreignisArt::halter && !std::strcmp(e.halter, "mensch")) mensch = e.sample;
    if (e.art == EreignisArt::halter && !std::strcmp(e.halter, "frei")) frei = e.sample;
    regler += e.art == EreignisArt::regler;
    hand += e.art == EreignisArt::hand;
  }
  PRUEFE_GLEICH(mensch, 100000);
  PRUEFE_GLEICH(frei, 400000 + 720000);
  PRUEFE_GLEICH(regler, 0);   // transport ist kein Regler: nur /e/halter (§5.9)
  PRUEFE_GLEICH(hand, 0);
}

FALL(halter_am_start_sample_nach_rueckgabe_im_selben_zyklus) {
  for (const int64_t start : {722010, 721990}) {   // Rückgabe bei 722 000 (32 Beats nach dem Griff bei 2 000)
    Lauf l;
    l.griff(1000, "deck/1/fader", 0.5f);
    l.griff(2000, "deck/1/fader", 0.6f);
    l.bis(2048);                                  // erst greifen, dann einreichen (sonst bricht der Griff den Teil ab)
    const int64_t id = l.teil("deck/1/fader", static_cast<double>(start) / 22500.0, 0, -6, "p", 0);
    l.bis(723000);
    PRUEFE(722000 / BLOCK == start / BLOCK);   // Rückgabe und Start im selben Zyklus
    if (start > 722000) {
      PRUEFE_GLEICH(l.bei(id, Status::gestartet), start);
    } else {   // Negativ-Kontrolle: vor der Rückgabe hält der Mensch noch
      PRUEFE(l.grund(id, Status::abgelehnt) == Grund::regler_beim_menschen);
      PRUEFE_GLEICH(l.bei(id, Status::abgelehnt), start);
    }
  }
}

FALL(verspaeteter_griff_wirkt_am_zyklusanfang) {
  Lauf l;
  l.beobachte("deck/1/fader");
  l.griff(100, "deck/1/fader", 0.5f);
  l.bis(1024);
  l.griff(900, "deck/1/fader", 1.0f);     // Sample liegt schon hinter jetzt()
  l.bis(1280);
  PRUEFE_NAH(l.wert_bei("deck/1/fader", 1023), -200, 0);
  PRUEFE_NAH(l.wert_bei("deck/1/fader", 1024), 0, 1e-4);
}

PRUEF_MAIN
