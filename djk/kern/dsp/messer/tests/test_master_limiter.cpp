// Tests des Master-Limiters (Scheibe 14; ADR 008 Punkt 2; SCHNITTSTELLEN 2.1 limiter_dbtp = -1,0).
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <vector>

#include "alloc_waechter.h"
#include "cypherdj/dsp/master_limiter.h"
#include "ebur128.h"
#include "pruef.h"

using namespace cypherdj::dsp;

// Echtspitze in dBTP nach BS.1770 (libebur128, 4-fach), unabhängige Instanz als Messgerät.
static double echtspitze_dbtp(const std::vector<float>& l, const std::vector<float>& r) {
  ebur128_state* st = ebur128_init(2, 48000, EBUR128_MODE_TRUE_PEAK);
  std::vector<float> v(2 * l.size());
  for (size_t i = 0; i < l.size(); ++i) {
    v[2 * i] = l[i];
    v[2 * i + 1] = r[i];
  }
  ebur128_add_frames_float(st, v.data(), l.size());
  double a = 0.0, b = 0.0;
  ebur128_true_peak(st, 0, &a);
  ebur128_true_peak(st, 1, &b);
  ebur128_destroy(&st);
  const double m = a > b ? a : b;
  return m > 0.0 ? 20.0 * std::log10(m) : -200.0;
}

static void limitiere(MasterLimiter& lim, std::vector<float>& l, std::vector<float>& r) {
  for (size_t p = 0; p < l.size(); p += 256) {
    const int n = static_cast<int>(std::min<size_t>(256, l.size() - p));
    lim.verarbeite(&l[p], &r[p], n);
  }
}

static void test_vorhalt() {
  MasterLimiter lim;
  PRUEFE(lim.vorhalt_samples() == 64 + 8 + 12);  // anstieg + halten + Laufzeit des 8-fach-Interpolators
}

static void test_leise_bleibt_bitgleich() {
  // Negativ-Kontrolle: Echtspitze weit unter der Decke -> Ausgang = Eingang, um den Vorhalt verzögert, bitgleich.
  std::vector<float> l(48000), r(48000);
  uint32_t s = 777;
  for (size_t i = 0; i < l.size(); ++i) {
    s = s * 1664525u + 1013904223u;
    l[i] = (static_cast<float>(s >> 8) / 16777216.0f - 0.5f) * 0.4f;  // Spitze < 0,2
    r[i] = -l[i] * 0.5f;
  }
  std::vector<float> ol = l, or_ = r;
  MasterLimiter lim;
  limitiere(lim, ol, or_);
  const int d = lim.vorhalt_samples();
  bool gleich = true;
  for (size_t i = d; i < l.size(); ++i) gleich = gleich && ol[i] == l[i - d] && or_[i] == r[i - d];
  for (int i = 0; i < d; ++i) gleich = gleich && ol[i] == 0.0f;
  PRUEFE(gleich);
  PRUEFE(lim.groesste_absenkung_db() == 0.0f);
}

static void test_sinus_plus_6_dbfs() {
  // 1-kHz-Sinus Amplitude 2,0 (+6,02 dBFS): ohne Limiter (Fehlerfall) Echtspitze +6,02, mit Limiter <= -1,0 dBTP.
  std::vector<float> l(96000), r(96000);
  for (size_t i = 0; i < l.size(); ++i) l[i] = r[i] = static_cast<float>(2.0 * std::sin(2.0 * M_PI * 1000.0 * i / 48000.0));
  const double ein = echtspitze_dbtp(l, r);
  PRUEFE(ein > 6.0);
  MasterLimiter lim;
  limitiere(lim, l, r);
  const double aus = echtspitze_dbtp(l, r);
  std::printf("sinus 1 kHz +6 dBFS: echtspitze ein %.3f aus %.3f dBTP\n", ein, aus);
  PRUEFE(aus <= -1.0);
}

