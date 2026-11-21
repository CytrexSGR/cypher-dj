#include "cypherdj/state_file.h"

#include <fcntl.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>

#include <cerrno>
#include <vector>

namespace cdj {

namespace {

// Takeover of older files. arr-bk: version 3 -> 4 widened the table of controls (2048 -> 4096 rows); container core K2: version 4 -> 5 widened it again
// (4096 -> 8192). The rows of a table keep their place (new rows are appended at the end, and a row carries its path anyway), so everything in front
// of the table has the same offsets and the sections behind it move. The layout of an old file is spelled out here with literal sizes (not derived from
// the current header), so the takeover does not follow a later change of the header by accident: head 64, two subjects of
// 208 + 2 x 64 x 48 + 256 x 256 + rows x 96 + 32 x 144 + 4 x 168 bytes, two subscriber subjects of 32 + 8 x 64.
constexpr std::size_t Z_VOR_REGLER = 208 + 2 * 64 * 48 + 256 * 256;                  // the offset of `regler` inside a subject (the same in versions 3, 4 and 5)
constexpr std::size_t Z_HINTER_REGLER = 32 * 144 + 4 * 168;                           // hoerscheine and decks, behind the table
constexpr std::size_t Z_ABOS = 32 + 8 * 64;
constexpr std::size_t z_echtzeit(std::size_t zeilen) { return Z_VOR_REGLER + zeilen * 96 + Z_HINTER_REGLER; }
constexpr std::size_t z_datei(std::size_t zeilen) { return 64 + 2 * z_echtzeit(zeilen) + 2 * Z_ABOS; }
constexpr std::size_t Z3_REGLER = 2048;
constexpr std::size_t Z4_REGLER = 4096;
static_assert(offsetof(cdj_z_echtzeit, regler) == Z_VOR_REGLER, "the sections in front of the table did not move");
static_assert(offsetof(cdj_z_datei, echtzeit) == 64 && sizeof(cdj_z_abos) == Z_ABOS, "head and subscriber subject as in version 3");
static_assert(sizeof(cdj_z_hoerschein) * CDJ_Z_HOERSCHEINE + sizeof(cdj_z_deck) * CDJ_Z_DECKS == Z_HINTER_REGLER, "sections behind the table as in version 3");
static_assert(CDJ_Z_REGLER >= Z4_REGLER && Z4_REGLER >= Z3_REGLER, "the table only grew");
static_assert(z_datei(CDJ_Z_REGLER) == sizeof(cdj_z_datei), "the literal layout agrees with the current header");

// The old format a file of this size and head stands for: its version and table size, or 0 when it is none of them (not trusted).
struct AltFormat { uint32_t version; std::size_t zeilen; };
AltFormat alt_format(const unsigned char* roh, std::size_t n) {
  for (const AltFormat f : {AltFormat{3u, Z3_REGLER}, AltFormat{4u, Z4_REGLER}}) {
    if (n != z_datei(f.zeilen)) continue;
    uint32_t v, g;
    std::memcpy(&v, roh + 4, 4);
    std::memcpy(&g, roh + 8, 4);
    if (std::memcmp(roh, "CDJZ", 4) == 0 && v == f.version && g == z_datei(f.zeilen)) return f;
  }
  return AltFormat{0u, 0};
}

// Fills `d` (zeroed, the size of the current file) from an old image; the magic is written last, as for a new file.
void uebernimm(cdj_z_datei* d, const unsigned char* roh, const AltFormat& f) {
  auto* aus = reinterpret_cast<unsigned char*>(d);
  std::memcpy(aus + 12, roh + 12, 52);   // the reserve words of the head
  for (std::size_t i = 0; i < 2; ++i) {
    const unsigned char* von = roh + 64 + i * z_echtzeit(f.zeilen);
    unsigned char* nach = reinterpret_cast<unsigned char*>(&d->echtzeit[i]);
    std::memcpy(nach, von, Z_VOR_REGLER + f.zeilen * 96);                         // up to and including the old rows
    std::memcpy(nach + offsetof(cdj_z_echtzeit, hoerscheine), von + Z_VOR_REGLER + f.zeilen * 96, Z_HINTER_REGLER);
  }
  for (std::size_t i = 0; i < 2; ++i) std::memcpy(&d->abos[i], roh + 64 + 2 * z_echtzeit(f.zeilen) + i * Z_ABOS, Z_ABOS);
  d->version = CDJ_ZUSTAND_VERSION;
  d->groesse = sizeof(cdj_z_datei);
  __atomic_thread_fence(__ATOMIC_RELEASE);
  std::memcpy(d->magic, "CDJZ", 4);
}

}  // namespace

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
  std::vector<unsigned char> alt;   // an intact file of version 3 or 4 is taken over instead of being recreated
  AltFormat alt_f{0u, 0};
  if (st.st_size == static_cast<off_t>(z_datei(Z3_REGLER)) || st.st_size == static_cast<off_t>(z_datei(Z4_REGLER))) {
    alt.resize(static_cast<std::size_t>(st.st_size));
    if (pread(fd, alt.data(), alt.size(), 0) != static_cast<ssize_t>(alt.size()) || !(alt_f = alt_format(alt.data(), alt.size())).version) alt.clear();
  }
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
  if (neu_ && !alt.empty()) {
    std::memset(d_, 0, sizeof(cdj_z_datei));
    uebernimm(d_, alt.data(), alt_f);
    neu_ = false;
    meldung_ = "version " + std::to_string(alt_f.version) + " taken over (control table " + std::to_string(alt_f.zeilen) + " -> " + std::to_string(CDJ_Z_REGLER) + ")";
  } else if (neu_) {
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
