// 1.8 T11 (AK32): cost of one core cycle (Kern::zyklus, no JACK, block KOSTEN_BLOCK = 128 or 256, default 256) with a playing arrangement, without and with armed recording
// tracks. Pattern cost_arr.cpp. Start: the task 29 lane of 2026-10-22 (arr3o, rec1, rec8). Lanes, each N measured cycles after 2 000 warm-up cycles:
//   arr3o  arrangement like arr3 (audio kicks, internal and host track on counting sinks, metronome, fader ramp), no loop bracket (a take ends at the first wrap), nothing armed
//   rec1   like arr3o, track 4 armed on erz/1, the take runs over the whole measured window
//   rec8   like arr3o, tracks 4..11 armed on erz/1..3 (the internal taps of task 29), takes over the whole window
//   rec8xm like arr3o, tracks 4..11 armed on the EXTERNAL pairs ein_1..4 (two tracks per pair, Kern::ein in every cycle, 256 frames of a sine per pair), the four channel modes
//          (stereo, left, right, sum) mixed, per-track monitor: five tracks `ein`, two `auto`, one `aus`; and MIDI armed (eingang 30) on the internal and the host track, 100 notes
//          per second (a note on every 480 frames, its off 240 frames later) through the path of the real core: Kern::midi_ein -> stamp -> Aufnahme::midi -> RecMidi ring ->
//          AufnahmeFaden (midi-<kennung>.bin) and Arrangement::live_note on both sinks.
// Gate (AK32): p99.9 of rec8xm <= p99.9 of arr3o + KOSTEN_REC_GATE_US (default 100) at the quantum of the run. One process makes KOSTEN_REC_LAEUFE runs (default 3); each run
// measures both lanes, the order alternates from run to run (a drift of the machine does not always favour the same lane). Per lane the median of the p99.9 values over the runs
// counts; delta = rec8xm - arr3o. Spread = the larger of the two lanes' (max - min) of p99.9 over the runs. Verdict:
//   HAELT                spread < gate and delta <= gate                                  exit 0
//   MISS                 spread < gate and delta > gate and spread <= delta / 2          exit 1 (a FINDING with the number; the gate is never moved)
//   WIEDERHOLEN          spread < gate and delta > gate and spread > delta / 2           exit 3 (repeat once on a quiet machine)
//   NICHT_ENTSCHEIDBAR   spread >= gate (the runs scatter more than the gate: no verdict)   exit 3
// Self-check per lane (exit 2): every armed audio track ends with a message with frames > 0 and gaps 0 and at least n cycles of frames; with MIDI armed one MIDI take with
// about the expected number of events and none refused; no command refused; the callback thread has no page faults reported as FINDING only (printed, not a verdict).
// Page faults: getrusage(RUSAGE_THREAD) of the measuring thread (it plays the callback) before and after the measured window of each lane; the sample vector is touched before.
// xruns: the offline loop has no JACK, so "ueber_frist" counts the measured cycles that took longer than their period (block / 48 kHz).
// KOSTEN_REC_LAEUFE=<n>, KOSTEN_REC_GATE_US=<us>, KOSTEN_BLOCK=<128|256>. Usage: kern_kosten_rec [cycles [lane,lane,...]]   (default 20000 and arr3o,rec8xm)
// KOSTEN_REC_OHNE_MIDI (compile definition, not a CMake option): drops everything that needs the MIDI recorder of the branch (RecMidi, TakeMeldung::art), so that the same source builds
// against the core of main for the AK32 comparison "no armed track, main core against branch core" (lane arr3o only; rec8xm is refused with exit 4).
// Build switches (CMake options, a separate build folder each): REC_FADEN_BREMSE (record thread sleeps 50 ms per chunk: the rings overflow, gaps > 0 are expected, so the
// self-check ends 2) and REC_KOSTEN_AUFSCHLAG (150 us busy wait in Aufnahme::block while a run takes: the positive control, the gate must turn red).
#include <sys/resource.h>
#include <time.h>
#include <unistd.h>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <memory>
#include <string>
#include <thread>
#include <vector>

#include "cypherdj/arr_playback.h"
#include "cypherdj/recording_thread.h"
#include "cypherdj/core.h"

