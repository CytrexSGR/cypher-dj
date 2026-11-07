// 1.15 A3: utility in the channel strip (after trim/EQ/kill/filter/colour, before gate and compressor), through the Mixer.
//  (U1) every utility value neutral: master, cue and ear tap bit-identical to a mixer that never saw the tool; the object is not in use
//  (U2) breite 0 on a hard-panned sine: L equals R at the master (positive control: off, L differs from R)
//  (U3) bassmono 120 Hz: an anti-phase 60 Hz sine becomes (almost) silent, an anti-phase 2 kHz sine stays
//  (U4) phase_l inverts the left channel
//  (U5) tausch swaps the sides
//  (U6) back to neutral: after the ramp bit-identical again and the object not called any more; positive control: not neutral differs
//  (U7) the same row set works on bus/1
//  (R)  the ramp survives on deck/1, deck/4, erz/1, pad/2 and bus/4 (max step per sample < 0.001); U2..U6 run on erz/1, deck/1 and deck/4
// The golden digest of the neutral mixer is test_mixer_golden (A0).
#include "mixer_wz_lauf.h"

using namespace wzt;

namespace {
const int KANAELE_U[] = {0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13, 14, 15, 16, 17};   // Q13 and B4, not erz/8

void neutral_setzen(Lauf& l, int k) {
  l.setze(k, "util/balance", 0.0f);
  l.setze(k, "util/breite", 100.0f);
  l.setze(k, "util/bassmono", 0.0f);
  for (const char* s : {"util/phase_l", "util/phase_r", "util/tausch", "util/dc"}) l.setze(k, s, 0.0f);
}
}  // namespace

