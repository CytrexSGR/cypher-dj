// Process control: progress lines, the SIGTERM flag, CPU time.
#include <sys/resource.h>

#include <chrono>
#include <cmath>
#include <csignal>
#include <cstdio>

#include "intern.h"

namespace cdj::noten {
namespace {

volatile std::sig_atomic_t g_abbruch = 0;

double jetzt() {
  using namespace std::chrono;
  return duration<double>(steady_clock::now().time_since_epoch()).count();
}

}  // namespace

void abbruchAnfordern() { g_abbruch = 1; }  // called from a signal handler: only a flag
bool abbruchAngefordert() { return g_abbruch != 0; }
void abbruchZuruecksetzen() { g_abbruch = 0; }

double cpuSekunden() {
  rusage r{};
  getrusage(RUSAGE_SELF, &r);
  return static_cast<double>(r.ru_utime.tv_sec + r.ru_stime.tv_sec) + 1e-6 * static_cast<double>(r.ru_utime.tv_usec + r.ru_stime.tv_usec);
}

Fortschritt::Fortschritt(int von) : von_(von < 1 ? 1 : von), gesendet_(10, -1e9) {}

void Fortschritt::stufe(int k, const char* name, double prozent) {
  // sliding window: a line goes out only when the tenth line before it is at least one second old
  const double t = jetzt();
  if (t - gesendet_[naechste_] < 1.0) return;
  gesendet_[naechste_] = t;
  naechste_ = (naechste_ + 1) % gesendet_.size();
  if (k < 1) k = 1;
  if (k > von_) k = von_;
  if (!(prozent >= 0.0)) prozent = 0.0;
  if (prozent > 100.0) prozent = 100.0;
  nlohmann::ordered_json j;
  j["stufe"] = k;
  j["von"] = von_;
  j["name"] = name;
  j["prozent"] = std::round(prozent * 10.0) / 10.0;
  const std::string zeile = "@@fortschritt " + j.dump() + "\n";
  std::fwrite(zeile.data(), 1, zeile.size(), stderr);
  std::fflush(stderr);
}

}  // namespace cdj::noten
