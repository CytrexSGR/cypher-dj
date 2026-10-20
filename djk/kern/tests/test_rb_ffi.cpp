// D1 K2a: die RB-338 aus libhall_ffi.a im Kern-Bau. Note am Versatz verschiebungs-invariant (A3), Zurücksetzen macht gleiche
// Läufe bitgleich (A7), Parameter über die IDs aus rb338, null harmlos, All-Off vor Note-Ein am selben Sample. Aufruf unter dem Denormal-Schutz wie Hall und Komp.
#include "cypherdj/cypher_rb_ffi.h"
#include <cypherdj/dsp/denormal.h>
#include "pruef.h"
#include <cmath>
#include <vector>

namespace {
const int N = 256;

std::vector<float> block(CypherRb* h, int n = N) {
  std::vector<float> l(n, 9.0f), r(n, 9.0f);
  cypherdj::dsp::DenormalSchutz schutz;
  cypher_rb_block(h, l.data(), r.data(), static_cast<size_t>(n));
  PRUEF(l == r);   // mono auf beide Kanäle
  return l;
}

// Transport-Start wie im Kern: Vorgaben, Parameter der Wiedergabe setzen, zurücksetzen, Noten mit Versatz über Blöcke
std::vector<float> lauf(CypherRb* h) {
  cypher_rb_vorgaben(h);
  cypher_rb_setze(h, "cutoff", 0.4f);
  cypher_rb_setze(h, "resonanz", 0.75f);
  cypher_rb_zuruecksetzen(h);
  std::vector<float> aus;
  for (int b = 0; b < 30; ++b) {
    if (b == 0) { cypher_rb_note_an(h, 7, 36, 100); cypher_rb_note_aus(h, 180, 36); }
    if (b == 2) { cypher_rb_note_an(h, 40, 43, 127); cypher_rb_note_an(h, 300, 48, 100); }   // 48 gleitet im Folgeblock
    if (b == 5) { cypher_rb_setze(h, "env_mod", 0.9f); cypher_rb_alle_aus(h, 12); }
    auto x = block(h);
    aus.insert(aus.end(), x.begin(), x.end());
  }
  return aus;
}
}  // namespace

