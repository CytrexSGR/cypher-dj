// Container core K5: the live invariants of a cypherdj-arr/4 file and the structural send mask.
// Cases: 1 each reason by name on a crafted /4 live head (a track under a group without dj, a track with PM output, a return that does not lead into a DJ output -> live_ohne_container;
// two top groups on one dj nr -> dj_doppelt), 2 without the live flag the files of case 1 (no dj) load, 3 a valid /4 live file loads and carries the send mask,
// 4 send_maske_live: a row write spur/1/send/2 = 0 dB into a return of another module leaves that module's pair silent (negative control: the own return at 0 dB is audible),
// 5 luecken_laden: groups nr 1, 3, 7 and tracks nr 2, 9 load and sound (gaps in nr, D-M4).
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

static constexpr int KAN = cdj::Arrangement::DJ_KANAELE;
static constexpr int64_t V = 537;

struct Paare {
  std::vector<float> l[KAN];
};
// like Treiber::lauf plus the DJ pairs (zeroed and handed before every block)
static void lauf(Treiber& t, Paare& p, int64_t bis) {
  float b[6][cdj::ARR_BLOCK];
  float dl[KAN][cdj::ARR_BLOCK], dr[KAN][cdj::ARR_BLOCK];
  while (t.s < bis) {
    const int n = t.n;
    for (auto& x : b) std::fill(x, x + n, 0.0f);
    float* pl[KAN];
    float* pr[KAN];
    for (int c = 0; c < KAN; ++c) {
      std::fill(dl[c], dl[c] + n, 0.0f);
      std::fill(dr[c], dr[c] + n, 0.0f);
      pl[c] = dl[c];
      pr[c] = dr[c];
    }
    t.arr.dj_ausgang(pl, pr);
    t.arr.block(t.k, t.s, n, b[0], b[1], b[2], b[3], b[4], b[5]);
    for (int c = 0; c < KAN; ++c) p.l[c].insert(p.l[c].end(), dl[c], dl[c] + n);
    t.s += n;
  }
}
static double spitze(const std::vector<float>& x) {
  double m = 0.0;
  for (float v : x) m = std::max(m, static_cast<double>(std::fabs(v)));
  return m;
}
static void setze(Treiber& t, const char* pfad, float w) {
  const int r = t.tab.suche(pfad);
  PRUEF(r >= 0);
  if (r >= 0) t.arr.setze_sofort(r, w);
}
static std::string dj(int n) { return "{\"art\":\"dj\",\"nr\":" + std::to_string(n) + "}"; }
static std::string grp(int n) { return "{\"art\":\"gruppe\",\"nr\":" + std::to_string(n) + "}"; }

