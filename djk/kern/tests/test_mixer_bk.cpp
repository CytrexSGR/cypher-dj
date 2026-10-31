// Baukasten S3c Task 4: Effekt-Graph im Kanalzug von deck/1..4 (Plan 2026-10-29-baukasten-s3c-effekt.md, D3, D4).
// Gelesen wird master_summe_l()/r() (vor master/pegel und Limiter). Signal: 1-kHz-Sinus 0,5 auf deck/1 (Index 0).
//  (a) ohne Graph bitgleich zu einem Mixer, der nie einen Graphen hatte; nach Entfernen und Blende wieder bitgleich
//  (b) Durchreich-Graph: nach der Blende bitgleich zu ohne Graph (der Split-Weg ist bitgleich, test_kanalzug_teilung)
//  (c) Halbierer-Graph: nach der Blende halbe Spitze (±0,05 dB); in der Blende kein Sprung > 0,07 zwischen Samples (Steigung des Sinus ≈ 0,065)
//  (d) Wechsel Halbierer → Durchreich: der alte Graph steht nach der Blende in bk_frei, vorher nicht
//  (e) Wechsel während der Blende: der älteste Graph wird sofort frei, der mittlere nach der Blende
//  (f) Graph auf Index 4 (erz/1): sofort in bk_frei, Kanal unberührt
//  (g) übersteuernder Graph (×100): Kanal auf ±8 geklemmt
//  (h) Allokationsfrei: Blöcke mit Graph und Blende allokieren nicht (alloc_abfang.h)
//  (i) Takt kommt an: ein LFO-Graph mit takt hört um einen halben Beat versetzt anders, ohne Versatz bitgleich
//  (j) zwei Wechsel vor demselben Block: der ungehörte geht sofort frei, der gehörte blendet weiter aus
//      (bitgleich zu einem einzelnen Wechsel); zurück auf den gehörten Graphen beendet die Blende
//  (k) Ablage: neun Freigaben ohne Abholen -> acht in bk_frei, eine verloren; gleicher Zeiger ändert nichts
//  (l) Hörprobe Effektwechsel auf deck/1, nur unter CYPHERDJ_BK_FX_WAV_EIN/_AUS (_TROCKEN: dieselbe Spur ohne Graph)
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <iterator>
#include <memory>
#include <string>
#include <vector>

#include "cypherdj/cypher_bk_ffi.h"
#include "cypherdj/mixer.h"
#include "pruef.h"
#include "alloc_abfang.h"   // zuletzt: ersetzt malloc und Verwandte (wie test_erzeuger_bk.cpp:17)

namespace sw = cypherdj::stellwerk;

constexpr int N = 256;
constexpr double PI = 3.14159265358979323846;

static CypherBk* graph(const char* json) {
  char f[256] = {};
  CypherBk* g = cypher_bk_neu(json, 48000.0, f, sizeof f);
  if (!g) std::fprintf(stderr, "Graph: %s\n", f);
  PRUEF(g != nullptr);
  return g;
}
static const char* DURCH =
    R"({"format":"baukasten/2","name":"durch","stimmen":1,"knoten":[{"id":"e","art":"eingang"},{"id":"o","art":"ausgang"}],"kanten":[{"von":"e.l","nach":"o.l"},{"von":"e.r","nach":"o.r"}]})";
static const char* HALB =
    R"({"format":"baukasten/2","name":"halb","stimmen":1,"knoten":[{"id":"e","art":"eingang"},{"id":"a","art":"mul","b":0.5},{"id":"b","art":"mul","b":0.5},{"id":"o","art":"ausgang"}],"kanten":[{"von":"e.l","nach":"a.a"},{"von":"e.r","nach":"b.a"},{"von":"a.aus","nach":"o.l"},{"von":"b.aus","nach":"o.r"}]})";
// Tremolo im Takt: Eingang mal LFO (Rechteck nicht nötig, Sinus genügt), Phase aus dem Beat
static const char* TAKT =
    R"({"format":"baukasten/2","name":"takt","stimmen":1,"knoten":[{"id":"e","art":"eingang"},{"id":"w","art":"lfo","form":0,"takt":1},{"id":"a","art":"mul"},{"id":"b","art":"mul"},{"id":"o","art":"ausgang"}],"kanten":[{"von":"e.l","nach":"a.a"},{"von":"e.r","nach":"b.a"},{"von":"w.aus","nach":"a.b"},{"von":"w.aus","nach":"b.b"},{"von":"a.aus","nach":"o.l"},{"von":"b.aus","nach":"o.r"}]})";
