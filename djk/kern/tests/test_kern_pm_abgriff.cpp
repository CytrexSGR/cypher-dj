// 1.10 Slice 2 (E2): der PM-Abgriff des Kerns. Fall 1 (AK17): bei inaktivem Set-Limiter (Spitze weit unter der Decke), Kleber 0, master/pegel 0 dB und
// erz/4 neutral ist der Ring-Master gleich dem Abgriff durch den Isolator von erz/4 (Gains 1,0, um den Limiter-Vorhalt ausgerichtet) unter −90 dBFS;
// um 1 Sample verschoben rot; Stille ungültig.
// Fall 2 (AK18 Kern-Teil): heißes Material: der Abgriff trägt die ungebremste Spitze (> 1,0), der Ring-Master hält die Decke (−1 dBTP = 0,891).
// Fall 3 (AK20): das Metronom klingt im Ring-Master, ist aber nicht im Abgriff. Fall 4: ohne Wiedergabe ist der Abgriff Stille.
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <string>
#include <vector>

#include <cypherdj/dsp/isolator.h>

#include "arr_lauf.h"

bool g_waechter = false;

using k35::N;

static double spitze(const std::vector<float>& x, int64_t von, int64_t bis) {
  double m = 0.0;
  for (int64_t i = von; i < bis && i < static_cast<int64_t>(x.size()); ++i) m = std::max(m, static_cast<double>(std::fabs(x[static_cast<size_t>(i)])));
  return m;
}

