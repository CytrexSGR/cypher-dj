// cypherdj-aufnehmer: JACK-Aufnehmer am Ziel (SCHNITTSTELLEN.md §19.5, nie pw-record: 01 §4.4). Nimmt zwei Ports auf,
// schreibt WAV (float32) und daneben <datei>.json mit dem Blockanfang des ersten aufgenommenen Frames (mono_ns wie /uhr),
// damit die Auswertung jedes Aufnahme-Frame einem Kern-Sample zuordnen kann. Zählt eigene Lücken und Ring-Überläufe.
// Vorlage: proben/01-audio-kern/a-cpp-jack/aufnehmer.cpp.
// Aufruf: pw-jack -p 256 cypherdj-aufnehmer --quelle <präfix> --datei <x.wav> --sekunden <s> [--bereit <datei>]
// Der Präfix bekommt L und R angehängt, z. B. cypherdj-pruef-a-1:monitor_F.
// Gruppe: wie Kern und Notbahn node.group = "cypherdj-<i>". Ohne eigene Gruppe setzt pipewire-jack jeden JACK-Client in
// "group.dsp.0"; dort teilen sich alle JACK-Clients aller Sessions einen Treiber, und die eigene Senke lief in der
// Planungsprobe in 3 von 8 Läufen als Follower eines fremden Treibers (Versatz 256 statt 512, Sprung beim Wechsel).
#include <jack/jack.h>
#include <jack/ringbuffer.h>
#include <sndfile.h>
#include <unistd.h>

#include <atomic>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include "cypherdj/instanz.h"

static jack_client_t* c;
static jack_port_t* ein[2];
static jack_ringbuffer_t* rb;
static std::atomic<uint64_t> ueberlauf{0}, luecken{0};
static std::atomic<int64_t> erster_mono_ns{0};
static std::atomic<uint32_t> erster_frame{0};
static std::atomic<bool> aktiv{false};
static jack_nframes_t letzt = 0, letzt_n = 0;
static bool erster = true;
static uint64_t rt_frames = 0;                      // aufgenommene Frames, nur im Callback
static uint64_t luecke_bei[16], luecke_frames[16];  // wo in der WAV und wie viele Graph-Frames fehlen

static int process(jack_nframes_t n, void*) {
  jack_nframes_t cf;
  jack_time_t cu, nu;
  float per;
  jack_get_cycle_times(c, &cf, &cu, &nu, &per);
  if (!erster && aktiv.load(std::memory_order_relaxed) && cf - letzt != letzt_n) {
    const uint64_t k = luecken.fetch_add(1);
    if (k < 16) { luecke_bei[k] = rt_frames; luecke_frames[k] = (uint64_t)(cf - letzt - letzt_n); }
  }
  erster = false;
  letzt = cf;
  letzt_n = n;
  if (!aktiv.load(std::memory_order_relaxed)) return 0;
  const float* a = (const float*)jack_port_get_buffer(ein[0], n);
  const float* b = (const float*)jack_port_get_buffer(ein[1], n);
  if (jack_ringbuffer_write_space(rb) < n * 2 * sizeof(float)) { ueberlauf++; return 0; }
  for (jack_nframes_t i = 0; i < n; ++i) {
    const float s[2] = {a[i], b[i]};
    jack_ringbuffer_write(rb, (const char*)s, sizeof s);
  }
  rt_frames += n;
  if (erster_mono_ns.load(std::memory_order_relaxed) == 0) {
    erster_frame.store(cf, std::memory_order_relaxed);
    erster_mono_ns.store((int64_t)cu * 1000, std::memory_order_release);
  }
  return 0;
}

