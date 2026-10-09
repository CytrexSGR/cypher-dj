// Keylock Slice 4 (Plan 2026-09-30-keylock-plan): Render-Faden des Netzes für die REC-Umrechnung. Ein Mitschnitt bei T ≠ 128
// wird offline auf das 128er-Raster gerechnet (rendere_rec, Tonhöhe erhalten; ADR 027 Entscheidung 6, Datei-Konvertierung,
// kein Abspielen). Ein Faden mit niedrigster Priorität, Aufträge in Eingangsreihenfolge, nie zwei zugleich; ein laufender
// Render wird zwischen den R3-Stücken abgebrochen (abbrechen(), Destruktor). Nie im Audio-Callback.
// Keylock Task 7 (Plan 2026-10-06-keylock-echtzeit.md, Detailschnitt 7a Abschnitt 8): die Keylock-Varianten der Loop-Boxen
// (Slice 3, ein Render-Auftrag je Box) sind ausgebaut; die Box dehnt live mit dem Dehner.
#pragma once

#include <atomic>
#include <condition_variable>
#include <cstdint>
#include <deque>
#include <functional>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include "cypherdj/loop.h"

namespace cdj {

// Keylock Slice 4: REC-Umrechnung. Eingang roh_frames Stereo-Frames (verschränkt) beim Tempo der Aufnahme, Ergebnis genau
// frames Frames bei 128 BPM (2 · frames Werte), Tonhöhe erhalten. Leer oder falsche Länge = Fehler.
using RecRenderFn = std::function<std::vector<float>(const float* daten, int64_t roh_frames, int64_t frames)>;

struct KeylockOpt {  // Einstellungen des Netzes; Tests setzen sie (Netz::setze_keylock), im Betrieb gelten die Vorgaben
  RecRenderFn rec_fn;                  // leer: rendere_rec (Slice 4)
  bool niedrige_prio = true;           // nice 19 und SCHED_IDLE für den Render-Faden
  bool faden_start_wirft = false;      // nur Tests (Slice 3b, F5): der Fadenstart scheitert (std::system_error)
};

// Was das Netz nach der Umrechnung für /e/mitschnitt braucht (Ereignis::pfad, fassung, beat des Kerns).
struct RecMeldung {
  char pfad[48] = {};
  int32_t fassung = 0;
  double beat = 0.0;
};

class KeylockRender {
 public:
  explicit KeylockRender(const KeylockOpt& opt);
  ~KeylockRender();  // Abbruch und Stopp-Flag, Faden abwarten (join), kein weiterer Auftrag startet
  // Slice 3b (F6): laufenden Render zwischen zwei R3-Stücken abbrechen und keinen weiteren starten; wartet nicht.
  // Aus jedem Faden aufrufbar. Nach abbrechen() nimmt rec_auftrag() nichts mehr an.
  void abbrechen();
  // Slice 3b (F5): false, wenn der Faden nicht starten konnte (REC bei T ≠ 128 wird dann nicht umgerechnet)
  bool bereit() const { return faden_laeuft_; }
  KeylockRender(const KeylockRender&) = delete;
  KeylockRender& operator=(const KeylockRender&) = delete;
  // Slice 4: REC-Umrechnung. Der Faden bekommt den Mitschnitt (roh_frames bei Tempo der Aufnahme) und ersetzt mt->daten durch
  // frames Frames bei 128 BPM (umgerechnet = true). Fehler (Ausnahme, leer, falsche Länge): eine stderr-Zeile, fehler = true,
  // mt unverändert. Das Ergebnis holt der Netz-Faden mit rec_hole und schreibt erst dann die Datei.
  struct RecErgebnis {
    std::unique_ptr<Mitschnitt> mt;
    RecMeldung meldung;
    bool fehler = false;
  };
  void rec_auftrag(std::unique_ptr<Mitschnitt> mt, const RecMeldung& meldung);
  bool rec_hole(RecErgebnis& e);

 private:
  void faden();
  void faden_schleife();
  RecErgebnis rechne_rec(RecErgebnis a);
  KeylockOpt opt_;
  std::mutex m_;
  std::condition_variable cv_;
  std::deque<RecErgebnis> rec_auftraege_;  // Slice 4: wartende REC-Umrechnungen (fehler unbenutzt)
  std::deque<RecErgebnis> rec_fertig_;     // fertig, noch nicht abgeholt
  bool stopp_ = false;
  std::atomic<bool> abbruch_{false};  // Slice 3b (F6): R3 liest ihn zwischen den Stücken
  bool faden_laeuft_ = false;
  std::thread faden_;
};

}  // namespace cdj
