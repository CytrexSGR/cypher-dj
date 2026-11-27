// cdj_noten: the own pitch detector (port of `pyin_hmm` of the bench, messungen/M21-noten/m21_k_pyin.py). Created by task A4; the
// command `analyse` (cli_analysis.cpp) is its caller. Version: DETEKTOR_VERSION.
#pragma once
#include <vector>

#include "intern.h"

namespace cdj::noten {

/// Probabilistic YIN with an HMM over 20 cent pitch bins and Viterbi decoding (three analysis scales, absolute silence gate), on a mono
/// signal at sample rate `sr`. One pitch per frame: hop HOP (256), frame i is centred at sample i * HOP, floor(n / HOP) + 1 frames for n
/// samples (an empty input gives one unvoiced frame). f0_ct is MIDI times 100 (0 = unvoiced), konf the voiced posterior (0..1).
/// The returned Kurve has detektor "pyin", the curve id <DETEKTOR_VERSION>.<SEGMENTIERER_VERSION>, `frames` = n. Non finite samples count
/// as 0. `f` (may be null) gets progress lines as stage 2 of the command, named "tonhoehe". The loops poll abbruchAngefordert(): after
/// SIGTERM the function returns early with an incomplete (all unvoiced) curve that the caller must discard.
Kurve erkenne(const std::vector<float>& mono, int sr, Fortschritt* f);

}  // namespace cdj::noten