static int64_t jetzt_ns() { timespec t; clock_gettime(CLOCK_MONOTONIC, &t); return (int64_t)t.tv_sec * 1000000000LL + t.tv_nsec; }
struct Kostensenke : cdj::ArrSenke {
  int64_t v; uint64_t n = 0;
  explicit Kostensenke(int64_t vorhalt) : v(vorhalt) {}
  int64_t vorhalt() const noexcept override { return v; }
  void note(int, int64_t, uint8_t, uint8_t, bool) noexcept override { ++n; }
  void alle_aus(int, int64_t) noexcept override {}
  void transport_start(int, int64_t) noexcept override {}
  void block(int, int64_t, int, float*, float*) noexcept override {}
};
struct Lauf {
  std::unique_ptr<unsigned char[]> mem{new unsigned char[CDJ_RING_BYTES]()};
  cdj_ring_kopf* ring = reinterpret_cast<cdj_ring_kopf*>(mem.get());
  std::unique_ptr<cdj::Befehlsring> bef{new cdj::Befehlsring()};
  std::unique_ptr<cdj::Ereignisring> ere{new cdj::Ereignisring()};
  std::unique_ptr<cdj::Kern> kern{new cdj::Kern(128.0, ring, bef.get(), ere.get())};
  int64_t id = 1;
  cdj::Befehl neu(int art) { cdj::Befehl b{}; b.art = art; b.id = ++id; std::snprintf(b.quelle, sizeof b.quelle, "andreas"); return b; }
};

struct Lage { const char* name; int scharf; bool ext; bool midi; };
static const Lage LAGEN[] = {{"arr3o", 0, false, false}, {"rec1", 1, false, false}, {"rec8", 8, false, false}, {"rec8xm", 8, true, true}};
static const int MONITOR_XM[8] = {2, 2, 2, 2, 2, 1, 1, 0};   // rec8xm: five `ein`, two `auto`, one `aus`

struct Messung {
  std::string lage;
  double median = 0, p99 = 0, p999 = 0, max = 0;
  size_t zyklen = 0, ueber_frist = 0;
  long minflt = 0, majflt = 0;
  int ok = 0, erwartet = 0;
  int64_t luecken = 0, abgelehnt = 0, rec3 = 0, midi_ereignisse = 0, midi_refused = 0;
  bool selbst_ok = true;
};

static int quantum() {
  const char* e = std::getenv("KOSTEN_BLOCK");
  if (!e) return 256;
  const int b = std::atoi(e);
  if (b != 128 && b != 256) { std::fprintf(stderr, "kosten_rec: KOSTEN_BLOCK \"%s\" is neither 128 nor 256\n", e); std::exit(4); }
  return b;
}

