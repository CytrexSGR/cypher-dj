// Paket K3 (Spec D1 2.5, 6.14, 6.25, 6.29; arr_lader.h): Freeze-Auftrag anlegen und Freeze-Datei schreiben, im
// Arrangement-Lade-Faden (nie im Callback, nie im Netz-Faden). Die Datei ist rohes f32 Stereo (L und R verschränkt),
// frames · 8 Bytes. Sie entsteht als Temp-Datei und bekommt ihren Namen erst, wenn sie vollständig ist; eine vorhandene
// Datei desselben Namens wird nie ersetzt (renameat2 mit RENAME_NOREPLACE, wo das Dateisystem es nicht kann link() plus
// unlink()). Die Kennung vergibt S3 je Instanz eindeutig (Wiedergabe-Zähler, Spec 6.25); der Kern prüft nur, dass der
// Name noch frei ist.
#include <fcntl.h>
#include <stdio.h>
#include <unistd.h>

#include <cerrno>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <memory>
#include <new>
#include <string>

#include "cypherdj/arr_lader.h"
#include "cypherdj/arrangement.h"

namespace cdj {

std::string freeze_datei(const std::string& ordner, int spur, int32_t kennung) {
  return ordner + "/freeze-" + std::to_string(spur) + "-" + std::to_string(kennung) + ".f32";
}

ArrFreeze* freeze_anlegen(const ArrAuftrag& a, char* grund, size_t n) {
  try {
    auto f = std::make_unique<ArrFreeze>();
    f->spur = a.spur;
    f->kennung = a.kennung;
    f->von_beat = a.von_beat;
    f->bis_beat = a.bis_beat;
    f->kap = static_cast<int64_t>(std::ceil((a.bis_beat - a.von_beat + ARR_FREEZE_NACHLAUF) * 48000.0)) + 2;   // 60 BPM
    f->daten.assign(static_cast<size_t>(f->kap) * 2, 0.0f);   // berührt jede Seite: der Callback hat keine Seitenfehler
    return f.release();
  } catch (const std::bad_alloc&) {
    std::snprintf(grund, n, "zu_gross");
    return nullptr;
  }
}

namespace {

// Ziel nur anlegen, wenn es nicht besteht; false mit errno (EEXIST: besteht)
bool umbenennen_ohne_ersetzen(const std::string& teil, const std::string& ziel) {
#ifdef RENAME_NOREPLACE
  if (renameat2(AT_FDCWD, teil.c_str(), AT_FDCWD, ziel.c_str(), RENAME_NOREPLACE) == 0) return true;
  if (errno != EINVAL && errno != ENOSYS) return false;   // EEXIST oder echter Fehler; sonst kann es das Dateisystem nicht
#endif
  if (link(teil.c_str(), ziel.c_str()) != 0) return false;
  unlink(teil.c_str());
  return true;
}

}  // namespace

bool schreibe_freeze(const std::string& ordner, const ArrFreeze& f, std::string& fehler, bool* besteht) {
  if (besteht) *besteht = false;
  const std::string ziel = freeze_datei(ordner, f.spur, f.kennung);
  const std::string teil = ziel + "." + std::to_string(getpid()) + ".teil";
  FILE* d = std::fopen(teil.c_str(), "wb");
  if (!d) {
    fehler = teil + ": " + std::strerror(errno);
    return false;
  }
  // Fix L12: der Grund jedes Fehlers (errno des fehlgeschlagenen Aufrufs) geht in den Text, etwa EFBIG bei RLIMIT_FSIZE
  const size_t n = static_cast<size_t>(f.frames) * 2;
  const bool passt = n <= f.daten.size();
  int nr = 0;   // errno des ersten Fehlers
  bool geschrieben = passt && std::fwrite(f.daten.data(), sizeof(float), n, d) == n;
  if (passt && !geschrieben) nr = errno;
  const bool zu = std::fclose(d) == 0;   // schreibt den Rest aus dem Puffer: auch hier kann EFBIG kommen
  if (!zu && nr == 0) nr = errno;
#ifdef CYPHERDJ_MUTATION_ARR_FREEZE_OHNE_ERRNO
  nr = 0;   // Fehlerfall L12: der Grund geht verloren
#endif
  geschrieben = geschrieben && zu;
#ifdef CYPHERDJ_MUTATION_ARR_FREEZE_ERSETZT
  const bool benannt = geschrieben && std::rename(teil.c_str(), ziel.c_str()) == 0;   // Fehlerfall: ersetzt still
#else
  const bool benannt = geschrieben && umbenennen_ohne_ersetzen(teil, ziel);
#endif
  if (!benannt) {
    const int e = geschrieben ? errno : nr;
    if (!passt) fehler = ziel + ": Puffer kürzer als frames";
    else if (e != 0) fehler = ziel + ": " + std::strerror(e);
    else fehler = ziel + ": nicht vollständig geschrieben";
    if (besteht && geschrieben && e == EEXIST) *besteht = true;
    std::remove(teil.c_str());
    return false;
  }
  return true;
}

}  // namespace cdj
