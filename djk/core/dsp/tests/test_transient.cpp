// Transient shaper against analytic expectations.
// Call: test_transient
#include <cypherdj/dsp/transient.h>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <limits>
#include <memory>
#include <vector>

#include "check.h"

using namespace cypherdj::dsp;

namespace {

constexpr double kFs = 48000.0;
constexpr double kPi = 3.14159265358979323846;

std::vector<float> runde(Transient& t, const std::vector<float>& in, int block) {
    std::vector<float> out(in.size());
    for (std::size_t p = 0; p < in.size();) {
        const int n = static_cast<int>(std::min<std::size_t>(static_cast<std::size_t>(block), in.size() - p));
        t.verarbeite(&in[p], &in[p], &out[p], &out[p], n);
        p += static_cast<std::size_t>(n);
    }
    return out;
}

// 100 Hz sine under an exponential decay (time constant 50 ms), 400 ms long, after 50 ms of silence.
std::vector<float> burst() {
    const std::size_t vor = static_cast<std::size_t>(0.05 * kFs), n = static_cast<std::size_t>(0.45 * kFs);
    std::vector<float> x(n, 0.0f);
    for (std::size_t i = vor; i < n; ++i) {
        const double t = static_cast<double>(i - vor) / kFs;
        x[i] = static_cast<float>(0.5 * std::exp(-t / 0.05) * std::sin(2.0 * kPi * 100.0 * t));
    }
    return x;
}

double spitze(const std::vector<float>& x, double von_ms, double bis_ms, double t0_ms = 50.0) {
    const std::size_t a = static_cast<std::size_t>((t0_ms + von_ms) * 1e-3 * kFs);
    const std::size_t b = static_cast<std::size_t>((t0_ms + bis_ms) * 1e-3 * kFs);
    double m = 0.0;
    for (std::size_t i = a; i < b && i < x.size(); ++i) m = std::max(m, static_cast<double>(std::fabs(x[i])));
    return m;
}
double db(double v) { return 20.0 * std::log10(v); }

}  // namespace

