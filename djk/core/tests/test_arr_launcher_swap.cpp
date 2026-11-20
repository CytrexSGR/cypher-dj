// Loop deck K5: the launcher follows snapshot swaps by track id, ends with /k/set/neu, unload and KI stop, and counts lost receipts.
// 128 BPM: 22 500 samples per beat; 4-beat cells of 90 000 frames. Blocks of 256. The track buses (spur_bus_l 0..3) are recorded per block.
//   1  tracks reordered (nr 1 -> 4): the playing voice continues bit-equal in the bus of the new index, stand shows the same cell
//   2  the track is gone from the new snapshot (or has no cells left): its voice ends at the swap sample with no fade tail, the state is gone
//   3  the playing cell replaced by other audio: the old audio plays on, verwaist; a new launch of that index plays the new audio
//   4  the playing cell cleared: plays on, verwaist
//   5  pending start whose cell is cleared by the swap: the track stops at ab_beat
//   6  launch_alles_aus: fade over ARR_NAHT (pending dropped with 7); sofort: silent from s
//   7  launch_ki_stopp: the pending launch of cypher dropped (7), the one of andreas kept
//   8  a launch across the region seam of the transport loop: onset and signal unchanged (spec 12)
//   9  pending start accepted, tracks reordered before ab_beat: the signal lands in the bus of the right track
//  10  pending start, its track gone: dropped with 7, nothing sounds
//  11  holds: alles_aus, ki_stopp, a gone track and a cleared cell release the audio to the cache at once
//  12  receipt overflow is counted and shown by launch_stand
#include <algorithm>
#include <cmath>
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
using cdj::ArrArt;
using cdj::ArrZelle;
using cdj::ArrZellArt;
using cdj::LaunchGrund;
using cdj::LaunchMeldung;
using cdj::LaunchStand;

static const uint64_t ID = cdj::arr_id("s1");
static const uint64_t ID2 = cdj::arr_id("s2");
static constexpr int64_t CELL = 4 * SPB;
static constexpr ArrZellArt LOOP = ArrZellArt::loop;
static const ArrZelle LEER{};

static ArrZelle zelle(Audio& a, float gain = 1.0f) {
  ArrZelle z;
  z.art = LOOP;
  z.audio = &a.a;
  z.frames = a.a.frames;
  z.beats = 4.0;
  z.gain = gain;
  z.modus = 2;
  return z;
}

// A snapshot with the deck tracks (spur nr, id text, cells); a track without an id text is a plain audio track.
struct SpurDef {
  int nr;
  const char* id;
  std::vector<ArrZelle> zs;
};
static cdj::ArrSnapshot* bauen(const std::vector<SpurDef>& defs) {
  Bau b;
  for (const SpurDef& d : defs) b.spur(d.nr, ArrArt::audio);
  cdj::ArrSnapshot* s = b.fertig();
  for (const SpurDef& d : defs) {
    cdj::ArrSpur& sp = s->spur[d.nr - 1];
    if (!d.id) continue;
    sp.kennung = cdj::arr_id(d.id);
    std::snprintf(sp.kennung_text, sizeof sp.kennung_text, "%s", d.id);
    for (size_t i = 0; i < d.zs.size(); ++i) {
      sp.zellen[i] = d.zs[i];
      if (d.zs[i].art != ArrZellArt::leer) ++sp.n_zellen;
    }
  }
  return s;
}

struct Lauf {
  Treiber t;
  std::vector<float> b[4];
  void bis(int64_t ziel) {
    while (t.s < ziel) {
      t.lauf(t.s + t.n);
      for (int i = 0; i < 4; ++i) b[i].insert(b[i].end(), t.arr.spur_bus_l(i), t.arr.spur_bus_l(i) + t.n);
    }
  }
  float at(int i, int64_t s) const { return b[i][static_cast<size_t>(s)]; }
  float spitze(int i, int64_t von, int64_t bis_) const {
    float p = 0.0f;
    for (int64_t s = von; s < bis_ && s < static_cast<int64_t>(b[i].size()); ++s) p = std::max(p, std::fabs(b[i][static_cast<size_t>(s)]));
    return p;
  }
};

