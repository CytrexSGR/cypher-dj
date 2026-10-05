// Pegelmesser je Kanal für /pegel (SCHNITTSTELLEN 5.6): Spitze, Echtspitze, LUFS M und S
// über libebur128, drei Bandpegel aus den Bandsignalen des Isolators. Scheibe 14.
// Anlegen und Zerstören allokieren (ebur128_init): nie im Callback. verarbeite() ist echtzeitfest,
// schnappschuss() allokiert nicht, kostet aber eine Summe über 3 s Audio (Kosten im Bericht).
#pragma once

#include "ebur128.h"  // ebur128_state ist ein anonymes typedef-struct, nicht vorab deklarierbar

namespace cypherdj::dsp {

inline constexpr float kStummDb = -200.0f;   // SCHNITTSTELLEN 1.2: stumm = -200,0
inline constexpr int kMesserMaxBlock = 1024; // größere Blöcke werden intern geteilt

// Felder von /pegel ,sfffffff ohne kanal, in Vertragsreihenfolge (5.6).
struct PegelWerte {
  float spitze_db;        // Abtastspitze dBFS seit dem letzten Schnappschuss
  float echtspitze_dbtp;  // Echtspitze dBTP (BS.1770, 4-fach überabgetastet) seit dem letzten Schnappschuss
  float lufs_m;           // LUFS momentan (400 ms), laufendes Fenster
  float lufs_s;           // LUFS kurz (3 s), laufendes Fenster
  float band_tief_db;     // RMS dBFS des Isolator-Tiefbands seit dem letzten Schnappschuss
  float band_mitte_db;
  float band_hoch_db;
};

// Bandsignale des LR8-Isolators am Mess-Abgriff, vor dem Band-Gain (5.6); liefert Scheibe 04,
// verdrahtet der Kern (43). Jeder Zeiger zeigt auf n Samples.
struct IsoBaender {
  const float* tief[2];
  const float* mitte[2];
  const float* hoch[2];
};

class PegelMesser {
 public:
  PegelMesser();
  ~PegelMesser();
  PegelMesser(const PegelMesser&) = delete;
  PegelMesser& operator=(const PegelMesser&) = delete;

  bool gueltig() const { return st_ != nullptr; }

  // n Frames links/rechts, iso darf nullptr sein (dann bleiben die Bandpegel stumm).
  void verarbeite(const float* l, const float* r, int n, const IsoBaender* iso);

  // Werte für /pegel (20 Hz); setzt Spitze, Echtspitze und Bandsummen zurück.
  // Alles <= -120 dB und Stille (-inf) kommt als -200,0 (1.2).
  PegelWerte schnappschuss();

 private:
  ebur128_state* st_;
  float verschraenkt_[2 * kMesserMaxBlock];
  float spitze_;
  double echtspitze_;
  double summe_iso_[3];
  long n_iso_;
};

// 20*log10(linear) bzw. 10*log10(leistung) mit Stumm-Regel (1.2).
float in_db(double linear);
float leistung_in_db(double leistung);

}  // namespace cypherdj::dsp
