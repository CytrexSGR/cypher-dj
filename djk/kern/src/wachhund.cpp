#include "cypherdj/wachhund.h"

#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>

#include <cstddef>
#include <cstdlib>
#include <cstring>

namespace cdj {

bool sd_melde(const char* text) noexcept {
  const char* s = std::getenv("NOTIFY_SOCKET");
  if (!s || !*s) return false;
  sockaddr_un a{};
  a.sun_family = AF_UNIX;
  const std::size_t n = std::strlen(s);
  if (n >= sizeof a.sun_path) return false;
  std::memcpy(a.sun_path, s, n);
  if (a.sun_path[0] == '@') a.sun_path[0] = 0;  // abstrakter Namensraum
  const int fd = socket(AF_UNIX, SOCK_DGRAM | SOCK_CLOEXEC, 0);
  if (fd < 0) return false;
  const ssize_t r = sendto(fd, text, std::strlen(text), 0, reinterpret_cast<sockaddr*>(&a),
                           static_cast<socklen_t>(offsetof(sockaddr_un, sun_path) + n));
  close(fd);
  return r >= 0;
}

int64_t Wachhund::aus_umgebung() {
  const char* w = std::getenv("WATCHDOG_USEC");
  return w ? std::atoll(w) : 0;
}

bool Wachhund::pruefe(uint64_t zyklen) noexcept {
  const bool fortschritt = !erste_ && zyklen != letzte_;
  erste_ = false;
  letzte_ = zyklen;
  if (!fortschritt) {
    ++ohne_;
    return false;
  }
  if (usec_ <= 0 || !sd_melde("WATCHDOG=1")) return false;
  ++gemeldet_;
  return true;
}

}  // namespace cdj
