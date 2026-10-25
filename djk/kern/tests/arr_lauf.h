// D1 K1: Prüfaufbau des Kerns mit Arrangement ohne JACK (Muster kern35.h). Wiedergaben entstehen als Datei im
// Arbeitsordner (arr_datei.h), lade_wiedergabe() lädt sie wie der Lade-Faden (ohne mlock), der Schnappschuss geht als
// Befehl ARR_LADEN in den Kern. ARR_ALT-Rückgaben gibt der Aufbau nach jedem Lauf frei. erz/4 ist offen (Fader 0 dB),
// der Prüfmodus aus (das Metronom ist dort gesperrt). Mitgeschrieben: Master (k35::Lauf l, r) und Cue links (cue_l),
// je Index = Kern-Sample des schreibenden Blocks; der Master liegt um den Limiter-Vorhalt vh (84) dahinter.
#pragma once

#include <memory>
#include <string>
#include <vector>

#include "arr_datei.h"
#include "cypherdj/arr_wiedergabe.h"
#include "kern35.h"

namespace arr35 {

struct Lauf : k35::Lauf {
  arrdatei::Ordner ordner;
  cdj::SpeicherKonto konto{3800LL << 20};
  cdj::ArrAudioCache cache{&konto, 1024LL << 20, false};
  std::vector<float> cue_l;
  std::vector<float> pm_l, pm_r;   // PM-Abgriff des Kerns je Zyklus (Index = Kern-Sample, 1.10)
  size_t frei_bis = 0;

  Lauf(const std::string& ab, const char* name, const char* mapping = nullptr) : k35::Lauf(ab, mapping), ordner(name) {
    kern->setze_pruefmodus(false);
    teil("erz/4/fader", 0.0f, 0.0, 0.0);   // Spec 2.3: der Server setzt erz/4 neutral; die Vorgabe ist −200 dB
  }
  ~Lauf() {
    frei();
    if (const cdj::ArrSnapshot* s = kern->arrangement().snapshot())
      cdj::gib_wiedergabe(const_cast<cdj::ArrSnapshot*>(s), cache);
  }
  int64_t laden(int64_t nr, const std::string& spuren, const char* quelle = "andreas", bool v2 = false) {   // v2: Format /2 (Paket 1.13, Warp)
    if (v2) ordner.wiedergabe2_warp(nr, spuren); else ordner.wiedergabe(nr, spuren);
    cdj::ArrLadeErgebnis e = cdj::lade_wiedergabe(ordner.pfad, nr, cache);
    PRUEF(e.snap != nullptr);
    if (!e.snap) return -1;
    cdj::Befehl b = neu(cdj::Befehl::ARR_LADEN, quelle);
    b.zeiger = e.snap.release();
    b.arr_nr = nr;
    return sende(b);
  }
  // 1.10: Wiedergabe /2 mit Gruppen-Liste (JSON-Elemente ohne eckige Klammern)
  int64_t laden2(int64_t nr, const std::string& spuren, const std::string& gruppen, const char* quelle = "andreas") {
    ordner.wiedergabe2(nr, spuren, gruppen);
    cdj::ArrLadeErgebnis e = cdj::lade_wiedergabe(ordner.pfad, nr, cache);
    PRUEF(e.snap != nullptr);
    if (!e.snap) return -1;
    cdj::Befehl b = neu(cdj::Befehl::ARR_LADEN, quelle);
    b.zeiger = e.snap.release();
    b.arr_nr = nr;
    return sende(b);
  }
  int64_t start(double beat, int quant, const char* quelle = "andreas") {
    cdj::Befehl b = neu(cdj::Befehl::ARR_START, quelle);
    b.ab_beat = beat;
    b.politik = quant;
    return sende(b);
  }
  int64_t stopp(int quant, const char* quelle = "andreas") {
    cdj::Befehl b = neu(cdj::Befehl::ARR_STOPP, quelle);
    b.politik = quant;
    return sende(b);
  }
  int64_t loop(bool an, double von, double bis, const char* quelle = "andreas") {
    cdj::Befehl b = neu(cdj::Befehl::ARR_LOOP, quelle);
    b.an = an ? 1 : 0;
    b.arr_von = von;
    b.arr_bis = bis;
    return sende(b);
  }
  int64_t metronom(bool an, float pegel_db, int ziel, const char* quelle = "andreas") {
    cdj::Befehl b = neu(cdj::Befehl::ARR_METRONOM, quelle);
    b.an = an ? 1 : 0;
    b.wert = pegel_db;
    b.nr = ziel;
    return sende(b);
  }
  int64_t rec_spur(int spur, int scharf, int eingang, cdj::RecSpur* p, const char* quelle = "andreas") {
    cdj::Befehl b = neu(cdj::Befehl::REC_SPUR, quelle);
    b.nr = spur; b.an = scharf; b.deck = eingang; b.zeiger = p;
    return sende(b);
  }
  int64_t rec_start(int kennung, int nachlauf, int64_t frist = 0, const char* quelle = "andreas") {   // frist 0: Vorgabe 96000
    cdj::Befehl b = neu(cdj::Befehl::REC_START, quelle);
    b.nr = kennung; b.fassung = nachlauf; b.versatz_f = frist;
    return sende(b);
  }
  int64_t rec_stopp(const char* quelle = "andreas") { return sende(neu(cdj::Befehl::REC_STOPP, quelle)); }
  void lauf(int64_t bis) {
    while (kern->sample() < bis) {
      const int64_t n0 = kern->sample();
      const uint64_t w0 = cdj_lade(&ring->w);
      zyklen(n0 + k35::N);
      const float* d = cdj_ring_daten_c(ring);
      if (static_cast<int64_t>(cue_l.size()) < n0 + k35::N) cue_l.resize(static_cast<size_t>(n0 + k35::N));
      for (int i = 0; i < k35::N; ++i) cue_l[n0 + i] = d[((w0 + static_cast<uint64_t>(i)) % CDJ_RING_CAP) * 4 + 2];
      if (static_cast<int64_t>(pm_l.size()) < n0 + k35::N) {
        pm_l.resize(static_cast<size_t>(n0 + k35::N));
        pm_r.resize(static_cast<size_t>(n0 + k35::N));
      }
      for (int i = 0; i < k35::N; ++i) {
        pm_l[n0 + i] = kern->pm_abgriff_l()[i];
        pm_r[n0 + i] = kern->pm_abgriff_r()[i];
      }
    }
    frei();
  }
  void frei() {
    for (; frei_bis < ev.size(); ++frei_bis)
      if (ev[frei_bis].art == cdj::Ereignis::ARR_ALT)
        cdj::gib_wiedergabe(static_cast<cdj::ArrSnapshot*>(const_cast<void*>(ev[frei_bis].zeiger)), cache);
  }
  // erstes Sample in [von, bis) mit Wert ungleich 0, sonst −1
  static int64_t erster(const std::vector<float>& x, int64_t von, int64_t bis) {
    for (int64_t i = von; i < bis && i < static_cast<int64_t>(x.size()); ++i)
      if (x[i] != 0.0f) return i;
    return -1;
  }
};

}  // namespace arr35