int main() {
  arrdatei::Ordner o("test_arr_live_invarianten");
  const int64_t frames = 400000;
  const std::string sha = o.audio('a', frames, 0.25f);
  const std::string clip = o.clip("c1", 0.0, 8.0, sha, frames);
  cdj::SpeicherKonto konto(100LL << 20);
  cdj::ArrAudioCache cache(&konto, 50LL << 20, false);
  int64_t nr = 0;
  // one file: tracks (json), groups (json), returns (json); head = format and live flag
  const auto lade = [&](const std::string& spuren, const std::string& gruppen, const std::string& returns, bool live, const char* format = "cypherdj-arr/4") {
    ++nr;
    o.roh(nr, std::string("{\"format\":\"") + format + "\",\"nr\":" + std::to_string(nr) + (live ? ",\"live\":true" : "") + ",\"spuren\":[" + spuren + "],\"gruppen\":[" + gruppen + "],\"returns\":[" + returns + "]}");
    return cdj::lade_wiedergabe(o.pfad, nr, cache);
  };
  const auto spur = [&](int n, const std::string& ausgang) {
    return "{\"nr\":" + std::to_string(n) + ",\"art\":\"audio\"" + (ausgang.empty() ? "" : ",\"ausgang\":" + ausgang) + ",\"clips\":[" + clip + "]}";
  };
  const auto gruppe = [](int n, const std::string& ausgang) { return "{\"nr\":" + std::to_string(n) + ",\"ausgang\":" + ausgang + "}"; };
  const std::string master = "{\"art\":\"master\"}";
  const auto frei = [&](cdj::ArrLadeErgebnis& e) { if (e.snap) cdj::gib_wiedergabe(e.snap.release(), cache); };
  {  // 1: each reason by name
    struct F { const char* was; std::string spuren, gruppen, returns; const char* grund; };
    const F faelle[] = {
      {"track under a group without dj", spur(1, grp(1)), gruppe(1, master), "", "live_ohne_container"},
      {"track with PM output", spur(1, ""), gruppe(1, dj(1)), "", "live_ohne_container"},
      {"track with explicit master output", spur(1, master), gruppe(1, dj(1)), "", "live_ohne_container"},
      {"track in a child of a group without dj", spur(1, grp(2)), gruppe(1, master) + "," + gruppe(2, grp(1)), "", "live_ohne_container"},
      {"return on the PM", spur(1, grp(1)), gruppe(1, dj(1)), "{\"nr\":1,\"ausgang\":" + master + "}", "live_ohne_container"},
      {"two top groups on dj 2", spur(1, grp(1)), gruppe(1, dj(2)) + "," + gruppe(2, dj(2)), "", "dj_doppelt"},
    };
    for (const F& f : faelle) {
      cdj::ArrLadeErgebnis e = lade(f.spuren, f.gruppen, f.returns, true);
      if (e.grund != f.grund) std::printf("1 (%s): reason '%s', message '%s'\n", f.was, e.grund.c_str(), e.meldung.c_str());
      PRUEF(!e.snap && e.grund == f.grund);
      frei(e);
    }
    // a child group of a DJ group is fine: the track reaches the top group
    cdj::ArrLadeErgebnis e = lade(spur(1, grp(2)), gruppe(1, dj(1)) + "," + gruppe(2, grp(1)), "{\"nr\":1,\"ausgang\":" + dj(1) + "}", true);
    PRUEF(e.snap != nullptr && e.grund.empty());
    frei(e);
  }
  {  // 2: without the live flag the files without dj load (the invariants are the live head's)
    for (const std::string& s : {spur(1, grp(1)), spur(1, "")}) {
      cdj::ArrLadeErgebnis e = lade(s, gruppe(1, master), "{\"nr\":1,\"ausgang\":" + master + "}", false);
      PRUEF(e.snap != nullptr && !e.snap->live && !e.snap->send_maske);
      frei(e);
    }
  }
  {  // 3: a valid live file
    cdj::ArrLadeErgebnis e = lade(spur(1, grp(1)) + "," + spur(2, grp(2)), gruppe(1, dj(1)) + "," + gruppe(2, dj(4)), "{\"nr\":1,\"ausgang\":" + dj(1) + "},{\"nr\":2,\"ausgang\":" + dj(4) + "}", true);
    PRUEF(e.snap != nullptr && e.snap->live && e.snap->send_maske);
    if (e.snap) PRUEF(e.snap->gruppe_dj[0] == 1 && e.snap->gruppe_dj[1] == 4 && e.snap->ret_dj[0] == 1 && e.snap->ret_dj[1] == 4);
    frei(e);
  }
  {  // 4: send_maske_live. Track 1 plays in group 1 (dj 1); return 1 leads into dj 1 (own module), return 2 into dj 2 (another module); group 2 (dj 2) is empty.
    const auto lauf_mit = [&](float send1, float send2, Paare& p) {
      cdj::ArrLadeErgebnis e = lade(spur(1, grp(1)), gruppe(1, dj(1)) + "," + gruppe(2, dj(2)), "{\"nr\":1,\"ausgang\":" + dj(1) + "},{\"nr\":2,\"ausgang\":" + dj(2) + "}", true);
      PRUEF(e.snap != nullptr);
      if (!e.snap) return;
      auto t = std::make_unique<Treiber>();
      for (const char* h : {"ret/1/hall/an", "ret/2/hall/an"}) setze(*t, h, 0.0f);   // dry returns
      setze(*t, "spur/1/send/1", send1);
      setze(*t, "spur/1/send/2", send2);
      t->laden(e.snap.release());
      t->arr.start(0.0, 2, false, 0, V, 256, t->k);
      lauf(*t, p, 99840);
    };
    Paare nur_gruppe, eigen, fremd;
    lauf_mit(-120.0f, -120.0f, nur_gruppe);   // no sends: the group alone
    lauf_mit(0.0f, -120.0f, eigen);           // negative control: the own return at 0 dB is audible in pair 1
    lauf_mit(-120.0f, 0.0f, fremd);           // the foreign return at 0 dB: nothing may arrive in pair 2
    const double dry = spitze(nur_gruppe.l[0]);
    std::printf("4: pair 1 dry %.4f, with own return %.4f; pair 2 with the foreign send %.3g\n", dry, spitze(eigen.l[0]), spitze(fremd.l[1]));
    PRUEF(dry > 0.1);
    PRUEF(spitze(eigen.l[0]) > dry * 1.3);          // the return adds its signal into its own module
    PRUEF(spitze(fremd.l[1]) < 1e-10);               // < -200 dB: the foreign return is silent
    PRUEF(spitze(fremd.l[0]) < dry * 1.0001 + 1e-9);   // and nothing of the send moved into the own pair
  }
  {  // 5: luecken_laden: gaps in the group and track numbers
    cdj::ArrLadeErgebnis e = lade(spur(2, grp(1)) + "," + spur(9, grp(7)), gruppe(1, dj(1)) + "," + gruppe(3, dj(2)) + "," + gruppe(7, dj(3)), "", true);
    PRUEF(e.snap != nullptr);
    if (!e.snap) { PRUEF_ENDE(); return 1; }
    PRUEF(e.snap->spur[1].nr == 2 && e.snap->spur[8].nr == 9 && e.snap->spur[0].nr == 0);
    PRUEF(e.snap->gruppe_dj[0] == 1 && e.snap->gruppe_dj[2] == 2 && e.snap->gruppe_dj[6] == 3 && e.snap->gruppe_dj[1] == 0);
    auto t = std::make_unique<Treiber>();
    t->laden(e.snap.release());
    t->arr.start(0.0, 2, false, 0, V, 256, t->k);
    Paare p;
    lauf(*t, p, 99840);
    std::printf("5: pairs %.4f %.4f %.4f %.4f\n", spitze(p.l[0]), spitze(p.l[1]), spitze(p.l[2]), spitze(p.l[3]));
    PRUEF(spitze(p.l[0]) > 0.1 && spitze(p.l[2]) > 0.1);   // tracks 2 and 9 sound in the containers of their top groups
    PRUEF(spitze(p.l[1]) == 0.0 && spitze(p.l[3]) == 0.0);   // group 3 has no member, dj 4 nobody
  }
  PRUEF_ENDE();
  return 0;
}
