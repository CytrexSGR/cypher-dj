// Task 1: §1.2 und §1.6 als Funktionen.
#include <cypherdj/dsp/werte.h>

#include <limits>

#include "pruef.h"

using namespace cypherdj::dsp;

int main() {
    // stumm: −200 und alles ≤ −120 ergibt exakt 0; 0 dB exakt 1.
    PRUEF(db_zu_linear(-200.0) == 0.0);
    PRUEF(db_zu_linear(-120.0) == 0.0);
    PRUEF(db_zu_linear(-119.9) > 0.0);
    PRUEF(db_zu_linear(0.0) == 1.0);
    PRUEF_NAH(db_zu_linear(-6.0), 0.501187233627, 1e-12);
    PRUEF(normiere_db(-150.0f) == kStummDb);
    PRUEF(normiere_db(-60.0f) == -60.0f);
    PRUEF(!ist_stumm(std::numeric_limits<double>::quiet_NaN()));

    // Abnahme: dB-Rampe von −200 nach 0 beginnt bei −60 dB (§1.2).
    const int n = 480;  // Schaltrampe 10 ms
    PRUEF(rampe_db_wert(-200, 0, 0.0) == kStummDb);            // am Startsample noch stumm
    PRUEF_NAH(rampe_db_wert(-200, 0, 1.0 / n), -60.0 + 60.0 / n, 1e-12);
    PRUEF_NAH(rampe_db_wert(-200, 0, 0.5), -30.0, 1e-12);
    PRUEF(rampe_db_wert(-200, 0, 1.0) == 0.0);
    // Fehlerfall zum Vergleich: eine naive lineare dB-Rampe ab −200 stünde in der Mitte bei −100 dB
    // (unhörbar), die Regel bei −30 dB.
    const double naiv_mitte = -200.0 + (0.0 - -200.0) * 0.5;
    PRUEF_NAH(naiv_mitte, -100.0, 1e-12);
    PRUEF(rampe_db_wert(-200, 0, 0.5) - naiv_mitte > 60.0);
    // nach stumm: läuft bis −60, setzt am Ende −200.
    PRUEF_NAH(rampe_db_wert(0, -200, 0.5), -30.0, 1e-12);
    PRUEF_NAH(rampe_db_wert(0, -200, 1.0 - 1.0 / n), -60.0 + 60.0 / n, 1e-9);
    PRUEF(rampe_db_wert(0, -200, 1.0) == kStummDb);
    // Auslegung: anderes Ende unter −60 → kein Umweg über −60.
    PRUEF(rampe_db_wert(-200, -80, 0.5) == -80.0);
    PRUEF(rampe_db_wert(-80, -200, 0.5) == -80.0);
    PRUEF(rampe_db_wert(-200, -200, 0.5) == kStummDb);
    // Negativ-Kontrolle: ohne stummes Ende ist es die gewöhnliche lineare dB-Rampe (Golden-Folge teil_rampe).
    PRUEF_NAH(rampe_db_wert(-15, 0, 0.5), -7.5, 1e-12);
    PRUEF_NAH(rampe_db_wert(-80, 0, 0.25), -60.0, 1e-12);

    // S-Kurve (§4.3 Form 1)
    PRUEF(s_kurve(0.0) == 0.0);
    PRUEF(s_kurve(1.0) == 1.0);
    PRUEF_NAH(s_kurve(0.5), 0.5, 1e-15);

    // §1.6 Kanalpegel und §1.5 Trim-Vorgabe
    PRUEF(kanalpegel_db(6.0f, -200.0f) == kStummDb);
    PRUEF(kanalpegel_db(-24.0f, -200.0f) == kStummDb);
    PRUEF_NAH(kanalpegel_db(3.0f, -10.0f), -7.0, 1e-6);
    PRUEF_NAH(trim_aus_lufs(-16.0f, -14.0f), -2.0, 1e-6);
    PRUEF(trim_aus_lufs(-16.0f, -50.0f) == kTrimMaxDb);
    PRUEF(trim_aus_lufs(-16.0f, 20.0f) == kTrimMinDb);
    return pruef::ende();
}
