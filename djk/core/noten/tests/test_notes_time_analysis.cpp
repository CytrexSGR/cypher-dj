// Run time of `analyse`: a 240 second stereo synthetic voice must take at most 12 CPU seconds (process CPU time by getrusage, own process
// plus children; a wall clock never decides). 12 s is the 15 s limit of the spec for the full analysis minus 3 s left for `pruefe`.
// Label ruhig (heavy).
#include <fcntl.h>
#include <sys/resource.h>
#include <sys/wait.h>
#include <unistd.h>

#include <cstdio>
#include <filesystem>
#include <fstream>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "check.h"
#include "synth.h"
#include "intern.h"

using namespace cdj::noten;
namespace fs = std::filesystem;

static double cpu(int wer) {
  rusage r{};
  getrusage(wer, &r);
  return static_cast<double>(r.ru_utime.tv_sec + r.ru_stime.tv_sec) + 1e-6 * static_cast<double>(r.ru_utime.tv_usec + r.ru_stime.tv_usec);
}

int main() {
  const fs::path tmp = fs::current_path() / ("noten_zeit_tmp_" + std::to_string(getpid()));
  fs::remove_all(tmp);
  fs::create_directories(tmp);
  const std::string sha(64, '5');
  const fs::path q = tmp / (sha + ".f32"), aus = tmp / "aus.json", out = tmp / "stdout.txt";

  // eight seconds of a sung melody with vibrato, glides and pauses, repeated to 240 s; the two channels differ (a wide stereo voice)
  {
    std::vector<synth::Ton> n;
    const double midi[8] = {57, 60, 64, 62, 55, 67, 59, 52};
    double t = 0.1;
    for (int i = 0; i < 8; ++i) {
      synth::Ton x;
      x.start_s = t;
      x.dauer_s = 0.8;
      x.midi = midi[i];
      x.midi_ende = (i % 3 == 2) ? midi[i] + 3.0 : -1.0;
      x.vib_ct = 35.0;
      x.mit_huelle = true;
      n.push_back(x);
      t += 0.95;
    }
    const std::vector<float> takt = synth::melodie(n, 8.0);
    std::vector<float> m = synth::wiederhole(takt, 240.0);
    Stereo s;
    s.l = m;
    s.r = m;
    synth::Zufall z(3);
    for (size_t i = 0; i < m.size(); ++i) {
      const float r = static_cast<float>(0.02 * z.normal());
      s.l[i] += r;
      s.r[i] -= r;
    }
    PRUEF(!schreibeF32(q.string(), s));
  }

  const double c0 = cpu(RUSAGE_SELF) + cpu(RUSAGE_CHILDREN);
  const pid_t pid = fork();
  if (pid == 0) {
    const int fd = open(out.c_str(), O_WRONLY | O_CREAT | O_TRUNC, 0600);
    dup2(fd, 1);
    const int nul = open("/dev/null", O_WRONLY);
    dup2(nul, 2);
    execl(NOTEN_PROGRAMM, NOTEN_PROGRAMM, "analyse", q.c_str(), aus.c_str(), static_cast<char*>(nullptr));
    _exit(127);
  }
  int st = 0;
  waitpid(pid, &st, 0);
  const double c1 = cpu(RUSAGE_SELF) + cpu(RUSAGE_CHILDREN);
  PRUEF(WIFEXITED(st) && WEXITSTATUS(st) == 0);

  std::ifstream f(out);
  std::string zeile;
  std::getline(f, zeile);
  const auto j = nlohmann::json::parse(zeile, nullptr, false);
  PRUEF(!j.is_discarded() && j.value("status", "") == "ok");
  const double eigen = j.is_discarded() ? 1e9 : j.value("sekunden", 1e9);
  std::printf("analyse of 240 s stereo: %.2f CPU seconds (getrusage delta), the program reports %.2f, %zu notes, voiced %.3f\n", c1 - c0, eigen,
              j.is_discarded() ? size_t{0} : j.value("noten", size_t{0}), j.is_discarded() ? 0.0 : j.value("stimmhaft", 0.0));
  PRUEF(c1 - c0 <= 12.0);
  PRUEF(eigen <= 12.0);
  PRUEF(j.value("stimmhaft", 0.0) > 0.5);

  auto s = liesSeitendatei(aus.string());
  PRUEF(std::holds_alternative<Seitendatei>(s));
  if (std::holds_alternative<Seitendatei>(s)) PRUEF(std::get<Seitendatei>(s).k.f0_ct.size() == static_cast<size_t>(frameZahl(240 * 48000)));

  fs::remove_all(tmp);
  PRUEF_ENDE();
}
