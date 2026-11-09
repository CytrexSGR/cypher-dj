// Hardening: controls.h / controls.cpp (controller table, path lookup) and the value rules of values.h it relies on.
//   1. Table invariants: min <= vorgabe <= max, switch ramp > 0, unit-specific ranges, paths unique and non-empty.
//   2. Round trip: regler_aus_pfad(info(r).pfad) == r for every controller.
//   3. Fuzz: 200 000 strings (random, and valid paths with a character changed, inserted, removed, cut, case
//      flipped, with prefix/suffix, embedded NUL) map to a controller only if they equal its path exactly.
//   4. values.h at and beyond the range limits: db_zu_linear exact 0 / 1, finite and strictly increasing on
//      (-120, +24]; rampe_db_wert finite, inside the ends (or stumm), monotone in u; kanalpegel_db and
//      trim_aus_lufs clamp, also for +-inf.
//
// Mutation check (automatic, test_haertung_regler_mutation_praefix): controls.cpp is copied with the exact comparison
// replaced by a prefix match (teilpfad.starts_with(pfad)). The fuzz check 3 is PRUEF_M and fails on that variant
// (verified 2026-11-02: 58566 of 200000 strings wrong, e.g. "send/2 ", "trim\0x", "send/3send/3").
#include <cypherdj/dsp/controls.h>
#include <cypherdj/dsp/values.h>

#include <cstdio>
#include <limits>
#include <set>
#include <string>

#include "hardening.h"

using namespace cypherdj::dsp;
using haertung::Zufall;