static int stand(const cdj::Arrangement& a, LaunchStand* s) { return a.launch_stand(s, 8); }
static std::vector<LaunchMeldung> meldungen(cdj::Arrangement& a) {
  LaunchMeldung m[160];
  const int n = a.launch_meldungen(m, 160);
  return std::vector<LaunchMeldung>(m, m + n);
}
static bool hat(const std::vector<LaunchMeldung>& m, int64_t id, int status) {
  for (const LaunchMeldung& x : m)
    if (x.id == id && x.status == status) return true;
  return false;
}

// ---- cache cases (case 11): the loader path of test_arr_launcher_halt
namespace {
struct Fix {
  Treiber t;
  arrdatei::Ordner o;
  cdj::SpeicherKonto konto{200LL << 20};
  cdj::ArrLader lader;
  std::unique_ptr<cdj::ArrLaderRinge> r{std::make_unique<cdj::ArrLaderRinge>()};
  std::string sha_a, sha_b;
  int64_t nr = 0;
  explicit Fix(const char* name, bool werk = false) : o(name), lader(o.pfad, &konto, 100LL << 20, false) {
    sha_a = o.sinus('a', CELL, 440.0, 0.5f);
    sha_b = o.sinus('b', CELL, 660.0, 0.5f);
    if (werk) {
      PRUEF(t.mit_werk(0));
      lader.setze_warp_werk(t.werk.get());
    }
  }
  std::string zelle(int index, const std::string& sha) const {
    char z[640];
    std::snprintf(z, sizeof z,
                  "{\"index\":%d,\"sha256\":\"%s\",\"datei\":\"%s/audio/%s.f32\",\"frames\":%lld,\"beats\":4,\"art\":\"loop\",\"gain_db\":0,\"modus\":2}",
                  index, sha.c_str(), o.pfad.c_str(), sha.c_str(), static_cast<long long>(CELL));
    return z;
  }
  // a playback with the deck track "s1" (empty text: no deck track, only the plain track 1)
  cdj::ArrSnapshot* lade(const std::string& zellen, const char* id = "s1") {
    ++nr;
    const std::string idtext = id[0] ? std::string(",\"id\":\"") + id + "\",\"zellen\":[" + zellen + "]" : "";
    o.wiedergabe2_warp(nr, "{\"nr\":1,\"art\":\"audio\"" + idtext + ",\"clips\":[]}");
    cdj::ArrAuftrag a{};
    a.id = nr;
    std::snprintf(a.quelle, sizeof a.quelle, "andreas");
    a.nr = nr;
    PRUEF(r->auftraege.schiebe(a));
    PRUEF(lader.einmal(*r));
    cdj::ArrErgebnis e{};
    PRUEF(r->ergebnisse.hole(e));
    return e.snap;
  }
  void tausche(cdj::ArrSnapshot* neu) {
    if (const cdj::ArrSnapshot* alt = t.arr.tausche(neu, t.s, t.k)) PRUEF(r->rueckgabe.schiebe(const_cast<cdj::ArrSnapshot*>(alt)));
  }
  void lader_lauf() {
    for (int i = 0; i < 4; ++i) lader.einmal(*r);
  }
  void bis(int64_t ziel) {
    while (t.s < ziel) t.lauf(t.s + t.n);
  }
  int eintraege() const { return lader.cache().eintraege(); }
  void ende() {
    tausche(nullptr);
    lader_lauf();
  }
};
}  // namespace

