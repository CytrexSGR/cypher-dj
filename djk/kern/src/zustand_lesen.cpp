// Paket K3: Neustart-Zustand nur lesend (zustand_lesen.h).
#include "cypherdj/zustand_lesen.h"

#include <fcntl.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>

#include <cerrno>

#include "cypherdj/zustand_datei.h"

namespace cdj {

std::unique_ptr<cdj_z_echtzeit> lies_echtzeit_fach(const std::string& pfad, std::string& fehler, bool* fehlt) {
  if (fehlt) *fehlt = false;
  const int fd = open(pfad.c_str(), O_RDONLY | O_CLOEXEC);
  if (fd < 0 && errno == ENOENT) {
    if (fehlt) *fehlt = true;
    fehler = pfad + ": fehlt";
    return nullptr;
  }
  struct stat st;
  if (fd < 0 || fstat(fd, &st) != 0 || st.st_size != static_cast<off_t>(sizeof(cdj_z_datei))) {
    if (fd >= 0) close(fd);
    fehler = pfad + ": nicht lesbar oder falsche Größe";
    return nullptr;
  }
  void* p = mmap(nullptr, sizeof(cdj_z_datei), PROT_READ, MAP_SHARED, fd, 0);
  close(fd);
  if (p == MAP_FAILED) {
    fehler = pfad + ": mmap gescheitert";
    return nullptr;
  }
  auto f = std::make_unique<cdj_z_echtzeit>();
  const int i = z_neuestes(static_cast<const cdj_z_datei*>(p)->echtzeit, *f);
  munmap(p, sizeof(cdj_z_datei));
  if (i < 0) {
    fehler = pfad + ": kein fertiges Echtzeit-Fach";
    return nullptr;
  }
  return f;
}

}  // namespace cdj
