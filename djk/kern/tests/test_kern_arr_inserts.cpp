// 1.10 slice 4a T2: the kernel publishes the gain reduction of every running pooled insert stage as Ereignis::INS_GR (event 43), pfad ins/komp/<n>,
// wert = dB >= 0, with the levels at 20 Hz. A stage that does not run publishes nothing (negative control: the same project with the row an = 0).
// 1.10 slice 5 U2b (plan E6): the DJ key through the whole kernel. A bass track whose compressor is keyed by erz/1; the Strudel share of erz/1 is an impulse kit event (erz_->block, before the arrangement block),
// the host return into erz/1 (Kern::rueck, added after the arrangement block) is not part of the key. Case 1: erz/1 against a track key, same click on the same sample: the PM tap of the two runs is
// bit-identical, the onset differs by 0 samples. Case 2: a loud host return into erz/1 does not duck (printed: key level against return level).
#include <algorithm>
#include <cmath>
#include <cstring>
#include <string>

#include "arr_lauf.h"
#include "cypherdj/erzeuger.h"

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
