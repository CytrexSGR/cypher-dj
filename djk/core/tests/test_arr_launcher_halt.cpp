// Loop deck K4: launcher voices (and pending launches) hold their audio across a snapshot swap. The release goes through the real loader path:
// snapshots come from ArrLader::einmal (files in /dev/shm), the Arrangement swaps with tausche(), the replaced snapshot goes back through the
// rueckgabe ring, and ArrLader::einmal frees it. The audio cache entry of an audio that a launcher voice (or a pending start) still plays must
// outlive the snapshot; the track bus must be bit-equal to a run without the swap. 128 BPM: 22 500 samples per beat, 4-beat cells of 90 000 frames.
//   1  loop plays, swap clears the cell, old snapshot released: audio still cached, bus bit-equal to the run without the swap
//   2  the voice stops: the next einmal frees the entry, cache empty, account back to the new audio only
//   3  the same with a keylock voice (werk slot, WarpWerk::haelt path)            (only with Bungee)
//   4  while an audio is deferred a load that would exceed the budget with it counted is refused zu_gross; after the free it loads
//   5  no voice: the release frees at once (as before)
//   6  pending start (ab_beat in the future), swap to another audio for the cell: the audio of the acceptance plays, cached until the voice ends
//   7  pending start, unload: the pending start is dropped (receipt 7), nothing sounds, the audio is freed after that
//   8  pending start replaced by another cell / by a stop: the hold of the replaced start is released (its audio is freed)
//   9  pending keylock start across a swap (prepared ahead by launch_vorab): the audio of the acceptance plays   (only with Bungee)
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <memory>
#include <string>
#include <vector>

#include "arr_build.h"
#include "arr_file.h"
#include "cypherdj/arr_loader.h"
#include "check.h"

bool g_waechter = false;

using namespace arrtest;
using cdj::LaunchGrund;
using cdj::LaunchMeldung;

static const uint64_t ID = cdj::arr_id("s1");
static constexpr int64_t CELL = 4 * SPB;   // 90 000 frames = 4 beats at 128 BPM

