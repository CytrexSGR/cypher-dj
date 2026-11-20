// Kraken patch field (task 3): the pins of the matrix block in the bk sink of a project track (arr_bk_sink.h) and in the loader (playback key `stifte`).
// Graph helper: note -> saw -> matrix e1, matrix a1 -> output. Only the pin [satz 0][zeile 0][spalte 0] is audible there (the weight of e1 into a1); the graph of case f wires every input
// and output so that all 256 pins of set A weigh in. The sink is driven block by block (256 samples) on a snapshot holder, the module does not run.
//   a snapshot with `stifte` [[0,0,0,1]] (folge 0, the hand-built value): the first block after the take-over already sounds at full level (no glide into the sound)
//   b without `stifte`: the graph's own pins (a graph with a default pin sounds, one without is silent); with an empty list of its own: silent even for the graph with a default pin
//   c stift() on the sink: the next block changes
//   d a live pin, then more blocks of the same snapshot: the value holds (a snapshot that is still current never reverts it)
//   e a new snapshot (folge + 1) without the pin: the pin is gone within 3 blocks (undo of the only live pin)
//   f 512 live pins in one cycle: all arrive (the output equals an instance given the same pins directly, and differs from one that lacks one), verloren() unchanged
//   g a transport start keeps the pins, the one of the snapshot and a live one
//   h a live pin stamped with the generation before a swap is dropped, one stamped after it is applied
//   i the loader: `stifte` of a bk track lands in the snapshot (folge unique and never 0, pins sorted), absent = stifte_da false; wrong shapes are refused with `format`
// Mutation: none of its own; every case is red on the build before the change.
#include <cmath>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <string>
#include <vector>

#include "arr_build.h"
#include "arr_file.h"
#include "bk_help.h"
#include "cypherdj/arr_bk_sink.h"
#include "cypherdj/arr_playback.h"
#include <cypherdj/dsp/denormal.h>
#include "check.h"

using namespace arrtest;
using cdj::ArrArt;

