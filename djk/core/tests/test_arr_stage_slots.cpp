// Package 1.9 U6 (T6.1): member slots in the internal sinks. The RB-338, Baukasten and kit sinks size their per-slot arrays with
// ARR_SENKEN_PLAETZE (32 tracks + 32 member slots) and read the device of a slot through ArrSnapshot::platz().
//   a kit: slot 40 plays the same sound with the same notes as slot 0, bit for bit
//   b rb338: the same with parameters and note offs
//   c bk: the same with a second instance of the same graph
//   d negative controls: a member slot without a device stays exactly silent; slot 64 (past the last) is refused without a crash and without a
//     sound; slot 0 is unchanged by the traffic on slot 40 (its output equals the run without it)
//   e memory: the sizes are printed (not asserted; before the change at 32 slots: sizeof ArrSpur 360, ArrSnapshot 11840, ArrRbSenke 148792,
//     ArrBkSenke 141616, ArrKitSenke 202800; resident growth rb 524 KiB, bk 140 KiB, kit 200 KiB, measured by a throwaway program, ledger)
// Mutation: ARR_PLAETZE_NUR_SPUREN (the sinks are sized to 32 slots: a member slot is refused, a, b, c red).
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
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

constexpr int MEMBER = cdj::ARR_SPUREN + 8;   // slot 40
constexpr int BLOCK = 256;

struct Spuren {
  std::vector<float> l0, r0, l1, r1;
};

// the sink plays the same events on slot a and slot b (both in the same block loop) and records the two outputs
template <class Senke, class Ereignisse>
Spuren fahre(Senke& se, int a, int b, int bloecke, Ereignisse ev) {
  Spuren o;
  for (int k = 0; k < bloecke; ++k) {
    const int64_t s0 = static_cast<int64_t>(k) * BLOCK;
    ev(se, a, s0);
    ev(se, b, s0);
    std::vector<float> l0(BLOCK, 0.0f), r0(BLOCK, 0.0f), l1(BLOCK, 0.0f), r1(BLOCK, 0.0f);
    se.block(a, s0, BLOCK, l0.data(), r0.data());
    se.block(b, s0, BLOCK, l1.data(), r1.data());
    o.l0.insert(o.l0.end(), l0.begin(), l0.end());
    o.r0.insert(o.r0.end(), r0.begin(), r0.end());
    o.l1.insert(o.l1.end(), l1.begin(), l1.end());
    o.r1.insert(o.r1.end(), r1.begin(), r1.end());
  }
  return o;
}

bool gleich(const std::vector<float>& x, const std::vector<float>& y) {
  return x.size() == y.size() && std::memcmp(x.data(), y.data(), x.size() * sizeof(float)) == 0;
}
bool alles_null(const std::vector<float>& x) {
  for (float v : x)
    if (v != 0.0f) return false;
  return true;
}
double energie(const std::vector<float>& x) {
  double e = 0.0;
  for (float v : x) e += static_cast<double>(v) * v;
  return e;
}

std::unique_ptr<cdj::Kit> dc_kit(int noten, int64_t frames) {
  auto k = std::make_unique<cdj::Kit>();
  k->name = "dc";
  k->n = noten;
  for (int i = 0; i < noten; ++i) {
    k->klang[i].name = "dc:" + std::to_string(i);
    k->klang[i].frames = frames;
    k->klang[i].daten.assign(static_cast<size_t>(frames) * 2, 0.1f * static_cast<float>(i + 1));
  }
  return k;
}

}  // namespace

