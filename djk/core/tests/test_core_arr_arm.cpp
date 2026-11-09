// 1.12 Automation slice 3, task 7: the command Befehl::ARR_ARM (/k/arr/arm) and the event AUTO_PUNKT (/e/auto_punkt) in the whole core
// (the net thread is test_netz_arr_arm). Grips come in through /test/hand (Befehl HAND) at exact samples; the hand loop, the Stellwerk and the Arrangement are real.
//   (a) command -> state: arm a track with a mode, arm another, spur 0 with an 0 disarms every track, the same arm again changes nothing; q 1 and 3
//   (b) refusals: spur outside 0..32, an outside 0/1, modus outside 0..2 and spur 0 with an 1 give format; cypher and every source but andreas give nur_andreas
//       (the state stays); andreas works (negative control); in the AI stop cypher gets ki_gestoppt first
//   (c) gates: nothing without an arm, nothing for an unarmed track (while the armed track reports), nothing while the transport stands; pan and fader of one track
//       report independently (the rate is per regulator); the same grips report once the gate opens (negative control for every "nothing")
//   (d) the rate cap: grips in every cycle give at most one point per 960 samples and regulator (sample of the events at least REGLER_MELDUNG_ABSTAND apart)
//   (e) the last value of a gesture arrives: the point inside the window is held, sent when the window ends, the newest one wins, and it keeps the beat of ITS grip
//   (f) the beat is exact over a tempo ramp and over the loop seam, also for a grip behind the seam inside the block that wraps (oracle: the elapsed Kern beats)
//   (g) a held point is sent at once when the transport stops; disarming drops it (a later re-arm does not send a stale point)
//   (i) beat and value of ONE sample: in a real 1024-sample cycle (MIX_BLOCK) over a tempo ramp, a gesture of eight steps; the point carries the beat of the last grip and
//       the value the regulator has there (read from the Stellwerk course of that cycle), not the value of the end of the block with the beat of the first grip
//   (j) the rate window survives a disarm: disarm and re-arm in a row cannot send inside 960 samples; the held point is dropped
//   (k) a full event ring loses no point: three regulators and a newer grip while the ring is full; nothing arrives while it is full, after it drained the points come
//       once each, in the order spur, field, with the beat and value of their own (newest) grip. No other loss path exists: a pending point goes only by a newer
//       grip (trailing), a disarm, or by being sent
//   (h) allocation guard: commands and points cost 0 allocations inside Kern::zyklus
// Mutations (WILL_FAIL): ARR_ARM_CYPHER (b), ARR_PUNKT_OHNE_ARM (c), ARR_PUNKT_ALLE_SPUREN (c), ARR_PUNKT_IM_STOPP (c), ARR_PUNKT_OHNE_DROSSEL (d),
// ARR_PUNKT_OHNE_NACHZUEGLER (e), ARR_PUNKT_NACHZUEGLER_ERSTER (e), ARR_PUNKT_BEAT_JETZT (e), ARR_PUNKT_BEAT_LINEAR (f), ARR_PUNKT_BEAT_OHNE_NAHT (f),
// ARR_PUNKT_STOPP_VERWIRFT (g), ARR_ARM_AUS_BEHAELT (g), ARR_PUNKT_PAARUNG_ERSTER (i), ARR_ARM_AUS_FENSTER_NEU (j), ARR_PUNKT_VOLL_VERWIRFT (k).
#include <unistd.h>

#include <cmath>
#include <cstdio>
#include <cstring>

#include "arr_run.h"
#include "cypherdj/signalbox/types.h"
#include "alloc_intercept.h"   // last: replaces malloc and relatives

bool g_waechter = false;

using k35::N;
namespace sw = cypherdj::stellwerk;

