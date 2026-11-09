// Hardening: channel_strip.h / channel_strip.cpp (whole channel strip). Fixed seed, 44.1 / 48 / 96 kHz.
//   1. Fuzz: random events (setze, rampe, verlauf, setze_sofort on every controller with targets in range, at the
//      limits, beyond, +-inf, NaN), random block sizes 1..kMaxFrames, Color FX art / PARAMETER / filter Q changes,
//      full-scale input, all four sends connected: main, sends, tap and bands finite and bounded.
//   2. Segmentation independence (header contract "split calls are bit-identical"): the same event list processed
//      with blocks of 1, 7, 64, kMaxFrames (split at the events) gives bit-identical main, send and tap output;
//      for the DJ filter and for every Color FX art with the knob held out of the dead zone.
//   3. Switch ramps scale with the rate: after llround(ms * fs / 1000) + 1 samples every ramp has ended.
//   4. Denormals: under the strip's own DenormalSchutz, 30 s silence after loud input with EQ boost, filter, Color
//      FX and sends give no subnormal sample in main, sends, tap or bands.
//   5. Clicks: 780 Hz at -6 dBFS, one setze() at 1 s; HF peak (> 5 kHz, metric of tests/knack.py) in +-50 ms:
//      kill on/off below the 16-bit step (-96.33 dBFS); EQ, trim, filter, fader, send over their full range (also to
//      stumm) below -60 dBFS; jumps without ramp (positive control) at least 10 dB above that (see pruefe_knack).
//   6. Reset: zustaende_leeren() clears a NaN-poisoned state and gives the output of a fresh strip with the same
//      controller values; zuruecksetzen() sets every controller to its default at once.
//   Former bug B1 (fixed, now a normal ctest entry, see REPORT-hardening.md and REPORT-fixes.md): befund_kanalzug_color_bloecke - with a Color FX art
//   and the knob crossing the centre, split calls are not bit-identical.
//
// Mutation checks (automatic): against the existing libraries cypherdj_dsp_mut_ohne_ftz (no flush-to-zero: the
// denormal check 4 is PRUEF_M and fails) and cypherdj_dsp_mut_kill_hart (kill without ramp: the click check 5 is
// PRUEF_M and fails). Both verified 2026-11-02: without FTZ 418 794 subnormal samples (full run) instead of 0; hard
// kill -32.7 dBFS click instead of -97.2 dBFS.
#include <cypherdj/dsp/channel_strip.h>

#include <algorithm>
#include <cstdio>
#include <limits>
#include <memory>
#include <string>
#include <vector>

#include "hardening.h"

using namespace cypherdj::dsp;
using haertung::Zufall;

