// Scheibe 25: Planteile im Callback, offline über Kern::zyklus (ohne JACK). Die Golden-Folge teil_rampe
// (SCHNITTSTELLEN §19.3) ohne ihre Deck- und Hörschein-Zeilen, dazu der Prüfklick (Z1) im Kanal deck/2:
//   Teil 5 setzt deck/2/fader bei Beat 64 auf −15 dB, Teil 6 fährt ihn bis Beat 96 linear auf 0 dB (Gruppe b_rein).
// Erwartet: Quittungen 1, 2 (Sample 1 440 000), 3 (Teil 5 nach der 10-ms-Schaltrampe, Teil 6 bei 2 160 000); /e/regler
// bei Teilstart mit Halter plan:p1 und am Ende frei; am Master ist der Klick bei Beat 80 um 7,5 dB leiser als bei Beat 96
// (bei Beat 72 um 11,25 dB). Negativ-Kontrolle: vor Beat 64 (Fader −200) ist der Master exakt 0. Der Callback allokiert
// nicht (Wächter wie test_kern). Blockgrößen: Zyklen zu 1 536 Samples (Teilblöcke 1 024 + 512) geben bitgleich denselben
// Master wie Zyklen zu 256.
#include <cstdio>
#include <new>

#include "kern25.h"
#include "pruef.h"

static bool g_waechter = false;
static long g_allokationen = 0;
void* operator new(std::size_t n) {
  if (g_waechter) ++g_allokationen;
  void* p = std::malloc(n ? n : 1);
  if (!p) throw std::bad_alloc();
  return p;
}
void operator delete(void* p) noexcept { std::free(p); }
void operator delete(void* p, std::size_t) noexcept { std::free(p); }

static void teil_rampe(Kern25& k) {
  k.klick(2, "deck/2", 1);
  k.teil(5, "cypher", "p1", 1, "deck/2/fader", 64.0, 0.0, -15.0f, 0, 0, "b_rein", "h2");
  k.teil(6, "cypher", "p1", 2, "deck/2/fader", 64.0, 32.0, 0.0f, 0, 0, "b_rein", "h2");
}

int main() {
  Kern25 k;
  k.mitschreiben = true;
  teil_rampe(k);
  k.bis(1'000'000);
  // Wächter: 400 Zyklen mitten in der Folge ohne Allokation
  for (int z = 0; z < 400; ++z) {
    g_waechter = true;
    k.kern->zyklus(256, 0);
    g_waechter = false;
    cdj::Ereignis e;
    while (k.ere->hole(e)) {}
    const float* d = cdj_ring_daten_c(k.ring);
    const uint64_t w = cdj_lade(&k.ring->w) - 256;
    for (int i = 0; i < 256; ++i) {
      k.master.push_back(d[((w + i) % CDJ_RING_CAP) * 4]);
      k.cue.push_back(d[((w + i) % CDJ_RING_CAP) * 4 + 2]);
    }
  }
  PRUEF(g_allokationen == 0);
  k.bis(2'200'000);

  // Quittungen
  const cdj::Ereignis* q;
  PRUEF((q = k.q(5, 1)) && q->sample == 0);
  PRUEF((q = k.q(6, 1)) && q->sample == 0);
  PRUEF((q = k.q(5, 2)) && q->sample == 1'440'000 && q->beat == 64.0);
  PRUEF((q = k.q(6, 2)) && q->sample == 1'440'000 && !std::strcmp(q->quelle, "cypher"));
  PRUEF((q = k.q(5, 3)) && q->sample >= 1'440'000 && q->sample <= 1'440'480);  // Übergabe an Teil 6 am selben Sample
  PRUEF((q = k.q(6, 3)) && q->sample == 2'160'000 && q->beat == 96.0);
  PRUEF(k.q(5).size() == 3 && k.q(6).size() == 3);
  PRUEF((q = k.q(2, 2)) && q->sample == 0);  // Z1: Status 2 beim ersten Klick (Beat 0, eingeschaltet bei Sample 0)
  // /e/regler bei Teilstart (plan:p1) und am Ende (frei)
  const cdj::Ereignis* erst = nullptr;
  const cdj::Ereignis* letzt = nullptr;
  int regler = 0;
  for (const auto& e : k.ev)
    if (e.art == cdj::Ereignis::REGLER && !std::strcmp(e.pfad, "deck/2/fader")) {
      if (!erst) erst = &e;
      letzt = &e;
      ++regler;
    }
  PRUEF(erst && erst->sample == 1'440'000 && !std::strcmp(erst->text, "plan:p1"));
  PRUEF(letzt && letzt->sample == 2'160'000 && !std::strcmp(letzt->text, "frei") && letzt->wert == 0.0f);
  PRUEF(regler > 700 && regler < 800);  // 32 Beats = 15 s zu höchstens 50 Hz (§5.7): rund 750
  // Master: vor Beat 64 exakt 0 (Negativ-Kontrolle), danach Klick-Energie nach dem Fader
  PRUEF(k.spitze(0, 1'440'000) == 0.0);
  const double e80 = k.energie_db(1'800'000), e96 = k.energie_db(2'160'000), e72 = k.energie_db(1'620'000);
  std::printf("Klick-Energie: Beat 72 %.4f dB, 80 %.4f dB, 96 %.4f dB; 80 gegen 96: %.4f dB\n", e72, e80, e96,
              e80 - e96);
  PRUEF_NAH(e80 - e96, -7.5, 0.01);
  PRUEF_NAH(e72 - e96, -11.25, 0.01);
  PRUEF(k.spitze(0, 2'200'000) > 0.1);
  // Cue bleibt still (keine PFL, cue/mix −1)
  double cue_max = 0.0;
  for (float c : k.cue) cue_max = std::fmax(cue_max, std::fabs(c));
  PRUEF(cue_max == 0.0);

  // Blockgrößen: 1 536 Samples je Zyklus (Teilblöcke 1 024 + 512) bitgleich zu 256
  Kern25 g;
  g.mitschreiben = true;
  teil_rampe(g);
  g.bis(2'200'000, 1536);
  size_t gleich = 0;
  const size_t n = std::min(k.master.size(), g.master.size());
  for (size_t i = 0; i < n; ++i) gleich += (k.master[i] == g.master[i]) ? 1 : 0;
  std::printf("Blockgrößen: %zu von %zu Samples gleich\n", gleich, n);
  PRUEF(n >= 2'200'000 && gleich == n);
  PRUEF_ENDE();
}
