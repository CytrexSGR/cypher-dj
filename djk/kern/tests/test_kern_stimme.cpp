// Voice channel (stimme.h, kern.toml stimme_*), kern wiring without JACK. Music: a loud sine on erz/1 over the return
// path (fader 0 dB). Voice: a full-scale burst on input pair ein_4.
//  (a) stimme_eingang 0 (the default) with a loud signal on ein_4: the master is bit-identical to a run without any input.
//      The mutation CYPHERDJ_MUTATION_STIMME_IMMER_AN (the voice path always runs on pair 4) must turn this red.
//  (b) stimme_eingang 4: loudest music plus loudest voice stays under the limiter ceiling (-1 dBTP), so under 0 dBFS.
//  (c) stimme_eingang 4: up to the start of the duck the master is bit-identical to (a); the duck starts before the voice
//      sounds (look-ahead), and while the voice speaks the music is down by about stimme_duck_db.
//  (d) stimme_eingang 3 with the voice on ein_4: nothing changes (the pair is chosen, not fixed).
#include <cmath>
#include <vector>

#include "cypherdj/stimme.h"
#include "kern35.h"

bool g_waechter = false;

using namespace k35;

constexpr int64_t VOICE_AB = 96000;     // voice starts at 2 s
constexpr int64_t VOICE_BIS = 144000;   // and ends at 3 s
constexpr int64_t ENDE = 192000;

static float musik(int64_t s) { return 4.0f * std::sin(2.0 * M_PI * 110.0 * s / 48000.0); }   // +12 dB over full scale into the limiter
static float stimme(int64_t s) {
  if (s < VOICE_AB || s >= VOICE_BIS) return 0.0f;
  return std::sin(2.0 * M_PI * 440.0 * s / 48000.0) >= 0.0 ? 1.0f : -1.0f;   // full-scale square
}

struct Ergebnis {
  std::vector<float> l, r;
  int vh = 0;
};

static Ergebnis lauf(const std::string& ab, int eingang, bool mit_stimme, bool mit_musik = true) {
  Lauf x(ab, nullptr);
  if (eingang > 0) {
    cdj::StimmEinstellung e;
    e.eingang = eingang;
    e.duck_db = -12.0f;
    x.kern->stimme_einstellen(e);
  }
  x.teil("erz/1/fader", 0.0f, 0.0, 0.0);
  if (mit_musik) x.erz_quelle[0] = musik;
  if (mit_stimme) x.ein_quelle[4] = stimme;
  x.zyklen(ENDE);
  return {x.l, x.r, x.vh};
}

static int64_t erste_abweichung(const std::vector<float>& a, const std::vector<float>& b) {
  for (size_t i = 0; i < a.size() && i < b.size(); ++i)
    if (a[i] != b[i]) return static_cast<int64_t>(i);
  return a.size() == b.size() ? -1 : static_cast<int64_t>(std::min(a.size(), b.size()));
}

static float spitze(const std::vector<float>& a, int64_t von, int64_t bis) {
  float m = 0.0f;
  for (int64_t i = von; i < bis && i < static_cast<int64_t>(a.size()); ++i) m = std::fmax(m, std::fabs(a[i]));
  return m;
}

