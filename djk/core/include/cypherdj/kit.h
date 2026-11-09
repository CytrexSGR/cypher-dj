// Plan 2026-09-27 (ADR 024): Kit für den Erzeuger im Kern. Klänge als Stereo float32 verschränkt, 48 kHz, je Note
// (0..127) höchstens einer. Geladen und geprüft im Nicht-Echtzeit-Faden (Netz); der Callback liest nur.
#pragma once

#include <cstdint>
#include <memory>
#include <string>
#include <vector>

namespace cdj {

constexpr int KIT_NOTEN = 128;               // Noten je kit.json (0..127)
constexpr int KIT_KLAENGE = 2 * KIT_NOTEN;   // F08 (Glanz 2.4.2): kit:<a>+<b> legt b auf KIT_NOTEN + note
constexpr int64_t KIT_MAX_FRAMES = 480000;         // 10 s bei 48 kHz je Klang
constexpr int64_t KIT_MAX_BYTES = 256LL << 20;     // je Kit

struct KitKlang {
  std::string name;          // Strudel-Name "<s>:<n>", z. B. "bd:0"
  int64_t frames = 0;        // 0: Note ohne Klang
  std::vector<float> daten;  // 2 · frames Werte, L R verschränkt
  bool duck = false;         // K2: Strudel-Name bd oder bd:<n> startet den Sidechain-Duck
};

struct Kit {
  std::string name;
  std::string ordner;
  int n = 0;                 // Zahl der belegten Noten
  KitKlang klang[KIT_KLAENGE];
};

// Liest <ordner>/kit.json und die .f32 daneben. Fehler: nullptr, *fehler nennt Datei und Grund.
std::unique_ptr<Kit> lade_kit(const std::string& ordner, std::string* fehler);

// MVP 2 Scheibe 3 (E2, §4.8 kit:<a>+<b>): beide Kits in EINEM Kit, damit ein Muster s("bd rec0") beide spielt:
// a auf seinen Noten, b auf KIT_NOTEN + note (F08: battery 112 + rec 38 Klänge passen nicht in 128). Fehlt
// <ordner_b>/kit.json ganz, gilt nur a. Kaputtes b: nullptr, *fehler nennt den Grund.
std::unique_ptr<Kit> lade_kits(const std::string& ordner_a, const std::string& ordner_b, std::string* fehler);

}  // namespace cdj
