// I08 Task 14 (Nachzug R1): Ablauf des Messclients ohne JACK, damit Tests ihn gegen ein Schleifenmodell fahren.
// block() ist der Prozess-Callback von cypherdj-latenz; latenz_warten() ist das Warten des Hauptfadens mit Frist und Ausfall.
#pragma once

#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <thread>
#include <vector>

#include "latenz_stat.h"

constexpr float LATENZ_SCHWELLE = 0.1f;

// Ein Wert entsteht nur, wenn der Treffer nachweislich vom Impuls kommt (Spec 1.8 AK12). Dafür drei Sperren:
//  - Ruheprüfung: liegt die Quelle auf Pegel, ohne dass wir etwas gesendet haben, geht kein Impuls hinaus (Versuch -1).
//  - Leerversuche (R2): im Wechsel mit den Messversuchen dasselbe Suchfenster, aber ohne Impuls. Ein Treffer dort heißt: die Quelle ist unruhig.
//  - Impulsabstand (R2): pseudozufällig verschoben (fester Seed, Läufe sind reproduzierbar), und das Urteil verlangt max - min <= rate / 1000 Samples.
// Alles allokations- und sperrfrei: block() läuft im JACK-Callback.
struct LatenzLauf {
  int versuche = 60;                 // Messversuche höchstens (der Aufrufer begrenzt auf 256)
  std::atomic<int> n{0};             // abgeschlossene Messversuche
  int ergebnis[256] = {};            // Samples Hinweg+Rückweg, -1: kein Impuls (oder Quelle nicht ruhig)
  std::atomic<int> leer_n{0};        // abgeschlossene Leerversuche
  std::atomic<int> leer_treffer{0};  // davon mit Pegel über der Schwelle: die Quelle ist von selbst laut
  uint64_t frames = 0;               // Frames seit Start (Zyklusanfang)
  int phase = 0;                     // 0 Pause, 2 Messversuch sucht, 3 Leerversuch sucht
  uint64_t t_send = 0, pause_bis = 0, suche_bis = 0, laut_bis = 0;
  bool leer_dran = true;             // der nächste Versuch ist ein Leerversuch (Tests setzen false, um mit einem Messversuch zu beginnen)
  uint32_t lcg = 0x4c61e1u;          // fester Seed

  // Pause vor dem nächsten Versuch: eine halbe Sekunde, damit der Nachlauf abklingt, dazu 0 bis 500 ms pseudozufällig.
  uint64_t naechste_pause(unsigned rate) {
#ifdef CYPHERDJ_MUTATION_LATENZ_OHNE_JITTER
    return rate / 2;
#else
    lcg = lcg * 1664525u + 1013904223u;
    return rate / 2 + (lcg >> 8) % (rate / 2);
#endif
  }

