// Container core K8: the input selection of the four containers (A..D = deck/1, deck/2, pad/1, pad/2). Each container hears the player of its
// strip (art 1, the default), the DJ pair of the arrangement (art 2, "modul") or nothing (art 0, "leer"). A change blends linearly over
// CONTAINER_BLENDE = 480 samples from the weight reached.
// Cases (real kernel, mixer and strips):
//   1 default art player: deck 1 is audible in A
//   2 /k/container/quelle C art modul: the DJ pair 3 sounds in C, receipts 1 then 3, event [3, 2]
//   3 blend: A from player to modul while deck 1 plays: no jump (largest step below 0.01), the new source is there after exactly 480 samples,
//     the player keeps advancing; a second change inside a blend continues from the weight reached
//   4 art leer: the container input is zero and the strip sleeps after its hold time (spec R7)
//   5 four leer: all four sleep; one blend wakes its container in the very block that applies it
//   7 container 5 and art 3 (and 0, -1): receipt 6 ausserhalb_bereich
//   8 under the AI stop: quelle cypher gets 6 ki_gestoppt (before the range check), quelle andreas is accepted
//   9 deck 3 plays on pad/1 (container C) while its art is player and is silent while it is modul
//  10 a deck load closes the fader and sets the trim of the strip only while the art is player (laden_in_modul_laesst_streifen)
//  11 the loudness trim of a load is the auto gain of the PLAYER (player branch, trim_auto_db, event <strip>/trim_auto); the strip trim is the hand's part and survives container change and load
//  13 restart: the hand's strip trim comes back, auto is derived again   14 an old state file (trim_stand 0): its strip trim is discarded   15 hand 0 to +1 dB is +1 dB on top of the auto part
//  16 the incoming module or loop behind the same strip never passes the player's trim: no burst, no step; the outgoing player keeps its trim until it is silent
// (Case 6, the events after /e/neustart, is test_net_container.cpp.)
// Mutations (CMakeLists.txt): CONTAINER_OHNE_BLENDE (3: hard switch), DECKLADEN_IGNORIERT_ART (10: the load closes the fader in art modul), AUTO_TRIM_AM_STREIFEN (11, 16: the auto trim on the strip, a burst and a step behind the module).
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

#include <memory>

#include "arr_run.h"
#include "cypherdj/cypher_bk_ffi.h"
#include "cypherdj/state.h"
#include "cypherdj/mixer.h"
#include "check.h"

bool g_waechter = false;

using k35::N;

static constexpr int LEER = 0, PLAYER = 1, MODUL = 2;
static constexpr const char* PFAD[4] = {"deck/1", "deck/2", "pad/1", "pad/2"};
static const char* const MID1 = "a2a0000000000e01";
static const char* const MID3 = "a2a0000000000e03";
static const char* const MID6 = "a2a0000000000e06";   // quiet carrier (0.05) at -34.5 LUFS: +18.5 dB stays below the limiter
static const char* const MID7 = "a2a0000000000e07";   // the same loud carrier at the target loudness (-16 LUFS): no auto part
static const char* const MID5 = "a2a0000000000e05";   // quiet master (-34.5 LUFS): the load derives a trim of +18.5 dB

