// Plan 3 (Beat-FX, Spec E8): BeatFx ohne Kern. Rechnung aus dem MVP-2-Plan („Folgepläne, Scheibe 3“): Wet 0 ist trocken
// (bitgleich), Echo mit Verzögerung beats · SPB und Rückkopplung, LFO-Phase aus dem absoluten Beat (zwei Instanzen mit
// verschiedenem Start sind im selben Takt gleich), Art- und Kanalwechsel ohne Sprung, OFF lässt die Echo-Fahne ausklingen,
// keine Allokation in block().
#include <cmath>
#include <cstdlib>
#include <new>
#include <vector>

#include "cypherdj/beatfx.h"
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

static constexpr double BPS = 128.0 / 60.0 / 48000.0;  // Beats je Sample bei 128
static constexpr int SPB = 22500;

// Rechnet ein Signal in Blöcken zu 256 durch fx, ab Sample s0 (Beat = s0 · BPS)
static void lauf(cdj::BeatFx& fx, std::vector<float>& l, std::vector<float>& r, int64_t s0) {
  for (size_t i = 0; i < l.size(); i += 256) {
    const int n = static_cast<int>(std::min<size_t>(256, l.size() - i));
    g_waechter = true;
    fx.block(l.data() + i, r.data() + i, n, (s0 + (int64_t)i) * BPS, BPS);
    g_waechter = false;
  }
}

static float signal(int64_t s) {  // Funktion des absoluten Samples: 440 Hz + 97 Hz, dazu je Beat ein Impuls
  float x = 0.3f * std::sin(2.0 * M_PI * 440.0 * s / 48000.0) + 0.2f * std::sin(2.0 * M_PI * 97.0 * s / 48000.0);
  if (s % SPB == 0) x += 0.4f;
  return x;
}

