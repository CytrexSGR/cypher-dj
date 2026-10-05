// Task 1: Reglertabelle §1.5 und Pfad-Auflösung.
#include <cypherdj/dsp/regler.h>

#include "pruef.h"

using namespace cypherdj::dsp;

int main() {
    PRUEF(kAnzahlRegler == 13);
    // Stichproben aus §1.5 (der Abgleich aller Zeilen gegen den Vertragstext: regler_gegen_vertrag.py)
    PRUEF(info(Regler::fader).vorgabe == -200.0f && info(Regler::fader).max == 0.0f);
    PRUEF(info(Regler::trim).min == -24.0f && info(Regler::trim).max == 24.0f);
    PRUEF(info(Regler::eq_mitte).max == 6.0f && info(Regler::eq_mitte).vorgabe == 0.0f);
    PRUEF(info(Regler::kill_hoch).schaltrampe_ms == 5.0f && info(Regler::kill_hoch).form == Schaltform::zweite_ordnung);
    PRUEF(info(Regler::filter).schaltrampe_ms == 20.0f && info(Regler::filter).form == Schaltform::glaettung);
    PRUEF(info(Regler::send_4).vorgabe == -200.0f);

    // Pfad → Regler, Hin und Zurück für alle
    for (int i = 0; i < kAnzahlRegler; ++i) {
        const auto r = regler_aus_pfad(kReglerInfo[i].pfad);
        PRUEF(r.has_value() && static_cast<int>(*r) == i);
    }
    PRUEF(regler_aus_pfad("eq/tief") == Regler::eq_tief);
    PRUEF(regler_aus_pfad("send/3") == Regler::send_3);
    // Negativ-Kontrolle: Pfade, die nicht zum Kanalzug gehören, und Tippfehler
    PRUEF(!regler_aus_pfad("stem/bass").has_value());
    PRUEF(!regler_aus_pfad("xseite").has_value());
    PRUEF(!regler_aus_pfad("ziel").has_value());
    PRUEF(!regler_aus_pfad("send/5").has_value());
    PRUEF(!regler_aus_pfad("deck/1/fader").has_value());
    PRUEF(!regler_aus_pfad("").has_value());
    return pruef::ende();
}
