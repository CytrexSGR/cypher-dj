// Baukasten S20 (task 4): a Baukasten graph as the sink of an internal project track (arr_bk_sink.h).
//   1 the sink alone against the FFI called directly, bit-identical: knobs, takt, a transport start with a note from before (reset,
//     all notes off), events with offsets across block boundaries, a knob change in the middle of the run. Counter-check: other knob
//     values sound different.
//   2 transport start (RB rule A3): a restart while a note sounds gives, from the start block on, bit for bit the output of a fresh
//     instance that was idle until the same start.
//   3 knobs are fed in every block: k1 changed by a snapshot swap during a held note changes the level (the smoothed ramp ends at
//     the ratio of the knob values); the same run without the swap stays bit-identical to the one before the swap.
//   4 change of instance (another graph): the old tail fades out linearly over one block (the old output times (m-1-i)/m, step not
//     larger than inside the note before), then exact silence; nutzt() names the instance in use and lets the old one go.
//     Negative control: a new snapshot with the same instance changes nothing (bit-identical).
//   5 the track leaves the sink (becomes empty): the same fade, afterwards spielend() == 0 and nutzt() false; the track returns
//     in the same cycle (two swaps before one block): the old tail fades, the new note plays.
//   6 rest: with the transport standing and 1 s of exact silence the instance is reset and not computed (ruhend()); a running
//     transport never rests (long pause between two notes); a new start wakes it.
// Mutations: ARR_BK_VERSATZ_NULL (1), ARR_BK_OHNE_ZURUECKSETZEN (2), ARR_BK_REGLER_NUR_START (3), ARR_BK_WECHSEL_HART (4),
// ARR_BK_OHNE_AKTIV (4).
#include <cmath>
#include <cstdio>
#include <vector>

#include "arr_build.h"
#include "bk_help.h"
#include "cypherdj/arr_bk_sink.h"
#include <cypherdj/dsp/denormal.h>
#include "check.h"

using namespace arrtest;
using cdj::ArrArt;