// Übersteuert endlich (0,5 · 100 = 50): nicht endliche Werte fängt schon der Rust-Wächter (Ausgang 0), die Klemme ±8
// im Mixer sieht nur dieser Fall
static const char* GROSS =
    R"({"format":"baukasten/2","name":"gross","stimmen":1,"knoten":[{"id":"e","art":"eingang"},{"id":"a","art":"mul","b":100},{"id":"b","art":"mul","b":100},{"id":"o","art":"ausgang"}],"kanten":[{"von":"e.l","nach":"a.a"},{"von":"e.r","nach":"b.a"},{"von":"a.aus","nach":"o.l"},{"von":"b.aus","nach":"o.r"}]})";

struct Lauf {
  sw::ReglerTabelle tab;
  std::unique_ptr<cdj::Mixer> m;
  float ml[N], mr[N], cl[N], cr[N];
  long t = 0;
  double beat_versatz = 0.0;
  Lauf() : m(std::make_unique<cdj::Mixer>(tab)) { setze("deck/1/fader", 0.0f); }
  void setze(const char* pfad, float w) {
    const int r = tab.suche(pfad);
    PRUEF(r >= 0);
    m->setze_sofort(r, w);
  }
  const float* block() {
    for (int i = 0; i < N; ++i) {
      const float x = static_cast<float>(0.5 * std::sin(2.0 * PI * 1000.0 * (t + i) / 48000.0));
      m->eingang_l(0)[i] = x;
      m->eingang_r(0)[i] = x;
    }
    t += N;
    m->fx_takt(t / 22500.0 + beat_versatz, 128.0 / 60.0 / 48000.0);
    m->verarbeite(N, ml, mr, cl, cr);
    return m->master_summe_l();
  }
  int frei(CypherBk** aus) { return m->bk_frei(aus, 8); }
};

static float spitze(const float* x) {
  float p = 0.0f;
  for (int i = 0; i < N; ++i) p = std::fmax(p, std::fabs(x[i]));
  return p;
}

