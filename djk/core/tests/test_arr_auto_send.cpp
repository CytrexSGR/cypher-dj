// Send automation, task 1: a lane `send.<r>` (ARR_AUTO_SEND, param = return - 1) drives the send of a track into a return, once per audio block (Arrangement::auto_send):
// the lane value at the last running sample of the block is the target of a gain ramp across the block, the mixer takes it between the cell envelope and the knob
// (cell envelope > lane > knob). Deterministic: the returns are dry (ret/N/hall/an = 0), one track plays a constant 0.25 (centre), 120 BPM, blocks of 250 samples
// (96 blocks per beat), so the share the return adds to the master is the difference of two runs: wet = run - reference, and 20 log10(wet / direct) is the send level in dB.
//   1. no lane: the return carries the track at the knob (-6.02 dB), the old behaviour.
//   2. a lane constant at -200 dB over the knob: the return is exactly silent (bit-equal to the run without a send), no NaN.
//   3. a lane -60 -> 0 dB over beats 0..4: at the first sample of three blocks inside the ramp the level is within 0.5 dB of the lane value at that block start, after the last
//      point it is 0 dB, between the block starts the level only rises (smooth ramp), and every sample-to-sample step stays below one block ramp.
//   4. a transport loop over the ramp: the first sample after the seam and the first block start after it are within 0.5 dB of the lane value at the loop start.
//   5. a loop deck cell with an envelope on the same send: the return follows the cell envelope, the lane (here -200 dB) is not applied on top (bit-equal to the run without lane);
//      without the envelope the lane rules (control).
//   6. a swap to a playback without the lane: the return is back at the knob within one block, without a step; a swap that brings the lane in goes the other way; a swap from one lane
//      to another follows the new lane (no stale cursor).
//   7. stop and start: a fresh start takes the lane value at the start beat from the first block on (no ramp from the value held at the stop).
//   8. a send lane on track 1 does not touch track 2 and a lane on send 2 does not touch send 1.
//   9. the loop seam inside a block, sample exact (block sizes 250, 1024 and 777): the last sample before the seam is the lane value there (the end of part one), the first sample after
//      it is the lane value at the loop start (the start of part two), the last sample of the block is the lane value there (the end of part two). An off-by-one in the part switch of
//      the mixer (`t < ts` against `t <= ts`) fails here.
//  10. block size 1024: a ramp, a constant -200 dB (exact silence) and the monotonic course.
//  11. start and stop in the middle of a block (the origin is 537 samples in, the stop 100 samples into a block, block size 1024 and 250): the first sound is the lane value at the start
//      beat, the sound up to the stop follows the lane, nothing is added after the stop.
//  12. send.8 (the last target: param 7, the end of the field) next to send.1: each into its own return; on track 32 (the last strip) too.
//  13. a pre return: the send is taken before fader and pan of the track, the lane scales it, the fader of the track does not.
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <memory>
#include <vector>

#include "arr_build.h"
#include "cypherdj/arrangement.h"
#include "check.h"

using namespace arrtest;
using cdj::ArrArt;
using cdj::ArrAutoPunkt;
using cdj::ArrZelle;
using cdj::ArrZellArt;
using cdj::LaunchGrund;

#define TR(x) auto x##_p = std::make_unique<Treiber>(); Treiber& x = *x##_p;
static constexpr int64_t V = 537;
static int NB = 250;                              // block size: 24000 samples per beat / 250 = 96 blocks per beat (the block size cases below set it and put it back)
static constexpr double BEAT = 24000.0;
static const double MITTE = 0.70710677;
static const double D = 0.25 * MITTE;             // the direct level of the track on the left channel

static ArrAutoPunkt P(double beat, float wert, uint8_t form = 0) { return ArrAutoPunkt{beat, wert, form}; }

