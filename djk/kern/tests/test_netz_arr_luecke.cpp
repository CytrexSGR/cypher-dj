// D1 K1 Slice 9 (A10): Laden einer großen Wiedergabe blockiert den Netz-Faden nicht. Drei Fäden wie im Betrieb: Callback
// (Kern::zyklus alle 5,33 ms), Netz (laufen), Arrangement-Lade-Faden (laufen, mit MAP_POPULATE und mlock). Eine
// Gegenstelle misst die Abstände der /uhr-Pakete vor und während des Ladens. Grenze: größte Lücke beim Laden höchstens
// 10 ms über der größten Lücke ohne Laden (Grundrauschen dieses Rechners). Die Datei liegt auf dem Datenträger des
// Bauordners (wie ~/.cache, nicht /dev/shm) und ist vor dem Laden aus dem Seiten-Cache geworfen: das Laden liest wirklich.
// Größe: CYPHERDJ_ARR_LUECKE_MB (Vorgabe 200; die Abnahme A10 fährt 500).
// Mutation: ARR_NETZ_WARTET (das Netz wartet aufs Laden) macht den Test rot.
#include <poll.h>
#include <sys/socket.h>
#include <time.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <thread>

#include "arr_datei.h"
#include "cypherdj/arr_lader.h"
#include "cypherdj/netz.h"
#include "gegenstelle.h"
#include "pruef.h"

namespace v = cypherdj::osc;

static int64_t jetzt_ns() {
  timespec t;
  clock_gettime(CLOCK_MONOTONIC, &t);
  return static_cast<int64_t>(t.tv_sec) * 1000000000LL + t.tv_nsec;
}

// größte Lücke vor einem /uhr-Paket (ms), das in [von, bis) ankam (auch die Lücke, die vor von begann)
struct Messung {
  std::vector<int64_t> t;
  double groesste(int64_t von, int64_t bis) const {
    double m = 0.0;
    for (size_t i = 1; i < t.size(); ++i)
      if (t[i] >= von && t[i] < bis) m = std::max(m, (t[i] - t[i - 1]) / 1e6);
    return m;
  }
};

int main() {
  const char* e = std::getenv("CYPHERDJ_ARR_LUECKE_MB");
  const int64_t mb = e ? std::atoll(e) : 200;
  const int64_t frames = mb * (1LL << 20) / 8;
  arrdatei::Ordner o("test_netz_arr_luecke", ".");   // Bauordner: ext4 wie ~/.cache
  const std::string a = o.audio('a', frames, 0.0f);
  o.kalt(a);
  o.wiedergabe(1, "{\"nr\":1,\"art\":\"audio\",\"clips\":[" + o.clip("c1", 0.0, 1.0, a, frames) + "]}");

  auto mem = std::make_unique<unsigned char[]>(CDJ_RING_BYTES);
  auto* ring = reinterpret_cast<cdj_ring_kopf*>(mem.get());
  std::memset(ring, 0, sizeof *ring);
  auto bef = std::make_unique<cdj::Befehlsring>();
  auto ere = std::make_unique<cdj::Ereignisring>();
  auto ringe = std::make_unique<cdj::ArrLaderRinge>();
  cdj::SpeicherKonto konto(3800LL << 20);
  cdj::ArrLader lader(o.pfad, &konto, 3800LL << 20, true);
  auto kern = std::make_unique<cdj::Kern>(128.0, ring, bef.get(), ere.get());
  cdj::Netz netz(0, false, bef.get(), ere.get());
  netz.verbinde_arr(ringe.get());
  Gegenstelle g(netz.port());
  {
    cdj::osc::Schreiber s(v::k_hallo);
    s.s("x").i(g.port).i(1);
    g.sende(s);
  }
  std::atomic<bool> stop{false};
  std::thread callback([&] {
    int64_t naechster = jetzt_ns();
    while (!stop.load()) {
      kern->zyklus(256, jetzt_ns());
      naechster += 5333333;
      std::this_thread::sleep_until(std::chrono::steady_clock::time_point(std::chrono::nanoseconds(naechster)));
    }
  });
  std::thread netz_faden([&] { netz.laufen(stop); });
  std::thread lade_faden([&] { lader.laufen(*ringe, stop); });

  Messung m;
  bool geladen = false;   // Quittung 3 von /k/arr/laden (id 91) gesehen
  // empfängt bis bis_ns (oder bis geladen, wenn bis_geladen): Ankunftszeit jedes /uhr, Quittung 3 der Ladung
  auto empfang = [&](int64_t bis_ns, bool bis_geladen) {
    char buf[2048];
    while (jetzt_ns() < bis_ns && !(bis_geladen && geladen)) {
      pollfd pf{g.sock, POLLIN, 0};
      if (poll(&pf, 1, 1) <= 0) continue;
      const ssize_t r = recv(g.sock, buf, sizeof buf, MSG_DONTWAIT);
      cdj::osc::Nachricht n;
      if (r <= 0 || !cdj::osc::lesen(buf, static_cast<size_t>(r), n)) continue;
      if (!std::strcmp(n.adresse, "/uhr")) m.t.push_back(jetzt_ns());
      else if (!std::strcmp(n.adresse, "/q") && n.werte[0].h == 91 && n.werte[2].i == 3) geladen = true;
    }
  };
  empfang(jetzt_ns() + 500'000'000, false);     // einschwingen
  const int64_t ohne_von = jetzt_ns();
  empfang(jetzt_ns() + 1'000'000'000, false);   // ohne Laden
  const int64_t mit_von = jetzt_ns();
  {
    cdj::osc::Schreiber s(v::k_arr_laden);
    s.h(91).s("andreas").i(1);
    g.sende(s);
  }
  empfang(jetzt_ns() + 20'000'000'000LL, true);
  const int64_t lade_ende = jetzt_ns();
  empfang(jetzt_ns() + 300'000'000, false);
  const int64_t mit_bis = jetzt_ns();
  stop = true;
  callback.join();
  netz_faden.join();
  lade_faden.join();

  const double ohne = m.groesste(ohne_von, mit_von), mit = m.groesste(mit_von, mit_bis);
  std::printf("arr_luecke: %lld MiB, /uhr-Lücke ohne Laden %.2f ms, beim Laden %.2f ms, Laden %.0f ms, geladen %d\n",
              (long long)mb, ohne, mit, (lade_ende - mit_von) / 1e6, geladen ? 1 : 0);
  PRUEF(geladen);
  PRUEF(m.t.size() > 200);
  PRUEF(mit <= ohne + 10.0);
  if (const cdj::ArrSnapshot* s = kern->arrangement().snapshot()) {
    ringe->rueckgabe.schiebe(const_cast<cdj::ArrSnapshot*>(s));
    lader.einmal(*ringe);
  }
  PRUEF_ENDE();
}
