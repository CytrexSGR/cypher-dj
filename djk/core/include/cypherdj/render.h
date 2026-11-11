// Paket K3 (Spec D1 2.5, 6.20, 6.24, A7): Offline-Render einer Wiedergabe mit demselben Kern, ohne JACK. Ein Kern im
// Prozess mit eigenem Ring im Heap (kein /dev/shm), Start-Tempo = Projekttempo, Limiter-Decke und Filter-Güte aus
// kern.toml, Metronom gesperrt, kein Prüfmodus, kein Mapping, keine Decks. Regler-Stand (Spec 2.5, 6.20) entweder aus
// einem Neustart-Fach des laufenden Kerns (Quelle „kern“) oder, wenn es keinen gibt, wie ein frisch gestarteter Kern:
// Vorgaben der Regler-Tabelle, erz/4 neutral (2.3: Fader 0 dB, sonst Vorgabe, Sends −200) und darüber die Spur-Regler
// des Projekts (Quelle „projekt“). Interne Spuren spielt die RB-338, die der Kern selbst anlegt (K2b, Spec 6.24).
// Die Wiedergabe lädt lade_wiedergabe() (derselbe Lader wie der Lade-Faden, ohne mlock). Der Transport startet im ersten
// Zyklus mit Quant 0 aus dem Stand: der Einsatz liegt 3n Samples nach Sample 0 (bis 2026-11-10 3n + 25), die Blockphase ist 0 wie live bei
// Quant 0. Ergebnis: Master ab Einsatz plus Limiter-Vorhalt, (bis − von) Beats lang, Loop-Klammer aus.
#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include "cypherdj/arrangement.h"

struct cdj_z_echtzeit;

