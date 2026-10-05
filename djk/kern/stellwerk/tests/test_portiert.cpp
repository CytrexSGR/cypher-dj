// Scheibe 11, Task 12: die 12 Tests aus proben/09-ki-steuerung/stellwerk.test.mjs, portiert auf Vertragsversion 1.
// Szenario wie szenario.mjs: 48 kHz, 128 BPM, Takt = 90 000 Samples, Block 256, eingereicht bei Takt 9.
// Umrechnung: A.gain 0,8 -> deck/1/fader -1,9382 dB (Kurve fader_db: Stellung = Amplitude), A.bass an -> deck/1/kill/tief 0,
// B.gain 0 -> deck/2/fader -200, B.bass aus -> deck/2/kill/tief 1. Abweichungen vom Prototyp stehen je Fall mit Grund.
#include "probe_pruefer.h"
#include "pruef.h"
#include "szenario.h"

using namespace probe;

namespace {

const float A08 = dB(0.8);   // -1,9382 dB

// PLAN aus szenario.mjs: Fader A ab Takt 17 über 8 Takte auf stumm, Bass A aus auf Takt 21
struct Szenario {
  Lauf l;
  int64_t fader = 0, kill = 0;
  explicit Szenario(Pruefer* p = nullptr, bool mit_plan = true) : l(128.0, p) {
    l.sw->setze_direkt(l.r("deck/1/fader"), A08);
    l.sw->setze_direkt(l.r("deck/2/kill/tief"), 1.0f);
    l.beobachte("deck/1/fader");
    l.beobachte("deck/1/kill/tief");
    l.beobachte("deck/2/fader");
    l.beobachte("deck/2/kill/tief");
    l.griff(1000, "deck/1/fader", 0.8f);   // der Controller meldet beim Start seine Stellung (§7.3 Punkt 2)
    l.bis(T(9));
    if (mit_plan) {
      fader = l.teil("deck/1/fader", B(17), 32, -200, "p1", 0);
      kill = l.teil("deck/1/kill/tief", B(21), 0, 1, "p1", 1);
    }
  }
  // HANDGRIFF: Berührung bei Takt 19, dann in einem halben Schlag von 0,81 auf 0,90 (10 MIDI-Schritte)
  void handgriff() {
    l.griff(T(19), "deck/1/fader", 0, GriffArt::beruehrung);
    for (int k = 0; k < 10; k++) l.griff(T(19) + k * 1406, "deck/1/fader", 0.81f + 0.01f * k);
  }
  void handgriff_relativ() {
    for (int k = 0; k < 10; k++) l.griff(T(19) + k * 1406, "deck/1/fader", 0.01f, GriffArt::relativ);
  }
};

double plan_a(int64_t s) { return rampe_db(A08, -200, B(17), 32, s); }
// skaliert: (1-u)/(1-p) bleibt ab der Übernahme gleich; Übernahme bei Stellung 0,8 und Planwert u0
double hand_a(double u0, double p) { return 20 * std::log10(1 - (1 - u0) * (1 - p) / (1 - 0.8)); }

}  // namespace

// Prototyp-Test 1
FALL(t01_negativ_kontrolle_ohne_handgriff_laeuft_der_plan_vollstaendig) {
  Szenario z;
  z.l.bis(T(28));
  PRUEFE_GLEICH(z.l.bei(z.fader, Status::gestartet), T(17));
  PRUEFE_GLEICH(z.l.bei(z.fader, Status::fertig), T(25));
  PRUEFE_GLEICH(z.l.bei(z.kill, Status::gestartet), T(21));
  PRUEFE_NAH(z.l.wert_bei("deck/1/fader", T(17)), A08, 1e-5);
  PRUEFE_NAH(z.l.wert_bei("deck/1/fader", T(19)), plan_a(T(19)), 1e-4);   // -16,45 dB (Prototyp in Gain: 0,6)
  PRUEFE_NAH(z.l.wert_bei("deck/1/fader", T(21)), plan_a(T(21)), 1e-4);   // -30,97 dB (Prototyp: 0,4)
  PRUEFE_NAH(z.l.wert_bei("deck/1/fader", T(25)), -200, 0);
  PRUEFE_NAH(z.l.wert_bei("deck/1/fader", T(27)), -200, 0);
  PRUEFE_NAH(z.l.wert_bei("deck/1/kill/tief", T(21) - 1), 0, 0);
  PRUEFE_NAH(z.l.wert_bei("deck/1/kill/tief", T(21) + 240), 1, 0);          // Vertrag: Schaltrampe 5 ms
  PRUEFE(z.l.max_schritt("deck/1/fader") <= 0.0011);   // größter Schritt: -60 dB -> stumm am Ende (§1.2)
}

