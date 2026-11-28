// cypherdj-noten: argument parsing, dispatch, result and error lines, SIGTERM handling. The commands live in cli_<name>.cpp; the three
// that are not built yet answer nicht_gebaut. Contract: djk/contract/notes.md (Command line, Lines, Error codes).
#include <signal.h>

#include <cctype>
#include <cstdio>
#include <cstring>

#include "intern.h"

namespace cdj::noten {
namespace {

using ojson = nlohmann::ordered_json;

struct Befehl {
  const char* name;
  size_t positional;                       // exact number of positional arguments
  std::vector<std::string> optionen;       // allowed `--name value` options
  int (*lauf)(const Argumente&);
};

const std::vector<Befehl>& befehle() {
  static const std::vector<Befehl> t = {
      {"version", 0, {}, cliVersion},
      {"analyse", 2, {"sha"}, cliAnalyse},
      {"segment", 3, {"sha"}, cliSegment},
      {"pruefe", 2, {}, cliPruefe},
      {"render", 4, {"vorher", "nur", "vorher-liste"}, cliRender},
  };
  return t;
}

void zeile(const std::string& text) {
  std::fwrite(text.data(), 1, text.size(), stdout);
  std::fputc('\n', stdout);
  std::fflush(stdout);
}

bool hex64(const std::string& s) {
  if (s.size() != 64) return false;
  for (char c : s) if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;
  return true;
}

void beiSigterm(int) { abbruchAnfordern(); }

}  // namespace

int endeOk(const ojson& z) {
  zeile(z.dump());
  return 0;
}

int endeFehler(const Fehler& f) {
  if (f.code == "abbruch" || abbruchAngefordert()) return 143;
  ojson z;
  z["status"] = "fehler";
  z["fehler"] = f.code;
  z["text"] = f.text.empty() ? "unknown error" : f.text;
  zeile(z.dump(-1, ' ', false, ojson::error_handler_t::replace));
  return f.code == "argument" ? 2 : 1;
}

std::variant<std::string, Fehler> quellSha(const std::string& quelle, const Argumente& a) {
  std::string stem = quelle.substr(quelle.find_last_of('/') == std::string::npos ? 0 : quelle.find_last_of('/') + 1);
  const size_t punkt = stem.find_last_of('.');
  if (punkt != std::string::npos) stem.resize(punkt);
  if (hex64(stem)) return stem;
  if (!a.hat("sha")) return Fehler{"argument", "Missing argument: --sha is needed when the file name is not a 64 digit hex stem."};
  if (!hex64(a.wert("sha"))) return Fehler{"argument", "Invalid argument: --sha must be 64 lowercase hex digits."};
  return a.wert("sha");
}

}  // namespace cdj::noten

int main(int argc, char** argv) {
  using namespace cdj::noten;
  struct sigaction sa;
  std::memset(&sa, 0, sizeof sa);
  sa.sa_handler = beiSigterm;
  sigemptyset(&sa.sa_mask);
  sa.sa_flags = 0;   // no SA_RESTART: a read blocked on a pipe returns and sees the flag
  sigaction(SIGTERM, &sa, nullptr);

  const char* nutzung = "Usage: cypherdj-noten <version|analyse|segment|pruefe|render> [arguments]";
  if (argc < 2) return endeFehler(Fehler{"argument", nutzung});
  const std::string name = argv[1];
  const Befehl* b = nullptr;
  for (const auto& c : befehle()) if (name == c.name) b = &c;
  if (!b) return endeFehler(Fehler{"argument", "Unknown command: " + name + ". " + nutzung});

  Argumente a;
  for (int i = 2; i < argc; ++i) {
    const std::string t = argv[i];
    if (t.rfind("--", 0) == 0 && t.size() > 2) {
      const std::string opt = t.substr(2);
      bool erlaubt = false;
      for (const auto& o : b->optionen) if (o == opt) erlaubt = true;
      if (!erlaubt) return endeFehler(Fehler{"argument", "Unknown option " + t + " for " + name});
      if (i + 1 >= argc) return endeFehler(Fehler{"argument", "Missing value for option " + t});
      if (a.hat(opt)) return endeFehler(Fehler{"argument", "Option " + t + " given more than once"});
      a.opt[opt] = argv[++i];
    } else {
      a.pos.push_back(t);
    }
  }
  if (a.pos.size() != b->positional)
    return endeFehler(Fehler{"argument", name + " takes " + std::to_string(b->positional) + " positional argument(s), got " + std::to_string(a.pos.size())});
  if (a.hat("nur") && !a.hat("vorher")) return endeFehler(Fehler{"argument", "--nur needs --vorher"});
  if (a.hat("vorher-liste") && !a.hat("vorher")) return endeFehler(Fehler{"argument", "--vorher-liste needs --vorher"});
  return b->lauf(a);
}
