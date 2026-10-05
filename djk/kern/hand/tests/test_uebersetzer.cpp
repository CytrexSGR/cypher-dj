// Scheibe 19: MIDI-Dekodierung (§7.2, §7.3 Punkt 1). Sample am Versatz, CC und Note, beide relativen Kodierungen
// vorzeichenrichtig, Tasten mit Druck und Loslassen, Schalter, Berührung, Tempo, Deck-Aktionen, Zähler.
#include <cstdint>
#include <memory>

#include "hand/mapping.h"
#include "hand/uebersetzer.h"
#include "pruef.h"

using namespace hand;

namespace {

const char* const MAPPING = R"({"version":1,"geraet":"test","quelle_port":"q","ziel_port":"z",
 "eintraege":[
  {"nachricht":{"typ":"cc","kanal":1,"nr":7},"ziel":"deck/1/fader","art":"absolut"},
  {"nachricht":{"typ":"cc","kanal":1,"nr":20},"ziel":"deck/1/eq/tief","art":"relativ","kodierung":"zweierkomplement"},
  {"nachricht":{"typ":"cc","kanal":2,"nr":20},"ziel":"deck/2/eq/tief","art":"relativ","kodierung":"versatz64"},
  {"nachricht":{"typ":"note","kanal":1,"nr":36},"ziel":"deck/1/kill/tief","art":"taste"},
  {"nachricht":{"typ":"note","kanal":1,"nr":37},"ziel":"deck/1/fader","art":"beruehrung"},
  {"nachricht":{"typ":"note","kanal":1,"nr":44},"ziel":"deck/1/play","art":"taste"},
  {"nachricht":{"typ":"cc","kanal":1,"nr":22},"ziel":"deck/1/nudge","art":"relativ","kodierung":"zweierkomplement"},
  {"nachricht":{"typ":"cc","kanal":16,"nr":9},"ziel":"tempo","art":"relativ","kodierung":"versatz64"},
  {"nachricht":{"typ":"note","kanal":16,"nr":0},"ziel":"taste/stopp","art":"taste"},
  {"nachricht":{"typ":"cc","kanal":16,"nr":1},"ziel":"taste/annehmen","art":"taste"},
  {"nachricht":{"typ":"cc","kanal":16,"nr":10},"ziel":"taste/autonomie","art":"absolut"},
  {"nachricht":{"typ":"cc","kanal":16,"nr":11},"ziel":"taste/spielart","art":"relativ","kodierung":"zweierkomplement"}]})";

enum { FADER, EQ1, EQ2, KILL, BERUEHR, PLAY, NUDGE, TEMPO, STOPP, ANNEHMEN, AUTONOMIE, SPIELART };

struct Aufbau {
  std::unique_ptr<Mapping> m = std::make_unique<Mapping>();
  std::unique_ptr<Uebersetzer> u;
  Aufbau() {
    Fehler f;
    if (!lade(MAPPING, stellwerk::ReglerTabelle(), m.get(), &f)) {
      std::printf("  Mapping: %s\n", f.text);
      pruef::fehler()++;
    }
    u = std::make_unique<Uebersetzer>(m.get());
  }
  // 1 und Ausgabe, oder 0
  int ein(uint8_t s, uint8_t a, uint8_t b, Ausgabe* aus, int64_t s0 = 0, uint32_t versatz = 0, uint32_t n = 256) {
    const uint8_t d[3] = {s, a, b};
    return u->ereignis(d, 3, s0, versatz, n, aus);
  }
};

}  // namespace

FALL(sample_am_versatz_nicht_am_blockanfang) {
  Aufbau a;
  Ausgabe x{};
  PRUEFE_GLEICH(a.ein(0xB0, 7, 64, &x, 1619968, 32, 256), 1);
  PRUEFE_GLEICH(x.sample, 1620000);      // 1619968 + 32
  PRUEFE_GLEICH(a.ein(0xB0, 7, 65, &x, 1619968, 255, 256), 1);
  PRUEFE_GLEICH(x.sample, 1620223);      // letzter Frame des Blocks
  PRUEFE_GLEICH(a.ein(0xB0, 7, 66, &x, 1619968, 0, 256), 1);
  PRUEFE_GLEICH(x.sample, 1619968);      // erster Frame
  PRUEFE_GLEICH(a.ein(0xB0, 7, 67, &x, 1619968, 300, 256), 1);
  PRUEFE_GLEICH(x.sample, 1620223);      // Versatz jenseits des Blocks wird auf den letzten Frame begrenzt
}