int main() {
  // 1 A3 Verschiebungs-Invarianz (Spec 1, Fassung 2.1): nach zuruecksetzen ist eine Note bei Versatz k bitgleich die um k
  //   verschobene Note bei Versatz 0, auch an Blockgrenzen (Versatz hinter dem Block wandert); das erste Nicht-Null-Sample
  //   ist kein Maß. Gegenprobe: unverschoben verglichen ist k = 1 ein anderes Signal.
  {
    auto note_bei = [](int k) {
      CypherRb* h = cypher_rb_neu(48000.0);
      PRUEF(h != nullptr);
      cypher_rb_note_an(h, 0, 30, 127);   // Vorleben
      block(h);
      cypher_rb_zuruecksetzen(h);
      PRUEF(cypher_rb_note_an(h, static_cast<uint32_t>(k), 36, 100) == 0);
      cypher_rb_note_aus(h, static_cast<uint32_t>(k + 1500), 36);
      std::vector<float> aus;
      for (int b = 0; b < 12; ++b) { auto x = block(h); aus.insert(aus.end(), x.begin(), x.end()); }
      cypher_rb_frei(h);
      return aus;
    };
    const auto ref = note_bei(0);
    bool klingt = false;
    for (float v : ref) klingt = klingt || v != 0.0f;
    PRUEF(klingt);
    for (int k : {1, 100, 255, 256, 257, 511}) {
      auto x = note_bei(k);
      bool still = true, gleich = true;
      for (int i = 0; i < k; ++i) still = still && x[i] == 0.0f;
      for (size_t i = static_cast<size_t>(k); i < x.size(); ++i) gleich = gleich && x[i] == ref[i - k];
      PRUEF(still);
      PRUEF(gleich);
      if (!gleich) std::fprintf(stderr, "Versatz %d: nicht die verschobene Referenz\n", k);
    }
    PRUEF(note_bei(1) != ref);
  }
  // 2 Bitgleich: zweimal derselbe Lauf nach zuruecksetzen; Gegenprobe ohne zuruecksetzen ist ein anderes Signal
  {
    CypherRb* h = cypher_rb_neu(48000.0);
    cypher_rb_note_an(h, 3, 30, 127);   // Zustand verschmutzen
    block(h, 100);
    auto a = lauf(h);
    auto b = lauf(h);
    PRUEF(a == b);
    bool klingt = false, endlich = true;
    float spitze = 0.0f;
    for (float v : a) { klingt = klingt || v != 0.0f; endlich = endlich && std::isfinite(v); spitze = std::fmax(spitze, std::fabs(v)); }
    PRUEF(klingt);
    PRUEF(endlich);
    PRUEF(spitze < 1.0f);   // Vorgabe-Lautstärke −12 dB, Akzent 1,36: Spitze um 0,25 (Messung rb_wie_plugin)
    cypher_rb_note_an(h, 0, 50, 100);
    block(h);
    cypher_rb_setze(h, "cutoff", 0.4f);
    cypher_rb_setze(h, "resonanz", 0.75f);
    std::vector<float> c;
    for (int b2 = 0; b2 < 30; ++b2) { auto x = block(h); c.insert(c.end(), x.begin(), x.end()); }
    PRUEF(c != a);
    cypher_rb_frei(h);
  }
  // 3 Parameter-IDs aus rb338
  {
    CypherRb* h = cypher_rb_neu(48000.0);
    for (const char* id : {"lautstaerke", "wellenform", "cutoff", "resonanz", "env_mod", "decay", "accent"})
      PRUEF(cypher_rb_setze(h, id, 0.5f) == 0);
    PRUEF(cypher_rb_setze(h, "volume", 0.5f) == -1);
    PRUEF(cypher_rb_setze(h, nullptr, 0.5f) == -1);
    PRUEF(cypher_rb_setze(h, "cutoff", std::nanf("")) == -2);
    PRUEF(cypher_rb_note_an(h, 0, 200, 100) == -2);
    cypher_rb_frei(h);
  }
  // 4 null ist harmlos und still
  {
    std::vector<float> l(N, 1.0f), r(N, 1.0f);
    cypher_rb_block(nullptr, l.data(), r.data(), N);
    bool still = true;
    for (int i = 0; i < N; ++i) still = still && l[i] == 0.0f && r[i] == 0.0f;
    PRUEF(still);
    PRUEF(cypher_rb_note_an(nullptr, 0, 36, 100) == -1);
    cypher_rb_zuruecksetzen(nullptr);
    cypher_rb_frei(nullptr);
  }
  // 5 Am selben Sample: All-Off vor Note-Ein, in beiden Meldereihenfolgen (Loop-Wrap: der Neuanschlag klingt und gleitet nicht)
  {
    auto lauf5 = [](int art) {
      CypherRb* h = cypher_rb_neu(48000.0);
      cypher_rb_note_an(h, 0, 36, 100);
      cypher_rb_note_an(h, 100, 40, 100);   // 40 gleitet über 36
      std::vector<float> aus = block(h);
      if (art == 0) { cypher_rb_note_aus(h, 10, 36); cypher_rb_note_aus(h, 10, 40); cypher_rb_note_an(h, 10, 48, 100); }
      if (art == 1) { cypher_rb_alle_aus(h, 10); cypher_rb_note_an(h, 10, 48, 100); }
      if (art == 2) { cypher_rb_note_an(h, 10, 48, 100); cypher_rb_alle_aus(h, 10); }
      for (int b = 0; b < 10; ++b) { auto x = block(h); aus.insert(aus.end(), x.begin(), x.end()); }
      cypher_rb_frei(h);
      return aus;
    };
    const auto ref = lauf5(0);
    double e = 0.0;
    for (size_t i = N + 10; i < ref.size(); ++i) e += static_cast<double>(ref[i]) * ref[i];
    PRUEF(e > 1e-3);   // die 48 klingt
    PRUEF(lauf5(1) == ref);
    PRUEF(lauf5(2) == ref);
  }
  PRUEF_ENDE();
}
