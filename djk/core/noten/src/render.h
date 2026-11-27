// cdj_noten: pitch-only render of the engine `teilton-2` (task A6): port of the edit of BERICHT_teilton2.md section 8, B (steps 6 to 13,
// pitch part). The envelope reading (hull.cpp) and the phase reading (phase.cpp) are one function each, so that a later improvement
// replaces only them. Builds on the partial analysis of teiltoene.h.
#pragma once
#include <cstdint>
#include <set>
#include <string>
#include <utility>
#include <variant>
#include <vector>

#include "teiltoene.h"

namespace cdj::noten {

/// Amplitudes of the partials k = 1 .. amp.size() of the frame `frame` of `t` (index into t.f0, channel `kanal`) when the pitch moves by
/// `faktor` (new f0 / old f0): the old log amplitude over the harmonic index is read at kappa = k * faktor^(1 - mischung), Catmull-Rom (cubic Hermite) in ln A
/// between the neighbouring partials, a falling spectrum is continued below the first partial, the amplitude is zero above the last
/// fitted partial and above min(16 kHz, 0.49 sr), and the energy of the frame is kept. `mischung` 0: the envelope stays in Hz (a voice),
/// 1: it stays on the harmonic index (a string). Empty for an unvoiced frame. A frame with faktor 1 gives its own amplitudes.
void leseHuelle(const Teiltoene& t, int kanal, int frame, double faktor, std::vector<double>& amp, double mischung = 0.0);

/// Phases of the same partials as leseHuelle returns them (same size): the phase of the partial of the same index in the old frame
/// (the waveform keeps its shape), zero where the old frame has no such partial.
void lesePhase(const Teiltoene& t, int kanal, int frame, double faktor, std::vector<double>& phase, double mischung = 0.0);

/// Number of partials leseHuelle and lesePhase return for the frame (the shared rule behind both).
int neueTeiltoene(const Teiltoene& t, int frame, double faktor, double mischung);

/// Where the spectral envelope of the material stays when the pitch moves: 0 in Hz, 1 on the harmonic index, in steps of 0.25 (step 8 of
/// the port section). Estimated from up to six notes of the list (at least 0.35 s long, spread over the pitch range) with the detected
/// values qa, qe, qton only, so it does not depend on the edits. 0 when fewer than three usable pairs of notes exist.
double schaetzeMischung(const Stereo& quelle, const Kurve& k, const std::vector<AudioNote>& liste);

struct RenderErgebnis {
  /// Rewritten sample ranges, half open, ascending, disjoint. Without `vorher`: the regions of the edit groups (everything outside is
  /// the source, bit for bit). With `vorher` and `nur`: the restored ranges (everything outside is `vorher`, bit for bit).
  std::vector<std::pair<int64_t, int64_t>> bereiche;
};

/// Renders the pitch edits of `liste` (the `ton` targets; any other target is Fehler "nicht_unterstuetzt") into `aus` (the frames of
/// `quelle`). Errors: kurve_passt_nicht (frames, sr, hop or length of the curve), vorher_passt_nicht, noten_ungueltig (a note ends after
/// the source), argument (an id of `nur` is not in the list), abbruch (SIGTERM).
///
/// Notes closer than 40 ms form one group; the region of a group is the union of its notes; the shift per sample is the note's semitone
/// offset with raised cosine ramps of at most 20 ms, y = x - h + h' inside the notes, so the samples outside every region stay the
/// source bit for bit. Without `vorher` the output starts as a copy of the source. With `vorher` and `nur`: it starts as a copy of
/// `vorher`; the range R, the union over the ids of `nur` of [qa - 40 ms, qe + 40 ms], grown until it covers every edit group of the new
/// list it touches, is copied from the source, and every group touching R is rendered again. `nur` without `vorher` is ignored.
/// A list without any target renders nothing. `f` (may be null) gets progress lines as stage 2 "rendern".
std::variant<RenderErgebnis, Fehler> rendere(const Stereo& quelle, const Kurve& k, const std::vector<AudioNote>& liste, const Stereo* vorher,
                                             const std::set<std::string>* nur, Stereo& aus, Fortschritt* f);

}  // namespace cdj::noten
