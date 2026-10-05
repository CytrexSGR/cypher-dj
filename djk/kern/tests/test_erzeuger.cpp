// Plan 2026-09-27 Task 3: Erzeuger-Schlange (SCHNITTSTELLEN §4.8, ADR 024) ohne Kern. Einsatz genau am Sample des
// Beats, auch an Blockgrenzen; Fenster ersetzen mit Zählern; zu spät; Strom ohne Kit still; velocity; Stimmen enden
// mit dem Kit. Fehlerfall: test_erzeuger_mutation (Einsatz am Blockanfang) muss scheitern.
#include <cmath>
#include <vector>

#include "cypherdj/erzeuger.h"
#include "pruef.h"

namespace {

constexpr int N = 256;
constexpr int64_t SPB = 22500;  // 128 BPM
constexpr int ERZ1 = 4;         // Mixer-Index erz/1

struct Welt {
  cdj::Karte karte{128.0, 0};
  cdj::Erzeuger erz;
  std::vector<float> puffer_l = std::vector<float>(cdj::MIX_KANAELE * N), puffer_r = puffer_l;
  float* l[cdj::MIX_KANAELE];
  float* r[cdj::MIX_KANAELE];
  std::vector<float> aus_l, aus_r;  // Kanal erz/1 über alle Blöcke
  int64_t s = 0;
  Welt() {
    for (int k = 0; k < cdj::MIX_KANAELE; ++k) { l[k] = &puffer_l[k * N]; r[k] = &puffer_r[k * N]; }
  }
  void bis(int64_t ende) {  // Blöcke zu N Samples bis ende (ausschließlich)
    while (s < ende) {
      std::fill(puffer_l.begin(), puffer_l.end(), 0.0f);
      std::fill(puffer_r.begin(), puffer_r.end(), 0.0f);
      erz.block(karte, s, N, l, r);
      aus_l.insert(aus_l.end(), l[ERZ1], l[ERZ1] + N);
      aus_r.insert(aus_r.end(), r[ERZ1], r[ERZ1] + N);
      s += N;
    }
  }
  double jetzt() const { return karte.beat_at((double)s); }
};

cdj::Kit impuls_kit() {
  cdj::Kit k;
  k.klang[36].frames = 3;
  k.klang[36].daten = {1.0f, 1.0f, 0.5f, 0.5f, 0.25f, 0.25f};
  k.klang[38].frames = 1;
  k.klang[38].daten = {0.125f, -0.125f};
  k.n = 2;
  return k;
}

cdj::ErzFenster fenster(int sendung, double ab, double bis, std::initializer_list<cdj::ErzEv> evs) {
  cdj::ErzFenster f{};
  f.strom = 1;
  f.sendung = sendung;
  f.ab_beat = ab;
  f.bis_beat = bis;
  for (const auto& e : evs) f.ev[f.n++] = e;
  return f;
}

// erster Index i >= von mit |aus[i]| > 1e-6, sonst -1
int64_t einsatz(const std::vector<float>& a, int64_t von) {
  for (int64_t i = von; i < (int64_t)a.size(); ++i)
    if (std::fabs(a[i]) > 1e-6f) return i;
  return -1;
}

}  // namespace

