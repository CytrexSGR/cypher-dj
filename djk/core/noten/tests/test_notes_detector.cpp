// Detector `erkenne` against the golden vectors (tests/daten/gold): per item, on the frames voiced in both curves |C++ - gold| <= 2 ct on at
// least 99 percent of them and <= 10 ct on all, voicing agreement >= 99.5 percent, konf within 0.02 on >= 99 percent of the frames. Plus
// silence, noise, very short inputs and non finite samples.
#include <cmath>
#include <cstdio>
#include <string>
#include <variant>
#include <vector>

#include <nlohmann/json.hpp>

#include "detector.h"
#include "check.h"
#include "synth.h"

using namespace cdj::noten;

static double anteilStimmhaft(const Kurve& k) {
  size_t n = 0;
  for (double v : k.f0_ct) if (v > 0) ++n;
  return k.f0_ct.empty() ? 0.0 : static_cast<double>(n) / static_cast<double>(k.f0_ct.size());
}

int main() {
  const std::string gold = std::string(NOTEN_DATEN) + "/gold/";
  auto text = liesText(gold + "gold.json");
  if (std::holds_alternative<Fehler>(text)) { std::fprintf(stderr, "gold.json: %s\n", std::get<Fehler>(text).text.c_str()); return 1; }
  const auto index = nlohmann::json::parse(std::get<std::string>(text));
  size_t geprueft = 0;
  for (const auto& item : index["items"]) {
    const std::string name = item["name"];
    auto g = liesSeitendatei(gold + name + ".kurve.json");
    if (std::holds_alternative<Fehler>(g)) { std::fprintf(stderr, "%s: gold curve unreadable\n", name.c_str()); PRUEF(false); continue; }
    const Kurve& soll = std::get<Seitendatei>(g).k;
    const std::vector<float> audio = liesS16(gold + name + ".s16");
    PRUEF(!audio.empty());
    const Kurve ist = erkenne(audio, 48000, nullptr);
    PRUEF(ist.frames == static_cast<int64_t>(audio.size()));
    PRUEF(ist.detektor == "pyin" && ist.kurve == "pyin-1.noten_hmm-1" && ist.sr == 48000 && ist.hop == 256);
    PRUEF(ist.f0_ct.size() == soll.f0_ct.size() && ist.konf.size() == soll.konf.size());
    if (ist.f0_ct.size() != soll.f0_ct.size()) continue;
    const size_t nf = soll.f0_ct.size();
    size_t beide = 0, nah = 0, einig = 0, konfNah = 0;
    double maxAbw = 0.0, maxKonf = 0.0;
    for (size_t t = 0; t < nf; ++t) {
      const bool a = ist.f0_ct[t] > 0, b = soll.f0_ct[t] > 0;
      if (a == b) ++einig;
      if (a && b) {
        ++beide;
        const double d = std::fabs(ist.f0_ct[t] - soll.f0_ct[t]);
        maxAbw = std::max(maxAbw, d);
        if (d <= 2.0) ++nah;
      }
      const double dk = std::fabs(ist.konf[t] - soll.konf[t]);
      maxKonf = std::max(maxKonf, dk);
      if (dk <= 0.02) ++konfNah;
      PRUEF(ist.konf[t] >= 0.0 && ist.konf[t] <= 1.0);
    }
    const double nahAnteil = beide ? static_cast<double>(nah) / static_cast<double>(beide) : 1.0;
    std::printf("%-28s frames %3zu, both voiced %3zu, within 2 ct %.4f, max %.2f ct, voicing agreement %.4f, konf within 0.02 %.4f (max %.3f)\n",
                name.c_str(), nf, beide, nahAnteil, maxAbw, static_cast<double>(einig) / static_cast<double>(nf),
                static_cast<double>(konfNah) / static_cast<double>(nf), maxKonf);
    PRUEF(nahAnteil >= 0.99);
    PRUEF(maxAbw <= 10.0);
    PRUEF(static_cast<double>(einig) / static_cast<double>(nf) >= 0.995);
    PRUEF(static_cast<double>(konfNah) / static_cast<double>(nf) >= 0.99);
    ++geprueft;
  }
  PRUEF(geprueft == index["items"].size() && geprueft == 11);

  // silence: every frame unvoiced; noise: at most 2 percent voiced
  {
    const Kurve k = erkenne(synth::stille(2.0), 48000, nullptr);
    PRUEF(k.f0_ct.size() == 376);
    PRUEF(anteilStimmhaft(k) == 0.0);
    for (double v : k.konf) PRUEF(v == 0.0);
    const Kurve r = erkenne(synth::rauschen(2.0, -20.0, 7), 48000, nullptr);
    PRUEF(anteilStimmhaft(r) <= 0.02);
    const Kurve r2 = erkenne(synth::rauschen(3.0, -40.0, 99), 48000, nullptr);
    PRUEF(anteilStimmhaft(r2) <= 0.02);
    // a quiet tone below the gate (-80 dBFS) is silence
    std::vector<synth::Ton> leise = {{0.0, 1.0, 60.0}};
    leise[0].pegel = 1e-4;
    PRUEF(anteilStimmhaft(erkenne(synth::melodie(leise, 1.0), 48000, nullptr)) == 0.0);
  }

  // very short inputs: floor(n / 256) + 1 frames, empty input one unvoiced frame
  {
    synth::Ton t{0.0, 1.0, 69.0};
    t.pegel = 0.5;
    const std::vector<float> ton = synth::melodie({t}, 1.0);
    for (size_t n : {size_t{0}, size_t{1}, size_t{100}, size_t{255}, size_t{256}, size_t{257}, size_t{512}, size_t{1000}, size_t{3000}}) {
      const std::vector<float> x(ton.begin(), ton.begin() + static_cast<std::ptrdiff_t>(n));
      const Kurve k = erkenne(x, 48000, nullptr);
      PRUEF(k.f0_ct.size() == n / 256 + 1 && k.konf.size() == n / 256 + 1);
      PRUEF(k.frames == static_cast<int64_t>(n));
      if (n <= 100) PRUEF(k.f0_ct.size() == 1 && k.f0_ct[0] == 0.0);
    }
  }

  // `kurz`: erkenne itself gives the gold curve (the short-source rule is the command's)
  {
    auto g = liesSeitendatei(gold + "kurz.kurve.json");
    PRUEF(std::holds_alternative<Seitendatei>(g));
    const Kurve k = erkenne(liesS16(gold + "kurz.s16"), 48000, nullptr);
    PRUEF(k.f0_ct.size() == 29);
    size_t stimm = 0;
    for (double v : k.f0_ct) if (v > 0) ++stimm;
    PRUEF(stimm >= 27);   // the gold curve has 28 voiced frames of 29
  }

  // non finite samples count as 0: no crash, the finite part is still found
  {
    synth::Ton t{0.0, 1.0, 57.0};
    t.pegel = 0.4;
    std::vector<float> x = synth::melodie({t}, 1.0);
    x[1000] = std::nanf("");
    x[5000] = INFINITY;
    x[6000] = -INFINITY;
    const Kurve k = erkenne(x, 48000, nullptr);
    PRUEF(k.f0_ct.size() == 48000 / 256 + 1);
    PRUEF(anteilStimmhaft(k) > 0.8);
    PRUEF_NAH(k.f0_ct[100], 5700.0, 30.0);
  }

  PRUEF_ENDE();
}