FALL(cc_absolut_stellung_wert_durch_127) {
  Aufbau a;
  Ausgabe x{};
  PRUEFE_GLEICH(a.ein(0xB0, 7, 0, &x), 1);
  PRUEFE(x.art == AusgabeArt::regler_absolut && x.eintrag == FADER);
  PRUEFE_NAH(x.x, 0.0, 0);
  PRUEFE_GLEICH(a.ein(0xB0, 7, 127, &x), 1);
  PRUEFE_NAH(x.x, 1.0, 0);
  PRUEFE_GLEICH(a.ein(0xB0, 7, 64, &x), 1);
  PRUEFE_NAH(x.x, 64.0 / 127.0, 1e-7);
  PRUEFE_GLEICH(x.wert, 64);
}

FALL(zweierkomplement_vorzeichenrichtig) {
  const struct { uint8_t v; int r; } T[] = {{1, 1}, {2, 2}, {63, 63}, {64, -64}, {65, -63}, {126, -2}, {127, -1}, {0, 0}};
  for (const auto& t : T) PRUEFE_GLEICH(rasten(Kodierung::zweierkomplement, t.v), t.r);
  Aufbau a;
  Ausgabe x{};
  PRUEFE_GLEICH(a.ein(0xB0, 20, 1, &x), 1);
  PRUEFE(x.art == AusgabeArt::regler_relativ && x.eintrag == EQ1 && x.wert == 1);
  PRUEFE_NAH(x.x, 1.0 / 127.0, 1e-7);
  PRUEFE_GLEICH(a.ein(0xB0, 20, 127, &x), 1);
  PRUEFE_GLEICH(x.wert, -1);
  PRUEFE_NAH(x.x, -1.0 / 127.0, 1e-7);
  PRUEFE_GLEICH(a.ein(0xB0, 20, 0, &x), 0);   // keine Drehung, keine Ausgabe
}

FALL(versatz64_vorzeichenrichtig) {
  const struct { uint8_t v; int r; } T[] = {{65, 1}, {66, 2}, {127, 63}, {63, -1}, {62, -2}, {1, -63}, {0, -64}, {64, 0}};
  for (const auto& t : T) PRUEFE_GLEICH(rasten(Kodierung::versatz64, t.v), t.r);
  Aufbau a;
  Ausgabe x{};
  PRUEFE_GLEICH(a.ein(0xB1, 20, 65, &x), 1);
  PRUEFE(x.eintrag == EQ2 && x.wert == 1);
  PRUEFE_GLEICH(a.ein(0xB1, 20, 63, &x), 1);
  PRUEFE_GLEICH(x.wert, -1);
  PRUEFE_GLEICH(a.ein(0xB1, 20, 64, &x), 0);
}

FALL(fehlerfall_falsche_kodierung_dreht_die_richtung) {
  // Vergleich: dieselbe Raste "+1" im anderen Format gelesen ist fast der Endanschlag in Gegenrichtung
  PRUEFE_GLEICH(rasten(Kodierung::versatz64, 1), -63);         // zweierkomplement-Raste +1 als versatz64
  PRUEFE_GLEICH(rasten(Kodierung::zweierkomplement, 65), -63);  // versatz64-Raste +1 als zweierkomplement
}

FALL(taste_note_druck_und_loslassen) {
  Aufbau a;
  Ausgabe x{};
  PRUEFE_GLEICH(a.ein(0x9F, 0, 127, &x), 1);
  PRUEFE(x.art == AusgabeArt::taste && x.eintrag == STOPP && x.wert == 1);
  PRUEFE_GLEICH(a.ein(0x9F, 0, 0, &x), 1);    // Note-On mit Velocity 0 = Loslassen
  PRUEFE_GLEICH(x.wert, 0);
  PRUEFE_GLEICH(a.ein(0x8F, 0, 64, &x), 1);   // Note-Off
  PRUEFE_GLEICH(x.wert, 0);
  PRUEFE_GLEICH(a.ein(0xBF, 1, 127, &x), 1);  // CC-Taste: >= 64 gedrückt
  PRUEFE(x.eintrag == ANNEHMEN && x.wert == 1);
  PRUEFE_GLEICH(a.ein(0xBF, 1, 0, &x), 1);
  PRUEFE_GLEICH(x.wert, 0);
}