int main() {
  const cdj::Kit kit = impuls_kit();
  {  // 1. Einsatz am Sample, Form, beide Seiten, auch genau auf einer Blockgrenze (Beat 9,1022…: Sample 204 800 = 800 · 256)
    Welt w;
    PRUEF(w.erz.setze_strom(1, &kit, ERZ1) == nullptr);
    const double b_grenze = 204800.0 / SPB;
    const auto z = w.erz.fenster(fenster(1, 8.0, 12.0, {{8.3, 36, 1, 1.0f}, {b_grenze, 36, 1, 1.0f}}), w.jetzt());
    PRUEF(z.eingefuegt == 2 && z.verworfen == 0 && z.zu_spaet == 0 && z.ungehoert == 0);
    w.bis(12 * SPB);
    const int64_t s1 = std::llround(8.3 * SPB);
    PRUEF(einsatz(w.aus_l, 0) == s1);
    PRUEF(w.aus_l[s1] == 1.0f && w.aus_l[s1 + 1] == 0.5f && w.aus_l[s1 + 2] == 0.25f && w.aus_l[s1 + 3] == 0.0f);
    PRUEF(w.aus_r[s1] == 1.0f);
    PRUEF(einsatz(w.aus_l, s1 + 3) == 204800 && w.aus_l[204800] == 1.0f && w.aus_l[204801] == 0.5f);
    PRUEF(w.erz.offen(1) == 0 && w.erz.stimmen() == 0);
    std::printf("einsatz: Beat 8,3 bei %lld (Soll %lld), Blockgrenze bei %lld (Soll 204800)\n",
                (long long)einsatz(w.aus_l, 0), (long long)s1, (long long)einsatz(w.aus_l, s1 + 3));
  }
  {  // 2. Fenster ersetzen: nach Beat 5 ersetzt ein Fenster [4, 16) die Ereignisse 8 und 12 durch 8,5 (anderes Muster)
    Welt w;
    w.erz.setze_strom(1, &kit, ERZ1);
    w.erz.fenster(fenster(1, 0.0, 16.0, {{4.0, 36, 1, 1.0f}, {8.0, 36, 1, 1.0f}, {12.0, 36, 1, 1.0f}}), w.jetzt());
    w.bis(5 * SPB);
    const auto z = w.erz.fenster(fenster(2, 4.0, 16.0, {{8.5, 36, 2, 1.0f}}), w.jetzt());
    PRUEF(z.verworfen == 2 && z.verworfen_anderes_muster == 2 && z.eingefuegt == 1 && z.zu_spaet == 0);
    w.bis(16 * SPB);
    PRUEF(einsatz(w.aus_l, 0) == 4 * SPB);
    PRUEF(einsatz(w.aus_l, 4 * SPB + 3) == std::llround(8.5 * SPB));
    PRUEF(einsatz(w.aus_l, std::llround(8.5 * SPB) + 3) == -1);
    std::printf("ersetzen: verworfen %d, anderes Muster %d, eingefuegt %d\n", z.verworfen, z.verworfen_anderes_muster,
                z.eingefuegt);
  }
  {  // 3. zu spät: Beat 2 in einem Fenster, das bei Beat 3 ankommt; gleiches Muster zählt nicht als „anderes“
    Welt w;
    w.erz.setze_strom(1, &kit, ERZ1);
    w.bis(3 * SPB);
    const auto z = w.erz.fenster(fenster(1, 0.0, 8.0, {{2.0, 36, 1, 1.0f}, {6.0, 36, 1, 1.0f}}), w.jetzt());
    PRUEF(z.zu_spaet == 1 && z.eingefuegt == 1);
    w.bis(8 * SPB);
    PRUEF(einsatz(w.aus_l, 0) == 6 * SPB);
  }
  {  // 4. Negativ-Kontrolle: Strom ohne Kit bleibt still, verbraucht aber seine Ereignisse
    Welt w;
    w.erz.fenster(fenster(1, 0.0, 8.0, {{4.0, 36, 1, 1.0f}}), w.jetzt());
    PRUEF(w.erz.offen(1) == 1);
    w.bis(8 * SPB);
    PRUEF(einsatz(w.aus_l, 0) == -1 && w.erz.offen(1) == 0);
  }
  {  // 5. velocity linear, zwei Noten auf demselben Beat addieren sich, Note ohne Klang verfällt
    Welt w;
    w.erz.setze_strom(1, &kit, ERZ1);
    w.erz.fenster(fenster(1, 0.0, 8.0, {{4.0, 36, 1, 0.5f}, {4.0, 38, 1, 1.0f}, {5.0, 99, 1, 1.0f}}), w.jetzt());
    w.bis(8 * SPB);
    PRUEF(w.aus_l[4 * SPB] == 0.5f + 0.125f && w.aus_r[4 * SPB] == 0.5f - 0.125f);
    PRUEF(einsatz(w.aus_l, 4 * SPB + 3) == -1);
  }
  {  // 6. Kit tauschen: das alte kommt zurück, seine klingenden Stimmen enden sofort
    Welt w;
    cdj::Kit lang;
    lang.klang[36].frames = 48000;
    lang.klang[36].daten.assign(96000, 0.5f);
    lang.n = 1;
    w.erz.setze_strom(1, &lang, ERZ1);
    w.erz.fenster(fenster(1, 0.0, 8.0, {{1.0, 36, 1, 1.0f}}), w.jetzt());
    w.bis(2 * SPB);
    PRUEF(w.erz.stimmen() == 1);
    PRUEF(w.erz.setze_strom(1, &kit, ERZ1) == &lang);
    PRUEF(w.erz.stimmen() == 0);
    const int64_t getauscht = w.s;  // bis() rendert bis zur Blockgrenze: vorher Gerendertes zählt nicht
    w.bis(3 * SPB);
    PRUEF(einsatz(w.aus_l, getauscht) == -1);
  }
  {  // Scheibe 3: begin/end (§4.8 Parameter-Schwanz). Klang 8 Frames 1..8; [0,25; 0,75) spielt Frames 2..5 = 3,4,5,6.
    cdj::Kit k8;
    k8.klang[40].frames = 8;
    for (int i = 0; i < 8; ++i) { k8.klang[40].daten.push_back((float)(i + 1)); k8.klang[40].daten.push_back((float)(i + 1)); }
    k8.n = 1;
    Welt w;
    w.erz.setze_strom(1, &k8, ERZ1);
    cdj::ErzEv mitte{8.0, 40, 1, 1.0f};
    mitte.begin = 0.25f;
    mitte.end = 0.75f;
    cdj::ErzEv leer{9.0, 40, 1, 1.0f};
    leer.begin = 0.5f;
    leer.end = 0.5f;
    cdj::ErzEv geklemmt{10.0, 40, 1, 1.0f};
    geklemmt.begin = -1.0f;
    geklemmt.end = 2.0f;
    cdj::ErzEv voll{11.0, 40, 1, 1.0f};  // ohne Schwanz: 0 und 1
    w.erz.fenster(fenster(1, 8.0, 12.0, {mitte, leer, geklemmt, voll}), w.jetzt());
    w.bis(12 * SPB);
    const int64_t a = 8 * SPB;
    PRUEF(w.aus_l[a] == 3.0f && w.aus_l[a + 1] == 4.0f && w.aus_l[a + 2] == 5.0f && w.aus_l[a + 3] == 6.0f);
    PRUEF(w.aus_l[a + 4] == 0.0f);
    PRUEF(einsatz(w.aus_l, a + 4) == 10 * SPB);  // der leere Bereich bei Beat 9 klingt nicht
    const int64_t c = 10 * SPB;
    PRUEF(w.aus_l[c] == 1.0f && w.aus_l[c + 7] == 8.0f && w.aus_l[c + 8] == 0.0f);
    const int64_t d = 11 * SPB;
    PRUEF(w.aus_l[d] == 1.0f && w.aus_l[d + 7] == 8.0f && w.aus_l[d + 8] == 0.0f);
  }
  PRUEF_ENDE();
}
