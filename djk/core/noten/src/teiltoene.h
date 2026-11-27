// cdj_noten: partial analysis of the engine `teilton-2` (a port of m21_k_teilton.py, BERICHT_teilton2.md section 8), the harmonic
// resynthesis, the harmonic-to-residual ratio and the monophonic check (A2). Owned by task A5; the render (A6) builds on this header.
#pragma once
#include <complex>
#include <cstdint>
#include <vector>

#include "intern.h"

namespace cdj::noten {

/// Thresholds of the monophonic check (BERICHT_einstimmig.md, gold.json `mono`): a checked frame that the curve calls voiced is
/// polyphonic when its HRR is below MONO_HRR_DB AND the CMNDF minimum of the residual is at most MONO_PERIODE. The unvoiced rule is off.
inline constexpr double MONO_HRR_DB = 9.5;
inline constexpr double MONO_PERIODE = 0.5;

/// Fit of the partials of one region of a source: all frames that touch the samples [s0, s1). Frame i of the region is centred at
/// sample (j0 + i) * HOP. A frame the curve calls unvoiced has f0 = 0 and empty b vectors.
///
/// The fundamental phase is per channel, as in the prototype: psi = phi + alpha1 interpolated, where phi is the integral of the refined
/// f0 track (linear between the voiced frames, any origin) and alpha1 the unwrapped phase of partial 1 of the channel at the frame
/// centres (psi / alpha1 for the left, psi_r / alpha1_r for the right channel). b[i][k-1] = A_k e^{j rho_k} is the partial k of the frame
/// relative to k times the fundamental of its own channel (the waveform shape; partial 1 is real). Two identical channels are fitted
/// once (b_r equals b_l, psi_r equals psi). Only b and psi modulo 2 pi are meaningful; they do not depend on the origin of phi, so the analysis of
/// a region equals the analysis of the whole file except next to unvoiced holes that reach past the margin of the region.
struct Teiltoene {
  int64_t s0 = 0, s1 = 0;
  std::vector<double> f0;                                  // refined f0 in Hz per frame, 0 = no partials
  std::vector<double> psi, psi_r;                          // phase of the fundamental per sample over [s0, s1): left, right channel
  std::vector<std::vector<std::complex<double>>> b_l, b_r; // per frame, per channel: A_k e^{j rho_k}, k = 1 .. size
  // for the render: psi == phi + alpha1 interpolated linearly between the frame centres (held at the ends)
  int64_t j0 = 0;                                          // index of the first frame
  std::vector<double> alpha1, alpha1_r;                    // per frame: unwrapped phase of partial 1 relative to phi at the frame centre, left, right
  std::vector<double> phi;                                 // per sample over [s0, s1): phase of the f0 track
};

/// Analysis of the frames that touch [s0, s1) (clipped to the source). Windows of an integer number of periods, sized from the refined
/// pitch; samples outside the source are zero. The curve must have frameZahl(x.frames()) frames of hop HOP at SR.
Teiltoene analysiere(const Stereo& x, const Kurve& k, int64_t s0, int64_t s1);

/// The harmonic signal of one channel (0 = left, 1 = right) over [t.s0, t.s1): oscillator bank, b interpolated linearly in time between
/// the frame centres (held outside), psi per sample.
void harmonisch(const Teiltoene& t, int kanal, std::vector<double>& h);

/// Harmonic-to-residual ratio in dB, 10 log10(sum h^2 / sum (x - h)^2), over the samples of [s0, s1) that lie within half a hop of a
/// voiced frame, both channels.
double hrrDb(const Stereo& x, const Kurve& k, int64_t s0, int64_t s1);

/// HRR in dB of the 20 ms block [c - 480, c + 480) around the centre c of each given frame (ascending frame indices, mono mix of x);
/// NaN where the curve is unvoiced at the frame.
std::vector<double> hrrFrames(const Stereo& x, const Kurve& k, const std::vector<int64_t>& frames);

/// The frames the monophonic check evaluates: every fourth frame whose block RMS is at least P95 - 40 dB (mono mix, nf frames).
std::vector<int64_t> gepruefteFrames(const std::vector<float>& mono, int64_t nf);

/// Monophonic check of a source with its curve (A2). No short-source rule here (the command applies it). `f` may be null.
Mono pruefeEinstimmig(const Stereo& x, const Kurve& k, Fortschritt* f);

}  // namespace cdj::noten
