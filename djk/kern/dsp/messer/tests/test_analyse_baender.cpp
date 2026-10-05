// Tests der sechs Analyse-Bänder (Scheibe 14, SCHNITTSTELLEN 6.2).
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <vector>

#include "alloc_waechter.h"
#include "cypherdj/dsp/analyse_baender.h"
#include "ebur128.h"
#include "frequenzgang.h"
#include "pruef.h"

using namespace cypherdj::dsp;

static constexpr double kSr = 48000.0;

static std::vector<HuellenWerte> lauf(AnalyseBaender& a, const std::vector<float>& l, const std::vector<float>& r,
                                      int block) {
  std::vector<HuellenWerte> alle;
  std::vector<HuellenWerte> puffer(block / kFenster + 2);
  for (size_t p = 0; p < l.size(); p += block) {
    const int n = static_cast<int>(std::min<size_t>(block, l.size() - p));
    const int k = a.verarbeite(&l[p], &r[p], n, puffer.data(), static_cast<int>(puffer.size()));
    for (int i = 0; i < k; ++i) alle.push_back(puffer[i]);
  }
  return alle;
}

static void test_stille_ist_null() {
  AnalyseBaender a(vertrag_baender());
  std::vector<float> z(48000, 0.0f);
  auto w = lauf(a, z, z, 256);
  PRUEFE(w.size() == 1000);
  bool alle_null = true;
  for (auto& h : w) {
    for (float v : h.band) alle_null = alle_null && v == 0.0f;
    alle_null = alle_null && h.k_leistung == 0.0f && h.spitze == 0.0f;
  }
  PRUEFE(alle_null);
}

static void test_sinus_je_band_gegen_frequenzgang() {
  // Je Band ein Sinus mit ganzzahliger Frequenz, 2 s, Amplitude 0,5 auf beiden Kanälen.
  // Erwartet nach dem Einschwingen: sqrt(Mittel von band^2) = 0,5 * |H_b(f)| / sqrt(2) für jedes b
  // (RMS eines Sinus, Leistung über beide Kanäle gemittelt).
  const double freq[6] = {60, 170, 500, 1300, 3500, 10000};
  for (double f : freq) {
    AnalyseBaender a(vertrag_baender());
    std::vector<float> x(96000);
    for (size_t i = 0; i < x.size(); ++i) x[i] = static_cast<float>(0.5 * std::sin(2.0 * M_PI * f * i / kSr));
    auto w = lauf(a, x, x, 256);
    for (int b = 0; b < kBaender; ++b) {
      double summe = 0.0;
      for (size_t i = 1000; i < 2000; ++i) summe += double(w[i].band[b]) * w[i].band[b];  // zweite Sekunde
      const double ist = std::sqrt(summe / 1000.0);
      const double soll = 0.5 * betrag_frequenzgang(vertrag_baender().band[b], f) / std::sqrt(2.0);
      PRUEFE_NAHE(ist, soll, 1e-4 * 0.5 + 1e-4 * soll);
    }
  }
}

static void test_bloecke_egal() {
  // 2 s Rauschen in Blöcken zu 256, 1, 48, 1000: Datensätze bitgleich.
  std::vector<float> l(96000), r(96000);
  uint32_t s = 12345;
  for (size_t i = 0; i < l.size(); ++i) {
    s = s * 1664525u + 1013904223u;
    l[i] = (static_cast<float>(s >> 8) / 16777216.0f - 0.5f) * 0.4f;
    s = s * 1664525u + 1013904223u;
    r[i] = (static_cast<float>(s >> 8) / 16777216.0f - 0.5f) * 0.4f;
  }
  AnalyseBaender a256(vertrag_baender()), a1(vertrag_baender()), a48(vertrag_baender()), a1000(vertrag_baender());
  auto w256 = lauf(a256, l, r, 256), w1 = lauf(a1, l, r, 1), w48 = lauf(a48, l, r, 48), w1000 = lauf(a1000, l, r, 1000);
  PRUEFE(w256.size() == 2000 && w1.size() == 2000 && w48.size() == 2000 && w1000.size() == 2000);
  bool gleich = true;
  for (size_t i = 0; i < w256.size() && i < w1.size() && i < w48.size() && i < w1000.size(); ++i)
    for (int b = 0; b < kBaender; ++b)
      gleich = gleich && w256[i].band[b] == w1[i].band[b] && w256[i].band[b] == w48[i].band[b] &&
               w256[i].band[b] == w1000[i].band[b] && w256[i].k_leistung == w1[i].k_leistung &&
               w256[i].spitze == w1000[i].spitze;
  PRUEFE(gleich);
}