namespace {

struct Fix {
  Treiber t;
  arrdatei::Ordner o;
  cdj::SpeicherKonto konto{200LL << 20};
  cdj::ArrLader lader;
  std::unique_ptr<cdj::ArrLaderRinge> r{std::make_unique<cdj::ArrLaderRinge>()};
  std::vector<float> bus;
  std::string sha_a, sha_b, sha_c;
  int64_t nr = 0;
  explicit Fix(const char* name, int64_t budget = 100LL << 20, bool werk = false)
      : o(name), lader(o.pfad, &konto, budget, false) {
    sha_a = o.sinus('a', CELL, 440.0, 0.5f);
    sha_b = o.sinus('b', CELL, 660.0, 0.5f);
    sha_c = o.sinus('c', CELL, 880.0, 0.5f);
    if (werk) {
      PRUEF(t.mit_werk(0));
      lader.setze_warp_werk(t.werk.get());
    }
  }
  std::string zelle(int index, const std::string& sha, const char* art, double beats, int modus) const {
    char z[640];
    std::snprintf(z, sizeof z,
                  "{\"index\":%d,\"sha256\":\"%s\",\"datei\":\"%s/audio/%s.f32\",\"frames\":%lld,\"beats\":%.17g,\"art\":\"%s\",\"gain_db\":0,\"modus\":%d}",
                  index, sha.c_str(), o.pfad.c_str(), sha.c_str(), static_cast<long long>(CELL), beats, art, modus);
    return z;
  }
  // loads a playback with one deck track "s1" and these cells (JSON text); nullptr and the reason when refused
  cdj::ArrSnapshot* lade(const std::string& zellen, std::string* grund = nullptr) {
    ++nr;
    o.wiedergabe2_warp(nr, "{\"nr\":1,\"art\":\"audio\",\"id\":\"s1\",\"zellen\":[" + zellen + "],\"clips\":[]}");
    cdj::ArrAuftrag a{};
    a.id = nr;
    std::snprintf(a.quelle, sizeof a.quelle, "andreas");
    a.nr = nr;
    PRUEF(r->auftraege.schiebe(a));
    PRUEF(lader.einmal(*r));
    cdj::ArrErgebnis e{};
    PRUEF(r->ergebnisse.hole(e));
    if (grund) *grund = e.grund;
    return e.snap;
  }
  void tausche(cdj::ArrSnapshot* neu) {   // the swap in the callback, the old snapshot back to the loader
    if (const cdj::ArrSnapshot* alt = t.arr.tausche(neu, t.s, t.k)) PRUEF(r->rueckgabe.schiebe(const_cast<cdj::ArrSnapshot*>(alt)));
  }
  void lader_lauf() {
    for (int i = 0; i < 4; ++i) lader.einmal(*r);
  }
  void bis(int64_t ziel) {
    while (t.s < ziel) {
      t.lauf(t.s + t.n);
      bus.insert(bus.end(), t.arr.spur_bus_l(0), t.arr.spur_bus_l(0) + t.n);
    }
  }
  int eintraege() const { return lader.cache().eintraege(); }
  std::vector<LaunchMeldung> meldungen() {
    LaunchMeldung m[32];
    const int n = t.arr.launch_meldungen(m, 32);
    return std::vector<LaunchMeldung>(m, m + n);
  }
  float spitze(int64_t von, int64_t bis_) const {
    float p = 0.0f;
    for (int64_t i = von; i < bis_ && i < static_cast<int64_t>(bus.size()); ++i) p = std::max(p, std::fabs(bus[static_cast<size_t>(i)]));
    return p;
  }
  void ende() {   // the playback is unloaded and everything returned (the Treiber then holds no snapshot)
    tausche(nullptr);
    lader_lauf();
  }
};

bool gleich(const std::vector<float>& x, const std::vector<float>& y) {
  if (x.size() != y.size()) return false;
  return std::memcmp(x.data(), y.data(), x.size() * sizeof(float)) == 0;
}

// the run without a swap: the same cell, started the same way (the reference of cases 1, 3, 6, 9)
std::vector<float> referenz(const char* name, int64_t ziel, int zelle_nr, double ab_beat, double versatz, bool kl, int64_t befehl_s) {
  Fix f(name, 100LL << 20, kl);
  cdj::ArrSnapshot* s = f.lade(f.zelle(zelle_nr, f.sha_a, "loop", 4.0, 2));
  f.t.arr.tausche(s, 0, f.t.k);
  f.bis(befehl_s);
  PRUEF(f.t.arr.launch_start(ID, zelle_nr, ab_beat, versatz, 1, false) == LaunchGrund::ok);
  f.bis(ziel);
  std::vector<float> aus = f.bus;
  f.t.arr.tausche(nullptr, f.t.s, f.t.k);
  delete s;
  return aus;
}

}  // namespace

static void fall_laufende_stimme(bool kl, const char* name_ref, const char* name) {
  const int64_t ziel = 8 * SPB;
  const std::vector<float> ref = referenz(name_ref, ziel, 1, 1.0, 0.0, kl, 0);
  Fix f(name, 100LL << 20, kl);
  cdj::ArrSnapshot* s1 = f.lade(f.zelle(1, f.sha_a, "loop", 4.0, 2));
  f.tausche(s1);
  PRUEF(f.t.arr.launch_start(ID, 1, 1.0, 0.0, 1, false) == LaunchGrund::ok);
  f.bis(2 * SPB);   // the voice plays since beat 1
  PRUEF(f.t.arr.launch_stimmen() == 1);
  // swap: cell 1 cleared, cell 2 carries the other audio (the track keeps its id and a filled cell)
  cdj::ArrSnapshot* s2 = f.lade(f.zelle(2, f.sha_b, "loop", 4.0, 2));
  f.tausche(s2);
  f.lader_lauf();   // the old snapshot is released: its audio (a) has no snapshot any more, only the voice
  PRUEF(f.eintraege() == 2);   // a (held by the voice) and b
  f.bis(4 * SPB);
  f.lader_lauf();
  PRUEF(f.eintraege() == 2);
  f.bis(ziel);
  PRUEF(gleich(f.bus, ref));   // bit-equal to the run without the swap
  // 2 / 3: the voice stops, the audio goes
  PRUEF(f.t.arr.launch_stopp(ID, 9.0, 2, false) == LaunchGrund::ok);
  f.bis(ziel + 2 * SPB);
  PRUEF(f.t.arr.launch_stimmen() == 0);
  f.lader_lauf();
  PRUEF(f.eintraege() == 1);
  PRUEF(f.lader.cache().gesperrt() == CELL * 8);
  f.ende();
  PRUEF(f.eintraege() == 0 && f.konto.gesperrt() == 0);
}

