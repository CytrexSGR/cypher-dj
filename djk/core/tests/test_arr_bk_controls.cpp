// Production plan task 8: the control rows spur/<slot>/bk/<k> (slot 1..8 = the running number among the tracks with the device bk in ascending track number, k 1..32) are a
// TRANSIENT override of the Baukasten knobs. A written row is reported to the bk sink in EVERY block (the sink clears its report flag per block) until the next playback build
// (Arrangement::tausche) clears it. The role is neither saved nor restored. The sink here is a recording stand-in: the real ArrBkSenke applies what it is told in every
// block_bahn() (arr_bk_sink.cpp), also while the transport stands, so what this test pins is what the Arrangement reports.
//   1 override audible while written: three blocks, each reports knob index 4 of the track on number 7 (slot 2) = 0.9, with the transport stopped; the track on number 3 is not touched;
//     the sink's block() runs while the transport stands (the knob is applied there)
//   2 a lane wins while the arrangement plays (the later report overwrites); after the transport stops the override alone is reported again
//   3 cleared by the next build with the same project value: no report from this path
//   4 cleared by the next build with another project value: nothing reported, the flag is down
//   5 slot mapping follows the snapshot: with the bk track on number 3 removed, the former slot 2 is slot 1; a row of slot 2 reaches nothing
//   6 a row of a slot whose track holds an RB-338 (not bk) does nothing
//   7 not persisted: the state of a core does not list the row, a state file that holds it does not set it (restart state and render take-over), a neighbour row is stored and restored
//   8 table: the 1024 rows exist and nothing around them; the reserve of the table stays 44 or more
//   9 verlauf(): the pointer form reports the last sample of the block
//  10 slot numbering pinned with the same example as the page (djk/ui/tests/project_commands_device_param.test.mjs): bk on the numbers 3, 7 and 9, an RB-338 on number 5: the slots are 1, 2, 3 in
//     ascending track number, counted by device name (a bk track without an instance counts, too); nr 9 is slot 3
//  11 ARR_BK_MAX = SPUR_BK_SLOTS = 16: sixteen bk tracks on the numbers 1..16; the table has no row spur/17/bk/1; a row of slot 16 reaches the 16th bk track only
//     and nothing reaches the 9th and 10th (bk_slot_ -1: they take the release path of the page)
#include <cmath>
#include <cstdio>
#include <cstring>
#include <memory>
#include <vector>

#include "arr_build.h"
#include "cypherdj/core.h"
#include "cypherdj/signalbox/insert_zahlen.h"
#include "cypherdj/state.h"
#include "check.h"

using namespace arrtest;
using cdj::ArrArt;
namespace iz = cypherdj::insert_zahlen;
// strand 2 slice 2: the knob rows plug/<h>/k<m> exist once per effect host (the signalbox library cannot see ARR_INS_HOST)
static_assert(cypherdj::stellwerk::REGLER_PLUG_HOSTS == cdj::ARR_INS_HOST, "plug/<h>/k<m> rows per effect host");