namespace {

void pruefe_tabelle() {
    std::set<std::string_view> pfade;
    bool ok = true;
    for (int i = 0; i < kAnzahlRegler; ++i) {
        const ReglerInfo& r = kReglerInfo[static_cast<std::size_t>(i)];
        bool z = !r.pfad.empty() && pfade.insert(r.pfad).second;
        z = z && r.min <= r.vorgabe && r.vorgabe <= r.max && r.min < r.max && r.schaltrampe_ms > 0.0f;
        switch (r.einheit) {
            case Einheit::db: z = z && r.max <= kTrimMaxDb && (r.min == kStummDb || r.min == kTrimMinDb); break;
            case Einheit::schalter: z = z && r.min == 0.0f && r.max == 1.0f && r.form == Schaltform::zweite_ordnung; break;
            case Einheit::filter: z = z && r.min == -1.0f && r.max == 1.0f && r.form == Schaltform::glaettung; break;
        }
        if (!z) std::printf("table entry %d (%.*s) violates an invariant\n", i, static_cast<int>(r.pfad.size()), r.pfad.data());
        ok = ok && z;
    }
    PRUEF(ok);
    for (int i = 0; i < kAnzahlRegler; ++i) {
        const auto r = regler_aus_pfad(info(static_cast<Regler>(i)).pfad);
        PRUEF(r.has_value() && *r == static_cast<Regler>(i));
    }
}

void pruefe_fuzz() {
    Zufall z(211);
    const std::string zeichen = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/<>_-. \t";
    long falsch = 0, treffer = 0;
    std::string beispiel;
    for (int f = 0; f < 200000; ++f) {
        std::string s;
        const std::string basis(info(static_cast<Regler>(z.ganz(0, kAnzahlRegler - 1))).pfad);
        switch (f % 9) {
            case 0: { const int n = z.ganz(0, 12); for (int i = 0; i < n; ++i) s += zeichen[static_cast<std::size_t>(z.ganz(0, static_cast<int>(zeichen.size()) - 1))]; break; }
            case 1: s = basis; s[static_cast<std::size_t>(z.ganz(0, static_cast<int>(s.size()) - 1))] = zeichen[static_cast<std::size_t>(z.ganz(0, static_cast<int>(zeichen.size()) - 1))]; break;
            case 2: s = basis; s.insert(static_cast<std::size_t>(z.ganz(0, static_cast<int>(s.size()))), 1, zeichen[static_cast<std::size_t>(z.ganz(0, static_cast<int>(zeichen.size()) - 1))]); break;
            case 3: s = basis; s.erase(static_cast<std::size_t>(z.ganz(0, static_cast<int>(s.size()) - 1)), 1); break;
            case 4: s = basis.substr(0, static_cast<std::size_t>(z.ganz(0, static_cast<int>(basis.size())))); break;
            case 5: s = basis; for (char& c : s) if (c >= 'a' && c <= 'z' && z.gleich() < 0.3) c = static_cast<char>(c - 32); break;
            case 6: s = (z.gleich() < 0.5 ? "k1/" : "") + basis + (z.gleich() < 0.5 ? "/" : " "); break;
            case 7: s = basis; s.push_back('\0'); s += "x"; break;
            default: s = basis + basis; break;
        }
        const auto r = regler_aus_pfad(s);
        bool gueltig = false;
        for (int i = 0; i < kAnzahlRegler; ++i) gueltig = gueltig || kReglerInfo[static_cast<std::size_t>(i)].pfad == s;
        if (r.has_value()) ++treffer;
        const bool ok = r.has_value() ? (gueltig && info(*r).pfad == s) : !gueltig;
        if (!ok) {
            ++falsch;
            if (beispiel.size() < 60) {
                std::string d = s;
                for (char& c : d) if (c < ' ') c = '?';  // NUL and tab printable
                beispiel += "\"" + d + "\" ";
            }
        }
    }
    std::printf("path fuzz: 200000 strings, %ld hits, %ld wrong %s\n", treffer, falsch, beispiel.c_str());
    PRUEF_M(falsch == 0);
}

void pruefe_werte() {
    PRUEF(db_zu_linear(0.0) == 1.0);
    PRUEF(db_zu_linear(kStummGrenzeDb) == 0.0);
    PRUEF(db_zu_linear(kStummDb) == 0.0);
    PRUEF(db_zu_linear(-std::numeric_limits<double>::infinity()) == 0.0);
    PRUEF(normiere_db(-121.0f) == kStummDb && normiere_db(-119.0f) == -119.0f);
    bool steigend = true, endlich = true;
    double alt = 0.0;
    for (int i = 1; i <= 144000; ++i) {
        const double d = kStummGrenzeDb + i * (kTrimMaxDb - kStummGrenzeDb) / 144000.0;
        const double v = db_zu_linear(d);
        endlich = endlich && std::isfinite(v) && v > 0.0;
        steigend = steigend && v > alt;
        alt = v;
    }
    PRUEF(endlich);
    PRUEF(steigend);

    Zufall z(221);
    long fehler_grenze = 0, fehler_mono = 0, fehler_endlich = 0;
    for (int f = 0; f < 20000; ++f) {
        auto zufalls_db = [&]() {
            const double w = z.gleich();
            return w < 0.15 ? static_cast<double>(kStummDb) : w < 0.2 ? -120.0 : w < 0.25 ? 24.0 : z.zwischen(-200.0, 24.0);
        };
        const double von = zufalls_db(), nach = zufalls_db();
        double vorher = rampe_db_wert(von, nach, 0.0);
        const double lo = std::fmin(von, nach), hi = std::fmax(von, nach);
        for (int j = 0; j <= 64; ++j) {
            const double u = j / 64.0;
            const double w = rampe_db_wert(von, nach, u);
            fehler_endlich += !std::isfinite(w);
            fehler_grenze += !(w == kStummDb || (w >= lo - 1e-9 && w <= hi + 1e-9));
            // monotone towards the target (the stumm end jumps once, in the same direction)
            if (j > 0) fehler_mono += nach >= von ? (w < vorher - 1e-12) : (w > vorher + 1e-12);
            vorher = w;
        }
    }
    std::printf("rampe_db_wert fuzz: non-finite %ld, outside the ends %ld, not monotone %ld\n", fehler_endlich, fehler_grenze, fehler_mono);
    PRUEF(fehler_endlich == 0);
    PRUEF(fehler_grenze == 0);
    PRUEF(fehler_mono == 0);

    const float inf = std::numeric_limits<float>::infinity();
    PRUEF(trim_aus_lufs(-14.0f, -inf) == kTrimMaxDb);   // silent track (integrated -inf LUFS)
    PRUEF(trim_aus_lufs(-14.0f, inf) == kTrimMinDb);
    PRUEF(trim_aus_lufs(-14.0f, -20.0f) == 6.0f);
    PRUEF(kanalpegel_db(-24.0f, kStummDb) == kStummDb);
    PRUEF(kanalpegel_db(24.0f, 0.0f) == 24.0f);
    PRUEF(kanalpegel_db(-inf, 0.0f) == kStummDb);
    // NaN is not clamped by trim_aus_lufs (std::clamp passes it through); Bahn::setze_sofort drops NaN, so a NaN
    // loudness keeps the previous trim. Documented here, not a defect.
    PRUEF(std::isnan(trim_aus_lufs(-14.0f, std::numeric_limits<float>::quiet_NaN())));
}

}  // namespace

int main(int argc, char** argv) {
    haertung::starte(argc, argv);
    if (haertung::normal_lauf()) {
        pruefe_tabelle();
        pruefe_fuzz();
        pruefe_werte();
    }
    return haertung::ende();
}
