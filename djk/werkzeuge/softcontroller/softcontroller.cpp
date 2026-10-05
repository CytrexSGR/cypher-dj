// Softcontroller (Scheibe 19): ein virtueller MIDI-Controller im Terminal. Er meldet sich wie ein USB-Controller als
// ALSA-Sequencer-Client an (Port "hand" zum Lesen, Port "led" zum Beschreiben); PipeWires Midi-Bridge macht daraus
// JACK-Ports (SCHNITTSTELLEN §7.1). Jede Taste sendet eine Nachricht aus tastatur.h, die im Mapping
// djk/konfig/controller/softcontroller.json steht; LED-Nachrichten am Port "led" zeigt er mit ihrem Namen (§7.4).
// Er verbindet selbst nichts (kein Ton, kein Riegel nötig) und sendet nichts, solange keine Taste kommt.
//
// Aufrufe:
//   softcontroller                          interaktiv (Terminal roh) oder Tasten von stdin (Pipe), Ende mit Q/ESC/EOF
//   softcontroller --mess N [--vorlauf-ms M] [--log datei]
//                                           Latenzprobe: nach M ms (Vorgabe 2000) N Mal CC 1/7 (deck/1/fader) mit
//                                           Wert i % 128, Pause 13 bis 47 ms (wie 09 Probe c), Sendezeit je Ereignis
//   Optionen: --mapping <datei> (für LED-Namen), --hilfe
//   CYPHERDJ_INSTANZ=b -> Client "cypherdj-softcontroller-b" (ROADMAP Z2)
#include <alsa/asoundlib.h>
#include <poll.h>
#include <signal.h>
#include <termios.h>
#include <unistd.h>

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <ctime>
#include <memory>
#include <string>

#include "hand/mapping.h"
#include "tastatur.h"

