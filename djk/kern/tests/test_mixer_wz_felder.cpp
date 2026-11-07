// 1.15 A3 fix round: the field constants of Mixer::kanal (mixer.cpp, G_* and U_*) pinned by their EFFECT, through the Mixer. A swap of
// two fields of the same range (hold/attack, phase_r/dc) is invisible to every table test; here each row must do its own job.
//  (F1) gate/hold: the gate stays open for the hold time after the signal drops, then closes (hold 400 ms)
//  (F2) gate/attack: from closed to open the gain rises over the attack time (200 ms): about -12 dB after 50 ms
//  (F3) util/phase_r inverts the right channel (left unchanged)
//  (F4) util/dc removes a DC offset
//  (F5) util/balance +1 silences the left channel, the right one is unchanged
//  (F6) 1.15 A4 mb/<b>/attack and release: attack 300 ms / release 20 ms reduces slowly (a swap would be fast), on bus/1 and bus/4
//  (F7) 1.15 A4 mb/grenze_tief and grenze_hoch: a 3 kHz sine sits in the mid band for 500/5000 Hz (a swap puts it in the low band)
//  (F8) 1.15 A4 mb/mitte/knie: a 24 dB knee reduces at the threshold, a hard knee does not
#include <cmath>

#include "mixer_wz_lauf.h"

using namespace wzt;

namespace {
double db_zu_amp(double db) { return std::pow(10.0, db / 20.0); }
}

