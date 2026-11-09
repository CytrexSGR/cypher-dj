// 1.10 T9 (AK24): the render-only key mask. A per-track loudness render isolates a track; a key source (a kick that ducks the bass through a compressor key) must keep
// running for its key point and still add nothing to the output. RenderAuftrag::nur_schluessel lists the key sources: bare = the strip captures its key points normally and
// writes zero into its target and its sends; ":ziel" keeps the target (a member that feeds a key-only group), ":sends" keeps the sends (a track that feeds a key-only return).
// Cases: the ducked bass (track key post); a group key (group 2 post on a PM stage, group 2 pre on a group stage); a return key (return 1 post on a PM stage); the project
// without the flag is bit-equal, and an id of a source that does not exist is ignored. Mutation NUR_SCHLUESSEL_STUMM (arr_output.cpp): the mask zeroes the key as well, the
// ducked-bass case goes red. T10 (--trocken-aus, the return as the mix feeds it): see the case "dry-out"; the unflagged renders keep their bit pattern (checksums printed at the end).
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <string>
#include <vector>

#include "arr_file.h"
#include "cypherdj/render.h"
#include "check.h"

namespace {
constexpr int FRAMES = 400000;
constexpr double SR = 48000.0;
constexpr int KLICK_ABSTAND = 24000;   // a click every 500 ms
constexpr int KLICK_LAENGE = 1440;     // 30 ms of 1 kHz

// the kick: 30 ms bursts of a 1 kHz sine at 0.5 every 500 ms, silence in between
std::string klicks(const arrdatei::Ordner& o, char z) {
  const std::string sha(64, z);
  std::vector<float> d(static_cast<size_t>(FRAMES) * 2, 0.0f);
  for (int f = 0; f < FRAMES; ++f)
    if (f % KLICK_ABSTAND < KLICK_LAENGE) d[2 * f] = d[2 * f + 1] = 0.5f * static_cast<float>(std::sin(2.0 * 3.14159265358979323846 * 1000.0 * f / SR));
  std::ofstream(o.pfad + "/audio/" + sha + ".f32", std::ios::binary).write(reinterpret_cast<const char*>(d.data()), static_cast<std::streamsize>(d.size() * sizeof(float)));
  return sha;
}

double peak_db(const cdj::RenderErgebnis& e) {
  float p = 0.0f;
  for (size_t i = 0; i < e.l.size(); ++i) p = std::max(p, std::max(std::fabs(e.l[i]), std::fabs(e.r[i])));
  return p > 0.0f ? 20.0 * std::log10(static_cast<double>(p)) : -300.0;
}

// RMS in dBFS of the window [von, bis) in frames
double fenster_db(const cdj::RenderErgebnis& e, int64_t von, int64_t bis) {
  double q = 0.0;
  int64_t n = 0;
  for (int64_t i = von; i < bis && i < static_cast<int64_t>(e.l.size()); ++i, ++n) q += static_cast<double>(e.l[i]) * e.l[i] + static_cast<double>(e.r[i]) * e.r[i];
  return 10.0 * std::log10(q / static_cast<double>(2 * std::max<int64_t>(n, 1)) + 1e-20);
}

// smallest reduction in dB over the clicks: window from 5 ms to 40 ms after the start of each click, reference minus keyed
double kleinste_absenkung(const cdj::RenderErgebnis& ref, const cdj::RenderErgebnis& e, int skip) {
  double kl = 1e9;
  for (int k = skip; k < 6; ++k) {
    const int64_t a = static_cast<int64_t>(k) * KLICK_ABSTAND + 240, b = static_cast<int64_t>(k) * KLICK_ABSTAND + 1920;
    kl = std::min(kl, fenster_db(ref, a, b) - fenster_db(e, a, b));
  }
  return kl;
}

// FNV-1a over the bits of both channels: the unflagged renders must keep these values across the change of T10 (printed, compared by hand against the build before)
uint64_t pruefsumme(const cdj::RenderErgebnis& e) {
  uint64_t h = 1469598103934665603ull;
  const auto mische = [&](const std::vector<float>& v) {
    for (float x : v) {
      uint32_t u;
      std::memcpy(&u, &x, 4);
      for (int b = 0; b < 4; ++b) h = (h ^ ((u >> (8 * b)) & 0xffu)) * 1099511628211ull;
    }
  };
  mische(e.l);
  mische(e.r);
  return h;
}

bool gleich(const cdj::RenderErgebnis& a, const cdj::RenderErgebnis& b) {
  return a.l.size() == b.l.size() && a.r.size() == b.r.size() && std::memcmp(a.l.data(), b.l.data(), a.l.size() * sizeof(float)) == 0 &&
         std::memcmp(a.r.data(), b.r.data(), a.r.size() * sizeof(float)) == 0;
}

struct Fall {
  const arrdatei::Ordner& o;
  std::string bass, kick;
  std::string spur(int nr, const std::string& sha, const std::string& extra) const {
    return "{\"nr\":" + std::to_string(nr) + ",\"art\":\"audio\"" + extra + ",\"clips\":[" + o.clip(("c" + std::to_string(nr)).c_str(), 0.0, 16.0, sha, FRAMES) + "]}";
  }
  static std::string stufe(const std::string& key) { return "{\"art\":\"komp\",\"slot\":1,\"key\":" + key + "}"; }
  static std::string kette(const std::string& key) { return "[" + stufe(key) + "]"; }
};

// controls: tracks 1..3 at 0 dB (track 1 can be taken down to -200 for the residual case), group 1 and 2, return 1, the stage in slot 1 (one stage per project)
std::vector<cdj::SpurRegler> regler(bool bass_aus, const std::vector<int>& stumm, const std::vector<int>& sends) {
  std::vector<cdj::SpurRegler> v;
  const auto streifen = [&](const std::string& p, float fader, float mute) {
    v.push_back({p + "fader", fader});
    v.push_back({p + "pan", 0.0f});
    v.push_back({p + "mute", mute});
    v.push_back({p + "solo", 0.0f});
  };
  for (int s = 1; s <= 3; ++s) {
    bool m = false;
    for (int x : stumm) m = m || x == s;
    streifen("spur/" + std::to_string(s) + "/", s == 1 && bass_aus ? -200.0f : 0.0f, m ? 1.0f : 0.0f);
  }
  for (int g = 1; g <= 2; ++g) streifen("grp/" + std::to_string(g) + "/", 0.0f, 0.0f);
  streifen("ret/1/", 0.0f, 0.0f);
  for (int s : sends) v.push_back({"spur/" + std::to_string(s) + "/send/1", 0.0f});
  const std::pair<const char*, float> zeilen[] = {{"schwelle", -30.0f}, {"ratio", 8.0f}, {"knie", 0.0f}, {"attack", 1.0f}, {"release", 100.0f}, {"makeup", 0.0f}, {"mix", 1.0f}, {"schp", 0.0f}, {"sc", 0.0f}, {"an", 1.0f}};
  for (const auto& z : zeilen) v.push_back({std::string("ins/komp/1/") + z.first, z.second});
  return v;
}

cdj::RenderErgebnis render(const arrdatei::Ordner& o, int nr, const std::vector<cdj::SpurRegler>& r, const std::vector<std::string>& flag, bool trocken_aus = false) {
  cdj::RenderAuftrag a;
  a.arr_ordner = o.pfad;
  a.nr = nr;
  a.von_beat = 0.0;
  a.bis_beat = 8.0;
  a.bpm = 128.0;
  a.regler_projekt = true;
  a.spur_regler = r;
  a.abgriff = cdj::RenderAbgriff::produktion;
  a.nur_schluessel = flag;
  a.trocken_aus = trocken_aus;
  cdj::RenderErgebnis e = cdj::rendere(a);
  if (!e.fehler.empty()) std::fprintf(stderr, "render %d: %s: %s\n", nr, e.fehler.c_str(), e.meldung.c_str());
  return e;
}
}  // namespace

