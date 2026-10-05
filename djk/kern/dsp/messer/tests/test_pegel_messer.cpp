// Tests des Pegelmessers (Scheibe 14, SCHNITTSTELLEN 5.6).
#include <cmath>
#include <cstdio>
#include <vector>

#include "alloc_waechter.h"
#include "cypherdj/dsp/pegel_messer.h"
#include "ebur128.h"
#include "pruef.h"

using namespace cypherdj::dsp;

static PegelWerte sinus_lauf(PegelMesser& m, double f, double dbfs, double phase, double sekunden) {
  const double a = std::pow(10.0, dbfs / 20.0);
  const int n = static_cast<int>(sekunden * 48000.0);
  std::vector<float> x(256);
  for (int p = 0; p < n; p += 256) {
    const int k = std::min(256, n - p);
    for (int i = 0; i < k; ++i) x[i] = static_cast<float>(a * std::sin(2.0 * M_PI * f * (p + i) / 48000.0 + phase));
    m.verarbeite(x.data(), x.data(), k, nullptr);
  }
  return m.schnappschuss();
}

static void test_ebu_fall_1_und_2() {
  // EBU Tech 3341 Fall 1 und 2: Stereo-Sinus 1 kHz, -23 bzw. -33 dBFS, 20 s. Abnahme: +-0,01 LU (04 §4.7: 0,007).
  PegelMesser m1;
  PRUEFE(m1.gueltig());
  PegelWerte w1 = sinus_lauf(m1, 1000.0, -23.0, 0.0, 20.0);
  std::printf("ebu fall1 lufs_m %.3f lufs_s %.3f (Soll -23,0 +-0,01)\n", w1.lufs_m, w1.lufs_s);
  PRUEFE_NAHE(w1.lufs_m, -23.0, 0.01);
  PRUEFE_NAHE(w1.lufs_s, -23.0, 0.01);
  PegelMesser m2;
  PegelWerte w2 = sinus_lauf(m2, 1000.0, -33.0, 0.0, 20.0);
  std::printf("ebu fall2 lufs_m %.3f lufs_s %.3f (Soll -33,0 +-0,01)\n", w2.lufs_m, w2.lufs_s);
  PRUEFE_NAHE(w2.lufs_m, -33.0, 0.01);
  PRUEFE_NAHE(w2.lufs_s, -33.0, 0.01);
}

static void test_echtspitze() {
  // 12 kHz, Phase pi/4, Amplitude 0,5: Abtastspitze -9,031 dBFS, Echtspitze -5,917 dBTP (04 §4.7, gleiche Bibliothek;
  // wahre Spitze -6,02). Gegenprobe Phase 0: Abtast- gleich Echtspitze -6,021.
  PegelMesser m;
  PegelWerte w = sinus_lauf(m, 12000.0, 20.0 * std::log10(0.5), M_PI / 4.0, 5.0);
  std::printf("echtspitze 12 kHz pi/4: spitze_db %.3f echtspitze_dbtp %.3f\n", w.spitze_db, w.echtspitze_dbtp);
  PRUEFE_NAHE(w.spitze_db, -9.031, 0.01);
  PRUEFE_NAHE(w.echtspitze_dbtp, -5.917, 0.01);
  PRUEFE(w.echtspitze_dbtp > w.spitze_db + 2.9f);
  PegelMesser g;
  PegelWerte v = sinus_lauf(g, 12000.0, 20.0 * std::log10(0.5), 0.0, 5.0);
  PRUEFE_NAHE(v.spitze_db, -6.021, 0.01);
  PRUEFE_NAHE(v.echtspitze_dbtp, -6.021, 0.01);
}

