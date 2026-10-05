// hand_pruef (Scheibe 19): JACK-MIDI-Prüfclient für den Hand-Weg. Er tut im Kleinen, was der Kern (Scheibe 35) am
// Eingang cypherdj-kern:hand_in tut: jedes MIDI-Ereignis im Prozess-Callback durch die Hand-Bibliothek übersetzen,
// mit Kern-Sample = Frame-Zeit des Zyklus plus Versatz (SCHNITTSTELLEN §7.3 Punkt 1). Je Ereignis protokolliert er
// Frame-Zeit und Mikrosekunden des Zyklusanfangs, Versatz, Blocklänge, Bytes und das Sample, das die Bibliothek
// liefert; auswertung.py stellt das gegen die Sendezeiten des Softcontrollers. Kein Audio-Port.
//
// Aufruf (unter pw-jack; Quantum 256 mit pw-jack -p 256):
//   hand_pruef --mapping <json> --quelle <muster> --sekunden S [--anzahl N] [--log datei]
//              [--led name:zustand --led-ziel <muster>]
// --quelle/--led-ziel: Teilzeichenkette des JACK-Portnamens (jack_get_ports-Muster). Riegel wie SCHNITTSTELLEN §8:
// verbunden wird nur mit Ports, deren Name "cypherdj-softcontroller" enthält, sonst Abbruch mit Rückgabe 3.
// CYPHERDJ_INSTANZ=b -> Client "cypherdj-hand-pruef-b" (ROADMAP Z2).
#include <jack/jack.h>
#include <jack/midiport.h>
#include <jack/ringbuffer.h>
#include <unistd.h>

#include <atomic>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <ctime>
#include <memory>
#include <string>

#include "hand/led.h"
#include "hand/mapping.h"
#include "hand/uebersetzer.h"

namespace {

struct Satz {
  int64_t cf;        // Frame-Zeit des Zyklusanfangs (= Kern-Sample des Blockanfangs in dieser Probe)
  int64_t cu, nu;    // Mikrosekunden (CLOCK_MONOTONIC) dieses und des nächsten Zyklusanfangs
  uint32_t n;        // Blocklänge
  uint32_t versatz;  // jack_midi_event_t::time
  uint8_t bytes[3];
  uint8_t groesse;
  int8_t aus;        // Rückgabe von Uebersetzer::ereignis
  int64_t sample;    // Ausgabe::sample
  hand::AusgabeArt art;
  int16_t eintrag;
  int32_t wert;
};

jack_client_t* cl = nullptr;
jack_port_t* ein = nullptr;
jack_port_t* led_aus = nullptr;
jack_ringbuffer_t* rb = nullptr;
hand::Uebersetzer* ueb = nullptr;
std::atomic<long> verloren{0};
std::atomic<int> led_senden{0};
uint8_t led_bytes[3];

int prozess(jack_nframes_t n, void*) {
  void* lb = jack_port_get_buffer(led_aus, n);
  jack_midi_clear_buffer(lb);
  if (led_senden.load(std::memory_order_acquire) == 1) {
    jack_midi_event_write(lb, 0, led_bytes, 3);
    led_senden.store(2, std::memory_order_release);
  }
  void* b = jack_port_get_buffer(ein, n);
  const uint32_t k = jack_midi_get_event_count(b);
  if (!k) return 0;
  jack_nframes_t cf;
  jack_time_t cu, nu;
  float pu;
  jack_get_cycle_times(cl, &cf, &cu, &nu, &pu);
  for (uint32_t i = 0; i < k; i++) {
    jack_midi_event_t e;
    if (jack_midi_event_get(&e, b, i)) continue;
    Satz s{};
    s.cf = cf;
    s.cu = static_cast<int64_t>(cu);
    s.nu = static_cast<int64_t>(nu);
    s.n = n;
    s.versatz = e.time;
    s.groesse = static_cast<uint8_t>(e.size > 255 ? 255 : e.size);
    for (size_t j = 0; j < 3 && j < e.size; j++) s.bytes[j] = e.buffer[j];
    hand::Ausgabe a{};
    s.aus = static_cast<int8_t>(ueb->ereignis(e.buffer, e.size, cf, e.time, n, &a));
    s.sample = a.sample;
    s.art = a.art;
    s.eintrag = s.aus ? a.eintrag : -1;
    s.wert = a.wert;
    if (jack_ringbuffer_write_space(rb) >= sizeof s) jack_ringbuffer_write(rb, reinterpret_cast<const char*>(&s), sizeof s);
    else verloren++;
  }
  return 0;
}

int64_t mono_us() {
  timespec ts;
  clock_gettime(CLOCK_MONOTONIC, &ts);
  return static_cast<int64_t>(ts.tv_sec) * 1000000 + ts.tv_nsec / 1000;
}

// Ersten passenden Port suchen, bis zu `sekunden` lang; leer, wenn keiner kommt
std::string warte_auf_port(const char* muster, unsigned long flags, double sekunden) {
  const int64_t ende = mono_us() + static_cast<int64_t>(sekunden * 1e6);
  while (mono_us() < ende) {
    const char** ps = jack_get_ports(cl, muster, JACK_DEFAULT_MIDI_TYPE, flags);
    std::string p = ps && ps[0] ? ps[0] : "";
    if (ps) jack_free(ps);
    if (!p.empty()) return p;
    usleep(50000);
  }
  return "";
}

bool riegel_ok(const std::string& port) { return port.find("cypherdj-softcontroller") != std::string::npos; }

}  // namespace

