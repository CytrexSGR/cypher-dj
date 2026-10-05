// Nachtrag 04 (A27 Weg a): Güte des DjFilter als Konfig-Wert `filter_guete` (kern.toml, Vorgabe 0,707, Bereich 0,5 bis 4;
// bis 2026-09-26 0,5 bis 8, auf 4 begrenzt wegen Subbass-Überhöhung 22–32 Hz, bis Andreas gehört hat).
// Negativ-Kontrolle: bei Güte 0,707 (Vorgabe und ausdrücklich gesetzt) ist der Ausgang bitgleich zum Stand vor dem
// Nachtrag (Prüfsumme über eine Fahrt k −1 → +1 → −1, gerechnet mit der Bibliothek vor der Änderung).
// Fehlerfall: bei höherer Güte steht an der Eckfrequenz eine Resonanzspitze von 20·log10(Q) dB (TPT-SVF mit
// vorverzerrtem g: |H(fc)| = Q exakt), Tiefpass- und Hochpass-Seite. NaN-frei beim Durchfahren mit Höchstgüte und beim
// Umstellen der Güte mitten im Lauf. Ungültige Güte (NaN, außerhalb) wird verworfen bzw. geklemmt.
// Aufruf: test_djfilter_guete [1]   (Mutationsbau „Güte fest“: Argument 1 → muss rot sein)
#include <cypherdj/dsp/djfilter.h>
#include <cypherdj/dsp/kanalzug.h>

#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <limits>
#include <memory>
#include <vector>

#include "messen.h"
#include "pruef.h"

using namespace cypherdj::dsp;

namespace {
// Stand vor dem Nachtrag (feste Güte 0,707), mit der unveränderten Bibliothek gemessen am 2026-09-26 (-O0, -O2).
constexpr std::uint64_t kPruefsummeVorher = 0xb0ffc2a7c5b28ea3ull;

// Rauschen durch eine Fahrt k: −1 → +1 → −1 über 4 s in Blöcken zu 256; FNV-1a über die Float-Bits von L und R.
std::uint64_t pruefsumme(DjFilter& f) {
    const int N = 4 * 48000;
    std::vector<float> l(N), r(N);
    std::vector<double> k(N);
    unsigned s = 7;
    for (int i = 0; i < N; ++i) {
        s = s * 1664525u + 1013904223u;
        l[i] = static_cast<float>((s >> 8) * (1.0 / 16777216.0) - 0.5);
        r[i] = -0.5f * l[i];
        const double t = static_cast<double>(i) / N;
        k[i] = t < 0.5 ? -1.0 + 4.0 * t : 3.0 - 4.0 * t;
    }
    for (int p = 0; p < N; p += 256) f.verarbeite(&l[p], &r[p], 256, &k[p]);
    std::uint64_t h = 1469598103934665603ull;
    auto mische = [&](const std::vector<float>& v) {
        for (float x : v) {
            std::uint32_t b;
            std::memcpy(&b, &x, 4);
            for (int j = 0; j < 4; ++j) { h ^= (b >> (8 * j)) & 0xff; h *= 1099511628211ull; }
        }
    };
    mische(l);
    mische(r);
    return h;
}

// Pegel eines Sinus der Frequenz f nach dem Filter (feste Stellung k, Güte q), eingeschwungen, in dB.
double pegel_db(double f, double k, double q) {
    auto flt = std::make_unique<DjFilter>();
    flt->setze_guete(q);
    const auto x = messen::sinus(f, 0.25, 96000);
    std::vector<float> l = x, r = x;
    std::vector<double> kk(kMaxFrames, k);
    for (std::size_t p = 0; p < x.size(); p += 256) {
        const int n = static_cast<int>(std::min<std::size_t>(256, x.size() - p));
        flt->verarbeite(&l[p], &r[p], n, kk.data());
    }
    return messen::db(messen::rms(l, 48000, 96000) / messen::rms(x, 48000, 96000));
}

// Eckfrequenzen nach 04 §4.6 (wie djfilter.cpp)
double fc_tp(double k) { return 20000.0 * std::exp(std::max(0.0, -k) * std::log(60.0 / 20000.0)); }
double fc_hp(double k) { return 20.0 * std::exp(std::max(0.0, k) * std::log(8000.0 / 20.0)); }
}  // namespace