namespace {
struct Aufbau {
  k35::Arbeitsbestand ab;
  std::unique_ptr<arr35::Lauf> x;
  float schritt = 0.004f;   // raw movement per grip
  int zaehler[8] = {};   // per path index: the next raw value (every grip is a real movement)
  explicit Aufbau(const char* name, int spuren = 2) : ab(name) {
    x.reset(new arr35::Lauf(ab.pfad, name));
    for (int nr = 1; nr <= spuren; ++nr) {
      x->teil(("spur/" + std::to_string(nr) + "/fader").c_str(), 0.0f, 0.0, 0.0);
      x->teil(("spur/" + std::to_string(nr) + "/pan").c_str(), 0.0f, 0.0, 0.0);
    }
    const std::string audio = x->ordner.audio('a', 800000, 0.1f);
    std::string s;
    for (int nr = 1; nr <= spuren; ++nr)
      s += (nr > 1 ? "," : "") + std::string("{\"nr\":") + std::to_string(nr) + ",\"art\":\"audio\",\"clips\":[" +
           x->ordner.clip(("c" + std::to_string(nr)).c_str(), 0.0, 30.0, audio, 800000) + "],\"auto\":[" +
           arrdatei::Ordner::auto_lane({{0.0, 0.0, 0}, {16.0, -30.0, 0}}) + "]}";
    x->laden(1, s, "andreas", true);
  }
  const cdj::Arrangement& arr() const { return x->kern->arrangement(); }
  const cdj::Karte& karte() const { return x->kern->karte(); }
  void spiele(int zyklen) { x->zyklen(x->kern->sample() + zyklen * N); }
  void start_und_lauf(int zyklen = 12) {
    x->start(0.0, 0);
    spiele(zyklen);
  }
  int64_t arm(int spur, int an, int modus = 1, const char* quelle = "andreas") {
    cdj::Befehl b = x->neu(cdj::Befehl::ARR_ARM, quelle);
    b.nr = spur;
    b.an = an;
    b.politik = modus;
    return x->sende(b);
  }
  double fader(int nr) const { return x->wert(("spur/" + std::to_string(nr) + "/fader").c_str()); }
  double pan(int nr) const { return x->wert(("spur/" + std::to_string(nr) + "/pan").c_str()); }
  // sample of the cycle after the next one: a grip placed in it is processed in exactly that cycle
  int64_t naechster() const { return (x->kern->sample() / N + 1) * N; }
  // the first message of a regulator only sets the position (no grip); the next ones are grips (the raw value moves by 0.004 per message)
  void position(const char* pfad) {
    x->test_hand(pfad, 0.2f, naechster() + 10);
    spiele(2);
  }
  // one grip per call at `versatz` into the next cycle, then one cycle; returns the sample of the grip
  int64_t griff(int idx, const char* pfad, int versatz = 10) {
    const int64_t s = naechster() + versatz;
    x->test_hand(pfad, 0.2f + schritt * static_cast<float>(++zaehler[idx]), s);
    spiele(1);
    return s;
  }
  std::vector<cdj::Ereignis> punkte(const char* pfad = nullptr, size_t von = 0) const {
    std::vector<cdj::Ereignis> v;
    for (size_t i = von; i < x->ev.size(); ++i)
      if (x->ev[i].art == cdj::Ereignis::AUTO_PUNKT && (!pfad || !std::strcmp(x->ev[i].pfad, pfad))) v.push_back(x->ev[i]);
    return v;
  }
  bool abgelehnt(int64_t id, const char* grund) const {
    const k35::Q* q6 = x->quittung(id, 6);
    return q6 && q6->grund == grund && !x->quittung(id, 3);
  }
  // the project beat the playback has at Kern sample s, derived from the elapsed Kern beats only (start_beat 0, loop von..bis): the oracle of (e), (f)
  double projekt_beat(int64_t s, double kb0, bool schleife = false, double von = 0.0, double bis = 0.0) const {
    const double e = karte().beat_at(static_cast<double>(s)) - kb0;
    if (!schleife || e < bis) return e;
    return von + std::fmod(e - von, bis - von);
  }
  double kb0() const {
    const cdj::ArrZustand z = arr().zustand(karte(), x->kern->sample());
    return karte().beat_at(static_cast<double>(z.ursprung_sample));
  }
};
}  // namespace