// track 1 (constant clip) with return 1 and 2; a send lane on return `ret` (1-based) when `lane` is not empty
static cdj::ArrSnapshot* snap(const cdj::ArrAudio* a, const std::vector<ArrAutoPunkt>& lane, int ret = 1, bool track2 = false, const std::vector<ArrAutoPunkt>& lane2 = {}) {
  Bau b;
  b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 40.0, a);
  if (track2) b.spur(2, ArrArt::audio).clip(2, "c2", 0.0, 40.0, a);
  b.ret(1).ret(2);
  if (!lane.empty()) b.lane(1, lane, cdj::ARR_AUTO_SEND, static_cast<uint8_t>(ret - 1));
  if (!lane2.empty()) b.lane(2, lane2, cdj::ARR_AUTO_SEND, 0);
  return b.fertig();
}
static void setze(Treiber& t, const char* pfad, float w) {
  const int r = t.tab.suche(pfad);
  PRUEF(r >= 0);
  t.arr.setze_sofort(r, w);
}
static void rein(Treiber& t) {   // dry returns, block size, tempo
  t.k = cdj::Karte(120.0, 0);
  t.n = NB;
  for (const char* p : {"ret/1/hall/an", "ret/2/hall/an", "ret/3/hall/an", "ret/4/hall/an"}) setze(t, p, 0.0f);
}
static int64_t s_start(const Treiber& t) { return t.arr.zustand(t.k, t.s).ursprung_sample; }
static void spiele(Treiber& t, cdj::ArrSnapshot* s, float knob, int64_t bis, bool loop = false, double start_beat = 0.0) {
  rein(t);
  setze(t, "spur/1/send/1", knob);
  t.laden(s);
  if (loop) t.arr.loop(true, 0.0, 4.0, 0, t.k);
  t.arr.start(start_beat, 0, false, 0, V, NB, t.k);
  t.lauf(bis);
}
static double db(double x) { return 20.0 * std::log10(x); }
// the send level of the return at sample i in dB (relative to the direct level): (run - reference) / reference
static double nass(const Treiber& t, const Treiber& ref, int64_t i) {
  return db(std::max(std::fabs(static_cast<double>(t.l[i]) - static_cast<double>(ref.l[i])), 1e-30) / std::fabs(static_cast<double>(ref.l[i])));
}
static double nass_lin(const Treiber& t, const Treiber& ref, int64_t i) { return static_cast<double>(t.l[i]) - static_cast<double>(ref.l[i]); }
static int64_t block_ab(int64_t s) { return (s + NB - 1) / NB * NB; }   // the first block start at or after s
static bool ganz_gleich(const Treiber& a, const Treiber& b, int64_t von, int64_t bis) {
  return std::memcmp(a.l.data() + von, b.l.data() + von, sizeof(float) * static_cast<size_t>(bis - von)) == 0 &&
         std::memcmp(a.r.data() + von, b.r.data() + von, sizeof(float) * static_cast<size_t>(bis - von)) == 0;
}

// a loop deck cell playing a constant signal on track 1 with an envelope on send 1 (the setup of test_arr_launcher_huellen)
static const uint64_t ID1 = cdj::arr_id("s1");
static ArrZelle zelle(Audio& a, bool mit_huelle, float huelle_db) {
  ArrZelle z;
  z.art = ArrZellArt::loop;
  z.audio = &a.a;
  z.frames = a.a.frames;
  z.beats = 4.0;
  z.gain = 1.0f;
  z.modus = 0;
  if (mit_huelle) {
    cdj::ZellHuelle& h = z.huellen[z.n_huellen++];
    h.art = 0;
    h.feld = static_cast<uint8_t>(cdj::arr_f_send(0));
    h.n = 2;
    h.p[0] = P(0.0, huelle_db);
    h.p[1] = P(4.0, huelle_db);
  }
  return z;
}
static void zelle_lauf(Treiber& t, Audio& cell_audio, bool mit_huelle, const std::vector<ArrAutoPunkt>& lane, int64_t bis) {
  rein(t);
  Bau b;
  b.spur(1, ArrArt::audio).ret(1).ret(2);
  if (!lane.empty()) b.lane(1, lane, cdj::ARR_AUTO_SEND, 0);
  cdj::ArrSnapshot* s = b.fertig();
  cdj::ArrSpur& sp = s->spur[0];
  sp.kennung = ID1;
  std::snprintf(sp.kennung_text, sizeof sp.kennung_text, "s1");
  sp.zellen[0] = zelle(cell_audio, mit_huelle, -6.0f);
  sp.n_zellen = 1;
  setze(t, "spur/1/send/1", -40.0f);
  t.laden(s);
  t.arr.start(0.0, 0, false, 0, V, NB, t.k);
  PRUEF(t.arr.launch_start(ID1, 1, 0.0, 0.0, 1, false) == LaunchGrund::ok);
  t.lauf(bis);
}

