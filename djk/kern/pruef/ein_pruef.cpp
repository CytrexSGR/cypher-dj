// I08 Task 6: Prüf-Client "cypherdj-pruef-ein". Alle 2 s im SELBEN JACK-Zyklus und am SELBEN Frame-Versatz ein Impuls (Audio a_L = 1,0)
// und eine Note (MIDI 0x90 60 100). Aufruf: cypherdj-pruef-ein <Anzahl Paare> [Versatz]. Nur Messung.
// PIPEWIRE_PROPS mit node.group (Gruppe des Kerns, hier "cypherdj") und node.lock-quantum setzt der Aufrufer (Plan Task 6 Step 4).
#include <jack/jack.h>
#include <jack/midiport.h>

#include <atomic>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <unistd.h>

static jack_client_t* g_c = nullptr;
static jack_port_t *g_a = nullptr, *g_m = nullptr;
static std::atomic<int> g_gesendet{0};
static int g_ofs = 100, g_ziel = 20, g_zaehler = 0;

static int process(jack_nframes_t n, void*) {
  float* a = static_cast<float*>(jack_port_get_buffer(g_a, n));
  void* m = jack_port_get_buffer(g_m, n);
  std::memset(a, 0, n * sizeof(float));
  jack_midi_clear_buffer(m);
  const int periode = static_cast<int>((2u * jack_get_sample_rate(g_c)) / n);  // alle 2 s
  if (g_gesendet.load(std::memory_order_relaxed) < g_ziel && periode > 0 && ++g_zaehler % periode == 0 &&
      static_cast<int>(n) > g_ofs) {
    a[g_ofs] = 1.0f;
    const unsigned char on[3] = {0x90, 60, 100};
    jack_midi_event_write(m, static_cast<jack_nframes_t>(g_ofs), on, 3);
    g_gesendet.fetch_add(1, std::memory_order_relaxed);
  }
  return 0;
}

int main(int argc, char** argv) {
  if (argc > 1) g_ziel = std::atoi(argv[1]);
  if (argc > 2) g_ofs = std::atoi(argv[2]);
  g_c = jack_client_open("cypherdj-pruef-ein", JackNullOption, nullptr);
  if (!g_c) { std::fprintf(stderr, "kein JACK-Server\n"); return 2; }
  g_a = jack_port_register(g_c, "a_L", JACK_DEFAULT_AUDIO_TYPE, JackPortIsOutput, 0);
  g_m = jack_port_register(g_c, "m", JACK_DEFAULT_MIDI_TYPE, JackPortIsOutput, 0);
  jack_set_process_callback(g_c, process, nullptr);
  if (jack_activate(g_c) != 0) { std::fprintf(stderr, "jack_activate gescheitert\n"); return 2; }
  std::printf("bereit: %s %s\n", jack_port_name(g_a), jack_port_name(g_m));
  std::fflush(stdout);
  while (g_gesendet.load() < g_ziel) usleep(100000);
  usleep(500000);
  std::printf("gesendet %d (Versatz %d)\n", g_gesendet.load(), g_ofs);
  jack_client_close(g_c);
  return 0;
}
