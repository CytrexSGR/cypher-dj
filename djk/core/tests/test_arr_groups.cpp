// 1.10 Slice 1: Gruppen und Produktions-Master im Modul Arrangement (Spec 1.10 5.4; AK1 Negativ-Kontrolle, AK4, AK5, AK6, AK20).
// Gleichwert 0,25 je Spur, Spuren in Mitte (je 0,25·MITTE), Start ab Takt (90 000), Blöcke zu 256.
// Mutationen: ARR_ZIEL_IGNORIERT (Fälle 2, 3, 3c, 3d, 5 und 6 rot, gemessen in Task 6: die Spur bleibt auf master. Fall 1 bleibt grün: bei 0 dB und Balance-Mitte ist die Summe dieselbe und `gruppe_belegt` kommt aus dem Schnappschuss, nicht aus dem Ziel; Fall 4 benutzt keine Gruppe und bleibt grün, er ist die Negativ-Kontrolle), ARR_ZIEL_HART (Fall 6 rot: Ziel-Wechsel ohne Blende; Fall 6b bleibt grün, siehe dort),
// ARR_PM_FADER_AUS (Fall 7 rot), ARR_MUTE_HART (Fall 3 rot: Gruppen-Mute ohne Blende).
#include <algorithm>
#include <cmath>
#include <cstring>
#include <memory>
#include <string>
#include <vector>

#include "arr_build.h"
#include "check.h"

using namespace arrtest;
using cdj::ArrArt;

static constexpr int64_t V = 537;
static const double MITTE = 0.70710677;

// Schnappschuss mit Audio-Spuren 1..n (je ein Clip, 8 Beats); ziele[i] = Gruppe der Spur i+1 (0 = master)
static cdj::ArrSnapshot* snap(const cdj::ArrAudio* a, const std::vector<int>& ziele, int64_t nr = 1) {
  Bau b(nr);
  for (size_t i = 0; i < ziele.size(); ++i) {
    const std::string id = "c" + std::to_string(i + 1);
    const int sp = static_cast<int>(i) + 1;
    b.spur(sp, ArrArt::audio).clip(sp, id.c_str(), 0.0, 8.0, a).ausgang(sp, ziele[i]);
  }
  return b.fertig();
}
// The same with nested groups: eltern[g] = the group group g+1 outputs into (0 = master), up to ARR_GRUPPEN entries; ret = return 1 exists (dry, see `rueck`)
static cdj::ArrSnapshot* snapn(const cdj::ArrAudio* a, const std::vector<int>& ziele, const std::vector<int>& eltern, int64_t nr = 1, bool ret = false) {
  Bau b(nr);
  for (size_t i = 0; i < ziele.size(); ++i) {
    const std::string id = "c" + std::to_string(i + 1);
    const int sp = static_cast<int>(i) + 1;
    b.spur(sp, ArrArt::audio).clip(sp, id.c_str(), 0.0, 8.0, a).ausgang(sp, ziele[i]);
  }
  for (size_t g = 0; g < eltern.size(); ++g) b.gruppe_ausgang(static_cast<int>(g) + 1, eltern[g]);
  cdj::ArrSnapshot* s = b.fertig();
  if (ret) {
    s->ret_da[0] = true;
    cdj::arr_pdc_rechnen(*s);   // the loader computes the delays once the returns are known
  }
  return s;
}
// Treiber holds a whole Arrangement (about 2 MB): the cases of this file own theirs on the heap, so that main's frame stays small
#define TR(n) auto n##_p = std::make_unique<Treiber>(); Treiber& n = *n##_p;
static void spiele(Treiber& t, cdj::ArrSnapshot* s, int64_t bis = 99840) {
  t.laden(s);
  t.arr.start(0.0, 2, false, 0, V, 256, t.k);
  t.lauf(bis);
}
static int reg(Treiber& t, const char* pfad) {
  const int r = t.tab.suche(pfad);
  PRUEF(r >= 0);
  return r;
}

