// Baukasten S3b Task 2: der Erzeuger mit Graph-Werk (ein Block Vorlauf) gegen S3a im Callback, mit echtem Graphen.
// 1) Ohne Wechsel ist der Kanalpuffer bitgleich: ohne Werk, Werk mit 0 Fäden (synchron) und mit 2 Fäden (1 ms Schlaf
//    zwischen den Blöcken, damit die Fäden rechnen statt dass der Callback stiehlt).
// 2) Wechsel G1 -> G2 im Block T: G1 spielt T mit der Ausklang-Rampe ab 0 (gegen eine Referenzrechnung), G2 klingt ab T+1,
//    kein Sprung am Blockrand, G1 kommt über bk_frei() zurück. Fehlerfall CYPHERDJ_MUTATION_BK_WERK_RAMPE_SPAET.
// 3) Unter dem Allokationswächter allokiert block() mit Werk (2 Fäden) nicht.
#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <sstream>
#include <memory>
#include <thread>
#include <vector>

#include "cypherdj/cypher_bk_ffi.h"
#include "cypherdj/erzeuger.h"
#include "cypherdj/graph_werk.h"
#include "pruef.h"
#include "alloc_abfang.h"   // zuletzt: ersetzt malloc und Verwandte (wie test_erzeuger_bk.cpp)

