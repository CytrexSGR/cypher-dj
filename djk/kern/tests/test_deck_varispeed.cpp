// Welle 3 Task 1 (Plan 2026-10-06-welle3-beatmatch.md): Deck im Varispeed an der Kern-Karte. Material wie test_deck:
// Frame f trägt links f (float exakt bis 2^24), Catmull-Rom auf einer Geraden ist exakt, die Ausgabe zeigt also den
// gebrochenen Lesekopf. Soll: kopf(s) = f0 + beat_at(s) · fpb (Quell-Beat = Master-Beat, phasenstarr). Bei genau der
// Basis bleibt der ganzzahlige Direktweg bitgleich. Fehlerfall: CYPHERDJ_MUTATION_DECK_VARISPEED_STARR (heutiges Lesen
// mit einem Frame je Sample) muss diesen Test scheitern lassen (CMake test_mutation, WILL_FAIL).
#include <cmath>
#include <cstdio>
#include <vector>

#include "cypherdj/deck.h"
#include "cypherdj/fassung.h"
#include "cypherdj/uhr.h"
#include "pruef.h"

namespace {

struct Probe {
  std::vector<float> d;
  cdj::Material m{};
  Probe(int64_t frames, float (*wert)(int64_t f, int kanal)) {
    std::snprintf(m.material_id, sizeof m.material_id, "c1c0000000000301");
    m.basis_bpm = 128.0;
    m.fassung = 1;
    m.n_quellen = 1;
    m.frames = frames;
    m.erster_schlag_frame = 0;
    d.resize(2 * frames);
    for (int64_t f = 0; f < frames; ++f) {
      d[2 * f] = wert(f, 0);
      d[2 * f + 1] = wert(f, 1);
    }
    m.quelle[0] = d.data();
  }
};

float gerade(int64_t f, int kanal) { return kanal == 0 ? (float)f : -(float)f; }
float sinus1k(int64_t f, int) { return (float)(0.5 * std::sin(2.0 * M_PI * 1000.0 * (double)f / 48000.0)); }

constexpr double FPB = cdj::FRAMES_JE_MINUTE / 128.0;  // 22 500 Frames je Quell-Beat bei Basis 128
constexpr int64_t F0 = 1000;                          // Start-Frame
constexpr int EIN = 64;                               // Einblende aus dem Stand (48 Frames) überspringen

// Rendert [0, n_samples) in 256er Blöcken; Rückgabe linker Kanal.
std::vector<float> rendere(cdj::Deck& d, int64_t n_samples) {
  std::vector<float> aus(n_samples, 0.0f), r(256);
  for (int64_t s = 0; s < n_samples; s += 256) {
    const int n = (int)std::min<int64_t>(256, n_samples - s);
    std::vector<float> l(n, 0.0f);
    r.assign(n, 0.0f);
    d.block(s, n, l.data(), r.data(), 0);
    for (int i = 0; i < n; ++i) aus[s + i] = l[i];
  }
  return aus;
}

// größte Abweichung |aus − soll| über [von, bis), soll aus der Karte; ausgenommen Fenster [a, a + 128) je Ausnahme a
double max_abweichung(const std::vector<float>& aus, const cdj::Karte& k, int64_t von, int64_t bis,
                      std::vector<int64_t> ausnahmen = {}) {
  double m = 0.0;
  for (int64_t s = von; s < bis; ++s) {
    bool aus_n = false;
    for (int64_t a : ausnahmen) aus_n = aus_n || (s >= a && s < a + cdj::DECK_BLENDE + 256);
    if (aus_n) continue;
    m = std::max(m, std::fabs((double)aus[s] - ((double)F0 + k.beat_at((double)s) * FPB)));
  }
  return m;
}

}  // namespace

