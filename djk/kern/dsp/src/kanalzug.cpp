#include <cypherdj/dsp/kanalzug.h>

#include <algorithm>

#include <cypherdj/dsp/denormal.h>

#ifdef CYPHERDJ_DSP_MUTATION_ALLOKATION
#include <vector>
#endif

namespace cypherdj::dsp {

namespace {
constexpr Regler kEq[3] = {Regler::eq_tief, Regler::eq_mitte, Regler::eq_hoch};
constexpr Regler kKill[3] = {Regler::kill_tief, Regler::kill_mitte, Regler::kill_hoch};
constexpr Regler kSend[kAnzahlSends] = {Regler::send_1, Regler::send_2, Regler::send_3, Regler::send_4};
#ifdef CYPHERDJ_DSP_MUTATION_ALLOKATION
volatile float g_mutation_senke = 0.0f;
#endif
}  // namespace

Kanalzug::Kanalzug(double fs) : iso_(fs), filter_(fs) {
    for (int i = 0; i < kAnzahlRegler; ++i) bahn_[i] = Bahn(static_cast<Regler>(i), fs);
}

void Kanalzug::zuruecksetzen() {
    for (int i = 0; i < kAnzahlRegler; ++i) bahn_[i].setze_sofort(kReglerInfo[i].vorgabe);
    iso_.leeren();
    filter_.leeren();
}

void Kanalzug::zustaende_leeren() {
    iso_.leeren();
    filter_.leeren();
}

void Kanalzug::setze_sofort(Regler r, float wert) { bahn_[static_cast<int>(r)].setze_sofort(wert); }
void Kanalzug::setze(Regler r, float wert) { bahn_[static_cast<int>(r)].setze(wert); }
bool Kanalzug::rampe(Regler r, float nach, std::int64_t dauer_samples, Form form) {
    return bahn_[static_cast<int>(r)].rampe(nach, dauer_samples, form);
}
bool Kanalzug::verlauf(Regler r, const float* werte) { return bahn_[static_cast<int>(r)].verlauf(werte); }

bool Kanalzug::db_gains(Regler r, float* g, int n, double& konst) {
    Bahn& b = bahn_[static_cast<int>(r)];
    if (!b.block(werte_, n)) {
        konst = db_zu_linear(b.wert());
        return false;
    }
    for (int i = 0; i < n; ++i) g[i] = static_cast<float>(db_zu_linear(werte_[i]));
    return true;
}

void Kanalzug::verarbeite(const float* in_l, const float* in_r, int n, const KanalzugAusgang& aus) {
    verarbeite_vor(in_l, in_r, n);
    verarbeite_nach(n, aus);
}

void Kanalzug::verarbeite_vor(const float* in_l, const float* in_r, int n) {
    [[maybe_unused]] DenormalSchutz schutz;
#ifdef CYPHERDJ_DSP_MUTATION_ALLOKATION
    // Mutation für test_waechter (Task 9): allokiert in jedem Prozessaufruf.
    std::vector<float> mutation(static_cast<std::size_t>(n), in_l[0]);
    g_mutation_senke = mutation[static_cast<std::size_t>(n) - 1];
#endif
    float* a_l = abgriff_[0];
    float* a_r = abgriff_[1];

    // 1. Trim
    double k;
    if (db_gains(Regler::trim, g_trim_, n, k)) {
        for (int i = 0; i < n; ++i) { a_l[i] = in_l[i] * g_trim_[i]; a_r[i] = in_r[i] * g_trim_[i]; }
    } else {
        const float g = static_cast<float>(k);
        for (int i = 0; i < n; ++i) { a_l[i] = in_l[i] * g; a_r[i] = in_r[i] * g; }
    }

    // 2. Band-Gains: EQ (dB) mal (1 − Kill)
    for (int b = 0; b < 3; ++b) {
        float* g = g_band_[b];
        if (!db_gains(kEq[b], g, n, k)) std::fill(g, g + n, static_cast<float>(k));
        Bahn& kill = bahn_[static_cast<int>(kKill[b])];
        if (kill.block(werte_, n)) {
            for (int i = 0; i < n; ++i) g[i] *= static_cast<float>(1.0 - werte_[i]);
        } else if (kill.wert() != 0.0f) {
            const float f = 1.0f - kill.wert();
            for (int i = 0; i < n; ++i) g[i] *= f;
        }
    }

    // 3. Isolator und 4. Filter, beide an Ort und Stelle im Abgriff-Puffer
    iso_.verarbeite(a_l, a_r, a_l, a_r, n, g_band_[0], g_band_[1], g_band_[2]);
    Bahn& fb = bahn_[static_cast<int>(Regler::filter)];
    if (!fb.block(k_filter_, n)) std::fill(k_filter_, k_filter_ + n, static_cast<double>(fb.wert()));
    filter_.verarbeite(a_l, a_r, n, k_filter_);
    // ab hier: a_l/a_r ist der Abgriff nach Filter, vor dem Fader (ADR 008 Punkt 4, SCHNITTSTELLEN §6.2)
}

void Kanalzug::verarbeite_nach(int n, const KanalzugAusgang& aus) {
    [[maybe_unused]] DenormalSchutz schutz;
    double k;
    const float* a_l = abgriff_[0];
    const float* a_r = abgriff_[1];

    // 5. Fader
    float* h_l = aus.haupt_l;
    float* h_r = aus.haupt_r;
    if (db_gains(Regler::fader, g_fader_, n, k)) {
        for (int i = 0; i < n; ++i) { h_l[i] = a_l[i] * g_fader_[i]; h_r[i] = a_r[i] * g_fader_[i]; }
    } else {
        const float g = static_cast<float>(k);
        for (int i = 0; i < n; ++i) { h_l[i] = a_l[i] * g; h_r[i] = a_r[i] * g; }
    }

    // 6. Sends nach dem Fader; die Bahnen laufen auch ohne Bus weiter
    for (int s = 0; s < kAnzahlSends; ++s) {
        float* s_l = aus.send_l[s];
        float* s_r = aus.send_r[s];
        const bool faehrt = db_gains(kSend[s], g_send_, n, k);
        if (s_l == nullptr || s_r == nullptr) continue;
        if (faehrt) {
            for (int i = 0; i < n; ++i) { s_l[i] += h_l[i] * g_send_[i]; s_r[i] += h_r[i] * g_send_[i]; }
        } else if (k != 0.0) {
            const float g = static_cast<float>(k);
            for (int i = 0; i < n; ++i) { s_l[i] += h_l[i] * g; s_r[i] += h_r[i] * g; }
        }
    }
}

}  // namespace cypherdj::dsp
