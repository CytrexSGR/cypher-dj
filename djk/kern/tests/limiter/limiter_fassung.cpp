// Scheibe 25: Master-Limiter an einer echten Fassung (MVP „Lücken und Entscheide“: sonst übersteuern 9 von 14 Fassungen).
// Aufruf: kern_limiter_fassung <basis.f32> <trim_db> <eq_db> <ausgang.f32>
// Die Fassung (float32 LE Stereo verschränkt, 48 kHz, Werkstatt 15) läuft durch deck/1 des Betriebs-Mixers (Kanalzug
// aus 04, Master-Limiter aus 14, Decke −1 dBTP) mit Trim <trim_db> (§1.5: ziel_lufs − lufs_integriert), EQ tief, mitte,
// hoch je <eq_db>, Fader 0 dB. Gemessen mit libebur128 (BS.1770, 4-fach): Echtspitze der Fassung roh, nach Trim und EQ
// in einem allein gerechneten Kanalzug (= Master ohne Limiter) und am Master. Der Master geht nach
// <ausgang.f32> für die unabhängige 8-fach-Gegenprobe (djk/kern/dsp/messer/pruefung/echtspitze.py).
// Gebaut zweimal: kern_limiter_fassung (Betrieb) und kern_limiter_fassung_ohne (CYPHERDJ_MUTATION_OHNE_LIMITER).
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <vector>

#include "cypherdj/mixer.h"
#include "ebur128.h"

namespace sw = cypherdj::stellwerk;

static double dbtp(ebur128_state* st) {
  double a = 0.0, b = 0.0;
  ebur128_true_peak(st, 0, &a);
  ebur128_true_peak(st, 1, &b);
  const double m = a > b ? a : b;
  return m > 0.0 ? 20.0 * std::log10(m) : -200.0;
}

int main(int argc, char** argv) {
  if (argc != 5) {
    std::fprintf(stderr, "Aufruf: kern_limiter_fassung <basis.f32> <trim_db> <eq_db> <ausgang.f32>\n");
    return 2;
  }
  std::FILE* ein = std::fopen(argv[1], "rb");
  std::FILE* aus = std::fopen(argv[4], "wb");
  if (!ein || !aus) {
    std::fprintf(stderr, "Datei nicht offen\n");
    return 2;
  }
  const float trim = static_cast<float>(std::atof(argv[2])), eq = static_cast<float>(std::atof(argv[3]));
  sw::ReglerTabelle tab;
  auto m = std::make_unique<cdj::Mixer>(tab);
  auto setze = [&](const char* p, float w) { m->setze_sofort(tab.suche(p), w); };
  setze("deck/1/fader", 0.0f);
  setze("deck/1/trim", trim);
  setze("deck/1/eq/tief", eq);
  setze("deck/1/eq/mitte", eq);
  setze("deck/1/eq/hoch", eq);
  ebur128_state* st_roh = ebur128_init(2, 48000, EBUR128_MODE_TRUE_PEAK);
  ebur128_state* st_kanal = ebur128_init(2, 48000, EBUR128_MODE_TRUE_PEAK);
  ebur128_state* st_master = ebur128_init(2, 48000, EBUR128_MODE_TRUE_PEAK);
  std::vector<float> v(2 * 256), o(2 * 256), k(2 * 256);
  float ml[256], mr[256], cl[256], cr[256];
  long frames = 0;
  float absenkung = 0.0f;
  for (;;) {
    const size_t n = std::fread(v.data(), sizeof(float) * 2, 256, ein);
    if (n == 0) break;
    if (n < 256) std::memset(v.data() + 2 * n, 0, sizeof(float) * 2 * (256 - n));
    float* l = m->eingang_l(0);
    float* r = m->eingang_r(0);
    for (int i = 0; i < 256; ++i) {
      l[i] = v[2 * i];
      r[i] = v[2 * i + 1];
    }
    ebur128_add_frames_float(st_roh, v.data(), n);
    m->verarbeite(256, ml, mr, cl, cr);
    for (int i = 0; i < 256; ++i) {
      o[2 * i] = ml[i];
      o[2 * i + 1] = mr[i];
    }
    ebur128_add_frames_float(st_master, o.data(), 256);
    std::fwrite(o.data(), sizeof(float) * 2, 256, aus);
    absenkung = std::fmin(absenkung, m->limiter_absenkung_db());
    frames += (long)n;
  }
  // Kanal ohne Limiter: dieselbe Fassung noch einmal durch einen Kanalzug allein (Trim, EQ, Fader wie oben)
  std::rewind(ein);
  auto kz = std::make_unique<cypherdj::dsp::Kanalzug>();
  kz->zuruecksetzen();
  kz->setze_sofort(cypherdj::dsp::Regler::fader, 0.0f);
  kz->setze_sofort(cypherdj::dsp::Regler::trim, trim);
  kz->setze_sofort(cypherdj::dsp::Regler::eq_tief, eq);
  kz->setze_sofort(cypherdj::dsp::Regler::eq_mitte, eq);
  kz->setze_sofort(cypherdj::dsp::Regler::eq_hoch, eq);
  float kl[256], kr[256], il[256], ir[256];
  cypherdj::dsp::KanalzugAusgang ka;
  ka.haupt_l = kl;
  ka.haupt_r = kr;
  for (;;) {
    const size_t n = std::fread(v.data(), sizeof(float) * 2, 256, ein);
    if (n == 0) break;
    if (n < 256) std::memset(v.data() + 2 * n, 0, sizeof(float) * 2 * (256 - n));
    for (int i = 0; i < 256; ++i) {
      il[i] = v[2 * i];
      ir[i] = v[2 * i + 1];
    }
    kz->verarbeite(il, ir, 256, ka);
    for (int i = 0; i < 256; ++i) {
      k[2 * i] = kl[i];
      k[2 * i + 1] = kr[i];
    }
    ebur128_add_frames_float(st_kanal, k.data(), 256);
  }
  std::printf("{\"datei\":\"%s\",\"frames\":%ld,\"trim_db\":%.2f,\"eq_db\":%.2f,\"roh_dbtp\":%.3f,\"kanal_dbtp\":%.3f,"
              "\"master_dbtp\":%.3f,\"groesste_absenkung_db\":%.2f,\"vorhalt\":%d}\n",
              argv[1], frames, trim, eq, dbtp(st_roh), dbtp(st_kanal), dbtp(st_master), absenkung,
              m->limiter_vorhalt());
  std::fclose(ein);
  std::fclose(aus);
  return 0;
}
