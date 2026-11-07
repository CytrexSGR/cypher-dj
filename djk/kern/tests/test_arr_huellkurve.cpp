// 1.12 automation slice 5, unit U8a (plan D8, AK18): the gain envelope of an audio clip, played by the voice per sample (plain path: no warp).
// The clip carries a table gain_hk (copy-local beats -> dB, -200..0, on top of the clip gain); the voice holds an AutoLane cursor on it, takes the clip beat
// of every sample from the per-sample project beat wp_ (the same one the warp path uses), converts to a gain with db_lin only when the value moved by more
// than AUTO_HALT_DB, and glides over ARR_NAHT when a snapshot swap changes only the table. The tail copy of a swapped-out voice carries the envelope.
// Measuring: (A) the level at the master of a constant-source clip (0.5, centre pan -3 dB), every dB value can be computed back; (B) the held factor of the
// voice through ArrPruefZugang with one-sample blocks around the loop wrap (first sample after the wrap = hk(0), within 1e-6 linear).
// U8b (T8.3): the same checks through the warp paths. art 0 plain, art 1 RE-PITCH (identity map: clip beat b reads frame b * 24000), art 2 BEATS (units of one beat);
// the three read the clip beat from the per-sample project beat (RE-PITCH) or the map (BEATS) and apply the same table. The werk voices (COMPLEX, TONES) are in
// test_warp_werk_huellkurve.cpp (they need Bungee). Mutation ARR_HK_WARP_OHNE (a warped voice ignores the envelope): every art-1 and art-2 level check goes red.
// Mutations: ARR_HK_CURSOR_ALT (loop wrap: red), ARR_HK_TAUSCH_HART (table change at a swap jumps: red), ARR_HK_AUSKLANG_OHNE (the tail ignores the envelope: red),
// ARR_WARP_BLOCKANFANG (the project beat of a sub-block stands on its start: red on the steep ramp).
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <vector>

#include "arr_bau.h"
#include "pruef.h"

namespace cdj {
struct ArrPruefZugang {
  // the held linear envelope factor of the first active voice that plays a clip, -1 when there is none
  static float hk_lin(const Arrangement& a) {
    for (const Arrangement::Stimme& v : a.st_)
      if (v.aktiv && v.clip) return v.hk_lin;
    return -1.0f;
  }
};
}  // namespace cdj

using namespace arrtest;
using cdj::ArrArt;
using cdj::ArrAutoPunkt;
using Z = cdj::ArrPruefZugang;

static constexpr int64_t V = 537;
static const double MITTE = 0.70710677;   // centre pan, -3 dB

static ArrAutoPunkt P(double beat, float wert, uint8_t form = 0) { return ArrAutoPunkt{beat, wert, form}; }
static double lin(double db) { return db <= -120.0 ? 0.0 : std::pow(10.0, db / 20.0); }
static double db_von_pegel(double pegel, double voll) { return 20.0 * std::log10(std::max(std::fabs(pegel) / voll, 1e-12)); }
static double spb(double bpm) { return 48000.0 * 60.0 / bpm; }

// the clip c1 on track 1 of b: art 0 plain, art 1 RE-PITCH with an identity map (24000 source frames per clip beat, the source of 25 s covers 16 beats), art 2 BEATS with
// one unit per beat (loop off, envelope 100): constant source 0.5, so the level of the output is the gain alone, except in the last 96 samples of a BEATS unit (its short fade)
static void klipp(Bau& b, const cdj::ArrAudio* a, std::vector<ArrAutoPunkt> hk, double clip_beats, float gain, int art) {
  b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, clip_beats, a, 0, gain);
  if (art == 1) b.warp({0.0, clip_beats}, {0.0, clip_beats * 24000.0}, 0);
  if (art == 2) {
    std::vector<double> eb, ef;
    for (int k = 0; k < static_cast<int>(clip_beats); ++k) {
      eb.push_back(k);
      ef.push_back(24000.0 * k);
    }
    b.warp({0.0, clip_beats}, {0.0, clip_beats * 24000.0}, 1).beats(eb, ef, 0, 100);
  }
  if (!hk.empty()) b.hk(std::move(hk));
}
// one 16-beat clip on track 1 with an envelope (empty: none); constant source 0.5
static void aufbau(Treiber& t, const cdj::ArrAudio* a, std::vector<ArrAutoPunkt> hk, double bpm = 120.0, double clip_beats = 16.0, float gain = 1.0f, int art = 0) {
  t.k = cdj::Karte(bpm, 0);
  Bau b;
  klipp(b, a, std::move(hk), clip_beats, gain, art);
  t.laden(b.fertig());
}
// the sample of a clip beat position for the level checks: BEATS units end with a 96 sample fade, so a check sits half a beat into the unit (art 2) instead of on the beat
static double pos_beat(int art, double b) { return art == 2 ? b + 0.5 : b; }
static int64_t start_sample(Treiber& t) { return t.arr.zustand(t.k, t.s).ursprung_sample; }

