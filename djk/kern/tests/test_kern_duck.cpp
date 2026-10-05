// K2 Task 1.5, Kern-Verdrahtung ohne JACK: ein bd-Klang auf Strom 1 löst den Duck aus, die Absenkung auf erz/2 (Rückweg
// mit konstantem Pegel) beginnt im Master GENAU bei sample(bd) + Vorhalt des Limiters
// (Duck ohne Verzug, Abnahme 2026-09-30: gemessen 545 Samples Rundweg).
// Zykluslänge n = 2048 (zwei Teilblöcke à MIX_BLOCK 1024); bd bei 191250 = 786 Samples NACH dem Teilblockanfang (190464),
// damit die Mutation duck_ausloesen(0) (Blockanfang) einen Unterschied macht. Zweiter Fall: bd im ZWEITEN Teilblock
// (Zyklus-Offset ≥ 1024, nicht auf der Grenze), damit `sample - n0` statt `sample - s0` (Teilblockanfang) auffällt.
// Verglichen wird der Master eines Laufs mit duck/tiefe −12 gegen einen mit 0: bis zum Einsatz bitgleich, ab dort
// (erstes abweichendes Sample) verschieden. Der Master-Ring liegt um den Limiter-Vorhalt hinter der Summe.
#include <cmath>
#include <vector>

#include "cypherdj/erzeuger.h"
#include "cypherdj/mixer.h"
#include "kern35.h"

bool g_waechter = false;

using namespace k35;

constexpr int ZN = 2048;

// Master links, Ring-Index = Kern-Sample des schreibenden Blocks; tiefe = duck/tiefe, bd = bd-Klang oder nicht
static std::vector<float> lauf(const std::string& ab, float tiefe, bool bd, int vh_aus[1], double beat = 8.5) {
  cdj::Kit kit;
  kit.klang[36].frames = 1;
  kit.klang[36].daten = {0.5f, 0.5f};
  kit.klang[36].duck = bd;
  kit.n = 1;
  Lauf x(ab, nullptr);
  vh_aus[0] = x.vh;
  auto b = x.neu(cdj::Befehl::ERZ_STROM, "erzeuger");
  b.nr = 1;
  std::snprintf(b.pfad, sizeof b.pfad, "erz/1");
  b.zeiger = &kit;
  x.sende(b);
  x.teil("erz/2/fader", 0.0f, 0.0, 0.0);   // nur erz/2 hörbar; erz/1 (Kick) bleibt auf Vorgabe −200
  x.teil("duck/tiefe", tiefe, 0.0, 0.0);
  x.teil("duck/release", 600.0f, 0.0, 0.0);
  static float wirt[ZN];
  for (float& v : wirt) v = 0.25f;
  x.kern->rueck(2, wirt, wirt);
  auto* f = new cdj::ErzFenster{};
  f->strom = 1;
  f->sendung = 1;
  f->ab_beat = 8.0;
  f->bis_beat = 12.0;
  f->ev[f->n++] = cdj::ErzEv{beat, 36, 1, 1.0f};
  auto c = x.neu(cdj::Befehl::ERZ_FENSTER, "erzeuger");
  c.zeiger = f;
  x.sende(c);
  std::vector<float> l;
  while (x.kern->sample() < 9 * SPB) {
    const int64_t n0 = x.kern->sample();
    const uint64_t w0 = cdj_lade(&x.ring->w);
    x.kern->zyklus(ZN, n0 * 20833);
    const float* d = cdj_ring_daten_c(x.ring);
    l.resize(n0 + ZN);
    for (int i = 0; i < ZN; ++i) l[n0 + i] = d[((w0 + (uint64_t)i) % CDJ_RING_CAP) * 4 + 0];
    cdj::Ereignis e;
    while (x.ere->hole(e)) {}
  }
  delete f;
  return l;
}

static int64_t erste_abweichung(const std::vector<float>& a, const std::vector<float>& b) {
  for (size_t i = 0; i < a.size() && i < b.size(); ++i)
    if (a[i] != b[i]) return static_cast<int64_t>(i);
  return -1;
}

int main() {
  Arbeitsbestand ab("test_kern_duck");
  int vh[1] = {0};
  const auto ged = lauf(ab.pfad, -12.0f, true, vh);
  const auto roh = lauf(ab.pfad, 0.0f, true, vh);
  const auto ohne_bd = lauf(ab.pfad, -12.0f, false, vh);
  const int64_t bd = std::llround(8.5 * SPB);
  const int64_t soll = bd + vh[0];
  const int64_t ist = erste_abweichung(ged, roh);
  std::printf("duck im Kern: bd bei %lld, Absenkung im Master ab %lld, Soll %lld (Vorhalt %d)\n", (long long)bd,
              (long long)ist, (long long)soll, vh[0]);
  PRUEF(bd % 1024 == 786);   // mitten im Teilblock, nicht am Anfang
  PRUEF(ist == soll);
  PRUEF(ged[static_cast<size_t>(soll + 500)] < 0.22f && roh[static_cast<size_t>(soll + 500)] > 0.0f);   // Positivkontrolle
  // Negativ-Kontrolle: Klang ohne duck-Flag (kein bd) löst nichts aus, auch bei −12 dB Tiefe: bitgleich zu tiefe 0
  PRUEF(erste_abweichung(ohne_bd, roh) == -1);

  // bd im zweiten Teilblock: Zyklus-Offset 1300, der Teilblock beginnt bei 1024
  {
    const double beat2 = (190464 + 1300) / static_cast<double>(SPB);
    const int64_t bd2 = std::llround(beat2 * SPB);
    const auto ged2 = lauf(ab.pfad, -12.0f, true, vh, beat2);
    const auto roh2 = lauf(ab.pfad, 0.0f, true, vh, beat2);
    const int64_t ist2 = erste_abweichung(ged2, roh2);
    std::printf("duck im zweiten Teilblock: bd bei %lld (Zyklus-Offset %lld), Absenkung ab %lld, Soll %lld\n",
                (long long)bd2, (long long)(bd2 % ZN), (long long)ist2, (long long)(bd2 + vh[0]));
    PRUEF(bd2 % ZN >= 1100 && bd2 % 1024 != 0 && bd2 % ZN < ZN - 100);
    PRUEF(ist2 == bd2 + vh[0]);
  }
  PRUEF_ENDE();
}
