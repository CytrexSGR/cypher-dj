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

// T30 aus dem Band [lo, hi] Hz: FFT-freie Bandbegrenzung über zwei RBJ-Biquads (Hoch- und Tiefpass, Q 0,707),
// Schroeder-Rückwärtsintegral, Gerade durch −5 und −35 dB, mal 2.
static double t30_band(const std::vector<double>& x, double lo, double hi) {
  auto biquad = [](std::vector<double> v, double f, bool hoch) {
    const double w = 2.0 * M_PI * f / 48000.0, al = std::sin(w) / (2.0 * 0.70710678), c = std::cos(w);
    const double b0 = hoch ? (1 + c) / 2 : (1 - c) / 2, b1 = hoch ? -(1 + c) : 1 - c, b2 = b0;
    const double a0 = 1 + al, a1 = -2 * c, a2 = 1 - al;
    double x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (double& s : v) {
      const double y = (b0 * s + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
      x2 = x1; x1 = s; y2 = y1; y1 = y; s = y;
    }
    return v;
  };
  std::vector<double> b = biquad(biquad(x, lo, true), hi, false);
  std::vector<double> e(b.size() + 1, 0.0);
  for (size_t i = b.size(); i-- > 0;) e[i] = e[i + 1] + b[i] * b[i];
  size_t a5 = 0, a35 = 0;
  for (size_t i = 0; i < b.size(); ++i) {
    const double db = 10.0 * std::log10(e[i] / e[0] + 1e-300);
    if (!a5 && db <= -5.0) a5 = i;
    if (!a35 && db <= -35.0) { a35 = i; break; }
  }
  return a35 > a5 ? 2.0 * static_cast<double>(a35 - a5) / 48000.0 : 0.0;
}

int main() {
  // 1) Negativ-Kontrolle: Wet 0 ist für jede Art bitgleich trocken
  for (int art = 1; art <= 12; ++art) {
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
    std::vector<float> l(48000 * 4), r(48000 * 4);
    for (size_t i = 0; i < l.size(); ++i) l[i] = r[i] = 0.5f * std::sin(2.0 * M_PI * 100.0 * i / 48000.0);
    float schritt = 0.0f, vorher = 0.0f;
    for (size_t i = 0; i < l.size(); i += 256) {
      if (i == 48000 - 48000 % 256) fx.setze(cdj::BeatFx::PHASER, 1.0, 1.0f, 0.6f, true);
      if (i == 96000 - 96000 % 256) fx.setze(cdj::BeatFx::FILTER, 1.0, 1.0f, 0.6f, true);
      if (i == 144000 - 144000 % 256) fx.setze(cdj::BeatFx::REVERB, 1.0, 1.0f, 0.6f, true);
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
    PRUEF(fx.art() == cdj::BeatFx::REVERB);
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
  // R1) REVERB: Ausklingzeit = beats · SPB. Impuls, Wet 1, 2 Beats (0,9375 s bei 128) und 8 Beats (3,75 s): T30 im Band
  //     707–1414 Hz (Schroeder-Rückwärtsintegral, −5 bis −35 dB) innerhalb ±15 %.
  for (double beats : {2.0, 8.0}) {
    cdj::BeatFx fx;
    fx.setze(cdj::BeatFx::REVERB, beats, 1.0f, 0.5f, true);
    const int n = static_cast<int>(48000 * (beats * 60.0 / 128.0 * 2.5 + 0.5));
    std::vector<float> l(n, 0.0f), r(n, 0.0f);
    l[1000] = r[1000] = 1.0f;
    lauf(fx, l, r, 0);
    std::vector<double> y(l.begin() + 1001, l.end());   // nur der nasse Anteil nach dem Impuls (trocken ist dort 0)
    const double t30 = t30_band(y, 707.0, 1414.0);
    const double soll = beats * 60.0 / 128.0;
    std::printf("R1 REVERB %g Beats: T30 %.3f s, Soll %.3f s\n", beats, t30, soll);
    PRUEF(std::fabs(t30 / soll - 1.0) < 0.15);
  }
  // R2) OFF: die Fahne klingt aus, neuer Eingang nach OFF hallt nicht
  {
    cdj::BeatFx fx;
    fx.setze(cdj::BeatFx::REVERB, 4.0, 1.0f, 0.5f, true);
    std::vector<float> a(4000, 0.0f), ar(4000, 0.0f);
    a[1000] = ar[1000] = 1.0f;
    lauf(fx, a, ar, 0);
    fx.setze(cdj::BeatFx::REVERB, 4.0, 1.0f, 0.5f, false);   // OFF bei Sample 4000
    std::vector<float> b(96000, 0.0f), br(96000, 0.0f);
    lauf(fx, b, br, 4000);
    double e_fahne = 0;
    for (int i = 2000; i < 24000; ++i) e_fahne += b[i] * b[i];
    PRUEF(e_fahne > 1e-4);                     // Nachhall des Impulses vor OFF klingt weiter
    PRUEF(fx.klingt());
    cdj::BeatFx g;                              // Gegenprobe: Impuls erst NACH OFF → nur trocken, kein Hall
    g.setze(cdj::BeatFx::REVERB, 4.0, 1.0f, 0.5f, false);
    std::vector<float> c(48000, 0.0f), cr(48000, 0.0f);
    c[1000] = cr[1000] = 1.0f;
    lauf(g, c, cr, 0);
    double e_nach = 0;
    for (int i = 1001; i < 48000; ++i) e_nach += c[i] * c[i];
    PRUEF(e_nach < 1e-12);
  }
  // R3) Art-Wechsel ohne Sprung: den vorhandenen Test 5 (Echo → Phaser → Filter, 100-Hz-Sinus, Schritt < 0,05) um eine
  //     vierte Sekunde verlängern: Vektoren `48000 * 4`, dazu
  //     `if (i == 144000 - 144000 % 256) fx.setze(cdj::BeatFx::REVERB, 1.0, 1.0f, 0.6f, true);`
  //     und die Schlussprüfung auf `fx.art() == cdj::BeatFx::REVERB`.
  // R4) Keine C++-Allokation in block() bei REVERB (Rust-Seite: hall_ffi/tests/keine_allokation.rs)
  {
    g_allokationen = 0;
    cdj::BeatFx fx;
    fx.setze(cdj::BeatFx::REVERB, 2.0, 0.7f, 0.3f, true);
    std::vector<float> l(48000), r(48000);
    for (int i = 0; i < 48000; ++i) l[i] = r[i] = signal(i);
    lauf(fx, l, r, 0);
    PRUEF(g_allokationen == 0);
  }

  // D1) DELAY ¼ Beat, Wet 1, TONE 1 (offen): EINE Wiederholung bei +5 625 mit Energie ~1, keine zweite bei +11 250
  {
    cdj::BeatFx fx;
    fx.setze(cdj::BeatFx::DELAY, 0.25, 1.0f, 1.0f, true);
    std::vector<float> l(20000, 0.0f), r(20000, 0.0f);
    l[1000] = r[1000] = 1.0f;
    lauf(fx, l, r, 0);
    double s1 = 0, s2 = 0;
    for (int i = 0; i < 64; ++i) { s1 += l[1000 + 5625 + i]; s2 += std::fabs(l[1000 + 11250 + i]); }
    std::printf("D1 DELAY: Summe erste Wiederholung %.4f, zweite %.6f, vor der Wiederholung %.6f\n", s1, s2, l[1000 + 5624]);
    PRUEF(std::fabs(s1 - 1.0) < 0.02);
    PRUEF(s2 < 1e-6);
    PRUEF(std::fabs(l[1000 + 5624]) < 1e-9);
  }
  // D2) DELAY TONE 0: die Wiederholung ist dumpf (Tiefpass ~1 kHz): erste Probe deutlich unter der offenen
  {
    cdj::BeatFx a, b;
    a.setze(cdj::BeatFx::DELAY, 0.25, 1.0f, 1.0f, true);
    b.setze(cdj::BeatFx::DELAY, 0.25, 1.0f, 0.0f, true);
    std::vector<float> la(8000, 0.0f), ra(8000, 0.0f), lb(8000, 0.0f), rb(8000, 0.0f);
    la[1000] = ra[1000] = lb[1000] = rb[1000] = 1.0f;
    lauf(a, la, ra, 0);
    lauf(b, lb, rb, 0);
    PRUEF(lb[1000 + 5625] < 0.3f * la[1000 + 5625]);
  }
  // P1) PING PONG ¼ Beat, Rückkopplung 0,5: L bei +5 625 (1), R bei +11 250 (0,5), L bei +16 875 (0,25); gegenüber still
  {
    cdj::BeatFx fx;
    fx.setze(cdj::BeatFx::PINGPONG, 0.25, 1.0f, 0.5f / 0.9f, true);
    std::vector<float> l(24000, 0.0f), r(24000, 0.0f);
    l[1000] = r[1000] = 1.0f;
    lauf(fx, l, r, 0);
    std::printf("P1 PINGPONG: L %.4f R %.4f | R %.4f L %.4f | L %.4f R %.4f\n", l[6625], r[6625], r[12250], l[12250], l[17875], r[17875]);
    PRUEF_NAH(l[6625], 1.0, 1e-6);
    PRUEF_NAH(r[6625], 0.0, 1e-9);
    PRUEF_NAH(r[12250], 0.5, 1e-6);
    PRUEF_NAH(l[12250], 0.0, 1e-9);
    PRUEF_NAH(l[17875], 0.25, 1e-6);
    PRUEF_NAH(r[17875], 0.0, 1e-9);
  }
  // P2) PING PONG OFF nach dem Impuls: die Wiederholungen laufen weiter, neuer Eingang springt nicht mehr
  {
    cdj::BeatFx fx;
    fx.setze(cdj::BeatFx::PINGPONG, 0.25, 1.0f, 0.5f / 0.9f, true);
    std::vector<float> a(2000, 0.0f), ar(2000, 0.0f);
    a[1000] = ar[1000] = 1.0f;
    lauf(fx, a, ar, 0);
    fx.setze(cdj::BeatFx::PINGPONG, 0.25, 1.0f, 0.5f / 0.9f, false);
    std::vector<float> b(22000, 0.0f), br(22000, 0.0f);
    b[3000] = br[3000] = 1.0f;   // Sample 5000, nach OFF
    lauf(fx, b, br, 2000);
    PRUEF_NAH(br[12250 - 2000], 0.5, 1e-3);   // Fahne des ersten Impulses
    PRUEF(std::fabs(b[5000 + 5625 - 2000]) < 1e-3);   // der zweite Impuls wird nicht wiederholt
    PRUEF(fx.klingt());
  }
  // T1) TRANS 1 Beat, DUTY 0,5, Wet 1: Gleichsignal 0,5 ist in der ersten Beathälfte offen, in der zweiten zu,
  //     phasenstarr zum absoluten Beat (Start mitten im Beat)
  {
    cdj::BeatFx fx;
    fx.setze(cdj::BeatFx::TRANS, 1.0, 1.0f, 0.5f, true);
    const int64_t s0 = 7 * SPB + 3000;
    std::vector<float> l(6 * SPB, 0.5f), r(6 * SPB, 0.5f);
    lauf(fx, l, r, s0);
    const auto bei = [&](int64_t abs) { return l[abs - s0]; };
    std::printf("T1 TRANS: Beat 10,25 %.4f  Beat 10,75 %.4f  Beat 11,1 %.4f\n", bei(10 * SPB + SPB / 4), bei(10 * SPB + 3 * SPB / 4), bei(11 * SPB + SPB / 10));
    PRUEF_NAH(bei(10 * SPB + SPB / 4), 0.5, 1e-4);
    PRUEF(std::fabs(bei(10 * SPB + 3 * SPB / 4)) < 1e-4);
    PRUEF_NAH(bei(11 * SPB + SPB / 10), 0.5, 1e-4);
    float sprung = 0.0f;   // Flanken geglättet: keine Stufe über 0,05 je Sample
    for (size_t i = 1; i < l.size(); ++i) sprung = std::max(sprung, std::fabs(l[i] - l[i - 1]));
    PRUEF(sprung < 0.05f);
  }

  // Chirp als Prüfsignal: nie periodisch, jedes Sample eindeutig (Roll muss eine Wiederholung erzeugen, die nicht im Eingang steht)
  const auto chirp = [](int64_t n) { return 0.4f * static_cast<float>(std::sin(2.0 * M_PI * (300.0 * n / 48000.0 + 1e-6 * n * n / 48000.0))); };
  // RO1) ROLL ¼ Beat (L = 5 625): ab 2L ist die Ausgabe L-periodisch und gleich der Aufnahme ab dem Einschalten
  {
    cdj::BeatFx fx;
    fx.setze(cdj::BeatFx::ROLL, 0.25, 1.0f, 0.5f, true);
    const int L = 5625;
    std::vector<float> l(6 * L), r(6 * L), x(6 * L);
    for (int i = 0; i < 6 * L; ++i) l[i] = r[i] = x[i] = chirp(i);
    lauf(fx, l, r, 0);
    float diff_periode = 0.0f, diff_aufnahme = 0.0f, diff_eingang = 0.0f;
    for (int ph = 200; ph < L - 200; ++ph) {
      diff_periode = std::max(diff_periode, std::fabs(l[3 * L + ph] - l[2 * L + ph]));
      diff_aufnahme = std::max(diff_aufnahme, std::fabs(l[3 * L + ph] - x[ph]));
      diff_eingang = std::max(diff_eingang, std::fabs(l[3 * L + ph] - x[3 * L + ph]));
    }
    std::printf("RO1 ROLL: Periode %.2e, gegen Aufnahme %.2e, gegen laufenden Eingang %.3f\n", diff_periode, diff_aufnahme, diff_eingang);
    PRUEF(diff_periode < 1e-6f && diff_aufnahme < 1e-6f);
    PRUEF(diff_eingang > 0.1f);   // Negativ: es ist wirklich die Wiederholung, nicht das Durchgereichte
  }
  // RO2) BEAT-Wechsel ¼ → ½ bei Sample 22 500: ROLL wiederholt weiter die ERSTE Aufnahme (ab 0), SLIP ROLL nimmt NEU auf (ab 22 500)
  for (int art : {static_cast<int>(cdj::BeatFx::ROLL), static_cast<int>(cdj::BeatFx::SLIPROLL)}) {
    cdj::BeatFx fx;
    fx.setze(art, 0.25, 1.0f, 0.5f, true);
    const int L2 = 11250, tc = 22500;
    std::vector<float> l(tc + 4 * L2), r(tc + 4 * L2), x(tc + 4 * L2);
    for (size_t i = 0; i < l.size(); ++i) l[i] = r[i] = x[i] = chirp(i);
    std::vector<float> a(l.begin(), l.begin() + tc), ar(a);
    lauf(fx, a, ar, 0);
    fx.setze(art, 0.5, 1.0f, 0.5f, true);
    std::vector<float> b(l.begin() + tc, l.end()), br(b);
    lauf(fx, b, br, tc);
    const int quelle = art == cdj::BeatFx::SLIPROLL ? tc : 0;
    float d = 0.0f;
    for (int ph = 200; ph < L2 - 200; ++ph) d = std::max(d, std::fabs(b[2 * L2 + ph] - x[quelle + ph]));
    std::printf("RO2 %s: Abweichung von der Aufnahme ab %d: %.2e\n", art == cdj::BeatFx::SLIPROLL ? "SLIP ROLL" : "ROLL", quelle, d);
    PRUEF(d < 1e-6f);
  }
  // RO3) ROLL OFF: zurück zum laufenden Eingang (kein Nachklang)
  {
    cdj::BeatFx fx;
    fx.setze(cdj::BeatFx::ROLL, 0.25, 1.0f, 0.5f, true);
    std::vector<float> l(40000), r(40000);
    for (int i = 0; i < 40000; ++i) l[i] = r[i] = chirp(i);
    std::vector<float> a(l.begin(), l.begin() + 20000), ar(a);
    lauf(fx, a, ar, 0);
    fx.setze(cdj::BeatFx::ROLL, 0.25, 1.0f, 0.5f, false);
    std::vector<float> b(l.begin() + 20000, l.end()), br(b);
    lauf(fx, b, br, 20000);
    float d = 0.0f;
    for (int i = 2000; i < 20000; ++i) d = std::max(d, std::fabs(b[i] - l[20000 + i]));
    PRUEF(d < 1e-6f);
  }
  // V1) VINYL BRAKE 4 Beats (T = 90 000): 1 kHz wird zur Mitte hin ~500 Hz (halbe Geschwindigkeit), nach T still
  {
    cdj::BeatFx fx;
    fx.setze(cdj::BeatFx::VINYL, 4.0, 1.0f, 0.5f, true);
    const int T = 90000;
    std::vector<float> l(T + 20000), r(T + 20000);
    for (size_t i = 0; i < l.size(); ++i) l[i] = r[i] = 0.5f * static_cast<float>(std::sin(2.0 * M_PI * 1000.0 * i / 48000.0));
    lauf(fx, l, r, 0);
    int nd = 0;
    for (int i = T / 2 - 2400; i < T / 2 + 2400; ++i) nd += (l[i] < 0.0f) != (l[i + 1] < 0.0f);
    const double f = nd / 2.0 / 0.1;   // Nulldurchgänge in 0,1 s
    float rest = 0.0f;
    for (size_t i = T + 1000; i < l.size(); ++i) rest = std::max(rest, std::fabs(l[i]));
    std::printf("V1 VINYL BRAKE: Mitte %.0f Hz (Soll ~500), nach dem Stopp max %.2e\n", f, rest);
    PRUEF(f > 450.0 && f < 550.0);
    PRUEF(rest < 1e-6f);
  }
  // S1) SPIRAL ¼ Beat, Rückkopplung 0,5: erste Wiederholung genau bei d (1,0), die zweite verschmiert mit Energie ~0,25
  {
    cdj::BeatFx fx;
    fx.setze(cdj::BeatFx::SPIRAL, 0.25, 1.0f, 0.5f / 0.95f, true);
    std::vector<float> l(24000, 0.0f), r(24000, 0.0f);
    l[1000] = r[1000] = 1.0f;
    lauf(fx, l, r, 0);
    double e2 = 0;
    for (int i = 1000 + 2 * 5625 - 10; i < 1000 + 2 * 5625 + 3000; ++i) e2 += l[i] * l[i];
    std::printf("S1 SPIRAL: erste Wiederholung %.4f, Energie der zweiten %.4f (Soll 0,25)\n", l[1000 + 5625], e2);
    PRUEF_NAH(l[1000 + 5625], 1.0, 1e-4);
    PRUEF(std::fabs(e2 - 0.25) < 0.0125);
  }
  // S2) SPIRAL BEAT-Wechsel ¼ → ½: KEIN Leeren (die Fahne läuft durch und gleitet), danach Wiederholung bei der neuen Zeit
  {
    cdj::BeatFx fx;
    fx.setze(cdj::BeatFx::SPIRAL, 0.25, 1.0f, 0.6f, true);
    std::vector<float> l(90000), r(90000);
    for (int i = 0; i < 20000; ++i) l[i] = r[i] = chirp(i);
    for (int i = 20000; i < 90000; ++i) l[i] = r[i] = 0.0f;
    std::vector<float> a(l.begin(), l.begin() + 20000), ar(a);
    lauf(fx, a, ar, 0);
    fx.setze(cdj::BeatFx::SPIRAL, 0.5, 1.0f, 0.6f, true);
    std::vector<float> b(70000, 0.0f), br(70000, 0.0f);
    b[40000] = br[40000] = 1.0f;   // Sample 60 000, nach dem Gleiten
    lauf(fx, b, br, 20000);
    double e_durch = 0;   // ab 1 000 Samples: nach dem Ausgleiten (480), das ein falsches Leeren hätte
    for (int i = 1000; i < 5000; ++i) e_durch += b[i] * b[i];
    std::printf("S2 SPIRAL: Energie direkt nach dem Wechsel %.4f, Wiederholung bei neuer Zeit %.4f\n", e_durch, b[40000 + 11250]);
    PRUEF(e_durch > 1e-3);                      // Fahne nicht geleert
    PRUEF(std::fabs(b[40000 + 11250]) > 0.5f);  // neue Verzögerung ½ Beat erreicht
  }
  PRUEF_ENDE();
}
