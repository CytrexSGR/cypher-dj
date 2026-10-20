// Paket K3 (Spec D1 2.5, 6.20, 6.24, A7): Offline-Render einer Wiedergabe mit demselben Kern, ohne JACK. Ein Kern im
// Prozess mit eigenem Ring im Heap (kein /dev/shm), Start-Tempo = Projekttempo, Limiter-Decke und Filter-Güte aus
// kern.toml, Metronom gesperrt, kein Prüfmodus, kein Mapping, keine Decks. Regler-Stand (Spec 2.5, 6.20) entweder aus
// einem Neustart-Fach des laufenden Kerns (Quelle „kern“) oder, wenn es keinen gibt, wie ein frisch gestarteter Kern:
// Vorgaben der Regler-Tabelle, erz/4 neutral (2.3: Fader 0 dB, sonst Vorgabe, Sends −200) und darüber die Spur-Regler
// des Projekts (Quelle „projekt“). Interne Spuren spielt die RB-338, die der Kern selbst anlegt (K2b, Spec 6.24).
// Die Wiedergabe lädt lade_wiedergabe() (derselbe Lader wie der Lade-Faden, ohne mlock). Der Transport startet im ersten
// Zyklus mit Quant 0 aus dem Stand: der Einsatz liegt 3n + 25 Samples nach Sample 0, die Blockphase ist 25 wie live bei
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

// Spec 6.20/6.25: ein Spur-Regler des Projekts, Pfad spur/<1..8>/{fader,pan,mute,solo}, Wert in Kern-Einheiten
struct SpurRegler {
  std::string pfad;
  float wert = 0.0f;
};

struct RenderAuftrag {
  std::string arr_ordner;                  // Arbeitsordner der Instanz: wiedergabe-<nr>.json, audio/, freeze-*.f32
  int64_t nr = 0;                          // Wiedergabe-Nummer
  double von_beat = 0.0, bis_beat = 0.0;   // Export-Bereich [von, bis) in Projekt-Beats
  double bpm = 120.0;                      // Projekttempo (60..200)
  int quantum = 256;                       // Blockgröße wie live (16..8192)
  double limiter_dbtp = -1.0;              // kern.toml
  double filter_guete = 0.707;             // kern.toml
  int64_t speicher_budget_bytes = 3800LL << 20;
  int64_t arr_budget_bytes = 1024LL << 20;
  const cdj_z_echtzeit* regler = nullptr;  // Neustart-Fach; nur die Regler werden übernommen (Quelle kern)
  // Spec 6.20: ohne Fach (regler == nullptr) die Regler wie ein frisch gestarteter Kern, erz/4 neutral, darüber
  // spur_regler (Quelle projekt). Weder Fach noch projekt: nur die Vorgaben (erz/4 −200 dB, still; nur für Tests).
  bool regler_projekt = false;
  std::vector<SpurRegler> spur_regler;
  ArrSenke* senke_intern = nullptr;        // Ersatz für Tests; nullptr: die RB-338 des Kerns (K2b)
  int gegenprobe_spur = 0;                 // > 0: jeder Audio-Clip dieser Spur 1 Frame weiter in der Quelle (A7, 5.)
};

struct RenderErgebnis {
  // "" fertig; sonst aufruf, datei_fehlt, format, audio_fehlt, zu_gross, spur_bereich, wirt_nicht_eingefroren,
  // gegenprobe, regler (ein Spur-Regler außerhalb der Tabelle), abgelehnt (Quittung 6 des Kerns), kein_einsatz.
  // Kein OSC-Grund (§16.2), darum nicht „grund“.
  std::string fehler;
  std::string meldung;
  std::vector<float> l, r;                 // Master, frames Werte je Seite
  int64_t frames = 0;                      // (bis − von) Beats in Samples
  int64_t start_sample = -1;               // Kern-Sample des Einsatzes; l[0] klingt am Kern-Sample start + vorhalt
  int vorhalt = 0;                         // Vorhalt des Master-Limiters
  int phase = 0;                           // start_sample mod quantum
  int regler = 0;                          // übernommene Regler (kern: aus dem Fach, −1 ungültig; projekt: Spur-Regler)
  std::string regler_quelle;               // "kern", "projekt" oder "" (weder noch, nur Tests)
  float spitze = 0.0f;                     // größter Betrag im Master, linear
};

RenderErgebnis rendere(const RenderAuftrag& a);

// Spec 6.20/6.25: --spur-regler <datei.json>, EIN JSON-Objekt Pfad -> Zahl. Nur spur/<1..8>/{fader,pan,mute,solo}, Werte
// in den Grenzen der Regler-Tabelle (fader −200..+6 dB, pan −1..+1, mute und solo 0 oder 1). false mit fehler bei fehlender
// oder unlesbarer Datei, kein JSON, kein Objekt, fremdem Pfad, keiner Zahl, Wert außerhalb.
bool lies_spur_regler(const std::string& pfad, std::vector<SpurRegler>& aus, std::string& fehler);

}  // namespace cdj
