// Package 1.15, part C: spectrum analyser (Fft, SpektrumAnalysator). Numeric checks against analytic
// expectations: FFT against a direct DFT, sine levels in dB, white-noise band power, band centres in Hz,
// frame count per hop, smoothing decay in dB per frame, peak hold time in frames and fall in dB per frame,
// ring overflow in samples, and a two-thread run.
// Call: test_spektrum [mutation]
//   no argument:     every check must pass;
//   "ohne_fenster":  mutation build with a rectangular window instead of Hann; the leakage check MUST fail
//                    (an off-bin 1 kHz sine leaks about -40 dB into the 4 kHz band without a window).
#include <cypherdj/dsp/spektrum.h>

#include <atomic>
#include <chrono>
#include <cmath>
#include <complex>
#include <cstdio>
#include <memory>
#include <string>
#include <thread>
#include <vector>

#include "messen.h"
#include "pruef.h"

using namespace cypherdj::dsp;

namespace {

bool pruefe(bool ok, const char* name) {
    std::printf("  %-44s %s\n", name, ok ? "ok" : "ROT");
    return ok;
}

// Feeds x in blocks and analyses after every block (as a UI thread polling faster than the hop would).
void einspeisen(SpektrumAnalysator& s, const std::vector<float>& x, int block = 256) {
    for (std::size_t a = 0; a < x.size(); a += static_cast<std::size_t>(block)) {
        const int n = static_cast<int>(std::min<std::size_t>(static_cast<std::size_t>(block), x.size() - a));
        s.schreibe(&x[a], nullptr, n);
        s.analysiere();
    }
}

int band_von(const SpektrumAnalysator& s, double f) {
    for (int b = 0; b < s.anzahl_baender(); ++b)
        if (f >= s.band_unten_hz(b) && f < s.band_oben_hz(b)) return b;
    return -1;
}

int lautestes_band(const SpektrumAnalysator& s) {
    int m = 0;
    for (int b = 1; b < s.anzahl_baender(); ++b)
        if (s.pegel_db()[b] > s.pegel_db()[m]) m = b;
    return m;
}

SpektrumEinstellung ohne_glaettung(int groesse) {
    SpektrumEinstellung e;
    e.groesse = groesse;
    e.glaettung_ms = 0.0f;
    return e;
}

// 1. FFT against a direct DFT (double), all sizes from 2 to 4096.
bool fft_gegen_dft(double& groesster_fehler) {
    auto fft = std::make_unique<Fft>();
    groesster_fehler = 0.0;
    bool ok = !fft->setze_groesse(3000) && !fft->setze_groesse(8192) && !fft->setze_groesse(0);
    unsigned s = 11;
    for (int n = 2; n <= 4096; n *= 2) {
        ok &= fft->setze_groesse(n);
        std::vector<double> re(static_cast<std::size_t>(n)), im(static_cast<std::size_t>(n));
        for (int i = 0; i < n; ++i) {
            s = s * 1664525u + 1013904223u;
            re[i] = (s >> 8) * (1.0 / 16777216.0) - 0.5;
            s = s * 1664525u + 1013904223u;
            im[i] = (s >> 8) * (1.0 / 16777216.0) - 0.5;
        }
        const std::vector<double> re0(re), im0(im);
        fft->transformiere(re.data(), im.data());
        const int pruefbins = n <= 256 ? n : 64;  // direct DFT is O(n^2): spot-check large sizes
        for (int t = 0; t < pruefbins; ++t) {
            const int k = n <= 256 ? t : (t * 97 + 5) % n;
            std::complex<double> soll(0.0, 0.0);
            for (int j = 0; j < n; ++j)
                soll += std::complex<double>(re0[j], im0[j]) * std::polar(1.0, -2.0 * messen::kPi * j * k / n);
            groesster_fehler = std::max(groesster_fehler, std::abs(soll - std::complex<double>(re[k], im[k])));
        }
    }
    std::printf("    largest |FFT - DFT| over sizes 2 ... 4096: %.3g\n", groesster_fehler);
    return ok && groesster_fehler < 1e-10;
}

// 2. Band layout: 1/6 octave between 20 Hz and 20 kHz: centres 1000 * 2^(i/6), i = -33 ... 25, contiguous.
bool baender() {
    auto s = std::make_unique<SpektrumAnalysator>();
    bool ok = s->anzahl_baender() == 59;
    for (int b = 0; b < s->anzahl_baender(); ++b) {
        const double soll = 1000.0 * std::pow(2.0, (b - 33) / 6.0);
        ok &= std::fabs(s->band_mitte_hz(b) - soll) < 1e-3 * soll;
        ok &= std::fabs(s->band_unten_hz(b) - soll * std::pow(2.0, -1.0 / 12.0)) < 1e-3 * soll;
        if (b > 0) ok &= s->band_unten_hz(b) == s->band_oben_hz(b - 1);
    }
    std::printf("    %d bands, first %.3f Hz, last %.1f Hz\n", s->anzahl_baender(), s->band_mitte_hz(0),
                s->band_mitte_hz(s->anzahl_baender() - 1));
    SpektrumEinstellung e;
    e.baender_pro_oktave = 3;
    auto t = std::make_unique<SpektrumAnalysator>(44100.0, e);
    ok &= t->anzahl_baender() == 29;  // 1/3 octave: i = -16 ... 12 (19.7 Hz ... 16 kHz; 20.16 kHz > f_max)
    std::printf("    1/3 octave at 44.1 kHz: %d bands, %.2f ... %.1f Hz\n", t->anzahl_baender(), t->band_mitte_hz(0),
                t->band_mitte_hz(t->anzahl_baender() - 1));
    return ok;
}

// 3. Sine levels: amplitude 1 reads 0 dB, amplitude 0.5 reads -6.02 dB, in the band that contains it,
//    for all three sizes and off-bin frequencies.
bool sinus_pegel(double& groesste_abweichung) {
    bool ok = true;
    groesste_abweichung = 0.0;
    for (int n : {1024, 2048, 4096})
        for (double f : {1000.0, 3210.0, 10000.0})
            for (double a : {1.0, 0.5}) {
                auto s = std::make_unique<SpektrumAnalysator>(48000.0, ohne_glaettung(n));
                einspeisen(*s, messen::sinus(f, a, 24000));
                const int b = band_von(*s, f);
                const double soll = 20.0 * std::log10(a);
                const double ist = s->pegel_db()[b];
                // Exact only if the band holds the whole Hann main lobe (+-2 bins, plus half a bin margin);
                // otherwise part of the lobe is counted in the neighbour band and the level reads lower.
                const double bin = 48000.0 / n;
                if (f - 2.5 * bin >= s->band_unten_hz(b) && f + 2.5 * bin < s->band_oben_hz(b)) {
                    groesste_abweichung = std::max(groesste_abweichung, std::fabs(ist - soll));
                    ok &= lautestes_band(*s) == b;
                    ok &= std::fabs(ist - soll) < 0.05;
                } else {
                    if (a == 1.0)
                        std::printf("    %.0f Hz, size %d: main lobe wider than the band (%d bins), reads %.2f dB\n", f,
                                    n, s->band_bins(b), ist);
                    ok &= ist <= soll + 0.05 && ist > soll - 6.0;
                }
            }
    // Stereo: (l + r) / 2, so l = r = sine reads like the sine, l = -r reads silence.
    auto s = std::make_unique<SpektrumAnalysator>(48000.0, ohne_glaettung(2048));
    const auto x = messen::sinus(1000.0, 1.0, 48 * 512);
    std::vector<float> minus(x);
    for (float& v : minus) v = -v;
    for (std::size_t a = 0; a < x.size(); a += 512) { s->schreibe(&x[a], &x[a], 512); s->analysiere(); }
    ok &= std::fabs(s->pegel_db()[band_von(*s, 1000.0)]) < 0.05;
    for (std::size_t a = 0; a < x.size(); a += 512) { s->schreibe(&x[a], &minus[a], 512); s->analysiere(); }
    ok &= s->pegel_db()[band_von(*s, 1000.0)] == kStummDb;
    std::printf("    largest deviation of a sine level from 20*log10(A): %.4f dB\n", groesste_abweichung);
    // Report only: a 100 Hz tone in a band narrower than one bin reads lower (density times width).
    for (int n : {1024, 4096}) {
        auto t = std::make_unique<SpektrumAnalysator>(48000.0, ohne_glaettung(n));
        einspeisen(*t, messen::sinus(100.0, 1.0, 48000));
        std::printf("    100 Hz full-scale sine, size %d: band %.1f Hz reads %.2f dB (%d bins)\n", n,
                    t->band_mitte_hz(band_von(*t, 100.0)), t->pegel_db()[band_von(*t, 100.0)],
                    t->band_bins(band_von(*t, 100.0)));
    }
    return ok;
}

// 4. Leakage (the window): an off-bin 1 kHz sine must stay below -90 dB in the 4 kHz band.
bool leckage(double& db4k) {
    auto s = std::make_unique<SpektrumAnalysator>(48000.0, ohne_glaettung(4096));
    einspeisen(*s, messen::sinus(1000.0, 1.0, 24000));  // bin 85.33
    db4k = s->pegel_db()[band_von(*s, 4000.0)];
    std::printf("    1 kHz sine, level in the 4 kHz band: %.1f dB\n", db4k);
    return db4k < -90.0;
}

// 5. White noise (uniform, variance 1/3): band power = 4 * sigma^2 * bins / N relative to a full-scale sine.
bool rauschen() {
    bool ok = true;
    for (int n : {1024, 4096}) {
        SpektrumEinstellung e;
        e.groesse = n;
        e.glaettung_ms = 5000.0f;
        auto s = std::make_unique<SpektrumAnalysator>(48000.0, e);
        std::vector<float> x(48000 * 30);
        unsigned z = 3;
        for (float& v : x) { z = z * 1664525u + 1013904223u; v = static_cast<float>((z >> 8) * (2.0 / 16777216.0) - 1.0); }
        einspeisen(*s, x, 1024);
        for (double f : {1000.0, 8000.0}) {
            const int b = band_von(*s, f);
            const double soll = 10.0 * std::log10(4.0 / 3.0 * s->band_bins(b) / n);
            std::printf("    white noise, size %d, band %.0f Hz (%d bins): %.3f dB, expected %.3f dB\n", n,
                        s->band_mitte_hz(b), s->band_bins(b), s->pegel_db()[b], soll);
            ok &= s->band_bins(b) > 0 && std::fabs(s->pegel_db()[b] - soll) < 0.3;
        }
    }
    return ok;
}

// 6. Frames: one per hop; 48000 samples with size 2048 and overlap 4 (hop 512) give 93 frames.
bool rahmen_zahl() {
    bool ok = true;
    for (int u : {1, 2, 4, 8}) {
        SpektrumEinstellung e;
        e.ueberlappung = u;
        auto s = std::make_unique<SpektrumAnalysator>(48000.0, e);
        einspeisen(*s, std::vector<float>(48000, 0.1f), 1000);
        ok &= s->hop() == 2048 / u && s->rahmen() == 48000 / (2048 / u);
    }
    auto s = std::make_unique<SpektrumAnalysator>();
    ok &= !s->setze_ueberlappung(3) && !s->setze_groesse(3000) && !s->setze_groesse(512);
    ok &= s->setze_groesse(4096) && s->groesse() == 4096 && s->hop() == 1024 && s->anzahl_baender() == 59;
    return ok;
}

// 7. Smoothing: after the signal stops, the smoothed power falls by 10*log10(exp(-hop / (tau * fs))) per frame
//    (-0.4633 dB per frame for hop 512 and 100 ms).
bool glaettung(double& db_pro_rahmen) {
    SpektrumEinstellung e;
    e.glaettung_ms = 100.0f;
    auto s = std::make_unique<SpektrumAnalysator>(48000.0, e);
    einspeisen(*s, messen::sinus(1000.0, 1.0, 48000), 512);
    einspeisen(*s, std::vector<float>(2048, 0.0f), 512);  // now every frame is silent
    const int b = band_von(*s, 1000.0);
    const double vorher = s->pegel_db()[b];
    einspeisen(*s, std::vector<float>(512 * 10, 0.0f), 512);
    db_pro_rahmen = (s->pegel_db()[b] - vorher) / 10.0;
    const double soll = 10.0 * std::log10(std::exp(-512.0 / (0.1 * 48000.0)));
    std::printf("    smoothing decay: %.5f dB per frame, expected %.5f\n", db_pro_rahmen, soll);
    return std::fabs(db_pro_rahmen - soll) < 1e-3;
}

// 8. Peak hold: 500 ms at hop 512 = round(46.875) = 47 frames unchanged, then 20 dB/s = 0.21333 dB per frame.
bool spitze_halten(int& gehalten, double& fall) {
    SpektrumEinstellung e;
    e.glaettung_ms = 0.0f;
    e.halten_ms = 500.0f;
    e.fallen_db_pro_s = 20.0f;
    auto s = std::make_unique<SpektrumAnalysator>(48000.0, e);
    const int b = 33;  // 1 kHz
    // tone, then silence; record the peak after every frame (one hop per call)
    std::vector<float> x = messen::sinus(1000.0, 0.5, 94 * 512);
    x.resize(294 * 512, 0.0f);  // whole hops only: one schreibe() of 512 per frame
    std::vector<float> spitze, pegel;
    for (std::size_t a = 0; a < x.size(); a += 512) {
        s->schreibe(&x[a], nullptr, 512);
        if (s->analysiere() != 1) return false;
        spitze.push_back(s->spitze_db()[b]);
        pegel.push_back(s->pegel_db()[b]);
    }
    int gesetzt = -1;  // last frame in which the peak was (re)set by the level
    for (int k = 0; k < static_cast<int>(spitze.size()); ++k)
        if (pegel[k] >= spitze[k] && pegel[k] > -100.0f) gesetzt = k;
    gehalten = 0;
    while (gesetzt + gehalten + 1 < static_cast<int>(spitze.size()) && spitze[gesetzt + gehalten + 1] == spitze[gesetzt]) ++gehalten;
    fall = spitze[gesetzt + gehalten + 1] - spitze[gesetzt + gehalten + 11];
    fall /= 10.0;
    std::printf("    peak %.3f dB held %d frames (expected 47), then falls %.5f dB per frame (expected %.5f)\n",
                spitze[gesetzt], gehalten, fall, 20.0 * 512.0 / 48000.0);
    return gehalten == 47 && std::fabs(fall - 20.0 * 512.0 / 48000.0) < 1e-4 &&
           std::fabs(spitze[gesetzt] - 20.0 * std::log10(0.5)) < 0.05;
}

// 9. Ring overflow: without analysis, 20000 samples leave kRing in the ring and lose 20000 - kRing.
bool ueberlauf() {
    auto s = std::make_unique<SpektrumAnalysator>();
    std::vector<float> x(1000, 0.25f);
    for (int i = 0; i < 20; ++i) s->schreibe(x.data(), x.data(), 1000);
    const long verloren = s->verlorene_samples();
    const int r = s->analysiere();
    std::printf("    lost %ld samples (expected %d), %d frames from the ring (expected %d)\n", verloren,
                20000 - SpektrumAnalysator::kRing, r, SpektrumAnalysator::kRing / 512);
    return verloren == 20000 - SpektrumAnalysator::kRing && r == SpektrumAnalysator::kRing / 512;
}

// 10. Two threads: an audio thread writes 10 s of a sine in 128-sample blocks while the analysis thread polls.
//     Every sample is either analysed or counted as lost; with nothing lost the level is exact.
bool zwei_threads() {
    auto s = std::make_unique<SpektrumAnalysator>(48000.0, ohne_glaettung(2048));
    const auto x = messen::sinus(997.0, 0.5, 48000 * 10);
    std::atomic<bool> fertig{false};
    long rahmen = 0;
    std::thread analyse([&] {
        while (!fertig.load(std::memory_order_acquire)) { rahmen += s->analysiere(); std::this_thread::yield(); }
        rahmen += s->analysiere();
    });
    for (std::size_t a = 0; a < x.size(); a += 128) {
        s->schreibe(&x[a], nullptr, 128);
        if (a % 1024 == 0) std::this_thread::sleep_for(std::chrono::microseconds(500));  // ~40x real time
    }
    fertig.store(true, std::memory_order_release);
    analyse.join();
    const long verloren = s->verlorene_samples();
    const double pegel = s->pegel_db()[band_von(*s, 997.0)];
    std::printf("    two threads: %ld frames, %ld samples lost, level %.4f dB\n", rahmen, verloren, pegel);
    bool ok = rahmen == (static_cast<long>(x.size()) - verloren) / 512 && verloren < static_cast<long>(x.size()) / 10;
    if (verloren == 0) ok &= std::fabs(pegel - 20.0 * std::log10(0.5)) < 0.05;
    return ok;
}

}  // namespace

