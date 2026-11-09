// 1.15 A6: the three gain-reduction getters of the Mixer (feed of /zustand/mix), through the Mixer on the default table.
//  (R1) gate_reduktion_db: 0 while the gate is off; a -60 dBFS noise under threshold -40 drives it towards the floor (positive, > 40 dB);
//       a -20 dBFS sine over the threshold keeps it at 0 while the gate runs (positive control: running and open is 0, not "no reading");
//       switched off again it is 0 within a few blocks
//  (R2) mb_reduktion_db: bus 0 with mb/an 1 and a 1 kHz sine over the mid band's threshold: mid > 3 dB, low and high 0 (the bands are
//       told apart), all >= 0; mb/an 0 gives 0 again once the 480-sample fade is over
//  (R3) the range contract, run under CYPHERDJ_SANITIZE=ON: gate k = -1, 11 (erz/8, no object), 14..17, 18, 1000, INT_MIN/MAX; mb bus
//       -1, 4, 14, INT_MIN/MAX and band -1, 3, INT_MAX: all 0 and no indexing (UBSan aborts on an out-of-bounds read)
//  (R5) the upper edges read positively: gate on pad/1 (k=12) and pad/2 (k=13), multiband on bus/4 (bus 3)
//  (R4) kanal_limiter_reduktion_db with no limiter built: 0 for bus 0..3 and for anything else
#include <climits>
#include <cmath>

#include "mixer_wz_run.h"

using namespace wzt;

constexpr int BUS4 = 17;   // bus/4, the last mixer channel (not in the shared header)

