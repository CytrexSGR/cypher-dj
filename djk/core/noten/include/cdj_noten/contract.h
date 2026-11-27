// cdj_noten: types and constants of the note editor contract (djk/contract/notes.md, contract version 1), and the readers and
// writers of the JSON files the contract describes. notes_contract.ts is the server side of the same rules; the examples in
// djk/contract/cases/noten/ (with gruende.json) keep both equal.
#pragma once
#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <variant>
#include <vector>

namespace cdj::noten {

inline constexpr int SR = 48000;
inline constexpr int HOP = 256;
inline constexpr int VERTRAG = 1;
// One place each (an algorithm change that changes its output bumps its number; a change of the monophonic check bumps the segmenter)
inline constexpr std::string_view DETEKTOR_VERSION = "pyin-1";
inline constexpr std::string_view NETZ_VERSION = "netz-1";
inline constexpr std::string_view SEGMENTIERER_VERSION = "noten_hmm-1";
inline constexpr std::string_view MASCHINE_VERSION = "teilton-2";
inline constexpr double TON_SPANNE = 24.0;          // semitones around qton
inline constexpr double TON_TOLERANZ = 1e-4;        // targets are rounded to 1e-4, so a span of exactly 24 stays inside
inline constexpr int MAX_NOTEN = 4096;              // notes of a list or a sidecar
inline constexpr double MONO_ANTEIL_MAX = 0.30;     // a source is polyphonic when more than this share of the checked frames is
inline constexpr int64_t KURZ_QUELLE_FRAMES = 9600; // sources shorter than this (200 ms) get no notes from the commands

/// Number of analysis frames of a source of `frames` stereo frames: frame i is centred at sample i * HOP.
constexpr int64_t frameZahl(int64_t frames) { return frames / HOP + 1; }
/// A target pitch is allowed: inside 0..127 and at most 24 semitones (plus 1e-4 for the rounding of targets) from the detected pitch.
inline bool tonImSpann(double ton, double qton) {
  return ton >= 0.0 && ton <= 127.0 && (ton > qton ? ton - qton : qton - ton) <= TON_SPANNE + TON_TOLERANZ;
}

/// An error of the command line: `code` is one of the codes of the contract (plus "abbruch" for SIGTERM, never printed), `text` English.
struct Fehler {
  std::string code;
  std::string text;
  bool operator==(const Fehler&) const = default;
};

/// Pitch curve of one source: one value per frame. f0_ct is MIDI times 100 (A4 = 6900.0), 0 = unvoiced; konf is 0..1.
struct Kurve {
  int sr = SR;
  int hop = HOP;
  int64_t frames = 0;        // stereo frames of the source
  std::string detektor;      // "pyin" or "netz"
  std::string kurve;         // curve id <detector version>.<segmenter version>
  std::vector<double> f0_ct;
  std::vector<double> konf;
  bool operator==(const Kurve&) const = default;
};

/// A detected note of a sidecar (no id, no targets): seconds, float MIDI, level 0..1.
struct NoteQ {
  double qa = 0, qe = 0, qton = 0, p = 0;
  bool operator==(const NoteQ&) const = default;
};

/// A note of a clip or a render order: detected values plus the targets that differ from them.
struct AudioNote {
  std::string id;
  double qa = 0, qe = 0, qton = 0, p = 0;
  std::optional<double> a, e, ton, vib, drift, formant, gain_db;
  bool operator==(const AudioNote&) const = default;
};

/// Result of the monophonic check (written by `pruefe` only).
struct Mono {
  int64_t geprueft_frames = 0;
  double anteil = 0;
  bool mehrstimmig = false;
  double hrr_db_schwelle = 0, periode_schwelle = 0;
  bool operator==(const Mono&) const = default;
};

/// The curve sidecar `<arbeitsordner>/noten/<source sha>.<curve id>.json`.
struct Seitendatei {
  std::string quelle;        // source sha, 64 lowercase hex
  Kurve k;
  std::vector<NoteQ> noten;
  double stimmhaft_anteil = 0;
  std::optional<Mono> mono;
  bool operator==(const Seitendatei&) const = default;
};

/// Stereo audio, two float channels of equal length.
struct Stereo {
  std::vector<float> l, r;
  int64_t frames() const { return static_cast<int64_t>(l.size()); }
};

/// Rounding of the contract: seconds to 1e-6, pitch, factors, dB to 1e-4.
double rundeS(double x);
double rundeTon(double x);

// ---- JSON files. Every reader returns the value or a Fehler; the codes and their precedence are those of notes.md:
//      datei_fehlt (no such file), datei_kaputt (not readable JSON), format (shape, ranges, lengths, mono rules),
//      noten_ungueltig (list rules). Readers check everything the contract says about the file alone; whether the curve fits the
//      source (kurve_passt_nicht) is the caller's check, except the curve id of a render order, which liesAuftrag compares.

/// Sidecar: shape of the file, mono rules, shape of all notes, array lengths and decimals, then the list rules of the notes.
std::variant<Seitendatei, Fehler> liesSeitendatei(const std::string& pfad);
/// Writes the sidecar to `<pfad>.tmp` and renames it. Values are rounded to the decimals of the contract (f0_ct 2, konf 3, note times 6,
/// pitch and level 4, stimmhaft_anteil 4) and the result is checked like a file that is read; a broken struct gives format, nothing is written.
std::optional<Fehler> schreibeSeitendatei(const std::string& pfad, const Seitendatei& s);
/// External curve (input of `segment`). The returned Kurve has detektor "netz" and the curve id <detektor_version>.<SEGMENTIERER_VERSION>.
std::variant<Kurve, Fehler> liesRoh(const std::string& pfad);
/// Render order. `kurveId` is the curve id of the sidecar: another one in the order gives kurve_passt_nicht (after the file itself is valid).
std::variant<std::vector<AudioNote>, Fehler> liesAuftrag(const std::string& pfad, const std::string& kurveId);

}  // namespace cdj::noten