int main() {
  Probe p(800000, gerade);

  // 1) Negativ-Kontrolle: Karte auf der Basis → ganzzahliger Direktweg, bitgleich (jedes Frame genau f0 + s)
  {
    cdj::Karte k(128.0, 0);
    cdj::Deck d;
    d.setze_karte(&k);
    d.lade(&p.m, 0);
    d.start(0, F0);
    const auto aus = rendere(d, 3 * 48000);
    bool gleich = true;
    for (int64_t s = EIN; s < 3 * 48000; ++s) gleich = gleich && aus[s] == (float)(F0 + s);
    PRUEF(gleich);
  }

  // 2) 132 BPM konstant: der Kopf läuft 132/128 schneller, phasenstarr am Beat
  {
    cdj::Karte k(132.0, 0);
    cdj::Deck d;
    d.setze_karte(&k);
    d.lade(&p.m, 0);
    d.start(0, F0);
    const auto aus = rendere(d, 2 * 48000);
    PRUEF_NAH(max_abweichung(aus, k, EIN, 2 * 48000), 0.0, 0.05);
    PRUEF_NAH(d.quell_beat_bei(2 * 48000), (double)F0 / FPB + k.beat_at(2.0 * 48000), 1e-4);
  }

  // 3) Rampe 128 → 132 ab Beat 4 über 8 Beats bei laufendem Deck: Kopf folgt der Karte durch die Rampe
  {
    cdj::Karte k(128.0, 0);
    PRUEF(k.rampe(4.0, 132.0, 8.0));
    cdj::Deck d;
    d.setze_karte(&k);
    d.lade(&p.m, 0);
    d.start(0, F0);
    const int64_t n = std::llround(k.sample_at(16.0));
    const auto aus = rendere(d, n);
    const int64_t wechsel = std::llround(k.sample_at(4.0)) / 256 * 256;  // erster Block mit der Rampe
    PRUEF_NAH(max_abweichung(aus, k, EIN, n), 0.0, 1.0);                  // auch in der Pfad-Blende höchstens 1 Frame
    PRUEF_NAH(max_abweichung(aus, k, EIN, n, {wechsel}), 0.0, 0.05);
  }

  // 4) Rampe hin und zurück (128 → 132 → 128): danach wieder ganzzahlig, Schritt genau 1, Lage höchstens 0,5 Frame daneben
  {
    cdj::Karte k(128.0, 0);
    PRUEF(k.rampe(4.0, 132.0, 4.0));
    PRUEF(k.rampe(12.0, 128.0, 4.0));
    cdj::Deck d;
    d.setze_karte(&k);
    d.lade(&p.m, 0);
    d.start(0, F0);
    const int64_t n = std::llround(k.sample_at(24.0));
    const auto aus = rendere(d, n);
    const int64_t ab = std::llround(k.sample_at(17.0));
    bool ganz = true;
    for (int64_t s = ab; s + 1 < n; ++s) ganz = ganz && aus[s + 1] - aus[s] == 1.0f && aus[s] == std::floor(aus[s]);
    PRUEF(ganz);
    PRUEF_NAH(max_abweichung(aus, k, ab, n), 0.0, 0.5);
  }

  // 5) Tonhöhe: 1000-Hz-Sinus bei Basis 128, Karte 132 → 1031,25 Hz (Nulldurchgänge über 1 s)
  {
    Probe ps(200000, sinus1k);
    cdj::Karte k(132.0, 0);
    cdj::Deck d;
    d.setze_karte(&k);
    d.lade(&ps.m, 0);
    d.start(0, 0);
    const auto aus = rendere(d, 48000 + 4800);
    int64_t erster = -1, letzter = -1;
    int n = 0;
    for (int64_t s = 4800; s < 48000 + 4800; ++s)
      if (aus[s - 1] < 0.0f && aus[s] >= 0.0f) {
        if (erster < 0) erster = s;
        letzter = s;
        ++n;
      }
    const double f = (double)(n - 1) * 48000.0 / (double)(letzter - erster);
    PRUEF_NAH(f, 1000.0 * 132.0 / 128.0, 0.5);
  }

  // 6) Neustart: Anker in Beats (kern_deck_zustand) setzt den Lauf mitten in einer Rampe phasenrichtig fort
  {
    cdj::Karte k(128.0, 0);
    PRUEF(k.rampe(4.0, 132.0, 8.0));
    cdj::Deck d;
    d.setze_karte(&k);
    d.lade(&p.m, 0);
    const double b = 6.0;  // mitten in der Rampe
    d.setze_lauf_beat(std::llround(k.sample_at(b)), b, F0 + std::llround(b * FPB));
    const int64_t s0 = std::llround(k.sample_at(b)) / 256 * 256 + 256;
    std::vector<float> l(256, 0.0f), r(256, 0.0f);
    d.block(s0, 256, l.data(), r.data(), 0);
    double m = 0.0;
    for (int i = cdj::DECK_BLENDE; i < 256; ++i)
      m = std::max(m, std::fabs((double)l[i] - ((double)F0 + k.beat_at((double)(s0 + i)) * FPB)));
    PRUEF_NAH(m, 0.0, 0.6);
  }

  PRUEF_ENDE();
}