int main() {
  {  // a: kit
    auto kit = dc_kit(8, 3000);
    Treiber t;
    cdj::ArrKitSenke se(t.arr);
    cdj::ArrSnapshot* s = Bau().spur(1, ArrArt::intern).fertig();
    cdj::ArrSpur& sp = s->spur[0];
    std::snprintf(sp.geraet, sizeof sp.geraet, "kit");
    std::snprintf(sp.kit, sizeof sp.kit, "dc");
    sp.kit_ptr = kit.get();
    sp.kit_gen = 1;
    s->glied_spur[MEMBER - cdj::ARR_SPUREN] = sp;   // the member slot carries the same device
    t.laden(s);
    auto ev = [](cdj::ArrKitSenke& k, int slot, int64_t s0) {
      if (s0 == 0) k.note(slot, 100, 3, 127, true);
      if (s0 == 512) k.note(slot, 600, 5, 64, true);
      if (s0 == 768) k.note(slot, 1000, 3, 100, true);
    };
    Spuren o = fahre(se, 0, MEMBER, 24, ev);
    PRUEF(energie(o.l0) > 0.0);
    PRUEF(gleich(o.l0, o.l1) && gleich(o.r0, o.r1));
    PRUEF(se.spielend() == 2);
  }
  {  // b: rb338 with parameters and a note off
    Treiber t;
    cdj::ArrRbSenke se(t.arr);
    PRUEF(se.bereit());
    cdj::ArrSnapshot* s = Bau().spur(1, ArrArt::intern).fertig();
    cdj::ArrSpur& sp = s->spur[0];
    std::snprintf(sp.geraet, sizeof sp.geraet, "rb338");
    std::snprintf(sp.param[0].name, sizeof sp.param[0].name, "cutoff");
    sp.param[0].wert = 0.4f;
    sp.n_param = 1;
    s->glied_spur[MEMBER - cdj::ARR_SPUREN] = sp;
    t.laden(s);
    auto ev = [](cdj::ArrRbSenke& r, int slot, int64_t s0) {
      if (s0 == 0) r.note(slot, 64, 40, 127, true);
      if (s0 == 1024) r.note(slot, 1100, 40, 0, false);
      if (s0 == 1536) r.note(slot, 1600, 47, 110, true);
    };
    Spuren o = fahre(se, 0, MEMBER, 24, ev);
    PRUEF(energie(o.l0) > 0.0);
    PRUEF(gleich(o.l0, o.l1) && gleich(o.r0, o.r1));
    PRUEF(se.verloren() == 0 && se.parameter_abgelehnt() == 0);
  }
  {  // c: bk with two instances of the same graph
    CypherBk* h0 = bkt::neu(bkt::G_T);
    CypherBk* h1 = bkt::neu(bkt::G_T);
    PRUEF(h0 && h1);
    if (h0 && h1) {
      Treiber t;
      cdj::ArrBkSenke se(t.arr);
      cdj::ArrSnapshot* s = Bau().spur(1, ArrArt::intern).fertig();
      bkt::spur(s, 1, h0, 1, {{"k1", 0.7f}});
      cdj::ArrSpur& m = s->glied_spur[MEMBER - cdj::ARR_SPUREN];
      m = s->spur[0];
      m.bk = h1;
      m.bk_gen = 2;
      t.laden(s);
      auto ev = [](cdj::ArrBkSenke& b, int slot, int64_t s0) {
        if (s0 == 0) b.note(slot, 64, 45, 127, true);
        if (s0 == 1024) b.note(slot, 1100, 45, 0, false);
        if (s0 == 1536) b.note(slot, 1600, 52, 110, true);
      };
      Spuren o = fahre(se, 0, MEMBER, 24, ev);
      PRUEF(energie(o.l0) > 0.0);
      PRUEF(gleich(o.l0, o.l1) && gleich(o.r0, o.r1));
      PRUEF(se.spielend() == 2);
    }
    if (h0) cypher_bk_frei(h0);
    if (h1) cypher_bk_frei(h1);
  }
  {  // d: negative controls on the kit sink (the cheapest)
    auto kit = dc_kit(8, 3000);
    Treiber t;
    cdj::ArrKitSenke se(t.arr);
    cdj::ArrSnapshot* s = Bau().spur(1, ArrArt::intern).fertig();
    cdj::ArrSpur& sp = s->spur[0];
    std::snprintf(sp.geraet, sizeof sp.geraet, "kit");
    std::snprintf(sp.kit, sizeof sp.kit, "dc");
    sp.kit_ptr = kit.get();
    sp.kit_gen = 1;
    s->glied_spur[MEMBER - cdj::ARR_SPUREN] = sp;   // slot 40 has a device, slot 41 has none
    t.laden(s);
    // slot 41 (a member slot without a device) and slot 64 (past the last slot) get a note and stay silent
    std::vector<float> l(BLOCK, 0.0f), r(BLOCK, 0.0f), l2(BLOCK, 0.0f), r2(BLOCK, 0.0f);
    se.note(MEMBER + 1, 10, 3, 127, true);
    se.note(cdj::ARR_SENKEN_PLAETZE, 10, 3, 127, true);
    se.block(MEMBER + 1, 0, BLOCK, l.data(), r.data());
    se.block(cdj::ARR_SENKEN_PLAETZE, 0, BLOCK, l2.data(), r2.data());
    PRUEF(alles_null(l) && alles_null(r) && alles_null(l2) && alles_null(r2));
    // slot 0 alone equals slot 0 with traffic on slot 40
    auto ev = [](cdj::ArrKitSenke& k, int slot, int64_t s0) {
      if (s0 == 0) k.note(slot, 100, 3, 127, true);
    };
    Treiber t2;
    cdj::ArrKitSenke se2(t2.arr);
    cdj::ArrSnapshot* s2 = Bau().spur(1, ArrArt::intern).fertig();
    s2->spur[0] = s->spur[0];
    t2.laden(s2);
    Spuren allein;
    for (int k = 0; k < 8; ++k) {   // slot 0 only
      const int64_t s0 = static_cast<int64_t>(k) * BLOCK;
      ev(se2, 0, s0);
      std::vector<float> bl(BLOCK, 0.0f), br(BLOCK, 0.0f);
      se2.block(0, s0, BLOCK, bl.data(), br.data());
      allein.l0.insert(allein.l0.end(), bl.begin(), bl.end());
      allein.r0.insert(allein.r0.end(), br.begin(), br.end());
    }
    Treiber t3;
    cdj::ArrKitSenke se3(t3.arr);
    cdj::ArrSnapshot* s3 = Bau().spur(1, ArrArt::intern).fertig();
    s3->spur[0] = s->spur[0];
    s3->glied_spur[MEMBER - cdj::ARR_SPUREN] = s->glied_spur[MEMBER - cdj::ARR_SPUREN];
    t3.laden(s3);
    Spuren mit = fahre(se3, 0, MEMBER, 8, [&](cdj::ArrKitSenke& k, int slot, int64_t s0) { ev(k, slot, s0); });
    PRUEF(energie(allein.l0) > 0.0 && gleich(allein.l0, mit.l0) && gleich(allein.r0, mit.r0));
  }
  std::printf("memory (%d slots): sizeof ArrSpur %zu ArrSnapshot %zu ArrRbSenke %zu ArrBkSenke %zu ArrKitSenke %zu\n", cdj::ARR_SENKEN_PLAETZE,
              sizeof(cdj::ArrSpur), sizeof(cdj::ArrSnapshot), sizeof(cdj::ArrRbSenke), sizeof(cdj::ArrBkSenke), sizeof(cdj::ArrKitSenke));
  PRUEF_ENDE();
}