int main() {
  arrdatei::Ordner o("test_render_nur_schluessel");
  Fall f{o, o.sinus('a', FRAMES, 220.0, 0.01f), klicks(o, 'b')};   // the bass is -40 dBFS peak: below the threshold of its own detector, so it reduces only through a loud key
  const std::string kopf = "{\"format\":\"cypherdj-arr/2\",\"nr\":";

  // --- track key: the bass (track 1) has a stage keyed by the kick, track 2, post
  const std::string key_spur = "{\"q\":\"spur\",\"nr\":2,\"punkt\":\"post\"}";
  o.roh(1, kopf + "1,\"spuren\":[" + f.spur(1, f.bass, ",\"chain\":" + Fall::kette(key_spur)) + "," + f.spur(2, f.kick, "") + "],\"gruppen\":[]}");
  const auto r_alle = regler(false, {}, {});
  const auto r_kick_stumm = regler(false, {2}, {});
  const cdj::RenderErgebnis ref1 = render(o, 1, r_kick_stumm, {});                 // the bug this closes: the isolation mutes the kick, the key is gone, the bass is not ducked
  const cdj::RenderErgebnis mit1 = render(o, 1, r_alle, {"spur/2"});               // the kick listed: it runs for its key and adds nothing
  const cdj::RenderErgebnis rest1 = render(o, 1, regler(true, {}, {}), {"spur/2"});   // the bass taken down: what is left is the residual of the kick
  const cdj::RenderErgebnis voll1 = render(o, 1, r_alle, {});                      // today: the kick plays in the output
  PRUEF(ref1.fehler.empty() && mit1.fehler.empty() && rest1.fehler.empty() && voll1.fehler.empty());
  std::printf("track key: bass alone (kick muted, no flag) %.2f dBFS; kick listed %.2f dBFS, smallest reduction %.2f dB; residual %.1f dBFS; kick in the output without flag %.2f dBFS\n",
              fenster_db(ref1, 0, FRAMES), fenster_db(mit1, 0, FRAMES), kleinste_absenkung(ref1, mit1, 0), peak_db(rest1), fenster_db(voll1, 0, 24000));
  PRUEF(fenster_db(ref1, 0, FRAMES) > -60.0 && fenster_db(ref1, 0, FRAMES) < -30.0);   // there is a bass
  PRUEF(kleinste_absenkung(ref1, ref1, 0) == 0.0);                                    // sanity of the measure
  PRUEF(kleinste_absenkung(voll1, ref1, 1) < -6.0 || fenster_db(voll1, 0, 24000) > fenster_db(ref1, 0, 24000) + 6.0);   // the unflagged render carries the kick audibly
  PRUEF(kleinste_absenkung(ref1, mit1, 0) >= 6.0);                                    // ducked after each click
  PRUEF(peak_db(rest1) < -120.0);                                                     // the kick leaves nothing in the output
  // the same bass without the flag and without the mute is ducked too but carries the kick: the control is the tracks' sum, not the isolation
  PRUEF(peak_db(voll1) > -12.0);

  // --- lanes: the kick sits at -200 dB as a base value and a fader lane (0 dB) brings it in; the per-track render of the bass must keep that lane (the server keeps the lanes of
  // the key sources), or the key is silent. With the lane the bass is ducked and the kick leaves no residual; without it (the lanes stripped) the bass is not ducked.
  {
    const std::string lane = arrdatei::Ordner::auto_lane({{0.0, 0.0, 0}, {16.0, 0.0, 0}});
    const auto datei = [&](int nr, bool mit_lane) {
      o.roh(nr, kopf + std::to_string(nr) + ",\"spuren\":[" + f.spur(1, f.bass, ",\"chain\":" + Fall::kette(key_spur)) + "," + f.spur(2, f.kick, mit_lane ? ",\"auto\":[" + lane + "]" : "") + "],\"gruppen\":[]}");
    };
    datei(30, true);
    datei(31, false);
    auto r_lane = regler(false, {}, {});
    for (cdj::SpurRegler& z : r_lane)
      if (z.pfad == "spur/2/fader") z.wert = -200.0f;
    auto r_bass_aus = regler(true, {}, {});
    for (cdj::SpurRegler& z : r_bass_aus)
      if (z.pfad == "spur/2/fader") z.wert = -200.0f;
    const auto ref = render(o, 30, regler(false, {2}, {}), {});          // the bass alone, not ducked
    const auto mit = render(o, 30, r_lane, {"spur/2"});                  // the lane kept
    const auto ohne = render(o, 31, r_lane, {"spur/2"});                 // the lanes stripped: the kick stays at its base value of -200 dB
    const auto rest = render(o, 30, r_bass_aus, {"spur/2"});
    PRUEF(ref.fehler.empty() && mit.fehler.empty() && ohne.fehler.empty() && rest.fehler.empty());
    std::printf("lane key: reduction with the lane %.2f dB, lanes stripped %.2f dB; residual %.1f dBFS\n", kleinste_absenkung(ref, mit, 1), kleinste_absenkung(ref, ohne, 1), peak_db(rest));
    PRUEF(kleinste_absenkung(ref, mit, 1) >= 6.0);
    PRUEF(kleinste_absenkung(ref, ohne, 1) < 1.0);   // counter-check: without the lane the key is silent and the bass plays unducked
    PRUEF(peak_db(rest) < -120.0);
  }

  // --- group key: group 2 has two members (tracks 2 and 3, track 3 sends to return 1); measured path: track 1 -> group 1 -> master
  const auto gruppe_json = [&](int nr, const std::string& gk, const std::string& pm_k) {
    const std::string pm = pm_k.empty() ? "" : ",\"pm\":{\"chain\":" + Fall::kette(pm_k) + "}";
    o.roh(nr, kopf + std::to_string(nr) + ",\"spuren\":[" + f.spur(1, f.bass, ",\"ausgang\":{\"art\":\"gruppe\",\"nr\":1}") + "," + f.spur(2, f.kick, ",\"ausgang\":{\"art\":\"gruppe\",\"nr\":2}") + "," +
                    f.spur(3, f.kick, ",\"ausgang\":{\"art\":\"gruppe\",\"nr\":2}") + "],\"gruppen\":[{\"nr\":1,\"ausgang\":{\"art\":\"master\"}" + (gk.empty() ? "" : ",\"chain\":" + Fall::kette(gk)) +
                    "},{\"nr\":2,\"ausgang\":{\"art\":\"master\"}}],\"returns\":[{\"nr\":1,\"ausgang\":{\"art\":\"master\"}}]" + pm + "}");
  };
  const std::vector<std::string> gflag = {"grp/2", "spur/2:ziel", "spur/3:ziel"};
  struct GFall {
    int nr;
    const char* name;
    std::string gk, pm_k;
  };
  const GFall gfaelle[] = {{10, "PM stage keyed by group 2 post", "", "{\"q\":\"grp\",\"nr\":2,\"punkt\":\"post\"}"},
                           {11, "group 1 stage keyed by group 2 pre", "{\"q\":\"grp\",\"nr\":2,\"punkt\":\"pre\"}", ""}};
  for (const GFall& g : gfaelle) {
    gruppe_json(g.nr, g.gk, g.pm_k);
    const auto ref = render(o, g.nr, regler(false, {2, 3}, {3}), {});               // isolation today: the members are muted, the key is silent
    const auto mit = render(o, g.nr, regler(false, {}, {3}), gflag);                 // members run unmuted, group 2 and the send are zero in the output
    const auto rest = render(o, g.nr, regler(true, {}, {3}), gflag);
    PRUEF(ref.fehler.empty() && mit.fehler.empty() && rest.fehler.empty());
    std::printf("group key (%s): bass alone %.2f dBFS; flagged %.2f dBFS, smallest reduction %.2f dB; residual %.1f dBFS\n", g.name, fenster_db(ref, 0, FRAMES), fenster_db(mit, 0, FRAMES),
                kleinste_absenkung(ref, mit, 0), peak_db(rest));
    PRUEF(kleinste_absenkung(ref, ref, 0) == 0.0 && fenster_db(ref, 0, FRAMES) > -60.0);
    PRUEF(kleinste_absenkung(ref, mit, 0) >= 6.0);   // the members reach group 2 (muted members would give no key) and the stage ducks
    PRUEF(peak_db(rest) < -120.0);                   // neither the members' sends nor group 2 leave a residual
  }
  // the members left out of the list: their target and sends play, group 2 and the return are audible
  {
    const auto offen = render(o, 10, regler(true, {}, {3}), {"grp/2"});
    std::printf("group key: members not listed, residual %.1f dBFS\n", peak_db(offen));
    PRUEF(peak_db(offen) > -30.0);   // the members' own sends / group 2 are in the output when they are not masked (the suffix is what silences them)
  }

  // --- return key: PM stage keyed by return 1 post; track 2 sits outside the path and sends to return 1; track 1 is the measured one
  {
    const std::string key_ret = "{\"q\":\"ret\",\"nr\":1,\"punkt\":\"post\"}";
    o.roh(20, kopf + "20,\"spuren\":[" + f.spur(1, f.bass, "") + "," + f.spur(2, f.kick, "") + "],\"gruppen\":[],\"returns\":[{\"nr\":1,\"ausgang\":{\"art\":\"master\"}}],\"pm\":{\"chain\":" + Fall::kette(key_ret) + "}}");
    const std::vector<std::string> rflag = {"ret/1", "spur/2:sends"};
    const auto ref = render(o, 20, regler(false, {2}, {2}), {});
    const auto mit = render(o, 20, regler(false, {}, {2}), rflag);
    const auto rest = render(o, 20, regler(true, {}, {2}), rflag);
    PRUEF(ref.fehler.empty() && mit.fehler.empty() && rest.fehler.empty());
    std::printf("return key: bass alone %.2f dBFS; flagged %.2f dBFS, smallest reduction %.2f dB; residual (dry of track 2 and return) %.1f dBFS\n", fenster_db(ref, 0, FRAMES), fenster_db(mit, 0, FRAMES),
                kleinste_absenkung(ref, mit, 1), peak_db(rest));
    PRUEF(fenster_db(ref, 0, FRAMES) > -60.0);
    PRUEF(kleinste_absenkung(ref, mit, 1) >= 6.0);   // from the second click: the return fades in over 480 samples at the start, the first click is partly inside it
    PRUEF(peak_db(rest) < -120.0);   // the dry signal of track 2 and the return output are zero
  }

  // --- T10 (AK24): --trocken-aus, the return as the mix feeds it, wet only. Every track and group writes zero to the master, the sends stay live. Track 1 (-40 dBFS sine)
  // goes to the master (files 40, 42) or into group 1 (file 41); the send goes to return 1 at -6 dB, from the track (40) or from the group (41, 42: no send at all).
  {
    const auto send = [](const char* pfad, float db) { return cdj::SpurRegler{pfad, db}; };
    const std::string rr = ",\"returns\":[{\"nr\":1,\"ausgang\":{\"art\":\"master\"}}]}";
    o.roh(40, kopf + "40,\"spuren\":[" + f.spur(1, f.bass, "") + "],\"gruppen\":[]" + rr);
    o.roh(41, kopf + "41,\"spuren\":[" + f.spur(1, f.bass, ",\"ausgang\":{\"art\":\"gruppe\",\"nr\":1}") + "],\"gruppen\":[{\"nr\":1,\"ausgang\":{\"art\":\"master\"}}]" + rr);
    auto r_send = regler(false, {2, 3}, {});
    r_send.push_back(send("spur/1/send/1", -6.0f));
    auto r_gsend = regler(false, {2, 3}, {});
    r_gsend.push_back(send("grp/1/send/1", -6.0f));
    const auto r_ohne = regler(false, {2, 3}, {});
    const auto trocken_send = render(o, 40, r_send, {}, true);
    const auto voll_send = render(o, 40, r_send, {}, false);
    const auto trocken_ohne = render(o, 40, r_ohne, {}, true);
    const auto trocken_g = render(o, 41, r_gsend, {}, true);
    const auto voll_g = render(o, 41, r_gsend, {}, false);
    const auto trocken_g_ohne = render(o, 41, r_ohne, {}, true);
    PRUEF(trocken_send.fehler.empty() && voll_send.fehler.empty() && trocken_ohne.fehler.empty() && trocken_g.fehler.empty() && voll_g.fehler.empty() && trocken_g_ohne.fehler.empty());
    std::printf("dry-out: track send %.2f dBFS (full mix %.2f), no send %.1f; group send %.2f dBFS (full mix %.2f), no send %.1f\n", peak_db(trocken_send), peak_db(voll_send), peak_db(trocken_ohne),
                peak_db(trocken_g), peak_db(voll_g), peak_db(trocken_g_ohne));
    // superposition, sample by sample: the full mix = the dry part (the render without any send) + the wet part (the dry-out render). The mix is linear at this level (-36 dBFS),
    // and the wet part is not in phase with the dry one (the return Hall), so it is the samples that add, not the peaks.
    const auto abstand = [](const cdj::RenderErgebnis& x, const cdj::RenderErgebnis& d, const cdj::RenderErgebnis& w) {
      double m = x.l.size() == d.l.size() && x.l.size() == w.l.size() ? 0.0 : 1e9;
      for (size_t i = 0; i < x.l.size() && m < 1e9; ++i) m = std::max({m, std::fabs(static_cast<double>(x.l[i]) - d.l[i] - w.l[i]), std::fabs(static_cast<double>(x.r[i]) - d.r[i] - w.r[i])});
      return m;
    };
    const auto trocken0 = render(o, 40, regler(false, {2, 3}, {}), {}, false);
    auto r_send0 = regler(false, {2, 3}, {});
    r_send0.push_back(send("spur/1/send/1", 0.0f));
    const auto trocken_send0 = render(o, 40, r_send0, {}, true);
    std::printf("dry-out: largest sample distance full - dry - wet: track %.3g, group %.3g\n", abstand(voll_send, trocken0, trocken_send), abstand(voll_g, trocken0, trocken_g));
    std::printf("dry-out: dry alone %.2f dBFS; return alone at -6 dB %.2f, at 0 dB %.2f\n", peak_db(trocken0), peak_db(trocken_send), peak_db(trocken_send0));
    PRUEF(peak_db(trocken_send) < peak_db(voll_send) - 3.0);                                       // the dry part is gone
    PRUEF(abstand(voll_send, trocken0, trocken_send) < 1e-6);
    PRUEF(std::fabs((peak_db(trocken_send0) - peak_db(trocken_send)) - 6.0) < 0.2);                // the wet part scales with the send
    PRUEF(peak_db(trocken_ohne) < -120.0);                                                         // no send: nothing is left, the dry master write is zero
    PRUEF(std::fabs(peak_db(trocken_g) - peak_db(trocken_send)) < 0.2);                            // the member keeps feeding the group, so the group's send is live (same level as the track's send)
    PRUEF(abstand(voll_g, trocken0, trocken_g) < 1e-6);
    PRUEF(peak_db(trocken_g_ohne) < -120.0);
    // the flag leaves the key mask alone: together with a bare key source it still silences it
    const auto beide = render(o, 40, r_send, {"spur/1"}, true);
    PRUEF(beide.fehler.empty() && peak_db(beide) < -120.0);   // track 1 is both a key source (bare: no sends) and dry-out: nothing left
  }

  // --- T10 fix 1: the return entry with a PM stage keyed by ANOTHER return (post). Bass (track 1) sends to return 1, kick (track 2) to return 2, the PM stage listens to return 2.
  // Entry of return 1 (--trocken-aus): the old controls mute return 2, the key is gone and the wet bass is not ducked; with return 2 running through the mask (ret/2 bare, not
  // muted) the bass wet is ducked after each click. A bare key return adds nothing: the entry holds the bass wet only.
  {
    const std::string key_ret2 = "{\"q\":\"ret\",\"nr\":2,\"punkt\":\"post\"}";
    o.roh(50, kopf + "50,\"spuren\":[" + f.spur(1, f.bass, "") + "," + f.spur(2, f.kick, "") + "],\"gruppen\":[],\"returns\":[{\"nr\":1,\"ausgang\":{\"art\":\"master\"}},{\"nr\":2,\"ausgang\":{\"art\":\"master\"}}],\"pm\":{\"chain\":" + Fall::kette(key_ret2) + "}}");
    const auto mit_ret = [&](bool ret2_stumm) {
      auto v = regler(false, {}, {});
      for (const char* k : {"fader", "pan", "mute", "solo"}) v.push_back({std::string("ret/2/") + k, std::string(k) == "mute" && ret2_stumm ? 1.0f : 0.0f});
      v.push_back({"spur/1/send/1", 0.0f});
      v.push_back({"spur/2/send/2", 0.0f});
      return v;
    };
    const auto alt = render(o, 50, mit_ret(true), {}, true);              // before the fix: return 2 muted, no key
    const auto neu = render(o, 50, mit_ret(false), {"ret/2"}, true);      // return 2 runs through the mask
    PRUEF(alt.fehler.empty() && neu.fehler.empty());
    std::printf("return entry with a return key: smallest reduction vs. the muted key return %.2f dB; entry peak %.2f dBFS (muted key %.2f)\n", kleinste_absenkung(alt, neu, 1), peak_db(neu), peak_db(alt));
    PRUEF(kleinste_absenkung(alt, neu, 1) >= 6.0);                       // the ducking is back
    PRUEF(kleinste_absenkung(alt, alt, 1) == 0.0 && fenster_db(alt, 0, FRAMES) > -80.0);   // there is a bass wet part to duck
    PRUEF(peak_db(neu) <= peak_db(alt) + 0.01);                          // and nothing was added: the key return (wet of the kick) is silent in the entry
  }

  // --- no flag: bit-equal; an id of a source that does not exist is ignored (not an error)
  {
    const auto a = render(o, 1, r_alle, {});
    const auto b = render(o, 1, r_alle, {});
    const auto c = render(o, 1, r_alle, {"spur/7", "grp/5:ziel", "ret/3:sends", "spur/99"});
    PRUEF(c.fehler.empty());
    PRUEF(gleich(a, b));
    PRUEF(gleich(a, c));   // a mask on strips that are not in the project changes nothing
    PRUEF(gleich(a, voll1));
    // a malformed id is the caller's error
    const auto d = render(o, 1, r_alle, {"spur/2:stumm"});
    PRUEF(d.fehler == "aufruf");
  }
  std::printf("pruefsumme unflagged: voll1 %016llx ref1 %016llx\n", static_cast<unsigned long long>(pruefsumme(voll1)), static_cast<unsigned long long>(pruefsumme(render(o, 10, regler(false, {2, 3}, {3}), {}))));
  PRUEF_ENDE();
}