namespace {

termios alt_term;
bool term_roh = false;

void term_zurueck() {
  if (term_roh) tcsetattr(0, TCSANOW, &alt_term);
  term_roh = false;
}
void bei_signal(int s) {
  term_zurueck();
  signal(s, SIG_DFL);
  raise(s);
}

int64_t mono_us() {
  timespec ts;
  clock_gettime(CLOCK_MONOTONIC, &ts);
  return static_cast<int64_t>(ts.tv_sec) * 1000000 + ts.tv_nsec / 1000;
}

bool sende(snd_seq_t* seq, int port, const uint8_t* d) {
  snd_seq_event_t ev;
  snd_seq_ev_clear(&ev);
  snd_seq_ev_set_source(&ev, port);
  snd_seq_ev_set_subs(&ev);
  snd_seq_ev_set_direct(&ev);
  const int k = d[0] & 0x0F;
  switch (d[0] & 0xF0) {
    case 0xB0: snd_seq_ev_set_controller(&ev, k, d[1], d[2]); break;
    case 0x90: snd_seq_ev_set_noteon(&ev, k, d[1], d[2]); break;
    case 0x80: snd_seq_ev_set_noteoff(&ev, k, d[1], d[2]); break;
    default: return false;
  }
  return snd_seq_event_output_direct(seq, &ev) >= 0;
}

void hilfe() {
  std::printf("Tasten (Q oder ESC beendet, ? zeigt diese Liste):\n");
  for (const soft::Taste& t : soft::TASTEN)
    std::printf("  %c  %-24s %s %2d/%-3d\n", t.zeichen, t.ziel, t.note ? "note" : "cc  ", t.kanal, t.nr);
  std::fflush(stdout);
}

const char* led_name(const hand::Mapping* m, int typ, int kanal, int nr, int wert, const char** zustand) {
  if (!m) return nullptr;
  for (int i = 0; i < m->n_leds; i++) {
    const hand::Led& l = m->led[i];
    if (static_cast<int>(l.nachricht.typ) != typ || l.nachricht.kanal != kanal || l.nachricht.nr != nr) continue;
    *zustand = wert == l.an ? "an" : wert == l.blinkt ? "blinkt" : wert == l.aus ? "aus" : "anderer_wert";
    return l.name;
  }
  return nullptr;
}

// LED-Nachrichten am Port "led" lesen und zeigen
void led_lesen(snd_seq_t* seq, const hand::Mapping* m) {
  snd_seq_event_t* ev = nullptr;
  while (snd_seq_event_input_pending(seq, 1) > 0 && snd_seq_event_input(seq, &ev) >= 0 && ev) {
    int typ = -1, kanal = 0, nr = 0, wert = 0;
    if (ev->type == SND_SEQ_EVENT_NOTEON || ev->type == SND_SEQ_EVENT_NOTEOFF) {
      typ = 1;
      kanal = ev->data.note.channel + 1;
      nr = ev->data.note.note;
      wert = ev->type == SND_SEQ_EVENT_NOTEOFF ? 0 : ev->data.note.velocity;
    } else if (ev->type == SND_SEQ_EVENT_CONTROLLER) {
      typ = 0;
      kanal = ev->data.control.channel + 1;
      nr = static_cast<int>(ev->data.control.param);
      wert = ev->data.control.value;
    }
    if (typ < 0) continue;
    const char* zustand = "";
    const char* n = led_name(m, typ, kanal, nr, wert, &zustand);
    if (n) std::printf("LED %s %s\n", n, zustand);
    else std::printf("LED unbekannt %s %d/%d = %d\n", typ ? "note" : "cc", kanal, nr, wert);
    std::fflush(stdout);
  }
}

int messen(snd_seq_t* seq, int port, int n, int vorlauf_ms, const char* log) {
  FILE* f = log ? std::fopen(log, "w") : stdout;
  if (!f) {
    std::fprintf(stderr, "Log %s nicht schreibbar\n", log);
    return 1;
  }
  usleep(static_cast<useconds_t>(vorlauf_ms) * 1000);
  std::srand(9);
  int fehler = 0;
  for (int i = 0; i < n; i++) {
    const uint8_t d[3] = {0xB0, 7, static_cast<uint8_t>(i % 128)};
    const int64_t t = mono_us();
    if (!sende(seq, port, d)) fehler++;
    std::fprintf(f, "{\"typ\":\"gesendet\",\"i\":%d,\"t_send_us\":%lld,\"wert\":%d}\n", i, static_cast<long long>(t), i % 128);
    usleep(13000 + std::rand() % 34000);
  }
  std::fprintf(f, "{\"typ\":\"ende\",\"gesendet\":%d,\"sendefehler\":%d}\n", n, fehler);
  if (log) std::fclose(f);
  return fehler ? 1 : 0;
}

}  // namespace