// Prototyp-Test 2
FALL(t02_handgriff_bei_takt_19_fader_teil_endet_am_selben_sample_kill_laeuft_weiter) {
  Szenario z;
  z.handgriff();
  z.l.bis(T(28));
  PRUEFE_GLEICH(z.l.bei(z.fader, Status::abgebrochen), T(19));    // 0 Samples Verzug
  PRUEFE(z.l.grund(z.fader, Status::abgebrochen) == Grund::hand);
  PRUEFE_GLEICH(z.l.bei(z.kill, Status::abgebrochen), -1);        // nur dieser Regler
  PRUEFE_NAH(z.l.wert_bei("deck/1/fader", T(19) - 1), plan_a(T(19) - 1), 1e-4);
  const double u0 = amp(plan_a(T(19) - 1));
  PRUEFE_NAH(z.l.wert_bei("deck/1/fader", T(21)), hand_a(u0, 0.90), 1e-3);   // Hand, nicht Plan (Plan: -30,97)
  PRUEFE_NAH(z.l.wert_bei("deck/1/fader", T(25)), hand_a(u0, 0.90), 1e-3);   // Plan wäre stumm
  PRUEFE_NAH(z.l.wert_bei("deck/1/kill/tief", T(21) - 1), 0, 0);
  PRUEFE_GLEICH(z.l.bei(z.kill, Status::fertig), T(21) + 240);   // anderer Teil unberührt, sample-genau
  PRUEFE(z.l.max_schritt("deck/1/fader") <= 0.05);                // kein Sprung beim Übernehmen
  int64_t mensch = -1, frei = -1;
  for (const Ereignis& e : z.l.ereignisse) {
    if (e.art != EreignisArt::halter || e.regler != z.l.r("deck/1/fader")) continue;
    if (!std::strcmp(e.halter, "mensch")) mensch = e.sample;
    if (!std::strcmp(e.halter, "frei") && e.sample > T(19)) frei = e.sample;
  }
  PRUEFE_GLEICH(mensch, T(19));
  PRUEFE_GLEICH(frei, T(19) + 9 * 1406 + 720000);   // 32 Beats nach dem letzten Griff; Prototyp: 2 352 654
}

// Prototyp-Test 3 ("Vergleich naiv: Blockraster"): Kill und Griff wirken am Sample, nicht an der Blockgrenze.
// Der naive Wert (1 800 192 bzw. 1 620 224) erscheint in der Mutationsmatrix als Fehlerbild von M01.
FALL(t03_kill_und_griff_am_sample_nicht_an_der_blockgrenze) {
  Szenario z;
  z.handgriff();
  z.l.bis(T(28));
  PRUEFE(T(21) % BLOCK != 0 && T(19) % BLOCK != 0);
  PRUEFE_GLEICH(z.l.bei(z.kill, Status::gestartet), 1800000);     // naiv: 1 800 192 (4,0 ms zu spät)
  PRUEFE_GLEICH(z.l.bei(z.fader, Status::abgebrochen), 1620000);  // naiv: 1 620 224 (4,67 ms zu spät)
}

