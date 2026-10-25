// I08 Task 14: cypherdj-latenz <Ziel-Playback-Port> <Quell-Capture-Port> [Läufe=20] [Ausgabe.json]
// Spielt je Lauf einen Impuls (1,0) auf <Ziel> und sucht ihn auf <Quelle>; Abstand in Samples. Ohne Treffer bricht er mit "keine_schleife" ab, bei einer
// Quelle, die von selbst laut wird (Leerversuche) oder deren Treffer um mehr als rate/1000 Samples streuen, mit "quelle_unruhig"; er schreibt dann KEINEN Wert. PIPEWIRE_PROPS mit node.group (Gruppe des Kerns) und node.lock-quantum setzt der Aufrufer (Atlas services/desktop.md, Abschnitt 83).
#include <jack/jack.h>

#include <atomic>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <unistd.h>
#include <vector>

#include "latenz_lauf.h"
#include "latenz_stat.h"

static jack_client_t* g_c = nullptr;
static jack_port_t *g_aus = nullptr, *g_ein = nullptr;
static LatenzLauf g_l;
static int g_ziel = 20;                           // Läufe gewünscht
static std::atomic<bool> g_ausfall{false};        // JACK-Server weg (jack_on_shutdown)

static int process(jack_nframes_t n, void*) {
  g_l.block(static_cast<const float*>(jack_port_get_buffer(g_ein, n)), static_cast<float*>(jack_port_get_buffer(g_aus, n)), n, jack_get_sample_rate(g_c));
  return 0;
}
static void on_shutdown(void*) { g_ausfall.store(true); }

int main(int argc, char** argv) {
  if (argc < 3) { std::fprintf(stderr, "Aufruf: cypherdj-latenz <Ziel-Playback-Port> <Quell-Capture-Port> [Läufe] [Ausgabe.json]\n"); return 2; }
  if (argc > 3) g_ziel = std::atoi(argv[3]);
  g_l.versuche = g_ziel * 3;
  // R1: eine alte Ausgabe darf einen fehlgeschlagenen Lauf nicht überleben (latenz_eintragen.mjs liest die Datei, nicht den Ende-Code).
#ifndef CYPHERDJ_MUTATION_LATENZ_ALTE_DATEI
  if (argc > 4) std::remove(argv[4]);
#endif
  g_c = jack_client_open("cypherdj-latenz", JackNullOption, nullptr);
  if (!g_c) { std::fprintf(stderr, "kein JACK-Server\n"); return 2; }
  g_aus = jack_port_register(g_c, "out", JACK_DEFAULT_AUDIO_TYPE, JackPortIsOutput, 0);
  g_ein = jack_port_register(g_c, "in", JACK_DEFAULT_AUDIO_TYPE, JackPortIsInput, 0);
  jack_set_process_callback(g_c, process, nullptr);
  jack_on_shutdown(g_c, on_shutdown, nullptr);
  if (jack_activate(g_c) != 0) { std::fprintf(stderr, "jack_activate gescheitert\n"); return 2; }
  // Gesamtreview Teil A, M1: unter pipewire-jack heißt der Client eines ALSA-Geräts node.description; die Namen aus `pw-link` (node.name) kennt jack_connect nicht.
  // Die Namen kommen aus `pw-jack jack_lsp` (Plan Task 16 Step 2). Gesamtreview m1: den eigenen Port über seinen tatsächlichen Namen verbinden
  // (pipewire-jack hängt bei einer Namenskollision eine Zahl an den Clientnamen), nie über den fest geschriebenen.
  for (int i = 1; i <= 2; ++i)
    if (!jack_port_by_name(g_c, argv[i])) {
      std::fprintf(stderr, "Port nicht gefunden: %s (Namen wie `pw-jack jack_lsp` sie zeigt, bei ALSA-Geräten mit node.description als Client, nicht wie `pw-link -o`)\n", argv[i]);
      jack_client_close(g_c);
      return 2;
    }
#ifdef CYPHERDJ_MUTATION_LATENZ_FESTER_NAME
  const std::string mein_aus = "cypherdj-latenz:out", mein_ein = "cypherdj-latenz:in";
#else
  const std::string mein_aus = jack_port_name(g_aus), mein_ein = jack_port_name(g_ein);
#endif
  const bool v1 = jack_connect(g_c, mein_aus.c_str(), argv[1]) == 0;
  const bool v2 = jack_connect(g_c, argv[2], mein_ein.c_str()) == 0;
  if (!v1 || !v2) { std::fprintf(stderr, "Verbinden gescheitert: %s -> %s: %d, %s -> %s: %d\n", mein_aus.c_str(), argv[1], v1, argv[2], mein_ein.c_str(), v2); jack_client_close(g_c); return 2; }
  // Gesamtfrist: zu jedem Messversuch gehört ein Leerversuch (R2); jeder dauert höchstens 2 s (0,5 bis 1 s Pause, eine Sekunde Suche), dazu 5 s Anlauf.
  const LatenzWarte w = latenz_warten(g_l.n, g_l.versuche, g_ausfall, g_l.versuche * 4000 + 5000);
  if (w != LatenzWarte::Fertig) {                   // kein Wert, keine Datei; harter Ausstieg, ein hängender Treiber lässt jack_client_close warten
    std::printf("{\"ok\":false,\"grund\":\"%s\",\"laeufe\":%d}\n", w == LatenzWarte::Ausfall ? "jack_ausfall" : "zeitueberschreitung", g_l.n.load());
    std::fflush(stdout);
    std::_Exit(3);
  }
  const unsigned quantum = jack_get_buffer_size(g_c), rate = jack_get_sample_rate(g_c);
  jack_client_close(g_c);
  const LatenzErgebnis e = latenz_urteil(g_l, g_ziel, rate);   // keine_schleife, zu_wenige_laeufe, quelle_unruhig
  char json[512];
  if (e.ok)
    std::snprintf(json, sizeof json, "{\"ok\":true,\"samples\":%.3f,\"streuung\":%.3f,\"min\":%d,\"max\":%d,\"laeufe\":%d,\"quantum\":%u,\"rate\":%u}\n",
                  e.mittel, e.streuung, e.min, e.max, e.laeufe, quantum, rate);
  else
    std::snprintf(json, sizeof json, "{\"ok\":false,\"grund\":\"%s\",\"laeufe\":%d,\"leer_treffer\":%d,\"leerversuche\":%d,\"quantum\":%u,\"rate\":%u}\n",
                  e.grund, e.laeufe, g_l.leer_treffer.load(), g_l.leer_n.load(), quantum, rate);
  std::fputs(json, stdout);
  if (e.ok && argc > 4) {                           // nur ein gültiger Wert wird geschrieben
    if (FILE* f = std::fopen(argv[4], "w")) { std::fputs(json, f); std::fclose(f); }
  }
  return e.ok ? 0 : 3;
}
