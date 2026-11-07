// 1.12 Automation slice 3, task 1 (D1): the grip signal of the Stellwerk. A grip is every hand step that is APPLIED to a
// regulator (a value, or an explicit touch event), whatever the holder state is. The signal is "grip in this cycle" plus
// the sample of the first grip, and it is reset at the start of every prozess().
//   (a) value grip: flag set, sample right          (b) touch event without a value: flag set
//   (c) grip and release in one cycle: flag set     (d) second grip while the holder is still `mensch`: flag set again
//   (e) negative: a part from andreas/cypher and setze_direkt leave the flag unset
//   (f) physical position unknown: the first absolute message sets no flag, the second does
//   (g) a step inside the dead zone of an open part is discarded: no flag
//   (h) two grips in one cycle: the sample stays with the first
//   (h2) griff_letzter_im_zyklus (task 7): the sample of the LAST grip; one grip gives the same sample for both; no grip, no signal; reset with the next cycle
// Mutations (WILL_FAIL targets): STELLWERK_GRIFF_NUR_HALTERWECHSEL turns (d) red, STELLWERK_GRIFF_IN_TOTZONE (g),
// STELLWERK_GRIFF_SAMPLE_LETZTER (h), STELLWERK_RESEND_GRIFF (i), STELLWERK_GRIFF_LETZTER_ERSTER (h2).
#include "pruef.h"
#include "szenario.h"

using namespace probe;

namespace {
constexpr const char* R = "deck/1/fader";
constexpr int64_t Z0 = 256 * 20;   // cycle start used by the tests (cycles are 256 samples)

bool griff(const Lauf& l, const char* pfad, int64_t& s) { return l.sw->griff_im_zyklus(l.r(pfad), s); }
}  // namespace

FALL(a_wertgriff_setzt_flag_mit_sample) {
  Lauf l;
  l.sw->setze_direkt(l.r(R), dB(0.8));
  l.griff(100, R, 0.8f);   // first value: only the position
  l.bis(Z0);
  int64_t s = -1;
  PRUEFE(!griff(l, R, s));   // nothing in the cycle before
  l.griff(Z0 + 100, R, 0.81f);
  l.zyklus();
  PRUEFE(griff(l, R, s));
  PRUEFE_GLEICH(s, Z0 + 100);
}

FALL(b_beruehrung_ohne_wert_setzt_flag) {
  Lauf l;
  l.bis(Z0);
  l.griff(Z0 + 40, R, 0, GriffArt::beruehrung);
  l.zyklus();
  int64_t s = -1;
  PRUEFE(griff(l, R, s));
  PRUEFE_GLEICH(s, Z0 + 40);
  PRUEFE(l.sw->halter(l.r(R)).art == HalterArt::mensch);
}

FALL(c_griff_und_loslassen_im_selben_zyklus) {
  Lauf l;
  l.sw->setze_direkt(l.r(R), dB(0.8));
  l.griff(100, R, 0.8f);
  l.bis(Z0);
  l.griff(Z0 + 10, R, 0.82f);
  l.griff(Z0 + 200, R, 0, GriffArt::freigabe);
  l.zyklus();
  int64_t s = -1;
  PRUEFE(griff(l, R, s));
  PRUEFE_GLEICH(s, Z0 + 10);
  PRUEFE(l.sw->halter(l.r(R)).art != HalterArt::mensch);   // the release was applied: the holder is back
}

FALL(d_zweiter_griff_bei_halter_mensch) {
  Lauf l;
  l.sw->setze_direkt(l.r(R), dB(0.8));
  l.griff(100, R, 0.8f);
  l.bis(Z0);
  l.griff(Z0 + 10, R, 0.82f);
  l.zyklus();
  int64_t s = -1;
  PRUEFE(griff(l, R, s));
  l.bis(Z0 + 256 * 4);   // quiet cycles: the holder stays mensch for 32 beats, the flag is reset every cycle
  PRUEFE(l.sw->halter(l.r(R)).art == HalterArt::mensch);
  PRUEFE(!griff(l, R, s));
  const int64_t z1 = Z0 + 256 * 4;
  l.griff(z1 + 30, R, 0.84f);
  l.zyklus();
  PRUEFE(l.sw->halter(l.r(R)).art == HalterArt::mensch);
  PRUEFE(griff(l, R, s));   // holder unchanged, still a grip
  PRUEFE_GLEICH(s, z1 + 30);
  l.griff(z1 + 256 + 5, R, 0, GriffArt::beruehrung);   // an explicit touch with the holder already mensch
  l.zyklus();
  PRUEFE(griff(l, R, s));
  PRUEFE_GLEICH(s, z1 + 256 + 5);
}

FALL(e_teil_und_setze_direkt_sind_kein_griff) {
  Lauf l;
  l.sw->setze_direkt(l.r(R), dB(0.8));
  l.bis(Z0);
  int64_t s = -1;
  l.teil(R, 0.0, 1.0, -6.0f, "p", 0, "", Quelle::andreas);   // starts at beat 0.. within the next cycles
  l.teil("deck/2/fader", 0.0, 1.0, -6.0f, "p", 1, "", Quelle::cypher);
  l.sw->setze_direkt(l.r("deck/3/fader"), -12.0f);
  for (int i = 0; i < 8; i++) {
    l.sw->setze_direkt(l.r("deck/3/fader"), -12.0f - static_cast<float>(i));   // directly before the cycle that must not flag it
    l.zyklus();
    PRUEFE(!griff(l, R, s));
    PRUEFE(!griff(l, "deck/2/fader", s));
    PRUEFE(!griff(l, "deck/3/fader", s));
  }
  PRUEFE(l.zahl(EreignisArt::quittung) > 0);   // the parts really ran
}