static void test_zwischenwert_spitze() {
  // Fehlerfall für reine Abtastspitzen-Erkennung: 12 kHz, Phase pi/4, Abtastwerte bei -1,5 dBFS, Echtspitze
  // rund +1,5 dBTP. Ein Limiter, der nur Abtastwerte sieht, liesse das durch.
  const double a = std::pow(10.0, -1.5 / 20.0) / std::sin(M_PI / 4.0);
  std::vector<float> l(48000), r(48000);
  for (size_t i = 0; i < l.size(); ++i) l[i] = r[i] = static_cast<float>(a * std::sin(2.0 * M_PI * 12000.0 * i / 48000.0 + M_PI / 4.0));
  float abtast = 0.0f;
  for (float v : l) abtast = std::fmax(abtast, std::fabs(v));
  PRUEFE(20.0 * std::log10(abtast) < -1.4);
  const double ein = echtspitze_dbtp(l, r);
  PRUEFE(ein > 1.0);
  MasterLimiter lim;
  limitiere(lim, l, r);
  const double aus = echtspitze_dbtp(l, r);
  std::printf("12 kHz pi/4, Abtastwerte -1,5 dBFS: echtspitze ein %.3f aus %.3f dBTP\n", ein, aus);
  PRUEFE(aus <= -1.0);
}

static void test_sprung_aus_stille() {
  // Stille, dann schlagartig Rauschen mit Spitzen bis +12 dBFS: kein Ausreisser über der Decke.
  std::vector<float> l(96000, 0.0f), r(96000, 0.0f);
  uint32_t s = 4242;
  for (size_t i = 48000; i < l.size(); ++i) {
    s = s * 1664525u + 1013904223u;
    l[i] = (static_cast<float>(s >> 8) / 16777216.0f - 0.5f) * 8.0f;
    s = s * 1664525u + 1013904223u;
    r[i] = (static_cast<float>(s >> 8) / 16777216.0f - 0.5f) * 8.0f;
  }
  MasterLimiter lim;
  limitiere(lim, l, r);
  const double aus = echtspitze_dbtp(l, r);
  const float absenkung = lim.groesste_absenkung_db();
  std::printf("rauschen aus stille, spitzen +12 dBFS: echtspitze aus %.3f dBTP, groesste absenkung %.2f dB\n", aus,
              absenkung);
  PRUEFE(aus <= -1.0);
  PRUEFE(absenkung < -12.0f);
}

static void test_nan_vergiftet_nicht() {
  // Ein NaN am Eingang darf weder den Ausgang noch den Zustand vergiften.
  std::vector<float> l(48000), r(48000);
  for (size_t i = 0; i < l.size(); ++i) l[i] = r[i] = static_cast<float>(0.1 * std::sin(2.0 * M_PI * 440.0 * i / 48000.0));
  l[1000] = NAN;
  r[2000] = INFINITY;
  std::vector<float> ol = l, or_ = r;
  MasterLimiter lim;
  limitiere(lim, ol, or_);
  bool endlich = true;
  for (size_t i = 0; i < ol.size(); ++i) endlich = endlich && std::isfinite(ol[i]) && std::isfinite(or_[i]);
  PRUEFE(endlich);
  const int d = lim.vorhalt_samples();
  bool spaeter_gleich = true;  // nach dem Ereignis wieder Verstärkung 1, bitgleich
  for (size_t i = 10000; i < l.size(); ++i) spaeter_gleich = spaeter_gleich && ol[i] == l[i - d];
  PRUEFE(spaeter_gleich);
}

static void test_keine_allokation() {
  MasterLimiter lim;
  std::vector<float> l(256), r(256);
  long zahl = -1;
  {
    AllocFenster f;
    for (int k = 0; k < 10000; ++k) {
      for (int i = 0; i < 256; ++i) l[i] = r[i] = static_cast<float>(3.0 * std::sin(0.05 * (k * 256 + i)));
      lim.verarbeite(l.data(), r.data(), 256);
    }
    zahl = f.zahl();
  }
  PRUEFE(zahl == 0);
}

int main() {
  test_vorhalt();
  test_leise_bleibt_bitgleich();
  test_sinus_plus_6_dbfs();
  test_zwischenwert_spitze();
  test_sprung_aus_stille();
  test_nan_vergiftet_nicht();
  test_keine_allokation();
  return pruef_ende("test_master_limiter");
}
