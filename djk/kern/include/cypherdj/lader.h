// Lader des Kerns (ARCHITEKTUR §3.1, SCHNITTSTELLEN.md §4.4, §6.4, §13.2; ADR 015): blendet eine Fassung aus dem
// Arbeitsbestand per mmap ein, sperrt sie mit mlock (je Material, nie MCL_FUTURE: 10 NP K7), prüft sie gegen
// fassung.json und reicht sie über einen Ring in den Callback. Freigegeben (munlock, munmap) wird erst, wenn der
// Callback das Material zurückgegeben hat. Budget: speicher_budget_mib (§2.1, 3 800 MiB unter der 4-GiB-Grenze).
// Scheibe 31. Lader::lade() und gib_frei() laufen nur im Lade-Faden oder vor dem Start (Systemaufrufe, Allokation);
// der Callback berührt nur die Ringe und Material::quelle[].
#pragma once

#include <atomic>
#include <cstddef>
#include <cstdint>
#include <string>

#include "cypherdj/fassung.h"
#include "cypherdj/spsc_ring.h"

namespace cdj {

// Ein eingeblendetes, gesperrtes Material: die Basis-Datei oder die vier Stems einer Fassung (§4.4: nie beides).
struct Material {
  char material_id[24];
  double basis_bpm;
  int32_t fassung;
  int32_t mit_stems;
  int32_t n_quellen;                  // 1: Basis; 4: Stems in der Reihenfolge STEM_NAMEN
  int32_t erste_eins_quell_beat;
  int64_t frames;
  int64_t erster_schlag_frame;
  double beats;
  double lufs_integriert;
  const float* quelle[STEM_ANZAHL];   // verschränkt Stereo, frames · 2 Werte
  void* abbild[STEM_ANZAHL];          // nur der Lader: mmap-Adressen
  size_t bytes[STEM_ANZAHL];
  int64_t gesperrt;                   // Summe der gezählten Bytes (Budget)
};

enum class LadeGrund : int32_t { ok = 0, material_fehlt = 1, pruefung = 2, budget_speicher = 3 };
const char* grund_text(LadeGrund g);  // §16.2: "", "material_fehlt", "pruefung", "budget_speicher"

struct LadeAuftrag {
  int64_t id;
  char quelle[48];
  int32_t deck;          // 1 bis 4
  int32_t fassung;
  int32_t mit_stems;
  uint32_t seq;          // Reihenfolge der Deck-Befehle im Kern
  double basis_bpm;
  char material_id[24];
};

struct LadeErgebnis {
  LadeAuftrag auftrag;
  Material* material;    // nullptr bei Fehler
  LadeGrund grund;
};

// Wege zwischen Callback und Lade-Faden, je genau ein Schreiber und ein Leser (spsc_ring.h).
struct LaderRinge {
  SpscRing<LadeAuftrag, 16> auftraege;    // Callback -> Lader
  SpscRing<LadeErgebnis, 16> ergebnisse;  // Lader -> Callback
  SpscRing<Material*, 16> rueckgabe;      // Callback -> Lader: Freigabe erst nach Rückgabe
};

struct LaderOptionen {
  bool pruefsumme = true;  // sha256 gegen fassung.json; im Neustart-Pfad aus (das Material lag schon geprüft da)
  bool sperren = true;     // MAP_POPULATE und mlock; nur der Fehlerfall der Abnahme (M8) schaltet es ab
};

class Lader {
 public:
  Lader(std::string arbeitsbestand, int64_t budget_bytes);
  // Blendet ein, prüft, sperrt. Rückgabe: Material (gehört bis gib_frei() dem Aufrufer) oder nullptr mit Grund.
  Material* lade(const LadeAuftrag& a, LadeGrund& grund, std::string& meldung, const LaderOptionen& opt = {});
  void gib_frei(Material* m);  // munlock, munmap, Budget zurück
  int64_t gesperrt() const { return gesperrt_.load(std::memory_order_relaxed); }
  int64_t budget() const { return budget_; }
  const std::string& arbeitsbestand() const { return ab_; }
  // Ein Durchgang des Lade-Fadens: alle Rückgaben freigeben, höchstens einen Auftrag laden. true: es gab Arbeit.
  bool einmal(LaderRinge& r, const LaderOptionen& opt = {});
  // Lade-Faden bis stop (je Durchgang ohne Arbeit 1 ms Pause).
  void laufen(LaderRinge& r, const std::atomic<bool>& stop, const LaderOptionen& opt = {});

 private:
  std::string ab_;
  int64_t budget_;
  std::atomic<int64_t> gesperrt_{0};
};

}  // namespace cdj
