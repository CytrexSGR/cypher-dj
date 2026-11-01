// Baukasten S20 (task 4): the dispatcher of the internal tracks (arr_intern_senke.h) with the real RB-338 sink and the bk sink.
//   1 dispatch by device: track 1 plays on the RB-338 (geraet "rb338"), track 2 on a Baukasten graph (geraet "bk"); each output is
//     bit-identical to the same track alone on its own sink (the dispatcher adds nothing and takes nothing).
//   2 rb338 -> bk on one slot (a swap that only changes the device): the RB tail fades out over one block (the old output times
//     (m-1-i)/m), the bk track plays its notes; the RB sink rests afterwards (ruhend).
//   3 bk -> rb338 on one slot: the bk tail fades the same way, the RB track plays.
//   4 a bk track after an rb338 -> leer -> bk double swap in one cycle: the RB fades out and the bk plays (the "returned" branch of the
//     RB sink must not take a bk track for a return).
//   5 a geraet.cutoff lane on an rb338 track reaches the RB sink through the dispatcher (auto_parameter forwarded: values reported > 0, none rejected);
//     found by the cost layout arr32cut after the rebase: the dispatcher dropped every device lane value.
// Mutations: ARR_INTERN_OHNE_WECHSEL (2, 3: the old sink gets no fade block, its tail ends with a step), ARR_RB_BK_ALS_RUECKKEHR (4), ARR_INTERN_OHNE_AUTO (5).
#include <cmath>
#include <cstdio>
#include <vector>

#include "arr_bau.h"
#include "bk_hilfe.h"
#include "cypherdj/arr_bk_senke.h"
#include "cypherdj/arr_intern_senke.h"
#include "cypherdj/arr_rb_senke.h"
#include "pruef.h"

using namespace arrtest;
using cdj::ArrArt;

namespace {

double energie(const std::vector<float>& l, int64_t von, int64_t bis) {
  double e = 0.0;
  for (int64_t i = von; i < bis && i < static_cast<int64_t>(l.size()); ++i) e += static_cast<double>(l[i]) * l[i];
  return e;
}

void rb_param(cdj::ArrSnapshot* s, int nr, const char* name, float wert) {
  cdj::ArrSpur& sp = s->spur[nr - 1];
  std::snprintf(sp.param[sp.n_param].name, sizeof sp.param[0].name, "%s", name);
  sp.param[sp.n_param++].wert = wert;
}

// the track as rb338 (geraet "rb338") or as bk (instance h)
void geraet_rb(cdj::ArrSnapshot* s, int nr) {
  std::snprintf(s->spur[nr - 1].geraet, sizeof s->spur[0].geraet, "rb338");
  rb_param(s, nr, "cutoff", 0.4f);
}

struct Sinken {
  cdj::ArrRbSenke rb;
  cdj::ArrBkSenke bk;
  cdj::ArrInternSenke intern;
  explicit Sinken(cdj::Arrangement& a) : rb(a), bk(a), intern(a, &rb, &bk) { a.setze_senke_intern(&intern); }
};

// Case 1: the two tracks together through the dispatcher, each alone on its own sink
std::vector<float> fall1(int welche, CypherBk* h) {   // 1 track 1 (rb) 2 track 2 (bk) 3 both
  Treiber t;
  Sinken sk(t.arr);
  Bau b;
  if (welche & 1) b.spur(1, ArrArt::intern).note(1, "a/n1", 0.0, 1.0, 40, 127).note(1, "a/n2", 1.5, 0.5, 47, 110);
  if (welche & 2) b.spur(2, ArrArt::intern).note(2, "b/n1", 0.25, 1.0, 57, 127).note(2, "b/n2", 1.75, 0.5, 64, 100);
  cdj::ArrSnapshot* s = b.fertig();
  if (welche & 1) geraet_rb(s, 1);
  if (welche & 2) bkt::spur(s, 2, h, 1, {{"k1", 0.7f}});
  t.laden(s);
  t.arr.start(0.0, 0, false, t.s, 537, 256, t.k);
  t.lauf(3 * SPB);
  return t.l;
}

// Cases 2 to 4: a held note on track 1; at the swap block T the device changes. von: 0 rb338, 1 bk; art 0 no swap, 1 the other device,
// 2 empty and then the other device in the same cycle
struct Fall2 {
  std::vector<float> l;
  int64_t tausch = -1;
  int rb_ruhend = -1;
  uint64_t verloren = 0;
  uint64_t rb_abgelehnt = 0;   // parameters the RB sink tried to set on its voice (a bk track's knobs would be refused)
};
Fall2 fall2(int von, int art) {
  Fall2 f;
  CypherBk* h = bkt::neu(bkt::G_T);   // a fresh instance per run (the runs are compared with each other)
  Treiber t;
  Sinken sk(t.arr);
  auto projekt = [&](int64_t nr, bool bk, double beat2) {
    Bau b(nr);
    // the same tone and length on both devices: a swap keeps the open note (no note off), the old tail only fades
    b.spur(1, ArrArt::intern).note(1, "v/n1", 0.0, 4.0, 45, 127);
    if (beat2 > 0.0) b.note(1, "v/n2", beat2, 1.0, 50, 127);
    cdj::ArrSnapshot* s = b.fertig();
    if (bk) bkt::spur(s, 1, h, 1, {{"k1", 0.8f}});
    else geraet_rb(s, 1);
    return s;
  };
  t.laden(projekt(1, von == 1, 0.0));
  t.arr.start(0.0, 0, false, t.s, 537, 256, t.k);
  t.lauf(SPB + SPB / 2 + 13 * 256);
  f.tausch = t.s;
  const double beat2 = static_cast<double>(f.tausch + 64 - (537 + 256)) / SPB;   // a note of the new device 64 samples into the swap block
  if (art == 1) {
    t.laden(projekt(2, von != 1, beat2));
  } else if (art == 2) {
    t.laden(Bau(2).fertig());
    t.laden(projekt(3, von != 1, beat2));
  }
  t.lauf(f.tausch + 2 * SPB);
  f.rb_ruhend = sk.rb.ruhend();
  f.l = t.l;
  f.verloren = sk.rb.verloren() + sk.bk.verloren();
  f.rb_abgelehnt = sk.rb.parameter_abgelehnt();
  cypher_bk_frei(h);
  return f;
}

}  // namespace

