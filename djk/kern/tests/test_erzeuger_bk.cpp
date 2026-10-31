// Baukasten S3a Task 2: ein Strom mit Graph (bk) spielt Noten am Sample des Beats in den Eingang seines Kanals, ohne
// Vorhalt, das Off am Sample nach dauer; Kit und MIDI schweigen, solange der Graph gilt. Wechsel: der alte behält seine
// Noten, klingt 240 Samples linear aus (bitgenau gegen eine Referenz) und kommt danach über bk_frei() zurück; ein zweiter
// Wechsel im Ausklang verliert nichts. Unter dem Allokationswächter allokieren block, setze_bk und bk_frei nicht und
// geben nicht frei. Die Ausgabe ist auf ±8 geklemmt. Negativ-Kontrolle: ein Kit-Strom ohne Graph klingt unverändert.
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <sstream>
#include <vector>

#include "cypherdj/cypher_bk_ffi.h"
#include "cypherdj/erzeuger.h"
#include "pruef.h"
#include "alloc_abfang.h"   // zuletzt: ersetzt malloc und Verwandte (wie test_kern_arr_senken_alloc.cpp:17)

namespace {

constexpr int N = 256;
constexpr int64_t SPB = 22500;  // 128 BPM bei 48 kHz
constexpr int ERZ2 = 5, ERZ3 = 6;
const char* G = R"({"format":"baukasten/2","name":"t","stimmen":2,"knoten":[{"id":"n","art":"note"},{"id":"s","art":"saege"},{"id":"v","art":"mul"},{"id":"o","art":"ausgang"}],"kanten":[{"von":"n.hz","nach":"s.hz"},{"von":"s.aus","nach":"v.a"},{"von":"n.gate","nach":"v.b"},{"von":"v.aus","nach":"o.x"}]})";

const char* GA = R"({"format":"baukasten/2","name":"t","stimmen":2,"knoten":[{"id":"n","art":"note"},{"id":"s","art":"saege"},{"id":"e","art":"adsr","a":0.001,"d":0.1,"s":1,"r":1.0},{"id":"v","art":"mul"},{"id":"o","art":"ausgang"}],"kanten":[{"von":"n.hz","nach":"s.hz"},{"von":"n.gate","nach":"e.gate"},{"von":"s.aus","nach":"v.a"},{"von":"e.aus","nach":"v.b"},{"von":"v.aus","nach":"o.x"}]})";
CypherBk* graphA() {
  char f[256] = {};
  CypherBk* h = cypher_bk_neu(GA, 48000.0, f, sizeof f);
  PRUEF(h != nullptr);
  return h;
}
CypherBk* graph() {
  char f[256] = {};
  CypherBk* h = cypher_bk_neu(G, 48000.0, f, sizeof f);
  PRUEF(h != nullptr);
  return h;
}

struct Welt {
  cdj::Karte karte{128.0, 0};
  cdj::Erzeuger erz;
  std::vector<float> pl = std::vector<float>(cdj::MIX_KANAELE * N), pr = pl;
  float* l[cdj::MIX_KANAELE];
  float* r[cdj::MIX_KANAELE];
  std::vector<float> erz2, erz2r, erz3;
  int64_t s = 0;
  Welt() { for (int k = 0; k < cdj::MIX_KANAELE; ++k) { l[k] = &pl[k * N]; r[k] = &pr[k * N]; } }
  void bis(int64_t ende) {
    while (s < ende) {
      std::fill(pl.begin(), pl.end(), 0.0f);
      std::fill(pr.begin(), pr.end(), 0.0f);
      erz.block(karte, s, N, l, r, nullptr, s);
      erz2.insert(erz2.end(), l[ERZ2], l[ERZ2] + N);
      erz2r.insert(erz2r.end(), r[ERZ2], r[ERZ2] + N);
      erz3.insert(erz3.end(), l[ERZ3], l[ERZ3] + N);
      s += N;
    }
  }
};

cdj::ErzFenster fenster(int strom, std::initializer_list<cdj::ErzEv> evs) {
  cdj::ErzFenster f{};
  f.strom = strom;
  f.sendung = 1;
  f.ab_beat = 0.0;
  f.bis_beat = 8.0;
  for (const auto& e : evs) f.ev[f.n++] = e;
  return f;
}

cdj::ErzEv ev(double beat, int note, float vel, double dauer) {
  cdj::ErzEv e{beat, note, 1, vel};
  e.dauer = dauer;
  return e;
}

int64_t erstes(const std::vector<float>& x) {
  for (size_t i = 0; i < x.size(); ++i) if (x[i] != 0.0f) return (int64_t)i;
  return -1;
}

}  // namespace

