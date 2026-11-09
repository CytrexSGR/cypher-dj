// 1.10 slice 7 (T5, spec 5.7, AK16 to AK18): the real-time tap /k/arr/abgriff at the module Arrangement alone, the sibling of the freeze (test_arr_freeze).
// A tap is a run from von_beat by the start rule with the loop bracket suspended; the file holds the signal at ONE point of ONE strip (art 0 track, 1 group,
// 2 return, 3 PM; punkt 0 pre, 1 post), exactly bis - von beats long, shifted by the path latency of the tapped point, so it starts on von_beat like the export.
// Sines and impulses from arr_build.h, never a deck. Every buffer is prefilled with -9: what the run does not write falls out of every comparison.
// Cases: 1 frames (8 bars at 120 BPM: 768000 exactly, all strip kinds and both points), 2 pm_gleich_tap (the PM post file equals the copy of pm_l() of the same blocks),
// 3 gruppe_post_pegel (group fader -6.02 dB: post RMS = pre RMS - 6.02 dB), 4 pre_post (track fader -200: pre unchanged, post under -120 dBFS), 5 ankunft (an impulse
// through one EQ on the track, group, return and master chain: file sample 0 for post of each kind), 6 refusals (each with its reason), 7 freeze_unveraendert (the
// freeze file of the fixture equals the clip audio byte for byte, a tap after it runs), 8 abbruch (stop, waiting stop, swap: status 1, loop bracket and start beat
// back), 9 keine_allokation (0 allocations over 2000 blocks with a running tap; positive control: allocating the buffer counts).
// Mutations (CMakeLists.txt): ABGRIFF_VOR_FADER (4 and 3), ABGRIFF_NACHLAUF (1), ABGRIFF_OHNE_ANKUNFT (5).
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <memory>
#include <vector>

#include "arr_build.h"
#include "cypherdj/eq.h"
#include "check.h"
#include "alloc_intercept.h"   // last: replaces malloc and relatives. Exactly one translation unit per program includes it.

using namespace arrtest;
using cdj::ArrArt;
using cdj::ArrInsArt;
using cdj::ArrStufe;

#define TR(x) auto x##_p = std::make_unique<Treiber>(); Treiber& x = *x##_p;

namespace {

int reg(Treiber& t, const char* pfad) {
  const int r = t.tab.suche(pfad);
  if (r < 0) std::fprintf(stderr, "no row %s\n", pfad);
  PRUEF(r >= 0);
  return r;
}
void setze(Treiber& t, const char* pfad, float w) { t.arr.setze_sofort(reg(t, pfad), w); }

cdj::ArrAbgriff auftrag(int art, int nr, int punkt, double von, double bis, double kap_beats = -1.0) {
  cdj::ArrAbgriff a;
  a.art = art;
  a.nr = nr;
  a.punkt = punkt;
  a.kennung = 7;
  a.von_beat = von;
  a.bis_beat = bis;
  a.kap = static_cast<int64_t>(std::ceil((kap_beats < 0.0 ? bis - von : kap_beats) * 48000.0)) + 2;   // 60 BPM, the slowest project tempo
  a.daten.assign(static_cast<size_t>(a.kap) * 2, -9.0f);
  return a;
}

// scene: track 1 (sine) into group 1, track 2 (sine) to the PM with a send into return 1 (dry); every kind of strip exists and carries signal
cdj::ArrSnapshot* szene(const cdj::ArrAudio* a) {
  Bau b;
  b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 40.0, a).ausgang(1, 1);
  b.spur(2, ArrArt::audio).clip(2, "c2", 0.0, 40.0, a);
  cdj::ArrSnapshot* s = b.fertig();
  s->ret_da[0] = true;
  cdj::arr_pdc_rechnen(*s);
  return s;
}
void szene_regler(Treiber& t) {
  setze(t, "ret/1/hall/an", 0.0f);   // the return passes dry
  setze(t, "spur/2/send/1", 0.0f);
}

bool lauf_tap(Treiber& t, cdj::ArrAbgriff& a, int quant = 0, int64_t vorhalt = 0) {
  const char* grund = "";
  if (!t.arr.abgriff(&a, quant, false, t.s, vorhalt, t.n, t.k, grund)) {
    std::fprintf(stderr, "abgriff refused: %s\n", grund);
    return false;
  }
  t.lauf(a.start_s + a.frames + 8192);
  return true;
}

