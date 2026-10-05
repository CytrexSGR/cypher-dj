// Stellwerk-RT (Scheibe 20, Task 13): Hörschein-Register und Prüfer I3a (SCHNITTSTELLEN §17, §4.5).
// Echtzeit: HoerscheinRegister hat feste 32 Plätze, keine Allokation; PrueferI3::vor_teilstart ohne Allokation,
// I/O, Sperre, std::map, std::string.
//
// Schaltbar (Rev. 2, Review B3): Vorgabe AUS. Ausgeschaltet gibt vor_teilstart immer Grund::kein zurück, damit
// bestehende Kern-Tests, die Kanäle mit Quelle `pruefstand` (kern35.h) oder `cypher` (test_kern_stopp.cpp) ohne
// Hörschein öffnen, weiter das prüfen, was sie prüfen sollen. Im Betrieb schaltet main.cpp ihn über den
// Konfig-Schlüssel `hoerschein_pflicht` an (Vorgabe true).
#pragma once
#include <cstdint>

#include "cypherdj/stellwerk/pruefer.h"

namespace cypherdj::stellwerk {

// Was auf einem Kanal klingt (§4.5 `inhalt`, ohne Pad-/Erzeuger-Anteil: nur der Deck-Fall, den I3a braucht).
struct Inhalt {
  char material_id[17] = {};
  int32_t bpm_milli = 0;
  int32_t fassung = 0;
};

// Ein registrierter Hörschein (§4.5 `/k/hoerschein`).
struct Schein {
  char hs_id[48] = {};
  char kanal[16] = {};
  Inhalt inhalt;
  double bpm = 0.0;
  double gueltig_bis = 0.0;
  double quell_von = 0.0;
  double quell_bis = 0.0;
  bool belegt = false;
};

// Echtzeit: feste 32 Plätze, keine Allokation (§4.5: "höchstens 32 gleichzeitig").
class HoerscheinRegister {
 public:
  static constexpr int MAX = 32;

  // Gleiche hs_id ersetzt den bestehenden Platz. Ist das Register voll: zuerst einen abgelaufenen Platz
  // (gueltig_bis < beat_jetzt) verdrängen, sonst den mit dem kleinsten gueltig_bis.
  void setze(const Schein& s, double beat_jetzt);
  void weg(const char* hs_id);
  const Schein* finde(const char* hs_id) const;

 private:
  Schein s_[MAX] = {};
};

// Der Kern liefert, was auf einem Kanal klingt und, bei Decks, die Quellposition (§4.5 `quell_von`/`quell_bis`).
class DeckModell {
 public:
  virtual ~DeckModell() = default;
  virtual bool inhalt(int kanal, Inhalt& aus) const = 0;               // false: nichts geladen
  virtual double quell_beat_bei(int kanal, int64_t sample) const = 0;  // NaN außer Decks
};

class PrueferI3 final : public Pruefer {
 public:
  PrueferI3(const HoerscheinRegister& r, const DeckModell& d) : reg_(r), deck_(d) {}

  void schalte(bool an) { an_ = an; }
  bool geschaltet() const { return an_; }

  Grund vor_teilstart(const Sicht& s, const TeilSicht& t) override;

 private:
  const HoerscheinRegister& reg_;
  const DeckModell& deck_;
  bool an_ = false;   // Vorgabe aus (Rev. 2, Review B3)
};

}  // namespace cypherdj::stellwerk
