// Scheibe 18, Vergleichsmessung: was kostet das Schreiben des Echtzeit-Fachs im Callback? Misst je Zyklus (Quantum 256)
// die Dauer von Kern::zyklus allein und von zyklus_anfang + zyklus + zyklus_ende, mit 1 offenen Befehl (Prüfklick),
// 2 (Klick und Rampe) und so vielen wartenden Rampen, wie die Karte fasst (64 Segmente, §1.3). Dazu der schlimmste Fall
// des Fachs selbst: 256 Einträge (§6.3) je Zyklus kopiert. Ausgabe: eine JSON-Zeile je Fall mit p50, p99 und Maximum in
// Mikrosekunden. Kein Test mit Grenze (Fremdlast verschiebt Zeiten), sondern eine Zahl für die Stand-Datei; die Grenze
// prüft /zustand/kern am laufenden Kern (Task 9).
#include <time.h>
#include <unistd.h>

#include <algorithm>
#include <cstdio>
#include <cstring>
#include <memory>
#include <string>
#include <vector>

#include "cypherdj/neustart.h"

static int64_t jetzt() {
  timespec t;
  clock_gettime(CLOCK_MONOTONIC, &t);
  return (int64_t)t.tv_sec * 1000000000LL + t.tv_nsec;
}

static void fall(const char* name, int rampen, bool mit_zustand, const std::string& pfad) {
  auto mem = std::make_unique<unsigned char[]>(CDJ_RING_BYTES);
  auto* ring = reinterpret_cast<cdj_ring_kopf*>(mem.get());
  std::memcpy(ring->magic, "CDJB", 4);
  auto bef = std::make_unique<cdj::Befehlsring>();
  auto ere = std::make_unique<cdj::Ereignisring>();
  cdj::Kern kern(128.0, ring, bef.get(), ere.get());
  cdj::Betrieb betrieb;
  unlink(pfad.c_str());
  if (mit_zustand) betrieb.starte(pfad, kern);
  cdj::Befehl b{};
  b.art = cdj::Befehl::KLICK;
  b.id = 1;
  b.an = 1;
  std::snprintf(b.quelle, sizeof b.quelle, "pruefstand");
  bef->schiebe(b);
  for (int i = 0; i < rampen; ++i) {  // wartende Rampen weit in der Zukunft, je 1 Beat, ohne Überlappung
    cdj::Befehl r{};
    r.art = cdj::Befehl::TEMPO_RAMPE;
    r.id = 100 + i;
    std::snprintf(r.quelle, sizeof r.quelle, "leitstand");
    r.ab_beat = 100000.0 + 2.0 * i;
    r.ziel_bpm = (i % 2) ? 128.0 : 129.0;
    r.dauer_beats = 1.0;
    while (!bef->schiebe(r)) {
      kern.zyklus(256, 0);
      cdj::Ereignis e;
      while (ere->hole(e)) {}
    }
  }
  std::vector<int32_t> ns;
  ns.reserve(20000);
  uint32_t F = 0;
  for (int z = 0; z < 20000; ++z) {
    const int64_t t0 = jetzt();
    if (mit_zustand) betrieb.zyklus_anfang(F, (int64_t)F * 20833, kern);
    kern.zyklus(256, (int64_t)F * 20833);
    if (mit_zustand) betrieb.zyklus_ende(F, (int64_t)F * 20833, 256, kern);
    ns.push_back((int32_t)(jetzt() - t0));
    F += 256;
    cdj::Ereignis e;
    while (ere->hole(e)) {}
  }
  std::sort(ns.begin(), ns.end());
  std::printf("{\"fall\":\"%s\",\"offene_befehle\":%d,\"zustand\":%s,\"p50_us\":%.2f,\"p99_us\":%.2f,\"max_us\":%.2f}\n",
              name, kern.wartend() + 1, mit_zustand ? "true" : "false", ns[ns.size() / 2] / 1e3,
              ns[ns.size() * 99 / 100] / 1e3, ns.back() / 1e3);
}

// Schlimmster Fall des Fachs: 256 Einträge je Zyklus (spätere Scheiben mit Teilen), ohne Kern
static void fach_voll(const std::string& pfad) {
  unlink(pfad.c_str());
  cdj::ZustandDatei z;
  z.oeffne(pfad);
  cdj::FachSchreiber<cdj_z_echtzeit> w;
  w.verbinde(z.daten()->echtzeit, 0);
  auto quelle = std::make_unique<cdj_z_befehl[]>(CDJ_Z_BEFEHLE);
  std::vector<int32_t> ns;
  for (int k = 0; k < 20000; ++k) {
    const int64_t t0 = jetzt();
    cdj_z_echtzeit* f = w.beginne();
    std::memcpy(f->befehle, quelle.get(), sizeof(cdj_z_befehl) * CDJ_Z_BEFEHLE);
    f->n_befehle = CDJ_Z_BEFEHLE;
    w.beende();
    ns.push_back((int32_t)(jetzt() - t0));
  }
  std::sort(ns.begin(), ns.end());
  std::printf("{\"fall\":\"fach_256\",\"offene_befehle\":256,\"zustand\":true,\"p50_us\":%.2f,\"p99_us\":%.2f,"
              "\"max_us\":%.2f}\n", ns[ns.size() / 2] / 1e3, ns[ns.size() * 99 / 100] / 1e3, ns.back() / 1e3);
}

int main() {
  const std::string ordner = "/dev/shm/cypherdj-test18m-" + std::to_string(getpid());
  const std::string pfad = ordner + "/zustand";
  fall("ohne_zustand_1", 0, false, pfad);
  fall("mit_zustand_1", 0, true, pfad);
  fall("ohne_zustand_2", 1, false, pfad);
  fall("mit_zustand_2", 1, true, pfad);
  fall("ohne_zustand_voll", 255, false, pfad);
  fall("mit_zustand_voll", 255, true, pfad);
  fach_voll(pfad);
  unlink(pfad.c_str());
  rmdir(ordner.c_str());
  return 0;
}
