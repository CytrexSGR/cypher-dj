// Run time of the pitch render on a four-minute stereo source (label `ruhig` by the CMake loop): process CPU time (getrusage), never a
// wall clock. Limit of the spec: a one-note render of a four-minute stereo source takes under 1 s. Two cases: a bass note of 1.78 s at 41 Hz
// shifted by -12 semitones (no `vorher`), and a voice note of 1.14 s shifted by +2 with `vorher` and `nur` (the incremental path). The
// measured time includes everything `rendere` does: the mixing estimate over the list, the partial analysis of the touched region and the
// synthesis; the copy of the source is part of it too.
#include <cmath>
#include <cstdio>
#include <set>
#include <string>
#include <variant>
#include <vector>

#include "intern.h"
#include "check.h"
#include "render.h"
#include "synth.h"

using namespace cdj::noten;

struct Spur {
  Stereo x;
  Kurve k;
  std::vector<AudioNote> liste;
};

/// One period of notes {start, length of the note (qe - qa) in s, midi} repeated up to 240 s; every note of every repetition is in the list.
struct Teil { double start, laenge, midi; };

static Spur bauen(const std::vector<Teil>& periode, double periode_s, bool stimme) {
  std::vector<synth::Ton> toene;
  for (const Teil& t : periode) {
    synth::Ton n;
    n.start_s = t.start - 0.02;
    n.dauer_s = t.laenge + 0.05;
    n.midi = t.midi;
    n.vib_ct = stimme ? 30.0 : 0.0;
    n.pegel = 0.3;
    n.mit_huelle = stimme;
    n.teiltoene = stimme ? 60 : 400;
    toene.push_back(n);
  }
  const std::vector<float> eins = synth::melodie(toene, periode_s);
  const std::vector<float> m = synth::wiederhole(eins, 240.0);
  Spur s;
  s.x.l = m;
  s.x.r.resize(m.size());
  for (size_t i = 0; i < m.size(); ++i) s.x.r[i] = stimme ? 0.8f * (i >= 5 ? m[i - 5] : 0.0f) : m[i];
  s.k.frames = s.x.frames();
  s.k.detektor = "pyin";
  s.k.kurve = "pyin-1.noten_hmm-1";
  const int64_t nf = frameZahl(s.x.frames());
  s.k.f0_ct.assign(static_cast<size_t>(nf), 0.0);
  s.k.konf.assign(static_cast<size_t>(nf), 1.0);
  const int wdh = static_cast<int>(240.0 / periode_s);
  for (int w = 0; w < wdh; ++w) {
    for (size_t i = 0; i < periode.size(); ++i) {
      const Teil& t = periode[i];
      const double qa = w * periode_s + t.start, qe = qa + t.laenge;
      for (int64_t j = static_cast<int64_t>(std::ceil(qa * SR / HOP)); static_cast<double>(j * HOP) / SR <= qe && j < nf; ++j) {
        const double ts = static_cast<double>(j * HOP) / SR - (w * periode_s + toene[i].start_s);
        s.k.f0_ct[static_cast<size_t>(j)] = 100.0 * synth::tonHoehe(toene[i], ts);
      }
      AudioNote n;
      n.id = "n" + std::to_string(w) + "_" + std::to_string(i);
      n.qa = qa;
      n.qe = qe;
      n.qton = t.midi;
      n.p = 0.8;
      s.liste.push_back(n);
    }
  }
  return s;
}

static AudioNote* finde(std::vector<AudioNote>& l, const std::string& id) {
  for (AudioNote& n : l) if (n.id == id) return &n;
  return nullptr;
}

int main() {
  // ---- bass: a note of 1.78 s at 41 Hz (midi 28) shifted by -12, no vorher
  {
    const std::vector<Teil> periode = {{0.1, 1.78, 28}, {2.1, 1.0, 33}, {3.3, 1.5, 31}, {5.0, 0.9, 26}, {6.1, 1.2, 35}, {7.6, 1.78, 28}, {9.6, 0.3, 30}};
    Spur s = bauen(periode, 10.0, false);
    std::vector<AudioNote> liste = s.liste;
    AudioNote* n = finde(liste, "n12_0");
    PRUEF(n != nullptr);
    if (n) n->ton = rundeTon(n->qton - 12.0);
    Stereo aus;
    const double c0 = cpuSekunden();
    auto r = rendere(s.x, s.k, liste, nullptr, nullptr, aus, nullptr);
    const double sek = cpuSekunden() - c0;
    PRUEF(std::holds_alternative<RenderErgebnis>(r));
    const size_t nb = std::holds_alternative<RenderErgebnis>(r) ? std::get<RenderErgebnis>(r).bereiche.size() : 0;
    std::printf("bass note 1.78 s at 41 Hz, -12 semitones, 240 s stereo: %.3f CPU s (limit 1.0), %zu range(s), %zu notes in the list\n", sek, nb, liste.size());
    PRUEF(nb == 1);
    PRUEF(aus.frames() == s.x.frames());
    PRUEF(sek <= 1.0);
  }

  // ---- voice: a note of 1.14 s shifted by +2 with vorher and nur (the neighbour was rendered before)
  {
    const std::vector<Teil> periode = {{0.1, 0.6, 62}, {0.9, 1.14, 65}, {2.4, 0.5, 69}, {3.1, 0.8, 67}, {4.1, 0.7, 64}, {5.0, 0.6, 60},
                                       {5.8, 0.5, 62}, {6.5, 0.8, 67}, {7.5, 0.6, 72}, {8.3, 0.5, 65}, {9.0, 0.6, 63}, {9.8, 0.1, 60}};
    Spur s = bauen(periode, 10.0, true);
    std::vector<AudioNote> erste = s.liste;
    AudioNote* nb = finde(erste, "n12_2");
    PRUEF(nb != nullptr);
    if (nb) nb->ton = rundeTon(nb->qton + 1.0);
    Stereo vorher;
    {
      auto r0 = rendere(s.x, s.k, erste, nullptr, nullptr, vorher, nullptr);
      PRUEF(std::holds_alternative<RenderErgebnis>(r0));
    }
    std::vector<AudioNote> liste = erste;
    AudioNote* n = finde(liste, "n12_1");
    PRUEF(n != nullptr);
    if (n) n->ton = rundeTon(n->qton + 2.0);
    Stereo aus;
    const std::set<std::string> nur = {"n12_1"};
    const double c0 = cpuSekunden();
    auto r = rendere(s.x, s.k, liste, &vorher, &nur, aus, nullptr);
    const double sek = cpuSekunden() - c0;
    PRUEF(std::holds_alternative<RenderErgebnis>(r));
    const size_t nbr = std::holds_alternative<RenderErgebnis>(r) ? std::get<RenderErgebnis>(r).bereiche.size() : 0;
    std::printf("voice note 1.14 s, +2 semitones with vorher and nur, 240 s stereo: %.3f CPU s (limit 1.0), %zu range(s)\n", sek, nbr);
    PRUEF(nbr >= 1);
    PRUEF(aus.frames() == s.x.frames());
    PRUEF(sek <= 1.0);
    // a full render without vorher costs about the same (one more edit group): printed for the record, not asserted
    Stereo voll;
    const double c1 = cpuSekunden();
    auto rv = rendere(s.x, s.k, liste, nullptr, nullptr, voll, nullptr);
    std::printf("the same list as a full render: %.3f CPU s\n", cpuSekunden() - c1);
    PRUEF(std::holds_alternative<RenderErgebnis>(rv));
  }
  PRUEF_ENDE();
}
