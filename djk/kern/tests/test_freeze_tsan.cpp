// Paket K3 (A10, Spec 6.29): der Weg eines Freeze-Auftrags über drei Fäden wie im Betrieb. Netz-Faden (Netz::laufen:
// /k/arr/freeze, Lade-Ergebnisse, Rückgaben, /e/freeze), Kern-Faden (Kern::zyklus) und Arrangement-Lade-Faden
// (ArrLader::laufen: Puffer anlegen, Datei schreiben, freigeben) laufen gleichzeitig; der Auftrag samt Puffer geht nur
// über die SPSC-Ringe (Lader -> Netz -> Kern -> Netz -> Lader). Drei Freezes, der zweite durch /k/arr/stopp abgebrochen:
// /e/freeze 0, 1, 0, Dateien nur für den ersten und dritten.
// Unter ThreadSanitizer (eigener Bau mit -DCYPHERDJ_TSAN=ON, Ziel test_freeze_tsan) meldet TSan keinen Befund.
// Gegenprobe dort (Ziel test_freeze_tsan_ohne_ring, nur im TSan-Bau): derselbe Lauf, dazu ein Auftrag, dessen Zeiger ohne
// Ring an den Kern-Faden geht (gewöhnliche Variable); TSan muss das Datenrennen melden.
#include <cstdio>
#include <filesystem>

#include "freeze_faeden.h"

#ifdef CYPHERDJ_TSAN_OHNE_RING
cdj::ArrFreeze* g_roh = nullptr;   // Fehlerfall: Übergabe ohne Ring und ohne Ordnung
int32_t g_gesehen = -1;
#endif

int main() {
  ff::Aufbau x("test_freeze_tsan");
  const std::string a = x.ordner.audio('a', 48000);
  x.ordner.wiedergabe(1, "{\"nr\":1,\"art\":\"audio\",\"clips\":[" + x.ordner.clip("c1", 0.0, 1.0, a, 48000) + "]}");
  x.echtzeit.store(false);
  x.pause_us.store(300);
  x.starten([](cdj::Kern&) {
#ifdef CYPHERDJ_TSAN_OHNE_RING
    if (g_roh) g_gesehen = g_roh->kennung;
#endif
  });
  x.hallo();
  PRUEF(x.warte("/k/willkommen", 5000, [](const cdj::osc::Nachricht&) { return true; }) >= 0);
  const int64_t l = x.laden(1);
  PRUEF(x.warte_q(l, 3, 20000) >= 0);
  auto e_freeze = [&](int32_t kennung) {
    return x.warte("/e/freeze", 120000, [&](const cdj::osc::Nachricht& m) { return m.werte[1].i == kennung; });
  };
  auto status = [&](long i) {
    cdj::osc::Nachricht m;
    const ff::Paket& p = x.pakete[static_cast<size_t>(i)];
    return cdj::osc::lesen(p.roh.data(), p.roh.size(), m) ? m.werte[2].i : -1;
  };
  // 1: fertig
  const int64_t f1 = x.freeze(1, 0.0, 1.0, 11);
  const long e1 = e_freeze(11);
  PRUEF(e1 >= 0 && status(e1) == 0 && x.warte_q(f1, 3, 1000) >= 0);
  // 2: abgebrochen (Stopp nach dem Einsatz)
  const int64_t f2 = x.freeze(1, 0.0, 4.0, 12);
  PRUEF(x.warte_q(f2, 2, 60000) >= 0);
  x.stopp();
  const long e2 = e_freeze(12);
  PRUEF(e2 >= 0 && status(e2) == 1 && x.warte_q(f2, 7, 1000) >= 0);
  // 3: fertig
  const int64_t f3 = x.freeze(1, 0.0, 1.0, 13);
  const long e3 = e_freeze(13);
  PRUEF(e3 >= 0 && status(e3) == 0 && x.warte_q(f3, 3, 1000) >= 0);
#ifdef CYPHERDJ_TSAN_OHNE_RING
  auto roh = std::make_unique<cdj::ArrFreeze>();
  roh->kennung = 99;
  g_roh = roh.get();   // ohne Ring: der Kern-Faden liest Zeiger und Inhalt ohne Ordnung
  x.sammeln(50);
  roh->kennung = 98;
  x.sammeln(50);
#endif
  x.anhalten();
  const bool d11 = std::filesystem::exists(x.ordner.pfad + "/freeze-1-11.f32");
  const bool d12 = std::filesystem::exists(x.ordner.pfad + "/freeze-1-12.f32");
  const bool d13 = std::filesystem::exists(x.ordner.pfad + "/freeze-1-13.f32");
  std::printf("freeze_tsan: /e/freeze %d %d %d, Dateien %d %d %d\n", e1 >= 0 ? status(e1) : -1, e2 >= 0 ? status(e2) : -1,
              e3 >= 0 ? status(e3) : -1, d11, d12, d13);
  PRUEF(d11 && !d12 && d13);
  PRUEF_ENDE();
}