int main(int argc, char** argv) {
    const bool mutation = argc > 1 && std::atoi(argv[1]) == 1;

    // --- Negativ-Kontrolle: Güte 0,707 bitgleich zu vorher ---
    {
        auto f = std::make_unique<DjFilter>();
        PRUEF(f->guete() == kGueteVorgabe);
        const std::uint64_t h = pruefsumme(*f);
        std::printf("Prüfsumme Vorgabe: 0x%016llx (vorher 0x%016llx)\n", static_cast<unsigned long long>(h),
                    static_cast<unsigned long long>(kPruefsummeVorher));
        PRUEF(h == kPruefsummeVorher);
        auto g = std::make_unique<DjFilter>();
        g->setze_guete(4.0);
        g->setze_guete(0.707);  // hin und zurück: wieder genau das alte Verhalten
        PRUEF(pruefsumme(*g) == kPruefsummeVorher);
    }

    // --- Fehlerfall: Resonanzspitze an der Eckfrequenz ---
    struct Fall { double k, q, soll_db; };
    const Fall faelle[] = {
        {-0.5, 0.707, 20.0 * std::log10(0.707)},  // −3,01 dB: heutiges Verhalten, keine Spitze
        {-0.5, 2.0, 20.0 * std::log10(2.0)},      // +6,02 dB
        {-0.5, 4.0, 20.0 * std::log10(4.0)},      // +12,04 dB
        {-0.5, 8.0, 20.0 * std::log10(4.0)},      // verlangt 8, geklemmt auf 4: +12,04 dB statt +18,06 dB
        {+0.5, 0.707, 20.0 * std::log10(0.707)},
        {+0.5, 4.0, 20.0 * std::log10(4.0)},
        {-0.8, 4.0, 20.0 * std::log10(4.0)},
    };
    double spitze_q4 = 0.0;
    for (const Fall& c : faelle) {
        const double fc = c.k < 0.0 ? fc_tp(c.k) : fc_hp(c.k);
        const double ist = pegel_db(fc, c.k, c.q);
        std::printf("k=%+.2f Q=%.3f fc=%7.1f Hz: %+7.3f dB (soll %+7.3f)\n", c.k, c.q, fc, ist, c.soll_db);
        PRUEF_NAH(ist, c.soll_db, 0.1);
        if (c.k == -0.5 && c.q == 4.0) spitze_q4 = ist;
    }
    // Die Spitze ist eine Spitze: eine Oktave neben fc liegt der Pegel tiefer als an fc
    PRUEF(pegel_db(fc_tp(-0.5) * 2.0, -0.5, 4.0) < spitze_q4 - 6.0);
    PRUEF(pegel_db(fc_tp(-0.5) * 0.5, -0.5, 4.0) < spitze_q4 - 6.0);
    // Negativ-Kontrolle: auch mit Güte 8 bleibt k = 0 bitgleich trocken (nass = 0) …
    {
        auto f = std::make_unique<DjFilter>();
        f->setze_guete(8.0);
        std::vector<float> x(48000);
        unsigned s = 3;
        for (float& v : x) { s = s * 1664525u + 1013904223u; v = static_cast<float>((s >> 8) * (1.0 / 16777216.0) - 0.5); }
        std::vector<float> l = x, r = x;
        std::vector<double> k0(kMaxFrames, 0.0);
        for (std::size_t p = 0; p < x.size(); p += 256) {
            const int n = static_cast<int>(std::min<std::size_t>(256, x.size() - p));
            f->verarbeite(&l[p], &r[p], n, k0.data());
        }
        PRUEF(std::memcmp(x.data(), l.data(), x.size() * sizeof(float)) == 0);
    }
    // … und die Endstellung sperrt weiter (k = −1, 1 kHz: bei 0,707 −48,9 dB, mit Güte 4 ebenfalls weit unten)
    PRUEF(pegel_db(1000.0, -1.0, 4.0) < -40.0);

    // --- Grenzen: NaN verworfen, außerhalb geklemmt ---
    {
        DjFilter f;
        f.setze_guete(3.0);
        f.setze_guete(std::numeric_limits<double>::quiet_NaN());
        PRUEF(f.guete() == 3.0);
        f.setze_guete(std::numeric_limits<double>::infinity());
        PRUEF(f.guete() == kGueteMax);
        f.setze_guete(100.0);
        PRUEF(f.guete() == kGueteMax);
        f.setze_guete(0.0);
        PRUEF(f.guete() == kGueteMin);
        f.setze_guete(-1.0);
        PRUEF(f.guete() == kGueteMin);
        PRUEF(kGueteMin == 0.5 && kGueteMax == 4.0 && kGueteVorgabe == 0.707);
        // Befund 3: Höchstgüte 4, bis Andreas gehört hat. 4 selbst bleibt erlaubt, alles darüber wird 4.
        f.setze_guete(4.0);
        PRUEF(f.guete() == 4.0);
        f.setze_guete(8.0);
        PRUEF(f.guete() == 4.0);
        f.setze_guete(4.000001);
        PRUEF(f.guete() == 4.0);
        f.setze_guete(3.999);
        PRUEF(f.guete() == 3.999);
    }

    // --- Grenze am Ohr (Befund 3): leichtes Rechtsdrehen k = 0,05 (fc 27 Hz, Ende der Totzone) mit verlangter
    // Güte 8 hob den Subbass um +18,1 dB (gemessen 2026-09-26); mit der Grenze höchstens +12,04 dB wie bei Güte 4.
    {
        const double sub = pegel_db(fc_hp(0.05), 0.05, 8.0);
        std::printf("k=+0.05 fc=%5.1f Hz, Güte 8 verlangt: %+7.3f dB (Grenze %+7.3f)\n", fc_hp(0.05), sub,
                    20.0 * std::log10(kGueteMax));
        PRUEF(sub < 20.0 * std::log10(4.0) + 0.1);
    }

    // --- NaN-freie Rampe: Güte 8 verlangt (geklemmt auf Höchstgüte), Fahrt −1 → +1 → −1 über 2 s, lautes Rauschen, Güte mitten im Lauf umgestellt ---
    {
        auto f = std::make_unique<DjFilter>();
        f->setze_guete(8.0);
        const int N = 2 * 48000;
        std::vector<float> l(N), r(N);
        std::vector<double> k(N);
        unsigned s = 11;
        for (int i = 0; i < N; ++i) {
            s = s * 1664525u + 1013904223u;
            l[i] = static_cast<float>(2.0 * ((s >> 8) * (1.0 / 16777216.0) - 0.5));  // ±1
            r[i] = l[i];
            const double t = static_cast<double>(i) / N;
            k[i] = t < 0.5 ? -1.0 + 4.0 * t : 3.0 - 4.0 * t;
        }
        long nicht_endlich = 0;
        double spitze = 0.0;
        for (int p = 0, b = 0; p < N; p += 256, ++b) {
            if (b % 50 == 25) f->setze_guete(b % 100 == 25 ? 0.5 : 8.0);  // Güte springt zwischen den Enden
            f->verarbeite(&l[p], &r[p], 256, &k[p]);
            for (int i = p; i < p + 256; ++i) {
                nicht_endlich += !std::isfinite(l[i]) + !std::isfinite(r[i]);
                spitze = std::max(spitze, static_cast<double>(std::fabs(l[i])));
            }
        }
        std::printf("Rampe Höchstgüte: %ld nicht endliche Samples, Spitze %.2f (%.1f dBFS)\n", nicht_endlich, spitze,
                    messen::db(spitze));
        PRUEF(nicht_endlich == 0);
        PRUEF(spitze < 2.0 * kGueteMax);  // Grenze: Q·2 bei Eingang ±1; ein instabiles Filter läuft weit darüber
    }

    // --- Güte-Wechsel bei stehendem Regler (Befund 1 der adversarialen Prüfung): setze_guete muss den
    // Koeffizienten-Cache verwerfen, sonst rechnet koeffizienten(k) bei unverändertem k nicht neu und a_tp_/a_hp_
    // bleiben auf der alten Dämpfung stehen. Fehlerfall: Güte 0,707 → 4 mitten im Lauf bei k = ±0,5, Sinus an fc,
    // danach muss die Spitze +12,04 dB stehen wie bei einem frisch mit Güte 4 angelegten Filter. Mutationsbau
    // „ohne Cache-Invalidierung“ (CYPHERDJ_DSP_MUTATION_OHNE_CACHE_INVALIDIERUNG) muss hier rot sein.
    for (const double k : {-0.5, +0.5}) {
        const double fc = k < 0.0 ? fc_tp(k) : fc_hp(k);
        auto f = std::make_unique<DjFilter>();
        const auto x = messen::sinus(fc, 0.25, 3 * 48000);
        std::vector<float> l = x, r = x;
        std::vector<double> kk(kMaxFrames, k);
        for (std::size_t p = 0; p < x.size(); p += 256) {
            if (p == 48000 - 48000 % 256) f->setze_guete(4.0);  // nach ~1 s, k steht die ganze Zeit
            const int n = static_cast<int>(std::min<std::size_t>(256, x.size() - p));
            f->verarbeite(&l[p], &r[p], n, kk.data());
        }
        const double ist = messen::db(messen::rms(l, 2 * 48000, 3 * 48000) / messen::rms(x, 2 * 48000, 3 * 48000));
        std::printf("Güte 0,707 → 4 bei stehendem k=%+.2f, fc=%7.1f Hz: %+7.3f dB (soll %+7.3f)\n", k, fc, ist,
                    20.0 * std::log10(4.0));
        PRUEF_NAH(ist, 20.0 * std::log10(4.0), 0.1);
    }

    // --- Kanalzug reicht die Güte durch (Naht zu Scheibe 25), zuruecksetzen() lässt sie stehen ---
    {
        auto kz = std::make_unique<Kanalzug>();
        PRUEF(kz->filter_guete() == kGueteVorgabe);
        kz->setze_filter_guete(4.0);
        PRUEF(kz->filter_guete() == 4.0);
        kz->zuruecksetzen();
        PRUEF(kz->filter_guete() == 4.0);
        kz->setze_filter_guete(std::numeric_limits<double>::quiet_NaN());
        PRUEF(kz->filter_guete() == 4.0);
    }

    if (mutation) {
        const bool rot = pruef::fehler() > 0;
        std::printf("Mutationsbau: %s\n", rot ? "rot wie erwartet" : "GRÜN, der Test sieht die Mutation nicht");
        return rot ? 0 : 1;
    }
    return pruef::ende();
}
