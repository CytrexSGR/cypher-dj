#include "cypherdj/zustand_datei.h"

#include <fcntl.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>

#include <cerrno>

namespace cdj {

bool z_lies_befehle(const cdj_z_datei* d, cdj_z_befehl* befehle, int& n) noexcept {
  constexpr std::size_t KOPF = offsetof(cdj_z_echtzeit, segmente);
  for (int runde = 0; runde < 100; ++runde) {
    alignas(8) unsigned char k[2][KOPF];
    uint64_t seq[2], stand[2] = {0, 0};
    for (int i = 0; i < 2; ++i) {
      seq[i] = z_lies_roh(&d->echtzeit[i].seq, &d->echtzeit[i], k[i], KOPF, 100);
      if (!(seq[i] & 1u)) std::memcpy(&stand[i], k[i] + offsetof(cdj_z_echtzeit, stand), sizeof stand[i]);
    }
    const int b = stand[1] > stand[0] ? 1 : 0;
    if (stand[b] == 0) return false;
    int32_t m;
    std::memcpy(&m, k[b] + offsetof(cdj_z_echtzeit, n_befehle), sizeof m);
    if (m < 0 || m > CDJ_Z_BEFEHLE) return false;
    const cdj_z_echtzeit& f = d->echtzeit[b];
    std::memcpy(befehle, f.befehle, sizeof(cdj_z_befehl) * static_cast<std::size_t>(m));
    __atomic_thread_fence(__ATOMIC_ACQUIRE);
    if (__atomic_load_n(&f.seq, __ATOMIC_RELAXED) == seq[b]) {
      n = m;
      return true;
    }
  }
  return false;
}

std::string ZustandDatei::pfad_fuer(const char* instanz) {
  return (instanz && *instanz) ? std::string("/dev/shm/cypherdj-") + instanz + "/zustand"
                               : std::string("/dev/shm/cypherdj/zustand");
}

bool ZustandDatei::oeffne(const std::string& pfad) {
  const std::size_t schnitt = pfad.rfind('/');
  if (schnitt != std::string::npos && schnitt > 0) {
    const std::string ordner = pfad.substr(0, schnitt);
    if (mkdir(ordner.c_str(), 0700) != 0 && errno != EEXIST) {
      meldung_ = ordner + ": " + std::strerror(errno);
      return false;
    }
  }
  const int fd = open(pfad.c_str(), O_RDWR | O_CREAT, 0600);
  if (fd < 0) {
    meldung_ = pfad + ": " + std::strerror(errno);
    return false;
  }
  struct stat st;
  fstat(fd, &st);
  const off_t soll = static_cast<off_t>(sizeof(cdj_z_datei));
  neu_ = false;
  if (st.st_size != soll) {
    neu_ = true;
    meldung_ = st.st_size == 0 ? "neu angelegt"
                               : "Größe " + std::to_string(st.st_size) + " statt " + std::to_string(soll) +
                                     ", neu angelegt";
    if (ftruncate(fd, soll) != 0) {
      meldung_ = pfad + ": ftruncate: " + std::strerror(errno);
      close(fd);
      return false;
    }
  }
  void* p = mmap(nullptr, sizeof(cdj_z_datei), PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
  close(fd);
  if (p == MAP_FAILED) {
    meldung_ = pfad + ": mmap: " + std::strerror(errno);
    return false;
  }
  d_ = static_cast<cdj_z_datei*>(p);
  if (!neu_ && (std::memcmp(d_->magic, "CDJZ", 4) != 0 || d_->version != CDJ_ZUSTAND_VERSION ||
                d_->groesse != sizeof(cdj_z_datei))) {
    neu_ = true;
    meldung_ = "Kopf passt nicht (Version " + std::to_string(d_->version) + "), neu angelegt";
  }
  if (neu_) {
    std::memset(d_, 0, sizeof(cdj_z_datei));
    d_->version = CDJ_ZUSTAND_VERSION;
    d_->groesse = sizeof(cdj_z_datei);
    __atomic_thread_fence(__ATOMIC_RELEASE);
    std::memcpy(d_->magic, "CDJZ", 4);  // zuletzt: erst dann gilt der Kopf
  } else {
    meldung_ = "vorhanden";
  }
  if (mlock(d_, sizeof(cdj_z_datei)) != 0) meldung_ += std::string(", mlock: ") + std::strerror(errno);
  return true;
}

ZustandDatei::~ZustandDatei() {
  if (d_) munmap(d_, sizeof(cdj_z_datei));
}

}  // namespace cdj
