// 1.8 T3: the RecSpur handoff over the real threads of the operation. The callback thread (Kern::zyklus), the net thread (Netz::laufen, builds, registers and frees
// every RecSpur) and the recording thread (AufnahmeFaden::starte, 10 ms) run at the same time; the peer talks to the net over UDP like the server does.
//   A) in-place monitor changes: the same input in the same mode, monitor 0/1/2 in bursts. The callback reads the new RecSpur (neu->monitor, neu->modus), stores the
//      monitor into the live one with a relaxed store and hands the unused one back (REC_ALT); the net thread frees it.
//   B) real swaps: ein_2 <-> ein_3, so the callback hands the replaced RecSpur back and the net thread frees it while the recording thread may have it registered.
//   C) a take on the armed track while monitor changes arrive in place (accepted at any time) and swaps are refused (aufnahme_laeuft, the new RecSpur goes back too).
//   E) (1.8 T7a) the MIDI ring: a burst of eingang 30 arms (the first RecMidi is adopted, every other one goes back through REC_ALT with fassung 1 and the net thread frees it while the
//      recording thread has it registered), then a take while the callback thread stamps notes and control changes every cycle (the notes sound live on track 2, an RB-338 track, T7b), the recording thread drains the ring, /e/aufnahme art 1.
//   D) disarm, and wait for the answer of the last command: the REC_ALT of every RecSpur is in the event ring before it, so the net thread has freed all of them
//      (under ASan/LSan a RecSpur that was never handed back is reported as a leak at exit).
// Named in the CYPHERDJ_TSAN list of djk/core/CMakeLists.txt: TSan runs this program through setarch -R and every TSan line fails the test.
// Without a sanitizer the program checks the answers and the take only.
#include <atomic>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <string>
#include <thread>
#include <vector>

#include "cypherdj/arr_playback.h"
#include "cypherdj/recording_thread.h"
#include "freeze_threads.h"

namespace v = cypherdj::osc;

