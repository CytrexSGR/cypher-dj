// Loop lane strip K4, the kernel: a track of a group on DJ channel 1 (container A = deck/1) with spur/1/fx/3 on and a halving graph on fx/3. The share goes through the whole chain: the arrangement
// diverts it into the fx/3 pair, the core weights it with the container weight and hands it to the mixer, the strip of deck/1 applies its fader, the graph halves it, the master sum carries it.
// Cases: 1 the group alone at 0 dB: the run with fx/3 and the halving graph is half of the run without (peak within 1 percent of 0.5), 2 at -6 dB it is the fader's -6 dB (the container fader acts on the share), 3 with deck/1 closed
// nothing reaches the master, 4 without a graph on fx/3 the track plays on its normal path: the run is the plain one (audible, bit-equal)
// 5 (decision 2026-11-23: FX 3 is a post-fader send of the LOOP group) the group fader at -6 dB is on the share too, and a muted group lets nothing new into fx/3: the master is below -90 dB
// Mutation (CMakeLists.txt): ARR_FX3_OHNE_FADER and ARR_FX3_KOPIE reach this test too (the first run of case 2/3, the sum of case 1).
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <memory>
#include <string>
#include <vector>

#include "arr_run.h"
#include "cypherdj/arr_playback.h"
#include "cypherdj/cypher_bk_ffi.h"
#include "check.h"

bool g_waechter = false;

static const char* HALB =   // the graph halves the signal: it proves that the share really runs through fx/3
    R"({"format":"baukasten/2","name":"halb","stimmen":1,"knoten":[{"id":"e","art":"eingang"},{"id":"a","art":"mul","b":0.5},{"id":"b","art":"mul","b":0.5},{"id":"o","art":"ausgang"}],"kanten":[{"von":"e.l","nach":"a.a"},{"von":"e.r","nach":"b.a"},{"von":"a.aus","nach":"o.l"},{"von":"b.aus","nach":"o.r"}]})";

static double spitze(const std::vector<float>& x, size_t von, size_t bis) {
  double m = 0.0;
  for (size_t i = von; i < x.size() && i < bis; ++i) m = std::max(m, static_cast<double>(std::fabs(x[i])));
  return m;
}
static std::string live_datei(arr35::Lauf& x, const std::string& audio, int64_t frames) {
  const std::string spur = "{\"nr\":1,\"art\":\"audio\",\"ausgang\":{\"art\":\"gruppe\",\"nr\":1},\"clips\":[" + x.ordner.clip("c1", 0.0, 8.0, audio, frames) + "]}";
  return "{\"format\":\"cypherdj-arr/4\",\"nr\":1,\"spuren\":[" + spur + "],\"live\":true,\"gruppen\":[{\"nr\":1,\"ausgang\":{\"art\":\"dj\",\"nr\":1}}]}";
}
// one kernel run: deck/1 fader (dB), fx/3 row of track 1 on or off, a halving graph on fx/3 or none
static std::vector<float> lauf(const std::string& ab, double fader_db, bool fx3, bool mit_graph, double gruppe_db = 0.0, bool gruppe_stumm = false) {
  arr35::Lauf x(ab, "test_arr_fx3_kern");
  const int64_t FR = 400000;
  const std::string a = x.ordner.audio('a', FR, 0.25f);
  x.teil("deck/1/fader", static_cast<float>(fader_db), 0.0, 0.0, "andreas");
  {
    cdj::Befehl b = x.neu(cdj::Befehl::CONTAINER_QUELLE, "andreas");
    b.nr = 1;
    b.an = cdj::Kern::CONTAINER_ART_MODUL;
    x.sende(b);
  }
  if (mit_graph) {
    char f[256] = {};
    CypherBk* g = cypher_bk_neu(HALB, 48000.0, f, sizeof f);
    PRUEF(g != nullptr);
    cdj::Befehl b = x.neu(cdj::Befehl::KANAL_GRAPH, "andreas");
    std::snprintf(b.pfad, sizeof b.pfad, "%s", "fx/3");
    b.zeiger = g;
    x.sende(b);
  }
  x.lauf(4 * k35::N);
  x.ordner.roh(1, live_datei(x, a, FR));
  cdj::ArrLadeErgebnis e = cdj::lade_wiedergabe(x.ordner.pfad, 1, x.cache);
  PRUEF(e.snap != nullptr);
  cdj::Befehl b = x.neu(cdj::Befehl::ARR_LADEN, "andreas");
  b.zeiger = e.snap.release();
  b.arr_nr = 1;
  x.sende(b);
  if (fx3) x.teil("spur/1/fx/3", 1.0f, 0.0, 0.0, "andreas");
  if (gruppe_db != 0.0) x.teil("grp/1/fader", static_cast<float>(gruppe_db), 0.0, 0.0, "andreas");
  if (gruppe_stumm) x.teil("grp/1/mute", 1.0f, 0.0, 0.0, "andreas");
  x.start(0.0, 0);
  x.lauf(135000);
  return x.l;
}

int main() {
  k35::Arbeitsbestand ab("test_arr_fx3_kern_ab");
  const size_t w0 = 100000, w1 = 130000;
  const std::vector<float> plain = lauf(ab.pfad, 0.0, false, false);
  const std::vector<float> g0 = lauf(ab.pfad, 0.0, true, true);
  const std::vector<float> g6 = lauf(ab.pfad, -6.0, true, true);
  const std::vector<float> gz = lauf(ab.pfad, -200.0, true, true);
  const std::vector<float> kein = lauf(ab.pfad, 0.0, true, false);
  std::printf("kern: plain %.5f, fx/3 + halving graph at 0 dB %.5f, at -6 dB %.5f, closed %.3g, fx/3 without graph %.5f\n", spitze(plain, w0, w1), spitze(g0, w0, w1), spitze(g6, w0, w1), spitze(gz, 0, SIZE_MAX),
              spitze(kein, w0, w1));
  PRUEF(spitze(plain, w0, w1) > 0.05);
  PRUEF(std::fabs(spitze(g0, w0, w1) / spitze(plain, w0, w1) - 0.5) < 0.01);   // only the halved share reaches the master: insert, not copy
  PRUEF(std::fabs(spitze(g6, w0, w1) / spitze(g0, w0, w1) - std::pow(10.0, -6.0 / 20.0)) < 2e-3);
  PRUEF(spitze(gz, 0, SIZE_MAX) < 1e-6);
  const std::vector<float> gf = lauf(ab.pfad, 0.0, true, true, -6.0, false);
  const std::vector<float> gs = lauf(ab.pfad, 0.0, true, true, 0.0, true);
  std::printf("kern: group fader -6 dB %.5f (ratio to 0 dB %.4f), group muted peak %.3g (limit %.3g)\n", spitze(gf, w0, w1), spitze(gf, w0, w1) / spitze(g0, w0, w1), spitze(gs, 0, SIZE_MAX), std::pow(10.0, -90.0 / 20.0));
  PRUEF(std::fabs(spitze(gf, w0, w1) / spitze(g0, w0, w1) - std::pow(10.0, -6.0 / 20.0)) < 2e-3);   // the group fader acts on the share
  PRUEF(spitze(gs, 0, SIZE_MAX) < std::pow(10.0, -90.0 / 20.0));                                      // the group mute: nothing reaches fx/3
  PRUEF(plain.size() == kein.size() && std::memcmp(plain.data(), kein.data(), plain.size() * sizeof(float)) == 0);
  PRUEF_ENDE();
}