int main() {
  auto a = Audio::gleich(1200000);   // 25 s at 48 kHz, constant 0.5
  {  // T8.2 / AK18 (A): -12 -> 0 dB over a 16-beat clip, the level at five beats within 0.05 dB of the line, at a whole-sample (120) and a fractional-sample (127) tempo
     // negative control: the same clip without a table holds 0 dB (+-0.01)
    for (int art : {0, 1, 2})   // U8b T8.3: the same check through a RE-PITCH clip (1) and a BEATS clip (2)
      for (double bpm : {120.0, 127.0}) {
        Treiber t;
        aufbau(t, &a->a, {P(0, -12.f), P(16, 0.f)}, bpm, 16.0, 1.0f, art);
        t.arr.start(0.0, 0, false, 0, V, 256, t.k);
        t.lauf(static_cast<int64_t>(17 * spb(bpm)) + 2000);
        const int64_t s0 = start_sample(t);
        for (int b : {2, 4, 8, 12, 15}) {
          const double bp = pos_beat(art, b);
          const int64_t sm = s0 + std::llround(bp * spb(bpm));
          PRUEF_NAH(db_von_pegel(t.l[sm], 0.5 * MITTE), -12.0 + 12.0 * bp / 16.0, 0.05);
        }
        Treiber v;
        aufbau(v, &a->a, {}, bpm, 16.0, 1.0f, art);
        v.arr.start(0.0, 0, false, 0, V, 256, v.k);
        v.lauf(static_cast<int64_t>(17 * spb(bpm)) + 2000);
        const int64_t v0 = start_sample(v);
        for (int b : {2, 4, 8, 12, 15}) PRUEF_NAH(db_von_pegel(v.l[v0 + std::llround(pos_beat(art, b) * spb(bpm))], 0.5 * MITTE), 0.0, 0.01);
      }
  }
  {  // T8.2 loop copies: four 4-beat copies of one clip, each with the same table (-12 -> 0 over its own 4 beats); each copy repeats the line, and the first sample of
     // a copy reads hk(0) (not the end value of the copy before)
    for (int art : {0, 1}) {   // U8b: and through RE-PITCH copies (each with its own identity map)
      Treiber t;
      t.k = cdj::Karte(120.0, 0);
      Bau b;
      b.spur(1, ArrArt::audio);
      for (int k = 0; k < 4; ++k) {
        b.clip(1, ("c" + std::to_string(k)).c_str(), 4.0 * k, 4.0, &a->a);
        if (art == 1) b.warp({0.0, 4.0}, {0.0, 4.0 * 24000.0}, 0);
        b.hk({P(0, -12.f), P(4, 0.f)});
      }
      t.laden(b.fertig());
      t.arr.start(0.0, 0, false, 0, V, 256, t.k);
      t.lauf(17 * 24000);
      const int64_t s0 = start_sample(t);
      for (int k = 0; k < 4; ++k) {
        for (double lb : {1.0, 2.0, 3.0}) PRUEF_NAH(db_von_pegel(t.l[s0 + std::llround((4.0 * k + lb) * 24000.0)], 0.5 * MITTE), -12.0 + 3.0 * lb, 0.05);
        PRUEF_NAH(db_von_pegel(t.l[s0 + 4 * 24000 * k + 2], 0.5 * MITTE), -12.0, 0.05);   // copy start: hk(0), also after a copy that ended at 0 dB
      }
    }
  }
  {  // T8.2 start in the middle: the transport starts at beat 6 and the first sound after the short fade-in is hk(6), not hk(0)
    for (int art : {0, 1}) {   // (BEATS starts mid unit the same way; RE-PITCH is enough for the warp map)
    Treiber t;
    aufbau(t, &a->a, {P(0, -12.f), P(16, 0.f)}, 120.0, 16.0, 1.0f, art);
    t.arr.start(6.0, 0, false, 0, V, 256, t.k);
    t.lauf(300000);
    const int64_t s0 = start_sample(t);
    for (int64_t d : {100, 1000, 12000}) PRUEF_NAH(db_von_pegel(t.l[s0 + d], 0.5 * MITTE), -12.0 + 12.0 * (6.0 + static_cast<double>(d) / 24000.0) / 16.0, 0.05);
    }
  }
  {  // T8.2 on top of the clip gain: clip gain 0.5 (-6.02 dB) and a flat envelope -12 dB give -18.02 dB
    for (int art : {0, 1, 2}) {
      Treiber t;
      aufbau(t, &a->a, {P(0, -12.f), P(16, -12.f)}, 120.0, 16.0, 0.5f, art);
      t.arr.start(0.0, 0, false, 0, V, 256, t.k);
      t.lauf(200000);
      const int64_t s0 = start_sample(t);
      PRUEF_NAH(db_von_pegel(t.l[s0 + 100000], 0.5 * MITTE), -12.0 + 20.0 * std::log10(0.5), 0.02);
    }
  }
  {  // merge gate 2: the fader dB rule. A table that starts at -200 (mute) runs from -60: at the middle of -200 -> 0 over 8 beats the level is -30 dB, not -100 dB
    for (int art : {0, 1}) {
      Treiber t;
      aufbau(t, &a->a, {P(0, -200.f), P(8, 0.f)}, 120.0, 16.0, 1.0f, art);
      t.arr.start(0.0, 0, false, 0, V, 256, t.k);
      t.lauf(300000);
      const int64_t s0 = start_sample(t);
      PRUEF_NAH(db_von_pegel(t.l[s0 + 4 * 24000], 0.5 * MITTE), -30.0, 0.05);
      PRUEF_NAH(db_von_pegel(t.l[s0 + 6 * 24000], 0.5 * MITTE), -15.0, 0.05);
      Treiber m;   // a mute table is mute: exactly 0
      aufbau(m, &a->a, {P(0, -200.f), P(16, -200.f)}, 120.0, 16.0, 1.0f, art);
      m.arr.start(0.0, 0, false, 0, V, 256, m.k);
      m.lauf(100000);
      float spitze = 0.0f;
      for (float x : m.l) spitze = std::max(spitze, std::fabs(x));
      PRUEF(spitze == 0.0f);
    }
  }
  {  // T8.2 steep: -60 -> 0 dB within half a beat (12000 samples, 0.005 dB per sample): the clip beat comes from the per-sample project beat, not from the sub-block start
    for (int art : {0, 1, 2}) {   // BEATS reads the clip beat from the map of the block, not from wp_: it must stay on the line as well
      Treiber t;
      aufbau(t, &a->a, {P(0, -60.f), P(2, -60.f), P(2.5, 0.f), P(16, 0.f)}, 120.0, 16.0, 1.0f, art);
      t.arr.start(0.0, 0, false, 0, V, 256, t.k);
      t.lauf(120000);
      const int64_t s0 = start_sample(t);
      for (double lb : {2.125, 2.25, 2.375}) PRUEF_NAH(db_von_pegel(t.l[s0 + std::llround(lb * 24000.0)], 0.5 * MITTE), -60.0 + 60.0 * (lb - 2.0) / 0.5, 0.1);
    }
  }
  {  // T8.2 loop wrap (B): bracket 0..16 over a 16-beat clip with a 3-point table. The voice of the new pass sits in the pool slot of the voice that ended on the
     // seam, whose cursor stands on the last point. The first sample after the wrap reads hk(0) = -12 dB (<= 1e-6 linear); the sample before it reads the end (about 0 dB).
    for (int art : {0, 1, 2})   // U8b: the warp paths wrap on the same seam
    for (double bpm : {120.0, 127.0}) {
      Treiber t;
      aufbau(t, &a->a, {P(0, -12.f), P(8, -6.f), P(16, 0.f)}, bpm, 16.0, 1.0f, art);
      t.arr.loop(true, 0.0, 16.0, 0, t.k);
      t.arr.start(0.0, 0, false, 0, V, 256, t.k);
      t.lauf(static_cast<int64_t>(15.5 * spb(bpm)));
      const int64_t s0 = start_sample(t);
      const int64_t naht = std::llround(t.k.sample_at(16.0 + t.k.beat_at(static_cast<double>(s0))));
      PRUEF(naht > t.s);
      t.n = 1;
      std::vector<float> rec(static_cast<size_t>(naht + 600), -2.0f);
      while (t.s < naht + 500) {
        t.lauf(t.s + 1);
        if (t.s - 1 > naht - 400) rec[static_cast<size_t>(t.s - 1)] = Z::hk_lin(t.arr);   // factor after the sample t.s - 1
      }
      PRUEF(rec[static_cast<size_t>(naht - 1)] > 0.995f && rec[static_cast<size_t>(naht - 1)] <= 1.0f);   // the end of the table: about 0 dB (held within 0.03 dB)
      PRUEF_NAH(rec[static_cast<size_t>(naht)], lin(-12.0), bpm == 120.0 ? 1e-6 : 5e-6);               // hk(0) on the first sample of the new pass
      PRUEF_NAH(rec[static_cast<size_t>(naht + 100)], lin(-12.0 + 6.0 * (100.0 / spb(bpm)) / 8.0 * 2.0 / 2.0), 2e-3);   // and it follows the line from there (6 dB per 8 beats)
      // way A: the level a few hundred samples into the new pass is on the line
      PRUEF_NAH(db_von_pegel(t.l[static_cast<size_t>(naht + 300)], 0.5 * MITTE), -12.0 + 6.0 * (300.0 / spb(bpm)) / 8.0, 0.05);
    }
  }
  {  // T8.4 a table change at a swap glides: constant -6 dB, then at beat 4 the snapshot changes only the table to constant -18 dB. No sample steps by more than the ramp of
     // ARR_NAHT samples allows, no new voice, no lost voice, and 200 samples later the level is -18 dB
    for (int art : {0, 1, 2}) {   // U8b: a table-only swap of a warped voice glides as well, no new voice (RE-PITCH, BEATS)
    const auto swap = [&](bool gleiche_tabelle, bool ohne_swap, std::vector<float>& aus, uint64_t& verloren, int& stimmen_nach) {
      Treiber t;
      aufbau(t, &a->a, {P(0, -6.f), P(16, -6.f)}, 120.0, 16.0, 1.0f, art);
      t.arr.start(0.0, 0, false, 0, V, 256, t.k);
      t.lauf(1024);
      t.lauf(start_sample(t) + 4 * 24000 + 12000);   // beat 4.5: in the middle of a BEATS unit (the unit ends fade over 96 samples), the swap sits away from them
      if (!ohne_swap) {
        Bau b;
        klipp(b, &a->a, gleiche_tabelle ? std::vector<ArrAutoPunkt>{P(0, -6.f), P(16, -6.f)} : std::vector<ArrAutoPunkt>{P(0, -18.f), P(16, -18.f)}, 16.0, 1.0f, art);
        t.laden(b.fertig());
      }
      const int64_t s_swap = t.s;
      t.lauf(s_swap + 1000);
      aus = t.l;
      aus.push_back(static_cast<float>(s_swap));
      verloren = t.arr.stimmen_verloren();
      stimmen_nach = t.arr.stimmen();
    };
    std::vector<float> geaendert, gleich, ohne;
    uint64_t v1 = 99, v2 = 99, v3 = 99;
    int n1 = 0, n2 = 0, n3 = 0;
    swap(false, false, geaendert, v1, n1);
    swap(true, false, gleich, v2, n2);
    swap(true, true, ohne, v3, n3);
    const int64_t s_swap = static_cast<int64_t>(geaendert.back());
    geaendert.pop_back();
    gleich.pop_back();
    ohne.pop_back();
    PRUEF(s_swap > 4 * 24000 && static_cast<int64_t>(geaendert.size()) > s_swap + 900);
    const double schritt_max = 0.5 * MITTE * (lin(-6.0) - lin(-18.0)) / 96.0 * 1.05;   // the ramp of ARR_NAHT samples from -6 to -18 dB, 5 % air
    double groesster = 0.0;
    for (int64_t i = s_swap - 4; i < s_swap + 300; ++i) groesster = std::max(groesster, std::fabs(static_cast<double>(geaendert[static_cast<size_t>(i)]) - geaendert[static_cast<size_t>(i - 1)]));
    PRUEF(groesster <= schritt_max);
    PRUEF(groesster > 0.5 * MITTE * (lin(-6.0) - lin(-18.0)) / 96.0 * 0.5);   // and it really glides: the steps are not all zero
    PRUEF_NAH(db_von_pegel(geaendert[static_cast<size_t>(s_swap - 10)], 0.5 * MITTE), -6.0, 0.02);
    PRUEF_NAH(db_von_pegel(geaendert[static_cast<size_t>(s_swap + 200)], 0.5 * MITTE), -18.0, 0.05);
    PRUEF(v1 == 0 && n1 == 1);   // no lost voice, one voice (not a second one next to the first)
    // negative control: the same table in a new snapshot changes nothing, bit for bit
    PRUEF(gleich == ohne && v2 == 0 && n2 == 1 && v3 == 0 && n3 == 1);
    }
  }
  {  // T8.4 an envelope added / removed at a swap glides as well (1 <-> table): 0 dB to -12 dB and back
    for (int art : {0, 1, 2})
    for (int richtung = 0; richtung < 2; ++richtung) {
      Treiber t;
      const std::vector<ArrAutoPunkt> tab = {P(0, -12.f), P(16, -12.f)};
      aufbau(t, &a->a, richtung == 0 ? std::vector<ArrAutoPunkt>{} : tab, 120.0, 16.0, 1.0f, art);
      t.arr.start(0.0, 0, false, 0, V, 256, t.k);
      t.lauf(1024);
      t.lauf(start_sample(t) + 4 * 24000 + 12000);   // beat 4.5: in the middle of a BEATS unit (the unit ends fade over 96 samples), the swap sits away from them
      Bau b;
      klipp(b, &a->a, richtung == 0 ? tab : std::vector<ArrAutoPunkt>{}, 16.0, 1.0f, art);
      t.laden(b.fertig());
      const int64_t s_swap = t.s;
      t.lauf(s_swap + 1000);
      const double soll_von = richtung == 0 ? 0.0 : -12.0, soll_nach = richtung == 0 ? -12.0 : 0.0;
      PRUEF_NAH(db_von_pegel(t.l[static_cast<size_t>(s_swap - 10)], 0.5 * MITTE), soll_von, 0.02);
      PRUEF_NAH(db_von_pegel(t.l[static_cast<size_t>(s_swap + 300)], 0.5 * MITTE), soll_nach, 0.05);
      const double schritt_max = 0.5 * MITTE * (1.0 - lin(-12.0)) / 96.0 * 1.05;
      double groesster = 0.0;
      for (int64_t i = s_swap - 4; i < s_swap + 300; ++i) groesster = std::max(groesster, std::fabs(static_cast<double>(t.l[static_cast<size_t>(i)]) - t.l[static_cast<size_t>(i - 1)]));
      PRUEF(groesster <= schritt_max && groesster > schritt_max * 0.4);
      PRUEF(t.arr.stimmen_verloren() == 0 && t.arr.stimmen() == 1);
    }
  }
  {  // T8.4 the tail copy carries the envelope: the clip (flat -12 dB) disappears at a swap. The tail is the old sound faded out over ARR_NAHT samples, at the envelope level
     // (-12 dB), not at 0 dB. Negative control: the same swap without an envelope fades from 0 dB.
    for (int art : {0, 1, 2})   // U8b: and the tail copy of a RE-PITCH voice and of a BEATS voice
    for (int mit = 1; mit >= 0; --mit) {
      Treiber t;
      aufbau(t, &a->a, mit ? std::vector<ArrAutoPunkt>{P(0, -12.f), P(16, -12.f)} : std::vector<ArrAutoPunkt>{}, 120.0, 16.0, 1.0f, art);
      t.arr.start(0.0, 0, false, 0, V, 256, t.k);
      t.lauf(1024);
      t.lauf(start_sample(t) + 4 * 24000 + 12000);   // beat 4.5: in the middle of a BEATS unit (the unit ends fade over 96 samples), the swap sits away from them
      Bau b;
      b.spur(1, ArrArt::audio);
      t.laden(b.fertig());   // the clip is gone
      const int64_t s_swap = t.s;
      t.lauf(s_swap + 400);
      const double voll = 0.5 * MITTE * (mit ? lin(-12.0) : 1.0);
      for (int q : {0, 24, 48, 72}) PRUEF_NAH(t.l[static_cast<size_t>(s_swap + q)] / voll, static_cast<double>(cdj::ARR_NAHT - q) / cdj::ARR_NAHT, 0.01);
      PRUEF(t.l[static_cast<size_t>(s_swap + 200)] == 0.0f);   // and it ends
    }
  }
  PRUEF_ENDE();
}
