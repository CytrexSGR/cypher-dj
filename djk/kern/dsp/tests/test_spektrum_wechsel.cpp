// Package 1.15, part C: spectrum source change (stale ring data must not reach the new source's frames).
// Call: test_spektrum_wechsel [mutation]
//   no argument:     every check must pass;
//   "ohne_leeren":   build whose verwerfe_bis() does not call leeren(); the window check MUST fail (and only it);
//   "schnitt_ignoriert": build whose verwerfe_bis() ignores the cut and drops everything written; only the
//                    cut-before-the-write-index check MUST fail;
//   "ohne_lese":     build whose verwerfe_bis() does not advance the read index; the ring checks MUST fail (and only they).
#include <cypherdj/dsp/spektrum.h>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

#include "pruef.h"

using namespace cypherdj::dsp;

namespace {

constexpr double kPi = 3.14159265358979323846;

bool pruefe(bool ok, const char* name) {
    std::printf("  %-62s %s\n", name, ok ? "ok" : "ROT");
    return ok;
}

std::vector<float> sinus(double f, int n) {
    std::vector<float> x(static_cast<std::size_t>(n));
    for (int i = 0; i < n; ++i) x[static_cast<std::size_t>(i)] = static_cast<float>(std::sin(2.0 * kPi * f * i / 48000.0));
    return x;
}

SpektrumEinstellung ohne_glaettung() {
    SpektrumEinstellung e;
    e.glaettung_ms = 0.0f;   // level = this frame
    e.halten_ms = 10000.0f;  // peak hold keeps the maximum over every frame since leeren()
    return e;
}

int band_von(const SpektrumAnalysator& s, double f) {
    for (int b = 0; b < s.anzahl_baender(); ++b)
        if (f >= s.band_unten_hz(b) && f < s.band_oben_hz(b)) return b;
    return -1;
}

struct Messung {
    double spitze_db = 0.0;    // highest 1 kHz band level minus highest 5 kHz band level over the frames of the first 2048 new samples
    double ruhig_db = 0.0;     // same on the last frame after the window holds 5 kHz only (smoothing is off)
    long rahmen = 0;
};

// 5 kHz after the switch; frames 1..3 see a partly filled window: the onset of the sine from silence splatters
// about -45 dB into the 1 kHz band by itself (the reference without any stale data shows it), so "no stale 1 kHz"
// is judged against that reference, and against -60 dB on the last frame, where the window is full.
// mode 0: stale then verwerfe_bis(cut); 1: stale then leeren() only (the pre-change behaviour); 2: no stale data.
Messung messe(int stale, int modus) {
    SpektrumAnalysator s(48000.0, ohne_glaettung());
    if (modus != 2) {
        const auto alt = sinus(1000.0, stale);
        s.schreibe(alt.data(), nullptr, stale);
    }
    const std::size_t schnitt = s.schreib_position();
    if (modus == 0) s.verwerfe_bis(schnitt); else s.leeren();
    const auto neu = sinus(5000.0, 4096);
    Messung m;
    s.schreibe(neu.data(), nullptr, 2048);
    s.analysiere();
    m.spitze_db = static_cast<double>(s.spitze_db()[band_von(s, 1000.0)] - s.spitze_db()[band_von(s, 5000.0)]);
    s.schreibe(neu.data() + 2048, nullptr, 2048);
    s.analysiere();
    m.ruhig_db = static_cast<double>(s.pegel_db()[band_von(s, 1000.0)] - s.pegel_db()[band_von(s, 5000.0)]);
    m.rahmen = s.rahmen();
    return m;
}

bool altlast(int stale) {
    const Messung ref = messe(0, 2), m = messe(stale, 0);
    std::printf("    %d stale: 1k vs 5k peak %.2f dB (clean reference %.2f), settled %.2f dB, %ld frames\n", stale, m.spitze_db,
                ref.spitze_db, m.ruhig_db, m.rahmen);
    return m.rahmen > 0 && m.spitze_db <= ref.spitze_db + 0.5 && m.ruhig_db <= -60.0 && ref.ruhig_db <= -60.0;
}

// The pre-change behaviour, pinned: leeren() alone leaves the ring alone, so the stale samples still reach the frames.
bool leeren_allein_reicht_nicht() {
    const Messung m = messe(14336, 1);
    std::printf("    leeren() only, 14336 stale: peak %.2f dB, settled %.2f dB over %ld frames\n", m.spitze_db, m.ruhig_db, m.rahmen);
    return m.rahmen > 0 && m.spitze_db > -3.0;
}

// The window (verlauf_) holds old data that was already analysed; the ring is empty. Only leeren() removes it.
bool fenster_wird_geleert() {
    SpektrumAnalysator s(48000.0, ohne_glaettung());
    const auto alt = sinus(1000.0, 4096);
    s.schreibe(alt.data(), nullptr, 4096);
    s.analysiere();
    const std::size_t schnitt = s.schreib_position();
    s.verwerfe_bis(schnitt);
    const auto neu = sinus(5000.0, 2048);
    s.schreibe(neu.data(), nullptr, 2048);
    s.analysiere();
    const double d = static_cast<double>(s.spitze_db()[band_von(s, 1000.0)] - s.spitze_db()[band_von(s, 5000.0)]);
    const Messung ref = messe(0, 2);
    std::printf("    analysed window, then switch: 1k vs 5k peak %.2f dB (clean reference %.2f) over %ld frames\n", d, ref.spitze_db,
                s.rahmen());
    return s.rahmen() > 0 && d <= ref.spitze_db + 0.5;
}

// A full ring (16384 stale samples) is emptied by the cut: the new source is not dropped afterwards.
bool voller_ring_wird_frei() {
    SpektrumAnalysator s(48000.0, ohne_glaettung());
    const auto alt = sinus(1000.0, SpektrumAnalysator::kRing);
    s.schreibe(alt.data(), nullptr, SpektrumAnalysator::kRing);
    s.verwerfe_bis(s.schreib_position());
    const auto neu = sinus(5000.0, 2048);
    s.schreibe(neu.data(), nullptr, 2048);
    s.analysiere();
    const double d = static_cast<double>(s.spitze_db()[band_von(s, 1000.0)] - s.spitze_db()[band_von(s, 5000.0)]);
    const Messung ref = messe(0, 2);
    std::printf("    full ring cut: lost %ld, 1k vs 5k %.2f dB (clean reference %.2f), frames %ld\n", s.verlorene_samples(), d,
                ref.spitze_db, s.rahmen());
    return s.verlorene_samples() == 0 && s.rahmen() > 0 && d <= ref.spitze_db + 0.5;
}

// D12 case: the cut is taken, the NEW source is written, and only then verwerfe_bis(cut) runs, so cut < write index.
// Everything before the cut goes, everything after it stays: same frame count and level as without any stale data.
bool schnitt_vor_schreibindex() {
    const Messung ref = messe(0, 2);
    bool ok = true;
    for (int stale : {3000, 1920}) {
        SpektrumAnalysator s(48000.0, ohne_glaettung());
        const auto alt = sinus(1000.0, stale);
        s.schreibe(alt.data(), nullptr, stale);
        const std::size_t schnitt = s.schreib_position();
        const auto neu = sinus(5000.0, 2048);
        s.schreibe(neu.data(), nullptr, 2048);
        s.verwerfe_bis(schnitt);
        s.analysiere();
        const double d = static_cast<double>(s.spitze_db()[band_von(s, 1000.0)] - s.spitze_db()[band_von(s, 5000.0)]);
        const float p5 = s.pegel_db()[band_von(s, 5000.0)];
        std::printf("    %d stale, cut, 2048 new, then verwerfe_bis(cut): %ld frames (reference 4), 1k vs 5k %.2f dB, 5k level %.2f dB\n",
                    stale, s.rahmen(), d, static_cast<double>(p5));
        ok &= s.rahmen() == 4 && d <= ref.spitze_db + 0.5 && d >= ref.spitze_db - 0.5;
    }
    return ok;
}

bool schreib_position_zaehlt() {
    SpektrumAnalysator s(48000.0, ohne_glaettung());
    bool ok = s.schreib_position() == 0;
    const auto x = sinus(1000.0, 1000);
    s.schreibe(x.data(), nullptr, 1000);
    ok &= s.schreib_position() == 1000;
    s.analysiere();
    ok &= s.schreib_position() == 1000;  // reading does not move it
    // overfill: 16000 unread samples leave room for 384; only the accepted ones count
    const auto y = sinus(1000.0, 16000);
    s.schreibe(y.data(), nullptr, 16000);
    s.schreibe(x.data(), nullptr, 1000);
    ok &= s.schreib_position() == 1000 + 16000 + 384;
    ok &= s.verlorene_samples() == 616;
    std::printf("    position after overfill: %zu, lost %ld\n", s.schreib_position(), s.verlorene_samples());
    return ok;
}

// A cut beyond what was written is clamped to the write index; a cut in the past never rewinds the read index.
bool schnitt_klemmt() {
    SpektrumAnalysator s(48000.0, ohne_glaettung());
    const auto x = sinus(1000.0, 4096);
    s.schreibe(x.data(), nullptr, 4096);
    s.verwerfe_bis(1000000);  // far beyond: everything written so far is dropped, nothing "future"
    const auto y = sinus(5000.0, 4096);
    s.schreibe(y.data(), nullptr, 4096);
    const int n1 = s.analysiere();
    int m = 0;
    for (int b = 1; b < s.anzahl_baender(); ++b)
        if (s.pegel_db()[b] > s.pegel_db()[m]) m = b;
    // past cut: the read index is already at the write index; a cut at 0 must not make old samples readable again
    s.verwerfe_bis(0);
    const int n2 = s.analysiere();
    std::printf("    frames after far cut %d, after past cut %d, loudest band %d (5 kHz is %d)\n", n1, n2, m, band_von(s, 5000.0));
    const int b5 = band_von(s, 5000.0);
    return n1 == 4096 / s.hop() && n2 == 0 && m == b5;
}

// Positive control: without any source change the frames do show the 1 kHz peak at the right band.
bool positivkontrolle() {
    SpektrumAnalysator s(48000.0, ohne_glaettung());
    const auto alt = sinus(1000.0, 4096);
    s.schreibe(alt.data(), nullptr, 4096);
    s.analysiere();
    int m = 0;
    for (int b = 1; b < s.anzahl_baender(); ++b)
        if (s.spitze_db()[b] > s.spitze_db()[m]) m = b;
    std::printf("    loudest band %d (1 kHz is band %d), %.2f dB\n", m, band_von(s, 1000.0), static_cast<double>(s.spitze_db()[m]));
    return m == band_von(s, 1000.0) && s.spitze_db()[m] > -1.0f;
}

}  // namespace

