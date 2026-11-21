// Container core K4 (F9): /pegel reports `strom/<n>` for every stream that is set (Erzeuger::strom_gesetzt), from the stream buffer, and for no other.
//  - before stream 5 is set no strom/<n> event exists, after it only strom/5;
//  - the reported peak (since the last report) equals the largest sample of the stream buffer, to 0.05 dB;
//  - the literal erz/<n> channels are gone.
// Error case: the mutation PEGEL_STROM_ALLE (test_kern_pegel_strom_mutation, WILL_FAIL) reports the unset streams too.
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <string>

#include "cypherdj/cypher_bk_ffi.h"
#include "core25.h"
#include "core35.h"

bool g_waechter = false;

using k35::Lauf;
using k35::N;
using k35::SPB;

namespace {
const char* G = R"({"format":"baukasten/2","name":"t","stimmen":1,"knoten":[{"id":"n","art":"note"},{"id":"s","art":"saege"},{"id":"v","art":"mul"},{"id":"o","art":"ausgang"}],"kanten":[{"von":"n.hz","nach":"s.hz"},{"von":"s.aus","nach":"v.a"},{"von":"n.gate","nach":"v.b"},{"von":"v.aus","nach":"o.x"}]})";
}

int main() {
  k35::Arbeitsbestand ab("test_kern_pegel_strom");
  Lauf x(ab.pfad, nullptr);
  const auto strom_ereignisse = [&](int von_sample) {
    int n = 0;
    for (const auto& e : x.alle(cdj::Ereignis::PEGEL))
      if (e.sample >= von_sample && std::string(e.pfad).rfind("strom/", 0) == 0) ++n;
    return n;
  };
  x.zyklen(40 * N);   // nothing set yet
  PRUEF(strom_ereignisse(0) == 0);
  const int64_t ab_s = x.kern->sample();

  char f[256] = {};
  CypherBk* g = cypher_bk_neu(G, 48000.0, f, sizeof f);
  PRUEF(g != nullptr);
  auto s = x.neu(cdj::Befehl::ERZ_STROM, "erzeuger");
  s.nr = 5;
  s.form = -1;
  s.politik = 1;
  s.zeiger = g;
  x.sende(s);
  auto* fe = new cdj::ErzFenster{};
  fe->strom = 5;
  fe->sendung = 1;
  fe->ab_beat = 0.0;
  fe->bis_beat = 8.0;
  cdj::ErzEv e{1.0, 57, 1, 1.0f};
  e.dauer = 4.0;
  fe->ev[fe->n++] = e;
  auto c = x.neu(cdj::Befehl::ERZ_FENSTER, "erzeuger");
  c.zeiger = fe;
  x.sende(c);

  float buf_spitze = 0.0f;
  for (int zyk = 0; zyk < 400; ++zyk) {
    x.zyklen(x.kern->sample() + N);
    const cdj::Quellpuffer& q = x.kern->quellpuffer();
    for (int i = 0; i < N; ++i) buf_spitze = std::max(buf_spitze, std::max(std::fabs(q.strom_l[4][i]), std::fabs(q.strom_r[4][i])));
  }
  int n5 = 0, fremd = 0;
  float hoechst = -999.0f;
  for (const auto& ev : x.alle(cdj::Ereignis::PEGEL)) {
    const std::string pfad = ev.pfad;
    if (pfad.rfind("strom/", 0) != 0) {
      PRUEF(pfad.rfind("erz/", 0) != 0);   // the literal channels are gone
      continue;
    }
    if (pfad == "strom/5") {
      ++n5;
      hoechst = std::max(hoechst, ev.pegel[0]);
    } else {
      ++fremd;
    }
  }
  const float soll = 20.0f * std::log10(buf_spitze);
  std::printf("pegel strom: strom/5 %d reports, highest %.2f dB (buffer peak %.2f dB), other strom channels %d (from sample %lld)\n", n5, hoechst, soll, fremd,
              static_cast<long long>(ab_s));
  PRUEF(n5 >= 400 * N / 2400 - 2);
  PRUEF(buf_spitze > 0.01f);
  PRUEF(std::fabs(hoechst - soll) <= 0.05f);
  PRUEF(fremd == 0);   // unset streams do not report
  PRUEF_ENDE();
}
