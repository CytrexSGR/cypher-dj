// Fassungen im Arbeitsbestand (SCHNITTSTELLEN.md §6.4, §13.1, §13.2): Pfade, fassung.json lesen, Raster der Fassung.
// Scheibe 31. lies_fassung() liest eine Datei und allokiert: nur im Lade-Faden oder vor dem Start. frame_von() und
// quell_beat_von() sind echtzeitfest.
#pragma once

#include <array>
#include <cstdint>
#include <string>

namespace cdj {

constexpr int STEM_ANZAHL = 4;
// §1.5, §13.1: Reihenfolge der Stems; in dieser Reihenfolge summiert das Deck (Festlegung F3 im Plan 31).
extern const char* const STEM_NAMEN[STEM_ANZAHL];  // drums, bass, vocals, other
constexpr double FRAMES_JE_MINUTE = 2880000.0;      // 60 s · 48 000 Hz

struct FassungInfo {
  int schema = 0;
  std::string material_id;
  double basis_bpm = 0.0;
  int fassung = 0;
  std::string datei;                 // Basis-Datei, "basis.f32"
  int64_t frames = 0;
  std::string sha256;
  int64_t erster_schlag_frame = 0;
  double beats = 0.0;
  int erste_eins_quell_beat = 0;
  std::string analyse_quelle;        // "stems" oder "basis" (§13.1)
  struct Stem {
    std::string datei, sha256;
    int64_t frames = 0;
  };
  bool hat_stems = false;            // alle vier Stems stehen in fassung.json
  std::array<Stem, STEM_ANZAHL> stems;
  double lufs_integriert = 0.0;      // lautheit.lufs_integriert: daraus der Trim (§1.5)
};

// §13.1 <bpm·1000>: 128.0 -> "128000", 124.5 -> "124500"
std::string bpm_text(double basis_bpm);
// §6.4, §13.1: <arbeitsbestand>/<material_id>/fassungen/<bpm·1000>_r<fassung>
std::string fassung_ordner(const std::string& arbeitsbestand, const std::string& material_id, double basis_bpm,
                           int fassung);
// §1.4: 16 Hex-Zeichen, Kleinbuchstaben
bool material_id_gueltig(const char* id);

enum class FassungFehler { keiner, fehlt, form };
// Liest <ordner>/fassung.json (§13.2). fehlt: Datei nicht lesbar; form: kein JSON, schema ungleich 1, ein Feld, das der
// Kern braucht, fehlt oder hat den falschen Typ oder Bereich. meldung nennt das Feld.
FassungFehler lies_fassung(const std::string& ordner, FassungInfo& aus, std::string& meldung);

// §13.1 Raster der Fassung (starr): Frame des Quell-Beats q und umgekehrt. Frames je Beat = 60 · 48000 / basis_bpm.
inline double frame_von(double q, int64_t erster_schlag_frame, double basis_bpm) {
  return static_cast<double>(erster_schlag_frame) + q * FRAMES_JE_MINUTE / basis_bpm;
}
inline double quell_beat_von(double frame, int64_t erster_schlag_frame, double basis_bpm) {
  return (frame - static_cast<double>(erster_schlag_frame)) * basis_bpm / FRAMES_JE_MINUTE;
}

}  // namespace cdj