// Prototyp-Test 4 ("Vergleich naiv: ohne Schiedsrichter überschreibt der Plan die Hand"): mit Schiedsrichter wirkt
// die Hand; ohne ihn (Mutation M04) liefe der Plan weiter.
FALL(t04_schiedsrichter_die_hand_wirkt_der_plan_nicht) {
  Szenario z;
  z.handgriff();
  z.l.bis(T(28));
  PRUEFE(z.l.zahl(EreignisArt::hand, "deck/1/fader") >= 2);        // Hand kam an ...
  PRUEFE(z.l.wert_bei("deck/1/fader", T(21)) > -10.0f);            // ... und wirkt (Plan: -30,97)
  PRUEFE(z.l.wert_bei("deck/1/fader", T(25)) > -10.0f);            // (Plan: stumm)
}

// Prototyp-Test 5 ("Vergleich naiv: Hand bricht ganzen Plan ab, Bass A bleibt an"): hier geht der Bass trotzdem aus.
FALL(t05_hand_bricht_nicht_den_ganzen_plan) {
  Szenario z;
  z.handgriff();
  z.l.bis(T(28));
  PRUEFE_NAH(z.l.wert_bei("deck/1/kill/tief", T(21) + 240), 1, 0);
  PRUEFE_GLEICH(z.l.bei(z.kill, Status::fertig), T(21) + 240);
}

// Prototyp-Test 6: Übernahme. Vertrag: nur skaliert (absolut) und relativ (Encoder), ADR 014; sprung und pickup
// gibt es nicht mehr (sprung erscheint als Mutation M07 mit Schritt über 0,05, pickup ist verworfen).
FALL(t06_uebernahme_skaliert_und_relativ_ohne_sprung) {
  Szenario sk;
  sk.handgriff();
  sk.l.bis(T(26));
  const double u0 = amp(plan_a(T(19) - 1));
  PRUEFE_NAH(sk.l.wert_bei("deck/1/fader", T(25)), hand_a(u0, 0.90), 1e-3);   // Prototyp: 0,8 bei p = 0,9
  PRUEFE(sk.l.max_schritt("deck/1/fader") <= 0.05);
  Szenario rel;
  rel.handgriff_relativ();
  rel.l.bis(T(26));
  // Totzone über die Summe (§7.3 Punkt 3): Übernahme beim dritten Schritt, danach 8 Schritte zu 0,01
  PRUEFE_GLEICH(rel.l.bei(rel.fader, Status::abgebrochen), T(19) + 2 * 1406);
  const double u_rel = amp(plan_a(T(19) + 2 * 1406 - 1)) + 0.08;
  PRUEFE_NAH(rel.l.wert_bei("deck/1/fader", T(25)), 20 * std::log10(u_rel), 1e-3);   // Prototyp: 0,7 ohne Totzone
  PRUEFE(rel.l.max_schritt("deck/1/fader") <= 0.011);
}

// Prototyp-Test 7
FALL(t07_tempo_132_ab_takt_18_schaltpunkte_bleiben_auf_ihrem_takt) {
  Szenario z;
  z.l.bis(1529856);
  z.l.uhr.konstant_ab(T(18), 132.0);
  z.l.bis(2200000);
  PRUEFE_GLEICH(z.l.bei(z.kill, Status::gestartet), 1791818);   // §1.1 llround (Prototyp aufgerundet: 1 791 819)
  PRUEFE_NAH(z.l.wert_bei("deck/1/kill/tief", 1791817), 0, 0);
  PRUEFE_GLEICH(z.l.bei(z.fader, Status::fertig), 2140910);     // erstes Sample mit Beat >= 96
  PRUEFE_GLEICH(takt_von(z.l.uhr.beat(2140910)), 25);
}

