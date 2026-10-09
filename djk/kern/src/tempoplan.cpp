#include "cypherdj/tempoplan.h"

#include <cmath>
#include <cstring>

namespace cdj {

Tempoplan::Tempoplan(double start_bpm) : basis_(start_bpm, 0), karte_(start_bpm, 0) {}

void Tempoplan::neu(double start_bpm) {
  basis_.neu(start_bpm, 0);
  karte_.neu(start_bpm, 0);
  n_ = 0;
  ++generation_;
}

bool Tempoplan::baue(Karte& ziel) const {
  ziel = basis_;
  for (int i = 0; i < n_; ++i) {
    const RampeEintrag& e = e_[i];
    if (e.gestartet) continue;
    if (!ziel.rampe(e.start_beat, e.ziel_bpm, e.ende_beat - e.start_beat)) return false;
  }
  return true;
}

void Tempoplan::entferne(int i) {
  for (int j = i + 1; j < n_; ++j) e_[j - 1] = e_[j];
  --n_;
}

Einsortiert Tempoplan::rampe(int64_t id, const char* quelle, double ab_beat, double ziel_bpm, double dauer_beats,
                             int64_t n0) {
  const bool spaet = std::llround(karte_.sample_at(ab_beat)) < n0;  // §3: nach dem Ziel-Sample im Ring
  const double start = spaet ? karte_.beat_at((double)n0) : ab_beat;
  double ende = ab_beat + dauer_beats;  // §4.2: Ende-Beat unverändert
  if (ende - start < 1.0) ende = start + 1.0;  // ADR 004 Regel 4: nie kürzer als 1 Beat
  for (int i = 0; i < n_; ++i)
    if (start < e_[i].ende_beat && e_[i].start_beat < ende) return Einsortiert::ueberlappung;
  if (n_ == MAX_WARTEND) return Einsortiert::karte_voll;
  int pos = n_;
  while (pos > 0 && e_[pos - 1].start_beat > start) --pos;
  RampeEintrag neu{};
  neu.id = id;
  std::strncpy(neu.quelle, quelle, sizeof neu.quelle - 1);
  neu.start_beat = start;
  neu.ende_beat = ende;
  neu.ziel_bpm = ziel_bpm;
  neu.verspaetet = spaet;
  neu.gestartet = false;
  for (int j = n_; j > pos; --j) e_[j] = e_[j - 1];
  e_[pos] = neu;
  ++n_;
  Karte kandidat;
  if (!baue(kandidat)) {  // 64 Segmente überschritten: Liste und Karte bleiben, wie sie waren
    entferne(pos);
    return Einsortiert::karte_voll;
  }
  karte_ = kandidat;
  ++generation_;
  return spaet ? Einsortiert::verspaetet : Einsortiert::angenommen;
}

bool Tempoplan::storno(int64_t ziel_id, const char* quelle) {
  for (int i = 0; i < n_; ++i) {
    if (e_[i].id != ziel_id || e_[i].gestartet || std::strncmp(e_[i].quelle, quelle, sizeof e_[i].quelle) != 0)
      continue;
    const RampeEintrag alt = e_[i];
    entferne(i);
    Karte kandidat;
    if (!baue(kandidat)) {  // kann nicht eintreten (weniger Rampen belegen nie mehr Segmente); Zustand bleibt
      for (int j = n_; j > i; --j) e_[j] = e_[j - 1];
      e_[i] = alt;
      ++n_;
      return false;
    }
    karte_ = kandidat;
    ++generation_;
    return true;
  }
  return false;
}

void Tempoplan::verwerfe_vor(int64_t n0) {
  basis_.verwerfe_vor(n0);
  karte_.verwerfe_vor(n0);
}

bool Tempoplan::wiederherstellen(const Karte& basis, const Karte& karte, const RampeEintrag* e, int n) noexcept {
  if (n < 0 || n > MAX_WARTEND) return false;
  basis_ = basis;
  karte_ = karte;
  for (int i = 0; i < n; ++i) e_[i] = e[i];
  n_ = n;
  ++generation_;
  return true;
}

int Tempoplan::wartend() const {
  int w = 0;
  for (int i = 0; i < n_; ++i) w += e_[i].gestartet ? 0 : 1;
  return w;
}

}  // namespace cdj
