// D1 K3 Fix L12: schreibe_freeze (arr_freeze_datei.cpp) führt den Grund eines Schreibfehlers mit. Ein Kind-Prozess setzt
// RLIMIT_FSIZE auf 1 MiB (SIGXFSZ ignoriert, so wird write zu EFBIG) und schreibt eine Freeze-Datei von 2 MiB: der Fehlertext
// nennt strerror(EFBIG), keine Teil-Datei bleibt, die Datei entsteht nicht (vorher: „nicht vollständig geschrieben“).
// Negativ-Kontrolle: ohne Grenze schreibt dasselbe Kind die Datei vollständig. Ein frames größer als der Puffer heißt
// „Puffer kürzer als frames“. Mutation ARR_FREEZE_OHNE_ERRNO (der Grund geht verloren) macht den Test rot.
// Der Kind-Prozess entsteht, bevor ein Faden läuft (fork in einem Prozess mit einem Faden).
#include <signal.h>
#include <sys/resource.h>
#include <sys/wait.h>
#include <unistd.h>

#include <cerrno>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <string>

#include "arr_datei.h"
#include "cypherdj/arr_lader.h"
#include "cypherdj/arrangement.h"
#include "pruef.h"

namespace {

// Im Kind: optional RLIMIT_FSIZE setzen, Freeze schreiben, Ergebnis und Fehlertext über die Röhre zurück
std::string im_kind(const std::string& ordner, int32_t kennung, rlim_t grenze, int64_t frames, int64_t puffer_frames,
                    bool& ok) {
  int r[2];
  if (pipe(r) != 0) return "pipe";
  const pid_t p = fork();
  if (p == 0) {
    close(r[0]);
    if (grenze != RLIM_INFINITY) {
      signal(SIGXFSZ, SIG_IGN);
      const rlimit l{grenze, grenze};
      setrlimit(RLIMIT_FSIZE, &l);
    }
    cdj::ArrFreeze f;
    f.spur = 1;
    f.kennung = kennung;
    f.frames = frames;
    f.daten.assign(static_cast<size_t>(puffer_frames) * 2, 0.5f);
    std::string fehler;
    const bool gut = cdj::schreibe_freeze(ordner, f, fehler);
    const std::string aus = std::string(gut ? "1" : "0") + fehler;
    const ssize_t w = write(r[1], aus.data(), aus.size());
    (void)w;
    _exit(0);
  }
  close(r[1]);
  std::string text;
  char b[512];
  for (ssize_t n; (n = read(r[0], b, sizeof b)) > 0;) text.append(b, static_cast<size_t>(n));
  close(r[0]);
  int st = 0;
  waitpid(p, &st, 0);
  ok = !text.empty() && text[0] == '1';
  return text.empty() ? "" : text.substr(1);
}

size_t teile(const std::string& ordner) {
  size_t n = 0;
  for (const auto& e : std::filesystem::directory_iterator(ordner)) n += e.path().string().find(".teil") != std::string::npos;
  return n;
}

}  // namespace

int main() {
  const char* tmp = std::getenv("TMPDIR");
  arrdatei::Ordner o("test_arr_freeze_datei", tmp && *tmp ? tmp : "/tmp");   // RLIMIT_FSIZE gilt auf jedem Dateisystem
  constexpr int64_t FRAMES = 2 * 1024 * 1024 / 8;                           // 2 MiB Datei
  bool ok = false;
  // EFBIG: die Grenze 1 MiB liegt mitten in der Datei
  const std::string t1 = im_kind(o.pfad, 1, 1024 * 1024, FRAMES, FRAMES, ok);
  std::printf("EFBIG: geschrieben %d, Fehler \"%s\", Teil-Dateien %zu\n", ok, t1.c_str(), teile(o.pfad));
  PRUEF(!ok && t1.find(std::strerror(EFBIG)) != std::string::npos);
  PRUEF(teile(o.pfad) == 0 && !std::filesystem::exists(cdj::freeze_datei(o.pfad, 1, 1)));
  // Negativ-Kontrolle: ohne Grenze vollständig
  const std::string t2 = im_kind(o.pfad, 2, RLIM_INFINITY, FRAMES, FRAMES, ok);
  PRUEF(ok && t2.empty());
  PRUEF(std::filesystem::file_size(cdj::freeze_datei(o.pfad, 1, 2)) == static_cast<uintmax_t>(FRAMES) * 8);
  // frames größer als der Puffer: eigener Grund
  const std::string t3 = im_kind(o.pfad, 3, RLIM_INFINITY, FRAMES + 1, FRAMES, ok);
  std::printf("Puffer zu kurz: geschrieben %d, Fehler \"%s\"\n", ok, t3.c_str());
  PRUEF(!ok && t3.find("Puffer kürzer als frames") != std::string::npos && teile(o.pfad) == 0);
  PRUEF_ENDE();
}
