// The program `cypherdj-noten` as a process: result and error lines, exit codes, progress lines, the command `segment` on golden
// material, SIGTERM. The program is NOTEN_PROGRAMM (the build output next to this test).
#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <unistd.h>

#include <chrono>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <string>
#include <thread>
#include <variant>
#include <vector>

#include <nlohmann/json.hpp>

#include "intern.h"
#include "check.h"
#include "synth.h"

using namespace cdj::noten;
namespace fs = std::filesystem;
using json = nlohmann::json;

static fs::path tmp;

struct Lauf {
  int code = -1;       // exit code, or 128 + signal when the process was killed by one
  std::string out, err;
};

/// A started process with its two output pipes; `warteEnde` collects both until it exits.
struct Kind {
  pid_t pid = -1;
  int fdOut = -1, fdErr = -1;
  Lauf warteEnde() {
    Lauf l;
    bool offen[2] = {true, true};
    int fds[2] = {fdOut, fdErr};
    std::string* ziel[2] = {&l.out, &l.err};
    while (offen[0] || offen[1]) {
      pollfd p[2] = {{fds[0], POLLIN, 0}, {fds[1], POLLIN, 0}};
      for (int i = 0; i < 2; ++i) if (!offen[i]) p[i].fd = -1;
      if (poll(p, 2, 30000) <= 0) break;
      for (int i = 0; i < 2; ++i) {
        if (!offen[i] || !(p[i].revents & (POLLIN | POLLHUP))) continue;
        char b[4096];
        const ssize_t n = read(fds[i], b, sizeof b);
        if (n > 0) ziel[i]->append(b, static_cast<size_t>(n)); else offen[i] = false;
      }
    }
    close(fdOut);
    close(fdErr);
    int st = 0;
    waitpid(pid, &st, 0);
    l.code = WIFEXITED(st) ? WEXITSTATUS(st) : 128 + WTERMSIG(st);
    return l;
  }
};

static Kind starte(const std::vector<std::string>& args) {
  int o[2], e[2];
  PRUEF(pipe(o) == 0 && pipe(e) == 0);
  Kind k;
  k.pid = fork();
  if (k.pid == 0) {
    dup2(o[1], 1);
    dup2(e[1], 2);
    close(o[0]); close(o[1]); close(e[0]); close(e[1]);
    std::vector<char*> av;
    std::string prog = NOTEN_PROGRAMM;
    av.push_back(prog.data());
    std::vector<std::string> kopie = args;
    for (auto& a : kopie) av.push_back(a.data());
    av.push_back(nullptr);
    execv(prog.c_str(), av.data());
    _exit(127);
  }
  close(o[1]);
  close(e[1]);
  k.fdOut = o[0];
  k.fdErr = e[0];
  return k;
}

static Lauf lauf(const std::vector<std::string>& args) { return starte(args).warteEnde(); }

static size_t zeilen(const std::string& s) { size_t n = 0; for (char c : s) if (c == '\n') ++n; return n; }

/// stdout must be exactly one compact JSON line ending in one LF.
static json eineZeile(const Lauf& l) {
  PRUEF(zeilen(l.out) == 1 && !l.out.empty() && l.out.back() == '\n' && l.out.find('\r') == std::string::npos);
  json j = json::parse(l.out, nullptr, false);
  PRUEF(!j.is_discarded());
  return j.is_discarded() ? json::object() : j;
}

static void fehlerErwartet(const Lauf& l, int code, const char* name) {
  if (l.code != code) std::fprintf(stderr, "expected exit %d (%s), got %d: %s\n", code, name, l.code, l.out.c_str());
  PRUEF(l.code == code);
  const json j = eineZeile(l);
  PRUEF(j.value("status", "") == "fehler");
  if (j.value("fehler", "") != name) std::fprintf(stderr, "expected code %s, got %s\n", name, l.out.c_str());
  PRUEF(j.value("fehler", "") == name);
  PRUEF(j.contains("text") && j["text"].is_string() && !j["text"].get<std::string>().empty());
  PRUEF(j.size() == 3);
}