int main() {
  // (R1) gate
  {
    Lauf l;
    for (int blk = 0; blk < 30; ++blk) {
      l.rausch(ERZ1, 0.001);   // -60 dBFS
      l.verarbeite();
    }
    PRUEF(!l.m->gate_aktiv(ERZ1));
    PRUEF(l.m->gate_reduktion_db(ERZ1) == 0.0f);   // off: 0

    l.setze(ERZ1, "gate/an", 1.0f);
    l.setze(ERZ1, "gate/schwelle", -40.0f);
    l.setze(ERZ1, "gate/bereich", -80.0f);
    l.setze(ERZ1, "gate/release", 50.0f);
    for (int blk = 0; blk < 120; ++blk) {
      l.rausch(ERZ1, 0.001);
      l.verarbeite();
    }
    const float zu = l.m->gate_reduktion_db(ERZ1);
    std::printf("R1: gate closed on noise -60 dBFS (threshold -40, floor -80): reduction %.2f dB\n", zu);
    PRUEF(l.m->gate_aktiv(ERZ1));
    PRUEF(zu > 40.0f && zu <= 120.0f);
    PRUEF(std::isfinite(zu));
    PRUEF(l.m->gate_reduktion_db(ERZ2) == 0.0f);   // another channel, gate off

    for (int blk = 0; blk < 60; ++blk) {
      l.sinus(ERZ1, 1000.0, 0.1, 0.1);   // -20 dBFS, over the threshold: opens
      l.verarbeite();
    }
    const float offen = l.m->gate_reduktion_db(ERZ1);
    std::printf("R1: gate open on a -20 dBFS sine: reduction %.4f dB, running %d\n", offen, (int)l.m->gate_aktiv(ERZ1));
    PRUEF(l.m->gate_aktiv(ERZ1));
    PRUEF(offen >= 0.0f && offen < 0.5f);

    l.setze(ERZ1, "gate/an", 0.0f);
    for (int blk = 0; blk < 4; ++blk) {
      l.rausch(ERZ1, 0.001);
      l.verarbeite();
    }
    PRUEF(!l.m->gate_aktiv(ERZ1));
    PRUEF(l.m->gate_reduktion_db(ERZ1) == 0.0f);
  }

  // (R2) multiband
  {
    Lauf l;
    for (int blk = 0; blk < 20; ++blk) {
      l.sinus(BUS1, 1000.0, 0.3, 0.3);
      l.verarbeite();
    }
    for (int b = 0; b < 4; ++b)
      for (int band = 0; band < 3; ++band) PRUEF(l.m->mb_reduktion_db(b, band) == 0.0f);   // off: 0

    l.setze(BUS1, "mb/an", 1.0f);
    l.setze(BUS1, "mb/mitte/schwelle", -30.0f);
    l.setze(BUS1, "mb/mitte/ratio", 8.0f);
    l.setze(BUS1, "mb/mitte/attack", 1.0f);
    for (int blk = 0; blk < 120; ++blk) {
      l.sinus(BUS1, 1000.0, 0.3, 0.3);
      l.verarbeite();
    }
    const float tief = l.m->mb_reduktion_db(0, 0), mitte = l.m->mb_reduktion_db(0, 1), hoch = l.m->mb_reduktion_db(0, 2);
    std::printf("R2: bus/1 multiband on a 1 kHz sine at -10 dBFS, mid threshold -30 ratio 8: low %.3f, mid %.3f, high %.3f dB\n", tief, mitte,
                hoch);
    PRUEF(l.m->mb_aktiv(BUS1));
    PRUEF(mitte > 3.0f);
    PRUEF(tief >= 0.0f && tief < 0.1f);
    PRUEF(hoch >= 0.0f && hoch < 0.1f);
    PRUEF(std::isfinite(mitte));
    PRUEF(l.m->mb_reduktion_db(1, 1) == 0.0f);   // bus/2 has no tool running

    // R3 inside the running state: a band outside 0..2 must not read the neighbour (band 3 would be past the array)
    PRUEF(l.m->mb_reduktion_db(0, 3) == 0.0f);
    PRUEF(l.m->mb_reduktion_db(0, -1) == 0.0f);

    l.setze(BUS1, "mb/an", 0.0f);
    for (int blk = 0; blk < 6; ++blk) {
      l.sinus(BUS1, 1000.0, 0.3, 0.3);
      l.verarbeite();
    }
    PRUEF(!l.m->mb_aktiv(BUS1));
    for (int band = 0; band < 3; ++band) PRUEF(l.m->mb_reduktion_db(0, band) == 0.0f);
  }

  // (R3) range contract, with the tools running so that an unguarded read would find a non-zero neighbour
  {
    Lauf l;
    l.setze(ERZ1, "gate/an", 1.0f);
    l.setze(ERZ1, "gate/schwelle", -40.0f);
    l.setze(BUS1, "mb/an", 1.0f);
    l.setze(BUS1, "mb/mitte/schwelle", -30.0f);
    l.setze(BUS1, "mb/mitte/ratio", 8.0f);
    for (int blk = 0; blk < 120; ++blk) {
      l.rausch(ERZ1, 0.001);
      l.sinus(BUS1, 1000.0, 0.3, 0.3);
      l.verarbeite();
    }
    PRUEF(l.m->gate_reduktion_db(ERZ1) > 40.0f);   // positive control: in range it reads
    PRUEF(l.m->mb_reduktion_db(0, 1) > 3.0f);
    for (const int k : {-1, ERZ8, 14, 15, 16, 17, 18, 100, 1000, INT_MIN, INT_MAX}) PRUEF(l.m->gate_reduktion_db(k) == 0.0f);
    for (const int bus : {-1, 4, 5, 14, 17, 1000, INT_MIN, INT_MAX})
      for (const int band : {0, 1, 2}) PRUEF(l.m->mb_reduktion_db(bus, band) == 0.0f);
    for (const int band : {-1, 3, 4, 1000, INT_MIN, INT_MAX})
      for (const int bus : {0, 1, 2, 3}) PRUEF(l.m->mb_reduktion_db(bus, band) == 0.0f);
  }

  // (R5) the upper edges read positively: gate on pad/1 (k=12) and pad/2 (k=13, the last source channel), multiband on bus/4 (bus 3, the last bus)
  {
    Lauf l;
    for (const int k : {PAD1, PAD2}) {
      l.setze(k, "gate/an", 1.0f);
      l.setze(k, "gate/schwelle", -40.0f);
    }
    l.setze(BUS4, "mb/an", 1.0f);
    l.setze(BUS4, "mb/mitte/schwelle", -30.0f);
    l.setze(BUS4, "mb/mitte/ratio", 8.0f);
    for (int blk = 0; blk < 120; ++blk) {
      l.rausch(PAD1, 0.001);
      l.rausch(PAD2, 0.001);
      l.sinus(BUS4, 1000.0, 0.3, 0.3);
      l.verarbeite();
    }
    std::printf("R5: pad/1 %.2f dB, pad/2 %.2f dB, bus/4 mid %.3f dB, bus/4 low %.3f, bus/1 mid %.3f\n", l.m->gate_reduktion_db(PAD1),
                l.m->gate_reduktion_db(PAD2), l.m->mb_reduktion_db(3, 1), l.m->mb_reduktion_db(3, 0), l.m->mb_reduktion_db(0, 1));
    PRUEF(l.m->gate_reduktion_db(PAD1) > 40.0f);
    PRUEF(l.m->gate_reduktion_db(PAD2) > 40.0f);
    PRUEF(l.m->mb_reduktion_db(3, 1) > 3.0f);
    PRUEF(l.m->mb_reduktion_db(3, 0) < 0.1f);   // the right band of the right bus
    PRUEF(l.m->mb_reduktion_db(0, 1) == 0.0f);  // negative control: bus/1 has no tool
    PRUEF(l.m->gate_reduktion_db(ERZ1) == 0.0f);
  }

  // (R4) limiter not built: 0 (the built case is pinned in test_mixer_kanal_limiter)
  {
    Lauf l;
    for (const int bus : {-1, 0, 1, 2, 3, 4, INT_MIN, INT_MAX}) PRUEF(l.m->kanal_limiter_reduktion_db(bus) == 0.0f);
  }
  PRUEF_ENDE();
}