int main() {
  // 1) Negativ-Kontrolle: Wet 0 ist für jede Art bitgleich trocken
  for (int art = 1; art <= 4; ++art) {
    cdj::BeatFx fx;
    fx.setze(art, 1.0, 0.0f, 0.5f, true);
    std::vector<float> l(48000), r(48000), l0(48000);
    for (int i = 0; i < 48000; ++i) l[i] = r[i] = l0[i] = signal(i);
    lauf(fx, l, r, 0);
    bool gleich = true;
    for (int i = 0; i < 48000; ++i) gleich = gleich && l[i] == l0[i] && r[i] == l0[i];
    PRUEF(gleich);
  }

  // 2) Echo ¼ Beat, Wet 1, Rückkopplung 0,5 (PARAM 0,5/0,9): Impuls 1 bei s → 1 bei s + 5 625, 0,5 bei s + 11 250
  {
    cdj::BeatFx fx;
    fx.setze(cdj::BeatFx::ECHO, 0.25, 1.0f, 0.5f / 0.9f, true);
    std::vector<float> l(20000, 0.0f), r(20000, 0.0f);
    l[1000] = r[1000] = 1.0f;   // Wet ist nach 480 Samples oben
    lauf(fx, l, r, 0);
    PRUEF_NAH(l[1000], 1.0, 1e-6);
    PRUEF_NAH(l[1000 + 5625], 1.0, 1e-6);
    PRUEF_NAH(l[1000 + 11250], 0.5, 1e-6);
    PRUEF_NAH(l[1000 + 16875], 0.25, 1e-6);
    PRUEF_NAH(l[1000 + 5624], 0.0, 1e-9);    // Negativ: kein Echo daneben
  }

  // 3) OFF bei Echo: die Fahne klingt aus (Wet bleibt), neuer Eingang wird nicht mehr geechot
  {
    cdj::BeatFx fx;
    fx.setze(cdj::BeatFx::ECHO, 0.25, 1.0f, 0.5f / 0.9f, true);
    std::vector<float> l(30000, 0.0f), r(30000, 0.0f);
    l[1000] = r[1000] = 1.0f;
    std::vector<float> a(l.begin(), l.begin() + 2000), ar(a);
    lauf(fx, a, ar, 0);
    fx.setze(cdj::BeatFx::ECHO, 0.25, 1.0f, 0.5f / 0.9f, false);   // OFF bei Sample 2000
    std::vector<float> b(28000, 0.0f), br(28000, 0.0f);
    b[3000] = br[3000] = 1.0f;   // Sample 5000: nach OFF
    lauf(fx, b, br, 2000);
    PRUEF_NAH(b[1000 + 5625 - 2000], 1.0, 1e-6);   // Fahne des Impulses vor OFF
    PRUEF_NAH(b[1000 + 11250 - 2000], 0.5, 1e-6);
    PRUEF_NAH(b[3000 + 5625], 0.0, 1e-6);          // Impuls nach OFF: kein Echo
    PRUEF(fx.klingt());                              // die Fahne ist noch in der Leitung
    std::vector<float> c(48000 * 6, 0.0f), cr(c);
    lauf(fx, c, cr, 30000);
    PRUEF(!fx.klingt());                             // nach 6 s Stille ausgeklungen (0,5^n)
  }

  // 4) LFO phasenstarr: Flanger mit Periode 16 Beats, eine Instanz ab Beat 8, eine ab Beat 12 → in Takt 11 gleich
  {
    const int64_t a0 = 8 * SPB, b0 = 12 * SPB, t0 = 40 * SPB, t1 = 44 * SPB;
    cdj::BeatFx fa, fb;
    fa.setze(cdj::BeatFx::FLANGER, 16.0, 1.0f, 0.5f, true);
    fb.setze(cdj::BeatFx::FLANGER, 16.0, 1.0f, 0.5f, true);
    std::vector<float> la(t1 - a0), ra(t1 - a0), lb(t1 - b0), rb(t1 - b0);
    for (int64_t s = a0; s < t1; ++s) la[s - a0] = ra[s - a0] = signal(s);
    for (int64_t s = b0; s < t1; ++s) lb[s - b0] = rb[s - b0] = signal(s);
    lauf(fa, la, ra, a0);
    lauf(fb, lb, rb, b0);
    double d = 0.0;
    for (int64_t s = t0; s < t1; ++s) d = std::max(d, (double)std::fabs(la[s - a0] - lb[s - b0]));
    PRUEF(d < 1e-5);
  }

  // 5) Artwechsel bei ON ohne Sprung (100-Hz-Sinus 0,5, Echo → Phaser → Filter): größte Änderung je Sample < 0,05
  {
    cdj::BeatFx fx;
    fx.setze(cdj::BeatFx::ECHO, 0.5, 1.0f, 0.6f, true);
    std::vector<float> l(48000 * 3), r(48000 * 3);
    for (size_t i = 0; i < l.size(); ++i) l[i] = r[i] = 0.5f * std::sin(2.0 * M_PI * 100.0 * i / 48000.0);
    float schritt = 0.0f, vorher = 0.0f;
    for (size_t i = 0; i < l.size(); i += 256) {
      if (i == 48000 - 48000 % 256) fx.setze(cdj::BeatFx::PHASER, 1.0, 1.0f, 0.6f, true);
      if (i == 96000 - 96000 % 256) fx.setze(cdj::BeatFx::FILTER, 1.0, 1.0f, 0.6f, true);
      const int n = static_cast<int>(std::min<size_t>(256, l.size() - i));
      g_waechter = true;
      fx.block(l.data() + i, r.data() + i, n, i * BPS, BPS);
      g_waechter = false;
      for (int k = 0; k < n; ++k) {
        if (i + k > 0) schritt = std::max(schritt, std::fabs(l[i + k] - vorher));
        vorher = l[i + k];
      }
    }
    PRUEF(schritt < 0.05f);
    PRUEF(fx.art() == cdj::BeatFx::FILTER);
  }

  // 5b) BEAT-Wechsel bei laufendem Echo (½ → 1 Beat): kein Sprung (vorher 0,61 mit sofort wechselnder Verzögerung, dann
  //     0,33 mit ungeleerter Leitung: die Rückkopplung schrieb eine Stufe hinein)
  {
    cdj::BeatFx fx;
    fx.setze(cdj::BeatFx::ECHO, 0.5, 1.0f, 0.6f, true);
    std::vector<float> l(48000 * 2), r(48000 * 2);
    for (size_t i = 0; i < l.size(); ++i) l[i] = r[i] = 0.5f * std::sin(2.0 * M_PI * 100.0 * i / 48000.0);
    float schritt = 0.0f, vorher = 0.0f;
    for (size_t i = 0; i < l.size(); i += 256) {
      if (i == 48000 - 48000 % 256) fx.setze(cdj::BeatFx::ECHO, 1.0, 1.0f, 0.6f, true);
      const int n = static_cast<int>(std::min<size_t>(256, l.size() - i));
      fx.block(l.data() + i, r.data() + i, n, i * BPS, BPS);
      for (int k = 0; k < n; ++k) {
        if (i + k > 0) schritt = std::max(schritt, std::fabs(l[i + k] - vorher));
        vorher = l[i + k];
      }
    }
    PRUEF(schritt < 0.05f);
  }

  // 6) OFF klingt bei jeder Art aus (Andreas 2026-09-28: „effekte laufen besser immer aus“): der Eingang schließt, das
  //    Trockene läuft voll, der Nachhall der Rückkopplung ist nach OFF noch da (Flanger, Rückkopplung 0,9) und endet dann;
  //    vorher glitt Wet in 480 Samples auf 0 und schnitt ihn ab
  {
    cdj::BeatFx fx;
    fx.setze(cdj::BeatFx::FLANGER, 1.0, 1.0f, 1.0f, true);
    std::vector<float> l(4000), r(4000);
    for (int i = 0; i < 4000; ++i) l[i] = r[i] = signal(i);
    lauf(fx, l, r, 0);
    fx.setze(cdj::BeatFx::FLANGER, 1.0, 1.0f, 1.0f, false);
    const int n = 48000;
    std::vector<float> m(n), mr(n), m0(n);
    for (int i = 0; i < n; ++i) m[i] = mr[i] = m0[i] = signal(4000 + i);
    lauf(fx, m, mr, 4000);
    double nachhall = 0.0, rest = 0.0;
    for (int i = 600; i < 1500; ++i) nachhall = std::max(nachhall, (double)std::fabs(m[i] - m0[i]));
    for (int i = 24000; i < n; ++i) rest = std::max(rest, (double)std::fabs(m[i] - m0[i]));
    PRUEF(nachhall > 1e-3);        // nach dem Gleiten (480) noch hörbar
    PRUEF(rest < 1e-6);            // eine halbe Sekunde später trocken
    PRUEF(!fx.klingt());
  }
  // 6b) dasselbe für Phaser und Filter: am Ende trocken und still (klingt() falsch)
  for (int art : {3, 4}) {
    cdj::BeatFx fx;
    fx.setze(art, 1.0, 1.0f, 1.0f, true);
    std::vector<float> l(4000), r(4000);
    for (int i = 0; i < 4000; ++i) l[i] = r[i] = signal(i);
    lauf(fx, l, r, 0);
    fx.setze(art, 1.0, 1.0f, 1.0f, false);
    std::vector<float> m(48000), mr(48000);
    for (int i = 0; i < 48000; ++i) m[i] = mr[i] = signal(4000 + i);
    lauf(fx, m, mr, 4000);
    PRUEF(!fx.klingt());
  }

  // 7) Echtzeit: keine Allokation in block()
  PRUEF(g_allokationen == 0);
  PRUEF_ENDE();
}