namespace {

std::string namen(const char* p) {
  std::string s = "[";
  for (int i = 0; i < 16; ++i) s += std::string(i ? "," : "") + "\"" + p + std::to_string(i) + "\"";
  return s + "]";
}

// note -> saw -> matrix e1, matrix a1 -> output; `stifte` is the text of the default pins of the matrix node ("" = none)
std::string graph(const std::string& stifte) {
  return R"({"format":"baukasten/2","name":"m","stimmen":1,"knoten":[{"id":"n","art":"note"},{"id":"s","art":"saege"},{"id":"m","art":"matrix","zeilen":)" + namen("z") +
         R"(,"spalten":)" + namen("s") + (stifte.empty() ? "" : ",\"stifte\":" + stifte) +
         R"(},{"id":"o","art":"ausgang"}],"kanten":[{"von":"n.hz","nach":"s.hz"},{"von":"s.aus","nach":"m.e1"},{"von":"m.a1","nach":"o.x"}]})";
}

// the saw into every input e1..e16, every output a1..a16 summed (four adds, then one) into the output: the output is the saw times the sum of all pins of set A
std::string graph_voll() {
  std::string k, adds;
  const char* port = "abcd";
  for (int i = 1; i <= 16; ++i) {
    k += ",{\"von\":\"s.aus\",\"nach\":\"m.e" + std::to_string(i) + "\"},{\"von\":\"m.a" + std::to_string(i) + "\",\"nach\":\"p" + std::to_string((i - 1) / 4) + "." + port[(i - 1) % 4] + "\"}";
  }
  for (int j = 0; j < 4; ++j) {
    adds += ",{\"id\":\"p" + std::to_string(j) + "\",\"art\":\"add\"}";
    k += ",{\"von\":\"p" + std::to_string(j) + ".aus\",\"nach\":\"pf." + port[j] + "\"}";
  }
  adds += ",{\"id\":\"pf\",\"art\":\"add\"}";
  k += ",{\"von\":\"pf.aus\",\"nach\":\"o.x\"}";
  return R"({"format":"baukasten/2","name":"v","stimmen":1,"knoten":[{"id":"n","art":"note"},{"id":"s","art":"saege"},{"id":"m","art":"matrix","zeilen":)" + namen("z") +
         R"(,"spalten":)" + namen("s") + "}" + adds + R"(,{"id":"o","art":"ausgang"}],"kanten":[{"von":"n.hz","nach":"s.hz"})" + k + "]}";
}

std::vector<float> ffi_block(CypherBk* h, int n) {
  std::vector<float> l(static_cast<size_t>(n)), r(static_cast<size_t>(n));
  cypherdj::dsp::DenormalSchutz schutz;
  cypher_bk_block(h, l.data(), r.data(), static_cast<size_t>(n));
  return l;
}

float spitze(const std::vector<float>& v) {
  float m = 0.0f;
  for (float x : v) m = std::max(m, std::fabs(x));
  return m;
}

// a snapshot with track 2 on the instance h; `pins` = [satz, zeile, spalte, wert] of the track (da: the track has its own list, even when empty)
cdj::ArrSnapshot* snap(CypherBk* h, uint64_t gen, uint64_t folge, bool da, std::vector<cdj::ArrStift> pins = {}) {
  cdj::ArrSnapshot* s = Bau(static_cast<int64_t>(folge) + 1).spur(2, ArrArt::intern).fertig();
  bkt::spur(s, 2, h, gen);
  s->folge = folge;
  for (const cdj::ArrStift& p : pins) s->stifte.push_back(p);
  s->spur[1].stifte_da = da;
  s->spur[1].stift_von = 0;
  s->spur[1].stift_n = static_cast<int32_t>(pins.size());
  return s;
}

// drives the sink of track 2 (slot index 1) in blocks of 256
struct Rig {
  Treiber t;
  cdj::ArrBkSenke se{t.arr};
  int64_t s0 = 0;
  std::vector<float> block() {
    std::vector<float> l(256, 0.0f), r(256, 0.0f);
    se.takt(static_cast<double>(s0) / SPB, 128.0 / 60.0 / 48000.0);
    se.block(1, s0, 256, l.data(), r.data());
    s0 += 256;
    return l;
  }
  float peak() { return spitze(block()); }
};

}  // namespace