// Prototyp-Test 8: Verriegelung A4. Im Vertrag prüft der Kern am Start (I3a über den Prüfer, Scheibe 20); hier trägt
// der Probe-Prüfer die Hörschein-Regel, um zu zeigen, dass die Naht es kann. zu_spaet prüft das Stellwerk selbst.
FALL(t08_verriegelung_a4_nichts_wird_ungehoert_hoerbar) {
  auto lauf = [](const char* fall) {
    ProbePruefer p;
    p.inhalt["deck/2"] = "ki-song-7";
    Schein h{"deck/2", 128, B(40), "ki-song-7"};
    if (!std::strcmp(fall, "126")) h.bpm = 126;
    if (!std::strcmp(fall, "material")) h.inhalt = "ki-song-6";
    if (!std::strcmp(fall, "abgelaufen")) h.gueltig_bis = B(16);
    if (std::strcmp(fall, "ohne")) p.scheine["H12"] = h;
    if (!std::strcmp(fall, "sub")) p.i1 = true;
    Szenario z(&p, false);
    const char* hs = std::strcmp(fall, "ohne") ? "H12" : "";
    int64_t id;
    if (!std::strcmp(fall, "zu_spaet")) {
      z.l.bis(T(9) + 11264);
      id = z.l.naechste_id++;
      z.l.sw->teil(TeilBefehl{id, Quelle::cypher, "pB", 0, "deck/2/fader", B(9), 32, A08, 0, 0, "", hs});
    } else if (!std::strcmp(fall, "leiser")) {
      id = z.l.teil("deck/1/fader", B(17), 32, -200, "pL", 0);
    } else if (!std::strcmp(fall, "sub")) {
      id = z.l.naechste_id++;
      z.l.sw->teil(TeilBefehl{id, Quelle::cypher, "pS", 0, "deck/2/fader", B(17), 0, A08, 0, 0, "", hs});
      z.l.sw->teil(TeilBefehl{id + 1000, Quelle::cypher, "pS", 1, "deck/2/kill/tief", B(17), 0, 0, 0, 0, "", ""});
    } else if (!std::strcmp(fall, "tausch")) {
      id = z.l.naechste_id++;
      z.l.sw->teil(TeilBefehl{id, Quelle::cypher, "pT", 0, "deck/2/fader", B(17), 16, A08, 0, 0, "", hs});
      z.l.sw->teil(TeilBefehl{id + 1000, Quelle::cypher, "pT", 1, "deck/1/kill/tief", B(21), 0, 1, 0, 0, "basstausch", ""});
      z.l.sw->teil(TeilBefehl{id + 2000, Quelle::cypher, "pT", 2, "deck/2/kill/tief", B(21), 0, 0, 0, 0, "basstausch", ""});
      p.i1 = true;
    } else {
      id = z.l.naechste_id++;
      z.l.sw->teil(TeilBefehl{id, Quelle::cypher, "pB", 0, "deck/2/fader", B(17), 32, A08, 0, 0, "", hs});
    }
    if (!std::strcmp(fall, "zweit")) {
      z.l.bis(T(12) - 64);
      z.l.uhr.konstant_ab(T(12), 132.0);
    }
    z.l.bis(T(26));
    z.l.nachlese_ereignisse();
    struct { Grund g; bool gestartet; float b_t25; bool verworfen; } e{};
    e.gestartet = z.l.bei(id, Status::gestartet) >= 0;
    e.g = e.gestartet ? Grund::kein : z.l.grund(id, Status::abgelehnt);
    if (!std::strcmp(fall, "sub")) e.g = z.l.grund(id, Status::abgebrochen);
    e.verworfen = z.l.bei(id, Status::verspaetet_verworfen) >= 0;
    e.b_t25 = z.l.sw->wert(z.l.r("deck/2/fader"));
    return e;
  };
  auto o = lauf("ohne");
  PRUEFE(o.g == Grund::kein_hoerschein && o.b_t25 == -200.0f);
  auto m = lauf("mit");
  PRUEFE(m.gestartet);
  PRUEFE_NAH(m.b_t25, A08, 1e-4);
  PRUEFE(lauf("126").g == Grund::hoerschein_anderes_tempo);
  PRUEFE(lauf("material").g == Grund::hoerschein_anderer_inhalt);   // Prototyp: hoerschein_anderes_material
  PRUEFE(lauf("abgelaufen").g == Grund::hoerschein_abgelaufen);
  PRUEFE(lauf("zu_spaet").verworfen);                                // Prototyp: verriegelt zu_spaet
  auto zw = lauf("zweit");
  PRUEFE(zw.g == Grund::hoerschein_anderes_tempo && zw.b_t25 == -200.0f);   // am Start verriegelt
  PRUEFE(lauf("leiser").gestartet);                                  // Negativ-Kontrolle: nur leiser, ohne Hörschein
  auto s = lauf("sub");
  PRUEFE(s.g == Grund::invariante_sub_doppelt);   // Vertrag: I1 zur Laufzeit statt beim Einreichen
  PRUEFE(s.b_t25 <= -26.0f);                       // B bleibt unhörbar (Prototyp: Gain B 0)
  auto t = lauf("tausch");
  PRUEFE(t.gestartet);
  PRUEFE_NAH(t.b_t25, A08, 1e-4);                                    // Basstausch sauber
}