static void test_ausrichtung() {
  // Erstes Sample 100: das erste Fenster endet auf Sample 143 ((143 + 1) % 48 == 0), Offset 43.
  AnalyseBaender a(vertrag_baender());
  a.zuruecksetzen(100);
  std::vector<float> z(256, 0.0f);
  HuellenWerte h[8];
  const int k = a.verarbeite(z.data(), z.data(), 256, h, 8);
  PRUEFE(k == 5);  // Enden 143, 191, 239, 287, 335 -> Offsets 43, 91, 139, 187, 235
  PRUEFE(h[0].ende_offset == 43);
  PRUEFE(h[4].ende_offset == 235);
}

static void test_spitze_je_fenster() {
  AnalyseBaender a(vertrag_baender());
  std::vector<float> l(96, 0.0f), r(96, 0.0f);
  l[10] = -0.7f;
  r[60] = 0.25f;
  HuellenWerte h[4];
  const int k = a.verarbeite(l.data(), r.data(), 96, h, 4);
  PRUEFE(k == 2);
  PRUEFE(h[0].spitze == 0.7f);
  PRUEFE(h[1].spitze == 0.25f);
}

static void test_k_leistung_gegen_libebur128() {
  // 1-kHz-Sinus -23 dBFS auf beiden Kanälen, 2 s: LUFS aus dem Mittel von k_leistung über die
  // letzten 400 Datensätze (400 ms) gegen ebur128_loudness_momentary desselben Signals.
  const double a0 = std::pow(10.0, -23.0 / 20.0);
  std::vector<float> x(96000);
  for (size_t i = 0; i < x.size(); ++i) x[i] = static_cast<float>(a0 * std::sin(2.0 * M_PI * 1000.0 * i / kSr));
  AnalyseBaender a(vertrag_baender());
  auto w = lauf(a, x, x, 256);
  double summe = 0.0;
  for (size_t i = w.size() - 400; i < w.size(); ++i) summe += w[i].k_leistung;
  const double lufs_baender = -0.691 + 10.0 * std::log10(summe / 400.0);
  ebur128_state* st = ebur128_init(2, 48000, EBUR128_MODE_M);
  std::vector<float> v(2 * x.size());
  for (size_t i = 0; i < x.size(); ++i) v[2 * i] = v[2 * i + 1] = x[i];
  ebur128_add_frames_float(st, v.data(), x.size());
  double m = 0.0;
  ebur128_loudness_momentary(st, &m);
  ebur128_destroy(&st);
  PRUEFE_NAHE(lufs_baender, m, 0.001);
  PRUEFE_NAHE(lufs_baender, -23.0, 0.01);
}

static void test_keine_allokation() {
  AnalyseBaender a(vertrag_baender());
  std::vector<float> l(256, 0.1f), r(256, -0.1f);
  HuellenWerte h[8];
  long zahl = -1;
  {
    AllocFenster f;
    for (int i = 0; i < 10000; ++i) a.verarbeite(l.data(), r.data(), 256, h, 8);
    zahl = f.zahl();
  }
  PRUEFE(zahl == 0);
}

static void test_waechter_sieht_allokation() {
  // Positiv-Kontrolle des Wächters: ein std::vector im Fenster muss gezählt werden.
  long zahl = 0;
  {
    AllocFenster f;
    std::vector<float>* v = new std::vector<float>(1000);
    delete v;
    zahl = f.zahl();
  }
  PRUEFE(zahl >= 2);
}

int main() {
  test_stille_ist_null();
  test_sinus_je_band_gegen_frequenzgang();
  test_bloecke_egal();
  test_ausrichtung();
  test_spitze_je_fenster();
  test_k_leistung_gegen_libebur128();
  test_keine_allokation();
  test_waechter_sieht_allokation();
  return pruef_ende("test_analyse_baender");
}
