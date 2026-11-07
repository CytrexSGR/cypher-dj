// Package 1.9 Instruments, U0 (AK-R9, kit neutrality): projects without kit tracks and racks render bit-equal to the state before the
// package. Three reference projects run through cdj::rendere (the offline render of the live kern):
//   rb_audio  RB-338 track (16 notes) plus an audio track with one clip of fixed-seed noise (stands in for a frozen Surge track)
//   bk        the bk project of test_render_bk.cpp (graph bkt::G_T), two notes
//   routing   the group project of test_render.cpp case 9 (two audio tracks into group 1), rendered with a group fader and a track pan
// The FNV-1a hash over the master samples (L then R) plus the render geometry (frames, start sample, limiter lead) of each project is
// pinned in tests/daten/render_instrumente_unveraendert.hash, recorded on main 8afd2d88 BEFORE the first change of the package
// (call with --schreibe). Every later change that touches the unchanged path of the sinks, the dispatcher or the render turns it red.
// Instrument checks: a hash over silence is not a hash. Every render must carry signal, and for rb_audio each of its two tracks must
// contribute (muting either one changes the master and leaves signal).
// Call: test_render_instrumente_unveraendert [--schreibe]
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <string>
#include <vector>

#include "arr_datei.h"
#include "bk_hilfe.h"
#include "cypherdj/render.h"
#include "cypherdj/zustand.h"
#include "pruef.h"

namespace {

constexpr int64_t NOISE_FRAMES = 300000;

// Fixed-seed noise written as audio/<sha>.f32 (stereo f32), peak 0.25: any shift by one sample shows up in the hash.
std::string rauschen_schreiben(const arrdatei::Ordner& o, char z, uint32_t saat) {
  const std::string sha(64, z);
  std::vector<float> d(static_cast<size_t>(NOISE_FRAMES) * 2);
  uint32_t s = saat;
  for (float& v : d) {
    s = s * 1664525u + 1013904223u;
    v = 0.25f * (static_cast<float>(s >> 8) / 8388608.0f - 1.0f);
  }
  std::ofstream(o.pfad + "/audio/" + sha + ".f32", std::ios::binary)
      .write(reinterpret_cast<const char*>(d.data()), static_cast<std::streamsize>(d.size() * sizeof(float)));
  return sha;
}

uint64_t fnv_bytes(const void* p, size_t n, uint64_t h) {
  const auto* b = static_cast<const uint8_t*>(p);
  for (size_t i = 0; i < n; ++i) {
    h ^= b[i];
    h *= 1099511628211ULL;
  }
  return h;
}

uint64_t fnv(const std::vector<float>& v, uint64_t h) { return fnv_bytes(v.data(), v.size() * sizeof(float), h); }

struct Probe {
  std::string name;
  uint64_t hash = 0;
  long long frames = 0, start = 0;
  int vorhalt = 0;
  float spitze = 0.0f;
};

Probe fasse(const std::string& name, const cdj::RenderErgebnis& e) {
  Probe p;
  p.name = name;
  p.hash = fnv(e.r, fnv(e.l, 1469598103934665603ULL));
  p.frames = e.frames;
  p.start = e.start_sample;
  p.vorhalt = e.vorhalt;
  p.spitze = e.spitze;
  return p;
}

std::string zeile(const Probe& p) {
  char b[160];
  std::snprintf(b, sizeof b, "%s %016llx %lld %lld %d", p.name.c_str(), static_cast<unsigned long long>(p.hash), p.frames, p.start, p.vorhalt);
  return b;
}

cdj::RenderAuftrag auftrag(const std::string& ordner, int64_t nr, double bis_beat) {
  cdj::RenderAuftrag r;
  r.arr_ordner = ordner;
  r.nr = nr;
  r.von_beat = 0.0;
  r.bis_beat = bis_beat;
  r.bpm = 128.0;
  r.regler_projekt = true;   // erz/4 neutral, the project controls on top (source "projekt"): no Neustart-Fach needed
  return r;
}

// 16 notes on eighths over 8 beats: a fixed bass line with changing velocity
std::string rb_noten() {
  static const int ton[16] = {36, 36, 48, 36, 43, 36, 46, 48, 36, 39, 48, 36, 43, 41, 46, 48};
  std::string s;
  char b[160];
  for (int i = 0; i < 16; ++i) {
    std::snprintf(b, sizeof b, "%s{\"id\":\"c1/n%d\",\"beat\":%.1f,\"laenge\":0.4,\"ton\":%d,\"vel\":%d}", i ? "," : "", i + 1, i * 0.5, ton[i], 70 + (i * 7) % 50);
    s += b;
  }
  return s;
}

}  // namespace

