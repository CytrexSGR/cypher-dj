// 1.9 U8 T9 fix round 3 (E9 side effect of the start-value fix): a `geraet` lane on a PLAIN RB-338 track starts on its value at the transport start, as the same track
// would whose own parameter holds that value. Before the fix (ArrRbSenke::lanes_vorab_) the lane value reached the instrument after zuruecksetzen_ had locked the smoothers
// on the stored value, so the track opened with a glide (own 0.5 -> lane 0.2: about 240 ms).
// Four single-track playbacks (four notes on 16 beats, 128 BPM) with the cutoff in the playback; audio, not set logs.
//   1. render: own cutoff 0.5 and a constant `geraet.cutoff` lane 0.2 is bit-equal from frame 0 to own cutoff 0.2 without a lane (all frames, both channels); the same for lane
//      0.8; negative control: own 0.5 without a lane differs from both, and the two ends differ from each other (the cutoff is audible, the signal is not silent).
//   2. live vs render (a core in the process, arr35::Lauf, with monitor pre-roll blocks before the start as in operation): a constant lane from beat 0 and a ramp 0.1 -> 0.9 from
//      beat 0, started at beat 0; a ramp started in the middle of the lane (beat 4 of 16); a jump of the lane at beat 6 of a start at beat 0. Live (master recorded through the ring head)
//      and rendere() are bit-equal over the whole compared length.
// Mutation ARR_RB_START_GLEITET (the lane value is set after the lock again) turns case 1 red (both ends); case 2 stays green under it by design: live and render share the sink, so
// it guards the other direction (a live path that differs from the render, e.g. through the monitor pre-roll).
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <memory>
#include <string>
#include <tuple>
#include <vector>

#include "arr_build.h"
#include "arr_run.h"
#include "cypherdj/null_test.h"
#include "cypherdj/render.h"
#include "cypherdj/ring_capture.h"
#include "cypherdj/state.h"

bool g_waechter = false;
using k35::N;
namespace {
using Lane = std::vector<std::tuple<double, double, int>>;
constexpr double BPM = 128.0;

std::string rb_text(const Lane& lane, double eigen) {
  char eg[64];
  std::snprintf(eg, sizeof eg, "%.3f", eigen);
  const std::string auto_teil = lane.empty() ? "" : ",\"auto\":[" + arrdatei::Ordner::auto_lane(lane, "geraet.cutoff") + "]";
  return std::string("{\"nr\":1,\"art\":\"intern\",\"geraet\":\"rb338\",\"parameter\":{\"cutoff\":") + eg + "},\"noten\":["
         "{\"id\":\"n1\",\"beat\":0.0,\"laenge\":3.5,\"ton\":36,\"vel\":110},"
         "{\"id\":\"n2\",\"beat\":4.0,\"laenge\":3.5,\"ton\":43,\"vel\":110},"
         "{\"id\":\"n3\",\"beat\":8.0,\"laenge\":3.5,\"ton\":36,\"vel\":110},"
         "{\"id\":\"n4\",\"beat\":12.0,\"laenge\":3.5,\"ton\":48,\"vel\":110}]" + auto_teil + "}";
}

struct Live {
  cdj::RingMitschnitt m;
  int64_t ursprung = -1;
  std::unique_ptr<cdj_z_echtzeit> fach{new cdj_z_echtzeit()};
};

// monitor pre-roll (37 blocks with the playback loaded), then the transport start; the master is recorded until two beats after the range
Live live_lauf(arr35::Lauf& x, int beats, double von) {
  Live v;
  const int64_t spb = static_cast<int64_t>(std::ceil(48000.0 * 60.0 / BPM));
  cdj::RingLeser leser(x.ring);
  x.lauf(x.kern->sample() + 37 * N);
  PRUEF(leser.lies(v.m));
  const int64_t id = x.start(von, 0);
  const int64_t frist = x.kern->sample() + 20 * spb;
  while ((v.ursprung < 0 && x.kern->sample() < frist) || (v.ursprung >= 0 && x.kern->sample() < v.ursprung + (beats + 2) * spb)) {
    x.lauf(x.kern->sample() + N);
    PRUEF(leser.lies(v.m));
    if (v.ursprung < 0 && x.quittung(id, 2)) v.ursprung = x.quittung(id, 2)->sample;
  }
  x.kern->abbild(*v.fach);
  return v;
}

void kern_neu(arr35::Lauf& x) {
  x.kern.reset(new cdj::Kern(BPM, x.ring, x.bef.get(), x.ere.get()));
  x.kern->verbinde_lader(x.lr.get());
  x.kern->setze_pruefmodus(false);
  x.vh = x.kern->mixer().limiter_vorhalt();
}

cdj::RenderAuftrag auftrag(const arr35::Lauf& x, int64_t nr, double von, double bis, const cdj_z_echtzeit* fach) {
  cdj::RenderAuftrag a;
  a.arr_ordner = x.ordner.pfad;
  a.nr = nr;
  a.von_beat = von;
  a.bis_beat = bis;
  a.bpm = BPM;
  a.quantum = N;
  a.regler = fach;
  return a;
}

// first frame in which the two buffers differ (bit level) over the common length, -1: none
int64_t erster_unterschied(const float* a, const float* b, int64_t n) {
  for (int64_t i = 0; i < n; ++i)
    if (std::memcmp(&a[i], &b[i], sizeof(float)) != 0) return i;
  return -1;
}
double energie(const std::vector<float>& v) {
  double e = 0.0;
  for (float s : v) e += static_cast<double>(s) * s;
  return e;
}
}  // namespace

