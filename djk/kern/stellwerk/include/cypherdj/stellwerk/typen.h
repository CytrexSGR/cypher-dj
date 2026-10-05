// Stellwerk-RT (Scheibe 11): Grundtypen, Konstanten und Ausgaben.
// Vertrag: SCHNITTSTELLEN.md Vertragsversion 1, §1.2, §1.4, §4.3, §5.1, §5.7 bis §5.9, §7.3, §16.2.
#pragma once
#include <cstdint>

namespace cypherdj::stellwerk {

constexpr int SR = 48000;                  // §1.1
constexpr int BLOCK_MAX = 1024;            // größtes Quantum, für das Puffer angelegt sind (V1: 256)
constexpr int MAX_TEILE = 256;             // offene Teile (angenommen oder gestartet) zugleich
constexpr int MAX_BEWEGT = 128;            // Regler mit Verlauf je Zyklus
constexpr int MAX_HAND = 256;              // wartende Griffe
constexpr int MAX_EREIGNISSE = 2048;       // Ausgaben zwischen zwei Abholungen
constexpr int TEXT = 48;                   // OSC-Zeichenketten: höchstens 47 Bytes plus Null (§1.4)
constexpr float STUMM = -200.0f;           // §1.2
constexpr float STUMM_GRENZE = -120.0f;    // §1.2: jeder Wert <= -120 gilt als stumm
constexpr float STUMM_RAMPE = -60.0f;      // §1.2: Rampen von/nach stumm interpolieren bis -60 dB
constexpr double TOTZONE = 3.0 / 128.0;    // §7.3 Punkt 3
constexpr double RUECKGABE_BEATS = 32.0;   // §7.3 Punkte 4 und 5
constexpr double KI_STOPP_BEATS = 4.0;     // §4.7
constexpr int REGLER_MELDUNG_ABSTAND = SR / 50;  // §5.7: höchstens 50 Hz je Regler
constexpr int HAND_MELDUNG_ABSTAND = SR / 20;    // §5.8: höchstens 20 Hz

enum class Quelle : uint8_t { andreas, cypher, leitstand, erzeuger, werkstatt, pruefstand };

// §5.1, Zahlenwerte wie im Vertrag
enum class Status : uint8_t {
  angenommen = 1, gestartet = 2, fertig = 3, verspaetet_verworfen = 4,
  verspaetet_ausgefuehrt = 5, abgelehnt = 6, abgebrochen = 7, storniert = 8
};

// §16.2, nur die Codes, die der Kern vergibt
enum class Grund : uint8_t {
  kein, zu_spaet, regler_beim_menschen, ueberlappung, nur_hand, unbekannter_regler, ausserhalb_bereich,
  kein_hoerschein, hoerschein_anderer_kanal, hoerschein_anderer_inhalt, hoerschein_anderes_tempo,
  hoerschein_abgelaufen, hoerschein_anderer_abschnitt, ziel_ungehoert, keine_stems,
  invariante_sub_doppelt, invariante_master_leer, ki_gestoppt, hand, abbruch, ki_stopp, deck_beruehrt
};

enum class HalterArt : uint8_t { frei, mensch, plan, quelle };
enum class InvArt : uint8_t { sub_doppelt, master_leer, hoerschein };   // §5.9 /e/invariante

const char* name(Quelle q);
const char* name(Status s);
const char* name(Grund g);
const char* name(InvArt a);
bool quelle_aus_text(const char* text, Quelle* aus);

// §5.7: frei | mensch | plan:<id> | <quelle>
struct Halter {
  HalterArt art = HalterArt::frei;
  Quelle quelle = Quelle::andreas;
  char plan[TEXT] = {};
};
int halter_text(const Halter& h, char* aus, int max);   // Rückgabe: Länge ohne Null

enum class EreignisArt : uint8_t { quittung, regler, hand, halter, ki, invariante };

// Eine Ausgabe des Stellwerks. Der Kern (Scheibe 25) macht daraus OSC nach §5; `beat` rechnet er selbst aus `sample`.
struct Ereignis {
  EreignisArt art;
  int64_t sample;
  int64_t id;          // quittung
  Quelle quelle;       // quittung
  Status status;       // quittung
  Grund grund;         // quittung; ki: kein oder ki_stopp
  int16_t regler;      // regler, hand, halter (Index in der Regler-Tabelle, auch deck/<n>/transport)
  float wert;          // regler, hand
  char halter[TEXT];   // regler, halter
  bool gestoppt;       // ki
  InvArt inv;          // invariante
  char plan[TEXT];     // invariante
  int32_t teil;        // invariante
};

}  // namespace cypherdj::stellwerk
