// Task N2 (live keys, /k/live/tasten): Erzeuger::taste plays a key through the sink of the target stream, as a pattern event of that stream would.
//   1) graph stream without Werk: a key (note, velocity, on at S, off at T) is bit-identical to a pattern event at the same samples with dauer T - S and the same velocity
//      (velocity arrives: the graph multiplies by the note velocity); silent before S; nothing is held afterwards
//   2) graph stream with Werk (0 and 2 threads): the key sounds from the start of the block after its stamp (the handle computed the current block a block ahead), the same as a late pattern event
//   3) host stream (midi:1:3): note on at the stamp with the key's velocity and the channel of the stream, note off at the release; no lead (the lead of the pattern events is 512 here)
//   4) closing: target change, change of the MIDI target (the off goes to the OLD port and channel), tasten_alle_aus, change of the graph; per-note offs only (no CC 123, no all-off), the
//      notes of a pattern on the same stream keep their own off
//   5) the same pitch as a pattern note: a pattern off does not cut a held key, a key release does not cut a scheduled pattern note (host stream: the exact message list)
//   6) a stream with a kit and no target takes no keys; target 0 (the state after start) changes nothing: a pattern run is bit-identical with and without a key queue; the queue never fills
//      (an On beyond the queue is counted, an off is never lost)
//   7) under the allocation guard taste, tasten_ziel and block allocate nothing
#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <memory>
#include <thread>
#include <vector>

#include "cypherdj/cypher_bk_ffi.h"
#include "cypherdj/generator.h"
#include "cypherdj/graph_factory.h"
#include "check.h"
#include "alloc_intercept.h"   // last: replaces malloc and relatives

namespace {

constexpr int N = 256;
constexpr int64_t SPB = 22500;  // 128 BPM at 48 kHz
constexpr int ERZ2 = 5;         // mixer channel of erz/2
// saw x gate x velocity
const char* GV = R"({"format":"baukasten/2","name":"t","stimmen":4,"knoten":[{"id":"n","art":"note"},{"id":"s","art":"saege"},{"id":"v","art":"mul"},{"id":"w","art":"mul"},{"id":"o","art":"ausgang"}],"kanten":[{"von":"n.hz","nach":"s.hz"},{"von":"s.aus","nach":"v.a"},{"von":"n.gate","nach":"v.b"},{"von":"v.aus","nach":"w.a"},{"von":"n.vel","nach":"w.b"},{"von":"w.aus","nach":"o.x"}]})";

CypherBk* neu() {
  char f[256] = {};
  CypherBk* h = cypher_bk_neu(GV, 48000.0, f, sizeof f);
  PRUEF(h != nullptr);
  return h;
}

struct Taste { int64_t smp; int note; int vel; bool an; };
struct Msg { int64_t t; int port; uint8_t b0, b1, b2; };

struct Welt {
  cdj::Karte karte{128.0, 0};
  std::unique_ptr<cdj::GraphWerk> werk;
  cdj::Erzeuger erz;
  std::vector<float> pl = std::vector<float>(cdj::MIX_KANAELE * N), pr = pl;
  float* l[cdj::MIX_KANAELE];
  float* r[cdj::MIX_KANAELE];
  cdj::MidiAus midi[cdj::ERZ_MIDI_PORTS];
  std::vector<float> aus;
  std::vector<Msg> msgs;
  std::vector<Taste> plan;
  size_t naechste = 0;
  int64_t s = 0;
  bool schlaf = false;
  explicit Welt(int faeden = -1) {
    for (int k = 0; k < cdj::MIX_KANAELE; ++k) { l[k] = &pl[k * N]; r[k] = &pr[k * N]; }
    if (faeden >= 0) {
      werk = cdj::graph_werk_neu({faeden});
      erz.setze_graph_werk(werk.get());
      schlaf = faeden > 0;
    }
  }
  // the kern pushes the keys of a cycle at its start: here every key whose stamp lies in the block
  void bis(int64_t ende) {
    while (s < ende) {
      while (naechste < plan.size() && plan[naechste].smp < s + N) {
        const Taste& t = plan[naechste++];
        erz.taste(t.note, t.vel, t.an, std::max(t.smp, s));
      }
      std::fill(pl.begin(), pl.end(), 0.0f);
      std::fill(pr.begin(), pr.end(), 0.0f);
      for (auto& m : midi) m.leer();
      erz.block(karte, s, N, l, r, midi, s);
      aus.insert(aus.end(), l[ERZ2], l[ERZ2] + N);
      for (int p = 0; p < cdj::ERZ_MIDI_PORTS; ++p)
        for (int i = 0; i < midi[p].n; ++i) msgs.push_back({s + midi[p].ev[i].t, p + 1, midi[p].ev[i].b[0], midi[p].ev[i].b[1], midi[p].ev[i].b[2]});
      s += N;
      if (schlaf) std::this_thread::sleep_for(std::chrono::milliseconds(1));
    }
  }
  int zaehle(uint8_t st, uint8_t note, int port = 0) const {
    int n = 0;
    for (const auto& m : msgs) n += (m.b0 & 0xf0) == st && m.b1 == note && (!port || m.port == port);
    return n;
  }
  void frei() {
    erz.setze_bk(2, nullptr, ERZ2);
    bis(s + 6 * N);
    CypherBk* f[8];
    for (int nf; (nf = erz.bk_frei(f, 8)) > 0;)
      for (int i = 0; i < nf; ++i) cypher_bk_frei(f[i]);
  }
};

cdj::ErzFenster fenster(int strom, std::initializer_list<cdj::ErzEv> evs) {
  cdj::ErzFenster f{};
  f.strom = strom;
  f.sendung = 1;
  f.ab_beat = 0.0;
  f.bis_beat = 64.0;
  for (const auto& e : evs) f.ev[f.n++] = e;
  return f;
}

cdj::ErzEv ev(double beat, int note, float vel, double dauer) {
  cdj::ErzEv e{beat, note, 1, vel};
  e.dauer = dauer;
  return e;
}
double beat_bei(int64_t smp) { return static_cast<double>(smp) / static_cast<double>(SPB); }

int64_t erstes(const std::vector<float>& x) {
  for (size_t i = 0; i < x.size(); ++i) if (x[i] != 0.0f) return static_cast<int64_t>(i);
  return -1;
}

}  // namespace