int main() {
  auto a = Audio::gleich(400000, 0.25f);
  {  // 1: Gruppieren ändert den Pegel nicht (Gruppen-Pan ist eine Balance, Mitte 0 dB; P14); ohne Gruppe bleibt es die alte Summe
    Treiber roh, grp;
    spiele(roh, snap(&a->a, {0, 0, 0}));
    spiele(grp, snap(&a->a, {1, 1, 0}));
    PRUEF_NAH(roh.l[99000], 3 * 0.25 * MITTE, 1e-6);
    PRUEF_NAH(grp.l[99000], roh.l[99000], 1e-6);
    PRUEF_NAH(grp.r[99000], roh.r[99000], 1e-6);
    PRUEF(grp.arr.gruppe_belegt(0) && !grp.arr.gruppe_belegt(1));
    PRUEF(!roh.arr.gruppe_belegt(0));
  }
  {  // 2 (AK4): Gruppen-Fader −6,0206 dB senkt die Summe der Mitglieder um 6,0 dB ±0,1; Spur 3 ohne Gruppe bleibt (Negativ-Kontrolle)
    Treiber t;
    spiele(t, snap(&a->a, {1, 1}));
    PRUEF_NAH(t.l[99000], 2 * 0.25 * MITTE, 1e-6);
    t.arr.setze_sofort(reg(t, "grp/1/fader"), -6.0206f);
    t.lauf(100352);
    PRUEF_NAH(t.l[100000], 0.5 * 2 * 0.25 * MITTE, 1e-5);
    PRUEF_NAH(20.0 * std::log10(t.l[100000] / t.l[99000]), -6.0206, 0.1);
    Treiber u;   // Spur 1 und 2 stumm, nur Spur 3 (direkt) klingt: der Gruppen-Fader berührt sie nicht
    spiele(u, snap(&a->a, {1, 1, 0}));
    u.arr.setze_sofort(reg(u, "spur/1/mute"), 1.0f);
    u.arr.setze_sofort(reg(u, "spur/2/mute"), 1.0f);
    u.arr.setze_sofort(reg(u, "grp/1/fader"), -6.0206f);
    u.lauf(101000);
    PRUEF_NAH(u.l[100800], 0.25 * MITTE, 1e-6);
  }
  {  // 3 (AK5): Gruppen-Mute nullt beide Mitglieder (Blende 480 Samples linear), Spur 3 bleibt
    Treiber t;
    spiele(t, snap(&a->a, {1, 1, 0}));
    PRUEF_NAH(t.l[99000], 3 * 0.25 * MITTE, 1e-6);
    t.arr.setze_sofort(reg(t, "grp/1/mute"), 1.0f);
    t.lauf(101000);
    PRUEF_NAH(t.l[99839], 3 * 0.25 * MITTE, 1e-6);
    PRUEF_NAH(t.l[99840 + 239], 0.25 * MITTE + 2 * 0.25 * MITTE * 0.5, 1e-5);   // Mitte der Blende
    PRUEF_NAH(t.l[100500], 0.25 * MITTE, 1e-6);                                  // nur Spur 3
  }
  {  // 3b (AK5, F2): Solo auf Spur 1 lässt nur Spur 1 und ihre Gruppe klingen (Spur 2 und 3 schweigen)
    Treiber t;
    spiele(t, snap(&a->a, {1, 1, 0}));
    t.arr.setze_sofort(reg(t, "spur/1/solo"), 1.0f);
    t.lauf(101000);
    PRUEF_NAH(t.l[100500], 0.25 * MITTE, 1e-6);
  }
  {  // 3c (AK5): Solo auf der Gruppe lässt alle Mitglieder klingen, Spur 3 schweigt
    Treiber t;
    spiele(t, snap(&a->a, {1, 1, 0}));
    t.arr.setze_sofort(reg(t, "grp/1/solo"), 1.0f);
    t.lauf(101000);
    PRUEF_NAH(t.l[100500], 2 * 0.25 * MITTE, 1e-6);
  }
  {  // 3d (AK5): Gruppen-Balance: ganz rechts L 0 und R voll (0 dB), ganz links umgekehrt, Mitte unverändert
    Treiber t;
    spiele(t, snap(&a->a, {1, 1}));
    t.arr.setze_sofort(reg(t, "grp/1/pan"), 1.0f);
    t.lauf(100352);
    PRUEF_NAH(t.l[100000], 0.0, 1e-6);
    PRUEF_NAH(t.r[100000], 2 * 0.25 * MITTE, 1e-6);
    t.arr.setze_sofort(reg(t, "grp/1/pan"), -1.0f);
    t.lauf(100864);
    PRUEF_NAH(t.l[100500], 2 * 0.25 * MITTE, 1e-6);
    PRUEF_NAH(t.r[100500], 0.0, 1e-6);
  }
  {  // 4: leere Gruppe und Gruppen-Zustand ohne Mitglieder: nichts klingt zusätzlich, Spitze 0, kein Absturz
    Treiber t;
    spiele(t, snap(&a->a, {0, 0}));
    t.arr.setze_sofort(reg(t, "grp/3/fader"), -12.0f);
    t.arr.setze_sofort(reg(t, "grp/3/mute"), 1.0f);
    t.lauf(100352);
    PRUEF_NAH(t.l[100000], 2 * 0.25 * MITTE, 1e-6);
    PRUEF_NAH(t.arr.spitze_gruppe_lesen(2), 0.0, 0.0);
  }
  {  // 5: Spitze der Gruppe nach dem Gruppen-Fader, beim Lesen zurückgesetzt
    Treiber t;
    spiele(t, snap(&a->a, {1, 1}));
    PRUEF_NAH(t.arr.spitze_gruppe_lesen(0), 2 * 0.25 * MITTE, 1e-6);
    PRUEF_NAH(t.arr.spitze_gruppe_lesen(0), 0.0, 0.0);
    PRUEF_NAH(t.arr.spitze_pm_lesen(), 2 * 0.25 * MITTE, 1e-6);
  }
  {  // 6 (AK6): Ziel-Wechsel master → Gruppe (Fader −6,02 dB) bei laufender Wiedergabe, Gleichwert: kein Sprung
    Treiber t;
    spiele(t, snap(&a->a, {0}));
    t.arr.setze_sofort(reg(t, "grp/1/fader"), -6.0206f);
    t.laden(snap(&a->a, {1}, 2));
    t.lauf(101000);
    PRUEF_NAH(t.l[99839], 0.25 * MITTE, 1e-6);
    PRUEF_NAH(t.l[100800], 0.5 * 0.25 * MITTE, 1e-5);   // Blende (480 Samples) zu Ende
    double sprung = 0.0;
    for (int64_t i = 99800; i < 100800; ++i) sprung = std::max(sprung, static_cast<double>(std::fabs(t.l[i + 1] - t.l[i])));
    PRUEF(sprung < 0.001);   // linear: 0,5 · 0,177 / 480 ≈ 0,00018 je Sample; ohne Blende 0,088 (Mutation ARR_ZIEL_HART)
  }
  {  // 6b (AK6, Spec-Form): Sinus 1 kHz, Wechsel bei Gruppen-Fader 0 dB: größter Sprung höchstens das 1,05-fache des Sinus allein.
     // Bei 0 dB und Balance-Mitte ist der Wechsel pegelneutral (l·(1−z) + l·z = l): auch ARR_ZIEL_HART bleibt hier grün, 6b hat keine eigene Gegenprobe (Prüfung 2, C5).
     // Die Gegenprobe zur Blende ist Fall 6 (Gruppen-Fader −6,02 dB, Sprung 0,088 statt 0,00018); 6b belegt nur, dass die Blende einen Sinus nicht verzerrt.
    auto s = Audio::sinus(400000, 1000.0, 0.5f);
    Treiber t;
    spiele(t, snap(&s->a, {0}));
    t.laden(snap(&s->a, {1}, 2));
    t.lauf(101000);
    double allein = 0.0, wechsel = 0.0;
    for (int64_t i = 98000; i < 99800; ++i) allein = std::max(allein, static_cast<double>(std::fabs(t.l[i + 1] - t.l[i])));
    for (int64_t i = 99800; i < 100900; ++i) wechsel = std::max(wechsel, static_cast<double>(std::fabs(t.l[i + 1] - t.l[i])));
    PRUEF(allein > 0.01);   // der Aufbau sieht den Sinus (sonst wäre der Vergleich leer)
    PRUEF(wechsel <= 1.05 * allein);
  }
  {  // 7 (AK20): PM-Fader −6,0206 dB senkt Ausgang und Abgriff um 6,0 dB ±0,1; der Abgriff ist der PM-Ausgang
    Treiber t;
    spiele(t, snap(&a->a, {0, 0}));
    const float vor = t.l[99000];
    PRUEF_NAH(t.pml[99000], vor, 1e-7);   // Abgriff = Ausgang (erz/4-Eingang war +0)
    t.arr.setze_sofort(reg(t, "pm/fader"), -6.0206f);
    t.lauf(100352);
    PRUEF_NAH(20.0 * std::log10(t.l[100000] / vor), -6.0206, 0.1);
    PRUEF_NAH(t.pml[100000], t.l[100000], 1e-7);
  }
  {  // 8 (AK1, Negativ-Kontrolle und Determinismus): PM-Fader 0 dB gibt zweimal dieselben Bits, 0,01 dB gibt andere
    auto lauf = [&](float pm_db) {
      Treiber t;
      spiele(t, snap(&a->a, {0, 0, 0}));
      if (pm_db != 0.0f) t.arr.setze_sofort(reg(t, "pm/fader"), pm_db);
      t.lauf(102400);
      return std::vector<float>(t.l.begin() + 99840, t.l.end());
    };
    const std::vector<float> n1 = lauf(0.0f), n2 = lauf(0.0f), leicht = lauf(0.01f);
    PRUEF(n1.size() == n2.size() && n1.size() == leicht.size() && !n1.empty());
    PRUEF(std::memcmp(n1.data(), n2.data(), n1.size() * sizeof(float)) == 0);
    PRUEF(std::memcmp(n1.data(), leicht.data(), n1.size() * sizeof(float)) != 0);
  }
  {  // 9 (nested groups): a sine on a track in group 3 (in 2 in 1) equals, sample for sample, the same sine on a track routed to master (faders 0 dB, balances centred)
    auto s = Audio::sinus(400000, 1000.0, 0.5f);
    TR(ref) TR(tief)
    spiele(ref, snap(&s->a, {0}));
    spiele(tief, snapn(&s->a, {3}, {0, 1, 2}));
    PRUEF(tief.arr.gruppe_belegt(2) && tief.arr.gruppe_belegt(1) && tief.arr.gruppe_belegt(0));   // the parents hold no track and count as used
    double d = 0.0, spitze = 0.0;
    for (int64_t i = 98000; i < 99800; ++i) {
      d = std::max(d, static_cast<double>(std::fabs(tief.l[i] - ref.l[i])));
      d = std::max(d, static_cast<double>(std::fabs(tief.r[i] - ref.r[i])));
      spitze = std::max(spitze, static_cast<double>(std::fabs(ref.l[i])));
    }
    PRUEF(spitze > 0.1);   // the reference carries signal
    PRUEF(d < 1e-6);
  }
  {  // 10: group fader -6.0206 dB on each of the three levels gives -18.06 dB at the master
    TR(ref) TR(t)
    spiele(ref, snapn(&a->a, {0}, {0, 1, 2}));
    spiele(t, snapn(&a->a, {3}, {0, 1, 2}));
    for (const char* p : {"grp/1/fader", "grp/2/fader", "grp/3/fader"}) t.arr.setze_sofort(reg(t, p), -6.0206f);
    t.lauf(100800);
    ref.lauf(100800);
    PRUEF_NAH(20.0 * std::log10(t.l[100500] / ref.l[100500]), 3 * -6.0206, 1e-4);
  }
  {  // 11: mute on group 1 silences the track in group 3 and its send to a return (positive control: the return carries signal before)
    TR(t) TR(o)
    for (Treiber* x : {&t, &o}) {
      spiele(*x, snapn(&a->a, {3}, {0, 1, 2}, 1, true));
      x->arr.setze_sofort(reg(*x, "ret/1/hall/an"), 0.0f);   // the return passes dry
    }
    t.arr.setze_sofort(reg(t, "spur/1/send/1"), 0.0f);
    o.arr.setze_sofort(reg(o, "spur/1/send/1"), -200.0f);
    t.lauf(101000);   // the return fades in over 480 samples
    o.lauf(101000);
    PRUEF(t.l[100900] - o.l[100900] > 0.05);   // the send adds to the master
    t.arr.setze_sofort(reg(t, "grp/1/mute"), 1.0f);
    t.lauf(103000);
    PRUEF(std::fabs(t.l[102900]) < 1e-6 && std::fabs(t.r[102900]) < 1e-6);   // direct path and send are both gone after the 480 sample fade
  }
  {  // 12: solo on the track in group 3 lets groups 3, 2, 1 play and silences a sibling track in group 2 and a track on the master (decision 1)
    TR(t)
    spiele(t, snapn(&a->a, {3, 2, 0}, {0, 1, 2}));
    PRUEF_NAH(t.l[99000], 3 * 0.25 * MITTE, 1e-6);
    t.arr.setze_sofort(reg(t, "spur/1/solo"), 1.0f);
    t.lauf(101000);
    PRUEF_NAH(t.l[100800], 0.25 * MITTE, 1e-6);
    TR(u)   // solo on the group in the middle: its member track, its child and its parent play; the sibling of the group in group 1 would not
    spiele(u, snapn(&a->a, {3, 2, 1}, {0, 1, 2}));
    u.arr.setze_sofort(reg(u, "grp/2/solo"), 1.0f);
    u.lauf(101000);
    PRUEF_NAH(u.l[100800], 2 * 0.25 * MITTE, 1e-6);   // tracks 1 (below) and 2 (member) play, track 3 (member of group 1, a sibling of group 2's branch) does not
  }
  {  // 13: group 2 retargeted from group 1 to master and back in consecutive blocks: finite output, no stuck blend, the route is group 1 again at the end
    TR(t)
    spiele(t, snapn(&a->a, {2}, {0, 1}, 1));
    t.arr.setze_sofort(reg(t, "grp/1/fader"), -6.0206f);
    t.lauf(100000);
    PRUEF_NAH(t.l[99900], 0.5 * 0.25 * MITTE, 1e-5);
    t.laden(snapn(&a->a, {2}, {0, 0}, 2));
    t.lauf(t.s + 256);
    t.laden(snapn(&a->a, {2}, {0, 1}, 3));
    t.lauf(t.s + 4096);
    bool endlich = true;
    double hoechst = 0.0;
    for (size_t i = 99000; i < t.l.size(); ++i) {
      endlich = endlich && std::isfinite(t.l[i]) && std::isfinite(t.r[i]);
      hoechst = std::max(hoechst, static_cast<double>(std::fabs(t.l[i])));
    }
    PRUEF(endlich);
    PRUEF(hoechst <= 0.25 * MITTE * 1.001);   // never above the louder of the two routes
    PRUEF_NAH(t.l[t.l.size() - 1], 0.5 * 0.25 * MITTE, 1e-5);   // no stuck blend
  }
  {  // 14: A in B, then B in A in one swap, both groups carry a track: group 1 (old target B, now the same or a lower level) switches hard, group 2 blends from master, no cycle, finite
    TR(t)
    spiele(t, snapn(&a->a, {1, 2}, {2, 0}, 1));   // group 1 in group 2; track 1 in group 1, track 2 in group 2
    t.arr.setze_sofort(reg(t, "grp/1/fader"), -6.0206f);
    t.arr.setze_sofort(reg(t, "grp/2/fader"), -12.0412f);
    t.lauf(100000);
    const double X = 0.25 * MITTE;
    PRUEF_NAH(t.l[99900], X * 0.5 * 0.25 + X * 0.25, 1e-5);   // track 1 through both groups, track 2 through group 2
    const int64_t swap = t.s;
    t.laden(snapn(&a->a, {1, 2}, {0, 1}, 2));   // group 2 in group 1, group 1 to master
    t.lauf(swap + 2048);
    bool endlich = true;
    for (size_t i = 99000; i < t.l.size(); ++i) endlich = endlich && std::isfinite(t.l[i]) && std::isfinite(t.r[i]);
    PRUEF(endlich);
    // group 1 hard (track 1 at its new route from the first sample), group 2 blends master -> group 1: after 11 steps zw = 11 / 480, the tail still goes to the master with (1 - zw)
    const double zw = 11.0 / 480.0;
    PRUEF_NAH(t.l[swap + 10], X * 0.5 + X * 0.25 * ((1.0 - zw) + 0.5 * zw), 1e-4);
    PRUEF_NAH(t.l[swap + 2000], X * 0.5 + X * 0.25 * 0.5, 1e-5);
  }
  {  // 15: a group send from group 3 and a track send from a track in group 3: muting group 1 silences both; each is scaled once by the blend (no double blend)
    constexpr int64_t M0 = 100096;   // the block start the mute is set at (the first run ends there: 99840 + one block of 256)
    auto lauf = [&](float send_grp, float send_spur, bool stumm) {
      auto t = std::make_unique<Treiber>();
      spiele(*t, snapn(&a->a, {3}, {0, 1, 2}, 1, true));
      t->arr.setze_sofort(reg(*t, "ret/1/hall/an"), 0.0f);
      t->arr.setze_sofort(reg(*t, "grp/3/send/1"), send_grp);
      t->arr.setze_sofort(reg(*t, "spur/1/send/1"), send_spur);
      t->lauf(100000);
      PRUEF(t->s == M0);
      if (stumm) t->arr.setze_sofort(reg(*t, "grp/1/mute"), 1.0f);
      t->lauf(101500);
      return t;
    };
    const int64_t mitte = M0 + 239, ende = M0 + 1200;   // half way through the 480 sample fade (gain 0.5), and long after it
    for (const bool grp : {true, false}) {
      const float an = 0.0f, aus = -200.0f;
      auto m_an = lauf(grp ? an : aus, grp ? aus : an, true), m_aus = lauf(aus, aus, true);
      auto f_an = lauf(grp ? an : aus, grp ? aus : an, false), f_aus = lauf(aus, aus, false);
      const double fest = f_an->l[mitte] - f_aus->l[mitte];   // the send share without a mute
      const double halb = m_an->l[mitte] - m_aus->l[mitte];   // the send share half way through the fade of group 1
      std::printf("15: %s send share %.6f, half way %.6f\n", grp ? "group" : "track", fest, halb);
      PRUEF(fest > 0.05);
      PRUEF_NAH(halb / fest, 0.5, 1e-3);   // once the blend (0.5), not twice (0.25)
      PRUEF(std::fabs(m_an->l[ende] - m_aus->l[ende]) < 1e-6);   // at the end of the fade no share is left
    }
  }
  {  // 16: group 2 moves from group 1 to group 3, which is on the same level as group 1 in the new order: a hard switch at the block start, no signal lost after it
    TR(t)
    spiele(t, snapn(&a->a, {2}, {0, 0, 0}, 1));
    t.laden(snapn(&a->a, {2}, {0, 1, 0}, 2));   // group 2 in group 1 ...
    t.arr.setze_sofort(reg(t, "grp/1/fader"), -6.0206f);
    t.lauf(t.s + 2048);
    PRUEF_NAH(t.l[t.l.size() - 1], 0.5 * 0.25 * MITTE, 1e-5);
    const int64_t swap = t.s;
    t.laden(snapn(&a->a, {2}, {0, 3, 0}, 3));   // ... then into group 3: old target group 1 is on level 0 in the new order, group 2 on level 0
    t.lauf(swap + 2048);
    PRUEF_NAH(t.l[swap + 10], 0.25 * MITTE, 1e-5);
    PRUEF_NAH(t.l[swap + 2000], 0.25 * MITTE, 1e-5);
  }
  {  // 17: decision 4, the BLEND branch: groups 2 and 3 both in group 1 (level 1); group 3 goes to the master while group 2 stays. Group 1 is still open when group 3 adds (level 1 > 0), so the move
     // ramps over ARR_ZIEL_BLENDE (480) samples from the old share (through group 1 at -6.02 dB) to the new one (master): monotone, ends exactly on the target, finite
    TR(t)
    spiele(t, snapn(&a->a, {3, 2}, {0, 1, 1}, 1));
    t.arr.setze_sofort(reg(t, "grp/1/fader"), -6.0206f);
    t.lauf(100000);
    const double X = 0.25 * MITTE;
    PRUEF_NAH(t.l[99900], 0.5 * X + 0.5 * X, 1e-5);   // both groups through group 1
    const int64_t swap = t.s;
    t.laden(snapn(&a->a, {3, 2}, {0, 1, 0}, 2));
    t.lauf(swap + 2048);
    bool endlich = true;
    for (size_t i = 99000; i < t.l.size(); ++i) endlich = endlich && std::isfinite(t.l[i]) && std::isfinite(t.r[i]);
    PRUEF(endlich);
    bool monoton = true;
    for (int64_t i = swap; i < swap + 480; ++i) monoton = monoton && t.l[i + 1] >= t.l[i] - 1e-7f;
    PRUEF(monoton);
    PRUEF(t.l[swap - 1] < t.l[swap + 240] && t.l[swap + 240] < t.l[swap + 600]);   // a real ramp: neither a jump at the start nor a late one
    PRUEF_NAH(t.l[swap + 240], 0.5 * X + X * (0.5 + 0.5 * (241.0 / 480.0)), 1e-4);   // half way: group 3's share is 0.5 X (old) to X (new) at weight zw
    for (const int64_t i : {swap + 600, swap + 2000}) PRUEF_NAH(t.l[i], 0.5 * X + X, 1e-6);   // ends exactly on the target: group 2 through group 1, group 3 direct
    PRUEF_NAH(t.l[swap + 600], t.l[swap + 2000], 1e-7);   // no stuck blend
  }
  PRUEF_ENDE();
}