int main() {
  {  // 1 + 2: re-pitch loop across a swap
    fall_laufende_stimme(false, "k4_ref1", "k4_f1");
  }
#if defined(CYPHERDJ_BUNGEE)
  {  // 3: keylock loop across a swap (the werk slot reads the audio until its thread lets go)
    fall_laufende_stimme(true, "k4_ref3", "k4_f3");
  }
#endif
  {  // 4: budget stays conservative while deferred
    Fix f("k4_f4", 2 * CELL * 8 + CELL * 4);   // room for two audios and a half
    cdj::ArrSnapshot* s1 = f.lade(f.zelle(1, f.sha_a, "loop", 4.0, 2));
    f.tausche(s1);
    PRUEF(f.t.arr.launch_start(ID, 1, 1.0, 0.0, 1, false) == LaunchGrund::ok);
    f.bis(2 * SPB);
    cdj::ArrSnapshot* s2 = f.lade(f.zelle(2, f.sha_b, "loop", 4.0, 2));
    f.tausche(s2);
    f.lader_lauf();
    PRUEF(f.eintraege() == 2);
    std::string grund;
    cdj::ArrSnapshot* s3 = f.lade(f.zelle(3, f.sha_c, "loop", 4.0, 2), &grund);
    PRUEF(s3 == nullptr && grund == "zu_gross");   // a (deferred) + b + c do not fit
    PRUEF(f.t.arr.launch_stopp(ID, 3.0, 2, false) == LaunchGrund::ok);
    f.bis(6 * SPB);
    f.lader_lauf();
    PRUEF(f.eintraege() == 1);
    s3 = f.lade(f.zelle(3, f.sha_c, "loop", 4.0, 2), &grund);   // now it fits
    PRUEF(s3 != nullptr);
    f.tausche(s3);
    f.lader_lauf();
    f.ende();
    PRUEF(f.eintraege() == 0 && f.konto.gesperrt() == 0);
  }
  {  // 5: no voice, no pending start: the release frees at once
    Fix f("k4_f5");
    cdj::ArrSnapshot* s1 = f.lade(f.zelle(1, f.sha_a, "loop", 4.0, 2));
    f.tausche(s1);
    f.bis(SPB);
    cdj::ArrSnapshot* s2 = f.lade(f.zelle(2, f.sha_b, "loop", 4.0, 2));
    f.tausche(s2);
    f.lader_lauf();
    PRUEF(f.eintraege() == 1);   // only b
    f.ende();
    PRUEF(f.eintraege() == 0 && f.konto.gesperrt() == 0);
  }
  {  // 6: pending start across a swap: the audio of the acceptance plays
    const int64_t ziel = 8 * SPB;
    const std::vector<float> ref = referenz("k4_ref6", ziel, 1, 3.0, 0.0, false, 0);
    Fix f("k4_f6");
    cdj::ArrSnapshot* s1 = f.lade(f.zelle(1, f.sha_a, "loop", 4.0, 2));
    f.tausche(s1);
    PRUEF(f.t.arr.launch_start(ID, 1, 3.0, 0.0, 1, false) == LaunchGrund::ok);   // takes effect at beat 3, sample 67 500
    f.bis(SPB / 2);
    cdj::ArrSnapshot* s2 = f.lade(f.zelle(1, f.sha_b, "loop", 4.0, 2));   // cell 1 now carries another audio
    f.tausche(s2);
    f.lader_lauf();
    PRUEF(f.eintraege() == 2);   // a is held by the pending start
    f.bis(2 * SPB);
    f.lader_lauf();
    PRUEF(f.eintraege() == 2);
    f.bis(ziel);
    PRUEF(gleich(f.bus, ref));   // the audio of the acceptance, not b
    PRUEF(f.t.arr.launch_stopp(ID, 9.0, 2, false) == LaunchGrund::ok);
    f.bis(ziel + 2 * SPB);
    f.lader_lauf();
    PRUEF(f.eintraege() == 1);
    f.ende();
    PRUEF(f.eintraege() == 0 && f.konto.gesperrt() == 0);
  }
  {  // 7: pending start, unload
    Fix f("k4_f7");
    cdj::ArrSnapshot* s1 = f.lade(f.zelle(1, f.sha_a, "loop", 4.0, 2));
    f.tausche(s1);
    PRUEF(f.t.arr.launch_start(ID, 1, 3.0, 0.0, 7, false) == LaunchGrund::ok);
    f.bis(SPB / 2);
    f.tausche(nullptr);   // unload
    f.lader_lauf();
    PRUEF(f.eintraege() == 0);   // K5: the unload drops the pending start at once and releases its hold
    f.bis(6 * SPB);          // over ab_beat
    PRUEF(f.spitze(0, static_cast<int64_t>(f.bus.size())) == 0.0f);   // nothing sounds
    PRUEF(f.t.arr.launch_stimmen() == 0);
    const auto m = f.meldungen();
    bool sieben = false;
    for (const LaunchMeldung& x : m) sieben = sieben || (x.id == 7 && x.status == 7);
    PRUEF(sieben);
    f.lader_lauf();
    PRUEF(f.eintraege() == 0 && f.konto.gesperrt() == 0);
  }
  {  // 8: replaced and aborted pending starts let go
    Fix f("k4_f8");
    cdj::ArrSnapshot* s1 = f.lade(f.zelle(1, f.sha_a, "loop", 4.0, 2) + "," + f.zelle(2, f.sha_b, "loop", 4.0, 2));
    f.tausche(s1);
    PRUEF(f.t.arr.launch_start(ID, 1, 6.0, 0.0, 1, false) == LaunchGrund::ok);   // a pending
    PRUEF(f.t.arr.launch_start(ID, 2, 6.0, 0.0, 2, false) == LaunchGrund::ok);   // replaced by b
    cdj::ArrSnapshot* s2 = f.lade(f.zelle(3, f.sha_c, "loop", 4.0, 2));          // neither a nor b in the new snapshot
    f.tausche(s2);
    f.lader_lauf();
    PRUEF(f.eintraege() == 1);   // K5: only c; a went with the replaced start, b with the swap that cleared its cell (the pending start became a stop)
    PRUEF(f.t.arr.launch_stopp(ID, 7.0, 3, false) == LaunchGrund::ok);   // the pending stop replaces the pending start of b
    f.bis(SPB);
    f.lader_lauf();
    PRUEF(f.eintraege() == 1);   // only c
    f.ende();
    PRUEF(f.eintraege() == 0 && f.konto.gesperrt() == 0);
  }
#if defined(CYPHERDJ_BUNGEE)
  {  // 9: pending keylock start across a swap, prepared ahead after the swap
    const int64_t ziel = 10 * SPB;
    const std::vector<float> ref = referenz("k4_ref9", ziel, 1, 6.0, 0.0, true, 0);
    Fix f("k4_f9", 100LL << 20, true);
    cdj::ArrSnapshot* s1 = f.lade(f.zelle(1, f.sha_a, "loop", 4.0, 2));
    f.tausche(s1);
    PRUEF(f.t.arr.launch_start(ID, 1, 6.0, 0.0, 1, false) == LaunchGrund::ok);
    f.bis(SPB / 2);
    cdj::ArrSnapshot* s2 = f.lade(f.zelle(1, f.sha_b, "loop", 4.0, 2));
    f.tausche(s2);
    f.lader_lauf();
    PRUEF(f.eintraege() == 2);
    f.bis(5 * SPB);   // inside ARR_WARP_VORLAUF of the start: the voice is prepared ahead with the held audio
    f.lader_lauf();
    PRUEF(f.eintraege() == 2);
    f.bis(ziel);
    PRUEF(gleich(f.bus, ref));
    PRUEF(f.t.arr.launch_stopp(ID, 11.0, 2, false) == LaunchGrund::ok);
    f.bis(ziel + 2 * SPB);
    for (int i = 0; i < 4; ++i) {
      f.t.werk->takt(f.t.s);
      f.lader_lauf();
    }
    PRUEF(f.eintraege() == 1);
    f.ende();
    PRUEF(f.eintraege() == 0 && f.konto.gesperrt() == 0);
  }
#endif
  PRUEF_ENDE();
}
