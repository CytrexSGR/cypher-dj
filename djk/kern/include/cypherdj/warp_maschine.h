// Paket 1.13 Warp, Slice 2: die Rechenmaschine einer Warp-Stimme, hinter einer Schnittstelle, damit nur eine Quelle (warp_werk_bungee.cpp, nur mit
// CYPHERDJ_BUNGEE gebaut) Bungee kennt. Eine Maschine rechnet EINE Stimme: ansetzen() setzt sie ab einem Ziel-Sample neu an, block() liefert die
// nächsten WARP_BLOCK Frames des Stroms ab diesem Sample. Position und Geschwindigkeit je Korn fragt sie an der Abbildung der Stimme; das Quellband
// holt sie sich dort ebenso. Alles läuft im Faden des Werks (oder synchron im Render): keine Allokation nach dem Anlegen.
#pragma once

#include <cstdint>
#include <memory>

namespace cdj {

class WarpAbbild {
 public:
  virtual ~WarpAbbild() = default;
  virtual double position(double s) const noexcept = 0;         // Quellframe, der zum Ausgabe-Sample s gehört (gebrochen)
  virtual double geschwindigkeit(double s) const noexcept = 0;  // Quellframes je Ausgabeframe
  virtual double tonhoehe() const noexcept = 0;                 // Slice 5: Frequenzfaktor der Stimme (Bungee Request.pitch), 1 = unverändert
  // n Frames ab Quellframe ab in zwei Felder (planar); außerhalb der Datei Stille
  virtual void band(int64_t ab, int n, float* l, float* r) const noexcept = 0;
};

class WarpMaschine {
 public:
  virtual ~WarpMaschine() = default;
  virtual void ansetzen(const WarpAbbild& a, int64_t s_h) noexcept = 0;
  virtual void block(const WarpAbbild& a, float* l, float* r) noexcept = 0;   // die nächsten 256 Frames
};

// fein: Korn 256 (TONES), sonst Korn 512 (COMPLEX). nullptr ohne Bungee.
std::unique_ptr<WarpMaschine> warp_maschine_bungee_neu(bool fein);

}  // namespace cdj
