// Softcontroller (Scheibe 19): Tastenbelegung. Jede Taste des Terminals sendet genau eine MIDI-Nachricht, die im
// Mapping djk/konfig/controller/softcontroller.json auf `ziel` steht; test_belegung prüft das über die Hand-Bibliothek.
// Nur Daten und reine Funktionen, kein ALSA: so kann der Test sie ohne Sequencer benutzen.
#pragma once
#include <cstdint>

namespace soft {

enum class Wirkung : uint8_t {
  absolut_plus,    // CC-Wert + 8 (höchstens 127)
  absolut_minus,   // CC-Wert - 8 (mindestens 0)
  stufe_plus,      // CC-Wert eine Stufe von 0/42/85/127 hoch (Autonomie 0 bis 3)
  stufe_minus,
  zweier_plus,     // relative Raste +1 in zweierkomplement (1)
  zweier_minus,    // -1 (127)
  versatz_plus,    // relative Raste +1 in versatz64 (65)
  versatz_minus,   // -1 (63)
  druecken         // Note-On 127, sofort danach Note-Off (ein Terminal kennt kein Loslassen)
};

struct Taste {
  char zeichen;
  const char* ziel;   // wie im Mapping
  bool note;          // false: CC
  uint8_t kanal;      // 1 bis 16
  uint8_t nr;
  Wirkung wirkung;
  uint8_t start;      // Anfangswert absoluter Regler (nur absolut_*, stufe_*)
};

constexpr Taste TASTEN[] = {
    // Deck 1 (Kanal 1)
    {'q', "deck/1/fader", false, 1, 7, Wirkung::absolut_plus, 0},
    {'a', "deck/1/fader", false, 1, 7, Wirkung::absolut_minus, 0},
    {'w', "deck/1/eq/tief", false, 1, 20, Wirkung::zweier_plus, 0},
    {'s', "deck/1/eq/tief", false, 1, 20, Wirkung::zweier_minus, 0},
    {'e', "deck/1/filter", false, 1, 21, Wirkung::absolut_plus, 64},
    {'d', "deck/1/filter", false, 1, 21, Wirkung::absolut_minus, 64},
    {'g', "deck/1/nudge", false, 1, 22, Wirkung::zweier_plus, 0},
    {'f', "deck/1/nudge", false, 1, 22, Wirkung::zweier_minus, 0},
    {'j', "deck/1/loop_laenge", false, 1, 23, Wirkung::zweier_plus, 0},
    {'h', "deck/1/loop_laenge", false, 1, 23, Wirkung::zweier_minus, 0},
    {'z', "deck/1/kill/tief", true, 1, 36, Wirkung::druecken, 0},
    {'x', "deck/1/pfl", true, 1, 37, Wirkung::druecken, 0},
    {'K', "deck/1/fader", true, 1, 38, Wirkung::druecken, 0},   // Berührungssensor des Faders
    {'1', "deck/1/hotcue/1", true, 1, 40, Wirkung::druecken, 0},
    {'2', "deck/1/hotcue/2", true, 1, 41, Wirkung::druecken, 0},
    {'3', "deck/1/hotcue/3", true, 1, 42, Wirkung::druecken, 0},
    {'4', "deck/1/hotcue/4", true, 1, 43, Wirkung::druecken, 0},
    {'c', "deck/1/play", true, 1, 44, Wirkung::druecken, 0},
    {'v', "deck/1/cue", true, 1, 45, Wirkung::druecken, 0},
    {'b', "deck/1/loop", true, 1, 46, Wirkung::druecken, 0},
    {'t', "deck/1/tap", true, 1, 47, Wirkung::druecken, 0},
    {'r', "deck/1/laden", true, 1, 48, Wirkung::druecken, 0},
    // Deck 2 (Kanal 2)
    {'o', "deck/2/fader", false, 2, 7, Wirkung::absolut_plus, 0},
    {'l', "deck/2/fader", false, 2, 7, Wirkung::absolut_minus, 0},
    {'i', "deck/2/eq/tief", false, 2, 20, Wirkung::versatz_plus, 0},
    {'k', "deck/2/eq/tief", false, 2, 20, Wirkung::versatz_minus, 0},
    {'m', "deck/2/kill/tief", true, 2, 36, Wirkung::druecken, 0},
    {'p', "deck/2/pfl", true, 2, 37, Wirkung::druecken, 0},
    {'7', "deck/2/hotcue/1", true, 2, 40, Wirkung::druecken, 0},
    {'8', "deck/2/hotcue/2", true, 2, 41, Wirkung::druecken, 0},
    {'9', "deck/2/hotcue/3", true, 2, 42, Wirkung::druecken, 0},
    {'0', "deck/2/hotcue/4", true, 2, 43, Wirkung::druecken, 0},
    {'n', "deck/2/play", true, 2, 44, Wirkung::druecken, 0},
    {'u', "deck/2/laden", true, 2, 48, Wirkung::druecken, 0},
    // Global (Kanal 16)
    {'.', "xfader", false, 16, 8, Wirkung::absolut_plus, 64},
    {',', "xfader", false, 16, 8, Wirkung::absolut_minus, 64},
    {'+', "tempo", false, 16, 9, Wirkung::zweier_plus, 0},
    {'-', "tempo", false, 16, 9, Wirkung::zweier_minus, 0},
    {']', "taste/autonomie", false, 16, 10, Wirkung::stufe_plus, 42},
    {'[', "taste/autonomie", false, 16, 10, Wirkung::stufe_minus, 42},
    {'}', "taste/spielart", false, 16, 11, Wirkung::zweier_plus, 0},
    {'{', "taste/spielart", false, 16, 11, Wirkung::zweier_minus, 0},
    {')', "taste/kiste_wahl", false, 16, 12, Wirkung::zweier_plus, 0},
    {'(', "taste/kiste_wahl", false, 16, 12, Wirkung::zweier_minus, 0},
    {'>', "taste/laenge", false, 16, 13, Wirkung::zweier_plus, 0},
    {'<', "taste/laenge", false, 16, 13, Wirkung::zweier_minus, 0},
    {'S', "taste/stopp", true, 16, 0, Wirkung::druecken, 0},
    {'A', "taste/annehmen", true, 16, 1, Wirkung::druecken, 0},
    {'V', "taste/verwerfen", true, 16, 2, Wirkung::druecken, 0},
    {'C', "taste/cypher_vorschlag", true, 16, 3, Wirkung::druecken, 0},
    {'H', "taste/cypher_hoeren", true, 16, 4, Wirkung::druecken, 0},
    {'F', "taste/freigabe", true, 16, 5, Wirkung::druecken, 0},
    {'G', "taste/urteil_gut", true, 16, 6, Wirkung::druecken, 0},
    {'D', "taste/urteil_daneben", true, 16, 7, Wirkung::druecken, 0},
    {'B', "taste/basstausch", true, 16, 8, Wirkung::druecken, 0},
    {'T', "taste/tempo_basis", true, 16, 9, Wirkung::druecken, 0},
    {'Z', "taste/zuruf", true, 16, 20, Wirkung::druecken, 0},
};
constexpr int ANZAHL = sizeof(TASTEN) / sizeof(TASTEN[0]);

inline const Taste* finde(char c) {
  for (const Taste& t : TASTEN)
    if (t.zeichen == c) return &t;
  return nullptr;
}

// Neuer CC-Wert eines absoluten Reglers nach dem Tastendruck
inline uint8_t absolut_neu(Wirkung w, uint8_t alt) {
  static const uint8_t STUFEN[4] = {0, 42, 85, 127};
  int stufe = 0;
  for (int i = 0; i < 4; i++)
    if (alt >= STUFEN[i]) stufe = i;
  switch (w) {
    case Wirkung::absolut_plus: return alt > 119 ? 127 : static_cast<uint8_t>(alt + 8);
    case Wirkung::absolut_minus: return alt < 8 ? 0 : static_cast<uint8_t>(alt - 8);
    case Wirkung::stufe_plus: return STUFEN[stufe < 3 ? stufe + 1 : 3];
    case Wirkung::stufe_minus: return STUFEN[stufe > 0 ? stufe - 1 : 0];
    default: return alt;
  }
}

// Datenbyte einer relativen Raste
inline uint8_t relativ_wert(Wirkung w) {
  switch (w) {
    case Wirkung::zweier_plus: return 1;
    case Wirkung::zweier_minus: return 127;
    case Wirkung::versatz_plus: return 65;
    case Wirkung::versatz_minus: return 63;
    default: return 0;
  }
}

// Die rohen Bytes, die eine Taste sendet: n = 1 (CC) oder 2 (Note-On, Note-Off). `stand` ist der CC-Wert des
// absoluten Reglers vor dem Druck und wird fortgeschrieben.
struct Bytes {
  uint8_t d[2][3];
  int n;
};
inline Bytes bytes_fuer(const Taste& t, uint8_t* stand) {
  Bytes b{};
  const uint8_t k = static_cast<uint8_t>(t.kanal - 1);
  if (t.note) {
    b.n = 2;
    b.d[0][0] = static_cast<uint8_t>(0x90 | k);
    b.d[0][1] = t.nr;
    b.d[0][2] = 127;
    b.d[1][0] = static_cast<uint8_t>(0x80 | k);
    b.d[1][1] = t.nr;
    b.d[1][2] = 0;
    return b;
  }
  b.n = 1;
  b.d[0][0] = static_cast<uint8_t>(0xB0 | k);
  b.d[0][1] = t.nr;
  const uint8_t r = relativ_wert(t.wirkung);
  if (r) {
    b.d[0][2] = r;
  } else {
    *stand = absolut_neu(t.wirkung, *stand);
    b.d[0][2] = *stand;
  }
  return b;
}

}  // namespace soft