int main(int argc, char** argv) {
    const std::string mutation = argc > 1 ? argv[1] : "";
    std::printf("SpektrumAnalysator%s\n", mutation.empty() ? "" : (" (mutation build: " + mutation + ")").c_str());
    double fft_fehler = 0.0, sinus_abw = 0.0, db4k = 0.0, glatt = 0.0, fall = 0.0;
    int gehalten = 0;
    const bool r_fft = pruefe(fft_gegen_dft(fft_fehler), "FFT equals direct DFT");
    const bool r_baender = pruefe(baender(), "band centres 1000 * 2^(i/b)");
    const bool r_sinus = pruefe(sinus_pegel(sinus_abw), "sine reads 20*log10(A) in its band");
    const bool r_leck = pruefe(leckage(db4k), "Hann leakage two octaves away < -90 dB");
    const bool r_rauschen = pruefe(rauschen(), "white-noise band power");
    const bool r_rahmen = pruefe(rahmen_zahl(), "one frame per hop, size/overlap switch");
    const bool r_glatt = pruefe(glaettung(glatt), "smoothing decay per frame");
    const bool r_spitze = pruefe(spitze_halten(gehalten, fall), "peak hold and fall");
    const bool r_ueberlauf = pruefe(ueberlauf(), "ring overflow counted, never blocks");
    const bool r_threads = pruefe(zwei_threads(), "audio and analysis thread");

    if (mutation == "ohne_fenster") {
        PRUEF(!r_leck);  // the wrong implementation must be caught
        return pruef::ende();
    }
    PRUEF(r_fft);
    PRUEF(r_baender);
    PRUEF(r_sinus);
    PRUEF(r_leck);
    PRUEF(r_rauschen);
    PRUEF(r_rahmen);
    PRUEF(r_glatt);
    PRUEF(r_spitze);
    PRUEF(r_ueberlauf);
    PRUEF(r_threads);
    return pruef::ende();
}
