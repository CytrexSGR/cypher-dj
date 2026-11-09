// Baukasten S20 (task 4): a project track with device bk plays in the kern through the loader path, without any further action. The
// playback (nr 1) holds track 2 on the RB-338 and track 3 on a Baukasten graph (saw x gate x k1); the graph is read from a folder by the
// loader (ArrAudioCache::bk_hole), the kern's sink plays it:
//   1 the master is silent before the note and sounds from the note target plus the limiter lead; /pegel spur/3 reports it, and the
//     RB track 2 sounds beside it
//   2 the knob of the playback arrives: k1 0.8 against 0.1 differ in level by about the ratio of the knobs
//   3 negative control: the same playback without a start stays silent
// Mutation: ARR_OHNE_RB_SENKE (the kern does not attach the internal sink at all) turns case 1 red.
#include <cmath>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <string>

#include "arr_run.h"
#include "bk_help.h"

bool g_waechter = false;

using k35::N;
using k35::SPB;

namespace {

struct Ergebnis {
  int64_t note = -1;
  int64_t erster = -1;
  double energie = 0.0;      // master left from the note on, a quarter note
  float pegel_bk = -200.0f;  // spur/3
  float pegel_rb = -200.0f;  // spur/2
  int eintraege = -1;
};

Ergebnis lauf(const std::string& ab, const char* k1, bool starten = true) {
  Ergebnis e;
  arr35::Lauf x(ab, "test_kern_arr_bk");
  const std::string bk = x.ordner.pfad + "/bk";
  std::filesystem::create_directories(bk);
  std::ofstream(bk + "/t.json") << bkt::G_T;
  x.cache.setze_bk_ordner(bk);
  x.cache.setze_bk_leser(x.kern->arr_bk_leser());
  const std::string rb = "{\"nr\":2,\"art\":\"intern\",\"geraet\":\"rb338\",\"parameter\":{\"cutoff\":0.3},\"noten\":[{\"id\":\"c2/n1\",\"beat\":0.5,\"laenge\":0.5,\"ton\":36,\"vel\":100}]}";
  const std::string bks = std::string("{\"nr\":3,\"art\":\"intern\",\"geraet\":\"bk\",\"graph\":\"t\",\"parameter\":{\"k1\":") + k1 +
                          "},\"noten\":[{\"id\":\"c3/n1\",\"beat\":0.5,\"laenge\":0.5,\"ton\":57,\"vel\":100}]}";
  x.laden(1, rb + "," + bks);
  x.lauf(4 * N);
  const int64_t st = starten ? x.start(0.0, 0) : -1;
  x.lauf(4 * N + 2 * SPB);
  if (starten) {
    const k35::Q* q2 = x.quittung(st, 2);
    PRUEF(q2 != nullptr);
    if (q2) e.note = q2->sample + SPB / 2;
  }
  e.erster = arr35::Lauf::erster(x.l, 0, static_cast<int64_t>(x.l.size()));
  if (e.note >= 0)
    for (int64_t i = e.note + x.vh; i < e.note + x.vh + SPB / 4; ++i) e.energie += static_cast<double>(x.l[i]) * x.l[i];
  for (const cdj::Ereignis& p : x.alle(cdj::Ereignis::PEGEL, "spur/3")) e.pegel_bk = std::max(e.pegel_bk, p.pegel[0]);
  for (const cdj::Ereignis& p : x.alle(cdj::Ereignis::PEGEL, "spur/2")) e.pegel_rb = std::max(e.pegel_rb, p.pegel[0]);
  e.eintraege = x.cache.bk_eintraege();
  return e;
}

}  // namespace

int main() {
  k35::Arbeitsbestand ab("test_kern_arr_bk");
  const Ergebnis a = lauf(ab.pfad, "0.8"), b = lauf(ab.pfad, "0.1"), c = lauf(ab.pfad, "0.8", false);
  std::printf("bk: note %lld, first master value %lld, energy %.4f (k1 0.8) / %.4f (k1 0.1), level spur/3 %.1f dB, spur/2 %.1f dB, graphs in the store %d\n",
              (long long)a.note, (long long)a.erster, a.energie, b.energie, a.pegel_bk, a.pegel_rb, a.eintraege);
  PRUEF(a.eintraege == 1);                                   // the loader built the graph once
  PRUEF(a.note > 0 && a.erster > 0 && a.erster < a.note + 4096);
  PRUEF(a.energie > 1e-3);
  PRUEF(a.pegel_bk > -60.0f);                                // /pegel spur/3 reports the Baukasten track
  PRUEF(a.pegel_rb > -60.0f);                                // the RB-338 track beside it still sounds
  PRUEF(b.energie > 0.0 && a.energie > 4.0 * b.energie);     // the knob of the playback arrives (0.8 against 0.1 is far more than 2x in amplitude)
  PRUEF(c.erster == -1 && c.pegel_bk == -200.0f);            // without a start no sound
  PRUEF_ENDE();
}
