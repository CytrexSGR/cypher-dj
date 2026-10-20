// cypherdj-render (Paket K3, Spec D1 2.5, 6.20, 6.24, 6.25): Export einer Wiedergabe als WAV (48 kHz, 32 bit float) mit
// demselben Kern wie live, ohne JACK. Liest kern.toml der Instanz (CYPHERDJ_INSTANZ, Z2: limiter_dbtp, filter_guete,
// Budgets, arr_ordner), den Regler-Stand und das Quantum aus dem Neustart-Zustand des laufenden Kerns
// (/dev/shm/cypherdj[-i]/zustand, nur lesend) und die Wiedergabe <arr_ordner>/wiedergabe-<nr>.json. Läuft mit nice 19;
// eigener Ring im Heap, kein Mapping, kein Prüfmodus, Metronom aus. Interne Spuren spielt die RB-338, die der Kern selbst
// anlegt (K2b, 6.24); Wirt-Spuren müssen eingefroren sein.
// Regler (6.20, 6.25): gibt es den Neustart-Zustand, gilt er („kern“, die Spur-Regler-Datei wird nur geprüft). Fehlt die
// Datei (kein Kern seit dem Boot) oder steht --ohne-zustand, gelten die Vorgaben eines frisch gestarteten Kerns, erz/4
// neutral und darüber --spur-regler („projekt“); ohne --spur-regler dann Rückgabe 3. Ein vorhandener, aber unlesbarer
// Zustand ist Rückgabe 3, kein stiller Rückfall. Das Programm parst kein Projekt.
// --spur-regler <datei.json>: EIN JSON-Objekt Pfad -> Wert, Pfade spur/<n>/{fader,pan,mute,solo} in Kern-Einheiten
// (fader dB −200..+6, pan −1..+1, mute und solo 0/1).
// Aufruf: cypherdj-render --nr N --von-beat V --bis-beat B --bpm T --aus <datei.wav> [--quantum Q] [--konfig kern.toml]
//         [--zustand pfad | --ohne-zustand] [--spur-regler datei.json] [--arr-ordner pfad] [--gegenprobe-spur S]
// Ausgabe (stdout, eine Zeile): {"datei","frames","spitze_db","start_sample","phase","quantum","vorhalt","regler",
// "regler_quelle"}
// Zahlen werden streng gelesen (Fix L8: „abc“ oder „128x“ sind Rückgabe 2 mit dem Schalter im Text, nicht 0 oder 128);
// eine ungültige CYPHERDJ_INSTANZ ist Rückgabe 2 mit Hinweis.
// Rückgabe: 0 geschrieben, 2 Aufruf (auch: Spur-Regler-Datei unlesbar oder ungültig; bis − von über 2048 Beats,
// RENDER_MAX_BEATS), 3 Konfiguration oder Zustand (auch: weder Zustand noch --spur-regler), 4 Wiedergabe oder Render
// (Grund auf stderr), 5 Wirt-Spur nicht eingefroren, 6 Schreiben, 7 Speicher (bad_alloc beim Rendern oder Schreiben),
// 8 Ziel besteht (Fix L9: cypherdj-render ersetzt nie, wie der Freeze nach Spec 6.25; geprüft vor dem Rendern und beim
// Umbenennen; der Aufrufer, S3, vergibt eigene Namen). Jeder Fehler steht als Zeile auf stderr.
#include <sys/resource.h>
#include <sys/stat.h>
#include <unistd.h>

#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <new>
#include <string>
#include <vector>

#include "cypherdj/aufruf_zahl.h"
#include "cypherdj/instanz.h"
#include "cypherdj/json_text.h"
#include "cypherdj/konfig.h"
#include "cypherdj/render.h"
#include "cypherdj/wav.h"
#include "cypherdj/zustand_datei.h"
#include "cypherdj/zustand_lesen.h"

