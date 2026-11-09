// Hardening: path.h / path.cpp (per-sample controller trajectories). Fixed seed, every controller, 44.1/48/96 kHz.
//   1. Fuzz: setze / rampe / verlauf / setze_sofort with targets in range, at the limits, beyond them, +-inf and NaN:
//      every value finite and inside [min, max] (dB: or -200 = stumm), switches only 0 or 1 after setze.
//   2. Switch ramp duration: after llround(schaltrampe_ms * fs / 1000) + 1 samples the target is reached exactly
//      and faehrt() is false, at every rate (the ramp lasts the same time in ms).
//   3. No jumps: the per-sample step of a switch ramp (S-curve) is at most 1.5 |target - start| / n; dB ramps the
//      same between non-stumm ends (the one stumm step is about -60 dB, at most 0.0011 linear); the smoother's first
//      step is the largest, at most (1 - p) |target - start|. Monotone towards the target.
//   4. Segmentation independence: block() in sizes 1, 7, 64, kMaxFrames with the same events at the same sample
//      positions gives bit-identical values.
//   5. verlauf(): NaN holds the previous value, values clamped, dB <= -120 becomes -200, switches proportional;
//      nullptr refused; the trajectory rests on the last value afterwards.
//   6. Reset: setze_sofort() stops any ramp at once; NaN is ignored by setze, setze_sofort and rampe.
//   7. Denormals: the smoother settles on the target exactly (kEinrasten) and never produces a subnormal value.
//
// Mutation check (automatic, test_haertung_bahn_mutation_kill_hart): the test runs against the existing library
// cypherdj_dsp_mut_kill_hart (switches jump without ramp). The step check 3 is PRUEF_M and fails on it (verified
// 2026-11-02: kill step 1.0 instead of <= 0.00679 = 1.5 / 221 samples at 44.1 kHz).
#include <cypherdj/dsp/path.h>

#include <algorithm>
#include <cstdio>
#include <limits>
#include <vector>

#include "hardening.h"

using namespace cypherdj::dsp;
using haertung::Zufall;

