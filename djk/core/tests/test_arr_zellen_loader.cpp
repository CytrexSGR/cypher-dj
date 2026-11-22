// Loop deck K1: the loader reads the track id and the cells of an audio track (playback /2 and up).
// Every refusal has a positive control (the same track with valid values loads). Nothing stays locked or booked after a refusal.
#include <cstdint>
#include <cstdio>
#include <string>

#include "arr_file.h"
#include "cypherdj/arr_playback.h"
#include "cypherdj/arrangement.h"   // ARR_F_FILTER, arr_f_send
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
    PRUEF(grund(true, spur(1, "", zelle(1, a, F, "loop", 2.0, 0.0, 1))) == "format");           // loop with modus 1
    PRUEF(grund(true, spur(1, "", zelle(1, a, F, "loop", 2.0, 0.0, 0))).empty());               // session view K2: keylock off is a loop with modus 0
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
  {  // 6 (session view K2): the map, the pitch and the envelopes of a cell
    const auto mit = [&](int index, const char* art, double beats, int modus, const std::string& extra) {
      std::string z = zelle(index, a, F, art, beats, 0.0, modus);
      z.pop_back();   // the closing brace
      return z + (extra.empty() ? "" : "," + extra) + "}";
    };
    const auto lade1 = [&](const std::string& z) {
      ++nr;
      o.wiedergabe2_warp(nr, spur(1, "s1", z));
      return cdj::lade_wiedergabe(o.pfad, nr, cache);
    };
    {  // 6a: every key arrives
      cdj::ArrLadeErgebnis e = lade1(mit(1, "loop", 2.0, 2,
          "\"rueckwaerts\":1,\"blende\":1,\"scheiben\":[[0,1],[1,0]],\"pitch\":1.1225,"
          "\"huellen\":[{\"art\":\"feld\",\"feld\":9,\"punkte\":[[0,-1,0],[1,1,1]]},{\"art\":\"gain\",\"punkte\":[[0,-6,2]]},"
          "{\"art\":\"feld\",\"feld\":13,\"punkte\":[[0.5,-12,0]]}]"));
      PRUEF(e.snap && e.grund.empty());
      if (e.snap) {
        const cdj::ArrZelle& z = e.snap->spur[0].zellen[0];
        PRUEF(z.karte.n == 2 && z.karte.frames == F && z.karte.rueck && z.karte.blende && z.karte.kreis);
        PRUEF(z.karte.g[0] == 0.0 && z.karte.g[1] == 24000.0 && z.karte.g[2] == static_cast<double>(F));
        PRUEF(z.karte.s[0] == 1 && z.karte.s[1] == 0);
        PRUEF(z.pitch == 1.1225);
        PRUEF(z.n_huellen == 3);
        PRUEF(z.huellen[0].art == 0 && z.huellen[0].feld == cdj::ARR_F_FILTER && z.huellen[0].n == 2);
        PRUEF(z.huellen[0].p[0].beat == 0.0 && z.huellen[0].p[0].wert == -1.0f && z.huellen[0].p[0].form == 0);
        PRUEF(z.huellen[0].p[1].beat == 1.0 && z.huellen[0].p[1].wert == 1.0f && z.huellen[0].p[1].form == 1);
        PRUEF(z.huellen[1].art == 2 && z.huellen[1].n == 1 && z.huellen[1].p[0].wert == -6.0f && z.huellen[1].p[0].form == 2);
        PRUEF(z.huellen[2].art == 0 && z.huellen[2].feld == cdj::arr_f_send(4) && z.huellen[2].p[0].beat == 0.5);
      }
      cdj::gib_wiedergabe(e.snap.release(), cache);
      PRUEF(cache.eintraege() == 0 && konto.gesperrt() == 0);
    }
    {  // 6b: absent keys give today's cell; kreis follows the art
      cdj::ArrLadeErgebnis e = lade1(loop(1) + "," + zelle(2, b, F / 2, "einmal", 0.0, 0.0, 0));
      PRUEF(e.snap && e.grund.empty());
      if (e.snap) {
        const cdj::ArrZelle& l = e.snap->spur[0].zellen[0];
        PRUEF(l.karte.n == 0 && !l.karte.rueck && !l.karte.blende && l.karte.kreis && l.karte.frames == F);
        PRUEF(l.pitch == 1.0 && l.n_huellen == 0);
        const cdj::ArrZelle& m = e.snap->spur[0].zellen[1];
        PRUEF(m.karte.n == 0 && !m.karte.kreis && m.karte.frames == F / 2 && m.pitch == 1.0 && m.n_huellen == 0);
      }
      cdj::gib_wiedergabe(e.snap.release(), cache);
      PRUEF(cache.eintraege() == 0 && konto.gesperrt() == 0);
    }
    {  // 6c: slices on a one-shot cell take the cell beats from the entry; keylock off loop with modus 0 loads
      cdj::ArrLadeErgebnis e = lade1(mit(1, "einmal", 2.0, 0, "\"scheiben\":[[0,0],[1,1]]"));
      PRUEF(e.snap && e.grund.empty());
      if (e.snap) {
        const cdj::ArrZelle& z = e.snap->spur[0].zellen[0];
        PRUEF(z.karte.n == 2 && z.karte.g[1] == 24000.0 && !z.karte.kreis && z.beats == 0.0);
      }
      cdj::gib_wiedergabe(e.snap.release(), cache);
      PRUEF(cache.eintraege() == 0 && konto.gesperrt() == 0);
    }
    {  // 6c2: a one-shot with an envelope carries its length in beats (huell_beats, the position the envelope is read on); beats 0: unknown, the transport rules
      const std::string env = "\"huellen\":[{\"art\":\"feld\",\"feld\":9,\"punkte\":[[0,0,0],[1,0.5,0]]}]";
      cdj::ArrLadeErgebnis e = lade1(mit(1, "einmal", 4.0, 0, env));
      PRUEF(e.snap && e.grund.empty());
      if (e.snap) {
        const cdj::ArrZelle& z = e.snap->spur[0].zellen[0];
        PRUEF(z.art == cdj::ArrZellArt::einmal && z.beats == 0.0 && z.huell_beats == 4.0 && z.n_huellen == 1);
      }
      cdj::gib_wiedergabe(e.snap.release(), cache);
      cdj::ArrLadeErgebnis n = lade1(mit(1, "einmal", 0.0, 0, env));   // without a length the envelope still loads
      PRUEF(n.snap && n.grund.empty());
      if (n.snap) PRUEF(n.snap->spur[0].zellen[0].huell_beats == 0.0);
      cdj::gib_wiedergabe(n.snap.release(), cache);
      PRUEF(cache.eintraege() == 0 && konto.gesperrt() == 0);
    }
    // 6d: refusals zellen_ungueltig, each next to its positive control
    const auto raster = [](int n, double schritt) {   // n slots, identity source order
      std::string t = "\"scheiben\":[";
      for (int i = 0; i < n; ++i) t += (i ? "," : "") + std::string("[") + std::to_string(i * schritt) + "," + std::to_string(i) + "]";
      return t + "]";
    };
    const auto punkte = [](int n) {
      std::string t = "[";
      for (int i = 0; i < n; ++i) t += (i ? "," : "") + std::string("[") + std::to_string(i * 0.01) + ",-3,0]";
      return t + "]";
    };
    const auto ungueltig = [&](const std::string& z) { return grund(true, spur(1, "s1", z)) == "zellen_ungueltig"; };
    const auto gut = [&](const std::string& z) { return grund(true, spur(1, "s1", z)).empty(); };
    PRUEF(gut(mit(1, "loop", 2.0, 2, raster(64, 0.03))));                        // 64 slots
    PRUEF(ungueltig(mit(1, "loop", 2.0, 2, raster(65, 0.03))));                  // 65 slots
    {
      const std::string h = "{\"art\":\"gain\",\"punkte\":[[0,-3,0]]}";
      const std::string h9 = "{\"art\":\"feld\",\"feld\":9,\"punkte\":[[0,0,0]]}", h4 = "{\"art\":\"feld\",\"feld\":4,\"punkte\":[[0,-3,0]]}", h5 = "{\"art\":\"feld\",\"feld\":5,\"punkte\":[[0,-3,0]]}";
      PRUEF(gut(mit(1, "loop", 2.0, 2, "\"huellen\":[" + h + "," + h9 + "," + h4 + "," + h5 + "]")));          // 4 envelopes, 4 targets
      PRUEF(ungueltig(mit(1, "loop", 2.0, 2, "\"huellen\":[" + h + "," + h9 + "," + h4 + "," + h5 + ",{\"art\":\"feld\",\"feld\":6,\"punkte\":[[0,-3,0]]}]")));   // 5 envelopes, 5 targets
    }
    PRUEF(gut(mit(1, "loop", 2.0, 2, "\"huellen\":[{\"art\":\"gain\",\"punkte\":" + punkte(64) + "}]")));      // 64 points
    PRUEF(ungueltig(mit(1, "loop", 2.0, 2, "\"huellen\":[{\"art\":\"gain\",\"punkte\":" + punkte(65) + "}]")));  // 65 points
    PRUEF(ungueltig(mit(1, "loop", 2.0, 2, "\"huellen\":[{\"art\":\"gain\",\"punkte\":[]}]")));                // no point
    PRUEF(gut(mit(1, "loop", 2.0, 2, "\"huellen\":[{\"art\":\"feld\",\"feld\":9,\"punkte\":[[0,0,0]]}]")));
    PRUEF(gut(mit(1, "loop", 2.0, 2, "\"huellen\":[{\"art\":\"feld\",\"feld\":4,\"punkte\":[[0,-20,0]]}]")));   // send to return 1
    PRUEF(ungueltig(mit(1, "loop", 2.0, 2, "\"huellen\":[{\"art\":\"feld\",\"feld\":8,\"punkte\":[[0,0,0]]}]")));    // the cue field
    PRUEF(ungueltig(mit(1, "loop", 2.0, 2, "\"huellen\":[{\"art\":\"feld\",\"feld\":10,\"punkte\":[[0,0,0]]}]")));   // an EQ field
    PRUEF(ungueltig(mit(1, "loop", 2.0, 2, "\"huellen\":[{\"art\":\"feld\",\"feld\":0,\"punkte\":[[0,0,0]]}]")));    // the fader
    PRUEF(ungueltig(mit(1, "loop", 2.0, 2, "\"huellen\":[{\"art\":\"feld\",\"punkte\":[[0,0,0]]}]")));                // feld missing
    PRUEF(ungueltig(mit(1, "loop", 2.0, 2, "\"huellen\":[{\"art\":\"klang\",\"punkte\":[[0,0,0]]}]")));               // unknown art
    PRUEF(ungueltig(mit(1, "loop", 2.0, 2, "\"huellen\":[{\"art\":\"feld\",\"feld\":9,\"punkte\":[[0,1.5,0]]}]")));   // filter out of range
    PRUEF(ungueltig(mit(1, "loop", 2.0, 2, "\"huellen\":[{\"art\":\"gain\",\"punkte\":[[0,3,0]]}]")));                 // gain above 0 dB
    PRUEF(ungueltig(mit(1, "loop", 2.0, 2, "\"huellen\":[{\"art\":\"gain\",\"punkte\":[[1,0,0],[0.5,0,0]]}]")));        // beats falling
    PRUEF(ungueltig(mit(1, "loop", 2.0, 2, "\"huellen\":[{\"art\":\"gain\",\"punkte\":[[2,0,0]]}]")));                 // beat at the cell end
    PRUEF(ungueltig(mit(1, "loop", 2.0, 2, "\"huellen\":[{\"art\":\"gain\",\"punkte\":[[0,0,3]]}]")));                 // form 3
    {  // one envelope per target; three points at one beat refused, two are a jump
      const std::string g = "{\"art\":\"gain\",\"punkte\":[[0,-3,0]]}", f9 = "{\"art\":\"feld\",\"feld\":9,\"punkte\":[[0,0,0]]}";
      const std::string f4 = "{\"art\":\"feld\",\"feld\":4,\"punkte\":[[0,0,0]]}";
      PRUEF(gut(mit(1, "loop", 2.0, 2, "\"huellen\":[" + g + "," + f9 + "," + f4 + "]")));
      PRUEF(ungueltig(mit(1, "loop", 2.0, 2, "\"huellen\":[" + g + "," + g + "]")));          // twice gain
      PRUEF(ungueltig(mit(1, "loop", 2.0, 2, "\"huellen\":[" + f9 + "," + g + "," + f9 + "]")));   // twice the filter
      PRUEF(ungueltig(mit(1, "loop", 2.0, 2, "\"huellen\":[" + f4 + "," + f4 + "]")));        // twice the same send
      PRUEF(gut(mit(1, "loop", 2.0, 2, "\"huellen\":[{\"art\":\"gain\",\"punkte\":[[0,-3,0],[1,-6,2],[1,0,0],[1.5,0,0]]}]")));   // two at beat 1: a jump
      PRUEF(ungueltig(mit(1, "loop", 2.0, 2, "\"huellen\":[{\"art\":\"gain\",\"punkte\":[[0,-3,0],[1,-6,2],[1,0,0],[1,-1,0]]}]")));   // three at beat 1
    }
    {  // the cell JSON is checked before the audio is fetched: a refused cell whose file is missing gives the cell reason
      const std::string fehlt(64, 'e');
      std::string z = zelle(1, fehlt, F, "loop", 2.0, 0.0, 2);
      PRUEF(grund(true, spur(1, "s1", z)) != "zellen_ungueltig" && !grund(true, spur(1, "s1", z)).empty());   // control: the missing file alone
      z.pop_back();
      PRUEF(ungueltig(z + ",\"pitch\":9}"));
    }
    PRUEF(gut(mit(1, "loop", 2.0, 2, "\"pitch\":1.5")));
    PRUEF(ungueltig(mit(1, "loop", 2.0, 0, "\"pitch\":1.5")));                  // pitch on a keylock-off cell
    PRUEF(ungueltig(mit(1, "einmal", 0.0, 0, "\"pitch\":1.5")));                // pitch on a one-shot
    PRUEF(ungueltig(mit(1, "loop", 2.0, 2, "\"pitch\":4.5")));                  // beyond 24 semitones
    PRUEF(ungueltig(mit(1, "loop", 2.0, 2, "\"pitch\":0")));
    PRUEF(gut(mit(1, "loop", 2.0, 2, "\"scheiben\":[[0,0],[1,1]]")));
    PRUEF(ungueltig(mit(1, "loop", 2.0, 2, "\"scheiben\":[[0,0],[1,2]]")));      // source slot 2 of 2 (0-based)
    PRUEF(ungueltig(mit(1, "loop", 2.0, 2, "\"scheiben\":[[0,0],[1,-1]]")));
    PRUEF(ungueltig(mit(1, "loop", 2.0, 2, "\"scheiben\":[[0.5,0],[1,1]]")));    // first boundary not 0
    PRUEF(ungueltig(mit(1, "loop", 2.0, 2, "\"scheiben\":[[0,0],[1,1],[1,0]]"))); // not rising
    PRUEF(ungueltig(mit(1, "loop", 2.0, 2, "\"scheiben\":[[0,0],[1,1],[0.5,0]]")));
    PRUEF(ungueltig(mit(1, "loop", 2.0, 2, "\"scheiben\":[[0,0],[2,1]]")));      // boundary at the cell end
    PRUEF(ungueltig(mit(1, "loop", 2.0, 2, "\"scheiben\":[[0,0,1],[1,1]]")));    // pair of three
    PRUEF(ungueltig(mit(1, "loop", 2.0, 2, "\"scheiben\":[[0],[1,1]]")));        // pair of one
    PRUEF(ungueltig(mit(1, "loop", 2.0, 2, "\"scheiben\":[]")));                 // empty table
    PRUEF(gut(mit(1, "loop", 2.0, 2, "\"scheiben\":[[0,0],[0.008,1]]")));         // first slot exactly 192 frames (ZELL_SLOT_MIN)
    PRUEF(ungueltig(mit(1, "loop", 2.0, 2, "\"scheiben\":[[0,0],[0.0079,1]]")));  // 190 frames
    PRUEF(ungueltig(mit(1, "loop", 2.0, 2, "\"scheiben\":[[0,0],[1.9921,1]]")));  // last slot 190 frames
    PRUEF(ungueltig(mit(1, "einmal", 0.0, 0, "\"scheiben\":[[0,0],[1,1]]")));     // one-shot without cell beats for the table
    PRUEF(ungueltig(mit(1, "loop", 2.0, 2, "\"rueckwaerts\":2")));
    PRUEF(gut(mit(1, "loop", 2.0, 2, "\"rueckwaerts\":1,\"blende\":1")));
  }
  PRUEF_ENDE();
}