int main() {
  // (a) + (b)
  {
    Lauf a, b;
    int anders_ohne = 0, anders_durch = 0;
    for (int k = 0; k < 40; ++k) {
      if (k == 10) b.m->setze_kanal_graph(0, graph(DURCH));
      if (k == 25) b.m->setze_kanal_graph(0, nullptr);
      const float* x = a.block();
      const float* y = b.block();
      const bool gleich = std::memcmp(x, y, sizeof(float) * N) == 0;
      if (k < 10 || k >= 28) anders_ohne += !gleich;
      if (k >= 13 && k < 25) anders_durch += !gleich;
    }
    PRUEF(anders_ohne == 0);
    PRUEF(anders_durch == 0);
    CypherBk* f[8] = {};
    PRUEF(b.frei(f) == 1);
    cypher_bk_frei(f[0]); f[0] = nullptr;
  }
  // (c) Halbierer: Spitze nach der Blende halb, Blende ohne Sprung
  {
    Lauf b;
    float vor = 0.0f, nach = 0.0f, letzter = 0.0f, sprung = 0.0f;
    for (int k = 0; k < 20; ++k) {
      if (k == 10) b.m->setze_kanal_graph(0, graph(HALB));
      const float* x = b.block();
      if (k == 9) vor = spitze(x);
      if (k == 15) nach = spitze(x);
      for (int i = 0; i < N; ++i) {
        if (k >= 9 && k <= 13) sprung = std::fmax(sprung, std::fabs(x[i] - letzter));
        letzter = x[i];
      }
    }
    PRUEF(std::fabs(20.0 * std::log10(nach / vor) + 6.0206) < 0.05);
    // 1 kHz bei 0,5: größte Steigung je Sample ≈ 0,5·2π·1000/48000 ≈ 0,065; die Blende darf sie kaum erhöhen
    PRUEF(sprung < 0.07f);
  }
  // (d) Wechsel: alter Graph erst nach der Blende frei
  {
    Lauf b;
    b.m->setze_kanal_graph(0, graph(HALB));
    for (int k = 0; k < 5; ++k) b.block();
    CypherBk* f[8] = {};
    PRUEF(b.frei(f) == 0);
    b.m->setze_kanal_graph(0, graph(DURCH));
    b.block();   // 256 von 480 Samples Blende
    PRUEF(b.frei(f) == 0);
    b.block();   // Blende fertig
    PRUEF(b.frei(f) == 1);
    cypher_bk_frei(f[0]); f[0] = nullptr;
  }
  // (e) Wechsel in der Blende: der älteste sofort frei
  {
    Lauf b;
    b.m->setze_kanal_graph(0, graph(HALB));
    b.block(); b.block();
    b.m->setze_kanal_graph(0, graph(DURCH));   // HALB blendet aus
    b.block();
    b.m->setze_kanal_graph(0, graph(HALB));    // HALB(alt) sofort frei, DURCH blendet aus
    CypherBk* f[8] = {};
    PRUEF(b.frei(f) == 1);
    cypher_bk_frei(f[0]); f[0] = nullptr;
    b.block(); b.block();
    PRUEF(b.frei(f) == 1);
    cypher_bk_frei(f[0]); f[0] = nullptr;
  }
  // (f) Kanal außerhalb deck/1..4
  {
    Lauf b;
    b.m->setze_kanal_graph(4, graph(DURCH));
    CypherBk* f[8] = {};
    PRUEF(b.frei(f) == 1);
    cypher_bk_frei(f[0]); f[0] = nullptr;
  }
  // (g) übersteuernder Graph: Kanal auf ±8 geklemmt (Fader 0 dB, also Master höchstens 8)
  {
    Lauf b;
    b.m->setze_kanal_graph(0, graph(GROSS));
    float p = 0.0f;
    for (int k = 0; k < 6; ++k) {
      const float* x = b.block();
      if (k >= 2) p = std::fmax(p, spitze(x));
    }
    PRUEF(p > 7.9f && p <= 8.0f * 1.0001f);   // Positivkontrolle: übersteuert wirklich, und die Klemme greift
  }
  // (h) allokationsfrei mit Graph, Wechsel und Blende
  {
    Lauf b;
    CypherBk* g1 = graph(HALB);
    CypherBk* g2 = graph(DURCH);
    b.m->setze_kanal_graph(0, g1);
    b.block();
    abfang_an();   // Positivkontrolle: der Wächter sieht Allokationen aus dem Rust-Teil
    CypherBk* probe = graph(DURCH);
    const long pos = abfang_aus();
    cypher_bk_frei(probe);
    PRUEF(!ALLOC_ABFANG_VERFUEGBAR || pos > 0);
    abfang_an();
    b.m->setze_kanal_graph(0, g2);
    for (int k = 0; k < 10; ++k) b.block();
    const AbfangZahlen az = abfang_zahlen();
    abfang_aus();
    PRUEF(!ALLOC_ABFANG_VERFUEGBAR || az.summe() == 0);   // Allokation, free, Sperren, Schlafen
  }
  // (i) Takt: gleicher Beat bitgleich, halber Beat versetzt deutlich anders
  {
    Lauf a, b, c;
    c.beat_versatz = 0.5;
    a.m->setze_kanal_graph(0, graph(TAKT));
    b.m->setze_kanal_graph(0, graph(TAKT));
    c.m->setze_kanal_graph(0, graph(TAKT));
    int anders_ab = 0;
    float diff_ac = 0.0f;
    for (int k = 0; k < 60; ++k) {
      const float* x = a.block();
      const float* y = b.block();
      const float* z = c.block();
      anders_ab += std::memcmp(x, y, sizeof(float) * N) != 0;
      for (int i = 0; i < N; ++i) diff_ac = std::fmax(diff_ac, std::fabs(x[i] - z[i]));
    }
    PRUEF(anders_ab == 0);
    PRUEF(diff_ac > 0.1f);   // ohne Takt rechneten a und c denselben freilaufenden LFO und wären gleich
  }
  // (j) zwei Wechsel vor demselben Block
  {
    Lauf ein, zwei;
    ein.m->setze_kanal_graph(0, graph(HALB));
    zwei.m->setze_kanal_graph(0, graph(HALB));
    for (int k = 0; k < 4; ++k) { ein.block(); zwei.block(); }
    ein.m->setze_kanal_graph(0, graph(DURCH));
    zwei.m->setze_kanal_graph(0, graph(GROSS));   // ungehört, wird sofort ersetzt
    zwei.m->setze_kanal_graph(0, graph(DURCH));
    CypherBk* f[8] = {};
    PRUEF(zwei.frei(f) == 1);                     // GROSS sofort frei
    cypher_bk_frei(f[0]); f[0] = nullptr;
    int anders = 0;
    for (int k = 0; k < 4; ++k) anders += std::memcmp(ein.block(), zwei.block(), sizeof(float) * N) != 0;
    PRUEF(anders == 0);
    PRUEF(zwei.frei(f) == 1);                     // HALB nach der Blende
    cypher_bk_frei(f[0]); f[0] = nullptr;
    PRUEF(ein.frei(f) == 1);
    cypher_bk_frei(f[0]); f[0] = nullptr;
#ifndef CYPHERDJ_MUTATION_BK_KANAL_DOPPEL_ALT   // alter Weg: h ginge in die Freigabe und liefe weiter (use-after-free, gemessen SegFault)
    // zurück auf den gehörten: HALB läuft, DURCH gesetzt und vor dem Block wieder HALB -> keine Blende, bitgleich
    Lauf r, s2;
    CypherBk* h = graph(HALB);
    r.m->setze_kanal_graph(0, graph(HALB));
    s2.m->setze_kanal_graph(0, h);
    for (int k = 0; k < 4; ++k) { r.block(); s2.block(); }
    s2.m->setze_kanal_graph(0, graph(DURCH));
    s2.m->setze_kanal_graph(0, h);
    PRUEF(s2.frei(f) == 1);                       // DURCH frei, h bleibt
    cypher_bk_frei(f[0]); f[0] = nullptr;
    anders = 0;
    for (int k = 0; k < 4; ++k) anders += std::memcmp(r.block(), s2.block(), sizeof(float) * N) != 0;
    PRUEF(anders == 0);
    PRUEF(s2.frei(f) == 0);
#endif
  }
  // (k) Ablage-Überlauf und gleicher Zeiger
  {
    Lauf b;
    CypherBk* g[9];
    for (int i = 0; i < 9; ++i) { g[i] = graph(DURCH); b.m->setze_kanal_graph(4, g[i]); }
    CypherBk* f[8] = {};
    PRUEF(b.frei(f) == 8);
    PRUEF(b.m->bk_verloren() == 1);
    for (int i = 0; i < 8; ++i) cypher_bk_frei(f[i]);
    cypher_bk_frei(g[8]);   // der verlorene; im Betrieb ein Leck, hier vom Test aufgeräumt
    CypherBk* d = graph(DURCH);
    b.m->setze_kanal_graph(0, d);
    b.block(); b.block();
    b.m->setze_kanal_graph(0, d);
    b.block();
    PRUEF(b.frei(f) == 0);
  }
  // (l) Hörprobe (Task 7), nur mit CYPHERDJ_BK_FX_WAV_EIN/_AUS: 48-kHz-Stereo-WAV (16 bit oder 32-bit float) auf
  //     deck/1, 128 BPM ab Beat 0; 0 s ohne Graph, 4 s fx-echo-achtel, 12 s fx-filter-wobble, 20 s ohne, Ende 24 s
  const char* wav_ein = std::getenv("CYPHERDJ_BK_FX_WAV_EIN");
  const char* wav_aus = std::getenv("CYPHERDJ_BK_FX_WAV_AUS");
  if (wav_ein && wav_aus) {
    std::ifstream f(wav_ein, std::ios::binary);
    std::vector<char> roh((std::istreambuf_iterator<char>(f)), std::istreambuf_iterator<char>());
    PRUEF(roh.size() > 44 && std::memcmp(roh.data(), "RIFF", 4) == 0 && std::memcmp(roh.data() + 8, "WAVE", 4) == 0);
    auto u16 = [&](size_t o) { uint16_t v; std::memcpy(&v, roh.data() + o, 2); return v; };
    auto u32 = [&](size_t o) { uint32_t v; std::memcpy(&v, roh.data() + o, 4); return v; };
    int format = 0, kanaele = 0, bits = 0;
    size_t daten = 0, laenge = 0;
    for (size_t o = 12; o + 8 <= roh.size(); o += 8 + ((u32(o + 4) + 1) & ~1u)) {
      if (std::memcmp(roh.data() + o, "fmt ", 4) == 0) { format = u16(o + 8); kanaele = u16(o + 10); bits = u16(o + 22); PRUEF(u32(o + 12) == 48000); }
      if (std::memcmp(roh.data() + o, "data", 4) == 0) { daten = o + 8; laenge = std::min<size_t>(u32(o + 4), roh.size() - daten); break; }
    }
    PRUEF(kanaele == 2 && daten > 0 && ((format == 1 && bits == 16) || (format == 3 && bits == 32)));
    const size_t frames = laenge / (bits / 8 * 2);
    auto probe = [&](size_t i, int c) -> float {
      const char* p = roh.data() + daten + (i * 2 + c) * (bits / 8);
      if (bits == 16) { int16_t v; std::memcpy(&v, p, 2); return v / 32768.0f; }
      float v; std::memcpy(&v, p, 4); return v;
    };
    auto lies = [](const char* name) {
      std::ifstream j(std::string(CYPHERDJ_DJK "/instrumente/baukasten_dsp/beispiele/") + name);
      return std::string((std::istreambuf_iterator<char>(j)), std::istreambuf_iterator<char>());
    };
    const std::string echo = lies("fx-echo-achtel.json"), wobble = lies("fx-filter-wobble.json");
    constexpr long ENDE = 24L * 48000;
    PRUEF(frames >= (size_t)ENDE);
    // mit = false: derselbe Mixer ohne Graph, die Vergleichsspur (der Kanalzug ist auch ohne Graph nicht neutral)
    auto spiele = [&](bool mit) {
      Lauf l;
      std::vector<float> aus;
      aus.reserve(ENDE * 2);
      for (long s = 0; s < ENDE; s += N) {
        if (mit && s == 4L * 48000) l.m->setze_kanal_graph(0, graph(echo.c_str()));
        if (mit && s == 12L * 48000) l.m->setze_kanal_graph(0, graph(wobble.c_str()));
        if (mit && s == 20L * 48000) l.m->setze_kanal_graph(0, nullptr);
        CypherBk* fr[8];
        for (int nf = l.frei(fr), i = 0; i < nf; ++i) cypher_bk_frei(fr[i]);
        for (int i = 0; i < N; ++i) { l.m->eingang_l(0)[i] = probe(s + i, 0); l.m->eingang_r(0)[i] = probe(s + i, 1); }
        l.m->fx_takt(s / 22500.0, 128.0 / 60.0 / 48000.0);
        l.m->verarbeite(N, l.ml, l.mr, l.cl, l.cr);
        for (int i = 0; i < N; ++i) { aus.push_back(l.m->master_summe_l()[i]); aus.push_back(l.m->master_summe_r()[i]); }
      }
      return aus;
    };
    auto schreibe = [](const char* pfad, const std::vector<float>& aus) {
      std::ofstream o(pfad, std::ios::binary);
      auto w32 = [&](uint32_t v) { o.write(reinterpret_cast<const char*>(&v), 4); };
      auto w16 = [&](uint16_t v) { o.write(reinterpret_cast<const char*>(&v), 2); };
      const uint32_t bytes = aus.size() * 4;
      o.write("RIFF", 4); w32(36 + bytes); o.write("WAVEfmt ", 8); w32(16); w16(3); w16(2); w32(48000); w32(48000 * 8); w16(8); w16(32);
      o.write("data", 4); w32(bytes); o.write(reinterpret_cast<const char*>(aus.data()), bytes);
      PRUEF(o.good());
      std::fprintf(stderr, "Hörprobe: %s (%zu Frames)\n", pfad, aus.size() / 2);
    };
    schreibe(wav_aus, spiele(true));
    if (const char* wav_trocken = std::getenv("CYPHERDJ_BK_FX_WAV_TROCKEN")) schreibe(wav_trocken, spiele(false));
  }
  PRUEF_ENDE();
}
