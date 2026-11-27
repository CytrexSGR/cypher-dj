// Readers and writers of the contract files (src/contract.cpp, src/audio.cpp): every example of djk/contract/cases/noten/ reads as
// the contract says (gruende.json names the code of every bad one), sidecars survive read -> write -> read, the audio I/O refuses what it must.
#include <sys/stat.h>
#include <unistd.h>

#include <algorithm>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <string>
#include <thread>
#include <variant>
#include <vector>

#include <nlohmann/json.hpp>

#include "intern.h"
#include "check.h"

using namespace cdj::noten;
namespace fs = std::filesystem;
using json = nlohmann::json;

static const std::string FALL = std::string(CONTRACT) + "/cases/noten/";
static fs::path tmp;

static bool endetMit(const std::string& s, const std::string& ende) { return s.size() >= ende.size() && s.compare(s.size() - ende.size(), ende.size(), ende) == 0; }
static bool beginntMit(const std::string& s, const std::string& a) { return s.rfind(a, 0) == 0; }

static std::string text(const fs::path& p) {
  std::ifstream f(p, std::ios::binary);
  return std::string((std::istreambuf_iterator<char>(f)), std::istreambuf_iterator<char>());
}
static void schreibe(const fs::path& p, const std::string& t) { std::ofstream(p, std::ios::binary) << t; }

template <class T> static const Fehler* fehler(const std::variant<T, Fehler>& v) { return std::get_if<Fehler>(&v); }

/// The result of reading an example file of any kind, as the code (empty = read without error).
static std::string lies(const std::string& name) {
  const std::string pfad = FALL + name;
  if (beginntMit(name, "kurve_")) { auto r = liesSeitendatei(pfad); return fehler(r) ? fehler(r)->code : ""; }
  if (beginntMit(name, "roh_")) { auto r = liesRoh(pfad); return fehler(r) ? fehler(r)->code : ""; }
  auto r = liesAuftrag(pfad, "pyin-1.noten_hmm-1");
  return fehler(r) ? fehler(r)->code : "";
}