FALL(schalter_nur_beim_druck_beruehrung_nur_beim_beruehren) {
  Aufbau a;
  Ausgabe x{};
  PRUEFE_GLEICH(a.ein(0x90, 36, 100, &x), 1);
  PRUEFE(x.art == AusgabeArt::regler_umschalten && x.eintrag == KILL);
  PRUEFE_GLEICH(a.ein(0x80, 36, 0, &x), 0);
  PRUEFE_GLEICH(a.ein(0x90, 37, 1, &x), 1);
  PRUEFE(x.art == AusgabeArt::regler_beruehrung && x.eintrag == BERUEHR);
  PRUEFE_GLEICH(a.ein(0x90, 37, 0, &x), 0);
}

FALL(deck_tempo_und_tasten_mit_werten) {
  Aufbau a;
  Ausgabe x{};
  PRUEFE_GLEICH(a.ein(0x90, 44, 127, &x), 1);
  PRUEFE(x.art == AusgabeArt::deck && x.eintrag == PLAY && x.wert == 1);
  PRUEFE_GLEICH(a.ein(0x90, 44, 0, &x), 1);
  PRUEFE(x.art == AusgabeArt::deck && x.wert == 0);
  PRUEFE_GLEICH(a.ein(0xB0, 22, 126, &x), 1);
  PRUEFE(x.art == AusgabeArt::deck && x.eintrag == NUDGE && x.wert == -2);
  PRUEFE_GLEICH(a.ein(0xBF, 9, 67, &x), 1);
  PRUEFE(x.art == AusgabeArt::tempo && x.wert == 3);
  const struct { uint8_t v; int stufe; } S[] = {{0, 0}, {42, 1}, {85, 2}, {127, 3}, {21, 0}, {22, 1}};
  for (const auto& s : S) {
    PRUEFE_GLEICH(a.ein(0xBF, 10, s.v, &x), 1);
    PRUEFE(x.art == AusgabeArt::taste && x.eintrag == AUTONOMIE);
    PRUEFE_GLEICH(x.wert, s.stufe);
  }
  PRUEFE_GLEICH(a.ein(0xBF, 11, 127, &x), 1);
  PRUEFE(x.art == AusgabeArt::taste && x.eintrag == SPIELART && x.wert == -1);
}

FALL(fremdes_und_kurzes_wird_gezaehlt_nicht_uebersetzt) {
  Aufbau a;
  Ausgabe x{};
  PRUEFE_GLEICH(a.ein(0xB5, 7, 64, &x), 0);    // Kanal 6: kein Eintrag
  PRUEFE_GLEICH(a.ein(0x90, 7, 64, &x), 0);    // Note 7 statt CC 7
  PRUEFE_GLEICH(a.ein(0xE0, 0, 64, &x), 0);    // Pitch-Bend
  PRUEFE_GLEICH(a.ein(0xA0, 36, 64, &x), 0);   // Aftertouch
  const uint8_t uhr[1] = {0xF8};
  PRUEFE_GLEICH(a.u->ereignis(uhr, 1, 0, 0, 256, &x), 0);   // MIDI-Clock, ein Byte
  const UebersetzerZaehler& z = a.u->zaehler();
  PRUEFE_GLEICH(z.ereignisse, 5);
  PRUEFE_GLEICH(z.unbekannt, 2);
  PRUEFE_GLEICH(z.ignoriert, 3);
  PRUEFE_GLEICH(z.ausgaben, 0);
}

FALL(negativ_kontrolle_ohne_ereignis_keine_ausgabe) {
  Aufbau a;
  const UebersetzerZaehler& z = a.u->zaehler();
  PRUEFE_GLEICH(z.ereignisse, 0);
  PRUEFE_GLEICH(z.ausgaben, 0);
  Uebersetzer ohne(nullptr);   // noch kein Mapping geladen
  Ausgabe x{};
  const uint8_t d[3] = {0xB0, 7, 64};
  PRUEFE_GLEICH(ohne.ereignis(d, 3, 0, 0, 256, &x), 0);
}

PRUEF_MAIN
