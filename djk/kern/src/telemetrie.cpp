#include "cypherdj/telemetrie.h"

#include <time.h>

#include <algorithm>
#include <cmath>

namespace cdj {
namespace {
int64_t mono_ns() {
  timespec ts;
  clock_gettime(CLOCK_MONOTONIC, &ts);  // vDSO, kein Systemaufruf
  return static_cast<int64_t>(ts.tv_sec) * 1000000000LL + ts.tv_nsec;
}
}  // namespace

void Zyklusmesser::anfang(uint32_t treiber_frame, uint64_t zyklus_us, int64_t jetzt_ns, uint32_t nframes,
                          int64_t sample) {
  start_ns_ = jetzt_ns;
  aufwach_us_ = static_cast<int32_t>(jetzt_ns / 1000 - static_cast<int64_t>(zyklus_us));
  nframes_ = nframes;
  if (!erster_) {
    const int32_t d = static_cast<int32_t>(treiber_frame - letzter_frame_ - letzte_n_);
    if (d != 0) {
      // Jede Unstetigkeit der Frame-Zeit ist eine Lücke. Ausgelassene Perioden nur bei kleinen positiven Sprüngen
      // (bis 16 Perioden, wie proben/10-robustheit-betrieb/src/xrunmesser.c); größere oder negative Sprünge sind ein
      // Treiberwechsel (ADR 004: außen neu verankern, gemeldet mit zyklen = 0).
      const bool klein = d > 0 && d <= 16 * static_cast<int32_t>(letzte_n_);
      const int32_t zyk = klein ? static_cast<int32_t>((d + letzte_n_ - 1) / letzte_n_) : 0;
      ++luecken_;
      ++luecken_gesamt_;
      ausgelassen_ += zyk;
      ausgelassen_gesamt_ += zyk;
      Ereignis e{};
      e.art = Ereignis::LUECKE;
      e.sample = sample;
      e.frames = d;
      e.zyklen = zyk;
      schiebe(e);
    }
    if (nframes != letzte_n_) {
      Ereignis e{};
      e.art = Ereignis::QUANTUM;
      e.alt = static_cast<int32_t>(letzte_n_);
      e.neu = static_cast<int32_t>(nframes);
      e.sample = sample;
      schiebe(e);
    }
  }
  erster_ = false;
  letzter_frame_ = treiber_frame;
  letzte_n_ = nframes;
  ++zyklen_;
  if (last_alle_ > 0 && zyklen_ % static_cast<uint64_t>(last_alle_) == 0) {
    const int64_t bis = jetzt_ns + static_cast<int64_t>(last_perioden_ * nframes * 1e9 / 48000.0);
    while (mono_ns() < bis) {
    }
    ++verbrannt_;
  }
}

void Zyklusmesser::ende(int64_t jetzt_ns, int32_t befehle_wartend, int32_t generation, int64_t sample) {
  Ereignis e{};
  e.art = Ereignis::ZYKLUS;
  e.mono_ns = start_ns_;
  e.dauer_us = static_cast<int32_t>((jetzt_ns - start_ns_) / 1000);
  e.aufwach_us = aufwach_us_;
  e.nframes = static_cast<int32_t>(nframes_);
  e.wartend = befehle_wartend;
  e.generation = generation;
  e.sample = sample;
  e.frame_luecken = luecken_;
  e.ausgelassen = ausgelassen_;
  schiebe(e);
}

void Zyklusmesser::neue_generation() {
  luecken_ = 0;
  ausgelassen_ = 0;
}

void Zustandsfenster::zyklus(const Ereignis& e) {
  e_[kopf_] = Eintrag{e.mono_ns, e.dauer_us, e.aufwach_us};
  kopf_ = (kopf_ + 1) % N;
  if (anzahl_ < N) ++anzahl_;
  letzt_.generation = e.generation;
  letzt_.quantum = e.nframes;
  letzt_.sample = e.sample;
  letzt_.frame_luecken = static_cast<int32_t>(e.frame_luecken);
  letzt_.ausgelassene_perioden = static_cast<int32_t>(e.ausgelassen);
  letzt_.befehle_wartend = e.wartend;
}

KernZustand Zustandsfenster::werte(int64_t jetzt_ns) const {
  KernZustand w = letzt_;
  int32_t dauer[N];
  int m = 0;
  w.cb_max_us = 0;
  w.aufwach_max_us = 0;
  for (int i = 0; i < anzahl_; ++i) {
    const Eintrag& x = e_[(kopf_ - 1 - i + N) % N];
    if (x.start_ns < jetzt_ns - 1000000000LL) break;
    dauer[m++] = x.dauer_us;
    w.cb_max_us = std::max(w.cb_max_us, x.dauer_us);
    w.aufwach_max_us = std::max(w.aufwach_max_us, x.aufwach_us);
  }
  w.cb_p99_us = 0;
  if (m > 0) {
    const int k = std::max(0, static_cast<int>(std::ceil(0.99 * m)) - 1);
    std::nth_element(dauer, dauer + k, dauer + m);
    w.cb_p99_us = dauer[k];
  }
  return w;
}

}  // namespace cdj