namespace {

constexpr int N = 256;
constexpr int64_t SPB = 22500;  // 128 BPM bei 48 kHz
constexpr int ERZ2 = 5, ERZ3 = 6;
const char* G = R"({"format":"baukasten/2","name":"t","stimmen":2,"knoten":[{"id":"n","art":"note"},{"id":"s","art":"saege"},{"id":"v","art":"mul"},{"id":"o","art":"ausgang"}],"kanten":[{"von":"n.hz","nach":"s.hz"},{"von":"s.aus","nach":"v.a"},{"von":"n.gate","nach":"v.b"},{"von":"v.aus","nach":"o.x"}]})";
const char* GA = R"({"format":"baukasten/2","name":"t","stimmen":2,"knoten":[{"id":"n","art":"note"},{"id":"s","art":"saege"},{"id":"e","art":"adsr","a":0.001,"d":0.1,"s":1,"r":1.0},{"id":"v","art":"mul"},{"id":"o","art":"ausgang"}],"kanten":[{"von":"n.hz","nach":"s.hz"},{"von":"n.gate","nach":"e.gate"},{"von":"s.aus","nach":"v.a"},{"von":"e.aus","nach":"v.b"},{"von":"v.aus","nach":"o.x"}]})";

CypherBk* neu(const char* json) {
  char f[256] = {};
  CypherBk* h = cypher_bk_neu(json, 48000.0, f, sizeof f);
  PRUEF(h != nullptr);
  return h;
}

// faeden < 0: ohne Werk (S3a). schlaf: 1 ms nach jedem Block (die Fäden rechnen den Vorlauf).
struct Welt {
  cdj::Karte karte{128.0, 0};
  std::unique_ptr<cdj::GraphWerk> werk;
  cdj::Erzeuger erz;
  std::vector<float> pl = std::vector<float>(cdj::MIX_KANAELE * N), pr = pl;
  float* l[cdj::MIX_KANAELE];
  float* r[cdj::MIX_KANAELE];
  std::vector<float> erz2, erz2r, erz3;
  int64_t s = 0;
  bool schlaf = false;
  int bn = N;          // Blockgröße (Fall 2b: 128, kleiner als ERZ_AUSKLANG)
  bool takt = false;   // Fall 3: 1 ms aktiv warten statt schlafen (der Wächter zählt Schlafen, nicht Rechnen)
  explicit Welt(int faeden) {
    for (int k = 0; k < cdj::MIX_KANAELE; ++k) { l[k] = &pl[k * N]; r[k] = &pr[k * N]; }
    if (faeden >= 0) {
      werk = cdj::graph_werk_neu({faeden});
      erz.setze_graph_werk(werk.get());
      schlaf = faeden > 0;
    }
  }
  void bis(int64_t ende) {
    while (s < ende) {
      std::fill(pl.begin(), pl.end(), 0.0f);
      std::fill(pr.begin(), pr.end(), 0.0f);
      erz.block(karte, s, bn, l, r, nullptr, s);
      erz2.insert(erz2.end(), l[ERZ2], l[ERZ2] + bn);
      erz2r.insert(erz2r.end(), r[ERZ2], r[ERZ2] + bn);
      erz3.insert(erz3.end(), l[ERZ3], l[ERZ3] + bn);
      s += bn;
      if (schlaf) std::this_thread::sleep_for(std::chrono::milliseconds(1));
      if (takt)
        for (auto t0 = std::chrono::steady_clock::now(); std::chrono::steady_clock::now() - t0 < std::chrono::milliseconds(1);) {
        }
    }
  }
  int raeumen() {  // Graph ab, ausklingen lassen, alles freigeben; Rückgabe: Anzahl freigegebener Graphen
    for (int st = 1; st <= cdj::ERZ_STROEME; ++st) erz.setze_bk(st, nullptr, ERZ2);
    bis(s + 4 * N);   // bei bn = 128: 512 Samples, reicht für zwei Blöcke Ausklang
    CypherBk* f[8];
    int ges = 0;
    for (int nf; (nf = erz.bk_frei(f, 8)) > 0; ges += nf)
      for (int i = 0; i < nf; ++i) cypher_bk_frei(f[i]);
    return ges;
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

// Szenario 1: Noten am Sample (auch mitten im Block), Off nach dauer, eine Note doppelt (aus vor an), Hüllkurven-Graph auf
// Strom 2, dazu ein Kit-Strom 3 auf demselben Kanal wie der Graph. Ton 49 schlägt bei Beat 0.5 wieder an, während sein
// erster Anschlag (Beat 0.37, dauer 0.5, Off bei 0.87) noch klingt: der Zweig "Note klingt noch" in bk_noten.
std::vector<float> szenario(int faeden, const cdj::Kit& kit, std::vector<float>* rechts) {
  Welt w(faeden);
  w.erz.setze_bk(2, neu(GA), ERZ2);
  w.erz.setze_strom(3, &kit, ERZ2);
  w.erz.fenster(fenster(2, {ev(0.0, 45, 0.8f, 1.0), ev(0.37, 49, 0.6f, 0.5), ev(0.5, 49, 0.8f, 0.5), ev(1.0, 52, 0.9f, 0.25), ev(1.1, 45, 0.7f, 2.0),
                            ev(2.0, 57, 1.0f, 3.0), ev(2.0, 61, 1.0f, 3.0)}), 0.0);
  w.erz.fenster(fenster(3, {ev(0.5, 57, 1.0f, 0.0), ev(1.75, 57, 0.5f, 0.0)}), 0.0);
  w.bis(6 * SPB);
  const auto st = w.erz.bk_stand();
  std::printf("szenario faeden=%d: verloren %u panik %u verspaetet %u\n", faeden, st.verloren, st.panik, st.verspaetet);
  PRUEF(st.verloren == 0 && st.panik == 0 && st.verspaetet == 0);
  if (w.werk) {
    const auto z = w.werk->zaehler();
    std::printf("MESS szenario faeden=%d: auftraege=%llu gestohlen=%llu anlauf=%llu verspaetet=%llu verworfen=%llu\n", faeden,
                (unsigned long long)z.auftraege, (unsigned long long)z.gestohlen, (unsigned long long)z.anlauf,
                (unsigned long long)z.verspaetet, (unsigned long long)z.verworfen);
    PRUEF(z.auftraege > 0 && z.anlauf == 1 && z.verspaetet == 0);   // genau ein Anlauf: der erste Block
  }
  PRUEF(w.raeumen() == 1);
  if (rechts) *rechts = w.erz2r;
  return w.erz2;
}

// Fall 2b: Wechsel G1 -> G2 bei Blockgröße bn < ERZ_AUSKLANG = 240: G1 klingt im Ausklang-Platz über mehrere Blöcke aus
// (bk_ausklang_werk). faeden < 0: Referenz ohne Werk (S3a). zweiter: ein dritter Graph kommt, solange G1 noch ausklingt
// (der Ausklang-Platz ist besetzt, der Wechsel wartet). Die Zeitpunkte des zweiten Wechsels sind in S3a und mit Werk nicht
// dieselben (das Werk gibt den Ausklang-Platz einen Block früher frei), deshalb vergleicht Fall 2b nur ohne ihn bitgleich.
struct Wechsel128 {
  std::vector<float> aus;
  int frei = 0;
  float ausklang = 0.0f, g3 = 0.0f;
  unsigned verspaetet = 0;
};
Wechsel128 wechsel128(int faeden, int bn, bool zweiter) {
  Welt w(faeden);
  w.bn = bn;
  w.erz.setze_bk(2, neu(G), ERZ2);
  w.erz.fenster(fenster(2, {ev(0.0, 57, 1.0f, 8.0), ev((double)(778) / (double)SPB, 64, 1.0f, 1.0),
                            ev((double)(1546) / (double)SPB, 60, 1.0f, 1.0)}), 0.0);
  w.bis(512);
  w.erz.setze_bk(2, neu(G), ERZ2);
  const size_t T = w.erz2.size();
  if (zweiter) {
    w.bis(w.s + 2 * bn);
    w.erz.setze_bk(2, neu(G), ERZ2);
  }
  w.bis(2816);
  Wechsel128 e;
  for (size_t i = T; i < T + 2 * (size_t)bn; ++i) e.ausklang = std::max(e.ausklang, std::abs(w.erz2[i]));
  for (size_t i = 1546 + 300; i < 1546 + 1000; ++i) e.g3 = std::max(e.g3, std::abs(w.erz2[i]));
  e.verspaetet = w.erz.bk_stand().verspaetet;
  e.frei = w.raeumen();
  CypherBk* f[8];
  for (int nf; (nf = w.erz.bk_frei(f, 8)) > 0; e.frei += nf)
    for (int i = 0; i < nf; ++i) cypher_bk_frei(f[i]);
  e.aus = w.erz2;
  return e;
}

}  // namespace

int main() {
  cdj::Kit kit;
  kit.klang[57].frames = 3;
  kit.klang[57].daten = {0.5f, 0.5f, 0.25f, 0.25f, 0.125f, 0.125f};
  kit.n = 1;

  {  // 1) bitgleich ohne Werk / Werk 0 Fäden / Werk 2 Fäden
    std::vector<float> r0, r1, r2;
    const std::vector<float> a = szenario(-1, kit, &r0), b = szenario(0, kit, &r1), c = szenario(2, kit, &r2);
    float spitze = 0.0f;
    for (float v : a) spitze = std::max(spitze, std::abs(v));
    const bool gleich_b = a.size() == b.size() && std::memcmp(a.data(), b.data(), a.size() * sizeof(float)) == 0 && r0 == r1;
    const bool gleich_c = a.size() == c.size() && std::memcmp(a.data(), c.data(), a.size() * sizeof(float)) == 0 && r0 == r2;
    std::printf("MESS bitgleich: %zu Samples, spitze=%.4f, faeden0=%s faeden2=%s\n", a.size(), spitze, gleich_b ? "gleich" : "UNGLEICH",
                gleich_c ? "gleich" : "UNGLEICH");
    PRUEF(spitze > 0.1f);   // Positivprobe: das Szenario klingt
    PRUEF(gleich_b);
    PRUEF(gleich_c);
  }
  for (int faeden : {0, 2}) {  // 2) Wechsel G1 -> G2 im Block T = 2
    Welt w(faeden);
    w.erz.setze_bk(2, neu(G), ERZ2);
    // G1: Note ab Sample 0, gehalten; G2 bekommt die Note bei Sample 3N + 10 (liegt hinter dem Fenster, das G1 vorab bekam)
    const double beat_g2 = (double)(3 * N + 10) / (double)SPB;
    w.erz.fenster(fenster(2, {ev(0.0, 57, 1.0f, 8.0), ev(beat_g2, 64, 1.0f, 1.0)}), 0.0);
    w.bis(2 * N);
    w.erz.setze_bk(2, neu(G), ERZ2);
    const size_t T = w.erz2.size();
    w.bis(w.s + 3 * N);
    CypherBk* ref = neu(G);   // Referenz: G1 mit derselben Note, Block T mal Rampe ab 0
    cypher_bk_note_an(ref, 0, 57, 1.0f);
    std::vector<float> rl(N), rr(N);
    for (int b = 0; b <= 2; ++b) cypher_bk_block(ref, rl.data(), rr.data(), N);
    cypher_bk_frei(ref);
    double maxabw = 0.0;
    float nach_rampe = 0.0f;
    for (int i = 0; i < N; ++i) {
      const float soll = i < cdj::ERZ_AUSKLANG ? rl[i] * (1.0f - (float)(i + 1) / (float)cdj::ERZ_AUSKLANG) : 0.0f;
      maxabw = std::max(maxabw, (double)std::abs(w.erz2[T + i] - soll));
      if (i >= cdj::ERZ_AUSKLANG) nach_rampe = std::max(nach_rampe, std::abs(w.erz2[T + i]));
    }
    float vor = 0.0f, g2 = 0.0f, sprung = 0.0f;
    for (size_t i = T - 16; i < T; ++i) vor = std::max(vor, std::abs(w.erz2[i]));
    for (size_t i = T + N + 11; i < T + 2 * N; ++i) g2 = std::max(g2, std::abs(w.erz2[i]));
    for (size_t b : {T, T + N}) sprung = std::max(sprung, std::abs(w.erz2[b] - w.erz2[b - 1]));   // Wechselblock: Anfang, Ende
    CypherBk* frei[4];
    const int nf = w.erz.bk_frei(frei, 4);
    for (int i = 0; i < nf; ++i) cypher_bk_frei(frei[i]);
    std::printf("MESS wechsel faeden=%d: vor=%.4f maxabw=%g nach_rampe=%g g2=%.4f sprung_blockrand=%.4f frei=%d\n", faeden, vor,
                maxabw, nach_rampe, g2, sprung, nf);
    PRUEF(vor > 0.05f);          // G1 klang vor dem Wechsel
    PRUEF(maxabw < 1e-6);        // Rampe ab 0 im Wechselblock
    PRUEF(nach_rampe == 0.0f);   // danach nichts mehr von G1
    PRUEF(g2 > 0.05f);           // G2 klingt ab T+1
    PRUEF(sprung <= 0.1f);       // kein Knacks an einem Blockrand
    PRUEF(nf == 1);              // G1 zurück
    PRUEF(w.raeumen() == 1);     // G2
  }
  for (int faeden : {0, 2}) {  // 2b) Ausklang über mehrere Blöcke (Quantum 128), bitgleich gegen S3a ohne Werk
    const Wechsel128 ref = wechsel128(-1, 128, false), got = wechsel128(faeden, 128, false);
    const bool gleich = ref.aus.size() == got.aus.size() &&
                        std::memcmp(ref.aus.data(), got.aus.data(), ref.aus.size() * sizeof(float)) == 0;
    std::printf("MESS wechsel128 faeden=%d: %zu Samples %s, ausklang_spitze=%.4f (ref %.4f), frei=%d (ref %d), verspaetet=%u\n",
                faeden, got.aus.size(), gleich ? "gleich" : "UNGLEICH", got.ausklang, ref.ausklang, got.frei, ref.frei, got.verspaetet);
    PRUEF(got.ausklang > 0.05f);   // Positivprobe: im Ausklang klingt G1
    PRUEF(gleich);                 // bitgleich zur Referenz ohne Werk
    PRUEF(got.verspaetet == 0);    // kein verspäteter Block
    PRUEF(got.frei == 2);          // G1 und G2: alle Graphen zurück
    // Quantum 64: der Ausklang dauert vier Blöcke, ein zweiter Wechsel wartet auf den besetzten Platz
    const Wechsel128 z = wechsel128(faeden, 64, true);
    std::printf("MESS wechsel64_zweiter faeden=%d: ausklang_spitze=%.4f g3=%.4f frei=%d verspaetet=%u\n", faeden, z.ausklang, z.g3,
                z.frei, z.verspaetet);
    PRUEF(z.ausklang > 0.05f);
    PRUEF(z.g3 > 0.05f);           // G3 klingt, nachdem er den Platz bekommen hat
    PRUEF(z.verspaetet == 0);
    PRUEF(z.frei == 3);            // G1, G2, G3
  }
  {  // 3) Allokationswächter: block() mit Werk (2 Fäden), Noten, Wechsel und bk_frei allokieren nicht
    Welt w(2);
    CypherBk* a = neu(G);
    CypherBk* b = neu(G);
    w.erz.setze_bk(2, a, ERZ2);
    w.erz.fenster(fenster(2, {ev(0.5, 57, 1.0f, 0.5), ev(1.0, 60, 1.0f, 0.5), ev(1.5, 64, 0.7f, 2.0)}), 0.0);
    w.bis(N);   // erster Block außerhalb der Zählung (Vectors der Welt wachsen)
    w.schlaf = false;   // Schlafen zählt der Wächter; Takt wie ein Callback (ohne ihn wäre fast jeder Block verspätet, gemessen 136-147
    w.takt = true;      // von ~190, und der Wechsel käme in 4 Blöcken nicht dran)
    w.erz2.reserve(1 << 20);
    w.erz2r.reserve(1 << 20);
    w.erz3.reserve(1 << 20);
    if (!ALLOC_ABFANG_VERFUEGBAR) std::printf("bk_werk: Allokationswaechter fehlt (Sanitizer-Bau), Fall 3 uebersprungen\n");
    abfang_an();   // Positiv-Kontrolle: der Wächter sieht Allokationen aus dem Rust-Teil
    CypherBk* probe = neu(G);
    const long pos = abfang_aus();
    cypher_bk_frei(probe);
    PRUEF(!ALLOC_ABFANG_VERFUEGBAR || pos > 0);
    CypherBk* frei[4];
    abfang_an();
    w.bis(2 * SPB);
    w.erz.setze_bk(2, b, ERZ2);
    w.bis(w.s + 4 * N);
    const int nf = w.erz.bk_frei(frei, 4);
    const AbfangZahlen az = abfang_zahlen();
    abfang_aus();
    const long allok = az.summe();
    std::printf("MESS ohne_allokation: alloc+frei+sperren+schlafen=%ld (Positiv-Kontrolle %ld) frei=%d verspaetet=%u\n", allok, pos, nf,
                w.erz.bk_stand().verspaetet);
    PRUEF(!ALLOC_ABFANG_VERFUEGBAR || allok == 0);
    PRUEF(nf == 1);
    for (int i = 0; i < nf; ++i) cypher_bk_frei(frei[i]);
    PRUEF(w.raeumen() == 1);
  }
  if (const char* wav = std::getenv("CYPHERDJ_BK_WAV_WERK")) {  // Task 4 Step 3: Hörprobe wie test_erzeuger_bk Fall 6, mit Werk (2 Fäden)
    std::ifstream f(CYPHERDJ_DJK "/instrumente/baukasten_dsp/beispiele/juno-pad.json");
    std::stringstream text;
    text << f.rdbuf();
    PRUEF(f.good() || f.eof());
    Welt w(2);
    w.erz.setze_bk(2, neu(text.str().c_str()), ERZ2);
    w.erz.fenster(fenster(2, {ev(0.0, 45, 0.8f, 1.0), ev(1.0, 49, 0.8f, 1.0), ev(2.0, 52, 0.8f, 1.0), ev(3.0, 57, 0.8f, 1.0),
                              ev(4.0, 45, 0.8f, 4.0), ev(4.0, 49, 0.8f, 4.0), ev(4.0, 52, 0.8f, 4.0), ev(4.0, 57, 0.8f, 4.0)}), 0.0);
    w.bis(10 * SPB);
    const auto z = w.werk->zaehler();
    std::printf("MESS hoerprobe_werk: %zu Frames, auftraege=%llu gestohlen=%llu verspaetet=%llu\n", w.erz2.size(),
                (unsigned long long)z.auftraege, (unsigned long long)z.gestohlen, (unsigned long long)z.verspaetet);
    std::ofstream o(wav, std::ios::binary);   // Format wie test_erzeuger_bk Fall 6 (16 bit Stereo, 48 kHz)
    const uint32_t frames = (uint32_t)w.erz2.size(), bytes = frames * 4, rate = 48000;
    const auto u32 = [&](uint32_t v) { o.write(reinterpret_cast<const char*>(&v), 4); };
    const auto u16 = [&](uint16_t v) { o.write(reinterpret_cast<const char*>(&v), 2); };
    o.write("RIFF", 4); u32(36 + bytes); o.write("WAVEfmt ", 8); u32(16); u16(1); u16(2); u32(rate); u32(rate * 4); u16(4); u16(16);
    o.write("data", 4); u32(bytes);
    const auto pcm = [](float v) { return (int16_t)std::lrintf(std::clamp(v, -1.0f, 1.0f) * 32767.0f); };
    for (uint32_t i = 0; i < frames; ++i) {
      const int16_t a = pcm(w.erz2[i]), b = pcm(w.erz2r[i]);
      o.write(reinterpret_cast<const char*>(&a), 2);
      o.write(reinterpret_cast<const char*>(&b), 2);
    }
    PRUEF(o.good());
    PRUEF(w.raeumen() == 1);
  }
  PRUEF_ENDE();
}