int main() {
  const int64_t S1 = 3000, T1 = 8000, S2 = 9100, T2 = 11000, ENDE = 14000;
  {  // 1) graph without Werk: key == pattern event at the same samples, velocity included
    Welt k;
    k.erz.setze_bk(2, neu(), ERZ2);
    k.erz.tasten_ziel(2);
    k.plan = {{S1, 57, 100, true}, {T1, 57, 0, false}, {S2, 61, 50, true}, {T2, 61, 0, false}};
    k.bis(ENDE);
    Welt o;
    o.erz.setze_bk(2, neu(), ERZ2);
    o.erz.fenster(fenster(2, {ev(beat_bei(S1), 57, 100.0f / 127.0f, beat_bei(T1) - beat_bei(S1)), ev(beat_bei(S2), 61, 50.0f / 127.0f, beat_bei(T2) - beat_bei(S2))}), 0.0);
    o.bis(ENDE);
    std::printf("bk ohne Werk: erstes Sample %lld (Soll > %lld), Pegel %g\n", (long long)erstes(k.aus), (long long)S1, (double)*std::max_element(k.aus.begin(), k.aus.end()));
    PRUEF(erstes(k.aus) > S1 - 1 && erstes(k.aus) < S1 + 4);   // the saw is 0 on its first sample
    PRUEF(k.aus == o.aus);
    float a1 = 0, a2 = 0;
    for (int64_t i = S1; i < T1; ++i) a1 = std::max(a1, std::fabs(k.aus[i]));
    for (int64_t i = S2; i < T2; ++i) a2 = std::max(a2, std::fabs(k.aus[i]));
    PRUEF(a1 > 0.5f * (100.0f / 127.0f) && a2 > 0.0f && a2 < a1 && a1 <= 100.0f / 127.0f + 1e-3f);   // the velocity scales the level
    PRUEF(k.erz.tasten_offen() == 0);
    PRUEF(k.aus[T1 + 8] == 0.0f);
    k.frei();
    o.frei();
  }
  for (int faeden : {0, 2}) {  // 2) graph with Werk: from the start of the next block, as a late pattern event
    const int64_t on1 = (S1 / N + 1) * N, off1 = (T1 / N + 1) * N, on2 = (S2 / N + 1) * N, off2 = (T2 / N + 1) * N;
    Welt k(faeden);
    k.erz.setze_bk(2, neu(), ERZ2);
    k.erz.tasten_ziel(2);
    k.plan = {{S1, 57, 100, true}, {T1, 57, 0, false}, {S2, 61, 50, true}, {T2, 61, 0, false}};
    k.bis(ENDE);
    Welt o(faeden);
    o.erz.setze_bk(2, neu(), ERZ2);
    o.erz.fenster(fenster(2, {ev(beat_bei(on1), 57, 100.0f / 127.0f, beat_bei(off1) - beat_bei(on1)), ev(beat_bei(on2), 61, 50.0f / 127.0f, beat_bei(off2) - beat_bei(on2))}), 0.0);
    o.bis(ENDE);
    std::printf("bk mit Werk (%d Faeden): erstes Sample %lld (Soll %lld)\n", faeden, (long long)erstes(k.aus), (long long)on1);
    PRUEF(erstes(k.aus) >= on1 && erstes(k.aus) < on1 + 4);
    PRUEF(k.aus == o.aus);
    PRUEF(k.erz.tasten_offen() == 0 && k.erz.bk_stand().verloren == 0 && k.erz.bk_stand().verspaetet == 0);
    k.frei();
    o.frei();
  }
  {  // 3) host stream midi:1:3: on at the stamp, velocity, channel, off at the release; the lead of the pattern events is not applied
    Welt k;
    k.erz.setze_midi_vorhalt(512);
    k.erz.setze_midi(2, 1, 3);
    k.erz.setze_strom(2, nullptr, ERZ2);
    k.erz.tasten_ziel(2);
    k.plan = {{S1, 60, 90, true}, {T1, 60, 0, false}};
    k.bis(ENDE);
    PRUEF(k.msgs.size() == 2);
    if (k.msgs.size() == 2) {
      PRUEF(k.msgs[0].t == S1 && k.msgs[0].port == 1 && k.msgs[0].b0 == 0x92 && k.msgs[0].b1 == 60 && k.msgs[0].b2 == 90);
      PRUEF(k.msgs[1].t == T1 && k.msgs[1].port == 1 && k.msgs[1].b0 == 0x82 && k.msgs[1].b1 == 60 && k.msgs[1].b2 == 0);
    }
    PRUEF(k.erz.tasten_offen() == 0);
  }
  {  // 4a) host: target change closes the held key (per-note off at the start of the block), the pattern note on the same stream keeps its own off, no CC 123
    Welt k;
    k.erz.setze_midi(2, 1, 3);
    k.erz.setze_strom(2, nullptr, ERZ2);
    k.erz.tasten_ziel(2);
    k.erz.fenster(fenster(2, {ev(beat_bei(1000), 62, 1.0f, beat_bei(9000) - beat_bei(1000))}), 0.0);
    k.plan = {{S1, 60, 90, true}};
    k.bis(5000);
    PRUEF(k.erz.tasten_offen() == 1 && k.zaehle(0x80, 60) == 0);
    k.erz.tasten_ziel(0);
    const int64_t jetzt = k.s;
    k.bis(ENDE);
    PRUEF(k.erz.tasten_offen() == 0 && k.zaehle(0x80, 60) == 1);
    for (const auto& m : k.msgs) PRUEF((m.b0 & 0xf0) != 0xb0);
    for (const auto& m : k.msgs)
      if ((m.b0 & 0xf0) == 0x80 && m.b1 == 60) PRUEF(m.t == jetzt);
    PRUEF(k.zaehle(0x80, 62) == 1);   // the pattern note ended by its own off, not by the close
    for (const auto& m : k.msgs)
      if ((m.b0 & 0xf0) == 0x80 && m.b1 == 62) PRUEF(m.t >= 8000);
  }
  {  // 4b) host: a change of the MIDI target sends the off to the OLD port and channel; the same target again changes nothing
    Welt k;
    k.erz.setze_midi(2, 1, 3);
    k.erz.setze_strom(2, nullptr, ERZ2);
    k.erz.tasten_ziel(2);
    k.plan = {{S1, 60, 90, true}};
    k.bis(5000);
    k.erz.setze_midi(2, 1, 3);
    k.bis(k.s + 2 * N);
    PRUEF(k.erz.tasten_offen() == 1 && k.zaehle(0x80, 60) == 0);
    k.erz.setze_midi(2, 2, 5);
    k.bis(k.s + 2 * N);
    PRUEF(k.erz.tasten_offen() == 0 && k.zaehle(0x80, 60) == 1 && k.zaehle(0x80, 60, 1) == 1);
    for (const auto& m : k.msgs) if ((m.b0 & 0xf0) == 0x80) PRUEF(m.b0 == 0x82 && m.port == 1);
    k.plan = {{k.s + 10, 64, 70, true}};
    k.naechste = 0;
    k.bis(k.s + 4 * N);   // a new key goes to the new place
    PRUEF(k.zaehle(0x90, 64, 2) == 1 && k.msgs.back().b0 == 0x94);
  }
  {  // 4c) host: tasten_alle_aus (a midi_ein went away) closes and drops what has not been played
    Welt k;
    k.erz.setze_midi(2, 1, 3);
    k.erz.setze_strom(2, nullptr, ERZ2);
    k.erz.tasten_ziel(2);
    k.plan = {{S1, 60, 90, true}, {S1 + 2 * N, 67, 90, true}};
    k.bis(S1 + N);
    PRUEF(k.erz.tasten_offen() == 1);
    k.erz.taste(72, 80, true, k.s + 5);   // queued, not yet played
    k.erz.tasten_alle_aus();
    k.bis(k.s + 4 * N);
    PRUEF(k.erz.tasten_offen() == 1 && k.zaehle(0x90, 67) == 1);   // the plan entry 67 comes after the close and is played, 72 was dropped with the queue
    PRUEF(k.zaehle(0x80, 60) == 1 && k.zaehle(0x90, 72) == 0);
  }
  {  // 4d) graph: target change closes the held key (off at the start of the next block), graph change drops it with the instance
    Welt k;
    k.erz.setze_bk(2, neu(), ERZ2);
    k.erz.tasten_ziel(2);
    k.plan = {{S1, 57, 100, true}};
    k.bis(5000);
    PRUEF(k.erz.tasten_offen() == 1 && std::fabs(k.aus[4900]) > 0.0f);
    k.erz.tasten_ziel(0);
    k.bis(k.s + 2 * N);
    PRUEF(k.erz.tasten_offen() == 0);
    PRUEF(k.aus[k.aus.size() - 1] == 0.0f);   // gate 0: the graph is silent
    k.frei();
    Welt g;
    g.erz.setze_bk(2, neu(), ERZ2);
    g.erz.tasten_ziel(2);
    g.plan = {{S1, 57, 100, true}};
    g.bis(5000);
    PRUEF(g.erz.tasten_offen() == 1);
    g.erz.setze_bk(2, neu(), ERZ2);   // another instance: the keys of the old one are gone
    PRUEF(g.erz.tasten_offen() == 0);
    g.bis(g.s + 6 * N);
    g.frei();
  }
  {  // 5a) host, same pitch: a key held, a pattern note of the pitch ends: the pattern off is held back, the key release sends the off
    Welt k;
    k.erz.setze_midi(2, 1, 3);
    k.erz.setze_strom(2, nullptr, ERZ2);
    k.erz.tasten_ziel(2);
    k.erz.fenster(fenster(2, {ev(beat_bei(4096), 60, 1.0f, beat_bei(1500))}), 0.0);   // pattern note 4096 .. 5596
    k.plan = {{2048, 60, 90, true}, {9000, 60, 0, false}};
    k.bis(ENDE);
    // key on 2048; pattern on 4096 (retrigger: off, on); pattern off 5596 held back; key off 9000: four messages
    std::printf("same pitch, key first:");
    for (const auto& m : k.msgs) std::printf(" [%lld %02x]", (long long)m.t, m.b0);
    std::printf("\n");
    PRUEF(k.msgs.size() == 4);
    PRUEF(k.zaehle(0x90, 60) == 2 && k.zaehle(0x80, 60) == 2);
    bool ok = k.msgs.size() == 4;
    if (ok) {
      ok = k.msgs[0].t == 2048 && (k.msgs[0].b0 & 0xf0) == 0x90 && k.msgs[1].t == 4096 && (k.msgs[1].b0 & 0xf0) == 0x80 && k.msgs[2].t == 4096 &&
           (k.msgs[2].b0 & 0xf0) == 0x90 && k.msgs[3].t == 9000 && (k.msgs[3].b0 & 0xf0) == 0x80;
    }
    PRUEF(ok);
    for (const auto& m : k.msgs) PRUEF(!((m.b0 & 0xf0) == 0x80 && m.t > 5000 && m.t < 9000));   // nothing at the pattern off
    PRUEF(k.erz.tasten_offen() == 0);
  }
  {  // 5b) host, same pitch: a pattern note long, a key of the pitch pressed and released inside it: the release sends no off, the pattern off ends the note
    Welt k;
    k.erz.setze_midi(2, 1, 3);
    k.erz.setze_strom(2, nullptr, ERZ2);
    k.erz.tasten_ziel(2);
    k.erz.fenster(fenster(2, {ev(beat_bei(2048), 60, 1.0f, beat_bei(8000))}), 0.0);   // pattern note 2048 .. 10048
    k.plan = {{4096, 60, 90, true}, {6144, 60, 0, false}};
    k.bis(ENDE);
    std::printf("same pitch, pattern first:");
    for (const auto& m : k.msgs) std::printf(" [%lld %02x]", (long long)m.t, m.b0);
    std::printf("\n");
    PRUEF(k.zaehle(0x90, 60) == 2);   // the pattern on and the key on
    PRUEF(k.zaehle(0x80, 60) == 2);   // the retrigger at the key on and the pattern off; the key release sends none
    for (const auto& m : k.msgs) PRUEF(!((m.b0 & 0xf0) == 0x80 && m.t >= 6144 && m.t < 9000));
    PRUEF(k.erz.tasten_offen() == 0);
  }
  {  // 5c) graph, same pitch: the key's release leaves a scheduled pattern note alone, the pattern off does not cut a held key (bit-identical to the one-voice sink)
    const int64_t P0 = 2048, P1 = 6000, K0 = 4096, K1 = 9000;
    Welt k;
    k.erz.setze_bk(2, neu(), ERZ2);
    k.erz.tasten_ziel(2);
    k.erz.fenster(fenster(2, {ev(beat_bei(P0), 57, 1.0f, beat_bei(P1) - beat_bei(P0))}), 0.0);
    k.plan = {{K0, 57, 100, true}, {K1, 57, 0, false}};
    k.bis(ENDE);
    // the key retriggers at K0 (the pattern note had its off scheduled at P1, which is held back), the key release at K1 ends the note
    PRUEF(std::fabs(k.aus[P1 + 20]) > 0.0f);   // still sounding after the pattern off
    PRUEF(std::fabs(k.aus[K1 - 20]) > 0.0f);
    PRUEF(k.aus[K1 + 8] == 0.0f);
    PRUEF(k.erz.tasten_offen() == 0);
    k.frei();
  }
  {  // 6) a kit stream takes no keys; target 0 changes nothing
    cdj::Kit kit;
    kit.klang[57].frames = 1;
    kit.klang[57].daten = {1.0f, 1.0f};
    kit.n = 1;
    Welt k;
    k.erz.setze_strom(2, &kit, ERZ2);
    k.erz.tasten_ziel(2);
    k.plan = {{S1, 57, 100, true}, {T1, 57, 0, false}};
    k.bis(ENDE);
    PRUEF(erstes(k.aus) == -1 && k.erz.tasten_offen() == 0 && k.msgs.empty());
    Welt a, b;   // pattern run with and without keys offered to a stream that is not the target: bit-identical, nothing held
    a.erz.setze_midi(2, 1, 3);
    a.erz.setze_strom(2, nullptr, ERZ2);
    b.erz.setze_midi(2, 1, 3);
    b.erz.setze_strom(2, nullptr, ERZ2);
    for (Welt* w : {&a, &b}) w->erz.fenster(fenster(2, {ev(1.0, 60, 0.8f, 0.5), ev(1.5, 62, 0.8f, 0.25)}), 0.0);
    for (int i = 0; i < 100; ++i) b.erz.taste(60, 100, true, 0);   // target 0: ignored
    PRUEF(b.erz.tasten_offen() == 0);
    a.bis(3 * SPB);
    b.bis(3 * SPB);
    PRUEF(a.msgs.size() == b.msgs.size() && a.msgs.size() == 4);
    for (size_t i = 0; i < a.msgs.size() && i < b.msgs.size(); ++i) PRUEF(a.msgs[i].t == b.msgs[i].t && a.msgs[i].b0 == b.msgs[i].b0 && a.msgs[i].b1 == b.msgs[i].b1 && a.msgs[i].b2 == b.msgs[i].b2);
    // queue overflow: the Ons beyond it are counted, the offs are applied once the queue is empty
    Welt q;
    q.erz.setze_midi(2, 1, 3);
    q.erz.setze_strom(2, nullptr, ERZ2);
    q.erz.tasten_ziel(2);
    q.erz.taste(60, 100, true, 0);
    q.bis(2 * N);
    PRUEF(q.erz.tasten_offen() == 1);
    for (int i = 0; i < cdj::ERZ_TASTEN_EV; ++i) q.erz.taste(61, 0, false, q.s + 3);   // offs of a key not held: queued, silent
    q.erz.taste(60, 0, false, q.s + 3);   // queue is full: the off waits for the empty queue
    PRUEF(q.erz.tasten_verloren() == 0);
    q.erz.taste(62, 100, true, q.s + 3);   // an On beyond the full queue is counted
    PRUEF(q.erz.tasten_verloren() == 1);
    q.bis(q.s + 4 * N);
    PRUEF(q.zaehle(0x80, 60) == 1);
    PRUEF(q.erz.tasten_offen() == 0);
  }
  for (int faeden : {-1, 0, 2}) {  // 8) key on and off on the same offset (one cycle, or stale stamps): the voice must end (graph: off lands after its own on)
    for (int fall = 0; fall < 3; ++fall) {
      Welt k(faeden);
      k.erz.setze_bk(2, neu(), ERZ2);
      k.erz.tasten_ziel(2);
      k.bis(3 * N);
      const int64_t b = k.s;
      if (fall == 0) {   // the same stamp
        k.erz.taste(57, 100, true, b + 5);
        k.erz.taste(57, 0, false, b + 5);
      } else if (fall == 1) {   // two stamps in the past: both clamp to the start of the window
        k.erz.taste(57, 100, true, b - 700);
        k.erz.taste(57, 0, false, b - 600);
      } else {   // press, release, press again, all in one window, released later
        k.erz.taste(57, 100, true, b + 5);
        k.erz.taste(57, 0, false, b + 6);
        k.erz.taste(57, 100, true, b + 7);
      }
      k.bis(b + 4 * N);
      if (fall == 2) {
        PRUEF(k.erz.tasten_offen() == 1);
        k.erz.taste(57, 0, false, k.s + 10);
        k.bis(k.s + 4 * N);
      }
      PRUEF(k.erz.tasten_offen() == 0);
      float rest = 0.0f;   // level (not the table): nothing is left sounding 2 blocks later
      for (size_t i = k.aus.size() - 2 * N; i < k.aus.size(); ++i) rest = std::max(rest, std::fabs(k.aus[i]));
      std::printf("same offset (%d threads, case %d): level at the end %g\n", faeden, fall, (double)rest);
      PRUEF(rest == 0.0f);
      k.frei();
    }
  }
  {  // 9) pile-up: the keys wait in the queue while a Werk block is late; they come in one window, the voice still ends
    Welt k(2);
    k.erz.setze_bk(2, neu(), ERZ2);
    k.erz.tasten_ziel(2);
    k.bis(3 * N);
    for (int i = 0; i < 20; ++i) {   // 20 quick presses of two pitches, every release before the next window
      k.erz.taste(57 + i % 2, 100, true, k.s + 3 * i);
      k.erz.taste(57 + i % 2, 0, false, k.s + 3 * i + 1);
    }
    k.bis(k.s + 6 * N);
    PRUEF(k.erz.tasten_offen() == 0);
    float rest = 0.0f;
    for (size_t i = k.aus.size() - 2 * N; i < k.aus.size(); ++i) rest = std::max(rest, std::fabs(k.aus[i]));
    PRUEF(rest == 0.0f);
    k.frei();
  }
  {  // 10) tasten_midi_zu with a full buffer keeps the keys it could not write and retries in the next cycle
    Welt k;
    k.erz.setze_midi(2, 1, 3);
    k.erz.setze_strom(2, nullptr, ERZ2);
    k.erz.tasten_ziel(2);
    for (int n = 60; n < 63; ++n) k.erz.taste(n, 100, true, k.s + 5);
    k.bis(2 * N);
    PRUEF(k.erz.tasten_offen() == 3);
    k.erz.tasten_ziel(0);
    for (auto& m : k.midi) m.leer();
    k.midi[0].n = cdj::ERZ_MIDI_EV - 1;   // room for one message
    k.erz.block(k.karte, k.s, N, k.l, k.r, k.midi, k.s);
    PRUEF(k.midi[0].n == cdj::ERZ_MIDI_EV && k.erz.tasten_offen() == 2);
    k.s += N;
    k.bis(k.s + 2 * N);   // the next cycle writes the rest
    PRUEF(k.erz.tasten_offen() == 0 && k.zaehle(0x80, 60) + k.zaehle(0x80, 61) + k.zaehle(0x80, 62) == 2);
  }
  {  // 11) an off waiting for room must not close a key pressed again meanwhile (the new press retriggers)
    Welt k;
    k.erz.setze_midi(2, 1, 3);
    k.erz.setze_strom(2, nullptr, ERZ2);
    k.erz.tasten_ziel(2);
    k.erz.taste(60, 100, true, k.s + 5);
    k.bis(2 * N);
    PRUEF(k.erz.tasten_offen() == 1);
    for (int i = 0; i < cdj::ERZ_TASTEN_EV - 1; ++i) k.erz.taste(61, 0, false, k.s + 3);   // silent fillers: queue one short of full
    k.erz.taste(61, 0, false, k.s + 3 * N);                                                   // the last filler waits for a later window: the queue stays full
    k.erz.taste(60, 0, false, k.s + 5);   // queue full: the off waits as a bit
    k.bis(k.s + N);                        // the fillers of this window leave, one entry stays
    k.erz.taste(60, 100, true, k.s + 10);  // pressed again
    k.bis(k.s + 6 * N);
    PRUEF(k.erz.tasten_offen() == 1);      // still held: the old off did not cancel the new press
    PRUEF(k.zaehle(0x90, 60) == 2 && k.zaehle(0x80, 60) == 1);   // the second on retriggered once
  }
  {  // 7) allocation guard
    Welt k;
    k.erz.setze_midi(2, 1, 3);
    k.erz.setze_strom(2, nullptr, ERZ2);
    k.erz.setze_bk(3, neu(), ERZ2 + 1);
    abfang_an();
    for (int i = 0; i < 40; ++i) {
      k.erz.tasten_ziel(i % 2 ? 2 : 3);
      k.erz.taste(60 + i % 5, 100, true, k.s + 10);
      k.erz.taste(60 + i % 5, 0, false, k.s + 100);
      for (auto& m : k.midi) m.leer();
      k.erz.block(k.karte, k.s, N, k.l, k.r, k.midi, k.s);
      k.s += N;
    }
    k.erz.tasten_alle_aus();
    const long allok = abfang_aus();
    PRUEF(!ALLOC_ABFANG_VERFUEGBAR || allok == 0);
    k.erz.setze_bk(3, nullptr, ERZ2 + 1);
    k.bis(k.s + 6 * N);
    CypherBk* f[8];
    for (int nf; (nf = k.erz.bk_frei(f, 8)) > 0;)
      for (int i = 0; i < nf; ++i) cypher_bk_frei(f[i]);
  }
  PRUEF_ENDE();
}
