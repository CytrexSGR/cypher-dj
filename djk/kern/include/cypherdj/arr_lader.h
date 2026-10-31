// D1 K1 (Spec D1 2.1): eigener Arrangement-Lade-Faden. Der Netz-Faden prüft nur die Anfrage /k/arr/laden und reiht
// einen Auftrag in einen SPSC-Ring; dieser Faden liest die Wiedergabe (lade_wiedergabe, arr_wiedergabe.h), lädt und
// sperrt das Audio über den Cache und reicht den fertigen Schnappschuss zurück an den Netz-Faden, der ihn als Befehl
// ARR_LADEN in den Callback gibt. Abgelöste Schnappschüsse (ARR_ALT) kommen über den Rückgabe-Ring hierher und werden
// nur hier freigegeben. So blockiert ein Laden von hunderten MB weder /uhr noch Quittungen noch Deck-Befehle (A10).
// Paket K3 (Spec 2.5, 6.25, 6.29): derselbe Faden legt Freeze-Aufträge samt Puffer an (bis rund 99 MB) und schreibt nach
// dem Ende die Freeze-Datei, nie ersetzend. Ein Freeze-Auftrag geht durch denselben Auftragsring wie ein Laden, damit
// /k/arr/laden und /k/arr/freeze in ihrer Reihenfolge beim Kern ankommen. Der Netz-Faden prüft nur, reiht ein, gibt
// Auftrag und Rückgabe weiter und sendet /e/freeze (gemessen bei 256 Beats: 27 bis 29 ms Anlegen, 10 bis 75 ms Datei,
// so lange stünden sonst /uhr und jede OSC-Antwort still).
#pragma once

#include <atomic>
#include <cstddef>
#include <cstdint>
#include <string>

#include "cypherdj/arr_wiedergabe.h"
#include "cypherdj/spsc_ring.h"
#include "cypherdj/warp_werk.h"

namespace cdj {

struct ArrFreeze;   // arrangement.h

struct ArrAuftrag {
  int64_t id;
  char quelle[48];
  int64_t nr;
  // Paket K3: art FREEZE trägt die Felder von /k/arr/freeze (vom Netz geprüft); LADEN (0) ist die Vorgabe von ArrAuftrag{}
  static constexpr int32_t LADEN = 0, FREEZE = 1;
  int32_t art;
  int32_t spur, kennung;
  double von_beat, bis_beat;
};

struct ArrErgebnis {
  ArrAuftrag auftrag;
  ArrSnapshot* snap;   // nullptr bei Fehler
  char grund[32];      // Spec 3.1: datei_fehlt, format, audio_fehlt, zu_gross, spur_bereich; zu_spaet (Ring voll, /q 4)
  ArrFreeze* freeze;   // Paket K3, art FREEZE: angelegter Auftrag samt Puffer, nullptr bei Fehler (grund)
};

// Paket K3: Ergebnis eines beendeten Freeze für /e/freeze (status 0 Datei geschrieben, 1 abgebrochen, 2 nicht geschrieben)
struct ArrFreezeMeldung {
  int32_t spur, kennung, status;
  int64_t frames;
};

// Je genau ein Schreiber und ein Leser (spsc_ring.h): Netz-Faden und Arrangement-Lade-Faden.
struct ArrLaderRinge {
  SpscRing<ArrAuftrag, 16> auftraege;      // Netz -> Lader
  SpscRing<ArrErgebnis, 16> ergebnisse;    // Lader -> Netz
  SpscRing<ArrSnapshot*, 16> rueckgabe;    // Netz -> Lader: abgelöst (ARR_ALT) oder nicht eingereiht
  // Paket K3: beendeter Freeze-Auftrag (status 0 fertig, 1 abgebrochen, ARR_FREEZE_ABGELEHNT nur freigeben) Netz -> Lader,
  // Ergebnis für /e/freeze Lader -> Netz
  SpscRing<ArrFreeze*, 16> freeze_zurueck;
  SpscRing<ArrFreezeMeldung, 16> freeze_meldungen;
};

// Paket K3 (arr_freeze_datei.cpp, im Lade-Faden; die Mutationen ARR_FREEZE_ANLEGEN_IM_NETZ und ARR_FREEZE_SCHREIBEN_IM_NETZ
// rufen sie im Netz-Faden):
// Pfad <ordner>/freeze-<spur>-<kennung>.f32. Anlegen: Auftrag samt Puffer für 60 BPM (das langsamste Projekttempo) plus
// Nachlauf, alle Seiten berührt; nullptr mit grund (zu_gross: Speicher reicht nicht). Schreiben: rohes f32 Stereo,
// frames · 2 Werte, über <ziel>.<pid>.teil und renameat2(RENAME_NOREPLACE) bzw. link() + unlink(); Spec 6.25: eine
// vorhandene Datei wird nie ersetzt (false, besteht = true). false mit fehler (Pfad und errno-Text), die Temp-Datei ist
// dann entfernt.
std::string freeze_datei(const std::string& ordner, int spur, int32_t kennung);
ArrFreeze* freeze_anlegen(const ArrAuftrag& a, char* grund, size_t n);
bool schreibe_freeze(const std::string& ordner, const ArrFreeze& f, std::string& fehler, bool* besteht = nullptr);

class ArrLader {
 public:
  // sperren = false nur für Tests und den Fehlerfall der Abnahme (kein MAP_POPULATE, kein mlock)
  ArrLader(std::string ordner, SpeicherKonto* konto, int64_t arr_budget_bytes, bool sperren = true);
  // Ein Durchgang: alle Rückgaben freigeben, beendete Freezes schreiben und freigeben (Paket K3), höchstens einen Auftrag
  // laden oder einen Freeze-Auftrag anlegen. true: es gab Arbeit. Bleibt der Ergebnisring
  // 1 s voll, wird das Ergebnis zu_spaet ohne Schnappschuss und geht im nächsten Durchgang mit Platz hinaus, vor jedem
  // neuen Auftrag (jede id endet genau einmal).
  bool einmal(ArrLaderRinge& r);
  // Faden bis stop (je Durchgang ohne Arbeit 1 ms Pause)
  void laufen(ArrLaderRinge& r, const std::atomic<bool>& stop);
  const ArrAudioCache& cache() const { return cache_; }
  const std::string& ordner() const { return ordner_; }
  // Paket 1.13 Slice 2 (Lebensdauer): ein abgelöster Schnappschuss wird erst freigegeben, wenn das Warp-Werk ihn nicht mehr liest (WarpWerk::liest);
  // bis dahin wartet er hier (höchstens WARTE_MAX, in jedem Durchgang erneut gefragt). Vor dem Start des Fadens setzen; nullptr: ohne Werk.
  void setze_warp_werk(const WarpWerk* w) { werk_ = w; }
  int aufgeschoben() const { return n_aufgeschoben_; }
  static constexpr int WARTE_MAX = 16;

 private:
  std::string ordner_;
  ArrAudioCache cache_;
  ArrErgebnis wartend_{};   // K1-Fix 9: Ergebnis, das nach 1 s vollem Ring als zu_spaet auf Platz wartet
  bool wartet_ = false;
  const WarpWerk* werk_ = nullptr;
  ArrSnapshot* aufgeschoben_[WARTE_MAX] = {};   // abgelöst, aber das Warp-Werk liest noch (Slice 2)
  int n_aufgeschoben_ = 0;
  void rueckgabe_frei(ArrSnapshot* s, bool& arbeit);
  void freeze_fertig(ArrLaderRinge& r, ArrFreeze* f);   // Paket K3: Datei, Meldung, freigeben
};

}  // namespace cdj
