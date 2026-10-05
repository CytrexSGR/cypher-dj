// Master-Limiter mit Vorhalt und Echtspitzen-Erkennung (ARCHITEKTUR 3.1, ADR 008 Punkt 2,
// SCHNITTSTELLEN 2.1 limiter_dbtp). Scheibe 14. Stereo gekoppelt.
//
// Verfahren: je Eingangssample die Echtspitze mit zwei Interpolatoren, genommen wird die größere:
//   (a) derselbe 4-fach-Interpolator wie libebur128 (49 Abgriffe, Hann-Sinc; 6 Samples Laufzeit), damit der
//       Kern-Messer (/pegel echtspitze_dbtp) nie mehr als die Decke zeigt;
//   (b) ein 8-fach-Interpolator mit Kaiser-Sinc (192 Abgriffe, beta 6, bis 20 kHz auf 0,005 dB flach), weil (a)
//       Zwischenwerte mit Anteilen über 15 kHz unterschätzt (Probe plan-14: MFB +6 dB, nur (a): libebur128
//       -1,009 dBTP, 8-fach -0,729, 32-fach -0,726).
// Die Decke liegt intern um 0,01 dB (Rundung) plus 0,119 dB (Gitter von (b) bei 20 kHz) tiefer; mit (a), (b)
// und beiden Reserven: libebur128 -1,126, 8-fach -1,074, 32-fach -1,080 dBTP (dieselbe Probe).
// Daraus die nötige Verstärkung q = min(1, decke / spitze); Minimum über ein gleitendes Fenster
// (anstieg + 2*halten + 1); Abklingen einpolig, nie über dem Minimum; dann gleitender Mittelwert über
// anstieg + 1 Samples. Damit liegt die Verstärkung an jedem Ausgangssample unter der nötigen Verstärkung
// aller Eingangssamples im Abstand <= halten. Der Ausgang ist um vorhalt_samples() verzögert; um genau so
// viele Samples verzögert der Kern den Cue (ADR 008 Punkt 3).
// Echtzeitfest: verarbeite() allokiert nicht, sperrt nicht. NaN/Inf am Eingang zählen als 0.
#pragma once

namespace cypherdj::dsp {

struct LimiterEinstellung {
  float decke_dbtp = -1.0f;    // limiter_dbtp (2.1)
  int anstieg = 64;            // Samples bis zur vollen Absenkung (gesetzt, M18 hört)
  int halten = 8;              // Samples beidseits der Spitze mit voller Absenkung (gesetzt)
  float abklingen_ms = 50.0f;  // Zeitkonstante der Rückkehr (gesetzt)
};

class MasterLimiter {
 public:
  static constexpr int kInterpVerzug = 12;             // Laufzeit von (b); (a) wird um 6 nachgezogen
  static constexpr double kRundungsReserveDb = 0.01;   // Decke intern 0,01 dB tiefer
  static constexpr int kMaxFenster = 1024;             // anstieg + 2 * halten + 1 höchstens
  static constexpr int kMaxVorhalt = kMaxFenster + kInterpVerzug;
  static constexpr int kA_Phasen = 4, kA_Abgriffe = 13;  // (a) wie libebur128 interp_create(49, 4, ...)
  static constexpr int kB_Phasen = 8, kB_Abgriffe = 24;  // (b) 8 * 24 = 192 Abgriffe

  explicit MasterLimiter(const LimiterEinstellung& e = {});

  void verarbeite(float* l, float* r, int n);     // in place
  int vorhalt_samples() const { return vorhalt_; }
  float groesste_absenkung_db();                  // seit dem letzten Aufruf dieser Funktion, <= 0; setzt zurück
  void zuruecksetzen();

 private:
  float naechste_verstaerkung(float xl, float xr);

  // (a) libebur128-Interpolator
  double a_koeff_[kA_Phasen][kA_Abgriffe];
  int a_index_[kA_Phasen][kA_Abgriffe];
  int a_n_[kA_Phasen];
  float a_z_[2][kA_Abgriffe];
  int a_zi_;
  float a_nachzug_[6];  // Spitze aus (a), 6 Schritte verzögert auf die Laufzeit von (b)
  int a_nachzug_pos_;

  // (b) 8-fach-Interpolator, Verlauf doppelt abgelegt (zusammenhängendes Fenster)
  float b_koeff_[kB_Phasen][kB_Abgriffe];
  float b_verlauf_[2][2 * kB_Abgriffe];
  int b_pos_;

  // gleitendes Minimum (monotone Schlange) über fenster_ Werte
  float min_wert_[kMaxFenster + 1];
  long min_pos_[kMaxFenster + 1];
  int min_kopf_, min_ende_, min_n_;
  long zeit_;

  // Abklingen und gleitender Mittelwert über anstieg + 1 Werte
  double abkling_koeff_;
  double h_rel_;
  float mittel_ring_[kMaxFenster + 1];
  int mittel_pos_;
  double mittel_summe_;
  int unter_eins_;

  // Verzögerung des Signals
  float verz_[2][kMaxVorhalt + 1];
  int verz_pos_;

  float decke_;
  int anstieg_, halten_, fenster_, vorhalt_;
  float kleinste_verstaerkung_;
};

}  // namespace cypherdj::dsp