int main() {
  Arbeitsbestand ab("test_kern_stimme");
  const Ergebnis ref = lauf(ab.pfad, 0, false);
  const Ergebnis aus = lauf(ab.pfad, 0, true);
  // (a) default off: a loud voice on ein_4 changes nothing
  std::printf("(a) off with voice on ein_4: first difference at %lld (-1 = bit-identical)\n",
              (long long)std::max(erste_abweichung(ref.l, aus.l), erste_abweichung(ref.r, aus.r)));
  PRUEF(erste_abweichung(ref.l, aus.l) == -1 && erste_abweichung(ref.r, aus.r) == -1);
  PRUEF(spitze(ref.l, 48000, ENDE) > 0.5f);   // positive control: the music sounds

  const Ergebnis an = lauf(ab.pfad, 4, true);
  // (b) ceiling: limiter -1 dBTP; the sample peak must stay below it (and so below 0 dBFS)
  const float sp = std::fmax(spitze(an.l, 0, ENDE), spitze(an.r, 0, ENDE));
  const float decke = std::pow(10.0f, -1.0f / 20.0f);
  std::printf("(b) loud music + full-scale voice: peak %.4f (%.2f dBFS), ceiling %.4f\n", sp, 20.0 * std::log10(sp), decke);
  PRUEF(sp <= decke + 1e-4f && sp < 1.0f);
  // positive control: the voice alone reaches the master
  const Ergebnis nur_stimme = lauf(ab.pfad, 4, true, false);
  const float sp_stimme = spitze(nur_stimme.l, VOICE_AB, VOICE_BIS + 9600);
  std::printf("    voice alone in the master: peak %.4f\n", sp_stimme);
  PRUEF(sp_stimme > 0.5f);
  PRUEF(spitze(nur_stimme.l, 0, VOICE_AB) == 0.0f);   // silence before the (delayed) voice

  // (c) duck before the voice: the first difference to the run without voice comes before the voice is heard
  const int64_t ab_duck = erste_abweichung(ref.l, an.l);
  const int64_t stimme_hoerbar = VOICE_AB + 4800 + an.vh;   // look-ahead 4800 plus the limiter's delay
  std::printf("(c) master differs from %lld, voice audible from %lld (look-ahead 4800, limiter delay %d)\n", (long long)ab_duck,
              (long long)stimme_hoerbar, an.vh);
  // lower bound: nothing changes before the voice is detected (the limiter's look-ahead may move the first change of its
  // gain up to vh samples ahead of vh, so the bound is the detection sample itself)
  PRUEF(ab_duck >= VOICE_AB && ab_duck < stimme_hoerbar);
  // the gain of the ducker itself (music 1.0, voice 0.5 from 12000 to 24000): no limiter in between
  {
    cdj::StimmDucker d;
    cdj::StimmEinstellung e;
    e.eingang = 4;
    e.duck_db = -12.0f;
    d.einstellen(e);
    std::vector<float> vl(48000), ml(48000, 1.0f), mr(48000, 1.0f), z(48000, 0.0f);
    for (int i = 0; i < 48000; ++i) vl[i] = i >= 12000 && i < 24000 ? 0.5f : 0.0f;
    d.block(vl.data(), vl.data(), ml.data(), mr.data(), nullptr, 48000);
    const float ziel = std::pow(10.0f, -12.0f / 20.0f);
    const float vor = ml[11999];                    // before the voice is detected
    const float kurz_vor_stimme = ml[12000 + 4800 - 1];   // the last sample before the delayed voice sounds
    const float bei_stimme = ml[12000 + 4800 + 100] - 0.5f;   // music part while the voice sounds
    const float halten = ml[24000 + 4800 + 9000];   // after the voice, inside the hold
    const float ende = ml[47999];                   // in the release
    std::printf("    duck gain: before %.4f, last sample before the voice %.4f, while speaking %.4f (target %.4f), hold %.4f, release %.4f\n",
                vor, kurz_vor_stimme, bei_stimme, ziel, halten, ende);
    PRUEF(vor == 1.0f);
    PRUEF(kurz_vor_stimme < ziel * 1.05f);   // the look-ahead has the music down before the first sample of the voice
    PRUEF(std::fabs(bei_stimme - ziel) < 0.01f);
    PRUEF(std::fabs(halten - ziel) < 0.01f);
    PRUEF(ende > ziel + 0.05f && ende < 1.0f);
  }

  // (d) the pair is chosen: eingang 3 does not hear the voice on ein_4
  const Ergebnis drei = lauf(ab.pfad, 3, true);
  std::printf("(d) stimme_eingang 3, voice on ein_4: first difference %lld\n", (long long)erste_abweichung(ref.l, drei.l));
  PRUEF(erste_abweichung(ref.l, drei.l) == -1);
  PRUEF_ENDE();
}
