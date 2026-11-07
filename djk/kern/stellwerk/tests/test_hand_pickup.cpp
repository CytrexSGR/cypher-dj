// 1.12 Automation slice 3, task 1 (D2): the pickup inside hand_anwenden. The Stellwerk asks the PickupQuelle exactly where a
// hand step is certain to be applied, and sets the regulator to the lane value before the step is applied.
//   (a) value grip with a known position: one pickup, the value at the grip sample starts from the lane value
//   (b) touch event: one pickup
//   (c) dead zone of an open part (the step is discarded): no pickup, the base value stays
//   (d) first absolute message (position only): no pickup
//   (e) release: no pickup
//   (f) queue overflow (MAX_HAND): the discarded griffs never ask
// Mutation STELLWERK_PICKUP_VOR_VERWURF (the pickup runs before the discard checks and for a release) must turn (c) and (e) red.
#include "pruef.h"
#include "szenario.h"

using namespace probe;

namespace {
constexpr const char* R = "deck/1/fader";
constexpr int64_t Z0 = 256 * 20;

struct Stub : PickupQuelle {
  int regler = -1;
  float lane = -20.0f;
  mutable int treffer = 0;
  mutable int fragen = 0;
  bool lane_wert(int r, float& w) const override {
    fragen++;
    if (r != regler) return false;
    w = lane;
    treffer++;
    return true;
  }
};
}  // namespace

FALL(a_wertgriff_startet_vom_lane_wert) {
  Lauf l;
  Stub st;
  st.regler = l.r(R);
  l.sw->setze_pickup(&st);
  l.sw->setze_direkt(l.r(R), 0.0f);
  l.beobachte(R);
  l.griff(100, R, 0.8f);   // position only
  l.bis(Z0);
  l.griff(Z0 + 100, R, 0.81f);
  l.bis(Z0 + 512);
  PRUEFE_GLEICH(st.treffer, 1);
  // before the grip sample the value is the lane value (the slot is filled with the picked-up value), not the base 0 dB
  PRUEFE_NAH(l.wert_bei(R, Z0 + 99), -20.0, 1e-4);
  PRUEFE(l.wert_bei(R, Z0 + 100) < -5.0);   // the step starts from -20 dB, it does not jump to the base
}

FALL(b_beruehrung_greift_ab) {
  Lauf l;
  Stub st;
  st.regler = l.r(R);
  l.sw->setze_pickup(&st);
  l.bis(Z0);
  l.griff(Z0 + 40, R, 0, GriffArt::beruehrung);
  l.zyklus();
  PRUEFE_GLEICH(st.treffer, 1);
  PRUEFE_NAH(l.sw->wert(l.r(R)), -20.0, 1e-4);
}

FALL(c_totzone_verwurf_kein_pickup) {
  Lauf l;
  Stub st;
  st.regler = l.r(R);
  l.sw->setze_pickup(&st);
  l.sw->setze_direkt(l.r(R), 0.0f);
  l.teil(R, 64, 8, -6.0f, "p", 0, "b");
  l.bis(Z0);
  l.griff(Z0 + 10, R, 0.5f);
  l.zyklus();
  l.griff(Z0 + 256 + 10, R, 0.505f);   // inside the dead zone: discarded
  l.zyklus();
  PRUEFE_GLEICH(st.treffer, 0);
  PRUEFE_NAH(l.sw->wert(l.r(R)), 0.0, 1e-4);
}

FALL(d_erster_wert_kein_pickup) {
  Lauf l;
  Stub st;
  st.regler = l.r(R);
  l.sw->setze_pickup(&st);
  l.sw->setze_direkt(l.r(R), 0.0f);
  l.bis(Z0);
  l.griff(Z0 + 10, R, 0.5f);
  l.zyklus();
  PRUEFE_GLEICH(st.fragen, 0);
  PRUEFE_NAH(l.sw->wert(l.r(R)), 0.0, 1e-4);
}

FALL(e_freigabe_kein_pickup) {
  Lauf l;
  Stub st;
  st.regler = l.r(R);
  l.sw->setze_pickup(&st);
  l.bis(Z0);
  l.griff(Z0 + 10, R, 0, GriffArt::beruehrung);
  l.zyklus();
  PRUEFE_GLEICH(st.treffer, 1);
  l.griff(Z0 + 256 + 10, R, 0, GriffArt::freigabe);
  l.zyklus();
  PRUEFE_GLEICH(st.treffer, 1);
  PRUEFE_GLEICH(st.fragen, 1);
}

FALL(f_ueberlauf_der_warteschlange_fragt_nicht) {
  Lauf l;
  Stub st;
  st.regler = l.r(R);
  st.lane = 0.0f;
  l.sw->setze_pickup(&st);
  l.bis(Z0);
  const int n = MAX_HAND + 10;
  for (int i = 0; i < n; i++) l.griff(Z0 + 1 + i % 200, R, 0.5f + 0.0001f * i);
  l.zyklus();
  PRUEFE_GLEICH(l.sw->zaehler().hand_verloren, 10);
  PRUEFE_GLEICH(st.fragen, MAX_HAND - 1);   // the queued griffs minus the swallowed first message; the 10 discarded never ask
}

FALL(g_wiederholter_wert_kein_pickup) {
  // controller decision: an absolute value equal to the known position is a resend, not an applied step
  Lauf l;
  Stub st;
  st.regler = l.r(R);
  l.sw->setze_pickup(&st);
  l.sw->setze_direkt(l.r(R), 0.0f);
  l.bis(Z0);
  l.griff(Z0 + 10, R, 0.5f);
  l.zyklus();
  l.griff(Z0 + 256 + 10, R, 0.5f);   // the same value again
  l.zyklus();
  PRUEFE_GLEICH(st.fragen, 0);
  PRUEFE_NAH(l.sw->wert(l.r(R)), 0.0, 1e-4);
  l.griff(Z0 + 512 + 10, R, 0.52f);   // movement: asks, picks up
  l.zyklus();
  PRUEFE_GLEICH(st.treffer, 1);
}

FALL(h_zweiter_griff_skaliert_vom_lane_wert) {
  // §7.3 point 3: the takeover is SCALED, also on a second grip: the hand value is not the absolute curve value of the knob. The knob stands at 0.5 (first grip),
  // the lane has fallen to -40 dB; a knob move down to 0.2 scales the value down from the lane value, so it ends BELOW the lane (acceptance 1.12 S3 wave A, S10c).
  Lauf l;
  Stub st;
  st.regler = l.r(R);
  st.lane = -40.0f;
  l.sw->setze_pickup(&st);
  l.sw->setze_direkt(l.r(R), 0.0f);
  l.bis(Z0);
  l.griff(Z0 + 10, R, 0.5f);          // position only
  l.zyklus();
  l.griff(Z0 + 256 + 10, R, 0.6f);    // first applied value: pickup 1, the knob is at 0.6 now
  l.zyklus();
  st.lane = -40.0f;                   // the lane value of the second grip (the stub answers every time; the core answers once per override start)
  l.griff(Z0 + 512 + 10, R, 0.2f);
  l.zyklus();
  PRUEFE(l.sw->wert(l.r(R)) < -40.0);   // below the lane although the knob value 0.2 would be above -40 dB on the absolute curve
  PRUEFE(l.sw->wert(l.r(R)) > -200.0);
}

PRUEF_MAIN