namespace {

struct RecSenke final : cdj::ArrSenke {
  struct Aufruf { int block; int spur; int param; float wert; };
  std::vector<Aufruf> calls;
  int cur = 0;           // block number, set before every block of the driver
  int block_aufrufe = 0;
  int64_t vorhalt() const noexcept override { return 0; }
  void note(int, int64_t, uint8_t, uint8_t, bool) noexcept override {}
  void alle_aus(int, int64_t) noexcept override {}
  void transport_start(int, int64_t) noexcept override {}
  void block(int, int64_t, int, float*, float*) noexcept override { ++block_aufrufe; }
  void auto_parameter(int spur, int param, float wert) noexcept override { calls.push_back({cur, spur, param, wert}); }
  // the value the sink would hold for (spur, param) after block `b`: the last report of that block, -1 when none
  float letzter(int b, int spur, int param) const {
    float w = -1.0f;
    for (const Aufruf& c : calls)
      if (c.block == b && c.spur == spur && c.param == param) w = c.wert;
    return w;
  }
  int n_in(int b) const {
    int n = 0;
    for (const Aufruf& c : calls) n += c.block == b ? 1 : 0;
    return n;
  }
};

// the instance is never dereferenced by the recording sink: any non-null pointer stands for it
CypherBk* attrappe() { static int x; return reinterpret_cast<CypherBk*>(&x); }

void mache_bk(cdj::ArrSnapshot* s, int nr, float k5) {
  cdj::ArrSpur& sp = s->spur[nr - 1];
  std::snprintf(sp.geraet, sizeof sp.geraet, "bk");
  std::snprintf(sp.graph, sizeof sp.graph, "t");
  sp.bk = attrappe();
  sp.bk_gen = 1;
  sp.n_param = 0;
  std::snprintf(sp.param[0].name, sizeof sp.param[0].name, "k5");
  sp.param[sp.n_param++].wert = k5;
}
void mache_rb(cdj::ArrSnapshot* s, int nr) {
  std::snprintf(s->spur[nr - 1].geraet, sizeof s->spur[nr - 1].geraet, "rb338");
}

// two bk tracks on the numbers 3 and 7 (slots 1 and 2), an RB-338 track on number 5; knob k5 = `k5` on both
cdj::ArrSnapshot* zwei_bk(float k5, bool mit_drei = true) {
  Bau b;
  b.spur(7, ArrArt::intern).spur(5, ArrArt::intern);
  if (mit_drei) b.spur(3, ArrArt::intern);
  cdj::ArrSnapshot* s = b.fertig();
  mache_bk(s, 7, k5);
  mache_rb(s, 5);
  if (mit_drei) mache_bk(s, 3, k5);
  return s;
}

struct Rig {
  Treiber t;
  RecSenke rec;
  Rig() {
    t.arr.setze_senke_intern(&rec);
    t.vor_block = [this](int64_t) { ++rec.cur; };
  }
  ~Rig() { t.arr.setze_senke_intern(nullptr); }
  int zeile(const char* pfad) { return t.tab.suche(pfad); }
  void blocks(int n) { t.lauf(t.s + static_cast<int64_t>(n) * t.n); }
};

}  // namespace

