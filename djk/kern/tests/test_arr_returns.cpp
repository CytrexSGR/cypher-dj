// 1.10 Slice 3 Task 5a: sends and return strips in the arrangement mixer, without Hall (spec 5.4; AK1, AK8, AK10, F1, F2, F7, P5, P7, P9, P14, P15).
// Constant 0.25 per track in the centre (each track gives d = 0.25 * MITTE on the left), start at bar 90000, blocks of 256.
// A return without Hall passes its input dry, so a send of -6.02 dB adds half of the track level to the master.
// Task 5b adds the Cypher Hall cases 9 to 17 (mapping, determinism pin, AK11, wake, first application, debounce and credit, swap, hall on).
// Mutations: ARR_SEND_PRE (case 1 red), ARR_SEND_OHNE_MUTE (case 3 red), ARR_SEND_OHNE_GRUPPEN_BLENDE (case 4 red), ARR_RET_NACH_PM_FADER (case 6 red),
// ARR_RET_SOLO_AUS (case 2 red), ARR_RUHE_SCHNEIDET_AB (case 8 red).
#include <algorithm>
#include <cmath>
#include <cstring>
#include <memory>
#include <string>
#include <vector>

#include <fstream>
#include <nlohmann/json.hpp>

#include "arr_bau.h"
#include "pruef.h"

using namespace arrtest;
using cdj::ArrArt;

// a Treiber is about 750 KB: on the heap, or a case with many of them overflows the stack
#define TR(x) auto x##_p = std::make_unique<Treiber>(); Treiber& x = *x##_p;
static constexpr int64_t V = 537;
static const double MITTE = 0.70710677;
static const double D = 0.25 * MITTE;   // one track on the left channel

// snapshot with audio tracks 1..n (one clip, 8 beats); ziele[i] = group of track i+1 (0 = master); ret = which returns exist (bit r = return r+1)
static cdj::ArrSnapshot* snap(const cdj::ArrAudio* a, const std::vector<int>& ziele, unsigned ret, int64_t nr = 1) {
  Bau b(nr);
  for (size_t i = 0; i < ziele.size(); ++i) {
    const std::string id = "c" + std::to_string(i + 1);
    const int sp = static_cast<int>(i) + 1;
    b.spur(sp, ArrArt::audio).clip(sp, id.c_str(), 0.0, 8.0, a).ausgang(sp, ziele[i]);
  }
  cdj::ArrSnapshot* s = b.fertig();
  for (int r = 0; r < cdj::ARR_RETURNS; ++r) s->ret_da[r] = (ret >> r) & 1;
  return s;
}
static int reg(Treiber& t, const char* pfad) {
  const int r = t.tab.suche(pfad);
  PRUEF(r >= 0);
  return r;
}
static void setze(Treiber& t, const char* pfad, float w) { t.arr.setze_sofort(reg(t, pfad), w); }
static void spiele(Treiber& t, cdj::ArrSnapshot* s, int64_t bis = 99840) {
  for (const char* p : {"ret/1/hall/an", "ret/2/hall/an", "ret/3/hall/an", "ret/4/hall/an"}) setze(t, p, 0.0f);   // 5a: returns without Hall pass dry (P6)
  t.laden(s);
  t.arr.start(0.0, 2, false, 0, V, 256, t.k);
  t.lauf(bis);
}
static double db(double x) { return 20.0 * std::log10(x); }
// largest sample-to-sample step of the left channel in [von, bis)
static double sprung(const Treiber& t, int64_t von, int64_t bis) {
  double m = 0.0;
  for (int64_t i = von; i < bis; ++i) m = std::max(m, static_cast<double>(std::fabs(t.l[i + 1] - t.l[i])));
  return m;
}

// ---- Task 5b: the Cypher Hall of the returns. The hall stays ON (default); `spiele` above switches it off for the dry cases.
static void spiele_hall(Treiber& t, cdj::ArrSnapshot* s, int64_t bis = 99840) {
  t.laden(s);
  t.arr.start(0.0, 2, false, 0, V, 256, t.k);
  t.lauf(bis);
}
static int64_t spitzenort(const Treiber& t, int64_t von, int64_t bis) {
  int64_t o = von;
  for (int64_t i = von; i < bis; ++i)
    if (std::fabs(t.l[i]) > std::fabs(t.l[o])) o = i;
  return o;
}
static double hoechst(const Treiber& t, int64_t von, int64_t bis) {
  double m = 0.0;
  for (int64_t i = von; i < bis && i < static_cast<int64_t>(t.l.size()); ++i) m = std::max(m, static_cast<double>(std::fabs(t.l[i])));
  return m;
}
static double hoechst_vec(const std::vector<float>& v, int64_t von, int64_t bis) {
  double m = 0.0;
  for (int64_t i = von; i < bis && i < static_cast<int64_t>(v.size()); ++i) m = std::max(m, static_cast<double>(std::fabs(v[i])));
  return m;
}
static bool gleich_bits(const std::vector<float>& a, const std::vector<float>& b, int64_t von, int64_t n) {
  return std::memcmp(a.data() + von, b.data() + von, sizeof(float) * static_cast<size_t>(n)) == 0;
}
static const float STANDARD_X[cdj::ARR_HALL_PARAM] = {0.04f, 0.5252f, 0.282f, 0.5658f, 0.8039f, 0.66667f};

