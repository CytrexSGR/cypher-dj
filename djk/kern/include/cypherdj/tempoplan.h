// Tempo-Rampen im Callback (SCHNITTSTELLEN.md §1.3, §4.2, §16.1): angenommene Rampen warten sortiert nach Start-Beat;
// die Karte ist die Grundkarte (alles Gestartete) plus alle wartenden Rampen, in Startreihenfolge neu aufgebaut, sobald
// sich die Liste ändert. So gilt jede Rampe "vom dann gültigen Tempo", auch nach einem Storno davor.
// Keine Allokation, keine Sperre: alle Methoden sind im Callback erlaubt. Scheibe 08.
#pragma once

#include <cstdint>

#include "cypherdj/uhr.h"

namespace cdj {

constexpr int MAX_WARTEND = 256;  // §6.3: ausstehende Befehle bis 256

enum class Einsortiert {
  angenommen,    // Quittung 1 jetzt, 2 am Start-Sample
  verspaetet,    // zu spät: Start am Anfang dieses Blocks, Quittung 5 statt 1 und 2 (§16.1)
  ueberlappung,  // schneidet eine angenommene Rampe: Quittung 6, Grund ueberlappung
  karte_voll,    // mehr als 64 Segmente: Quittung 6, Grund karte_voll (§1.3, 02 NP N4)
};

struct RampeEintrag {
  int64_t id;
  char quelle[48];
  double start_beat;  // wirksamer Start (bei Verspätung der Beat am Blockanfang)
  double ende_beat;   // ab_beat + dauer_beats, mindestens start_beat + 1 (ADR 004 Regel 4)
  double ziel_bpm;
  bool verspaetet;
  bool gestartet;
};

class Tempoplan {
 public:
  explicit Tempoplan(double start_bpm);

  // /k/set/neu: konstante Karte ab Sample 0, keine Einträge. Offene Einträge vorher mit eintrag() abfragen.
  void neu(double start_bpm);

  const Karte& karte() const { return karte_; }
  // Keylock (Plan 2026-10-06-keylock-echtzeit.md, Vertrag 10): wächst, wenn sich die Karte im Inhalt ändert (Rampe
  // angenommen oder verspätet, Storno, /k/set/neu, Wiederherstellen), NICHT bei verwerfe_vor. Adresse fest (Deck liest sie).
  uint32_t generation() const { return generation_; }
  const uint32_t* generation_zeiger() const { return &generation_; }

  // Einsortieren am Blockanfang n0. ab_beat endlich, ziel_bpm 60 bis 200, dauer_beats >= 1 (prüft das Netz).
  Einsortiert rampe(int64_t id, const char* quelle, double ab_beat, double ziel_bpm, double dauer_beats, int64_t n0);

  // Zieht einen noch nicht gestarteten Eintrag derselben Quelle zurück. false: keiner gefunden (schon gestartet,
  // fertig, andere Quelle oder unbekannt).
  bool storno(int64_t ziel_id, const char* quelle);

  // Starts und Enden im Block [n0, n0 + n): melde(eintrag, status, ist_sample, ist_beat) mit Status 2 oder 5 am
  // Start-Sample und 3 am End-Sample. Ein fertiger Eintrag verschwindet danach.
  template <class F>
  void faellige(int64_t n0, int n, F&& melde);

  // §1.3: vergangene Segmente verwerfen (Karte und Grundkarte).
  void verwerfe_vor(int64_t n0);

  int eintraege() const { return n_; }
  const RampeEintrag& eintrag(int i) const { return e_[i]; }
  int wartend() const;  // noch nicht gestartete Einträge (/zustand/kern befehle_wartend)

  // Scheibe 18: Grundkarte (alles Gestartete) für den Neustart-Zustand, und das Setzen des ganzen Zustands aus ihm.
  // wiederherstellen übernimmt Grundkarte, wirksame Karte und Einträge unverändert (keine Neuberechnung), so fährt der
  // neue Kern dieselbe Karte weiter. false: mehr als MAX_WARTEND Einträge, nichts geändert.
  const Karte& basis() const { return basis_; }
  bool wiederherstellen(const Karte& basis, const Karte& karte, const RampeEintrag* e, int n) noexcept;

 private:
  bool baue(Karte& ziel) const;  // Grundkarte + alle nicht gestarteten Einträge in Startreihenfolge
  void entferne(int i);
  Karte basis_;
  Karte karte_;
  RampeEintrag e_[MAX_WARTEND];
  int n_ = 0;
  uint32_t generation_ = 1;
};

template <class F>
void Tempoplan::faellige(int64_t n0, int n, F&& melde) {
  const int64_t ende = n0 + n;
  for (int i = 0; i < n_;) {
    RampeEintrag& e = e_[i];
    if (!e.gestartet) {
      const int64_t s = std::llround(karte_.sample_at(e.start_beat));
      if (s >= ende) break;  // sortiert: alle weiteren starten später
      e.gestartet = true;
      basis_.rampe(e.start_beat, e.ziel_bpm, e.ende_beat - e.start_beat);  // gleiche Rechnung wie in karte_
      melde(e, e.verspaetet ? 5 : 2, s, karte_.beat_at((double)s));
    }
    const int64_t s1 = std::llround(karte_.sample_at(e.ende_beat));
    if (s1 < ende) {
      melde(e, 3, s1, karte_.beat_at((double)s1));
      entferne(i);
      continue;
    }
    ++i;
  }
}

}  // namespace cdj
