// The command `cypherdj-noten pruefe <quelle.f32> <kurve.json>` as a process: it rewrites the sidecar with `mono` and keeps every other
// field, the ok line, the short-source rule, the failures (no output change), the progress lines and SIGTERM.
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
#include "teiltoene.h"

using namespace cdj::noten;
namespace fs = std::filesystem;
using json = nlohmann::json;

static fs::path tmp;

struct Lauf {
  int code = -1;
  std::string out, err;
};

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
      if (poll(p, 2, 60000) <= 0) break;
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
  PRUEF(j.size() == 3);
}

static std::string text(const fs::path& p) {
  std::ifstream f(p, std::ios::binary);
  return std::string((std::istreambuf_iterator<char>(f)), std::istreambuf_iterator<char>());
}

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
    PRUEF(n == "laden" || n == "pruefen" || n == "schreiben");
    z.push_back(j);
  }
  return z;
}

static const std::string GOLD = std::string(NOTEN_DATEN) + "/gold/";

/// The gold item as a stereo f32 file and its gold sidecar without `mono` (what `analyse` or `segment` leave behind).
static Seitendatei vorbereiten(const std::string& name, const fs::path& f32, const fs::path& sidecar) {
  const auto mono = liesS16(GOLD + name + ".s16");
  PRUEF(!mono.empty());
  PRUEF(!schreibeF32(f32.string(), synth::stereoAusMono(mono)));
  auto s = liesSeitendatei(GOLD + name + ".kurve.json");
  PRUEF(std::holds_alternative<Seitendatei>(s));
  Seitendatei sd = std::get<Seitendatei>(s);
  sd.mono.reset();
  PRUEF(!schreibeSeitendatei(sidecar.string(), sd));
  return sd;
}