static Messung messe_lage(const Lage& lg, int n, int Q, const std::string& ordner, int lauf_nr) {
  Messung ms;
  ms.lage = lg.name;
  cdj::SpeicherKonto konto(3800LL << 20);
  cdj::ArrAudioCache cache(&konto, 1024LL << 20, true);
  Lauf l;
  const std::string recdir = ordner + "/rec-" + lg.name + "-" + std::to_string(lauf_nr);
  std::filesystem::create_directories(recdir);
  cdj::AufnahmeFaden faden(recdir);
  std::vector<cdj::RecSpur*> rs;
#ifndef KOSTEN_REC_OHNE_MIDI
  std::vector<cdj::RecMidi*> rm;
#endif
  Kostensenke intern(0), wirt(2 * 256 + 25);   // stand-in sink with an explicit lead (537); the cost lanes do not use the kernel constant for it
  l.kern->setze_arr_senke_intern(&intern);
  l.kern->setze_arr_senke_wirt(1, &wirt);
  cdj::Befehl f = l.neu(cdj::Befehl::TEIL); std::snprintf(f.pfad, sizeof f.pfad, "erz/4/fader"); f.politik = 1; l.bef->schiebe(f);
  cdj::ArrLadeErgebnis e = cdj::lade_wiedergabe(ordner, 1, cache);
  if (!e.snap) { std::fprintf(stderr, "kosten_rec: %s\n", e.meldung.c_str()); std::exit(1); }
  cdj::Befehl b = l.neu(cdj::Befehl::ARR_LADEN); b.zeiger = e.snap.release(); b.arr_nr = 1; l.bef->schiebe(b);
  cdj::Befehl m = l.neu(cdj::Befehl::ARR_METRONOM); m.an = 1; m.wert = -12.0f; l.bef->schiebe(m);
  for (int k = 0; k < lg.scharf; ++k) {
    const int spur = 4 + k;
    const int eing = lg.ext ? 1 + k % 4 : 11 + k % 3;
    cdj::RecSpur* p = cdj::RecSpur::neu(spur, eing);
    if (lg.ext) { p->modus = static_cast<int8_t>(k % 4); p->monitor.store(static_cast<int8_t>(MONITOR_XM[k]), std::memory_order_relaxed); }
    faden.anmelden(p); rs.push_back(p);
    cdj::Befehl r = l.neu(cdj::Befehl::REC_SPUR); r.nr = spur; r.an = 1; r.deck = eing; r.form = lg.ext ? k % 4 : 0; r.politik = lg.ext ? MONITOR_XM[k] : 1; r.zeiger = p; l.bef->schiebe(r);
  }
#ifndef KOSTEN_REC_OHNE_MIDI
  if (lg.midi) {   // eingang 30 on the internal track 2 and the host track 3: the first RecMidi is adopted, the second comes back through REC_ALT (fassung 1) and is freed in leeren()
    for (int spur = 2; spur <= 3; ++spur) {
      cdj::RecMidi* mp = cdj::RecMidi::neu();
      if (spur == 2) { faden.anmelden_midi(mp); rm.push_back(mp); }
      cdj::Befehl r = l.neu(cdj::Befehl::REC_SPUR); r.nr = spur; r.an = 1; r.deck = 30; r.zeiger = mp; l.bef->schiebe(r);
    }
  }
#endif
  // the external inputs: a sine per pair, R = -L, pointers set before every cycle (like main.cpp)
  static float ein_l[4][256], ein_r[4][256];
  for (int k = 0; k < 4; ++k)
    for (int i = 0; i < 256; ++i) { ein_l[k][i] = 0.25f * std::sin(0.05f * (float)(k + 1) * (float)i); ein_r[k][i] = -ein_l[k][i]; }
  int64_t abgelehnt = 0, rec3 = 0;
  const uint8_t kette[3] = {0x90, 0, 100};
  int64_t zyk0 = 0, naechstes = 0;   // first sample of the cycle (own counter); next MIDI event index (2 per note: on at j * 480, off at j * 480 + 240)
  const auto ereignis_zeit = [](int64_t i) { return (i / 2) * 480 + (i % 2) * 240; };
  const auto leeren = [&] {
    cdj::Ereignis x;
    while (l.ere->hole(x)) {
      if (x.art == cdj::Ereignis::QUITTUNG && x.status == 6) { ++abgelehnt; std::fprintf(stderr, "%s: abgelehnt \"%s\"\n", lg.name, x.text); }
      if (x.art == cdj::Ereignis::REC_ZUSTAND && x.status == 3) ++rec3;
#ifndef KOSTEN_REC_OHNE_MIDI
      if (x.art == cdj::Ereignis::REC_ALT && x.fassung == 1) cdj::RecMidi::frei(static_cast<cdj::RecMidi*>(const_cast<void*>(x.zeiger)));   // the RecMidi that was not adopted
#endif
    }
  };
  const auto zyklus = [&](int64_t t0) {
    if (lg.ext) for (int k = 0; k < 4; ++k) l.kern->ein(k + 1, ein_l[k], ein_r[k]);
    if (lg.midi) {
      while (ereignis_zeit(naechstes) < zyk0 + Q) {
        const int64_t j = naechstes / 2;
        uint8_t d[3] = {static_cast<uint8_t>(kette[0] | 0), static_cast<uint8_t>(48 + j % 24), static_cast<uint8_t>(naechstes % 2 == 0 ? 100 : 0)};   // note on / note on with velocity 0 = off
        l.kern->midi_ein(d, 3, static_cast<uint32_t>(ereignis_zeit(naechstes) - zyk0));
        ++naechstes;
      }
    }
    l.kern->zyklus(Q, t0);
    zyk0 += Q;
  };
  for (int i = 0; i < 20; ++i) { zyklus(jetzt_ns()); leeren(); }
  faden.starte();
  if (lg.scharf || lg.midi) { cdj::Befehl r = l.neu(cdj::Befehl::REC_START); r.nr = 7; r.fassung = 0; r.versatz_f = 0; l.bef->schiebe(r); }
  cdj::Befehl s = l.neu(cdj::Befehl::ARR_START); l.bef->schiebe(s);
  cdj::Befehl r = l.neu(cdj::Befehl::TEIL); std::snprintf(r.pfad, sizeof r.pfad, "spur/1/fader"); r.wert = -6.0f; r.ab_beat = 8.0; r.dauer_beats = 64.0; r.politik = 1; l.bef->schiebe(r);
  for (int i = 0; i < 2000; ++i) { zyklus(jetzt_ns()); leeren(); }
  std::vector<double> us(static_cast<size_t>(n), 0.0);   // touched here, so the push of the measured window faults no page
  const double frist_us = Q * 1e6 / 48000.0;
  rusage ru0{}, ru1{};
  getrusage(RUSAGE_THREAD, &ru0);
  for (int i = 0; i < n; ++i) { const int64_t t0 = jetzt_ns(); zyklus(t0); us[static_cast<size_t>(i)] = (jetzt_ns() - t0) / 1000.0; leeren(); }
  getrusage(RUSAGE_THREAD, &ru1);
  ms.minflt = ru1.ru_minflt - ru0.ru_minflt;
  ms.majflt = ru1.ru_majflt - ru0.ru_majflt;
  for (double v : us) ms.ueber_frist += v > frist_us ? 1 : 0;
  std::sort(us.begin(), us.end());
  const auto q = [&](double p) { return us[std::min(us.size() - 1, (size_t)(p * us.size()))]; };
  ms.zyklen = us.size(); ms.median = q(0.5); ms.p99 = q(0.99); ms.p999 = q(0.999); ms.max = us.back();
  ms.erwartet = lg.scharf + (lg.midi ? 1 : 0);
  if (lg.scharf || lg.midi) {
    cdj::Befehl st = l.neu(cdj::Befehl::REC_STOPP); l.bef->schiebe(st);
    for (int i = 0; i < 200; ++i) { zyklus(jetzt_ns()); leeren(); usleep(1000); }
    cdj::TakeMeldung tm{};
    for (int w = 0; w < 300 && ms.ok < ms.erwartet; ++w) {
#ifdef REC_FADEN_BREMSE
      if (w == 0) std::fprintf(stderr, "%s: REC_FADEN_BREMSE build, the record thread sleeps 50 ms per chunk; the wait for the takes is long\n", lg.name);
#endif
      while (faden.hole_meldung(tm)) {
#ifndef KOSTEN_REC_OHNE_MIDI
        if (tm.art == 1) {
          ms.midi_ereignisse = tm.frames; ms.midi_refused = tm.luecken;
          if (tm.frames > 0) ++ms.ok;
        } else
#endif
        {
          if (tm.frames >= static_cast<int64_t>(n) * Q) ++ms.ok;   // frames > 0 and at least the measured window
          else std::fprintf(stderr, "%s: track %d: %lld frames, expected at least %lld\n", lg.name, tm.spur, (long long)tm.frames, (long long)n * Q);
        }
#ifndef KOSTEN_REC_OHNE_MIDI
        ms.luecken += tm.art == 1 ? 0 : tm.luecken;
#else
        ms.luecken += tm.luecken;
#endif
      }
      usleep(10000);
    }
    ms.abgelehnt = abgelehnt; ms.rec3 = rec3;
    const double soll_midi = lg.midi ? 0.9 * n * Q / 48000.0 * 200.0 : 0.0;   // 200 events per second, 90 %
    std::fprintf(stderr, "%s: takes ok %d of %d, gaps %lld, MIDI events %lld (at least %.0f), MIDI refused %lld, REC_ZUSTAND status 3: %lld, refused commands %lld\n", lg.name, ms.ok, ms.erwartet,
                 (long long)ms.luecken, (long long)ms.midi_ereignisse, soll_midi, (long long)ms.midi_refused, (long long)rec3, (long long)abgelehnt);
    if (ms.ok != ms.erwartet || ms.luecken || abgelehnt || ms.midi_refused || (lg.midi && ms.midi_ereignisse < soll_midi)) ms.selbst_ok = false;
  }
  faden.stoppe();
  for (cdj::RecSpur* p : rs) { faden.abmelden(p); cdj::RecSpur::frei(p); }
#ifndef KOSTEN_REC_OHNE_MIDI
  for (cdj::RecMidi* p : rm) { faden.abmelden_midi(p); cdj::RecMidi::frei(p); }
#endif
  std::fprintf(stderr, "%s: notes internal %llu, host %llu; callback thread page faults minor %ld major %ld\n", lg.name, (unsigned long long)intern.n, (unsigned long long)wirt.n, ms.minflt, ms.majflt);
  return ms;
}

