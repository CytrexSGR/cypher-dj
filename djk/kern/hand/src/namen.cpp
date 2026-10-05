// Hand-Weg: Namen aus dem Vertrag. Tasten (SCHNITTSTELLEN §5.8), Deck-Aktionen (§7.2), LED-Namen (§7.4), dazu die
// Namen der Fehlerarten und Arten für Meldungen. Nur Tabellen und Vergleiche, echtzeitfest.
#include <cstring>

#include "hand/led.h"
#include "hand/mapping.h"

namespace hand {

namespace {

const char* const TASTEN_NAMEN[TASTEN] = {
    "annehmen", "verwerfen", "cypher_vorschlag", "cypher_hoeren", "stopp", "freigabe", "urteil_gut", "urteil_daneben",
    "autonomie", "spielart", "laenge", "spielart_start", "basstausch", "kiste_laden", "kiste_wahl", "tempo_basis", "zuruf"};

struct AktionName {
  const char* name;
  DeckAktion aktion;
};
const AktionName AKTIONEN[] = {{"play", DeckAktion::play},           {"cue", DeckAktion::cue},
                               {"loop", DeckAktion::loop},           {"loop_laenge", DeckAktion::loop_laenge},
                               {"sprung_plus", DeckAktion::sprung_plus}, {"sprung_minus", DeckAktion::sprung_minus},
                               {"nudge", DeckAktion::nudge},         {"tap", DeckAktion::tap},
                               {"slip", DeckAktion::slip},           {"laden", DeckAktion::laden}};

const char* const LED_FEST[] = {"vorschlag", "plan_laeuft", "rueckfall", "notbahn", "ki_gestoppt",
                                "autonomie_0", "autonomie_1", "autonomie_2", "autonomie_3"};
const char* const LED_JE_DECK[] = {"halter_andreas", "halter_cypher", "hoerschein_ok", "hoerschein_rot", "frist", "loop", "roll"};

}  // namespace

bool taste_aus_text(const char* text, Taste* aus) {
  for (int i = 0; i < TASTEN; i++)
    if (std::strcmp(text, TASTEN_NAMEN[i]) == 0) {
      *aus = static_cast<Taste>(i);
      return true;
    }
  return false;
}

bool deck_aktion_aus_text(const char* text, DeckAktion* aus) {
  for (const AktionName& n : AKTIONEN)
    if (std::strcmp(text, n.name) == 0) {
      *aus = n.aktion;
      return true;
    }
  return false;
}

bool led_name_gueltig(const char* n) {
  for (const char* f : LED_FEST)
    if (std::strcmp(n, f) == 0) return true;
  if (std::strncmp(n, "deck", 4) != 0 || n[4] < '1' || n[4] > '4' || n[5] != '_') return false;
  for (const char* d : LED_JE_DECK)
    if (std::strcmp(n + 6, d) == 0) return true;
  return false;
}

const char* name(Taste t) { return TASTEN_NAMEN[static_cast<int>(t)]; }

const char* name(DeckAktion a) {
  switch (a) {
    case DeckAktion::hotcue: return "hotcue";
    case DeckAktion::hotcue_setzen: return "hotcue_setzen";
    case DeckAktion::roll: return "roll";
    default:
      for (const AktionName& n : AKTIONEN)
        if (n.aktion == a) return n.name;
  }
  return "?";
}

const char* name(Art a) {
  switch (a) {
    case Art::absolut: return "absolut";
    case Art::relativ: return "relativ";
    case Art::beruehrung: return "beruehrung";
    case Art::taste: return "taste";
  }
  return "?";
}

const char* name(FehlerArt a) {
  switch (a) {
    case FehlerArt::datei: return "datei";
    case FehlerArt::json: return "json";
    case FehlerArt::version: return "version";
    case FehlerArt::feld_fehlt: return "feld_fehlt";
    case FehlerArt::feld_unbekannt: return "feld_unbekannt";
    case FehlerArt::feld_typ: return "feld_typ";
    case FehlerArt::unbekanntes_ziel: return "unbekanntes_ziel";
    case FehlerArt::falsche_kodierung: return "falsche_kodierung";
    case FehlerArt::falsche_art: return "falsche_art";
    case FehlerArt::nachricht: return "nachricht";
    case FehlerArt::kurve: return "kurve";
    case FehlerArt::quant: return "quant";
    case FehlerArt::doppelt: return "doppelt";
    case FehlerArt::led_name: return "led_name";
    case FehlerArt::zu_viele: return "zu_viele";
  }
  return "?";
}

}  // namespace hand
