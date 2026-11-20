// Loop deck K1: the loader reads the track id and the cells of an audio track (playback /2 and up).
// Every refusal has a positive control (the same track with valid values loads). Nothing stays locked or booked after a refusal.
#include <cstdint>
#include <cstdio>
#include <string>

#include "arr_file.h"
#include "cypherdj/arr_playback.h"
#include "check.h"

static const int64_t F = 48000;

int main() {
  arrdatei::Ordner o("test_arr_zellen_lader");
  const std::string a = o.audio('a', F);
  const std::string b = o.audio('b', F / 2);
  cdj::SpeicherKonto konto(200LL << 20);
  cdj::ArrAudioCache cache(&konto, 100LL << 20, false);
  int64_t nr = 100;

  const auto zelle = [&](int index, const std::string& sha, int64_t frames, const char* art, double beats, double gain_db, int modus) {
    char z[640];
    std::snprintf(z, sizeof z,
                  "{\"index\":%d,\"sha256\":\"%s\",\"datei\":\"%s/audio/%s.f32\",\"frames\":%lld,\"beats\":%.17g,\"art\":\"%s\","
                  "\"gain_db\":%.17g,\"modus\":%d}",
                  index, sha.c_str(), o.pfad.c_str(), sha.c_str(), static_cast<long long>(frames), beats, art, gain_db, modus);
    return std::string(z);
  };
  const auto loop = [&](int index) { return zelle(index, a, F, "loop", 2.0, 0.0, 2); };
  const std::string clip = o.clip("c1", 0.0, 1.0, a, F);
  // a track text: id (empty: none), cells (empty: none), art
  const auto spur = [&](int n, const std::string& id, const std::string& zellen, const char* art = "audio") {
    std::string s = "{\"nr\":" + std::to_string(n) + ",\"art\":\"" + art + "\"";
    if (!id.empty()) s += ",\"id\":\"" + id + "\"";
    if (!zellen.empty()) s += ",\"zellen\":[" + zellen + "]";
    if (std::string(art) == "audio") s += ",\"clips\":[" + clip + "]";
    return s + "}";
  };
  // "" = loaded (and released at once), otherwise the refusal reason
  const auto grund = [&](bool v2, const std::string& spuren) {
    ++nr;
    if (v2) o.wiedergabe2_warp(nr, spuren); else o.wiedergabe(nr, spuren);
    cdj::ArrLadeErgebnis e = cdj::lade_wiedergabe(o.pfad, nr, cache);
    const std::string g = e.snap ? "" : e.grund;
    if (e.snap) cdj::gib_wiedergabe(e.snap.release(), cache);
    PRUEF(cache.eintraege() == 0 && konto.gesperrt() == 0);
    return g;
  };

  {  // 1: a track with an id and two cells
    ++nr;
    o.wiedergabe2_warp(nr, spur(1, "s12", loop(1) + "," + zelle(3, b, F / 2, "einmal", 0.0, -6.0, 0)));
    cdj::ArrLadeErgebnis e = cdj::lade_wiedergabe(o.pfad, nr, cache);
    PRUEF(e.snap && e.grund.empty());
    if (e.snap) {
      const cdj::ArrSpur& s = e.snap->spur[0];
      PRUEF(s.kennung == cdj::arr_id("s12") && std::string(s.kennung_text) == "s12");
      PRUEF(s.n_zellen == 2);
      const cdj::ArrZelle& z0 = s.zellen[0];
      PRUEF(z0.art == cdj::ArrZellArt::loop && z0.frames == F && z0.beats == 2.0 && z0.gain == 1.0f && z0.modus == 2 && z0.audio != nullptr);
      const cdj::ArrZelle& z2 = s.zellen[2];   // index 3 sits at slot 2
      PRUEF(z2.art == cdj::ArrZellArt::einmal && z2.frames == F / 2 && z2.beats == 0.0 && z2.modus == 0 && z2.audio != nullptr);
      PRUEF_NAH(z2.gain, 0.5011872f, 1e-6);
      PRUEF(s.zellen[1].art == cdj::ArrZellArt::leer && s.zellen[1].audio == nullptr);
      PRUEF(z0.audio != z2.audio);
    }
    cdj::gib_wiedergabe(e.snap.release(), cache);
    PRUEF(cache.eintraege() == 0 && konto.gesperrt() == 0);
  }
  {  // 2: refusals, each with the positive control of the same shape
    PRUEF(grund(true, spur(1, "s12", loop(1))).empty());
    PRUEF(grund(false, spur(1, "", loop(1))) == "format");                                      // zellen in /1
    PRUEF(grund(false, spur(1, "s12", "")) == "format");                                        // id in /1
    PRUEF(grund(true, spur(1, "s12", loop(1), "intern")) == "format");                          // cells on a non-audio track
    PRUEF(grund(true, spur(1, "", loop(0))) == "format");                                       // index 0
    PRUEF(grund(true, spur(1, "", loop(9))) == "format");                                       // index 9
    PRUEF(grund(true, spur(1, "", loop(8))).empty());
    PRUEF(grund(true, spur(1, "", loop(2) + "," + loop(2))) == "format");                       // duplicate index
    PRUEF(grund(true, spur(1, "", loop(1) + "," + loop(2))).empty());
    PRUEF(grund(true, spur(1, "", zelle(1, a, F, "loop", 0.0, 0.0, 2))) == "format");           // loop without beats
    PRUEF(grund(true, spur(1, "", zelle(1, a, F, "loop", 2.0, 0.0, 0))) == "format");           // loop with modus 0
    PRUEF(grund(true, spur(1, "", zelle(1, a, F, "einmal", 0.0, 0.0, 0))).empty());
    PRUEF(grund(true, spur(1, "", zelle(1, a, F, "einmal", 0.0, 0.0, 2))) == "format");         // einmal with modus 2
    PRUEF(grund(true, spur(1, "", zelle(1, a, F, "gleis", 2.0, 0.0, 2))) == "format");          // unknown art
    PRUEF(grund(true, spur(1, "", zelle(1, a, 0, "loop", 2.0, 0.0, 2))) == "format");           // frames 0
    PRUEF(grund(true, spur(1, "", zelle(1, a, 2880001, "loop", 2.0, 0.0, 2))) == "format");     // frames over 60 s
    PRUEF(grund(true, spur(1, "", zelle(1, a, F, "loop", 2.0, -61.0, 2))) == "format");         // gain low
    PRUEF(grund(true, spur(1, "", zelle(1, a, F, "loop", 2.0, 12.5, 2))) == "format");          // gain high
    PRUEF(grund(true, spur(1, "", zelle(1, a, F, "loop", 2.0, 12.0, 2))).empty());
    PRUEF(grund(true, spur(1, "", zelle(1, a, F, "loop", 2.0, -60.0, 2))).empty());
    PRUEF(grund(true, spur(1, "a b", "")) == "format");                                         // space in the id
    PRUEF(grund(true, spur(1, "1ab", "")) == "format");                                         // starts with a digit
    PRUEF(grund(true, spur(1, std::string(33, 'x'), "")) == "format");                          // 33 chars
    PRUEF(grund(true, spur(1, std::string(32, 'x'), "")).empty());                              // 32 chars
    PRUEF(grund(true, spur(1, "A_b-9", "")).empty());
    PRUEF(grund(true, spur(1, "s1", "") + "," + spur(2, "s1", "")) == "format");                // same id on two tracks
    PRUEF(grund(true, spur(1, "s1", "") + "," + spur(2, "s2", "")).empty());
  }
  {  // 3: a missing file gets the reason a clip gets
    const std::string fehlt(64, 'f');
    ++nr;
    o.wiedergabe2_warp(nr, "{\"nr\":1,\"art\":\"audio\",\"clips\":[" + o.clip("c1", 0.0, 1.0, fehlt, F) + "]}");
    cdj::ArrLadeErgebnis ec = cdj::lade_wiedergabe(o.pfad, nr, cache);
    PRUEF(!ec.snap && !ec.grund.empty());
    const std::string g = grund(true, spur(1, "", zelle(1, fehlt, F, "loop", 2.0, 0.0, 2)));
    PRUEF(g == ec.grund);
    PRUEF(cache.eintraege() == 0 && konto.gesperrt() == 0);
  }
  {  // 4: a clip and a cell with one sha: one cache entry, released with the snapshot
    ++nr;
    o.wiedergabe2_warp(nr, spur(1, "s1", loop(1)));
    cdj::ArrLadeErgebnis e = cdj::lade_wiedergabe(o.pfad, nr, cache);
    PRUEF(e.snap && e.grund.empty());
    PRUEF(cache.eintraege() == 1);
    if (e.snap) {
      PRUEF(e.snap->spur[0].clips[0].audio == e.snap->spur[0].zellen[0].audio);
      PRUEF(e.snap->audios.size() == 1 && e.snap->audios[0]->ref == 1);
    }
    cdj::gib_wiedergabe(e.snap.release(), cache);
    PRUEF(cache.eintraege() == 0 && konto.gesperrt() == 0);
  }
  {  // 5: a track without cells loads as before
    ++nr;
    o.wiedergabe2_warp(nr, spur(1, "s7", "") + "," + spur(2, "", ""));
    cdj::ArrLadeErgebnis e = cdj::lade_wiedergabe(o.pfad, nr, cache);
    PRUEF(e.snap && e.grund.empty());
    if (e.snap) {
      PRUEF(e.snap->spur[0].n_zellen == 0 && e.snap->spur[0].kennung == cdj::arr_id("s7") && e.snap->spur[0].n_clips == 1);
      PRUEF(e.snap->spur[1].n_zellen == 0 && e.snap->spur[1].kennung == 0 && e.snap->spur[1].kennung_text[0] == 0);
    }
    cdj::gib_wiedergabe(e.snap.release(), cache);
    PRUEF(cache.eintraege() == 0 && konto.gesperrt() == 0);
  }
  PRUEF_ENDE();
}
