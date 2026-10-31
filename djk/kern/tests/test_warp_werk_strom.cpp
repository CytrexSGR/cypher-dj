// Paket 1.13 Warp, Slice 5, Task 0 (Prüfung r1 M1): Referenz des Werk-Stroms bei pitch 1, aufgenommen auf f2e2c6ac VOR Slice 5 (--schreibe).
// Der Test nennt pitch nirgends. Er zeigt, dass der Strom von COMPLEX und TONES Bit für Bit derselbe bleibt, wenn pitch 1 ist, und prüft damit, was
// Slice 5 für pitch 1 ändert und kein anderer Test: den Maschinen-Konstruktor (zweiter Aufwärm-Durchgang) und die Abstandsformel des Korn-Abstands.
// Je Modus: ein frisches Werk, Durchgang 0 (erste Nutzung einer Maschine) und, nach gib(), Durchgang 1 (ob dieselbe Maschine oder eine andere, hängt vom Pool; beides ist Referenz).
// Aufruf: test_warp_werk_strom [--schreibe]; STROM_STOER=1 ändert den Startwert des Rauschens: der Hash MUSS dann abweichen (Negativkontrolle des Vergleichs).
#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <memory>
#include <string>
#include <thread>
#include <vector>

#include "arr_bau.h"
#include "cypherdj/warp_werk.h"
#include "pruef.h"

bool g_waechter = false;

namespace {
constexpr int64_t FPB125 = 23040;
constexpr int64_t SPB = arrtest::SPB;

std::unique_ptr<arrtest::Audio> rauschen(int64_t frames, uint32_t saat) {   // wie test_arr_warp_unveraendert.cpp: feste Folge, Spitze 0,5
  auto x = std::make_unique<arrtest::Audio>();
  x->d.resize(static_cast<size_t>(frames) * 2);
  uint32_t z = saat;
  for (float& v : x->d) {
    z = z * 1664525u + 1013904223u;
    v = 0.5f * (static_cast<float>(z >> 8) / 8388608.0f - 1.0f);
  }
  x->fuellen(frames);
  return x;
}

struct Quelle {
  std::unique_ptr<arrtest::Audio> audio;
  std::vector<double> beat{0.0, 6.0, 16.0}, frame;
  cdj::ArrWarp warp;
  cdj::ArrClip clip{};
  Quelle(std::unique_ptr<arrtest::Audio> a, int modus) : audio(std::move(a)) {
    frame = {0.0, 6.0 * static_cast<double>(FPB125) * 1.03, 16.0 * static_cast<double>(FPB125)};   // Tempowechsel bei Beat 6
    warp.modus = modus;
    warp.n = 3;
    warp.beat = beat.data();
    warp.frame = frame.data();
    clip.id = 1;
    clip.start_beat = 0.0;
    clip.laenge_beats = 16.0;
    clip.audio = &audio->a;
    clip.gain = 1.0f;
    clip.warp = &warp;
  }
};

cdj::WarpAnsatz auftrag(const Quelle& q, int64_t s_c, int64_t s_h) {
  cdj::WarpAnsatz a;
  a.clip = &q.clip;
  a.s_h = s_h;
  a.s_ende = s_c + 16 * SPB;
  a.beat_versatz = -static_cast<double>(s_c) / static_cast<double>(SPB);
  a.karte = cdj::Karte(128.0, 0);
  return a;
}

bool lies(cdj::WarpWerk& w, int p, int64_t s_h, int64_t n, std::vector<float>& l, std::vector<float>& r) {   // wie test_warp_werk_pitch.cpp
  l.assign(static_cast<size_t>(n), 0.0f);
  r.assign(static_cast<size_t>(n), 0.0f);
  const auto frist = std::chrono::steady_clock::now() + std::chrono::seconds(3);
  for (int64_t s = s_h; s < s_h + n; s += 256) {
    const int m = static_cast<int>(std::min<int64_t>(256, s_h + n - s));
    w.takt(s);
    while (!w.ring(p).lies(s, m, l.data() + (s - s_h), r.data() + (s - s_h))) {
      if (std::chrono::steady_clock::now() > frist) return false;
      std::this_thread::sleep_for(std::chrono::milliseconds(1));
      w.takt(s);
    }
  }
  return true;
}

uint64_t fnv(const std::vector<float>& v, uint64_t h) {
  for (float f : v) {
    uint8_t b[sizeof f];
    std::memcpy(b, &f, sizeof f);
    for (uint8_t c : b) {
      h ^= c;
      h *= 1099511628211ULL;
    }
  }
  return h;
}

bool hat_signal(const std::vector<float>& v) {
  for (float f : v)
    if (std::fabs(f) > 1e-6f) return true;
  return false;
}
}  // namespace

int main(int argc, char** argv) {
  const std::string datei = std::string(CYPHERDJ_DJK) + "/kern/tests/daten/warp_werk_strom_pitch1.hash";
  const bool stoer = std::getenv("STROM_STOER") != nullptr, schreibe = argc > 1 && std::strcmp(argv[1], "--schreibe") == 0;
  const int64_t S_C = 10000;
  std::vector<std::string> ist;
  for (int modus : {cdj::ARR_WARP_COMPLEX, cdj::ARR_WARP_TONES}) {
    auto werk = cdj::warp_werk_neu({});
    PRUEF(werk != nullptr);
    if (!werk) PRUEF_ENDE();
    for (int durchgang = 0; durchgang < 2; ++durchgang) {
      Quelle q(rauschen(17 * FPB125, static_cast<uint32_t>(7 + durchgang + (stoer ? 1 : 0))), modus);
      const int p = werk->belege();
      PRUEF(p >= 0);
      cdj::WarpAnsatz a = auftrag(q, S_C, S_C);
      werk->ansetzen(p, a);
      std::vector<float> l, r;
      PRUEF(lies(*werk, p, S_C, 8 * SPB, l, r));
      PRUEF(hat_signal(l) && hat_signal(r));   // Instrument-Check: ein Hash über Stille ist kein Hash
      char z[40];
      std::snprintf(z, sizeof z, "%016llx", static_cast<unsigned long long>(fnv(r, fnv(l, 1469598103934665603ULL))));
      ist.push_back(z);
      std::printf("%s Durchgang %d: Hash %s\n", modus == cdj::ARR_WARP_COMPLEX ? "COMPLEX" : "TONES", durchgang, z);
      werk->gib(p);
    }
  }
  if (schreibe) {
    if (pruef_fehler) {
      std::fprintf(stderr, "Referenz nicht geschrieben: %d Pruefung(en) gescheitert\n", pruef_fehler);
      return 1;
    }
    std::ofstream f(datei);
    for (const std::string& z : ist) f << z << "\n";
    std::printf("geschrieben: %s (%zu Hashes)\n", datei.c_str(), ist.size());
    return 0;
  }
  std::ifstream f(datei);
  std::vector<std::string> soll;
  for (std::string z; f >> z;) soll.push_back(z);
  PRUEF(soll.size() == ist.size());   // fehlt die Datei: einmal mit --schreibe auf dem Stand VOR Slice 5 aufnehmen
  if (stoer) PRUEF(soll != ist);      // Negativkontrolle: eine andere Quelle muss einen anderen Hash geben
  else PRUEF(soll == ist);
  PRUEF_ENDE();
}
