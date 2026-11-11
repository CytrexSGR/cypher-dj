// Plan 1.11 T12 (INTERFACES §4.11 /k/arr/export_lauf; D10): the real-time export of the production master, at the module Arrangement and its writer thread (no Kern, no net).
// A project with an active effect-host stage cannot be rendered offline, so the core plays it and streams the PM post point into a file. The synthetic host of the tests returns the send
// times a gain after `latenz` samples (as in test_arr_host_stufe); with gain 1.0 the project sounds like the same project without the stage once the delay compensation has aligned it.
// Cases: 1 frames_null (a 600-beat project, beyond the tap's 256: frames = the range in samples exactly, file size = frames x 8, and the file equals the offline render of the same project
// without the host stage, residual below -120 dBFS), 2 klick_start (a stage with latenz 600: the clicks of the host strip and of a plain strip sit on beat - von_beat, within 1 sample),
// 3 belegt (a running tap, a running freeze and a running export each refuse a new run; a refusal leaves the job untouched), 4 render (a playback with a host stage `an` true is refused
// host_insert_echtzeit naming the strip, with `an` false it renders), 5 ungesund (the health flag down for 10 blocks of the window: ungesund == 10; 0 without), 6 ueberlauf (a writer that
// falls behind: the run ends schreiber_ueberlauf, the file is removed), 7 keine_allokation (0 allocations in the callback over 2000 blocks of a running export).
// Mutations (CMakeLists.txt): HOST_EXPORT_OHNE_VERSATZ (2: the click is late by 600), HOST_RENDER_OHNE_PRUEFUNG (4 and, through the render comparison of 1 without the stage, the check of 4).
#include <sys/stat.h>
#include <unistd.h>

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <memory>
#include <string>
#include <thread>
#include <vector>

#include "arr_build.h"
#include "arr_file.h"
#include "cypherdj/arr_export_run.h"
#include "cypherdj/render.h"
#include "check.h"
#include "alloc_intercept.h"   // last: replaces malloc and relatives. Exactly one translation unit per program includes it.

using namespace arrtest;
using cdj::ArrArt;
using cdj::ArrInsArt;
using cdj::ArrStufe;

#define TR(x) auto x##_p = std::make_unique<Treiber>(); Treiber& x = *x##_p;