// the live playback with one group per DJ output of `kan` (1..4): every group plays the same constant audio
static std::string live_datei(arr35::Lauf& x, int64_t nr, const std::string& audio, int64_t frames, const std::vector<int>& kan) {
  std::string spuren, gruppen;
  for (size_t i = 0; i < kan.size(); ++i) {
    const std::string n = std::to_string(i + 1), id = "c" + n;
    spuren += std::string(i ? "," : "") + "{\"nr\":" + n + ",\"art\":\"audio\",\"ausgang\":{\"art\":\"gruppe\",\"nr\":" + n + "},\"clips\":[" + x.ordner.clip(id.c_str(), 0.0, 8.0, audio, frames) + "]}";
    gruppen += std::string(i ? "," : "") + "{\"nr\":" + n + ",\"ausgang\":{\"art\":\"dj\",\"nr\":" + std::to_string(kan[i]) + "}}";
  }
  return "{\"format\":\"cypher-arr/4\",\"nr\":" + std::to_string(nr) + ",\"spuren\":[" + spuren + "],\"live\":true,\"gruppen\":[" + gruppen + "]}";
}
static void lade_modul(arr35::Lauf& x, const std::vector<int>& kan) {   // a live playback with groups on the DJ outputs kan, started at beat 0
  const int64_t FR = 400000;
  const std::string a = x.ordner.audio('a', FR, 0.25f);
  std::string text = live_datei(x, 1, a, FR, kan);
  text.replace(text.find("cypher-arr/4"), 12, "cypherdj-arr/4");
  x.ordner.roh(1, text);
  cdj::ArrLadeErgebnis e = cdj::lade_wiedergabe(x.ordner.pfad, 1, x.cache);
  PRUEF(e.snap != nullptr);
  if (!e.snap) return;
  cdj::Befehl b = x.neu(cdj::Befehl::ARR_LADEN, "andreas");
  b.zeiger = e.snap.release();
  b.arr_nr = 1;
  x.sende(b);
  x.start(0.0, 0);
}
static int64_t quelle(arr35::Lauf& x, int container, int art, const char* von = "andreas") {
  cdj::Befehl b = x.neu(cdj::Befehl::CONTAINER_QUELLE, von);
  b.nr = container;
  b.an = art;
  return x.sende(b);
}
// one cycle (the commands that are in the ring are applied at its start)
static void ein_zyklus(arr35::Lauf& x) { x.lauf(x.kern->sample() + N); }
static void bis(arr35::Lauf& x, int64_t s) { x.lauf(s); }
// load the deck, open its strip, start it at kern beat 2 (sample 45000)
static void spiele_deck(arr35::Lauf& x, int deck, const char* mid, int container) {
  x.k35::Lauf::laden(deck, mid);
  bis(x, x.kern->sample() + 12 * N);
  x.teil((std::string(PFAD[container]) + "/fader").c_str(), 0.0f, 0.0, 0.0, "andreas");
  bis(x, x.kern->sample() + 2 * N);
  x.k35::Lauf::start(deck, 2.0);
}
static double spitze(const std::vector<float>& v, size_t von, size_t bis_) {
  double m = 0.0;
  for (size_t i = von; i < bis_ && i < v.size(); ++i) m = std::max(m, static_cast<double>(std::fabs(v[i])));
  return m;
}
static constexpr size_t vh16 = 84;
static double groesster_schritt(const std::vector<float>& v, size_t von, size_t bis_) {
  double m = 0.0;
  for (size_t i = std::max<size_t>(von, 1); i < bis_ && i < v.size(); ++i) m = std::max(m, static_cast<double>(std::fabs(v[i] - v[i - 1])));
  return m;
}
static int mixer_kanal(int c) { return cdj::Mixer::kanal_index(PFAD[c]); }
static size_t pos_q(const arr35::Lauf& x, int64_t id, int32_t st) {
  for (size_t i = 0; i < x.q.size(); ++i)
    if (x.q[i].id == id && x.q[i].status == st) return i;
  return SIZE_MAX;
}


// case 16: the transition player -> module (or loops with an fx/3 share) while the deck plays with the auto part of the load (+18.5 dB). konfig 0: the load's auto part (MID5), 1: a track at the target
// loudness, no auto part (the same transition with trim 0), 2: that track with the hand's strip trim at 18.5 dB (the same player level on the strip, for the outgoing player). The module is a constant 0.25 on both channels; the deck is a sine on the right only, so the LEFT channel is the incoming content alone.
struct Ueb {
  double schritt_l = 0.0, schritt_r = 0.0, spitze_l = 0.0;
  std::vector<float> r;
};
static const char* HALB16 =
    R"({"format":"baukasten/2","name":"halb","stimmen":1,"knoten":[{"id":"e","art":"eingang"},{"id":"a","art":"mul","b":0.5},{"id":"b","art":"mul","b":0.5},{"id":"o","art":"ausgang"}],"kanten":[{"von":"e.l","nach":"a.a"},{"von":"e.r","nach":"b.a"},{"von":"a.aus","nach":"o.l"},{"von":"b.aus","nach":"o.r"}]})";
