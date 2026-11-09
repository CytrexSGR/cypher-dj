// 1.10 rest, AK26: swapping the structure of a running playback does not stall the net thread. The transport runs on
// playback 1 (one track into group 1, return 1); while it runs, playback 2 is loaded with a different layout (two tracks
// into groups 1 and 2, returns 1 to 3) through the whole way of the operation: file, load thread, net thread, ring, core
// thread at a block boundary; the old snapshot (cold audio of MB MiB) goes back to the load thread for release. A counterpart
// measures the gaps between /uhr packets (kernel arrival stamps, freeze_threads.h). Bound: the largest gap from the load
// order until 300 ms after receipt 3 is at most 10 ms (the normal gap is one cycle, 5.33 ms). Pattern: test_netz_arr_freeze_uhr
// (threads) and test_netz_arr_luecke (cold file, MB from CYPHERDJ_ARR_SWAP_MB, default 100).
// Error case ARR_NETZ_WARTET (the net thread waits for the load that the swap contains) makes it red; there is no second
// mutation for the release of the old snapshot, which stays in the load thread by design (net_arr.cpp arr_zurueck).
#include <sys/vfs.h>
#include <linux/magic.h>

#include <algorithm>
#include <cstdio>
#include <cstdlib>

#include "freeze_threads.h"

int main() {
  const char* tmp = std::getenv("TMPDIR");
  const std::string basis = tmp && *tmp ? tmp : "/tmp";
  const char* e = std::getenv("CYPHERDJ_ARR_SWAP_MB");
  const int64_t mb = e ? std::atoll(e) : 100;
  const int64_t frames = mb * (1LL << 20) / 8;
  ff::Aufbau x("test_netz_arr_swap_uhr", basis, 128.0);
  struct statfs fs {};
  const bool platte = statfs(x.ordner.pfad.c_str(), &fs) == 0 && fs.f_type != TMPFS_MAGIC && fs.f_type != RAMFS_MAGIC;
  PRUEF(platte);
  const std::string a = x.ordner.audio('a', frames, 0.1f), b = x.ordner.audio('b', frames, 0.2f);
  const std::string ziel_g1 = "\"ausgang\":{\"art\":\"gruppe\",\"nr\":1}", ziel_g2 = "\"ausgang\":{\"art\":\"gruppe\",\"nr\":2}";
  const std::string master = "\"ausgang\":{\"art\":\"master\"}";
  auto spur = [&](int nr, const std::string& ziel, const std::string& sha) {
    return "{\"nr\":" + std::to_string(nr) + ",\"art\":\"audio\"," + ziel + ",\"clips\":[" +
           x.ordner.clip("c1", 0.0, 300.0, sha, frames) + "]}";
  };
  auto el = [&](int nr) { return "{\"nr\":" + std::to_string(nr) + "," + master + "}"; };
  // playback 1: one track, one group, one return; playback 2: two tracks, two groups, three returns
  x.ordner.wiedergabe2_ret(1, spur(1, ziel_g1, a), el(1), el(1));
  x.ordner.wiedergabe2_ret(2, spur(1, ziel_g1, b) + "," + spur(2, ziel_g2, b), el(1) + "," + el(2), el(1) + "," + el(2) + "," + el(3));
  x.ordner.kalt(a);
  x.ordner.kalt(b);   // the load of playback 2 really reads
  x.starten([](cdj::Kern&) {});
  x.hallo();
  PRUEF(x.warte("/k/willkommen", 1000, [](const cdj::osc::Nachricht&) { return true; }) >= 0);
  const int64_t l1 = x.laden(1);
  PRUEF(x.warte_q(l1, 3, 20000) >= 0);
  {
    cdj::osc::Schreiber s(ff::v::k_arr_start);
    s.h(++x.id).s("andreas").d(0.0).i(0);
    x.g->sende(s);
  }
  const int64_t t0 = ff::real_ns();
  while (ff::real_ns() < t0 + 500000000LL) x.sammeln(5);   // settle
  const size_t bezug_ab = x.pakete.size();
  const int64_t t_bezug = ff::real_ns();
  while (ff::real_ns() < t_bezug + 1000000000LL) x.sammeln(5);
  const size_t bezug_bis = x.pakete.size();
  const int64_t t_laden = ff::real_ns();
  const int64_t l2 = x.laden(2);
  const long q3 = x.warte_q(l2, 3, 20000);
  PRUEF(q3 >= 0);
  const int64_t t_q3 = q3 >= 0 ? x.pakete[static_cast<size_t>(q3)].t_ns : ff::real_ns();
  while (ff::real_ns() < t_q3 + 300000000LL) x.sammeln(5);
  const bool spielt = x.kern->arrangement().status() == cdj::ArrStatus::spielt;   // read before the threads stop
  x.anhalten();

  auto abstaende = [&](int64_t von, int64_t bis) {
    std::vector<int64_t> d;
    int64_t vorige = -1;
    for (const ff::Paket& p : x.pakete) {
      if (p.adresse != "/uhr") continue;
      if (vorige >= 0 && p.t_ns >= von && vorige < bis) d.push_back(p.t_ns - vorige);
      vorige = p.t_ns;
    }
    return d;
  };
  std::vector<int64_t> bezug = abstaende(x.pakete[bezug_ab].t_ns, x.pakete[bezug_bis - 1].t_ns);
  std::sort(bezug.begin(), bezug.end());
  const int64_t normal = bezug.empty() ? 0 : bezug[bezug.size() / 2];
  const std::vector<int64_t> d_ohne = abstaende(x.pakete[bezug_ab].t_ns, x.pakete[bezug_bis - 1].t_ns);
  const std::vector<int64_t> d_mit = abstaende(t_laden, t_q3 + 300000000LL);
  const int64_t max_ohne = d_ohne.empty() ? -1 : *std::max_element(d_ohne.begin(), d_ohne.end());
  const int64_t max_mit = d_mit.empty() ? -1 : *std::max_element(d_mit.begin(), d_mit.end());
  const cdj::ArrSnapshot* snap = x.kern->arrangement().snapshot();
  std::printf("swap_uhr: %lld MiB, normal %.2f ms, largest gap without swap %.2f ms, during the swap %.2f ms (%zu gaps), "
              "swap took %.0f ms, transport still playing %d, snapshot %lld\n",
              (long long)mb, normal / 1e6, max_ohne / 1e6, max_mit / 1e6, d_mit.size(), (t_q3 - t_laden) / 1e6, spielt ? 1 : 0,
              snap ? (long long)snap->nr : -1LL);
  PRUEF(normal > 4000000 && normal < 7000000);   // one cycle 256/48000 s = 5.33 ms
  PRUEF(snap && snap->nr == 2 && snap->ret_da[2] && !snap->ret_da[3]);   // the new layout is installed
  PRUEF(spielt);                                                          // the transport was not interrupted
  PRUEF(d_mit.size() > 20);
  PRUEF(max_mit > 0 && max_mit <= 10000000);   // AK26: at most 10 ms
  if (snap) {   // like test_netz_arr_luecke: the last snapshot goes back to the load thread's side
    x.ringe->rueckgabe.schiebe(const_cast<cdj::ArrSnapshot*>(snap));
    x.lader.einmal(*x.ringe);
  }
  PRUEF_ENDE();
}
