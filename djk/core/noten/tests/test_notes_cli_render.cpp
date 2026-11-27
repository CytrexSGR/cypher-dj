// The command `cypherdj-noten render <quelle.f32> <kurve.json> <auftrag.json> <aus.f32> [--vorher <f32> --nur <ids>]` as a process: the
// output has the length of the source and equals the library render, `--vorher` with `--nur` gives the bytes of the full render, the ok
// line, the failures (no output file and no tmp file left), the progress lines and SIGTERM.
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
#include <set>
#include <string>
#include <thread>
#include <variant>
#include <vector>

#include <nlohmann/json.hpp>

#include "intern.h"
#include "check.h"
#include "render.h"
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

static const std::string GOLD = std::string(NOTEN_DATEN) + "/gold/";
static const std::string SHA = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

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
    PRUEF(n == "laden" || n == "rendern" || n == "schreiben");
    z.push_back(j);
  }
  return z;
}

static bool dateiGleich(const fs::path& a, const fs::path& b) { return fs::exists(a) && fs::exists(b) && text(a) == text(b); }

static void schreibe(const fs::path& p, const std::string& s) { std::ofstream(p, std::ios::binary) << s; }

static json auftragMit(const json& basis, const std::set<std::string>& ids, double halbtoene) {
  json a = basis;
  for (json& n : a["liste"]) {
    n.erase("ton");
    if (ids.count(n["id"].get<std::string>())) n["ton"] = n["qton"].get<double>() + halbtoene;
  }
  return a;
}

