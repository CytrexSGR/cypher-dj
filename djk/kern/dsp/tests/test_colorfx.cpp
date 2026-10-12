// SOUND COLOR FX (colorfx.h): Mitte bitgleich trocken, je Art die Richtung aus dem Pioneer-Handbuch (S. 15),
// Fahnen von SPACE und DUB ECHO klingen nach, Artwechsel leert.
#include <cypherdj/dsp/colorfx.h>

#include <cmath>
#include <cstdio>
#include <cstring>
#include <memory>
#include <vector>

#include "messen.h"
#include "pruef.h"

using namespace cypherdj::dsp;

namespace {
constexpr double kSpb = 24000.0;   // 120 BPM

struct Lauf {
    std::vector<float> l, r;
};
// x in beide Kanäle, k je Block über eine Funktion des Sample-Index
template <class KFn>
Lauf durch(ColorFx& fx, const std::vector<float>& x, KFn kfn, int block = 256) {
    Lauf y{x, x};
    std::vector<double> kk(kMaxFrames);
    for (std::size_t p = 0; p < x.size(); p += static_cast<std::size_t>(block)) {
        const int n = static_cast<int>(std::min<std::size_t>(static_cast<std::size_t>(block), x.size() - p));
        for (int i = 0; i < n; ++i) kk[static_cast<std::size_t>(i)] = kfn(p + static_cast<std::size_t>(i));
        fx.verarbeite(&y.l[p], &y.r[p], n, kk.data());
    }
    return y;
}
std::unique_ptr<ColorFx> neu(ColorArt a, float p = kColorParamVorgabe) {
    auto f = std::make_unique<ColorFx>();
    f->setze(static_cast<int>(a), p, kSpb);
    return f;
}
std::vector<float> rauschen(int n, double amp, unsigned saat = 1) {
    std::vector<float> x(static_cast<std::size_t>(n));
    std::uint32_t s = saat;
    for (auto& v : x) {
        s = s * 1664525u + 1013904223u;
        v = static_cast<float>(amp * (static_cast<double>(s >> 8) / 8388608.0 - 1.0));
    }
    return x;
}
// Energie oberhalb/unterhalb einer Grenzfrequenz grob über eine Differenz erster Ordnung (Höhenanteil)
double hoehenanteil(const std::vector<float>& x, int a, int b) {
    double d = 0.0, s = 0.0;
    for (int i = a + 1; i < b; ++i) {
        const double e = x[static_cast<std::size_t>(i)] - x[static_cast<std::size_t>(i - 1)];
        d += e * e;
        s += static_cast<double>(x[static_cast<std::size_t>(i)]) * x[static_cast<std::size_t>(i)];
    }
    return s > 0.0 ? d / s : 0.0;
}
bool bitgleich(const std::vector<float>& a, const std::vector<float>& b) {
    return a.size() == b.size() && std::memcmp(a.data(), b.data(), a.size() * sizeof(float)) == 0;
}
}  // namespace