int main() {
  tmp = fs::current_path() / ("noten_pruefe_tmp_" + std::to_string(getpid()));
  fs::remove_all(tmp);
  fs::create_directories(tmp);
  const std::string sha = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const json erwartetKurz = json::parse(text(GOLD + "kurz.erwartet.json"));

  // ---- on a gold sidecar: mono is written, every other field is kept
  for (const char* name : {"stimme_vibrato", "bass_gehalten", "saege_legato", "stille", "akkord_terz", "akkord_dreiklang"}) {
    const fs::path q = tmp / (sha + ".f32"), sc = tmp / (std::string(name) + ".json");
    const Seitendatei vorher = vorbereiten(name, q, sc);
    PRUEF(!vorher.mono);
    const Lauf l = lauf({"pruefe", q.string(), sc.string()});
    if (l.code != 0) std::fprintf(stderr, "%s: exit %d, %s %s\n", name, l.code, l.out.c_str(), l.err.c_str());
    PRUEF(l.code == 0);
    const json z = eineZeile(l);
    PRUEF(z.value("status", "") == "ok");
    PRUEF(z.contains("mehrstimmig") && z["mehrstimmig"].is_boolean() && z.contains("anteil") && z["anteil"].is_number());
    PRUEF(z.contains("sekunden") && z["sekunden"].is_number() && z.size() == 4);
    PRUEF(!fs::exists(sc.string() + ".tmp"));

    auto n = liesSeitendatei(sc.string());
    PRUEF(std::holds_alternative<Seitendatei>(n));
    if (!std::holds_alternative<Seitendatei>(n)) continue;
    Seitendatei nach = std::get<Seitendatei>(n);
    PRUEF(nach.mono.has_value());
    auto g = liesSeitendatei(GOLD + name + ".kurve.json");
    const Mono gold = *std::get<Seitendatei>(g).mono;
    const Mono m = nach.mono.value_or(Mono{});
    std::printf("%-18s mono: checked %4lld (gold %4lld) share %.4f (gold %.4f) polyphonic %d, exit %d, CPU %.3f s\n", name,
                static_cast<long long>(m.geprueft_frames), static_cast<long long>(gold.geprueft_frames), m.anteil, gold.anteil, m.mehrstimmig,
                l.code, z.value("sekunden", -1.0));
    PRUEF(m.geprueft_frames == gold.geprueft_frames);
    PRUEF(m.mehrstimmig == gold.mehrstimmig);
    PRUEF_NAH(m.anteil, gold.anteil, 0.03);
    PRUEF(m.hrr_db_schwelle == 9.5 && m.periode_schwelle == 0.5);
    PRUEF(z.value("mehrstimmig", !m.mehrstimmig) == m.mehrstimmig);
    PRUEF_NAH(z.value("anteil", -1.0), m.anteil, 1e-9);
    nach.mono.reset();
    PRUEF(nach == vorher);   // every other field is kept (the file is read back through the same reader)
    const auto fz = fortschritt(l.err, 3);
    PRUEF(!fz.empty() && fz.size() <= 10);
    if (!fz.empty()) PRUEF(fz.back().value("name", "") == "schreiben" && fz.back().value("prozent", 0.0) == 100);
    bool sahPruefen = false;
    int letzte = 0;
    for (const auto& j : fz) { PRUEF(j.value("stufe", 0) >= letzte); letzte = j.value("stufe", 0); sahPruefen |= j.value("name", "") == "pruefen"; }
    PRUEF(sahPruefen);
    if (std::string(name).rfind("akkord", 0) == 0) PRUEF(z.value("mehrstimmig", false) == true);
    else PRUEF(z.value("mehrstimmig", true) == false);
  }

  // ---- a check of an existing mono is rewritten (the second run gives the same result)
  {
    const fs::path q = tmp / (sha + ".f32"), sc = tmp / "zweimal.json";
    vorbereiten("saege_legato", q, sc);
    const Lauf a = lauf({"pruefe", q.string(), sc.string()});
    const std::string erste = text(sc);
    const Lauf b = lauf({"pruefe", q.string(), sc.string()});
    PRUEF(a.code == 0 && b.code == 0);
    PRUEF(text(sc) == erste);
  }

  // ---- short source (kurz): geprueft_frames 0, whatever the library function computes
  {
    const fs::path q = tmp / (sha + ".f32"), sc = tmp / "kurz.json";
    vorbereiten("kurz", q, sc);
    const Lauf l = lauf({"pruefe", q.string(), sc.string()});
    PRUEF(l.code == 0);
    const json z = eineZeile(l);
    PRUEF(z.value("mehrstimmig", true) == false && z.value("anteil", 1.0) == 0.0);
    auto n = liesSeitendatei(sc.string());
    PRUEF(std::holds_alternative<Seitendatei>(n));
    if (std::holds_alternative<Seitendatei>(n)) {
      const Mono m = std::get<Seitendatei>(n).mono.value_or(Mono{.geprueft_frames = -1});
      const json& soll = erwartetKurz["pruefe"]["mono"];
      PRUEF(m.geprueft_frames == soll["geprueft_frames"].get<int64_t>() && m.geprueft_frames == 0);
      PRUEF(m.anteil == soll["anteil"].get<double>());
      PRUEF(m.mehrstimmig == soll["mehrstimmig"].get<bool>());
      PRUEF(m.hrr_db_schwelle == soll["hrr_db_schwelle"].get<double>() && m.periode_schwelle == soll["periode_schwelle"].get<double>());
    }
  }

  // ---- failures: code, exit 1, the sidecar stays as it was, no tmp file
  {
    const fs::path q = tmp / (sha + ".f32"), sc = tmp / "fehler.json";
    vorbereiten("saege_legato", q, sc);
    const std::string vor = text(sc);
    auto unveraendert = [&] { PRUEF(text(sc) == vor && !fs::exists(sc.string() + ".tmp")); };
    fehlerErwartet(lauf({"pruefe", (tmp / "nirgends.f32").string(), sc.string()}), 1, "datei_fehlt");
    fehlerErwartet(lauf({"pruefe", q.string(), (tmp / "nirgends.json").string()}), 1, "datei_fehlt");
    unveraendert();
    { std::ofstream(tmp / "kaputt.f32", std::ios::binary) << std::string(12, '\1'); }
    fehlerErwartet(lauf({"pruefe", (tmp / "kaputt.f32").string(), sc.string()}), 1, "datei_kaputt");
    { std::ofstream(tmp / "kaputt.json") << "{\"format\": "; }
    fehlerErwartet(lauf({"pruefe", q.string(), (tmp / "kaputt.json").string()}), 1, "datei_kaputt");
    json bad = json::parse(vor);
    bad["extra"] = 1;
    { std::ofstream(tmp / "form.json") << bad.dump(); }
    fehlerErwartet(lauf({"pruefe", q.string(), (tmp / "form.json").string()}), 1, "format");
    // a source of another length than the curve
    const fs::path ander = tmp / (std::string(64, 'd') + ".f32");
    PRUEF(!schreibeF32(ander.string(), synth::stereoAusMono(std::vector<float>(48000, 0.0f))));
    fehlerErwartet(lauf({"pruefe", ander.string(), sc.string()}), 1, "kurve_passt_nicht");
    unveraendert();
    // a sidecar of a hop other than the source's (valid file, wrong grid)
    json hop = json::parse(vor);
    hop["hop"] = 512;
    { std::ofstream(tmp / "hop.json") << hop.dump(); }
    const Lauf lh = lauf({"pruefe", q.string(), (tmp / "hop.json").string()});
    PRUEF(lh.code == 1);
    const json zh = json::parse(lh.out, nullptr, false);
    PRUEF(!zh.is_discarded() && (zh.value("fehler", "") == "kurve_passt_nicht" || zh.value("fehler", "") == "format"));
  }

  // ---- SIGTERM while the check runs: exit 143, the sidecar is as before, no tmp file
  {
    const fs::path q = tmp / (sha + ".f32"), sc = tmp / "abbruch.json";
    // a long source: the vibrato item repeated 60 times with its curve repeated the same way
    auto s = liesSeitendatei(GOLD + "stimme_vibrato.kurve.json");
    Seitendatei sd = std::get<Seitendatei>(s);
    const std::vector<float> m1 = liesS16(GOLD + "stimme_vibrato.s16");
    const int wdh = 60;
    std::vector<float> lang;
    for (int i = 0; i < wdh; ++i) lang.insert(lang.end(), m1.begin(), m1.end());
    PRUEF(!schreibeF32(q.string(), synth::stereoAusMono(lang)));
    const int64_t nf = frameZahl(static_cast<int64_t>(lang.size()));
    Kurve k = sd.k;
    k.frames = static_cast<int64_t>(lang.size());
    k.f0_ct.assign(static_cast<size_t>(nf), 0.0);
    k.konf.assign(static_cast<size_t>(nf), 0.0);
    for (int64_t j = 0; j < nf; ++j) {
      const size_t src = static_cast<size_t>(j % static_cast<int64_t>(m1.size() / HOP));
      k.f0_ct[static_cast<size_t>(j)] = sd.k.f0_ct[src];
      k.konf[static_cast<size_t>(j)] = sd.k.konf[src];
    }
    Seitendatei lsd;
    lsd.quelle = sha;
    lsd.k = k;
    lsd.stimmhaft_anteil = stimmhaftAnteil(k);
    PRUEF(!schreibeSeitendatei(sc.string(), lsd));
    const std::string vor = text(sc);
    Kind kind = starte({"pruefe", q.string(), sc.string()});
    // wait for the first line of the stage `pruefen`, then send SIGTERM
    std::string err;
    bool sah = false;
    const auto ende = std::chrono::steady_clock::now() + std::chrono::seconds(60);
    while (!sah && std::chrono::steady_clock::now() < ende) {
      pollfd p = {kind.fdErr, POLLIN, 0};
      if (poll(&p, 1, 200) > 0 && (p.revents & (POLLIN | POLLHUP))) {
        char b[4096];
        const ssize_t n = read(kind.fdErr, b, sizeof b);
        if (n <= 0) break;
        err.append(b, static_cast<size_t>(n));
        sah = err.find("\"name\":\"pruefen\"") != std::string::npos;
      }
    }
    PRUEF(sah);
    std::this_thread::sleep_for(std::chrono::milliseconds(100));
    kill(kind.pid, SIGTERM);
    const Lauf l = kind.warteEnde();
    if (l.code != 143) std::fprintf(stderr, "SIGTERM: exit %d, out '%s'\n", l.code, l.out.c_str());
    PRUEF(l.code == 143);
    PRUEF(l.out.empty());
    PRUEF(text(sc) == vor && !fs::exists(sc.string() + ".tmp"));
  }

  fs::remove_all(tmp);
  PRUEF_ENDE();
}