int main() {
  tmp = fs::current_path() / ("noten_render_tmp_" + std::to_string(getpid()));
  fs::remove_all(tmp);
  fs::create_directories(tmp);

  // the source: a gold item as stereo f32 (named by its sha), the gold sidecar, an order of the gold case
  const fs::path q = tmp / (SHA + ".f32"), sc = tmp / "kurve.json";
  const std::vector<float> mono = liesS16(GOLD + "stimme_vibrato.s16");
  PRUEF(!mono.empty());
  const Stereo quelle = synth::stereoAusMono(mono);
  PRUEF(!schreibeF32(q.string(), quelle));
  auto sdr = liesSeitendatei(GOLD + "stimme_vibrato.kurve.json");
  PRUEF(std::holds_alternative<Seitendatei>(sdr));
  Seitendatei sd = std::get<Seitendatei>(sdr);
  sd.mono.reset();
  PRUEF(!schreibeSeitendatei(sc.string(), sd));
  const json basis = json::parse(text(GOLD + "stimme_vibrato.beruehrend.json"))["auftrag"];
  const std::string kurveId = basis["kurve"].get<std::string>();
  PRUEF(kurveId == sd.k.kurve);

  auto liste = [&](const json& a) {
    schreibe(tmp / "auftrag.json", a.dump());
    auto r = liesAuftrag((tmp / "auftrag.json").string(), kurveId);
    PRUEF(std::holds_alternative<std::vector<AudioNote>>(r));
    return std::holds_alternative<std::vector<AudioNote>>(r) ? std::get<std::vector<AudioNote>>(r) : std::vector<AudioNote>{};
  };

  // ---- full render: the length of the source, the library's bytes, the ok line, the progress lines
  const json beide = auftragMit(basis, {"t1", "t2"}, 2.0);
  const fs::path voll = tmp / "voll.f32";
  {
    schreibe(tmp / "beide.json", beide.dump());
    const Lauf l = lauf({"render", q.string(), sc.string(), (tmp / "beide.json").string(), voll.string()});
    if (l.code != 0) std::fprintf(stderr, "render: exit %d, %s %s\n", l.code, l.out.c_str(), l.err.c_str());
    PRUEF(l.code == 0);
    const json z = eineZeile(l);
    PRUEF(z.value("status", "") == "ok");
    PRUEF(z.value("datei", "") == voll.string());
    PRUEF(z.contains("bereiche") && z["bereiche"].is_array() && z.contains("sekunden") && z["sekunden"].is_number() && z.size() == 4);
    PRUEF(!fs::exists(voll.string() + ".tmp"));
    Stereo ref;
    auto r = rendere(quelle, sd.k, liste(beide), nullptr, nullptr, ref, nullptr);
    PRUEF(std::holds_alternative<RenderErgebnis>(r));
    auto aus = liesF32(voll.string());
    PRUEF(std::holds_alternative<Stereo>(aus));
    if (std::holds_alternative<Stereo>(aus) && std::holds_alternative<RenderErgebnis>(r)) {
      const Stereo& s = std::get<Stereo>(aus);
      PRUEF(s.frames() == quelle.frames());
      PRUEF(s.l == ref.l && s.r == ref.r);
      PRUEF(s.l != quelle.l);
      const auto& soll = std::get<RenderErgebnis>(r).bereiche;
      PRUEF(z["bereiche"].size() == soll.size());
      for (size_t i = 0; i < soll.size() && i < z["bereiche"].size(); ++i) {
        PRUEF(z["bereiche"][i].is_array() && z["bereiche"][i].size() == 2);
        PRUEF(z["bereiche"][i][0].get<int64_t>() == soll[i].first && z["bereiche"][i][1].get<int64_t>() == soll[i].second);
        PRUEF(soll[i].first < soll[i].second);
      }
      // outside the ranges the output is the source, bit for bit
      for (int64_t i = 0, b = 0; i < quelle.frames(); ++i) {
        while (b < static_cast<int64_t>(soll.size()) && i >= soll[static_cast<size_t>(b)].second) ++b;
        const bool drin = b < static_cast<int64_t>(soll.size()) && i >= soll[static_cast<size_t>(b)].first;
        if (!drin) { PRUEF(s.l[static_cast<size_t>(i)] == quelle.l[static_cast<size_t>(i)]); if (pruef_fehler) break; }
      }
    }
    const auto fz = fortschritt(l.err, 3);
    PRUEF(!fz.empty() && fz.size() <= 10);
    bool sahRendern = false;
    int letzte = 0;
    for (const auto& j : fz) { PRUEF(j.value("stufe", 0) >= letzte); letzte = j.value("stufe", 0); sahRendern |= j.value("name", "") == "rendern"; }
    PRUEF(sahRendern);
    if (!fz.empty()) PRUEF(fz.back().value("name", "") == "schreiben" && fz.back().value("prozent", 0.0) == 100);
  }

  // ---- incremental: t1 +2 alone, then both with --vorher and --nur t2 gives the bytes of the full render
  {
    const json nurT1 = auftragMit(basis, {"t1"}, 2.0);
    schreibe(tmp / "t1.json", nurT1.dump());
    const fs::path erst = tmp / "erst.f32", teil = tmp / "teil.f32";
    Lauf l = lauf({"render", q.string(), sc.string(), (tmp / "t1.json").string(), erst.string()});
    PRUEF(l.code == 0);
    l = lauf({"render", q.string(), sc.string(), (tmp / "beide.json").string(), teil.string(), "--vorher", erst.string(), "--nur", "t2"});
    if (l.code != 0) std::fprintf(stderr, "incremental render: exit %d, %s %s\n", l.code, l.out.c_str(), l.err.c_str());
    PRUEF(l.code == 0);
    const json z = eineZeile(l);
    PRUEF(z.value("status", "") == "ok" && z.contains("bereiche") && !z["bereiche"].empty());
    PRUEF(dateiGleich(teil, voll));
    PRUEF(!fs::exists(teil.string() + ".tmp"));
    // reset t1 (--nur t1): the same bytes as a full render of the list with t2 only
    const json nurT2 = auftragMit(basis, {"t2"}, 2.0);
    schreibe(tmp / "t2.json", nurT2.dump());
    const fs::path ref2 = tmp / "ref2.f32", teil2 = tmp / "teil2.f32";
    PRUEF(lauf({"render", q.string(), sc.string(), (tmp / "t2.json").string(), ref2.string()}).code == 0);
    l = lauf({"render", q.string(), sc.string(), (tmp / "t2.json").string(), teil2.string(), "--vorher", teil.string(), "--nur", "t1"});
    PRUEF(l.code == 0);
    PRUEF(dateiGleich(teil2, ref2));
  }

  // ---- a list without a target: the output is the source
  {
    const fs::path aus = tmp / "keiner.f32";
    schreibe(tmp / "keiner.json", auftragMit(basis, {}, 0).dump());
    const Lauf l = lauf({"render", q.string(), sc.string(), (tmp / "keiner.json").string(), aus.string()});
    PRUEF(l.code == 0);
    const json z = eineZeile(l);
    PRUEF(z.contains("bereiche") && z["bereiche"].is_array() && z["bereiche"].empty());
    PRUEF(dateiGleich(aus, q));
  }

  // ---- failures: code, exit, no output file and no tmp file
  {
    const fs::path aus = tmp / "fehler.f32";
    auto keineAusgabe = [&] { PRUEF(!fs::exists(aus) && !fs::exists(aus.string() + ".tmp")); };
    const std::string auftrag = (tmp / "beide.json").string();
    fehlerErwartet(lauf({"render", (tmp / "nirgends.f32").string(), sc.string(), auftrag, aus.string()}), 1, "datei_fehlt");
    fehlerErwartet(lauf({"render", q.string(), (tmp / "nirgends.json").string(), auftrag, aus.string()}), 1, "datei_fehlt");
    fehlerErwartet(lauf({"render", q.string(), sc.string(), (tmp / "nirgends.json").string(), aus.string()}), 1, "datei_fehlt");
    keineAusgabe();
    schreibe(tmp / "kaputt.f32", std::string(12, '\1'));
    fehlerErwartet(lauf({"render", (tmp / "kaputt.f32").string(), sc.string(), auftrag, aus.string()}), 1, "datei_kaputt");
    schreibe(tmp / "kaputt.json", "{\"format\": ");
    fehlerErwartet(lauf({"render", q.string(), sc.string(), (tmp / "kaputt.json").string(), aus.string()}), 1, "datei_kaputt");
    json form = beide;
    form["extra"] = 1;
    schreibe(tmp / "form.json", form.dump());
    fehlerErwartet(lauf({"render", q.string(), sc.string(), (tmp / "form.json").string(), aus.string()}), 1, "format");
    keineAusgabe();
    // another curve id in the order
    json fremd = beide;
    fremd["kurve"] = "pyin-1.noten_hmm-9";
    schreibe(tmp / "fremd.json", fremd.dump());
    fehlerErwartet(lauf({"render", q.string(), sc.string(), (tmp / "fremd.json").string(), aus.string()}), 1, "kurve_passt_nicht");
    // a source of another length than the curve
    const fs::path ander = tmp / (std::string(64, 'd') + ".f32");
    PRUEF(!schreibeF32(ander.string(), synth::stereoAusMono(std::vector<float>(48000, 0.0f))));
    fehlerErwartet(lauf({"render", ander.string(), sc.string(), auftrag, aus.string()}), 1, "kurve_passt_nicht");
    keineAusgabe();
    // a target other than ton
    json gain = beide;
    for (json& n : gain["liste"]) { n.erase("ton"); }
    gain["liste"][0]["gain_db"] = 3.0;
    schreibe(tmp / "gain.json", gain.dump());
    fehlerErwartet(lauf({"render", q.string(), sc.string(), (tmp / "gain.json").string(), aus.string()}), 1, "nicht_unterstuetzt");
    keineAusgabe();
    // --nur without --vorher: usage error
    fehlerErwartet(lauf({"render", q.string(), sc.string(), auftrag, aus.string(), "--nur", "t1"}), 2, "argument");
    // --vorher of another length
    fehlerErwartet(lauf({"render", q.string(), sc.string(), auftrag, aus.string(), "--vorher", ander.string(), "--nur", "t1"}), 1, "vorher_passt_nicht");
    // an id of --nur that is not in the list
    fehlerErwartet(lauf({"render", q.string(), sc.string(), auftrag, aus.string(), "--vorher", q.string(), "--nur", "t9"}), 2, "argument");
    keineAusgabe();
    // a repeated option is a usage error (the last value used to win silently), for --nur and for --vorher
    fehlerErwartet(lauf({"render", q.string(), sc.string(), auftrag, aus.string(), "--vorher", q.string(), "--nur", "t1", "--nur", "t2"}), 2, "argument");
    fehlerErwartet(lauf({"render", q.string(), sc.string(), auftrag, aus.string(), "--vorher", q.string(), "--vorher", q.string(), "--nur", "t1"}), 2, "argument");
    PRUEF(!fs::exists(aus) && !fs::exists(aus.string() + ".tmp"));
    // unknown option, missing arguments
    fehlerErwartet(lauf({"render", q.string(), sc.string(), auftrag}), 2, "argument");
    fehlerErwartet(lauf({"render", q.string(), sc.string(), auftrag, aus.string(), "--quatsch", "1"}), 2, "argument");
    keineAusgabe();
  }

  // ---- an existing output is replaced by a complete file (rename), never by a partial one
  {
    const fs::path aus = tmp / "bestehend.f32";
    schreibe(aus, "alt");
    const Lauf l = lauf({"render", q.string(), sc.string(), (tmp / "beide.json").string(), aus.string()});
    PRUEF(l.code == 0);
    PRUEF(dateiGleich(aus, voll));
  }

  // ---- SIGTERM while the render runs: exit 143, no output file, no tmp file
  {
    // a long source: the vibrato item 60 times, the first note of every repetition edited
    const int wdh = 60;
    const double dauer = static_cast<double>(mono.size()) / SR;
    std::vector<float> lang;
    for (int i = 0; i < wdh; ++i) lang.insert(lang.end(), mono.begin(), mono.end());
    const fs::path ql = tmp / (std::string(64, 'a') + ".f32"), scl = tmp / "lang.json";
    PRUEF(!schreibeF32(ql.string(), synth::stereoAusMono(lang)));
    const int64_t nf = frameZahl(static_cast<int64_t>(lang.size()));
    Kurve k = sd.k;
    k.frames = static_cast<int64_t>(lang.size());
    k.f0_ct.assign(static_cast<size_t>(nf), 0.0);
    k.konf.assign(static_cast<size_t>(nf), 0.0);
    for (int64_t j = 0; j < nf; ++j) {
      const size_t src = static_cast<size_t>(j % static_cast<int64_t>(mono.size() / HOP));
      k.f0_ct[static_cast<size_t>(j)] = sd.k.f0_ct[src];
      k.konf[static_cast<size_t>(j)] = sd.k.konf[src];
    }
    Seitendatei lsd;
    lsd.quelle = std::string(64, 'a');
    lsd.k = k;
    lsd.stimmhaft_anteil = stimmhaftAnteil(k);
    PRUEF(!schreibeSeitendatei(scl.string(), lsd));
    json auftrag = {{"format", "cdj-noten-auftrag/1"}, {"kurve", kurveId}, {"liste", json::array()}};
    int zaehler = 0;
    for (int i = 0; i < wdh; ++i) {
      for (const json& n : basis["liste"]) {
        json m = n;
        m.erase("ton");
        m["id"] = "t" + std::to_string(++zaehler);
        m["qa"] = n["qa"].get<double>() + i * dauer;
        m["qe"] = n["qe"].get<double>() + i * dauer;
        if (n["id"] == "t1") m["ton"] = n["qton"].get<double>() + 3.0;
        auftrag["liste"].push_back(m);
      }
    }
    schreibe(tmp / "lang_auftrag.json", auftrag.dump());
    const fs::path aus = tmp / "abbruch.f32";
    Kind kind = starte({"render", ql.string(), scl.string(), (tmp / "lang_auftrag.json").string(), aus.string()});
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
        sah = err.find("\"name\":\"rendern\"") != std::string::npos;
      }
    }
    PRUEF(sah);
    std::this_thread::sleep_for(std::chrono::milliseconds(100));
    kill(kind.pid, SIGTERM);
    const Lauf l = kind.warteEnde();
    if (l.code != 143) std::fprintf(stderr, "SIGTERM: exit %d, out '%s'\n", l.code, l.out.c_str());
    PRUEF(l.code == 143);
    PRUEF(l.out.empty());
    PRUEF(!fs::exists(aus) && !fs::exists(aus.string() + ".tmp"));
  }

  fs::remove_all(tmp);
  PRUEF_ENDE();
}