int main(int argc, char** argv) {
  int mess = 0, vorlauf_ms = 2000;
  const char* log = nullptr;
  const char* mapping_pfad = SOFTCONTROLLER_MAPPING;
  for (int i = 1; i < argc; i++) {
    const std::string a = argv[i];
    if (a == "--mess" && i + 1 < argc) mess = std::atoi(argv[++i]);
    else if (a == "--vorlauf-ms" && i + 1 < argc) vorlauf_ms = std::atoi(argv[++i]);
    else if (a == "--log" && i + 1 < argc) log = argv[++i];
    else if (a == "--mapping" && i + 1 < argc) mapping_pfad = argv[++i];
    else {
      std::printf("Aufruf: softcontroller [--mess N [--vorlauf-ms M] [--log datei]] [--mapping datei]\n");
      hilfe();
      return a == "--hilfe" ? 0 : 2;
    }
  }

  // Mapping nur für die LED-Namen; fehlt es, zeigt er LEDs roh
  auto m = std::make_unique<hand::Mapping>();
  hand::Fehler fe;
  const stellwerk::ReglerTabelle tab;
  const bool mapping_ok = hand::lade_datei(mapping_pfad, tab, m.get(), &fe);
  if (!mapping_ok) std::fprintf(stderr, "Mapping %s: %s (LEDs ohne Namen)\n", mapping_pfad, fe.text);

  snd_seq_t* seq = nullptr;
  if (snd_seq_open(&seq, "default", SND_SEQ_OPEN_DUPLEX, SND_SEQ_NONBLOCK) < 0) {
    std::fprintf(stderr, "kein ALSA-Sequencer (/dev/snd/seq)\n");
    return 1;
  }
  std::string name = "cypherdj-softcontroller";
  if (const char* inst = std::getenv("CYPHERDJ_INSTANZ"); inst && *inst) name += std::string("-") + inst;
  snd_seq_set_client_name(seq, name.c_str());
  const int p_hand = snd_seq_create_simple_port(seq, "hand", SND_SEQ_PORT_CAP_READ | SND_SEQ_PORT_CAP_SUBS_READ,
                                                SND_SEQ_PORT_TYPE_MIDI_GENERIC | SND_SEQ_PORT_TYPE_APPLICATION);
  const int p_led = snd_seq_create_simple_port(seq, "led", SND_SEQ_PORT_CAP_WRITE | SND_SEQ_PORT_CAP_SUBS_WRITE,
                                               SND_SEQ_PORT_TYPE_MIDI_GENERIC | SND_SEQ_PORT_TYPE_APPLICATION);
  if (p_hand < 0 || p_led < 0) {
    std::fprintf(stderr, "Ports nicht angelegt\n");
    return 1;
  }
  std::fprintf(stderr, "softcontroller: ALSA-Client %d \"%s\", Ports hand=%d led=%d\n", snd_seq_client_id(seq),
               name.c_str(), p_hand, p_led);

  if (mess > 0) {
    const int rc = messen(seq, p_hand, mess, vorlauf_ms, log);
    snd_seq_close(seq);
    return rc;
  }

  if (isatty(0)) {
    tcgetattr(0, &alt_term);
    termios roh = alt_term;
    roh.c_lflag &= static_cast<tcflag_t>(~(ICANON | ECHO));
    roh.c_cc[VMIN] = 1;
    roh.c_cc[VTIME] = 0;
    tcsetattr(0, TCSANOW, &roh);
    term_roh = true;
    std::atexit(term_zurueck);
    signal(SIGINT, bei_signal);
    signal(SIGTERM, bei_signal);
    hilfe();
  }

  uint8_t stand[16][128];
  std::memset(stand, 0, sizeof stand);
  for (const soft::Taste& t : soft::TASTEN)
    if (!t.note) stand[t.kanal - 1][t.nr] = t.start;

  const int n_seq = snd_seq_poll_descriptors_count(seq, POLLIN);
  pollfd fds[16];
  fds[0] = {0, POLLIN, 0};
  snd_seq_poll_descriptors(seq, fds + 1, static_cast<unsigned>(n_seq > 15 ? 15 : n_seq), POLLIN);
  const int n_fds = 1 + (n_seq > 15 ? 15 : n_seq);
  long gesendet = 0;
  while (true) {
    if (poll(fds, static_cast<nfds_t>(n_fds), -1) < 0) break;
    for (int i = 1; i < n_fds; i++)
      if (fds[i].revents) led_lesen(seq, mapping_ok ? m.get() : nullptr);
    if (!(fds[0].revents & (POLLIN | POLLHUP))) continue;
    char c;
    if (read(0, &c, 1) != 1) break;   // EOF
    if (c == 'Q' || c == 27) break;
    if (c == '?') {
      hilfe();
      continue;
    }
    const soft::Taste* t = soft::finde(c);
    if (!t) continue;   // Zeilenende und fremde Zeichen senden nichts
    const soft::Bytes b = soft::bytes_fuer(*t, &stand[t->kanal - 1][t->nr]);
    for (int j = 0; j < b.n; j++) gesendet += sende(seq, p_hand, b.d[j]);
    std::printf("%c  %-24s %s %d/%d = %d\n", c, t->ziel, t->note ? "note" : "cc", t->kanal, t->nr, b.d[0][2]);
    std::fflush(stdout);
  }
  term_zurueck();
  std::fprintf(stderr, "softcontroller: %ld Nachrichten gesendet\n", gesendet);
  snd_seq_close(seq);
  return 0;
}
