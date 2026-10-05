// Task 10: die öffentliche Naht festhalten. Jede Signatur, die Scheibe 25 (und 14, 22) benutzt, ist hier
// als static_assert eingefroren. Eine Änderung einer bestehenden Signatur oder Reihenfolge bricht den Bau
// dieses Tests. Ergänzen (neue Funktionen, neue Regler hinten) bricht ihn nicht.
#include <cypherdj/dsp/kanalzug.h>

#include <cstdint>
#include <type_traits>

using namespace cypherdj::dsp;

// Kanalzug
static_assert(std::is_same_v<decltype(&Kanalzug::verarbeite),
                             void (Kanalzug::*)(const float*, const float*, int, const KanalzugAusgang&)>);
static_assert(std::is_same_v<decltype(&Kanalzug::setze), void (Kanalzug::*)(Regler, float)>);
static_assert(std::is_same_v<decltype(&Kanalzug::setze_sofort), void (Kanalzug::*)(Regler, float)>);
static_assert(std::is_same_v<decltype(&Kanalzug::rampe), bool (Kanalzug::*)(Regler, float, std::int64_t, Form)>);
static_assert(std::is_same_v<decltype(&Kanalzug::verlauf), bool (Kanalzug::*)(Regler, const float*)>);
static_assert(std::is_same_v<decltype(&Kanalzug::wert), float (Kanalzug::*)(Regler) const>);
static_assert(std::is_same_v<decltype(&Kanalzug::ziel), float (Kanalzug::*)(Regler) const>);
static_assert(std::is_same_v<decltype(&Kanalzug::faehrt), bool (Kanalzug::*)(Regler) const>);
static_assert(std::is_same_v<decltype(&Kanalzug::kanalpegel_db), float (Kanalzug::*)() const>);
static_assert(std::is_same_v<decltype(&Kanalzug::abgriff), const float* (Kanalzug::*)(int) const>);
static_assert(std::is_same_v<decltype(&Kanalzug::band), const float* (Kanalzug::*)(Band, int) const>);
static_assert(std::is_same_v<decltype(&Kanalzug::zuruecksetzen), void (Kanalzug::*)()>);
static_assert(std::is_constructible_v<Kanalzug, double>);
static_assert(std::is_same_v<decltype(KanalzugAusgang::haupt_l), float*>);
static_assert(std::is_same_v<decltype(KanalzugAusgang::send_l), float* [4]>);
static_assert(kAnzahlSends == 4);

// Regler: Reihenfolge und Anzahl (Tabellen in 25 indizieren danach)
static_assert(static_cast<int>(Regler::trim) == 0);
static_assert(static_cast<int>(Regler::eq_tief) == 1 && static_cast<int>(Regler::eq_hoch) == 3);
static_assert(static_cast<int>(Regler::kill_tief) == 4 && static_cast<int>(Regler::kill_hoch) == 6);
static_assert(static_cast<int>(Regler::filter) == 7 && static_cast<int>(Regler::fader) == 8);
static_assert(static_cast<int>(Regler::send_1) == 9 && static_cast<int>(Regler::send_4) == 12);
static_assert(kAnzahlRegler == 13);
static_assert(std::is_same_v<decltype(&regler_aus_pfad), std::optional<Regler> (*)(std::string_view)>);

// Formen (§4.3 Feld `form`) und Bänder
static_assert(static_cast<int>(Form::linear) == 0 && static_cast<int>(Form::s_kurve) == 1);
static_assert(static_cast<int>(Band::tief) == 0 && static_cast<int>(Band::mitte) == 1 && static_cast<int>(Band::hoch) == 2);

// Werte (§1.2, §1.6)
static_assert(kStummDb == -200.0f && kStummGrenzeDb == -120.0f && kRampenAnkerDb == -60.0f);
static_assert(kMaxFrames == 1024 && kAbtastrate == 48000.0);
static_assert(std::is_same_v<decltype(&db_zu_linear), double (*)(double)>);
static_assert(std::is_same_v<decltype(&rampe_db_wert), double (*)(double, double, double)>);
static_assert(std::is_same_v<decltype(static_cast<float (*)(float, float)>(&kanalpegel_db)), float (*)(float, float)>);
static_assert(std::is_same_v<decltype(&trim_aus_lufs), float (*)(float, float)>);

// Bausteine, die 14 und 22 wiederverwenden
static_assert(std::is_same_v<decltype(&tiefpass_2), BiquadKoeff (*)(double, double, double)>);
static_assert(std::is_same_v<decltype(&Biquad::schritt), double (Biquad::*)(double)>);
static_assert(std::is_same_v<decltype(&Bahn::block), bool (Bahn::*)(double*, int)>);
static_assert(std::is_same_v<decltype(&Bahn::verlauf), bool (Bahn::*)(const float*)>);
static_assert(std::is_same_v<decltype(&Isolator::band), const float* (Isolator::*)(Band, int) const>);
static_assert(static_cast<int>(Schaltform::s_kurve) == 0 && static_cast<int>(Schaltform::zweite_ordnung) == 1 &&
              static_cast<int>(Schaltform::glaettung) == 2);

int main() { return 0; }
