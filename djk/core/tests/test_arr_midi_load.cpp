// Strand 7 task 1.2 (plan 2026-11-27 strang7-midi, section 3.2): the playback key `midi` of an instrument track into ArrSpur::midi.
//   1 a full object on a bk track: every field lands in ArrMidiParam (rate snapped to the exact grid value, sync on, an on)
//   2 a minimal `{"arp": {...}}` on a wirt track (free rate in hz, defaults for oktaven and gate), and on a rack track
//   3 without `midi`: the track's ArrMidiParam is the default one, field by field; a /2 file with the head key `harmonie` (strand 7 task 5.1) loads into
//     ArrSnapshot::harmonie_beat / harmonie_maske (task 5.2), a file without it has n_harmonie 0
//   5 task 5.2, refusals of the head key `harmonie`, each `format` naming the entry: /1 file, not a list, empty, 513 entries, an entry that is not a pair,
//     beat not a number, negative, equal or falling, maske 0, 4096, fractional, not a number
//   4 refusals, each `format` with the field path in the text: audio track, strom track, a /1 file, an empty object, a saat-only object, rate and hz
//     together, neither, rate 0.3, hz out of range, oktaven 5, gate 0, akkord with 0 / duplicates / 7 entries / out of range, maske 0 and 4096,
//     unknown arp muster, unknown member key (top level and inside a stage), chance 101 and not an integer, saat out of range, wrong value shapes
#include <cstdint>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <string>
#include <vector>

#include "arr_file.h"
#include "bk_help.h"
#include "cypherdj/arr_playback.h"
#include "cypherdj/midi_stufe.h"
#include "check.h"

namespace {

bool ist_vorgabe(const cdj::ArrMidiParam& p) {   // field by field against a default-constructed ArrMidiParam
  const cdj::ArrMidiParam d{};
  bool ok = p.an == d.an && p.akkord_n == d.akkord_n && p.skala_maske == d.skala_maske && p.skala_lane == d.skala_lane && p.arp == d.arp &&
            p.muster == d.muster && p.sync == d.sync && p.rate_beats == d.rate_beats && p.rate_hz == d.rate_hz && p.oktaven == d.oktaven &&
            p.gate == d.gate && p.vel == d.vel && p.vel_kurve == d.vel_kurve && p.vel_zufall == d.vel_zufall && p.vel_fest == d.vel_fest &&
            p.chance == d.chance && p.saat == d.saat;
  for (int i = 0; i < cdj::MIDI_AKKORD_MAX; ++i) ok = ok && p.akkord[i] == d.akkord[i];
  return ok;
}

}  // namespace

