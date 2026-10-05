// Ohr Task 16: der Kanalzug lässt sich vor und nach dem Abgriff teilen (additiv zur Naht, test_naht bleibt unverändert).
// verarbeite() == verarbeite_vor() + verarbeite_nach(), bitgleich über mehrere Blöcke mit Rampen, Verlauf und Sends.
#include <cypherdj/dsp/kanalzug.h>

#include <cstring>
#include <memory>
#include <vector>

#include "pruef.h"

using namespace cypherdj::dsp;

namespace {

std::vector<float> rauschen(int n, unsigned saat) {
    std::vector<float> x(n);
    unsigned s = saat;
    for (float& v : x) { s = s * 1664525u + 1013904223u; v = static_cast<float>((s >> 8) * (1.0 / 16777216.0) - 0.5); }
    return x;
}

bool bitgleich(const std::vector<float>& a, const std::vector<float>& b) {
    return a.size() == b.size() && std::memcmp(a.data(), b.data(), a.size() * sizeof(float)) == 0;
}

std::unique_ptr<Kanalzug> aufbau() {
    auto kz = std::make_unique<Kanalzug>();
    kz->setze_sofort(Regler::trim, -3.0f);
    kz->setze_sofort(Regler::eq_tief, -4.0f);
    kz->setze(Regler::kill_mitte, 1.0f);            // Schaltrampe läuft über mehrere Blöcke mit
    kz->rampe(Regler::filter, -0.5f, 6000, Form::s_kurve);
    kz->rampe(Regler::fader, -12.0f, 9000, Form::linear);
    kz->setze_sofort(Regler::send_1, -6.0f);
    kz->rampe(Regler::send_2, -3.0f, 4000, Form::linear);
    return kz;
}

}  // namespace

int main() {
    const int blocke[] = {256, 100, 1024, 37, 512, 256, 256, 700, 64, 256};
    int gesamt = 0;
    for (int n : blocke) gesamt += n;
    const auto x = rauschen(gesamt, 5), y = rauschen(gesamt, 9);

    // Beide Wege über alle Blöcke, mit Verlauf des Faders im letzten Drittel: bitgleich in Haupt, Sends und Abgriff.
    {
        auto a = aufbau(), b = aufbau();
        std::vector<float> ha_l(gesamt), ha_r(gesamt), hb_l(gesamt), hb_r(gesamt);
        std::vector<float> sa1(gesamt, 0.25f), sa2(gesamt, 0.25f), sb1(gesamt, 0.25f), sb2(gesamt, 0.25f);   // += auf Vorbelegung
        std::vector<float> aa(gesamt), ab(gesamt);
        std::vector<float> verlauf(1024, -20.0f);
        int p = 0, nr = 0;
        for (int n : blocke) {
            if (++nr > 7) {                           // Bahnen der Blöcke 8..10 hängen an einem Verlauf
                a->verlauf(Regler::fader, verlauf.data());
                b->verlauf(Regler::fader, verlauf.data());
            }
            KanalzugAusgang oa, ob;
            oa.haupt_l = &ha_l[p]; oa.haupt_r = &ha_r[p];
            oa.send_l[0] = &sa1[p]; oa.send_r[0] = &sa1[p]; oa.send_l[1] = &sa2[p]; oa.send_r[1] = &sa2[p];
            ob.haupt_l = &hb_l[p]; ob.haupt_r = &hb_r[p];
            ob.send_l[0] = &sb1[p]; ob.send_r[0] = &sb1[p]; ob.send_l[1] = &sb2[p]; ob.send_r[1] = &sb2[p];
            a->verarbeite(&x[p], &y[p], n, oa);
            b->verarbeite_vor(&x[p], &y[p], n);
            b->verarbeite_nach(n, ob);
            for (int k = 0; k < 2; ++k)
                PRUEF(std::memcmp(a->abgriff(k), b->abgriff(k), static_cast<std::size_t>(n) * sizeof(float)) == 0);
            std::memcpy(&aa[p], a->abgriff(0), static_cast<std::size_t>(n) * sizeof(float));
            std::memcpy(&ab[p], b->abgriff(0), static_cast<std::size_t>(n) * sizeof(float));
            p += n;
        }
        PRUEF(bitgleich(ha_l, hb_l));
        PRUEF(bitgleich(ha_r, hb_r));
        PRUEF(bitgleich(sa1, sb1));
        PRUEF(bitgleich(sa2, sb2));
        PRUEF(bitgleich(aa, ab));
        PRUEF(ha_l[gesamt - 1] != 0.0f);                     // der Lauf hat wirklich Signal geführt
        for (int r = 0; r < kAnzahlRegler; ++r)
            PRUEF(a->wert(static_cast<Regler>(r)) == b->wert(static_cast<Regler>(r)));
    }

    // Die Naht in der Mitte: abgriff_schreibbar() ist derselbe Puffer wie abgriff(), und der Fader hängt an ihm.
    {
        auto kz = std::make_unique<Kanalzug>();
        kz->setze_sofort(Regler::fader, 0.0f);
        const auto in = rauschen(256, 3);
        std::vector<float> hl(256, 7.0f), hr(256, 7.0f);
        KanalzugAusgang aus;
        aus.haupt_l = hl.data(); aus.haupt_r = hr.data();
        kz->verarbeite_vor(in.data(), in.data(), 256);
        for (int k = 0; k < 2; ++k) PRUEF(kz->abgriff_schreibbar(k) == kz->abgriff(k));
        PRUEF(kz->abgriff_schreibbar(0) != kz->abgriff_schreibbar(1));
        for (int i = 0; i < 256; ++i) { kz->abgriff_schreibbar(0)[i] = 0.5f; kz->abgriff_schreibbar(1)[i] = -0.5f; }
        kz->verarbeite_nach(256, aus);                      // Fader 0 dB: Haupt = Abgriff
        bool ok = true;
        for (int i = 0; i < 256; ++i) ok = ok && hl[i] == 0.5f && hr[i] == -0.5f;
        PRUEF(ok);
    }
    return pruef::ende();
}