int main() {
  k35::Arbeitsbestand ab("arr_rb_start_lane");

  {  // 1 render: the lane equals the own value, from frame 0
    arr35::Lauf x(ab.pfad, "rb_start_lane_r");
    kern_neu(x);
    const Lane l02 = {{0.0, 0.2, 0}, {20.0, 0.2, 0}}, l08 = {{0.0, 0.8, 0}, {20.0, 0.8, 0}};
    x.laden(2, rb_text({}, 0.2), "andreas", true);    // own 0.2, no lane
    x.laden(3, rb_text(l08, 0.5), "andreas", true);   // own 0.5, lane 0.8
    x.laden(4, rb_text({}, 0.8), "andreas", true);    // own 0.8, no lane
    x.laden(5, rb_text({}, 0.5), "andreas", true);    // negative control: own 0.5, no lane
    x.laden(1, rb_text(l02, 0.5), "andreas", true);   // own 0.5, lane 0.2 (loaded last: the live run below plays it and gives the restart tray with the track regulators)
    Live v = live_lauf(x, 2, 0.0);
    PRUEF(v.ursprung > 0);
    const cdj_z_echtzeit* fach_ptr = v.fach.get();
    cdj::RenderErgebnis r[6];
    for (int nr = 1; nr <= 5; ++nr) {
      r[nr] = cdj::rendere(auftrag(x, nr, 0.0, 16.0, fach_ptr));
      if (!r[nr].fehler.empty()) std::printf("render %d: %s: %s\n", nr, r[nr].fehler.c_str(), r[nr].meldung.c_str());
      PRUEF(r[nr].fehler.empty() && !r[nr].l.empty());
    }
    const int64_t n = static_cast<int64_t>(r[1].l.size());
    PRUEF(n > 0 && static_cast<int64_t>(r[2].l.size()) == n && static_cast<int64_t>(r[3].l.size()) == n && static_cast<int64_t>(r[4].l.size()) == n && static_cast<int64_t>(r[5].l.size()) == n);
    const int64_t d02 = erster_unterschied(r[1].l.data(), r[2].l.data(), n), d02r = erster_unterschied(r[1].r.data(), r[2].r.data(), n);
    const int64_t d08 = erster_unterschied(r[3].l.data(), r[4].l.data(), n), d08r = erster_unterschied(r[3].r.data(), r[4].r.data(), n);
    const int64_t k02 = erster_unterschied(r[5].l.data(), r[2].l.data(), n), k08 = erster_unterschied(r[5].l.data(), r[4].l.data(), n), k_ende = erster_unterschied(r[2].l.data(), r[4].l.data(), n);
    std::printf("1: render of %lld frames: lane 0.2 vs own 0.2 first differing frame %lld/%lld (L/R), lane 0.8 vs own 0.8 %lld/%lld; controls: own 0.5 vs 0.2 from frame %lld, vs 0.8 from %lld, 0.2 vs 0.8 from %lld\n",
                static_cast<long long>(n), static_cast<long long>(d02), static_cast<long long>(d02r), static_cast<long long>(d08), static_cast<long long>(d08r), static_cast<long long>(k02),
                static_cast<long long>(k08), static_cast<long long>(k_ende));
    PRUEF(d02 == -1 && d02r == -1);   // sample-equal from frame 0, both channels
    PRUEF(d08 == -1 && d08r == -1);
    PRUEF(energie(r[2].l) > 1e-6 && energie(r[4].l) > 1e-6);   // not silence
    PRUEF(k02 >= 0 && k08 >= 0 && k_ende >= 0);                // the cutoff is audible: the unmapped 0.5 differs from both, and the two ends from each other
  }

  {  // 2 live (monitor pre-roll, then the start) against rendere()
    struct F {
      const char* name;
      Lane lane;
      double von, bis;
    };
    const std::vector<F> faelle = {
        {"constant lane 0.2, own 0.5", {{0.0, 0.2, 0}, {20.0, 0.2, 0}}, 0.0, 16.0},
        {"ramp 0.1 -> 0.9 from beat 0", {{0.0, 0.1, 0}, {16.0, 0.9, 0}}, 0.0, 16.0},
        {"ramp started in the middle (beat 4)", {{0.0, 0.1, 0}, {16.0, 0.9, 0}}, 4.0, 12.0},
        {"jump at beat 6", {{0.0, 0.9, 0}, {6.0, 0.9, 0}, {6.0, 0.15, 0}, {20.0, 0.15, 0}}, 0.0, 16.0},
    };
    int nr_lauf = 0;
    for (const F& f : faelle) {
      const std::string nm = "rb_start_lane_l" + std::to_string(nr_lauf++);
      arr35::Lauf x(ab.pfad, nm.c_str());
      kern_neu(x);
      x.laden(1, rb_text(f.lane, 0.5), "andreas", true);
      Live v = live_lauf(x, static_cast<int>(f.bis - f.von), f.von);
      PRUEF(v.ursprung > 0 && v.m.fehler.empty());
      const cdj::RenderErgebnis r = cdj::rendere(auftrag(x, 1, f.von, f.bis, v.fach.get()));
      if (!r.fehler.empty()) std::printf("render: %s: %s\n", r.fehler.c_str(), r.meldung.c_str());
      PRUEF(r.fehler.empty());
      const int64_t ab_s = v.ursprung + r.vorhalt - v.m.s0;
      const int64_t n_live = static_cast<int64_t>(v.m.l.size()) - ab_s;
      PRUEF(ab_s >= 0 && n_live > 0);
      const int64_t nn = std::min<int64_t>(n_live, static_cast<int64_t>(r.l.size()));
      const int64_t dl = erster_unterschied(v.m.l.data() + ab_s, r.l.data(), nn), dr = erster_unterschied(v.m.r.data() + ab_s, r.r.data(), nn);
      std::printf("2: %-38s live vs render over %lld frames: first differing frame L %lld, R %lld; signal %.3g\n", f.name, static_cast<long long>(nn), static_cast<long long>(dl),
                  static_cast<long long>(dr), energie(r.l));
      PRUEF(nn > 48000 && energie(r.l) > 1e-6);
      PRUEF(dl == -1 && dr == -1);
    }
  }
  PRUEF_ENDE();
}