int main() {
  auto ram = Audio::rampe(CELL);
  auto g50 = Audio::gleich(CELL, 0.5f);
  auto g25 = Audio::gleich(CELL, 0.25f);
  const int64_t BLK = 256;

  {  // 1: reorder
    Lauf ref;
    ref.t.laden(bauen({{1, "s1", {zelle(*ram)}}}));
    PRUEF(ref.t.arr.launch_start(ID, 1, 1.0, 0.0, 1, false) == LaunchGrund::ok);
    ref.bis(8 * SPB);
    Lauf x;
    x.t.laden(bauen({{1, "s1", {zelle(*ram)}}}));
    PRUEF(x.t.arr.launch_start(ID, 1, 1.0, 0.0, 1, false) == LaunchGrund::ok);
    x.bis(2 * SPB + 3 * BLK);
    const int64_t sw = x.t.s;   // the swap sample (a block boundary)
    x.t.laden(bauen({{4, "s1", {zelle(*ram)}}}));
    LaunchStand st[8];
    PRUEF(stand(x.t.arr, st) == 1 && st[0].zelle == 1 && !st[0].verwaist && st[0].kennung == ID);
    x.bis(8 * SPB);
    bool gl = ref.b[0].size() == x.b[0].size();
    for (size_t i = 0; gl && i < ref.b[0].size(); ++i) {
      const float v = x.b[0][i] + x.b[3][i];
      gl = std::memcmp(&v, &ref.b[0][i], sizeof v) == 0 && (x.b[0][i] == 0.0f || x.b[3][i] == 0.0f);
    }
    PRUEF(gl);
    PRUEF(x.spitze(3, sw, 8 * SPB) > 1.0f);   // really in the new bus
    PRUEF(x.spitze(0, sw, 8 * SPB) == 0.0f);
    PRUEF(stand(x.t.arr, st) == 1 && st[0].zelle == 1 && !st[0].verwaist);
  }
  {  // 2: the track is gone
    Lauf x;
    x.t.laden(bauen({{1, "s1", {zelle(*g50)}}}));
    PRUEF(x.t.arr.launch_start(ID, 1, 0.0, 0.0, 1, false) == LaunchGrund::ok);
    x.bis(2 * SPB);
    const int64_t s = x.t.s;
    x.t.laden(bauen({{1, nullptr, {}}}));   // track 1 is a plain audio track now
    x.bis(s + 4 * BLK);
    PRUEF_NAH(x.at(0, s - 1), 0.5, 1e-6);
    PRUEF(x.spitze(0, s, s + 4 * BLK) == 0.0f);   // no fade tail into the bus of whatever sits at that index now
    LaunchStand st[8];
    PRUEF(stand(x.t.arr, st) == 0);
    PRUEF(x.t.arr.launch_stimmen() == 0);
  }
  {  // 2b: the track keeps its id but has no cell left (n_zellen 0): it is gone for the launcher too, no tail
    Lauf x;
    x.t.laden(bauen({{1, "s1", {zelle(*g50)}}}));
    PRUEF(x.t.arr.launch_start(ID, 1, 0.0, 0.0, 1, false) == LaunchGrund::ok);
    x.bis(2 * SPB);
    const int64_t s = x.t.s;
    x.t.laden(bauen({{1, "s1", {}}}));
    x.bis(s + 4 * BLK);
    PRUEF_NAH(x.at(0, s - 1), 0.5, 1e-6);
    PRUEF(x.spitze(0, s, s + 4 * BLK) == 0.0f);
    PRUEF(x.t.arr.launch_stimmen() == 0);
  }
  {  // 3: cell replaced
    Lauf x;
    x.t.laden(bauen({{1, "s1", {zelle(*g50)}}}));
    PRUEF(x.t.arr.launch_start(ID, 1, 0.0, 0.0, 1, false) == LaunchGrund::ok);
    x.bis(2 * SPB);
    x.t.laden(bauen({{1, "s1", {zelle(*g25)}}}));
    LaunchStand st[8];
    PRUEF(stand(x.t.arr, st) == 1 && st[0].zelle == 1 && st[0].verwaist);
    x.bis(3 * SPB);
    PRUEF_NAH(x.at(0, 3 * SPB - 1), 0.5, 1e-6);   // the old audio plays on
    PRUEF(x.t.arr.launch_start(ID, 1, 4.0, 0.0, 2, false) == LaunchGrund::ok);   // a new launch of that index
    x.bis(6 * SPB);
    PRUEF_NAH(x.at(0, 6 * SPB - 1), 0.25, 1e-6);
    PRUEF(stand(x.t.arr, st) == 1 && !st[0].verwaist);
  }
  {  // 4: cell cleared (cell 2 keeps the track in the snapshot)
    Lauf x;
    x.t.laden(bauen({{1, "s1", {zelle(*g50)}}}));
    PRUEF(x.t.arr.launch_start(ID, 1, 0.0, 0.0, 1, false) == LaunchGrund::ok);
    x.bis(2 * SPB);
    x.t.laden(bauen({{1, "s1", {LEER, zelle(*g25)}}}));
    LaunchStand st[8];
    PRUEF(stand(x.t.arr, st) == 1 && st[0].zelle == 1 && st[0].verwaist);
    x.bis(3 * SPB);
    PRUEF_NAH(x.at(0, 3 * SPB - 1), 0.5, 1e-6);
  }
  {  // 5: pending start on a cell the swap clears: the track stops at ab_beat
    Lauf x;
    x.t.laden(bauen({{1, "s1", {zelle(*g50), zelle(*g25)}}}));
    PRUEF(x.t.arr.launch_start(ID, 1, 0.0, 0.0, 1, false) == LaunchGrund::ok);
    x.bis(SPB);
    PRUEF(x.t.arr.launch_start(ID, 2, 4.0, 0.0, 2, false) == LaunchGrund::ok);
    x.t.laden(bauen({{1, "s1", {zelle(*g50)}}}));   // cell 2 gone (cell 1 keeps the track)
    LaunchStand st[8];
    PRUEF(stand(x.t.arr, st) == 1 && st[0].wartend == 0 && st[0].wartend_ab == 4.0);
    x.bis(6 * SPB);
    PRUEF_NAH(x.at(0, 4 * SPB - 1), 0.5, 1e-6);
    PRUEF(x.spitze(0, 4 * SPB + cdj::ARR_NAHT, 6 * SPB) == 0.0f);   // stopped, no 0.25
    PRUEF(stand(x.t.arr, st) == 0 || (st[0].zelle == 0 && st[0].wartend == -1));
    PRUEF(hat(meldungen(x.t.arr), 2, 3));
  }
  {  // 6: alles_aus, fade and sofort
    for (int sofort = 0; sofort < 2; ++sofort) {
      Lauf x;
      x.t.laden(bauen({{1, "s1", {zelle(*g50), zelle(*g25)}}}));
      PRUEF(x.t.arr.launch_start(ID, 1, 0.0, 0.0, 1, false) == LaunchGrund::ok);
      x.bis(2 * SPB);
      PRUEF(x.t.arr.launch_start(ID, 2, 4.0, 0.0, 2, false) == LaunchGrund::ok);
      const int64_t s = x.t.s;
      x.t.arr.launch_alles_aus(s, sofort != 0);
      x.bis(s + 4 * BLK);
      PRUEF(hat(meldungen(x.t.arr), 2, 7));
      if (sofort) {
        PRUEF(x.spitze(0, s, s + 4 * BLK) == 0.0f);
      } else {
        PRUEF(x.at(0, s + 10) > 0.0f && x.at(0, s + 10) < 0.5f);
        PRUEF(x.spitze(0, s + cdj::ARR_NAHT, s + 4 * BLK) == 0.0f);
      }
      x.bis(6 * SPB);
      PRUEF(x.spitze(0, s + cdj::ARR_NAHT, 6 * SPB) == 0.0f);   // the dropped start never plays
      PRUEF(x.t.arr.launch_stimmen() == 0 && x.t.arr.launch_ruhig());
    }
  }
  {  // 7: KI stop
    Lauf x;
    x.t.laden(bauen({{1, "s1", {zelle(*g50)}}, {2, "s2", {zelle(*g25)}}}));
    PRUEF(x.t.arr.launch_start(ID, 1, 3.0, 0.0, 1, true) == LaunchGrund::ok);    // cypher
    PRUEF(x.t.arr.launch_start(ID2, 1, 3.0, 0.0, 2, false) == LaunchGrund::ok);  // andreas
    x.bis(SPB);
    x.t.arr.launch_ki_stopp();
    const auto m = meldungen(x.t.arr);
    PRUEF(hat(m, 1, 7) && !hat(m, 2, 7));
    x.bis(5 * SPB);
    PRUEF(x.spitze(0, 0, 5 * SPB) == 0.0f);
    PRUEF_NAH(x.at(1, 5 * SPB - 1), 0.25, 1e-6);
  }
  {  // 8: launch across the region seam
    const int64_t ziel = 5 * SPB;
    Lauf ref;
    ref.t.laden(bauen({{1, "s1", {zelle(*ram)}}}));
    PRUEF(ref.t.arr.launch_start(ID, 1, 2.0, 0.0, 1, false) == LaunchGrund::ok);
    ref.bis(ziel);
    Lauf x;
    x.t.laden(bauen({{1, "s1", {zelle(*ram)}}}));
    x.t.arr.start(0.0, 0, false, 0, 0, 256, x.t.k);
    x.t.arr.loop(true, 0.0, 2.0, x.t.s, x.t.k);   // the region wraps at sample 45 000 = T: its last sample is T - 1
    PRUEF(x.t.arr.launch_start(ID, 1, 2.0, 0.0, 1, false) == LaunchGrund::ok);
    x.bis(ziel);
    PRUEF(x.t.arr.status() == cdj::ArrStatus::spielt);
    int64_t erster = -1;
    for (int64_t i = 1; i < ziel && erster < 0; ++i)
      if (std::fabs(x.at(0, i)) > 1e-6f) erster = i;
    PRUEF(erster == 2 * SPB + 1);   // the ramp is 0 at frame 0
    PRUEF(x.b[0].size() == ref.b[0].size() && std::memcmp(x.b[0].data(), ref.b[0].data(), x.b[0].size() * sizeof(float)) == 0);
  }
  {  // 9: pending start, tracks reordered before ab_beat
    Lauf ref;
    ref.t.laden(bauen({{1, "s1", {zelle(*ram)}}}));
    PRUEF(ref.t.arr.launch_start(ID, 1, 3.0, 0.0, 1, false) == LaunchGrund::ok);
    ref.bis(6 * SPB);
    Lauf x;
    x.t.laden(bauen({{1, "s1", {zelle(*ram)}}}));
    PRUEF(x.t.arr.launch_start(ID, 1, 3.0, 0.0, 1, false) == LaunchGrund::ok);
    x.bis(SPB);
    x.t.laden(bauen({{3, "s1", {zelle(*ram)}}}));
    x.bis(6 * SPB);
    bool gl = true;
    for (size_t i = 0; i < ref.b[0].size(); ++i) gl = gl && std::memcmp(&x.b[2][i], &ref.b[0][i], sizeof(float)) == 0;
    PRUEF(gl);
    PRUEF(x.spitze(2, 3 * SPB, 6 * SPB) > 1.0f);
    PRUEF(x.spitze(0, 0, 6 * SPB) == 0.0f);
    PRUEF(hat(meldungen(x.t.arr), 1, 3));
  }
  {  // 10: pending start, its track gone
    Lauf x;
    x.t.laden(bauen({{1, "s1", {zelle(*g50)}}}));
    PRUEF(x.t.arr.launch_start(ID, 1, 3.0, 0.0, 5, false) == LaunchGrund::ok);
    x.bis(SPB);
    x.t.laden(bauen({{1, nullptr, {}}}));
    PRUEF(hat(meldungen(x.t.arr), 5, 7));
    x.bis(6 * SPB);
    PRUEF(x.spitze(0, 0, 6 * SPB) == 0.0f);
    PRUEF(x.t.arr.launch_ruhig());
  }
  {  // 11: the holds are released at once
    {  // alles_aus with a voice and a pending start of another cell
      Fix f("k5_f11a");
      cdj::ArrSnapshot* s1 = f.lade(f.zelle(1, f.sha_a) + "," + f.zelle(2, f.sha_b));
      f.tausche(s1);
      PRUEF(f.t.arr.launch_start(ID, 1, 0.0, 0.0, 1, false) == LaunchGrund::ok);
      f.bis(SPB);
      PRUEF(f.t.arr.launch_start(ID, 2, 6.0, 0.0, 2, false) == LaunchGrund::ok);
      f.tausche(f.lade("", ""));   // no deck track: voice and pending start are the only owners of a and b (gone track: the voice ends at once, the start is dropped)
      f.lader_lauf();
      PRUEF(f.eintraege() == 0);   // no fade tail: a is free at the swap, b too
      f.ende();
    }
    {  // alles_aus
      Fix f("k5_f11b");
      cdj::ArrSnapshot* s1 = f.lade(f.zelle(1, f.sha_a) + "," + f.zelle(2, f.sha_b));
      f.tausche(s1);
      PRUEF(f.t.arr.launch_start(ID, 1, 0.0, 0.0, 1, false) == LaunchGrund::ok);
      f.bis(SPB);
      PRUEF(f.t.arr.launch_start(ID, 2, 6.0, 0.0, 2, false) == LaunchGrund::ok);
      f.tausche(f.lade(f.zelle(3, f.sha_b)));   // a: only the voice, b: the pending start and the new cell 3
      f.lader_lauf();
      PRUEF(f.eintraege() == 2);
      f.t.arr.launch_alles_aus(f.t.s, true);
      f.lader_lauf();
      PRUEF(f.eintraege() == 1);   // only b of the snapshot
      f.ende();
      PRUEF(f.eintraege() == 0 && f.konto.gesperrt() == 0);
    }
    {  // ki_stopp of a pending start whose audio only the pending start holds
      Fix f("k5_f11c");
      cdj::ArrSnapshot* s1 = f.lade(f.zelle(1, f.sha_a));
      f.tausche(s1);
      PRUEF(f.t.arr.launch_start(ID, 1, 6.0, 0.0, 1, true) == LaunchGrund::ok);
      f.tausche(f.lade(f.zelle(1, f.sha_b)));
      f.lader_lauf();
      PRUEF(f.eintraege() == 2);
      f.t.arr.launch_ki_stopp();
      f.lader_lauf();
      PRUEF(f.eintraege() == 1);
      f.ende();
      PRUEF(f.eintraege() == 0 && f.konto.gesperrt() == 0);
    }
    {  // a pending start whose cell the swap clears turns into a stop and lets go
      Fix f("k5_f11d");
      cdj::ArrSnapshot* s1 = f.lade(f.zelle(1, f.sha_a) + "," + f.zelle(2, f.sha_b));
      f.tausche(s1);
      PRUEF(f.t.arr.launch_start(ID, 2, 6.0, 0.0, 1, false) == LaunchGrund::ok);
      f.tausche(f.lade(f.zelle(1, f.sha_a)));
      f.lader_lauf();
      PRUEF(f.eintraege() == 1);   // b is free at once
      f.ende();
      PRUEF(f.eintraege() == 0 && f.konto.gesperrt() == 0);
    }
#if defined(CYPHERDJ_BUNGEE)
    {  // a pending keylock start prepared ahead, then alles_aus
      Fix f("k5_f11e", true);
      cdj::ArrSnapshot* s1 = f.lade(f.zelle(1, f.sha_a));
      f.tausche(s1);
      PRUEF(f.t.arr.launch_start(ID, 1, 6.0, 0.0, 1, false) == LaunchGrund::ok);
      f.tausche(f.lade(f.zelle(1, f.sha_b)));
      f.bis(5 * SPB);
      f.t.arr.launch_alles_aus(f.t.s, false);
      f.lader_lauf();
      PRUEF(f.eintraege() == 1);
      f.bis(7 * SPB);
      PRUEF(f.t.arr.launch_stimmen() == 0);
      f.ende();
      PRUEF(f.eintraege() == 0 && f.konto.gesperrt() == 0);
    }
#endif
  }
  {  // 12: receipt overflow
    Lauf x;
    x.t.laden(bauen({{1, "s1", {zelle(*g50)}}}));
    for (int i = 0; i < 131; ++i) PRUEF(x.t.arr.launch_start(ID, 1, 50.0 + i, 0.0, 100 + i, false) == LaunchGrund::ok);   // 130 replaced starts = 130 receipts
    PRUEF(x.t.arr.launch_meldungen_verloren() == 2);
    LaunchStand st[8];
    PRUEF(stand(x.t.arr, st) == 1 && st[0].meldungen_verloren == 2);
    const auto m = meldungen(x.t.arr);
    PRUEF(m.size() == 128 && m[0].id == 102 && m[127].id == 229);   // the two oldest are the ones counted
  }
  PRUEF_ENDE();
}
