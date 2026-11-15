// Instrument graphs with latency on a project track (delay compensation for instruments). The latency of the graph joins the latency of its strip as if it were a stage at the
// head of the insert chain; the other strips are delayed to match. Graphs are chains of limiter nodes (a limiter is a pure look-ahead delay for a quiet signal, so the onset of a
// note is exact): vorlauf 1.4583 ms = 69 samples, 5 ms = 239 samples each.
//  1 onsets_live       two tracks (latent graph, latency-free graph) play the same note: the master onsets of the strips (the other one muted) are the same sample in the live kern,
//                      and equal the onset of the latent track alone (its own graph delay) and 69 samples after the latency-free track alone
//  1b                  the same with the track pool on 4 lanes
//  2 onsets_render     the same offline (the export skips the common delay: the file onsets are equal, pdc_latenz is 69)
//  3 null              a project of latency-free graphs only is bit for bit what it was before the change (hashes recorded with the build before it), live and offline, no delay place in use
//  4 grenze            17 limiters (4063 samples) are accepted and aligned; 18 (4302) are refused with reason `format` and a message that names the limit 4096
//  5 summe             a latent graph (69) and an EQ insert (69) on the same strip: 138 samples are compensated (live and offline)
// Mutation (CMakeLists.txt): none of its own, the cases are red on the build before the change.
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <string>
#include <vector>

#include "arr_run.h"
#include "cypherdj/arr_track_phase.h"
#include "cypherdj/reverb_pool.h"
#include "cypherdj/render.h"
#include "check.h"

bool g_waechter = false;

using k35::N;
using k35::SPB;

namespace {

// saw x gate x knob 1 through `n` limiters of the given look-ahead (ms); no limiter: the plain mono output
std::string graph(const char* name, int n, double vorlauf) {
  std::string k = R"({"format":"baukasten/2","name":")" + std::string(name) +
                  R"(","stimmen":2,"knoten":[{"id":"n","art":"note"},{"id":"s","art":"saege"},{"id":"v","art":"mul"},{"id":"k","art":"regler","nr":1,"min":0,"max":1},{"id":"vk","art":"mul"},)";
  std::string e = R"("kanten":[{"von":"n.hz","nach":"s.hz"},{"von":"s.aus","nach":"v.a"},{"von":"n.gate","nach":"v.b"},{"von":"v.aus","nach":"vk.a"},{"von":"k.aus","nach":"vk.b"})";
  char b[200];
  std::string vor = "vk";
  for (int i = 0; i < n; ++i) {
    std::snprintf(b, sizeof b, R"({"id":"l%d","art":"limiter","decke":0,"vorlauf":%g},)", i, vorlauf);
    k += b;
    std::snprintf(b, sizeof b, R"(,{"von":"%s.%s","nach":"l%d.l"},{"von":"%s.%s","nach":"l%d.r"})", vor.c_str(), i ? "l" : "aus", i, vor.c_str(), i ? "r" : "aus", i);
    e += b;
    vor = "l" + std::to_string(i);
  }
  if (n == 0) e += R"(,{"von":"vk.aus","nach":"o.x"})";
  else e += ",{\"von\":\"" + vor + ".l\",\"nach\":\"o.l\"},{\"von\":\"" + vor + ".r\",\"nach\":\"o.r\"}";
  return k + R"({"id":"o","art":"ausgang"}],)" + e + "]}";
}

void schreibe_graphen(const std::string& bk) {
  std::filesystem::create_directories(bk);
  std::ofstream(bk + "/g0.json") << graph("g0", 0, 0.0);               // no latency
  std::ofstream(bk + "/g69.json") << graph("g69", 1, 1.4583);          // 69 samples
  std::ofstream(bk + "/g4063.json") << graph("g4063", 17, 5.0);        // 4063 samples
  std::ofstream(bk + "/g4302.json") << graph("g4302", 18, 5.0);        // 4302 samples: over the limit
}

std::string spur(int nr, const char* graph, const std::string& kette = "") {
  return "{\"nr\":" + std::to_string(nr) + ",\"art\":\"intern\",\"geraet\":\"bk\",\"graph\":\"" + graph + "\",\"parameter\":{\"k1\":0.5}" + (kette.empty() ? "" : ",\"chain\":[" + kette + "]") +
         ",\"noten\":[{\"id\":\"c" + std::to_string(nr) + "/n1\",\"beat\":0.5,\"laenge\":0.5,\"ton\":57,\"vel\":100}]}";
}
const char* EQ = "{\"art\":\"eq\",\"slot\":1,\"an\":true}";

uint64_t hash(const std::vector<float>& x) {   // FNV-1a over the bit patterns
  uint64_t h = 1469598103934665603ull;
  for (const float v : x) {
    uint32_t b;
    std::memcpy(&b, &v, 4);
    for (int i = 0; i < 4; ++i) h = (h ^ ((b >> (8 * i)) & 0xff)) * 1099511628211ull;
  }
  return h;
}
int64_t erster(const std::vector<float>& x) {
  for (size_t i = 0; i < x.size(); ++i)
    if (x[i] != 0.0f) return static_cast<int64_t>(i);
  return -1;
}

