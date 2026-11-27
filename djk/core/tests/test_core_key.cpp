// Task N2 (/k/live/tasten) at the kern: the keys of midi_ein reach the target stream through Kern::midi_ein -> Erzeuger::taste, the command TASTEN_ZIEL sets the target (every source, strand 11).
//   1) host stream midi:1:1 on erz/2: a key (note 60, velocity 100) is a note on in midi_aus(1) in its cycle with the velocity of the key, the release a note off; no target: nothing
//   2) a held key closes when the target changes (note off in the next cycle, no CC 123)
//   3) graph stream (bk) on erz/1: the key sounds (level of erz/1), the release and the target change silence it
//   4) the same pitch: a pattern note of the stream and a key on the same pitch; the release of the key does not cut the pattern note (one off, at the pattern end)
//   5) receipts: andreas and cypher are accepted (status 1 and 3); after Stop Cypher cypher is refused (6, ki_gestoppt); strom 4, 8 and 11 are refused (6, ausserhalb_bereich);
//      a refused command leaves the target alone
//   7) a note the learn table of its place maps (a button) triggers its action (/e/taste) and does not play the stream; a note without an entry plays it
//   6) a lost midi_ein port closes the held key; no allocation in the cycle with keys
#include <new>

#include "cypherdj/generator.h"
#include "core35.h"

bool g_waechter = false;
static long g_allokationen = 0;
void* operator new(std::size_t n) {
  if (g_waechter) ++g_allokationen;
  void* p = std::malloc(n ? n : 1);
  if (!p) throw std::bad_alloc();
  return p;
}
void operator delete(void* p) noexcept { std::free(p); }
void operator delete(void* p, std::size_t) noexcept { std::free(p); }

using namespace k35;

namespace {

struct Msg { int64_t t; uint8_t b0, b1, b2; };

void host_strom(Lauf& x, int nr) {
  auto s = x.neu(cdj::Befehl::ERZ_STROM, "erzeuger");
  s.nr = nr;
  std::snprintf(s.pfad, sizeof s.pfad, "erz/%d", nr);
  s.form = 1;     // MIDI port 1
  s.politik = 1;  // MIDI channel 1
  s.zeiger = nullptr;
  x.sende(s);
}

void ziel(Lauf& x, int strom, const char* quelle = "andreas") {
  auto b = x.neu(cdj::Befehl::TASTEN_ZIEL, quelle);
  b.nr = strom;
  x.sende(b);
}

// runs the cycles up to bis and collects the host messages of midi_aus(1) with absolute sample
std::vector<Msg> lauf_bis(Lauf& x, int64_t bis) {
  std::vector<Msg> out;
  while (x.kern->sample() < bis) {
    const int64_t z0 = x.kern->sample();
    x.zyklen(z0 + N);
    const cdj::MidiAus& m = x.kern->midi_aus(1);
    for (int i = 0; i < m.n; ++i) out.push_back({z0 + m.ev[i].t, m.ev[i].b[0], m.ev[i].b[1], m.ev[i].b[2]});
  }
  return out;
}

int zaehle(const std::vector<Msg>& v, uint8_t st, uint8_t note) {
  int n = 0;
  for (const auto& m : v) n += (m.b0 & 0xf0) == st && m.b1 == note;
  return n;
}

const char* G = R"({"format":"baukasten/2","name":"t","stimmen":2,"knoten":[{"id":"n","art":"note"},{"id":"s","art":"saege"},{"id":"v","art":"mul"},{"id":"o","art":"ausgang"}],"kanten":[{"von":"n.hz","nach":"s.hz"},{"von":"s.aus","nach":"v.a"},{"von":"n.gate","nach":"v.b"},{"von":"v.aus","nach":"o.x"}]})";

float pegel_max(Lauf& x, const char* pfad) {
  float p = -999.0f;
  for (const auto& e : x.alle(cdj::Ereignis::PEGEL, pfad)) p = std::max(p, e.pegel[0]);
  return p;
}

}  // namespace

