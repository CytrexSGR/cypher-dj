// Task 3: Bahnen (Schaltrampen §1.5, Planteil-Rampen §4.3, dB-Regel §1.2, Einrasten, Verlauf von außen).
#include <cypherdj/dsp/bahn.h>

#include <cmath>
#include <cstdio>
#include <limits>
#include <vector>

#include "pruef.h"

using namespace cypherdj::dsp;

namespace {
// Fährt die Bahn n Samples und liefert die Werte je Sample.
std::vector<double> fahre(Bahn& b, int n) {
    std::vector<double> w(n);
    for (int p = 0; p < n; p += 256) {
        const int m = std::min(256, n - p);
        if (!b.block(&w[p], m)) for (int i = 0; i < m; ++i) w[p + i] = b.wert();
    }
    return w;
}
}  // namespace

int main() {
    // Vorgaben aus §1.5
    PRUEF(Bahn(Regler::fader).wert() == -200.0f);
    PRUEF(Bahn(Regler::eq_tief).wert() == 0.0f);
    PRUEF(Bahn(Regler::send_3).wert() == -200.0f);

    // Negativ-Kontrolle: ohne Befehl ruht die Bahn, block() schreibt nichts, der Wert bleibt bitgleich.
    {
        Bahn b(Regler::eq_mitte);
        double w[256] = {};
        PRUEF(!b.block(w, 256));
        PRUEF(w[0] == 0.0 && w[255] == 0.0);
        const auto v = fahre(b, 100000);
        PRUEF(v.front() == 0.0 && v.back() == 0.0);
        PRUEF(!b.faehrt());
    }

    // Schaltrampe dB (Fader −200 → 0 per setze): 10 ms = 480 Samples, S-Form, §1.2 ab −60 dB.
    {
        Bahn b(Regler::fader);
        b.setze(0.0f);
        PRUEF(b.faehrt());
        const auto v = fahre(b, 1000);
        PRUEF(v[0] == -200.0);                                       // Startsample: noch stumm (u = 0)
        const double s1 = s_kurve(1.0 / 480.0);
        PRUEF_NAH(v[1], -60.0 + 60.0 * s1, 1e-9);                    // Abnahme: beginnt bei −60 dB
        PRUEF(v[1] > -60.0 && v[1] < -59.99);
        PRUEF_NAH(v[240], -30.0, 1e-9);                              // Mitte der S-Kurve
        PRUEF(v[480] == 0.0);                                        // Ende exakt
        PRUEF(!b.faehrt());
        PRUEF(v[999] == 0.0);
        // zurück nach stumm: bis −60, am Ende −200
        b.setze(-200.0f);
        const auto z = fahre(b, 1000);
        PRUEF_NAH(z[479], -60.0 * s_kurve(479.0 / 480.0), 1e-9);
        PRUEF(z[480] == -200.0);
    }

    // Kill: §1.5 „5 ms, zweite Ordnung“ als S-Rampe fester Länge (240 Samples), Steigung am Anfang 0.
    {
        Bahn b(Regler::kill_mitte);
        b.setze(1.0f);
        const auto v = fahre(b, 1000);
        PRUEF(v[0] == 0.0);                                           // u = 0: Ist-Wert
        PRUEF_NAH(v[1], s_kurve(1.0 / 240.0), 1e-15);                 // 5,2e−5: kein Knick
        PRUEF_NAH(v[120], 0.5, 1e-15);
        PRUEF(v[239] < 1.0 && v[240] == 1.0);                         // fertig nach genau 5 ms
        PRUEF(!b.faehrt());
        // Fehlerfall zum Vergleich: ein Glätter erster Ordnung mit 5 ms springt im ersten Sample um 1−p.
        const double p5 = std::exp(-1.0 / (0.005 * 48000.0));
        PRUEF(1.0 - p5 > 50.0 * v[1]);
        b.setze(0.0f);
        const auto z = fahre(b, 1000);
        PRUEF(z[240] == 0.0 && z.back() == 0.0);                      // Rückweg exakt
    }

    // Filter: Glättung erster Ordnung 20 ms, rastet exakt auf 0 zurück (trocken).
    {
        Bahn b(Regler::filter);
        b.setze(-0.5f);
        auto v = fahre(b, 48000);
        PRUEF(v.back() == static_cast<double>(-0.5f));
        b.setze(0.0f);
        v = fahre(b, 48000);
        PRUEF(v.back() == 0.0);
    }

    // Planteil-Rampe linear in dB (Golden-Folge teil_rampe im Kleinen: −15 → 0, Mitte −7,5).
    {
        Bahn b(Regler::fader);
        b.setze_sofort(-15.0f);
        PRUEF(b.rampe(0.0f, 1000, Form::linear));
        const auto v = fahre(b, 1200);
        PRUEF(v[0] == -15.0);
        PRUEF_NAH(v[500], -7.5, 1e-12);
        PRUEF(v[1000] == 0.0 && v[1199] == 0.0);
    }
    // Rampe S in der Filter-Einheit
    {
        Bahn b(Regler::filter);
        PRUEF(b.rampe(1.0f, 100, Form::s_kurve));
        const auto v = fahre(b, 200);
        PRUEF_NAH(v[50], 0.5, 1e-12);
        PRUEF(v[100] == 1.0);
    }
    // Schalter nehmen keine Rampe; NaN und dauer < 1 werden verworfen; Bereich wird begrenzt.
    {
        Bahn k(Regler::kill_tief);
        PRUEF(!k.rampe(1.0f, 100, Form::linear));
        PRUEF(!k.faehrt());
        Bahn f(Regler::fader);
        PRUEF(!f.rampe(0.0f, 0, Form::linear));
        f.setze(std::numeric_limits<float>::quiet_NaN());
        PRUEF(!f.faehrt() && f.wert() == -200.0f);
        f.setze_sofort(12.0f);
        PRUEF(f.wert() == 0.0f);                                      // Fader max 0 dB
        Bahn t(Regler::trim);
        t.setze_sofort(-40.0f);
        PRUEF(t.wert() == -24.0f);
        Bahn e(Regler::eq_hoch);
        e.setze_sofort(-150.0f);
        PRUEF(e.wert() == -200.0f);                                   // stumm normiert
    }
    // Setzen während einer Rampe startet vom Ist-Wert (kein Sprung)
    {
        Bahn b(Regler::eq_tief);
        b.setze(-12.0f);
        auto v = fahre(b, 240);
        const double ist = b.wert();
        b.setze(0.0f);
        v = fahre(b, 2);
        PRUEF_NAH(v[0], ist, 1e-5);  // wert() ist float, die Bahn rechnet in double
    }

    // Verlauf von außen: Werte je Sample, begrenzt, NaN hält, Schalter anteilig, danach ruhend.
    {
        Bahn f(Regler::fader);
        std::vector<float> w(256);
        for (int i = 0; i < 256; ++i) w[i] = -30.0f + 0.1f * static_cast<float>(i);
        w[10] = std::numeric_limits<float>::quiet_NaN();
        w[20] = 5.0f;        // über dem Bereich (Fader max 0)
        w[30] = -130.0f;     // ≤ −120: stumm
        PRUEF(f.verlauf(w.data()));
        PRUEF(f.faehrt());
        double v[256];
        PRUEF(f.block(v, 256));
        PRUEF(v[0] == static_cast<double>(w[0]) && v[9] == static_cast<double>(w[9]));
        PRUEF(v[10] == v[9]);                                         // NaN hält den Wert davor
        PRUEF(v[20] == 0.0);
        PRUEF(v[30] == -200.0);
        PRUEF(v[255] == static_cast<double>(w[255]));
        PRUEF(!f.faehrt() && f.wert() == w[255]);                     // danach ruhend auf dem letzten Wert
        PRUEF(!f.block(v, 256));
        PRUEF(!f.verlauf(nullptr));
        Bahn k(Regler::kill_mitte);
        std::vector<float> kv(64, 0.25f);
        PRUEF(k.verlauf(kv.data()));
        PRUEF(k.block(v, 64));
        PRUEF(v[63] == 0.25 && k.wert() == 0.25f);                    // Schalter anteilig, nicht gerundet
    }
    return pruef::ende();
}
