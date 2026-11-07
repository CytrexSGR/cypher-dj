// 1.15 A4: multiband compressor on bus/1..4 (after the utility, before the fader, on the tap), through the Mixer. Every test runs on
// bus/1 AND bus/4 (the edges of the array) unless it says otherwise.
//  (M1)  mb/an 0 is bit-identical to a mixer that never saw the tool; on then off is bit-identical again, the object not in use
//  (M2)  mb/an 1 with all bands neutral: magnitude flat within 0.05 dB over 30 Hz .. 16 kHz, phase differs (positive control)
//  (M3)  a 632.5 Hz sine over the mid threshold is reduced by the library's analytic value (MbDetektor::statisch_db) within 0.1 dB
//  (M3b) the production default: a band compressed by about 6 dB keeps its level within 1 dB (automatic make-up on in the Mixer)
//  (M4)  umgehen per band: the band passes at gain 1 WITHOUT its makeup; the other bands keep working
//  (M5)  a crossover change while audio runs: test_mixer_multiband_grenzen.cpp (crossfade of two objects)
//  (M6)  the switching crossfade (D7, 480 samples, S-curve): both directions on a running signal, largest step against the natural
//        largest step of the twin; the fade lasts 480 samples
//  (M8)  exactly 4 buses with a multiband (two objects each since the M5 fix), created in the constructor, on the buses only
//  (D6)  switched off and on again: the state is reset (a fresh mixer and a re-used one agree bit for bit)
//  (D9)  a per-sample course counts with its last sample
//  (D1)  order: the utility acts BEFORE the multiband; PFL (the tap before the fader) hears the multiband at fader -200
//  (N)   a NaN: the F01 guard resets the multiband (envelope and fade), and it comes back without a long fade or a click
//  (Z)   guard of the index ranges: the sources never touch a multiband slot
#include <cmath>
#include <cstring>
#include <vector>

#include "cypherdj/dsp/multiband.h"
#include "mixer_wz_lauf.h"

using namespace wzt;
namespace dsp = cypherdj::dsp;

namespace {
constexpr int BUS3 = 16, BUS4 = 17;
double db_zu_amp(double db) { return std::pow(10.0, db / 20.0); }
double amp_zu_db(double a) { return 20.0 * std::log10(std::fmax(a, 1e-15)); }

// Energy of the master (left) over a number of blocks of a running sine on bus k; returns the level in dB.
double pegel_db(Lauf& l, int k, double f, double amp, int blocks) {
  double s = 0.0;
  for (int b = 0; b < blocks; ++b) {
    l.sinus(k, f, amp, amp);
    l.verarbeite();
    for (int i = 0; i < N; ++i) s += static_cast<double>(l.m->master_summe_l()[i]) * l.m->master_summe_l()[i];
  }
  return 10.0 * std::log10(std::fmax(s / (static_cast<double>(blocks) * N), 1e-30));
}
void mb_ein(Lauf& l, int k) { l.setze(k, "mb/an", 1.0f); }
void band(Lauf& l, int k, const char* b, float schwelle, float ratio, float attack = 10.0f, float release = 100.0f, float knie = 0.0f,
          float makeup = 0.0f) {
  const std::string p = std::string("mb/") + b + "/";
  l.setze(k, (p + "schwelle").c_str(), schwelle);
  l.setze(k, (p + "ratio").c_str(), ratio);
  l.setze(k, (p + "attack").c_str(), attack);
  l.setze(k, (p + "release").c_str(), release);
  l.setze(k, (p + "knie").c_str(), knie);
  l.setze(k, (p + "makeup").c_str(), makeup);
}
}  // namespace

