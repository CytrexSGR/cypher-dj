// Paket K3 (Spec D1 2.5, 3.1 /k/arr/freeze): Freeze im Modul Arrangement. Ein Freeze ist ein Transport-Lauf ab von_beat
// nach der Start-Regel mit ausgesetzter Loop-Klammer. Der Abgriff kopiert das Spur-Signal vor dem Fader (bus_l_/bus_r_
// nach den Senken, vor mischen) ab dem Einsatz-Sample in den Puffer des Auftrags, (bis − von + 2) Beats lang; dort endet
// der Transport. Stopp, neuer Start, Tausch, KI-Stopp, die Hand-Taste, eine Tempo-Rampe und /k/set/neu brechen ihn ab
// (status 1, beende/stopp, freeze_abbrechen).
// Echtzeit: keine Allokation (der Puffer kommt fertig aus dem Arrangement-Lade-Faden, Spec 6.29), keine Sperre, kein I/O.
#include <algorithm>
#include <cmath>

#include "cypherdj/arrangement.h"

namespace cdj {

bool Arrangement::freeze(ArrFreeze* f, int quant, bool von_cypher, int64_t s, int64_t vorhalt, int n, const Karte& k,
                         const char*& grund) {
  if (!snap_) {
    grund = "nicht_geladen";
    return false;
  }
  if (status_ != ArrStatus::steht || freeze_ || freeze_fertig_) {
    grund = "ueberlappung";
    return false;
  }
  if (f->spur < 1 || f->spur > ARR_SPUREN || snap_->spur[f->spur - 1].art == ArrArt::leer) {
    grund = "spur_bereich";
    return false;
  }
  start_gemerkt_ = start_beat_;   // Fix L10: der start_beat des Nutzers (und seine Klammer-Lage) gilt nach dem Freeze wieder
  klammer_vorn_gemerkt_ = klammer_vorn_;
  start(f->von_beat, quant, von_cypher, s, vorhalt, n, k);   // Einsatz nach der Start-Regel (Spec 2.2)
  const int64_t ende = std::llround(k.sample_at(ursprung_ + (f->bis_beat - f->von_beat) + ARR_FREEZE_NACHLAUF));
  if (ende - start_s_ > f->kap) {   // langsamer als 60 BPM gibt es nicht; Schutz, falls der Puffer doch nicht reicht
    stopp(0, s, k);                 // wartet noch: sofort aus, es klang nichts
    start_beat_ = start_gemerkt_;
    klammer_vorn_ = klammer_vorn_gemerkt_;
    grund = "zu_gross";
    return false;
  }
  f->start_s = start_s_;
  f->frames = ende - start_s_;
  f->ende_s = -1;
  f->status = 0;
  freeze_ = f;
  freeze_gestartet_bei_ = -1;
  loop_gemerkt_ = loop_an_;
#ifndef CYPHERDJ_MUTATION_ARR_FREEZE_LOOP_BLEIBT
  loop_an_ = false;   // linear von von_beat bis zum Ende des Nachlaufs
#endif
  stopp_s_ = ende;
  return true;
}

void Arrangement::freeze_abgriff(int64_t s0, int m) {
  if (!freeze_) return;
  ArrFreeze& f = *freeze_;
  const int i = f.spur - 1;
  const int64_t a = std::max(s0, f.start_s), e = std::min(s0 + m, f.start_s + f.frames);
  float* d = f.daten.data();
#ifdef CYPHERDJ_MUTATION_ARR_FREEZE_NACH_FADER
  const float g = w_[i][0].w <= -120.0f ? 0.0f : std::pow(10.0f, w_[i][0].w / 20.0f);   // Fehlerfall: nach dem Fader
#else
  const float g = 1.0f;
#endif
  for (int64_t s = a; s < e; ++s) {
    const int64_t j = 2 * (s - f.start_s);
    d[j] = bus_l_[i][s - s0] * g;
    d[j + 1] = bus_r_[i][s - s0] * g;
  }
  if (s0 + m >= f.start_s + f.frames) freeze_ende(f.start_s + f.frames, 0);
}

void Arrangement::freeze_abbrechen(int64_t s, const Karte& k) {
  if (!freeze_) return;
  // Offene Noten: ihr Off-Sample liegt auf der alten Achse und wäre auf der neuen weit voraus (die RB-338 hielte es in ihrer
  // Warteschlange); alle_aus der Senken bei s (in stopp/beende) beendet sie. Clip-Stimmen bekommen in beende() das
  // Ausblend-Sample s und enden auf der neuen Achse, sobald sie ihr altes Einsatz-Sample erreichen, ohne zu klingen
  // (Fall 8 a in test_kern_arr_freeze: Spitze 0,0022 nur aus dem Nachlauf des Master-Zugs).
  n_offen_ = 0;
  if (status_ == ArrStatus::wartet) stopp(0, s, k);   // noch nicht eingesetzt: sofort aus (freeze_ende, Status 1)
  else beende(s);                                      // läuft: hier, nicht erst am Stopp-Sample der alten Achse
}

void Arrangement::freeze_ende(int64_t s, int32_t status) {
  freeze_->ende_s = s;
  freeze_->status = status;
  freeze_fertig_ = freeze_;
  freeze_ = nullptr;
  loop_an_ = loop_gemerkt_;
#ifndef CYPHERDJ_MUTATION_ARR_FREEZE_START_BEAT_BLEIBT
  start_beat_ = start_gemerkt_;   // Fix L10 (vorher blieb von_beat stehen: gemessen 8,0 -> 2,0)
  klammer_vorn_ = klammer_vorn_gemerkt_;
#endif
  geaendert_ = true;
}

}  // namespace cdj