namespace {

std::vector<double> werte(Bahn& b, int n, int block = kMaxFrames) {
    std::vector<double> v(static_cast<std::size_t>(n));
    std::vector<double> puffer(static_cast<std::size_t>(block));
    for (int p = 0; p < n; p += block) {
        const int m = std::min(block, n - p);
        if (!b.block(puffer.data(), m)) std::fill(puffer.begin(), puffer.begin() + m, static_cast<double>(b.wert()));
        std::copy(puffer.begin(), puffer.begin() + m, v.begin() + p);
    }
    return v;
}

bool im_bereich(Regler r, double w) {
    const ReglerInfo& ri = info(r);
    if (!std::isfinite(w)) return false;
    if (ri.einheit == Einheit::db && w == kStummDb) return true;
    return w >= ri.min && w <= ri.max;
}

float zufalls_ziel(Regler r, Zufall& z) {
    const ReglerInfo& ri = info(r);
    const double w = z.gleich();
    if (w < 0.05) return std::numeric_limits<float>::quiet_NaN();
    if (w < 0.10) return std::numeric_limits<float>::infinity();
    if (w < 0.15) return -std::numeric_limits<float>::infinity();
    if (w < 0.25) return ri.min;
    if (w < 0.35) return ri.max;
    if (w < 0.45) return static_cast<float>(z.zwischen(ri.min - 100.0, ri.max + 100.0));
    return static_cast<float>(z.zwischen(ri.min, ri.max));
}

void pruefe_fuzz() {
    Zufall z(231);
    long raus = 0, schalter_halb = 0, faelle = 0;
    for (double fs : haertung::kRaten)
        for (int ri = 0; ri < kAnzahlRegler; ++ri) {
            const Regler r = static_cast<Regler>(ri);
            Bahn b(r, fs);
            std::vector<float> ext(kMaxFrames);
            for (int e = 0; e < 300; ++e) {
                const int was = z.ganz(0, 3);
                const float ziel = zufalls_ziel(r, z);
                if (was == 0) b.setze(ziel);
                else if (was == 1) b.rampe(ziel, z.ganz(-2, 5000), z.gleich() < 0.5 ? Form::linear : Form::s_kurve);
                else if (was == 2) b.setze_sofort(ziel);
                else {
                    for (float& v : ext) v = zufalls_ziel(r, z);
                    b.verlauf(ext.data());
                }
                const bool schaltet = was == 0 || was == 2;
                const std::vector<double> v = werte(b, z.ganz(1, kMaxFrames), kMaxFrames);
                for (double w : v) { raus += !im_bereich(r, w); ++faelle; }
                if (schaltet && was == 2 && !std::isnan(ziel) && info(r).einheit == Einheit::schalter)
                    schalter_halb += !(b.wert() == 0.0f || b.wert() == 1.0f);
            }
        }
    std::printf("fuzz: %ld values, %ld outside the range or non-finite, %ld switch values not 0/1 after setze_sofort\n",
                faelle, raus, schalter_halb);
    PRUEF(raus == 0);
    PRUEF(schalter_halb == 0);
}

void pruefe_dauer_und_spruenge() {
    bool dauer_ok = true, mono_ok = true;
    double schalter_schritt = 0.0;
    const double schalter_grenze = 1.5 / static_cast<double>(std::llround(5.0 * 1e-3 * 44100.0));  // kill 5 ms, 44.1 kHz
    double db_ueber = 0.0, glatt_ueber = 0.0, stumm_schritt = 0.0;
    Zufall z(241);
    for (double fs : haertung::kRaten)
        for (int ri = 0; ri < kAnzahlRegler; ++ri) {
            const Regler r = static_cast<Regler>(ri);
            const ReglerInfo& inf = info(r);
            const std::int64_t n = std::llround(inf.schaltrampe_ms * 1e-3 * fs);
            for (int e = 0; e < 40; ++e) {
                Bahn b(r, fs);
                float von, nach;
                if (inf.einheit == Einheit::schalter) { von = static_cast<float>(e & 1); nach = 1.0f - von; }
                else if (e < 4) { von = (e & 1) ? inf.min : inf.max; nach = (e & 2) ? inf.min : inf.max; }
                else { von = static_cast<float>(z.zwischen(inf.min, inf.max)); nach = static_cast<float>(z.zwischen(inf.min, inf.max)); }
                b.setze_sofort(von);
                const double v0 = b.wert();
                b.setze(nach);
                const double ziel = b.ziel();
                const int laenge = inf.form == Schaltform::glaettung ? static_cast<int>(40 * fs) : static_cast<int>(n) + 1;
                const std::vector<double> v = werte(b, laenge, 1);
                if (inf.form != Schaltform::glaettung) dauer_ok = dauer_ok && !b.faehrt() && b.wert() == static_cast<float>(ziel);
                double alt = v0;
                for (double w : v) {
                    const double schritt = std::fabs(w - alt);
                    mono_ok = mono_ok && (ziel >= v0 ? w >= alt - 1e-12 : w <= alt + 1e-12);
                    if (inf.einheit == Einheit::schalter) {
                        schalter_schritt = std::fmax(schalter_schritt, schritt);
                    } else if (inf.einheit == Einheit::db) {
                        if (w == kStummDb || alt == kStummDb) stumm_schritt = std::fmax(stumm_schritt, std::fabs(db_zu_linear(w) - db_zu_linear(alt)));
                        else {
                            const double a = ist_stumm(v0) ? std::min<double>(kRampenAnkerDb, ziel) : v0;
                            const double c = ist_stumm(ziel) ? std::min<double>(kRampenAnkerDb, v0) : ziel;
                            db_ueber = std::fmax(db_ueber, schritt - (1.5 * std::fabs(c - a) / static_cast<double>(n) + 1e-9));
                        }
                    } else {
                        const double p = std::exp(-1.0 / (inf.schaltrampe_ms * 1e-3 * fs));
                        glatt_ueber = std::fmax(glatt_ueber, schritt - ((1.0 - p) * std::fabs(ziel - v0) + 1e-12));
                    }
                    alt = w;
                }
                if (inf.form == Schaltform::glaettung) dauer_ok = dauer_ok && !b.faehrt() && b.wert() == static_cast<float>(ziel);
            }
        }
    std::printf("switch ramp: duration ok %d, monotone %d; kill step max %.4g (bound %.4g); dB step excess "
                "%.3g; stumm step %.4g linear; smoother excess %.3g\n",
                dauer_ok, mono_ok, schalter_schritt, schalter_grenze, db_ueber, stumm_schritt, glatt_ueber);
    PRUEF(dauer_ok);
    PRUEF(mono_ok);
    PRUEF_M(schalter_schritt <= schalter_grenze + 1e-12);
    PRUEF(db_ueber <= 0.0);
    // the last value before stumm lies within one ramp step (<= 0.19 dB at 44.1 kHz) above the -60 dB anchor
    PRUEF(stumm_schritt <= 0.0011);
    PRUEF(glatt_ueber <= 0.0);
}

// Event list in absolute samples; the driver splits blocks at events (Kanalzug contract).
struct Ereignis {
    int t, was;
    float ziel;
    std::int64_t dauer;
};

std::vector<double> mit_ereignissen(Regler r, double fs, const std::vector<Ereignis>& ev, int n, int block,
                                    const std::vector<float>& ext) {
    Bahn b(r, fs);
    std::vector<double> v(static_cast<std::size_t>(n)), puffer(kMaxFrames);
    std::size_t e = 0;
    for (int p = 0; p < n;) {
        int aussen = 0;  // length of an external stretch starting here
        while (e < ev.size() && ev[e].t == p) {
            const Ereignis& x = ev[e++];
            if (x.was == 0) b.setze(x.ziel);
            else if (x.was == 1) b.rampe(x.ziel, x.dauer, x.dauer % 2 ? Form::linear : Form::s_kurve);
            else { b.verlauf(&ext[static_cast<std::size_t>(p)]); aussen = static_cast<int>(x.dauer); }
        }
        int m = std::min(block, n - p);
        if (e < ev.size()) m = std::min(m, ev[e].t - p);
        // verlauf() covers exactly the next block() call: that call has the stretch's length for every block size
        // (the Stellwerk hands one trajectory per block; the events are spaced wider than any stretch)
        if (aussen > 0) m = std::min(aussen, n - p);
        if (!b.block(puffer.data(), m)) std::fill(puffer.begin(), puffer.begin() + m, static_cast<double>(b.wert()));
        std::copy(puffer.begin(), puffer.begin() + m, v.begin() + p);
        p += m;
    }
    return v;
}

void pruefe_bloecke() {
    Zufall z(251);
    double abw = 0.0;
    const int n = 48000;
    for (double fs : haertung::kRaten)
        for (int ri = 0; ri < kAnzahlRegler; ++ri) {
            const Regler r = static_cast<Regler>(ri);
            std::vector<Ereignis> ev;
            std::vector<float> ext(static_cast<std::size_t>(n));
            for (float& v : ext) v = zufalls_ziel(r, z);
            for (int t = 0; t < n; t += z.ganz(250, 3000)) {
                const int was = z.ganz(0, 2);
                ev.push_back({t, was, zufalls_ziel(r, z), was == 2 ? z.ganz(1, 200) : z.ganz(1, 4000)});
            }
            const std::vector<double> ref = mit_ereignissen(r, fs, ev, n, 1, ext);
            for (int b : {7, 64, kMaxFrames}) {
                const std::vector<double> v = mit_ereignissen(r, fs, ev, n, b, ext);
                for (int i = 0; i < n; ++i) abw = std::fmax(abw, std::fabs(v[static_cast<std::size_t>(i)] - ref[static_cast<std::size_t>(i)]));
            }
        }
    std::printf("block sizes 1/7/64/%d with setze/rampe/verlauf events: max deviation %.3g\n", kMaxFrames, abw);
    PRUEF(abw == 0.0);
}

void pruefe_verlauf_und_reset() {
    const float nan = std::numeric_limits<float>::quiet_NaN();
    Bahn f(Regler::fader);
    f.setze_sofort(-6.0f);
    const float ext[6] = {nan, -3.0f, 5.0f, -130.0f, nan, -250.0f};
    PRUEF(!f.verlauf(nullptr));
    PRUEF(f.verlauf(ext));
    double v[6];
    PRUEF(f.block(v, 6));
    PRUEF(v[0] == -6.0 && v[1] == -3.0 && v[2] == 0.0 && v[3] == kStummDb && v[4] == kStummDb && v[5] == kStummDb);
    PRUEF(!f.faehrt() && f.wert() == kStummDb);
    PRUEF(!f.block(v, 6));
    Bahn k(Regler::kill_mitte);
    const float ext_k[3] = {0.25f, 2.0f, -1.0f};
    k.verlauf(ext_k);
    k.block(v, 3);
    PRUEF(v[0] == 0.25 && v[1] == 1.0 && v[2] == 0.0);

    for (int ri = 0; ri < kAnzahlRegler; ++ri) {
        Bahn b(static_cast<Regler>(ri));
        const float vorgabe = b.wert();
        b.setze(nan);
        b.setze_sofort(nan);
        PRUEF(!b.rampe(nan, 100, Form::linear));
        PRUEF(!b.faehrt() && b.wert() == vorgabe);
        b.setze(info(static_cast<Regler>(ri)).max == vorgabe ? info(static_cast<Regler>(ri)).min : info(static_cast<Regler>(ri)).max);
        werte(b, 7, 7);
        PRUEF(b.faehrt());
        b.setze_sofort(vorgabe);
        PRUEF(!b.faehrt() && b.wert() == vorgabe);
        PRUEF(!b.block(v, 6));
    }
    Bahn s(Regler::kill_tief);
    PRUEF(!s.rampe(1.0f, 100, Form::linear));
    Bahn t(Regler::trim);
    PRUEF(!t.rampe(1.0f, 0, Form::linear) && !t.rampe(1.0f, -5, Form::linear));
    PRUEF(t.rampe(100.0f, std::numeric_limits<std::int64_t>::max(), Form::s_kurve) && t.ziel() == kTrimMaxDb);
    werte(t, 1000, 64);
    PRUEF(std::isfinite(t.wert()) && t.wert() >= 0.0f && t.wert() < 1e-6f);
}

void pruefe_denormal() {
    long sub = 0;
    bool eingerastet = true;
    for (double fs : haertung::kRaten) {
        Bahn b(Regler::filter, fs);
        b.setze_sofort(1.0f);
        b.setze(0.0f);
        const std::vector<double> v = werte(b, static_cast<int>(60 * fs), kMaxFrames);
        for (double w : v) sub += std::fpclassify(w) == FP_SUBNORMAL;
        eingerastet = eingerastet && !b.faehrt() && b.wert() == 0.0f;
    }
    std::printf("smoother 1 -> 0: subnormal values %ld, settled exactly %d\n", sub, eingerastet);
    PRUEF(sub == 0);
    PRUEF(eingerastet);
}

}  // namespace

int main(int argc, char** argv) {
    haertung::starte(argc, argv);
    if (haertung::normal_lauf()) {
        pruefe_fuzz();
        pruefe_dauer_und_spruenge();
        pruefe_bloecke();
        pruefe_verlauf_und_reset();
        pruefe_denormal();
    }
    return haertung::ende();
}
