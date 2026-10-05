// OSC 1.0 kodieren und lesen, ohne liblo (SCHNITTSTELLEN.md §19.4). Vorlage: proben/02-uhr-sync-planer/kern/uhrkern.cpp
// Z. 322 ff. Typen: s (Zeichenkette), i (int32), h (int64), f (float32), d (float64), alle Big Endian, 4-Byte-Raster.
// Keine Allokation: Schreiber und Leser arbeiten auf festen Puffern.
#pragma once

#include <cstddef>
#include <cstdint>

#include "osc_adressen.h"  // erzeugt aus djk/vertrag/osc.json (Scheibe 02); Include-Pfad djk/vertrag

namespace cdj::osc {

constexpr size_t MAX_PAKET = 1400;  // SCHNITTSTELLEN.md §2: UDP-Pakete höchstens 1 400 Bytes
constexpr int MAX_WERTE = 32;  // Scheibe 3: /erz/ev mit Parameter-Schwanz (7 + 2 · n)

class Schreiber {
 public:
  // typen ohne führendes Komma, z. B. "hsihds"; jeder folgende Aufruf muss zum nächsten Typ passen
  Schreiber(const char* adresse, const char* typen);
  // Adresse und Typen aus dem Vertrag (Scheibe 08): Schreiber(cypherdj::osc::q) statt Schreiber("/q", "hsihds").
  // Die string_views in osc_adressen.h zeigen auf Literale, sind also nullterminiert.
  explicit Schreiber(const cypherdj::osc::Adresse& a) : Schreiber(a.pfad.data(), a.typen.data() + 1) {}
  Schreiber& s(const char* v);
  Schreiber& i(int32_t v);
  Schreiber& h(int64_t v);
  Schreiber& f(float v);
  Schreiber& d(double v);
  // true, wenn alle Typen in Reihenfolge geschrieben wurden und nichts übergelaufen ist
  bool ok() const { return ok_ && typen_[pos_] == '\0'; }
  const char* daten() const { return buf_; }
  size_t groesse() const { return n_; }

 private:
  bool naechster(char t);
  void roh(const void* p, size_t n);
  void text(const char* v);
  char buf_[MAX_PAKET];
  size_t n_ = 0;
  const char* typen_;
  int pos_ = 0;
  bool ok_ = true;
};

struct Wert {
  char typ;
  int32_t i;
  int64_t h;
  float f;
  double d;
  const char* s;  // zeigt in das gelesene Paket
};

struct Nachricht {
  const char* adresse;  // zeigt in das Paket
  const char* typen;    // ohne Komma, zeigt in das Paket
  int anzahl;
  Wert werte[MAX_WERTE];
};

// Liest ein Paket. false bei Formfehler (fehlendes Komma, abgeschnittene Werte, unbekannter Typ, Bundle).
bool lesen(const char* paket, size_t laenge, Nachricht& n);

}  // namespace cdj::osc