int main() {
  // (F1) hold: signal -20 dBFS, then -60 dBFS (threshold -40, release 50, floor -60)
  {
    Lauf ref, g;
    g.setze(ERZ1, "gate/an", 1.0f);
    g.setze(ERZ1, "gate/schwelle", -40.0f);
    g.setze(ERZ1, "gate/bereich", -60.0f);
    g.setze(ERZ1, "gate/release", 50.0f);
    g.setze(ERZ1, "gate/attack", 1.0f);
    g.setze(ERZ1, "gate/hold", 400.0f);
    double mitte = 0.0, ende = 0.0;
    for (int blk = 0; blk < 300; ++blk) {
      const double amp = blk < 20 ? db_zu_amp(-20.0) : db_zu_amp(-60.0);
      for (Lauf* l : {&ref, &g}) {
        l->sinus(ERZ1, 1000.0, amp, amp);
        l->verarbeite();
      }
      if (blk == 20 + 38) mitte = rms_db(ref.m->master_summe_l(), N) - rms_db(g.m->master_summe_l(), N);   // 200 ms after the drop
      if (blk == 299) ende = rms_db(ref.m->master_summe_l(), N) - rms_db(g.m->master_summe_l(), N);
    }
    std::printf("F1 hold 400 ms: attenuation %.2f dB 200 ms after the drop (still held), %.2f dB at the end (closed)\n", mitte, ende);
    PRUEF(mitte < 1.0);
    PRUEF_NAH(ende, 60.0, 0.5);
  }
  // (F2) attack: erz/2 keyed by a silent erz/1 closes; then the key opens it with attack 200 ms
  {
    Lauf ref, g;
    for (Lauf* l : {&ref, &g}) l->setze(ERZ1, "fader", -200.0f);
    g.setze(ERZ2, "gate/an", 1.0f);
    g.setze(ERZ2, "gate/schwelle", -40.0f);
    g.setze(ERZ2, "gate/bereich", -60.0f);
    g.setze(ERZ2, "gate/sc", 5.0f);
    g.setze(ERZ2, "gate/attack", 200.0f);
    g.setze(ERZ2, "gate/hold", 20.0f);
    g.setze(ERZ2, "gate/release", 50.0f);
    double geschlossen = 0.0, nach50 = 0.0, nach_ende = 0.0;
    for (int blk = 0; blk < 130; ++blk) {
      for (Lauf* l : {&ref, &g}) {
        l->sinus(ERZ2, 1000.0, 0.1, 0.1);
        l->sinus(ERZ1, 100.0, blk < 80 ? 0.0 : 0.1, blk < 80 ? 0.0 : 0.1);
        l->verarbeite();
      }
      const double d = rms_db(ref.m->master_summe_l(), N) - rms_db(g.m->master_summe_l(), N);
      if (blk == 79) geschlossen = d;
      if (blk == 80 + 9) nach50 = d;       // about 45 to 50 ms after the key appears
      if (blk == 129) nach_ende = d;
    }
    std::printf("F2 attack 200 ms: closed %.1f dB, %.1f dB about 50 ms after the key (expected near 12), %.2f dB at the end\n", geschlossen, nach50, nach_ende);
    PRUEF_NAH(geschlossen, 60.0, 0.5);
    PRUEF(nach50 > 8.0 && nach50 < 16.0);
    PRUEF_NAH(nach_ende, 0.0, 0.05);
  }
  // (F3) phase_r, (F5) balance, (F4) dc
  {
    Lauf ref, pr, bal;
    pr.setze(ERZ1, "util/phase_r", 1.0f);
    bal.setze(ERZ1, "util/balance", 1.0f);
    bool u3 = true, u5 = true;
    for (int blk = 0; blk < 14; ++blk) {
      for (Lauf* l : {&ref, &pr, &bal}) {
        l->sinus(ERZ1, 1000.0, 0.4, 0.3);
        l->verarbeite();
      }
      if (blk < 8) continue;
      for (int i = 0; i < N; ++i) {
        u3 = u3 && pr.m->master_summe_l()[i] == ref.m->master_summe_l()[i] && std::fabs(pr.m->master_summe_r()[i] + ref.m->master_summe_r()[i]) < 1e-7;
        u5 = u5 && std::fabs(bal.m->master_summe_l()[i]) < 1e-7 && std::fabs(bal.m->master_summe_r()[i] - ref.m->master_summe_r()[i]) < 1e-7;
      }
    }
    PRUEF(max_abstand(ref.m->master_summe_r(), bal.m->master_summe_l(), N) > 0.1);   // positive control: the right side carries signal
    PRUEF(u3);
    PRUEF(u5);
  }
  {
    Lauf ref, dc;
    dc.setze(ERZ1, "util/dc", 1.0f);
    double mr = 0.0, md = 0.0;
    for (int blk = 0; blk < 80; ++blk) {
      for (Lauf* l : {&ref, &dc}) {
        l->sinus(ERZ1, 1000.0, 0.1, 0.1);
        for (int i = 0; i < N; ++i) {
          l->m->eingang_l(ERZ1)[i] += 0.2f;
          l->m->eingang_r(ERZ1)[i] += 0.2f;
        }
        l->verarbeite();
      }
    }
    for (int i = 0; i < N; ++i) {
      mr += ref.m->master_summe_l()[i] / N;
      md += dc.m->master_summe_l()[i] / N;
    }
    std::printf("F4 dc: mean %.4f without, %.4f with the DC blocker\n", mr, md);
    PRUEF_NAH(mr, 0.2, 0.01);   // positive control: the offset reaches the master
    PRUEF(std::fabs(md) < 0.01);
  }
  for (const int K : {BUS1, 17}) {
    std::printf("-- F6..F8 on %s\n", kname(K));
    // (F6) onset of a sine over the mid threshold: ratio 20, threshold -40, attack 300 ms, release 20 ms; ~27 ms after the onset
    {
      Lauf ref, g;
      g.setze(K, "mb/an", 1.0f);
      g.setze(K, "mb/mitte/schwelle", -40.0f);
      g.setze(K, "mb/mitte/ratio", 20.0f);
      g.setze(K, "mb/mitte/attack", 300.0f);
      g.setze(K, "mb/mitte/release", 20.0f);
      double frueh = 0.0, spaet = 0.0;
      for (int blk = 0; blk < 200; ++blk) {
        const double amp = blk < 10 ? 0.0 : 0.5;
        for (Lauf* l : {&ref, &g}) {
          l->sinus(K, 632.5, amp, amp);
          l->verarbeite();
        }
        const double d = rms_db(ref.m->master_summe_l(), N) - rms_db(g.m->master_summe_l(), N);
        if (blk == 15) frueh = d;
        if (blk == 199) spaet = d;
      }
      std::printf("F6 attack 300 / release 20: reduction %.2f dB 27 ms after the onset (slow attack: small), %.2f dB at the end (large)\n", frueh, spaet);
      PRUEF(frueh > 0.5 && frueh < 8.0);   // the swapped fields (attack 20 ms) would be at about 25 dB here
      PRUEF(spaet > 15.0);                  // positive control: it does reduce in the end
    }
    // (F7) crossovers 500 / 5000: a 3 kHz sine is in the mid band; only the mid band compresses
    {
      Lauf ref, g;
      g.setze(K, "mb/an", 1.0f);
      g.setze(K, "mb/grenze_tief", 500.0f);
      g.setze(K, "mb/grenze_hoch", 5000.0f);
      g.setze(K, "mb/mitte/schwelle", -40.0f);
      g.setze(K, "mb/mitte/ratio", 20.0f);
      double d = 0.0;
      for (int blk = 0; blk < 150; ++blk)
        for (Lauf* l : {&ref, &g}) {
          l->sinus(K, 3000.0, 0.5, 0.5);
          l->verarbeite();
          if (blk == 149 && l == &g) d = rms_db(ref.m->master_summe_l(), N) - rms_db(g.m->master_summe_l(), N);
        }
      std::printf("F7 3 kHz with crossovers 500/5000: reduction %.2f dB (mid band only compresses)\n", d);
      PRUEF(d > 15.0);
    }
    // (F8) knee: sine peak 0.5 = -6.02 dBFS at the threshold, ratio 4: hard knee 0 dB, knee 24 dB about -2.25 dB
    {
      double r[2] = {};
      for (int j = 0; j < 2; ++j) {
        Lauf ref, g;
        g.setze(K, "mb/an", 1.0f);
        g.setze(K, "mb/mitte/schwelle", -6.0206f);
        g.setze(K, "mb/mitte/ratio", 4.0f);
        g.setze(K, "mb/mitte/knie", j ? 24.0f : 0.0f);
        for (int blk = 0; blk < 150; ++blk)
          for (Lauf* l : {&ref, &g}) {
            l->sinus(K, 632.5, 0.5, 0.5);
            l->verarbeite();
            if (blk == 149 && l == &g) r[j] = rms_db(ref.m->master_summe_l(), N) - rms_db(g.m->master_summe_l(), N);
          }
      }
      std::printf("F8 knee: hard %.2f dB, 24 dB knee %.2f dB reduction at the threshold\n", r[0], r[1]);
      PRUEF(r[0] < 0.7);
      PRUEF(r[1] > 1.5 && r[1] < 3.0);
    }
  }
  PRUEF_ENDE();
}
