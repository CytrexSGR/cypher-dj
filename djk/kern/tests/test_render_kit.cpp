// Package 1.9 U1b (T1.7): the offline render plays a project track with device kit like the live kern (render.h kit_ordner).
//   1 12 notes on 16ths at 120 BPM with the repo test kit kit_impuls: every impulse lies on the sample round(beat * 24000) (12 of 12, AK-K1)
//   2 the render is independent of the quantum: 128 and 1024 are bit-equal; two runs are bit-equal
//   3 refused, not silent: a kit with no folder gives fehler "format" and the message names <kit folder>/<name>; no kit folder at all too
// Mutation: RENDER_OHNE_KIT_ORDNER (the render does not hand the folder and the loader to the cache) turns cases 1 to 3 red.
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <memory>
#include <string>
#include <vector>

#include "arr_datei.h"
#include "cypherdj/render.h"
#include "cypherdj/zustand.h"
#include "pruef.h"

namespace {

const std::string KITS = std::string(CYPHERDJ_DJK) + "/kern/tests/daten/kits";   // repo test kits of U0 T0.4

std::unique_ptr<cdj_z_echtzeit> fach_erz4() {
  auto f = std::make_unique<cdj_z_echtzeit>();
  f->n_regler = 1;
  std::snprintf(f->regler[0].pfad, sizeof f->regler[0].pfad, "erz/4/fader");
  f->regler[0].wert = 0.0f;
  return f;
}

std::string projekt(const char* kit) {
  std::string noten;
  for (int i = 0; i < 12; ++i) {
    char n[128];
    std::snprintf(n, sizeof n, "%s{\"id\":\"k2/n%d\",\"beat\":%.17g,\"laenge\":0.1,\"ton\":0,\"vel\":127}", i ? "," : "", i, 0.25 * i);
    noten += n;
  }
  return std::string("{\"nr\":2,\"art\":\"intern\",\"geraet\":\"kit\",\"kit\":\"") + kit + "\",\"noten\":[" + noten + "]}";
}

cdj::RenderErgebnis render(const std::string& arr, int64_t nr, const std::string& kits, int quantum = 128) {
  cdj::RenderAuftrag r;
  r.arr_ordner = arr;
  r.nr = nr;
  r.von_beat = 0.0;
  r.bis_beat = 4.0;
  r.bpm = 120.0;
  r.quantum = quantum;
  r.kit_ordner = kits;
  const auto fach = fach_erz4();
  r.regler = fach.get();
  return cdj::rendere(r);
}

}  // namespace

int main() {
  arrdatei::Ordner o("test_render_kit");
  o.wiedergabe(1, projekt("kit_impuls"));
  o.wiedergabe(2, projekt("nicht-da-i19"));
  {  // 1: onsets on the sample
    const cdj::RenderErgebnis e = render(o.pfad, 1, KITS);
    std::printf("case 1: error '%s' %s, frames %lld, peak %.4f\n", e.fehler.c_str(), e.meldung.c_str(), static_cast<long long>(e.frames), e.spitze);
    PRUEF(e.fehler.empty() && e.spitze > 0.1f);
    // The master chain smears the 1-sample impulse into a response of some hundred samples (the same one for every note), so the onset of
    // note i is the first sample above 0.1 in a window of +-100 samples around round(beat * 24000), and the sample before it is still quiet.
    PRUEF(e.l.size() == 96000);
    int genau = 0, gleiche_antwort = 0;
    for (int i = 0; e.l.size() == 96000 && i < 12; ++i) {
      const int64_t soll = std::llround(0.25 * i * 24000.0);
      int64_t on = -1;
      for (int64_t k = std::max<int64_t>(0, soll - 100); k < soll + 100 && k < static_cast<int64_t>(e.l.size()); ++k)
        if (std::fabs(e.l[k]) > 0.1f) {
          on = k;
          break;
        }
      genau += on == soll && (soll == 0 || std::fabs(e.l[soll - 1]) < 0.01f) ? 1 : 0;
      bool gleich = true;   // the whole response starts on the same sample: bit-equal to the response of note 0
      for (int k = 0; gleich && k < 200; ++k) gleich = e.l[soll + k] == e.l[k];
      gleiche_antwort += gleich ? 1 : 0;
    }
    std::printf("case 1: onsets exactly on round(beat * 24000): %d of 12, responses bit-equal to the first: %d of 12\n", genau, gleiche_antwort);
    PRUEF(genau == 12);
    PRUEF(gleiche_antwort == 12);
  }
  {  // 2: quantum 128 and 1024 and a second run are bit-equal
    const cdj::RenderErgebnis a = render(o.pfad, 1, KITS, 128), b = render(o.pfad, 1, KITS, 1024), c = render(o.pfad, 1, KITS, 128);
    PRUEF(a.fehler.empty() && b.fehler.empty() && c.fehler.empty());
    PRUEF(a.l == b.l && a.r == b.r);
    PRUEF(a.l == c.l && a.r == c.r);
    PRUEF(a.spitze > 0.1f);
  }
  {  // 3: refused, not silent
    const cdj::RenderErgebnis a = render(o.pfad, 2, KITS);
    PRUEF(a.fehler == "format");
    PRUEF(a.meldung.find(KITS + "/nicht-da-i19") != std::string::npos);
    const cdj::RenderErgebnis b = render(o.pfad, 1, "");
    PRUEF(b.fehler == "format");
    std::printf("case 3: missing kit -> '%s' (%s); no folder -> '%s' (%s)\n", a.fehler.c_str(), a.meldung.c_str(), b.fehler.c_str(), b.meldung.c_str());
  }
  PRUEF_ENDE();
}