static void test_stille_und_zuruecksetzen() {
  PegelMesser m;
  PegelWerte s = sinus_lauf(m, 1000.0, -300.0, 0.0, 1.0);  // Amplitude 1e-15: unter -120 dB
  PRUEFE(s.spitze_db == kStummDb && s.echtspitze_dbtp == kStummDb);
  PRUEFE(s.lufs_m == kStummDb && s.lufs_s == kStummDb);
  PRUEFE(s.band_tief_db == kStummDb && s.band_mitte_db == kStummDb && s.band_hoch_db == kStummDb);
  PegelMesser n;
  sinus_lauf(n, 1000.0, -6.0, 0.0, 1.0);                     // laut, Schnappschuss verworfen
  std::vector<float> z(4800, 0.0f);
  n.verarbeite(z.data(), z.data(), 4800, nullptr);           // 100 ms Stille
  PegelWerte t = n.schnappschuss();
  PRUEFE(t.spitze_db == kStummDb);                          // Spitze gilt seit dem letzten Schnappschuss
  PRUEFE(t.lufs_s > -20.0f);                                // 3-s-Fenster enthält noch den Sinus
  n.verarbeite(z.data(), z.data(), 4800, nullptr);           // weitere 100 ms Stille
  PegelWerte u = n.schnappschuss();                          // der Interpolator (6 Samples Laufzeit) ist leer
  PRUEFE(u.echtspitze_dbtp == kStummDb);
}

static void test_iso_bandpegel() {
  // Tief: 100 Hz Amplitude 0,5 (RMS -9,031 dB); Mitte: Stille; Hoch: 5 kHz Amplitude 0,1 (RMS -23,010 dB).
  PegelMesser m;
  std::vector<float> t(4800), mi(4800, 0.0f), h(4800), x(4800, 0.0f);
  for (int i = 0; i < 4800; ++i) {
    t[i] = static_cast<float>(0.5 * std::sin(2.0 * M_PI * 100.0 * i / 48000.0));
    h[i] = static_cast<float>(0.1 * std::sin(2.0 * M_PI * 5000.0 * i / 48000.0));
  }
  IsoBaender iso{{t.data(), t.data()}, {mi.data(), mi.data()}, {h.data(), h.data()}};
  m.verarbeite(x.data(), x.data(), 4800, &iso);
  PegelWerte w = m.schnappschuss();
  PRUEFE_NAHE(w.band_tief_db, -9.031, 0.01);
  PRUEFE(w.band_mitte_db == kStummDb);
  PRUEFE_NAHE(w.band_hoch_db, -23.010, 0.01);
}

static void test_keine_allokation() {
  PegelMesser m;
  std::vector<float> l(256), r(256), t(256, 0.1f);
  for (int i = 0; i < 256; ++i) l[i] = r[i] = static_cast<float>(0.3 * std::sin(i * 0.1));
  IsoBaender iso{{t.data(), t.data()}, {t.data(), t.data()}, {t.data(), t.data()}};
  long zahl = -1;
  {
    AllocFenster f;
    for (int i = 0; i < 10000; ++i) {  // 53 s Audio, gut 500 Schnappschüsse
      m.verarbeite(l.data(), r.data(), 256, &iso);
      if (i % 19 == 0) m.schnappschuss();
    }
    zahl = f.zahl();
  }
  PRUEFE(zahl == 0);
}

static void test_waechter_sieht_modus_i() {
  // Fehlerfall des Instruments: libebur128 mit MODE_I allokiert je 100 ms (04 NP K3), der Wächter muss es sehen.
  ebur128_state* st = ebur128_init(2, 48000, EBUR128_MODE_I);
  std::vector<float> v(2 * 256, 0.2f);
  long zahl = 0;
  {
    AllocFenster f;
    for (int i = 0; i < 1000; ++i) ebur128_add_frames_float(st, v.data(), 256);
    zahl = f.zahl();
  }
  ebur128_destroy(&st);
  PRUEFE(zahl > 0);
}

int main() {
  test_ebu_fall_1_und_2();
  test_echtspitze();
  test_stille_und_zuruecksetzen();
  test_iso_bandpegel();
  test_keine_allokation();
  test_waechter_sieht_modus_i();
  return pruef_ende("test_pegel_messer");
}