int main() {
  auto a = Audio::gleich(1200000, 0.25f);
  const int64_t BIS = 8 * 24000;
  TR(ref)
  spiele(ref, snap(&a->a, {}), -200.0f, BIS);   // reference: no send at all
  const int64_t S0 = s_start(ref);
  std::printf("start sample %lld\n", static_cast<long long>(S0));
  PRUEF(S0 > 0 && std::fabs(ref.l[S0 + 5000] - D) < 1e-5);   // the direct level is as computed
  {  // 1. no lane: the knob
    TR(m)
    spiele(m, snap(&a->a, {}), -6.0206f, BIS);
    PRUEF(std::fabs(nass(m, ref, S0 + 60000) - -6.0206) < 0.1);
  }
  {  // 2. lane constant at -200 dB over the knob at -6 dB: exact silence
    TR(m)
    spiele(m, snap(&a->a, {P(0.0, -200.0f), P(40.0, -200.0f)}), -6.0206f, BIS);
    PRUEF(ganz_gleich(m, ref, 0, BIS));
    for (int64_t i = 0; i < BIS; i += 97) PRUEF(std::isfinite(m.l[i]) && std::isfinite(m.r[i]));
    // positive control: the same playback with the lane at 0 dB does carry the send
    TR(c)
    spiele(c, snap(&a->a, {P(0.0, 0.0f), P(40.0, 0.0f)}), -6.0206f, BIS);
    PRUEF(std::fabs(nass(c, ref, S0 + 60000)) < 0.1);   // 0 dB, not the knob -6
  }
  {  // 3. the ramp -60 -> 0 dB over beats 0..4
    TR(m)
    spiele(m, snap(&a->a, {P(0.0, -60.0f), P(4.0, 0.0f)}), -6.0206f, BIS);
    for (double beat : {1.0, 2.0, 3.0}) {
      const int64_t sb = block_ab(S0 + static_cast<int64_t>(beat * BEAT));
      const double lane = -60.0 + 15.0 * (static_cast<double>(sb - S0) / BEAT);
      const double got = nass(m, ref, sb);
      std::printf("3: beat %.2f block start %lld lane %.3f dB, return %.3f dB\n", beat, static_cast<long long>(sb), lane, got);
      PRUEF(std::fabs(got - lane) < 0.5);
    }
    PRUEF(std::fabs(nass(m, ref, S0 + 5 * 24000)) < 0.05);   // after the last point (beat 4): 0 dB
    PRUEF(std::fabs(nass(m, ref, S0 + 7 * 24000)) < 0.05);
    double schritt = 0.0;
    bool steigt = true;
    for (int64_t i = S0 + 24000; i < S0 + 90000; ++i) {
      const double d = nass_lin(m, ref, i) - nass_lin(m, ref, i - 1);
      if (d < -5e-8) steigt = false;
      schritt = std::max(schritt, std::fabs(d));
    }
    std::printf("3: monotonic %d, largest step %.3g\n", steigt ? 1 : 0, schritt);
    PRUEF(steigt);
    PRUEF(schritt < 1e-4);   // one block ramp of this lane is about 0.6 dB: no step in the return
  }
  {  // 4. a transport loop 0..4 over the ramp
    TR(lref)
    spiele(lref, snap(&a->a, {}), -200.0f, 9 * 24000, true);
    TR(m)
    spiele(m, snap(&a->a, {P(0.0, -60.0f), P(4.0, 0.0f)}), -6.0206f, 9 * 24000, true);
    const int64_t naht = m.arr.letzte_naht();
    std::printf("4: last seam sample %lld (origin %lld, expected %lld)\n", static_cast<long long>(naht), static_cast<long long>(S0), static_cast<long long>(S0 + 8 * 24000));
    PRUEF(naht > 0);
    if (naht > 0) {
      const int64_t ab_naht = naht + 3;                  // the first samples after the seam
      PRUEF(std::fabs(nass(m, lref, ab_naht) - (-60.0 + 15.0 * 3.0 / BEAT)) < 0.5);
      const int64_t sb = block_ab(naht + 1);             // the first block start after the seam
      const double lane = -60.0 + 15.0 * (static_cast<double>(sb - naht) / BEAT);
      std::printf("4: after the seam: %.3f dB (lane %.3f)\n", nass(m, lref, sb), lane);
      PRUEF(std::fabs(nass(m, lref, sb) - lane) < 0.5);
      PRUEF(nass(m, lref, naht - 3) > -1.0);             // just before the seam the ramp is at its top
      const int64_t sb2 = block_ab(naht + 2 * NB);
      PRUEF(std::fabs(nass(m, lref, sb2) - (-60.0 + 15.0 * (static_cast<double>(sb2 - naht) / BEAT))) < 0.5);
    }
  }
  {  // 5. cell envelope over lane over knob
    auto cell = Audio::gleich(4 * 24000, 0.25f);
    TR(k0)   // cell without envelope, knob -40, no lane
    zelle_lauf(k0, *cell, false, {}, 5 * 24000);
    TR(env)  // cell envelope -6 dB, no lane
    zelle_lauf(env, *cell, true, {}, 5 * 24000);
    TR(env_lane)   // cell envelope -6 dB, lane -200 dB
    zelle_lauf(env_lane, *cell, true, {P(0.0, -200.0f), P(40.0, -200.0f)}, 5 * 24000);
    TR(nur_lane)   // no envelope, lane -200 dB (control: the lane does rule over the knob -40 here)
    zelle_lauf(nur_lane, *cell, false, {P(0.0, -200.0f), P(40.0, -200.0f)}, 5 * 24000);
    TR(knopf_lane)   // no envelope, lane 0 dB (control: louder than the knob -40)
    zelle_lauf(knopf_lane, *cell, false, {P(0.0, 0.0f), P(40.0, 0.0f)}, 5 * 24000);
    const int64_t von = 2 * 24000, bis = 5 * 24000;
    double d_env = 0.0, d_lane = 0.0, d_knopf = 0.0;
    for (int64_t i = von; i < bis; ++i) {
      d_env = std::max(d_env, std::fabs(static_cast<double>(env.l[i]) - k0.l[i]));
      d_lane = std::max(d_lane, std::fabs(static_cast<double>(nur_lane.l[i]) - k0.l[i]));
      d_knopf = std::max(d_knopf, std::fabs(static_cast<double>(knopf_lane.l[i]) - k0.l[i]));
    }
    std::printf("5: |env - knob| %.4g, |lane -200 - knob| %.4g, |lane 0 - knob| %.4g\n", d_env, d_lane, d_knopf);
    PRUEF(d_env > 1e-3);                                   // the envelope is heard (it is -6 dB against the knob at -40)
    PRUEF(ganz_gleich(env_lane, env, von, bis));           // the lane is not applied on top of the cell envelope: bit-equal
    PRUEF(d_lane > 1e-5 && d_knopf > 1e-3);                // controls: without the envelope the lane rules over the knob
  }
  {  // 6. swaps
    const int64_t T = S0 + 3 * 24000 + 100;   // swap at a block start
    const int64_t t_swap = block_ab(T);
    TR(r0)   // no lane the whole time, knob -6
    spiele(r0, snap(&a->a, {}), -6.0206f, BIS);
    {  // lane -200 -> no lane: back at the knob within one block, no step
      TR(m)
      spiele(m, snap(&a->a, {P(0.0, -200.0f), P(40.0, -200.0f)}), -6.0206f, t_swap);
      PRUEF(m.s == t_swap);
      m.laden(snap(&a->a, {}));
      m.lauf(BIS);
      PRUEF(ganz_gleich(m, ref, 0, t_swap));   // silent before
      PRUEF(std::fabs(nass(m, ref, t_swap + 2 * NB) - -6.0206) < 0.1);
      PRUEF(std::fabs(nass(m, ref, BIS - 10) - -6.0206) < 0.1);
      double schritt = 0.0;
      for (int64_t i = t_swap - 5; i < t_swap + 6 * NB; ++i) schritt = std::max(schritt, std::fabs(nass_lin(m, ref, i + 1) - nass_lin(m, ref, i)));
      std::printf("6: lane -> knob, largest step %.3g (a jump would be %.3g)\n", schritt, D * 0.5);
      PRUEF(schritt < 5e-4);
      PRUEF(nass_lin(m, ref, t_swap + NB - 1) > 0.5 * D * 0.5 && nass_lin(m, ref, t_swap) < 0.02 * D);   // it ramps over the first block
    }
    {  // no lane -> lane -200: silent within one block, no step
      TR(m)
      spiele(m, snap(&a->a, {}), -6.0206f, t_swap);
      m.laden(snap(&a->a, {P(0.0, -200.0f), P(40.0, -200.0f)}));
      m.lauf(BIS);
      PRUEF(std::fabs(nass(m, ref, t_swap - 10) - -6.0206) < 0.1);
      PRUEF(ganz_gleich(m, ref, t_swap + 2 * NB, BIS));
      double schritt = 0.0;
      int64_t wo = 0;
      for (int64_t i = t_swap - 5; i < t_swap + 6 * NB; ++i) {
        const double d = std::fabs(nass_lin(m, ref, i + 1) - nass_lin(m, ref, i));
        if (d > schritt) schritt = d, wo = i - t_swap;
      }
      std::printf("6: knob -> lane, largest step %.3g at swap%+lld\n", schritt, static_cast<long long>(wo));
      PRUEF(schritt < 5e-4);
    }
    {  // lane -20 dB -> lane -40 dB: the new lane rules after one block
      TR(m)
      spiele(m, snap(&a->a, {P(0.0, -20.0f), P(40.0, -20.0f)}), -6.0206f, t_swap);
      PRUEF(std::fabs(nass(m, ref, t_swap - 10) - -20.0) < 0.1);
      m.laden(snap(&a->a, {P(0.0, -40.0f), P(2.0, -40.0f), P(40.0, -40.0f)}));
      m.lauf(BIS);
      PRUEF(std::fabs(nass(m, ref, t_swap + 2 * NB) - -40.0) < 0.1);
      PRUEF(std::fabs(nass(m, ref, BIS - 10) - -40.0) < 0.1);
    }
  }
  {  // 7. stop and start
    TR(lref)
    rein(lref);
    TR(m)
    spiele(m, snap(&a->a, {P(0.0, -60.0f), P(4.0, 0.0f)}), -6.0206f, S0 + 3 * 24000);
    m.arr.stopp(0, m.s, m.k);
    m.lauf(m.s + 6000);
    m.arr.start(2.0, 0, false, m.s, V, NB, m.k);   // a fresh start at beat 2 (the lane is -30 dB there)
    const int64_t sn = m.s;
    m.lauf(sn + 3 * 24000);
    const int64_t s2 = s_start(m);
    // the reference for the same stretch: the same stop/start without a send
    TR(r2)
    spiele(r2, snap(&a->a, {}), -200.0f, S0 + 3 * 24000);
    r2.arr.stopp(0, r2.s, r2.k);
    r2.lauf(r2.s + 6000);
    r2.arr.start(2.0, 0, false, r2.s, V, NB, r2.k);
    r2.lauf(sn + 3 * 24000);
    // the first audible sample of the new run: 20 dB-scale, compare with the lane at beat 2 + (sample - origin) / BEAT
    int64_t erst = -1;
    for (int64_t i = sn; i < sn + 3 * 24000; ++i)
      if (std::fabs(r2.l[i]) > 1e-3) { erst = i; break; }
    PRUEF(erst > 0);
    if (erst > 0) {
      const int64_t sb = block_ab(erst) + NB;   // a block start a little later, inside the run
      const double beat = 2.0 + static_cast<double>(sb - s2) / BEAT;
      const double lane = -60.0 + 15.0 * beat;
      std::printf("7: after the restart: first sound %lld, block %lld beat %.4f lane %.3f dB, return %.3f dB\n", static_cast<long long>(erst), static_cast<long long>(sb), beat, lane,
                  nass(m, r2, sb));
      PRUEF(std::fabs(nass(m, r2, sb) - lane) < 0.7);
      const double lane1 = -60.0 + 15.0 * (2.0 + static_cast<double>(erst - s2) / BEAT);
      PRUEF(std::fabs(nass(m, r2, erst + 1) - lane1) < 0.7);   // from the first sound on, not ramped up from the value held at the stop (about -7 dB)
    }
  }
  {  // 8. the lane drives its own track and send only
    TR(r2)   // reference: two tracks, no sends
    spiele(r2, snap(&a->a, {}, 1, true), -200.0f, BIS);
    TR(m)   // lane on send 2 of track 1 (-200 dB): the knob of send 1 stays heard; lane on send 1 of track 2 at -200: track 2 has no knob send, nothing changes
    spiele(m, snap(&a->a, {P(0.0, -200.0f), P(40.0, -200.0f)}, 2, true, {P(0.0, -200.0f), P(40.0, -200.0f)}), -6.0206f, BIS);
    const double wet = static_cast<double>(m.l[S0 + 60000]) - r2.l[S0 + 60000];   // send 1 of track 1 at the knob -6.02 dB: half of ONE track's direct level
    PRUEF(std::fabs(wet - 0.5 * D) < 0.02 * D);
  }

  {  // 9. the loop seam inside a block, sample exact
    const int groessen[] = {250, 1024, 777};
    for (int nb : groessen) {
      const int alt = NB;
      NB = nb;
      TR(lref)
      spiele(lref, snap(&a->a, {}), -200.0f, 9 * 24000, true);
      TR(m)
      spiele(m, snap(&a->a, {P(0.0, -60.0f), P(4.0, 0.0f)}), -6.0206f, 9 * 24000, true);
      const int64_t naht = m.arr.letzte_naht();
      const int64_t blk_ende = (naht / nb + 1) * nb;   // the block holding the seam ends here
      std::printf("9: block %d seam %lld (%lld into its block)\n", nb, static_cast<long long>(naht), static_cast<long long>(naht % nb));
      PRUEF(naht > 0 && naht % nb != 0 && naht % nb < nb - 2);   // the seam really is inside a block, with samples on both sides
      if (naht > 0) {
        const double vor = nass(m, lref, naht - 1), ab = nass(m, lref, naht), letzt = nass(m, lref, blk_ende - 1);
        const double lane_letzt = -60.0 + 15.0 * (static_cast<double>(blk_ende - 1 - naht) / BEAT);
        std::printf("9: before the seam %.4f dB (lane about 0), after %.4f dB (lane -60), block end %.4f dB (lane %.4f)\n", vor, ab, letzt, lane_letzt);
        PRUEF(std::fabs(vor) < 0.02);               // the last sample of part one: the lane at the top of the ramp
        PRUEF(std::fabs(ab + 60.0) < 0.05);         // the first sample of part two: the lane at the loop start, not part one carried on
        PRUEF(std::fabs(letzt - lane_letzt) < 0.05);   // the last sample of the block: the end of part two
        PRUEF(nass(m, lref, naht - 2) < nass(m, lref, naht - 1) + 1e-6);   // part one still rises up to the seam
        PRUEF(nass(m, lref, naht + 1) > ab);                               // part two rises from the loop start
      }
      NB = alt;
    }
  }
  {  // 10. block size 1024
    NB = 1024;
    TR(r1)
    spiele(r1, snap(&a->a, {}), -200.0f, BIS);
    const int64_t s1 = s_start(r1);
    TR(m)
    spiele(m, snap(&a->a, {P(0.0, -60.0f), P(4.0, 0.0f)}), -6.0206f, BIS);
    for (double beat : {1.0, 2.0, 3.0}) {
      const int64_t sb = block_ab(s1 + static_cast<int64_t>(beat * BEAT));
      const double lane = -60.0 + 15.0 * (static_cast<double>(sb - s1) / BEAT);
      const double lane_ende = -60.0 + 15.0 * (static_cast<double>(sb + NB - 1 - s1) / BEAT);
      std::printf("10: block start %lld lane %.3f dB return %.3f dB; block end lane %.3f return %.3f\n", static_cast<long long>(sb), lane, nass(m, r1, sb), lane_ende, nass(m, r1, sb + NB - 1));
      PRUEF(std::fabs(nass(m, r1, sb) - lane) < 0.1);
      PRUEF(std::fabs(nass(m, r1, sb + NB - 1) - lane_ende) < 0.1);
    }
    bool steigt = true;
    double schritt = 0.0;
    for (int64_t i = s1 + 24000; i < s1 + 90000; ++i) {
      const double d = nass_lin(m, r1, i) - nass_lin(m, r1, i - 1);
      if (d < -5e-8) steigt = false;
      schritt = std::max(schritt, std::fabs(d));
    }
    PRUEF(steigt && schritt < 1e-4);
    PRUEF(std::fabs(nass(m, r1, s1 + 5 * 24000)) < 0.05);   // after the last point: 0 dB
    TR(z)   // a constant -200 dB: exact silence
    spiele(z, snap(&a->a, {P(0.0, -200.0f), P(40.0, -200.0f)}), -6.0206f, BIS);
    PRUEF(ganz_gleich(z, r1, 0, BIS));
    NB = 250;
  }
  for (int nb : {1024, 250}) {   // 11. start and stop in the middle of a block
    NB = nb;
    TR(m)
    TR(r2)
    const std::vector<ArrAutoPunkt> lane = {P(0.0, -60.0f), P(4.0, 0.0f)};
    for (Treiber* t : {&m, &r2}) {
      spiele(*t, snap(&a->a, t == &m ? lane : std::vector<ArrAutoPunkt>{}), t == &m ? -6.0206f : -200.0f, 2 * 24000);
      t->arr.stopp(0, t->s, t->k);
      t->lauf(t->s + 3 * NB);
      t->arr.start(2.0, 0, false, t->s, V, NB, t->k);   // the origin is V = 537 samples into the block: a start in the middle of a block
    }
    const int64_t s2 = s_start(m), sn = s2 - V;
    PRUEF(s2 % NB != 0 && s2 == s_start(r2));
    for (Treiber* t : {&m, &r2}) t->lauf(sn + 4 * 24000 + 40 * NB);
    int64_t erst = -1;
    for (int64_t i = sn; i < sn + 3 * 24000; ++i)
      if (std::fabs(r2.l[i]) > 1e-3) { erst = i; break; }
    PRUEF(erst > 0);
    if (erst > 0) {
      const double lane_erst = -60.0 + 15.0 * (2.0 + static_cast<double>(erst - s2) / BEAT);
      std::printf("11: block %d, start origin %lld (%lld into its block), first sound %lld: return %.3f dB, lane %.3f dB\n", nb, static_cast<long long>(s2), static_cast<long long>(s2 % NB),
                  static_cast<long long>(erst), nass(m, r2, erst + 1), lane_erst);
      PRUEF(std::fabs(nass(m, r2, erst + 1) - lane_erst) < 0.7);
      const int64_t spaeter = erst + 3 * NB + 11;
      PRUEF(std::fabs(nass(m, r2, spaeter) - (-60.0 + 15.0 * (2.0 + static_cast<double>(spaeter - s2) / BEAT))) < 0.7);
    }
    // stop 100 samples into a block while running
    TR(p)
    TR(q)
    for (Treiber* t : {&p, &q}) {
      spiele(*t, snap(&a->a, t == &p ? lane : std::vector<ArrAutoPunkt>{}), t == &p ? -6.0206f : -200.0f, 3 * 24000);
      t->arr.stopp(0, t->s + 100, t->k);
      t->lauf(t->s + 4 * NB);
    }
    const int64_t halt = (3 * 24000 / NB + (3 * 24000 % NB ? 1 : 0)) * NB + 100;   // the sample the stop was asked for
    int64_t letzt = -1;
    for (int64_t i = halt - 3 * NB; i < halt + 2 * NB && i < static_cast<int64_t>(q.l.size()); ++i)
      if (std::fabs(q.l[i]) > 1e-3) letzt = i;
    std::printf("11: block %d, stop asked at %lld, last sound of the reference %lld\n", nb, static_cast<long long>(halt), static_cast<long long>(letzt));
    PRUEF(letzt >= halt && letzt <= halt + cdj::ARR_STUMM_BLENDE);   // the sound stops where it was asked for, with the stop fade (ARR_STUMM_BLENDE) after it, in the middle of the block
    if (letzt > 0) {
      const int64_t vor = halt - 1;   // the last sample before the stop
      const double lane_l = -60.0 + 15.0 * (static_cast<double>(vor - s_start(q)) / BEAT);
      std::printf("11: before the stop: return %.3f dB, lane %.3f dB\n", nass(p, q, vor), lane_l);
      PRUEF(std::fabs(nass(p, q, vor) - lane_l) < 0.7);
      double rest = 0.0;   // after the stop fade nothing is added to the master
      for (int64_t i = letzt + 2; i < letzt + 3 * NB; ++i) rest = std::max(rest, std::fabs(nass_lin(p, q, i)));
      PRUEF(rest < 1e-6);
    }
    NB = 250;
  }
  {  // 12. send.8 (param 7) next to send.1, and on track 32: the end of the field
    const auto s8 = [&](int spur_nr, const std::vector<ArrAutoPunkt>& l8, const std::vector<ArrAutoPunkt>& l1) {
      Bau b;
      b.spur(spur_nr, ArrArt::audio).clip(spur_nr, "c1", 0.0, 40.0, &a->a);
      for (int r = 1; r <= 8; ++r) b.ret(r);
      if (!l8.empty()) b.lane(spur_nr, l8, cdj::ARR_AUTO_SEND, 7);
      if (!l1.empty()) b.lane(spur_nr, l1, cdj::ARR_AUTO_SEND, 0);
      return b.fertig();
    };
    for (int spur_nr : {1, 32}) {
      const std::string sp = "spur/" + std::to_string(spur_nr) + "/send/";
      const auto lauf8 = [&](Treiber& t, cdj::ArrSnapshot* sn, int64_t bis) {
        rein(t);
        for (int r = 5; r <= 8; ++r) setze(t, ("ret/" + std::to_string(r) + "/hall/an").c_str(), 0.0f);
        for (int r = 1; r <= 8; ++r) setze(t, (sp + std::to_string(r)).c_str(), -200.0f);
        t.laden(sn);
        t.arr.start(0.0, 0, false, 0, V, NB, t.k);
        t.lauf(bis);
      };
      TR(r0)
      lauf8(r0, s8(spur_nr, {}, {}), 3 * 24000);
      const int64_t st = s_start(r0), i = st + 60000;
      TR(a8)   // send.8 alone at -6.02 dB (the knob of send 8 is -200): half of the track's direct level
      lauf8(a8, s8(spur_nr, {P(0.0, -6.0206f), P(40.0, -6.0206f)}, {}), 3 * 24000);
      const double w8 = static_cast<double>(a8.l[i]) - r0.l[i];
      TR(b8)   // send.8 at -6.02 dB and send.1 at -12.04 dB: both are heard, 0.5 + 0.25
      lauf8(b8, s8(spur_nr, {P(0.0, -6.0206f), P(40.0, -6.0206f)}, {P(0.0, -12.0412f), P(40.0, -12.0412f)}), 3 * 24000);
      const double wb = static_cast<double>(b8.l[i]) - r0.l[i];
      TR(c8)   // send.8 at -200 dB: silent
      lauf8(c8, s8(spur_nr, {P(0.0, -200.0f), P(40.0, -200.0f)}, {}), 3 * 24000);
      std::printf("12: track %d: send.8 alone %.5f (expected %.5f), with send.1 %.5f (expected %.5f)\n", spur_nr, w8, 0.5 * D, wb, 0.75 * D);
      PRUEF(std::fabs(w8 - 0.5 * D) < 0.02 * D);
      PRUEF(std::fabs(wb - 0.75 * D) < 0.02 * D);
      PRUEF(ganz_gleich(c8, r0, 0, 3 * 24000));
    }
  }
  {  // 13. a pre return: the send is taken before the fader and the pan of the track
    const auto pre = [&](const std::vector<ArrAutoPunkt>& lane, bool pre_an, float fader) {
      cdj::ArrSnapshot* sn = snap(&a->a, lane);
      sn->ret_pre[0] = pre_an;
      auto t = std::make_unique<Treiber>();
      rein(*t);
      setze(*t, "spur/1/send/1", lane.empty() ? -200.0f : -6.0206f);
      setze(*t, "spur/1/fader", fader);
      t->laden(sn);
      t->arr.start(0.0, 0, false, 0, V, NB, t->k);
      t->lauf(8 * 24000);
      return t;
    };
    const std::vector<ArrAutoPunkt> konst = {P(0.0, -6.0206f), P(40.0, -6.0206f)};
    auto r20 = pre({}, true, -20.0f);   // the track at -20 dB, no send: the reference of the same fader
    auto p20 = pre(konst, true, -20.0f);
    auto q20 = pre(konst, false, -20.0f);   // control: the same send post fader
    const int64_t i = s_start(*r20) + 60000;
    const double w_pre = static_cast<double>(p20->l[i]) - r20->l[i], w_post = static_cast<double>(q20->l[i]) - r20->l[i];
    std::printf("13: fader -20 dB, lane -6.02 dB: pre return %.5f (expected %.5f, the track before fader and pan x 0.5), post return %.5f\n", w_pre, 0.25 * 0.5, w_post);
    PRUEF(std::fabs(w_pre - 0.25 * 0.5) < 0.02 * 0.125);   // not scaled by the fader (-20 dB) or the centre pan
    PRUEF(std::fabs(w_post) < 0.2 * 0.125);                // control: post fader the same lane is far lower
    // the lane still ramps in a pre return: the level follows the lane
    auto r0 = pre({}, true, -20.0f);
    auto pr = pre({P(0.0, -60.0f), P(4.0, 0.0f)}, true, -20.0f);
    const int64_t sb = block_ab(s_start(*r0) + 2 * 24000);
    const double lane = -60.0 + 15.0 * (static_cast<double>(sb - s_start(*r0)) / BEAT);
    const double got = db((static_cast<double>(pr->l[sb]) - r0->l[sb]) / 0.25);
    std::printf("13: pre return on the ramp: %.3f dB, lane %.3f dB\n", got, lane);
    PRUEF(std::fabs(got - lane) < 0.5);
  }
  PRUEF_ENDE();
}
