// 1.15 A3: gate in the channel strip (after the utility, before the compressor, on the tap before the fader), through the Mixer.
//  (G1) gate/an 0: bit-identical to a mixer that never saw the tool; on then off: bit-identical again, the object not in use
//  (G2) a -60 dBFS sine under threshold -40 goes to the floor within hold + release (measured at the master), a -20 dBFS sine
//       passes within 0.01 dB
//  (G3) gate/sc keys from the INPUT of another channel (as komp/sc): erz/2 follows erz/1; sc 0 and the own index key on itself
//  (G4) PFL hears the gate (fader at -200)
//  (G5) order: the gate acts before the compressor (compressor make-up +12 dB must not lift noise over the gate threshold)
//  (G6) switching on while a signal runs: no step (starts open), and under the threshold it closes after hold + release
//  (G7) switched off and on again: the state is reset (back on, it starts open again, not at the old closed gain)
//  (G11) the hold time set BEFORE the gate is switched on counts (leeren_offen after setze, not before)
//  (G12) after an F01 reset the gate starts OPEN like after switching on (loud signal with a slow attack; and a gate that was closed)
//  (G8) a +Inf on a sidechain key does not hold a foreign gate open
//  (G9) D1: the utility acts BEFORE the gate (the gate sees the mono sum, not the hard-panned side)
//  (G10) D9: a per-sample course counts with its last sample
//  (N2) the F01 guard resets the IIR states of the utility (bassmono, dc) after a NaN
//  (N)  a NaN in a gated channel is caught by the F01 guard: the master is silent for one block only, the gate is reset
#include <cmath>

#include "mixer_wz_lauf.h"

using namespace wzt;

namespace {
void gate_ein(Lauf& l, int k, float schwelle, float bereich, float release = 50.0f) {
  l.setze(k, "gate/an", 1.0f);
  l.setze(k, "gate/schwelle", schwelle);
  l.setze(k, "gate/bereich", bereich);
  l.setze(k, "gate/release", release);
  l.setze(k, "gate/hold", 20.0f);
  l.setze(k, "gate/attack", 1.0f);
}
double db_zu_amp(double db) { return std::pow(10.0, db / 20.0); }
}  // namespace

