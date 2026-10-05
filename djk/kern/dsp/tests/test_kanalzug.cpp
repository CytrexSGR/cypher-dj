// Task 6: Kanalzug als Ganzes. Negativ-Kontrolle der Abnahme, Fader, Sends, Abgriffe, Teilblöcke, Verlauf.
#include <cypherdj/dsp/kanalzug.h>

#include <cmath>
#include <cstdio>
#include <cstring>
#include <memory>
#include <vector>

#include "messen.h"
#include "pruef.h"

using namespace cypherdj::dsp;

namespace {

std::vector<float> rauschen(int n, unsigned saat) {
    std::vector<float> x(n);
    unsigned s = saat;
    for (float& v : x) { s = s * 1664525u + 1013904223u; v = static_cast<float>((s >> 8) * (1.0 / 16777216.0) - 0.5); }
    return x;
}

struct Lauf {
    std::vector<float> l, r, abgriff;
};

// Läuft x (L = R = x) in Blöcken der Länge `block` durch den Kanalzug; sammelt Haupt und Abgriff (L).
Lauf durch(Kanalzug& kz, const std::vector<float>& x, int block = 256, std::vector<float>* send1 = nullptr) {
    Lauf o{std::vector<float>(x.size()), std::vector<float>(x.size()), std::vector<float>(x.size())};
    for (std::size_t p = 0; p < x.size(); p += block) {
        const int n = static_cast<int>(std::min<std::size_t>(block, x.size() - p));
        KanalzugAusgang aus;
        aus.haupt_l = &o.l[p];
        aus.haupt_r = &o.r[p];
        if (send1) { aus.send_l[0] = &(*send1)[p]; aus.send_r[0] = &(*send1)[p]; }
        kz.verarbeite(&x[p], &x[p], n, aus);
        std::memcpy(&o.abgriff[p], kz.abgriff(0), static_cast<std::size_t>(n) * sizeof(float));
    }
    return o;
}

// Referenz: derselbe Isolator allein in Neutralstellung, Eingang mal Trim (float wie im Kanalzug).
std::vector<float> iso_neutral(const std::vector<float>& x, float trim_db) {
    auto iso = std::make_unique<Isolator>();
    const float g = static_cast<float>(db_zu_linear(trim_db));
    std::vector<float> a(x.size()), y(x.size()), dummy(x.size()), eins(kMaxFrames, 1.0f);
    for (std::size_t i = 0; i < x.size(); ++i) a[i] = x[i] * g;
    for (std::size_t p = 0; p < x.size(); p += 256) {
        const int n = static_cast<int>(std::min<std::size_t>(256, x.size() - p));
        iso->verarbeite(&a[p], &a[p], &y[p], &dummy[p], n, eins.data(), eins.data(), eins.data());
    }
    return y;
}

bool bitgleich(const std::vector<float>& a, const std::vector<float>& b) {
    return a.size() == b.size() && std::memcmp(a.data(), b.data(), a.size() * sizeof(float)) == 0;
}

std::unique_ptr<Kanalzug> neutral(float trim_db) {
    auto kz = std::make_unique<Kanalzug>();
    kz->setze_sofort(Regler::trim, trim_db);
    kz->setze_sofort(Regler::fader, 0.0f);
    return kz;
}

}  // namespace

