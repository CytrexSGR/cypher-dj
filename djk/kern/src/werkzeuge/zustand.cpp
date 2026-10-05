// cypherdj-zustand: liest den Neustart-Zustand (nur lesend, SCHNITTSTELLEN §6.3 „Ausnahme: Prüfstand“) und gibt das
// neueste fertige Echtzeit- und Abonnenten-Fach als eine JSON-Zeile aus. Scheibe 18.
// Aufruf: cypherdj-zustand [<pfad>]   Ohne Pfad: /dev/shm/cypherdj[-$CYPHERDJ_INSTANZ]/zustand.
// Rückgabe 0 gelesen, 1 kein gültiges Echtzeit-Fach, 2 Datei fehlt oder hat die falsche Größe.
#include <fcntl.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>

#include <cstdio>
#include <cstdlib>
#include <memory>
#include <string>

#include "cypherdj/zustand_datei.h"

int main(int argc, char** argv) {
  const std::string pfad = argc > 1 ? argv[1] : cdj::ZustandDatei::pfad_fuer(std::getenv("CYPHERDJ_INSTANZ"));
  const int fd = open(pfad.c_str(), O_RDONLY);
  struct stat st;
  if (fd < 0 || fstat(fd, &st) != 0 || st.st_size != static_cast<off_t>(sizeof(cdj_z_datei))) {
    std::fprintf(stderr, "%s: fehlt oder falsche Größe\n", pfad.c_str());
    return 2;
  }
  void* p = mmap(nullptr, sizeof(cdj_z_datei), PROT_READ, MAP_SHARED, fd, 0);
  close(fd);
  if (p == MAP_FAILED) return 2;
  const auto* d = static_cast<const cdj_z_datei*>(p);
  auto e = std::make_unique<cdj_z_echtzeit>();
  cdj_z_abos a{};
  const int ie = cdj::z_neuestes(d->echtzeit, *e);
  const int ia = cdj::z_neuestes(d->abos, a);
  std::printf("{\"pfad\":\"%s\",\"version\":%u,\"echtzeit_fach\":%d", pfad.c_str(), d->version, ie);
  if (ie >= 0) {
    std::printf(",\"stand\":%llu,\"generation\":%d,\"anker_sample\":%lld,\"anker_frames\":%u,\"anker_mono_ns\":%lld,"
                "\"quantum\":%u,\"karte\":[",
                (unsigned long long)e->stand, e->generation, (long long)e->anker_sample, e->anker_frames,
                (long long)e->anker_mono_ns, e->quantum);
    for (int i = 0; i < e->n_segmente && i < CDJ_Z_SEGMENTE; ++i) {
      const cdj_z_segment& s = e->segmente[i];
      std::printf("%s{\"s0\":%lld,\"b0\":%.9g,\"bpm0\":%.9g,\"k\":%.9g}", i ? "," : "", (long long)s.s0, s.b0,
                  s.bpm0, s.k);
    }
    std::printf("],\"n_grund\":%d,\"befehle\":[", e->n_grund);
    for (int i = 0; i < e->n_befehle && i < CDJ_Z_BEFEHLE; ++i) {
      const cdj_z_befehl& b = e->befehle[i];
      std::printf("%s{\"id\":%lld,\"quelle\":\"%.47s\",\"art\":%d,\"stand\":%d,\"ist_sample\":%lld,\"ist_beat\":%.9g}",
                  i ? "," : "", (long long)b.id, b.quelle, b.art, b.stand, (long long)b.ist_sample, b.ist_beat);
    }
    std::printf("]");
  }
  std::printf(",\"abo_fach\":%d,\"abonnenten\":[", ia);
  for (int i = 0; ia >= 0 && i < a.n && i < CDJ_Z_ABONNENTEN; ++i)
    std::printf("%s{\"name\":\"%.47s\",\"port\":%d,\"letzte_ns\":%lld}", i ? "," : "", a.a[i].name, a.a[i].port,
                (long long)a.a[i].letzte_ns);
  std::printf("]}\n");
  munmap(p, sizeof(cdj_z_datei));
  return ie >= 0 ? 0 : 1;
}
