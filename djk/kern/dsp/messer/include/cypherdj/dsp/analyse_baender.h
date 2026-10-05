// Sechs Analyse-Bänder, K-gewichtete Leistung und Spitze je 48-Sample-Fenster (SCHNITTSTELLEN 6.2).
// Scheibe 14. Echtzeitfest: verarbeite() allokiert nicht, sperrt nicht, macht kein I/O.
#pragma once
#include <cstdint>

namespace cypherdj::dsp {

inline constexpr int kBaender = 6;        // Sub, Tief, Tiefmitte, Mitte, Präsenz, Hoch (6.2, 14.8)
inline constexpr int kMaxSektionen = 8;   // Biquads je Band höchstens
inline constexpr int kFenster = 48;       // ein Datensatz je 48 Samples (1 kHz)

struct BandKoeff {
  double von_hz, bis_hz;                  // Bandgrenzen laut baender.json
  int n_sektionen;                        // Zahl der Biquads dieses Bands
  double sos[kMaxSektionen][6];           // je Zeile b0 b1 b2 a0 a1 a2 mit a0 = 1 (scipy-SOS)
};

struct BaenderKoeff {
  BandKoeff band[kBaender];
  BandKoeff k_filter;                     // K-Filter BS.1770 (2 Sektionen), aus baender.json "k_filter"
};

// Die Koeffizienten aus djk/vertrag/baender.json, zur Bauzeit eingebaut (erzeuge_baender_h.py).
const BaenderKoeff& vertrag_baender();

// ITU-R BS.1770-4, K-Filter bei 48 kHz (Stufe 1 Shelf, Stufe 2 RLB-Hochpass), Normwerte; der Test
// prüft, dass baender.json genau diese Zahlen trägt.
inline constexpr double kKFilterNorm[2][6] = {
    {1.53512485958697, -2.69169618940638, 1.19839281085285, 1.0, -1.69065929318241, 0.73248077421585},
    {1.0, -2.0, 1.0, 1.0, -1.99004745483398, 0.99007225036621}};

// Die gerechneten Felder eines Hüllkurven-Datensatzes (6.2). sample, beat, quell_beat setzt der Kern (43).
struct HuellenWerte {
  float band[kBaender];  // RMS linear je Band: sqrt(Summe über 48 Samples von (yL^2 + yR^2) / (48 * 2))
  float k_leistung;      // mittlere K-gewichtete Leistung, Kanäle addiert (BS.1770, G = 1)
  float spitze;          // Betragsmaximum beider Kanäle im Fenster
  int ende_offset;       // Index des letzten Samples dieses Fensters im übergebenen Block
};

class AnalyseBaender {
 public:
  explicit AnalyseBaender(const BaenderKoeff& k);

  // Filterzustand auf 0; Fenster so ausrichten, dass jedes Fenster auf einem Sample s mit
  // (s + 1) % 48 == 0 endet. erstes_sample = Kern-Sample des nächsten Frames, der in
  // verarbeite() kommt (für Dateien: 0, dann gilt Index i = frame / 48 wie huelle_1khz.npy).
  void zuruecksetzen(int64_t erstes_sample);

  // n Frames links/rechts. Schreibt je vollendetem Fenster einen Datensatz nach aus und gibt
  // deren Zahl zurück; aus muss n / 48 + 1 Einträge fassen (max_aus), sonst werden die
  // überzähligen verworfen und -1 zurückgegeben.
  int verarbeite(const float* l, const float* r, int n, HuellenWerte* aus, int max_aus);

 private:
  struct Sektion {
    double b0, b1, b2, a1, a2;
  };
  Sektion sek_[kBaender][kMaxSektionen];
  int n_sek_[kBaender];
  double z_[kBaender][kMaxSektionen][2][2];  // [band][sektion][kanal][zustand], Direktform II transponiert
  Sektion ksek_[2];                          // K-Filter
  double kz_[2][2][2];                       // K-Filter [sektion][kanal][zustand]
  double summe_band_[kBaender];
  double summe_k_;
  float spitze_;
  int im_fenster_;                           // Samples im laufenden Fenster (0..47)
};

}  // namespace cypherdj::dsp
