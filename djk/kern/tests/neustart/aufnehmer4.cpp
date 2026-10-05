// cypherdj-aufnehmer4: JACK-Aufnehmer am Ziel mit vier Kanälen (Master L/R, Cue L/R) für die Abschuss-Serien der
// Scheibe 18 (SCHNITTSTELLEN §19.5: JACK-Aufnehmer, nie pw-record). Vorlage: djk/pruefstand/aufnehmer/aufnehmer.cpp
// (Scheibe 01), hier mit vier Ports und roher float32-Datei. Neben die Datei schreibt er <datei>.json mit Treiber-Frame
// und CLOCK_MONOTONIC des ersten Frames, damit die Auswertung Kern-Zeit und Aufnahme verbindet, dazu je Lücke des Graphen
// (Treiber-Frame springt) die Stelle in der Datei und die Zahl der fehlenden Frames (höchstens 16).
// Aufruf: pw-jack -p 256 cypherdj-aufnehmer4 --quelle <senke> --datei <x.f32> --sekunden <s> [--bereit <datei>]
// Verbunden wird <senke>:monitor_FL, _FR, _RL, _RR.
#include <jack/jack.h>
#include <jack/ringbuffer.h>
#include <unistd.h>

#include <atomic>
#include <csignal>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

static jack_client_t* c;
static jack_port_t* ein[4];
static jack_ringbuffer_t* rb;
static std::atomic<uint64_t> ueberlauf{0}, luecken{0};
static std::atomic<int64_t> erster_mono_ns{0};
static std::atomic<uint32_t> erster_frame{0};
static std::atomic<bool> aktiv{false};
static volatile sig_atomic_t stop = 0;
static jack_nframes_t letzt = 0, letzt_n = 0;
static bool erster = true;
static uint64_t rt_frames = 0;
static uint64_t luecke_bei[16], luecke_frames[16];  // wo in der Datei und wie viele Treiber-Frames fehlen (Vorlage 01)

