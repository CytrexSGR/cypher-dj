// cdj_noten: render of the engine `teilton-2` (task A6, time edits strand 8 T2): port of the edit of BERICHT_teilton2.md section 8, B
// (steps 6 to 13) and of the time edit of m21_k_teilton.py. The envelope reading (hull.cpp) and the phase reading (phase.cpp) are one function each, so that a later improvement
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
  /// Strand 8 T13: one entry per edited note (a target ton, a, e, vib or drift, and an interval of at least 8 samples) whose measuring range
  /// is long enough, ascending by list index. [s0, s1) is the middle of the new interval in output samples (between the head and tail zones
  /// of a time edit; a pitch-only edit keeps 40 ms at the start and 12 ms at the end), `ziel` the target pitch ton ?? qton (float MIDI).
  /// The caller measures the output there (cli_render.cpp); the same entries come with an incremental render for every edited note of `liste`.
  struct Mitte {
    std::string id;
    int64_t s0 = 0, s1 = 0;
    double ziel = 0;
  };
  std::vector<Mitte> mitten;
};

/// Renders the edits of `liste` (the targets `ton`, `a`, `e`, `vib` and `drift`; formant or gain_db is Fehler "nicht_unterstuetzt") into `aus`
/// (the frames of `quelle`). Errors: kurve_passt_nicht (frames, sr, hop or length of the curve), vorher_passt_nicht, noten_ungueltig (a
/// note ends after the source), argument (an id of `nur` is not in the list), noten_dehnung_grenze (a note with a time target whose
/// (e_eff - a_eff) / (qe - qa) lies outside 0.25 .. 4), noten_ueberlappen (the effective intervals a_eff = a ?? qa, e_eff = e ?? qe of two
/// neighbours overlap, or two edited notes overlap in the new timeline after the release margins), abbruch (SIGTERM).
///
/// Notes closer than 40 ms form one group; the region of a group is the union of the old and new intervals of its notes. Pitch edit: the
/// shift per sample is the note's semitone offset with raised cosine ramps of at most 20 ms, y = x - h + h' inside the notes. Time edit
/// (a or e; the new interval is clamped to the source after the stretch check): the note is read along a piecewise linear time map; the
/// head (unvoiced lead + 40 ms) and the tail (unvoiced tail + 12 ms) keep their length, the middle stretches; release margins of 6 ms
/// before and 12 ms after the note (never past a neighbour's detected edge) move with it. The partials are read along the map (and
/// shifted by a pitch target), the residual is copied at rate 1 and made as noise (STFT 1024, random phases from splitmix64 seeded with
/// (r0 << 16) ^ note index) in the stretched middle; a pure move (length kept) copies the residual over the whole note. What the new
/// interval covers is overwritten, what it vacates fades to silence over 10 ms. Vibrato and drift (strand 8 T9, contract notes.md): the
/// deviation of the curve from qton inside [qa, qe] is split into drift (centred moving mean over 47 frames) and vibrato (the rest); the
/// extra shift (drift - 1) * drift(tau) + (vib - 1) * vibrato(tau), read at the old time tau of the sample, is added to the semitone
/// shift of the note, shaped by the same edge ramps; a note without voiced frames ignores both factors. The samples outside every region stay the source bit for
/// bit; a list without time targets renders exactly as the pitch-only engine did.
///
/// Without `vorher` the output starts as a copy of the source. With `vorher` and `nur`: it starts as a copy of `vorher`; the range R, the
/// union over the ids of `nur` of [min(qa, a_eff) - 40 ms, max(qe, e_eff) + 40 ms] (widened by the release margins for a note with a time
/// target) in `liste` and, when given, in `vorherListe` (the list `vorher` was rendered from), grown until it covers every edit group of
/// the new list it touches, is copied from the source, and every group touching R is rendered again. A list with any time target and no
/// `vorherListe` ignores `nur` and renders in full (the earlier list may have left a moved note anywhere). `nur` without `vorher` is
/// ignored. A list without any target renders nothing. `f` (may be null) gets progress lines as stage 2 "rendern".
std::variant<RenderErgebnis, Fehler> rendere(const Stereo& quelle, const Kurve& k, const std::vector<AudioNote>& liste, const Stereo* vorher,
                                             const std::set<std::string>* nur, Stereo& aus, Fortschritt* f,
                                             const std::vector<AudioNote>* vorherListe = nullptr);

}  // namespace cdj::noten
