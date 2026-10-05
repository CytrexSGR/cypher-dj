// Hand-Weg (Scheibe 19): Mapping-Datei nach SCHNITTSTELLEN §7.2, geprüft gegen die Regler-Tabelle des Stellwerks
// (§1.5, Scheibe 11), die Tasten-Namen (§5.8) und die LED-Namen (§7.4). Laden ist Nicht-Echtzeit (§4.7 /k/mapping);
// das fertige Mapping ist ein Block fester Größe ohne Zeiger ins Freie und wird im Callback nur gelesen.
//
// Öffentliche Kopfdatei = Naht zu Scheibe 35 (Kern-Hand) und 40 (Andreas' Gerät). Spätere Scheiben ändern sie nur
// additiv (ROADMAP §3).
#pragma once
#include <cstdint>

#include "cypherdj/stellwerk/regler.h"

// Befund (Scheibe 19 an Strang B, siehe Stand-Datei): der Plan (23.09.) und proben/plan-19/ sind gegen
// `namespace stellwerk {}` geschrieben; Scheibe 11 hat seither auf `namespace cypherdj::stellwerk {}` umgebaut
// (djk/kern/stellwerk/include/cypherdj/stellwerk/*.h). API sonst unverändert (nur Namensraum und Include-Pfad
// geprüft, 2026-09-26). Alias, damit der Plan-Code unverändert `stellwerk::…` schreiben kann.
namespace stellwerk = cypherdj::stellwerk;

namespace hand {

constexpr int MAX_EINTRAEGE = 512;
constexpr int MAX_LEDS = 128;
constexpr int TEXT = 48;            // Ziel, Gerät, LED-Name
constexpr int PORT_TEXT = 128;      // JACK-Portnamen der Midi-Bridge

enum class NachrichtTyp : uint8_t { cc = 0, note = 1 };
struct Nachricht {
  NachrichtTyp typ;
  uint8_t kanal;   // 1 bis 16
  uint8_t nr;      // 0 bis 127
};

// §7.2 art
enum class Art : uint8_t { absolut, relativ, beruehrung, taste };
// §7.2 kodierung (nur bei art relativ)
enum class Kodierung : uint8_t { keine, zweierkomplement, versatz64 };
// §7.2 ziel: Regler-Pfad, Deck-Aktion, tempo oder taste/<name>
enum class ZielArt : uint8_t { regler, deck, tempo, taste };
// §7.2 Deck-Aktionen; `pfl` ist zugleich Regler-Pfad deck/<n>/pfl (§1.5) und wird als Regler geführt
enum class DeckAktion : uint8_t {
  play, cue, hotcue, hotcue_setzen, loop, loop_laenge, roll, sprung_plus, sprung_minus, nudge, tap, slip, laden
};
// §7.2 quant (nur Deck-Tasten), Vorgabe sofort
enum class Quant : uint8_t { sofort, beat, takt };
// §5.8 Tasten-Namen, Reihenfolge wie im Vertrag
enum class Taste : uint8_t {
  annehmen, verwerfen, cypher_vorschlag, cypher_hoeren, stopp, freigabe, urteil_gut, urteil_daneben, autonomie,
  spielart, laenge, spielart_start, basstausch, kiste_laden, kiste_wahl, tempo_basis, zuruf
};
constexpr int TASTEN = 17;

struct Eintrag {
  Nachricht nachricht;
  int zeile;                 // Zeile des Eintrags in der Datei
  char ziel[TEXT];           // wörtlich aus der Datei
  ZielArt ziel_art;
  Art art;
  Kodierung kodierung;       // keine, außer bei art relativ
  int16_t regler;            // ZielArt::regler: Index in stellwerk::ReglerTabelle, sonst -1
  bool schalter;             // Regler mit Schalter-Kurve (kill/*, pfl, cue/split): Taste schaltet um
  bool eigene_kurve;         // kurve steht in der Datei; sonst gilt die Standard-Kurve des Reglers
  stellwerk::Kurve kurve;    // gültig, wenn eigene_kurve
  uint8_t deck;              // ZielArt::deck: 1 bis 4
  DeckAktion aktion;
  uint8_t hotcue;            // hotcue, hotcue_setzen: 1 bis 8
  float roll_beats;          // roll/<beats>: 1/32 bis 128
  Quant quant;
  Taste taste;
};

struct Led {
  char name[TEXT];           // §7.4
  Nachricht nachricht;
  uint8_t aus, an, blinkt;   // §7.2 werte, je 0 bis 127
  int zeile;
};

struct Mapping {
  int version;
  char geraet[TEXT];
  char quelle_port[PORT_TEXT];
  char ziel_port[PORT_TEXT];
  int n_eintraege;
  Eintrag eintrag[MAX_EINTRAEGE];
  int n_leds;
  Led led[MAX_LEDS];
  int16_t index[2][16][128];   // [typ][kanal - 1][nr] -> Eintrag oder -1
};

enum class FehlerArt : uint8_t {
  datei, json, version, feld_fehlt, feld_unbekannt, feld_typ, unbekanntes_ziel, falsche_kodierung, falsche_art,
  nachricht, kurve, quant, doppelt, led_name, zu_viele
};
struct Fehler {
  FehlerArt art;
  int zeile;                 // 0: keine Zeile (Datei nicht lesbar)
  char text[200];            // "Zeile 14: unbekanntes_ziel: \"deck/1/fadr\""
};

// Liest und prüft. false: `fehler` beschreibt den ersten Fehler, `aus` ist unbrauchbar. Allokiert (nicht im Callback).
bool lade(const char* text, const stellwerk::ReglerTabelle& tabelle, Mapping* aus, Fehler* fehler);
bool lade_datei(const char* pfad, const stellwerk::ReglerTabelle& tabelle, Mapping* aus, Fehler* fehler);

// Index des Eintrags für diese Nachricht oder -1. Echtzeitfest.
inline int suche(const Mapping& m, NachrichtTyp typ, int kanal, int nr) {
  if (kanal < 1 || kanal > 16 || nr < 0 || nr > 127) return -1;
  return m.index[static_cast<int>(typ)][kanal - 1][nr];
}

const char* name(FehlerArt a);
const char* name(Taste t);
const char* name(DeckAktion a);
const char* name(Art a);
bool taste_aus_text(const char* text, Taste* aus);
// Deck-Aktionen ohne Nummer (play, cue, loop, loop_laenge, sprung_plus, sprung_minus, nudge, tap, slip, laden)
bool deck_aktion_aus_text(const char* text, DeckAktion* aus);

}  // namespace hand
