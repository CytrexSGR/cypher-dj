// Container core K6: eight returns. Cases: 1 a file with returns nr 1..8 loads (ret_da for all eight), 2 nr 9 is refused with the reason `format`,
// 3 return 8 sounds when spur/1/send/8 is open and not when it is closed (the sends 5..8 live in their own fields), 4 the send to return 5 reaches only return 5 (return 6 stays silent),
// 5 the same track sends into every return 1..8 in turn: each one adds the same level on the master.
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <memory>
#include <string>
#include <vector>

#include "arr_build.h"
#include "arr_file.h"
#include "cypherdj/arr_playback.h"
#include "check.h"

using namespace arrtest;

static constexpr int64_t V = 537;

static double spitze(const std::vector<float>& x) {
  double m = 0.0;
  for (float v : x) m = std::max(m, static_cast<double>(std::fabs(v)));
  return m;
}

int main() {
  static_assert(cdj::ARR_RETURNS == 8, "eight returns");
  arrdatei::Ordner o("test_arr_returns_acht");
  const int64_t frames = 400000;
  const std::string sha = o.audio('a', frames, 0.25f);
  const std::string clip = o.clip("c1", 0.0, 8.0, sha, frames);
  cdj::SpeicherKonto konto(100LL << 20);
  cdj::ArrAudioCache cache(&konto, 50LL << 20, false);
  int64_t nr = 0;
  const std::string master = "{\"art\":\"master\"}";
  // a production file (no live head): one track on the PM, the returns given by their numbers, all on the master
  const auto lade = [&](const std::vector<int>& returns) {
    std::string r;
    for (int n : returns) r += (r.empty() ? "" : ",") + std::string("{\"nr\":") + std::to_string(n) + ",\"ausgang\":" + master + "}";
    ++nr;
    o.roh(nr, "{\"format\":\"cypherdj-arr/4\",\"nr\":" + std::to_string(nr) + ",\"spuren\":[{\"nr\":1,\"art\":\"audio\",\"clips\":[" + clip + "]}],\"gruppen\":[],\"returns\":[" + r + "]}");
    return cdj::lade_wiedergabe(o.pfad, nr, cache);
  };
  {  // 1, 2
    cdj::ArrLadeErgebnis e = lade({1, 2, 3, 4, 5, 6, 7, 8});
    PRUEF(e.snap != nullptr && e.grund.empty());
    if (e.snap)
      for (int r = 0; r < 8; ++r) PRUEF(e.snap->ret_da[r]);
    if (e.snap) cdj::gib_wiedergabe(e.snap.release(), cache);
    cdj::ArrLadeErgebnis z = lade({1, 9});
    if (z.grund != "format") std::printf("2: reason '%s', message '%s'\n", z.grund.c_str(), z.meldung.c_str());
    PRUEF(!z.snap && z.grund == "format");
    if (z.snap) cdj::gib_wiedergabe(z.snap.release(), cache);
  }
  // the peak of the master with the given returns present and the given send open (0 dB); -1: all sends closed
  const auto master_spitze = [&](const std::vector<int>& returns, int offen) {
    cdj::ArrLadeErgebnis e = lade(returns);
    PRUEF(e.snap != nullptr);
    if (!e.snap) return 0.0;
    auto t = std::make_unique<Treiber>();
    for (int r = 1; r <= 8; ++r) {
      const std::string h = "ret/" + std::to_string(r) + "/hall/an";
      const int ri = t->tab.suche(h.c_str());
      PRUEF(ri >= 0);
      if (ri >= 0) t->arr.setze_sofort(ri, 0.0f);   // dry returns
    }
    if (offen > 0) {
      const std::string s = "spur/1/send/" + std::to_string(offen);
      const int ri = t->tab.suche(s.c_str());
      PRUEF(ri >= 0);
      if (ri >= 0) t->arr.setze_sofort(ri, 0.0f);
    }
    t->laden(e.snap.release());
    t->arr.start(0.0, 2, false, 0, V, 256, t->k);
    t->lauf(99840);
    return spitze(t->l);
  };
  const double zu = master_spitze({8}, -1);
  const double auf = master_spitze({8}, 8);
  std::printf("3: return 8 closed %.4f, open %.4f\n", zu, auf);
  PRUEF(zu > 0.1);
  PRUEF(auf > zu * 1.3);   // 3
  const double nur5 = master_spitze({5}, 5);
  const double fuenf_sechs = master_spitze({5, 6}, 5);
  PRUEF(nur5 > zu * 1.3);
  PRUEF(fuenf_sechs == nur5);   // 4: return 6 got nothing from send/5
  for (int r = 1; r <= 8; ++r) {   // 5
    const double a = master_spitze({r}, r);
    if (std::fabs(a - auf) > 1e-6) std::printf("5: return %d peak %.6f, return 8 %.6f\n", r, a, auf);
    PRUEF(std::fabs(a - auf) < 1e-6);
  }
  PRUEF_ENDE();
}
