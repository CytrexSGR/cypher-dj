// Package 1.15 A4 (M5 fix): MultibandKompressor::uebernehme_dynamik takes over settings, detector states and gain ramps, not the filter states.
//  (U1) right after the takeover the reduction of every band equals the source's; a fresh object (negative control) shows none
//  (U2) the filters are NOT taken over: fed silence, the new object outputs exact zeros while the source still rings (positive control)
//  (U3) continuing on the same input, the new object stays within 1 dB of the source's reduction; the fresh one is far away
//  (U4) taking over from itself changes nothing
//  (U6) a half takeover leaves the object consistent: the next setze_band with the same values (the Mixer does it every block) neither is
//       swallowed nor leaves the detector with its old time constants
//  (U5) the two halves: detectors alone carry the reduction but not the settings; ramps alone carry the settings but not the reduction
#include <cypherdj/dsp/multiband.h>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <vector>

#include "measure.h"
#include "check.h"

using namespace cypherdj::dsp;

namespace {
void einstellen(MultibandKompressor& k) {
    MbBandEinstellung e;
    e.schwelle_db = -30.0f;
    e.verhaeltnis = 10.0f;
    e.anstieg_ms = 10.0f;
    e.abklingen_ms = 5000.0f;
    e.aufholen_db = 3.0f;
    k.setze_band(Band::mitte, e);
}
void laufen(MultibandKompressor& k, int bloecke, long& t, double amp, float* letzter = nullptr) {
    std::vector<float> x(256), y(256);
    for (int b = 0; b < bloecke; ++b) {
        for (int i = 0; i < 256; ++i) x[static_cast<std::size_t>(i)] = static_cast<float>(amp * std::sin(2.0 * 3.14159265358979 * 632.5 * static_cast<double>(t + i) / 48000.0));
        k.verarbeite(x.data(), x.data(), y.data(), y.data(), 256);
        t += 256;
        if (letzter) *letzter = y[255];
    }
}
}  // namespace