int main() {
  arrdatei::Ordner o("test_arr_midi_laden");
  const std::string bk = o.pfad + "/bk";
  std::filesystem::create_directories(bk);
  std::ofstream(bk + "/t.json") << bkt::G_T;
  cdj::SpeicherKonto konto{1024LL << 20};
  cdj::ArrAudioCache cache{&konto, 256LL << 20, false};
  cache.setze_bk_ordner(bk);
  int64_t nr = 1;
  auto lade2 = [&](const std::string& spuren) {
    o.wiedergabe2_warp(nr, spuren);
    return cdj::lade_wiedergabe(o.pfad, nr++, cache);
  };
  const std::string bk_spur = "{\"nr\":1,\"art\":\"intern\",\"geraet\":\"bk\",\"graph\":\"t\",\"noten\":[]";
  const std::string wirt_spur = "{\"nr\":2,\"art\":\"wirt\",\"slot\":1,\"noten\":[]";
  const std::string rb_spur = "{\"nr\":3,\"art\":\"intern\",\"geraet\":\"rb338\",\"parameter\":{},\"noten\":[]";
  const std::string rack_spur = "{\"nr\":4,\"art\":\"intern\",\"geraet\":\"rack\",\"kette\":0,\"glieder\":[{\"id\":\"a\",\"art\":\"intern\",\"geraet\":\"rb338\"}],\"noten\":[]";
  const std::string arp_min = "{\"arp\":{\"muster\":\"up\",\"rate\":0.25}}";

  {  // 1: full object on a bk track
    cdj::ArrLadeErgebnis e = lade2(bk_spur +
                                   ",\"midi\":{\"akkord\":[4,7,-12],\"skala\":{\"maske\":2773,\"lane\":true},"
                                   "\"arp\":{\"muster\":\"updown\",\"rate\":0.6666667,\"oktaven\":2,\"gate\":0.75},"
                                   "\"velocity\":{\"kurve\":-0.5,\"zufall\":12,\"fest\":100},\"chance\":80,\"saat\":4294967295}}");
    PRUEF(e.snap != nullptr);
    if (!e.snap) std::printf("1: %s %s\n", e.grund.c_str(), e.meldung.c_str());
    if (e.snap) {
      const cdj::ArrMidiParam& m = e.snap->spur[0].midi;
      PRUEF(m.an);
      PRUEF(m.akkord_n == 3 && m.akkord[0] == 4 && m.akkord[1] == 7 && m.akkord[2] == -12 && m.akkord[3] == 0);
      PRUEF(m.skala_maske == 2773 && m.skala_lane);
      PRUEF(m.arp && m.muster == cdj::ArpMuster::updown && m.sync && m.rate_beats == 2.0 / 3.0 && m.oktaven == 2 && m.gate == 0.75f);
      PRUEF(m.vel && m.vel_kurve == -0.5f && m.vel_zufall == 12 && m.vel_fest == 100);
      PRUEF(m.chance == 80 && m.saat == 4294967295u);
      cdj::gib_wiedergabe(e.snap.release(), cache);
    }
    // skala without lane: lane false; every arp pattern name and every sync rate
    const char* muster[] = {"up", "down", "updown", "downup", "played", "random", "chord"};
    const double raten[] = {2, 1, 2.0 / 3.0, 0.5, 1.0 / 3.0, 0.25, 1.0 / 6.0, 0.125};
    for (int i = 0; i < 7; ++i) {
      char b[256];
      std::snprintf(b, sizeof b, ",\"midi\":{\"skala\":{\"maske\":1},\"arp\":{\"muster\":\"%s\",\"rate\":%.9g}}}", muster[i], raten[i] + 4e-7);
      cdj::ArrLadeErgebnis f = lade2(rb_spur + b);
      PRUEF(f.snap != nullptr);
      if (!f.snap) std::printf("1: %s %s\n", muster[i], f.meldung.c_str());
      if (f.snap) {
        const cdj::ArrMidiParam& m = f.snap->spur[2].midi;
        PRUEF(m.an && m.skala_maske == 1 && !m.skala_lane && m.arp && static_cast<int>(m.muster) == i && m.rate_beats == raten[i]);
        PRUEF(!m.vel && m.chance == 100 && m.saat == 0 && m.akkord_n == 0);
        cdj::gib_wiedergabe(f.snap.release(), cache);
      }
    }
    cdj::ArrLadeErgebnis g = lade2(rb_spur + ",\"midi\":{\"arp\":{\"muster\":\"up\",\"rate\":0.125}}}");   // 1/32
    PRUEF(g.snap && g.snap->spur[2].midi.rate_beats == 0.125);
    if (g.snap) cdj::gib_wiedergabe(g.snap.release(), cache);
    cdj::ArrLadeErgebnis h = lade2(rb_spur + ",\"midi\":{\"chance\":0}}");   // chance alone is a stage
    PRUEF(h.snap && h.snap->spur[2].midi.an && h.snap->spur[2].midi.chance == 0 && !h.snap->spur[2].midi.arp);
    if (h.snap) cdj::gib_wiedergabe(h.snap.release(), cache);
  }
  {  // 2: minimal arp on a wirt track (free rate) and on a rack track
    cdj::ArrLadeErgebnis e = lade2(wirt_spur + ",\"midi\":{\"arp\":{\"muster\":\"down\",\"hz\":12.5}}}," + rack_spur + ",\"midi\":" + arp_min + "}");
    PRUEF(e.snap != nullptr);
    if (!e.snap) std::printf("2: %s %s\n", e.grund.c_str(), e.meldung.c_str());
    if (e.snap) {
      const cdj::ArrMidiParam& w = e.snap->spur[1].midi;
      PRUEF(w.an && w.arp && w.muster == cdj::ArpMuster::down && !w.sync && w.rate_hz == 12.5 && w.oktaven == 1 && w.gate == 0.5f);
      PRUEF(w.akkord_n == 0 && w.skala_maske == 0 && !w.vel && w.chance == 100 && w.saat == 0);
      const cdj::ArrMidiParam& r = e.snap->spur[3].midi;
      PRUEF(e.snap->spur[3].art == cdj::ArrArt::rack && r.an && r.arp && r.sync && r.rate_beats == 0.25);
      cdj::gib_wiedergabe(e.snap.release(), cache);
    }
  }
  {  // 3: without `midi` every track keeps the default ArrMidiParam; the head key `harmonie` loads
    cdj::ArrLadeErgebnis e = lade2(bk_spur + "}," + wirt_spur + "}," + rb_spur + "}," + rack_spur + "}");
    PRUEF(e.snap != nullptr);
    if (e.snap) {
      for (int i = 0; i < cdj::ARR_SPUREN; ++i) PRUEF(ist_vorgabe(e.snap->spur[i].midi));
      PRUEF(e.snap->n_harmonie == 0);
      cdj::gib_wiedergabe(e.snap.release(), cache);
    }
    o.wiedergabe(nr, rb_spur + "}");   // /1 without midi
    cdj::ArrLadeErgebnis v1 = cdj::lade_wiedergabe(o.pfad, nr++, cache);
    PRUEF(v1.snap && ist_vorgabe(v1.snap->spur[2].midi));
    if (v1.snap) cdj::gib_wiedergabe(v1.snap.release(), cache);
    o.roh(nr, "{\"format\":\"cypherdj-arr/2\",\"nr\":" + std::to_string(nr) + ",\"harmonie\":[[0,2773],[8,1709]],\"spuren\":[" + rb_spur +
                  ",\"midi\":{\"skala\":{\"maske\":2773,\"lane\":true}}}]}");
    cdj::ArrLadeErgebnis hz = cdj::lade_wiedergabe(o.pfad, nr++, cache);
    PRUEF(hz.snap && hz.snap->spur[2].midi.skala_lane);
    PRUEF(hz.snap && hz.snap->n_harmonie == 2 && hz.snap->harmonie_beat[0] == 0.0 && hz.snap->harmonie_maske[0] == 2773 &&
          hz.snap->harmonie_beat[1] == 8.0 && hz.snap->harmonie_maske[1] == 1709);
    if (!hz.snap) std::printf("3: %s %s\n", hz.grund.c_str(), hz.meldung.c_str());
    if (hz.snap) cdj::gib_wiedergabe(hz.snap.release(), cache);
  }
  {  // 4: refusals
    struct Fall {
      const char* was;
      std::string spuren;
      const char* im_text;   // must appear in the message
    };
    auto rb = [&](const std::string& midi) { return rb_spur + ",\"midi\":" + midi + "}"; };
    const std::vector<Fall> faelle = {
        {"audio track", "{\"nr\":3,\"art\":\"audio\",\"clips\":[],\"midi\":" + arp_min + "}", "spuren[0].midi"},
        {"not an object", rb("[1]"), "spuren[0].midi"},
        {"empty object", rb("{}"), "spuren[0].midi"},
        {"saat only", rb("{\"saat\":3}"), "spuren[0].midi"},
        {"unknown member", rb("{\"chance\":50,\"tempo\":1}"), "spuren[0].midi.tempo"},
        {"rate and hz", rb("{\"arp\":{\"muster\":\"up\",\"rate\":0.25,\"hz\":4}}"), "spuren[0].midi.arp"},
        {"neither rate nor hz", rb("{\"arp\":{\"muster\":\"up\"}}"), "spuren[0].midi.arp"},
        {"rate 0.3", rb("{\"arp\":{\"muster\":\"up\",\"rate\":0.3}}"), "spuren[0].midi.arp.rate"},
        {"rate just outside 1e-6", rb("{\"arp\":{\"muster\":\"up\",\"rate\":0.250002}}"), "spuren[0].midi.arp.rate"},
        {"hz 0.4", rb("{\"arp\":{\"muster\":\"up\",\"hz\":0.4}}"), "spuren[0].midi.arp.hz"},
        {"hz 41", rb("{\"arp\":{\"muster\":\"up\",\"hz\":41}}"), "spuren[0].midi.arp.hz"},
        {"oktaven 5", rb("{\"arp\":{\"muster\":\"up\",\"rate\":0.25,\"oktaven\":5}}"), "spuren[0].midi.arp.oktaven"},
        {"oktaven 0", rb("{\"arp\":{\"muster\":\"up\",\"rate\":0.25,\"oktaven\":0}}"), "spuren[0].midi.arp.oktaven"},
        {"oktaven 1.5", rb("{\"arp\":{\"muster\":\"up\",\"rate\":0.25,\"oktaven\":1.5}}"), "spuren[0].midi.arp.oktaven"},
        {"gate 0", rb("{\"arp\":{\"muster\":\"up\",\"rate\":0.25,\"gate\":0}}"), "spuren[0].midi.arp.gate"},
        {"gate 1.1", rb("{\"arp\":{\"muster\":\"up\",\"rate\":0.25,\"gate\":1.1}}"), "spuren[0].midi.arp.gate"},
        {"unknown muster", rb("{\"arp\":{\"muster\":\"zigzag\",\"rate\":0.25}}"), "spuren[0].midi.arp.muster"},
        {"muster missing", rb("{\"arp\":{\"rate\":0.25}}"), "spuren[0].midi.arp.muster"},
        {"unknown arp key", rb("{\"arp\":{\"muster\":\"up\",\"rate\":0.25,\"swing\":1}}"), "spuren[0].midi.arp.swing"},
        {"arp not an object", rb("{\"arp\":true}"), "spuren[0].midi.arp"},
        {"akkord with 0", rb("{\"akkord\":[0,7]}"), "spuren[0].midi.akkord"},
        {"akkord duplicates", rb("{\"akkord\":[7,7]}"), "spuren[0].midi.akkord"},
        {"akkord 7 entries", rb("{\"akkord\":[1,2,3,4,5,6,7]}"), "spuren[0].midi.akkord"},
        {"akkord empty", rb("{\"akkord\":[]}"), "spuren[0].midi.akkord"},
        {"akkord 25", rb("{\"akkord\":[25]}"), "spuren[0].midi.akkord"},
        {"akkord -25", rb("{\"akkord\":[-25]}"), "spuren[0].midi.akkord"},
        {"akkord fraction", rb("{\"akkord\":[4.5]}"), "spuren[0].midi.akkord"},
        {"maske 0", rb("{\"skala\":{\"maske\":0}}"), "spuren[0].midi.skala.maske"},
        {"maske 4096", rb("{\"skala\":{\"maske\":4096}}"), "spuren[0].midi.skala.maske"},
        {"maske missing", rb("{\"skala\":{\"lane\":true}}"), "spuren[0].midi.skala.maske"},
        {"lane not boolean", rb("{\"skala\":{\"maske\":5,\"lane\":1}}"), "spuren[0].midi.skala.lane"},
        {"unknown skala key", rb("{\"skala\":{\"maske\":5,\"grundton\":2}}"), "spuren[0].midi.skala.grundton"},
        {"kurve 1.5", rb("{\"velocity\":{\"kurve\":1.5}}"), "spuren[0].midi.velocity.kurve"},
        {"zufall 65", rb("{\"velocity\":{\"zufall\":65}}"), "spuren[0].midi.velocity.zufall"},
        {"fest 128", rb("{\"velocity\":{\"fest\":128}}"), "spuren[0].midi.velocity.fest"},
        {"unknown velocity key", rb("{\"velocity\":{\"kurve\":0,\"x\":0}}"), "spuren[0].midi.velocity.x"},
        {"chance 101", rb("{\"chance\":101}"), "spuren[0].midi.chance"},
        {"chance fraction", rb("{\"chance\":50.5}"), "spuren[0].midi.chance"},
        {"saat negative", rb("{\"chance\":50,\"saat\":-1}"), "spuren[0].midi.saat"},
        {"saat above 32 bit", rb("{\"chance\":50,\"saat\":4294967296}"), "spuren[0].midi.saat"},
    };
    for (const Fall& f : faelle) {
      cdj::ArrLadeErgebnis e = lade2(f.spuren);
      const bool ok = !e.snap && e.grund == "format" && e.meldung.find(f.im_text) != std::string::npos;
      if (!ok) std::printf("4: %s: snap %d grund '%s' meldung '%s'\n", f.was, e.snap != nullptr, e.grund.c_str(), e.meldung.c_str());
      PRUEF(ok);
      if (e.snap) cdj::gib_wiedergabe(e.snap.release(), cache);
    }
    // a strom track (a /4 file: quelle exists only there)
    o.roh(nr, "{\"format\":\"cypherdj-arr/4\",\"nr\":" + std::to_string(nr) + ",\"spuren\":[{\"nr\":3,\"art\":\"intern\",\"quelle\":{\"art\":\"strom\",\"strom\":1},\"midi\":" +
                  arp_min + "}]}");
    cdj::ArrLadeErgebnis st = cdj::lade_wiedergabe(o.pfad, nr++, cache);
    const bool st_ok = !st.snap && st.grund == "format" && st.meldung.find("spuren[0].midi") != std::string::npos;
    if (!st_ok) std::printf("4: strom track: snap %d grund '%s' meldung '%s'\n", st.snap != nullptr, st.grund.c_str(), st.meldung.c_str());
    PRUEF(st_ok);
    if (st.snap) cdj::gib_wiedergabe(st.snap.release(), cache);
    // the same strom track without midi loads (the refusal above is the key, not the file)
    o.roh(nr, "{\"format\":\"cypherdj-arr/4\",\"nr\":" + std::to_string(nr) + ",\"spuren\":[{\"nr\":3,\"art\":\"intern\",\"quelle\":{\"art\":\"strom\",\"strom\":1}}]}");
    cdj::ArrLadeErgebnis st2 = cdj::lade_wiedergabe(o.pfad, nr++, cache);
    PRUEF(st2.snap != nullptr);
    if (!st2.snap) std::printf("4: strom track without midi: %s %s\n", st2.grund.c_str(), st2.meldung.c_str());
    if (st2.snap) cdj::gib_wiedergabe(st2.snap.release(), cache);
    // a /1 file
    o.wiedergabe(nr, rb(arp_min));
    cdj::ArrLadeErgebnis e = cdj::lade_wiedergabe(o.pfad, nr++, cache);
    const bool ok = !e.snap && e.grund == "format" && e.meldung.find("spuren[0].midi") != std::string::npos;
    if (!ok) std::printf("4: /1 file: snap %d grund '%s' meldung '%s'\n", e.snap != nullptr, e.grund.c_str(), e.meldung.c_str());
    PRUEF(ok);
    if (e.snap) cdj::gib_wiedergabe(e.snap.release(), cache);
  }
  {  // 5: refusals of the head key harmonie
    auto datei = [&](const char* fmt, const std::string& h) {
      return std::string("{\"format\":\"") + fmt + "\",\"nr\":" + std::to_string(nr) + ",\"harmonie\":" + h + ",\"spuren\":[" + rb_spur + "}]}";
    };
    std::string viele = "[";
    for (int i = 0; i < 513; ++i) viele += (i ? ",[" : "[") + std::to_string(i) + ",1]";
    viele += "]";
    std::string genug = "[";
    for (int i = 0; i < 512; ++i) genug += (i ? ",[" : "[") + std::to_string(i) + ",1]";
    genug += "]";
    struct Fall {
      const char* was;
      const char* fmt;
      std::string h;
      const char* im_text;
    };
    const std::vector<Fall> faelle = {
        {"/1 file", "cypherdj-arr/1", "[[0,1]]", "harmonie"},
        {"not a list", "cypherdj-arr/2", "{\"0\":1}", "harmonie"},
        {"empty", "cypherdj-arr/2", "[]", "harmonie"},
        {"513 entries", "cypherdj-arr/2", viele, "harmonie"},
        {"not a pair", "cypherdj-arr/2", "[[0,1,2]]", "harmonie[0]"},
        {"not a list entry", "cypherdj-arr/2", "[5]", "harmonie[0]"},
        {"beat text", "cypherdj-arr/2", "[[\"0\",1]]", "harmonie[0].beat"},
        {"beat negative", "cypherdj-arr/2", "[[-1,1]]", "harmonie[0].beat"},
        {"beat equal", "cypherdj-arr/2", "[[0,1],[4,2],[4,3]]", "harmonie[2].beat"},
        {"beat falling", "cypherdj-arr/2", "[[0,1],[4,2],[3,3]]", "harmonie[2].beat"},
        {"maske 0", "cypherdj-arr/2", "[[0,0]]", "harmonie[0].maske"},
        {"maske 4096", "cypherdj-arr/2", "[[0,4096]]", "harmonie[0].maske"},
        {"maske negative", "cypherdj-arr/2", "[[0,-3]]", "harmonie[0].maske"},
        {"maske fraction", "cypherdj-arr/2", "[[0,2.5]]", "harmonie[0].maske"},
        {"maske text", "cypherdj-arr/2", "[[0,\"x\"]]", "harmonie[0].maske"},
    };
    for (const Fall& f : faelle) {
      o.roh(nr, datei(f.fmt, f.h));
      cdj::ArrLadeErgebnis e = cdj::lade_wiedergabe(o.pfad, nr++, cache);
      const bool ok = !e.snap && e.grund == "format" && e.meldung.find(f.im_text) != std::string::npos;
      if (!ok) std::printf("5: %s: snap %d grund '%s' meldung '%s'\n", f.was, e.snap != nullptr, e.grund.c_str(), e.meldung.c_str());
      PRUEF(ok);
      if (e.snap) cdj::gib_wiedergabe(e.snap.release(), cache);
    }
    o.roh(nr, datei("cypherdj-arr/2", genug));   // 512 entries load; a fractional beat too
    cdj::ArrLadeErgebnis g = cdj::lade_wiedergabe(o.pfad, nr++, cache);
    PRUEF(g.snap && g.snap->n_harmonie == 512 && g.snap->harmonie_beat[511] == 511.0);
    if (g.snap) cdj::gib_wiedergabe(g.snap.release(), cache);
    o.roh(nr, datei("cypherdj-arr/3", "[[0.5,4095]]"));
    cdj::ArrLadeErgebnis h = cdj::lade_wiedergabe(o.pfad, nr++, cache);
    PRUEF(h.snap && h.snap->n_harmonie == 1 && h.snap->harmonie_beat[0] == 0.5 && h.snap->harmonie_maske[0] == 4095);
    if (!h.snap) std::printf("5: /3 lane: %s %s\n", h.grund.c_str(), h.meldung.c_str());
    if (h.snap) cdj::gib_wiedergabe(h.snap.release(), cache);
    std::printf("5: %zu harmonie refusals\n", faelle.size());
  }
  PRUEF_ENDE();
}
