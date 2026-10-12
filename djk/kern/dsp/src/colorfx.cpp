#include <cypherdj/dsp/colorfx.h>

#include <algorithm>
#include <cmath>

namespace cypherdj::dsp {

namespace {
constexpr double kPi = 3.14159265358979323846;
constexpr double kTotzone = 0.05;            // wie DjFilter: |k| < 0,05 ist trocken
constexpr int kEchoMax = 96000;              // 2 s je Kanal
constexpr double kEchoGleit_s = 0.08;        // Zeitwechsel gleitet (wie SPIRAL), kein Sprung in der Leitung
constexpr int kFdnLen[4] = {1559, 1877, 2333, 2707};
constexpr int kApLen[2][2] = {{142, 379}, {167, 401}};
constexpr double kApG = 0.6;

// Anteil aus der Totzone heraus: 0 in der Mitte, 1 am Anschlag
inline double anteil(double k) {
    const double a = (std::fabs(k) - kTotzone) / (1.0 - kTotzone);
    return a <= 0.0 ? 0.0 : (a >= 1.0 ? 1.0 : a);
}
// exponentiell von `von` (a = 0) nach `bis` (a = 1)
inline double expo(double a, double von, double bis) { return von * std::exp(a * std::log(bis / von)); }

struct Koef {
    double g = 0.0, d = 1.0, a = 1.0;
};
inline Koef koef(double fc, double q, double fs) {
    Koef c;
    c.g = std::tan(kPi * std::min(fc, 0.45 * fs) / fs);
    c.d = 1.0 / q;
    c.a = 1.0 / (1.0 + c.g * (c.g + c.d));
    return c;
}
inline void schritt(ColorFx::Svf& s, double x, const Koef& c, double& lp, double& bp, double& hp) {
    const double v1 = (s.ic1 + c.g * (x - s.ic2)) * c.a;
    const double v2 = s.ic2 + c.g * v1;
    s.ic1 = 2.0 * v1 - s.ic1;
    s.ic2 = 2.0 * v2 - s.ic2;
    lp = v2;
    bp = v1;
    hp = x - c.d * v1 - v2;
}
inline float zufall(std::uint32_t& s) {   // xorshift32, gleichverteilt in [−1, 1)
    s ^= s << 13;
    s ^= s >> 17;
    s ^= s << 5;
    return static_cast<float>(static_cast<std::int32_t>(s)) * (1.0f / 2147483648.0f);
}
inline double einpol(double zeit_s, double fs) { return 1.0 - std::exp(-1.0 / (zeit_s * fs)); }
}  // namespace

ColorFx::ColorFx(double fs) : fs_(fs) {
    for (auto& e : echo_) e.assign(kEchoMax, 0.0f);
    for (int i = 0; i < kLeitungen; ++i) {
        fdn_len_[i] = kFdnLen[i];
        fdn_[i].assign(static_cast<std::size_t>(kFdnLen[i]), 0.0f);
    }
    for (int c = 0; c < 2; ++c)
        for (int s = 0; s < 2; ++s) ap_[c][s].assign(static_cast<std::size_t>(kApLen[c][s]), 0.0f);
    leeren();
}

void ColorFx::leeren() {
    for (auto& st : f_)
        for (auto& s : st) s = Svf{};
    halt_[0] = halt_[1] = 0.0f;
    halt_zaehler_ = 0;
    huelle_ = spitze_ = 0.0;
    gate_ = 1.0;
    // Echo und Hall: Füllzähler statt memset (echtzeitfest, s. Kopf); Lesen hinter dem Gefüllten liefert 0
    echo_pos_ = echo_gefuellt_ = 0;
    echo_d_ = 0.0;
    echo_tp_[0] = echo_tp_[1] = 0.0;
    for (int i = 0; i < kLeitungen; ++i) {
        fdn_pos_[i] = 0;
        fdn_tp_[i] = 0.0;
    }
    for (auto& c : ap_pos_) c[0] = c[1] = 0;
    space_gefuellt_ = 0;
    fahne_ = 0;
    ruht_ = true;
}

void ColorFx::setze(int art, float param, double samples_pro_beat) {
    const ColorArt neu = (art >= 0 && art <= kColorArtMax) ? static_cast<ColorArt>(art) : ColorArt::filter;
    if (neu != art_) {
        art_ = neu;
        leeren();
    }
    p_ = std::isnan(param) ? kColorParamVorgabe : std::clamp(param, 0.0f, 1.0f);
    spb_ = samples_pro_beat > 0.0 ? samples_pro_beat : 0.5 * fs_ / 0.75;
}

void ColorFx::verarbeite(float* l, float* r, int n, const double* k) {
    if (art_ == ColorArt::filter) return;
    bool aktiv = fahne_ > 0;
    for (int i = 0; i < n && !aktiv; ++i) aktiv = std::fabs(k[i]) > kTotzone;
    if (!aktiv) {   // bitgleich trocken; der nächste Einstieg beginnt mit leeren Zuständen
        if (!ruht_) leeren();
        return;
    }
    ruht_ = false;
    switch (art_) {
        case ColorArt::space: space(l, r, n, k); break;
        case ColorArt::dub_echo: dub_echo(l, r, n, k); break;
        case ColorArt::sweep: sweep(l, r, n, k); break;
        case ColorArt::noise: noise(l, r, n, k); break;
        case ColorArt::crush: crush(l, r, n, k); break;
        case ColorArt::filter: break;
    }
}

// SPACE: Hall. Links speist Mitten und Tiefen (Tiefpass 2,5 kHz), rechts Mitten und Höhen (Hochpass 350 Hz);
// PARAMETER rechts = mehr Rückkopplung (T60 0,8 bis 4 s). Fahne läuft nach.
void ColorFx::space(float* l, float* r, int n, const double* k) {
    const double t60 = 0.8 + 3.2 * p_;
    double g[kLeitungen];
    for (int i = 0; i < kLeitungen; ++i) g[i] = std::pow(10.0, -3.0 * fdn_len_[i] / (t60 * fs_));
    const double dkoef = einpol(1.0 / (2.0 * kPi * 6000.0), fs_);
    const Koef tp = koef(2500.0, 0.707, fs_), hp = koef(350.0, 0.707, fs_);
    const double wet = 0.7;
    for (int i = 0; i < n; ++i) {
        const double a = anteil(k[i]);
        if (a > 0.0) {
            seite_ = k[i] < 0.0 ? -1 : 1;
            fahne_ = static_cast<int>(t60 * 1.2 * fs_);
        }
        double ein[2];
        const float x[2] = {l[i], r[i]};
        for (int c = 0; c < 2; ++c) {
            double lp, bp, hpo;
            schritt(f_[0][c], x[c], seite_ < 0 ? tp : hp, lp, bp, hpo);
            double v = a * (seite_ < 0 ? lp : hpo);
            for (int s = 0; s < 2; ++s) {   // Schroeder-Allpass zur Diffusion
                std::vector<float>& b = ap_[c][s];
                int& pos = ap_pos_[c][s];
                const double alt = space_gefuellt_ >= kApLen[c][s] ? b[static_cast<std::size_t>(pos)] : 0.0;
                const double y = alt - kApG * v;
                b[static_cast<std::size_t>(pos)] = static_cast<float>(v + kApG * y);
                if (++pos >= kApLen[c][s]) pos = 0;
                v = y;
            }
            ein[c] = v;
        }
        double o[kLeitungen];
        for (int j = 0; j < kLeitungen; ++j) {
            const double roh = space_gefuellt_ >= fdn_len_[j] ? fdn_[j][static_cast<std::size_t>(fdn_pos_[j])] : 0.0;
            fdn_tp_[j] += (roh - fdn_tp_[j]) * dkoef;
            o[j] = fdn_tp_[j];
        }
        const double h[4] = {0.5 * (o[0] + o[1] + o[2] + o[3]), 0.5 * (o[0] - o[1] + o[2] - o[3]),
                             0.5 * (o[0] + o[1] - o[2] - o[3]), 0.5 * (o[0] - o[1] - o[2] + o[3])};
        for (int j = 0; j < kLeitungen; ++j) {
            fdn_[j][static_cast<std::size_t>(fdn_pos_[j])] = static_cast<float>(g[j] * h[j] + ein[j & 1]);
            if (++fdn_pos_[j] >= fdn_len_[j]) fdn_pos_[j] = 0;
        }
        if (space_gefuellt_ < (1 << 30)) ++space_gefuellt_;
        l[i] = static_cast<float>(x[0] + wet * 0.5 * (o[0] + o[2]));
        r[i] = static_cast<float>(x[1] + wet * 0.5 * (o[1] + o[3]));
    }
    fahne_ = std::max(0, fahne_ - n);
}

// DUB ECHO: Echo 3/4 Beat, mehrfach und abnehmend. Links nur Mitten (Bandpass 1 kHz), rechts nur Höhen
// (Hochpass 2,5 kHz); jede Wiederholung läuft erneut durch das Filter (wird dünner). PARAMETER = Rückkopplung.
void ColorFx::dub_echo(float* l, float* r, int n, const double* k) {
    const double fb = 0.35 + 0.55 * p_;
    const double ziel = std::clamp(0.75 * spb_, 480.0, static_cast<double>(kEchoMax - 2));
    if (echo_d_ <= 0.0) echo_d_ = ziel;
    const double gleit = einpol(kEchoGleit_s, fs_);
    const Koef bp = koef(1000.0, 0.9, fs_), hp = koef(2500.0, 0.707, fs_);
    const int wiederholungen = static_cast<int>(std::ceil(std::log(1e-4) / std::log(fb)));
    for (int i = 0; i < n; ++i) {
        const double a = anteil(k[i]);
        if (a > 0.0) {
            seite_ = k[i] < 0.0 ? -1 : 1;
            fahne_ = static_cast<int>((wiederholungen + 1) * ziel);
        }
        echo_d_ += (ziel - echo_d_) * gleit;
        double lesen = echo_pos_ - echo_d_;
        if (lesen < 0.0) lesen += kEchoMax;
        const int i0 = static_cast<int>(lesen);
        const int i1 = i0 + 1 >= kEchoMax ? 0 : i0 + 1;
        const double frac = lesen - i0;
        const bool gueltig = echo_gefuellt_ > echo_d_ + 1.0;
        const float x[2] = {l[i], r[i]};
        const Koef& c0 = seite_ < 0 ? bp : hp;
        for (int c = 0; c < 2; ++c) {
            const std::vector<float>& b = echo_[c];
            const double aus = gueltig ? b[static_cast<std::size_t>(i0)] * (1.0 - frac) + b[static_cast<std::size_t>(i1)] * frac : 0.0;
            double lp, bpo, hpo;
            schritt(f_[0][c], x[c], c0, lp, bpo, hpo);
            const double send = a * (seite_ < 0 ? c0.d * bpo : hpo);
            schritt(f_[1][c], aus, c0, lp, bpo, hpo);
            const double rueck = fb * (seite_ < 0 ? c0.d * bpo : hpo);
            echo_[c][static_cast<std::size_t>(echo_pos_)] = static_cast<float>(send + rueck);
            (c == 0 ? l : r)[i] = static_cast<float>(x[c] + aus);
        }
        if (++echo_pos_ >= kEchoMax) echo_pos_ = 0;
        if (echo_gefuellt_ < kEchoMax) ++echo_gefuellt_;
    }
    fahne_ = std::max(0, fahne_ - n);
}

// SWEEP: links ein Gate (Klang wird enger, PARAMETER zieht es weiter zu), rechts ein Bandpass, der mit dem Regler
// schmaler wird; PARAMETER rechts = Mittenfrequenz 150 Hz bis 10 kHz.
void ColorFx::sweep(float* l, float* r, int n, const double* k) {
    const double h_an = einpol(0.0005, fs_), h_ab = einpol(0.03, fs_), s_ab = einpol(1.0, fs_);
    const double g_an = einpol(0.0003, fs_), g_ab = einpol(0.010, fs_);
    const double fc = expo(p_, 150.0, 10000.0);
    double k_alt = NAN;
    Koef c;
    for (int i = 0; i < n; ++i) {
        const double a = anteil(k[i]);
        const double w = std::min(1.0, 4.0 * a);
        const float x[2] = {l[i], r[i]};
        if (k[i] < 0.0) {
            const double m = 0.5 * (std::fabs(x[0]) + std::fabs(x[1]));
            huelle_ += (m - huelle_) * (m > huelle_ ? h_an : h_ab);
            spitze_ = m > spitze_ ? m : spitze_ + (m - spitze_) * s_ab;
            const double schwelle = spitze_ * a * (0.1 + 0.7 * p_);
            const double ziel = huelle_ > schwelle ? 1.0 : 0.0;
            gate_ += (ziel - gate_) * (ziel > gate_ ? g_an : g_ab);
            const double g = 1.0 - w + w * gate_;
            l[i] = static_cast<float>(x[0] * g);
            r[i] = static_cast<float>(x[1] * g);
        } else {
            if (k[i] != k_alt) {
                k_alt = k[i];
                c = koef(fc, 0.7 + 9.3 * a * a, fs_);
            }
            for (int ch = 0; ch < 2; ++ch) {
                double lp, bp, hp;
                schritt(f_[0][ch], x[ch], c, lp, bp, hp);
                (ch == 0 ? l : r)[i] = static_cast<float>(x[ch] * (1.0 - w) + c.d * bp * w);
            }
        }
    }
}

// NOISE: weißes Rauschen durch ein Filter in den Kanal gemischt. Links Tiefpass 18 kHz → 250 Hz, rechts Hochpass
// 250 Hz → 14 kHz; der Anteil wächst mit dem Regler, PARAMETER = Rauschpegel (−36 bis −6 dBFS am Anschlag).
void ColorFx::noise(float* l, float* r, int n, const double* k) {
    const double pegel = std::pow(10.0, (-36.0 + 30.0 * p_) / 20.0);
    double k_alt = NAN;
    Koef c;
    for (int i = 0; i < n; ++i) {
        const double a = anteil(k[i]);
        if (k[i] != k_alt) {
            k_alt = k[i];
            c = k[i] < 0.0 ? koef(expo(a, 18000.0, 250.0), 0.707, fs_) : koef(expo(a, 250.0, 14000.0), 0.707, fs_);
        }
        for (int ch = 0; ch < 2; ++ch) {
            double lp, bp, hp;
            schritt(f_[0][ch], zufall(rng_[ch]), c, lp, bp, hp);
            const double z = k[i] < 0.0 ? lp : hp;
            float& y = (ch == 0 ? l : r)[i];
            y = static_cast<float>(y + a * pegel * z);
        }
    }
}

// CRUSH: links Verzerrung (Bittiefe 16 → 4, Abtasthalt bis 1/24), rechts dasselbe vor einem Hochpass
// 20 Hz → 8 kHz; PARAMETER verstärkt die Wirkung.
void ColorFx::crush(float* l, float* r, int n, const double* k) {
    const double s = 0.3 + 0.7 * p_;
    double k_alt = NAN;
    Koef c;
    for (int i = 0; i < n; ++i) {
        const double a = anteil(k[i]);
        const double tiefe = a * s;
        const double w = std::min(1.0, 4.0 * a);
        const double stufen = std::exp2(15.0 - 12.0 * tiefe);
        const int halten = 1 + static_cast<int>(23.0 * tiefe * tiefe);
        const double treib = 1.0 + 5.0 * tiefe;
        if (k[i] > 0.0 && k[i] != k_alt) {
            k_alt = k[i];
            c = koef(expo(a, 20.0, 8000.0), 0.707, fs_);
        }
        const bool neu = halt_zaehler_ <= 0;
        if (neu) halt_zaehler_ = halten;
        --halt_zaehler_;
        const float x[2] = {l[i], r[i]};
        for (int ch = 0; ch < 2; ++ch) {
            if (neu) {
                const double v = std::tanh(x[ch] * treib) / treib;
                halt_[ch] = static_cast<float>(std::round(v * stufen) / stufen);
            }
            double z = halt_[ch];
            if (k[i] > 0.0) {
                double lp, bp, hp;
                schritt(f_[0][ch], z, c, lp, bp, hp);
                z = hp;
            }
            (ch == 0 ? l : r)[i] = static_cast<float>(x[ch] * (1.0 - w) + z * w);
        }
    }
}

}  // namespace cypherdj::dsp