int main() {
    const auto musik = rauschen(48000, 0.3);
    const ColorArt alle[] = {ColorArt::space, ColorArt::dub_echo, ColorArt::sweep, ColorArt::noise, ColorArt::crush};

    // 1. Mitte (und Totzone) ist bitgleich trocken, in jeder Art
    for (ColorArt a : alle) {
        auto f = neu(a);
        const auto y = durch(*f, musik, [](std::size_t i) { return (i % 3 == 0) ? 0.04 : -0.04; });
        PRUEF(bitgleich(y.l, musik) && bitgleich(y.r, musik));
    }
    // 1b. Negativkontrolle: am Anschlag ändert jede Art das Signal
    for (ColorArt a : alle) {
        auto f = neu(a);
        const auto y = durch(*f, musik, [](std::size_t) { return 0.9; });
        PRUEF(!bitgleich(y.l, musik));
    }

    // 2. NOISE: aus Stille wird Rauschen; links dunkel, rechts hell; PARAMETER hebt den Pegel
    {
        const std::vector<float> still(48000, 0.0f);
        auto fl = neu(ColorArt::noise), fr = neu(ColorArt::noise), fl2 = neu(ColorArt::noise, 1.0f);
        const auto yl = durch(*fl, still, [](std::size_t) { return -0.9; });
        const auto yr = durch(*fr, still, [](std::size_t) { return 0.9; });
        const auto yl2 = durch(*fl2, still, [](std::size_t) { return -0.9; });
        PRUEF(messen::rms(yl.l, 4800, 48000) > 1e-4);
        PRUEF(messen::rms(yr.l, 4800, 48000) > 1e-4);
        PRUEF(hoehenanteil(yl.l, 4800, 48000) < 0.05);       // Tiefpass um 600 Hz: kaum Differenzenergie
        PRUEF(hoehenanteil(yr.l, 4800, 48000) > 1.0);        // Hochpass um 8 kHz: viel
        PRUEF(messen::rms(yl2.l, 4800, 48000) > 3.0 * messen::rms(yl.l, 4800, 48000));
        PRUEF(!bitgleich(yl.l, yl.r));                       // zwei Rauschquellen: stereo
    }

    // 3. CRUSH links: wenige Stufen (Bittiefe) und gehaltene Samples; rechts nimmt der Hochpass die Tiefe
    {
        const auto sinus = messen::sinus(220.0, 0.5, 48000);
        auto f = neu(ColorArt::crush, 1.0f);
        // Rauschen statt Sinus: ohne Halt wiederholt sich ein Sample bei 4 Bit nur selten (Mutation crush_ohne_halt)
        const auto y = durch(*f, musik, [](std::size_t) { return -1.0; });
        int gleich = 0;
        for (int i = 24001; i < 48000; ++i) gleich += y.l[static_cast<std::size_t>(i)] == y.l[static_cast<std::size_t>(i - 1)];
        PRUEF(gleich > 20000);                               // Halt 24: ~23 von 24 Samples wiederholen sich
        auto f2 = neu(ColorArt::crush, 1.0f);
        const auto y2 = durch(*f2, sinus, [](std::size_t) { return 1.0; });
        PRUEF_KLEINER(messen::rms(y2.l, 24000, 48000), 0.5 * messen::rms(sinus, 24000, 48000));
    }

    // 4. SWEEP rechts: Bandpass um die Mittenfrequenz (PARAMETER 0,5 → 1225 Hz), schmal am Anschlag
    {
        const double fc = 150.0 * std::pow(10000.0 / 150.0, 0.5);
        auto fa = neu(ColorArt::sweep), fb = neu(ColorArt::sweep);
        const auto in_mitte = messen::sinus(fc, 0.5, 48000), weit = messen::sinus(fc * 8.0, 0.5, 48000);
        const auto ya = durch(*fa, in_mitte, [](std::size_t) { return 1.0; });
        const auto yb = durch(*fb, weit, [](std::size_t) { return 1.0; });
        PRUEF_NAH(messen::db(messen::rms(ya.l, 24000, 48000) / messen::rms(in_mitte, 24000, 48000)), 0.0, 0.5);
        PRUEF_KLEINER(messen::db(messen::rms(yb.l, 24000, 48000) / messen::rms(weit, 24000, 48000)), -20.0);
    }
    // 4b. SWEEP links: Gate schneidet das Ausklingen eines Schlags (enger, weniger Volumen)
    {
        std::vector<float> schlag(48000, 0.0f);
        for (int t = 0; t < 4; ++t)
            for (int i = 0; i < 6000; ++i)
                schlag[static_cast<std::size_t>(t * 12000 + i)] =
                    static_cast<float>(0.8 * std::exp(-i / 1500.0) * std::sin(2.0 * messen::kPi * 150.0 * i / 48000.0));
        auto f = neu(ColorArt::sweep, 1.0f);
        const auto y = durch(*f, schlag, [](std::size_t) { return -1.0; });
        // Ausklingen 3000..6000 Samples nach dem dritten Schlag
        PRUEF_KLEINER(messen::rms(y.l, 24000 + 3000, 24000 + 6000), 0.3 * messen::rms(schlag, 24000 + 3000, 24000 + 6000));
        // der Anschlag selbst bleibt
        PRUEF(messen::rms(y.l, 24000, 24000 + 300) > 0.5 * messen::rms(schlag, 24000, 24000 + 300));
    }

    // 5. DUB ECHO: Impuls bei Regler links, danach Mitte: Wiederholungen alle 3/4 Beat, abnehmend, Fahne klingt nach
    {
        std::vector<float> impuls(96000, 0.0f);
        impuls[100] = 1.0f;
        auto f = neu(ColorArt::dub_echo);
        const auto y = durch(*f, impuls, [](std::size_t i) { return i < 256 ? -1.0 : 0.0; });
        const int d = static_cast<int>(0.75 * kSpb);
        double e1 = 0, e2 = 0;
        for (int i = 100 + d - 400; i < 100 + d + 400; ++i) e1 += std::fabs(y.l[static_cast<std::size_t>(i)]);
        for (int i = 100 + 2 * d - 400; i < 100 + 2 * d + 400; ++i) e2 += std::fabs(y.l[static_cast<std::size_t>(i)]);
        double zwischen = 0;
        for (int i = 100 + d + 2000; i < 100 + 2 * d - 2000; ++i) zwischen += std::fabs(y.l[static_cast<std::size_t>(i)]);
        PRUEF(e1 > 0.05);
        PRUEF(e2 > 0.01 && e2 < e1);
        PRUEF_KLEINER(zwischen, 0.1 * e1);
        PRUEF(f->faehrt());
        // Artwechsel leert: danach kein Echo mehr
        f->setze(static_cast<int>(ColorArt::noise), 0.5f, kSpb);
        f->setze(static_cast<int>(ColorArt::dub_echo), 0.5f, kSpb);
        PRUEF(!f->faehrt());
        std::vector<float> still(48000, 0.0f);
        const auto z = durch(*f, still, [](std::size_t) { return 0.0; });
        PRUEF(bitgleich(z.l, still));
    }
    // 5b. DUB ECHO rechts lässt Tiefen nicht ins Echo (nur Höhen)
    {
        const auto bass = messen::sinus(100.0, 0.5, 4800);
        std::vector<float> x(96000, 0.0f);
        std::copy(bass.begin(), bass.end(), x.begin());
        auto fr = neu(ColorArt::dub_echo), fl = neu(ColorArt::dub_echo);
        const auto yr = durch(*fr, x, [](std::size_t i) { return i < 4800 ? 1.0 : 0.0; });
        const auto yl = durch(*fl, x, [](std::size_t i) { return i < 4800 ? -1.0 : 0.0; });
        const int d = static_cast<int>(0.75 * kSpb);
        PRUEF_KLEINER(messen::rms(yr.l, d, d + 4800), 0.02);
        PRUEF(messen::rms(yl.l, d, d + 4800) > messen::rms(yr.l, d, d + 4800));
    }

    // 6. SPACE: Fahne klingt nach dem Zurückdrehen nach, länger mit höherem PARAMETER, dann wieder bitgleich
    {
        std::vector<float> x(48000 * 6, 0.0f);
        for (int i = 0; i < 4800; ++i) x[static_cast<std::size_t>(i)] = musik[static_cast<std::size_t>(i)];
        auto kurz = neu(ColorArt::space, 0.0f), lang = neu(ColorArt::space, 1.0f);
        auto kfn = [](std::size_t i) { return i < 4800 ? 0.9 : 0.0; };
        const auto yk = durch(*kurz, x, kfn), yl = durch(*lang, x, kfn);
        const double nach_k = messen::rms(yk.l, 48000, 60000), nach_l = messen::rms(yl.l, 48000, 60000);
        PRUEF(messen::rms(yl.l, 9600, 14400) > 1e-3);         // Fahne nach dem Zurückdrehen
        PRUEF(nach_l > 4.0 * nach_k);                         // T60 4 s gegen 0,8 s
        PRUEF(!bitgleich(yl.l, yl.r));                        // stereo
        // nur rechts gespeist hallt beidseitig (Lehre Cypher Hall 2026-10-11: dort fehlte links der Hall)
        std::vector<float> stumm(x.size(), 0.0f);
        Lauf nr{stumm, x};
        auto fr = neu(ColorArt::space, 1.0f);
        std::vector<double> kk(kMaxFrames);
        for (std::size_t p = 0; p < x.size(); p += 256) {
            for (int i = 0; i < 256; ++i) kk[static_cast<std::size_t>(i)] = kfn(p + static_cast<std::size_t>(i));
            fr->verarbeite(&nr.l[p], &nr.r[p], 256, kk.data());
        }
        PRUEF(messen::rms(nr.l, 9600, 14400) > 1e-3);
        PRUEF(messen::rms(nr.r, 9600, 14400) > 1e-3);
        // nach 1,2·T60 ist sie aus, der Ausgang wieder exakt trocken
        PRUEF(!kurz->faehrt());
        bool trocken = true;
        for (int i = 48000 * 5; i < 48000 * 6; ++i) trocken = trocken && yk.l[static_cast<std::size_t>(i)] == 0.0f;
        PRUEF(trocken);
    }

    // 7. Art filter: verarbeite tut nichts (der DjFilter rechnet im Kanalzug)
    {
        auto f = neu(ColorArt::filter);
        const auto y = durch(*f, musik, [](std::size_t) { return 1.0; });
        PRUEF(bitgleich(y.l, musik));
    }
    // 8. Ungültige Art und NaN-Parameter
    {
        ColorFx f;
        f.setze(9, NAN, kSpb);
        PRUEF(f.art() == ColorArt::filter);
        f.setze(-1, 0.5f, kSpb);
        PRUEF(f.art() == ColorArt::filter);
    }
    return pruef::ende();
}
