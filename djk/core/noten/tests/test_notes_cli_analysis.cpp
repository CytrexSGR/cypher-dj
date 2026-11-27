// The command `analyse` of the program `cypherdj-noten` as a process (NOTEN_PROGRAMM): the sidecar on golden material, the short-source rule
// (kurz.erwartet.json), silent, very short and noisy sources, identical and wide stereo channels, errors, progress lines, SIGTERM.
#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <sys/wait.h>
#include <unistd.h>

#include <chrono>
#include <cmath>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <string>
#include <thread>
#include <variant>
#include <vector>

#include <nlohmann/json.hpp>

#include "detector.h"
#include "check.h"
#include "synth.h"

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
      if (poll(p, 2, 120000) <= 0) break;
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

static json eineZeile(const Lauf& l) {
  size_t n = 0;
  for (char c : l.out) if (c == '\n') ++n;
  PRUEF(n == 1 && !l.out.empty() && l.out.back() == '\n');
  json j = json::parse(l.out, nullptr, false);
  PRUEF(!j.is_discarded());
  return j.is_discarded() ? json::object() : j;
}

static std::string text(const fs::path& p) {
  std::ifstream f(p, std::ios::binary);
  return std::string((std::istreambuf_iterator<char>(f)), std::istreambuf_iterator<char>());
}

static double rundung(double x, double s) { return std::round(x * s) / s; }

static const std::string SHA = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

/// Runs analyse on a stereo source, checks the result line and returns the sidecar (nullopt when it is not valid).
static std::optional<Seitendatei> analyse(const Stereo& s, const char* name, json* zeile = nullptr, Lauf* roh = nullptr) {
  const fs::path q = tmp / (SHA + ".f32"), aus = tmp / (std::string(name) + ".json");
  fs::remove(aus);
  PRUEF(!schreibeF32(q.string(), s));
  const Lauf l = lauf({"analyse", q.string(), aus.string()});
  if (roh) *roh = l;
  if (l.code != 0) std::fprintf(stderr, "%s: exit %d, %s %s\n", name, l.code, l.out.c_str(), l.err.c_str());
  PRUEF(l.code == 0);
  const json z = eineZeile(l);
  if (zeile) *zeile = z;
  PRUEF(z.value("status", "") == "ok" && z.value("datei", "") == aus.string());
  PRUEF(z.contains("noten") && z["noten"].is_number_unsigned() && z.contains("stimmhaft") && z.contains("sekunden") && z["sekunden"].is_number());
  PRUEF(z.size() == 5);
  PRUEF(!fs::exists(aus.string() + ".tmp"));
  auto r = liesSeitendatei(aus.string());
  PRUEF(std::holds_alternative<Seitendatei>(r));
  if (!std::holds_alternative<Seitendatei>(r)) return std::nullopt;
  const Seitendatei& sd = std::get<Seitendatei>(r);
  PRUEF(sd.quelle == SHA);
  PRUEF(sd.k.detektor == "pyin" && sd.k.kurve == "pyin-1.noten_hmm-1");
  PRUEF(sd.k.frames == s.frames());
  PRUEF(static_cast<int64_t>(sd.k.f0_ct.size()) == frameZahl(s.frames()));
  PRUEF(!sd.mono);
  PRUEF(z.value("noten", size_t{999999}) == sd.noten.size());
  PRUEF_NAH(z.value("stimmhaft", -1.0), rundung(sd.stimmhaft_anteil, 1e4), 1e-9);
  return sd;
}