int main(int argc, char** argv) {
    const std::string mutation = argc > 1 ? argv[1] : "";
    std::printf("SpektrumAnalysator source change%s\n", mutation.empty() ? "" : (" (mutation build: " + mutation + ")").c_str());
    const bool r_kontrolle = pruefe(positivkontrolle(), "control: a 1 kHz sine peaks in the 1 kHz band");
    const bool r_alt = pruefe(leeren_allein_reicht_nicht(), "pre-change: leeren() alone leaves stale 1 kHz in the frames");
    const bool r_lang = pruefe(altlast(14336), "14336 stale samples: no stale 1 kHz after the cut");
    const bool r_kurz = pruefe(altlast(1920), "1920 stale samples: no stale 1 kHz after the cut");
    const bool r_ring = pruefe(voller_ring_wird_frei(), "full ring: the cut frees it, the new source is not dropped");
    const bool r_fenster = pruefe(fenster_wird_geleert(), "analysed window is cleared by the cut");
    const bool r_vor = pruefe(schnitt_vor_schreibindex(), "cut before the write index: new source kept, stale dropped");
    const bool r_pos = pruefe(schreib_position_zaehlt(), "schreib_position counts accepted samples only");
    const bool r_klemme = pruefe(schnitt_klemmt(), "cut beyond the write index clamps, cut in the past never rewinds");
    if (mutation == "ohne_leeren") {  // only the window check may fail
        PRUEF(!r_fenster);
        PRUEF(r_kontrolle && r_alt && r_lang && r_kurz && r_ring && r_pos && r_klemme && r_vor);
        return pruef::ende();
    }
    if (mutation == "schnitt_ignoriert") {  // only the cut-before-the-write-index check may fail
        PRUEF(!r_vor);
        PRUEF(r_kontrolle && r_alt && r_lang && r_kurz && r_ring && r_fenster && r_pos && r_klemme);
        return pruef::ende();
    }
    if (mutation == "ohne_lese") {  // the ring checks fail, the rest stays green
        PRUEF(!r_lang && !r_kurz && !r_ring);
        PRUEF(r_kontrolle && r_alt && r_fenster && r_pos);
        return pruef::ende();
    }
    PRUEF(r_kontrolle);
    PRUEF(r_alt);
    PRUEF(r_lang);
    PRUEF(r_kurz);
    PRUEF(r_ring);
    PRUEF(r_fenster);
    PRUEF(r_vor);
    PRUEF(r_pos);
    PRUEF(r_klemme);
    return pruef::ende();
}