FALL(f_unbekannte_stellung_erste_nachricht_ohne_flag) {
  Lauf l;
  l.bis(Z0);
  int64_t s = -1;
  l.griff(Z0 + 10, R, 0.5f);   // first absolute message: only the position
  l.zyklus();
  PRUEFE(!griff(l, R, s));
  PRUEFE(!l.sw->stellung_bekannt(l.r("deck/2/fader")));
  PRUEFE(l.sw->stellung_bekannt(l.r(R)));
  l.griff(Z0 + 256 + 10, R, 0.52f);   // second message: applied
  l.zyklus();
  PRUEFE(griff(l, R, s));
  PRUEFE_GLEICH(s, Z0 + 256 + 10);
  // both messages in one cycle: the first is swallowed, the second sets the flag with its own sample
  Lauf m;
  m.bis(Z0);
  m.griff(Z0 + 10, R, 0.5f);
  m.griff(Z0 + 20, R, 0.52f);
  m.zyklus();
  PRUEFE(griff(m, R, s));
  PRUEFE_GLEICH(s, Z0 + 20);
}

FALL(g_totzone_verworfen_kein_flag) {
  Lauf l;
  l.sw->setze_direkt(l.r(R), dB(0.8));
  l.teil(R, 64, 8, -6.0f, "p", 0, "b");   // an open part far in the future: the plan holds the regulator
  l.bis(Z0);
  int64_t s = -1;
  l.griff(Z0 + 10, R, 0.5f);   // first message: only the position
  l.zyklus();
  l.griff(Z0 + 256 + 10, R, 0.505f);   // inside 3/128 of the anchor: discarded
  l.zyklus();
  PRUEFE(!griff(l, R, s));
  PRUEFE(l.sw->halter(l.r(R)).art != HalterArt::mensch);
  l.griff(Z0 + 512 + 10, R, 0.8f);   // outside the dead zone: applied, takes over
  l.zyklus();
  PRUEFE(griff(l, R, s));
  PRUEFE_GLEICH(s, Z0 + 512 + 10);
}

FALL(h_zwei_griffe_im_zyklus_erstes_sample) {
  Lauf l;
  l.sw->setze_direkt(l.r(R), dB(0.8));
  l.griff(100, R, 0.8f);
  l.bis(Z0);
  l.griff(Z0 + 10, R, 0.82f);
  l.griff(Z0 + 200, R, 0.83f);
  l.zyklus();
  int64_t s = -1;
  PRUEFE(griff(l, R, s));
  PRUEFE_GLEICH(s, Z0 + 10);
}

FALL(h2_letzter_griff_im_zyklus) {
  Lauf l;
  l.sw->setze_direkt(l.r(R), dB(0.8));
  l.griff(100, R, 0.8f);
  l.bis(Z0);
  int64_t s = -1;
  PRUEFE(!l.sw->griff_letzter_im_zyklus(l.r(R), s));   // no grip yet
  l.griff(Z0 + 10, R, 0.82f);
  l.griff(Z0 + 120, R, 0.83f);
  l.griff(Z0 + 200, R, 0.84f);
  l.zyklus();
  PRUEFE(l.sw->griff_letzter_im_zyklus(l.r(R), s));
  PRUEFE_GLEICH(s, Z0 + 200);   // the last one
  int64_t erster = -1;
  PRUEFE(griff(l, R, erster));
  PRUEFE_GLEICH(erster, Z0 + 10);   // the first signal is untouched
  l.griff(Z0 + 256 + 77, R, 0.85f);   // next cycle, one grip: both signals name it
  l.zyklus();
  PRUEFE(l.sw->griff_letzter_im_zyklus(l.r(R), s));
  PRUEFE_GLEICH(s, Z0 + 256 + 77);
  PRUEFE(griff(l, R, erster));
  PRUEFE_GLEICH(erster, Z0 + 256 + 77);
  l.zyklus();   // a cycle without a grip: the signal is gone
  PRUEFE(!l.sw->griff_letzter_im_zyklus(l.r(R), s));
}

FALL(i_wiederholter_wert_ist_kein_griff) {
  // controller decision (AK11 "bewegt"): an absolute value exactly equal to the known physical position is a resend, not a grip
  Lauf l;
  l.sw->setze_direkt(l.r(R), dB(0.8));
  l.bis(Z0);
  int64_t s = -1;
  l.griff(Z0 + 10, R, 0.5f);   // position only
  l.zyklus();
  l.griff(Z0 + 256 + 10, R, 0.5f);   // the same value again
  l.zyklus();
  PRUEFE(!griff(l, R, s));
  PRUEFE(l.sw->halter(l.r(R)).art != HalterArt::mensch);
  PRUEFE_NAH(l.sw->wert(l.r(R)), dB(0.8), 1e-6);
  l.griff(Z0 + 512 + 10, R, 0.5f + 1.0f / 127.0f);   // one 7-bit step: movement, a grip
  l.zyklus();
  PRUEFE(griff(l, R, s));
  PRUEFE_GLEICH(s, Z0 + 512 + 10);
  l.griff(Z0 + 768 + 10, R, 0.5f + 1.0f / 127.0f);   // and its resend is none again
  l.zyklus();
  PRUEFE(!griff(l, R, s));
}

PRUEF_MAIN
