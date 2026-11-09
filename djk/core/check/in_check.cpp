// I08 task 6, extended for 1.8 T8: proof client "cypherdj-pruef-ein". Every <period> seconds, in the SAME JACK cycle and at the SAME frame offset, an impulse
// (audio a_L = 1.0) and a note on (MIDI 0x90 <pitch> 100). Measurement only.
//   cypherdj-pruef-ein <pairs> [offset] [options]
//   --offsets a,b,c   frame offsets inside the cycle, used in turn (default: the one [offset], else 100); every offset must be smaller than the quantum
//   --pitches p,q,r   note numbers 0..127, used in turn (default 60)
//   --off-after K     a note off (0x80, velocity 0) K frames after its on, also when that lies in a later cycle (default: none, the note is HELD)
//   --period S        seconds between two pairs (default 2; the cycle count rounds it down to whole cycles)
//   --midi-late D     the note lies D frames AFTER the impulse (a known constant MIDI offset for the Z1 positive control; offset + D must stay inside the cycle)
//   --wait-go         send nothing before a line "go" arrives on stdin; EOF on stdin ends the client (the caller owns the start of the series)
//   --linger S        stay alive S seconds after the last pair (default 0.5, never less than the time of --off-after plus 0.25 s so that the last note off is sent); a held note stays held for that long, then the client (and its MIDI port) goes
// The held-note variant (no --off-after) is the Z3 case of abnahme_rec5: the key is still down when the transport stops.
// PIPEWIRE_PROPS with node.group (group of the core, here "cypherdj") and node.lock-quantum is set by the caller (plan task 6 step 4).
// stdout: "ready: <audio port> <midi port>" once active, "sent <n> (offsets a,b,c)" at the end. Exit 0 sent all, 2 usage or no JACK.
#include <jack/jack.h>
#include <jack/midiport.h>

#include <algorithm>
#include <atomic>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <unistd.h>
#include <vector>

namespace {
constexpr int MAX_LISTE = 64, MAX_OFFEN = 64;
struct Aus { int64_t zeit; unsigned char ton; };   // a pending note off at an absolute frame
jack_client_t* g_c = nullptr;
jack_port_t *g_a = nullptr, *g_m = nullptr;
std::atomic<int> g_gesendet{0};
std::atomic<bool> g_los{true};
int g_ziel = 20, g_zaehler = 0, g_aus_nach = -1, g_spaet = 0;
int g_ofs[MAX_LISTE] = {100}, g_n_ofs = 1;
int g_ton[MAX_LISTE] = {60}, g_n_ton = 1;
double g_periode_s = 2.0, g_nachlauf_s = 0.5;
int64_t g_zeit = 0;      // absolute frame of the start of the current cycle (process callback only)
Aus g_offen[MAX_OFFEN];  // pending note offs (process callback only)
int g_n_offen = 0;
struct Ereignis { jack_nframes_t t; unsigned char b[3]; };

int process(jack_nframes_t n, void*) {
  float* a = static_cast<float*>(jack_port_get_buffer(g_a, n));
  void* m = jack_port_get_buffer(g_m, n);
  std::memset(a, 0, n * sizeof(float));
  jack_midi_clear_buffer(m);
  Ereignis ev[MAX_OFFEN + 1];
  int ne = 0;
  // note offs that fall into this cycle (first: an off at the frame of a new on must come before it)
  int rest = 0;
  for (int i = 0; i < g_n_offen; ++i) {
    if (g_offen[i].zeit < g_zeit + static_cast<int64_t>(n)) {
      if (ne < MAX_OFFEN) ev[ne++] = Ereignis{static_cast<jack_nframes_t>(std::max<int64_t>(0, g_offen[i].zeit - g_zeit)), {0x80, g_offen[i].ton, 0}};
    } else {
      g_offen[rest++] = g_offen[i];
    }
  }
  g_n_offen = rest;
  const int periode = static_cast<int>((g_periode_s * jack_get_sample_rate(g_c)) / n);
  const int gesendet = g_gesendet.load(std::memory_order_relaxed);
  if (g_los.load(std::memory_order_relaxed) && gesendet < g_ziel && periode > 0 && ++g_zaehler % periode == 0) {
    const int ofs = g_ofs[gesendet % g_n_ofs];
    const unsigned char ton = static_cast<unsigned char>(g_ton[gesendet % g_n_ton]);
    if (static_cast<int>(n) > ofs + g_spaet) {
      a[ofs] = 1.0f;
      if (ne < MAX_OFFEN) ev[ne++] = Ereignis{static_cast<jack_nframes_t>(ofs + g_spaet), {0x90, ton, 100}};
      if (g_aus_nach >= 0 && g_n_offen < MAX_OFFEN) g_offen[g_n_offen++] = Aus{g_zeit + ofs + g_spaet + g_aus_nach, ton};
      g_gesendet.fetch_add(1, std::memory_order_relaxed);
    }
  }
  std::stable_sort(ev, ev + ne, [](const Ereignis& x, const Ereignis& y) { return x.t < y.t; });
  for (int i = 0; i < ne; ++i) jack_midi_event_write(m, ev[i].t, ev[i].b, 3);
  g_zeit += n;
  return 0;
}

bool liste(const char* text, int* aus, int* n, int max, int von, int bis, const char* was) {
  *n = 0;
  std::string s(text);
  std::size_t i = 0;
  while (i <= s.size()) {
    const std::size_t k = s.find(',', i);
    const std::string teil = s.substr(i, k == std::string::npos ? std::string::npos : k - i);
    char* ende = nullptr;
    const long v = std::strtol(teil.c_str(), &ende, 10);
    if (teil.empty() || *ende != '\0' || v < von || v > bis || *n >= max) { std::fprintf(stderr, "%s: '%s' is not a list of integers %d..%d (at most %d)\n", was, text, von, bis, max); return false; }
    aus[(*n)++] = static_cast<int>(v);
    if (k == std::string::npos) break;
    i = k + 1;
  }
  return *n > 0;
}
}  // namespace