static std::string text(const fs::path& p) {
  std::ifstream f(p, std::ios::binary);
  return std::string((std::istreambuf_iterator<char>(f)), std::istreambuf_iterator<char>());
}

/// The progress lines of a stderr text: every `@@fortschritt` line parsed and checked against the form of the contract.
static std::vector<json> fortschritt(const std::string& err, int von) {
  std::vector<json> z;
  size_t a = 0;
  while (a < err.size()) {
    size_t e = err.find('\n', a);
    if (e == std::string::npos) e = err.size();
    const std::string l = err.substr(a, e - a);
    a = e + 1;
    if (l.empty()) continue;
    PRUEF(l.rfind("@@fortschritt ", 0) == 0);
    json j = json::parse(l.substr(14), nullptr, false);
    PRUEF(!j.is_discarded() && j.is_object());
    if (j.is_discarded() || !j.is_object()) continue;
    PRUEF(j.value("von", 0) == von);
    PRUEF(j.value("stufe", 0) >= 1 && j.value("stufe", 0) <= von);
    PRUEF(j.value("prozent", -1.0) >= 0 && j.value("prozent", 101.0) <= 100);
    const std::string n = j.value("name", "");
    PRUEF(n == "laden" || n == "tonhoehe" || n == "noten" || n == "pruefen" || n == "rendern" || n == "schreiben");
    z.push_back(j);
  }
  return z;
}

/// A gold item as a stereo f32 file and as an external curve.
static void golden(const std::string& name, const fs::path& f32, const fs::path& roh) {
  const std::string gold = std::string(NOTEN_DATEN) + "/gold/";
  const auto mono = liesS16(gold + name + ".s16");
  PRUEF(!mono.empty());
  PRUEF(!schreibeF32(f32.string(), synth::stereoAusMono(mono)));
  const json k = json::parse(text(gold + name + ".kurve.json"));
  json r;
  r["format"] = "cdj-noten-kurve-roh/1";
  r["frames"] = k["frames"];
  r["sr"] = k["sr"];
  r["hop"] = k["hop"];
  r["detektor"] = "netz";
  r["detektor_version"] = "netz-1";
  r["f0_ct"] = k["f0_ct"];
  r["konf"] = k["konf"];
  std::ofstream(roh) << r.dump();
}

