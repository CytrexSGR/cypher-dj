// cypherdj-mitschnitt (Paket K3, Spec D1 A7 Schritt 2): Master-Mitschnitt aus dem Audio-Ring eines laufenden Kerns, nur
// lesend (/dev/shm/cypherdj[-$CYPHERDJ_INSTANZ]/bus, INTERFACES §6.1). Liest ab jetzt alle 20 ms, was der Kern neu
// geschrieben hat, sekunden lang, und schreibt Master L/R als rohes f32 Stereo. s0 ist das Kern-Sample des ersten
// Frames (über sample_minus_w), grenze eine Blockgrenze (für die Blockphase).
// Aufruf: cypherdj-mitschnitt --sekunden S --aus <datei.f32> [--ring pfad]
// Ausgabe (stdout, eine Zeile): {"datei","s0","frames","grenze"}
// Rückgabe: 0 geschrieben, 2 Aufruf (Fix L8: auch ein Wert, der keine Zahl ist, und eine ungültige CYPHERDJ_INSTANZ, je mit
// Text), 3 Ring fehlt oder ungültig, 4 ueberlauf oder sprung, 5 Schreiben, 6 der Ring steht
// (w bewegt sich 1 s lang nicht: kein Kern).
#include <fcntl.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>

#include "cypherdj/aufruf_zahl.h"
#include "cypherdj/instanz.h"
#include "cypherdj/json_text.h"
#include "cypherdj/ring_mitschnitt.h"

int main(int argc, char** argv) {
  if (!cdj::instanz_gueltig("cypherdj-mitschnitt")) return 2;   // Fix L8: mit Hinweis
  double sekunden = 0.0;
  std::string aus, ring_pfad;
  for (int i = 1; i < argc; ++i) {
    const bool wert = i + 1 < argc;
    if (!std::strcmp(argv[i], "--sekunden") && wert) {
      if (!cdj::lies_zahl(argv[++i], sekunden))   // Fix L8: streng, „0.1x“ ist kein Wert
        return cdj::wert_falsch("cypherdj-mitschnitt", "--sekunden", argv[i], "endliche Zahl");
    } else if (!std::strcmp(argv[i], "--aus") && wert) {
      aus = argv[++i];
    } else if (!std::strcmp(argv[i], "--ring") && wert) {
      ring_pfad = argv[++i];
    } else {
      sekunden = -1.0;
    }
  }
  if (!(sekunden > 0.0 && sekunden <= 600.0) || aus.empty()) {
    std::fprintf(stderr, "Aufruf: cypherdj-mitschnitt --sekunden 0..600 --aus <datei.f32> [--ring pfad]\n");
    return 2;
  }
  if (ring_pfad.empty()) {
    char ordner[128];
    cdj_shm_ordner(ordner, sizeof ordner, cdj_instanz());
    ring_pfad = std::string(ordner) + "/bus";
  }
  const int fd = open(ring_pfad.c_str(), O_RDONLY | O_CLOEXEC);
  struct stat st;
  if (fd < 0 || fstat(fd, &st) != 0 || st.st_size != static_cast<off_t>(CDJ_RING_BYTES)) {
    std::fprintf(stderr, "%s: fehlt oder kein Ring der Version 1\n", ring_pfad.c_str());
    return 3;
  }
  void* p = mmap(nullptr, CDJ_RING_BYTES, PROT_READ, MAP_SHARED, fd, 0);
  close(fd);
  if (p == MAP_FAILED) return 3;
  const auto* ring = static_cast<const cdj_ring_kopf*>(p);
  cdj::RingLeser leser(ring);
  cdj::RingMitschnitt m;
  if (!leser.lies(m)) {
    std::fprintf(stderr, "%s: %s\n", ring_pfad.c_str(), m.fehler.c_str());
    return 3;
  }
  const size_t ziel = static_cast<size_t>(sekunden * 48000.0);
  size_t vorher = 0;
  int still = 0;
  while (m.l.size() < ziel) {
    const timespec t{0, 20 * 1000 * 1000};
    nanosleep(&t, nullptr);
    if (!leser.lies(m)) {
      std::fprintf(stderr, "%s: %s nach %zu Frames\n", ring_pfad.c_str(), m.fehler.c_str(), m.l.size());
      return 4;
    }
    still = m.l.size() == vorher ? still + 1 : 0;
    vorher = m.l.size();
    if (still >= 50) {
      std::fprintf(stderr, "%s: w steht seit 1 s\n", ring_pfad.c_str());
      return 6;
    }
  }
  FILE* d = std::fopen(aus.c_str(), "wb");
  bool ok = d != nullptr;
  for (size_t i = 0; ok && i < m.l.size(); ++i) {
    const float f[2] = {m.l[i], m.r[i]};
    ok = std::fwrite(f, sizeof f, 1, d) == 1;
  }
  if (d && std::fclose(d) != 0) ok = false;
  if (!ok) {
    std::fprintf(stderr, "%s: nicht geschrieben\n", aus.c_str());
    return 5;
  }
  std::printf("{\"datei\":%s,\"s0\":%lld,\"frames\":%zu,\"grenze\":%lld}\n", cdj::json_text(aus).c_str(),
              (long long)m.s0, m.l.size(), (long long)m.grenze);   // Fix L7: maskiert
  return 0;
}