int main() {
    const auto x = rauschen(48000, 7);

    // Negativ-Kontrolle der Abnahme, Teil 1: alle Regler auf Vorgabe (§1.5, wie nach dem Laden: Trim gesetzt,
    // Fader −200, Sends −200, EQ 0, Kill 0, Filter 0). Haupt exakt 0, Bus unberührt, Abgriff (vor dem Fader)
    // bitgleich zu Isolator_neutral(Eingang · Trim).
    for (float trim : {0.0f, -7.5f, 12.0f}) {
        auto kz = std::make_unique<Kanalzug>();
        kz->setze_sofort(Regler::trim, trim);
        std::vector<float> bus = rauschen(48000, 99), bus0 = bus;
        const auto o = durch(*kz, x, 256, &bus);
        bool null = true;
        for (float v : o.l) null = null && v == 0.0f;
        PRUEF(null);
        PRUEF(bitgleich(bus, bus0));
        PRUEF(bitgleich(o.abgriff, iso_neutral(x, trim)));
        PRUEF(kz->kanalpegel_db() == kStummDb);
    }
    // Teil 2: Fader 0 dB, sonst Vorgabe → Haupt bitgleich zu Isolator_neutral(Eingang · Trim), L gleich R.
    for (float trim : {0.0f, -7.5f, 12.0f}) {
        auto kz = neutral(trim);
        const auto o = durch(*kz, x);
        PRUEF(bitgleich(o.l, iso_neutral(x, trim)));
        PRUEF(bitgleich(o.l, o.r));
        PRUEF(bitgleich(o.l, o.abgriff));   // Fader 0 dB ist Gain exakt 1
    }
    // Fehlerfall zum Vergleich: gegen den rohen Eingang mal Trim ist der Ausgang NICHT bitgleich, weil der
    // LR8-Isolator auch bei 0 dB ein Allpass ist (Mixxx: „not fully dry at unity“; Betrag flach: test_isolator).
    {
        auto kz = neutral(0.0f);
        const auto o = durch(*kz, x);
        double max_abw = 0.0;
        for (std::size_t i = 0; i < x.size(); ++i) max_abw = std::max(max_abw, std::fabs(static_cast<double>(o.l[i]) - x[i]));
        std::printf("neutral gegen rohen Eingang: nicht bitgleich, max |y-x| = %.4f (LR8-Allpass)\n", max_abw);
        PRUEF(!bitgleich(o.l, x));
        PRUEF(max_abw > 0.01);
    }
    // Fader −6 dB: Haupt = Abgriff · g(−6 dB) bitgleich; Kanalpegel = Trim + Fader.
    {
        auto kz = neutral(3.0f);
        kz->setze_sofort(Regler::fader, -6.0f);
        std::vector<float> l(256), r(256);
        KanalzugAusgang aus;
        aus.haupt_l = l.data();
        aus.haupt_r = r.data();
        kz->verarbeite(x.data(), x.data(), 256, aus);
        const float g = static_cast<float>(db_zu_linear(-6.0));
        bool gleich = true;
        for (int i = 0; i < 256; ++i) gleich = gleich && l[i] == kz->abgriff(0)[i] * g;
        PRUEF(gleich);
        PRUEF_NAH(kz->kanalpegel_db(), -3.0, 1e-6);
    }
    // Sends nach dem Fader: 0 dB → Bus += Haupt; der Send ändert den Hauptweg nicht.
    {
        auto kz = neutral(0.0f);
        kz->setze_sofort(Regler::fader, -6.0f);
        const auto o = durch(*kz, x);
        auto kz2 = neutral(0.0f);
        kz2->setze_sofort(Regler::fader, -6.0f);
        kz2->setze_sofort(Regler::send_1, 0.0f);
        std::vector<float> bus2(48000, 0.0f), nur_r(48000, 0.0f);
        Lauf o2{std::vector<float>(48000), std::vector<float>(48000), {}};
        for (int p = 0; p < 48000; p += 256) {
            KanalzugAusgang aus;
            aus.haupt_l = &o2.l[p];
            aus.haupt_r = &o2.r[p];
            aus.send_l[0] = &bus2[p];
            aus.send_r[0] = &nur_r[p];
            kz2->verarbeite(&x[p], &x[p], std::min(256, 48000 - p), aus);
        }
        PRUEF(bitgleich(bus2, o2.l));      // 0 + Haupt·1 == Haupt
        PRUEF(bitgleich(o2.l, o.l));
    }
    // Teilblöcke: 100 + 156 Samples liefern bitgleich dasselbe wie 256 (Ereignisse mitten im Block).
    {
        auto a = neutral(0.0f), b = neutral(0.0f);
        a->setze(Regler::eq_tief, -12.0f);
        b->setze(Regler::eq_tief, -12.0f);
        a->setze(Regler::kill_mitte, 1.0f);
        b->setze(Regler::kill_mitte, 1.0f);
        const auto oa = durch(*a, x, 256);
        std::vector<float> lb(x.size()), rb(x.size());
        for (std::size_t p = 0; p < x.size();) {
            const int n = static_cast<int>(std::min<std::size_t>((p / 100) % 2 ? 156 : 100, x.size() - p));
            KanalzugAusgang aus;
            aus.haupt_l = &lb[p];
            aus.haupt_r = &rb[p];
            b->verarbeite(&x[p], &x[p], n, aus);
            p += static_cast<std::size_t>(n);
        }
        PRUEF(bitgleich(oa.l, lb));
    }
    // An Ort und Stelle: in == haupt
    {
        auto a = neutral(-3.0f), b = neutral(-3.0f);
        const auto oa = durch(*a, x);
        std::vector<float> l = x, r = x;
        for (int p = 0; p < 48000; p += 256) {
            KanalzugAusgang aus;
            aus.haupt_l = &l[p];
            aus.haupt_r = &r[p];
            b->verarbeite(&l[p], &r[p], std::min(256, 48000 - p), aus);
        }
        PRUEF(bitgleich(oa.l, l));
    }
    // Verlauf (Naht zu 11 und 25), Negativ-Kontrolle: ein Verlauf mit dem Ist-Wert ändert nichts.
    {
        auto a = neutral(0.0f), b = neutral(0.0f);
        a->setze_sofort(Regler::fader, -6.0f);
        b->setze_sofort(Regler::fader, -6.0f);
        const auto oa = durch(*a, x);
        std::vector<float> lb(x.size()), rb(x.size()), konst(256, -6.0f);
        for (int p = 0; p < 48000; p += 256) {
            b->verlauf(Regler::fader, konst.data());
            KanalzugAusgang aus;
            aus.haupt_l = &lb[p];
            aus.haupt_r = &rb[p];
            b->verarbeite(&x[p], &x[p], std::min(256, 48000 - p), aus);
        }
        PRUEF(bitgleich(oa.l, lb));
    }
    // Verlauf mit Stufe mitten im Block = geteilter Block mit setze_sofort am selben Sample (bitgleich).
    {
        auto a = neutral(0.0f), b = neutral(0.0f);
        std::vector<float> la(256), ra(256), lb(256), rb(256), stufe(256, 0.0f);
        for (int i = 100; i < 256; ++i) stufe[i] = -6.0f;
        KanalzugAusgang aa, ab;
        aa.haupt_l = la.data(); aa.haupt_r = ra.data();
        a->verarbeite(x.data(), x.data(), 100, aa);
        a->setze_sofort(Regler::fader, -6.0f);
        aa.haupt_l = la.data() + 100; aa.haupt_r = ra.data() + 100;
        a->verarbeite(x.data() + 100, x.data() + 100, 156, aa);
        ab.haupt_l = lb.data(); ab.haupt_r = rb.data();
        PRUEF(b->verlauf(Regler::fader, stufe.data()));
        b->verarbeite(x.data(), x.data(), 256, ab);
        PRUEF(bitgleich(la, lb));
        PRUEF(b->wert(Regler::fader) == -6.0f && !b->faehrt(Regler::fader));
    }
    // Hin und zurück (a-EQ-Fehler aus 05 §4.1: Glättung blieb 0,05 dB vor dem Ziel stehen):
    // alles bewegen, alles per setze zurück, 3 s weiter → wieder bitgleich zur Referenz.
    {
        auto kz = neutral(0.0f);
        const auto lang = rauschen(4 * 48000, 3);
        kz->setze(Regler::eq_tief, -26.0f);
        kz->setze(Regler::eq_hoch, 4.0f);
        kz->setze(Regler::kill_mitte, 1.0f);
        kz->setze(Regler::filter, -0.6f);
        kz->setze(Regler::fader, -9.0f);
        kz->setze(Regler::send_2, -3.0f);
        std::vector<float> teil(lang.begin(), lang.begin() + 48000);
        durch(*kz, teil);
        kz->setze(Regler::eq_tief, 0.0f);
        kz->setze(Regler::eq_hoch, 0.0f);
        kz->setze(Regler::kill_mitte, 0.0f);
        kz->setze(Regler::filter, 0.0f);
        kz->setze(Regler::fader, 0.0f);
        kz->setze(Regler::send_2, -200.0f);
        const auto o = durch(*kz, lang);
        bool ruhe = true;
        for (int r = 0; r < kAnzahlRegler; ++r) ruhe = ruhe && !kz->faehrt(static_cast<Regler>(r));
        PRUEF(ruhe);
        // Ab 3 s: bitgleich zur Referenz ohne Vorgeschichte (die IIR-Zustände sind bis unter die
        // double-Auflösung abgeklungen, alle Gains stehen exakt auf 1).
        const auto ref = iso_neutral(lang, 0.0f);
        const std::size_t ab = 3 * 48000;
        PRUEF(std::memcmp(&o.l[ab], &ref[ab], (lang.size() - ab) * sizeof(float)) == 0);
        PRUEF(kz->wert(Regler::fader) == 0.0f && kz->wert(Regler::filter) == 0.0f);
        PRUEF(kz->wert(Regler::kill_mitte) == 0.0f && kz->wert(Regler::eq_tief) == 0.0f);
    }
    // rampe(): Schalter lehnen ab, dB-Regler nehmen an.
    {
        auto kz = neutral(0.0f);
        PRUEF(!kz->rampe(Regler::kill_tief, 1.0f, 480, Form::linear));
        PRUEF(kz->rampe(Regler::fader, -12.0f, 480, Form::s_kurve));
        PRUEF(kz->faehrt(Regler::fader));
    }
    return pruef::ende();
}
