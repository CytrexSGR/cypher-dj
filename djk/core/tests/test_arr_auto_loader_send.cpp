// Send automation, task 1: the loader reads the lane targets `send.1` .. `send.8` of a track (ARR_AUTO_SEND, param = return number - 1).
//   - the eight names load, ziel and param come from the one table; the older targets keep their ids (fader 0, pan 1, mute 2, solo 3, geraet 4; the geraet.* params in test_arr_auto_lader)
//   - refused with a reason (positive control for each): `send.0` and `send.9` (unknown), a send lane on a return, a relative send lane, a send lane into a return the
//     playback lacks, two lanes on one send, a send lane on a group
//   - a track may carry all eight send lanes next to a fader lane (the lane table has room for 2 x 80)
#include <cstdint>
#include <cstdio>
#include <fstream>
#include <string>

#include "arr_file.h"
#include "cypherdj/arr_playback.h"
#include "check.h"

int main() {
  arrdatei::Ordner o("test_arr_auto_lader_send");
  const std::string a = o.audio('a', 48000);
  cdj::SpeicherKonto konto(100LL << 20);
  cdj::ArrAudioCache cache(&konto, 50LL << 20, false);
  const auto lane = [](const std::string& ziel, const char* punkte = "[[0,-60,0],[16,0,0]]", const char* extra = "") {
    return "{\"ziel\":\"" + ziel + "\",\"punkte\":" + punkte + extra + "}";
  };
  const auto spur = [&](const std::string& lanes) {
    return "{\"nr\":1,\"art\":\"audio\",\"clips\":[" + o.clip("c1", 0.0, 4.0, a, 48000) + "]" + (lanes.empty() ? "" : ",\"auto\":[" + lanes + "]") + "}";
  };
  const auto ret = [](int nr, const std::string& auto_liste = "") {
    return "{\"nr\":" + std::to_string(nr) + ",\"ausgang\":{\"art\":\"master\"}" + (auto_liste.empty() ? "" : ",\"auto\":[" + auto_liste + "]") + "}";
  };
  int64_t nr = 500;
  // the reason, "+snap" when a snapshot came back (kept in `behalten` for the caller to look at, else given back)
  cdj::ArrLadeErgebnis last;
  const auto lade = [&](const std::string& lanes, const std::string& returns, const char* format = "cypherdj-arr/2", const std::string& gruppen = "") {
    ++nr;
    std::ofstream(o.pfad + "/wiedergabe-" + std::to_string(nr) + ".json") << "{\"format\":\"" << format << "\",\"nr\":" << nr << ",\"spuren\":[" << spur(lanes) << "],\"gruppen\":["
                                                                           << gruppen << "],\"returns\":[" << returns << "]}";
    cdj::gib_wiedergabe(last.snap.release(), cache);
    last = cdj::lade_wiedergabe(o.pfad, nr, cache);
    return last.grund + (last.snap ? "+snap" : "");
  };
  std::string alle;   // returns 1..8
  for (int r = 1; r <= 8; ++r) alle += (r > 1 ? "," : "") + ret(r);

  {  // the eight targets load, one by one, each into its own return number
    for (int r = 1; r <= 8; ++r) {
      PRUEF(lade(lane("send.1"), ret(1)) == "+snap");   // positive control of the next line
      const std::string name = "send." + std::to_string(r);
      PRUEF(lade(lane(name), alle) == "+snap");
      if (last.snap && last.snap->spur[0].n_auto == 1) {
        const cdj::ArrAutoLane& l = last.snap->spur[0].auto_lanes[0];
        PRUEF(l.ziel == cdj::ARR_AUTO_SEND && l.param == r - 1 && !l.relativ && l.n == 2);
        PRUEF(l.p[0].wert == -60.0f && l.p[1].wert == 0.0f);
      } else {
        PRUEF(false);
      }
      PRUEF(last.snap && last.snap->n_auto_lanes == 1);
    }
  }
  {  // the ids of the older targets do not move
    struct E { const char* name; uint8_t ziel, param; };
    const E alt[] = {{"fader", cdj::ARR_AUTO_FADER, 0}, {"pan", cdj::ARR_AUTO_PAN, 0}, {"mute", cdj::ARR_AUTO_MUTE, 0}, {"solo", cdj::ARR_AUTO_SOLO, 0}};
    PRUEF(cdj::ARR_AUTO_FADER == 0 && cdj::ARR_AUTO_PAN == 1 && cdj::ARR_AUTO_MUTE == 2 && cdj::ARR_AUTO_SOLO == 3 && cdj::ARR_AUTO_GERAET == 4);
    for (const E& e : alt) {
      const bool sprung = std::string(e.name) == "mute" || std::string(e.name) == "solo";
      PRUEF(lade(lane(e.name, sprung ? "[[0,0,2]]" : "[[0,0,0]]"), alle) == "+snap");
      PRUEF(last.snap && last.snap->spur[0].n_auto == 1 && last.snap->spur[0].auto_lanes[0].ziel == e.ziel && last.snap->spur[0].auto_lanes[0].param == e.param);
    }
    // the ids of geraet.* (RB-338 param 0..3, bk k1..k64 = param 0..63) are pinned by test_arr_auto_lader (c) and (c2); ARR_AUTO_GERAET stays 4, the send target is the new 5
    PRUEF(cdj::ARR_AUTO_SEND == 5);
  }
  {  // refused, each with its positive control
    PRUEF(lade(lane("send.9"), alle) == "format");
    PRUEF(lade(lane("send.8"), alle) == "+snap");
    PRUEF(lade(lane("send.0"), alle) == "format");
    PRUEF(lade(lane("send"), alle) == "format");
    PRUEF(lade(lane("send.01"), alle) == "format");
    // a send lane into a return the playback does not have
    PRUEF(lade(lane("send.3"), ret(1) + "," + ret(2)) == "format");
    PRUEF(lade(lane("send.2"), ret(1) + "," + ret(2)) == "+snap");
    PRUEF(lade(lane("send.1"), "") == "format");   // no returns at all
    // relative
    PRUEF(lade(lane("send.1", "[[0,-6,0]]", ",\"relativ\":true"), alle) == "format");
    PRUEF(lade(lane("send.1", "[[0,-6,0]]", ",\"relativ\":false"), alle) == "+snap");
    // two lanes on one send, two on different sends
    PRUEF(lade(lane("send.2") + "," + lane("send.2"), alle) == "format");
    PRUEF(lade(lane("send.2") + "," + lane("send.3"), alle) == "+snap");
    // range of send_setzen: -200 .. +6 dB
    PRUEF(lade(lane("send.1", "[[0,-200,0],[4,6,0]]"), alle) == "+snap");
    PRUEF(lade(lane("send.1", "[[0,-201,0]]"), alle) == "format");
    PRUEF(lade(lane("send.1", "[[0,6.5,0]]"), alle) == "format");
    // a send lane on a return (a return takes the fader lane only) and on a group
    PRUEF(lade("", ret(1, lane("send.1")) + "," + ret(2), "cypherdj-arr/3") == "format");
    PRUEF(lade("", ret(1, lane("fader")) + "," + ret(2), "cypherdj-arr/3") == "+snap");
    PRUEF(lade("", ret(1) + ",", "cypherdj-arr/3") == "format");   // control for the JSON helper: a trailing comma is not a playback
    PRUEF(lade("", ret(1), "cypherdj-arr/2", "{\"nr\":1,\"ausgang\":{\"art\":\"master\"},\"auto\":[" + lane("send.1") + "]}") == "format");
    PRUEF(lade("", ret(1), "cypherdj-arr/2", "{\"nr\":1,\"ausgang\":{\"art\":\"master\"}}") == "+snap");
    // /1 knows no `auto` at all
    PRUEF(lade(lane("send.1"), ret(1), "cypherdj-arr/1") == "format");
  }
  {  // eight send lanes and a fader lane on one track: all load, the lane table order is the file order
    std::string l = lane("fader");
    for (int r = 1; r <= 8; ++r) l += "," + lane("send." + std::to_string(r));
    PRUEF(lade(l, alle) == "+snap");
    PRUEF(last.snap && last.snap->spur[0].n_auto == 9 && last.snap->n_auto_lanes == 9);
    if (last.snap && last.snap->spur[0].n_auto == 9) {
      PRUEF(last.snap->spur[0].auto_lanes[0].ziel == cdj::ARR_AUTO_FADER);
      for (int r = 1; r <= 8; ++r) PRUEF(last.snap->spur[0].auto_lanes[r].ziel == cdj::ARR_AUTO_SEND && last.snap->spur[0].auto_lanes[r].param == r - 1);
    }
  }
  cdj::gib_wiedergabe(last.snap.release(), cache);
  PRUEF(cache.eintraege() == 0 && konto.gesperrt() == 0);
  PRUEF_ENDE();
}