int main() {
  const int TRACK3 = 2, TRACK7 = 6;   // 0-based track indices of the numbers 3 and 7
  {  // 1: override audible in every block, with the transport stopped
    Rig g;
    g.t.laden(zwei_bk(0.25f));
    const int r = g.zeile("spur/2/bk/5");
    PRUEF(r >= 0);
    g.t.arr.setze_sofort(r, 0.9f);
    PRUEF(g.t.arr.bk_ueber_da(1, 4));
    const int b0 = g.rec.cur + 1;
    g.blocks(3);
    PRUEF(g.t.arr.status() == cdj::ArrStatus::steht);
    for (int b = b0; b < b0 + 3; ++b) PRUEF(std::fabs(g.rec.letzter(b, TRACK7, 4) - 0.9f) < 1e-6f);   // every block, not only the first
    for (const auto& c : g.rec.calls) PRUEF(c.spur != TRACK3);   // slot 1 untouched
    PRUEF(g.rec.block_aufrufe >= 3 * 2);   // the sink's block() runs while the transport stands (the knob is applied there): both bk tracks, every block
    PRUEF(g.t.arr.bk_ueber_da(1, 4));      // a block does not clear the flag (only a build does)
  }
  {  // 1b: 64-knob live override: k33 and k64 of slot 2 reach param 32 and 63 of the sink, slot 1 stays untouched
    Rig g;
    g.t.laden(zwei_bk(0.25f));
    const int r33 = g.zeile("spur/2/bk/33"), r64 = g.zeile("spur/2/bk/64");
    PRUEF(r33 >= 0 && r64 >= 0);
    g.t.arr.setze_sofort(r33, 0.7f);
    g.t.arr.setze_sofort(r64, 0.3f);
    PRUEF(g.t.arr.bk_ueber_da(1, 32) && g.t.arr.bk_ueber_da(1, 63));
    g.blocks(2);
    PRUEF(std::fabs(g.rec.letzter(g.rec.cur, TRACK7, 32) - 0.7f) < 1e-6f);
    PRUEF(std::fabs(g.rec.letzter(g.rec.cur, TRACK7, 63) - 0.3f) < 1e-6f);
    for (const auto& c : g.rec.calls) PRUEF(c.spur != TRACK3);
  }
  {  // 2: a lane wins while playing, the override returns after the stop
    Rig g;
    Bau b;
    b.spur(7, ArrArt::intern).spur(3, ArrArt::intern).lane(7, {{0.0, 0.1f, 0}, {64.0, 0.1f, 0}}, cdj::ARR_AUTO_GERAET, 4);
    cdj::ArrSnapshot* s = b.fertig();
    mache_bk(s, 7, 0.25f);
    mache_bk(s, 3, 0.25f);
    g.t.laden(s);
    g.t.arr.setze_sofort(g.zeile("spur/2/bk/5"), 0.9f);
    g.t.arr.start(0.0, 0, false, g.t.s, 0, 256, g.t.k);
    g.blocks(4);
    PRUEF(g.t.arr.status() == cdj::ArrStatus::spielt);
    PRUEF(std::fabs(g.rec.letzter(g.rec.cur, TRACK7, 4) - 0.1f) < 1e-6f);   // the lane report comes last
    bool ueber_gemeldet = false;   // the override was reported too, before the lane
    for (const auto& c : g.rec.calls) ueber_gemeldet = ueber_gemeldet || (c.block == g.rec.cur && c.spur == TRACK7 && c.param == 4 && std::fabs(c.wert - 0.9f) < 1e-6f);
    PRUEF(ueber_gemeldet);
    g.t.arr.stopp(0, g.t.s, g.t.k);
    g.blocks(3);
    PRUEF(g.t.arr.status() == cdj::ArrStatus::steht);
    PRUEF(std::fabs(g.rec.letzter(g.rec.cur, TRACK7, 4) - 0.9f) < 1e-6f);
  }
  {  // 3: next build, same project value: the row is gone, nothing is reported from this path
    Rig g;
    g.t.laden(zwei_bk(0.9f));
    g.t.arr.setze_sofort(g.zeile("spur/2/bk/5"), 0.9f);
    g.blocks(1);
    PRUEF(g.rec.n_in(g.rec.cur) > 0);
    g.t.laden(zwei_bk(0.9f));
    for (int slot = 0; slot < 8; ++slot)
      for (int k = 0; k < 64; ++k) PRUEF(!g.t.arr.bk_ueber_da(slot, k));
    g.blocks(2);
    PRUEF(g.rec.n_in(g.rec.cur) == 0 && g.rec.n_in(g.rec.cur - 1) == 0);
  }
  {  // 4: next build, another project value: nothing reported that could beat it
    Rig g;
    g.t.laden(zwei_bk(0.25f));
    g.t.arr.setze_sofort(g.zeile("spur/2/bk/5"), 0.9f);
    g.blocks(1);
    PRUEF(std::fabs(g.rec.letzter(g.rec.cur, TRACK7, 4) - 0.9f) < 1e-6f);
    g.t.laden(zwei_bk(0.3f));
    g.blocks(2);
    PRUEF(g.rec.letzter(g.rec.cur, TRACK7, 4) < 0.0f);   // the sink falls back to the snapshot value 0.3 (it reports itself), 0.9 is not reported any more
    PRUEF(!g.t.arr.bk_ueber_da(1, 4));
    g.t.arr.setze_sofort(g.zeile("spur/2/bk/5"), 0.8f);   // and a new write after the build works again
    g.blocks(1);
    PRUEF(std::fabs(g.rec.letzter(g.rec.cur, TRACK7, 4) - 0.8f) < 1e-6f);
  }
  {  // 5: the slot mapping follows the snapshot
    Rig g;
    g.t.laden(zwei_bk(0.25f));
    g.t.laden(zwei_bk(0.25f, false));   // the bk track on number 3 is gone: number 7 is slot 1 now
    g.t.arr.setze_sofort(g.zeile("spur/1/bk/5"), 0.7f);
    g.blocks(1);
    PRUEF(std::fabs(g.rec.letzter(g.rec.cur, TRACK7, 4) - 0.7f) < 1e-6f);
    const size_t n = g.rec.calls.size();
    g.t.arr.setze_sofort(g.zeile("spur/2/bk/5"), 0.6f);   // no slot 2 any more: reaches nothing, throws nothing
    g.blocks(1);
    for (size_t i = n; i < g.rec.calls.size(); ++i) PRUEF(std::fabs(g.rec.calls[i].wert - 0.6f) > 1e-6f);
  }
  {  // 6: the track of the slot is not a bk device
    Rig g;
    Bau b;
    b.spur(5, ArrArt::intern).spur(7, ArrArt::intern);
    cdj::ArrSnapshot* s = b.fertig();
    mache_rb(s, 5);
    mache_bk(s, 7, 0.25f);   // slot 1 is the bk track on number 7; the RB-338 on number 5 has no slot
    g.t.laden(s);
    g.t.arr.setze_sofort(g.zeile("spur/2/bk/5"), 0.9f);   // slot 2: nobody
    g.blocks(2);
    PRUEF(g.rec.calls.empty());
    g.t.arr.setze_sofort(g.zeile("spur/1/bk/5"), 0.9f);
    g.blocks(1);
    for (const auto& c : g.rec.calls) PRUEF(c.spur == TRACK7);   // never the RB-338 track (index 4)
    PRUEF(!g.rec.calls.empty());
  }
  {  // 7: not persisted
    struct Aufbau {
      std::unique_ptr<unsigned char[]> mem{new unsigned char[CDJ_RING_BYTES]()};
      cdj_ring_kopf* ring = reinterpret_cast<cdj_ring_kopf*>(mem.get());
      std::unique_ptr<cdj::Befehlsring> bef{new cdj::Befehlsring()};
      std::unique_ptr<cdj::Ereignisring> ere{new cdj::Ereignisring()};
      std::unique_ptr<cdj::Kern> kern;
      Aufbau() {
        std::memcpy(ring->magic, "CDJB", 4);
        kern.reset(new cdj::Kern(128.0, ring, bef.get(), ere.get()));
      }
    };
    Aufbau a;
    PRUEF(a.kern->regler_setzen("spur/1/bk/5", 0.9f));   // the project write path accepts the row
    PRUEF(a.kern->regler_setzen("master/bk/3", 0.9f));   // positive control: a stored row
    PRUEF(a.kern->arrangement().bk_ueber_da(0, 4));
    auto f = std::make_unique<cdj_z_echtzeit>();
    std::memset(f.get(), 0, sizeof *f);
    a.kern->abbild(*f);
    bool bk_da = false, master_da = false;
    for (int i = 0; i < f->n_regler; ++i) {
      bk_da = bk_da || !std::strcmp(f->regler[i].pfad, "spur/1/bk/5");
      master_da = master_da || !std::strcmp(f->regler[i].pfad, "master/bk/3");
    }
    PRUEF(master_da);
    PRUEF(!bk_da);
    // a state file that does hold the row (built by hand): neither restore path sets it, the neighbour is restored
    PRUEF(f->n_regler < CDJ_Z_REGLER);
    cdj_z_regler& z = f->regler[f->n_regler++];
    std::memset(&z, 0, sizeof z);
    std::snprintf(z.pfad, sizeof z.pfad, "spur/1/bk/5");
    std::snprintf(z.halter, sizeof z.halter, "frei");
    z.wert = 0.9f;
    const int r = a.kern->stellwerk().tabelle().suche("spur/1/bk/5");
    PRUEF(r >= 0);
    Aufbau b;
    PRUEF(b.kern->wiederherstellen(*f));
    PRUEF(!b.kern->arrangement().bk_ueber_da(0, 4));
    PRUEF(b.kern->stellwerk().wert(r) == b.kern->stellwerk().tabelle().def(r).vorgabe);
    PRUEF(b.kern->stellwerk().wert(b.kern->stellwerk().tabelle().suche("master/bk/3")) == 0.9f);
    Aufbau c;
    PRUEF(c.kern->regler_uebernehmen(*f) >= 1);   // the render take-over
    PRUEF(!c.kern->arrangement().bk_ueber_da(0, 4));
    PRUEF(c.kern->stellwerk().wert(r) == c.kern->stellwerk().tabelle().def(r).vorgabe);
  }
  {  // 8: the table
    const auto tab = std::make_unique<cypherdj::stellwerk::ReglerTabelle>();   // 24576 rows: heap, not stack
    PRUEF(tab->suche("spur/1/bk/1") >= 0 && tab->suche("spur/16/bk/64") >= 0 && tab->suche("spur/16/bk/33") >= 0 && tab->suche("spur/9/bk/1") >= 0 && tab->suche("spur/5/bk/17") >= 0);
    for (const char* p : {"spur/17/bk/1", "spur/1/bk/65", "spur/1/bk/0", "spur/0/bk/1", "spur/1/bk/01", "spur/32/bk/1", "spur/1/bk/", "spur/1/bk/100"})
      PRUEF(tab->suche(p) < 0);
    const int r = tab->suche("spur/2/bk/5");
    PRUEF(tab->def(r).rolle == cypherdj::stellwerk::Rolle::spur_bk && tab->def(r).min == 0.0f && tab->def(r).max == 1.0f && tab->def(r).vorgabe == 0.5f);
    // Table size = the 3958 rows outside the insert block (a pin: it moves only when a row outside the inserts is added) + the insert block
    // from docs/interfaces/insert_module.json (iz::ZEILEN_GESAMT, generated: no row count of an insert stage is typed here) + the trailing track and plug rows.
    PRUEF(tab->anzahl() == 3958 + iz::ZEILEN_GESAMT +
          (cypherdj::stellwerk::SPUR_REGLER_SPUREN - cypherdj::stellwerk::SPUR_REGLER_SPUREN_ALT) * 24 +
          cypherdj::stellwerk::REGLER_PLUG_HOSTS * cypherdj::stellwerk::REGLER_PLUG_KNOEPFE);
    PRUEF(cypherdj::stellwerk::MAX_REGLER - tab->anzahl() >= 44);   // reserve
    PRUEF(tab->suche("spur/1/bk/1") == 1290 + iz::ZEILEN_GESAMT);   // the row sits behind the insert block (1290 rows outside it come before); slot-major
  }
  {  // 9: the pointer form takes the last sample of the block
    Rig g;
    g.t.laden(zwei_bk(0.25f));
    std::vector<float> werte(256, 0.1f);
    werte[255] = 0.65f;
    g.t.arr.verlauf(g.zeile("spur/2/bk/5"), werte.data());
    g.blocks(1);
    PRUEF(std::fabs(g.rec.letzter(g.rec.cur, TRACK7, 4) - 0.65f) < 1e-6f);
    g.blocks(1);   // the pointer is not read again; the value stays written
    PRUEF(std::fabs(g.rec.letzter(g.rec.cur, TRACK7, 4) - 0.65f) < 1e-6f);
  }
  {  // 10: the shared example of core and page
    Rig g;
    Bau b;
    b.spur(9, ArrArt::intern).spur(7, ArrArt::intern).spur(5, ArrArt::intern).spur(3, ArrArt::intern);
    cdj::ArrSnapshot* s = b.fertig();
    mache_bk(s, 3, 0.25f);
    mache_rb(s, 5);
    mache_bk(s, 7, 0.25f);
    mache_bk(s, 9, 0.25f);
    s->spur[6].bk = nullptr;   // the bk track on number 7 has no instance (graph file missing): it still holds slot 2, the track on number 9 stays slot 3
    g.t.laden(s);
    g.t.arr.setze_sofort(g.zeile("spur/3/bk/5"), 0.4f);
    g.t.arr.setze_sofort(g.zeile("spur/2/bk/5"), 0.5f);   // slot 2 is the track without an instance: nothing to override
    g.blocks(1);
    PRUEF(g.rec.calls.size() == 1 && g.rec.calls[0].spur == 8 && g.rec.calls[0].param == 4 && std::fabs(g.rec.calls[0].wert - 0.4f) < 1e-6f);
  }
  {  // 11: sixteen bk tracks, sixteen slots
    Rig g;
    Bau b;
    for (int nr = 1; nr <= cdj::ARR_BK_MAX; ++nr) b.spur(nr, ArrArt::intern);
    cdj::ArrSnapshot* s = b.fertig();
    for (int nr = 1; nr <= cdj::ARR_BK_MAX; ++nr) mache_bk(s, nr, 0.25f);
    g.t.laden(s);
    PRUEF(g.zeile("spur/17/bk/1") == -1);
    PRUEF(g.zeile("spur/16/bk/64") >= 0 && g.zeile("spur/16/bk/1") >= 0 && g.zeile("spur/9/bk/1") >= 0);
    g.t.arr.setze_sofort(g.zeile("spur/16/bk/5"), 0.9f);
    const int b0 = g.rec.cur + 1;
    g.blocks(3);
    for (int b = b0; b < b0 + 3; ++b) {
      PRUEF(std::fabs(g.rec.letzter(b, 15, 4) - 0.9f) < 1e-6f);   // the 16th bk track (index 15), every block
      PRUEF(g.rec.n_in(b) == 1);                                   // and nothing else
    }
    for (const auto& c : g.rec.calls) PRUEF(c.spur == 15);
    g.t.arr.setze_sofort(g.zeile("spur/9/bk/5"), 0.6f);   // slot 9 reaches the 9th bk track only (index 8)
    g.blocks(1);
    PRUEF(std::fabs(g.rec.letzter(g.rec.cur, 8, 4) - 0.6f) < 1e-6f);
    for (const auto& c : g.rec.calls) PRUEF(c.spur == 15 || c.spur == 8);
  }
  PRUEF_ENDE();
}