int main() {
  tmp = fs::current_path() / ("noten_cli_analyse_tmp_" + std::to_string(getpid()));
  fs::remove_all(tmp);
  fs::create_directories(tmp);
  const std::string gold = std::string(NOTEN_DATEN) + "/gold/";

  // ---- golden items: the sidecar holds the curve of erkenne (rounded like the file) and the notes of segmentiere on that curve
  for (const char* name : {"stimme_vibrato", "stimme_gleiten_konsonanten", "bass_gehalten", "bass_ende", "saege_legato"}) {
    const auto mono = liesS16(gold + name + ".s16");
    PRUEF(!mono.empty());
    json z;
    Lauf roh;
    const auto sd = analyse(synth::stereoAusMono(mono), name, &z, &roh);
    if (!sd) continue;
    const Kurve k = erkenne(mono, 48000, nullptr);
    PRUEF(sd->k.f0_ct.size() == k.f0_ct.size());
    for (size_t i = 0; i < k.f0_ct.size() && i < sd->k.f0_ct.size(); ++i) {
      PRUEF_NAH(sd->k.f0_ct[i], rundung(k.f0_ct[i], 100.0), 1e-9);
      PRUEF_NAH(sd->k.konf[i], rundung(k.konf[i], 1000.0), 1e-9);
    }
    auto g = liesSeitendatei(gold + name + ".kurve.json");
    const Seitendatei& gd = std::get<Seitendatei>(g);
    PRUEF(!sd->noten.empty());
    if (sd->noten.size() != gd.noten.size()) std::fprintf(stderr, "%s: %zu notes, gold %zu\n", name, sd->noten.size(), gd.noten.size());
    PRUEF(sd->noten.size() == gd.noten.size());
    for (size_t i = 0; i < sd->noten.size() && i < gd.noten.size(); ++i) {
      PRUEF_NAH(sd->noten[i].qa, gd.noten[i].qa, 0.0054);
      PRUEF_NAH(sd->noten[i].qe, gd.noten[i].qe, 0.0054);
      PRUEF_NAH(sd->noten[i].qton, gd.noten[i].qton, 0.02);
    }
    PRUEF_NAH(sd->stimmhaft_anteil, gd.stimmhaft_anteil, 0.005);
    // progress: four stages, ends with schreiben 100, at most ten lines
    size_t zeilen = 0;
    int letzte = 0;
    size_t a = 0;
    while (a < roh.err.size()) {
      size_t e = roh.err.find('\n', a);
      if (e == std::string::npos) e = roh.err.size();
      const std::string l = roh.err.substr(a, e - a);
      a = e + 1;
      if (l.empty()) continue;
      PRUEF(l.rfind("@@fortschritt ", 0) == 0);
      const json j = json::parse(l.substr(14), nullptr, false);
      PRUEF(!j.is_discarded() && j.value("von", 0) == 4 && j.value("stufe", 0) >= letzte && j.value("stufe", 0) <= 4);
      if (!j.is_discarded()) letzte = j.value("stufe", 0);
      const std::string nm = j.is_discarded() ? "" : j.value("name", "");
      PRUEF(nm == "laden" || nm == "tonhoehe" || nm == "noten" || nm == "schreiben");
      ++zeilen;
    }
    PRUEF(zeilen >= 1 && zeilen <= 10);
    std::printf("%-28s %zu notes, voiced %.4f, %zu progress lines\n", name, sd->noten.size(), sd->stimmhaft_anteil, zeilen);
  }

  // ---- short source: what kurz.erwartet.json states (every frame unvoiced, no notes, stimmhaft_anteil 0)
  {
    const auto erwartet = json::parse(text(gold + "kurz.erwartet.json"))["analyse"]["kurve"];
    json z;
    const auto sd = analyse(synth::stereoAusMono(liesS16(gold + "kurz.s16")), "kurz", &z);
    PRUEF(sd.has_value());
    if (sd) {
      PRUEF(sd->k.frames == erwartet["frames"].get<int64_t>());
      PRUEF(sd->k.f0_ct == erwartet["f0_ct"].get<std::vector<double>>());
      PRUEF(sd->k.konf == erwartet["konf"].get<std::vector<double>>());
      PRUEF(sd->noten.empty() && sd->stimmhaft_anteil == 0.0);
      PRUEF(z.value("noten", 1) == 0 && z.value("stimmhaft", 1.0) == 0.0);
    }
  }

  // ---- silent, very short (also shorter than one hop, empty) and noisy sources end ok with no notes
  {
    synth::Ton t{0.0, 1.0, 69.0};
    t.pegel = 0.5;
    const auto ton = synth::melodie({t}, 1.0);
    for (size_t n : {size_t{0}, size_t{1}, size_t{100}, size_t{255}, size_t{9599}}) {
      const std::vector<float> x(ton.begin(), ton.begin() + static_cast<std::ptrdiff_t>(n));
      const auto sd = analyse(synth::stereoAusMono(x), "sehr_kurz");
      PRUEF(sd.has_value());
      if (sd) PRUEF(sd->noten.empty() && sd->stimmhaft_anteil == 0.0);
    }
    for (double sek : {0.1, 3.0}) {
      const auto sd = analyse(synth::stereoAusMono(synth::stille(sek)), "stille");
      PRUEF(sd.has_value());
      if (sd) PRUEF(sd->noten.empty() && sd->stimmhaft_anteil == 0.0);
    }
    const auto sd = analyse(synth::stereoAusMono(synth::rauschen(3.0, -20.0, 5)), "rauschen");
    PRUEF(sd.has_value());
    if (sd) PRUEF(sd->noten.empty() && sd->stimmhaft_anteil <= 0.02);
  }

  // ---- identical channels, and a wide stereo vocal: the curve of analyse is erkenne(mitte(x)), one curve for both channels
  {
    synth::Ton t{0.1, 1.6, 62.0};
    t.vib_ct = 40.0;
    t.mit_huelle = true;
    const auto stimme = synth::melodie({t}, 2.0);
    Stereo zwei = synth::stereoAusMono(stimme);
    Stereo breit;
    breit.l = stimme;
    breit.r = stimme;
    synth::Zufall z(11);
    for (size_t i = 0; i < stimme.size(); ++i) {
      const float r = static_cast<float>(0.3 * z.normal());
      breit.l[i] += r;
      breit.r[i] -= r;
    }
    for (const auto* st : {&zwei, &breit}) {
      const auto sd = analyse(*st, st == &zwei ? "gleich" : "breit");
      PRUEF(sd.has_value());
      if (!sd) continue;
      const Kurve k = erkenne(mitte(*st), 48000, nullptr);
      PRUEF(sd->k.f0_ct.size() == k.f0_ct.size());
      for (size_t i = 0; i < k.f0_ct.size() && i < sd->k.f0_ct.size(); ++i) {
        PRUEF_NAH(sd->k.f0_ct[i], rundung(k.f0_ct[i], 100.0), 1e-9);
        PRUEF_NAH(sd->k.konf[i], rundung(k.konf[i], 1000.0), 1e-9);
      }
      PRUEF(sd->stimmhaft_anteil > 0.7 && sd->noten.size() == 1);
    }
  }

  // ---- the sha from the file name or --sha
  {
    const fs::path q = tmp / "quelle.f32", aus = tmp / "mit_sha.json";
    PRUEF(!schreibeF32(q.string(), synth::stereoAusMono(synth::stille(0.5))));
    const std::string anders(64, '7');
    PRUEF(lauf({"analyse", q.string(), aus.string(), "--sha", anders}).code == 0);
    auto s = liesSeitendatei(aus.string());
    PRUEF(std::holds_alternative<Seitendatei>(s) && std::get<Seitendatei>(s).quelle == anders);
    const Lauf l = lauf({"analyse", q.string(), (tmp / "ohne.json").string()});
    PRUEF(l.code == 2);
    PRUEF(json::parse(l.out).value("fehler", "") == "argument");
    PRUEF(!fs::exists(tmp / "ohne.json"));
  }

  // ---- failures: datei_fehlt (exit 1), datei_kaputt, schreiben, no output file left behind
  {
    const fs::path aus = tmp / "fehler.json";
    const Lauf l = lauf({"analyse", (tmp / (std::string(64, 'b') + ".f32")).string(), aus.string()});
    PRUEF(l.code == 1);
    const json z = eineZeile(l);
    PRUEF(z.value("status", "") == "fehler" && z.value("fehler", "") == "datei_fehlt" && z.size() == 3);
    PRUEF(!fs::exists(aus) && !fs::exists(aus.string() + ".tmp"));
    { std::ofstream(tmp / (std::string(64, 'c') + ".f32"), std::ios::binary) << std::string(12, '\1'); }
    const Lauf k = lauf({"analyse", (tmp / (std::string(64, 'c') + ".f32")).string(), aus.string()});
    PRUEF(k.code == 1 && json::parse(k.out).value("fehler", "") == "datei_kaputt");
    PRUEF(!fs::exists(aus) && !fs::exists(aus.string() + ".tmp"));
    PRUEF(!schreibeF32((tmp / (std::string(64, 'd') + ".f32")).string(), synth::stereoAusMono(synth::stille(0.5))));
    const Lauf w = lauf({"analyse", (tmp / (std::string(64, 'd') + ".f32")).string(), (tmp / "nirgends" / "aus.json").string()});
    PRUEF(w.code == 1 && json::parse(w.out).value("fehler", "") == "schreiben");
  }

  // ---- SIGTERM during the detector: exit 143, nothing on stdout, no output file, no tmp file
  {
    const fs::path q = tmp / (std::string(64, 'e') + ".f32"), aus = tmp / "abbruch.json";
    synth::Ton t{0.0, 8.0, 60.0};
    t.vib_ct = 30.0;
    const auto m = synth::wiederhole(synth::melodie({t}, 8.0), 240.0);   // the detector needs a few CPU seconds for this
    PRUEF(!schreibeF32(q.string(), synth::stereoAusMono(m)));
    Kind k = starte({"analyse", q.string(), aus.string()});
    std::this_thread::sleep_for(std::chrono::milliseconds(800));
    kill(k.pid, SIGTERM);
    const Lauf l = k.warteEnde();
    if (l.code != 143) std::fprintf(stderr, "SIGTERM: exit %d, out '%s'\n", l.code, l.out.c_str());
    PRUEF(l.code == 143);
    PRUEF(l.out.empty());
    PRUEF(!fs::exists(aus) && !fs::exists(aus.string() + ".tmp"));
  }

  fs::remove_all(tmp);
  PRUEF_ENDE();
}