int main() {
  // (G1) off = never saw the tool; on then off = identical again
  {
    Lauf a, b, c;
    for (const char* s : {"gate/schwelle", "gate/hysterese", "gate/ratio", "gate/bereich", "gate/attack", "gate/hold", "gate/release"})
      PRUEF(b.r((std::string(kname(ERZ1)) + "/" + s).c_str()) >= 0);
    b.setze(ERZ1, "gate/schwelle", -10.0f);   // moved, but gate/an stays 0
    b.setze(ERZ1, "gate/bereich", -100.0f);
    int aus_ungleich = 0, wieder_ungleich = 0, an_ungleich = 0;
    bool aktiv_an = false, aktiv_ende = true;
    for (int blk = 0; blk < 70; ++blk) {
      if (blk == 20) gate_ein(c, ERZ1, -10.0f, -100.0f);
      if (blk == 40) c.setze(ERZ1, "gate/an", 0.0f);
      for (Lauf* l : {&a, &b, &c}) {
        l->sinus(ERZ1, 1000.0, 0.1, 0.1);   // -20 dBFS: under threshold -10, the gate would close
        l->sinus(ERZ2, 220.0, 0.2, 0.1);
        l->verarbeite();
      }
      aus_ungleich += !gleich(a, b);
      if (blk >= 26 && blk < 40) an_ungleich += !gleich(a, c);   // switched on at 20: open for the hold time (3.75 blocks), then it closes
      if (blk == 30) aktiv_an = c.m->gate_aktiv(ERZ1);
      if (blk >= 41) wieder_ungleich += !gleich(a, c);
      if (blk == 69) aktiv_ende = c.m->gate_aktiv(ERZ1);
    }
    std::printf("G1: off vs never: %d of 70 differ; on (blocks 26..39) differs in %d of 14 (positive control); on then off differs in %d of 29\n",
                aus_ungleich, an_ungleich, wieder_ungleich);
    PRUEF(aus_ungleich == 0);
    PRUEF(an_ungleich == 14);
    PRUEF(aktiv_an);
    PRUEF(wieder_ungleich == 0);
    PRUEF(!aktiv_ende);
  }
  // (G2) floor and pass-through, measured at the master against an ungated twin; on erz/1, deck/1 and deck/4
  for (const int K : {ERZ1, DECK1, 3}) {
    std::printf("-- G2 channel %s\n", kname(K));
    Lauf ref, g;
    gate_ein(g, K, -40.0f, -60.0f, 50.0f);
    double durch_db = 99.0, daempf_block[2] = {}, daempf_ende = 0.0;
    for (int blk = 0; blk < 100; ++blk) {
      const double amp = blk < 40 ? db_zu_amp(-20.0) : db_zu_amp(-60.0);
      for (Lauf* l : {&ref, &g}) {
        l->sinus(K, 1000.0, amp, amp);
        l->verarbeite();
      }
      const double d = rms_db(ref.m->master_summe_l(), N) - rms_db(g.m->master_summe_l(), N);   // attenuation in dB
      if (blk == 39) durch_db = -d;
      if (blk == 42) daempf_block[0] = d;    // 3 blocks after the drop: still in hold / detector decay
      if (blk == 60) daempf_block[1] = d;    // 20 blocks = 107 ms after: detector decay + hold + release are over
      if (blk == 99) daempf_ende = d;
    }
    std::printf("G2: -20 dBFS passes with %.4f dB; after the drop to -60 dBFS: %.2f dB at +3 blocks, %.3f dB at +20 blocks, %.3f dB at the end (floor 60)\n",
                durch_db, daempf_block[0], daempf_block[1], daempf_ende);
    PRUEF_NAH(durch_db, 0.0, 0.01);
    PRUEF(daempf_block[0] < 6.0);              // positive control: the measurement sees a gate that is still open
    PRUEF_NAH(daempf_block[1], 60.0, 0.5);     // at the floor within detector decay + hold + release
    PRUEF_NAH(daempf_ende, 60.0, 0.1);
  }
  // (G3) sidechain from the input of another channel
  for (int sc : {5, 0, 6}) {   // 5 = erz/1 (index 4 + 1); 0 = own signal; 6 = erz/2 itself (index 5 + 1) = own signal as well
    Lauf ref, g;
    for (Lauf* l : {&ref, &g}) l->setze(ERZ1, "fader", -200.0f);
    gate_ein(g, ERZ2, -40.0f, -60.0f, 20.0f);
    g.setze(ERZ2, "gate/sc", static_cast<float>(sc));
    double still = 0.0, laut = 0.0;
    for (int blk = 0; blk < 120; ++blk) {
      for (Lauf* l : {&ref, &g}) {
        l->sinus(ERZ2, 1000.0, 0.1, 0.1);                                    // erz/2: -20 dBFS all the time
        l->sinus(ERZ1, 100.0, blk < 60 ? 0.0 : 0.1, blk < 60 ? 0.0 : 0.1);   // the key: silent, then -20 dBFS
        l->verarbeite();
      }
      if (blk == 59) still = rms_db(ref.m->master_summe_l(), N) - rms_db(g.m->master_summe_l(), N);
      if (blk == 119) laut = rms_db(ref.m->master_summe_l(), N) - rms_db(g.m->master_summe_l(), N);
    }
    std::printf("G3 sc=%d: attenuation of erz/2 with the key silent %.2f dB, with the key loud %.3f dB\n", sc, still, laut);
    if (sc == 5) {
      PRUEF_NAH(still, 60.0, 0.1);   // erz/2 closed by a key that is silent
      PRUEF_NAH(laut, 0.0, 0.01);    // opened by the other channel
    } else {
      PRUEF_NAH(still, 0.0, 0.01);   // keyed on itself: -20 dBFS, open all the time
      PRUEF_NAH(laut, 0.0, 0.01);
    }
  }
  // (G4) PFL hears the gate
  {
    Lauf aus, an;
    for (Lauf* l : {&aus, &an}) {
      l->setze(ERZ1, "fader", -200.0f);
      l->setze(ERZ1, "pfl", 1.0f);
    }
    gate_ein(an, ERZ1, 0.0f, -60.0f, 20.0f);   // threshold 0 dBFS: a -20 dBFS sine never opens it
    for (int blk = 0; blk < 60; ++blk)
      for (Lauf* l : {&aus, &an}) {
        l->sinus(ERZ1, 1000.0, 0.1, 0.1);
        l->verarbeite();
      }
    const double ca = rms_db(aus.cl, N), cb = rms_db(an.cl, N);
    std::printf("G4: cue %.2f dB without, %.2f dB with the gate (fader -200)\n", ca, cb);
    PRUEF(ca > -40.0);              // positive control: the cue hears the channel at all
    PRUEF_NAH(ca - cb, 60.0, 0.1);
  }
  // (G5) order: gate before compressor
  {
    Lauf ref, komp_nur, beide;
    for (Lauf* l : {&komp_nur, &beide}) {
      l->setze(ERZ1, "komp/an", 1.0f);
      l->setze(ERZ1, "komp/schwelle", 0.0f);
      l->setze(ERZ1, "komp/ratio", 2.0f);
      l->setze(ERZ1, "komp/makeup", 12.0f);
    }
    gate_ein(beide, ERZ1, -45.0f, -60.0f, 20.0f);   // -50 dBFS is under -45; the lifted -38 dBFS would be over it
    for (int blk = 0; blk < 120; ++blk)
      for (Lauf* l : {&ref, &komp_nur, &beide}) {
        l->sinus(ERZ1, 1000.0, db_zu_amp(-50.0), db_zu_amp(-50.0));
        l->verarbeite();
      }
    const double r0 = rms_db(ref.m->master_summe_l(), N), kn = rms_db(komp_nur.m->master_summe_l(), N), bd = rms_db(beide.m->master_summe_l(), N);
    std::printf("G5: master rms %.2f dB plain, %.2f dB compressor make-up +12, %.2f dB gate (-45) then compressor\n", r0, kn, bd);
    PRUEF_NAH(kn - r0, 12.0, 0.2);   // positive control: the make-up lifts the tone over the gate threshold
    PRUEF(bd < r0 - 40.0);           // the gate sees -50 dBFS, stays closed; make-up lifts only the floor
  }
  // (G6) switch on with a running signal: no step; under the threshold: closes the regular way
  for (const int K : {ERZ1, DECK1}) {
    for (float att : {1.0f, 200.0f}) {
      Lauf ref, g;
      g.setze(K, "gate/attack", att);
      std::vector<float> vr, vg;
      const int WB = 40;
      for (int blk = 0; blk < WB + 12; ++blk) {
        if (blk == WB) g.setze(K, "gate/an", 1.0f);
        for (Lauf* l : {&ref, &g}) {
          l->sinus(K, 1000.0, 0.316, 0.316);
          l->verarbeite();
        }
        vr.insert(vr.end(), ref.m->master_summe_l(), ref.m->master_summe_l() + N);
        vg.insert(vg.end(), g.m->master_summe_l(), g.m->master_summe_l() + N);
      }
      const size_t s0 = static_cast<size_t>(WB) * N;
      double natuerlich = 0.0, schritt = 0.0;
      for (size_t i = s0 - 200; i < s0 + 200; ++i) natuerlich = std::fmax(natuerlich, std::fabs(vr[i] - vr[i - 1]));
      for (size_t i = s0; i < s0 + 6 * N; ++i) schritt = std::fmax(schritt, std::fabs(vg[i] - vg[i - 1]));
      std::printf("G6 %s attack %.0f ms: largest step after the switch %.5f, natural largest step %.5f (%.2fx)\n", kname(K), att, schritt,
                  natuerlich, schritt / natuerlich);
      PRUEF(natuerlich > 0.03);                      // the instrument sees a 1 kHz sine at all
      PRUEF(schritt <= natuerlich * 1.0 + 1e-6);     // switching on adds no step (1.0x)
    }
    Lauf ref, g;   // under the threshold: closes after hold + release
    g.setze(K, "gate/schwelle", -40.0f);
    g.setze(K, "gate/bereich", -60.0f);
    g.setze(K, "gate/release", 50.0f);
    double erst = 0.0, spaeter = 0.0;
    for (int blk = 0; blk < 80; ++blk) {
      if (blk == 20) g.setze(K, "gate/an", 1.0f);
      for (Lauf* l : {&ref, &g}) {
        l->sinus(K, 1000.0, db_zu_amp(-60.0), db_zu_amp(-60.0));
        l->verarbeite();
      }
      if (blk == 20) erst = rms_db(ref.m->master_summe_l(), N) - rms_db(g.m->master_summe_l(), N);
      if (blk == 60) spaeter = rms_db(ref.m->master_summe_l(), N) - rms_db(g.m->master_summe_l(), N);
    }
    std::printf("G6 %s under the threshold: attenuation %.2f dB in the first block, %.2f dB 40 blocks later (floor 60)\n", kname(K), erst, spaeter);
    PRUEF(erst < 1.0);
    PRUEF_NAH(spaeter, 60.0, 0.5);
  }
  // (G7) off and on again: the old state is gone
  {
    Lauf ref, g;
    gate_ein(g, ERZ1, -40.0f, -60.0f, 50.0f);
    g.setze(ERZ1, "gate/attack", 200.0f);
    double erste = 99.0, spaeter = 99.0;
    for (int blk = 0; blk < 70; ++blk) {
      if (blk == 40) g.setze(ERZ1, "gate/an", 0.0f);
      if (blk == 45) g.setze(ERZ1, "gate/an", 1.0f);
      const double amp = blk < 45 ? db_zu_amp(-60.0) : db_zu_amp(-20.0);   // closed gate before, then a loud signal appears with the switch
      for (Lauf* l : {&ref, &g}) {
        l->sinus(ERZ1, 1000.0, amp, amp);
        l->verarbeite();
      }
      if (blk == 39) spaeter = rms_db(ref.m->master_summe_l(), N) - rms_db(g.m->master_summe_l(), N);
      if (blk == 45) erste = rms_db(ref.m->master_summe_l(), N) - rms_db(g.m->master_summe_l(), N);
    }
    std::printf("G7: attenuation %.2f dB before the switch off (closed), %.2f dB in the first block after switching on again\n", spaeter, erste);
    PRUEF_NAH(spaeter, 60.0, 0.5);   // positive control: it was closed
    PRUEF(erste < 1.0);              // reset: it starts open again
  }
  // (G11) hold set while the gate is OFF, then switched on under the threshold: the open phase follows that hold, not the previous one
  for (const float hold : {0.0f, 500.0f}) {
    Lauf ref, g;
    g.setze(ERZ1, "gate/schwelle", -40.0f);
    g.setze(ERZ1, "gate/bereich", -60.0f);
    g.setze(ERZ1, "gate/release", 50.0f);
    g.setze(ERZ1, "gate/attack", 1.0f);
    g.setze(ERZ1, "gate/hold", hold);
    double d[3] = {};
    for (int blk = 0; blk < 170; ++blk) {   // one block is 256 samples = 5.33 ms; switched on at block 20
      if (blk == 20) g.setze(ERZ1, "gate/an", 1.0f);
      for (Lauf* l : {&ref, &g}) {
        l->sinus(ERZ1, 1000.0, db_zu_amp(-60.0), db_zu_amp(-60.0));
        l->verarbeite();
      }
      const double a = rms_db(ref.m->master_summe_l(), N) - rms_db(g.m->master_summe_l(), N);
      if (blk == 24) d[0] = a;      // 21 to 27 ms after switching on: the 3 dB mark of hold 0 is at 14.6 ms, that of a 20 ms hold at 34.6 ms
      if (blk == 70) d[1] = a;      // 267 ms after switching on: a 500 ms hold is still open
      if (blk == 169) d[2] = a;
    }
    std::printf("G11 hold %.0f ms: attenuation %.2f dB 21..27 ms after switching on, %.2f dB at 267 ms, %.2f dB at 795 ms\n", hold, d[0], d[1], d[2]);
    PRUEF_NAH(d[2], 60.0, 0.5);                // positive control: it closes in the end
    if (hold == 0.0f) PRUEF(d[0] > 3.0);       // no hold: it is already closing (a stale 20 ms hold would still be open)
    else PRUEF(d[1] < 1.0);                    // hold 500 ms: still open at 267 ms (a stale 20 ms hold would have closed it)
  }
  // (G12) F01: after a NaN the gate starts OPEN. (i) loud sine, attack 200 ms: no fade-in after the NaN block. (ii) a closed gate: reopened, closes again.
  {
    Lauf ref, g;
    gate_ein(g, ERZ1, -40.0f, -60.0f, 50.0f);
    g.setze(ERZ1, "gate/attack", 200.0f);
    double a1 = 99.0, a2 = 99.0;
    for (int blk = 0; blk < 60; ++blk) {
      for (Lauf* l : {&ref, &g}) l->sinus(ERZ1, 1000.0, 0.3, 0.3);
      if (blk == 30) { ref.m->eingang_l(ERZ1)[7] = NAN; g.m->eingang_l(ERZ1)[7] = NAN; }
      ref.verarbeite();
      g.verarbeite();
      const double a = rms_db(ref.m->master_summe_l(), N) - rms_db(g.m->master_summe_l(), N);
      if (blk == 31) a1 = a;
      if (blk == 32) a2 = a;
    }
    std::printf("G12 loud, attack 200 ms: attenuation %.2f dB in the block after the NaN block, %.2f dB in the second\n", a1, a2);
    PRUEF(a1 < 1.0);
    PRUEF(a2 < 1.0);
  }
  {
    Lauf ref, g;
    gate_ein(g, ERZ1, -40.0f, -60.0f, 50.0f);
    double vorher = 0.0, danach = 99.0, spaet = 0.0;
    for (int blk = 0; blk < 80; ++blk) {
      for (Lauf* l : {&ref, &g}) l->sinus(ERZ1, 1000.0, db_zu_amp(-60.0), db_zu_amp(-60.0));
      if (blk == 40) { ref.m->eingang_l(ERZ1)[7] = NAN; g.m->eingang_l(ERZ1)[7] = NAN; }
      ref.verarbeite();
      g.verarbeite();
      const double a = rms_db(ref.m->master_summe_l(), N) - rms_db(g.m->master_summe_l(), N);
      if (blk == 39) vorher = a;
      if (blk == 41) danach = a;
      if (blk == 79) spaet = a;
    }
    std::printf("G12 closed gate: attenuation %.2f dB before the NaN, %.2f dB in the block after (reopened), %.2f dB at the end (closed again)\n", vorher, danach, spaet);
    PRUEF_NAH(vorher, 60.0, 0.5);   // positive control: it was closed
    PRUEF(danach < 3.0);
    PRUEF_NAH(spaet, 60.0, 0.5);
  }
  // (G8) +Inf (and NaN) on the key of a foreign gate: erz/2 keyed by the cue-only erz/8 (sc 12)
  for (const float boese : {INFINITY, NAN}) {
    Lauf g;
    g.m->setze_nur_cue(ERZ8);
    gate_ein(g, ERZ2, -40.0f, -60.0f, 20.0f);
    g.setze(ERZ2, "gate/sc", 12.0f);
    double geschlossen = 0.0, nach = 0.0, offen = 0.0;
    for (int blk = 0; blk < 260; ++blk) {
      g.sinus(ERZ2, 1000.0, 0.1, 0.1);
      g.sinus(ERZ8, 100.0, blk < 200 ? 0.0 : 0.1, blk < 200 ? 0.0 : 0.1);
      if (blk == 100) g.m->eingang_l(ERZ8)[7] = boese;
      g.verarbeite();
      if (blk == 99) geschlossen = rms_db(g.m->master_summe_l(), N);
      if (blk == 199) nach = rms_db(g.m->master_summe_l(), N);
      if (blk == 259) offen = rms_db(g.m->master_summe_l(), N);
    }
    std::printf("G8 %s on the key: erz/2 level %.1f dB before, %.1f dB 100 blocks after, %.1f dB when the key is loud\n", std::isinf(boese) ? "+Inf" : "NaN",
                geschlossen, nach, offen);
    PRUEF(geschlossen < -80.0);
    PRUEF(nach < -80.0);       // still closed: the Inf did not stick the follower
    PRUEF(offen > -30.0);      // positive control: a loud key opens it
  }
  // (G9) D1: utility before gate. L-only sine 0.2; breite 0 makes it 0.1 on both sides (-20 dBFS); the gate threshold sits at -17 dBFS
  {
    Lauf ref, g;
    for (Lauf* l : {&ref, &g}) l->setze(ERZ1, "util/breite", 0.0f);
    gate_ein(g, ERZ1, -17.0f, -60.0f, 20.0f);
    g.setze(ERZ1, "gate/hysterese", 0.0f);
    for (int blk = 0; blk < 100; ++blk)
      for (Lauf* l : {&ref, &g}) {
        l->sinus(ERZ1, 1000.0, 0.2, 0.0);
        l->verarbeite();
      }
    const double d = rms_db(ref.m->master_summe_l(), N) - rms_db(g.m->master_summe_l(), N);
    std::printf("G9: gate (-17 dBFS) behind the utility (mono, -20 dBFS): attenuation %.2f dB (closed = 60)\n", d);
    PRUEF_NAH(d, 60.0, 0.5);   // the gate sees the mono sum (0.1 < threshold), not the panned side (0.2 > threshold)
  }
  // (G10) D9: gate/schwelle -90 with a course that ends on 0 in this block; hold 0 and release 1 ms: the block is gated if the last sample counts
  {
    Lauf ref, g, offen;
    for (Lauf* l : {&ref, &g, &offen}) {
      gate_ein(*l, ERZ1, -90.0f, -60.0f, 1.0f);
      l->setze(ERZ1, "gate/hold", 0.0f);
    }
    float verlauf[N];
    for (int i = 0; i < N; ++i) verlauf[i] = -90.0f + 90.0f * static_cast<float>(i) / (N - 1);   // ends on exactly 0
    bool gleich5 = false;
    double gated = 0.0;
    for (int blk = 0; blk < 8; ++blk) {
      if (blk == 5) {
        ref.setze(ERZ1, "gate/schwelle", 0.0f);
        g.m->verlauf(g.r((std::string(kname(ERZ1)) + "/gate/schwelle").c_str()), verlauf);
      }
      for (Lauf* l : {&ref, &g, &offen}) {
        l->sinus(ERZ1, 1000.0, 0.1, 0.1);
        l->verarbeite();
      }
      if (blk == 5) {
        gleich5 = gleich(ref, g);
        gated = rms_db(offen.m->master_summe_l(), N) - rms_db(ref.m->master_summe_l(), N);
      }
    }
    std::printf("G10: block with the course: gate with course == gate with the final value: %d; that gate attenuates %.1f dB against an open one\n", gleich5, gated);
    PRUEF(gated > 6.0);   // positive control: the final value (0 dBFS) really gates this block, the start value (-90) would not
    PRUEF(gleich5);
  }
  // (N2) NaN with IIR states in the utility (bassmono, dc) and a gate: the guard resets them, the channel is back and nothing sticks
  {
    Lauf ref, g;
    for (Lauf* l : {&ref, &g}) {
      gate_ein(*l, ERZ1, -60.0f, -60.0f, 20.0f);
      l->setze(ERZ1, "util/bassmono", 120.0f);
      l->setze(ERZ1, "util/dc", 1.0f);
      l->setze(ERZ1, "util/breite", 50.0f);
    }
    int still = 0;
    bool endlich_alle = true;
    double nach = 0.0;
    for (int blk = 0; blk < 120; ++blk) {
      for (Lauf* l : {&ref, &g}) l->sinus(ERZ1, 300.0, 0.3, 0.3);
      if (blk == 30) g.m->eingang_l(ERZ1)[7] = NAN;
      ref.verarbeite();
      g.verarbeite();
      bool st = true;
      for (int i = 0; i < N; ++i) {
        st = st && std::fabs(g.m->master_summe_l()[i]) < 1e-9;
        endlich_alle = endlich_alle && std::isfinite(g.ml[i]) && std::isfinite(g.mr[i]);
      }
      if (blk >= 30 && st) ++still;
      if (blk == 119) nach = max_abstand(g.m->master_summe_l(), ref.m->master_summe_l(), N);
    }
    std::printf("N2: NaN with bassmono + dc + gate: silent blocks %d, nan_treffer %lld, all finite %d, difference to the twin at the end %.3g\n", still,
                static_cast<long long>(g.m->nan_treffer()), endlich_alle, nach);
    PRUEF(still == 1);
    PRUEF(g.m->nan_treffer() == 1);
    PRUEF(endlich_alle);
    PRUEF(nach < 1e-3);
  }
  // (N) a NaN in a gated, utility-processed channel
  {
    Lauf ref, g;
    for (Lauf* l : {&ref, &g}) l->setze(ERZ2, "fader", 0.0f);
    gate_ein(g, ERZ1, -40.0f, -60.0f, 20.0f);
    g.setze(ERZ1, "util/tausch", 1.0f);
    gate_ein(ref, ERZ1, -40.0f, -60.0f, 20.0f);
    ref.setze(ERZ1, "util/tausch", 1.0f);
    bool alle_endlich = true;
    int still_bloecke = 0;
    double nach = 0.0;
    for (int blk = 0; blk < 80; ++blk) {
      for (Lauf* l : {&ref, &g}) {
        l->sinus(ERZ1, 1000.0, 0.1, 0.1);
        l->sinus(ERZ2, 440.0, 0.2, 0.2);
      }
      if (blk == 20) g.m->eingang_l(ERZ1)[10] = NAN;
      ref.verarbeite();
      g.verarbeite();
      bool endlich = true;
      for (int i = 0; i < N; ++i)
        endlich = endlich && std::isfinite(g.ml[i]) && std::isfinite(g.mr[i]) && std::isfinite(g.cl[i]) && std::isfinite(g.cr[i]);
      alle_endlich = alle_endlich && endlich;
      if (blk >= 20 && spitze_db(g.m->master_summe_l(), N) < -100.0 && spitze_db(g.m->master_summe_r(), N) < -100.0) ++still_bloecke;   // the ear tap is the sum the guard zeroes; ml lags by the limiter look-ahead
      if (blk == 79) nach = max_abstand(g.ml, ref.ml, N);
    }
    std::printf("N: NaN at block 20: master silent in %d block(s), nan_treffer %lld, all outputs finite: %d, max difference to the twin at the end %.3g\n",
                still_bloecke, static_cast<long long>(g.m->nan_treffer()), alle_endlich, nach);
    PRUEF(alle_endlich);
    PRUEF(still_bloecke == 1);
    PRUEF(g.m->nan_treffer() == 1);
    PRUEF(g.m->gate_aktiv(ERZ1));    // the gate is on again after the reset
    PRUEF(nach < 1e-3);              // the gate has recovered: the channel is back
  }
  PRUEF_ENDE();
}
