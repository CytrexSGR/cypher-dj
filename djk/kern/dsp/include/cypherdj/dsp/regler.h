// Regler des Kanalzugs nach SCHNITTSTELLEN.md §1.5 (Pfad, Einheit, Bereich, Vorgabe, Schaltrampe).
// Teil der öffentlichen Naht von cypherdj_dsp (Scheibe 04). Neue Regler nur hinten anfügen (vor `anzahl`).
#pragma once

#include <array>
#include <cstdint>
#include <optional>
#include <string_view>

namespace cypherdj::dsp {

enum class Regler : std::uint8_t {
    trim,
    eq_tief,
    eq_mitte,
    eq_hoch,
    kill_tief,
    kill_mitte,
    kill_hoch,
    filter,
    fader,
    send_1,
    send_2,
    send_3,
    send_4,
    anzahl
};
inline constexpr int kAnzahlRegler = static_cast<int>(Regler::anzahl);

enum class Einheit : std::uint8_t { db, schalter, filter };

// Wie ein Setzen mit dauer_beats = 0 gefahren wird (§1.5 Spalte „Schaltrampe“).
enum class Schaltform : std::uint8_t {
    s_kurve,         // S-Kurve 3u²−2u³ über genau schaltrampe_ms, in der Einheit (dB mit §1.2)
    zweite_ordnung,  // Schalter: S-Rampe fester Länge, Steigung am Anfang und Ende 0 (04 NP K2, Auslegung Scheibe 04)
    glaettung        // ein Einpol-Glätter mit Zeitkonstante schaltrampe_ms (04 §4.6)
};

struct ReglerInfo {
    std::string_view pfad;   // Teil nach "<k>/", z. B. "eq/tief"
    Einheit einheit;
    float min;
    float max;
    float vorgabe;           // Trim: Busse 0; Decks setzen beim Laden trim_aus_lufs()
    float schaltrampe_ms;
    Schaltform form;
};

inline constexpr std::array<ReglerInfo, kAnzahlRegler> kReglerInfo{{
    {"trim", Einheit::db, -24.0f, 24.0f, 0.0f, 10.0f, Schaltform::s_kurve},
    {"eq/tief", Einheit::db, -200.0f, 6.0f, 0.0f, 10.0f, Schaltform::s_kurve},
    {"eq/mitte", Einheit::db, -200.0f, 6.0f, 0.0f, 10.0f, Schaltform::s_kurve},
    {"eq/hoch", Einheit::db, -200.0f, 6.0f, 0.0f, 10.0f, Schaltform::s_kurve},
    {"kill/tief", Einheit::schalter, 0.0f, 1.0f, 0.0f, 5.0f, Schaltform::zweite_ordnung},
    {"kill/mitte", Einheit::schalter, 0.0f, 1.0f, 0.0f, 5.0f, Schaltform::zweite_ordnung},
    {"kill/hoch", Einheit::schalter, 0.0f, 1.0f, 0.0f, 5.0f, Schaltform::zweite_ordnung},
    {"filter", Einheit::filter, -1.0f, 1.0f, 0.0f, 20.0f, Schaltform::glaettung},
    {"fader", Einheit::db, -200.0f, 0.0f, -200.0f, 10.0f, Schaltform::s_kurve},
    {"send/1", Einheit::db, -200.0f, 0.0f, -200.0f, 10.0f, Schaltform::s_kurve},
    {"send/2", Einheit::db, -200.0f, 0.0f, -200.0f, 10.0f, Schaltform::s_kurve},
    {"send/3", Einheit::db, -200.0f, 0.0f, -200.0f, 10.0f, Schaltform::s_kurve},
    {"send/4", Einheit::db, -200.0f, 0.0f, -200.0f, 10.0f, Schaltform::s_kurve},
}};

inline const ReglerInfo& info(Regler r) { return kReglerInfo[static_cast<int>(r)]; }

// "fader", "eq/tief", "send/3" … → Regler; alles andere (auch "stem/bass", "xseite") → leer.
std::optional<Regler> regler_aus_pfad(std::string_view teilpfad);

}  // namespace cypherdj::dsp
