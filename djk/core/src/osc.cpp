#include "cypherdj/osc.h"

#include <cstring>

namespace cdj::osc {

static size_t pad4(size_t n) { return (n + 4) & ~(size_t)3; }  // Länge samt Null, auf 4 aufgerundet

static void be32(char* p, uint32_t v) {
  p[0] = (char)(v >> 24); p[1] = (char)(v >> 16); p[2] = (char)(v >> 8); p[3] = (char)v;
}
static void be64(char* p, uint64_t v) {
  be32(p, (uint32_t)(v >> 32));
  be32(p + 4, (uint32_t)v);
}
static uint32_t le_be32(const char* p) {
  const unsigned char* u = (const unsigned char*)p;
  return ((uint32_t)u[0] << 24) | ((uint32_t)u[1] << 16) | ((uint32_t)u[2] << 8) | (uint32_t)u[3];
}
static uint64_t le_be64(const char* p) { return ((uint64_t)le_be32(p) << 32) | le_be32(p + 4); }

Schreiber::Schreiber(const char* adresse, const char* typen) : typen_(typen) {
  text(adresse);
  char komma[64];
  size_t lt = std::strlen(typen);
  if (lt + 2 > sizeof komma) { ok_ = false; return; }
  komma[0] = ',';
  std::memcpy(komma + 1, typen, lt + 1);
  text(komma);
}

void Schreiber::roh(const void* p, size_t n) {
  if (n_ + n > MAX_PAKET) { ok_ = false; return; }
  std::memcpy(buf_ + n_, p, n);
  n_ += n;
}

void Schreiber::text(const char* v) {
  size_t l = std::strlen(v), g = pad4(l);
  if (n_ + g > MAX_PAKET) { ok_ = false; return; }
  std::memcpy(buf_ + n_, v, l);
  std::memset(buf_ + n_ + l, 0, g - l);
  n_ += g;
}

bool Schreiber::naechster(char t) {
  if (typen_[pos_] != t) { ok_ = false; return false; }
  ++pos_;
  return true;
}

Schreiber& Schreiber::s(const char* v) { if (naechster('s')) text(v); return *this; }
Schreiber& Schreiber::i(int32_t v) { if (naechster('i')) { char b[4]; be32(b, (uint32_t)v); roh(b, 4); } return *this; }
Schreiber& Schreiber::h(int64_t v) { if (naechster('h')) { char b[8]; be64(b, (uint64_t)v); roh(b, 8); } return *this; }
Schreiber& Schreiber::f(float v) {
  if (naechster('f')) { uint32_t u; std::memcpy(&u, &v, 4); char b[4]; be32(b, u); roh(b, 4); }
  return *this;
}
Schreiber& Schreiber::d(double v) {
  if (naechster('d')) { uint64_t u; std::memcpy(&u, &v, 8); char b[8]; be64(b, u); roh(b, 8); }
  return *this;
}

// Liest eine null-terminierte Zeichenkette ab o; gibt die Länge samt Auffüllung zurück oder 0 bei Formfehler.
static size_t lies_text(const char* p, size_t laenge, size_t o) {
  if (o >= laenge) return 0;
  const void* null = std::memchr(p + o, '\0', laenge - o);
  if (!null) return 0;
  size_t l = (size_t)((const char*)null - (p + o));
  size_t g = pad4(l);
  return (o + g <= laenge) ? g : 0;
}

bool lesen(const char* p, size_t laenge, Nachricht& n) {
  if (laenge < 8 || (laenge % 4) != 0 || p[0] != '/') return false;  // Bundles beginnen mit '#'
  size_t ga = lies_text(p, laenge, 0);
  if (!ga) return false;
  n.adresse = p;
  size_t o = ga;
  size_t gt = lies_text(p, laenge, o);
  if (!gt || p[o] != ',') return false;
  n.typen = p + o + 1;
  o += gt;
  n.anzahl = 0;
  for (const char* t = n.typen; *t; ++t) {
    if (n.anzahl >= MAX_WERTE) return false;
    Wert& w = n.werte[n.anzahl++];
    w = Wert{*t, 0, 0, 0.0f, 0.0, nullptr};
    switch (*t) {
      case 'i': if (o + 4 > laenge) return false; w.i = (int32_t)le_be32(p + o); o += 4; break;
      case 'f': { if (o + 4 > laenge) return false; uint32_t u = le_be32(p + o); std::memcpy(&w.f, &u, 4); o += 4; break; }
      case 'h': if (o + 8 > laenge) return false; w.h = (int64_t)le_be64(p + o); o += 8; break;
      case 'd': { if (o + 8 > laenge) return false; uint64_t u = le_be64(p + o); std::memcpy(&w.d, &u, 8); o += 8; break; }
      case 's': { size_t g = lies_text(p, laenge, o); if (!g) return false; w.s = p + o; o += g; break; }
      default: return false;
    }
  }
  return o == laenge;
}

}  // namespace cdj::osc