static int process(jack_nframes_t n, void*) {
  jack_nframes_t cf;
  jack_time_t cu, nu;
  float per;
  jack_get_cycle_times(c, &cf, &cu, &nu, &per);
  if (!erster && aktiv.load(std::memory_order_relaxed) && cf - letzt != letzt_n) {
    const uint64_t k = luecken.fetch_add(1);
    if (k < 16) {
      luecke_bei[k] = rt_frames;
      luecke_frames[k] = static_cast<uint64_t>(static_cast<int64_t>(static_cast<int32_t>(cf - letzt - letzt_n)));
    }
  }
  erster = false;
  letzt = cf;
  letzt_n = n;
  if (!aktiv.load(std::memory_order_relaxed)) return 0;
  const float* p[4];
  for (int k = 0; k < 4; ++k) p[k] = static_cast<const float*>(jack_port_get_buffer(ein[k], n));
  if (jack_ringbuffer_write_space(rb) < n * 4 * sizeof(float)) {
    ueberlauf.fetch_add(1);
    return 0;
  }
  for (jack_nframes_t i = 0; i < n; ++i) {
    const float s[4] = {p[0][i], p[1][i], p[2][i], p[3][i]};
    jack_ringbuffer_write(rb, reinterpret_cast<const char*>(s), sizeof s);
  }
  if (rt_frames == 0) {
    erster_frame.store(cf, std::memory_order_relaxed);
    erster_mono_ns.store(static_cast<int64_t>(cu) * 1000, std::memory_order_release);
  }
  rt_frames += n;
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
  if (quelle.empty() || datei.empty() || sek <= 0) {
    std::fprintf(stderr, "Aufruf: cypherdj-aufnehmer4 --quelle <senke> --datei <x.f32> --sekunden <s> [--bereit <d>]\n");
    return 2;
  }
  std::signal(SIGTERM, [](int) { stop = 1; });
  std::signal(SIGINT, [](int) { stop = 1; });
  const char* inst = std::getenv("CYPHERDJ_INSTANZ");
  const std::string name = std::string("cypherdj-aufnehmer4") + (inst && *inst ? std::string("-") + inst : "");
  jack_status_t st;
  c = jack_client_open(name.c_str(), JackNoStartServer, &st);
  if (!c) {
    std::fprintf(stderr, "kein JACK-Server (pw-jack?)\n");
    return 1;
  }
  const char* pn[4] = {"in_1", "in_2", "in_3", "in_4"};
  for (int k = 0; k < 4; ++k) ein[k] = jack_port_register(c, pn[k], JACK_DEFAULT_AUDIO_TYPE, JackPortIsInput, 0);
  rb = jack_ringbuffer_create(48000 * 4 * sizeof(float) * 4);
  jack_ringbuffer_mlock(rb);
  jack_set_process_callback(c, process, nullptr);
  if (jack_activate(c)) return 1;
  const char* suf[4] = {"monitor_FL", "monitor_FR", "monitor_RL", "monitor_RR"};
  for (int k = 0; k < 4; ++k) {
    const std::string q = quelle + ":" + suf[k];
    if (jack_connect(c, q.c_str(), jack_port_name(ein[k]))) {
      std::fprintf(stderr, "Verbinden mit %s gescheitert\n", q.c_str());
      return 1;
    }
  }
  FILE* f = std::fopen(datei.c_str(), "wb");
  if (!f) return 1;
  usleep(100000);
  aktiv = true;
  while (erster_mono_ns.load(std::memory_order_acquire) == 0 && !stop) usleep(1000);
  if (!bereit.empty()) {
    FILE* b = std::fopen(bereit.c_str(), "w");
    if (b) {
      std::fprintf(b, "%lld\n", static_cast<long long>(erster_mono_ns.load()));
      std::fclose(b);
    }
  }
  std::vector<float> buf(4096 * 4);
  uint64_t geschrieben = 0;
  const uint64_t ziel = static_cast<uint64_t>(sek * 48000.0);
  while (geschrieben < ziel && !stop) {
    const size_t verf = jack_ringbuffer_read_space(rb) / (4 * sizeof(float));
    if (verf == 0) {
      usleep(2000);
      continue;
    }
    size_t n = verf < 4096 ? verf : 4096;
    if (n > ziel - geschrieben) n = static_cast<size_t>(ziel - geschrieben);
    jack_ringbuffer_read(rb, reinterpret_cast<char*>(buf.data()), n * 4 * sizeof(float));
    std::fwrite(buf.data(), sizeof(float) * 4, n, f);
    geschrieben += n;
  }
  aktiv = false;
  const uint32_t quantum = jack_get_buffer_size(c);
  jack_deactivate(c);
  jack_client_close(c);
  std::fclose(f);
  std::string bei = "[";
  for (uint64_t k = 0; k < luecken.load() && k < 16; ++k)
    bei += (k ? ",[" : "[") + std::to_string(luecke_bei[k]) + "," +
           std::to_string(static_cast<int64_t>(luecke_frames[k])) + "]";
  bei += "]";
  FILE* j = std::fopen((datei + ".json").c_str(), "w");
  std::fprintf(j,
               "{\"erster_mono_ns\":%lld,\"erster_jack_frame\":%u,\"frames\":%llu,\"luecken\":%llu,\"luecken_bei\":%s,"
               "\"ueberlauf\":%llu,\"quantum\":%u,\"quelle\":\"%s\"}\n",
               static_cast<long long>(erster_mono_ns.load()), erster_frame.load(),
               static_cast<unsigned long long>(geschrieben), static_cast<unsigned long long>(luecken.load()), bei.c_str(),
               static_cast<unsigned long long>(ueberlauf.load()), quantum, quelle.c_str());
  std::fclose(j);
  std::fprintf(stderr, "aufnahme %s: %llu Frames, %llu Lücken, %llu Überläufe\n", datei.c_str(),
               static_cast<unsigned long long>(geschrieben), static_cast<unsigned long long>(luecken.load()),
               static_cast<unsigned long long>(ueberlauf.load()));
  return 0;
}