int main() {
  tmp = fs::current_path() / ("noten_cli_tmp_" + std::to_string(getpid()));
  fs::remove_all(tmp);
  fs::create_directories(tmp);
  const std::string gold = std::string(NOTEN_DATEN) + "/gold/";

  // ---- version
  {
    const Lauf l = lauf({"version"});
    PRUEF(l.code == 0 && l.err.empty());
    PRUEF(l.out == "{\"status\":\"ok\",\"programm\":\"cypherdj-noten\",\"vertrag\":1,\"detektor\":\"pyin-1\",\"segmentierer\":\"noten_hmm-1\",\"maschine\":\"teilton-2\"}\n");
  }

  // ---- usage errors: exit 2, one error line
  fehlerErwartet(lauf({}), 2, "argument");
  fehlerErwartet(lauf({"gibtsnicht"}), 2, "argument");
  fehlerErwartet(lauf({"version", "extra"}), 2, "argument");
  fehlerErwartet(lauf({"render"}), 2, "argument");
  fehlerErwartet(lauf({"analyse", "a"}), 2, "argument");
  fehlerErwartet(lauf({"segment", "a", "b"}), 2, "argument");
  fehlerErwartet(lauf({"pruefe", "a"}), 2, "argument");
  fehlerErwartet(lauf({"render", "q.f32", "k.json", "a.json", "aus.f32", "--nur", "t1"}), 2, "argument");   // --nur without --vorher
  fehlerErwartet(lauf({"render", "q.f32", "k.json", "a.json", "aus.f32", "--vorher"}), 2, "argument");     // option without value
  fehlerErwartet(lauf({"analyse", "q.f32", "aus.json", "--mist", "1"}), 2, "argument");
  fehlerErwartet(lauf({"segment", "q.f32", "roh.json", "aus.json"}), 2, "argument");                      // no sha in the name, no --sha
  fehlerErwartet(lauf({"segment", "q.f32", "roh.json", "aus.json", "--sha", "ABC"}), 2, "argument");
  fehlerErwartet(lauf({"segment", "q.f32", "roh.json", "aus.json", "--sha", std::string(64, 'A')}), 2, "argument");   // upper case

  // ---- segment on golden material: the sidecar holds what the library computes, plus the fields of the command
  const std::string sha = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  for (const char* name : {"saege_legato", "stimme_vibrato", "bass_ende", "stille", "rauschen"}) {
    const fs::path q = tmp / (sha + ".f32"), roh = tmp / "roh.json", aus = tmp / (std::string(name) + ".json");
    golden(name, q, roh);
    const Lauf l = lauf({"segment", q.string(), roh.string(), aus.string()});
    if (l.code != 0) std::fprintf(stderr, "%s: exit %d, %s %s\n", name, l.code, l.out.c_str(), l.err.c_str());
    PRUEF(l.code == 0);
    const json z = eineZeile(l);
    PRUEF(z.value("status", "") == "ok" && z.value("datei", "") == aus.string());
    PRUEF(z.contains("noten") && z["noten"].is_number_unsigned() && z.contains("stimmhaft") && z.contains("sekunden") && z["sekunden"].is_number());
    PRUEF(z.value("stimmhaft", -1.0) >= 0 && z.value("stimmhaft", 2.0) <= 1);
    PRUEF(z.size() == 5);
    PRUEF(!fs::exists(aus.string() + ".tmp"));
    // progress: three stages, each with 0 and 100, in order, at most ten lines per second (a run of this size is far below)
    const auto fz = fortschritt(l.err, 3);
    PRUEF(!fz.empty() && fz.size() <= 10);
    if (!fz.empty()) PRUEF(fz.back().value("name", "") == "schreiben" && fz.back().value("prozent", 0.0) == 100);
    int letzte = 0;
    for (const auto& j : fz) { PRUEF(j.value("stufe", 0) >= letzte); letzte = j.value("stufe", 0); }

    auto s = liesSeitendatei(aus.string());
    PRUEF(std::holds_alternative<Seitendatei>(s));
    if (!std::holds_alternative<Seitendatei>(s)) continue;
    const Seitendatei& sd = std::get<Seitendatei>(s);
    auto g = liesSeitendatei(gold + name + ".kurve.json");
    const Seitendatei& gd = std::get<Seitendatei>(g);
    PRUEF(sd.quelle == sha);
    PRUEF(sd.k.detektor == "netz" && sd.k.kurve == "netz-1.noten_hmm-1");
    PRUEF(sd.k.frames == gd.k.frames && sd.k.f0_ct == gd.k.f0_ct && sd.k.konf == gd.k.konf);
    PRUEF(!sd.mono);
    PRUEF(sd.noten.size() == gd.noten.size() && z.value("noten", size_t{999}) == sd.noten.size());
    PRUEF_NAH(sd.stimmhaft_anteil, gd.stimmhaft_anteil, 1e-4);
    PRUEF_NAH(z.value("stimmhaft", -1.0), sd.stimmhaft_anteil, 1e-9);
    std::printf("%-16s %2zu notes, exit %d, %zu progress lines\n", name, sd.noten.size(), l.code, fz.size());
  }

  // the sha from the file name, or --sha
  {
    const fs::path q = tmp / "quelle.f32", roh = tmp / "roh2.json", aus = tmp / "mit_sha.json";
    golden("saege_legato", q, roh);
    const std::string anders(64, '7');
    const Lauf l = lauf({"segment", q.string(), roh.string(), aus.string(), "--sha", anders});
    PRUEF(l.code == 0);
    auto s = liesSeitendatei(aus.string());
    PRUEF(std::holds_alternative<Seitendatei>(s) && std::get<Seitendatei>(s).quelle == anders);
  }

  // short source: the gold notes of `kurz` are not what the command writes (kurz.erwartet.json: no notes)
  {
    const fs::path q = tmp / (sha + ".f32"), roh = tmp / "roh_kurz.json", aus = tmp / "kurz.json";
    golden("kurz", q, roh);
    const auto erwartet = json::parse(text(gold + "kurz.erwartet.json"));
    PRUEF(erwartet["segment"]["noten"].empty());
    const Lauf l = lauf({"segment", q.string(), roh.string(), aus.string()});
    PRUEF(l.code == 0);
    const json z = eineZeile(l);
    PRUEF(z.value("noten", 1) == 0);
    auto s = liesSeitendatei(aus.string());
    PRUEF(std::holds_alternative<Seitendatei>(s) && std::get<Seitendatei>(s).noten.empty());
  }

  // ---- failures of segment: code, exit 1, no output file
  {
    const fs::path q = tmp / (sha + ".f32"), roh = tmp / "roh3.json", aus = tmp / "fehler.json";
    golden("saege_legato", q, roh);
    auto keinAus = [&] { PRUEF(!fs::exists(aus) && !fs::exists(aus.string() + ".tmp")); };
    fehlerErwartet(lauf({"segment", (tmp / (std::string(64, 'b') + ".f32")).string(), roh.string(), aus.string()}), 1, "datei_fehlt");
    fehlerErwartet(lauf({"segment", q.string(), (tmp / "nirgends.json").string(), aus.string()}), 1, "datei_fehlt");
    keinAus();
    { std::ofstream(tmp / (std::string(64, 'c') + ".f32"), std::ios::binary) << std::string(12, '\1'); }
    fehlerErwartet(lauf({"segment", (tmp / (std::string(64, 'c') + ".f32")).string(), roh.string(), aus.string()}), 1, "datei_kaputt");
    { std::ofstream(tmp / "kaputt.json") << "{\"format\": "; }
    fehlerErwartet(lauf({"segment", q.string(), (tmp / "kaputt.json").string(), aus.string()}), 1, "datei_kaputt");
    json r = json::parse(text(roh));
    r["extra"] = 1;
    { std::ofstream(tmp / "form.json") << r.dump(); }
    fehlerErwartet(lauf({"segment", q.string(), (tmp / "form.json").string(), aus.string()}), 1, "format");
    // a curve of another length than the source
    const Stereo ein = synth::stereoAusMono(std::vector<float>(48000, 0.0f));
    PRUEF(!schreibeF32((tmp / (std::string(64, 'd') + ".f32")).string(), ein));
    fehlerErwartet(lauf({"segment", (tmp / (std::string(64, 'd') + ".f32")).string(), roh.string(), aus.string()}), 1, "kurve_passt_nicht");
    keinAus();
    fehlerErwartet(lauf({"segment", q.string(), roh.string(), (tmp / "nirgends" / "aus.json").string()}), 1, "schreiben");
    PRUEF(!fs::exists(tmp / "nirgends"));
  }

  // ---- SIGTERM: a source that does not end (a pipe) holds the program in its read; the signal ends it with 143, no output, no tmp file
  {
    const fs::path fifo = tmp / (sha + ".f32"), roh = tmp / "roh4.json", aus = tmp / "abbruch.json";
    fs::remove(fifo);
    golden("saege_legato", tmp / "hilfe.f32", roh);
    PRUEF(mkfifo(fifo.c_str(), 0600) == 0);
    Kind k = starte({"segment", fifo.string(), roh.string(), aus.string()});
    const int w = open(fifo.c_str(), O_WRONLY);   // blocks until the program has opened its end: it is in liesF32 then
    PRUEF(w >= 0);
    const char acht[8] = {0, 0, 0, 0, 0, 0, 0, 0};
    PRUEF(write(w, acht, sizeof acht) == 8);
    std::this_thread::sleep_for(std::chrono::milliseconds(200));   // the program is blocked in read
    kill(k.pid, SIGTERM);
    const Lauf l = k.warteEnde();
    close(w);
    if (l.code != 143) std::fprintf(stderr, "SIGTERM: exit %d, out '%s'\n", l.code, l.out.c_str());
    PRUEF(l.code == 143);
    PRUEF(l.out.empty());
    PRUEF(!fs::exists(aus) && !fs::exists(aus.string() + ".tmp"));
    fs::remove(fifo);
  }

  fs::remove_all(tmp);
  PRUEF_ENDE();
}