int main() {
  k35::Arbeitsbestand ab("test_kern_pm_abgriff");
  const double SCHWELLE = std::pow(10.0, -90.0 / 20.0);
  {  // 1 (AK17)
    arr35::Lauf x(ab.pfad, "pm1");
    const std::string a = x.ordner.sinus('a', 200000, 1000.0, 0.25f), b = x.ordner.sinus('b', 200000, 1500.0, 0.1f);
    x.lauf(10 * N);
    x.laden(5, "{\"nr\":1,\"art\":\"audio\",\"clips\":[" + x.ordner.clip("c1", 0.0, 4.0, a, 200000) + "]},"
               "{\"nr\":2,\"art\":\"audio\",\"clips\":[" + x.ordner.clip("c2", 0.0, 4.0, b, 200000) + "]}");
    x.lauf(12 * N);
    const int64_t s1 = x.start(0.0, 0);
    x.lauf(120 * N);
    const k35::Q* q2 = x.quittung(s1, 2);
    PRUEF(q2 != nullptr);
    const int64_t ein = q2 ? q2->sample : 0;
    // Referenz = Kanalzug von erz/4 über den Abgriff: der LR8-Isolator lässt bei Gains 1,0 den Betrag flach durch, die Phase nicht
    // (gemessen 2026-10-23: Abgriff direkt gegen Ring −11,4 dBFS, durch den Isolator −240 dBFS). Der Abgriff ist also der PM
    // ohne DJ-Kanalzug, der Ring-Master derselbe PM durch einen Allpass (Befund zu Spec 4, Gegenprobe; ~/messungen/2026-10-23-r1-bau/task17/).
    std::vector<float> ref_l(x.pm_l.size()), ref_r(x.pm_r.size());
    {
      cypherdj::dsp::Isolator iso;
      std::vector<float> eins(static_cast<size_t>(N), 1.0f);
      for (size_t o = 0; o + static_cast<size_t>(N) <= x.pm_l.size(); o += static_cast<size_t>(N))
        iso.verarbeite(&x.pm_l[o], &x.pm_r[o], &ref_l[o], &ref_r[o], N, eins.data(), eins.data(), eins.data());
    }
    double rest = 0.0, verschoben = 0.0, signal = 0.0;
    for (int64_t t = ein + 4000; t < ein + 24000; ++t) {
      const size_t i = static_cast<size_t>(t), j = static_cast<size_t>(t + x.vh);
      rest = std::max(rest, static_cast<double>(std::fabs(x.l[j] - ref_l[i])));
      rest = std::max(rest, static_cast<double>(std::fabs(x.r[j] - ref_r[i])));
      verschoben = std::max(verschoben, static_cast<double>(std::fabs(x.l[j + 1] - ref_l[i])));
      signal = std::max(signal, static_cast<double>(std::fabs(x.pm_l[i])));
    }
    std::printf("Fall 1: Rest %.1f dBFS, um 1 Sample verschoben %.1f dBFS, Signal %.1f dBFS\n", 20.0 * std::log10(rest + 1e-12),
                20.0 * std::log10(verschoben + 1e-12), 20.0 * std::log10(signal + 1e-12));
    PRUEF(signal > 0.1);        // hörbar: Stille in beiden Läufen gilt als ungültig, nicht als bestanden
    PRUEF(rest < SCHWELLE);
    PRUEF(verschoben > 1e-3);   // Gegenprobe
  }
  {  // 2 (AK18, Kern-Teil): heißes Material
    arr35::Lauf x(ab.pfad, "pm2");
    const std::string a = x.ordner.audio('e', 200000, 1.5f);   // pro Spur in der Mitte 1,5 · 0,7071 = 1,06
    x.lauf(10 * N);
    x.laden(5, "{\"nr\":1,\"art\":\"audio\",\"clips\":[" + x.ordner.clip("c1", 0.0, 4.0, a, 200000) + "]}");
    x.lauf(12 * N);
    const int64_t s1 = x.start(0.0, 0);
    x.lauf(120 * N);
    const k35::Q* q2 = x.quittung(s1, 2);
    PRUEF(q2 != nullptr);
    const int64_t ein = q2 ? q2->sample : 0;
    const double pm = spitze(x.pm_l, ein + 4000, ein + 24000), ring = spitze(x.l, ein + 4000 + x.vh, ein + 24000 + x.vh);
    std::printf("Fall 2: Abgriff %.3f, Ring-Master %.3f\n", pm, ring);
    PRUEF(pm > 1.0);       // ungebremst: über 0 dBFS
    PRUEF(ring <= 0.92);   // der Set-Limiter hält die Decke (−1 dBTP = 0,891 plus Spielraum der Probe)
  }
  {  // 3 (AK20): Metronom im Master, nicht im Abgriff
    arr35::Lauf x(ab.pfad, "pm3");
    x.lauf(10 * N);
    x.laden(5, "{\"nr\":1,\"art\":\"audio\",\"clips\":[]}");
    x.metronom(true, -6.0f, 0);
    x.lauf(12 * N);
    const int64_t s1 = x.start(0.0, 0);
    x.lauf(300 * N);
    const k35::Q* q2 = x.quittung(s1, 2);
    PRUEF(q2 != nullptr);
    PRUEF(spitze(x.l, q2 ? q2->sample : 0, 300 * N) > 0.01);   // der Klick ist am Ring zu hören (Positiv-Kontrolle)
    PRUEF(spitze(x.pm_l, 0, 300 * N) == 0.0 && spitze(x.pm_r, 0, 300 * N) == 0.0);
  }
  {  // 4: ohne Wiedergabe ist der Abgriff Stille
    arr35::Lauf x(ab.pfad, "pm4");
    x.lauf(50 * N);
    PRUEF(x.pm_l.size() == static_cast<size_t>(50 * N) && spitze(x.pm_l, 0, 50 * N) == 0.0);
  }
  {  // 5 (AK19, Kern-Teil): greift der Set-Limiter, meldet /zustand/arr limiter_db < 0; bei leisem Material bleibt es 0 (Negativ-Kontrolle)
    for (int heiss = 0; heiss < 2; ++heiss) {
      arr35::Lauf x(ab.pfad, heiss ? "pm5h" : "pm5k");
      const std::string a = x.ordner.audio('c', 200000, heiss ? 1.5f : 0.2f);
      x.lauf(10 * N);
      x.laden(5, "{\"nr\":1,\"art\":\"audio\",\"clips\":[" + x.ordner.clip("c1", 0.0, 4.0, a, 200000) + "]}");
      x.lauf(12 * N);
      x.start(0.0, 0);
      x.lauf(160 * N);
      float tief = 0.0f;
      size_t n = 0;
      for (const cdj::Ereignis& e : x.alle(cdj::Ereignis::ARR_ZUSTAND)) { tief = std::min(tief, e.arr_limiter_db); ++n; }
      std::printf("Fall 5 (%s): %zu Meldungen, tiefste limiter_db %.2f, Kern-Minimum %.2f\n", heiss ? "heiß" : "leise", n, tief, x.kern->limiter_db_min());
      PRUEF(n > 5);
      if (heiss) PRUEF(tief < -0.5f && x.kern->limiter_db_min() < -0.5f);
      else PRUEF(tief == 0.0f && x.kern->limiter_db_min() > -0.05f);
    }
    {  // die Lampe bleibt nach dem Eingriff 0,5 s und geht dann aus: das Material endet nach 40 000 Frames, der Rest ist Stille
      arr35::Lauf x(ab.pfad, "pm5l");
      const std::string a = x.ordner.audio('c', 40000, 1.5f);
      x.lauf(10 * N);
      x.laden(5, "{\"nr\":1,\"art\":\"audio\",\"clips\":[" + x.ordner.clip("c1", 0.0, 1.0, a, 40000) + "]}");
      x.lauf(12 * N);
      x.start(0.0, 0);
      x.lauf(400 * N);
      const auto z = x.alle(cdj::Ereignis::ARR_ZUSTAND);
      PRUEF(!z.empty() && z.front().arr_limiter_db == 0.0f && z.back().arr_limiter_db == 0.0f);   // vorn und hinten aus
      bool an = false;
      for (const auto& e : z) an = an || e.arr_limiter_db < -0.5f;
      PRUEF(an);                                                                                    // dazwischen an
      // Haltezeit (P12): letzte Meldung "an" und erste "aus" danach gegen die letzte Spitze über der Decke im Abgriff (Tafel: Zugabe zum Plan)
      int64_t t_letzt = -1, an_bis = -1, aus_ab = -1;
      for (size_t i = 0; i < x.pm_l.size(); ++i)
        if (std::fabs(x.pm_l[i]) > 0.9f) t_letzt = static_cast<int64_t>(i);
      for (const auto& e : z) {
        if (e.arr_limiter_db < -0.5f) an_bis = e.sample;
        else if (an_bis >= 0 && aus_ab < 0) aus_ab = e.sample;
      }
      std::printf("Fall 5 Lampe: letzte Spitze %lld, zuletzt an %lld, erste aus danach %lld (Halte %lld)\n", (long long)t_letzt, (long long)an_bis,
                  (long long)aus_ab, (long long)(aus_ab - t_letzt));
      PRUEF(t_letzt > 0 && aus_ab >= t_letzt + 20000);   // die Lampe bleibt nach dem letzten Eingriff etwa 0,5 s (24 000 Samples)
    }
  }
  PRUEF_ENDE();
}