int main() {
  cdj::Kit kit;  // Klang auf Note 57: darf auf dem Graph-Strom NICHT klingen, auf erz/3 schon
  kit.klang[57].frames = 1;
  kit.klang[57].daten = {1.0f, 1.0f};
  kit.n = 1;

  {  // 1) Note am Beat 1 klingt ab Sample SPB, nicht früher (Vorhalt 0); Kit schweigt; Off nach dauer 0,5 Beat
    Welt w;
    w.erz.setze_strom(2, &kit, ERZ2);
    w.erz.setze_bk(2, graph(), ERZ2);
    w.erz.fenster(fenster(2, {ev(1.0, 57, 1.0f, 0.5)}), 0.0);
    w.bis(3 * SPB);
    std::printf("bk: erstes Sample %lld (soll %lld)\n", (long long)erstes(w.erz2), (long long)SPB);
    PRUEF(erstes(w.erz2) == SPB + 1);   // Note am Sample SPB, die Säge liefert dort selbst 0
    {  // Kit schweigt: derselbe Lauf ohne Kit am Strom ist bitgleich
      Welt o;
      o.erz.setze_bk(2, graph(), ERZ2);
      o.erz.fenster(fenster(2, {ev(1.0, 57, 1.0f, 0.5)}), 0.0);
      o.bis(3 * SPB);
      PRUEF(o.erz2 == w.erz2);
      CypherBk* f[2];
      o.erz.setze_bk(2, nullptr, ERZ2);
      o.bis(o.s + 2 * N);
      for (int i = 0, nf = o.erz.bk_frei(f, 2); i < nf; ++i) cypher_bk_frei(f[i]);
    }
    PRUEF(w.erz2[SPB] == 0.0f);
    PRUEF(w.erz2[SPB + SPB / 2 - 1] != 0.0f);   // Off am Sample: das letzte Sample vor dem Off klingt
    PRUEF(w.erz2[SPB + SPB / 2] == 0.0f);       // und das Off-Sample selbst nicht (gate 0)
    float an = 0.0f, nach = 0.0f;
    for (int64_t i = SPB; i < SPB + SPB / 2; ++i) an = std::max(an, std::abs(w.erz2[i]));
    for (int64_t i = SPB + SPB / 2 + 10; i < 3 * SPB; ++i) nach = std::max(nach, std::abs(w.erz2[i]));
    PRUEF(an > 0.1f);
    PRUEF(nach == 0.0f);   // gate 0 nach dem Off: der Graph (Säge · gate) schweigt
    CypherBk* frei[4];
    PRUEF(w.erz.bk_frei(frei, 4) == 0);
    w.erz.setze_bk(2, nullptr, ERZ2);
    w.bis(4 * SPB);
    PRUEF(w.erz.bk_frei(frei, 4) == 1);
    cypher_bk_frei(frei[0]);
  }
  {  // 2) Negativ-Kontrolle: ohne Graph ist der Strom ein Kit-Strom wie bisher (das Kit klingt am Beat)
    Welt w;
    w.erz.setze_strom(3, &kit, ERZ3);
    w.erz.fenster(fenster(3, {ev(1.0, 57, 1.0f, 0.5)}), 0.0);
    w.bis(2 * SPB);
    PRUEF(erstes(w.erz3) == SPB);
    PRUEF(erstes(w.erz2) == -1);
  }
  {  // 3) Wechsel während die Note klingt: der alte (G, ohne Hüllkurve) behält die Note und blendet linear aus
    Welt w;
    w.erz.setze_bk(2, graph(), ERZ2);
    w.erz.fenster(fenster(2, {ev(0.0, 57, 1.0f, 4.0)}), 0.0);
    w.bis(2 * N);
    CypherBk* frei[4];
    w.erz.setze_bk(2, graph(), ERZ2);   // neuer Graph ohne Note: alles, was danach klingt, ist der Ausklang
    const size_t a = w.erz2.size();
    w.bis(w.s + 2 * N);
    float vor = 0.0f, spaet = 0.0f;
    for (size_t i = a; i < a + 16; ++i) vor = std::max(vor, std::abs(w.erz2[i]));
    for (size_t i = a + cdj::ERZ_AUSKLANG; i < w.erz2.size(); ++i) spaet = std::max(spaet, std::abs(w.erz2[i]));
    std::printf("F3: vor=%g spaet=%g\n", vor, spaet);
    PRUEF(vor > 0.05f);
    PRUEF(spaet == 0.0f);
    // Referenz: gleicher Graph, gleiche Note, direkt (Note gehalten, kein alle_aus), mal linearer Rampe
    CypherBk* ref = graph();
    cypher_bk_note_an(ref, 0, 57, 1.0f);
    std::vector<float> l(2 * N), r(2 * N);
    cypher_bk_block(ref, l.data(), r.data(), N);
    cypher_bk_block(ref, l.data(), r.data(), N);
    std::vector<float> rl(N), rr(N);
    cypher_bk_block(ref, rl.data(), rr.data(), N);
    double maxabw = 0.0;
    for (int i = 0; i < cdj::ERZ_AUSKLANG; ++i) {
      const float soll = rl[i] * (1.0f - (float)(i + 1) / (float)cdj::ERZ_AUSKLANG);
      maxabw = std::max(maxabw, (double)std::abs(w.erz2[a + i] - soll));
    }
    std::printf("F3: max Abweichung zur Referenz %g\n", maxabw);
    PRUEF(maxabw < 1e-6);
    cypher_bk_frei(ref);
    int nf = w.erz.bk_frei(frei, 4);
    PRUEF(nf == 1);
    for (int i = 0; i < nf; ++i) cypher_bk_frei(frei[i]);
    w.erz.setze_bk(2, nullptr, ERZ2);
    w.bis(w.s + 2 * N);
    nf = w.erz.bk_frei(frei, 4);
    PRUEF(nf == 1);
    for (int i = 0; i < nf; ++i) cypher_bk_frei(frei[i]);
  }
  {  // 3b) zweiter Wechsel noch im Ausklang: der erste Ausklang endet sofort, nichts geht verloren (A, B frei; C klingt)
    Welt w;
    CypherBk* frei[8];
    w.erz.setze_bk(2, graphA(), ERZ2);
    w.bis(2 * N);
    w.erz.setze_bk(2, graphA(), ERZ2);   // A klingt aus
    w.erz.setze_bk(2, graphA(), ERZ2);   // B abgelöst, bevor ein Block lief: A geht sofort frei
    w.bis(w.s + 4 * N);
    const int nf = w.erz.bk_frei(frei, 8);
    PRUEF(nf == 2);
    for (int i = 0; i < nf; ++i) cypher_bk_frei(frei[i]);
    w.erz.setze_bk(2, nullptr, ERZ2);
    w.bis(w.s + 4 * N);
    PRUEF(w.erz.bk_frei(frei, 8) == 1);
    cypher_bk_frei(frei[0]);
  }
  {  // 4) Allokationswächter: block mit Noten, setze_bk (Graph vorher gebaut) und bk_frei allokieren nicht
    Welt w;
    CypherBk* a = graph();
    CypherBk* b = graph();
    w.erz.setze_bk(2, a, ERZ2);
    w.erz.fenster(fenster(2, {ev(0.5, 57, 1.0f, 0.5), ev(1.0, 60, 1.0f, 0.5), ev(1.5, 64, 0.7f, 2.0)}), 0.0);
    w.bis(N);   // erster Block außerhalb der Zählung (Vectors der Welt wachsen)
    w.erz2.reserve(1 << 20);
    w.erz2r.reserve(1 << 20);   // Hörprobe (Fall 6) sammelt den rechten Kanal mit: auch er darf in Fall 4 nicht wachsen
    w.erz3.reserve(1 << 20);
    CypherBk* frei[4];
    int nf = 0;
    if (!ALLOC_ABFANG_VERFUEGBAR) std::printf("bk: Allokationswaechter fehlt (Sanitizer-Bau), Fall 4 uebersprungen\n");
    abfang_an();   // Positiv-Kontrolle: der Wächter sieht Allokationen aus dem Rust-Teil
    CypherBk* probe = graph();
    const long pos = abfang_aus();
    cypher_bk_frei(probe);
    PRUEF(!ALLOC_ABFANG_VERFUEGBAR || pos > 0);
    abfang_an();   // tests/alloc_abfang.h; Form wie tests/test_kern_arr_senken_alloc.cpp:52-54
    w.bis(2 * SPB);
    w.erz.setze_bk(2, b, ERZ2);
    w.bis(w.s + 2 * N);
    nf = w.erz.bk_frei(frei, 4);
    const AbfangZahlen az = abfang_zahlen();
    abfang_aus();
    const long allok = az.summe();   // Allokation + free + Sperren + Schlafen
    std::printf("bk: Allokationen/Freigaben im Callback-Pfad %ld (Positiv-Kontrolle %ld)\n", allok, pos);
    PRUEF(!ALLOC_ABFANG_VERFUEGBAR || allok == 0);
    PRUEF(nf == 1);
    for (int i = 0; i < nf; ++i) cypher_bk_frei(frei[i]);
    w.erz.setze_bk(2, nullptr, ERZ2);
    w.bis(w.s + 2 * N);
    nf = w.erz.bk_frei(frei, 4);
    for (int i = 0; i < nf; ++i) cypher_bk_frei(frei[i]);
    const auto st = w.erz.bk_stand();
    PRUEF(st.verloren == 0 && st.panik == 0);
  }
  {  // 5) D7: Ausgabe über 8 wird auf 8 geklemmt (Graph liefert konstant 100); NaN/Inf fängt schon der Wächter des Programms
    const char* GK = R"({"format":"baukasten/2","name":"k","stimmen":1,"knoten":[{"id":"k","art":"konst","wert":100},{"id":"o","art":"ausgang"}],"kanten":[{"von":"k.aus","nach":"o.x"}]})";
    char f[256] = {};
    CypherBk* h = cypher_bk_neu(GK, 48000.0, f, sizeof f);
    PRUEF(h != nullptr);
    Welt w;
    w.erz.setze_bk(2, h, ERZ2);
    w.bis(2 * N);
    float mx = -1e9f, mn = 1e9f;
    for (float v : w.erz2) { mx = std::max(mx, v); mn = std::min(mn, v); }
    PRUEF(mx == 8.0f && mn == 8.0f);
    w.erz.setze_bk(2, nullptr, ERZ2);
    w.bis(w.s + 2 * N);
    CypherBk* frei[4];
    const int nf = w.erz.bk_frei(frei, 4);
    PRUEF(nf == 1);
    for (int i = 0; i < nf; ++i) cypher_bk_frei(frei[i]);
  }
  if (const char* wav = std::getenv("CYPHERDJ_BK_WAV")) {  // 6) Hörprobe: juno-pad.json im Erzeuger, A2 C#3 E3 A3, dann der Akkord, als WAV
    std::ifstream f(CYPHERDJ_DJK "/instrumente/baukasten_dsp/beispiele/juno-pad.json");
    std::stringstream text;
    text << f.rdbuf();
    PRUEF(f.good() || f.eof());
    char fehler[256] = {};
    CypherBk* h = cypher_bk_neu(text.str().c_str(), 48000.0, fehler, sizeof fehler);
    PRUEF(h != nullptr);
    Welt w;
    w.erz.setze_bk(2, h, ERZ2);
    w.erz.fenster(fenster(2, {ev(0.0, 45, 0.8f, 1.0), ev(1.0, 49, 0.8f, 1.0), ev(2.0, 52, 0.8f, 1.0), ev(3.0, 57, 0.8f, 1.0),
                              ev(4.0, 45, 0.8f, 4.0), ev(4.0, 49, 0.8f, 4.0), ev(4.0, 52, 0.8f, 4.0), ev(4.0, 57, 0.8f, 4.0)}), 0.0);
    w.bis(10 * SPB);
    float spitze = 0.0f;
    for (size_t i = 0; i < w.erz2.size(); ++i) spitze = std::max({spitze, std::abs(w.erz2[i]), std::abs(w.erz2r[i])});
    std::printf("bk: Hoerprobe %zu Frames, Spitze %.4f, rettungen %u, verloren %u, panik %u\n", w.erz2.size(), spitze,
                cypher_bk_rettungen(h), w.erz.bk_stand().verloren, w.erz.bk_stand().panik);
    PRUEF(spitze > 0.01f);
    std::ofstream o(wav, std::ios::binary);
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
    w.erz.setze_bk(2, nullptr, ERZ2);
    w.bis(w.s + 2 * N);
    CypherBk* frei[4];
    const int nf = w.erz.bk_frei(frei, 4);
    PRUEF(nf == 1);
    for (int i = 0; i < nf; ++i) cypher_bk_frei(frei[i]);
  }
  PRUEF_ENDE();
}