struct Live {
  int64_t onset = -1;
  uint64_t h = 0;
  int delays = -1;   // delay places in use
  std::string fehler;
};

// the live kern; `stumm`: track number to mute (0 none)
Live live(const std::string& ab, const std::string& bk, const std::string& spuren, int stumm, int bahnen = 0) {
  Live r;
  arr35::Lauf x(ab, "test_arr_bk_latenz");
  cdj::HallPoolEinstellung pe;
  pe.faeden = 3;
  pe.frist_us = 1000000;
  cdj::HallPool pool(pe);
  pool.setze_fifo_test(true);
  if (bahnen > 0) {   // the track pool: the tracks run on lanes (test only: the kern hands out a const view)
    x.kern->setze_hall_pool(&pool);
    cdj::Arrangement& arr = const_cast<cdj::Arrangement&>(x.kern->arrangement());
    arr.setze_spur_pool(1);
    cdj::SpurTest st;
    st.min_last = 0;
    st.grenze_ns = 10'000'000'000LL;
    st.warte_spaet_ns = 10'000'000'000LL;
    arr.setze_spur_test(st);
    arr.setze_spur_bahnen(bahnen);
  }
  x.cache.setze_bk_ordner(bk);
  x.cache.setze_bk_leser(x.kern->arr_bk_leser());
  x.ordner.wiedergabe2_ret(1, spuren, "", "");
  cdj::ArrLadeErgebnis e = cdj::lade_wiedergabe(x.ordner.pfad, 1, x.cache);
  if (!e.snap) {
    r.fehler = e.grund + ": " + e.meldung;
    return r;
  }
  r.delays = e.snap->pdc.ringe;
  cdj::Befehl b = x.neu(cdj::Befehl::ARR_LADEN, "andreas");
  b.zeiger = e.snap.release();
  b.arr_nr = 1;
  x.sende(b);
  if (stumm) x.teil(("spur/" + std::to_string(stumm) + "/mute").c_str(), 1.0f, 0.0, 0.0);
  x.lauf(4 * N);
  x.start(0.0, 0);
  x.lauf(4 * N + 2 * SPB);
  r.onset = arr35::Lauf::erster(x.l, 0, static_cast<int64_t>(x.l.size()));
  r.h = hash(x.l);
  return r;
}

struct Off {
  int64_t onset = -1;
  uint64_t h = 0;
  int pdc = -1;
  std::string fehler, meldung;
};

Off render(const std::string& pfad, const std::string& bk, const std::string& spuren, int stumm) {
  std::ofstream(pfad + "/wiedergabe-1.json") << "{\"format\":\"cypherdj-arr/2\",\"nr\":1,\"spuren\":[" << spuren << "],\"gruppen\":[],\"returns\":[]}";
  cdj::RenderAuftrag a;
  a.arr_ordner = pfad;
  a.nr = 1;
  a.von_beat = 0.0;
  a.bis_beat = 2.0;
  a.bpm = 128.0;
  a.bk_ordner = bk;
  a.regler_projekt = true;
  if (stumm) a.spur_regler.push_back({"spur/" + std::to_string(stumm) + "/mute", 1.0f});
  a.abgriff = cdj::RenderAbgriff::produktion;
  const cdj::RenderErgebnis e = cdj::rendere(a);
  Off r;
  r.fehler = e.fehler;
  r.meldung = e.meldung;
  r.pdc = e.pdc_latenz;
  r.onset = erster(e.l);
  r.h = hash(e.l);
  return r;
}

}  // namespace