namespace {

std::vector<float> ffi_block(CypherBk* h, int n) {
  std::vector<float> l(static_cast<size_t>(n)), r(static_cast<size_t>(n));
  cypherdj::dsp::DenormalSchutz schutz;
  cypher_bk_block(h, l.data(), r.data(), static_cast<size_t>(n));
  return l;
}

double energie(const std::vector<float>& l, int64_t von, int64_t bis) {
  double e = 0.0;
  for (int64_t i = von; i < bis && i < static_cast<int64_t>(l.size()); ++i) e += static_cast<double>(l[i]) * l[i];
  return e;
}

// Case 1: the sink alone (track slot 2, index 1), blocks of 256. Start S = 1000 (block 768); a note from before the start at 100.
struct Fall1 {
  std::vector<float> senke, ref;
};
Fall1 fall1(float k1_start, float k1_spaeter) {
  Fall1 f;
  Treiber t;   // only holds the snapshot (arr.snapshot()); the module does not run here
  CypherBk* hs = bkt::neu(bkt::G_T);
  CypherBk* hr = bkt::neu(bkt::G_T);
  cdj::ArrSnapshot* a = Bau().spur(2, ArrArt::intern).fertig();
  bkt::spur(a, 2, hs, 1, {{"k1", k1_start}});
  t.laden(a);
  cdj::ArrBkSenke se(t.arr);
  const int64_t S = 1000;
  se.transport_start(1, S);
  float k1 = k1_start;
  for (int64_t s0 = 0; s0 < 256 * 48; s0 += 256) {
    if (s0 == 5120) {   // knob change in the middle of the run, same instance
      cdj::ArrSnapshot* b = Bau(2).spur(2, ArrArt::intern).fertig();
      bkt::spur(b, 2, hs, 1, {{"k1", k1_spaeter}});
      t.laden(b);
      k1 = k1_spaeter;
    }
    const double beat0 = static_cast<double>(s0) / SPB, bps = 128.0 / 60.0 / 48000.0;
    se.takt(beat0, bps);
    // events in the block that holds their target (the module does this at lead 0)
    if (s0 == 0) se.note(1, 100, 57, 100, true);
    if (s0 == 1024) se.note(1, 1300, 57, 100, true);
    if (s0 == 4096) {
      se.note(1, 4300, 57, 0, false);
      se.note(1, 4300, 64, 127, true);
    }
    if (s0 == 6912) se.note(1, 7000, 64, 0, false);
    std::vector<float> l(256, 0.0f), r(256, 0.0f);
    se.block(1, s0, 256, l.data(), r.data());
    f.senke.insert(f.senke.end(), l.begin(), l.end());
    // reference: the same FFI calls directly, in the same order
    const bool sofort = s0 == 0 || s0 == 768;
    for (int k = 1; k <= 8; ++k) {
      const float w = k == 1 ? k1 : 0.5f;
      if (sofort) cypher_bk_regler_sofort(hr, static_cast<uint32_t>(k), w);
      else cypher_bk_regler(hr, static_cast<uint32_t>(k), w);
    }
    cypher_bk_takt(hr, beat0, bps);
    if (s0 == 768) {
      cypher_bk_zuruecksetzen(hr);
      cypher_bk_alle_aus(hr, static_cast<uint32_t>(S - s0));
    }
    if (s0 == 0) cypher_bk_note_an(hr, 100, 57, 100.0f / 127.0f);
    if (s0 == 1024) cypher_bk_note_an(hr, 1300 - 1024, 57, 100.0f / 127.0f);
    if (s0 == 4096) {
      cypher_bk_note_aus(hr, 4300 - 4096, 57);
      cypher_bk_note_an(hr, 4300 - 4096, 64, 1.0f);
    }
    if (s0 == 6912) cypher_bk_note_aus(hr, 7000 - 6912, 64);
    std::vector<float> x = ffi_block(hr, 256);
    if (s0 == 512) {   // a start in the next block: the sink fades this block to 0 (6.28)
      for (int i = 0; i < 256; ++i) x[i] *= static_cast<float>(256 - 1 - i) / 256.0f;
    }
    f.ref.insert(f.ref.end(), x.begin(), x.end());
  }
  PRUEF(se.verloren() == 0);
  cypher_bk_frei(hs);
  cypher_bk_frei(hr);
  return f;
}

// Case 2: restart during a sounding note (X) against an idle instance with the same start (Y)
std::vector<float> fall2(bool vorleben, int64_t* einsatz) {
  Treiber t;
  CypherBk* h = bkt::neu(bkt::beispiel("juno-pad"));
  cdj::ArrBkSenke bk(t.arr);
  t.arr.setze_senke_intern(&bk);
  Bau b;
  b.spur(1, ArrArt::intern).note(1, "v/n1", 0.0, 1.5, 50, 127);   // the life before
  b.note(1, "a/n1", 8.0, 1.0, 57, 100);                            // the test note after the start at beat 8
  cdj::ArrSnapshot* s = b.fertig();
  bkt::spur(s, 1, h, 1, {{"k1", 0.4f}, {"k5", 0.7f}});
  t.laden(s);
  if (vorleben) t.arr.start(0.0, 0, false, t.s, 537, 256, t.k);
  t.lauf(SPB);   // the first note sounds (X) or the instance idles (Y); both reach the same sample
  const int64_t s_start = t.s;
  t.arr.start(8.0, 0, false, s_start, 537, 256, t.k);
  *einsatz = s_start + 537 + 256;
  t.lauf(s_start + 3 * SPB);
  cypher_bk_frei(h);   // the sink must not run again after this point
  return t.l;
}

// Case 4 and 5: a held note on track 1; at the swap block T the snapshot changes. art 0 no swap, 1 another instance (silent),
// 2 the same instance in a new snapshot, 3 the track becomes empty, 4 empty and back in the same cycle (new note after T)
struct Fall4 {
  std::vector<float> l;
  int64_t tausch = -1;
  bool nutzt_a_vor = false, nutzt_b_vor = false, nutzt_a_nach = true, nutzt_b_nach = false;
  int spielend_nach = -1;
  uint64_t verloren = 0;
};
Fall4 fall4(int art) {
  Fall4 f;
  Treiber t;
  CypherBk* ha = bkt::neu(bkt::G_T);
  CypherBk* hb = bkt::neu(bkt::G_T);
  cdj::ArrBkSenke bk(t.arr);
  t.arr.setze_senke_intern(&bk);
  auto projekt = [&](int64_t nr, CypherBk* h, uint64_t gen, double beat2) {
    Bau b(nr);
    b.spur(1, ArrArt::intern).note(1, "v/n1", 0.0, 4.0, 57, 127);
    if (beat2 > 0.0) b.note(1, "v/n2", beat2, 1.0, 62, 127);   // a second note
    cdj::ArrSnapshot* s = b.fertig();
    bkt::spur(s, 1, h, gen, {{"k1", 0.8f}});
    return s;
  };
  t.laden(projekt(1, ha, 1, 0.0));
  t.arr.start(0.0, 0, false, t.s, 537, 256, t.k);
  t.lauf(SPB + SPB / 2 + 13 * 256);
  f.tausch = t.s;
  f.nutzt_a_vor = bk.nutzt(ha);
  f.nutzt_b_vor = bk.nutzt(hb);
  if (art == 1) t.laden(projekt(2, hb, 2, 0.0));
  else if (art == 2) t.laden(projekt(2, ha, 1, 0.0));
  else if (art == 3) t.laden(Bau(2).fertig());
  else if (art == 4) {
    t.laden(Bau(2).fertig());
    t.laden(projekt(3, ha, 1, static_cast<double>(f.tausch + 64 - (537 + 256)) / SPB));   // 64 samples after the swap block
  }
  t.lauf(f.tausch + 2 * SPB);
  f.nutzt_a_nach = bk.nutzt(ha);
  f.nutzt_b_nach = bk.nutzt(hb);
  f.spielend_nach = bk.spielend();
  f.l = t.l;
  f.verloren = bk.verloren();
  cypher_bk_frei(ha);
  cypher_bk_frei(hb);
  return f;
}

}  // namespace

