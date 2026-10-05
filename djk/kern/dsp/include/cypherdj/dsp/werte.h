// Werte und Einheiten des Kanalzugs (SCHNITTSTELLEN.md §1.1, §1.2, §1.5, §1.6).
// Diese Datei ist Teil der öffentlichen Naht der Bibliothek cypherdj_dsp (Scheibe 04).
// Spätere Scheiben (14, 22) ergänzen nur, sie ändern keine Signatur.
#pragma once

#include <algorithm>
#include <cmath>

namespace cypherdj::dsp {

inline constexpr double kAbtastrate = 48000.0;      // §1.1: überall 48 000 Hz
inline constexpr int kMaxFrames = 1024;             // größter Teilblock je verarbeite()-Aufruf
inline constexpr float kStummDb = -200.0f;          // §1.2: stumm = −200,0
inline constexpr float kStummGrenzeDb = -120.0f;    // §1.2: jeder Wert ≤ −120,0 gilt als stumm
inline constexpr float kRampenAnkerDb = -60.0f;     // §1.2: Rampen von/nach stumm laufen bis/ab −60 dB
inline constexpr float kTrimMinDb = -24.0f;         // §1.5 Trim-Bereich
inline constexpr float kTrimMaxDb = 24.0f;

// §1.2: stumm, wenn ≤ −120 dB. NaN ist nie stumm (NaN wird vorher verworfen).
inline bool ist_stumm(double db) { return db <= kStummGrenzeDb; }

// Stumm wird immer als −200 geführt, alles andere bleibt.
inline float normiere_db(float db) { return ist_stumm(db) ? kStummDb : db; }

// dB → linear. Stumm ist exakt 0, 0 dB ist exakt 1 (exp(0) == 1).
inline constexpr double kLn10Durch20 = 0.11512925464970228420;  // ln(10) / 20
inline double db_zu_linear(double db) { return ist_stumm(db) ? 0.0 : std::exp(db * kLn10Durch20); }

// §1.2, Rampe in dB zwischen `von` und `nach`, u in [0, 1] (Form schon angewendet).
// Ist ein Ende stumm, läuft die Rampe bis/ab −60 dB und setzt am stummen Ende −200.
// Liegt das andere Ende unter −60 dB, gilt statt −60 dieses Ende (sonst liefe die Rampe
// erst über das Ziel hinaus); Auslegung dieser Scheibe, im Bericht vermerkt.
inline double rampe_db_wert(double von, double nach, double u) {
    const bool von_stumm = ist_stumm(von);
    const bool nach_stumm = ist_stumm(nach);
    if (von_stumm && nach_stumm) return kStummDb;
    if (u <= 0.0) return von_stumm ? kStummDb : von;
    if (u >= 1.0) return nach_stumm ? kStummDb : nach;
    const double a = von_stumm ? std::min<double>(kRampenAnkerDb, nach) : von;
    const double b = nach_stumm ? std::min<double>(kRampenAnkerDb, von) : nach;
    return a + (b - a) * u;
}

// §4.3 Form 1: S-Kurve u ↦ 3u² − 2u³.
inline double s_kurve(double u) { return u * u * (3.0 - 2.0 * u); }

// §1.6: Kanalpegel = Trim + Fader, stumm als −200 geführt.
inline float kanalpegel_db(float trim_db, float fader_db) {
    return normiere_db(std::max(kStummDb, trim_db + fader_db));
}

// §1.5 Vorgabe des Trims beim Laden: ziel_lufs − lufs_integriert, auf −24 … +24 begrenzt.
inline float trim_aus_lufs(float ziel_lufs, float lufs_integriert) {
    return std::clamp(ziel_lufs - lufs_integriert, kTrimMinDb, kTrimMaxDb);
}

}  // namespace cypherdj::dsp