// Prototyp-Test 9
FALL(t09_kopplung_hand_an_bass_a_nimmt_bass_b_mit_hand_an_fader_a_nicht) {
  for (const bool an_bass : {true, false}) {
    Szenario z(nullptr, false);
    const int64_t b_ein = z.l.teil("deck/2/fader", B(17), 16, A08, "pT", 0);
    const int64_t a_aus = z.l.teil("deck/1/fader", B(17), 32, -200, "pT", 1);
    const int64_t a_kill = z.l.teil("deck/1/kill/tief", B(21), 0, 1, "pT", 2, "basstausch");
    const int64_t b_kill = z.l.teil("deck/2/kill/tief", B(21), 0, 0, "pT", 3, "basstausch");
    if (an_bass) {
      z.l.griff(1000, "deck/1/kill/tief", 0.0f);
      z.l.griff(T(20), "deck/1/kill/tief", 4.0f / 128);   // Andreas hält den Bass von A
    } else {
      z.l.griff(T(20), "deck/1/fader", 0, GriffArt::beruehrung);
    }
    z.l.bis(T(23));
    if (an_bass) {
      PRUEFE_NAH(z.l.wert_bei("deck/2/kill/tief", T(22)), 1, 0);   // B-Bass bleibt aus: kein Sub doppelt
      PRUEFE_GLEICH(z.l.bei(a_kill, Status::abgebrochen), T(20));
      PRUEFE_GLEICH(z.l.bei(b_kill, Status::abgebrochen), T(20));
      PRUEFE_GLEICH(z.l.bei(a_aus, Status::abgebrochen), -1);
    } else {
      PRUEFE_NAH(z.l.wert_bei("deck/2/kill/tief", T(22)), 0, 0);   // Basstausch lief
      PRUEFE_NAH(z.l.wert_bei("deck/1/kill/tief", T(22)), 1, 0);
      PRUEFE_GLEICH(z.l.bei(a_aus, Status::abgebrochen), T(20));
    }
    PRUEFE_GLEICH(z.l.bei(b_ein, Status::fertig), T(21));
  }
}

// Prototyp-Test 10
FALL(t10_gleichzeitig_hand_und_planschritt_am_selben_sample_die_hand_gewinnt) {
  Szenario z;
  z.l.griff(1000, "deck/1/kill/tief", 0.0f);
  z.l.griff(T(21), "deck/1/kill/tief", 4.0f / 128);
  z.l.bis(T(28));
  PRUEFE_GLEICH(z.l.bei(z.kill, Status::abgebrochen), T(21));
  PRUEFE_NAH(z.l.wert_bei("deck/1/kill/tief", T(21) + 240), 0, 0);   // Hand, nicht Plan (1)
  PRUEFE_NAH(z.l.wert_bei("deck/1/fader", T(25)), -200, 0);           // Fader-Rampe unberührt
  PRUEFE_GLEICH(z.l.bei(z.fader, Status::fertig), T(25));
}