static int hilfe() {
  std::fprintf(stderr, "Aufruf: cypherdj-render --nr N --von-beat V --bis-beat B --bpm T --aus <datei.wav> [--quantum Q]"
                       " [--konfig kern.toml] [--zustand pfad | --ohne-zustand] [--spur-regler datei.json]"
                       " [--arr-ordner pfad] [--gegenprobe-spur S]\n");
  return 2;
}

int main(int argc, char** argv) {
  setpriority(PRIO_PROCESS, 0, 19);   // Spec 2.5: der Live-Kern hat Vorrang
  const char* inst = cdj_instanz();
  if (!cdj::instanz_gueltig("cypherdj-render")) return 2;   // Fix L8: mit Hinweis
  cdj::RenderAuftrag a;
  a.nr = -1;
  std::string aus, konfig, zustand, arr_ordner, spur_regler;
  bool ohne_zustand = false;
  int quantum = 0;
  // Fix L8: jede Zahl streng (ganz verbraucht, endlich, im Bereich), sonst Rückgabe 2 mit dem Schalter
  auto falsch = [&](int i, const char* erwartet) { return cdj::wert_falsch("cypherdj-render", argv[i - 1], argv[i], erwartet); };
  for (int i = 1; i < argc; ++i) {
    const bool wert = i + 1 < argc;
    int64_t g = 0;
    if (!std::strcmp(argv[i], "--nr") && wert) {
      if (!cdj::lies_ganz(argv[++i], 0, INT64_MAX, a.nr)) return falsch(i, "ganze Zahl >= 0");
    } else if (!std::strcmp(argv[i], "--von-beat") && wert) {
      if (!cdj::lies_zahl(argv[++i], a.von_beat)) return falsch(i, "endliche Zahl");
    } else if (!std::strcmp(argv[i], "--bis-beat") && wert) {
      if (!cdj::lies_zahl(argv[++i], a.bis_beat)) return falsch(i, "endliche Zahl");
    } else if (!std::strcmp(argv[i], "--bpm") && wert) {
      if (!cdj::lies_zahl(argv[++i], a.bpm)) return falsch(i, "endliche Zahl");
    } else if (!std::strcmp(argv[i], "--aus") && wert) {
      aus = argv[++i];
    } else if (!std::strcmp(argv[i], "--quantum") && wert) {
      if (!cdj::lies_ganz(argv[++i], 16, 8192, g)) return falsch(i, "ganze Zahl 16..8192");
      quantum = static_cast<int>(g);
    } else if (!std::strcmp(argv[i], "--konfig") && wert) {
      konfig = argv[++i];
    } else if (!std::strcmp(argv[i], "--zustand") && wert) {
      zustand = argv[++i];
    } else if (!std::strcmp(argv[i], "--ohne-zustand")) {
      ohne_zustand = true;
    } else if (!std::strcmp(argv[i], "--spur-regler") && wert) {
      spur_regler = argv[++i];
    } else if (!std::strcmp(argv[i], "--arr-ordner") && wert) {
      arr_ordner = argv[++i];
    } else if (!std::strcmp(argv[i], "--gegenprobe-spur") && wert) {
      if (!cdj::lies_ganz(argv[++i], 0, 8, g)) return falsch(i, "ganze Zahl 0..8");
      a.gegenprobe_spur = static_cast<int>(g);
    } else {
      return hilfe();
    }
  }
  if (a.nr < 0 || aus.empty() || (ohne_zustand && !zustand.empty())) return hilfe();
  std::vector<cdj::SpurRegler> projekt;
  if (!spur_regler.empty()) {   // immer prüfen, auch wenn der Zustand gilt: ein kaputter Aufruf fällt sofort auf
    std::string fehler;
    if (!cdj::lies_spur_regler(spur_regler, projekt, fehler)) {
      std::fprintf(stderr, "Spur-Regler: %s\n", fehler.c_str());
      return 2;
    }
  }
  cdj::KernKonfig konf;
  const std::string kpfad = konfig.empty() ? cdj::standard_konfig_pfad(inst) : konfig;
  try {
    if (!konfig.empty() || access(kpfad.c_str(), F_OK) == 0) konf = cdj::lies_kern_toml(kpfad);
  } catch (const cdj::KonfigFehler& e) {
    std::fprintf(stderr, "Konfiguration: %s\n", e.what());
    return 3;
  }
  cdj::wende_instanz_an(konf, inst);
  a.arr_ordner = arr_ordner.empty() ? cdj::arr_ordner_von(konf, inst) : arr_ordner;
  a.limiter_dbtp = konf.limiter_dbtp;
  a.filter_guete = konf.filter_guete;
  a.speicher_budget_bytes = static_cast<int64_t>(konf.speicher_budget_mib) << 20;
  a.arr_budget_bytes = static_cast<int64_t>(konf.arr_budget_mib) << 20;
  std::unique_ptr<cdj_z_echtzeit> fach;
  bool fehlt = ohne_zustand;
  if (!ohne_zustand) {
    std::string fehler;
    fach = cdj::lies_echtzeit_fach(zustand.empty() ? cdj::ZustandDatei::pfad_fuer(inst) : zustand, fehler, &fehlt);
    if (!fach && !fehlt) {   // vorhanden, aber unlesbar: kein stiller Rückfall auf das Projekt
      std::fprintf(stderr, "Neustart-Zustand: %s\n", fehler.c_str());
      return 3;
    }
    if (!fach && spur_regler.empty()) {
      std::fprintf(stderr, "Neustart-Zustand: %s, und keine --spur-regler (Spec 6.20)\n", fehler.c_str());
      return 3;
    }
  } else if (spur_regler.empty()) {
    std::fprintf(stderr, "--ohne-zustand braucht --spur-regler (Spec 6.20)\n");
    return 3;
  }
  if (fach) {
    a.regler = fach.get();
  } else {
    a.regler_projekt = true;
    a.spur_regler = projekt;
  }
  a.quantum = quantum > 0 ? quantum : (fach && fach->quantum >= 16 && fach->quantum <= 8192 ? (int)fach->quantum : 256);
  struct stat st_aus;
  if (lstat(aus.c_str(), &st_aus) == 0) {   // Fix L9: nicht erst rendern, wenn das Ziel schon besteht
    std::fprintf(stderr, "WAV: %s besteht schon (cypherdj-render ersetzt nie)\n", aus.c_str());
    return 8;
  }
  cdj::RenderErgebnis e;
  try {   // Fix L3: Speichermangel ist eine Rückgabe mit Text, kein Abbruch (vorher: terminate, 134)
    e = cdj::rendere(a);
    if (!e.fehler.empty()) {
      std::fprintf(stderr, "Render: %s: %s\n", e.fehler.c_str(), e.meldung.c_str());
      return e.fehler == "wirt_nicht_eingefroren" ? 5 : (e.fehler == "aufruf" || e.fehler == "regler") ? 2 : 4;
    }
    std::string fehler;
    bool besteht = false;
    if (!cdj::schreibe_wav_f32(aus, e.l, e.r, fehler, &besteht)) {   // besteht: inzwischen angelegt, nie ersetzt
      std::fprintf(stderr, "WAV: %s\n", fehler.c_str());
      return besteht ? 8 : 6;
    }
  } catch (const std::bad_alloc&) {
    std::fprintf(stderr, "Speicher: zu wenig für %.17g Beats (bad_alloc)\n", a.bis_beat - a.von_beat);
    return 7;
  }
  const double spitze_db = e.spitze > 0.0f ? 20.0 * std::log10(static_cast<double>(e.spitze)) : -200.0;
  std::printf("{\"datei\":%s,\"frames\":%lld,\"spitze_db\":%.3f,\"start_sample\":%lld,\"phase\":%d,\"quantum\":%d,"
              "\"vorhalt\":%d,\"regler\":%d,\"regler_quelle\":%s}\n",
              cdj::json_text(aus).c_str(), (long long)e.frames, spitze_db, (long long)e.start_sample, e.phase, a.quantum,
              e.vorhalt, e.regler, cdj::json_text(e.regler_quelle).c_str());   // Fix L7: maskiert
  return 0;
}