int main() {
  // (U1) neutral values written explicitly (and gate values moved with gate/an 0) = a mixer that never saw the tool
  {
    Lauf a, b;
    for (int k : KANAELE_U) neutral_setzen(b, k);
    b.setze(ERZ1, "gate/schwelle", -3.0f);   // a gate that would cut everything, but is off
    int ungleich = 0;
    for (int blk = 0; blk < 60; ++blk) {
      const int n = blk % 7 == 3 ? 61 : (blk % 11 == 5 ? 1000 : N);
      for (Lauf* l : {&a, &b}) {
        l->sinus(DECK1, 440.0, 0.4, 0.3, n);
        l->sinus(ERZ1, 1000.0, 0.5, 0.0, n);
        l->rausch(ERZ2, 0.2, n);
        l->sinus(ERZ4, 60.0, 0.5, -0.5, n);
        l->sinus(PAD2, 3000.0, 0.1, 0.2, n);
        l->verarbeite(n);
      }
      ungleich += !gleich(a, b, n);
    }
    PRUEF(ungleich == 0);
    for (int k = 0; k < cdj::MIX_KANAELE; ++k) PRUEF(!b.m->util_aktiv(k));
    std::printf("U1: %d of 60 blocks differ, utility in use on any channel: %d\n", ungleich, b.m->util_aktiv(ERZ1));
  }
  // U2..U6 on a strip of the erz kind, on deck/1 and on deck/4 (A3 fix round: the first version ran on erz/1 only and missed the decks)
  for (const int K : {ERZ1, DECK1, 3}) {
    std::printf("-- channel %s\n", kname(K));
  // (U2) breite 0: mono
  {
    Lauf aus, an;
    an.setze(K, "util/breite", 0.0f);
    double d_an = 0.0, d_aus = 0.0, pegel = 0.0;
    for (int blk = 0; blk < 12; ++blk) {
      for (Lauf* l : {&aus, &an}) {
        l->sinus(K, 1000.0, 0.5, 0.0);
        l->verarbeite();
      }
      if (blk >= 6) {
        d_an = std::fmax(d_an, max_abstand(an.m->master_summe_l(), an.m->master_summe_r(), N));
        d_aus = std::fmax(d_aus, max_abstand(aus.m->master_summe_l(), aus.m->master_summe_r(), N));
        pegel = spitze_db(an.m->master_summe_l(), N);
      }
    }
    std::printf("U2: |L-R| max with breite 0: %.3g, off: %.3g, level L %.2f dBFS (expected -12.04)\n", d_an, d_aus, pegel);
    PRUEF(d_aus > 0.4);          // positive control: hard panned without the tool
    PRUEF(d_an < 1e-6);          // mono
    PRUEF_NAH(pegel, 20.0 * std::log10(0.25), 0.05);
    PRUEF(an.m->util_aktiv(K));
  }
  // (U3) bassmono 120 Hz: anti-phase (side only) signals; 60 Hz goes mono = cancels, 2 kHz stays
  {
    double rest[2] = {}, bleibt[2] = {};
    for (int mit = 0; mit < 2; ++mit) {
      Lauf l60, l2k;
      if (mit) {
        l60.setze(K, "util/bassmono", 120.0f);
        l2k.setze(K, "util/bassmono", 120.0f);
      }
      for (int blk = 0; blk < 24; ++blk) {
        l60.sinus(K, 60.0, 0.5, -0.5);
        l60.verarbeite();
        l2k.sinus(K, 2000.0, 0.5, -0.5);
        l2k.verarbeite();
      }
      rest[mit] = rms_db(l60.m->master_summe_l(), N);
      bleibt[mit] = rms_db(l2k.m->master_summe_l(), N);
    }
    std::printf("U3: 60 Hz anti-phase: %.1f dB off, %.1f dB bassmono 120; 2 kHz: %.2f dB off, %.2f dB bassmono 120\n", rest[0], rest[1],
                bleibt[0], bleibt[1]);
    PRUEF(rest[0] > -10.0);                   // positive control: without the tool the bass passes
    PRUEF(rest[1] < rest[0] - 30.0);          // mono bass: cancelled
    PRUEF_NAH(bleibt[1], bleibt[0], 0.1);     // highs unchanged
  }
  // (U4) phase_l, (U5) tausch: exact against the untouched mixer
  {
    Lauf ref, p, t;
    p.setze(K, "util/phase_l", 1.0f);
    t.setze(K, "util/tausch", 1.0f);
    bool u4 = true, u5 = true;
    for (int blk = 0; blk < 12; ++blk) {
      for (Lauf* l : {&ref, &p, &t}) {
        l->sinus(K, 1000.0, 0.5, 0.2);
        l->verarbeite();
      }
      if (blk < 6) continue;
      for (int i = 0; i < N; ++i) {
        u4 = u4 && std::fabs(p.m->master_summe_l()[i] + ref.m->master_summe_l()[i]) < 1e-7 &&
             p.m->master_summe_r()[i] == ref.m->master_summe_r()[i];
        u5 = u5 && std::fabs(t.m->master_summe_l()[i] - ref.m->master_summe_r()[i]) < 1e-7 &&
             std::fabs(t.m->master_summe_r()[i] - ref.m->master_summe_l()[i]) < 1e-7;
      }
    }
    PRUEF(u4);
    PRUEF(u5);
    PRUEF(max_abstand(ref.m->master_summe_l(), ref.m->master_summe_r(), N) > 0.1);   // positive control: the sides differ at all
  }
  // (U6) back to neutral
  {
    Lauf a, b;
    int vorher_ungleich = 0, nachher_ungleich = 0;
    bool aktiv_mitte = false, aktiv_ende = true;
    for (int blk = 0; blk < 60; ++blk) {
      if (blk == 10) {
        b.setze(K, "util/balance", 0.5f);
        b.setze(K, "util/bassmono", 150.0f);
        b.setze(K, "util/dc", 1.0f);
        b.setze(K, "util/tausch", 1.0f);
      }
      if (blk == 30) neutral_setzen(b, K);
      for (Lauf* l : {&a, &b}) {
        l->sinus(K, 100.0, 0.5, 0.3);
        l->verarbeite();
      }
      if (blk >= 12 && blk < 30) vorher_ungleich += !gleich(a, b);
      if (blk == 20) aktiv_mitte = b.m->util_aktiv(K);
      if (blk >= 34) nachher_ungleich += !gleich(a, b);
      if (blk == 59) aktiv_ende = b.m->util_aktiv(K);
    }
    std::printf("U6: blocks 12..29 differ: %d of 18 (positive control); blocks 34..59 differ: %d of 26; in use mid-run %d, at the end %d\n",
                vorher_ungleich, nachher_ungleich, aktiv_mitte, aktiv_ende);
    PRUEF(vorher_ungleich == 18);   // positive control: not neutral differs
    PRUEF(aktiv_mitte);
    PRUEF(nachher_ungleich == 0);   // after the ramp bit-identical again
    PRUEF(!aktiv_ende);             // and the object no longer called
  }
  }
  // (R) the ramp inside the utility survives on every strip: breite 0 <-> 100 on a constant input, no step per sample above 0.001
  // (a jump would be 0.25; the ramp is 0.25 / 480 = 0.0005). deck/1 and deck/4 first, because there the gate array once ended on util_[0..3].
  {
    struct Fall { const char* name; int util_kanal; int quelle; int ziel; };
    const Fall faelle[] = {{"deck/1", DECK1, DECK1, 0}, {"deck/4", 3, 3, 0}, {"erz/1", ERZ1, ERZ1, 0}, {"pad/2", PAD2, PAD2, 0}, {"bus/4", BUS1 + 3, ERZ1, 4}};
    for (const Fall& f : faelle)
      for (int richtung = 0; richtung < 2; ++richtung) {
        Lauf l;
        const float von = richtung ? 100.0f : 0.0f, nach = richtung ? 0.0f : 100.0f;
        if (f.ziel) l.setze(f.quelle, "ziel", static_cast<float>(f.ziel));
        l.setze(f.util_kanal, "util/breite", von);
        std::vector<float> spur;
        for (int blk = 0; blk < 16; ++blk) {
          if (blk == 8) l.setze(f.util_kanal, "util/breite", nach);
          for (int i = 0; i < N; ++i) {
            l.m->eingang_l(f.quelle)[i] = 0.5f;
            l.m->eingang_r(f.quelle)[i] = 0.0f;
          }
          l.verarbeite();
          if (blk >= 7) spur.insert(spur.end(), l.m->master_summe_l(), l.m->master_summe_l() + N);
        }
        double m = 0.0;
        for (size_t i = 1; i < spur.size(); ++i) m = std::fmax(m, std::fabs(static_cast<double>(spur[i]) - spur[i - 1]));
        const double ende = spur.back(), soll = nach == 0.0f ? 0.25 : 0.5;
        std::printf("R: %-6s breite %3.0f -> %3.0f: max step per sample %.6f, end value %.4f\n", f.name, von, nach, m, ende);
        PRUEF(m > 0.0003);          // the ramp is seen at all (a constant input would give 0 if nothing moved)
        PRUEF(m < 0.001);           // and it is a ramp, not a jump (0.25)
        PRUEF_NAH(ende, soll, 0.01);
      }
  }
  // (U7) on a bus: erz/1 -> bus/1, tausch on bus/1
  {
    Lauf ref, bus, neutral;
    for (Lauf* l : {&ref, &bus, &neutral}) l->setze(ERZ1, "ziel", 1.0f);
    bus.setze(BUS1, "util/tausch", 1.0f);
    for (int k : {BUS1}) neutral_setzen(neutral, k);
    bool getauscht = true, neutral_gleich = true;
    for (int blk = 0; blk < 14; ++blk) {
      for (Lauf* l : {&ref, &bus, &neutral}) {
        l->sinus(ERZ1, 1000.0, 0.5, 0.0);
        l->verarbeite();
      }
      neutral_gleich = neutral_gleich && gleich(ref, neutral);
      if (blk >= 8)
        getauscht = getauscht && max_abstand(bus.m->master_summe_r(), ref.m->master_summe_l(), N) < 1e-7 &&
                    max_abstand(bus.m->master_summe_l(), ref.m->master_summe_r(), N) < 1e-7;
    }
    PRUEF(max_abstand(ref.m->master_summe_l(), ref.m->master_summe_r(), N) > 0.1);   // positive control: the bus carries the signal
    PRUEF(getauscht);
    PRUEF(neutral_gleich);
    PRUEF(bus.m->util_aktiv(BUS1));
    PRUEF(!neutral.m->util_aktiv(BUS1));
  }
  PRUEF_ENDE();
}