int main() {
  const std::string kein = graph(""), mit = graph("[[0,0,0,1]]");
  const std::vector<cdj::ArrStift> eins{{0, 0, 0, 1.0f}};

  {  // a: the first block after the take-over sounds at full level (folge 0: not the sentinel of the sink)
    Rig r;
    CypherBk* h = bkt::neu(kein);
    PRUEF(h != nullptr && cypher_bk_hat_matrix(h) == 1);
    r.t.laden(snap(h, 1, 0, true, eins));
    r.se.note(1, 0, 57, 100, true);
    const float p1 = r.peak();
    r.peak();
    r.peak();
    const float p4 = r.peak();
    std::printf("a: peak of the first block %.4f, of the fourth %.4f\n", p1, p4);
    PRUEF(p4 > 0.05f && p1 > 0.9f * p4);
    cypher_bk_frei(h);
  }
  {  // b: graph defaults when the track has no pins of its own; its own list replaces them entirely
    Rig r1, r2, r3, r4;
    CypherBk* hm = bkt::neu(mit);
    CypherBk* hk = bkt::neu(kein);
    CypherBk* he = bkt::neu(mit);
    r1.t.laden(snap(hm, 1, 0, false));
    r1.se.note(1, 0, 57, 100, true);
    r2.t.laden(snap(hk, 1, 0, false));
    r2.se.note(1, 0, 57, 100, true);
    r3.t.laden(snap(he, 1, 0, true));   // an empty list of its own: all pins 0
    r3.se.note(1, 0, 57, 100, true);
    float a = 0, b = 0, c = 0;
    for (int i = 0; i < 4; ++i) {
      a = r1.peak();
      b = r2.peak();
      c = r3.peak();
    }
    std::printf("b: default pin %.4f, no pin %.4f, empty list over a default pin %.4f\n", a, b, c);
    PRUEF(a > 0.05f && b < 1e-6f && c < 1e-6f);
    cypher_bk_frei(hm);
    cypher_bk_frei(hk);
    cypher_bk_frei(he);
    (void)r4;
  }
  {  // c, d: a live pin changes the next block and holds while the snapshot stays the same
    Rig r;
    CypherBk* h = bkt::neu(kein);
    r.t.laden(snap(h, 1, 0, false));
    r.se.note(1, 0, 57, 100, true);
    float vor = 0;
    for (int i = 0; i < 3; ++i) vor = r.peak();
    PRUEF(vor < 1e-6f);
    r.se.stift(1, 0, 0, 0, 1.0f, r.t.arr.snapshot_generation());
    const float n1 = r.peak();   // the next block: the pin glides in (about 5 ms)
    float nach4 = 0, spaeter = 0;
    for (int i = 0; i < 3; ++i) nach4 = r.peak();
    for (int i = 0; i < 6; ++i) spaeter = r.peak();
    std::printf("c: before %.4g, next block after the pin %.4f; d: after 4 blocks %.4f, later %.4f\n", vor, n1, nach4, spaeter);
    PRUEF(n1 > 0.05f);
    PRUEF(nach4 > 0.5f && spaeter > 0.95f * nach4 && spaeter < 1.05f * nach4);   // holds: the current snapshot never takes it back
    // e: the next snapshot (folge + 1) says no pin: gone within 3 blocks
    r.t.laden(snap(h, 1, 1, false));
    r.peak();
    r.peak();
    const float weg3 = r.peak();   // smoothed: the pin glides out (about 5 ms), no step
    float weg = 0;
    for (int i = 0; i < 7; ++i) weg = r.peak();
    std::printf("e: three blocks after the new snapshot %.4g, ten blocks %.4g\n", weg3, weg);
    PRUEF(weg3 < 0.1f && weg < 1e-3f);
    cypher_bk_frei(h);
  }
  {  // e (control): a snapshot with the same folge does not take the pin back
    Rig r;
    CypherBk* h = bkt::neu(kein);
    r.t.laden(snap(h, 1, 7, false));
    r.se.note(1, 0, 57, 100, true);
    r.peak();
    r.se.stift(1, 0, 0, 0, 1.0f, r.t.arr.snapshot_generation());
    r.t.laden(snap(h, 1, 7, false));   // another snapshot, the same serial: the slot has nothing to reapply
    // the swap raised the generation: the pin above was stamped before it and is dropped; a pin after the swap stays
    r.se.stift(1, 0, 0, 0, 1.0f, r.t.arr.snapshot_generation());
    r.peak();
    float p = 0;
    for (int i = 0; i < 4; ++i) p = r.peak();
    PRUEF(p > 0.05f);
    cypher_bk_frei(h);
  }
  {  // f: 512 live pins in one cycle
    Rig r;
    CypherBk* h = bkt::neu(graph_voll());
    CypherBk* hd = bkt::neu(graph_voll());   // reference: the same pins straight into the instance
    CypherBk* hf = bkt::neu(graph_voll());   // reference that lacks the pin (0,0,15)
    PRUEF(h && hd && hf);
    r.t.laden(snap(h, 1, 0, true));
    const uint64_t g = r.t.arr.snapshot_generation();
    for (int i = 0; i < 512; ++i) {
      const int satz = i / 256, zeile = (i % 256) / 16, spalte = i % 16;
      const float w = (static_cast<float>(i % 7) - 3.0f) * 0.01f + 0.005f;
      r.se.stift(1, satz, zeile, spalte, w, g);
      cypher_bk_stift_sofort(hd, static_cast<uint32_t>(satz), static_cast<uint32_t>(zeile), static_cast<uint32_t>(spalte), w);
      if (i != 15) cypher_bk_stift_sofort(hf, static_cast<uint32_t>(satz), static_cast<uint32_t>(zeile), static_cast<uint32_t>(spalte), w);
    }
    r.se.note(1, 0, 57, 100, true);
    cypher_bk_note_an(hd, 0, 57, 100.0f / 127.0f);
    cypher_bk_note_an(hf, 0, 57, 100.0f / 127.0f);
    bool gleich = true, anders = false;
    float pr = 0;
    for (int i = 0; i < 4; ++i) {
      const std::vector<float> a = r.block(), d = ffi_block(hd, 256), f = ffi_block(hf, 256);
      pr = std::max(pr, spitze(a));
      gleich = gleich && a == d;
      anders = anders || a != f;
    }
    std::printf("f: peak %.4f, bit-identical to the instance given the pins directly %d, differs from one without a pin %d, verloren %llu\n", pr, gleich, anders, static_cast<unsigned long long>(r.se.verloren()));
    PRUEF(pr > 1e-4f && gleich && anders && r.se.verloren() == 0);
    cypher_bk_frei(h);
    cypher_bk_frei(hd);
    cypher_bk_frei(hf);
  }
  {  // g: a transport start keeps the pins (the snapshot's and a live one)
    Rig r;
    CypherBk* h = bkt::neu(kein);
    CypherBk* hs = bkt::neu(kein);
    r.t.laden(snap(h, 1, 0, true, eins));
    r.se.note(1, 0, 57, 100, true);
    for (int i = 0; i < 3; ++i) r.peak();
    r.se.transport_start(1, r.s0 + 100);
    r.se.note(1, r.s0 + 100, 57, 100, true);
    r.peak();
    r.peak();
    const float nach = r.peak();
    PRUEF(nach > 0.05f);   // the pin of the snapshot survives the reset of the start
    Rig q;
    q.t.laden(snap(hs, 1, 0, false));
    q.se.note(1, 0, 57, 100, true);
    q.peak();
    q.se.stift(1, 0, 0, 0, 1.0f, q.t.arr.snapshot_generation());
    for (int i = 0; i < 3; ++i) q.peak();
    q.se.transport_start(1, q.s0 + 100);
    q.se.note(1, q.s0 + 100, 57, 100, true);
    q.peak();
    q.peak();
    const float nach2 = q.peak();
    std::printf("g: after a start %.4f (pin of the snapshot), %.4f (live pin)\n", nach, nach2);
    PRUEF(nach2 > 0.05f);
    cypher_bk_frei(h);
    cypher_bk_frei(hs);
  }
  {  // h: the generation stamp
    Rig r;
    CypherBk* h = bkt::neu(kein);
    r.t.laden(snap(h, 1, 0, false));
    r.se.note(1, 0, 57, 100, true);
    r.peak();
    const uint64_t g0 = r.t.arr.snapshot_generation();
    r.se.stift(1, 0, 0, 0, 1.0f, g0);                     // sent against the snapshot before the swap
    r.t.laden(snap(h, 1, 1, false));                      // the swap: a newer snapshot without the pin
    float alt = 0;
    for (int i = 0; i < 4; ++i) alt = r.peak();
    PRUEF(r.t.arr.snapshot_generation() == g0 + 1);
    r.se.stift(1, 0, 0, 0, 1.0f, r.t.arr.snapshot_generation());   // sent after the swap
    r.peak();
    float neu = 0;
    for (int i = 0; i < 4; ++i) neu = r.peak();
    std::printf("h: pin of before the swap %.4g (dropped), pin of after it %.4f\n", alt, neu);
    PRUEF(alt < 1e-3f && neu > 0.05f);
    cypher_bk_frei(h);
  }
  {  // i: the loader
    arrdatei::Ordner o("test_arr_bk_stift");
    const std::string bk = o.pfad + "/bk";
    std::filesystem::create_directories(bk);
    std::ofstream(bk + "/m.json") << kein;
    std::ofstream(bk + "/t.json") << bkt::G_T;
    cdj::SpeicherKonto konto{1024LL << 20};
    cdj::ArrAudioCache cache{&konto, 256LL << 20, false};
    cache.setze_bk_ordner(bk);
    auto lade = [&](int64_t nr, const std::string& spur) {
      o.wiedergabe(nr, spur);
      return cdj::lade_wiedergabe(o.pfad, nr, cache);
    };
    const std::string kopf = "{\"nr\":1,\"art\":\"intern\",\"geraet\":\"bk\",\"graph\":\"m\",";
    cdj::ArrLadeErgebnis a = lade(1, kopf + "\"stifte\":[[0,0,0,0.5],[0,0,3,-0.25],[1,2,3,1]],\"noten\":[]}");
    PRUEF(a.snap != nullptr);
    if (a.snap) {
      const cdj::ArrSpur& sp = a.snap->spur[0];
      PRUEF(sp.stifte_da && sp.stift_n == 3 && a.snap->stifte.size() == 3);
      PRUEF(a.snap->stifte[1].satz == 0 && a.snap->stifte[1].spalte == 3 && a.snap->stifte[1].wert == -0.25f);
      PRUEF(a.snap->stifte[2].satz == 1 && a.snap->stifte[2].zeile == 2 && a.snap->stifte[2].wert == 1.0f);
      PRUEF(a.snap->folge != 0);
    }
    cdj::ArrLadeErgebnis b = lade(2, kopf + "\"noten\":[]}");
    PRUEF(b.snap != nullptr);
    if (b.snap) PRUEF(!b.snap->spur[0].stifte_da && b.snap->spur[0].stift_n == 0 && b.snap->folge != 0 && (!a.snap || b.snap->folge != a.snap->folge));
    cdj::ArrLadeErgebnis c = lade(3, kopf + "\"stifte\":[],\"noten\":[]}");
    PRUEF(c.snap != nullptr && c.snap->spur[0].stifte_da && c.snap->spur[0].stift_n == 0);
    const char* schlecht[] = {
        "\"stifte\":5",                              // not a list
        "\"stifte\":[[0,0,0]]",                      // three fields
        "\"stifte\":[[2,0,0,0.5]]",                  // satz 2
        "\"stifte\":[[0,16,0,0.5]]",                 // zeile 16
        "\"stifte\":[[0,0,-1,0.5]]",                 // spalte -1
        "\"stifte\":[[0,0,0,1.5]]",                  // wert above 1
        "\"stifte\":[[0,0,0,0]]",                    // wert 0 is no pin
        "\"stifte\":[[0,0,0.5,0.5]]",                // fractional spalte
        "\"stifte\":[[0,0,1,0.5],[0,0,0,0.5]]",      // not sorted
        "\"stifte\":[[0,0,0,0.5],[0,0,0,0.25]]",     // the same position twice
        "\"stifte\":[[0,0,\"x\",0.5]]",              // not a number
    };
    int nr = 10;
    for (const char* s : schlecht) {
      cdj::ArrLadeErgebnis e = lade(nr++, kopf + s + ",\"noten\":[]}");
      if (e.snap || e.grund != "format") std::printf("i: %s was not refused with format (grund '%s')\n", s, e.grund.c_str());
      PRUEF(!e.snap && e.grund == "format");
    }
    std::string viele = "[";   // 513 pins
    for (int i = 0; i < 513; ++i) viele += std::string(i ? "," : "") + "[" + std::to_string(i / 256) + "," + std::to_string((i % 256) / 16) + "," + std::to_string(i % 16) + ",0.5]";
    cdj::ArrLadeErgebnis v = lade(nr++, kopf + "\"stifte\":" + viele + "]" + ",\"noten\":[]}");
    PRUEF(!v.snap && v.grund == "format");
    // stifte on a track that is not a bk track
    cdj::ArrLadeErgebnis rb = lade(nr++, "{\"nr\":1,\"art\":\"intern\",\"geraet\":\"rb338\",\"stifte\":[[0,0,0,0.5]],\"noten\":[]}");
    PRUEF(!rb.snap && rb.grund == "format");
    for (auto* e : {&a, &b, &c})
      if (e->snap) cdj::gib_wiedergabe(e->snap.release(), cache);
  }
  PRUEF_ENDE();
}