namespace cdj {

// Fix L3: Höchstlänge des Export-Bereichs bis − von. Bei 60 BPM (langsamstes Tempo) 98 304 000 Frames: L und R zusammen
// 786 MB, die WAV-Datei ebenso viel; weit unter der WAV-Grenze WAV_F32_MAX_FRAMES (wav.h, 536 870 905 Frames). Gemessen
// (Fix 2/P4, /usr/bin/time -v, cypherdj-render 2048 Beats bei 60 BPM): Spitze des Arbeitsspeichers 888 188 kB, rund 0,91 GB
// (L und R plus Kern, Ring und Wiedergabe); vor P4 verschränkte schreibe_wav_f32 den ganzen Export in einer Kopie,
// 1 585 064 kB. Darüber lehnt rendere() mit fehler "aufruf" ab (cypherdj-render: Rückgabe 2 mit Text).
constexpr double RENDER_MAX_BEATS = 2048.0;

// Spec 6.20/6.25: ein Mixer-Regler des Projekts, Pfad spur/<1..ARR_SPUREN = 32>/{fader,pan,mute,solo}, grp/<1..ARR_GRUPPEN = 8>/{fader,pan,mute,solo}
// oder pm/fader (1.10), spur|grp/<n>/send/<1..4> und ret/<1..4>/{fader,pan,mute,solo,hall/…} (1.10 slice 3), Wert in Kern-Einheiten
struct SpurRegler {
  std::string pfad;
  float wert = 0.0f;
};

// 1.10 Slice 2 (E2): welches Signal der Export trägt. produktion: der PM-Ausgang des Kerns (Kern::pm_abgriff_*), vor erz/4, Kleber, master/pegel und
// Set-Limiter; l[0] klingt am Kern-Sample start_sample. set: der Master hinter dem Set-Limiter wie bisher; l[0] klingt am Kern-Sample start_sample +
// vorhalt. Der Ring-Master liegt in beiden Fällen um den Vorhalt hinter dem PM: für den Null-Test gegen den Live-Mitschnitt gilt dieselbe Ausrichtung.
// Nachzug N7: der Ring-Master ist der PM durch den Isolator von erz/4 (Allpass, Betrag flach, Phase gedreht); ein Sample-Vergleich produktion gegen set
// ist darum nie null, die Referenz ist der Abgriff durch cypherdj::dsp::Isolator mit Gains 1,0.
enum class RenderAbgriff { set, produktion };

struct RenderAuftrag {
  std::string arr_ordner;                  // Arbeitsordner der Instanz: wiedergabe-<nr>.json, audio/, freeze-*.f32
  int64_t nr = 0;                          // Wiedergabe-Nummer
  double von_beat = 0.0, bis_beat = 0.0;   // Export-Bereich [von, bis) in Projekt-Beats
  double bpm = 120.0;                      // Projekttempo (60..200)
  int quantum = 256;                       // Blockgröße wie live (16..8192)
  double limiter_dbtp = -1.0;              // kern.toml
  double filter_guete = 0.707;             // kern.toml
  double kanal_limiter_vorhalt_ms = 0.0;   // kern.toml (1.15 A5b): 0 = the bus limiters are not built (L = 0); the export is aligned with the master limiter's vh + L
  bool kanal_limiter_echtspitze = false;   // kern.toml
  int64_t speicher_budget_bytes = 3800LL << 20;
  int64_t arr_budget_bytes = 1024LL << 20;
  const cdj_z_echtzeit* regler = nullptr;  // Neustart-Fach; nur die Regler werden übernommen (Quelle kern)
  // Spec 6.20: ohne Fach (regler == nullptr) die Regler wie ein frisch gestarteter Kern, erz/4 neutral, darüber
  // spur_regler (Quelle projekt). Weder Fach noch projekt: nur die Vorgaben (erz/4 −200 dB, still; nur für Tests).
  bool regler_projekt = false;
  std::vector<SpurRegler> spur_regler;
  ArrSenke* senke_intern = nullptr;        // Ersatz für Tests; nullptr: die RB-338 des Kerns (K2b)
  // S20: folder of the Baukasten graphs (<graph>.json, samples/ beside them) of the project tracks with device bk. Empty: a playback with
  // a bk track is refused with fehler "format". cypherdj-render: --bk-ordner, else $CYPHERDJ_BK_ORDNER, else $HOME/.config/cypherdj/baukasten
  // (the folder the live kern reads).
  std::string bk_ordner;
  // 1.9: folder of the kits (<name>/kit.json and the sounds) of the project tracks with device kit. Empty: a playback with a kit track is
  // refused with fehler "format". cypherdj-render: --kit-ordner, else $CYPHERDJ_KIT_ORDNER, else $HOME/.config/cypherdj/kits (the live folder).
  std::string kit_ordner;
  int gegenprobe_spur = 0;                 // > 0: jeder Audio-Clip dieser Spur 1 Frame weiter in der Quelle (A7, 5.)
  // Automation Slice 1: true shifts every point of every lane by the beat distance of one sample (the lane runs one sample late). Counter-check of
  // the null test: a lane that the render evaluates wrongly by one sample must turn it red. Refused with grund gegenprobe when there is no lane.
  bool gegenprobe_auto = false;
  RenderAbgriff abgriff = RenderAbgriff::set;   // Vorgabe des Programms: wie bisher (P11)
  // 1.10 T9 (AK24): render-only key mask, used by no live path. Ids spur/<n>, grp/<n>, ret/<n>, each with an optional suffix. Bare: the strip computes and
  // captures its key points as usual but writes zero into its target and its sends. ":ziel": it keeps its target write and zeroes only its sends (a member
  // that must feed a key-only group). ":sends": it zeroes its target and keeps its sends (a track that must feed a key-only return). A number outside the
  // range (a source that does not exist) is ignored; a malformed id is refused with fehler "aufruf".
  std::vector<std::string> nur_schluessel;
  // 1.10 T10 (AK24): render-only, used by no live path. true: every track that targets the master and every group writes zero into the master; the sends stay live and a track
  // that targets a group keeps feeding it (the group's own sends need the signal). What is left in the output is the return part only: the wet signal as the mix feeds it.
  // Combines with nur_schluessel (cypherdj-render: --trocken-aus).
  bool trocken_aus = false;
};

struct RenderErgebnis {
  // "" fertig; sonst aufruf, datei_fehlt, format, audio_fehlt, zu_gross, spur_bereich, wirt_nicht_eingefroren,
  // gegenprobe, regler (ein Spur-Regler außerhalb der Tabelle), abgelehnt (Quittung 6 des Kerns), kein_einsatz, host_insert_echtzeit (plan 1.11 T12: a host stage with an true, the strip
  // is named in meldung; the project plays only in real time, /k/arr/export_lauf; cypherdj-render exit 5).
  // Kein OSC-Grund (§16.2), darum nicht „grund“.
  std::string fehler;
  std::string meldung;
  std::vector<float> l, r;                 // Master, frames Werte je Seite
  int64_t frames = 0;                      // (bis − von) Beats in Samples
  int64_t start_sample = -1;               // Kern-Sample des Einsatzes; l[0] klingt am Kern-Sample start + vorhalt
  int pdc_latenz = 0;                      // 1.10 slice 4b T13: the largest path latency of the insert chains; the file starts that many samples after the first valid sample of the tap (0: no latency stage)
  int vorhalt = 0;                         // Vorhalt des Master-Limiters plus the latency account L of the bus limiters (1.15 A5b; L = 0 without them)
  int phase = 0;                           // start_sample mod quantum
  int regler = 0;                          // übernommene Regler (kern: aus dem Fach, −1 ungültig; projekt: Spur-Regler)
  std::string regler_quelle;               // "kern", "projekt" oder "" (weder noch, nur Tests)
  float spitze = 0.0f;                     // größter Betrag im Master, linear
  std::string abgriff = "set";             // "produktion" oder "set": das tatsächlich gelesene Signal
  bool ueber_decke = false;                // Sample-Spitze des Exports größer als limiter_dbtp (kern.toml); die True-Peak-Lücke steht im Kommentar zu P10 des Plans
  float limiter_db_max = 0.0f;             // größte Absenkung des Set-Limiters während des Renders als positive dB-Zahl (0 = griff nie ein)
  // 1.10 slice 3 (P8 a, test seam): a Hall that woke on a pending target and got no setze credit (render: 0, hall_sofort() applied before block 0), and the
  // normalised decay each return Hall holds at the end
  uint64_t hall_start_alt = 0;
  float hall_decay[4] = {0, 0, 0, 0};
};

RenderErgebnis rendere(const RenderAuftrag& a);

// Spec 6.20/6.25: --spur-regler <datei.json>, EIN JSON-Objekt Pfad -> Zahl. Nur spur/<1..ARR_SPUREN = 32>/{fader,pan,mute,solo,send/<r>}, grp/<1..8>/… (also send), ret/<1..4>/… und pm/fader, Werte
// in den Grenzen der Regler-Tabelle (fader −200..+6 dB, pan −1..+1, mute und solo 0 oder 1). false mit fehler bei fehlender
// oder unlesbarer Datei, kein JSON, kein Objekt, fremdem Pfad, keiner Zahl, Wert außerhalb.
bool lies_spur_regler(const std::string& pfad, std::vector<SpurRegler>& aus, std::string& fehler);

}  // namespace cdj