int main() {
  {  // (a) command -> state
    Aufbau a("test_kern_arr_arm_a");
    a.start_und_lauf();
    PRUEF(a.x->kern->auto_arm(1) == -1 && a.x->kern->auto_arm(2) == -1);
    const int64_t i1 = a.arm(1, 1, 2);
    a.spiele(2);
    PRUEF(a.x->quittung(i1, 1) && a.x->quittung(i1, 3));
    PRUEF(a.x->kern->auto_arm(1) == 2);    // OSC track 1, mode write
    PRUEF(a.x->kern->auto_arm(2) == -1);   // another track is untouched
    const int64_t i2 = a.arm(2, 1, 0);
    a.spiele(2);
    PRUEF(a.x->quittung(i2, 3) && a.x->kern->auto_arm(1) == 2 && a.x->kern->auto_arm(2) == 0);
    a.arm(1, 1, 1);   // the mode is sent again with every arm: the new mode wins
    a.spiele(2);
    PRUEF(a.x->kern->auto_arm(1) == 1);
    a.arm(2, 0);
    a.spiele(2);
    PRUEF(a.x->kern->auto_arm(2) == -1 && a.x->kern->auto_arm(1) == 1);   // one track off, the other stays
    a.arm(2, 1, 2);
    const int64_t i3 = a.arm(0, 0, 0);   // spur 0 with an 0: everything off
    a.spiele(2);
    PRUEF(a.x->quittung(i3, 1) && a.x->quittung(i3, 3));
    PRUEF(a.x->kern->auto_arm(1) == -1 && a.x->kern->auto_arm(2) == -1);
    PRUEF(a.x->kern->auto_arm(0) == -1 && a.x->kern->auto_arm(33) == -1);
    std::printf("a: arm 1 -> %d, arm 2 -> %d after the disarm of all\n", a.x->kern->auto_arm(1), a.x->kern->auto_arm(2));
  }
  {  // (b) refusals
    Aufbau a("test_kern_arr_arm_b");
    a.start_und_lauf();
    const int64_t i_hoch = a.arm(33, 1), i_neg = a.arm(-1, 1), i_an = a.arm(1, 2), i_m = a.arm(1, 1, 3), i_m2 = a.arm(1, 1, -1);
    const int64_t i_alle = a.arm(0, 1, 1);
    a.spiele(2);
    for (int64_t id : {i_hoch, i_neg, i_an, i_m, i_m2, i_alle}) PRUEF(a.abgelehnt(id, "format"));
    const int64_t i_cy = a.arm(1, 1, 1, "cypher"), i_cy0 = a.arm(1, 0, 1, "cypher"), i_lei = a.arm(2, 1, 1, "leitstand");
    a.spiele(2);
    PRUEF(a.abgelehnt(i_cy, "nur_andreas") && a.abgelehnt(i_cy0, "nur_andreas") && a.abgelehnt(i_lei, "nur_andreas"));
    PRUEF(a.x->kern->auto_arm(1) == -1 && a.x->kern->auto_arm(2) == -1);   // nothing was armed
    const int64_t i_ok = a.arm(1, 1, 1, "andreas");   // negative control: the same command from andreas works
    a.spiele(2);
    PRUEF(a.x->quittung(i_ok, 3) && a.x->kern->auto_arm(1) == 1);
    const int64_t i_cy2 = a.arm(1, 0, 1, "cypher");   // cypher cannot disarm either
    a.spiele(2);
    PRUEF(a.abgelehnt(i_cy2, "nur_andreas") && a.x->kern->auto_arm(1) == 1);
    // the order: range first, then the source; in the AI stop cypher gets ki_gestoppt first
    const int64_t i_o = a.arm(99, 1, 1, "cypher");
    a.spiele(2);
    PRUEF(a.abgelehnt(i_o, "format"));
    cdj::Befehl ki = a.x->neu(cdj::Befehl::KI_STOPP, "andreas");
    a.x->sende(ki);
    a.spiele(2);
    const int64_t i_ki = a.arm(1, 1, 1, "cypher");
    a.spiele(2);
    PRUEF(a.abgelehnt(i_ki, "ki_gestoppt"));
  }
  {  // (c) gates
    Aufbau a("test_kern_arr_arm_c");
    a.start_und_lauf();
    a.position("spur/1/fader");
    a.position("spur/2/fader");
    a.position("spur/1/pan");
    const size_t e0 = a.x->ev.size();
    for (int k = 0; k < 12; ++k) {   // no arm anywhere: the grips override (control that they are grips) but report nothing
      a.griff(0, "spur/1/fader");
      a.griff(1, "spur/2/fader");
    }
    PRUEF(a.arr().auto_uebersteuert(0, 0) && a.arr().auto_uebersteuert(1, 0));
    PRUEF(a.punkte(nullptr, e0).empty());
    a.arm(1, 1, 1);
    a.spiele(2);
    const size_t e1 = a.x->ev.size();
    for (int k = 0; k < 12; ++k) {   // track 1 armed: its grips report, the grips of the unarmed track 2 do not
      a.griff(0, "spur/1/fader");
      a.griff(1, "spur/2/fader");
    }
    PRUEF(!a.punkte("spur/1/fader", e1).empty());
    PRUEF(a.punkte("spur/2/fader", e1).empty());
    std::printf("c: track 1 reported %zu points, unarmed track 2 reported %zu\n", a.punkte("spur/1/fader", e1).size(), a.punkte("spur/2/fader", e1).size());
    // pan and fader of the armed track: independent windows (both report in the same cycle)
    a.spiele(8);
    const size_t e2 = a.x->ev.size();
    const int64_t sf = a.naechster() + 10;
    a.x->test_hand("spur/1/fader", 0.9f, sf);
    a.x->test_hand("spur/1/pan", 0.9f, sf + 5);
    a.spiele(2);
    const auto pf = a.punkte("spur/1/fader", e2), pp = a.punkte("spur/1/pan", e2);
    PRUEF(pf.size() == 1 && pp.size() == 1);
    // while the transport stands: arm stays, grips report nothing (and override nothing, D5)
    a.x->stopp(0);
    a.spiele(4);
    PRUEF(a.arr().status() == cdj::ArrStatus::steht && a.x->kern->auto_arm(1) == 1);
    const size_t e3 = a.x->ev.size();
    for (int k = 0; k < 12; ++k) a.griff(0, "spur/1/fader");
    PRUEF(a.punkte(nullptr, e3).empty());
    // control: playing again, the same kind of grips report
    a.x->start(0.0, 0);
    a.spiele(12);
    const size_t e4 = a.x->ev.size();
    for (int k = 0; k < 12; ++k) a.griff(0, "spur/1/fader");
    PRUEF(!a.punkte("spur/1/fader", e4).empty());
  }
  {  // (d) the rate cap
    Aufbau a("test_kern_arr_arm_d", 1);
    a.start_und_lauf();
    a.position("spur/1/fader");
    a.arm(1, 1, 1);
    a.spiele(2);
    const size_t e0 = a.x->ev.size();
    const int zyklen = 120;   // 120 * 256 samples = 0.64 s: at most 32 windows of 960 samples
    for (int k = 0; k < zyklen; ++k) a.griff(0, "spur/1/fader");
    a.spiele(8);
    const auto p = a.punkte("spur/1/fader", e0);
    const int64_t abstand = cypherdj::stellwerk::REGLER_MELDUNG_ABSTAND;
    int64_t kleinster = 1 << 30;
    for (size_t i = 1; i < p.size(); ++i) kleinster = std::min(kleinster, p[i].sample - p[i - 1].sample);
    std::printf("d: %zu points for %d grips, smallest spacing %lld samples (cap %lld)\n", p.size(), zyklen, (long long)kleinster, (long long)abstand);
    PRUEF(p.size() >= 25 && p.size() <= static_cast<size_t>((zyklen * N + 8 * N) / abstand) + 1);
    PRUEF(kleinster >= abstand);
  }
  {  // (e) the last value of a gesture arrives, with the beat of its own grip
    Aufbau a("test_kern_arr_arm_e", 1);
    a.start_und_lauf();
    a.position("spur/1/fader");
    a.arm(1, 1, 1);
    a.schritt = 0.03f;
    a.spiele(12);   // the window of every earlier point is long over
    const double kb0 = a.kb0();
    const size_t e0 = a.x->ev.size();
    // three grips in three consecutive cycles; the value is read after the cycle that holds the grip
    const int64_t g1 = a.naechster() + 10, g2 = g1 + N, g3 = g2 + N;
    for (int64_t g : {g1, g2, g3}) a.x->test_hand("spur/1/fader", 0.2f + a.schritt * static_cast<float>(++a.zaehler[0]), g);
    a.x->zyklen((g1 / N + 1) * N);
    const double f1 = a.fader(1);
    a.x->zyklen((g2 / N + 1) * N);
    const double f2 = a.fader(1);
    a.x->zyklen((g3 / N + 1) * N);
    const double f3 = a.fader(1);
    a.spiele(10);
    const auto p = a.punkte("spur/1/fader", e0);
    std::printf("e: %zu points; values sent %.3f %.3f (cycle values %.3f %.3f %.3f)\n", p.size(), p.size() > 0 ? p[0].wert : 0.0f,
                p.size() > 1 ? p[1].wert : 0.0f, f1, f2, f3);
    PRUEF(p.size() == 2);   // the first at once, the second is the held (trailing) one: no more, no less
    if (p.size() == 2) {
      PRUEF(std::fabs(p[0].wert - f1) < 1e-3 && std::fabs(p[0].beat - a.projekt_beat(g1, kb0)) < 1e-6);
      PRUEF(f2 > f1 + 0.05 && f3 > f2 + 0.05);   // the three values differ clearly (so "wrong one" is visible)
      PRUEF(std::fabs(p[1].wert - f3) < 1e-3);   // the NEWEST value of the gesture wins, not the first held one (f2)
      PRUEF(std::fabs(p[1].beat - a.projekt_beat(g3, kb0)) < 1e-6);   // the beat of the grip, stored with the value
      const double beat_beim_senden = a.karte().beat_at(static_cast<double>(p[1].sample)) - kb0;
      std::printf("e: trailing beat %.4f (grip g3), beat when it was sent %.4f, g2 %.4f\n", p[1].beat, beat_beim_senden, a.projekt_beat(g2, kb0));
      PRUEF(beat_beim_senden - p[1].beat > 0.01);   // it was sent later than it was made
      PRUEF(p[1].sample - g3 >= N);
    }
  }
  {  // (f) the beat over a tempo ramp and over the loop seam
    Aufbau a("test_kern_arr_arm_f");
    {
      cdj::Befehl r = a.x->neu(cdj::Befehl::TEMPO_RAMPE, "andreas");
      r.ab_beat = 1.0;
      r.ziel_bpm = 90.0;
      r.dauer_beats = 8.0;   // from 128 down to 90 BPM, kern beat 1 to 9: the whole run below is on the ramp
      a.x->sende(r);
    }
    a.start_und_lauf(10);
    const double kb0 = a.kb0();
    // loop 2..bis; bis is chosen so that the seam sample lies in the middle of a cycle (a grip before and a grip behind it in one cycle)
    double bis = 6.0;
    int64_t w = 0;
    for (; bis < 7.0; bis += 0.01) {
      w = std::llround(a.karte().sample_at(kb0 + bis));
      if (w % N >= 40 && w % N <= 200) break;
    }
    PRUEF(w % N >= 40 && w % N <= 200);
    a.x->loop(true, 2.0, bis);
    a.spiele(2);
    a.arm(1, 1, 1);
    a.arm(2, 1, 1);
    a.position("spur/1/fader");
    a.position("spur/2/fader");
    // 1) on the ramp, far from the seam: beat = elapsed Kern beats (a constant tempo from the start would be far off)
    const size_t e0 = a.x->ev.size();
    a.spiele(300);   // about beat 3.4 of the run, on the ramp (it starts at Kern beat 1)
    const int64_t gr = a.griff(0, "spur/1/fader");
    a.spiele(8);
    auto p = a.punkte("spur/1/fader", e0);
    PRUEF(p.size() == 1);
    if (p.size() == 1) {
      const double soll = a.projekt_beat(gr, kb0, true, 2.0, bis);
      const double linear = static_cast<double>(gr - (a.arr().zustand(a.karte(), gr).ursprung_sample)) * 128.0 / 60.0 / 48000.0;
      std::printf("f: ramp: beat %.5f, oracle %.5f, constant 128 BPM would give %.5f\n", p[0].beat, soll, linear);
      PRUEF(std::fabs(p[0].beat - soll) < 1e-6 && std::fabs(soll - linear) > 0.01);
    }
    // 2) the seam: bring the transport up to the cycle before the seam, then a grip 3 samples before it (track 1) and 3 samples behind it (track 2)
    a.x->zyklen((w / N - 1) * N);
    PRUEF(a.x->kern->sample() <= (w / N) * N - N + N && a.arr().status() == cdj::ArrStatus::spielt);
    const size_t e1 = a.x->ev.size();
    const int64_t vor = w - 3, nach = w + 3;
    PRUEF(vor / N == nach / N && vor / N * N >= a.x->kern->sample());
    a.x->test_hand("spur/1/fader", 0.7f, vor);
    a.x->test_hand("spur/2/fader", 0.7f, nach);
    a.x->zyklen((w / N + 3) * N);
    const auto pv = a.punkte("spur/1/fader", e1), pn = a.punkte("spur/2/fader", e1);
    PRUEF(pv.size() == 1 && pn.size() == 1);
    if (pv.size() == 1 && pn.size() == 1) {
      const double sv = a.projekt_beat(vor, kb0, true, 2.0, bis), sn = a.projekt_beat(nach, kb0, true, 2.0, bis);
      std::printf("f: seam at sample %lld (bis %.2f): before %.5f (oracle %.5f), behind %.5f (oracle %.5f)\n", (long long)w, bis, pv[0].beat, sv, pn[0].beat, sn);
      PRUEF(sv > bis - 0.05 && sn < 2.0 + 0.05);   // the oracle itself: just before bis, just after von
      PRUEF(std::fabs(pv[0].beat - sv) < 1e-6);
      PRUEF(std::fabs(pn[0].beat - sn) < 1e-6);
    }
  }
  {  // (g) stop sends what is held; disarming drops it
    Aufbau a("test_kern_arr_arm_g", 1);
    a.start_und_lauf();
    a.position("spur/1/fader");
    a.arm(1, 1, 1);
    a.spiele(12);
    const size_t e0 = a.x->ev.size();
    a.griff(0, "spur/1/fader");   // sent at once
    a.griff(0, "spur/1/fader");   // held
    a.spiele(1);                  // the cycle of the second grip is through (griff places its grip one cycle ahead)
    const double f2 = a.fader(1);
    a.x->stopp(0);
    a.spiele(12);
    const auto p = a.punkte("spur/1/fader", e0);
    PRUEF(p.size() == 2 && a.arr().status() == cdj::ArrStatus::steht);
    {   // the order at the stop, measured against /zustand/arr: index in the event list of the held point and of the first stopped state after the stop command
      size_t i_pkt = 0, i_steht = 0;
      for (size_t i = e0; i < a.x->ev.size(); ++i) {
        if (a.x->ev[i].art == cdj::Ereignis::AUTO_PUNKT) i_pkt = i;
        if (!i_steht && i > e0 + 1 && a.x->ev[i].art == cdj::Ereignis::ARR_ZUSTAND && a.x->ev[i].arr_status == 0) i_steht = i;
      }
      std::printf("g: held point at event %zu, first stopped /zustand/arr at event %zu\n", i_pkt, i_steht);
      PRUEF(i_pkt > 0 && i_steht > 0);
      PRUEF(i_pkt > i_steht);   // documented: the held point comes after the stopped status
    }
    if (p.size() == 2) PRUEF(std::fabs(p[1].wert - f2) < 1e-3);   // the held value is not lost at the stop
    // nothing comes later: the transport stands
    a.spiele(12);
    PRUEF(a.punkte("spur/1/fader", e0).size() == 2);
    // disarm drops the held point
    a.x->start(0.0, 0);
    a.spiele(30);
    const size_t e1 = a.x->ev.size();
    a.griff(0, "spur/1/fader");   // sent at once
    a.griff(0, "spur/1/fader");   // held
    a.spiele(1);                  // the second grip is through (held: its window of 960 samples is not over); the disarm comes in the cycle after
    a.arm(1, 0);
    a.spiele(12);
    PRUEF(a.punkte("spur/1/fader", e1).size() == 1);
    a.arm(1, 1, 1);   // armed again, no grip since: the stale point must not come out
    a.spiele(12);
    PRUEF(a.punkte("spur/1/fader", e1).size() == 1);
    // control: a new grip after the re-arm reports
    a.griff(0, "spur/1/fader");
    a.spiele(6);
    PRUEF(a.punkte("spur/1/fader", e1).size() == 2);
  }
  {  // (i) beat and value of one sample, in a 1024-sample cycle over a tempo ramp
    Aufbau a("test_kern_arr_arm_i", 1);
    {
      cdj::Befehl r = a.x->neu(cdj::Befehl::TEMPO_RAMPE, "andreas");
      r.ab_beat = 1.0;
      r.ziel_bpm = 175.0;
      r.dauer_beats = 8.0;
      a.x->sende(r);
    }
    a.start_und_lauf(10);
    constexpr int B = 1024;
    a.x->zyklen((a.x->kern->sample() / B + 1) * B);   // from here on cycles of the real MIX_BLOCK
    std::vector<cdj::Ereignis> punkte;
    auto zyklus = [&]() {
      const int64_t n0 = a.x->kern->sample();
      a.x->kern->zyklus(B, n0 * 20833);
      cdj::Ereignis e;
      while (a.x->ere->hole(e))
        if (e.art == cdj::Ereignis::AUTO_PUNKT) punkte.push_back(e);
    };
    a.arm(1, 1, 1);
    zyklus();
    zyklus();
    a.x->test_hand("spur/1/fader", 0.2f, a.x->kern->sample() + 10);   // the position
    for (int k = 0; k < 8; ++k) zyklus();                             // the window of the position message is long over, the transport runs on the ramp
    const double kb0 = a.kb0();
    const int64_t S = a.x->kern->sample();
    const int versatz[8] = {20, 150, 280, 410, 540, 670, 800, 930};
    for (int k = 0; k < 8; ++k) a.x->test_hand("spur/1/fader", 0.25f + 0.05f * static_cast<float>(k), S + versatz[k]);
    const size_t n0p = punkte.size();
    zyklus();
    PRUEF(punkte.size() == n0p + 1);
    const sw::Stellwerk& st = a.x->kern->stellwerk();
    const int r = st.tabelle().suche("spur/1/fader");
    const sw::Aenderung* av = nullptr;
    int na = st.aenderungen(&av), k = 0;
    for (; k < na && av[k].regler != r; ++k) {
    }
    PRUEF(k < na);
    if (punkte.size() == n0p + 1 && k < na) {
      const cdj::Ereignis& p = punkte.back();
      const int64_t samp = std::llround(a.karte().sample_at(p.beat + kb0));
      const int idx = static_cast<int>(samp - S);
      PRUEF(idx >= 0 && idx < B);
      const double am_beat = idx >= 0 && idx < B ? av[k].verlauf[idx] : 1e9;
      std::printf("i: point beat %.5f -> sample S+%d (last grip S+%d), value %.4f, course there %.4f, course at the first grip %.4f, at the block end %.4f\n", p.beat,
                  idx, versatz[7], p.wert, am_beat, av[k].verlauf[versatz[0]], av[k].verlauf[B - 1]);
      PRUEF(std::abs(idx - versatz[7]) <= 1);                 // the beat is that of the last grip
      PRUEF(std::fabs(p.wert - am_beat) < 1e-3);              // and the value is the one the regulator has at that beat
      PRUEF(std::fabs(av[k].verlauf[versatz[0]] - am_beat) > 0.3);   // control: the course moved, so the first-grip pairing would be visible
    }
  }
  {  // (j) the rate window survives a disarm
    Aufbau a("test_kern_arr_arm_j", 1);
    a.start_und_lauf();
    a.position("spur/1/fader");
    a.arm(1, 1, 1);
    a.spiele(12);
    const size_t e0 = a.x->ev.size();
    a.griff(0, "spur/1/fader");   // sent at once: the window opens
    a.spiele(1);                  // the grip is through before the disarm comes
    a.arm(1, 0);
    a.arm(1, 1, 1);               // disarm and re-arm in a row
    a.griff(0, "spur/1/fader");   // inside the window of the first point
    a.spiele(12);
    const auto p = a.punkte("spur/1/fader", e0);
    std::printf("j: %zu points, spacing %lld samples\n", p.size(), p.size() > 1 ? (long long)(p[1].sample - p[0].sample) : -1LL);
    PRUEF(p.size() == 2);
    if (p.size() == 2) PRUEF(p[1].sample - p[0].sample >= cypherdj::stellwerk::REGLER_MELDUNG_ABSTAND);
    // the held point is dropped by the disarm (a stale value does not come back) - checked in (g)
  }
  {  // (k) a full event ring loses no point
    Aufbau a("test_kern_arr_arm_k", 2);
    a.start_und_lauf();
    a.position("spur/1/fader");
    a.position("spur/1/pan");
    a.position("spur/2/fader");
    a.arm(1, 1, 1);
    a.arm(2, 1, 1);
    a.spiele(12);
    const double kb0 = a.kb0();
    a.x->abholen = false;   // the test reads the event ring itself
    cdj::Ereignisring& ere = *a.x->ere;
    std::vector<cdj::Ereignis> punkte;
    auto leeren = [&]() {
      cdj::Ereignis e;
      while (ere.hole(e))
        if (e.art == cdj::Ereignis::AUTO_PUNKT) punkte.push_back(e);
    };
    leeren();
    punkte.clear();
    auto fuellen = [&]() {
      cdj::Ereignis d{};
      d.art = 9999;
      while (ere.schiebe(d)) {
      }
    };
    const int64_t S = a.x->kern->sample();
    a.x->test_hand("spur/1/fader", 0.30f, S + 10);
    a.x->test_hand("spur/1/pan", 0.60f, S + 20);
    a.x->test_hand("spur/2/fader", 0.40f, S + 30);
    fuellen();                 // the ring is full before the cycle that holds the grips
    a.x->zyklen(S + N);
    const int64_t g2 = S + N + 50;   // a newer grip of the first regulator, ring still full
    a.x->test_hand("spur/1/fader", 0.35f, g2);
    fuellen();
    a.x->zyklen(S + 2 * N);
    const double fader1 = a.fader(1), pan1 = a.pan(1), fader2 = a.fader(2);
    leeren();
    PRUEF(punkte.empty());     // nothing got through the full ring (control: the points are pending, not sent)
    a.x->zyklen(S + 3 * N);    // the ring is empty now
    leeren();
    std::printf("k: %zu points after the ring drained\n", punkte.size());
    PRUEF(punkte.size() == 3);
    if (punkte.size() == 3) {
      PRUEF(!std::strcmp(punkte[0].pfad, "spur/1/fader") && !std::strcmp(punkte[1].pfad, "spur/1/pan") && !std::strcmp(punkte[2].pfad, "spur/2/fader"));
      PRUEF(std::fabs(punkte[0].wert - fader1) < 1e-3 && std::fabs(punkte[0].beat - a.projekt_beat(g2, kb0)) < 1e-6);   // the NEWER grip replaced the pending one
      PRUEF(std::fabs(punkte[1].wert - pan1) < 1e-3 && std::fabs(punkte[1].beat - a.projekt_beat(S + 20, kb0)) < 1e-6);
      PRUEF(std::fabs(punkte[2].wert - fader2) < 1e-3 && std::fabs(punkte[2].beat - a.projekt_beat(S + 30, kb0)) < 1e-6);
    }
    a.x->zyklen(S + 12 * N);   // and they come once
    leeren();
    PRUEF(punkte.size() == 3);
  }
  {  // (h) allocation guard
    if (!ALLOC_ABFANG_VERFUEGBAR) {
      std::printf("skipped (sanitizer build): allocation watcher not available\n");
    } else {
      Aufbau a("test_kern_arr_arm_h", 2);
      a.start_und_lauf();
      a.position("spur/1/fader");
      a.position("spur/2/fader");
      k35::Lauf& x = *a.x;
      long im_zyklus = 0;
      size_t punkte = 0;
      auto zyklus = [&]() {
        const int64_t n0 = x.kern->sample();
        abfang_an();
        x.kern->zyklus(N, n0 * 20833);
        im_zyklus += abfang_aus();
        cdj::Ereignis e;
        while (x.ere->hole(e))
          if (e.art == cdj::Ereignis::AUTO_PUNKT) ++punkte;
      };
      for (int i = 0; i < 4; ++i) zyklus();
      a.arm(1, 1, 2);
      a.arm(2, 1, 0);
      for (int k = 0; k < 60; ++k) {
        const int64_t s = x.kern->sample() + N + 10;
        x.test_hand(k % 2 ? "spur/1/fader" : "spur/2/fader", 0.2f + 0.004f * static_cast<float>(k + 1), s);
        if (k == 20) a.arm(0, 0, 0);
        if (k == 22) a.arm(1, 1, 1);
        zyklus();
        zyklus();
      }
      std::printf("h: allocations inside Kern::zyklus = %ld (%zu points)\n", im_zyklus, punkte);
      PRUEF(punkte > 3);
      PRUEF(im_zyklus == 0);
    }
  }
  PRUEF_ENDE();
}