static Ueb uebergang(const std::string& ab, const char* name, int konfig, bool modul_da, bool loops, int64_t sw) {
  arr35::Lauf x(ab, name);
  spiele_deck(x, 3, konfig == 0 ? MID5 : MID7, 2);
  if (konfig == 2) x.teil("pad/1/trim", 18.5f, 0.0, 0.0, "andreas");
  if (modul_da) lade_modul(x, {3});
  if (modul_da && loops) {
    char f[256] = {};
    CypherBk* g = cypher_bk_neu(HALB16, 48000.0, f, sizeof f);
    PRUEF(g != nullptr);
    cdj::Befehl b = x.neu(cdj::Befehl::KANAL_GRAPH, "andreas");
    std::snprintf(b.pfad, sizeof b.pfad, "%s", "fx/3");
    b.zeiger = g;
    x.sende(b);
    x.teil("spur/1/fx/3", 1.0f, 0.0, 0.0, "andreas");
  }
  bis(x, sw);
  quelle(x, 3, MODUL);
  bis(x, sw + 12 * N);
  Ueb u;
  const size_t von = static_cast<size_t>(sw) + vh16 - 8, bis_ = static_cast<size_t>(sw) + 12 * N;
  u.schritt_l = groesster_schritt(x.l, von, bis_);
  u.schritt_r = groesster_schritt(x.r, von, bis_);
  u.spitze_l = spitze(x.l, von, bis_);
  u.r.assign(x.r.begin() + static_cast<std::ptrdiff_t>(von), x.r.begin() + static_cast<std::ptrdiff_t>(bis_));
  return u;
}