int main() {
  {  // 5: a cutoff lane on an rb338 track arrives at the RB sink
    Treiber t;
    Sinken sk(t.arr);
    Bau b;
    b.spur(1, ArrArt::intern).note(1, "a/n1", 0.0, 1.0, 40, 127).lane(1, {{0.0, 0.2f, 0}, {4.0, 0.8f, 0}}, cdj::ARR_AUTO_GERAET, 1);
    cdj::ArrSnapshot* s = b.fertig();
    geraet_rb(s, 1);
    t.laden(s);
    t.arr.start(0.0, 0, false, t.s, 537, 256, t.k);
    t.lauf(2 * SPB);
    std::printf("device lane: auto_parameter reported %llu, rejected %llu\n", static_cast<unsigned long long>(sk.rb.parameter_gemeldet()),
                static_cast<unsigned long long>(sk.rb.parameter_abgelehnt()));
    PRUEF(sk.rb.parameter_gemeldet() >= 2 * SPB / 256 - 4);   // one value per running block
    PRUEF(sk.rb.parameter_abgelehnt() == 0);
  }
  {  // 1: dispatch by device, each track bit-identical to its own sink alone
    CypherBk* h = bkt::neu(bkt::G_T);
    const std::vector<float> rb = fall1(1, h), bk = fall1(2, h), beide = fall1(3, h);
    PRUEF(energie(rb, 0, 3 * SPB) > 1e-3 && energie(bk, 0, 3 * SPB) > 1e-3);
    bool gleich = beide.size() == rb.size() && beide.size() == bk.size();
    for (size_t i = 0; gleich && i < beide.size(); ++i) gleich = beide[i] == rb[i] + bk[i];
    PRUEF(gleich);
    PRUEF(rb != bk);
    cypher_bk_frei(h);
  }
  static const char* name[] = {"rb338 -> bk", "bk -> rb338"};
  for (int von = 0; von < 2; ++von) {
    const Fall2 ohne = fall2(von, 0);
    const int64_t T = ohne.tausch;
    float dmax_spiel = 0.0f;
    for (int64_t i = T - 4000; i < T; ++i) dmax_spiel = std::fmax(dmax_spiel, std::fabs(ohne.l[i] - ohne.l[i - 1]));
    PRUEF(dmax_spiel > 1e-4f);
    for (int art = 1; art <= 2; ++art) {   // 2, 3: one swap; 4: empty and the other device in the same cycle
      const Fall2 f = fall2(von, art);
      PRUEF(f.tausch == T);
      PRUEF(von == 1 || ohne.rb_ruhend == cdj::ARR_SPUREN - 1);
      float dmax = 0.0f, abw = 0.0f, ref_spitze = 0.0f;
      for (int64_t i = T - 1; i < T + 64; ++i) dmax = std::fmax(dmax, std::fabs(f.l[i] - f.l[i - 1]));
      bool davor_gleich = true;
      for (int64_t i = 0; i < T; ++i) davor_gleich = davor_gleich && f.l[i] == ohne.l[i];
      for (int i = 0; i < 256; ++i) {
        ref_spitze = std::fmax(ref_spitze, std::fabs(ohne.l[T + i]));
        const float soll = ohne.l[T + i] * (static_cast<float>(256 - 1 - i) / 256.0f);
        if (i < 64) abw = std::fmax(abw, std::fabs(f.l[T + i] - soll));   // the new note starts at sample 64 of the block
      }
      std::printf("%s (%s): before bit-identical %d, largest difference to the fade of the old output %.3g (old peak %.5f), largest step %.6f (inside the note %.6f)\n",
                  name[von], art == 1 ? "swap" : "empty and back", davor_gleich, abw, ref_spitze, dmax, dmax_spiel);
      std::fflush(stdout);
      PRUEF(davor_gleich);
      PRUEF(ref_spitze > 1e-3f);
      // rb338 -> empty: the open note gets its note off, so the RB tail is a release, not the continued note: no exact ramp to compare
      if (!(von == 0 && art == 2)) PRUEF(abw <= 1e-6f * ref_spitze + 1e-9f);
      PRUEF(dmax <= dmax_spiel * 1.5f);   // a hard cut would step by the whole tail (0.02 and more against 0.0009)
      PRUEF(energie(f.l, T + 256, T + 2 * SPB) > 1e-3);   // the new device plays
      PRUEF(f.verloren == 0);
      PRUEF(f.rb_abgelehnt == 0);   // the RB sink does not take a bk track for a return to the RB (its knobs k1.. are no RB parameters)
      if (von == 0) PRUEF(f.rb_ruhend == cdj::ARR_SPUREN);   // the RB sink let the track go: its instance rests again
    }
  }
  PRUEF_ENDE();
}