namespace {

constexpr int LAT = 600;

int reg(Treiber& t, const std::string& pfad) {
  const int r = t.tab.suche(pfad.c_str());
  if (r < 0) std::fprintf(stderr, "no row %s\n", pfad.c_str());
  PRUEF(r >= 0);
  return r;
}
void setze(Treiber& t, const std::string& pfad, float w) { t.arr.setze_sofort(reg(t, pfad), w); }

ArrStufe host_stufe(int slot, int latenz, bool an = true) {
  ArrStufe s{ArrInsArt::host, static_cast<uint8_t>(slot), an};
  s.latenz = static_cast<uint16_t>(latenz);
  return s;
}

// the host process of the tests: the return of the block starting at s is gain x the send of the samples s - lat ..; the send buffer is zeroed before every block (as main.cpp does).
// The history is a ring of 8192 samples (no growth over a 600-beat run).
struct Synth {
  int h = 1, lat = LAT, n = 256;
  float gain = 1.0f;
  bool gesund = true;
  std::vector<float> sl = std::vector<float>(8192, 0.0f), sr = std::vector<float>(8192, 0.0f);
  std::vector<float> aus_l = std::vector<float>(cdj::ARR_BLOCK), aus_r = std::vector<float>(cdj::ARR_BLOCK);
  std::vector<float> ret_l = std::vector<float>(cdj::ARR_BLOCK), ret_r = std::vector<float>(cdj::ARR_BLOCK);
  int gesendet = 0;
  int64_t s_gesendet = 0;
  void anbinden(Treiber& t, std::function<bool(int64_t)> gesund_bei = {}) {
    n = t.n;
    t.vor_block = [this, &t, gesund_bei](int64_t s) {
      for (int i = 0; i < gesendet; ++i) {
        sl[static_cast<size_t>((s_gesendet + i) & 8191)] = aus_l[static_cast<size_t>(i)];
        sr[static_cast<size_t>((s_gesendet + i) & 8191)] = aus_r[static_cast<size_t>(i)];
      }
      s_gesendet = s;
      gesendet = n;
      for (int i = 0; i < n; ++i) {
        const int64_t q = s + i - lat;
        ret_l[static_cast<size_t>(i)] = q >= 0 ? gain * sl[static_cast<size_t>(q & 8191)] : 0.0f;
        ret_r[static_cast<size_t>(i)] = q >= 0 ? gain * sr[static_cast<size_t>(q & 8191)] : 0.0f;
      }
      std::fill(aus_l.begin(), aus_l.begin() + n, 0.0f);
      std::fill(aus_r.begin(), aus_r.begin() + n, 0.0f);
      t.arr.host_stufe().setze_zeiger(h, aus_l.data(), aus_r.data(), ret_l.data(), ret_r.data());
      t.arr.host_stufe().setze_gesund(h, gesund_bei ? gesund_bei(s) : gesund);
    };
  }
};

// one block without keeping the output (a 600-beat run would be 400 MB in Treiber::lauf)
void schritt(Treiber& t) {
  float b[6][cdj::ARR_BLOCK];
  for (auto& x : b) std::fill(x, x + t.n, 0.0f);
  if (t.vor_block) t.vor_block(t.s);
  t.arr.block(t.k, t.s, t.n, b[0], b[1], b[2], b[3], b[4], b[5]);
  t.s += t.n;
}
void vorlauf(Treiber& t, int bloecke) {   // the stages settle on silence, as the real load comes seconds before the run
  for (int i = 0; i < bloecke; ++i) schritt(t);
}

struct Ergebnis {
  bool angenommen = false;
  std::string grund;           // the refusal of the core, or the reason of the meldung
  int32_t kern_status = -1;    // hole_export_fertig
  int64_t ende_s = -1;
  int64_t start_s = 0, frames = 0;
  bool meldung = false;
  cdj::ArrExportMeldung m;
};

std::unique_ptr<cdj::ArrExportSchreiber> neu(const std::string& pfad, double von, double bis) {
  auto job = std::make_unique<cdj::ArrExportLauf>();
  job->von_beat = von;
  job->bis_beat = bis;
  return std::make_unique<cdj::ArrExportSchreiber>(std::move(job), pfad);
}

bool warte_fertig(cdj::ArrExportSchreiber& s, int ms = 30000) {
  for (int i = 0; i < ms && !s.fertig(); ++i) std::this_thread::sleep_for(std::chrono::milliseconds(1));
  return s.fertig();
}

// runs one export to its end (or to `max_bloecke` blocks) and collects what the core and the writer say
Ergebnis exportiere(Treiber& t, const std::string& pfad, double von, double bis, int max_bloecke = 1 << 30, std::function<void()> je_block = {}) {
  Ergebnis e;
  auto sch = neu(pfad, von, bis);
  const char* grund = "";
  e.angenommen = t.arr.export_lauf(sch->job(), 0, false, t.s, 0, t.n, t.k, grund);
  if (!e.angenommen) {
    sch->job()->verwerfen(grund);
    e.grund = grund;
  }
  for (int i = 0; i < max_bloecke && (t.arr.export_laeuft() || (e.angenommen && i == 0)); ++i) {
    if (je_block) je_block();
    schritt(t);
  }
  if (e.angenommen) {
    e.start_s = sch->job()->start_s;
    e.frames = sch->job()->frames;
    t.arr.hole_export_fertig(e.kern_status, e.ende_s);
  }
  e.meldung = warte_fertig(*sch);
  if (e.meldung) {
    e.m = sch->meldung();
    if (e.grund.empty()) e.grund = e.m.grund;
  }
  return e;
}

std::vector<float> lies_f32(const std::string& pfad) {
  std::ifstream f(pfad, std::ios::binary | std::ios::ate);
  std::vector<float> d(static_cast<size_t>(f.tellg()) / sizeof(float));
  f.seekg(0);
  f.read(reinterpret_cast<char*>(d.data()), static_cast<std::streamsize>(d.size() * sizeof(float)));
  return d;
}
bool da(const std::string& p) {
  struct stat st;
  return ::stat(p.c_str(), &st) == 0;
}

std::string json_spur(const arrdatei::Ordner& o, int nr, const std::string& sha, double beats, const char* kette = "") {
  std::string clips;
  int k = 0;
  for (double b = 0.0; b < beats; b += 16.0, ++k) {
    if (k) clips += ",";
    clips += o.clip(("c" + std::to_string(nr) + "_" + std::to_string(k)).c_str(), b, std::min(16.0, beats - b), sha, 400000);
  }
  std::string s = "{\"nr\":" + std::to_string(nr) + ",\"art\":\"audio\",\"clips\":[" + clips + "]";
  if (kette[0]) s += std::string(",\"chain\":[") + kette + "]";
  return s + "}";
}

cdj::RenderErgebnis render(const std::string& ordner, double von, double bis) {
  cdj::RenderAuftrag r;
  r.arr_ordner = ordner;
  r.nr = 1;
  r.von_beat = von;
  r.bis_beat = bis;
  r.bpm = 128.0;
  r.quantum = 256;
  r.regler_projekt = true;
  r.abgriff = cdj::RenderAbgriff::produktion;
  return cdj::rendere(r);
}

double spitze(const std::vector<float>& d) {
  double m = 0.0;
  for (float x : d) m = std::max(m, static_cast<double>(std::fabs(x)));
  return m;
}

// the first sample of every click above 0.5 (clicks are 1 sample, summed with their neighbours at most 2)
std::vector<int64_t> klicks(const std::vector<float>& d, int64_t frames) {
  std::vector<int64_t> k;
  for (int64_t i = 0; i < frames; ++i)
    if (std::fabs(d[static_cast<size_t>(2 * i)]) > 0.5f && (k.empty() || i - k.back() > 2000)) k.push_back(i);
  return k;
}

}  // namespace

