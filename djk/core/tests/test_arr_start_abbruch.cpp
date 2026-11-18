// audit U33: stopping a transport start that is still waiting must cancel the pending start in the RB, BK and Kit sinks.
// transport_start() hands the start sample to every sink; the stop in the waiting state (Arrangement::stopp) used to leave it there, so a
// live note played afterwards was faded out one block before the abandoned start sample and cut (reset + all notes off) at it, although
// the transport was standing. Per sink: start with quant 2 (the start waits for the next bar), stop before the entry, hold a live note,
// run past the abandoned start sample: the note must sound as loud right after that sample as right before it.
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <memory>
#include <string>
#include <vector>

#include "arr_build.h"
#include "bk_help.h"
#include "cypherdj/arr_bk_sink.h"
#include "cypherdj/arr_kit_sink.h"
#include "cypherdj/arr_rb_sink.h"
#include "cypherdj/kit.h"
#include "check.h"

using namespace arrtest;
using cdj::ArrArt;

namespace {

struct Mass {
  double vor = 0.0, nach = 0.0;   // mean |l| in [S - 2048, S - 512) and [S + 512, S + 2048)
  int64_t S = -1;
};

Mass messen(const Treiber& t, int64_t S) {
  Mass m;
  m.S = S;
  for (int64_t i = S - 2048; i < S - 512; ++i) m.vor += std::fabs(t.l[static_cast<size_t>(i)]) / 1536.0;
  for (int64_t i = S + 512; i < S + 2048; ++i) m.nach += std::fabs(t.l[static_cast<size_t>(i)]) / 1536.0;
  return m;
}

// start waiting (quant 2), stop, one held live note, run past the abandoned entry
Mass abbruch_lauf(Treiber& t, int ton) {
  t.lauf(4 * 256);
  t.arr.start(0.0, 2, false, t.s, 537, 256, t.k);
  const int64_t S = t.arr.einsatz_sample();
  PRUEF(S > 20000);   // a bar away: the stop comes well before the entry
  t.lauf(t.s + 3 * 256);
  t.arr.stopp(0, t.s, t.k);
  t.lauf(t.s + 256);
  t.arr.live_note(0, t.s + 100, static_cast<uint8_t>(ton), 100, true);
  t.lauf(S + 4096);
  return messen(t, S);
}

void pruefe(const char* was, const Mass& m) {
  std::printf("start abbruch %s: S %lld, mean |l| before %.5f, after %.5f\n", was, static_cast<long long>(m.S), m.vor, m.nach);
  PRUEF(m.vor > 0.001);    // the held live note sounds (control: the measurement is not on silence)
  PRUEF(m.nach > 0.5 * m.vor);   // and it is not cut at the abandoned entry
}

std::unique_ptr<cdj::Kit> dc_kit(const char* name, int noten, int64_t frames, float einheit) {
  auto k = std::make_unique<cdj::Kit>();
  k->name = name;
  k->n = noten;
  for (int i = 0; i < noten; ++i) {
    k->klang[i].name = "dc:" + std::to_string(i);
    k->klang[i].frames = frames;
    k->klang[i].daten.assign(static_cast<size_t>(frames) * 2, static_cast<float>(i + 1) * einheit);
  }
  return k;
}

}  // namespace

int main() {
  {  // RB-338
    Treiber t;
    cdj::ArrRbSenke rb(t.arr);
    t.arr.setze_senke_intern(&rb);
    t.laden(Bau(1).spur(1, ArrArt::intern).fertig());
    pruefe("rb", abbruch_lauf(t, 40));
  }
  {  // Baukasten graph
    Treiber t;
    CypherBk* h = bkt::neu(bkt::beispiel("juno-pad"));
    cdj::ArrBkSenke bk(t.arr);
    t.arr.setze_senke_intern(&bk);
    cdj::ArrSnapshot* s = Bau(1).spur(1, ArrArt::intern).fertig();
    bkt::spur(s, 1, h, 1, {{"k1", 0.4f}});
    t.laden(s);
    pruefe("bk", abbruch_lauf(t, 50));
    cypher_bk_frei(h);   // the sink must not run again after this point
  }
  {  // Kit: a long DC sound, a cut shows as a drop to exact zero
    auto dc = dc_kit("dc", 8, 400000, 1.0f / 32.0f);
    Treiber t;
    cdj::ArrKitSenke se(t.arr);
    t.arr.setze_senke_intern(&se);
    cdj::ArrSnapshot* s = Bau(1).spur(1, ArrArt::intern).fertig();
    cdj::ArrSpur& sp = s->spur[0];
    std::snprintf(sp.geraet, sizeof sp.geraet, "kit");
    std::snprintf(sp.kit, sizeof sp.kit, "%s", dc->name.c_str());
    sp.kit_ptr = dc.get();
    sp.kit_gen = 1;
    t.laden(s);
    pruefe("kit", abbruch_lauf(t, 3));
  }
  PRUEF_ENDE();
}