int main() {
  auto a = Audio::gleich(400000, 0.25f);
  {  // 1 (AK8): the return share = the track level at its output - 6.02 dB (P5); post fader: track fader -6 gives -12
    TR(ohne) TR(mit) TR(post)
    spiele(ohne, snap(&a->a, {0}, 1));
    setze(mit, "spur/1/send/1", -6.0206f);
    spiele(mit, snap(&a->a, {0}, 1));
    PRUEF_NAH(ohne.l[99000], D, 1e-6);
    const double anteil = mit.l[99000] - ohne.l[99000];
    PRUEF_NAH(db(anteil / D), -6.0206, 0.1);
    setze(post, "spur/1/send/1", -6.0206f);
    setze(post, "spur/1/fader", -6.0206f);
    spiele(post, snap(&a->a, {0}, 1));
    const double direkt = D * 0.5;   // the track after its fader
    PRUEF_NAH(post.l[99000], direkt * 1.5, 1e-5);   // direct + send at -6.02 dB of the already attenuated level (post fader)
    PRUEF_NAH(db((post.l[99000] - direkt) / D), -12.0412, 0.1);
    // negative control: send -200 dB adds nothing
    TR(aus)
    setze(aus, "spur/1/send/1", -200.0f);
    spiele(aus, snap(&a->a, {0}, 1));
    PRUEF_NAH(aus.l[99000] - ohne.l[99000], 0.0, 1e-6);
  }
  {  // 2 (AK10, P7): return fader, mute, solo
    {
    TR(f)
    setze(f, "spur/1/send/1", 0.0f);
    setze(f, "ret/1/fader", -6.0206f);
    spiele(f, snap(&a->a, {0}, 1));
    PRUEF_NAH(f.l[99000] - D, 0.5 * D, 1e-5);   // the return share is halved: 6.0 dB
    }
    {
    TR(m)
    setze(m, "spur/1/send/1", 0.0f);
    setze(m, "ret/1/mute", 1.0f);
    spiele(m, snap(&a->a, {0}, 1), 101000);
    PRUEF_NAH(m.l[100500] - D, 0.0, 1e-6);       // muted after the 480 sample fade
    }
    // return solo on R1 with the source track without solo: tracks 1 and 2 fall silent, the return has nothing to play
    TR(s1)
    setze(s1, "spur/1/send/1", 0.0f);
    setze(s1, "ret/1/solo", 1.0f);
    spiele(s1, snap(&a->a, {0, 0}, 1), 101000);
    PRUEF_NAH(s1.l[100500], 0.0, 1e-6);
    // return solo and the source track solo: the track and its return share sound, track 2 is silent
    TR(s2)
    setze(s2, "spur/1/send/1", 0.0f);
    setze(s2, "ret/1/solo", 1.0f);
    setze(s2, "spur/1/solo", 1.0f);
    spiele(s2, snap(&a->a, {0, 0}, 1), 101000);
    PRUEF_NAH(s2.l[100500], 2 * D, 1e-5);
    // a solo on another track does not silence a return without solo: track 2 solo sends to R1
    TR(s3)
    setze(s3, "spur/2/send/1", 0.0f);
    setze(s3, "spur/2/solo", 1.0f);
    spiele(s3, snap(&a->a, {0, 0}, 1), 101000);
    PRUEF_NAH(s3.l[100500], 2 * D, 1e-5);
    // a second return without solo is silenced by the solo of the first return (everything without solo falls silent)
    TR(s4)
    setze(s4, "spur/1/send/2", 0.0f);
    setze(s4, "spur/1/solo", 1.0f);
    setze(s4, "ret/1/solo", 1.0f);
    spiele(s4, snap(&a->a, {0}, 3), 101000);
    PRUEF_NAH(s4.l[100500], D, 1e-5);   // direct only, R2 (no solo) is silent
    // a return without sends stays silent
    TR(leer)
    spiele(leer, snap(&a->a, {0}, 15), 101000);
    PRUEF_NAH(leer.l[100500], D, 1e-6);
    // solo of a return as a course (F7): ramps 0 -> 1 in the middle of a block; track 1 (sinus) falls silent in 480 samples without a step
    auto sn = Audio::sinus(400000, 1000.0, 0.5f);
    TR(v) TR(fest)
    for (Treiber* t : {&v, &fest}) setze(*t, "spur/1/send/1", 0.0f);
    spiele(v, snap(&sn->a, {0, 0}, 1), 99840);
    spiele(fest, snap(&sn->a, {0, 0}, 1), 99840);
    float rampe[cdj::ARR_BLOCK];
    for (int i = 0; i < 256; ++i) rampe[i] = i < 100 ? 0.0f : 1.0f;
    v.arr.verlauf(reg(v, "ret/1/solo"), rampe);
    v.lauf(v.s + 256);
    v.lauf(v.s + 1024);
    setze(fest, "ret/1/solo", 1.0f);
    fest.lauf(fest.s + 1280);
    PRUEF(sprung(v, 98000, 99830) > 0.01);                                   // the setup sees the sinus
    PRUEF(sprung(v, 99840, 101100) <= 1.05 * sprung(v, 98000, 99830));      // no step in the fade
    PRUEF_NAH(v.l[101000], 0.0, 1e-6);
    PRUEF_NAH(v.l[101100], fest.l[101100], 1e-6);                            // same end state as a fixed solo
  }
  {  // 3 (F2): track mute silences the track AND its send; group send and track send add up
    TR(t)
    setze(t, "spur/1/send/1", 0.0f);
    setze(t, "spur/1/mute", 1.0f);
    spiele(t, snap(&a->a, {0}, 1), 101000);
    PRUEF_NAH(t.l[100500], 0.0, 1e-6);   // direct and send, both silent after the fade
    TR(u)
    setze(u, "spur/1/send/1", -6.0206f);
    setze(u, "grp/1/send/1", -6.0206f);
    spiele(u, snap(&a->a, {0, 1, 1}, 1));
    PRUEF_NAH(u.l[99000], 3 * D + 0.5 * D + 2 * D * 0.5, 1e-5);
  }
  {  // 4 (F1, P14): a track in a muted group falls silent with its send; fade, solo, group fader (the mute is set at a block start)
    TR(t)
    for (const char* p : {"spur/1/send/1", "spur/2/send/1", "spur/3/send/1"}) setze(t, p, 0.0f);
    setze(t, "grp/1/mute", 1.0f);
    spiele(t, snap(&a->a, {1, 2, 0}, 1), 101000);
    PRUEF_NAH(t.l[100500], 4 * D, 1e-5);   // tracks 2 and 3 with their sends; track 1 and its send are silent
    TR(nur)   // track 1 alone in the muted group: direct and return share below -120 dBFS
    setze(nur, "spur/1/send/1", 0.0f);
    setze(nur, "grp/1/mute", 1.0f);
    spiele(nur, snap(&a->a, {1}, 1), 101000);
    PRUEF_NAH(nur.l[100500], 0.0, 1e-6);
    TR(wieder)   // negative control (c): unmuting brings the return back
    setze(wieder, "spur/1/send/1", 0.0f);
    setze(wieder, "grp/1/mute", 1.0f);
    spiele(wieder, snap(&a->a, {1}, 1), 101000);
    setze(wieder, "grp/1/mute", 0.0f);
    wieder.lauf(103000);
    PRUEF_NAH(wieder.l[102500], 2 * D, 1e-5);
    // the group fader does not change the send of its members (P14)
    TR(g0) TR(g20)
    setze(g0, "spur/1/send/1", 0.0f);
    setze(g20, "spur/1/send/1", 0.0f);
    setze(g20, "grp/1/fader", -20.0f);
    spiele(g0, snap(&a->a, {1}, 1));
    spiele(g20, snap(&a->a, {1}, 1));
    PRUEF_NAH(g0.l[99000], 2 * D, 1e-5);
    PRUEF_NAH(g20.l[99000], 0.1 * D + D, 1e-5);
    // solo on a track in group 1: the send of the track in group 2 is silent, the send of the solo track sounds
    TR(so)
    setze(so, "spur/1/send/1", 0.0f);
    setze(so, "spur/2/send/1", 0.0f);
    setze(so, "spur/1/solo", 1.0f);
    spiele(so, snap(&a->a, {1, 2}, 1), 101000);
    PRUEF_NAH(so.l[100500], 2 * D, 1e-5);
    // group mute in the middle of a block: the send part falls over 480 samples without a step (sinus)
    auto sn = Audio::sinus(400000, 1000.0, 0.5f);
    TR(sw)
    setze(sw, "spur/1/send/1", 0.0f);
    spiele(sw, snap(&sn->a, {1}, 1), 99840);
    setze(sw, "grp/1/mute", 1.0f);
    sw.lauf(101200);
    const double allein = sprung(sw, 98000, 99830);
    PRUEF(allein > 0.01);
    PRUEF(sprung(sw, 99840, 101100) <= 1.05 * allein);
  }
  {  // 5 (AK1): a project without returns, sends set high: the same bits as with sends at the default (no return exists)
    auto lauf = [&](float send_db) {
      TR(t)
      setze(t, "spur/1/send/1", send_db);
      setze(t, "spur/2/send/3", send_db);
      setze(t, "grp/1/send/2", send_db);
      spiele(t, snap(&a->a, {0, 1}, 0), 102400);
      return std::vector<float>(t.l.begin() + 99840, t.l.end());
    };
    const std::vector<float> n0 = lauf(-200.0f), n1 = lauf(0.0f);
    PRUEF(n0.size() == n1.size() && !n0.empty());
    PRUEF(std::memcmp(n0.data(), n1.data(), n0.size() * sizeof(float)) == 0);
    // the reverse: the same sends with a return that exists change the bits
    TR(mit)
    setze(mit, "spur/1/send/1", 0.0f);
    spiele(mit, snap(&a->a, {0, 1}, 1), 102400);
    PRUEF(std::memcmp(n0.data(), mit.l.data() + 99840, n0.size() * sizeof(float)) != 0);
  }
  {  // 6 (AK20): the return output joins the master BEFORE the PM fader: pm/fader -6.02 halves the return share too
    TR(t)
    setze(t, "spur/1/send/1", 0.0f);
    setze(t, "pm/fader", -6.0206f);
    spiele(t, snap(&a->a, {0}, 1));
    PRUEF_NAH(t.l[99000], 0.5 * 2 * D, 1e-5);
    PRUEF_NAH(t.pml[99000], t.l[99000], 1e-7);   // the export tap carries the returns
  }
  {  // 7 (P9): a return that the next playback does not know fades out in 480 samples without a step
    auto sn = Audio::sinus(400000, 1000.0, 0.5f);
    TR(t)
    setze(t, "spur/1/send/1", 0.0f);
    spiele(t, snap(&sn->a, {0}, 1), 99840);
    t.laden(snap(&sn->a, {0}, 0, 2));
    t.lauf(101200);
    const double allein = sprung(t, 98000, 99800);
    PRUEF(allein > 0.01);
    PRUEF(sprung(t, 99840, 101100) <= 1.05 * allein);   // before the swap the signal is direct + send; the fade only lowers it
    // after the fade only the direct part remains: amplitude 0.5 * MITTE
    double mx = 0.0;
    for (int64_t i = 100500; i < 101100; ++i) mx = std::max(mx, static_cast<double>(std::fabs(t.l[i])));
    PRUEF_NAH(mx, 0.5 * MITTE, 0.01);
  }
  {  // 8 (P15): unloading the playback fades the return strips out first; only then the quiet path is taken
    TR(t)
    setze(t, "spur/1/send/1", 0.0f);
    spiele(t, snap(&a->a, {0}, 1), 99840);
    PRUEF(t.arr.ret_belegt(0));
    const uint64_t r0 = t.arr.ruhe_zaehler();
    t.laden(nullptr);
    t.lauf(t.s + 256);   // the first block: the voices fade, the strips fade
    const uint64_t r1 = t.arr.ruhe_zaehler();
    t.lauf(t.s + 256);   // the second block: the strips still fade (480 samples), so no quiet path yet
    PRUEF(t.arr.ruhe_zaehler() == r1);
    PRUEF(r1 == r0);
    t.lauf(t.s + 1024);  // the fade is over: the quiet path runs
    PRUEF(!t.arr.ret_blendet());
    PRUEF(t.arr.ruhe_zaehler() > r1);
    // negative control: with a loaded playback nothing is cut off (the strip stays at 1, no quiet path)
    TR(u)
    setze(u, "spur/1/send/1", 0.0f);
    spiele(u, snap(&a->a, {0}, 1), 101000);
    PRUEF(u.arr.ruhe_zaehler() == 0);
    PRUEF_NAH(u.l[100500], 2 * D, 1e-5);
  }
  {  // 9: the mapping 0..1 -> unit: reference file (an independent Python computation), the defaults, the end points
    std::ifstream f(std::string(CYPHERDJ_DJK) + "/kern/tests/daten/hall_abbildung_ref.json");
    PRUEF(f.good());
    const nlohmann::json j = nlohmann::json::parse(f, nullptr, false);
    PRUEF(!j.is_discarded());
    if (!j.is_discarded()) {
      const char* namen[cdj::ARR_HALL_PARAM] = {"pre", "decay", "size", "low", "highcut", "tail"};
      for (int k = 0; k < cdj::ARR_HALL_PARAM; ++k) {
        const auto& pr = j.at("parameters").at(namen[k]);
        for (size_t q = 0; q < pr.at("x").size(); ++q) {
          float x[cdj::ARR_HALL_PARAM];
          std::memcpy(x, STANDARD_X, sizeof x);
          x[k] = pr.at("x").at(q).get<float>();
          const CypherHallEinstellung e = cdj::arr_hall_einstellung(x);
          const double ist[cdj::ARR_HALL_PARAM] = {e.pre_ms, e.decay_s, e.groesse_ms, e.tief_faktor, e.highcut_hz, e.fahne_db};
          const double soll = pr.at("y").at(q).get<double>();
          PRUEF_NAH(ist[k], soll, std::max(1e-6, 1e-6 * std::fabs(soll)));   // end points exact, up to the 9 digits of the file
        }
      }
    }
    const CypherHallEinstellung e = cdj::arr_hall_einstellung(STANDARD_X);   // the defaults of the controls hit the intended values
    PRUEF_NAH(e.pre_ms, 10.0, 0.1);
    PRUEF_NAH(e.decay_s, 2.0, 0.02);
    PRUEF_NAH(e.groesse_ms, 60.0, 0.6);
    PRUEF_NAH(e.tief_faktor, 1.2, 0.012);
    PRUEF_NAH(e.highcut_hz, 12000.0, 120.0);
    PRUEF_NAH(e.fahne_db, 0.0, 0.01);
    PRUEF(e.rahmen == 1);
    const float aus_bereich[cdj::ARR_HALL_PARAM] = {-1.0f, 2.0f, -1.0f, 2.0f, -1.0f, 2.0f};   // clamped, never out of range
    const CypherHallEinstellung c = cdj::arr_hall_einstellung(aus_bereich);
    PRUEF_NAH(c.pre_ms, 0.0, 1e-9);
    PRUEF_NAH(c.decay_s, 30.0, 1e-6);
    PRUEF_NAH(c.groesse_ms, 5.0, 1e-9);
    PRUEF_NAH(c.tief_faktor, 4.0, 1e-9);
    PRUEF_NAH(c.highcut_hz, 1000.0, 1e-9);
    PRUEF_NAH(c.fahne_db, 12.0, 1e-9);
  }
  {  // 10 (determinism pin, F2 a): two fresh arrangements, same input, same block raster, a non-default Hall: the same bits.
     // Counter-proofs: another decay differs; the input 100 samples later (another block raster) differs too: export and playback are no bit comparison (I12).
    auto im = Audio::impuls(400000);
    auto lauf = [&](float decay, int verschiebung) {
      TR(t)
      setze(t, "spur/1/send/1", 0.0f);
      setze(t, "ret/1/hall/decay", decay);
      setze(t, "ret/1/hall/groesse", 0.8f);
      t.arr.hall_sofort();
      t.laden(snap(&im->a, {0}, 1));
      t.arr.start(0.0, 2, false, 0, V, 256, t.k);
      t.lauf(100000 + verschiebung);
      return t.l;
    };
    const std::vector<float> a1 = lauf(0.7f, 0), a2 = lauf(0.7f, 0), a3 = lauf(0.3f, 0);
    PRUEF(a1.size() == a2.size() && a1.size() >= 100000);
    PRUEF(gleich_bits(a1, a2, 89000, 10000));
    PRUEF(!gleich_bits(a1, a3, 89000, 10000));
    // the impulse 100 samples later: build another audio with the impulse at frame 100
    auto spaet = Audio::impuls(400000);
    spaet->d[0] = spaet->d[1] = 0.0f;
    spaet->d[200] = spaet->d[201] = 1.0f;
    TR(u)
    setze(u, "spur/1/send/1", 0.0f);
    setze(u, "ret/1/hall/decay", 0.7f);
    setze(u, "ret/1/hall/groesse", 0.8f);
    u.arr.hall_sofort();
    u.laden(snap(&spaet->a, {0}, 1));
    u.arr.start(0.0, 2, false, 0, V, 256, u.k);
    u.lauf(100000);
    PRUEF(!gleich_bits(a1, u.l, 90200, 9700));   // not the same bits as the input 100 samples later at the same positions
    std::vector<float> verschoben(a1.size(), 0.0f);   // a1 shifted by 100 samples to the right
    std::memcpy(verschoben.data() + 100, a1.data(), sizeof(float) * (a1.size() - 100));
    // measured: shifted by 100 samples the output is bit-identical for the first ~4400 samples after the impulse (the early part is time-domain), then it
    // diverges (first difference 94465 for an impulse at 90000): the window must be long enough to see it
    PRUEF(!gleich_bits(verschoben, u.l, 90200, 9700));
  }
  {  // 11 (AK11): an impulse through the send; the tail is there after 1 s, ends, and the Hall sleeps again; it rings on after the transport stops
    auto im = Audio::impuls(2000000);
    TR(t)
    setze(t, "spur/1/send/1", 0.0f);
    TR(ohne)   // the same run without the send: the direct part only, to subtract
    setze(ohne, "spur/1/send/1", -200.0f);
    spiele_hall(t, snap(&im->a, {0}, 1), 89856);
    spiele_hall(ohne, snap(&im->a, {0}, 1), 89856);
    PRUEF(!t.arr.returns().hall_laeuft(0) && !t.arr.returns().wach(0));   // before the impulse the Hall does not compute
    t.lauf(90000 + 2 * 48000 + 5120);
    ohne.lauf(90000 + 2 * 48000 + 5120);
    const int64_t i0 = spitzenort(t, 89900, 90100);
    PRUEF(i0 >= 90000 && i0 < 90100);
    PRUEF(t.arr.returns().wach(0));
    double spitze = 0.0;
    for (int64_t i = i0 + 1; i < static_cast<int64_t>(t.l.size()); ++i) spitze = std::max(spitze, static_cast<double>(std::fabs(t.l[i] - ohne.l[i])));
    double fenster = 0.0;   // the window 1.00 to 1.10 s after the impulse
    for (int64_t i = i0 + 48000; i < i0 + 48000 + 4800; ++i) fenster = std::max(fenster, static_cast<double>(std::fabs(t.l[i] - ohne.l[i])));
    std::fprintf(stderr, "AK11: wet peak %.6f, window 1 s %.6f (%.1f dB relative)\n", spitze, fenster, db(fenster / spitze));
    PRUEF(spitze > 1e-3);
    PRUEF(fenster > spitze * 0.001);   // above -60 dBFS relative to the peak
    // the end: 15 s after the impulse the Hall has run out and sleeps (input quiet for 65536 samples, tail below 1e-9)
    t.lauf(90000 + 15 * 48000);
    ohne.lauf(90000 + 15 * 48000);
    double rest = 0.0;
    for (int64_t i = i0 + 14 * 48000; i < i0 + 15 * 48000; ++i) rest = std::max(rest, static_cast<double>(std::fabs(t.l[i] - ohne.l[i])));
    std::fprintf(stderr, "AK11: rest after 14 s: %.3e, wach %d, hall_laeuft %d\n", rest, t.arr.returns().wach(0) ? 1 : 0, t.arr.returns().hall_laeuft(0) ? 1 : 0);
    PRUEF(rest < 1e-5);   // below -100 dBFS
    PRUEF(!t.arr.returns().wach(0) && !t.arr.returns().hall_laeuft(0));
    // transport stop 0.5 s after the impulse: the tail rings on and is not cut (no step across the stop)
    TR(st)
    setze(st, "spur/1/send/1", 0.0f);
    spiele_hall(st, snap(&im->a, {0}, 1), 89856);
    st.lauf(90000 + 24000);
    st.arr.stopp(0, st.s, st.k);
    st.lauf(90000 + 24000 + 3 * 48000);
    const int64_t T = 90000 + 24000;
    const double vorher = sprung(st, T - 3000, T - 64), ueber = sprung(st, T - 64, T + 600);
    PRUEF(vorher > 0.0);
    PRUEF(ueber <= 1.5 * vorher);
    PRUEF(hoechst(st, T + 24000, T + 28800) > 1e-4);   // one second after the impulse and half a second after the stop the tail is still there
  }
  {  // 12 (wake and sleep): without a send no Hall computes; with a send it computes only while it has something to do
    TR(t)
    spiele_hall(t, snap(&a->a, {0, 0}, 15), 120000);
    for (int r = 0; r < cdj::ARR_RETURNS; ++r) PRUEF(!t.arr.returns().hall_laeuft(r) && !t.arr.returns().wach(r));
    PRUEF(hoechst(t, 100000, 119000) > 0.0);   // the run was not empty: the tracks play
    TR(u)
    setze(u, "spur/1/send/2", 0.0f);
    spiele_hall(u, snap(&a->a, {0, 0}, 15), 120000);
    PRUEF(u.arr.returns().hall_laeuft(1) && u.arr.returns().wach(1));
    PRUEF(!u.arr.returns().hall_laeuft(0) && !u.arr.returns().hall_laeuft(2) && !u.arr.returns().hall_laeuft(3));
  }
  {  // 13 (first application, P8 a, error case first): the controls stand on non-default values before the Hall wakes. Applied at the wake, none before.
    auto im = Audio::impuls(400000);
    TR(t)
    setze(t, "spur/1/send/1", 0.0f);
    t.laden(snap(&im->a, {0}, 1));
    t.arr.start(0.0, 2, false, 0, V, 256, t.k);
    t.lauf(89600);   // the block before the one that carries the impulse (sample 90000 lies in block 351: 89856..90111)
    const uint64_t c0 = t.arr.returns().setze_gesamt();
    setze(t, "ret/1/hall/decay", 0.8f);
    setze(t, "ret/1/hall/groesse", 0.7f);
    t.lauf(89856);
    PRUEF(t.arr.returns().setze_gesamt() == c0);   // asleep: a pending target costs nothing
    PRUEF(t.arr.returns().angewendet(0)[1] != 0.8f);
    t.lauf(90112);   // the wake block
    PRUEF(t.arr.returns().wach(0));
    PRUEF(t.arr.returns().setze_gesamt() == c0 + 1);
    PRUEF(t.arr.returns().angewendet(0)[1] == 0.8f && t.arr.returns().angewendet(0)[2] == 0.7f);
    PRUEF(t.arr.returns().start_alt() == 0);
    // the render way: hall_sofort() before block 0 gives the same applied setting and the wake needs no setze
    TR(u)
    setze(u, "spur/1/send/1", 0.0f);
    setze(u, "ret/1/hall/decay", 0.8f);
    setze(u, "ret/1/hall/groesse", 0.7f);
    const uint64_t d0 = u.arr.returns().setze_gesamt();
    u.arr.hall_sofort();
    PRUEF(u.arr.returns().setze_gesamt() == d0 + 1);
    u.laden(snap(&im->a, {0}, 1));
    u.arr.start(0.0, 2, false, 0, V, 256, u.k);
    u.lauf(90112);
    PRUEF(u.arr.returns().setze_gesamt() == d0 + 1 && u.arr.returns().start_alt() == 0);
    PRUEF(u.arr.returns().angewendet(0)[1] == 0.8f);
    // negative control: nothing changed -> no setze at the wake
    TR(n)
    setze(n, "spur/1/send/1", 0.0f);
    const uint64_t n0 = n.arr.returns().setze_gesamt();
    n.laden(snap(&im->a, {0}, 1));
    n.arr.start(0.0, 2, false, 0, V, 256, n.k);
    n.lauf(90112);
    PRUEF(n.arr.returns().wach(0) && n.arr.returns().setze_gesamt() == n0);
    // a target that changes in the very block of the wake is still applied at once (no debounce for the first application)
    TR(w)
    setze(w, "spur/1/send/1", 0.0f);
    w.laden(snap(&im->a, {0}, 1));
    w.arr.start(0.0, 2, false, 0, V, 256, w.k);
    w.lauf(89856);
    setze(w, "ret/1/hall/decay", 0.9f);
    w.lauf(90112);
    PRUEF(w.arr.returns().angewendet(0)[1] == 0.9f && w.arr.returns().start_alt() == 0);
    // two returns wake in the same block with pending targets: one setze credit, the second runs one block on its old setting and is applied in the next
    TR(z)
    setze(z, "spur/1/send/1", 0.0f);
    setze(z, "spur/1/send/2", 0.0f);
    setze(z, "ret/1/hall/decay", 0.8f);
    setze(z, "ret/2/hall/decay", 0.6f);
    z.laden(snap(&im->a, {0}, 3));
    z.arr.start(0.0, 2, false, 0, V, 256, z.k);
    z.lauf(89856);
    const uint64_t z0 = z.arr.returns().setze_gesamt();
    z.lauf(90112);
    PRUEF(z.arr.returns().setze_gesamt() == z0 + 1 && z.arr.returns().angewendet(0)[1] == 0.8f);
    PRUEF(z.arr.returns().start_alt() == 1 && z.arr.returns().angewendet(1)[1] != 0.6f);
    z.lauf(90368);
    PRUEF(z.arr.returns().angewendet(1)[1] == 0.6f && z.arr.returns().setze_gesamt() == z0 + 2);
  }
  {  // 14 (debounce and credit, P8 b/c): constant input keeps the Halls awake
    auto lauf_blocks = [&](Treiber& t, int n, float basis, int ret_bis) {   // n blocks, every block moves the decay of returns 1..ret_bis
      for (int b = 0; b < n; ++b) {
        for (int r = 1; r <= ret_bis; ++r) setze(t, (std::string("ret/") + std::to_string(r) + "/hall/decay").c_str(), basis + 0.001f * static_cast<float>(b));
        t.lauf(t.s + 256);
      }
    };
    TR(t)
    for (const char* p : {"spur/1/send/1", "spur/1/send/2", "spur/1/send/3", "spur/1/send/4"}) setze(t, p, 0.0f);
    spiele_hall(t, snap(&a->a, {0}, 15), 120064);
    PRUEF(t.arr.returns().wach(0) && t.arr.returns().wach(3));
    const uint64_t c0 = t.arr.returns().setze_gesamt();
    lauf_blocks(t, 20, 0.2f, 1);   // return 1 moves in 20 consecutive blocks: no setze in any of them
    PRUEF(t.arr.returns().setze_gesamt() == c0);
    const float ende = 0.2f + 0.001f * 19.0f;
    t.lauf(t.s + 256 * 12);   // still: the last value is applied, once
    PRUEF(t.arr.returns().angewendet(0)[1] == ende);
    PRUEF(t.arr.returns().setze_gesamt() == c0 + 1);
    t.lauf(t.s + 256 * 50);   // negative control: nothing changes, nothing is set
    PRUEF(t.arr.returns().setze_gesamt() == c0 + 1);
    // four returns awake and all four move: never more than one setze per block, all four end up applied
    const int max_vorher = t.arr.returns().setze_max_je_block();
    lauf_blocks(t, 20, 0.3f, 4);
    t.lauf(t.s + 256 * 60);
    PRUEF(t.arr.returns().setze_max_je_block() == 1 && max_vorher <= 1);
    for (int r = 0; r < 4; ++r) PRUEF(t.arr.returns().angewendet(r)[1] == 0.3f + 0.001f * 19.0f);
    PRUEF(t.arr.returns().setze_gesamt() == c0 + 1 + 4);
  }
  {  // 15 (swap in the tail): the Hall state belongs to the return number, not to the snapshot. A silent snapshot with the same return: same bits as no swap.
    auto im = Audio::impuls(400000);
    auto still = Audio::gleich(400000, 0.0f);
    auto lauf = [&](bool tausch, unsigned neu_ret, int64_t bis) {
      TR(t)
      setze(t, "spur/1/send/1", 0.0f);
      spiele_hall(t, snap(&im->a, {0}, 1), 89856);
      t.lauf(90000 + 24000);
      if (tausch) t.laden(snap(&still->a, {0}, neu_ret, 2));
      t.lauf(bis);
      return t.l;
    };
    const int64_t bis = 90000 + 24000 + 20000;
    const std::vector<float> ohne = lauf(false, 1, bis), mit = lauf(true, 1, bis), weg = lauf(true, 0, bis);
    PRUEF(hoechst_vec(ohne, 114000, 120000) > 1e-4);   // there is a tail to compare
    PRUEF(gleich_bits(ohne, mit, 114400, 5000));
    // a return the new snapshot does not know fades out over 480 samples and is silent afterwards (P9)
    double w = 0.0;
    for (int64_t i = 114176 + 600; i < 114176 + 5000; ++i) w = std::max(w, static_cast<double>(std::fabs(weg[i])));
    PRUEF(w < 1e-6);
    double schritt_weg = 0.0, schritt_ohne = 0.0;
    for (int64_t i = 114176; i < 114900; ++i) schritt_weg = std::max(schritt_weg, static_cast<double>(std::fabs(weg[i + 1] - weg[i])));
    for (int64_t i = 112000; i < 114000; ++i) schritt_ohne = std::max(schritt_ohne, static_cast<double>(std::fabs(ohne[i + 1] - ohne[i])));
    PRUEF(schritt_weg <= 1.05 * schritt_ohne);
  }
  {  // 16 (hall on 1 -> 0 in the tail): 480 samples between wet and dry, no step; afterwards the Hall sleeps (nothing hangs on)
    auto im = Audio::impuls(400000);
    TR(t)
    setze(t, "spur/1/send/1", 0.0f);
    spiele_hall(t, snap(&im->a, {0}, 1), 89856);
    t.lauf(90000 + 24000);
    setze(t, "ret/1/hall/an", 0.0f);
    t.lauf(90000 + 24000 + 4096);
    const int64_t T = 114176;   // the block boundary after 114000
    double vor = 0.0, uber = 0.0;
    for (int64_t i = T - 3000; i < T - 300; ++i) vor = std::max(vor, static_cast<double>(std::fabs(t.l[i + 1] - t.l[i])));
    for (int64_t i = T - 300; i < T + 1000; ++i) uber = std::max(uber, static_cast<double>(std::fabs(t.l[i + 1] - t.l[i])));
    PRUEF(vor > 0.0 && uber <= 1.05 * vor);
    PRUEF_NAH(hoechst(t, T + 700, T + 4000), 0.0, 1e-6);   // dry only, and the input is silent
    PRUEF(!t.arr.returns().wach(0));
  }
  {  // 17 (NaN): a NaN burst in the audio: the Hall is cleared and counted, the signal comes back; clean input counts nothing
    auto nan_audio = Audio::gleich(400000, 0.25f);
    for (int64_t f = 20000; f < 20300; ++f) nan_audio->d[2 * f] = nan_audio->d[2 * f + 1] = std::nanf("");
    TR(t)
    setze(t, "spur/1/send/1", 0.0f);
    spiele_hall(t, snap(&nan_audio->a, {0}, 1), 120000);   // the clip starts at 90000: the burst lies at 110000..110300
    PRUEF(t.arr.returns().nan_treffer() >= 1);
    bool alles_endlich = true;
    for (int64_t i = 112000; i < 120000; ++i) alles_endlich = alles_endlich && std::isfinite(t.l[i]);
    PRUEF(alles_endlich);
    PRUEF(hoechst(t, 118000, 120000) > 0.01);   // and it sounds
    TR(sauber)
    setze(sauber, "spur/1/send/1", 0.0f);
    spiele_hall(sauber, snap(&a->a, {0}, 1), 120000);
    PRUEF(sauber.arr.returns().nan_treffer() == 0);
  }
  PRUEF_ENDE();
}