int main() {
  tmp = fs::current_path() / ("noten_vertrag_tmp_" + std::to_string(getpid()));
  fs::remove_all(tmp);
  fs::create_directories(tmp);

  // ---- examples: every *_gut reads, every *_schlecht_* gives the code of gruende.json
  const json gruende = json::parse(text(FALL + "gruende.json"));
  std::vector<std::string> namen;
  for (const auto& e : fs::directory_iterator(FALL)) namen.push_back(e.path().filename().string());
  std::sort(namen.begin(), namen.end());
  int gut = 0, schlecht = 0;
  for (const auto& n : namen) {
    const bool art = beginntMit(n, "kurve_") || beginntMit(n, "roh_") || beginntMit(n, "auftrag_");
    if (!art) continue;   // audio_noten_* is the clip field (the server's), schluessel.json and zeilen.json are other kinds
    if (endetMit(n, "_gut.json")) {
      const std::string c = lies(n);
      if (!c.empty()) std::fprintf(stderr, "%s: expected to read, got %s\n", n.c_str(), c.c_str());
      PRUEF(c.empty());
      ++gut;
    } else if (n.find("_schlecht_") != std::string::npos) {
      PRUEF(gruende.contains(n));
      const std::string soll = gruende.value(n, "?");
      const std::string c = lies(n);
      if (c != soll) std::fprintf(stderr, "%s: expected %s, got %s\n", n.c_str(), soll.c_str(), c.c_str());
      PRUEF(c == soll);
      ++schlecht;
    }
  }
  std::printf("examples: %d good, %d bad\n", gut, schlecht);
  PRUEF(gut >= 6 && schlecht >= 15);

  // the render order: another curve id than the sidecar's is kurve_passt_nicht, and only after the file itself is valid
  {
    auto r = liesAuftrag(FALL + "auftrag_gut.json", "pyin-1.noten_hmm-2");
    PRUEF(fehler(r) && fehler(r)->code == "kurve_passt_nicht");
    auto b = liesAuftrag(FALL + "auftrag_schlecht_dauer.json", "pyin-1.noten_hmm-2");
    PRUEF(fehler(b) && fehler(b)->code == "noten_ungueltig");
    auto g = liesAuftrag(FALL + "auftrag_gut.json", "pyin-1.noten_hmm-1");
    PRUEF(!fehler(g) && !std::get<std::vector<AudioNote>>(g).empty());
  }

  // a version string of 50000 characters is refused as a format error (std::regex_match would overflow the stack on it)
  {
    json roh = json::parse(text(FALL + "roh_gut.json"));
    roh["detektor_version"] = "netz-" + std::string(50000, '1');
    const std::string pfad = (tmp / "roh_lang.json").string();
    {
      std::ofstream o(pfad);
      o << roh.dump();
    }
    auto r = liesRoh(pfad);
    PRUEF(fehler(r) && fehler(r)->code == "format");
  }

  // contents of two examples
  {
    auto r = liesSeitendatei(FALL + "kurve_mono_gut.json");
    PRUEF(!fehler(r));
    if (!fehler(r)) {
      const Seitendatei& s = std::get<Seitendatei>(r);
      PRUEF(s.k.frames == 2560 && s.k.f0_ct.size() == 11 && s.k.konf.size() == 11 && s.noten.size() == 2);
      PRUEF(s.k.detektor == "pyin" && s.k.kurve == "pyin-1.noten_hmm-1");
      PRUEF(s.mono && s.mono->geprueft_frames == 6 && !s.mono->mehrstimmig && s.mono->hrr_db_schwelle == 10.0 && s.mono->periode_schwelle == 0.3);
    }
    auto m = liesSeitendatei(FALL + "kurve_mono_mehrstimmig_gut.json");
    PRUEF(!fehler(m) && std::get<Seitendatei>(m).mono && std::get<Seitendatei>(m).mono->mehrstimmig);
    auto roh = liesRoh(FALL + "roh_gut.json");
    PRUEF(!fehler(roh));
    if (!fehler(roh)) {
      PRUEF(std::get<Kurve>(roh).kurve == "netz-1.noten_hmm-1" && std::get<Kurve>(roh).detektor == "netz" && std::get<Kurve>(roh).frames == 2560);
    }
    auto a = liesAuftrag(FALL + "auftrag_gut.json", "pyin-1.noten_hmm-1");
    PRUEF(!fehler(a));
    auto t24 = std::get_if<Fehler>(&a);
    PRUEF(!t24);
  }

  // ---- read -> write -> read gives equal structs, and the written file reads back
  for (const char* n : {"kurve_gut.json", "kurve_mono_gut.json", "kurve_mono_mehrstimmig_gut.json", "kurve_kurz_gut.json"}) {
    auto r1 = liesSeitendatei(FALL + n);
    PRUEF(!fehler(r1));
    if (fehler(r1)) continue;
    const Seitendatei& s1 = std::get<Seitendatei>(r1);
    const std::string aus = (tmp / n).string();
    PRUEF(!schreibeSeitendatei(aus, s1));
    PRUEF(!fs::exists(aus + ".tmp"));
    auto r2 = liesSeitendatei(aus);
    PRUEF(!fehler(r2));
    if (!fehler(r2)) PRUEF(std::get<Seitendatei>(r2) == s1);
    const std::string t = text(aus);
    PRUEF(!t.empty() && t.back() == '\n' && std::count(t.begin(), t.end(), '\n') == 1);
  }

  // the writer rounds to the decimals of the contract; a struct that breaks a rule is refused and leaves nothing behind
  {
    auto r = liesSeitendatei(FALL + "kurve_gut.json");
    Seitendatei s = std::get<Seitendatei>(r);
    s.k.f0_ct[2] = 6900.123456;
    s.k.konf[2] = 0.93456;
    s.noten[0].qa = 0.0106671234;
    s.noten[0].qton = 69.000049;
    const std::string aus = (tmp / "gerundet.json").string();
    PRUEF(!schreibeSeitendatei(aus, s));
    auto r2 = liesSeitendatei(aus);
    PRUEF(!fehler(r2));
    if (!fehler(r2)) {
      const Seitendatei& g = std::get<Seitendatei>(r2);
      PRUEF(g.k.f0_ct[2] == 6900.12 && g.k.konf[2] == 0.935 && g.noten[0].qa == 0.010667 && g.noten[0].qton == 69.0);
    }
    Seitendatei kaputt = std::get<Seitendatei>(r);
    kaputt.k.f0_ct.pop_back();
    const std::string aus2 = (tmp / "kaputt.json").string();
    auto f = schreibeSeitendatei(aus2, kaputt);
    PRUEF(f && f->code == "format");
    PRUEF(!fs::exists(aus2) && !fs::exists(aus2 + ".tmp"));
    Seitendatei ausserhalb = std::get<Seitendatei>(r);
    ausserhalb.noten[1].qe = 5.0;
    auto f2 = schreibeSeitendatei(aus2, ausserhalb);
    PRUEF(f2 && f2->code == "noten_ungueltig");
    PRUEF(!fs::exists(aus2) && !fs::exists(aus2 + ".tmp"));
    auto nach = schreibeSeitendatei((tmp / "nirgends" / "x.json").string(), std::get<Seitendatei>(r));
    PRUEF(nach && nach->code == "schreiben");
  }

  // ---- raw curve cases that have no example file
  {
    json roh = json::parse(text(FALL + "roh_gut.json"));
    auto code = [&](json j) {
      const fs::path p = tmp / "roh_probe.json";
      schreibe(p, j.dump());
      auto r = liesRoh(p.string());
      return fehler(r) ? fehler(r)->code : std::string();
    };
    PRUEF(code(roh).empty());
    { json j = roh; j["f0_ct"].erase(j["f0_ct"].size() - 1); PRUEF(code(j) == "format"); }
    { json j = roh; j["detektor"] = "pyin"; PRUEF(code(j) == "format"); }
    { json j = roh; j["detektor_version"] = "pyin-1"; PRUEF(code(j) == "format"); }
    { json j = roh; j["frames"] = 5000; PRUEF(code(j) == "format"); }   // 20 frames expected, 11 given
    { json j = roh; j["f0_ct"][3] = 6901.123; PRUEF(code(j) == "format"); }   // three decimals
    { json j = roh; j["konf"][3] = 0.9501; PRUEF(code(j) == "format"); }
    { json j = roh; j["f0_ct"][3] = 100; PRUEF(code(j) == "format"); }   // neither 0 nor 1500..11000
    { json j = roh; j["extra"] = 1; PRUEF(code(j) == "format"); }
    { json j = roh; j["sr"] = 44100; PRUEF(code(j) == "format"); }
    schreibe(tmp / "kein.json", "{\"format\": ");
    auto r = liesRoh((tmp / "kein.json").string());
    PRUEF(fehler(r) && fehler(r)->code == "datei_kaputt");
    auto m = liesRoh((tmp / "gibtsnicht.json").string());
    PRUEF(fehler(m) && fehler(m)->code == "datei_fehlt");
  }

  // ---- f32 files
  {
    schreibe(tmp / "zwoelf.f32", std::string(12, '\1'));
    auto r = liesF32((tmp / "zwoelf.f32").string());
    PRUEF(fehler(r) && fehler(r)->code == "datei_kaputt");
    auto m = liesF32((tmp / "fehlt.f32").string());
    PRUEF(fehler(m) && fehler(m)->code == "datei_fehlt");
    schreibe(tmp / "leer.f32", "");
    auto l = liesF32((tmp / "leer.f32").string());
    PRUEF(!fehler(l) && std::get<Stereo>(l).frames() == 0);

    // round trip over more than one read chunk (1 MiB), values that are not simple
    Stereo s;
    const size_t n = 300001;
    for (size_t i = 0; i < n; ++i) {
      s.l.push_back(std::sin(0.001f * static_cast<float>(i)));
      s.r.push_back(0.25f - 1e-6f * static_cast<float>(i));
    }
    const std::string pfad = (tmp / "rund.f32").string();
    PRUEF(!schreibeF32(pfad, s));
    PRUEF(!fs::exists(pfad + ".tmp"));
    PRUEF(fs::file_size(pfad) == n * 8);
    auto g = liesF32(pfad);
    PRUEF(!fehler(g));
    if (!fehler(g)) {
      PRUEF(std::get<Stereo>(g).l == s.l && std::get<Stereo>(g).r == s.r);
      const auto mi = mitte(std::get<Stereo>(g));
      PRUEF(mi.size() == n && mi[10] == (s.l[10] + s.r[10]) * 0.5f);
    }
    // a pipe delivers the bytes in pieces of any size: a frame split across reads must stay whole
    const std::string fifo = (tmp / "rohr.f32").string();
    PRUEF(mkfifo(fifo.c_str(), 0600) == 0);
    std::thread schreiber([&] {
      std::vector<char> b(n * 8);
      for (size_t i = 0; i < n; ++i) { std::memcpy(&b[8 * i], &s.l[i], 4); std::memcpy(&b[8 * i + 4], &s.r[i], 4); }
      FILE* f = std::fopen(fifo.c_str(), "wb");
      for (size_t a = 0; a < b.size(); a += 4099) std::fwrite(b.data() + a, 1, std::min<size_t>(4099, b.size() - a), f);
      std::fclose(f);
    });
    auto p = liesF32(fifo);
    schreiber.join();
    PRUEF(!fehler(p));
    if (!fehler(p)) PRUEF(std::get<Stereo>(p).l == s.l && std::get<Stereo>(p).r == s.r);
    // the s16 reader of the golden vectors: sample / 32768
    const auto kurz = liesS16(std::string(NOTEN_DATEN) + "/gold/kurz.s16");
    PRUEF(kurz.size() == 7200);
    const std::string roh = text(std::string(NOTEN_DATEN) + "/gold/kurz.s16");
    const int16_t erst = static_cast<int16_t>(static_cast<unsigned char>(roh[2]) | (static_cast<unsigned char>(roh[3]) << 8));
    PRUEF(kurz[1] == static_cast<float>(erst) / 32768.0f);
    PRUEF(liesS16((tmp / "fehlt.s16").string()).empty());
  }

  // ---- SIGTERM pending: the writers leave neither the file nor the tmp file
  {
    Stereo s;
    s.l.assign(1000, 0.5f);
    s.r.assign(1000, 0.5f);
    const std::string pfad = (tmp / "abbruch.f32").string();
    auto k = liesSeitendatei(FALL + "kurve_gut.json");   // read before the flag is set: the readers stop on it too
    PRUEF(!fehler(k));
    abbruchAnfordern();
    auto f = schreibeF32(pfad, s);
    PRUEF(f && f->code == "abbruch");
    PRUEF(!fs::exists(pfad) && !fs::exists(pfad + ".tmp"));
    auto f2 = schreibeSeitendatei((tmp / "abbruch.json").string(), std::get<Seitendatei>(k));
    PRUEF(f2 && f2->code == "abbruch");
    PRUEF(!fs::exists(tmp / "abbruch.json") && !fs::exists(tmp / "abbruch.json.tmp"));
    auto g = liesF32((tmp / "rund.f32").string());
    PRUEF(fehler(g) && fehler(g)->code == "abbruch");
    abbruchZuruecksetzen();
    PRUEF(!abbruchAngefordert());
  }

  fs::remove_all(tmp);
  PRUEF_ENDE();
}
