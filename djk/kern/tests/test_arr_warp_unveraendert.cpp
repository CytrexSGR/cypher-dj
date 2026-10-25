// Paket 1.13 Warp, AK1: ohne Warp ändert sich am Klang des Arrangements kein Bit. Das Referenzprojekt (drei Audio-Spuren aus
// Rauschen, Ein- und Ausblenden, Offset, Loop-Naht, ein Tausch mit geändertem Clip, ein Stopp) läuft durch den Treiber; der
// FNV-1a-Hash über alle Ausgabe-Samples (Zeile 1: L und R der Spur-Summe, Zeile 2: die Metronom-Ausgänge des Moduls, Master- und Cue-Ziel, Bytes der Floats) steht in tests/daten/arr_warp_unveraendert.hash und wurde
// VOR der ersten Änderung des Pakets auf main aufgenommen (Aufruf mit --schreibe). Jede spätere Änderung an der Stimmen-Schleife,
// die den ungewarpten Weg berührt, macht den Test rot.
// Aufruf: test_arr_warp_unveraendert [--schreibe]
#include <cmath>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <string>

#include "arr_bau.h"
#include "pruef.h"

using namespace arrtest;
using cdj::ArrArt;

namespace {

std::unique_ptr<Audio> rauschen(int64_t frames, uint32_t saat) {   // feste Folge, Spitze 0,5: jede Verschiebung um ein Sample ist sichtbar
  auto x = std::make_unique<Audio>();
  x->d.resize(static_cast<size_t>(frames) * 2);
  uint32_t z = saat;
  for (float& v : x->d) {
    z = z * 1664525u + 1013904223u;
    v = 0.5f * (static_cast<float>(z >> 8) / 8388608.0f - 1.0f);
  }
  x->fuellen(frames);
  return x;
}

uint64_t fnv(const std::vector<float>& v, uint64_t h) {
  for (float f : v) {
    uint8_t b[sizeof f];
    std::memcpy(b, &f, sizeof f);
    for (uint8_t c : b) {
      h ^= c;
      h *= 1099511628211ULL;
    }
  }
  return h;
}

bool hat_signal(const std::vector<float>& v) {
  for (float f : v)
    if (std::fabs(f) > 1e-6f) return true;
  return false;
}

struct Hashes {
  uint64_t lr = 0;   // Spur-Summe L und R
  uint64_t metro = 0;   // Metronom-Ausgänge ml, mr (Ziel Master) und cl, cr (Ziel Cue) des Moduls; sie tragen Signal nur, wenn das Metronom spielt (siehe lauf_referenz)
};

Hashes lauf_referenz() {
  Treiber t;
  auto a = rauschen(300000, 1), b = rauschen(300000, 2), c = rauschen(100000, 3);
  t.laden(Bau().spur(1, ArrArt::audio).spur(2, ArrArt::audio).spur(3, ArrArt::audio)
              .clip(1, "c1", 0.0, 4.0, &a->a, 0, 1.0f, 0.25, 0.25)
              .clip(2, "c2", 1.5, 4.5, &b->a, 1000, 0.5f)
              .clip(3, "c3", 2.0, 1.0, &c->a, 0, 0.7f, 0.0, 0.5)
              .fertig());
  t.arr.loop(true, 0.0, 4.0, t.s, t.k);
  t.arr.metronom(true, -6.0f, 0);   // ohne das stünden ml, mr, cl, cr auf 0.0 und ihr Hash hinge nur an der Länge (Prüfung 2, MINOR 1)
  t.arr.start(0.0, 0, false, 0, 537, 256, t.k);
  t.lauf(60000);
  // Tausch: c1 kürzer, c2 unverändert (bindet neu), c3 weg
  t.laden(Bau(2).spur(1, ArrArt::audio).spur(2, ArrArt::audio)
              .clip(1, "c1", 0.0, 3.0, &a->a, 0, 1.0f, 0.25, 0.25)
              .clip(2, "c2", 1.5, 4.5, &b->a, 1000, 0.5f)
              .fertig());
  t.arr.metronom(true, -6.0f, 1);   // ab hier klickt es in den Cue: beide Paare (Master und Cue) bekommen Signal
  t.lauf(150000);
  t.arr.stopp(0, t.s, t.k);
  t.lauf(160000);
  Hashes h;
  h.lr = fnv(t.r, fnv(t.l, 1469598103934665603ULL));
  h.metro = fnv(t.cr, fnv(t.cl, fnv(t.mr, fnv(t.ml, 1469598103934665603ULL))));
  // Instrument-Check: ein Hash über Stille ist kein Hash. Jede der sechs Ausgangsfolgen muss Signal tragen (Spur-Summe, beide Metronom-Paare).
  PRUEF(hat_signal(t.l) && hat_signal(t.r));
  PRUEF(hat_signal(t.ml) && hat_signal(t.mr));
  PRUEF(hat_signal(t.cl) && hat_signal(t.cr));
  return h;
}

}  // namespace

int main(int argc, char** argv) {
  const std::string datei = std::string(CYPHERDJ_DJK) + "/kern/tests/daten/arr_warp_unveraendert.hash";
  const Hashes h = lauf_referenz();
  char lr[32], metro[32];
  std::snprintf(lr, sizeof lr, "%016llx", static_cast<unsigned long long>(h.lr));
  std::snprintf(metro, sizeof metro, "%016llx", static_cast<unsigned long long>(h.metro));
  std::printf("Hash L/R %s, Metronom %s\n", lr, metro);
  if (argc > 1 && std::strcmp(argv[1], "--schreibe") == 0) {
    if (pruef_fehler) {   // eine Folge ist still: so eine Referenz wird nicht aufgenommen
      std::fprintf(stderr, "Referenz nicht geschrieben: %d Pruefung(en) gescheitert\n", pruef_fehler);
      return 1;
    }
    std::ofstream(datei) << lr << "\n" << metro << "\n";
    std::printf("geschrieben: %s\n", datei.c_str());
    return 0;
  }
  std::ifstream f(datei);
  std::string soll_lr, soll_metro;
  f >> soll_lr >> soll_metro;
  PRUEF(!soll_lr.empty() && !soll_metro.empty());   // fehlt die Datei: einmal mit --schreibe auf dem Stand VOR der Änderung aufnehmen
  PRUEF(soll_lr == lr);
  PRUEF(soll_metro == metro);
  PRUEF_ENDE();
}