int main(int argc, char** argv) {
  const std::string datei = std::string(CYPHERDJ_DJK) + "/kern/tests/daten/render_instrumente_unveraendert.hash";
  arrdatei::Ordner o("test_render_instrumente_unveraendert");
  const std::string bk = o.pfad + "/bk";
  std::filesystem::create_directories(bk);
  std::ofstream(bk + "/t.json") << bkt::G_T;
  const std::string sha = rauschen_schreiben(o, 'e', 12345u);
  const std::string sha2 = rauschen_schreiben(o, 'f', 777u);

  // 1 rb_audio: track 1 RB-338 (cutoff 0.5, resonanz 0.4), track 2 audio clip of noise
  o.wiedergabe(1, "{\"nr\":1,\"art\":\"intern\",\"geraet\":\"rb338\",\"parameter\":{\"cutoff\":0.5,\"resonanz\":0.4},\"noten\":[" + rb_noten() + "]},"
                  "{\"nr\":2,\"art\":\"audio\",\"clips\":[" + o.clip("c2", 0.0, 8.0, sha, NOISE_FRAMES, 0, -6.0) + "]}");
  // 2 bk: the project of test_render_bk.cpp (graph t, k1 0.8)
  o.wiedergabe(2, std::string("{\"nr\":2,\"art\":\"intern\",\"geraet\":\"bk\",\"graph\":\"t\",\"parameter\":{\"k1\":0.8},") +
                  "\"noten\":[{\"id\":\"c2/n1\",\"beat\":0.5,\"laenge\":0.5,\"ton\":57,\"vel\":100},"
                  "{\"id\":\"c2/n2\",\"beat\":2.0,\"laenge\":0.5,\"ton\":64,\"vel\":100}]}");
  // 3 routing: test_render.cpp case 9, two audio tracks into group 1 (two noise files instead of the constant: a swapped channel or a wrong sum shows)
  const std::string clip_a = o.clip("c1", 0.0, 4.0, sha, NOISE_FRAMES), clip_b = o.clip("c1", 0.0, 4.0, sha2, NOISE_FRAMES);
  o.wiedergabe2(3, "{\"nr\":1,\"art\":\"audio\",\"ausgang\":{\"art\":\"gruppe\",\"nr\":1},\"clips\":[" + clip_a + "]},"
                   "{\"nr\":2,\"art\":\"audio\",\"ausgang\":{\"art\":\"gruppe\",\"nr\":1},\"clips\":[" + clip_b + "]}",
                "{\"nr\":1,\"ausgang\":{\"art\":\"master\"}}");

  std::vector<Probe> proben;
  {
    cdj::RenderAuftrag r = auftrag(o.pfad, 1, 8.0);
    const cdj::RenderErgebnis e = cdj::rendere(r);
    std::printf("rb_audio: error '%s' %s, peak %.4f\n", e.fehler.c_str(), e.meldung.c_str(), e.spitze);
    PRUEF(e.fehler.empty() && e.spitze > 0.01f && e.frames == 8 * 22500);
    proben.push_back(fasse("rb_audio", e));
    // instrument check: both tracks contribute. Muting track 2 leaves the bass, muting track 1 leaves the noise; both differ from the full master.
    r.spur_regler = {{"spur/2/mute", 1.0f}};
    const cdj::RenderErgebnis nur_rb = cdj::rendere(r);
    r.spur_regler = {{"spur/1/mute", 1.0f}};
    const cdj::RenderErgebnis nur_audio = cdj::rendere(r);
    PRUEF(nur_rb.fehler.empty() && nur_audio.fehler.empty() && nur_rb.spitze > 0.01f && nur_audio.spitze > 0.01f);
    PRUEF(nur_rb.l != e.l && nur_audio.l != e.l && nur_rb.l != nur_audio.l);
    // determinism: a second render is bit-identical (a hash of a non-deterministic render pins nothing)
    PRUEF(cdj::rendere(auftrag(o.pfad, 1, 8.0)).l == e.l);
  }
  {
    cdj::RenderAuftrag r = auftrag(o.pfad, 2, 4.0);
    r.bk_ordner = bk;
    const cdj::RenderErgebnis e = cdj::rendere(r);
    std::printf("bk: error '%s' %s, peak %.4f\n", e.fehler.c_str(), e.meldung.c_str(), e.spitze);
    PRUEF(e.fehler.empty() && e.spitze > 0.01f && e.frames == 4 * 22500);
    proben.push_back(fasse("bk", e));
    PRUEF(cdj::rendere(r).l == e.l);
  }
  {
    cdj::RenderAuftrag r = auftrag(o.pfad, 3, 4.0);
    const cdj::RenderErgebnis roh = cdj::rendere(r);
    PRUEF(roh.fehler.empty() && roh.spitze > 0.01f && roh.frames == 4 * 22500);
    proben.push_back(fasse("routing", roh));
    // the same project with a group fader and a pan on track 1: the group path and the pan law are pinned as well
    r.spur_regler = {{"grp/1/fader", -6.0206f}, {"spur/1/pan", 0.5f}};
    const cdj::RenderErgebnis geregelt = cdj::rendere(r);
    std::printf("routing: peak %.4f, with group fader and pan %.4f\n", roh.spitze, geregelt.spitze);
    PRUEF(geregelt.fehler.empty() && geregelt.regler == 2 && geregelt.spitze > 0.01f && geregelt.l != roh.l);
    proben.push_back(fasse("routing_regler", geregelt));
  }

  std::string ist;
  for (const Probe& p : proben) {
    std::printf("%s\n", zeile(p).c_str());
    ist += zeile(p) + "\n";
  }
  if (argc > 1 && std::strcmp(argv[1], "--schreibe") == 0) {
    if (pruef_fehler) {   // a silent or non-deterministic reference is not recorded
      std::fprintf(stderr, "reference not written: %d check(s) failed\n", pruef_fehler);
      return 1;
    }
    std::ofstream(datei) << ist;
    std::printf("written: %s\n", datei.c_str());
    return 0;
  }
  std::ifstream f(datei);
  std::string soll((std::istreambuf_iterator<char>(f)), std::istreambuf_iterator<char>());
  PRUEF(!soll.empty());   // missing file: record once with --schreibe on the state BEFORE the change
  PRUEF(soll == ist);
  if (soll != ist) std::fprintf(stderr, "expected:\n%sgot:\n%s", soll.c_str(), ist.c_str());
  PRUEF_ENDE();
}
