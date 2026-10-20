// Hörbares Ziehen (Scrub, Wunsch Andreas 2026-10-17: „wenn ich die tracks mit der hand bewege, auch hören"): das Deck liest
// das Material an der Handposition, Tempo und Richtung folgen der Hand, Stillstand ist Stille. Material wie test_deck_varispeed:
// Frame f trägt links f, Catmull-Rom auf einer Geraden ist exakt, die Ausgabe zeigt also bei |Rate| ≥ 0,05 (volle Lautstärke)
// die gebrochene Leseposition selbst. Dazu ein Sinus für die Glätte (Sprung zwischen zwei Samples, besonders an Blockgrenzen).
// Fehlerfall: CYPHERDJ_MUTATION_SCRUB_OHNE_GLAETTUNG (die Position springt je Block auf das Ziel) muss diesen Test
// scheitern lassen (CMake test_mutation, WILL_FAIL).
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <vector>

#include "cypherdj/deck.h"
#include "cypherdj/fassung.h"
#include "cypherdj/uhr.h"
#include "pruef.h"

namespace {

constexpr int BLOCK = 256;

struct Probe {
  std::vector<float> d;
  cdj::Material m{};
  Probe(int64_t frames, float (*wert)(int64_t f, int kanal)) {
    std::snprintf(m.material_id, sizeof m.material_id, "c1c0000000000501");
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
float sinus(int64_t f, int) { return (float)(0.5 * std::sin(2.0 * M_PI * 440.0 * (double)f / 48000.0)); }

// Ein Szenario: Hand-Wege als Funktion des Samples; zieht die Strecke alle `takt` Samples (60 Hz = 800) als Treppe nach.
struct Lauf {
  cdj::Deck& d;
  std::vector<float> aus;
  int64_t s = 0;
  explicit Lauf(cdj::Deck& dk) : d(dk) {}
  void block() {
    std::vector<float> l(BLOCK, 0.0f), r(BLOCK, 0.0f);
    d.block(s, BLOCK, l.data(), r.data(), 0);
    aus.insert(aus.end(), l.begin(), l.end());
    s += BLOCK;
  }
};

// Hand: Weg(t) in Frames; Treppe alle 3 Blöcke (768 Samples, ≈ 62,5 Hz). Rückgabe: Ausgabe.
template <class Weg>
void zieh(Lauf& L, int64_t von_s, int64_t bis_s, Weg weg, bool los) {
  bool an = false;
  int64_t letzte = -1;
  while (L.s < bis_s) {
    if (L.s >= von_s && (letzte < 0 || L.s - letzte >= 768)) {
      const double w = weg(L.s - von_s);
      if (!an) {
        L.d.scrub_an(L.s, w);
        an = true;
      } else {
        L.d.scrub_ziel(L.s, w);
      }
      letzte = L.s;
    }
    L.block();
  }
  if (los) L.d.scrub_los(L.s, weg(bis_s - von_s));
}

double max_diff(const std::vector<float>& x, size_t a, size_t b) {
  double m = 0.0;
  for (size_t i = a + 1; i < b; ++i) m = std::max(m, (double)std::fabs(x[i] - x[i - 1]));
  return m;
}

// Größte Sprung-Überhöhung an Blockgrenzen: |x[k·B] − x[k·B − 1]| gegen das Doppelte des größten Schritts in den 8 Samples
// daneben (ohne die Grenze selbst). Eine glatte Bewegung bleibt ≤ 1; ein Positionssprung liegt weit darüber.
double grenz_ueberhoehung(const std::vector<float>& x, size_t ab) {
  double w = 0.0;
  for (size_t k = (ab / BLOCK + 1) * BLOCK; k + 8 < x.size(); k += BLOCK) {
    double nachbar = 1e-4;
    for (size_t i = k - 8; i < k + 8; ++i)
      if (i != k && i > 0) nachbar = std::max(nachbar, (double)std::fabs(x[i] - x[i - 1]));
    w = std::max(w, std::fabs((double)x[k] - (double)x[k - 1]) / (2.0 * nachbar));
  }
  return w;
}

}  // namespace

int main() {
  Probe lin(1200000, gerade);
  Probe sin1(1200000, sinus);
  constexpr int64_t F0 = 400000;

  // 1) Stillstand = Stille: Hand fasst an und bewegt sich nicht. Gegenprobe: dieselbe Hand, die sich bewegt, klingt.
  {
    cdj::Deck d;
    d.lade(&sin1.m, 0);
    d.setze_position(F0);
    Lauf L(d);
    zieh(L, 0, 24000, [](int64_t) { return 0.0; }, false);
    double e = 0.0;
    for (float v : L.aus) e += std::fabs(v);
    PRUEF(e == 0.0);                  // exakt Stille
    PRUEF(d.scrubbt());               // Hand hält noch
    PRUEF(d.position() == F0);

    cdj::Deck d2;
    d2.lade(&sin1.m, 0);
    d2.setze_position(F0);
    Lauf L2(d2);
    zieh(L2, 0, 24000, [](int64_t t) { return 1.5 * (double)t; }, false);
    double e2 = 0.0;
    for (float v : L2.aus) e2 += std::fabs(v);
    PRUEF(e2 > 500.0);                // die bewegte Hand klingt
  }

  // 2) Vorwärts: die Leseposition folgt der Hand (Treppe 62,5 Hz), im Beharrungszustand Rate = Handgeschwindigkeit (1,5)
  {
    cdj::Deck d;
    d.lade(&lin.m, 0);
    d.setze_position(F0);
    Lauf L(d);
    zieh(L, 0, 48000, [](int64_t t) { return 1.5 * (double)t; }, false);
    // Ausgabe = Position (Gerade, volle Lautstärke): ab 0,3 s Abstand zur Hand ≤ 2 400 Frames (Nachlauf ≈ 1 Treppenstufe + 10 ms)
    double abst = 0.0, rate = 0.0;
    for (int64_t t = 14400; t < 48000 - 768; ++t) {
      abst = std::max(abst, std::fabs((double)L.aus[t] - (F0 + 1.5 * (double)t)));
      rate += (double)L.aus[t + 1] - (double)L.aus[t];
    }
    rate /= (48000 - 768 - 14400);
    PRUEF_NAH(rate, 1.5, 0.02);
    PRUEF(abst < 3000.0);
  }

  // 3) Rückwärts: negative Rate hörbar (Steigung der Geraden negativ, Sinus-Energie ≠ 0)
  {
    cdj::Deck d;
    d.lade(&lin.m, 0);
    d.setze_position(F0);
    Lauf L(d);
    zieh(L, 0, 48000, [](int64_t t) { return -2.0 * (double)t; }, false);
    double rate = 0.0;
    for (int64_t t = 14400; t < 48000 - 768; ++t) rate += (double)L.aus[t + 1] - (double)L.aus[t];
    rate /= (48000 - 768 - 14400);
    PRUEF_NAH(rate, -2.0, 0.03);
    PRUEF(L.aus[40000] < (float)F0);

    cdj::Deck d2;
    d2.lade(&sin1.m, 0);
    d2.setze_position(F0);
    Lauf L2(d2);
    zieh(L2, 0, 48000, [](int64_t t) { return -2.0 * (double)t; }, false);
    double e = 0.0;
    for (float v : L2.aus) e += (double)v * v;
    PRUEF(e > 100.0);
  }

  // 4) Kein Knackser: Hin und Her über den Sinus, harte Treppe. Größter Schritt zwischen zwei Samples höchstens so groß wie
  //    das, was das Material bei der größten Rate hergibt; an Blockgrenzen nie ein Sprung gegenüber den Nachbarn.
  {
    cdj::Deck d;
    d.lade(&sin1.m, 0);
    d.setze_position(F0);
    Lauf L(d);
    auto hin_her = [](int64_t t) {  // ±3 Frames/Sample, alle 0,5 s die Richtung, Dreieck
      const double u = (double)t / 24000.0;
      const double ph = u - std::floor(u / 2.0) * 2.0;
      return 3.0 * 24000.0 * (ph < 1.0 ? ph : 2.0 - ph);
    };
    zieh(L, 0, 96000, hin_her, true);
    for (int i = 0; i < 100; ++i) L.block();  // ausschwingen lassen
    const double steigung = 0.5 * 2.0 * M_PI * 440.0 / 48000.0;  // größter Schritt des Materials je Frame
    const double schritt = max_diff(L.aus, 0, L.aus.size());
    PRUEF(schritt <= steigung * 4.0);                              // Rate ≤ 4 (Hand 3 + Nachlauf)
    PRUEF(grenz_ueberhoehung(L.aus, 0) <= 1.0);
    PRUEF(!d.scrubbt());
    for (float v : L.aus) PRUEF(std::isfinite(v));
  }

  // 5) Anfang und Ende des Materials: weit hinaus gezogen klemmt die Position, das Deck steht danach am Rand
  {
    cdj::Deck d;
    d.lade(&lin.m, 0);
    d.setze_position(1000);
    Lauf L(d);
    zieh(L, 0, 24000, [](int64_t t) { return -50.0 * (double)t; }, true);
    for (int i = 0; i < 200; ++i) L.block();
    PRUEF(!d.scrubbt());
    PRUEF(d.position() == 0);
    for (float v : L.aus) PRUEF(std::isfinite(v));

    cdj::Deck d2;
    d2.lade(&lin.m, 0);
    d2.setze_position(lin.m.frames - 1000);
    Lauf L2(d2);
    zieh(L2, 0, 24000, [](int64_t t) { return 50.0 * (double)t; }, true);
    for (int i = 0; i < 200; ++i) L2.block();
    PRUEF(!d2.scrubbt());
    PRUEF(d2.position() == lin.m.frames);
    for (float v : L2.aus) PRUEF(std::isfinite(v));
  }

  // 6) Loslassen am gestoppten Deck: der Kopf bleibt an der gezogenen Stelle, das Deck steht
  {
    cdj::Deck d;
    d.lade(&lin.m, 0);
    d.setze_position(F0);
    Lauf L(d);
    zieh(L, 0, 12000, [](int64_t t) { return 2.0 * (double)t; }, true);  // Ziel F0 + 24 000
    for (int i = 0; i < 100; ++i) L.block();
    PRUEF(!d.scrubbt());
    PRUEF(!d.laeuft());
    PRUEF_NAH((double)d.position(), (double)(F0 + 24000), 1.0);
    const size_t n = L.aus.size();
    double stille = 0.0;
    for (size_t i = n - 1024; i < n; ++i) stille += std::fabs(L.aus[i]);
    PRUEF(stille == 0.0);  // danach Stille
  }

  // 7) Laufendes Deck, Hand hält still: Nudge-artig, das Deck läuft weiter (Folgemodus), vor wie nach dem Griff bitgleich auf
  //    der Geraden (Quell-Frame = F0 + Sample); Loslassen ohne Strecke ändert nichts.
  {
    cdj::Karte k(128.0, 0);
    cdj::Deck d;
    d.setze_karte(&k);
    d.lade(&lin.m, 0);
    d.start(0, F0);
    Lauf L(d);
    while (L.s < 4800) L.block();
    zieh(L, 4800, 24000, [](int64_t) { return 0.0; }, true);
    for (int i = 0; i < 200; ++i) L.block();
    PRUEF(!d.scrubbt());
    PRUEF(d.laeuft());
    double ab = 0.0;
    for (size_t s = 256; s < L.aus.size(); ++s) ab = std::max(ab, std::fabs((double)L.aus[s] - ((double)F0 + (double)s)));
    PRUEF_NAH(ab, 0.0, 0.1);   // (Float-Gitter bei 4·10⁵: 0,03) auch durch Griff, Überblendung und Loslassen: kein Frame daneben
  }

  // 8) Laufendes Deck, Strecke gezogen: nach dem Loslassen läuft es dort weiter, wo ein Sprung um die Strecke hinführt
  {
    cdj::Karte k(128.0, 0);
    cdj::Deck d;
    d.setze_karte(&k);
    d.lade(&lin.m, 0);
    d.start(0, F0);
    Lauf L(d);
    while (L.s < 4800) L.block();
    zieh(L, 4800, 4800 + 24000, [](int64_t t) { return 1.0 * (double)t; }, true);  // 24 000 Frames vorwärts
    for (int i = 0; i < 200; ++i) L.block();
    PRUEF(!d.scrubbt());
    PRUEF(d.laeuft());
    PRUEF_NAH((double)d.frame_bei(L.s), (double)F0 + (double)L.s + 24000.0, 2.0);
  }

  // 9) Abbruch durch Start am stehenden Deck beendet das Ziehen
  {
    cdj::Deck d;
    d.lade(&lin.m, 0);
    d.setze_position(F0);
    Lauf L(d);
    zieh(L, 0, 4800, [](int64_t t) { return 1.0 * (double)t; }, false);
    PRUEF(d.scrubbt());
    d.start(L.s, 700000);
    PRUEF(!d.scrubbt());
    L.block();
    PRUEF(d.laeuft());
  }

  // 10) Wachhund: kommt das Los nie an (Paket verloren, Seite weg), löst das Deck das Ziehen nach 2 s selbst
  {
    cdj::Deck d;
    d.lade(&lin.m, 0);
    d.setze_position(F0);
    Lauf L(d);
    zieh(L, 0, 4800, [](int64_t t) { return 1.0 * (double)t; }, false);
    PRUEF(d.scrubbt());
    while (L.s < 4800 + 96000 + 4096) L.block();
    PRUEF(!d.scrubbt());
    PRUEF(!d.laeuft());
    PRUEF(d.position() > F0);
  }

  PRUEF_ENDE();
}
