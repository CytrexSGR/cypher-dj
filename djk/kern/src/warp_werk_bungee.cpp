// Paket 1.13 Warp, Slice 2: die Bungee-Maschine einer Warp-Stimme (warp_maschine.h). Dieselbe Rechnung wie dehner_bungee.cpp (Ablauf eines
// Ansatzes, Korn für Korn, die ersten drei Ausgaben verworfen), aber die Quellposition kommt je Korn aus der Abbildung der Stimme (Marker W(b) auf
// der Tempo-Karte) statt aus Anker und Basis-Tempo: Bungees Positions-API nimmt eine beliebige absolute Position je Korn, also läuft nichts weg.
// Bungee allokiert in reset, preroll, specifyGrain, analyseGrain, synthesiseGrain nie (test_dehner_bungee Test 3); alle Puffer entstehen im
// Konstruktor. Nur mit CYPHERDJ_BUNGEE gebaut (CMakeLists.txt).
#include <bungee/Bungee.h>

#include <algorithm>
#include <cmath>
#include <cstring>
#include <vector>

#include "cypherdj/warp_maschine.h"
#include "cypherdj/warp_werk.h"

namespace cdj {
namespace {

using Stretcher = Bungee::Stretcher<Bungee::Basic>;

class Maschine final : public WarpMaschine {
 public:
  explicit Maschine(bool fein)
      : hop_(fein ? 256 : 512), st_(Bungee::SampleRates{48000, 48000}, 2, fein ? -1 : 0) {
    stride_ = st_.maxInputFrameCount();
    in_.assign(2 * static_cast<std::size_t>(stride_), 0.0f);
    fl_.assign(FIFO, 0.0f);
    fr_.assign(FIFO, 0.0f);
    // Warm laufen wie dehner_bungee.cpp: Speicher berühren, Seitenfehler gehören nicht in den Betrieb. Danach beginnt jeder Ansatz mit reset.
    for (const double p : {1.4983070768766815, 1.0}) {   // Slice 5: beide Wege berühren (der Neuabtast-Weg bei pitch != 1); pitch 1 ZULETZT, damit der Endzustand der Maschine der von vor Slice 5 ist (D10)
      Bungee::Request r{};
      r.position = 100000.0;
      r.speed = 1.05;
      r.pitch = p;
      r.reset = true;
      r.resampleMode = resampleMode_autoOut;
      st_.preroll(r);
      for (int k = 0; k < 8; ++k) {
        (void)st_.specifyGrain(r);
        std::memset(in_.data(), 0, in_.size() * sizeof(float));
        st_.analyseGrain(in_.data(), stride_, 0, 0);
        Bungee::OutputChunk oc{};
        st_.synthesiseGrain(oc);
        st_.next(r);
      }
    }
  }

  void ansetzen(const WarpAbbild& a, int64_t s_h) noexcept override {
    s_h_ = s_h;
    gk_ = 0;
    pitch_ = a.tonhoehe();
    korn_nr_ = 0;
    fifo_n_ = 0;
    req_ = Bungee::Request{};
    req_.position = a.position(static_cast<double>(s_h));
    req_.speed = tempo(a.geschwindigkeit(static_cast<double>(s_h)));
    req_.pitch = pitch_;
    req_.reset = true;
    req_.resampleMode = resampleMode_autoOut;
    st_.preroll(req_);
    erstes_ = true;
  }

  void block(const WarpAbbild& a, float* l, float* r) noexcept override {
    while (fifo_n_ < WARP_BLOCK) korn(a);
    std::memcpy(l, fl_.data(), WARP_BLOCK * sizeof(float));
    std::memcpy(r, fr_.data(), WARP_BLOCK * sizeof(float));
    fifo_n_ -= WARP_BLOCK;
    std::memmove(fl_.data(), fl_.data() + WARP_BLOCK, static_cast<std::size_t>(fifo_n_) * sizeof(float));
    std::memmove(fr_.data(), fr_.data() + WARP_BLOCK, static_cast<std::size_t>(fifo_n_) * sizeof(float));
  }

 private:
  static constexpr int FIFO = 4096;   // höchstens 255 Rest + ein Korn (Bungee: bis 2049 Frames)
  static_assert(255 + 512 * 4 + 1 <= FIFO, "ein COMPLEX-Korn bei pitch 0,25 (2049 Frames) plus Rest muss passen");   // ARR_WARP_PITCH_MIN >= 0,25 (Lader)

  static double tempo(double v) { return std::min(16.0, std::max(0.05, v)); }   // nur der Hinweis für Bungee; die Position bestimmt die Lage

  void korn(const WarpAbbild& a) noexcept {
    const Bungee::InputChunk ch = st_.specifyGrain(req_);
    const int len = ch.end - ch.begin;
    a.band(ch.begin, len, in_.data(), in_.data() + stride_);
    st_.analyseGrain(in_.data(), stride_, 0, 0);
    Bungee::OutputChunk oc{};
    st_.synthesiseGrain(oc);
    // Die Ausgabe eines Korns reicht von der Position des Korns k−2 bis k−1: die ersten drei Ausgaben tragen noch die Zeit vor s_h (dehner_bungee.cpp)
    const int skip = korn_nr_ < 3 ? oc.frameCount : 0;
    ++korn_nr_;
    const int n = oc.frameCount - skip;
    if (n > 0 && fifo_n_ + n <= FIFO) {
      std::memcpy(fl_.data() + fifo_n_, oc.data + skip, static_cast<std::size_t>(n) * sizeof(float));
      std::memcpy(fr_.data() + fifo_n_, oc.data + oc.channelStride + skip, static_cast<std::size_t>(n) * sizeof(float));
      fifo_n_ += n;
    }
    req_.reset = false;
    if (erstes_) erstes_ = false;
    else ++gk_;
#ifndef CYPHERDJ_MUTATION_WARP_HOP_FEST   // Fehlerfall: Korn-Abstand Hop statt Hop / pitch (die Lage läuft mit dem Faktor pitch aus dem Raster)
    const double m = static_cast<double>(s_h_) + static_cast<double>(gk_) * static_cast<double>(hop_) / pitch_;
#else
    const double m = static_cast<double>(s_h_) + static_cast<double>(gk_) * static_cast<double>(hop_);
#endif
    req_.position = a.position(m);
    req_.speed = tempo(a.geschwindigkeit(m));
  }

  int hop_;
  Stretcher st_;
  int stride_ = 0;
  std::vector<float> in_, fl_, fr_;
  int fifo_n_ = 0;
  int64_t s_h_ = 0, gk_ = 0;
  double pitch_ = 1.0;
  int korn_nr_ = 0;
  bool erstes_ = true;
  Bungee::Request req_{};
};

}  // namespace

std::unique_ptr<WarpMaschine> warp_maschine_bungee_neu(bool fein) { return std::unique_ptr<WarpMaschine>(new Maschine(fein)); }

}  // namespace cdj
