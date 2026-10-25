// I08 Gesamtreview Teil A (m1, M1): Verdrahtung von cypherdj-latenz. Braucht einen JACK-Server (läuft unter `pw-jack`); ohne Server Ende 77 (ctest: SKIP).
// Aufruf: latenz_verdrahtung <cypherdj-latenz>
// (a) Ein Port, den es unter JACK nicht gibt (die node.name-Form eines ALSA-Geräts), wird mit Ende-Code 2 und klarer Meldung abgewiesen.
// (b) Hält ein anderer Client schon den Namen "cypherdj-latenz", heißt der Messclient anders (pipewire-jack hängt eine Zahl an); er muss trotzdem
//     SEINE Ports verbinden: Halter:in <- Messclient:out und Messclient:in <- Halter:out. Mit dem fest geschriebenen Namen verdrahtet er stattdessen die Ports des Halters
//     untereinander (Halter:out -> Halter:in) und verbindet den fremden Port.
#include <jack/jack.h>

#include <chrono>
#include <csignal>
#include <fcntl.h>
#include <cstdio>
#include <cstring>
#include <string>
#include <sys/wait.h>
#include <thread>
#include <unistd.h>

static int process(jack_nframes_t, void*) { return 0; }

static pid_t starte(const char* bin, const char* a, const char* b) {
  const pid_t p = fork();
  if (p == 0) {
    int null = open("/dev/null", O_WRONLY);
    if (null >= 0) { dup2(null, 1); dup2(null, 2); }
    execl(bin, bin, a, b, "1", static_cast<char*>(nullptr));
    _exit(127);
  }
  return p;
}

static bool ist_verbunden(jack_client_t* c, const char* port, const std::string& mit_praefix_nicht, std::string* andere) {
  jack_port_t* p = jack_port_by_name(c, port);
  const char** v = p ? jack_port_get_all_connections(c, p) : nullptr;
  bool gefunden = false;
  for (int i = 0; v && v[i]; ++i) {
    if (mit_praefix_nicht.empty() || std::strncmp(v[i], mit_praefix_nicht.c_str(), mit_praefix_nicht.size()) != 0) { gefunden = true; if (andere) *andere = v[i]; }
  }
  if (v) jack_free(v);
  return gefunden;
}

int main(int argc, char** argv) {
  if (argc < 2) return 2;
  jack_client_t* c = jack_client_open("cypherdj-latenz", JackNoStartServer, nullptr);
  if (!c) { std::fprintf(stderr, "kein JACK-Server, uebersprungen\n"); return 77; }
  jack_port_register(c, "in", JACK_DEFAULT_AUDIO_TYPE, JackPortIsInput, 0);
  jack_port_register(c, "out", JACK_DEFAULT_AUDIO_TYPE, JackPortIsOutput, 0);
  jack_set_process_callback(c, process, nullptr);
  jack_activate(c);
  const std::string ich = jack_get_client_name(c);
  if (ich != "cypherdj-latenz") { std::fprintf(stderr, "Halter heisst %s, der Name war schon belegt, uebersprungen\n", ich.c_str()); jack_client_close(c); return 77; }
  int rc = 0;
  {  // (a)
    const pid_t k = starte(argv[1], "alsa_input.gibt-es.nicht:capture_FL", "alsa_input.gibt-es.nicht:playback_FL");
    int st = 0; waitpid(k, &st, 0);
    if (!(WIFEXITED(st) && WEXITSTATUS(st) == 2)) { std::fprintf(stderr, "FEHLER (a): Ende-Code %d, erwartet 2\n", WIFEXITED(st) ? WEXITSTATUS(st) : -1); rc = 1; }
  }
  {  // (b)
    const std::string in = ich + ":in", out = ich + ":out";
    const pid_t k = starte(argv[1], in.c_str(), out.c_str());
    std::string fremd_ein, fremd_aus;
    bool ok = false;
    for (int i = 0; i < 100 && !ok; ++i) {
      std::this_thread::sleep_for(std::chrono::milliseconds(100));
      ok = ist_verbunden(c, in.c_str(), ich + ":", &fremd_ein) && ist_verbunden(c, out.c_str(), ich + ":", &fremd_aus);
    }
    const bool selbst = ist_verbunden(c, out.c_str(), "~", nullptr) && [&] {   // Halter:out -> Halter:in (falsche Verdrahtung)
      jack_port_t* p = jack_port_by_name(c, out.c_str());
      const char** v = jack_port_get_all_connections(c, p);
      bool s = false;
      for (int i = 0; v && v[i]; ++i) if (in == v[i]) s = true;
      if (v) jack_free(v);
      return s;
    }();
    kill(k, SIGKILL); int st = 0; waitpid(k, &st, 0);
    if (!ok) { std::fprintf(stderr, "FEHLER (b): der Messclient hat seine eigenen Ports nicht verbunden (in: %s, out: %s)\n", fremd_ein.c_str(), fremd_aus.c_str()); rc = 1; }
    if (selbst) { std::fprintf(stderr, "FEHLER (b): Halter:out ist mit Halter:in verbunden, der Messclient hat den Namen des Halters benutzt\n"); rc = 1; }
    if (ok) std::printf("verbunden ueber %s und %s\n", fremd_ein.c_str(), fremd_aus.c_str());
  }
  jack_client_close(c);
  if (rc == 0) std::puts("alle Pruefungen gruen");
  return rc;
}