int main() {
  const std::string dir = "/dev/shm/test_arr_export_lauf_" + std::to_string(::getpid());
  std::filesystem::create_directories(dir);
  auto datei = [&](const char* n) { return dir + "/" + n; };

  {  // 1 frames_null: 600 beats at 128 BPM = 13,500,000 frames; the file is the render of the same project without the stage
    arrdatei::Ordner o("test_arr_export_lauf1");
    const std::string sha = o.sinus('e', 400000, 220.0, 0.4f);
    o.roh(1, "{\"format\":\"cypherdj-arr/2\",\"nr\":1,\"spuren\":[" + json_spur(o, 1, sha, 600.0) + "]}");
    const cdj::RenderErgebnis ref = render(o.pfad, 0.0, 600.0);
    PRUEF(ref.fehler.empty());
    std::printf("1: render of the project without the stage: %lld frames, peak %.4f\n", static_cast<long long>(ref.frames), static_cast<double>(ref.spitze));
    PRUEF(ref.frames == 13500000 && ref.l.size() == 13500000);

    auto au = Audio::sinus(400000, 220.0, 0.4f);
    TR(t)
    Bau b;
    b.spur(1, ArrArt::audio);
    for (int k = 0; k < 38; ++k) b.clip(1, ("c" + std::to_string(k)).c_str(), 16.0 * k, std::min(16.0, 600.0 - 16.0 * k), &au->a);
    b.kette(1, {host_stufe(0, LAT)});
    t.laden(b.fertig());
    Synth host;
    host.anbinden(t);
    setze(t, "ins/host/1/an", 1.0f);
    vorlauf(t, 600);
    PRUEF(t.arr.snapshot()->pdc.gesamt == LAT);
    const Ergebnis e = exportiere(t, datei("a.f32"), 0.0, 600.0);
    std::printf("1: export: angenommen %d, frames %lld, kern_status %d, writer: frames %lld, spitze %.4f, ungesund %d, grund '%s'\n", e.angenommen, static_cast<long long>(e.frames),
                e.kern_status, static_cast<long long>(e.m.frames), static_cast<double>(e.m.spitze), e.m.ungesund, e.grund.c_str());
    PRUEF(e.angenommen && e.meldung && e.kern_status == 0);
    PRUEF(e.frames == 13500000 && e.m.frames == 13500000);   // the range in samples exactly
    PRUEF(e.grund.empty() && e.m.ungesund == 0);
    struct stat st;
    PRUEF(::stat(datei("a.f32").c_str(), &st) == 0 && st.st_size == 13500000LL * 8);
    const std::vector<float> d = lies_f32(datei("a.f32"));
    PRUEF(d.size() == 13500000u * 2);
    double rest2 = 0.0, ref2 = 0.0, rest_max = 0.0;
    for (int64_t i = 0; i < 13500000 && 2 * i + 1 < static_cast<int64_t>(d.size()); ++i) {
      const double dl = static_cast<double>(d[static_cast<size_t>(2 * i)]) - static_cast<double>(ref.l[static_cast<size_t>(i)]);
      const double dr = static_cast<double>(d[static_cast<size_t>(2 * i + 1)]) - static_cast<double>(ref.r[static_cast<size_t>(i)]);
      rest2 += dl * dl + dr * dr;
      ref2 += static_cast<double>(ref.l[static_cast<size_t>(i)]) * ref.l[static_cast<size_t>(i)] + static_cast<double>(ref.r[static_cast<size_t>(i)]) * ref.r[static_cast<size_t>(i)];
      rest_max = std::max(rest_max, std::max(std::fabs(dl), std::fabs(dr)));
    }
    const double rest_db = 10.0 * std::log10(rest2 / 27000000.0 + 1e-30);
    std::printf("1: residual against the render: rms %.1f dBFS, max %.3g (reference rms %.1f dBFS)\n", rest_db, rest_max, 10.0 * std::log10(ref2 / 27000000.0));
    PRUEF(ref2 > 1000.0);                 // positive control: the file carries signal
    PRUEF(rest_db < -120.0);
    PRUEF(std::fabs(spitze(d) - static_cast<double>(e.m.spitze)) < 1e-6);
  }

  {  // 2 klick_start: von_beat 1, the clicks at beat 2 (host strip, latenz 600) and beat 3 (plain strip) sit on 22500 and 45000 of the file
    auto au = Audio::impuls(400000);
    for (const int lat : {LAT, 0}) {   // negative control: without a stage (latency 0) the same positions
      TR(t)
      Bau b;
      b.spur(1, ArrArt::audio).clip(1, "k1", 2.0, 4.0, &au->a).spur(2, ArrArt::audio).clip(2, "k2", 3.0, 4.0, &au->a);
      if (lat) b.kette(1, {host_stufe(0, lat)});
      t.laden(b.fertig());
      Synth host;
      host.lat = lat;
      host.anbinden(t);
      setze(t, "ins/host/1/an", 1.0f);
      vorlauf(t, 600);
      const std::string pfad = datei(lat ? "b1.f32" : "b2.f32");
      const Ergebnis e = exportiere(t, pfad, 1.0, 5.0);
      PRUEF(e.angenommen && e.meldung && e.m.frames == 4 * 22500);
      const std::vector<float> d = lies_f32(pfad);
      const std::vector<int64_t> k = klicks(d, 4 * 22500);
      std::printf("2: latenz %d: pdc.gesamt %d, clicks at", lat, t.arr.snapshot()->pdc.gesamt);
      for (int64_t x : k) std::printf(" %lld", static_cast<long long>(x));
      std::printf(" (expected 22500 45000)\n");
      PRUEF(k.size() == 2);
      if (k.size() == 2) {
        PRUEF(std::llabs(k[0] - 22500) <= 1);
        PRUEF(std::llabs(k[1] - 45000) <= 1);
      }
    }
  }

  {  // 3 belegt: a running tap, freeze or export refuses a new run; the job is not touched
    auto au = Audio::sinus(900000, 220.0, 0.3f);
    TR(t)
    Bau b;
    b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 40.0, &au->a);
    t.laden(b.fertig());
    auto roh = std::make_unique<cdj::ArrExportLauf>();
    roh->von_beat = 0.0;
    roh->bis_beat = 4.0;
    const char* grund = "";
    cdj::ArrAbgriff tap;
    tap.art = 3;
    tap.nr = 1;
    tap.punkt = 1;
    tap.von_beat = 0.0;
    tap.bis_beat = 2.0;
    tap.kap = 2 * 48000 + 2;
    tap.daten.assign(static_cast<size_t>(tap.kap) * 2, 0.0f);
    PRUEF(t.arr.abgriff(&tap, 0, false, t.s, 0, t.n, t.k, grund));
    PRUEF(!t.arr.export_lauf(roh.get(), 0, false, t.s, 0, t.n, t.k, grund) && !std::strcmp(grund, "belegt"));
    PRUEF(roh->phase.load() == 0 && roh->start_s == -1 && !t.arr.export_laeuft());   // untouched
    while (t.arr.abgriff_laeuft()) schritt(t);
    PRUEF(t.arr.hole_abgriff_fertig() == &tap);
    for (int i = 0; i < 100; ++i) schritt(t);
    cdj::ArrFreeze fz;
    fz.spur = 1;
    fz.von_beat = 0.0;
    fz.bis_beat = 2.0;
    fz.kap = 4 * 48000;
    fz.daten.assign(static_cast<size_t>(fz.kap) * 2, 0.0f);
    PRUEF(t.arr.freeze(&fz, 0, false, t.s, 0, t.n, t.k, grund));
    PRUEF(!t.arr.export_lauf(roh.get(), 0, false, t.s, 0, t.n, t.k, grund) && !std::strcmp(grund, "belegt"));
    PRUEF(roh->phase.load() == 0 && roh->start_s == -1);
    while (t.arr.freeze_laeuft()) schritt(t);
    PRUEF(t.arr.hole_freeze_fertig() == &fz);
    for (int i = 0; i < 100; ++i) schritt(t);
    // an export running refuses the second one and the tap (untouched), and ends normally
    auto sch = neu(datei("c.f32"), 0.0, 2.0);
    PRUEF(t.arr.export_lauf(sch->job(), 0, false, t.s, 0, t.n, t.k, grund));
    PRUEF(!t.arr.export_lauf(roh.get(), 0, false, t.s, 0, t.n, t.k, grund) && !std::strcmp(grund, "belegt"));
    PRUEF(!t.arr.abgriff(&tap, 0, false, t.s, 0, t.n, t.k, grund));
    while (t.arr.export_laeuft()) schritt(t);
    int32_t st = -1;
    int64_t es = -1;
    PRUEF(t.arr.hole_export_fertig(st, es) && st == 0);
    PRUEF(warte_fertig(*sch) && sch->meldung().frames == 2 * 22500 && sch->meldung().grund[0] == '\0');
    std::printf("3: tap, freeze and export each refuse a new export with belegt; the refused job stays untouched\n");
  }

  {  // 4 render: a host stage with `an` true is refused naming the strip; with `an` false the project renders
    arrdatei::Ordner o("test_arr_export_lauf4");
    const std::string sha = o.sinus('e', 400000, 220.0, 0.4f);
    for (const bool an : {true, false}) {
      const std::string st = std::string("{\"art\":\"host\",\"slot\":1,\"an\":") + (an ? "true" : "false") + ",\"latenz\":600}";
      o.roh(1, "{\"format\":\"cypherdj-arr/2\",\"nr\":1,\"spuren\":[" + json_spur(o, 1, sha, 16.0) + "," + json_spur(o, 3, sha, 16.0, st.c_str()) + "]}");
      const cdj::RenderErgebnis r = render(o.pfad, 0.0, 8.0);
      std::printf("4: an %d: fehler '%s' meldung '%s' frames %lld peak %.4f\n", an, r.fehler.c_str(), r.meldung.c_str(), static_cast<long long>(r.frames), static_cast<double>(r.spitze));
      if (an) {
        PRUEF(r.fehler == "host_insert_echtzeit");
        PRUEF(r.meldung.find("Spur 3") != std::string::npos);
        PRUEF(r.l.empty());
      } else {
        PRUEF(r.fehler.empty());
        PRUEF(r.frames == 8 * 22500 && r.spitze > 0.1f);   // the stage is dry and aligned
      }
    }
  }

  {  // 5 ungesund: the health flag down for exactly 10 blocks of the window
    auto au = Audio::sinus(400000, 220.0, 0.4f);
    for (const int tropfen : {10, 0}) {
      TR(t)
      Bau b;
      b.spur(1, ArrArt::audio);
      for (int k = 0; k < 3; ++k) b.clip(1, ("c" + std::to_string(k)).c_str(), 16.0 * k, 16.0, &au->a);
      b.kette(1, {host_stufe(0, LAT)});
      t.laden(b.fertig());
      Synth host;
      int blk = 0;
      host.anbinden(t, [&](int64_t) { return !(tropfen > 0 && blk >= 1000 && blk < 1000 + tropfen); });
      setze(t, "ins/host/1/an", 1.0f);
      vorlauf(t, 600);
      blk = 0;
      const Ergebnis e = exportiere(t, datei(tropfen ? "d1.f32" : "d0.f32"), 0.0, 24.0, 1 << 30, [&] { ++blk; });
      std::printf("5: flag down for %d blocks: ungesund %d, grund '%s', frames %lld\n", tropfen, e.m.ungesund, e.grund.c_str(), static_cast<long long>(e.m.frames));
      PRUEF(e.angenommen && e.meldung && e.m.frames == 24 * 22500);
      PRUEF(e.m.ungesund == tropfen);
    }
  }

  {  // 6 ueberlauf: a writer that falls behind ends the run, the file is removed
    auto au = Audio::sinus(400000, 220.0, 0.4f);
    TR(t)
    Bau b;
    b.spur(1, ArrArt::audio).clip(1, "c", 0.0, 16.0, &au->a);
    t.laden(b.fertig());
    vorlauf(t, 100);
    auto sch = neu(datei("e.f32"), 0.0, 14.0);   // 315000 frames: more than the ring holds (1024 x 256 = 262144)
    sch->halte(true);
    const char* grund = "";
    PRUEF(t.arr.export_lauf(sch->job(), 0, false, t.s, 0, t.n, t.k, grund));
    for (int i = 0; i < 4000 && (t.arr.export_laeuft() || i == 0); ++i) schritt(t);
    int32_t st = -1;
    int64_t es = -1;
    PRUEF(t.arr.hole_export_fertig(st, es));
    PRUEF(st == 1);   // aborted by the core
    sch->halte(false);
    PRUEF(warte_fertig(*sch));
    std::printf("6: ueberlauf: core status %d, writer grund '%s', frames %lld, file there %d\n", st, sch->meldung().grund, static_cast<long long>(sch->meldung().frames), da(datei("e.f32")));
    PRUEF(!std::strcmp(sch->meldung().grund, "schreiber_ueberlauf"));
    PRUEF(sch->meldung().frames == 0 && !da(datei("e.f32")));
    for (int i = 0; i < 200; ++i) schritt(t);
    PRUEF(t.arr.status() == cdj::ArrStatus::steht);   // the transport of the run ended with it
  }

  if (!ALLOC_ABFANG_VERFUEGBAR) {
    std::printf("7 skipped (sanitizer build): allocation watcher not available\n");
  } else {  // 7 keine_allokation: 2000 blocks with a running export (the run starts and ends inside the window), a host stage on the strip
    auto au = Audio::sinus(400000, 220.0, 0.3f);
    TR(t)
    Bau b;
    b.spur(1, ArrArt::audio).clip(1, "c", 0.0, 16.0, &au->a);
    b.kette(1, {host_stufe(0, LAT)});
    t.laden(b.fertig());
    Synth host;
    host.anbinden(t);
    setze(t, "ins/host/1/an", 1.0f);
    vorlauf(t, 100);
    auto sch = neu(datei("f.f32"), 0.0, 4.0);   // 90000 frames, about 350 blocks
    const char* grund = "";
    abfang_an();
    const bool ok = t.arr.export_lauf(sch->job(), 0, false, t.s, 0, t.n, t.k, grund);
    int bloecke = 0;
    for (; bloecke < 2000; ++bloecke) {
      if (t.vor_block) t.vor_block(t.s);
      float bb[6][cdj::ARR_BLOCK];
      for (auto& x : bb) std::fill(x, x + t.n, 0.0f);
      t.arr.block(t.k, t.s, t.n, bb[0], bb[1], bb[2], bb[3], bb[4], bb[5]);
      t.s += t.n;
    }
    abfang_aus();
    const AbfangZahlen z = abfang_zahlen();
    int32_t st = -1;
    int64_t es = -1;
    PRUEF(ok && t.arr.hole_export_fertig(st, es) && st == 0);   // the window really started and ended in the counted blocks
    std::printf("7: allocations %ld, free %ld, locks %ld, sleeps %ld over %d blocks with a run\n", z.alloc, z.frei, z.sperren, z.schlafen, bloecke);
    PRUEF(z.summe() == 0);
    PRUEF(warte_fertig(*sch) && sch->meldung().frames == 4 * 22500);
    abfang_an();
    { std::vector<float> x(100000); x[5] = 1.0f; }
    PRUEF(abfang_aus() > 0);   // positive control: the counter sees allocations
  }

  std::filesystem::remove_all(dir);
  PRUEF_ENDE();
}
