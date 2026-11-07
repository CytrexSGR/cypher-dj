// cypherdj-stimme: the voice player of the voice channel (stimme.h, kern.toml stimme_eingang). A JACK client that stays
// connected to the kern's input pair ein_<k> for the whole set and plays queued speech clips; between clips it outputs
// silence. So one sentence is never a graph change: the only new edge is made once, when the player starts.
//
// Queue: the spool folder /dev/shm/cypherdj[-$CYPHERDJ_INSTANZ]/stimme. A writer (cypher-say with CYPHER_SAY_ZIEL=studio)
// puts a clip there as raw float32 stereo interleaved 48 kHz under a name ending in .f32 (write to .teil, then rename).
// The player takes clips in name order. When a clip has been played to the end, it renames it to <name>.gespielt (a
// waiting writer sees that and returns); the file is deleted 60 s later. A file named "stopp" in the folder fades the
// running clip out over 20 ms and drops every waiting clip (each becomes .verworfen).
//
// Call: cypherdj-stimme --eingang <1..4> [--ohne-verbinden]
// Realtime: the process callback copies from a clip loaded by the feeder thread and hands it back through atomics; no
// allocation, no lock, no I/O in the callback.
#include <dirent.h>
#include <fcntl.h>
#include <jack/jack.h>
#include <signal.h>
#include <sys/stat.h>
#include <unistd.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <thread>
#include <vector>

#include "cypherdj/instanz.h"

namespace {

struct Clip {
  std::vector<float> d;   // interleaved L R
  size_t pos = 0;         // frames played
  std::string pfad;
  bool verworfen = false;
};

std::atomic<Clip*> g_naechster{nullptr};   // feeder -> callback
std::atomic<Clip*> g_fertig{nullptr};      // callback -> feeder
std::atomic<bool> g_stopp{false};          // feeder -> callback: fade out the running clip
std::atomic<bool> g_halt{false};
Clip* g_lauf = nullptr;                    // callback only
int g_blende = 0;                          // callback only: remaining fade-out frames, 0 = none
jack_port_t* g_aus[2] = {};

constexpr int BLENDE = 960;   // 20 ms

int prozess(jack_nframes_t n, void*) {
  float* l = static_cast<float*>(jack_port_get_buffer(g_aus[0], n));
  float* r = static_cast<float*>(jack_port_get_buffer(g_aus[1], n));
  // a stop with no running clip stays pending until the next clip starts, which then fades out at once (no stop race)
  if (g_lauf && g_blende == 0 && g_stopp.exchange(false)) g_blende = BLENDE;
  jack_nframes_t i = 0;
  while (i < n) {
    if (!g_lauf) {
      if (g_fertig.load(std::memory_order_acquire) == nullptr) g_lauf = g_naechster.exchange(nullptr, std::memory_order_acq_rel);
      if (!g_lauf) break;
      if (g_blende == 0 && g_stopp.exchange(false)) g_blende = BLENDE;
    }
    const size_t frames = g_lauf->d.size() / 2;
    for (; i < n && g_lauf->pos < frames; ++i, ++g_lauf->pos) {
      float g = 1.0f;
      if (g_blende > 0) g = static_cast<float>(g_blende) / BLENDE;
      l[i] = g_lauf->d[2 * g_lauf->pos] * g;
      r[i] = g_lauf->d[2 * g_lauf->pos + 1] * g;
      if (g_blende > 0 && --g_blende == 0) {   // faded out: the clip is over (after this sample, never past the end)
        g_lauf->pos = frames - 1;
        g_lauf->verworfen = true;
      }
    }
    if (g_lauf->pos >= frames) {
      g_fertig.store(g_lauf, std::memory_order_release);
      g_lauf = nullptr;
      g_blende = 0;
      break;   // the next clip starts in the next cycle at the earliest (the feeder must collect this one first)
    }
  }
  for (; i < n; ++i) l[i] = r[i] = 0.0f;
  return 0;
}

void halt(int) { g_halt = true; }
void jack_weg(void*) { g_halt = true; }   // the JACK server went away: end, systemd shows the unit as stopped

bool lade(const std::string& pfad, Clip& c) {
  const int fd = ::open(pfad.c_str(), O_RDONLY | O_CLOEXEC);
  if (fd < 0) return false;
  struct stat st;
  if (fstat(fd, &st) != 0 || st.st_size % 8 != 0 || st.st_size > 48000LL * 8 * 600) {   // at most 10 minutes
    ::close(fd);
    return false;
  }
  c.d.resize(static_cast<size_t>(st.st_size) / 4);
  char* p = reinterpret_cast<char*>(c.d.data());
  size_t rest = static_cast<size_t>(st.st_size);
  while (rest > 0) {
    const ssize_t k = ::read(fd, p, rest);
    if (k <= 0) { ::close(fd); return false; }
    p += k;
    rest -= static_cast<size_t>(k);
  }
  ::close(fd);
  for (float& v : c.d) if (!(v == v) || v > 1.0f || v < -1.0f) v = v == v ? std::clamp(v, -1.0f, 1.0f) : 0.0f;
  // 5 ms fade in and out against clicks at the clip edges
  const size_t fr = c.d.size() / 2, f = std::min<size_t>(240, fr / 2);
  for (size_t i = 0; i < f; ++i) {
    const float g = static_cast<float>(i) / f;
    c.d[2 * i] *= g; c.d[2 * i + 1] *= g;
    c.d[2 * (fr - 1 - i)] *= g; c.d[2 * (fr - 1 - i) + 1] *= g;
  }
  c.pfad = pfad;
  return true;
}

std::vector<std::string> warteschlange(const std::string& ordner) {
  std::vector<std::string> r;
  if (DIR* d = opendir(ordner.c_str())) {
    while (dirent* e = readdir(d)) {
      const std::string n = e->d_name;
      if (n.size() > 4 && n.compare(n.size() - 4, 4, ".f32") == 0) r.push_back(ordner + "/" + n);
    }
    closedir(d);
  }
  std::sort(r.begin(), r.end());
  return r;
}

}  // namespace