int main() {
  // (M8) exactly 4 objects, created in the constructor (before any row is set or any block runs), on the buses only
  {
    sw::ReglerTabelle tab;
    cdj::Mixer m(tab);
    int n = 0;
    bool nur_busse = true;
    for (int k = 0; k < cdj::MIX_KANAELE; ++k) {
      const bool da = m.mb_objekt(k);
      n += da;
      nur_busse = nur_busse && (da == (k >= cdj::MIX_QUELLEN));
    }
    std::printf("M8: multiband on %d buses after the constructor, %d objects (two per bus: the second one is for the crossover crossfade)\n", n, m.mb_objekte());
    PRUEF(n == 4);
    PRUEF(m.mb_objekte() == 8);
    PRUEF(nur_busse);
    PRUEF(!m.mb_objekt(-1) && !m.mb_objekt(cdj::MIX_KANAELE));
  }
  for (const int K : {BUS1, BUS4}) {
    std::printf("-- bus %s\n", kname(K));
    // (M1) off = never saw the tool; on then off = identical again
    {
      Lauf a, b, c;
      b.setze(K, "mb/mitte/schwelle", -30.0f);   // moved, but mb/an stays 0
      b.setze(K, "mb/mitte/ratio", 8.0f);
      b.setze(K, "mb/grenze_tief", 400.0f);
      int aus_ungleich = 0, wieder_ungleich = 0, an_ungleich = 0;
      bool aktiv_an = false, aktiv_ende = true;
      for (int blk = 0; blk < 70; ++blk) {
        if (blk == 20) {
          mb_ein(c, K);
          band(c, K, "mitte", -30.0f, 8.0f);
        }
        if (blk == 40) c.setze(K, "mb/an", 0.0f);
        for (Lauf* l : {&a, &b, &c}) {
          l->sinus(K, 220.0, 0.3, 0.2);
          l->sinus(ERZ2, 330.0, 0.2, 0.1);
          l->verarbeite();
        }
        aus_ungleich += !gleich(a, b);
        if (blk >= 26 && blk < 40) an_ungleich += !gleich(a, c);
        if (blk == 30) aktiv_an = c.m->mb_aktiv(K);
        if (blk >= 43) wieder_ungleich += !gleich(a, c);   // the fade out (480 samples) ends inside block 41
        if (blk == 69) aktiv_ende = c.m->mb_aktiv(K);
      }
      std::printf("M1: off vs never: %d of 70 differ; on (blocks 26..39) differs in %d of 14 (positive control); on then off differs in %d of 27\n",
                  aus_ungleich, an_ungleich, wieder_ungleich);
      PRUEF(aus_ungleich == 0);
      PRUEF(an_ungleich == 14);
      PRUEF(aktiv_an);
      PRUEF(wieder_ungleich == 0);
      PRUEF(!aktiv_ende);
    }
    // (M2) neutral bands: magnitude flat within 0.05 dB over 30 Hz .. 16 kHz, phase differs
    {
      double groesste = 0.0, phase_diff = 0.0;
      for (const double f : {30.0, 50.0, 100.0, 200.0, 400.0, 632.5, 1000.0, 2000.0, 4000.0, 8000.0, 12000.0, 16000.0}) {
        Lauf ref, an;
        mb_ein(an, K);
        pegel_db(ref, K, f, 0.3, 60);   // settle (the fade is 480 samples, the 30 Hz allpass needs a good part of a second)
        pegel_db(an, K, f, 0.3, 60);
        const double d = pegel_db(an, K, f, 0.3, 300) - pegel_db(ref, K, f, 0.3, 300);
        groesste = std::fmax(groesste, std::fabs(d));
        if (f == 200.0) phase_diff = max_abstand(ref.m->master_summe_l(), an.m->master_summe_l(), N);
        PRUEF_NAH(d, 0.0, 0.05);
      }
      std::printf("M2: largest level difference 30 Hz .. 16 kHz %.4f dB; waveform difference at 200 Hz %.4f (positive control)\n", groesste, phase_diff);
      PRUEF(phase_diff > 0.05);
    }
    // (M3) 632.5 Hz sine, mid band: reduction by the library's analytic value
    {
      dsp::MbBandEinstellung e;
      e.schwelle_db = -20.0f;
      e.verhaeltnis = 4.0f;
      dsp::MbDetektor d;
      d.setze(e, 48000.0);
      const double soll = d.statisch_db(amp_zu_db(0.5));   // sample peak of the sine: -6.02 dBFS
      Lauf ref, an;
      mb_ein(an, K);
      band(an, K, "mitte", -20.0f, 4.0f, 10.0f, 100.0f);
      pegel_db(ref, K, 632.5, 0.5, 120);
      pegel_db(an, K, 632.5, 0.5, 120);
      const double ist = pegel_db(an, K, 632.5, 0.5, 40) - pegel_db(ref, K, 632.5, 0.5, 40);
      std::printf("M3: reduction measured %.4f dB, analytic %.4f dB\n", ist, soll);
      PRUEF(soll < -10.0);   // the curve is really reducing here
      PRUEF_NAH(ist, soll, 0.1);
    }
    // (M3b) the production default: a compressed band keeps its level (the automatic make-up is on in the Mixer, not a controller row).
    //       Mid band about 6 dB down (threshold -18 dB, ratio 2 on the -6 dBFS sine), level within 1 dB of the uncompressed run after 4 s.
    //       Red with CYPHERDJ_MUTATION_MB_AUSGLEICH_AUS (the Mixer leaves the automatic make-up off).
    {
      Lauf ref(true), an(true);
      mb_ein(an, K);
      band(an, K, "mitte", -18.0f, 2.0f, 5.0f, 80.0f);
      pegel_db(ref, K, 632.5, 0.5, 700);
      pegel_db(an, K, 632.5, 0.5, 700);   // 700 blocks of 256 = 3.7 s
      const double ist = pegel_db(an, K, 632.5, 0.5, 100) - pegel_db(ref, K, 632.5, 0.5, 100);
      const double red = static_cast<double>(an.m->mb_reduktion_db(K - cdj::MIX_QUELLEN, 1));   // >= 0
      std::printf("M3b: mid band reduced %.2f dB (meter), level against the uncompressed run %+.3f dB (limit 1)\n", red, ist);
      PRUEF(red > 5.0 && red < 7.0);   // the band really compresses (the meter reads the reduction as a positive number)
      PRUEF(std::fabs(ist) <= 1.0);
    }
    // (M4) umgehen per band: gain 1 without makeup; the other bands still work
    {
      const struct { const char* b; double f; } bd[] = {{"tief", 100.0}, {"mitte", 632.5}, {"hoch", 8000.0}};
      for (int i = 0; i < 3; ++i) {
        Lauf ref, an, um, andere;
        for (Lauf* l : {&an, &um, &andere}) {
          mb_ein(*l, K);
          band(*l, K, bd[i].b, -40.0f, 20.0f, 10.0f, 100.0f, 0.0f, 12.0f);   // reduces by about 32 dB, makeup +12
        }
        um.setze(K, (std::string("mb/") + bd[i].b + "/umgehen").c_str(), 1.0f);
        // another band bypassed: the one under test must keep working
        andere.setze(K, (std::string("mb/") + bd[(i + 1) % 3].b + "/umgehen").c_str(), 1.0f);
        double p[4] = {};
        Lauf* ls[4] = {&ref, &an, &um, &andere};
        for (int j = 0; j < 4; ++j) {
          pegel_db(*ls[j], K, bd[i].f, 0.5, 120);
          p[j] = pegel_db(*ls[j], K, bd[i].f, 0.5, 40);
        }
        std::printf("M4 band %s: reduced %.2f dB (makeup +12), bypassed %.4f dB (must be 0), another band bypassed %.2f dB\n", bd[i].b, p[1] - p[0],
                    p[2] - p[0], p[3] - p[0]);
        PRUEF(p[1] - p[0] < -12.0);        // positive control: without the bypass the band is reduced a lot
        PRUEF_NAH(p[2] - p[0], 0.0, 0.05);   // bypassed: gain 1, the +12 dB makeup is NOT applied
        PRUEF(p[3] - p[0] < -12.0);
      }
    }
    // (M6) switching crossfade, both directions, on a running signal; and its length
    {
      for (const double f : {100.0, 1000.0}) {
        double natuerlich = 0.0, ein_max = 0.0, aus_max = 0.0;
        for (int versatz = 0; versatz < 6; ++versatz) {
          Lauf ref, l;
          std::vector<float> vr, vl;
          const int WB = 40 + versatz, WA = 80 + versatz;
          for (int blk = 0; blk < 120; ++blk) {
            if (blk == WB) mb_ein(l, K);
            if (blk == WA) l.setze(K, "mb/an", 0.0f);
            for (Lauf* x : {&ref, &l}) {
              x->sinus(K, f + versatz * 7.0, 0.4, 0.4);
              x->verarbeite();
            }
            vr.insert(vr.end(), ref.m->master_summe_l(), ref.m->master_summe_l() + N);
            vl.insert(vl.end(), l.m->master_summe_l(), l.m->master_summe_l() + N);
            if (blk == WB) PRUEF(l.m->mb_blende(K) == 256);
            if (blk == WB + 1) PRUEF(l.m->mb_blende(K) == 480);
            if (blk == WA) PRUEF(l.m->mb_blende(K) == 480 - 256);
            if (blk == WA + 1) PRUEF(l.m->mb_blende(K) == 0);
          }
          for (size_t i = 50 * N; i < 100 * N; ++i) natuerlich = std::fmax(natuerlich, std::fabs(vr[i] - vr[i - 1]));
          for (size_t i = static_cast<size_t>(WB) * N; i < static_cast<size_t>(WB + 4) * N; ++i) ein_max = std::fmax(ein_max, std::fabs(vl[i] - vl[i - 1]));
          for (size_t i = static_cast<size_t>(WA) * N; i < static_cast<size_t>(WA + 4) * N; ++i) aus_max = std::fmax(aus_max, std::fabs(vl[i] - vl[i - 1]));
        }
        std::printf("M6 %.0f Hz: natural largest step %.4f; switching on %.4f (%.2fx), off %.4f (%.2fx); peak 0.4\n", f, natuerlich, ein_max,
                    ein_max / natuerlich, aus_max, aus_max / natuerlich);
        PRUEF(natuerlich > 0.005);
        PRUEF(ein_max <= natuerlich * 1.1);
        PRUEF(aus_max <= natuerlich * 1.1);
        if (f == 100.0) {   // the task's literal limit: below 0.1 of the peak (at 1 kHz the sine's own step is 0.13 of its peak)
          PRUEF(ein_max / 0.4 < 0.1);
          PRUEF(aus_max / 0.4 < 0.1);
        }
      }
    }
    // (D6) switched off and on again: the state is reset. A mixer that never ran the tool and one that ran it loudly and was switched off
    // agree bit for bit from the moment both switch on.
    {
      Lauf frisch, benutzt;
      for (int blk = 0; blk < 120; ++blk) {
        if (blk == 0) {
          mb_ein(benutzt, K);
          band(benutzt, K, "mitte", -40.0f, 20.0f, 1.0f, 5000.0f);   // slow release: the envelope stays deep
          benutzt.setze(K, "mb/mitte/makeup", 6.0f);
        }
        if (blk == 30) benutzt.setze(K, "mb/an", 0.0f);
        if (blk == 90) {
          for (Lauf* l : {&frisch, &benutzt}) {
            mb_ein(*l, K);
            band(*l, K, "mitte", -40.0f, 20.0f, 1.0f, 5000.0f);
            l->setze(K, "mb/mitte/makeup", 6.0f);
          }
        }
        for (Lauf* l : {&frisch, &benutzt}) {
          l->sinus(K, blk < 30 ? 632.5 : 250.0, blk < 30 ? 0.5 : 0.03, blk < 30 ? 0.5 : 0.03);
          l->verarbeite();
        }
        if (blk == 60) PRUEF(!benutzt.m->mb_aktiv(K));
      }
      // from block 90 on, the same input: compare the next blocks bit for bit
      int ungleich = 0;
      for (int blk = 120; blk < 150; ++blk) {
        for (Lauf* l : {&frisch, &benutzt}) {
          l->sinus(K, 250.0, 0.03, 0.03);
          l->verarbeite();
        }
        ungleich += !gleich(frisch, benutzt);
      }
      std::printf("D6: re-used vs fresh multiband, blocks 120..149: %d of 30 differ\n", ungleich);
      PRUEF(ungleich == 0);
    }
    // (D9) a per-sample course counts with its last sample: makeup 0 in the slot, a course that holds +12 dB in ONE block. Only that block
    // can tell (the block after it, nachfuehren has moved the slot value to the course's last sample). The makeup ramp inside the library is
    // 5 ms (240 samples), so the last samples of the block carry the full gain; both runs have the multiband on, so the waveforms agree.
    {
      Lauf ref, c;
      mb_ein(c, K);
      mb_ein(ref, K);
      std::vector<float> vl(N, 12.0f);
      double d = 0.0;
      for (int blk = 0; blk < 41; ++blk) {
        for (Lauf* l : {&ref, &c}) l->sinus(K, 632.5, 0.1, 0.1);
        if (blk == 40) c.m->verlauf(c.r((std::string(kname(K)) + "/mb/mitte/makeup").c_str()), vl.data());
        ref.verarbeite();
        c.verarbeite();
        if (blk == 40) {
          double sr = 0.0, sc = 0.0;
          for (int i = 246; i < N; ++i) {
            sr += static_cast<double>(ref.m->master_summe_l()[i]) * ref.m->master_summe_l()[i];
            sc += static_cast<double>(c.m->master_summe_l()[i]) * c.m->master_summe_l()[i];
          }
          d = 10.0 * std::log10(std::fmax(sc, 1e-30) / std::fmax(sr, 1e-30));
        }
      }
      std::printf("D9: course ending on +12 dB while the slot value is 0: gain at the end of the block %.2f dB (the last sample counts: 12)\n", d);
      PRUEF_NAH(d, 12.0, 0.5);
    }
    // (D1) order: the utility acts BEFORE the multiband. L-only sine 0.4; breite 0 turns it into 0.2 / 0.2 (mono); threshold -10 dBFS
    // with ratio 20: the multiband reduces if it sees 0.2 on both sides... it sees max(|L|,|R|) = 0.2 after the utility (-14 dBFS, under
    // the threshold: untouched), but 0.4 (-8 dBFS, over it) if it comes first.
    {
      Lauf ref, g;
      for (Lauf* l : {&ref, &g}) l->setze(K, "util/breite", 0.0f);
      mb_ein(g, K);
      band(g, K, "mitte", -10.0f, 20.0f, 1.0f, 100.0f);
      mb_ein(ref, K);
      double d = 0.0;
      for (int blk = 0; blk < 100; ++blk)
        for (Lauf* l : {&ref, &g}) {
          l->sinus(K, 632.5, 0.4, 0.0);
          l->verarbeite();
          if (blk == 99 && l == &g) d = rms_db(g.m->master_summe_l(), N) - rms_db(ref.m->master_summe_l(), N);
        }
      std::printf("D1: multiband (-10 dBFS) behind the utility (mono, -14 dBFS): level difference %.2f dB (0 = untouched)\n", d);
      PRUEF_NAH(d, 0.0, 0.1);
    }
    // (D1) PFL hears the multiband (the tap before the fader), fader at -200
    {
      Lauf aus, an;
      for (Lauf* l : {&aus, &an}) {
        l->setze(K, "fader", -200.0f);
        l->setze(K, "pfl", 1.0f);
      }
      mb_ein(an, K);
      band(an, K, "mitte", -40.0f, 20.0f, 1.0f, 100.0f);
      for (int blk = 0; blk < 80; ++blk)
        for (Lauf* l : {&aus, &an}) {
          l->sinus(K, 632.5, 0.2, 0.2);
          l->verarbeite();
        }
      const double ca = rms_db(aus.cl, N), cb = rms_db(an.cl, N);
      std::printf("D1: cue %.2f dB without, %.2f dB with the multiband (fader -200)\n", ca, cb);
      PRUEF(ca > -40.0);   // positive control: the cue hears the channel at all
      PRUEF(ca - cb > 10.0);
    }
    // (N) a NaN on a bus with the multiband in a deep reduction: the F01 guard resets it
    {
      Lauf ref, g;
      for (Lauf* l : {&ref, &g}) {
        mb_ein(*l, K);
        band(*l, K, "mitte", -40.0f, 20.0f, 1.0f, 5000.0f);   // release 5 s: a held envelope would last for the whole run
      }
      double vorher = 0.0, direkt = 0.0, spaet = 0.0;
      bool alle_endlich = true;
      int still = 0;
      std::vector<float> v;
      const int WN = 60;
      for (int blk = 0; blk < 140; ++blk) {
        const bool laut = blk < WN;
        for (Lauf* l : {&ref, &g}) l->sinus(K, 632.5, laut ? 0.5 : 0.01, laut ? 0.5 : 0.01);
        if (blk == WN) g.m->eingang_l(K)[10] = NAN;
        // the twin gets the same quiet signal but is reset the same way by switching: reference for "no old reduction" is a fresh mixer
        ref.verarbeite();
        g.verarbeite();
        bool endlich = true;
        for (int i = 0; i < N; ++i)
          endlich = endlich && std::isfinite(g.ml[i]) && std::isfinite(g.mr[i]) && std::isfinite(g.cl[i]) && std::isfinite(g.cr[i]);
        alle_endlich = alle_endlich && endlich;
        if (blk == WN - 1) vorher = rms_db(g.m->master_summe_l(), N);
        if (blk >= WN && spitze_db(g.m->master_summe_l(), N) < -100.0) ++still;
        if (blk >= WN + 1) v.insert(v.end(), g.m->master_summe_l(), g.m->master_summe_l() + N);
        if (blk == WN + 3) direkt = rms_db(g.m->master_summe_l(), N);
        if (blk == 139) spaet = rms_db(g.m->master_summe_l(), N);
      }
      // reference level of the quiet sine through a FRESH multiband (never reduced): started quiet, same bus
      Lauf frisch;
      mb_ein(frisch, K);
      band(frisch, K, "mitte", -40.0f, 20.0f, 1.0f, 5000.0f);
      double fr = 0.0;
      for (int blk = 0; blk < 140; ++blk) {
        frisch.sinus(K, 632.5, 0.01, 0.01);
        frisch.verarbeite();
        if (blk == WN + 3) fr = rms_db(frisch.m->master_summe_l(), N);
      }
      double fr_spaet = rms_db(frisch.m->master_summe_l(), N);
      std::printf("N: silent blocks %d, all outputs finite %d, level 3 blocks after the NaN %.2f dB vs fresh multiband %.2f dB; at the end %.2f vs %.2f dB; nan_treffer %lld; "
                  "level before the NaN %.1f dB\n", still, alle_endlich, direkt, fr, spaet, fr_spaet, static_cast<long long>(g.m->nan_treffer()), vorher);
      PRUEF(alle_endlich);
      PRUEF(still == 1);
      PRUEF(g.m->nan_treffer() == 1);
      PRUEF_NAH(direkt, fr, 0.5);     // no old reduction is carried through the guard (5 s release)
      PRUEF_NAH(spaet, fr_spaet, 1.0);   // the onset transients of the two starts differ (1 dB class); an old reduction would be 10 dB and more
    }
    // (N2) the same with the SECOND object active: after a finished crossover change the guard must reset that one too (the first one rests).
    // Without it the deep reduction (release 5 s) of the active object survives the NaN. The twin has no crossover change.
    {
      auto lauf = [&](bool wechsel, double& direkt, unsigned& blenden) {
        Lauf g;
        mb_ein(g, K);
        band(g, K, "mitte", -40.0f, 20.0f, 1.0f, 5000.0f);
        const int WN = 100;
        for (int blk = 0; blk < WN + 4; ++blk) {
          if (wechsel && blk == 20) g.setze(K, "mb/grenze_hoch", 1500.0f);   // finished long before the NaN (warm-up 20 ms + 10 ms)
          const double amp = blk < WN ? 0.5 : 0.01;
          g.sinus(K, 632.5, amp, amp);
          if (blk == WN) g.m->eingang_l(K)[10] = NAN;
          g.verarbeite();
          if (blk == WN + 3) direkt = rms_db(g.m->master_summe_l(), N);
        }
        blenden = g.m->mb_blenden(K);
      };
      double d0 = 0.0, d1 = 0.0;
      unsigned b0 = 0, b1 = 0;
      lauf(false, d0, b0);
      lauf(true, d1, b1);
      std::printf("N2: level 3 blocks after the NaN: first object active %.2f dB (%u crossfades), second object active %.2f dB (%u crossfades)\n", d0, b0, d1, b1);
      PRUEF(b0 == 0 && b1 == 1);       // the second object really took over
      PRUEF(d0 < -30.0 && d0 > -70.0);   // sane level, not silence and not the held reduction
      PRUEF_NAH(d1, d0, 0.7);
    }
  }
  // (N, click) after the guard, with a running loud signal, the multiband is back without a long fade and without a click: the largest step
  // after the silent block against the natural largest step
  {
    // the twin takes the same NaN without the multiband: its guard restart is the baseline (the EQ and filter stages restart too)
    Lauf ref, g;
    mb_ein(g, BUS1);
    std::vector<float> v, vr;
    const int WN = 60;
    for (int blk = 0; blk < WN + 10; ++blk) {
      for (Lauf* l : {&ref, &g}) l->sinus(BUS1, 400.0, 0.4, 0.4);
      if (blk == WN) {
        g.m->eingang_l(BUS1)[10] = NAN;
        ref.m->eingang_l(BUS1)[10] = NAN;
      }
      ref.verarbeite();
      g.verarbeite();
      if (blk >= WN + 1) {
        v.insert(v.end(), g.m->master_summe_l(), g.m->master_summe_l() + N);
        vr.insert(vr.end(), ref.m->master_summe_l(), ref.m->master_summe_l() + N);
      }
      if (blk == WN + 1) PRUEF(g.m->mb_aktiv(BUS1));
    }
    double groesster = 0.0, natuerlich = 0.0;
    for (size_t i = 1; i < v.size(); ++i) {
      groesster = std::fmax(groesster, std::fabs(v[i] - v[i - 1]));
      natuerlich = std::fmax(natuerlich, std::fabs(vr[i] - vr[i - 1]));
    }
    std::printf("N click: largest step after the guard %.4f, the twin without the multiband %.4f (%.2fx)\n", groesster, natuerlich, groesster / natuerlich);
    PRUEF(natuerlich > 0.01);
    PRUEF(groesster <= natuerlich * 1.1);
    PRUEF(g.m->mb_blende(BUS1) == 480);   // the fade came back in at most 480 samples (D7), not longer
  }
  // (Z) the sources never touch a multiband slot: moving every mb row of bus/1 does not change a source channel; and a source channel
  // run on its own with all multiband rows moved is bit-identical to a mixer that did not move them
  {
    Lauf a, b;
    for (const char* s : {"mb/an", "mb/grenze_tief", "mb/mitte/ratio", "mb/hoch/makeup"}) b.setze(BUS4, s, s[3] == 'a' ? 1.0f : 5.0f);
    b.setze(BUS4, "mb/an", 0.0f);
    int ungleich = 0;
    for (int blk = 0; blk < 40; ++blk)
      for (Lauf* l : {&a, &b}) {
        l->sinus(0, 500.0, 0.3, 0.2);
        l->sinus(ERZ1, 300.0, 0.3, 0.2);
        l->sinus(PAD2, 900.0, 0.3, 0.2);
        l->verarbeite();
        if (l == &b) ungleich += !gleich(a, b);
      }
    PRUEF(ungleich == 0);
  }
  PRUEF_ENDE();
}