int main() {
  Arbeitsbestand ab("test_kern_taste");
  {  // 1) + 2) host stream
    Lauf x(ab.pfad, nullptr);
    x.kern->midi_ein_extern(true);
    host_strom(x, 2);
    x.midi_ein_bei(3 * N + 10, 0x90, 60, 100);   // no target yet: the key is nobody's
    x.midi_ein_bei(3 * N + 40, 0x80, 60, 0);
    auto v = lauf_bis(x, 6 * N);
    PRUEF(v.empty());
    ziel(x, 2);
    x.zyklen(x.kern->sample() + N);
    const int64_t S = (x.kern->sample() / N + 3) * N + 77;
    x.midi_ein_bei(S, 0x90, 62, 100);
    x.midi_ein_bei(S + 2 * N, 0x80, 62, 0);
    x.midi_ein_bei(S + 3 * N, 0x91, 64, 33);    // channel 2 of the key does not change the channel of the stream (channel 1)
    v = lauf_bis(x, S + 8 * N);
    std::printf("kern host: ");
    for (const auto& m : v) std::printf("[%lld %02x %d %d] ", (long long)m.t, m.b0, m.b1, m.b2);
    std::printf("(key on at %lld)\n", (long long)S);
    PRUEF(v.size() == 2 || v.size() == 3);
    PRUEF(zaehle(v, 0x90, 62) == 1 && zaehle(v, 0x80, 62) == 1);
    for (const auto& m : v)
      if (m.b1 == 62 && (m.b0 & 0xf0) == 0x90) PRUEF(m.b2 == 100 && m.b0 == 0x90 && m.t >= S - N && m.t <= S + N);
    PRUEF(zaehle(v, 0x90, 64) == 1);
    for (const auto& m : v) if (m.b1 == 64 && (m.b0 & 0xf0) == 0x90) PRUEF(m.b2 == 33 && m.b0 == 0x90);
    // 2) the target changes: the held key 64 gets its off, no CC 123
    ziel(x, 0);
    v = lauf_bis(x, x.kern->sample() + 4 * N);
    PRUEF(zaehle(v, 0x80, 64) == 1);
    for (const auto& m : v) PRUEF((m.b0 & 0xf0) != 0xb0);
    PRUEF(x.quittung(x.id, 1) != nullptr && x.quittung(x.id, 3) != nullptr);
  }
  {  // 3) graph stream
    char fehler[256] = {};
    CypherBk* g = cypher_bk_neu(G, 48000.0, fehler, sizeof fehler);
    PRUEF(g != nullptr);
    Lauf x(ab.pfad, nullptr);
    x.kern->midi_ein_extern(true);
    auto s = x.neu(cdj::Befehl::ERZ_STROM, "erzeuger");
    s.nr = 2;
    std::snprintf(s.pfad, sizeof s.pfad, "erz/2");
    s.form = -1;
    s.politik = 1;
    s.zeiger = g;
    x.sende(s);
    x.teil("erz/2/fader", 0.0f, 0.0, 0.0);
    ziel(x, 3);   // another stream: erz/2 hears nothing
    x.midi_ein_bei(4 * N + 5, 0x90, 57, 100);
    x.midi_ein_bei(8 * N + 5, 0x80, 57, 0);
    x.zyklen(12 * N);
    const float still = pegel_max(x, "strom/2");
    ziel(x, 2);
    x.ev.clear();
    const int64_t S = (x.kern->sample() / N + 4) * N + 5;
    x.midi_ein_bei(S, 0x90, 57, 100);
    x.midi_ein_bei(S + 6 * N, 0x80, 57, 0);
    x.zyklen(S + 5 * N);
    const float klingt = pegel_max(x, "strom/2");
    x.zyklen(S + 6 * N + 20 * N);
    x.ev.clear();
    x.zyklen(x.kern->sample() + 4 * N);
    const float danach = pegel_max(x, "strom/2");
    std::printf("kern bk: level other target %.1f dB, key down %.1f dB, after release %.1f dB\n", still, klingt, danach);
    PRUEF(still < -80.0f && klingt > -40.0f && danach < -80.0f);
    // held key, then the target changes: silence
    x.midi_ein_bei((x.kern->sample() / N + 2) * N + 5, 0x90, 57, 100);
    x.zyklen(x.kern->sample() + 6 * N);
    x.ev.clear();
    x.zyklen(x.kern->sample() + 4 * N);
    PRUEF(pegel_max(x, "strom/2") > -40.0f );
    ziel(x, 0);
    x.zyklen(x.kern->sample() + 20 * N);
    x.ev.clear();
    x.zyklen(x.kern->sample() + 4 * N);
    PRUEF(pegel_max(x, "strom/2") < -80.0f );
    x.zyklen(x.kern->sample() + 8 * N);
    host_strom(x, 2);   // releases the graph
    x.zyklen(x.kern->sample() + 8 * N);
    for (const auto& e : x.alle(cdj::Ereignis::ERZ_BK_ALT)) if (e.zeiger == g) { cypher_bk_frei(g); g = nullptr; }
    if (g) cypher_bk_frei(g);
  }
  {  // 4) same pitch: pattern note 60 long, key 60 inside it
    Lauf x(ab.pfad, nullptr);
    x.kern->midi_ein_extern(true);
    host_strom(x, 2);
    ziel(x, 2);
    auto* f = new cdj::ErzFenster{};
    f->strom = 2; f->sendung = 1; f->ab_beat = 8.0; f->bis_beat = 12.0;
    cdj::ErzEv e{8.0, 60, 1, 1.0f};
    e.dauer = 2.0;
    f->ev[f->n++] = e;
    auto c = x.neu(cdj::Befehl::ERZ_FENSTER, "erzeuger");
    c.zeiger = f;
    x.sende(c);
    const int64_t K = 8 * SPB + SPB / 2;
    x.midi_ein_bei(K, 0x90, 60, 90);
    x.midi_ein_bei(K + SPB / 4, 0x80, 60, 0);
    const auto v = lauf_bis(x, 11 * SPB);
    std::printf("kern same pitch: ");
    for (const auto& m : v) std::printf("[%lld %02x] ", (long long)m.t, m.b0);
    std::printf("\n");
    // pattern on, key on (retrigger off + on), key release silent, pattern off at beat 10 (SPB * 10)
    PRUEF(zaehle(v, 0x90, 60) == 2 && zaehle(v, 0x80, 60) == 2);
    int offs_nach_taste = 0;
    for (const auto& m : v) offs_nach_taste += (m.b0 & 0xf0) == 0x80 && m.t > K + 2 * N && m.t < 10 * SPB - 2 * N;
    PRUEF(offs_nach_taste == 0);
  }
  {  // 5) receipts
    Lauf x(ab.pfad, nullptr);
    x.kern->midi_ein_extern(true);
    host_strom(x, 2);
    const int64_t ok = (ziel(x, 2), x.id);
    x.zyklen(2 * N);
    PRUEF(x.quittung(ok, 1) != nullptr && x.quittung(ok, 3) != nullptr);
    const int64_t ok_c = (ziel(x, 2, "cypher"), x.id);   // strand 11: cypher may set the target
    x.zyklen(x.kern->sample() + 2 * N);
    PRUEF(x.quittung(ok_c, 1) != nullptr && x.quittung(ok_c, 3) != nullptr && x.quittung(ok_c, 6) == nullptr);
    x.sende(x.neu(cdj::Befehl::KI_STOPP, "andreas"));   // Stop Cypher still stops it
    x.zyklen(x.kern->sample() + 2 * N);
    const char* grund[] = {"ki_gestoppt", "ausserhalb_bereich", "ausserhalb_bereich", "ausserhalb_bereich"};
    int i = 0;
    for (auto [str, q] : {std::pair<int, const char*>{3, "cypher"}, {4, "andreas"}, {8, "andreas"}, {11, "andreas"}}) {
      ziel(x, str, q);
      const int64_t id = x.id;
      x.zyklen(x.kern->sample() + 2 * N);
      const Q* r = x.quittung(id, 6);
      PRUEF(r != nullptr);
      if (r) PRUEF(r->grund == grund[i]);
      ++i;
    }
    x.midi_ein_bei((x.kern->sample() / N + 2) * N + 7, 0x90, 70, 80);   // the target is still 2: the key arrives there
    const auto v = lauf_bis(x, x.kern->sample() + 6 * N);
    PRUEF(zaehle(v, 0x90, 70) == 1);
  }
  {  // 6) a lost midi_ein port closes the held key; no allocation in the cycle with keys
    Lauf x(ab.pfad, nullptr);
    x.kern->midi_ein_extern(true);
    x.kern->ein_verbunden(1u << 8);   // midi_ein 1 is there
    host_strom(x, 2);
    ziel(x, 2);
    x.bewachen = true;
    g_allokationen = 0;
    x.midi_ein_bei(4 * N + 3, 0x90, 60, 100);
    x.midi_ein_bei(4 * N + 9, 0x90, 61, 100);
    x.midi_ein_bei(5 * N + 9, 0x80, 61, 0);
    auto v = lauf_bis(x, 8 * N);
    PRUEF(g_allokationen == 0);
    PRUEF(zaehle(v, 0x90, 60) == 1 && zaehle(v, 0x80, 60) == 0 && zaehle(v, 0x80, 61) == 1);
    x.kern->ein_verbunden(0);   // the port went away
    v = lauf_bis(x, 12 * N);
    PRUEF(g_allokationen == 0);
    PRUEF(zaehle(v, 0x80, 60) == 1 && zaehle(v, 0x80, 61) == 0);
  }
  {  // 7) mapped note = button, not key
    Lauf x(ab.pfad, nullptr);
    PRUEF(x.lern_laden("config/controller/softcontroller.json"));   // as the learn table of midi_ein 1: channel 16 note 0 is the stop button
    x.kern->midi_ein_extern(true);
    host_strom(x, 2);
    ziel(x, 2);
    x.midi_ein_bei(4 * N + 5, 0x9F, 0, 100);   // mapped (taste/stopp)
    x.midi_ein_bei(5 * N + 5, 0x8F, 0, 0);
    x.midi_ein_bei(6 * N + 5, 0x90, 70, 100);   // not mapped
    x.midi_ein_bei(7 * N + 5, 0x80, 70, 0);
    x.midi_ein_bei(8 * N + 5, 0x94, 40, 100);   // channel 5: no entry for it
    x.midi_ein_bei(9 * N + 5, 0x84, 40, 0);
    const auto v = lauf_bis(x, 14 * N);
    PRUEF(zaehle(v, 0x90, 0) == 0 && zaehle(v, 0x80, 0) == 0);     // the button is no key
    PRUEF(zaehle(v, 0x90, 40) == 1 && zaehle(v, 0x80, 40) == 1);   // the unmapped channel 5 note is
    PRUEF(zaehle(v, 0x90, 70) == 1 && zaehle(v, 0x80, 70) == 1);
    PRUEF(!x.alle(cdj::Ereignis::TASTE).empty());                   // the mapped button did its work
  }
  PRUEF_ENDE();
}