int main() {
  {  // 1: the sink against the FFI called directly, bit-identical; counter-check with other knob values
    const Fall1 f = fall1(0.25f, 0.8f);
    PRUEF(f.senke.size() == f.ref.size());
    bool gleich = f.senke == f.ref, klingt = false;
    for (float v : f.senke) klingt = klingt || v != 0.0f;
    PRUEF(gleich);
    PRUEF(klingt);
    if (!gleich)
      for (size_t i = 0; i < f.senke.size(); ++i)
        if (f.senke[i] != f.ref[i]) {
          std::fprintf(stderr, "case 1: first difference at sample %zu: sink %.9g, FFI %.9g\n", i, f.senke[i], f.ref[i]);
          break;
        }
    PRUEF(fall1(0.6f, 0.2f).senke != f.senke);   // the knobs of the playback take effect
  }
  {  // 2: A3: the output from the start on does not depend on what played before
    int64_t ex = -1, ey = -1;
    const std::vector<float> x = fall2(true, &ex), y = fall2(false, &ey);
    PRUEF(ex == ey && ex > 0);
    const int64_t c = ex / 256 * 256, bis = ex + 2 * SPB;
    PRUEF(energie(x, ex - 20000, ex - 300) > 1e-3);   // the note before the restart sounds
    bool gleich = true;
    for (int64_t i = c; i < bis; ++i) gleich = gleich && x[i] == y[i];
    PRUEF(gleich);
    PRUEF(energie(y, ex, bis) > 1e-3);   // the test note sounds
    if (!gleich)
      for (int64_t i = c; i < bis; ++i)
        if (x[i] != y[i]) {
          std::fprintf(stderr, "case 2: first difference at sample %lld (start %lld): after life %.9g, fresh %.9g\n", (long long)i, (long long)ex, x[i], y[i]);
          break;
        }
  }
  {  // 3: knobs in every block: a knob change by a swap during a held note arrives
    auto lauf3 = [](bool tausch) {
      Treiber t;
      CypherBk* h = bkt::neu(bkt::G_T);
      cdj::ArrBkSenke bk(t.arr);
      t.arr.setze_senke_intern(&bk);
      auto projekt = [&](int64_t nr, float k1) {
        cdj::ArrSnapshot* s = Bau(nr).spur(1, ArrArt::intern).note(1, "v/n1", 0.0, 4.0, 57, 127).fertig();
        bkt::spur(s, 1, h, 1, {{"k1", k1}});
        return s;
      };
      t.laden(projekt(1, 0.25f));
      t.arr.start(0.0, 0, false, t.s, 537, 256, t.k);
      t.lauf(SPB);
      const int64_t T = t.s;
      if (tausch) t.laden(projekt(2, 0.9f));
      t.lauf(T + 3 * 4800);
      cypher_bk_frei(h);
      return std::make_pair(t.l, T);
    };
    const auto [a, T] = lauf3(false);
    const auto [b, T2] = lauf3(true);
    PRUEF(T == T2);
    bool vorher_gleich = true;
    for (int64_t i = 0; i < T; ++i) vorher_gleich = vorher_gleich && a[i] == b[i];
    PRUEF(vorher_gleich);
    float pa = 0.0f, pb = 0.0f;
    for (int64_t i = T + 2 * 4800; i < T + 3 * 4800; ++i) {   // after the 20 ms ramp
      pa = std::fmax(pa, std::fabs(a[i]));
      pb = std::fmax(pb, std::fabs(b[i]));
    }
    std::printf("case 3: level after the knob change %.5f, without %.5f, ratio %.3f (knob values 0.9 / 0.25 = 3.6)\n", pb, pa, pb / pa);
    PRUEF(pa > 1e-3f);
    PRUEF(pb / pa > 3.2f && pb / pa < 4.0f);
  }
  {  // 4 and 5: change of instance, the track leaves, the track returns in the same cycle
    static const char* name[] = {"no swap", "another instance", "same instance", "track empty", "empty and back"};
    const Fall4 ohne = fall4(0);
    PRUEF(ohne.nutzt_a_vor && !ohne.nutzt_b_vor);
    PRUEF(ohne.nutzt_a_nach && !ohne.nutzt_b_nach && ohne.spielend_nach == 1);
    const int64_t T = ohne.tausch;
    float dmax_spiel = 0.0f;
    for (int64_t i = T - 4000; i < T; ++i) dmax_spiel = std::fmax(dmax_spiel, std::fabs(ohne.l[i] - ohne.l[i - 1]));
    PRUEF(dmax_spiel > 1e-4f);
    for (int art = 1; art <= 4; ++art) {
      const Fall4 f = fall4(art);
      PRUEF(f.tausch == T);
      PRUEF(f.nutzt_a_vor && !f.nutzt_b_vor);
      if (art == 2) {   // negative control: the same instance in a new snapshot changes nothing
        PRUEF(f.l == ohne.l);
        PRUEF(f.nutzt_a_nach && f.spielend_nach == 1);
        continue;
      }
      if (art == 1) PRUEF(!f.nutzt_a_nach && f.nutzt_b_nach && f.spielend_nach == 1);   // the old one is let go, the new one is in use
      if (art == 3) PRUEF(!f.nutzt_a_nach && !f.nutzt_b_nach && f.spielend_nach == 0);
      float dmax = 0.0f, abw = 0.0f, ref_spitze = 0.0f;
      const int n = art == 4 ? 64 : 256;   // empty and back: the new note starts 64 samples into the swap block
      for (int64_t i = T - 1; i < T + n; ++i) dmax = std::fmax(dmax, std::fabs(f.l[i] - f.l[i - 1]));
      bool davor_gleich = true;
      for (int64_t i = 0; i < T; ++i) davor_gleich = davor_gleich && f.l[i] == ohne.l[i];
      for (int i = 0; i < 256; ++i) {   // swap block: the old output times (m - 1 - i) / m
        ref_spitze = std::fmax(ref_spitze, std::fabs(ohne.l[T + i]));
        const float soll = ohne.l[T + i] * (static_cast<float>(256 - 1 - i) / 256.0f);
        if (i < n) abw = std::fmax(abw, std::fabs(f.l[T + i] - soll));
      }
      std::printf("case 4/5 (%s): before bit-identical %d, largest difference to the fade of the old output %.3g (old peak %.5f), largest step %.6f (inside the note %.6f)\n",
                  name[art], davor_gleich, abw, ref_spitze, dmax, dmax_spiel);
      std::fflush(stdout);
      PRUEF(davor_gleich);
      PRUEF(ref_spitze > 1e-3f);                 // there is a tail to fade
      PRUEF(abw <= 1e-6f * ref_spitze + 1e-9f);
      PRUEF(dmax <= dmax_spiel * 1.01f);         // no step at the cut
      if (art == 4) {
        PRUEF(energie(f.l, T + 256, T + 2 * SPB) > 1e-2);   // the returned track plays its new note
      } else {
        bool still = true;
        for (int64_t i = T + 256; i < static_cast<int64_t>(f.l.size()); ++i) still = still && f.l[i] == 0.0f;
        PRUEF(still);
      }
      PRUEF(f.verloren == 0);
    }
  }
  {  // 6: rest after 1 s of exact silence, never while the transport runs, wakes with a start
    Treiber t;
    CypherBk* h = bkt::neu(bkt::G_T);
    cdj::ArrBkSenke bk(t.arr);
    t.arr.setze_senke_intern(&bk);
    cdj::ArrSnapshot* s = Bau().spur(1, ArrArt::intern).note(1, "v/n1", 0.0, 0.25, 57, 127).note(1, "v/n2", 6.0, 0.25, 62, 127).fertig();
    bkt::spur(s, 1, h, 1, {{"k1", 0.8f}});
    t.laden(s);
    PRUEF(bk.ruhend() == 0 && bk.spielend() == 0);
    t.arr.start(0.0, 0, false, t.s, 537, 256, t.k);
    t.lauf(SPB);
    PRUEF(bk.spielend() == 1 && bk.ruhend() == 0);
    t.lauf(4 * SPB);   // pause between the notes at beat 0 and 6: the transport runs, no rest
    PRUEF(bk.ruhend() == 0);
    t.arr.stopp(0, t.s, t.k);
    const int64_t stopp = t.s;
    t.lauf(stopp + 24000);
    PRUEF(bk.ruhend() == 0);   // not yet 1 s
    t.lauf(stopp + 3 * 48000);
    PRUEF(bk.ruhend() == 1);
    bool still = true;
    for (int64_t i = stopp + 256; i < static_cast<int64_t>(t.l.size()); ++i) still = still && t.l[i] == 0.0f;
    PRUEF(still);
    const int64_t neu = t.s;   // a new start wakes the instance: the first note plays again
    t.arr.start(0.0, 0, false, neu, 537, 256, t.k);
    t.lauf(neu + SPB);
    PRUEF(bk.ruhend() == 0);
    PRUEF(energie(t.l, neu + 537 + 256, neu + SPB) > 1e-3);
    cypher_bk_frei(h);
  }
  PRUEF_ENDE();
}
