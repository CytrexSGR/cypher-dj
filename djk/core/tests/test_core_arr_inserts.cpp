// 1.10 slice 4a T2: the kernel publishes the gain reduction of every running pooled insert stage as Ereignis::INS_GR (event 43), pfad ins/komp/<n>,
// wert = dB >= 0, with the levels at 20 Hz. A stage that does not run publishes nothing (negative control: the same project with the row an = 0).
// 1.10 slice 5 U2b (plan E6): the DJ key through the whole kernel. A bass track whose compressor is keyed by erz/1; the Strudel share of erz/1 is an impulse kit event (erz_->block, before the arrangement block),
// the host return into erz/1 (Kern::rueck, added after the arrangement block) is not part of the key. Case 1: erz/1 against a track key, same click on the same sample: the PM tap of the two runs is
// bit-identical, the onset differs by 0 samples. Case 2: a loud host return into erz/1 does not duck (printed: key level against return level).
#include <algorithm>
#include <cmath>
#include <cstring>
#include <string>

#include "arr_run.h"
#include "cypherdj/generator.h"

bool g_waechter = false;

using k35::N;

int main() {
  k35::Arbeitsbestand ab("test_kern_arr_inserts");
  auto lauf = [&](bool an, int& n_ereignisse, float& wert, int slot = 3) {
    const std::string sl = std::to_string(slot);
    arr35::Lauf x(ab.pfad, "test_kern_arr_inserts");
    const std::string a = x.ordner.audio('a', 400000, 0.5f);
    x.teil(("ins/komp/" + sl + "/schwelle").c_str(), -30.0f, 0.0, 0.0);
    x.teil(("ins/komp/" + sl + "/ratio").c_str(), 8.0f, 0.0, 0.0);
    x.teil(("ins/komp/" + sl + "/mix").c_str(), 1.0f, 0.0, 0.0);
    x.teil(("ins/komp/" + sl + "/an").c_str(), an ? 1.0f : 0.0f, 0.0, 0.0);
    x.laden(1, "{\"nr\":1,\"art\":\"audio\",\"chain\":[{\"art\":\"komp\",\"slot\":" + sl + "}],\"clips\":[" + x.ordner.clip("c1", 0.0, 8.0, a, 400000) + "]}", "andreas", true);
    x.start(0.0, 0);
    x.lauf(300 * N);
    n_ereignisse = 0;
    wert = 0.0f;
    for (const cdj::Ereignis& e : x.ev)
      if (e.art == cdj::Ereignis::INS_GR) {
        PRUEF(std::string(e.pfad) == "ins/komp/" + sl);
        ++n_ereignisse;
        wert = std::max(wert, e.wert);
      }
  };
  int n = 0;
  float w = 0.0f;
  lauf(true, n, w);
  std::printf("INS_GR events %d, largest gain reduction %.2f dB\n", n, w);
  PRUEF(n >= 5);        // 300 cycles of N samples at 20 Hz
  PRUEF(w > 3.0f);      // a constant 0.5 against -30 dB, ratio 8
  lauf(false, n, w);
  PRUEF(n == 0);        // negative control: the stage is off, nothing is published
  for (int slot : {1, 9, 10, 11, 12}) {   // the path is written by hand in the callback: one and two digits
    lauf(true, n, w, slot);
    PRUEF(n >= 5 && w > 3.0f);
  }

  // ---- T8 (device faces): the limiter stage reports on ins/lim/<n>, next to a compressor with the same number
  {
    auto lim_lauf = [&](bool lim_an, bool komp_dazu, std::vector<std::string>& pfade, float& lim_gr) {
      arr35::Lauf x(ab.pfad, "test_kern_arr_inserts_lim");
      const std::string a = x.ordner.audio('a', 400000, 1.0f);   // 0 dBFS against a ceiling of -6 dB
      x.teil("ins/lim/1/decke", -6.0f, 0.0, 0.0);
      x.teil("ins/lim/1/an", lim_an ? 1.0f : 0.0f, 0.0, 0.0);
      std::string kette = "{\"art\":\"lim\",\"slot\":1}";
      if (komp_dazu) {
        x.teil("ins/komp/1/schwelle", -30.0f, 0.0, 0.0);
        x.teil("ins/komp/1/ratio", 8.0f, 0.0, 0.0);
        x.teil("ins/komp/1/mix", 1.0f, 0.0, 0.0);
        x.teil("ins/komp/1/an", 1.0f, 0.0, 0.0);
        kette += ",{\"art\":\"komp\",\"slot\":1}";
      }
      x.laden(1, "{\"nr\":1,\"art\":\"audio\",\"chain\":[" + kette + "],\"clips\":[" + x.ordner.clip("c1", 0.0, 8.0, a, 400000) + "]}", "andreas", true);
      x.start(0.0, 0);
      x.lauf(300 * N);
      pfade.clear();
      lim_gr = 0.0f;
      for (const cdj::Ereignis& e : x.ev)
        if (e.art == cdj::Ereignis::INS_GR) {
          pfade.push_back(e.pfad);
          if (std::string(e.pfad) == "ins/lim/1") lim_gr = std::max(lim_gr, e.wert);
        }
    };
    std::vector<std::string> pf;
    float g = 0.0f;
    lim_lauf(true, false, pf, g);
    std::printf("limiter INS_GR events %zu, largest reduction %.2f dB\n", pf.size(), static_cast<double>(g));
    PRUEF(pf.size() >= 5);
    for (const auto& p : pf) PRUEF(p == "ins/lim/1");
    PRUEF(g > 3.0f);
    lim_lauf(false, false, pf, g);   // negative control: a bypassed limiter reports nothing
    PRUEF(pf.empty());
    lim_lauf(true, true, pf, g);     // limiter 1 and compressor 1: two different paths
    int nl = 0, nk = 0;
    for (const auto& p : pf) {
      if (p == "ins/lim/1") ++nl;
      else if (p == "ins/komp/1") ++nk;
      else PRUEF(false);
    }
    PRUEF(nl >= 5 && nk >= 5);
  }

  // ---- T9 (device faces): STUFE_PEGEL, the input and output peak of a stage, through the whole kernel
  {
    struct Pegel { std::string pfad; float ein, aus; };
    // kind: "komp" or "lim"; clips: [(audio file, beat from, beat length)]; an: the stage runs
    auto pegel_lauf = [&](const std::string& kind, const std::vector<std::pair<std::string, std::pair<double, double>>>& clips, bool an, std::vector<Pegel>& aus) {
      arr35::Lauf x(ab.pfad, "test_kern_arr_inserts_pegel");
      std::string cl;
      char z = 'a';
      for (const auto& c : clips) {
        const std::string f = c.first == "sin12" ? x.ordner.sinus(z, 400000, 1000.0, 0.25119f) : c.first == "dc05" ? x.ordner.audio(z, 400000, 0.05f) : x.ordner.audio(z, 400000, 0.0f);
        if (!cl.empty()) cl += ",";
        cl += x.ordner.clip((std::string("c") + z).c_str(), c.second.first, c.second.second, f, 400000);
        ++z;
      }
      if (kind == "komp") {   // hard knee, no makeup, fast attack: the static reduction of a -12 dBFS peak against -30 dB, ratio 8 is 18 - 18/8 = 15.75 dB
        x.teil("ins/komp/1/schwelle", -30.0f, 0.0, 0.0);
        x.teil("ins/komp/1/ratio", 8.0f, 0.0, 0.0);
        x.teil("ins/komp/1/knie", 0.0f, 0.0, 0.0);
        x.teil("ins/komp/1/makeup", 0.0f, 0.0, 0.0);
        x.teil("ins/komp/1/attack", 1.0f, 0.0, 0.0);
        x.teil("ins/komp/1/release", 50.0f, 0.0, 0.0);
        x.teil("ins/komp/1/mix", 1.0f, 0.0, 0.0);
      }
      x.teil(("ins/" + kind + "/1/an").c_str(), an ? 1.0f : 0.0f, 0.0, 0.0);
      x.laden(1, "{\"nr\":1,\"art\":\"audio\",\"chain\":[{\"art\":\"" + kind + "\",\"slot\":1}],\"clips\":[" + cl + "]}", "andreas", true);
      x.start(0.0, 0);
      x.lauf(300 * N);
      aus.clear();
      for (const cdj::Ereignis& e : x.ev)
        if (e.art == cdj::Ereignis::STUFE_PEGEL) aus.push_back({e.pfad, e.pegel[0], e.pegel[1]});
    };
    std::vector<Pegel> p;
    pegel_lauf("komp", {{"sin12", {0.0, 8.0}}}, true, p);
    PRUEF(p.size() >= 5);
    for (const auto& q : p) PRUEF(q.pfad == "ins/komp/1");
    const Pegel& l = p.back();   // after the compressor has settled
    std::printf("STUFE_PEGEL reports %zu, last: in %.3f dBFS, out %.3f dBFS (static reduction 15.75 dB)\n", p.size(), static_cast<double>(l.ein), static_cast<double>(l.aus));
    PRUEF_NAH(l.ein, -12.0, 0.1);
    PRUEF_NAH(l.ein - l.aus, 15.75, 0.3);
    pegel_lauf("komp", {{"sil", {0.0, 8.0}}}, true, p);   // silence: -200 for both, never NaN or -inf
    PRUEF(p.size() >= 5);
    for (const auto& q : p) PRUEF(q.ein == -200.0f && q.aus == -200.0f);
    pegel_lauf("komp", {{"sin12", {0.0, 8.0}}}, false, p);   // negative control: a bypassed stage reports nothing
    PRUEF(p.empty());
    // read and reset: a loud first second, then a quiet one; reports from the quiet part do not carry the loud peak
    pegel_lauf("komp", {{"sin12", {0.0, 2.0}}, {"dc05", {2.0, 6.0}}}, true, p);
    PRUEF(p.size() >= 5);
    float lauteste = -200.0f;
    for (const auto& q : p) lauteste = std::max(lauteste, q.ein);
    PRUEF_NAH(lauteste, -12.0, 0.1);   // the loud part is there (positive control)
    PRUEF_NAH(p.back().ein, 20.0 * std::log10(0.05), 0.1);   // the last report holds the quiet part only
    pegel_lauf("lim", {{"sin12", {0.0, 8.0}}}, true, p);     // the limiter reports as well, on ins/lim/1
    PRUEF(p.size() >= 5);
    for (const auto& q : p) PRUEF(q.pfad == "ins/lim/1");
    PRUEF_NAH(p.back().ein, -12.0, 0.1);
    PRUEF(p.back().aus <= p.back().ein + 0.01f);   // a limiter never raises the peak (default ceiling is above -12 dBFS: it passes it)
  }

  // ---- slice 5 U2b: erz/1 as a key through the kernel
  {
    const double BEAT = 8.5;   // the click: beat 8.5 of the arrangement and of the erz/1 event (the same kernel sample is measured, see ct)
    // one run: the PM tap (left) of a kernel with the bass track 1 (stage komp slot 1, key `key_json`), the key track 2 (fader -200, impulse clip at beat BEAT), optionally an erz/1 impulse event at
    // beat `erz_beat` (< 0 none) and an optional host return into erz/1 (a loud sine from the sample `rueck_ab`, < 0 none)
    struct Ergebnis {
      std::vector<float> pm;
      float gr = 0.0f;
      float key_spitze = 0.0f;
      float erz_pegel = -999.0f;   // the level meter of erz/1 (dB): shows that a host return was there
    };
    const auto kern_lauf = [&](const std::string& key_json, float sc_zeile, double erz_beat, int64_t rueck_ab, bool bass_leise = true) {
      Ergebnis erg;
      arr35::Lauf x(ab.pfad, "test_kern_arr_inserts_u2b");
      cdj::Kit kit;
      kit.klang[36].frames = 1;
      kit.klang[36].daten = {0.5f, 0.5f};
      kit.n = 1;
      auto st = x.neu(cdj::Befehl::ERZ_STROM, "erzeuger");
      st.nr = 1;
      std::snprintf(st.pfad, sizeof st.pfad, "erz/1");
      st.zeiger = &kit;
      x.sende(st);
      x.teil("erz/1/fader", 0.0f, 0.0, 0.0);
      cdj::ErzFenster* f = nullptr;
      if (erz_beat >= 0.0) {
        f = new cdj::ErzFenster{};
        f->strom = 1;
        f->sendung = 7;
        f->ab_beat = 8.0;
        f->bis_beat = 12.0;
        f->ev[f->n++] = cdj::ErzEv{erz_beat, 36, 1, 1.0f};
        auto c = x.neu(cdj::Befehl::ERZ_FENSTER, "erzeuger");
        c.zeiger = f;
        x.sende(c);
      }
      const std::string bass = x.ordner.audio('a', 400000, bass_leise ? 0.01f : 0.5f);
      const std::string klick = x.ordner.impuls('c', 400000);
      x.laden(1, "{\"nr\":1,\"art\":\"audio\",\"chain\":[{\"art\":\"komp\",\"slot\":1" + std::string(key_json.empty() ? "" : ",\"key\":" + key_json) + "}],\"clips\":[" + x.ordner.clip("c1", 0.0, 16.0, bass, 400000) + "]},"
                  "{\"nr\":2,\"art\":\"audio\",\"clips\":[" + x.ordner.clip("c2", BEAT, 4.0, klick, 400000) + "]}", "andreas", true);
      x.teil("ins/komp/1/an", 1.0f, 0.0, 0.0);
      x.teil("ins/komp/1/schwelle", -30.0f, 0.0, 0.0);
      x.teil("ins/komp/1/ratio", 8.0f, 0.0, 0.0);
      x.teil("ins/komp/1/knie", 0.0f, 0.0, 0.0);
      x.teil("ins/komp/1/attack", 1.0f, 0.0, 0.0);
      x.teil("ins/komp/1/release", 5.0f, 0.0, 0.0);
      x.teil("ins/komp/1/mix", 1.0f, 0.0, 0.0);
      x.teil("ins/komp/1/sc", sc_zeile, 0.0, 0.0);
      x.teil("spur/2/fader", -200.0f, 0.0, 0.0);
      x.start(0.0, 0);
      if (rueck_ab >= 0) {
        x.erz_quelle[0] = [rueck_ab](int64_t s) { return s >= rueck_ab ? 0.5f * static_cast<float>(std::sin(2.0 * 3.14159265358979 * 500.0 * static_cast<double>(s) / 48000.0)) : 0.0f; };
      }
      const int64_t bis = static_cast<int64_t>(BEAT * k35::SPB) + 40000;
      while (x.kern->sample() < bis) {
        x.lauf(x.kern->sample() + k35::N);
        for (const cdj::Ereignis& e : x.ev) (void)e;
        erg.key_spitze = std::max(erg.key_spitze, [&] {
          float m = 0.0f;
          const float* kl = x.kern->arrangement().inserts().schluessel_puffer(0, false);
          for (int i = 0; i < 256; ++i) m = std::max(m, std::fabs(kl[i]));
          return m;
        }());
      }
      for (const cdj::Ereignis& e : x.ev)
        if (e.art == cdj::Ereignis::INS_GR && std::string(e.pfad) == "ins/komp/1") erg.gr = std::max(erg.gr, e.wert);
      for (const cdj::Ereignis& e : x.alle(cdj::Ereignis::PEGEL, "erz/1")) erg.erz_pegel = std::max(erg.erz_pegel, e.pegel[0]);
      erg.pm = x.pm_l;
      delete f;
      return erg;
    };
    const std::string k_erz = "{\"q\":\"erz\",\"nr\":1}";
    // where the click lands on the kernel timeline: the track alone, fader 0 (a project without a chain), first non-zero sample of the PM tap
    int64_t ct = -1;
    {
      arr35::Lauf x(ab.pfad, "test_kern_arr_inserts_u2b_ct");
      const std::string klick = x.ordner.impuls('c', 400000);
      x.laden(1, "{\"nr\":1,\"art\":\"audio\",\"clips\":[" + x.ordner.clip("c2", BEAT, 4.0, klick, 400000) + "]}", "andreas", true);
      x.start(0.0, 0);
      x.lauf(static_cast<int64_t>(BEAT * k35::SPB) + 20000);
      ct = arr35::Lauf::erster(x.pm_l, 100000, static_cast<int64_t>(BEAT * k35::SPB) + 20000);
    }
    const double erz_beat = static_cast<double>(ct) / static_cast<double>(k35::SPB);   // the erz/1 event on the kernel sample of the track click
    const Ergebnis ref = kern_lauf(k_erz, 0.0f, -1.0, -1);                   // erz/1 key, nobody plays: silent
    const Ergebnis erz = kern_lauf(k_erz, 0.0f, erz_beat, -1);               // erz/1 key, the impulse event on the click sample
    const Ergebnis zeile = kern_lauf("", 2.0f, -1.0, -1);                    // row key from track 2
    const Ergebnis rueck = kern_lauf(k_erz, 0.0f, -1.0, ct - 2000);          // erz/1 key, only a host return into erz/1 (a loud sine, added after the arrangement block)
    const auto onset = [&](const std::vector<float>& a, const std::vector<float>& b) -> int64_t {
      for (int64_t i = ct - 4; i < ct + 3000 && i < static_cast<int64_t>(a.size()) && i < static_cast<int64_t>(b.size()); ++i)
        if (a[i] != b[i]) return i;
      return -1;
    };
    const int64_t o_erz = onset(ref.pm, erz.pm), o_zeile = onset(ref.pm, zeile.pm), o_rueck = onset(ref.pm, rueck.pm);
    std::printf("kernel erz/1: click on kernel sample %lld; onset of the reduction: erz/1 key %lld, track key %lld (lag %lld samples); reduction erz/1 %.2f dB, track %.2f dB\n", static_cast<long long>(ct),
                static_cast<long long>(o_erz), static_cast<long long>(o_zeile), static_cast<long long>(o_erz - o_zeile), erz.gr, zeile.gr);
    std::printf("kernel erz/1 return share (plan E6): a host return of level 0.5 (%.2f dBFS) into erz/1: key buffer peak %.4f (with the Strudel event instead: %.4f), reduction %.2f dB (the key lacks the return); meter of erz/1 with the return %.1f dB, without %.1f dB\n",
                20.0 * std::log10(0.5), rueck.key_spitze, erz.key_spitze, rueck.gr, rueck.erz_pegel, ref.erz_pegel);
    PRUEF(ct > 100000);                              // the click was found
    PRUEF(o_zeile >= ct && o_zeile < ct + 50);       // positive control: the track key ducks at the click
    PRUEF(erz.gr > 6.0f && zeile.gr > 6.0f);         // and both duck
    PRUEF(o_erz == o_zeile);                         // 0 samples between the erz/1 key and the track key
    PRUEF(rueck.erz_pegel > ref.erz_pegel + 6.0f);   // positive control: the host return really reached erz/1 (the meter sees it)
    PRUEF(erz.key_spitze > 0.1f);                    // positive control of the key buffer reading: the Strudel event is in it
    PRUEF(ref.gr < 0.5f);                            // negative control: an erz/1 key nobody plays does not duck
    PRUEF(rueck.gr < 0.5f && rueck.key_spitze == 0.0f && o_rueck < 0);   // the host return is not in the key: no reduction, the key buffer is silent, the output equals the silent run
  }

  PRUEF_ENDE();
}
