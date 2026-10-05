// Audit F05: der Kanten-Abgleich liefert die fehlenden Kanten, deren beide Ports existieren.
#include <set>
#include <string>

#include <utility>
#include <vector>

#include "cypherdj/kanten.h"
#include "pruef.h"

struct Welt {
  std::set<std::string> ports;
  std::set<std::pair<std::string, std::string>> kanten;
};
static bool ex(void* c, const char* p) { return ((Welt*)c)->ports.count(p) > 0; }
static bool vb(void* c, const char* a, const char* b) { return ((Welt*)c)->kanten.count({a, b}) > 0; }

int main() {
  const std::vector<cdj::Kante> soll = {{"A", "X"}, {"B", "Y"}};
  {  // Fehlerfall: nur A->X steht, B->Y fehlt und beide Ports sind da
    Welt w{{"A", "B", "X", "Y"}, {{"A", "X"}}};
    const auto f = cdj::fehlende_kanten(soll, {ex, vb, &w});
    PRUEF(f.size() == 1 && f[0] == cdj::Kante({"B", "Y"}));
  }
  {  // Senke Y weg: nichts zu verbinden
    Welt w{{"A", "B", "X"}, {{"A", "X"}}};
    PRUEF(cdj::fehlende_kanten(soll, {ex, vb, &w}).empty());
  }
  {  // Negativ-Kontrolle: Ist = Soll
    Welt w{{"A", "B", "X", "Y"}, {{"A", "X"}, {"B", "Y"}}};
    PRUEF(cdj::fehlende_kanten(soll, {ex, vb, &w}).empty());
  }
  {  // Senke neu gestartet: beide Kanten weg, beide Ports da -> beide fehlen, in Reihenfolge
    Welt w{{"A", "B", "X", "Y"}, {}};
    const auto f = cdj::fehlende_kanten(soll, {ex, vb, &w});
    PRUEF(f.size() == 2 && f[0] == cdj::Kante({"A", "X"}) && f[1] == cdj::Kante({"B", "Y"}));
  }
  {  // m2: Übergänge der Zielports, einmalig je Richtung
    Welt w{{"A", "B", "X", "Y"}, {}};
    cdj::ZielUebergaenge zu;
    const cdj::KantenIst ist{ex, vb, &w};
    PRUEF(zu.pruefe(soll, ist).empty());  // alles da: still
    w.ports.erase("Y");
    auto e = zu.pruefe(soll, ist);
    PRUEF(e.size() == 1 && e[0].ziel == "Y" && !e[0].wieder);
    PRUEF(zu.pruefe(soll, ist).empty());  // bleibt weg: kein zweites Mal
    PRUEF(zu.pruefe(soll, ist).empty());
    w.ports.insert("Y");
    e = zu.pruefe(soll, ist);
    PRUEF(e.size() == 1 && e[0].ziel == "Y" && e[0].wieder);
    PRUEF(zu.pruefe(soll, ist).empty());
  }
  {  // m1: gescheiterter Connect lässt keine Karenz in der Zukunft stehen
    int64_t ab = 1000;  // nach dem Start gesetzt, längst vorbei
    const int64_t jetzt = 5000, karenz = 500;
    cdj::KarenzMarke m = cdj::karenz_beginnen(&ab, jetzt + karenz);
    PRUEF(ab == jetzt + karenz);  // vor dem Connect: Karenz steht
    cdj::karenz_zuruecknehmen(&ab, m);  // Connect gescheitert
    PRUEF(ab == 1000 && ab <= jetzt);
    // Negativ-Kontrolle: eine inzwischen neuere Karenz (Graph-Callback) bleibt stehen
    m = cdj::karenz_beginnen(&ab, jetzt + karenz);
    PRUEF(cdj::karenz_verlaengern(&ab, jetzt + 900));
    cdj::karenz_zuruecknehmen(&ab, m);
    PRUEF(ab == jetzt + 900);
    // M1: verlängern nie verkürzen, und nicht vor dem ersten Setzen (0)
    PRUEF(!cdj::karenz_verlaengern(&ab, jetzt + 100));  // MINOR-3: nichts verlängert -> false
    PRUEF(ab == jetzt + 900);
    int64_t null = 0;
    PRUEF(!cdj::karenz_verlaengern(&null, jetzt + 900));
    PRUEF(null == 0);
  }
  {  // Slice 2: Parser der Kanten-Datei
    const auto k = cdj::lies_kanten("a:out\tb:in\nohne tab\n\nc:out 1\td:in 2\n");
    PRUEF(k.size() == 2 && k[0] == cdj::Kante({"a:out", "b:in"}) && k[1] == cdj::Kante({"c:out 1", "d:in 2"}));
    PRUEF(cdj::lies_kanten("").empty());
    PRUEF(cdj::lies_kanten("nur\t\n\tnur\n").empty());  // leere Hälfte
    const auto crlf = cdj::lies_kanten("a\tb\r\n");
    PRUEF(crlf.size() == 1 && crlf[0] == cdj::Kante({"a", "b"}));
  }
  {  // Slice 2, B9: Filter
    const std::string kern = "cypherdj-kern-h:";
    const std::vector<cdj::Kante> alle = {
        {kern + "master_L", "alsa_output.gerät:playback_FL"},  // Audio-Ausgang des Kerns: nie über die Datei
        {"fremd:out", "fremd:in"},                              // ohne Kern-Port
        {kern + "midi_aus_1", "cypherdj-wirt-bass-h:events-in"},
        {"cypherdj-wirt-bass-h:audio-out1", kern + "rueck_erz_2_L"},
        {kern + "midi_aus_x", "w:in"},                          // keine Nummer
        {kern + "midi_aus_1x", "w:in"},
        {"w:out", kern + "rueck_erz_2_X"},                      // falsche Seite
        {"w:out", kern + "rueck_erz_2"},
        {"cypherdj-kern-h2:midi_aus_1", "w:in"},                // anderer Client
        {"w:out", kern + "hand_in"},
        {kern + "cue_L", "dev:playback_RL"}};
    const auto f = cdj::filtere_kanten(alle, kern);
    PRUEF(f.size() == 2);
    PRUEF(f.size() == 2 && f[0] == alle[2] && f[1] == alle[3]);
    // Riegel-Loch: der Kern wird nie über die Datei mit sich selbst verbunden (Gegenseite trägt das Kern-Präfix)
    PRUEF(cdj::filtere_kanten({{kern + "master_L", kern + "rueck_erz_2_L"}}, kern).empty());
    PRUEF(cdj::filtere_kanten({{kern + "cue_R", kern + "rueck_erz_3_R"}}, kern).empty());
    PRUEF(cdj::filtere_kanten({{kern + "midi_aus_1", kern + "hand_in"}}, kern).empty());
    PRUEF(cdj::filtere_kanten({{kern + "midi_aus_1", kern + "rueck_erz_2_L"}}, kern).empty());
  }
  {  // MINOR-5: Duplikate und Obergrenze
    std::vector<cdj::Kante> v;
    for (int i = 0; i < 100; ++i) v.push_back({"q" + std::to_string(i % 80), "z"});
    size_t weg = 0;
    const auto r = cdj::entdoppeln_begrenzen(v, 64, &weg);
    PRUEF(r.size() == 64 && weg == 100 - 64);  // 80 verschiedene, 20 Duplikate, davon 16 über der Grenze
    PRUEF(r.size() == 64 && r[0] == cdj::Kante({"q0", "z"}));
    size_t weg2 = 99;
    const auto k = cdj::entdoppeln_begrenzen({{"a", "b"}, {"a", "b"}, {"c", "d"}}, 64, &weg2);
    PRUEF(k.size() == 2 && weg2 == 1);
    PRUEF(cdj::entdoppeln_begrenzen({{"a", "b"}}, 64, nullptr).size() == 1);
  }
  {  // MINOR-2/6: Journal-Buchführung, fremd geheilte Kante
    Welt w{{"A", "B", "X", "Y"}, {}};
    const cdj::KantenIst ist{ex, vb, &w};
    cdj::VerlustBuch b;
    const cdj::Kante k{"A", "X"};
    PRUEF(b.verlust_melden(k));
    PRUEF(!b.verlust_melden(k));  // einmal je Verlust
    const int64_t s = 1000000000LL;
    PRUEF(b.scheitern_melden(k, 100 * s));
    PRUEF(!b.scheitern_melden(k, 105 * s));
    PRUEF(b.scheitern_melden(k, 110 * s));  // höchstens alle 10 s
    w.kanten.insert({"A", "X"});            // jemand anderes heilt die Kante
    b.geheilte_abgleichen({k}, ist);
    PRUEF(b.verlust_melden(k));             // der nächste Verlust meldet wieder
    PRUEF(b.scheitern_melden(k, 111 * s));  // und das Scheitern sofort wieder
    // Negativ-Kontrolle: Kante bleibt unverbunden -> nichts gelöscht
    w.kanten.clear();
    b.geheilte_abgleichen({k}, ist);
    PRUEF(!b.verlust_melden(k));
  }
  {  // Slice 3 (F06): All-Off je Kanal CC123 und CC120, Puffer zu klein -> nichts
    uint8_t out[40][3];
    for (auto& e : out) e[0] = e[1] = e[2] = 0xEE;
    PRUEF(cdj::alle_aus_ereignisse(out, 32) == 32);
    for (int ch = 0; ch < 16; ++ch) {
      PRUEF(out[2 * ch][0] == (0xB0 | ch) && out[2 * ch][1] == 123 && out[2 * ch][2] == 0);
      PRUEF(out[2 * ch + 1][0] == (0xB0 | ch) && out[2 * ch + 1][1] == 120 && out[2 * ch + 1][2] == 0);
    }
    PRUEF(out[32][0] == 0xEE);  // nichts hinter den 32
    uint8_t klein[31][3];
    for (auto& e : klein) e[0] = 0xEE;
    PRUEF(cdj::alle_aus_ereignisse(klein, 31) == 0 && klein[0][0] == 0xEE && klein[30][0] == 0xEE);
    PRUEF(cdj::alle_aus_ereignisse(out, 0) == 0);
  }
  {  // Slice 3 Review Q1/Q2: Plan der All-Offs (150 ms und 500 ms, früheste fällige, Fortsetzung, Neusetzen)
    const int64_t ms = 1000000LL, t0 = 10000 * ms;
    auto sende = [](cdj::AllAusPlan& p, int64_t jetzt, std::vector<int>* geschrieben) {
      return p.zyklus(jetzt, [&](int i) { if (geschrieben) geschrieben->push_back(i); return true; });
    };
    {  // vor 150 ms nichts, 150 ms und 500 ms je ein Senden mit allen 32, danach nichts mehr
      cdj::AllAusPlan p;
      std::vector<int> w;
      PRUEF(sende(p, t0, &w) == cdj::AllAusPlan::NICHTS);  // nie gesetzt
      p.setze(t0);
      PRUEF(sende(p, t0 + 149 * ms, &w) == cdj::AllAusPlan::NICHTS && w.empty());
      PRUEF(sende(p, t0 + 150 * ms, &w) == cdj::AllAusPlan::GESENDET && w.size() == 32);
      PRUEF(sende(p, t0 + 151 * ms, nullptr) == cdj::AllAusPlan::NICHTS);
      PRUEF(sende(p, t0 + 499 * ms, nullptr) == cdj::AllAusPlan::NICHTS);
      PRUEF(sende(p, t0 + 500 * ms, &w) == cdj::AllAusPlan::GESENDET && w.size() == 64);
      PRUEF(sende(p, t0 + 900 * ms, nullptr) == cdj::AllAusPlan::NICHTS);
    }
    {  // Q2: beide im selben Zyklus fällig (Callback stand): zwei Senden in zwei Zyklen, nicht eines
      cdj::AllAusPlan p;
      p.setze(t0);
      PRUEF(sende(p, t0 + 600 * ms, nullptr) == cdj::AllAusPlan::GESENDET);
      PRUEF(sende(p, t0 + 606 * ms, nullptr) == cdj::AllAusPlan::GESENDET);
      PRUEF(sende(p, t0 + 612 * ms, nullptr) == cdj::AllAusPlan::NICHTS);
    }
    {  // Fortsetzung: Puffer nimmt je Zyklus nur 10 auf; jedes der 32 Ereignisse genau einmal, in Reihenfolge
      cdj::AllAusPlan p;
      p.setze(t0);
      std::vector<int> w;
      int platz = 10;
      auto knapp = [&](int i) { if (platz == 0) return false; --platz; w.push_back(i); return true; };
      int voll = 0, gesendet = 0;
      for (int z = 0; z < 4; ++z) {
        platz = 10;
        const auto r = p.zyklus(t0 + 200 * ms, knapp);
        voll += r == cdj::AllAusPlan::PUFFER_VOLL;
        gesendet += r == cdj::AllAusPlan::GESENDET;
      }
      PRUEF(voll == 3 && gesendet == 1);
      bool ok = w.size() == 32;
      for (size_t i = 0; i < w.size(); ++i) ok = ok && w[i] == (int)i;
      PRUEF(ok);
      // der Slot bei 500 ms ist davon unberührt
      PRUEF(sende(p, t0 + 500 * ms, nullptr) == cdj::AllAusPlan::GESENDET);
    }
    {  // scheiternder Schreiber löscht nichts; erst ein funktionierender sendet
      cdj::AllAusPlan p;
      p.setze(t0);
      for (int z = 0; z < 5; ++z) PRUEF(p.zyklus(t0 + 200 * ms, [](int) { return false; }) == cdj::AllAusPlan::PUFFER_VOLL);
      PRUEF(sende(p, t0 + 205 * ms, nullptr) == cdj::AllAusPlan::GESENDET);
    }
    {  // Neusetzen mitten im Senden (Hauptfaden): der neue Zukunftswert wird nicht gelöscht, er wird später fällig
      cdj::AllAusPlan p;
      p.setze(t0);
      const auto r = p.zyklus(t0 + 200 * ms, [&](int i) { if (i == 31) p.setze(t0 + 200 * ms); return true; });
      PRUEF(r == cdj::AllAusPlan::GESENDET);
      PRUEF(sende(p, t0 + 349 * ms, nullptr) == cdj::AllAusPlan::NICHTS);
      PRUEF(sende(p, t0 + 350 * ms, nullptr) == cdj::AllAusPlan::GESENDET);
      PRUEF(sende(p, t0 + 700 * ms, nullptr) == cdj::AllAusPlan::GESENDET);
      PRUEF(sende(p, t0 + 701 * ms, nullptr) == cdj::AllAusPlan::NICHTS);
    }
  }
  PRUEF_ENDE();
}