int main() {
    MultibandKompressor a, neu, frisch;
    einstellen(a);
    einstellen(frisch);   // same settings, but no dynamics history (negative control)
    long ta = 0;
    laufen(a, 200, ta, 0.5);   // 1 s: deep reduction
    const float ga = a.aktuelle_absenkung_db(Band::mitte);
    neu.uebernehme_dynamik(a);
    std::printf("U1: source reduction %.3f dB, after the takeover %.3f dB, fresh object %.3f dB\n", ga, neu.aktuelle_absenkung_db(Band::mitte), frisch.aktuelle_absenkung_db(Band::mitte));
    PRUEF(ga < -10.0f);
    PRUEF_NAH(neu.aktuelle_absenkung_db(Band::mitte), ga, 1e-6);
    PRUEF_NAH(frisch.aktuelle_absenkung_db(Band::mitte), 0.0, 1e-6);
    PRUEF_NAH(neu.band_einstellung(Band::mitte).aufholen_db, 3.0, 1e-6);
    // U2: silence in; the source still rings (its filters hold the sine), the new object has empty filters
    {
        MultibandKompressor a2 = a;   // keep a for U3
        std::vector<float> z(256, 0.0f), ya(256), yn(256);
        a2.verarbeite(z.data(), z.data(), ya.data(), ya.data(), 256);
        MultibandKompressor n2;
        n2.uebernehme_dynamik(a);
        n2.verarbeite(z.data(), z.data(), yn.data(), yn.data(), 256);
        float ma = 0.0f, mn = 0.0f;
        for (int i = 0; i < 256; ++i) {
            ma = std::max(ma, std::fabs(ya[static_cast<std::size_t>(i)]));
            mn = std::max(mn, std::fabs(yn[static_cast<std::size_t>(i)]));
        }
        std::printf("U2: silence in: source rings with %.5f, new object outputs %.5f\n", ma, mn);
        PRUEF(ma > 1e-4f);
        PRUEF(mn == 0.0f);
    }
    // U3: on, same input, one block: reduction continues instead of settling in
    {
        long tn = ta, tf = ta;
        MultibandKompressor a3 = a;
        float dummy = 0.0f;
        laufen(a3, 1, ta, 0.5, &dummy);
        laufen(neu, 1, tn, 0.5, &dummy);
        laufen(frisch, 1, tf, 0.5, &dummy);
        std::printf("U3: after 1 block (5 ms, half an attack time): source %.3f dB, takeover %.3f dB, fresh %.3f dB\n", a3.aktuelle_absenkung_db(Band::mitte),
                    neu.aktuelle_absenkung_db(Band::mitte), frisch.aktuelle_absenkung_db(Band::mitte));
        PRUEF(std::fabs(neu.aktuelle_absenkung_db(Band::mitte) - a3.aktuelle_absenkung_db(Band::mitte)) < 1.0);
        PRUEF(std::fabs(frisch.aktuelle_absenkung_db(Band::mitte) - a3.aktuelle_absenkung_db(Band::mitte)) > 3.0);
    }
    // U4
    {
        const float vor = a.aktuelle_absenkung_db(Band::mitte);
        a.uebernehme_dynamik(a);
        PRUEF_NAH(a.aktuelle_absenkung_db(Band::mitte), vor, 1e-9);
    }
    // U5
    {
        MultibandKompressor d, r;
        d.uebernehme_detektoren(a);
        r.uebernehme_rampen(a);
        std::printf("U5: detectors (with their settings) alone: reduction %.3f dB, makeup %.1f; ramps alone: reduction %.3f dB, makeup %.1f\n", d.aktuelle_absenkung_db(Band::mitte),
                    d.band_einstellung(Band::mitte).aufholen_db, r.aktuelle_absenkung_db(Band::mitte), r.band_einstellung(Band::mitte).aufholen_db);
        PRUEF_NAH(d.aktuelle_absenkung_db(Band::mitte), a.aktuelle_absenkung_db(Band::mitte), 1e-6);
        PRUEF_NAH(d.band_einstellung(Band::mitte).aufholen_db, 3.0, 1e-6);   // the settings travel with the detectors
        PRUEF_NAH(r.band_einstellung(Band::mitte).aufholen_db, 3.0, 1e-6);
        PRUEF_NAH(r.aktuelle_absenkung_db(Band::mitte), 0.0, 1e-6);
    }
    // U6: attack 400 ms, release 100 ms on the source. The takeover of the ramps/settings alone, then the same band settings again, must act like
    // setting them normally (reference): the detector has to follow the settings. With the early return of setze_band and a detector that kept
    // its default time constants, the reduction after 8 blocks of DC 0.5 was 0.00 dB where the reference gives -1.26 dB (review r1, dsp_trap).
    {
        MbBandEinstellung e;
        e.schwelle_db = -30.0f;
        e.verhaeltnis = 8.0f;
        e.anstieg_ms = 400.0f;
        e.abklingen_ms = 100.0f;
        MultibandKompressor o, x, ref, y;
        o.setze_band(Band::mitte, e);
        ref.setze_band(Band::mitte, e);
        x.uebernehme_rampen(o);       // settings and ramps copied, detector states not
        x.setze_band(Band::mitte, e);   // the repeat
        y.uebernehme_detektoren(o);   // the other half, then the repeat
        y.setze_band(Band::mitte, e);
        auto absenkung = [](MultibandKompressor& k) {
            std::vector<float> in(256, 0.5f), out(256);
            for (int b = 0; b < 8; ++b) k.verarbeite(in.data(), in.data(), out.data(), out.data(), 256);
            return k.aktuelle_absenkung_db(Band::mitte);
        };
        const double r = absenkung(ref), a = absenkung(x), c = absenkung(y);
        std::printf("U6: reduction after 8 blocks of DC 0.5: reference %.2f dB, ramps-only + repeat %.2f dB, detectors-only + repeat %.2f dB\n", r, a, c);
        PRUEF(r < -1.0);   // the reference does reduce
        PRUEF_NAH(a, r, 0.05);
        PRUEF_NAH(c, r, 0.05);
    }
    // U6b: the same for the LEVEL (the gain ramps), not only the reduction: no compression, +6 dB makeup in the middle band, a 0.1 sine at 1 kHz.
    // Each half takes over, then the same band settings again. With the early return of setze_band the ramps of a half that copied the settings
    // but not the ramps would never move: level -23.01 dB where the reference gives -17.03 dB (review r2, dsp_halb).
    {
        MbBandEinstellung e;
        e.schwelle_db = 0.0f;
        e.verhaeltnis = 1.0f;
        e.aufholen_db = 6.0f;
        MultibandKompressor o, ref, d, r, beide;
        o.setze_band(Band::mitte, e);
        ref.setze_band(Band::mitte, e);
        {
            std::vector<float> still(256, 0.0f), aus(256);
            for (int b = 0; b < 10; ++b) o.verarbeite(still.data(), still.data(), aus.data(), aus.data(), 256);   // o's ramps are done
        }
        d.uebernehme_detektoren(o);
        d.setze_band(Band::mitte, e);
        r.uebernehme_rampen(o);
        r.setze_band(Band::mitte, e);
        beide.uebernehme_dynamik(o);
        beide.setze_band(Band::mitte, e);
        auto pegel = [](MultibandKompressor& k) {
            std::vector<float> in(256), out(256);
            double sum = 0.0;
            long t = 0;
            for (int b = 0; b < 40; ++b) {
                for (int i = 0; i < 256; ++i) in[static_cast<std::size_t>(i)] = 0.1f * static_cast<float>(std::sin(2.0 * 3.14159265358979 * 1000.0 * static_cast<double>(t++) / 48000.0));
                k.verarbeite(in.data(), in.data(), out.data(), out.data(), 256);
                if (b >= 30) for (float x : out) sum += static_cast<double>(x) * static_cast<double>(x);
            }
            return 10.0 * std::log10(sum / (10.0 * 256.0) + 1e-30);
        };
        const double lr = pegel(ref), ld = pegel(d), lrr = pegel(r), lb = pegel(beide);
        std::printf("U6b: level (makeup +6 dB): reference %.2f dB, detectors-only + repeat %.2f dB, ramps-only + repeat %.2f dB, both + repeat %.2f dB\n", lr, ld, lrr, lb);
        PRUEF(lr > -20.0);   // the makeup is really in the reference (-23.01 dB would be 0 dB makeup)
        PRUEF_NAH(ld, lr, 0.05);
        PRUEF_NAH(lrr, lr, 0.05);
        PRUEF_NAH(lb, lr, 0.05);
    }
    return pruef::ende();
}
