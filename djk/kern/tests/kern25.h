// Scheibe 25: Prüfaufbau für den Kern ohne JACK (Kern::zyklus in einer Schleife). Befehle wie aus dem Netz, Ereignisse
// gesammelt, Master und Cue aus dem Audio-Ring je Zyklus mitgeschrieben. Nur für Tests (allokiert außerhalb von zyklus).
#pragma once

#include <cmath>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <vector>

#include "cypherdj/kern.h"

struct Kern25 {
  std::unique_ptr<unsigned char[]> mem{new unsigned char[CDJ_RING_BYTES]()};
  cdj_ring_kopf* ring = reinterpret_cast<cdj_ring_kopf*>(mem.get());
  std::unique_ptr<cdj::Befehlsring> bef{new cdj::Befehlsring()};
  std::unique_ptr<cdj::Ereignisring> ere{new cdj::Ereignisring()};
  std::unique_ptr<cdj::Kern> kern;
  std::vector<cdj::Ereignis> ev;  // alle Ereignisse außer UHR und ZYKLUS
  std::vector<float> master, cue;  // Master links und Cue links ab Sample `ab`
  int64_t ab = 0;
  bool mitschreiben = false;

  Kern25() {
    std::memcpy(ring->magic, "CDJB", 4);
    ring->version = CDJ_RING_VERSION;
    ring->rate = CDJ_RING_RATE;
    ring->kanaele = CDJ_RING_KANAELE;
    ring->cap = CDJ_RING_CAP;
    kern.reset(new cdj::Kern(128.0, ring, bef.get(), ere.get()));
    kern->setze_pruefmodus(true);  // Prüfklicks überleben den Neustart nur im Prüfmodus (B7)
  }
  cdj::Befehl neu(int32_t art, int64_t id, const char* quelle) {
    cdj::Befehl b{};
    b.art = art;
    b.id = id;
    std::strcpy(b.quelle, quelle);
    return b;
  }
  void teil(int64_t id, const char* quelle, const char* plan, int nr, const char* pfad, double ab_beat,
            double dauer, float nach, int form, int politik, const char* gruppe, const char* hs) {
    cdj::Befehl b = neu(cdj::Befehl::TEIL, id, quelle);
    std::strcpy(b.plan, plan);
    b.nr = nr;
    std::strcpy(b.pfad, pfad);
    b.ab_beat = ab_beat;
    b.dauer_beats = dauer;
    b.wert = nach;
    b.form = form;
    b.politik = politik;
    std::strcpy(b.gruppe, gruppe);
    std::strcpy(b.hoerschein, hs);
    bef->schiebe(b);
  }
  void hand(const char* pfad, float midi_roh, int64_t sample) {
    cdj::Befehl b = neu(cdj::Befehl::HAND, 0, "andreas");
    std::strcpy(b.pfad, pfad);
    b.wert = midi_roh;
    b.sample = sample;
    bef->schiebe(b);
  }
  void klick(int64_t id, const char* kanal, int an) {
    cdj::Befehl b = neu(cdj::Befehl::KLICK, id, "pruefstand");
    std::strcpy(b.pfad, kanal);
    b.an = an;
    bef->schiebe(b);
  }
  void einfach(int32_t art, int64_t id, const char* quelle, const char* liste = "", const char* plan = "",
               int an = 0) {
    cdj::Befehl b = neu(art, id, quelle);
    std::strcpy(b.liste, liste);
    std::strcpy(b.plan, plan);
    b.an = an;
    bef->schiebe(b);
  }
  // Zyklen zu n Samples, bis das Kern-Sample `bis` erreicht ist.
  void bis(int64_t ziel, int n = 256) {
    while (kern->sample() < ziel) zyklus(n);
  }
  void zyklus(int n) {
    const int64_t s0 = kern->sample();
    const uint64_t w0 = cdj_lade(&ring->w);
    kern->zyklus(n, 0);
    cdj::Ereignis e;
    while (ere->hole(e))
      if (e.art != cdj::Ereignis::UHR && e.art != cdj::Ereignis::ZYKLUS) ev.push_back(e);
    if (mitschreiben) {
      if (master.empty()) ab = s0;
      const float* d = cdj_ring_daten_c(ring);
      for (int i = 0; i < n; ++i) {
        const uint64_t f = (w0 + (uint64_t)i) % CDJ_RING_CAP;
        master.push_back(d[f * 4 + 0]);
        cue.push_back(d[f * 4 + 2]);
      }
    }
  }
  // Quittungen einer Kennung in Reihenfolge
  std::vector<const cdj::Ereignis*> q(int64_t id) const {
    std::vector<const cdj::Ereignis*> v;
    for (const auto& e : ev)
      if (e.art == cdj::Ereignis::QUITTUNG && e.id == id) v.push_back(&e);
    return v;
  }
  const cdj::Ereignis* q(int64_t id, int status) const {
    for (const auto& e : ev)
      if (e.art == cdj::Ereignis::QUITTUNG && e.id == id && e.status == status) return &e;
    return nullptr;
  }
  // Wert eines Reglers am Sample s aus /e/regler (linear zwischen den Meldungen davor und danach, wie der Folgen-Läufer)
  double wert_bei(const char* pfad, int64_t s) const {
    const cdj::Ereignis* vor = nullptr;
    const cdj::Ereignis* nach = nullptr;
    for (const auto& e : ev) {
      if (e.art != cdj::Ereignis::REGLER || std::strcmp(e.pfad, pfad)) continue;
      if (e.sample <= s) vor = &e;
      if (e.sample >= s && !nach) nach = &e;
    }
    if (!vor) return NAN;
    if (!nach || nach->sample == vor->sample) return vor->wert;
    return vor->wert + (nach->wert - vor->wert) * double(s - vor->sample) / double(nach->sample - vor->sample);
  }
  int zaehle(int32_t art, const char* pfad = nullptr) const {
    int n = 0;
    for (const auto& e : ev) n += (e.art == art && (!pfad || !std::strcmp(e.pfad, pfad))) ? 1 : 0;
    return n;
  }
  // Energie (dB) des Master-Signals im Fenster [s, s + 2048) (Kern-Samples; ab muss davor liegen)
  double energie_db(int64_t s) const {
    double e = 0.0;
    for (int64_t i = s; i < s + 2048; ++i) {
      const double x = master[(size_t)(i - ab)];
      e += x * x;
    }
    return 10.0 * std::log10(e + 1e-300);
  }
  double spitze(int64_t von, int64_t bis_ex) const {
    double m = 0.0;
    for (int64_t i = von; i < bis_ex; ++i) m = std::fmax(m, std::fabs(master[(size_t)(i - ab)]));
    return m;
  }
};