int main(int argc, char** argv) {
  bool warte_los = false, offsets_gesetzt = false;
  int pos = 0;
  for (int i = 1; i < argc; ++i) {
    const std::string a = argv[i];
    const bool wert = i + 1 < argc;
    if (a == "--offsets" && wert) { if (!liste(argv[++i], g_ofs, &g_n_ofs, MAX_LISTE, 0, 1 << 20, "--offsets")) return 2; offsets_gesetzt = true; }
    else if (a == "--pitches" && wert) { if (!liste(argv[++i], g_ton, &g_n_ton, MAX_LISTE, 0, 127, "--pitches")) return 2; }
    else if (a == "--off-after" && wert) { g_aus_nach = std::atoi(argv[++i]); if (g_aus_nach < 1) { std::fprintf(stderr, "--off-after: at least 1 frame\n"); return 2; } }
    else if (a == "--period" && wert) { g_periode_s = std::atof(argv[++i]); if (!(g_periode_s > 0.0)) { std::fprintf(stderr, "--period: seconds > 0\n"); return 2; } }
    else if (a == "--linger" && wert) { g_nachlauf_s = std::atof(argv[++i]); if (g_nachlauf_s < 0.0) { std::fprintf(stderr, "--linger: seconds >= 0\n"); return 2; } }
    else if (a == "--midi-late" && wert) { g_spaet = std::atoi(argv[++i]); if (g_spaet < 0) { std::fprintf(stderr, "--midi-late: frames >= 0\n"); return 2; } }
    else if (a == "--wait-go") warte_los = true;
    else if (a.rfind("--", 0) == 0) { std::fprintf(stderr, "unknown option %s\n", a.c_str()); return 2; }
    else if (pos == 0) { g_ziel = std::atoi(argv[i]); ++pos; }
    else if (pos == 1) { g_ofs[0] = std::atoi(argv[i]); g_n_ofs = 1; offsets_gesetzt = true; ++pos; }
    else { std::fprintf(stderr, "too many arguments\n"); return 2; }
  }
  (void)offsets_gesetzt;
  g_los.store(!warte_los);
  g_c = jack_client_open("cypherdj-pruef-ein", JackNullOption, nullptr);
  if (!g_c) { std::fprintf(stderr, "no JACK server\n"); return 2; }
  for (int i = 0; i < g_n_ofs; ++i)   // an offset outside the cycle would never be sent and the client would wait for ever
    if (g_ofs[i] + g_spaet >= static_cast<int>(jack_get_buffer_size(g_c))) { std::fprintf(stderr, "offset %d (+ %d) is not inside a cycle of %u frames\n", g_ofs[i], g_spaet, jack_get_buffer_size(g_c)); jack_client_close(g_c); return 2; }
  g_a = jack_port_register(g_c, "a_L", JACK_DEFAULT_AUDIO_TYPE, JackPortIsOutput, 0);
  g_m = jack_port_register(g_c, "m", JACK_DEFAULT_MIDI_TYPE, JackPortIsOutput, 0);
  jack_set_process_callback(g_c, process, nullptr);
  if (jack_activate(g_c) != 0) { std::fprintf(stderr, "jack_activate failed\n"); return 2; }
  std::printf("ready: %s %s\n", jack_port_name(g_a), jack_port_name(g_m));
  std::fflush(stdout);
  if (warte_los) {   // a line "go" starts the series; EOF without it ends the client
    char zeile[64];
    bool los = false;
    while (std::fgets(zeile, sizeof zeile, stdin)) if (std::strncmp(zeile, "go", 2) == 0) { los = true; break; }
    if (!los) { jack_client_close(g_c); return 0; }
    g_los.store(true);
  }
  while (g_gesendet.load() < g_ziel) usleep(100000);
  // the last note off lies K frames behind its on: the port must outlive it, whatever --linger says (found in the first full run: a client that left 50 ms
  // too early lost the last off of a series and the core counted 5 events instead of 6)
  const double mind = g_aus_nach >= 0 ? static_cast<double>(g_aus_nach) / jack_get_sample_rate(g_c) + 0.25 : 0.0;
  usleep(static_cast<useconds_t>(std::max(g_nachlauf_s, mind) * 1e6));
  std::string ofs;
  for (int i = 0; i < g_n_ofs; ++i) ofs += (i ? "," : "") + std::to_string(g_ofs[i]);
  std::printf("sent %d (offsets %s)\n", g_gesendet.load(), ofs.c_str());
  jack_client_close(g_c);
  return 0;
}
