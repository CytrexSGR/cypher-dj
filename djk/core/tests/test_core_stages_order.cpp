// Container core K8 (review follow-up I1): the stage order of Kern::audio. Stage 1 (quellen_block, the source buffers) must run
// before stage 2 (arr_->block, which reads them), and stage 2 before the mixer. An impulse of stream 5 plays through a stream
// track of a group on DJ output 3 (container C, art module) and must reach the master within the same cycle plus the fixed
// latency of the limiter look-ahead; when quellen_block runs behind arr_->block the track reads the previous block and the
// impulse arrives one block (256 samples) later. Mutation (CMakeLists.txt): CYPHERDJ_MUTATION_QUELLEN_NACH_ARR.
#include <cmath>
#include <cstdio>
#include <string>

#include "arr_run.h"
#include "check.h"

bool g_waechter = false;

using k35::N;

int main() {
  k35::Arbeitsbestand ab("test_kern_stufen_reihenfolge");
  arr35::Lauf x(ab.pfad, "test_kern_stufen_reihenfolge");
  const int64_t T0 = 20 * N + 100;   // not on a block boundary
  x.erz_quelle[4] = [T0](int64_t t) { return t == T0 ? 1.0f : 0.0f; };
  x.teil("pad/1/fader", 0.0f, 0.0, 0.0, "andreas");
  cdj::Befehl q = x.neu(cdj::Befehl::CONTAINER_QUELLE, "andreas");
  q.nr = 3;
  q.an = cdj::Kern::CONTAINER_ART_MODUL;
  x.sende(q);
  const std::string file =
      "{\"format\":\"cypherdj-arr/4\",\"nr\":1,\"spuren\":[{\"nr\":1,\"art\":\"intern\",\"quelle\":{\"art\":\"strom\",\"strom\":5},\"ausgang\":{\"art\":\"gruppe\",\"nr\":1}}],\"live\":true,"
      "\"gruppen\":[{\"nr\":1,\"ausgang\":{\"art\":\"dj\",\"nr\":3}}]}";
  x.ordner.roh(1, file);
  cdj::ArrLadeErgebnis le = cdj::lade_wiedergabe(x.ordner.pfad, 1, x.cache);
  PRUEF(le.snap != nullptr);
  if (le.snap) {
    cdj::Befehl b = x.neu(cdj::Befehl::ARR_LADEN, "andreas");
    b.zeiger = le.snap.release();
    b.arr_nr = 1;
    x.sende(b);
  }
  x.start(0.0, 0);
  x.lauf(T0 + 4 * N);
  int64_t erst = -1;
  double spitze = 0.0;
  for (int64_t i = 0; i < static_cast<int64_t>(x.l.size()); ++i) {
    const double v = std::fabs(static_cast<double>(x.l[static_cast<size_t>(i)]));
    spitze = std::max(spitze, v);
    if (erst < 0 && v > 1e-6) erst = i;
  }
  std::printf("stufen: impulse at %lld, first master sample at %lld (delay %lld), peak %.4f\n", static_cast<long long>(T0), static_cast<long long>(erst), static_cast<long long>(erst - T0), spitze);
  PRUEF(spitze > 0.01);
  PRUEF(erst >= T0);
  PRUEF(erst - T0 < N);   // same cycle plus the limiter look-ahead: not a block later
  PRUEF_ENDE();
}