namespace {

struct Ereignis {
    int t;
    int was;      // 0 setze, 1 rampe, 2 verlauf (one block of `dauer` samples), 3 setze_sofort, 4 color, 5 guete
    Regler r;
    float ziel;
    std::int64_t dauer;
    int art;
};

struct Ausgabe {
    std::vector<float> l, r, send[kAnzahlSends], abgriff;
    long subnormal = 0;
    bool endlich = true;
    double spitze = 0.0;
};

float zufalls_ziel(Regler r, Zufall& z, bool wild) {
    const ReglerInfo& ri = info(r);
    const double w = z.gleich();
    if (wild && w < 0.03) return std::numeric_limits<float>::quiet_NaN();
    if (wild && w < 0.06) return (z.gleich() < 0.5 ? -1.0f : 1.0f) * std::numeric_limits<float>::infinity();
    if (w < 0.15) return ri.min;
    if (w < 0.25) return ri.max;
    if (wild && w < 0.30) return static_cast<float>(z.zwischen(ri.min - 50.0, ri.max + 50.0));
    return static_cast<float>(z.zwischen(ri.min, ri.max));
}

// Event list over n samples. color_art < 0: random arts; filter_seite != 0: the filter knob is only set to values
// of that side with |k| >= 0.2 (held out of the dead zone).
std::vector<Ereignis> ereignisse(int n, Zufall& z, bool wild, int color_art, double filter_seite) {
    std::vector<Ereignis> ev;
    for (int t = 0; t < n; t += z.ganz(100, 2500)) {
        Ereignis e{t, z.ganz(0, 3), static_cast<Regler>(z.ganz(0, kAnzahlRegler - 1)), 0.0f, z.ganz(1, 6000), 0};
        e.ziel = zufalls_ziel(e.r, z, wild);
        if (e.was == 2) e.dauer = z.ganz(1, 90);
        if (e.r == Regler::filter && filter_seite != 0.0) {
            e.ziel = static_cast<float>(filter_seite * z.zwischen(0.2, 1.0));
            if (e.was == 2) e.was = 0;  // keep the knob of a verlauf on the side as well: use setze instead
        }
        if (e.r == Regler::fader && z.gleich() < 0.7) e.ziel = static_cast<float>(z.zwischen(-20.0, 0.0));  // mostly audible
        if (color_art < 0 && z.gleich() < 0.05) { e.was = 4; e.art = z.ganz(-1, 6); }
        if (wild && z.gleich() < 0.02) { e.was = 5; e.ziel = static_cast<float>(z.zwischen(0.0, 6.0)); }
        ev.push_back(e);
    }
    return ev;
}

Ausgabe lauf(double fs, const std::vector<Ereignis>& ev, const std::vector<float>& x, int block, int color_art,
             bool zaehle_subnormal = false) {
    const int n = static_cast<int>(x.size());
    auto kz = std::make_unique<Kanalzug>(fs);
    kz->setze_sofort(Regler::fader, 0.0f);
    kz->setze_sofort(Regler::send_1, -6.0f);
    kz->setze_sofort(Regler::send_3, 0.0f);
    if (color_art > 0) kz->setze_color(color_art, 0.6f, fs / 2);
    Ausgabe a;
    a.l.resize(x.size());
    a.r.resize(x.size());
    a.abgriff.resize(x.size());
    for (auto& s : a.send) s.assign(x.size(), 0.0f);
    std::vector<float> rr(x.size());
    for (std::size_t i = 0; i < x.size(); ++i) rr[i] = -0.5f * x[i];
    std::vector<float> ext(kMaxFrames);
    std::size_t e = 0;
    for (int p = 0; p < n;) {
        int aussen = 0;
        while (e < ev.size() && ev[e].t == p) {
            const Ereignis& v = ev[e++];
            switch (v.was) {
                case 0: kz->setze(v.r, v.ziel); break;
                case 1: kz->rampe(v.r, v.ziel, v.dauer, v.dauer % 2 ? Form::linear : Form::s_kurve); break;
                case 2:
                    for (int i = 0; i < kMaxFrames; ++i) ext[static_cast<std::size_t>(i)] = v.ziel * (1.0f - i / 2048.0f);
                    kz->verlauf(v.r, ext.data());
                    aussen = static_cast<int>(v.dauer);
                    break;
                case 3: kz->setze_sofort(v.r, v.ziel); break;
                case 4: kz->setze_color(v.art, v.ziel, v.dauer); break;
                case 5: kz->setze_filter_guete(v.ziel); break;
            }
        }
        int m = std::min(block, n - p);
        if (e < ev.size()) m = std::min(m, ev[e].t - p);
        if (aussen > 0) m = std::min(aussen, n - p);  // a verlauf covers exactly one call, of the same length
        KanalzugAusgang aus;
        aus.haupt_l = &a.l[static_cast<std::size_t>(p)];
        aus.haupt_r = &a.r[static_cast<std::size_t>(p)];
        for (int s = 0; s < kAnzahlSends; ++s) {
            aus.send_l[s] = &a.send[s][static_cast<std::size_t>(p)];
            aus.send_r[s] = &a.send[s][static_cast<std::size_t>(p)];  // L and R summed into one bus
        }
        kz->verarbeite(&x[static_cast<std::size_t>(p)], &rr[static_cast<std::size_t>(p)], m, aus);
        std::copy(kz->abgriff(0), kz->abgriff(0) + m, &a.abgriff[static_cast<std::size_t>(p)]);
        const float* felder[] = {kz->abgriff(0), kz->abgriff(1), kz->band(Band::tief, 0), kz->band(Band::mitte, 1),
                                 kz->band(Band::hoch, 0), aus.haupt_l, aus.haupt_r, aus.send_l[0], aus.send_l[2]};
        for (const float* f : felder) {
            a.endlich = a.endlich && haertung::endlich(f, static_cast<std::size_t>(m));
            if (zaehle_subnormal) a.subnormal += haertung::subnormale(f, static_cast<std::size_t>(m));
        }
        p += m;
        // mutation run (no flush-to-zero): one subnormal is the finding; without FTZ the rest runs ~100x slower
        if (zaehle_subnormal && a.subnormal > 0 && haertung::mutationsmodus()) break;
    }
    a.spitze = std::fmax(haertung::spitze(a.l), haertung::spitze(a.r));
    for (auto& s : a.send) a.spitze = std::fmax(a.spitze, haertung::spitze(s));
    return a;
}

double abweichung(const Ausgabe& a, const Ausgabe& b) {
    double m = std::fmax(haertung::groesste_abweichung(a.l, b.l), haertung::groesste_abweichung(a.r, b.r));
    m = std::fmax(m, haertung::groesste_abweichung(a.abgriff, b.abgriff));
    for (int s = 0; s < kAnzahlSends; ++s) m = std::fmax(m, haertung::groesste_abweichung(a.send[s], b.send[s]));
    return m;
}

void pruefe_fuzz() {
    Zufall z(301);
    bool ok = true;
    double spitze = 0.0;
    for (double fs : haertung::kRaten)
        for (int lauf_nr = 0; lauf_nr < 6; ++lauf_nr) {
            const int n = static_cast<int>(fs);
            const std::vector<float> x = haertung::rauschen(n, 1.0, 302 + static_cast<std::uint64_t>(lauf_nr));
            const std::vector<Ereignis> ev = ereignisse(n, z, true, -1, 0.0);
            const Ausgabe a = lauf(fs, ev, x, z.ganz(1, kMaxFrames), -1);
            ok = ok && a.endlich;
            spitze = std::fmax(spitze, a.spitze);
        }
    std::printf("fuzz: all outputs finite %d, peak %.4g (input 1.0, trim/EQ up to +30 dB, Q up to 4)\n", ok, spitze);
    PRUEF(ok);
    PRUEF(spitze < 1e3);
}

void pruefe_bloecke() {
    Zufall z(311);
    double abw_filter = 0.0, abw_color = 0.0;
    for (double fs : haertung::kRaten) {
        const int n = static_cast<int>(fs / 2);
        const std::vector<float> x = haertung::rauschen(n, 0.8, 312);
        {
            const std::vector<Ereignis> ev = ereignisse(n, z, false, 0, 0.0);
            const Ausgabe ref = lauf(fs, ev, x, 1, 0);
            for (int b : {7, 64, kMaxFrames}) abw_filter = std::fmax(abw_filter, abweichung(ref, lauf(fs, ev, x, b, 0)));
        }
        for (int art = 1; art <= kColorArtMax; ++art)
            for (double seite : {-1.0, 1.0}) {
                std::vector<Ereignis> ev = ereignisse(n, z, false, art, seite);
                ev.insert(ev.begin(), Ereignis{0, 3, Regler::filter, static_cast<float>(0.5 * seite), 0, 0});
                const Ausgabe ref = lauf(fs, ev, x, 1, art);
                for (int b : {7, 64, kMaxFrames}) abw_color = std::fmax(abw_color, abweichung(ref, lauf(fs, ev, x, b, art)));
            }
    }
    std::printf("block sizes 1/7/64/%d with events: DJ filter %.3g, Color FX (knob held off-centre) %.3g\n", kMaxFrames,
                abw_filter, abw_color);
    PRUEF(abw_filter == 0.0);
    PRUEF(abw_color == 0.0);
}

void befund_color_bloecke() {
    Zufall z(321);
    for (int art = 1; art <= kColorArtMax; ++art) {
        const double fs = 48000.0;
        const int n = static_cast<int>(fs);
        const std::vector<float> x = haertung::rauschen(n, 0.5, 322);
        // the knob moves through the centre: setze to the other side every 0.1 s (smoother, 20 ms)
        std::vector<Ereignis> ev;
        for (int t = 0, s = 1; t < n; t += 4800, s = -s) ev.push_back({t, 0, Regler::filter, 0.6f * static_cast<float>(s), 0, 0});
        const Ausgabe ref = lauf(fs, ev, x, 1, art);
        double m = 0.0;
        for (int b : {7, 64, kMaxFrames}) m = std::fmax(m, abweichung(ref, lauf(fs, ev, x, b, art)));
        std::printf("  Color FX art %d, knob crossing the centre: split calls deviate by %.3g (%.1f dBFS)\n", art, m, haertung::db(m));
        PRUEF(m == 0.0);
    }
}

void pruefe_rampendauer() {
    bool ok = true;
    for (double fs : haertung::kRaten)
        for (int ri = 0; ri < kAnzahlRegler; ++ri) {
            const Regler r = static_cast<Regler>(ri);
            const ReglerInfo& inf = info(r);
            if (inf.form == Schaltform::glaettung) continue;
            auto kz = std::make_unique<Kanalzug>(fs);
            kz->setze_sofort(r, inf.min);
            kz->setze(r, inf.max);
            const int n = static_cast<int>(std::llround(inf.schaltrampe_ms * 1e-3 * fs));
            std::vector<float> x(static_cast<std::size_t>(n + 1), 0.1f), l(x.size()), rr(x.size());
            KanalzugAusgang aus;
            aus.haupt_l = l.data();
            aus.haupt_r = rr.data();
            kz->verarbeite(x.data(), x.data(), n, aus);
            const bool vorher = kz->faehrt(r);
            kz->verarbeite(x.data(), x.data(), 1, aus);
            ok = ok && vorher && !kz->faehrt(r) && kz->wert(r) == inf.max;
        }
    std::printf("switch ramps end after llround(ms * fs) + 1 samples at 44.1/48/96 kHz: %d\n", ok);
    PRUEF(ok);
}

void pruefe_denormal() {
    long sub = 0;
    for (double fs : haertung::kRaten)
        for (int art = 0; art <= kColorArtMax; ++art)
            for (float filter : {-0.6f, 0.6f}) {
                std::vector<Ereignis> ev{{0, 3, Regler::eq_tief, 6.0f, 0, 0}, {0, 3, Regler::eq_hoch, 6.0f, 0, 0},
                                         {0, 3, Regler::filter, filter, 0, 0}, {0, 3, Regler::trim, 12.0f, 0, 0}};
                const int laut = static_cast<int>(fs / 2), n = static_cast<int>(30.5 * fs);
                std::vector<float> x = haertung::rauschen(laut, 1.0, 331);
                x.resize(static_cast<std::size_t>(n), 0.0f);
                ev.push_back({laut, 0, Regler::filter, 0.0f, 0, 0});  // knob back to centre: tails must run out too
                if (sub == 0 || !haertung::mutationsmodus()) sub += lauf(fs, ev, x, kMaxFrames, art, true).subnormal;
            }
    std::printf("denormal: subnormal samples over 30 s silence (3 rates x 6 arts x 2 sides): %ld\n", sub);
#if defined(__x86_64__) || defined(__i386__)
    PRUEF_M(sub == 0);
#endif
}

struct Knack {
    const char* name;
    Regler r;
    float von, nach;
    bool hart;  // positive control: setze_sofort (jump without ramp) instead of setze
};

// Thresholds (stated here, see the file head):
//   kill switches: the 16-bit step -96.33 dBFS, as decided for the kill ramp (F1, berichte/04-kanalzug-dsp.md B3);
//   every other controller over its full range, including fades to stumm: -60 dBFS. A 10 ms S-ramp over 48 dB or the
//   20 ms smoother of the filter cannot stay below the 16-bit step at this stimulus (measured 2026-11-02: worst
//   -69.3 dBFS for filter -1 -> +1, -73.1 for fades to stumm = known B7 of 04); a jump without ramp lands far above
//   -60 dBFS (positive controls below), so the bound still catches a missing or broken ramp.
constexpr double kKnackGrenzeRegler = -60.0;

void pruefe_knack() {
    const Knack faelle[] = {
        {"kill/mitte on", Regler::kill_mitte, 0.0f, 1.0f, false},
        {"kill/mitte off", Regler::kill_mitte, 1.0f, 0.0f, false},
        {"kill/tief on", Regler::kill_tief, 0.0f, 1.0f, false},
        {"kill/hoch on", Regler::kill_hoch, 0.0f, 1.0f, false},
        {"eq/mitte 0 -> -26", Regler::eq_mitte, 0.0f, -26.0f, false},
        {"eq/mitte -26 -> +6", Regler::eq_mitte, -26.0f, 6.0f, false},
        {"trim 0 -> +12", Regler::trim, 0.0f, 12.0f, false},
        {"trim +24 -> -24", Regler::trim, 24.0f, -24.0f, false},
        {"filter 0 -> -0.5", Regler::filter, 0.0f, -0.5f, false},
        {"filter 0 -> +0.5", Regler::filter, 0.0f, 0.5f, false},
        {"filter -1 -> +1", Regler::filter, -1.0f, 1.0f, false},
        {"fader 0 -> -40", Regler::fader, 0.0f, -40.0f, false},
        {"send/1 -200 -> 0 (send)", Regler::send_1, kStummDb, 0.0f, false},
        {"fader 0 -> stumm", Regler::fader, 0.0f, kStummDb, false},
        {"eq/mitte 0 -> stumm", Regler::eq_mitte, 0.0f, kStummDb, false},
        {"control: fader 0 -> -6 hard", Regler::fader, 0.0f, -6.0f, true},
        {"control: filter 0 -> 0.2 hard", Regler::filter, 0.0f, 0.2f, true},
    };
    double schlimmste = -400.0, schlimmste_kill = -400.0, kontrolle = 400.0;
    for (const Knack& k : faelle) {
        double spitze = -400.0;
        for (double fs : haertung::kRaten) {
            const int n = static_cast<int>(2 * fs), t = static_cast<int>(fs);
            const std::vector<float> x = haertung::sinus(haertung::kKnackReizHz, haertung::kKnackReizAmp, n, fs);
            const std::vector<Ereignis> ev{{0, 3, k.r, k.von, 0, 0}, {t, k.hart ? 3 : 0, k.r, k.nach, 0, 0}};
            const Ausgabe a = lauf(fs, ev, x, 256, 0);
            const std::vector<float>& sig = k.r == Regler::send_1 ? a.send[0] : a.l;
            const std::size_t w = static_cast<std::size_t>(0.05 * fs);
            spitze = std::fmax(spitze, haertung::knack_spitze_dbfs(sig, fs, static_cast<std::size_t>(t) - w, static_cast<std::size_t>(t) + w));
        }
        std::printf("  click %-30s %7.1f dBFS\n", k.name, spitze);
        const bool kill = k.r == Regler::kill_mitte || k.r == Regler::kill_tief || k.r == Regler::kill_hoch;
        if (k.hart) kontrolle = std::fmin(kontrolle, spitze);
        else if (kill) schlimmste_kill = std::fmax(schlimmste_kill, spitze);
        else schlimmste = std::fmax(schlimmste, spitze);
    }
    std::printf("clicks: worst kill %.1f dBFS (threshold %.2f), worst other %.1f dBFS (threshold %.1f), "
                "jumps without ramp >= %.1f dBFS\n", schlimmste_kill, haertung::kKnackSchwelleDbfs, schlimmste,
                kKnackGrenzeRegler, kontrolle);
    PRUEF_M(schlimmste_kill < haertung::kKnackSchwelleDbfs);
    PRUEF(schlimmste < kKnackGrenzeRegler);
    PRUEF(kontrolle > kKnackGrenzeRegler + 10.0);
}

void pruefe_reset() {
    const double fs = 48000.0;
    const std::vector<float> x = haertung::rauschen(20000, 0.5, 341);
    std::vector<float> l(kMaxFrames), r(kMaxFrames);
    KanalzugAusgang aus;
    aus.haupt_l = l.data();
    aus.haupt_r = r.data();
    auto vergiftet = std::make_unique<Kanalzug>(fs), frisch = std::make_unique<Kanalzug>(fs);
    for (Kanalzug* k : {vergiftet.get(), frisch.get()}) {
        k->setze_sofort(Regler::fader, -3.0f);
        k->setze_sofort(Regler::filter, -0.4f);
        k->setze_sofort(Regler::eq_hoch, 4.0f);
    }
    std::vector<float> nan(kMaxFrames, std::numeric_limits<float>::quiet_NaN());
    vergiftet->verarbeite(nan.data(), nan.data(), 64, aus);
    const bool vergiftet_nan = std::isnan(l[0]);
    vergiftet->verarbeite(x.data(), x.data(), 512, aus);
    const bool bleibt_nan = std::isnan(l[511]);
    vergiftet->zustaende_leeren();
    double abw = 0.0;
    for (std::size_t p = 0; p < x.size(); p += 500) {
        std::vector<float> l2(500), r2(500);
        KanalzugAusgang a2;
        a2.haupt_l = l2.data();
        a2.haupt_r = r2.data();
        vergiftet->verarbeite(&x[p], &x[p], 500, aus);
        frisch->verarbeite(&x[p], &x[p], 500, a2);
        for (int i = 0; i < 500; ++i) abw = std::fmax(abw, std::isfinite(l[static_cast<std::size_t>(i)]) ? std::fabs(l[static_cast<std::size_t>(i)] - l2[static_cast<std::size_t>(i)]) : INFINITY);
    }
    std::printf("reset: NaN input poisons %d (stays %d), after zustaende_leeren deviation from fresh %.3g\n", vergiftet_nan,
                bleibt_nan, abw);
    PRUEF(vergiftet_nan && bleibt_nan);
    PRUEF(abw == 0.0);
    vergiftet->setze(Regler::fader, -30.0f);
    vergiftet->setze(Regler::kill_tief, 1.0f);
    vergiftet->zuruecksetzen();
    bool vorgaben = true;
    for (int i = 0; i < kAnzahlRegler; ++i) {
        const Regler rg = static_cast<Regler>(i);
        vorgaben = vorgaben && !vergiftet->faehrt(rg) && vergiftet->wert(rg) == info(rg).vorgabe;
    }
    PRUEF(vorgaben);
    PRUEF(vergiftet->kanalpegel_db() == kStummDb);  // fader default stumm
}

}  // namespace

int main(int argc, char** argv) {
    haertung::starte(argc, argv);
    if (haertung::normal_lauf()) {
        pruefe_fuzz();
        pruefe_bloecke();
        pruefe_rampendauer();
        pruefe_denormal();
        pruefe_knack();
        pruefe_reset();
    }
    if (haertung::befund_lauf("kanalzug_color_bloecke")) befund_color_bloecke();
    return haertung::ende();
}