static double median3(std::vector<double> v) { std::sort(v.begin(), v.end()); return v[v.size() / 2]; }

int main(int argc, char** argv) {
  const int n = argc > 1 ? std::atoi(argv[1]) : 20'000;
  std::string liste = argc > 2 ? argv[2] : "arr3o,rec8xm";
  const int Q = quantum();
  const int laeufe = std::getenv("KOSTEN_REC_LAEUFE") ? std::max(1, std::atoi(std::getenv("KOSTEN_REC_LAEUFE"))) : 3;
  const double gate = std::getenv("KOSTEN_REC_GATE_US") ? std::atof(std::getenv("KOSTEN_REC_GATE_US")) : 100.0;
  std::vector<const Lage*> lagen;
  for (size_t a = 0; a < liste.size();) {
    size_t z = liste.find(',', a);
    if (z == std::string::npos) z = liste.size();
    const std::string nm = liste.substr(a, z - a);
    const Lage* g = nullptr;
    for (const Lage& x : LAGEN) if (nm == x.name) g = &x;
    if (!g) { std::fprintf(stderr, "kosten_rec: unknown lane \"%s\" (arr3o, rec1, rec8, rec8xm)\n", nm.c_str()); return 4; }
#ifdef KOSTEN_REC_OHNE_MIDI
    if (g->midi) { std::fprintf(stderr, "kosten_rec: lane %s needs the MIDI recorder (build without KOSTEN_REC_OHNE_MIDI)\n", g->name); return 4; }
#endif
    lagen.push_back(g);
    a = z + 1;
  }
  if (lagen.empty()) return 4;
  const std::string ordner = "/dev/shm/kern_kosten_rec_" + std::to_string(getpid());
  std::filesystem::create_directories(ordner + "/audio");
  struct Aufraeumen { std::string d; ~Aufraeumen() { std::error_code ec; std::filesystem::remove_all(d, ec); } } aufraeumen{ordner};
  const std::string sha(64, 'c');
  { std::vector<float> kick(2 * 4800, 0.0f);
    for (int i = 0; i < 4800; ++i) kick[2 * i] = kick[2 * i + 1] = 0.5f * (1.0f - i / 4800.0f);
    std::ofstream(ordner + "/audio/" + sha + ".f32", std::ios::binary).write(reinterpret_cast<const char*>(kick.data()), (std::streamsize)(kick.size() * sizeof(float))); }
  std::string clips, noten;
  for (int b = 0; b < 256; ++b) {   // no loop: kicks over 256 beats (the window of 20 000 cycles ends at beat ~226 at 128 bpm and 256 frames)
    char c[400];
    std::snprintf(c, sizeof c, "%s{\"id\":\"k%d\",\"start_beat\":%d.0,\"laenge_beats\":0.2,\"sha256\":\"%s\",\"datei\":\"%s/audio/%s.f32\","
                  "\"frames\":4800,\"offset_frames\":0,\"gain_db\":0.0,\"ein_beats\":0.0,\"aus_beats\":0.0}", b ? "," : "", b, b, sha.c_str(), ordner.c_str(), sha.c_str());
    clips += c;
  }
  for (int i = 0; i < 1024; ++i)
    noten += (i ? "," : "") + std::string("{\"id\":\"n/") + std::to_string(i) + "\",\"beat\":" + std::to_string(i * 0.25) + ",\"laenge\":0.2,\"ton\":" + std::to_string(36 + i % 24) + ",\"vel\":100}";
  std::ofstream(ordner + "/wiedergabe-1.json") << "{\"format\":\"cypherdj-arr/1\",\"nr\":1,\"spuren\":[{\"nr\":1,\"art\":\"audio\",\"clips\":[" << clips
      << "]},{\"nr\":2,\"art\":\"intern\",\"geraet\":\"rb338\",\"noten\":[" << noten << "]},{\"nr\":3,\"art\":\"wirt\",\"slot\":1,\"noten\":[" << noten << "]}]}";
  std::fprintf(stderr, "kosten_rec: %d cycles of %d frames, %d run(s), lanes %s, gate %.0f us\n", n, Q, laeufe, liste.c_str(), gate);
  int rc = 0;
  std::vector<std::vector<Messung>> alle(lagen.size());   // per lane, one entry per run
  for (int lauf = 0; lauf < laeufe; ++lauf) {
    std::vector<size_t> reihe(lagen.size());
    for (size_t i = 0; i < reihe.size(); ++i) reihe[i] = (lauf % 2 == 0) ? i : lagen.size() - 1 - i;
    for (size_t i : reihe) {
      Messung ms = messe_lage(*lagen[i], n, Q, ordner, lauf);
      std::printf("%-6s run %d cycles %zu: median %.1f us, p99 %.1f us, p99.9 %.1f us, max %.1f us, over deadline %zu\n", ms.lage.c_str(), lauf + 1, ms.zyklen, ms.median, ms.p99, ms.p999, ms.max, ms.ueber_frist);
      std::printf("{\"lage\":\"%s\",\"lauf\":%d,\"zyklen\":%zu,\"median_us\":%.1f,\"p99_us\":%.1f,\"p999_us\":%.1f,\"max_us\":%.1f,\"ueber_frist\":%zu,\"minflt\":%ld,\"majflt\":%ld,"
                  "\"takes_ok\":%d,\"takes_erwartet\":%d,\"luecken\":%lld,\"midi_ereignisse\":%lld,\"midi_abgelehnt\":%lld,\"selbstpruefung\":%s}\n",
                  ms.lage.c_str(), lauf + 1, ms.zyklen, ms.median, ms.p99, ms.p999, ms.max, ms.ueber_frist, ms.minflt, ms.majflt, ms.ok, ms.erwartet, (long long)ms.luecken,
                  (long long)ms.midi_ereignisse, (long long)ms.midi_refused, ms.selbst_ok ? "true" : "false");
      std::fflush(stdout);
      if (!ms.selbst_ok) rc = 2;
      alle[i].push_back(ms);
    }
  }
  int ia = -1, ix = -1;
  for (size_t i = 0; i < lagen.size(); ++i) { if (!std::strcmp(lagen[i]->name, "arr3o")) ia = (int)i; if (!std::strcmp(lagen[i]->name, "rec8xm")) ix = (int)i; }
  if (ia >= 0 && ix >= 0) {
    std::vector<double> pa, px;
    for (const Messung& m : alle[ia]) pa.push_back(m.p999);
    for (const Messung& m : alle[ix]) px.push_back(m.p999);
    const auto streu = [](const std::vector<double>& v) { return *std::max_element(v.begin(), v.end()) - *std::min_element(v.begin(), v.end()); };
    const double ma = median3(pa), mx = median3(px), delta = mx - ma, spread = std::max(streu(pa), streu(px));
    const char* urteil = spread >= gate ? "NICHT_ENTSCHEIDBAR" : delta <= gate ? "HAELT" : spread > delta / 2 ? "WIEDERHOLEN" : "MISS";
    std::printf("GATE arr3o p99.9 median %.1f us, rec8xm p99.9 median %.1f us, delta %+.1f us (gate %.0f), spread %.1f us (arr3o %.1f, rec8xm %.1f): %s\n", ma, mx, delta, gate, spread, streu(pa), streu(px), urteil);
    std::printf("{\"urteil\":\"%s\",\"arr3o_p999_median_us\":%.1f,\"rec8xm_p999_median_us\":%.1f,\"delta_us\":%.1f,\"gate_us\":%.0f,\"streuung_us\":%.1f,\"quantum\":%d,\"laeufe\":%d}\n", urteil, ma, mx, delta, gate, spread, Q, laeufe);
    if (rc == 0) rc = !std::strcmp(urteil, "HAELT") ? 0 : !std::strcmp(urteil, "MISS") ? 1 : 3;
  }
  return rc;
}