int main(int argc, char** argv) {
  int eingang = 0;
  bool verbinden = true;
  for (int i = 1; i < argc; ++i) {
    if (!std::strcmp(argv[i], "--eingang") && i + 1 < argc) eingang = std::atoi(argv[++i]);
    else if (!std::strcmp(argv[i], "--ohne-verbinden")) verbinden = false;
    else eingang = -1;
  }
  const char* inst = cdj_instanz();
  if (eingang < 1 || eingang > 4 || cdj_instanz_k(inst) < 0) {
    std::fprintf(stderr, "usage: cypherdj-stimme --eingang <1..4> [--ohne-verbinden]   (CYPHERDJ_INSTANZ empty or a..i)\n");
    return 2;
  }
  char shm[128], name[64], kern[64];
  cdj_shm_ordner(shm, sizeof shm, inst);
  cdj_name(name, sizeof name, "cypherdj-stimme", inst);
  cdj_name(kern, sizeof kern, "cypherdj-kern", inst);
  const std::string ordner = std::string(shm) + "/stimme";
  ::mkdir(ordner.c_str(), 0700);
  ::unlink((ordner + "/stopp").c_str());
  if (DIR* d = opendir(ordner.c_str())) {   // leftovers of an earlier player: clips it had taken, markers, broken files
    while (dirent* e = readdir(d)) {
      const std::string n = e->d_name;
      if (n.find(".f32.") != std::string::npos) ::unlink((ordner + "/" + n).c_str());
    }
    closedir(d);
  }

  jack_status_t st;
  jack_client_t* c = jack_client_open(name, JackNoStartServer, &st);
  if (!c) {
    std::fprintf(stderr, "cypherdj-stimme: no JACK server (status 0x%x)\n", st);
    return 3;
  }
  if (jack_get_sample_rate(c) != 48000) {
    std::fprintf(stderr, "cypherdj-stimme: JACK runs at %u Hz, the clips are 48000\n", jack_get_sample_rate(c));
    jack_client_close(c);
    return 3;
  }
  g_aus[0] = jack_port_register(c, "aus_L", JACK_DEFAULT_AUDIO_TYPE, JackPortIsOutput, 0);
  g_aus[1] = jack_port_register(c, "aus_R", JACK_DEFAULT_AUDIO_TYPE, JackPortIsOutput, 0);
  if (!g_aus[0] || !g_aus[1]) {
    std::fprintf(stderr, "cypherdj-stimme: ports not created\n");
    jack_client_close(c);
    return 3;
  }
  jack_set_process_callback(c, prozess, nullptr);
  jack_on_shutdown(c, jack_weg, nullptr);
  if (jack_activate(c) != 0) {
    std::fprintf(stderr, "cypherdj-stimme: activation failed\n");
    jack_client_close(c);
    return 3;
  }
  // connect both outputs to the kern's pair; also used again when the kern restarted (its ports are new then)
  auto verbinde = [&](bool melden) {
    bool ok = true;
    for (int s = 0; s < 2; ++s) {
      if (jack_port_connected(g_aus[s]) > 0) continue;
      char ziel[96];
      std::snprintf(ziel, sizeof ziel, "%s:ein_%d_%c", kern, eingang, s ? 'R' : 'L');
      const int rc = jack_connect(c, jack_port_name(g_aus[s]), ziel);
      if (rc != 0 && rc != EEXIST) {
        ok = false;
        if (melden) std::fprintf(stderr, "cypherdj-stimme: cannot connect %s -> %s (kern running?)\n", jack_port_name(g_aus[s]), ziel);
      } else if (!melden) {
        std::fprintf(stderr, "cypherdj-stimme: connected again %s -> %s\n", jack_port_name(g_aus[s]), ziel);
      }
    }
    return ok;
  };
  if (verbinden && !verbinde(true)) {
    jack_client_close(c);
    return 4;
  }
  std::fprintf(stderr, "cypherdj-stimme: ready, %s -> %s:ein_%d, queue %s\n", name, kern, eingang, ordner.c_str());
  signal(SIGINT, halt);
  signal(SIGTERM, halt);

  struct Alt { std::string pfad; std::chrono::steady_clock::time_point t; };
  std::vector<Alt> alte;
  bool unterwegs = false;   // a clip is with the callback
  auto letzte_pruefung = std::chrono::steady_clock::now();
  bool getrennt_gemeldet = false;
  while (!g_halt) {
    if (verbinden && std::chrono::steady_clock::now() - letzte_pruefung > std::chrono::seconds(1)) {   // kern restarted?
      letzte_pruefung = std::chrono::steady_clock::now();
      if (jack_port_connected(g_aus[0]) == 0 || jack_port_connected(g_aus[1]) == 0) {
        if (!getrennt_gemeldet) std::fprintf(stderr, "cypherdj-stimme: not connected to %s:ein_%d, trying every second\n", kern, eingang);
        getrennt_gemeldet = !verbinde(false);
      }
    }
    if (Clip* f = g_fertig.exchange(nullptr, std::memory_order_acq_rel)) {
      const std::string ende = f->pfad + (f->verworfen ? ".verworfen" : ".gespielt");
      ::rename((f->pfad + ".laeuft").c_str(), ende.c_str());
      alte.push_back({ende, std::chrono::steady_clock::now()});
      std::fprintf(stderr, "cypherdj-stimme: %s %s\n", f->verworfen ? "stopped" : "played", f->pfad.c_str());
      delete f;
      unterwegs = false;
    }
    if (::access((ordner + "/stopp").c_str(), F_OK) == 0) {
      ::unlink((ordner + "/stopp").c_str());
      g_stopp = true;
      if (Clip* w = g_naechster.exchange(nullptr)) {   // a clip handed over but not started
        ::rename((w->pfad + ".laeuft").c_str(), (w->pfad + ".verworfen").c_str());
        delete w;
        unterwegs = false;
      }
      for (const std::string& p : warteschlange(ordner)) ::rename(p.c_str(), (p + ".verworfen").c_str());
    }
    if (!unterwegs) {
      for (const std::string& p : warteschlange(ordner)) {
        auto* k = new Clip;
        if (!lade(p, *k)) {
          ::rename(p.c_str(), (p + ".kaputt").c_str());
          std::fprintf(stderr, "cypherdj-stimme: not a clip (raw float32 stereo 48 kHz): %s\n", p.c_str());
          delete k;
          continue;
        }
        ::rename(p.c_str(), (p + ".laeuft").c_str());   // taken: a second scan does not load it again
        k->pfad = p;
        g_naechster.store(k, std::memory_order_release);
        unterwegs = true;
        break;
      }
    }
    const auto jetzt = std::chrono::steady_clock::now();
    alte.erase(std::remove_if(alte.begin(), alte.end(), [&](const Alt& a) {
                 if (jetzt - a.t < std::chrono::seconds(60)) return false;
                 ::unlink(a.pfad.c_str());
                 return true;
               }), alte.end());
    std::this_thread::sleep_for(std::chrono::milliseconds(10));
  }
  jack_client_close(c);
  return 0;
}