// Prototyp-Test 11: die übrigen Gründe einzeln. hoerschein_nicht_sync prüft laut §16.2 nur der Leitstand;
// hoerschein_anderes_deck heißt im Vertrag hoerschein_anderer_kanal; regler_verplant heißt im Kern ueberlappung.
FALL(t11_verriegelung_die_uebrigen_gruende_treffen_einzeln) {
  {
    ProbePruefer p;
    p.scheine["H12"] = Schein{"deck/1", 128, B(40)};
    Szenario z(&p, false);
    const int64_t id = z.l.naechste_id++;
    z.l.sw->teil(TeilBefehl{id, Quelle::cypher, "pB", 0, "deck/2/fader", B(17), 32, A08, 0, 0, "", "H12"});
    z.l.bis(T(18));
    PRUEFE(z.l.grund(id, Status::abgelehnt) == Grund::hoerschein_anderer_kanal);
  }
  {
    Szenario z(nullptr, false);
    PRUEFE(z.l.grund(z.l.teil("deck/9/fader", B(17), 0, -6), Status::abgelehnt) == Grund::unbekannter_regler);
  }
  {
    Szenario z;
    const int64_t id = z.l.teil("deck/1/fader", B(20), 16, -6, "p2", 0);
    PRUEFE(z.l.grund(id, Status::abgelehnt) == Grund::ueberlappung);
  }
  {
    Szenario z(nullptr, false);
    z.l.griff(T(9) + 5000, "deck/1/fader", 0.81f);
    z.l.bis(T(10));
    const int64_t id = z.l.teil("deck/1/fader", B(17), 32, -200, "p1", 0);
    z.l.bis(T(18));
    PRUEFE(z.l.bei(id, Status::angenommen) >= 0);
    PRUEFE(z.l.grund(id, Status::abgelehnt) == Grund::regler_beim_menschen);   // Prototyp: beim Einreichen, Vertrag: am Start
  }
  {
    Szenario z(nullptr, false);   // Negativ-Kontrolle: derselbe Plan ohne Hand startet
    z.l.bis(T(10));
    const int64_t id = z.l.teil("deck/1/fader", B(17), 32, -200, "p1", 0);
    z.l.bis(T(18));
    PRUEFE_GLEICH(z.l.bei(id, Status::gestartet), T(17));
  }
}

// Prototyp-Test 12: Rampe startet am Ist-Wert (kein Sprung). /k/teil hat im Vertrag kein Feld `von`; geprüft wird,
// dass der Ist-Wert beim Start zählt, nicht der Wert bei der Annahme (dazwischen setzt ein anderer Plan -6 dB).
FALL(t12_rampe_startet_am_ist_wert_nicht_am_wert_bei_annahme) {
  Szenario z(nullptr, false);
  const int64_t id = z.l.teil("deck/1/fader", B(17), 32, -200, "pv", 0);   // angenommen bei -1,94 dB
  z.l.teil("deck/1/fader", B(12), 0, -6, "q", 0, "", Quelle::leitstand);
  z.l.bis(T(18));
  PRUEFE_GLEICH(z.l.bei(id, Status::gestartet), T(17));
  PRUEFE_NAH(z.l.wert_bei("deck/1/fader", T(17)), -6, 1e-5);
  PRUEFE(z.l.max_schritt("deck/1/fader") < 0.001);   // größter Schritt: das Setzen auf -6 dB über 10 ms
  int64_t wo = 0;
  z.l.max_schritt("deck/1/fader", &wo);
  PRUEFE(wo < T(17));                              // kein Sprung am Start der Rampe
}

PRUEF_MAIN
