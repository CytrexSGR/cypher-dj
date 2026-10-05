// Keylock Slice 3 (Plan 2026-09-30-keylock-plan): Render-Faden des Netzes. Rechnet Keylock-Varianten von Loops (R3 offline,
// rendere_keylock) in einem eigenen Faden mit niedrigster Priorität und legt sie fertig gebaut als Loop in einen
// Übergabe-Slot. Der Faden reiht NICHTS ein und fasst den Befehlsring nicht an (Ein-Erzeuger, Plan [L12]): der Netz-Faden
// holt die Ergebnisse ab (hole) und reiht Befehl::LOOP_VARIANTE selbst ein. Nie im Audio-Callback.
//  - Je Box höchstens ein Auftrag wartet; ein neuer ersetzt einen noch nicht gestarteten (nur der neueste zählt).
//  - Nie zwei Renders zugleich (ein Faden). Ein laufender Render wird zwischen den R3-Stücken (1024 Frames) abgebrochen
//    (abbrechen(), Destruktor): der Faden endet in Zehntelsekunden, auch bei 32 Beats; es startet kein weiterer (Slice 3b, F6).
//  - Der Faden liest nie Daten, die der Kern besitzt: er rechnet aus einer KOPIE des Originals (KeylockQuelle).
// Slice 4: derselbe Faden rechnet auch REC-Mitschnitte bei T ≠ 128 auf das 128er-Raster um (rendere_rec, Tonhöhe erhalten).
// Ein REC-Auftrag gehört dem Faden (er bekommt den Mitschnitt, den das Netz vom Kern zurückbekam), gerechnet wird in
// Eingangsreihenfolge und vor Varianten (auf ein REC wartet jemand, eine Variante ist ein Zusatz); nie zwei Renders zugleich.
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

// Kopie der Originaldaten eines geladenen Loops für den Render-Faden (Netz-Faden legt sie beim /k/loop/laden an).
struct KeylockQuelle {
  std::string name;
  int beats = 0;
  int64_t frames = 0;
  int64_t versatz = 0;
  std::vector<float> daten;  // 2 · frames Werte, Stereo verschränkt, 128 BPM
};

using KeylockRenderFn = std::function<std::vector<float>(const std::vector<float>& daten, double bpm)>;

// Keylock Slice 4: REC-Umrechnung. Eingang roh_frames Stereo-Frames (verschränkt) beim Tempo der Aufnahme, Ergebnis genau
// frames Frames bei 128 BPM (2 · frames Werte), Tonhöhe erhalten. Leer oder falsche Länge = Fehler.
using RecRenderFn = std::function<std::vector<float>(const float* daten, int64_t roh_frames, int64_t frames)>;

struct KeylockOpt {  // Einstellungen des Netzes; Tests setzen sie (Netz::setze_keylock), im Betrieb gelten die Vorgaben
  KeylockRenderFn fn;                  // leer: rendere_keylock
  RecRenderFn rec_fn;                  // leer: rendere_rec (Slice 4)
  int64_t ruhe_ns = 250'000'000LL;     // so lange muss das Tempo unverändert sein, bevor gerendert wird
  bool niedrige_prio = true;           // nice 19 und SCHED_IDLE für den Render-Faden
  // Nur für Tests (Slice 3b, F5): wird nach dem Render und vor dem Bau der Loop im Render-Faden gerufen und darf werfen
  // (std::bad_alloc beim Bau der Loop ist sonst nicht nachzustellen); Fadenstart-Fehler (std::system_error) ebenso.
  std::function<void()> haken_bau;
  std::function<void()> haken_start;  // Test: wird im Render-Faden gerufen, bevor die Render-Funktion beginnt
  bool faden_start_wirft = false;
};

// Was das Netz nach der Umrechnung für /e/mitschnitt braucht (Ereignis::pfad, fassung, beat des Kerns).
struct RecMeldung {
  char pfad[48] = {};
  int32_t fassung = 0;
  double beat = 0.0;
};

class KeylockRender {
 public:
  struct Ergebnis {
    int box = 0;
    std::shared_ptr<const KeylockQuelle> quelle;  // der Auftrag, aus dem es stammt (Zeigergleichheit entscheidet im Netz)
    double bpm = 0.0;
    std::unique_ptr<Loop> loop;  // fertig gebaute Variante; nullptr bei Fehler
    bool fehler = false;
  };
  KeylockRender(int boxen, const KeylockOpt& opt);
  ~KeylockRender();  // Abbruch und Stopp-Flag, Faden abwarten (join), kein weiterer Auftrag startet
  // Slice 3b (F6): laufenden Render zwischen zwei R3-Stücken abbrechen und keinen weiteren starten; wartet nicht.
  // Aus jedem Faden aufrufbar. Nach abbrechen() nehmen auftrag() und rec_auftrag() nichts mehr an.
  void abbrechen();
  // Slice 3b (F5): false, wenn der Faden nicht starten konnte (Keylock bleibt aus, die Boxen bleiben im Varispeed)
  bool bereit() const { return faden_laeuft_; }
  KeylockRender(const KeylockRender&) = delete;
  KeylockRender& operator=(const KeylockRender&) = delete;
  // Box 1..boxen: ein Auftrag; ersetzt einen noch nicht gestarteten derselben Box.
  void auftrag(int box, std::shared_ptr<const KeylockQuelle> q, double bpm);
  // Ein fertiges Ergebnis abholen (Netz-Faden); false, wenn keins da ist. Ein nicht abgeholtes wird von einem neueren
  // derselben Box überschrieben und freigegeben.
  bool hole(Ergebnis& e);

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
  struct Auftrag {
    bool da = false;
    uint64_t nr = 0;
    std::shared_ptr<const KeylockQuelle> quelle;
    double bpm = 0.0;
  };
  void faden();
  void faden_schleife();
  RecErgebnis rechne_rec(RecErgebnis a);
  Ergebnis rechne(int box, const std::shared_ptr<const KeylockQuelle>& q, double bpm);
  KeylockOpt opt_;
  std::mutex m_;
  std::condition_variable cv_;
  std::vector<Auftrag> auftraege_;  // je Box
  std::vector<Ergebnis> fertig_;    // je Box, loop gesetzt oder fehler
  std::vector<bool> fertig_da_;
  std::deque<RecErgebnis> rec_auftraege_;  // Slice 4: wartende REC-Umrechnungen (fehler unbenutzt)
  std::deque<RecErgebnis> rec_fertig_;     // fertig, noch nicht abgeholt
  uint64_t zaehler_ = 0;
  bool stopp_ = false;
  std::atomic<bool> abbruch_{false};  // Slice 3b (F6): R3 liest ihn zwischen den Stücken
  bool faden_laeuft_ = false;
  std::thread faden_;
};

}  // namespace cdj