int main() {
  ff::Aufbau x("test_aufnahme_tsan");
  const std::string ordner = x.ordner.pfad + "/rec";
  PRUEF(std::filesystem::create_directories(ordner));
  cdj::AufnahmeFaden faden(ordner);
  x.netz->verbinde_rec(&faden);   // before the net thread starts (like main.cpp)
  faden.starte();
  const std::string a = x.ordner.audio('a', 48000);
  x.ordner.wiedergabe(1, "{\"nr\":1,\"art\":\"audio\",\"clips\":[" + x.ordner.clip("c1", 0.0, 1.0, a, 48000) + "]},"
                         "{\"nr\":2,\"art\":\"intern\",\"geraet\":\"rb338\",\"noten\":[]}");   // track 2 is an RB-338 track: the live notes of part E sound on it
  x.echtzeit.store(false);
  x.pause_us.store(200);   // the other threads get their turn between two callbacks
  std::atomic<bool> midi_an{false};
  std::atomic<uint32_t> midi_n{0};
  x.starten([&](cdj::Kern& k) {   // after every cycle, in the callback thread: the notes and control changes of the next one
    if (!midi_an.load(std::memory_order_relaxed)) return;
    const uint32_t n = midi_n.fetch_add(1, std::memory_order_relaxed);
    const uint8_t ton = static_cast<uint8_t>(40 + (n / 2) % 40);
    const uint8_t cc[3] = {0xB0, 74, static_cast<uint8_t>(n & 127)}, note[3] = {static_cast<uint8_t>(n % 2 ? 0x80 : 0x90), ton, static_cast<uint8_t>(n % 2 ? 0 : 100)};
    k.midi_ein(cc, 3, 5);
    k.midi_ein(note, 3, 77);
  });
  x.hallo();
  PRUEF(x.warte("/k/willkommen", 5000, [](const cdj::osc::Nachricht&) { return true; }) >= 0);
  const int64_t l = x.laden(1);
  PRUEF(x.warte_q(l, 3, 20000) >= 0);

  auto spur = [&](int eingang, int scharf, int monitor) {
    cdj::osc::Schreiber s(v::k_rec_spur);
    s.h(++x.id).s("andreas").i(1).i(scharf).i(eingang).i(0).i(monitor);
    x.g->sende(s);
    return x.id;
  };
  // the status of a command: 3 = done, 6 = refused (reason in the packet), -1 = no answer in time
  auto antwort = [&](int64_t id, int ms = 20000) {
    long i = x.warte("/q", ms, [&](const cdj::osc::Nachricht& m) { return m.werte[0].h == id && (m.werte[2].i == 3 || m.werte[2].i == 6); });
    if (i < 0) return -1;
    cdj::osc::Nachricht m;
    const ff::Paket& p = x.pakete[static_cast<size_t>(i)];
    return cdj::osc::lesen(p.roh.data(), p.roh.size(), m) ? static_cast<int>(m.werte[2].i) : -1;
  };
  // a burst: all commands out first, then the answers (the net thread and the callback work on them at the same time)
  auto salve = [&](int n, auto befehl) {
    std::vector<int64_t> ids;
    for (int i = 0; i < n; ++i) ids.push_back(befehl(i));
    int fertig = 0;
    for (int64_t id : ids) fertig += antwort(id) == 3 ? 1 : 0;
    return fertig;
  };

  // arm track 1 on ein_2
  PRUEF(antwort(spur(2, 1, 1)) == 3);
  // A) in place, 300 commands in 30 bursts
  int a_ok = 0;
  for (int b = 0; b < 30; ++b) a_ok += salve(10, [&](int i) { return spur(2, 1, (b + i) % 3); });
  PRUEF(a_ok == 300);
  // B) swaps, 120 commands in 12 bursts; the in-place ones in between keep both paths running side by side
  int b_ok = 0;
  for (int b = 0; b < 12; ++b) b_ok += salve(10, [&](int i) { return spur(i % 2 ? 3 : 2, 1, i % 3); });
  PRUEF(b_ok == 120);
  PRUEF(antwort(spur(2, 1, 2)) == 3);   // ends on ein_2 whatever the burst did last

  // C) a take; monitor changes in place and refused swaps while it records
  cdj::osc::Schreiber sr(v::k_rec_start);
  const int64_t rid = ++x.id;
  sr.h(rid).s("andreas").i(77).i(0).i(0).i(0);
  x.g->sende(sr);
  cdj::osc::Schreiber st(v::k_arr_start);
  st.h(++x.id).s("andreas").d(0.0).i(0);
  x.g->sende(st);
  PRUEF(x.warte("/q", 20000, [&](const cdj::osc::Nachricht& m) { return m.werte[0].h == rid && m.werte[2].i == 2; }) >= 0);   // the take has begun
  int c_inplace = 0, c_refused = 0;
  for (int b = 0; b < 5; ++b) {
    c_inplace += salve(6, [&](int i) { return spur(2, 1, (b + i) % 3); });
    std::vector<int64_t> ids;
    for (int i = 0; i < 4; ++i) ids.push_back(spur(3, 1, 1));   // another input: a swap, refused while the take runs
    for (int64_t id : ids) c_refused += antwort(id) == 6 ? 1 : 0;
  }
  PRUEF(c_inplace == 30);
  PRUEF(c_refused == 20);
  cdj::osc::Schreiber sp(v::k_arr_stopp);
  sp.h(++x.id).s("andreas").i(0);
  x.g->sende(sp);
  PRUEF(x.warte("/q", 20000, [&](const cdj::osc::Nachricht& m) { return m.werte[0].h == rid && m.werte[2].i == 3; }) >= 0);   // the take is over in the callback
  PRUEF(x.warte("/e/aufnahme", 20000, [](const cdj::osc::Nachricht&) { return true; }) >= 0);   // the recording thread closed the file and reported it once

  // D) disarm and wait for the answer: the net thread has handled every REC_ALT before it
  PRUEF(antwort(spur(2, 0, 1)) == 3);
  // E) the MIDI ring over the real threads
  auto midi_spur = [&](int nr, int scharf) {
    cdj::osc::Schreiber s(v::k_rec_spur);
    s.h(++x.id).s("andreas").i(nr).i(scharf).i(30).i(0).i(1);
    x.g->sende(s);
    return x.id;
  };
  midi_an.store(true);   // 1.8 T7b: notes from the first arm on, they play live on track 2 (an RB-338 track) while the net thread arms and disarms
  int e_ok = 0;
  for (int b = 0; b < 10; ++b) e_ok += salve(10, [&](int i) { return midi_spur(2 + i % 4, 1); });   // 100 arms of four tracks: one RecMidi adopted, the others returned
  PRUEF(e_ok == 100);
  cdj::osc::Schreiber sm(v::k_rec_start);
  const int64_t mid = ++x.id;
  sm.h(mid).s("andreas").i(78).i(0).i(0).i(0);
  x.g->sende(sm);
  cdj::osc::Schreiber sa(v::k_arr_start);
  sa.h(++x.id).s("andreas").d(0.0).i(0);
  x.g->sende(sa);
  PRUEF(x.warte("/q", 20000, [&](const cdj::osc::Nachricht& m) { return m.werte[0].h == mid && m.werte[2].i == 2; }) >= 0);   // an instrument-only take has begun
  const uint32_t n_vor = midi_n.load();
  while (midi_n.load() < n_vor + 600) std::this_thread::sleep_for(std::chrono::milliseconds(2));
  cdj::osc::Schreiber sq(v::k_arr_stopp);
  sq.h(++x.id).s("andreas").i(0);
  x.g->sende(sq);
  PRUEF(x.warte("/q", 20000, [&](const cdj::osc::Nachricht& m) { return m.werte[0].h == mid && m.werte[2].i == 3; }) >= 0);
  // the harness keeps the body of /q and /e/freeze only: the MIDI report is counted here (the first /e/aufnahme is the audio take of part C), its content is read from the sidecar
  // and the file (the packet itself is pinned by test_netz_rec_eingang)
  PRUEF(x.warte("/e/aufnahme", 20000, [](const cdj::osc::Nachricht&) { return true; }, 0) >= 0);
  int e_pakete = 0;
  for (int t = 0; t < 4000 && e_pakete < 2; ++t) {
    e_pakete = 0;
    for (const ff::Paket& p : x.pakete) e_pakete += p.adresse == "/e/aufnahme";
    if (e_pakete < 2) x.sammeln(5);
  }
  PRUEF(e_pakete == 2);   // the audio take of C and the MIDI take of E, once each
  for (int nr = 2; nr <= 5; ++nr) PRUEF(antwort(midi_spur(nr, 0)) == 3);   // the last disarm hands the adopted recorder back; notes still arrive: a held key of track 2 ends with its disarm
  midi_an.store(false);
  x.anhalten();
  faden.stoppe();
  PRUEF(x.kern->arrangement().live_offene_noten() == 0 && x.kern->arr_rb().verloren() == 0);   // T7b: every held live key ended with its disarm
  // all threads are stopped: give the loaded playback back like the other harnesses do (arr_run.h ~Lauf), else LeakSanitizer reports the load in every program that loads one
  if (const cdj::ArrSnapshot* snap = x.kern->arrangement().snapshot())
    cdj::gib_wiedergabe(const_cast<cdj::ArrSnapshot*>(snap), const_cast<cdj::ArrAudioCache&>(x.lader.cache()));
  const bool datei = std::filesystem::exists(ordner + "/aufnahme-1-77.f32") && std::filesystem::exists(ordner + "/aufnahme-1-77.json");
  std::printf("aufnahme_tsan: in place %d, swaps %d, take: in place %d, refused %d, files %d\n", a_ok, b_ok, c_inplace, c_refused, datei);
  PRUEF(datei);
  PRUEF(std::filesystem::exists(ordner + "/midi-78.bin") && std::filesystem::file_size(ordner + "/midi-78.bin") % 12 == 0 && std::filesystem::file_size(ordner + "/midi-78.bin") >= 600 * 12);   // two events per cycle, every one of the 600 cycles inside the take
  PRUEF(std::filesystem::exists(ordner + "/midi-78.json"));
  PRUEF_ENDE();
}