int main(int argc, char** argv) {
  std::string quelle, datei, bereit;
  double sek = 0;
  for (int i = 1; i + 1 < argc; i += 2) {
    if (!std::strcmp(argv[i], "--quelle")) quelle = argv[i + 1];
    else if (!std::strcmp(argv[i], "--datei")) datei = argv[i + 1];
    else if (!std::strcmp(argv[i], "--sekunden")) sek = std::atof(argv[i + 1]);
    else if (!std::strcmp(argv[i], "--bereit")) bereit = argv[i + 1];
  }
  const char* inst = cdj_instanz();
  if (quelle.empty() || datei.empty() || sek <= 0 || cdj_instanz_k(inst) < 0) {
    std::fprintf(stderr, "Aufruf: cypherdj-aufnehmer --quelle <präfix> --datei <x.wav> --sekunden <s> [--bereit <datei>]\n");
    return 2;
  }
  char name[64], gruppe[64], props[160];
  cdj_name(name, sizeof name, "cypherdj-aufnehmer", inst);
  cdj_name(gruppe, sizeof gruppe, "cypherdj", inst);
  std::snprintf(props, sizeof props, "{ node.group = \"%s\" node.lock-quantum = true }", gruppe);
  setenv("PIPEWIRE_PROPS", props, 1);
  jack_status_t st;
  c = jack_client_open(name, JackNoStartServer, &st);
  if (!c) { std::fprintf(stderr, "kein JACK-Server (pw-jack?)\n"); return 1; }
  ein[0] = jack_port_register(c, "in_L", JACK_DEFAULT_AUDIO_TYPE, JackPortIsInput, 0);
  ein[1] = jack_port_register(c, "in_R", JACK_DEFAULT_AUDIO_TYPE, JackPortIsInput, 0);
  rb = jack_ringbuffer_create(48000 * 2 * sizeof(float) * 4);
  jack_ringbuffer_mlock(rb);
  jack_set_process_callback(c, process, nullptr);
  if (jack_activate(c)) return 1;
  const int r1 = jack_connect(c, (quelle + "L").c_str(), jack_port_name(ein[0]));
  const int r2 = jack_connect(c, (quelle + "R").c_str(), jack_port_name(ein[1]));
  if (r1 || r2) { std::fprintf(stderr, "Verbinden mit %sL/R gescheitert (%d/%d)\n", quelle.c_str(), r1, r2); return 1; }
  SF_INFO info{};
  info.samplerate = (int)jack_get_sample_rate(c);
  info.channels = 2;
  info.format = SF_FORMAT_WAV | SF_FORMAT_FLOAT;
  SNDFILE* sf = sf_open(datei.c_str(), SFM_WRITE, &info);
  if (!sf) { std::fprintf(stderr, "%s: %s\n", datei.c_str(), sf_strerror(nullptr)); return 1; }
  usleep(200000);
  aktiv = true;
  while (erster_mono_ns.load(std::memory_order_acquire) == 0) usleep(1000);
  if (!bereit.empty()) {
    FILE* f = std::fopen(bereit.c_str(), "w");
    if (f) { std::fprintf(f, "%lld\n", (long long)erster_mono_ns.load()); std::fclose(f); }
  }
  std::vector<float> buf(4096 * 2);
  uint64_t geschrieben = 0;
  const uint64_t ziel = (uint64_t)(sek * info.samplerate);
  while (geschrieben < ziel) {
    size_t verf = jack_ringbuffer_read_space(rb) / (2 * sizeof(float));
    if (verf == 0) { usleep(2000); continue; }
    size_t n = std::min<size_t>(std::min<size_t>(verf, 4096), (size_t)(ziel - geschrieben));
    jack_ringbuffer_read(rb, (char*)buf.data(), n * 2 * sizeof(float));
    sf_writef_float(sf, buf.data(), (sf_count_t)n);
    geschrieben += n;
  }
  aktiv = false;
  const uint32_t quantum = jack_get_buffer_size(c);
  jack_deactivate(c);
  sf_close(sf);
  jack_client_close(c);
  std::string bei = "[";
  for (uint64_t k = 0; k < luecken.load() && k < 16; ++k)
    bei += (k ? ",[" : "[") + std::to_string(luecke_bei[k]) + "," + std::to_string(luecke_frames[k]) + "]";
  bei += "]";
  FILE* j = std::fopen((datei + ".json").c_str(), "w");
  std::fprintf(j,
               "{\"erster_mono_ns\":%lld,\"erster_jack_frame\":%u,\"frames\":%llu,\"luecken\":%llu,"
               "\"luecken_bei\":%s,\"ueberlauf\":%llu,\"quantum\":%u,\"quelle\":\"%s\"}\n",
               (long long)erster_mono_ns.load(), erster_frame.load(), (unsigned long long)geschrieben,
               (unsigned long long)luecken.load(), bei.c_str(), (unsigned long long)ueberlauf.load(), quantum,
               quelle.c_str());
  std::fclose(j);
  std::fprintf(stderr, "Aufnahme %s: %llu Frames, %llu Lücken, %llu Überläufe\n", datei.c_str(),
               (unsigned long long)geschrieben, (unsigned long long)luecken.load(), (unsigned long long)ueberlauf.load());
  return 0;
}
