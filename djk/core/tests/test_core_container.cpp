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
// (Case 6, the events after /e/neustart, is test_net_container.cpp.)
// Mutations (CMakeLists.txt): CONTAINER_OHNE_BLENDE (3: hard switch), DECKLADEN_IGNORIERT_ART (10: the load closes the fader in art modul).
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

#include "arr_run.h"
#include "cypherdj/mixer.h"
#include "check.h"

bool g_waechter = false;

using k35::N;

static constexpr int LEER = 0, PLAYER = 1, MODUL = 2;
static constexpr const char* PFAD[4] = {"deck/1", "deck/2", "pad/1", "pad/2"};
static const char* const MID1 = "a2a0000000000e01";
static const char* const MID3 = "a2a0000000000e03";

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

int main() {
  k35::Arbeitsbestand ab("test_kern_container");
  k35::traeger(ab.pfad, MID1, "--ohne-klick --freq 20 --traeger 0.9");   // the deck: a 20 Hz sine on the right, silence on the left
  k35::traeger(ab.pfad, MID3, "--ohne-klick --freq 20 --traeger 0.9");
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
  PRUEF_ENDE();
}
