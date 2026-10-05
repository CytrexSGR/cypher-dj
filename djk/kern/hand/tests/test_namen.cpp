// Scheibe 19: Namen aus dem Vertrag: Tasten (§5.8), Deck-Aktionen (§7.2), LED-Namen (§7.4).
#include <cstdio>
#include <cstring>

#include "hand/led.h"
#include "hand/mapping.h"
#include "pruef.h"

using namespace hand;

FALL(tasten_aus_5_8_hin_und_zurueck) {
  const char* namen[] = {"annehmen", "verwerfen", "cypher_vorschlag", "cypher_hoeren", "stopp", "freigabe", "urteil_gut",
                         "urteil_daneben", "autonomie", "spielart", "laenge", "spielart_start", "basstausch",
                         "kiste_laden", "kiste_wahl", "tempo_basis", "zuruf"};
  PRUEFE_GLEICH(sizeof namen / sizeof namen[0], TASTEN);
  for (const char* n : namen) {
    Taste t;
    PRUEFE(taste_aus_text(n, &t));
    PRUEFE(std::strcmp(name(t), n) == 0);
  }
  Taste t;
  for (const char* n : {"", "stop", "Stopp", "annehmen ", "tempo"}) PRUEFE(!taste_aus_text(n, &t));
}

FALL(deck_aktionen_aus_7_2) {
  for (const char* n : {"play", "cue", "loop", "loop_laenge", "sprung_plus", "sprung_minus", "nudge", "tap", "slip", "laden"}) {
    DeckAktion a;
    PRUEFE(deck_aktion_aus_text(n, &a));
    PRUEFE(std::strcmp(name(a), n) == 0);
  }
  DeckAktion a;
  // mit Nummer oder Länge (hotcue/<nr>, roll/<beats>) und pfl (Regler-Pfad) löst der Mapping-Leser selbst auf
  for (const char* n : {"hotcue", "roll", "pfl", "Play", ""}) PRUEFE(!deck_aktion_aus_text(n, &a));
}

FALL(alle_namen_aus_7_4_gueltig) {
  const char* fest[] = {"vorschlag", "plan_laeuft", "rueckfall", "notbahn", "ki_gestoppt",
                        "autonomie_0", "autonomie_1", "autonomie_2", "autonomie_3"};
  for (const char* n : fest) PRUEFE(led_name_gueltig(n));
  const char* je[] = {"halter_andreas", "halter_cypher", "hoerschein_ok", "hoerschein_rot", "frist", "loop", "roll"};
  int n = 0;
  for (int d = 1; d <= 4; d++)
    for (const char* s : je) {
      char name[32];
      std::snprintf(name, sizeof name, "deck%d_%s", d, s);
      PRUEFE(led_name_gueltig(name));
      n++;
    }
  PRUEFE_GLEICH(n, 28);
}

FALL(fremde_namen_ungueltig) {
  for (const char* n : {"", "vorschlaege", "deck5_loop", "deck0_loop", "deck1_", "deck1_foo", "deck12_loop",
                        "autonomie_4", "Vorschlag", "deck1loop"})
    PRUEFE(!led_name_gueltig(n));
}

PRUEF_MAIN