  void block(const float* ein, float* aus, unsigned nf, unsigned rate) {
    std::memset(aus, 0, nf * sizeof(float));
    const int fertig = n.load();
    bool laut = false;
    for (unsigned i = 0; i < nf; ++i)
      if (std::fabs(ein[i]) >= LATENZ_SCHWELLE) { laut = true; break; }
    if (phase == 0) {
      // Ruheprüfung (R1): liegt die Quelle auf Pegel, ohne dass wir etwas gesendet haben, ist das keine Schleife.
#ifdef CYPHERDJ_MUTATION_LATENZ_LAUT_BIS_FRAMES
      if (laut) laut_bis = frames;
#else
      if (laut) laut_bis = frames + nf;
#endif
      if (frames >= pause_bis && fertig < versuche && fertig < 256) {
        if (leer_dran) {
#ifdef CYPHERDJ_MUTATION_LATENZ_OHNE_LEER
          leer_dran = false;
#else
          suche_bis = frames + rate;                 // dasselbe Fenster wie beim Messversuch, aber ohne Impuls
          phase = 3;
#endif
        } else {
#ifdef CYPHERDJ_MUTATION_LATENZ_OHNE_RUHE
          const bool unruhig = false;
#elif defined(CYPHERDJ_MUTATION_LATENZ_RUHE_OHNE_FENSTER)
          const bool unruhig = laut_bis > 0 && frames < laut_bis;
#else
          const bool unruhig = laut_bis > 0 && frames < laut_bis + rate / 10;   // laut jetzt oder in den letzten 100 ms
#endif
          if (unruhig) {
            ergebnis[fertig] = -1;
            leer_dran = true;
#ifndef CYPHERDJ_MUTATION_LATENZ_UNRUHIG_OHNE_PAUSE
            pause_bis = frames + naechste_pause(rate);
#endif
            n.fetch_add(1);
          } else {
            aus[0] = 1.0f;
            t_send = frames;
            suche_bis = frames + rate;               // eine Sekunde Zeit für den Rückweg
            phase = 2;
          }
        }
      }
    } else if (phase == 2) {
      int treffer = -1;
      for (unsigned i = 0; i < nf; ++i)
        if (std::fabs(ein[i]) >= LATENZ_SCHWELLE) {
#ifdef CYPHERDJ_MUTATION_LATENZ_OHNE_I
          treffer = static_cast<int>(frames - t_send);
#else
          treffer = static_cast<int>(frames + i - t_send);
#endif
          break;
        }
      if (treffer >= 0 || frames + nf >= suche_bis) {
        ergebnis[fertig] = treffer;                  // -1: kein Impuls gefunden
        phase = 0;
        leer_dran = true;
        pause_bis = frames + naechste_pause(rate);
        n.fetch_add(1);                              // zuletzt: danach liest der Hauptfaden die Ergebnisse
      }
    } else if (phase == 3) {
      if (laut) leer_treffer.fetch_add(1);
      if (laut || frames + nf >= suche_bis) {        // ein Treffer genügt, das Fenster muss nicht zu Ende laufen
        leer_n.fetch_add(1);
        phase = 0;
        leer_dran = false;
        pause_bis = frames + naechste_pause(rate);
      }
    }
    frames += nf;
  }
};

// Urteil über den Lauf: ein Wert nur bei genug Treffern, ruhiger Quelle (keine Treffer in Leerversuchen) und enger Streuung (max - min <= rate / 1000).
// Gründe: keine_schleife (kein einziger Treffer), zu_wenige_laeufe, quelle_unruhig.
inline LatenzErgebnis latenz_urteil(const LatenzLauf& l, int soll, unsigned rate) {
  LatenzErgebnis e = latenz_auswerten(std::vector<int>(l.ergebnis, l.ergebnis + l.n.load()), soll);
  if (!e.ok) return e;
#ifndef CYPHERDJ_MUTATION_LATENZ_OHNE_LEER_URTEIL
  if (l.leer_treffer.load() > 0) { e.ok = false; e.grund = "quelle_unruhig"; return e; }
#endif
#ifndef CYPHERDJ_MUTATION_LATENZ_OHNE_STREUUNG
  if (e.max - e.min > static_cast<int>(rate / 1000)) { e.ok = false; e.grund = "quelle_unruhig"; return e; }
#endif
  return e;
}

enum class LatenzWarte { Fertig, Frist, Ausfall };

// Wartet, bis alle Versuche durch sind. Gesamtfrist und Ausfall des JACK-Servers (jack_on_shutdown setzt `ausfall`)
// beenden das Warten, sonst hängt der Client, sobald der Treiber process nicht mehr aufruft (R1).
inline LatenzWarte latenz_warten(const std::atomic<int>& n, int versuche, const std::atomic<bool>& ausfall, int frist_ms, int takt_ms = 100) {
  for (int t = 0;; t += takt_ms) {
    if (n.load() >= versuche || n.load() >= 256) return LatenzWarte::Fertig;
    if (ausfall.load()) return LatenzWarte::Ausfall;
#ifndef CYPHERDJ_MUTATION_LATENZ_OHNE_FRIST
    if (t >= frist_ms) return LatenzWarte::Frist;
#endif
    std::this_thread::sleep_for(std::chrono::milliseconds(takt_ms));
  }
}