int main(int argc, char** argv) {
  const char *mapping = nullptr, *quelle = nullptr, *log = nullptr, *led = nullptr, *led_ziel = nullptr;
  double sekunden = 20;
  long anzahl = 0;
  for (int i = 1; i + 1 < argc; i += 2) {
    const std::string a = argv[i];
    if (a == "--mapping") mapping = argv[i + 1];
    else if (a == "--quelle") quelle = argv[i + 1];
    else if (a == "--sekunden") sekunden = std::atof(argv[i + 1]);
    else if (a == "--anzahl") anzahl = std::atol(argv[i + 1]);
    else if (a == "--log") log = argv[i + 1];
    else if (a == "--led") led = argv[i + 1];
    else if (a == "--led-ziel") led_ziel = argv[i + 1];
  }
  if (!mapping || !quelle) {
    std::fprintf(stderr, "Aufruf: hand_pruef --mapping <json> --quelle <muster> --sekunden S [--anzahl N] [--log datei] "
                         "[--led name:zustand --led-ziel <muster>]\n");
    return 2;
  }
  auto m = std::make_unique<hand::Mapping>();
  hand::Fehler fe;
  if (!hand::lade_datei(mapping, stellwerk::ReglerTabelle(), m.get(), &fe)) {
    std::fprintf(stderr, "Mapping %s: %s\n", mapping, fe.text);
    return 2;
  }
  hand::Uebersetzer u(m.get());
  ueb = &u;
  if (led) {
    std::string l = led;
    const size_t p = l.find(':');
    const int z = p == std::string::npos ? -1 : std::atoi(l.c_str() + p + 1);
    if (!led_ziel || p == std::string::npos || hand::led_nachricht(*m, l.substr(0, p).c_str(), z, led_bytes) != 3) {
      std::fprintf(stderr, "--led %s: LED unbekannt oder Zustand ungültig, oder --led-ziel fehlt\n", led);
      return 2;
    }
  }
  FILE* f = log ? std::fopen(log, "w") : stdout;
  if (!f) return 2;

  std::string name = "cypherdj-hand-pruef";
  if (const char* inst = std::getenv("CYPHERDJ_INSTANZ"); inst && *inst) name += std::string("-") + inst;
  jack_status_t st;
  cl = jack_client_open(name.c_str(), JackNoStartServer, &st);
  if (!cl) {
    std::fprintf(stderr, "kein JACK (pw-jack?), status %d\n", static_cast<int>(st));
    return 1;
  }
  ein = jack_port_register(cl, "hand_in", JACK_DEFAULT_MIDI_TYPE, JackPortIsInput, 0);
  led_aus = jack_port_register(cl, "hand_led", JACK_DEFAULT_MIDI_TYPE, JackPortIsOutput, 0);
  rb = jack_ringbuffer_create(sizeof(Satz) * 8192);
  jack_set_process_callback(cl, prozess, nullptr);
  if (jack_activate(cl)) {
    std::fprintf(stderr, "activate fehlgeschlagen\n");
    return 1;
  }
  // Instrument-Kontrolle: JACK-Zeit gegen CLOCK_MONOTONIC (unter pipewire-jack dieselbe Uhr, 09 Probe c: 0 µs)
  int64_t d_min = INT64_MAX, d_max = INT64_MIN;
  for (int i = 0; i < 5; i++) {
    const int64_t a = mono_us(), j = static_cast<int64_t>(jack_get_time()), b = mono_us();
    const int64_t d = j - (a + b) / 2;
    d_min = d < d_min ? d : d_min;
    d_max = d > d_max ? d : d_max;
  }
  std::fprintf(f, "{\"typ\":\"uhrvergleich\",\"jack_minus_mono_us_min\":%lld,\"max\":%lld,\"sr\":%u,\"puffer\":%u,\"client\":\"%s\"}\n",
               static_cast<long long>(d_min), static_cast<long long>(d_max), jack_get_sample_rate(cl),
               jack_get_buffer_size(cl), jack_get_client_name(cl));
  const std::string q = warte_auf_port(quelle, JackPortIsOutput, 10.0);
  if (q.empty() || !riegel_ok(q)) {
    std::fprintf(stderr, "Quelle \"%s\" %s\n", quelle, q.empty() ? "nicht gefunden" : ("vom Riegel abgelehnt: " + q).c_str());
    jack_client_close(cl);
    return q.empty() ? 1 : 3;
  }
  const int rc = jack_connect(cl, q.c_str(), jack_port_name(ein));
  std::fprintf(f, "{\"typ\":\"verbunden\",\"quelle\":\"%s\",\"rc\":%d,\"t_us\":%lld}\n", q.c_str(), rc,
               static_cast<long long>(mono_us()));
  std::fflush(f);
  if (led) {
    const std::string z = warte_auf_port(led_ziel, JackPortIsInput, 10.0);
    if (z.empty() || !riegel_ok(z)) {
      std::fprintf(stderr, "LED-Ziel \"%s\" nicht gefunden oder vom Riegel abgelehnt\n", led_ziel);
      jack_client_close(cl);
      return z.empty() ? 1 : 3;
    }
    const int r2 = jack_connect(cl, jack_port_name(led_aus), z.c_str());
    usleep(300000);
    led_senden.store(1, std::memory_order_release);
    std::fprintf(f, "{\"typ\":\"led\",\"ziel\":\"%s\",\"rc\":%d,\"bytes\":[%d,%d,%d]}\n", z.c_str(), r2, led_bytes[0],
                 led_bytes[1], led_bytes[2]);
  }

  const int64_t ende = mono_us() + static_cast<int64_t>(sekunden * 1e6);
  long gelesen = 0, ausgaben = 0;
  auto leeren = [&]() {
    Satz s;
    while (jack_ringbuffer_read_space(rb) >= sizeof s) {
      jack_ringbuffer_read(rb, reinterpret_cast<char*>(&s), sizeof s);
      gelesen++;
      ausgaben += s.aus;
      std::fprintf(f,
                   "{\"typ\":\"ereignis\",\"cf\":%lld,\"cu\":%lld,\"nu\":%lld,\"n\":%u,\"versatz\":%u,\"groesse\":%u,"
                   "\"bytes\":[%u,%u,%u],\"aus\":%d,\"sample\":%lld,\"art\":\"%s\",\"ziel\":\"%s\",\"wert\":%d}\n",
                   static_cast<long long>(s.cf), static_cast<long long>(s.cu), static_cast<long long>(s.nu), s.n,
                   s.versatz, s.groesse, s.bytes[0], s.bytes[1], s.bytes[2], s.aus,
                   static_cast<long long>(s.aus ? s.sample : -1), s.aus ? hand::name(s.art) : "",
                   s.eintrag >= 0 ? m->eintrag[s.eintrag].ziel : "", s.aus ? s.wert : 0);
    }
  };
  while (mono_us() < ende && !(anzahl > 0 && ausgaben >= anzahl)) {
    leeren();
    usleep(2000);
  }
  jack_deactivate(cl);
  leeren();
  const hand::UebersetzerZaehler& z = u.zaehler();
  std::fprintf(f,
               "{\"typ\":\"ende\",\"ereignisse\":%llu,\"ausgaben\":%llu,\"unbekannt\":%llu,\"ignoriert\":%llu,"
               "\"protokolliert\":%ld,\"verloren\":%ld,\"led_gesendet\":%d}\n",
               static_cast<unsigned long long>(z.ereignisse), static_cast<unsigned long long>(z.ausgaben),
               static_cast<unsigned long long>(z.unbekannt), static_cast<unsigned long long>(z.ignoriert), gelesen,
               verloren.load(), led_senden.load() == 2 ? 1 : 0);
  if (log) std::fclose(f);
  jack_client_close(cl);
  jack_ringbuffer_free(rb);
  std::printf("hand_pruef: %llu Ereignisse, %llu Ausgaben, %ld verloren\n", static_cast<unsigned long long>(z.ereignisse),
              static_cast<unsigned long long>(z.ausgaben), verloren.load());
  return 0;
}