int main() {
  k35::Arbeitsbestand ab("test_arr_bk_latenz");
  arrdatei::Ordner o("test_arr_bk_latenz_o");
  const std::string bk = o.pfad + "/bk";
  schreibe_graphen(bk);

  const std::string frei1 = spur(1, "g0"), lat1 = spur(1, "g69"), frei2 = spur(2, "g0"), lat2 = spur(2, "g69");
  const std::string paar = lat1 + "," + frei2;   // track 1 latent, track 2 latency-free

  // 1 onsets_live
  {
    const Live nur_lat = live(ab.pfad, bk, lat1, 0), nur_frei = live(ab.pfad, bk, frei2, 0);
    const Live a = live(ab.pfad, bk, paar, 2), b = live(ab.pfad, bk, paar, 1);
    std::printf("1 live: latent alone %lld, free alone %lld, pair (track 2 muted) %lld, pair (track 1 muted) %lld, delay places %d\n", static_cast<long long>(nur_lat.onset),
                static_cast<long long>(nur_frei.onset), static_cast<long long>(a.onset), static_cast<long long>(b.onset), a.delays);
    PRUEF(nur_lat.fehler.empty() && nur_frei.fehler.empty() && a.fehler.empty());
    PRUEF(nur_frei.onset > 0 && nur_lat.onset == nur_frei.onset + 69);   // positive control: the graph delays by 69 samples
    PRUEF(a.onset == b.onset);                                           // aligned at the master
    PRUEF(a.onset == nur_lat.onset);                                     // the latency-free strip is held back to the latent one
    PRUEF(a.delays >= 1);
  }
  // 1b the same on the track pool lanes (the sink of a settled bk track joins a lane): the compensation is structure, not a property of where the unit runs
  {
    const Live nur_lat = live(ab.pfad, bk, lat1, 0, 4);
    const Live a = live(ab.pfad, bk, paar, 2, 4), b = live(ab.pfad, bk, paar, 1, 4);
    std::printf("1b lanes: latent alone %lld, pair %lld / %lld\n", static_cast<long long>(nur_lat.onset), static_cast<long long>(a.onset), static_cast<long long>(b.onset));
    PRUEF(a.onset > 0 && a.onset == b.onset && a.onset == nur_lat.onset);
  }
  // 2 onsets_render
  {
    const Off a = render(o.pfad, bk, paar, 2), b = render(o.pfad, bk, paar, 1), nur_frei = render(o.pfad, bk, frei2, 0);
    std::printf("2 render: file onsets pair %lld / %lld, free alone %lld, pdc_latenz %d\n", static_cast<long long>(a.onset), static_cast<long long>(b.onset),
                static_cast<long long>(nur_frei.onset), a.pdc);
    PRUEF(a.fehler.empty() && b.fehler.empty());
    PRUEF(a.pdc == 69 && nur_frei.pdc == 0);
    PRUEF(a.onset > 0 && a.onset == b.onset && a.onset == nur_frei.onset);   // the export skips the common delay: the file starts at the note
  }
  // 3 null (hashes of the build before the change)
  {
    const std::string zwei = frei1 + "," + frei2;
    const Live l = live(ab.pfad, bk, zwei, 0);
    const Off r = render(o.pfad, bk, zwei, 0);
    std::printf("3 null: live hash %llu, render hash %llu, delay places %d / pdc %d\n", static_cast<unsigned long long>(l.h), static_cast<unsigned long long>(r.h), l.delays, r.pdc);
    PRUEF(l.delays == 0 && r.pdc == 0);
    PRUEF(l.h == 1381526847438083662ull && r.h == 29977198191120856ull);   // recorded with the build before the change
  }
  // 4 grenze
  {
    const std::string gross = spur(1, "g4063") + "," + frei2;
    const Live a = live(ab.pfad, bk, gross, 2);
    const Live nur = live(ab.pfad, bk, spur(1, "g4063"), 0);
    std::printf("4 limit: 4063 samples: onset %lld alone %lld\n", static_cast<long long>(a.onset), static_cast<long long>(nur.onset));
    PRUEF(a.fehler.empty() && a.onset > 0 && a.onset == nur.onset);
    const Live b = live(ab.pfad, bk, spur(1, "g4302"), 0);
    const Off c = render(o.pfad, bk, spur(1, "g4302"), 0);
    std::printf("4 limit: 4302 samples: live '%s', render '%s' '%s'\n", b.fehler.c_str(), c.fehler.c_str(), c.meldung.c_str());
    PRUEF(b.fehler.rfind("format", 0) == 0 && b.fehler.find("4096") != std::string::npos);
    PRUEF(c.fehler == "format" && c.meldung.find("4096") != std::string::npos && c.meldung.find("g4302") != std::string::npos);
  }
  // 5 summe
  {
    const std::string mit_eq = spur(1, "g69", EQ) + "," + frei2;
    const Live nur_frei = live(ab.pfad, bk, frei2, 0);
    const Live a = live(ab.pfad, bk, mit_eq, 2), b = live(ab.pfad, bk, mit_eq, 1);
    const Off ra = render(o.pfad, bk, mit_eq, 2), rb = render(o.pfad, bk, mit_eq, 1);
    std::printf("5 sum: live onsets %lld / %lld (free alone %lld), render %lld / %lld, pdc %d\n", static_cast<long long>(a.onset), static_cast<long long>(b.onset),
                static_cast<long long>(nur_frei.onset), static_cast<long long>(ra.onset), static_cast<long long>(rb.onset), ra.pdc);
    PRUEF(a.fehler.empty() && ra.fehler.empty());
    PRUEF(ra.pdc == 138);
    PRUEF(b.onset == nur_frei.onset + 138);   // the latency-free strip alone is held back by 69 + 69
    PRUEF(std::llabs(a.onset - b.onset) <= 0);
    PRUEF(ra.onset == rb.onset);
  }
  PRUEF_ENDE();
}