int main() {
  k35::Arbeitsbestand ab("test_kern_container");
  k35::traeger(ab.pfad, MID1, "--ohne-klick --freq 20 --traeger 0.9");   // the deck: a 20 Hz sine on the right, silence on the left
  k35::traeger(ab.pfad, MID3, "--ohne-klick --freq 20 --traeger 0.9");
  k35::traeger(ab.pfad, MID5, "--ohne-klick --freq 20 --traeger 0.9 --lufs -34.5");
  k35::traeger(ab.pfad, MID7, "--ohne-klick --freq 20 --traeger 0.9 --lufs -16");
  k35::traeger(ab.pfad, MID6, "--ohne-klick --freq 20 --traeger 0.05 --lufs -34.5");
  const size_t vh = 84;

  {  // 1 default art player: deck 1 is audible in A
    arr35::Lauf x(ab.pfad, "test_kern_container_1");
    for (int c = 0; c < 4; ++c) PRUEF(x.kern->container_art(c) == PLAYER);
    spiele_deck(x, 1, MID1, 0);
    bis(x, 90000);
    const double p = spitze(x.r, 60000, 90000);
    std::printf("1: deck 1 in A: peak %.4f\n", p);
    PRUEF(p > 0.05);
  }
  {  // 2 C takes a module: the DJ pair 3 sounds in C; receipts 1 then 3, event [3, 2]
    arr35::Lauf x(ab.pfad, "test_kern_container_2");
    x.teil("pad/1/fader", 0.0f, 0.0, 0.0, "andreas");
    lade_modul(x, {3});
    bis(x, 40000);
    const double vorher = spitze(x.l, 20000, 40000);   // art player: the module of C is not heard (the player 3 is empty)
    const int64_t id = quelle(x, 3, MODUL);
    bis(x, 80000);
    const double nachher = spitze(x.l, 60000, 80000);
    std::printf("2: C before %.5f, after %.5f\n", vorher, nachher);
    PRUEF(vorher < 1e-6);
    PRUEF(nachher > 0.01);
    PRUEF(x.kern->container_art(2) == MODUL);
    const size_t a = pos_q(x, id, 1), b = pos_q(x, id, 3);
    PRUEF(a != SIZE_MAX && b != SIZE_MAX && a < b);
    PRUEF(pos_q(x, id, 6) == SIZE_MAX);
    const auto ev = x.alle(cdj::Ereignis::CONTAINER_QUELLE);
    PRUEF(ev.size() == 1);
    if (!ev.empty()) PRUEF(ev[0].deck == 3 && ev[0].status == 2);
  }
  {  // 3 the blend: A from player to modul while deck 1 plays
    // reference: the module alone in A (left channel level in the settled state)
    double modul_links = 0.0;
    {
      arr35::Lauf x(ab.pfad, "test_kern_container_3r");
      x.teil("deck/1/fader", 0.0f, 0.0, 0.0, "andreas");
      lade_modul(x, {1});
      quelle(x, 1, MODUL);
      bis(x, 60000);
      modul_links = spitze(x.l, 40000, 60000);
    }
    PRUEF(modul_links > 0.01);
    // pass 1 without a switch: find a block start where the sine on the right is near its peak
    int64_t sw = -1;
    std::vector<float> ref_r;
    {
      arr35::Lauf x(ab.pfad, "test_kern_container_3a");
      spiele_deck(x, 1, MID1, 0);
      lade_modul(x, {1});
      bis(x, 90000);
      const double p = spitze(x.r, 60000, 90000);
      for (int64_t n = 60000 / N * N; n < 90000 - N && sw < 0; n += N)
        if (std::fabs(x.r[n + vh]) > 0.95 * p) sw = n;
      bis(x, 90000 + 100 * N);
      ref_r = x.r;
    }
    PRUEF(sw > 0);
    arr35::Lauf x(ab.pfad, "test_kern_container_3");
    spiele_deck(x, 1, MID1, 0);
    lade_modul(x, {1});
    bis(x, sw);
    PRUEF(x.kern->container_gewicht_player(0) == cdj::CONTAINER_BLENDE && x.kern->container_gewicht_modul(0) == 0);
    quelle(x, 1, MODUL);
    ein_zyklus(x);   // the block that applies the change: 256 samples of the blend
    PRUEF(x.kern->container_gewicht_modul(0) == N);
    PRUEF(x.kern->container_gewicht_player(0) == cdj::CONTAINER_BLENDE - N);
    ein_zyklus(x);   // 512 samples in: the blend (480) is over
    PRUEF(x.kern->container_gewicht_modul(0) == cdj::CONTAINER_BLENDE && x.kern->container_gewicht_player(0) == 0);
    bis(x, sw + 6 * N);
    const double schritt = groesster_schritt(x.r, sw + vh - 8, sw + vh + 3 * N);
    std::printf("3: switch at %lld, largest step on the right %.5f, module level %.5f\n", static_cast<long long>(sw), schritt, modul_links);
    PRUEF(schritt < 0.01);
    PRUEF(x.kern->deck(1).laeuft());
    // the player keeps advancing while nobody hears it: back to player, the sine is the one of the run without a switch (same phase)
    quelle(x, 1, PLAYER);
    bis(x, sw + 72 * N);
    double abw = 0.0;
    for (int64_t n = sw + 60 * N; n < sw + 70 * N; ++n) abw = std::max(abw, static_cast<double>(std::fabs(x.r[n] - ref_r[n])));
    std::printf("3: after the way back the right channel differs from the run without a switch by %.6f\n", abw);
    PRUEF(abw < 0.005);
    // settled: the right channel carries the module only (the sine of the player is gone), the left is the module level
    PRUEF(spitze(x.l, sw + vh + 2 * N, sw + vh + 6 * N) > 0.9 * modul_links);
    // a change inside a blend continues from the weight reached: modul, 100 samples later back to player
    arr35::Lauf y(ab.pfad, "test_kern_container_3b");
    spiele_deck(y, 1, MID1, 0);
    lade_modul(y, {1});
    bis(y, sw);
    quelle(y, 1, MODUL);
    y.lauf(y.kern->sample() + 1);   // one cycle is the finest step: 256 samples
    const int gm = y.kern->container_gewicht_modul(0);
    PRUEF(gm == N);
    quelle(y, 1, PLAYER);
    ein_zyklus(y);   // the second block starts from 256 and walks back
    PRUEF(y.kern->container_gewicht_modul(0) == 0);
    PRUEF(y.kern->container_gewicht_player(0) == cdj::CONTAINER_BLENDE);
  }
  {  // 4 art leer: the container input is zero and the strip sleeps after its hold time
    arr35::Lauf x(ab.pfad, "test_kern_container_4");
    spiele_deck(x, 1, MID1, 0);
    bis(x, 60000);
    PRUEF(!x.kern->mixer().schlaeft(mixer_kanal(0)));
    quelle(x, 1, LEER);
    bis(x, 60000 + 10 * 48000);   // the hold time: the filter states of the strip run out to exact zeros (about 8 s after a 20 Hz sine)
    PRUEF(x.kern->container_art(0) == LEER);
    PRUEF(x.kern->mixer().schlaeft(mixer_kanal(0)));
    PRUEF(spitze(x.r, 60000 + 48000, 60000 + 10 * 48000) < 1e-6);
    PRUEF(x.kern->deck(1).laeuft());   // the player keeps playing into its buffer, nobody hears it
  }
  {  // 5 four leer: all four sleep; one blend wakes its container in the same block
    arr35::Lauf x(ab.pfad, "test_kern_container_5");
    spiele_deck(x, 1, MID1, 0);
    bis(x, 60000);
    for (int c = 0; c < 4; ++c) quelle(x, c + 1, LEER);
    bis(x, 60000 + 10 * 48000);
    for (int c = 0; c < 4; ++c) PRUEF(x.kern->mixer().schlaeft(mixer_kanal(c)));
    quelle(x, 1, PLAYER);
    ein_zyklus(x);
    PRUEF(!x.kern->mixer().schlaeft(mixer_kanal(0)));
    for (int c = 1; c < 4; ++c) PRUEF(x.kern->mixer().schlaeft(mixer_kanal(c)));
  }
  {  // 7 out of range: receipt 6 ausserhalb_bereich
    arr35::Lauf x(ab.pfad, "test_kern_container_7");
    const int werte[4][2] = {{5, 1}, {1, 3}, {0, 1}, {1, -1}};
    int64_t id[4];
    for (int i = 0; i < 4; ++i) id[i] = quelle(x, werte[i][0], werte[i][1]);
    bis(x, 4 * N);
    for (int i = 0; i < 4; ++i) {
      const k35::Q* q = x.quittung(id[i], 6);
      PRUEF(q != nullptr);
      if (q) PRUEF(q->grund == "ausserhalb_bereich");
      PRUEF(x.quittung(id[i], 1) == nullptr);
    }
    for (int c = 0; c < 4; ++c) PRUEF(x.kern->container_art(c) == PLAYER);
    PRUEF(x.alle(cdj::Ereignis::CONTAINER_QUELLE).empty());
  }
  {  // 8 under the AI stop: cypher is refused (before the range check), andreas is accepted
    arr35::Lauf x(ab.pfad, "test_kern_container_8");
    cdj::Befehl s = x.neu(cdj::Befehl::KI_STOPP, "andreas");
    x.sende(s);
    bis(x, 2 * N);
    PRUEF(x.kern->ki_gestoppt());
    const int64_t a = quelle(x, 2, LEER, "cypher");
    const int64_t b = quelle(x, 9, 7, "cypher");   // out of range too: the stop is named first
    const int64_t c = quelle(x, 2, LEER, "andreas");
    bis(x, 6 * N);
    const k35::Q* qa = x.quittung(a, 6);
    const k35::Q* qb = x.quittung(b, 6);
    PRUEF(qa && qa->grund == "ki_gestoppt");
    PRUEF(qb && qb->grund == "ki_gestoppt");
    PRUEF(x.quittung(c, 1) != nullptr && x.quittung(c, 3) != nullptr);
    PRUEF(x.kern->container_art(1) == LEER);
  }
  {  // 9 deck 3 plays on pad/1 while C is player, silent while C is modul
    arr35::Lauf x(ab.pfad, "test_kern_container_9");
    spiele_deck(x, 3, MID3, 2);
    bis(x, 90000);
    const double laut = spitze(x.r, 60000, 90000);
    quelle(x, 3, MODUL);
    bis(x, 90000 + 8 * 48000 / 8);
    const double still = spitze(x.r, 90000 + 4000, 90000 + 48000);
    std::printf("9: deck 3 on pad/1 %.4f, in art modul %.6f\n", laut, still);
    PRUEF(laut > 0.05);
    PRUEF(still < 1e-6);
    PRUEF(!x.kern->deck_hoerbar(3));
    PRUEF(!x.kern->deck_offen(3));
  }
  {  // 10 a deck load leaves the strip alone while the art is modul (laden_in_modul_laesst_streifen), closes it while the art is player
    arr35::Lauf x(ab.pfad, "test_kern_container_10");
    x.teil("pad/1/fader", -6.0f, 0.0, 0.0, "andreas");
    x.teil("pad/1/trim", 3.0f, 0.0, 0.0, "andreas");
    quelle(x, 3, MODUL);
    bis(x, 4 * N);
    x.k35::Lauf::laden(3, MID3);
    bis(x, x.kern->sample() + 12 * N);
    std::printf("10: art modul after the load: fader %.2f trim %.2f\n", x.wert("pad/1/fader"), x.wert("pad/1/trim"));
    PRUEF_NAH(x.wert("pad/1/fader"), -6.0, 1e-4);
    PRUEF_NAH(x.wert("pad/1/trim"), 3.0, 1e-4);
    quelle(x, 3, PLAYER);
    bis(x, x.kern->sample() + 2 * N);
    x.k35::Lauf::laden(3, MID3);
    bis(x, x.kern->sample() + 12 * N);
    std::printf("10: art player after the load: fader %.2f trim %.2f\n", x.wert("pad/1/fader"), x.wert("pad/1/trim"));
    PRUEF(x.wert("pad/1/fader") < -100.0);
  }
  {  // 11 the loudness trim of a load is the auto gain of the PLAYER (player branch); the strip trim is the hand's part and ADDS to it; neither is taken away by a container change or a load
    arr35::Lauf x(ab.pfad, "test_kern_container_11");
    x.k35::Lauf::laden(3, MID5);
    bis(x, x.kern->sample() + 12 * N);
    auto auto_ereignis = [&]() {   // the last /e/regler pad/1/trim_auto: what the container hears
      const auto ev = x.alle(cdj::Ereignis::REGLER, "pad/1/trim_auto");
      return ev.empty() ? -999.0 : static_cast<double>(ev.back().wert);
    };
    std::printf("11: loaded under art player: strip trim %.2f, auto part %.2f, event %.2f\n", x.wert("pad/1/trim"), x.kern->trim_auto_db(2), auto_ereignis());
    PRUEF_NAH(x.wert("pad/1/trim"), 0.0, 1e-4);        // the strip trim is the hand's part
    PRUEF_NAH(x.kern->trim_auto_db(2), 18.5, 1e-3);    // the calibration is on the player branch
    PRUEF_NAH(auto_ereignis(), 18.5, 1e-3);            // and reported (/lage, the page label)
    quelle(x, 3, MODUL);
    bis(x, x.kern->sample() + 4 * N);
    PRUEF_NAH(x.wert("pad/1/trim"), 0.0, 1e-4);        // a module in this place meets a strip trim of 0 dB
    PRUEF_NAH(x.kern->trim_auto_db(2), 18.5, 1e-3);    // the player keeps its calibration for the way back
    PRUEF_NAH(auto_ereignis(), 0.0, 1e-4);             // the container hears no player now
    quelle(x, 3, PLAYER);
    bis(x, x.kern->sample() + 4 * N);
    PRUEF_NAH(auto_ereignis(), 18.5, 1e-3);
    x.teil("pad/1/trim", 3.0f, 0.0, 0.0, "andreas");   // the hand: ADDS to the auto part, replaces nothing
    bis(x, x.kern->sample() + 4 * N);
    PRUEF_NAH(x.kern->trim_auto_db(2), 18.5, 1e-3);
    quelle(x, 3, MODUL);
    bis(x, x.kern->sample() + 4 * N);
    quelle(x, 3, PLAYER);
    bis(x, x.kern->sample() + 4 * N);
    x.k35::Lauf::laden(3, MID5);                       // a new load derives the auto part again and leaves the hand's trim alone
    bis(x, x.kern->sample() + 12 * N);
    std::printf("11: hand trim 3.0 after modul, back and a new load: strip %.2f, auto part %.2f\n", x.wert("pad/1/trim"), x.kern->trim_auto_db(2));
    PRUEF_NAH(x.wert("pad/1/trim"), 3.0, 1e-4);
    PRUEF_NAH(x.kern->trim_auto_db(2), 18.5, 1e-3);
  }
  {  // 11b unload: no material, no auto gain (deck reads 0, the event hides the label, the channel does not count it as open); a quiet-calibrated track loads with no auto part
    arr35::Lauf x(ab.pfad, "test_kern_container_11b");
    x.k35::Lauf::laden(3, MID5);
    bis(x, x.kern->sample() + 12 * N);
    PRUEF_NAH(x.kern->trim_auto_db(2), 18.5, 1e-3);
    cdj::Befehl en = x.neu(cdj::Befehl::DECK_ENTLADEN);
    en.deck = 3;
    x.sende(en);
    bis(x, x.kern->sample() + 12 * N);
    const auto ev = x.alle(cdj::Ereignis::REGLER, "pad/1/trim_auto");
    std::printf("11b: after unload: auto part %.2f, last event %.2f, loaded %d\n", x.kern->trim_auto_db(2), ev.empty() ? -999.0 : static_cast<double>(ev.back().wert), x.kern->deck(3).geladen() ? 1 : 0);
    PRUEF(!x.kern->deck(3).geladen());
    PRUEF_NAH(x.kern->trim_auto_db(2), 0.0, 1e-6);
    PRUEF(!ev.empty());
    PRUEF_NAH(ev.back().wert, 0.0, 1e-6);
    x.k35::Lauf::laden(3, MID7);
    bis(x, x.kern->sample() + 12 * N);
    PRUEF_NAH(x.kern->trim_auto_db(2), 0.0, 1e-3);     // -16 LUFS is the target: no auto part
    x.k35::Lauf::laden(3, MID5);
    bis(x, x.kern->sample() + 12 * N);
    PRUEF_NAH(x.kern->trim_auto_db(2), 18.5, 1e-3);
  }
  {  // 13 restart: the strip trim of the file is the hand's part and comes back as it was; the auto part is derived from the loaded material again
    arr35::Lauf x(ab.pfad, "test_kern_container_13a");
    x.k35::Lauf::laden(3, MID5);
    bis(x, x.kern->sample() + 12 * N);
    x.teil("pad/1/trim", 3.0f, 0.0, 0.0, "andreas");
    bis(x, x.kern->sample() + 2 * N);
    auto f = std::make_unique<cdj_z_echtzeit>();
    std::memset(f.get(), 0, sizeof *f);
    x.kern->abbild(*f);
    f->anker_sample = x.kern->sample() - 256;
    f->quantum = 256;
    const int64_t weiter = x.kern->sample() + 4096;
    arr35::Lauf y(ab.pfad, "test_kern_container_13b");
    PRUEF(y.kern->wiederherstellen(*f));
    PRUEF(y.kern->decks_nachladen(y.lader) >= 1);
    y.kern->fortsetzen(weiter);
    bis(y, weiter + 8 * N);
    std::printf("13: after the restart: strip trim %.2f, auto part %.2f\n", y.wert("pad/1/trim"), y.kern->trim_auto_db(2));
    PRUEF_NAH(y.wert("pad/1/trim"), 3.0, 1e-3);
    PRUEF_NAH(y.kern->trim_auto_db(2), 18.5, 1e-3);
  }
  {  // 14 an OLD state file (written before the auto part moved to the player branch: trim_stand 0, the strip trim was the load's +18.5): the restore discards it, the total is 18.5, never 18.5 + 18.5
    arr35::Lauf x(ab.pfad, "test_kern_container_14a");
    x.k35::Lauf::laden(3, MID5);
    bis(x, x.kern->sample() + 12 * N);
    x.teil("pad/1/trim", 18.5f, 0.0, 0.0, "andreas");   // what the old kernel had on the strip after the same load
    bis(x, x.kern->sample() + 2 * N);
    auto f = std::make_unique<cdj_z_echtzeit>();
    std::memset(f.get(), 0, sizeof *f);
    x.kern->abbild(*f);
    f->trim_stand = 0;   // the old way
    f->anker_sample = x.kern->sample() - 256;
    f->quantum = 256;
    const int64_t weiter = x.kern->sample() + 4096;
    arr35::Lauf y(ab.pfad, "test_kern_container_14b");
    PRUEF(y.kern->wiederherstellen(*f));
    PRUEF(y.kern->decks_nachladen(y.lader) >= 1);
    y.kern->fortsetzen(weiter);
    bis(y, weiter + 8 * N);
    std::printf("14: old file after the restart: strip trim %.2f, auto part %.2f\n", y.wert("pad/1/trim"), y.kern->trim_auto_db(2));
    PRUEF_NAH(y.wert("pad/1/trim"), 0.0, 1e-4);
    PRUEF_NAH(y.kern->trim_auto_db(2), 18.5, 1e-3);
  }
  {  // 15 the hand trim adds: turning it from 0 to +1 dB changes the deck by +1 dB (not by -17.5 dB); a hand 0 is simply 0 on top of the auto part
    double pegel[2] = {0.0, 0.0};
    for (int hand = 0; hand < 2; ++hand) {
      arr35::Lauf x(ab.pfad, hand ? "test_kern_container_15b" : "test_kern_container_15a");
      spiele_deck(x, 3, MID6, 2);
      if (hand) x.teil("pad/1/trim", 1.0f, 0.0, 0.0, "andreas");
      bis(x, 100000);
      pegel[hand] = spitze(x.r, 70000, 100000);
    }
    const double db = 20.0 * std::log10(pegel[1] / pegel[0]);
    std::printf("15: peak at hand 0 %.5f, at hand +1 %.5f: %.3f dB\n", pegel[0], pegel[1], db);
    PRUEF(pegel[0] > 0.2);   // +18.5 dB on a quiet carrier: audible, below the limiter
    PRUEF_NAH(db, 1.0, 0.05);
  }
  {  // 16 the incoming content passes the strip with the trim of the load during the blend (module and loops): no burst, no step, the outgoing player keeps its trim
    int64_t sw = -1;
    {
      arr35::Lauf x(ab.pfad, "test_kern_container_16s");
      spiele_deck(x, 3, MID5, 2);
      bis(x, 90000);
      const double p = spitze(x.r, 60000, 90000);
      for (int64_t n = 60000 / N * N; n < 90000 - N && sw < 0; n += N)
        if (std::fabs(x.r[n + vh]) > 0.95 * p) sw = n;
    }
    PRUEF(sw > 0);
    const double toleranz = std::pow(10.0, 0.5 / 20.0);
    const Ueb a0 = uebergang(ab.pfad, "test_kern_container_16c", 0, false, false, sw);   // the same transition without an incoming module: the outgoing player alone
    for (int loops = 0; loops < 2; ++loops) {
      const char* was = loops ? "loops" : "module";
      const Ueb a = uebergang(ab.pfad, "test_kern_container_16a", 0, true, loops != 0, sw);
      const Ueb n = uebergang(ab.pfad, "test_kern_container_16n", 1, true, loops != 0, sw);
      const Ueb h = uebergang(ab.pfad, "test_kern_container_16h", 2, true, loops != 0, sw);
      std::printf("16 %s: auto +18.5: step L %.5f R %.5f, incoming peak L %.5f | trim 0: step L %.5f R %.5f, peak L %.5f | hand 18.5: step R %.5f\n", was, a.schritt_l, a.schritt_r, a.spitze_l, n.schritt_l,
                  n.schritt_r, n.spitze_l, h.schritt_r);
      PRUEF(a.schritt_l <= n.schritt_l * 1.001 + 1e-6);   // (1) the incoming content steps no more than with trim 0
      PRUEF(a.schritt_r <= a0.schritt_r + 0.0006);   // the right channel: the fade of the player (a +18.5 dB sine into the limiter) plus the ramp of the module itself (0.25 / 480 = 0.00052) and nothing else
      PRUEF(a.spitze_l <= n.spitze_l * toleranz + 1e-6);   // (2) never above its own 0 dB level by more than 0.5 dB
    }
    // (3) the outgoing player keeps its trim until it is silent: without a module the right channel of the auto run is the one of the run whose trim the hand wrote
    const Ueb& a = a0;
    const Ueb h = uebergang(ab.pfad, "test_kern_container_16d", 2, false, false, sw);
    double d = 0.0, p = 0.0;
    for (size_t i = 0; i < a.r.size() && i < h.r.size(); ++i) {
      d = std::max(d, static_cast<double>(std::fabs(a.r[i] - h.r[i])));
      p = std::max(p, static_cast<double>(std::fabs(h.r[i])));
    }
    std::printf("16 outgoing player: auto against hand 18.5, largest difference %.6f (peak %.4f)\n", d, p);
    PRUEF(p > 0.05);
    PRUEF(d < 1e-4);
  }
  PRUEF_ENDE();
}
