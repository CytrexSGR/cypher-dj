// Softcontroller (Scheibe 19): jede Taste sendet eine Nachricht, die im Mapping softcontroller.json auf genau ihr Ziel
// führt (geprüft über die Hand-Bibliothek, wie der Kern sie liest), und jeder Eintrag des Mappings ist über mindestens
// eine Taste erreichbar. Dazu die Bytes der Tasten (absolut, Stufen, beide relativen Kodierungen, Note-On/Off).
#include <cstring>
#include <memory>
#include <set>
#include <string>

#include "hand/mapping.h"
#include "hand/uebersetzer.h"
#include "pruef.h"
#include "tastatur.h"

using namespace hand;

namespace {
std::unique_ptr<Mapping> lade_soft() {
  auto m = std::make_unique<Mapping>();
  Fehler f;
  if (!lade_datei(SOFTCONTROLLER_MAPPING, stellwerk::ReglerTabelle(), m.get(), &f)) {
    std::printf("  %s\n", f.text);
    pruef::fehler()++;
  }
  return m;
}
}  // namespace

FALL(jede_taste_trifft_ihr_ziel) {
  auto m = lade_soft();
  Uebersetzer u(m.get());
  std::set<std::string> zeichen;
  for (const soft::Taste& t : soft::TASTEN) {
    PRUEFE(zeichen.insert(std::string(1, t.zeichen)).second);   // kein Zeichen doppelt belegt
    uint8_t stand = t.start;
    const soft::Bytes b = soft::bytes_fuer(t, &stand);
    Ausgabe a{};
    if (u.ereignis(b.d[0], 3, 0, 0, 256, &a) != 1) {
      std::printf("  verfehlt: Taste %c (%s) ohne Ausgabe\n", t.zeichen, t.ziel);
      pruef::fehler()++;
      continue;
    }
    if (std::strcmp(m->eintrag[a.eintrag].ziel, t.ziel) != 0) {
      std::printf("  verfehlt: Taste %c soll %s, trifft %s\n", t.zeichen, t.ziel, m->eintrag[a.eintrag].ziel);
      pruef::fehler()++;
    }
  }
}

FALL(jeder_eintrag_hat_eine_taste) {
  auto m = lade_soft();
  for (int i = 0; i < m->n_eintraege; i++) {
    const Nachricht& n = m->eintrag[i].nachricht;
    bool da = false;
    for (const soft::Taste& t : soft::TASTEN)
      da = da || (t.note == (n.typ == NachrichtTyp::note) && t.kanal == n.kanal && t.nr == n.nr);
    if (!da) {
      std::printf("  verfehlt: Eintrag Zeile %d (%s) ohne Taste\n", m->eintrag[i].zeile, m->eintrag[i].ziel);
      pruef::fehler()++;
    }
  }
  PRUEFE_GLEICH(m->n_eintraege, 44);
  PRUEFE_GLEICH(m->n_leds, 23);
}

FALL(bytes_der_tasten) {
  uint8_t stand = 0;
  const soft::Taste* q = soft::finde('q');
  soft::Bytes b = soft::bytes_fuer(*q, &stand);
  PRUEFE_GLEICH(b.n, 1);
  PRUEFE(b.d[0][0] == 0xB0 && b.d[0][1] == 7 && b.d[0][2] == 8);
  for (int i = 0; i < 20; i++) b = soft::bytes_fuer(*q, &stand);
  PRUEFE_GLEICH(b.d[0][2], 127);   // Anschlag
  PRUEFE_GLEICH(soft::bytes_fuer(*soft::finde('w'), &stand).d[0][2], 1);     // zweierkomplement +1
  PRUEFE_GLEICH(soft::bytes_fuer(*soft::finde('s'), &stand).d[0][2], 127);   // zweierkomplement -1
  PRUEFE_GLEICH(soft::bytes_fuer(*soft::finde('i'), &stand).d[0][2], 65);    // versatz64 +1
  PRUEFE_GLEICH(soft::bytes_fuer(*soft::finde('k'), &stand).d[0][2], 63);    // versatz64 -1
  uint8_t stufe = 42;
  PRUEFE_GLEICH(soft::bytes_fuer(*soft::finde(']'), &stufe).d[0][2], 85);
  PRUEFE_GLEICH(soft::bytes_fuer(*soft::finde(']'), &stufe).d[0][2], 127);
  PRUEFE_GLEICH(soft::bytes_fuer(*soft::finde(']'), &stufe).d[0][2], 127);
  PRUEFE_GLEICH(soft::bytes_fuer(*soft::finde('['), &stufe).d[0][2], 85);
  const soft::Bytes s = soft::bytes_fuer(*soft::finde('S'), &stand);
  PRUEFE_GLEICH(s.n, 2);
  PRUEFE(s.d[0][0] == 0x9F && s.d[0][1] == 0 && s.d[0][2] == 127);
  PRUEFE(s.d[1][0] == 0x8F && s.d[1][1] == 0 && s.d[1][2] == 0);
}

FALL(negativ_kontrolle_fremde_zeichen_senden_nichts) {
  for (char c : {'\n', '\r', ' ', 'y', 'Y', '#', '5', '6'}) PRUEFE(soft::finde(c) == nullptr);
}

PRUEF_MAIN