int main() {
    auto t = std::make_unique<Transient>(kFs);
    const std::vector<float> x = burst();

    // 1. all knobs 0: bit-identical (mix 1, gain 0), with the burst and with a 512 block
    {
        auto o = runde(*t, x, 512);
        bool gleich = true;
        for (std::size_t i = 0; i < x.size(); ++i) gleich = gleich && o[i] == x[i];
        PRUEF(gleich);
        PRUEF(t->groesste_aenderung_db() == 0.0f);
    }

    // 2. attack +12: first 5 ms (peak) more than 6 dB above the input, tail within 1 dB
    {
        t->leeren();
        TransientParameter p;
        p.angriff_db = 12.0f;
        t->setze(p);
        auto o = runde(*t, x, 64);
        const double kopf = db(spitze(o, 0.0, 5.0)) - db(spitze(x, 0.0, 5.0));
        const double schwanz = db(spitze(o, 100.0, 120.0)) - db(spitze(x, 100.0, 120.0));
        std::printf("angriff +12: first 5 ms %+.2f dB, tail %+.2f dB\n", kopf, schwanz);
        PRUEF(kopf > 6.0);
        PRUEF(std::fabs(schwanz) < 1.0);
        PRUEF(t->groesste_aenderung_db() > 6.0f);
        PRUEF(t->groesste_aenderung_db() == 0.0f);   // read and reset
    }

    // 3. sustain -12: tail after 60 ms more than 6 dB lower
    {
        t->leeren();
        TransientParameter p;
        p.halten_db = -12.0f;
        t->setze(p);
        auto o = runde(*t, x, 64);
        for (double a : {60.0, 80.0, 100.0, 140.0})
            std::printf("halten -12: %3.0f-%3.0f ms %+.2f dB\n", a, a + 20, db(spitze(o, a, a + 20)) - db(spitze(x, a, a + 20)));
        const double schwanz = db(spitze(o, 100.0, 120.0)) - db(spitze(x, 100.0, 120.0));
        PRUEF(schwanz < -6.0);
    }

    // 4. no step bigger than 0.05 on a parameter jump (steady 100 Hz sine at 0.3, jump of the knobs mid-run)
    {
        t->leeren();
        TransientParameter p;
        t->setze(p);
        std::vector<float> s(static_cast<std::size_t>(0.4 * kFs));
        for (std::size_t i = 0; i < s.size(); ++i) s[i] = static_cast<float>(0.3 * std::sin(2.0 * kPi * 100.0 * static_cast<double>(i) / kFs));
        std::vector<float> o(s.size());
        const std::size_t halb = s.size() / 2;
        t->verarbeite(s.data(), s.data(), o.data(), o.data(), 512);
        std::size_t pos = 512;
        while (pos < s.size()) {
            if (pos >= halb && t->parameter().angriff_db == 0.0f) {
                p.angriff_db = 24.0f; p.halten_db = -24.0f; p.ausgang_db = 6.0f; p.mix = 0.5f;
                t->setze(p);
            }
            const int n = static_cast<int>(std::min<std::size_t>(100, s.size() - pos));
            t->verarbeite(&s[pos], &s[pos], &o[pos], &o[pos], n);
            pos += static_cast<std::size_t>(n);
        }
        // reference: the same signal through the shaper with the final parameters from the start has the same smooth shape;
        // here we only bound the sample-to-sample step against the input's own step plus the gain change per sample.
        double schritt = 0.0;
        for (std::size_t i = 1; i < o.size(); ++i) {
            const double eigen = std::fabs(static_cast<double>(s[i]) - s[i - 1]);
            schritt = std::max(schritt, std::fabs(static_cast<double>(o[i]) - o[i - 1]) - 2.0 * eigen);
        }
        std::printf("largest excess step after a parameter jump: %.5f\n", schritt);
        PRUEF(schritt < 0.05);
    }

    // 5. silence stays 0 (also with extreme settings), NaN and Inf in -> 0 out, state recovers
    {
        t->leeren();
        TransientParameter p;
        p.angriff_db = 24.0f; p.halten_db = 24.0f; p.ausgang_db = 24.0f;
        t->setze(p);
        std::vector<float> z(4800, 0.0f);
        auto o = runde(*t, z, 256);
        bool null = true;
        for (float v : o) null = null && v == 0.0f;
        PRUEF(null);
        std::vector<float> bad(64, 0.25f);
        bad[3] = std::numeric_limits<float>::quiet_NaN();
        bad[10] = std::numeric_limits<float>::infinity();
        bad[20] = -std::numeric_limits<float>::infinity();
        auto ob = runde(*t, bad, 64);
        bool endlich = std::isfinite(ob[3]) && std::isfinite(ob[10]) && std::isfinite(ob[20]) &&
                       ob[3] == 0.0f && ob[10] == 0.0f && ob[20] == 0.0f;
        PRUEF(endlich);
    }

    // 6. parameters clamp, NaN keeps the old value; mix 0 with output 0 dB is the dry signal
    {
        TransientParameter p;
        p.angriff_db = 99.0f;
        p.tempo_ms = std::numeric_limits<float>::quiet_NaN();
        t->setze(p);
        PRUEF(t->parameter().angriff_db == 24.0f);
        PRUEF(t->parameter().tempo_ms == 15.0f);
        p = TransientParameter{};
        p.angriff_db = 12.0f; p.halten_db = -12.0f; p.mix = 0.0f;
        t->setze(p);
        t->leeren();   // leeren() takes mix and output level to their set values at once
        auto o = runde(*t, x, 128);
        bool gleich = true;
        for (std::size_t i = 0; i < x.size(); ++i) gleich = gleich && o[i] == x[i];
        PRUEF(gleich);
    }

    return pruef::ende();
}