double rms_db(const std::vector<float>& d, int64_t frames) {
  double s = 0.0;
  for (int64_t i = 0; i < 2 * frames; ++i) s += static_cast<double>(d[static_cast<size_t>(i)]) * d[static_cast<size_t>(i)];
  return 10.0 * std::log10(s / static_cast<double>(2 * frames) + 1e-30);
}
double spitze(const std::vector<float>& d, int64_t frames) {
  double m = 0.0;
  for (int64_t i = 0; i < 2 * frames; ++i) m = std::max(m, static_cast<double>(std::fabs(d[static_cast<size_t>(i)])));
  return m;
}

}  // namespace

int main() {
  const int L_EQ = cdj::EqNativ().latenz();
  PRUEF(L_EQ > 0);   // positive control: the stage has a latency to compensate

  {  // 1 frames: 8 bars at 120 BPM = 32 beats = 768000 frames, every kind and both points, every sample written
    auto au = Audio::sinus(900000, 220.0, 0.4f);
    for (int art = 0; art <= 3; ++art)
      for (int punkt = 0; punkt <= 1; ++punkt) {
        TR(t)
        t.k = cdj::Karte{120.0, 0};
        t.laden(szene(&au->a));
        szene_regler(t);
        cdj::ArrAbgriff a = auftrag(art, 1, punkt, 0.0, 32.0);
        PRUEF(lauf_tap(t, a));
        std::printf("1: art %d punkt %d: frames %lld start_s %lld status %d\n", art, punkt, static_cast<long long>(a.frames),
                    static_cast<long long>(a.start_s), a.status);
        PRUEF(a.frames == 768000);
        PRUEF(t.arr.hole_abgriff_fertig() == &a && a.status == 0 && !t.arr.hole_abgriff_fertig());
        bool luecke = false;
        for (int64_t i = 0; i < 2 * a.frames; ++i) luecke = luecke || a.daten[static_cast<size_t>(i)] == -9.0f;
        PRUEF(!luecke);
        PRUEF(a.daten[static_cast<size_t>(2 * a.frames)] == -9.0f);   // behind the end nothing written (no tail)
        PRUEF(spitze(a.daten, a.frames) > 0.05);                       // the strip carries signal (positive control)
        PRUEF(t.arr.status() == cdj::ArrStatus::steht);
      }
  }

  {  // 2 pm_gleich_tap: the PM post file equals the copy of pm_l()/pm_r() of the same blocks, difference 0
    auto au = Audio::sinus(300000, 330.0, 0.4f);
    TR(t)
    t.laden(szene(&au->a));
    szene_regler(t);
    setze(t, "pm/fader", -3.0f);
    setze(t, "spur/1/fader", -2.0f);
    cdj::ArrAbgriff a = auftrag(3, 1, 1, 0.0, 8.0);
    PRUEF(lauf_tap(t, a));
    PRUEF(a.status == 0 && t.arr.abgriff_ankunft(3, 1, 1) == 0);
    double diff = 0.0;
    for (int64_t i = 0; i < a.frames; ++i) {
      const size_t j = static_cast<size_t>(a.start_s + i);
      diff = std::max(diff, std::fabs(static_cast<double>(a.daten[static_cast<size_t>(2 * i)]) - t.pml[j]));
      diff = std::max(diff, std::fabs(static_cast<double>(a.daten[static_cast<size_t>(2 * i + 1)]) - t.pmr[j]));
    }
    std::printf("2: PM post against pm_l()/pm_r(): max difference %.3g over %lld frames (peak %.3f)\n", diff,
                static_cast<long long>(a.frames), spitze(a.daten, a.frames));
    PRUEF(diff == 0.0 && spitze(a.daten, a.frames) > 0.1);
  }

  {  // 3 gruppe_post_pegel: one sine member, group fader -6.02 dB (gain 0.5): post RMS = pre RMS - 6.02 dB +-0.01
    auto au = Audio::sinus(300000, 440.0, 0.4f);
    double r[2] = {};
    for (int punkt = 0; punkt <= 1; ++punkt) {
      TR(t)
      Bau b;
      b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 40.0, &au->a).ausgang(1, 1);
      t.laden(b.fertig());
      setze(t, "grp/1/fader", -6.0206f);
      cdj::ArrAbgriff a = auftrag(1, 1, punkt, 0.0, 8.0);
      PRUEF(lauf_tap(t, a) && a.status == 0);
      r[punkt] = rms_db(a.daten, a.frames);
    }
    std::printf("3: group RMS pre %.4f dB, post %.4f dB, difference %.4f dB\n", r[0], r[1], r[1] - r[0]);
    PRUEF_NAH(r[1] - r[0], -6.0206, 0.01);
  }

  {  // 4 pre_post: track fader -200: pre unchanged (bit-equal to fader 0), post under -120 dBFS
    auto au = Audio::sinus(300000, 440.0, 0.4f);
    std::vector<float> pre_a, pre_b, post_b;
    for (int lauf = 0; lauf < 3; ++lauf) {
      TR(t)
      Bau b;
      b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 40.0, &au->a);
      t.laden(b.fertig());
      if (lauf > 0) setze(t, "spur/1/fader", -200.0f);
      cdj::ArrAbgriff a = auftrag(0, 1, lauf == 2 ? 1 : 0, 0.0, 4.0);
      PRUEF(lauf_tap(t, a) && a.status == 0);
      a.daten.resize(static_cast<size_t>(2 * a.frames));
      (lauf == 0 ? pre_a : lauf == 1 ? pre_b : post_b) = a.daten;
    }
    PRUEF(pre_a.size() == pre_b.size() && std::memcmp(pre_a.data(), pre_b.data(), pre_a.size() * 4) == 0);
    const double sp_post = spitze(post_b, static_cast<int64_t>(post_b.size() / 2));
    std::printf("4: pre peak %.4f (fader 0 and -200 equal), post peak at fader -200 = %.3g (%.1f dBFS)\n", spitze(pre_b, static_cast<int64_t>(pre_b.size() / 2)),
                sp_post, 20.0 * std::log10(sp_post + 1e-30));
    PRUEF(spitze(pre_b, static_cast<int64_t>(pre_b.size() / 2)) > 0.3);
    PRUEF(sp_post < 1e-6);   // under -120 dBFS
  }

  {  // 5 ankunft: an impulse on the first beat through one EQ on the chain of the strip: at file sample 0 for post of every kind
    struct Fall { int art; const char* name; };
    const Fall faelle[] = {{0, "track"}, {1, "group"}, {2, "return"}, {3, "PM"}};
    for (const Fall& fa : faelle) {
      auto au = Audio::impuls(400000);
      TR(t)
      Bau b;
      b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 8.0, &au->a);
      if (fa.art == 1) b.ausgang(1, 1);
      const ArrStufe EQ{ArrInsArt::eq, 0, true};
      if (fa.art == 0) b.kette(1, {EQ});
      if (fa.art == 1) b.gruppen_kette(1, {EQ});
      if (fa.art == 2) b.ret_kette(1, {EQ});
      if (fa.art == 3) b.pm_kette({EQ});
      cdj::ArrSnapshot* s = b.fertig();
      s->ret_da[0] = true;
      s->ret_pre[0] = true;
      cdj::arr_pdc_rechnen(*s);
      t.laden(s);
      setze(t, "ret/1/hall/an", 0.0f);
      setze(t, "ins/eq/1/an", 1.0f);
      if (fa.art == 2) setze(t, "spur/1/send/1", 0.0f);
      const int ank = t.arr.abgriff_ankunft(fa.art, 1, 1);
      cdj::ArrAbgriff a = auftrag(fa.art, 1, 1, 0.0, 4.0);
      PRUEF(lauf_tap(t, a) && a.status == 0);
      int64_t pos = -1;
      double sp = 0.0;
      for (int64_t i = 0; i < a.frames; ++i) {
        const double x = std::max(std::fabs(a.daten[static_cast<size_t>(2 * i)]), std::fabs(a.daten[static_cast<size_t>(2 * i + 1)]));
        if (x > sp) { sp = x; pos = i; }
      }
      // read one sample late: the residual against the file itself stays far above -90 dBFS (the impulse is the content)
      double rest = 0.0;
      for (int64_t i = 0; i + 1 < a.frames; ++i)
        rest = std::max(rest, std::fabs(static_cast<double>(a.daten[static_cast<size_t>(2 * i)]) - a.daten[static_cast<size_t>(2 * i + 2)]));
      std::printf("5: %s post: ankunft %d, impulse at file sample %lld (peak %.3f), residual one sample late %.1f dBFS\n", fa.name, ank,
                  static_cast<long long>(pos), sp, 20.0 * std::log10(rest + 1e-30));
      PRUEF(ank == L_EQ);
      PRUEF(sp > 0.2 && pos == 0);
      PRUEF(rest > std::pow(10.0, -90.0 / 20.0));
    }
    {   // pre points: a real impulse test for track, group, return and PM pre. The track chain carries an EQ so the path of the
        // group, return and master pre has latency; the file must still hold the impulse at sample 0 (the window shifts by ankunft)
      const char* namen[] = {"track", "group", "return", "PM"};
      for (int art = 0; art < 4; ++art) {
        auto au = Audio::impuls(400000);
        TR(t)
        Bau b;
        b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 8.0, &au->a);
        if (art == 1) b.ausgang(1, 1);
        b.kette(1, {ArrStufe{ArrInsArt::eq, 0, true}});
        cdj::ArrSnapshot* sn = b.fertig();
        sn->ret_da[0] = true;
        sn->ret_pre[0] = true;
        cdj::arr_pdc_rechnen(*sn);
        t.laden(sn);
        setze(t, "ret/1/hall/an", 0.0f);
        setze(t, "ins/eq/1/an", 1.0f);
        if (art == 2) setze(t, "spur/1/send/1", 0.0f);
        const int ank = t.arr.abgriff_ankunft(art, 1, 0);
        cdj::ArrAbgriff a = auftrag(art, 1, 0, 0.0, 4.0);
        PRUEF(lauf_tap(t, a) && a.status == 0);
        int64_t pos = -1;
        double sp = 0.0;
        for (int64_t i = 0; i < a.frames; ++i) {
          const double x = std::max(std::fabs(a.daten[static_cast<size_t>(2 * i)]), std::fabs(a.daten[static_cast<size_t>(2 * i + 1)]));
          if (x > sp) { sp = x; pos = i; }
        }
        std::printf("5: %s pre: ankunft %d, impulse at file sample %lld (peak %.3f)\n", namen[art], ank, static_cast<long long>(pos), sp);
        PRUEF(sp > 0.2 && pos == 0);
        if (art == 1 || art == 3) PRUEF(ank == L_EQ);   // group pre and master pre sit behind the track chain
      }
    }
    {   // the other points: the pre of a track is raw (0), the group pre arrives like the tracks (t_trk), the PM pre in front of the PM chain (p_in)
      auto au = Audio::impuls(100000);
      TR(t)
      Bau b;
      b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 1.0, &au->a).ausgang(1, 1);
      b.kette(1, {ArrStufe{ArrInsArt::eq, 0, true}}).pm_kette({ArrStufe{ArrInsArt::eq, 1, true}});
      t.laden(b.fertig());
      const cdj::ArrSnapshot* sn = t.arr.snapshot();
      PRUEF(t.arr.abgriff_ankunft(0, 1, 0) == 0);
      PRUEF(t.arr.abgriff_ankunft(0, 1, 1) == sn->pdc.t_trk && sn->pdc.t_trk == L_EQ);
      PRUEF(t.arr.abgriff_ankunft(1, 1, 0) == sn->pdc.t_trk);
      PRUEF(t.arr.abgriff_ankunft(3, 1, 0) == sn->pdc.p_in);
      PRUEF(t.arr.abgriff_ankunft(3, 1, 1) == sn->pdc.gesamt && sn->pdc.gesamt == 2 * L_EQ);
    }
  }

  {  // 6 refusals, each with its reason; a refusal leaves the module as it was
    auto au = Audio::sinus(300000, 440.0, 0.4f);
    TR(t)
    const char* grund = "";
    cdj::ArrAbgriff a = auftrag(0, 1, 1, 0.0, 4.0);
    PRUEF(!t.arr.abgriff(&a, 0, false, 0, 0, t.n, t.k, grund) && !std::strcmp(grund, "nicht_geladen"));   // no playback
    t.laden(szene(&au->a));
    szene_regler(t);
    struct Ab { int art, nr, punkt; const char* grund; };
    const Ab abs[] = {{0, 3, 1, "spur_bereich"},     // track 3 is empty
                      {1, 5, 1, "spur_bereich"},     // group 5 has no member
                      {2, 4, 1, "spur_bereich"},     // return 4 is not in the playback
                      {0, 33, 1, "spur_bereich"},    // beyond the slots
                      {0, 0, 1, "spur_bereich"},
                      {3, 2, 1, "spur_bereich"},     // the PM is strip 1 only
                      {4, 1, 1, "ausserhalb_bereich"},
                      {-1, 1, 1, "ausserhalb_bereich"},
                      {0, 1, 2, "ausserhalb_bereich"}};
    for (const Ab& x : abs) {
      cdj::ArrAbgriff r = auftrag(x.art, x.nr, x.punkt, 0.0, 4.0);
      const bool ok = t.arr.abgriff(&r, 0, false, 0, 0, t.n, t.k, grund);
      if (ok || std::strcmp(grund, x.grund)) std::fprintf(stderr, "art %d nr %d punkt %d: ok %d grund %s, expected %s\n", x.art, x.nr, x.punkt, ok, grund, x.grund);
      PRUEF(!ok && !std::strcmp(grund, x.grund));
    }
    cdj::ArrAbgriff gross = auftrag(0, 1, 1, 0.0, 257.0, 300.0);   // buffer is big enough: the range itself is refused
    PRUEF(!t.arr.abgriff(&gross, 0, false, 0, 0, t.n, t.k, grund) && !std::strcmp(grund, "zu_gross"));
    cdj::ArrAbgriff genau = auftrag(0, 1, 1, 0.0, 256.0, 260.0);   // 256 beats is the limit and allowed
    PRUEF(t.arr.abgriff(&genau, 0, false, 0, 0, t.n, t.k, grund));
    t.arr.stopp(0, 0, t.k);
    PRUEF(t.arr.hole_abgriff_fertig() == &genau && genau.status == 1);
    cdj::ArrAbgriff klein = auftrag(0, 1, 1, 0.0, 4.0, 1.0);   // 1 beat of buffer at 60 BPM = 48002 frames, the range needs 90000 at 128 BPM
    PRUEF(!t.arr.abgriff(&klein, 0, false, 0, 0, t.n, t.k, grund) && !std::strcmp(grund, "zu_gross"));
    PRUEF(t.arr.status() == cdj::ArrStatus::steht && !t.arr.abgriff_laeuft() && !t.arr.hole_abgriff_fertig());
    // overlap: a freeze runs, a tap runs, the transport runs, a finished job is still unclaimed
    cdj::ArrFreeze f;
    f.spur = 1;
    f.kennung = 1;
    f.von_beat = 0.0;
    f.bis_beat = 4.0;
    f.kap = 6 * 48000 + 2;
    f.daten.assign(static_cast<size_t>(f.kap) * 2, 0.0f);
    PRUEF(t.arr.freeze(&f, 0, false, t.s, 0, t.n, t.k, grund));
    cdj::ArrAbgriff ueb = auftrag(0, 1, 1, 0.0, 4.0);
    PRUEF(!t.arr.abgriff(&ueb, 0, false, t.s, 0, t.n, t.k, grund) && !std::strcmp(grund, "ueberlappung"));
    t.arr.stopp(0, t.s, t.k);
    PRUEF(t.arr.hole_freeze_fertig() == &f);
    cdj::ArrAbgriff lauf1 = auftrag(0, 1, 1, 0.0, 4.0);
    PRUEF(t.arr.abgriff(&lauf1, 0, false, t.s, 0, t.n, t.k, grund) && t.arr.abgriff_laeuft());
    PRUEF(!t.arr.abgriff(&ueb, 0, false, t.s, 0, t.n, t.k, grund) && !std::strcmp(grund, "ueberlappung"));   // a tap runs
    PRUEF(!t.arr.freeze(&f, 0, false, t.s, 0, t.n, t.k, grund) && !std::strcmp(grund, "ueberlappung"));       // and no freeze starts over it
    t.arr.stopp(0, t.s, t.k);   // waiting: aborts at once, the job is finished but unclaimed
    PRUEF(!t.arr.abgriff(&ueb, 0, false, t.s, 0, t.n, t.k, grund) && !std::strcmp(grund, "ueberlappung"));
    PRUEF(t.arr.hole_abgriff_fertig() == &lauf1 && lauf1.status == 1);
    PRUEF(t.arr.start(0.0, 0, false, t.s, 0, t.n, t.k));   // the transport runs
    PRUEF(!t.arr.abgriff(&ueb, 0, false, t.s, 0, t.n, t.k, grund) && !std::strcmp(grund, "ueberlappung"));
  }

  {  // 7 freeze_unveraendert: the freeze of the fixture (a clip on track 1) holds the clip audio byte for byte; a tap after it runs on the same module
    auto au = Audio::sinus(400000, 261.0, 0.3f);
    TR(t)
    Bau b;
    b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 8.0, &au->a);
    t.laden(b.fertig());
    cdj::ArrFreeze f;
    f.spur = 1;
    f.kennung = 3;
    f.von_beat = 0.0;
    f.bis_beat = 4.0;
    f.kap = 6 * 48000 + 2;
    f.daten.assign(static_cast<size_t>(f.kap) * 2, -9.0f);
    const char* grund = "";
    PRUEF(t.arr.freeze(&f, 0, false, 0, 0, t.n, t.k, grund));
    t.lauf(f.start_s + f.frames + 4096);
    PRUEF(t.arr.hole_freeze_fertig() == &f && f.status == 0 && f.start_s == 256 && f.frames == 6 * SPB);
    // the clip enters with a short fade-in at the onset sample (the freeze never saw the fader): compare from the second 64 samples on, then the whole clip
    int64_t ungleich = 0;
    for (int64_t i = 64; i < 4 * SPB; ++i)
      ungleich += std::memcmp(&f.daten[static_cast<size_t>(2 * i)], &au->d[static_cast<size_t>(2 * i)], 8) != 0;
    std::printf("7: freeze file against clip audio: %lld of %lld frames differ\n", static_cast<long long>(ungleich), static_cast<long long>(4 * SPB - 64));
    PRUEF(ungleich == 0);
    PRUEF(!t.arr.freeze_laeuft() && !t.arr.abgriff_laeuft());
    cdj::ArrAbgriff a = auftrag(0, 1, 0, 0.0, 4.0);
    PRUEF(lauf_tap(t, a) && t.arr.hole_abgriff_fertig() == &a && a.status == 0);
    ungleich = 0;
    for (int64_t i = 64; i < 4 * SPB; ++i)
      ungleich += std::memcmp(&a.daten[static_cast<size_t>(2 * i)], &au->d[static_cast<size_t>(2 * i)], 8) != 0;
    PRUEF(ungleich == 0);   // the pre tap of a track is the same signal the freeze takes
  }

  {  // 8 abbruch: stop while playing (at the stop sample), stop while waiting (at once), swap; the loop bracket and the start beat of the user come back
    auto au = Audio::sinus(300000, 440.0, 0.4f);
    TR(t)
    Bau b1, b2;
    b1.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 40.0, &au->a);
    b2.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 40.0, &au->a);
    t.laden(b1.fertig());
    t.arr.loop(true, 0.0, 2.0, t.s, t.k);
    PRUEF(t.arr.start(6.0, 0, false, 0, 4096, t.n, t.k));
    t.arr.stopp(0, 0, t.k);
    PRUEF(t.arr.start_beat() == 6.0);
    cdj::ArrAbgriff a = auftrag(0, 1, 1, 0.0, 16.0);
    const char* grund = "";
    PRUEF(t.arr.abgriff(&a, 0, false, t.s, 0, t.n, t.k, grund));
    PRUEF(t.arr.zustand(t.k, t.s).status == cdj::ArrStatus::freeze && t.arr.zustand(t.k, t.s).start_beat == 6.0 && t.arr.zustand(t.k, t.s).loop_an);
    t.lauf(a.start_s + 2 * SPB);
    PRUEF(t.arr.hole_abgriff_gestartet() == a.start_s - t.arr.abgriff_ankunft(0, 1, 1) && t.arr.hole_abgriff_gestartet() == -1);
    const int64_t s_stopp = t.s;
    t.arr.stopp(0, t.s, t.k);
    t.lauf(t.s + 4096);
    PRUEF(t.arr.hole_abgriff_fertig() == &a && a.status == 1 && a.ende_s == s_stopp);
    PRUEF(t.arr.start_beat() == 6.0 && t.arr.zustand(t.k, t.s).loop_an && t.arr.status() == cdj::ArrStatus::steht);
    cdj::ArrAbgriff w = auftrag(0, 1, 1, 0.0, 16.0);
    PRUEF(t.arr.abgriff(&w, 0, false, t.s, 0, t.n, t.k, grund));
    t.arr.stopp(0, t.s, t.k);   // before the onset
    PRUEF(t.arr.hole_abgriff_fertig() == &w && w.status == 1 && w.ende_s == t.s && t.arr.hole_abgriff_gestartet() == -1);
    PRUEF(t.arr.start_beat() == 6.0);
    cdj::ArrAbgriff x = auftrag(0, 1, 1, 0.0, 16.0);
    PRUEF(t.arr.abgriff(&x, 0, false, t.s, 0, t.n, t.k, grund));
    t.lauf(t.s + SPB);
    const int64_t s_tausch = t.s;
    t.laden(b2.fertig());
    t.lauf(t.s + 4096);
    PRUEF(t.arr.hole_abgriff_fertig() == &x && x.status == 1 && x.ende_s == s_tausch);
    PRUEF(t.arr.start_beat() == 6.0 && t.arr.zustand(t.k, t.s).loop_an);
  }

  if (!ALLOC_ABFANG_VERFUEGBAR) {
    std::printf("9 skipped (sanitizer build): allocation watcher not available\n");
  } else {  // 9 keine_allokation: 2000 blocks with a running tap on every kind of strip (the run starts and ends inside the window)
    auto au = Audio::sinus(900000, 220.0, 0.3f);
    TR(t)
    cdj::ArrSnapshot* s = szene(&au->a);
    s->ret_pre[0] = false;
    ArrStufe eq{ArrInsArt::eq, 0, true};
    s->kette[0].n = 1;
    s->kette[0].st[0] = eq;
    cdj::arr_pdc_rechnen(*s);
    t.laden(s);
    szene_regler(t);
    setze(t, "ins/eq/1/an", 1.0f);
    cdj::ArrAbgriff taps[8];
    for (int i = 0; i < 8; ++i) taps[i] = auftrag(i / 2, 1, i % 2, 0.0, 1.0);   // each 1 beat = about 47000 samples = 185 blocks
    const char* grund = "";
    float b[6][cdj::ARR_BLOCK];
    int64_t pos = t.s;
    int gestartet = 0;
    long fertig = 0;
    abfang_an();
    for (int blk = 0; blk < 2000; ++blk) {
      if (!t.arr.abgriff_laeuft() && gestartet < 8 && t.arr.status() == cdj::ArrStatus::steht) {
        if (gestartet > 0) fertig += t.arr.hole_abgriff_fertig() ? 1 : 0;
        if (!t.arr.abgriff(&taps[gestartet], 0, false, pos, 0, 256, t.k, grund)) PRUEF(false);
        ++gestartet;
      }
      for (auto& x : b) std::fill(x, x + 256, 0.0f);
      t.arr.block(t.k, pos, 256, b[0], b[1], b[2], b[3], b[4], b[5]);
      pos += 256;
    }
    const long im_fenster = abfang_aus();
    fertig += t.arr.hole_abgriff_fertig() ? 1 : 0;
    std::printf("9: allocations in 2000 blocks with %d taps started, %ld finished = %ld\n", gestartet, fertig, im_fenster);
    PRUEF(gestartet == 8 && fertig >= 7);   // the window really holds starts and ends of taps
    PRUEF(im_fenster == 0L);
    abfang_an();
    { cdj::ArrAbgriff zweite = auftrag(0, 1, 1, 0.0, 2.0); }
    const long bau_zaehlt = abfang_aus();
    std::printf("9: allocations while allocating a tap buffer = %ld\n", bau_zaehlt);
    PRUEF(bau_zaehlt > 0);   // positive control: the counter sees allocations
  }
  PRUEF_ENDE();
}
