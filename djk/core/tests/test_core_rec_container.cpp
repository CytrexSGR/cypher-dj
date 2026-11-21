// Container core K9: the recorder inputs of the containers. Codes 23 and 24 record the inputs of containers A and B (deck/1, deck/2),
// codes 21 and 22 those of containers C and D (pad/1, pad/2). Every container is a player keyed to its deck (deck 1..4), so the input
// of a container is the output of its player: deck 1 plays a carrier of amplitude 0.25, deck 3 one of amplitude 0.5, decks 2 and 4 are
// empty. One take, four armed tracks:
//   track 4 code 23 (A)  -> carries deck 1: peak about 0.25
//   track 5 code 24 (B)  -> deck 2 is empty: all zeros (negative control: the tap tells a container from its neighbour)
//   track 6 code 21 (C)  -> carries deck 3: peak about 0.5
//   track 7 code 22 (D)  -> deck 4 is empty: all zeros
// With the table REC_QUELLEN swapped between A and B or between C and D (mutation REC_CONTAINER_VERTAUSCHT) the peaks land on the other track.
#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <iterator>
#include <string>

#include "arr_run.h"
#include "cypherdj/recording_thread.h"

bool g_waechter = false;
using k35::N;

static std::string lies(const std::string& p) { std::ifstream f(p, std::ios::binary); return std::string((std::istreambuf_iterator<char>(f)), std::istreambuf_iterator<char>()); }

int main() {
  k35::Arbeitsbestand ab("test_kern_rec_container");
  k35::traeger(ab.pfad, "c1c0000000000e01", "--freq 1000 --ohne-klick --traeger 0.25");
  k35::traeger(ab.pfad, "c1c0000000000e03", "--freq 700 --ohne-klick --traeger 0.5");
  arr35::Lauf x(ab.pfad, "test_kern_rec_container");
  const std::string ordner = ab.pfad + "/rec";
  PRUEF(std::system(("mkdir -p " + ordner).c_str()) == 0);
  cdj::AufnahmeFaden faden(ordner);
  const std::string a = x.ordner.impuls('a', 48000);
  x.lauf(10 * N);
  x.laden(5, "{\"nr\":1,\"art\":\"audio\",\"clips\":[" + x.ordner.clip("c1", 0.0, 0.5, a, 48000) + "]}");   // the take needs an arrangement to run on
  x.lauf(12 * N);
  x.k35::Lauf::laden(1, "c1c0000000000e01");
  x.k35::Lauf::laden(3, "c1c0000000000e03");
  x.lauf(x.kern->sample() + 10 * N);
  const int spuren[4] = {4, 5, 6, 7};
  const int codes[4] = {23, 24, 21, 22};
  cdj::RecSpur* ps[4];
  for (int i = 0; i < 4; ++i) {
    ps[i] = cdj::RecSpur::neu(spuren[i], codes[i]);
    faden.anmelden(ps[i]);
    const int64_t ra = x.rec_spur(spuren[i], 1, codes[i], ps[i]);
    x.lauf(x.kern->sample() + 3 * N);
    PRUEF(x.quittung(ra, 3) != nullptr);
  }
  x.k35::Lauf::start(1, 2.0);
  x.k35::Lauf::start(3, 2.0);
  const int64_t r60 = x.rec_start(60, 0);
  x.start(0.0, 0);
  for (int i = 0; i < 900; ++i) { x.lauf(x.kern->sample() + N); faden.durchgang(); }
  PRUEF(x.quittung(r60, 2) != nullptr);
  x.stopp(0);
  for (int i = 0; i < 40; ++i) { x.lauf(x.kern->sample() + N); faden.durchgang(); }
  for (int i = 0; i < 20; ++i) faden.durchgang();
  float spitze[8] = {};
  int64_t frames[8] = {};
  int gemeldet = 0;
  cdj::TakeMeldung mt;
  while (faden.hole_meldung(mt)) {
    if (mt.kennung != 60 || mt.spur < 4 || mt.spur > 7) continue;
    PRUEF(mt.status == 0 && mt.luecken == 0);
    frames[mt.spur] = mt.frames;
    ++gemeldet;
  }
  PRUEF(gemeldet == 4);
  for (int s = 4; s <= 7; ++s) {
    const std::string roh = lies(ordner + "/aufnahme-" + std::to_string(s) + "-60.f32");
    PRUEF(frames[s] > 0 && static_cast<int64_t>(roh.size()) == frames[s] * 8);
    for (size_t i = 0; i + 4 <= roh.size(); i += 4) {
      float v;
      std::memcpy(&v, roh.data() + i, 4);
      spitze[s] = std::max(spitze[s], std::fabs(v));
    }
  }
  std::printf("rec container: peak A %.4f, B %.4f, C %.4f, D %.4f\n", spitze[4], spitze[5], spitze[6], spitze[7]);
  PRUEF(spitze[4] > 0.2f && spitze[4] < 0.3f);   // code 23: container A carries deck 1
  PRUEF(spitze[5] == 0.0f);                      // code 24: container B, deck 2 is empty
  PRUEF(spitze[6] > 0.45f && spitze[6] < 0.55f); // code 21: container C carries deck 3
  PRUEF(spitze[7] == 0.0f);                      // code 22: container D, deck 4 is empty
  for (int i = 0; i < 4; ++i) {
    const int64_t rd = x.rec_spur(spuren[i], 0, 0, nullptr);
    x.lauf(x.kern->sample() + 3 * N);
    PRUEF(x.quittung(rd, 3) != nullptr && x.kern->aufnahme().spur(spuren[i]) == nullptr);
    faden.abmelden(ps[i]);
    cdj::RecSpur::frei(ps[i]);
  }
  PRUEF_ENDE();
}
