// Monophonic check `pruefeEinstimmig` (decision of A2: HRR below 9.5 dB AND CMNDF minimum of the residual at most 0.5, every fourth
// checked frame, polyphonic above a share of 0.30) against mono_faelle.json and the `mono` objects of the golden curve files.
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <string>
#include <variant>
#include <vector>

#include <nlohmann/json.hpp>

#include "intern.h"
#include "check.h"
#include "synth.h"
#include "teiltoene.h"

using namespace cdj::noten;
using json = nlohmann::json;

static const std::string GOLD = std::string(NOTEN_DATEN) + "/gold/";

static json leseJson(const std::string& pfad) {
  auto t = liesText(pfad);
  if (std::holds_alternative<Fehler>(t)) {
    std::fprintf(stderr, "%s: %s\n", pfad.c_str(), std::get<Fehler>(t).text.c_str());
    ++pruef_fehler;
    return json::array();
  }
  return json::parse(std::get<std::string>(t));
}

int main() {
  const json faelle = leseJson(GOLD + "mono_faelle.json");
  PRUEF(faelle.size() == 11);

  size_t geprueft = 0;
  for (const json& fall : faelle) {
    const std::string name = fall["item"];
    const bool soll = fall["mehrstimmig"].get<bool>();
    auto s = liesSeitendatei(GOLD + name + ".kurve.json");
    if (std::holds_alternative<Fehler>(s)) { std::fprintf(stderr, "%s: %s\n", name.c_str(), std::get<Fehler>(s).text.c_str()); PRUEF(false); continue; }
    const Seitendatei& sd = std::get<Seitendatei>(s);
    PRUEF(sd.mono.has_value());
    const Stereo x = synth::stereoAusMono(liesS16(GOLD + name + ".s16"));
    PRUEF(x.frames() == sd.k.frames);

    const Mono m = pruefeEinstimmig(x, sd.k, nullptr);
    const Mono g = sd.mono.value_or(Mono{});
    std::printf("%-28s checked %4lld (gold %4lld), share %.4f (gold %.4f), polyphonic %d (expected %d)\n", name.c_str(),
                static_cast<long long>(m.geprueft_frames), static_cast<long long>(g.geprueft_frames), m.anteil, g.anteil, m.mehrstimmig, soll);
    PRUEF(m.mehrstimmig == soll);
    PRUEF(g.mehrstimmig == soll);
    PRUEF(m.geprueft_frames == g.geprueft_frames);                  // the checked frames depend on the audio only
    PRUEF_NAH(m.anteil, g.anteil, 0.03);                            // the prototype fits the whole file padded, the port in chunks
    PRUEF(m.mehrstimmig == (m.anteil > MONO_ANTEIL_MAX));
    PRUEF(m.hrr_db_schwelle == 9.5 && m.periode_schwelle == 0.5);
    PRUEF(m.hrr_db_schwelle == MONO_HRR_DB && m.periode_schwelle == MONO_PERIODE);
    PRUEF(m.anteil >= 0.0 && m.anteil <= 1.0);
    if (name == "stille") { PRUEF(m.geprueft_frames == 0); PRUEF(!m.mehrstimmig); PRUEF(m.anteil == 0.0); }
    if (name == "rauschen") PRUEF(!m.mehrstimmig);
    if (name == "kurz") PRUEF(m.geprueft_frames == g.geprueft_frames);   // the library function has no short-source rule: the gold mono
    ++geprueft;
  }
  PRUEF(geprueft == 11);

  // the checked frames: the voiced ones are among the frames of the gold HRR table
  for (const std::string name : {"stimme_vibrato", "bass_ende", "saege_legato", "akkord_terz"}) {
    const json g = leseJson(GOLD + name + ".teiltoene.json");
    auto s = liesSeitendatei(GOLD + name + ".kurve.json");
    const Seitendatei& sd = std::get<Seitendatei>(s);
    const std::vector<float> m = liesS16(GOLD + name + ".s16");
    const std::vector<int64_t> alle = gepruefteFrames(m, static_cast<int64_t>(sd.k.f0_ct.size()));
    PRUEF(static_cast<int64_t>(alle.size()) == sd.mono->geprueft_frames);
    std::vector<int64_t> stimmhaft;
    for (int64_t f : alle) if (sd.k.f0_ct[static_cast<size_t>(f)] > 0) stimmhaft.push_back(f);
    // the gold table holds every voiced frame of the curve: the evaluated voiced frames are a subset of it
    std::vector<int64_t> gold;
    for (size_t i = 0; i < g["hrr"]["frames"].size(); ++i) if (!g["hrr"]["db"][i].is_null()) gold.push_back(g["hrr"]["frames"][i].get<int64_t>());
    PRUEF(!stimmhaft.empty());
    PRUEF(std::includes(gold.begin(), gold.end(), stimmhaft.begin(), stimmhaft.end()));
    for (size_t i = 1; i < alle.size(); ++i) PRUEF(alle[i] > alle[i - 1]);
  }

  // synthetic single voices end `false`: vibrato, glide, a melody with a wide range, a low note, a chord ends `true`
  {
    std::vector<synth::Ton> melodie;
    double t = 0.0;
    for (double midi : {60.0, 64.0, 67.0, 72.0, 55.0, 62.0}) {
      synth::Ton n;
      n.start_s = t;
      n.dauer_s = 0.7;
      n.midi = midi;
      n.vib_ct = 25.0;
      n.pegel = 0.3;
      melodie.push_back(n);
      t += 0.75;
    }
    synth::Ton gl;
    gl.start_s = t;
    gl.dauer_s = 0.9;
    gl.midi = 60.0;
    gl.midi_ende = 67.0;
    melodie.push_back(gl);
    t += 1.0;
    const std::vector<float> m = synth::melodie(melodie, t);
    const Stereo x = synth::stereoAusMono(m);
    Kurve k;
    k.frames = x.frames();
    k.detektor = "pyin";
    k.kurve = "pyin-1.noten_hmm-1";
    const int64_t nf = frameZahl(x.frames());
    k.f0_ct.assign(static_cast<size_t>(nf), 0.0);
    k.konf.assign(static_cast<size_t>(nf), 1.0);
    for (int64_t j = 0; j < nf; ++j) {
      const double ts = static_cast<double>(j * HOP) / SR;
      for (const synth::Ton& n : melodie)
        if (ts >= n.start_s + 0.02 && ts <= n.start_s + n.dauer_s - 0.03) k.f0_ct[static_cast<size_t>(j)] = 100.0 * synth::tonHoehe(n, ts - n.start_s);
    }
    const Mono mo = pruefeEinstimmig(x, k, nullptr);
    std::printf("synthetic melody: checked %lld, share %.4f, polyphonic %d\n", static_cast<long long>(mo.geprueft_frames), mo.anteil, mo.mehrstimmig);
    PRUEF(mo.geprueft_frames > 100);
    PRUEF(!mo.mehrstimmig);

    // the same notes sounding together with a fifth and a tenth above (a chord), the curve follows the lowest voice: polyphonic
    std::vector<synth::Ton> akkord;
    for (const synth::Ton& n : melodie) {
      akkord.push_back(n);
      synth::Ton q = n;
      q.midi += 7.0;
      if (q.midi_ende >= 0) q.midi_ende += 7.0;
      akkord.push_back(q);
      synth::Ton z = n;
      z.midi += 16.0;
      if (z.midi_ende >= 0) z.midi_ende += 16.0;
      akkord.push_back(z);
    }
    const Stereo xa = synth::stereoAusMono(synth::melodie(akkord, t));
    const Mono ma = pruefeEinstimmig(xa, k, nullptr);
    std::printf("synthetic chord:  checked %lld, share %.4f, polyphonic %d\n", static_cast<long long>(ma.geprueft_frames), ma.anteil, ma.mehrstimmig);
    PRUEF(ma.mehrstimmig);
  }

  // a progress sink does not change the result
  {
    auto s = liesSeitendatei(GOLD + "saege_legato.kurve.json");
    const Seitendatei& sd = std::get<Seitendatei>(s);
    const Stereo x = synth::stereoAusMono(liesS16(GOLD + "saege_legato.s16"));
    Fortschritt f(3);
    const Mono a = pruefeEinstimmig(x, sd.k, &f);
    const Mono b = pruefeEinstimmig(x, sd.k, nullptr);
    PRUEF(a == b);
  }

  PRUEF_ENDE();
}
