// Studio S5.1 Task 1: ein Strom mit MIDI-Ziel spielt kein Kit, sondern schreibt Note-On am Sample des Beats und Note-Off
// nach dauer (Beats) in den MIDI-Puffer seines Ports; Versatz relativ zum Zyklusanfang. Umhängen des Ports schickt
// offene Noten aus. Negativ-Kontrolle: Strom ohne MIDI → keine Ereignisse; ohne Puffer (midi = nullptr) → nichts.
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <vector>

#include "cypherdj/erzeuger.h"
#include "pruef.h"

namespace {

constexpr int N = 256;
constexpr int64_t SPB = 22500;  // 128 BPM bei 48 kHz
constexpr int ERZ2 = 5;         // Mixer-Index erz/2

struct Ev { int port; int64_t sample; uint8_t s, d1, d2; };

struct Welt {
  cdj::Karte karte{128.0, 0};
  cdj::Erzeuger erz;
  std::vector<float> pl = std::vector<float>(cdj::MIX_KANAELE * N), pr = pl;
  float* l[cdj::MIX_KANAELE];
  float* r[cdj::MIX_KANAELE];
  cdj::MidiAus midi[cdj::ERZ_MIDI_PORTS];
  std::vector<Ev> evs;
  float max_erz2 = 0.0f;
  int64_t s = 0;
  Welt() { for (int k = 0; k < cdj::MIX_KANAELE; ++k) { l[k] = &pl[k * N]; r[k] = &pr[k * N]; } }
  void bis(int64_t ende, bool mit_midi = true) {
    while (s < ende) {
      std::fill(pl.begin(), pl.end(), 0.0f);
      std::fill(pr.begin(), pr.end(), 0.0f);
      for (auto& m : midi) m.leer();
      erz.block(karte, s, N, l, r, mit_midi ? midi : nullptr, s);  // Zyklus = ein Block
      for (int p = 0; p < cdj::ERZ_MIDI_PORTS; ++p)
        for (int i = 0; i < midi[p].n; ++i) {
          const auto& e = midi[p].ev[i];
          evs.push_back({p + 1, s + (int64_t)e.t, e.b[0], e.b[1], e.b[2]});
        }
      for (int i = 0; i < N; ++i) max_erz2 = std::max(max_erz2, std::abs(l[ERZ2][i]));
      s += N;
    }
  }
};

cdj::ErzFenster fenster2(double ab, double bis, std::initializer_list<cdj::ErzEv> evs) {
  cdj::ErzFenster f{};
  f.strom = 2;
  f.sendung = 1;
  f.ab_beat = ab;
  f.bis_beat = bis;
  for (const auto& e : evs) f.ev[f.n++] = e;
  return f;
}

cdj::ErzEv ev(double beat, int note, float vel, double dauer) {
  cdj::ErzEv e{beat, note, 1, vel};
  e.dauer = dauer;
  return e;
}

}  // namespace

int main() {
  cdj::Kit kit;  // ein Klang auf Note 36: darf bei MIDI-Ziel NICHT klingen
  kit.klang[36].frames = 1;
  kit.klang[36].daten = {1.0f, 1.0f};
  kit.n = 1;

  {  // 1) zwei Noten: On am Sample, Off nach dauer, Velocity 0..1 → 1..127, Kanal 1 (Status 0x90/0x80)
    Welt w;
    w.erz.setze_strom(2, &kit, ERZ2);
    w.erz.setze_midi(2, 1, 1);
    w.erz.fenster(fenster2(0.0, 8.0, {ev(1.0, 36, 1.0f, 0.5), ev(2.0, 39, 0.5f, 0.5)}), 0.0);
    w.bis(4 * SPB);
    std::printf("midi: %zu Ereignisse", w.evs.size());
    for (const auto& e : w.evs) std::printf(" [p%d %lld %02x %d %d]", e.port, (long long)e.sample, e.s, e.d1, e.d2);
    std::printf(", max erz/2 %.3f\n", w.max_erz2);
    PRUEF(w.evs.size() == 4);
    if (w.evs.size() == 4) {
      PRUEF(w.evs[0].port == 1 && w.evs[0].sample == SPB && w.evs[0].s == 0x90 && w.evs[0].d1 == 36 && w.evs[0].d2 == 127);
      PRUEF(w.evs[1].sample == SPB + SPB / 2 && w.evs[1].s == 0x80 && w.evs[1].d1 == 36);
      PRUEF(w.evs[2].sample == 2 * SPB && w.evs[2].s == 0x90 && w.evs[2].d1 == 39 && w.evs[2].d2 == 64);
      PRUEF(w.evs[3].sample == 2 * SPB + SPB / 2 && w.evs[3].s == 0x80 && w.evs[3].d1 == 39);
    }
    PRUEF(w.max_erz2 == 0.0f);  // das Kit schweigt, solange MIDI gilt
  }
  {  // 2) Port umhängen mitten in der Note: Off auf dem ALTEN Port im nächsten Block, Kanal 3 → Status 0x92
    Welt w;
    w.erz.setze_strom(2, nullptr, ERZ2);
    w.erz.setze_midi(2, 1, 3);
    w.erz.fenster(fenster2(0.0, 8.0, {ev(1.0, 40, 1.0f, 2.0)}), 0.0);
    w.bis(SPB + N);
    w.erz.setze_midi(2, 2, 3);
    w.bis(SPB + 3 * N);
    PRUEF(w.evs.size() == 2);
    if (w.evs.size() == 2) {
      PRUEF(w.evs[0].port == 1 && w.evs[0].s == 0x92 && w.evs[0].d1 == 40);
      PRUEF(w.evs[1].port == 1 && w.evs[1].s == 0x82 && w.evs[1].d1 == 40 && w.evs[1].sample < SPB + 3 * N);
    }
  }
  {  // 3) Negativ-Kontrollen: Strom ohne MIDI → keine MIDI-Ereignisse (Kit klingt); midi = nullptr → nichts, kein Absturz
    Welt w;
    w.erz.setze_strom(2, &kit, ERZ2);
    w.erz.fenster(fenster2(0.0, 8.0, {ev(1.0, 36, 1.0f, 0.5)}), 0.0);
    w.bis(2 * SPB);
    PRUEF(w.evs.empty() && w.max_erz2 > 0.5f);
    Welt v;
    v.erz.setze_strom(2, nullptr, ERZ2);
    v.erz.setze_midi(2, 1, 1);
    v.erz.fenster(fenster2(0.0, 8.0, {ev(1.0, 36, 1.0f, 0.5)}), 0.0);
    v.bis(2 * SPB, false);
    PRUEF(v.evs.empty());
  }
  PRUEF_ENDE();
}
