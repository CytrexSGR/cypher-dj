// Paket K3 (A10, Spec 6.29): wie lange der Arrangement-Lade-Faden für einen Freeze arbeitet: Auftrag samt Puffer anlegen
// (freeze_anlegen, Kapazität für 60 BPM plus Nachlauf, alle Seiten berührt) und die Datei schreiben (schreibe_freeze, wie
// nach dem Ende des Durchlaufs; ohne fsync, in den Seiten-Cache), für 8 Takte plus Nachlauf (32 + 2 Beats) und für die
// Höchstlänge (256 + 2 Beats), Datei bei 124 BPM, je drei Läufe. Kein Test: seit 6.29 steht in dieser Zeit nicht der
// Netz-Faden (/uhr läuft weiter, test_netz_arr_freeze_uhr), sondern ein Laden wartet hinter dem Freeze. Zahlen in den
// Bericht von Task 7.2.
// Aufruf: kern_freeze_schreiben <ordner>   (Ordner auf dem Datenträger des Arbeitsordners, z. B. ~/.cache/cypherdj-b/arr)
#include <algorithm>
#include <chrono>
#include <cstdio>
#include <memory>
#include <string>

#include "cypherdj/arr_lader.h"
#include "cypherdj/arrangement.h"

int main(int argc, char** argv) {
  if (argc < 2) {
    std::fprintf(stderr, "Aufruf: kern_freeze_schreiben <ordner>\n");
    return 2;
  }
  const std::string ordner = argv[1];
  for (double laenge : {32.0, 256.0}) {
    for (int lauf = 0; lauf < 3; ++lauf) {
      cdj::ArrAuftrag a{};
      a.art = cdj::ArrAuftrag::FREEZE;
      a.spur = 1;
      a.kennung = 900000 + lauf;
      a.von_beat = 0.0;
      a.bis_beat = laenge;
      char grund[32] = {0};
      const auto t_an = std::chrono::steady_clock::now();
      std::unique_ptr<cdj::ArrFreeze> f(cdj::freeze_anlegen(a, grund, sizeof grund));
      const double anlegen = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t_an).count();
      if (!f) {
        std::fprintf(stderr, "freeze_anlegen: %s\n", grund);
        return 1;
      }
      const double beats = laenge + cdj::ARR_FREEZE_NACHLAUF;
      f->frames = static_cast<int64_t>(beats * 48000.0 * 60.0 / 124.0);
      std::fill(f->daten.begin(), f->daten.begin() + 2 * f->frames, 0.1f);
      std::string fehler;
      const auto t0 = std::chrono::steady_clock::now();
      const bool ok = cdj::schreibe_freeze(ordner, *f, fehler);
      const double ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
      if (!ok) std::fprintf(stderr, "schreibe_freeze: %s\n", fehler.c_str());
      std::printf("{\"beats\":%.0f,\"puffer_mb\":%.1f,\"anlegen_ms\":%.1f,\"datei_mb\":%.1f,\"ok\":%d,\"schreiben_ms\":%.1f}\n",
                  beats, static_cast<double>(f->kap) * 8.0 / 1e6, anlegen, static_cast<double>(f->frames) * 8.0 / 1e6,
                  ok ? 1 : 0, ms);
      std::remove(cdj::freeze_datei(ordner, 1, f->kennung).c_str());
    }
  }
  return 0;
}
