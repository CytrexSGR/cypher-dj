// Plan 2026-09-27 Task 3: Erzeuger-Schlange (SCHNITTSTELLEN §4.8, ADR 024) ohne Kern. Einsatz genau am Sample des
// Beats, auch an Blockgrenzen; Fenster ersetzen mit Zählern; zu spät; Strom ohne Kit still; velocity; Stimmen enden
// mit dem Kit. Fehlerfall: test_erzeuger_mutation (Einsatz am Blockanfang) muss scheitern.
#include <algorithm>
#include <cmath>
#include <memory>
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

double groesster_sprung(const std::vector<float>& y, int64_t von, int64_t bis) {
  double m = 0.0;
  for (int64_t i = std::max<int64_t>(von, 1); i < bis && i < (int64_t)y.size(); ++i)
    m = std::max(m, (double)std::fabs(y[i] - y[i - 1]));
  return m;
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
  {  // 6. Kit tauschen (F11, Glanz 2.4.1): das alte kommt zurück; seine klingende Stimme klingt aus einer Kopie über
     // ERZ_AUSKLANG Frames aus. Vorher (kit_tausch, Erhebung): Sprung 0,4965 an der Tauschgrenze.
    auto wp = std::make_unique<Welt>();
    Welt& w = *wp;
    cdj::Kit lang;
    lang.klang[36].frames = 48000;
    lang.klang[36].daten.assign(96000, 0.5f);
    lang.n = 1;
    w.erz.setze_strom(1, &lang, ERZ1);
    w.erz.fenster(fenster(1, 0.0, 8.0, {{1.0, 36, 1, 1.0f}}), w.jetzt());
    w.bis(2 * SPB);
    PRUEF(w.erz.stimmen() == 1);
    PRUEF(w.erz.setze_strom(1, &kit, ERZ1) == &lang);
    PRUEF(w.erz.stimmen() == 0 && w.erz.ausklaenge() == 1);
    const int64_t getauscht = w.s;  // bis() rendert bis zur Blockgrenze: vorher Gerendertes zählt nicht
    std::fill(lang.klang[36].daten.begin(), lang.klang[36].daten.end(), 9.0f);  // „freigegeben“: der Ausklang liest es nicht mehr
    w.bis(3 * SPB);
    PRUEF(w.aus_l[getauscht - 1] == 0.5f);
    const double s = groesster_sprung(w.aus_l, getauscht, getauscht + cdj::ERZ_AUSKLANG + 1);
    std::printf("F11 Kit-Tausch: groesster Sprung %.5f (Schwelle %.5f, vorher 0,5)\n", s, 0.5 / cdj::ERZ_AUSKLANG);
    PRUEF(s <= 0.5 / cdj::ERZ_AUSKLANG + 1e-7);
    PRUEF(w.aus_l[getauscht] < 0.5f && w.aus_l[getauscht] > 0.49f);  // keine 9,0: Kopie, kein Lesen im alten Kit
    PRUEF(einsatz(w.aus_l, getauscht + cdj::ERZ_AUSKLANG) == -1 && w.erz.ausklaenge() == 0);
  }
  {  // 6b. F11 wie im Betrieb: das alte Kit wird nach dem Tausch wirklich freigegeben (netz_erz.cpp:204). Im ASan-Bau
     // wäre jedes Lesen danach ein heap-use-after-free; im Normalbau prüft Fall 6 dasselbe über die 9,0.
    auto wp = std::make_unique<Welt>();
    Welt& w = *wp;
    auto lang = std::make_unique<cdj::Kit>();
    lang->klang[36].frames = 48000;
    lang->klang[36].daten.assign(96000, 0.5f);
    lang->n = 1;
    w.erz.setze_strom(1, lang.get(), ERZ1);
    w.erz.fenster(fenster(1, 0.0, 8.0, {{1.0, 36, 1, 1.0f}}), w.jetzt());
    w.bis(2 * SPB);
    PRUEF(w.erz.setze_strom(1, &kit, ERZ1) == lang.get());
    lang.reset();
    const int64_t getauscht = w.s;
    w.bis(3 * SPB);
    PRUEF(w.aus_l[getauscht] < 0.5f && w.aus_l[getauscht] > 0.49f && w.erz.ausklaenge() == 0);
  }
  {  // F11 Negativ-Kontrolle: dasselbe Kit erneut setzen ändert nichts, die Stimme läuft bitgleich weiter
    auto wp = std::make_unique<Welt>();
    Welt& w = *wp;
    cdj::Kit lang;
    lang.klang[36].frames = 48000;
    lang.klang[36].daten.assign(96000, 0.5f);
    lang.n = 1;
    w.erz.setze_strom(1, &lang, ERZ1);
    w.erz.fenster(fenster(1, 0.0, 8.0, {{1.0, 36, 1, 1.0f}}), w.jetzt());
    w.bis(2 * SPB);
    PRUEF(w.erz.setze_strom(1, &lang, ERZ1) == nullptr);
    PRUEF(w.erz.stimmen() == 1 && w.erz.ausklaenge() == 0);
    const int64_t s0 = w.s;
    w.bis(3 * SPB);
    PRUEF(w.aus_l[s0] == 0.5f && w.aus_l[s0 + 1000] == 0.5f);
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
    PRUEF(w.aus_l[a] == 1.5f && w.aus_l[a + 1] == 4.0f && w.aus_l[a + 2] == 5.0f && w.aus_l[a + 3] == 3.0f);  // F46: je 1 Frame Rampe (1/4 von 4)
    PRUEF(w.aus_l[a + 4] == 0.0f);
    PRUEF(einsatz(w.aus_l, a + 4) == 10 * SPB);  // der leere Bereich bei Beat 9 klingt nicht
    const int64_t c = 10 * SPB;
    PRUEF(w.aus_l[c] == 1.0f && w.aus_l[c + 5] == 6.0f && w.aus_l[c + 8] == 0.0f);
    PRUEF_NAH(w.aus_l[c + 6], 7.0 * 2 / 3, 1e-5);
    PRUEF_NAH(w.aus_l[c + 7], 8.0 / 3, 1e-5);  // F50: lautes Dateiende, 2 Frames
    const int64_t d = 11 * SPB;
    PRUEF(w.aus_l[d] == 1.0f && w.aus_l[d + 5] == 6.0f && w.aus_l[d + 8] == 0.0f);
    PRUEF_NAH(w.aus_l[d + 6], 7.0 * 2 / 3, 1e-5);
    PRUEF_NAH(w.aus_l[d + 7], 8.0 / 3, 1e-5);
  }
  {  // F46 (Glanz 2.5.1): Ausschnitt mit lauter Kante setzt mit Rampe ein und hört mit Rampe auf. Reiz wie probe_erz
     // (Erhebung 01.10.): Sinus 100 Hz, 0,5; begin 0,3125 und end 0,5625 liegen auf Spitzen. Vorher: Sprung 0,5000.
    cdj::Kit ks;
    ks.klang[36].frames = 48001;  // Frame 48000 liegt auf einem Nulldurchgang: das Klangende ist leise
    for (int i = 0; i < 48001; ++i) {
      const float x = (float)(0.5 * std::sin(2 * M_PI * 100 * i / 48000.0));
      ks.klang[36].daten.push_back(x);
      ks.klang[36].daten.push_back(x);
    }
    ks.n = 1;
    const auto& d = ks.klang[36].daten;
    const double natuerlich = 0.5 * 2 * M_PI * 100 / 48000.0;  // 0,00654
    const int64_t a = 2 * SPB;                                 // Einsatz auf Beat 2
    {  // Fehlerfall: begin 0,3125 → Frame 15000, end 0,5625 → Frame 27000 (12000 Frames)
      auto wp = std::make_unique<Welt>();
      Welt& w = *wp;
      w.erz.setze_strom(1, &ks, ERZ1);
      cdj::ErzEv e{2.0, 36, 1, 1.0f};
      e.begin = 0.3125f;
      e.end = 0.5625f;
      w.erz.fenster(fenster(1, 0.0, 8.0, {e}), w.jetzt());
      w.bis(4 * SPB);
      const double s = groesster_sprung(w.aus_l, 1, (int64_t)w.aus_l.size());
      std::printf("F46 Ausschnitt: groesster Sprung %.5f (Schwelle %.5f, vorher 0,50000)\n", s, 0.5 / 32 + natuerlich);
      PRUEF(s <= 0.5 / 32 + natuerlich);
      PRUEF(w.aus_l[a] != 0.0f && std::fabs(w.aus_l[a]) <= 0.5f / 33.0f + 1e-6f);  // erstes Sample: 1/33 der Kante
      PRUEF(w.aus_l[a + cdj::ERZ_EIN] == d[2 * (15000 + cdj::ERZ_EIN)]);           // nach der Einblende bitgleich
      PRUEF(w.aus_l[a + 11999 - cdj::ERZ_AUS] == d[2 * (26999 - cdj::ERZ_AUS)]);   // vor der Ausblende bitgleich
      PRUEF(std::fabs(w.aus_l[a + 11999]) <= 0.5f / (cdj::ERZ_AUS + 1) + 1e-6f && w.aus_l[a + 12000] == 0.0f);
    }
    {  // Negativ-Kontrolle 1: begin 0 / end 1, Klangende leise: jedes Sample bitgleich zum Klang
      auto wp = std::make_unique<Welt>();
      Welt& w = *wp;
      w.erz.setze_strom(1, &ks, ERZ1);
      w.erz.fenster(fenster(1, 0.0, 8.0, {{2.0, 36, 1, 1.0f}}), w.jetzt());
      w.bis(a + 48001 + N);
      bool gleich = true;
      for (int64_t i = 0; i < 48001; ++i) gleich = gleich && w.aus_l[a + i] == d[2 * i] && w.aus_r[a + i] == d[2 * i + 1];
      PRUEF(gleich && w.aus_l[a + 48001] == 0.0f);
    }
    {  // Negativ-Kontrolle 2: Schnitt auf einem Nulldurchgang (begin 0,3 → Frame 14400, |x| < -60 dBFS): keine Einblende
      auto wp = std::make_unique<Welt>();
      Welt& w = *wp;
      w.erz.setze_strom(1, &ks, ERZ1);
      cdj::ErzEv e{2.0, 36, 1, 1.0f};
      e.begin = 0.3f;
      w.erz.fenster(fenster(1, 0.0, 8.0, {e}), w.jetzt());
      w.bis(a + 1000 + N);
      bool gleich = true;
      for (int64_t i = 0; i < 1000; ++i) gleich = gleich && w.aus_l[a + i] == d[2 * (14400 + i)];
      PRUEF(gleich);
    }
    {  // F50 Kernseite: Datei endet laut (wie rec anlauf:0, -5,7 dBFS) → Ausblende am Dateiende; Anfang bleibt hart
      cdj::Kit kr;
      kr.klang[36].frames = 4800;
      kr.klang[36].daten.assign(2 * 4800, 0.5f);
      kr.n = 1;
      auto wp = std::make_unique<Welt>();
      Welt& w = *wp;
      w.erz.setze_strom(1, &kr, ERZ1);
      w.erz.fenster(fenster(1, 0.0, 8.0, {{2.0, 36, 1, 1.0f}}), w.jetzt());
      w.bis(a + 4800 + N);
      PRUEF(w.aus_l[a] == 0.5f);  // Anschlag am Dateianfang: Absicht, keine Rampe
      PRUEF(std::fabs(w.aus_l[a + 4799]) <= 0.5f / (cdj::ERZ_AUS + 1) + 1e-6f && w.aus_l[a + 4800] == 0.0f);
      PRUEF(groesster_sprung(w.aus_l, a + 1, a + 4801) <= 0.5 / cdj::ERZ_AUS);
    }
  }
  {  // F16 (Glanz 2.5.2): freie Stimme zuerst. Reiz wie stimmen.cpp (Erhebung 01.10.): 8-s-Klang auf Beat 0, dazu ein
     // stummer 50-ms-Klang alle 1/4 Beat. Vorher wurde der lange Klang beim 33. Ereignis reihum geraubt.
    cdj::Kit kl;
    kl.klang[0].frames = 8 * 48000;
    for (int i = 0; i < 8 * 48000; ++i) {
      const float x = 0.5f * (float)std::sin(2 * M_PI * 220 * i / 48000.0);
      kl.klang[0].daten.push_back(x);
      kl.klang[0].daten.push_back(x);
    }
    kl.klang[1].frames = 2400;
    kl.klang[1].daten.assign(2 * 2400, 0.0f);  // stumm: hörbar ist nur Klang 0
    kl.n = 2;
    auto wp = std::make_unique<Welt>();
    Welt& w = *wp;
    w.erz.setze_strom(1, &kl, ERZ1);
    cdj::ErzFenster f = fenster(1, 0.0, 16.0, {{0.0, 0, 1, 1.0f}});
    for (int j = 1; j < 63; ++j) f.ev[f.n++] = cdj::ErzEv{0.25 * j, 1, 1, 1.0f};
    w.erz.fenster(f, w.jetzt());
    w.bis(8 * 48000 + N);
    int64_t letzt = -1;
    for (int64_t i = 0; i < (int64_t)w.aus_l.size(); ++i)
      if (w.aus_l[i] != 0.0f) letzt = i;
    std::printf("F16: 8-s-Klang klingt bis Sample %lld (Soll 383999)\n", (long long)letzt);
    PRUEF(letzt == 8 * 48000 - 1);  // letzter Frame -0,0144 · 1/97 (F50-Ausblende) ist nicht 0
  }
  {  // F16 Raub mit Ausklang: 33 lange Gleichwert-Klänge (0,5), alle 1/4 Beat. Der 33. (Beat 8, Sample 180000) raubt den
     // ältesten (Beat 0); der klingt nach der Blockgrenze 180224 über ERZ_AUSKLANG Frames aus, statt um 0,5 zu springen.
    cdj::Kit dc;
    dc.klang[0].frames = 8 * 48000;
    dc.klang[0].daten.assign(2 * 8 * 48000, 0.5f);
    dc.n = 1;
    auto wp = std::make_unique<Welt>();
    Welt& w = *wp;
    w.erz.setze_strom(1, &dc, ERZ1);
    cdj::ErzFenster f = fenster(1, 0.0, 16.0, {});
    for (int j = 0; j < 33; ++j) f.ev[f.n++] = cdj::ErzEv{0.25 * j, 0, 1, 1.0f};
    w.erz.fenster(f, w.jetzt());
    w.bis(706 * N);
    PRUEF(w.erz.stimmen() == 32);
    PRUEF(w.aus_l[180223] == 16.5f);  // 31 + geraubte (Rest des Blocks) + neue ab 180000
    const double s = groesster_sprung(w.aus_l, 180224, 180224 + cdj::ERZ_AUSKLANG + 1);
    std::printf("F16 Raub: groesster Sprung nach der Blockgrenze %.5f (Schwelle %.5f, vorher 0,5)\n", s, 0.5 / cdj::ERZ_AUSKLANG);
    PRUEF(s <= 0.5 / cdj::ERZ_AUSKLANG + 1e-5);
  }
  {  // F08 (Glanz 2.4.2): Note 255 spielt ihren eigenen Klang, nicht den von 255 & 127
    cdj::Kit z;
    const int hoch = cdj::KIT_KLAENGE - 1;  // vor F08 127, danach 255
    z.klang[hoch].frames = 1;
    z.klang[hoch].daten = {0.25f, 0.25f};
    z.klang[hoch & 127].frames = 1;
    z.klang[hoch & 127].daten = {0.75f, 0.75f};
    z.n = 2;
    auto wp = std::make_unique<Welt>();
    Welt& w = *wp;
    w.erz.setze_strom(1, &z, ERZ1);
    w.erz.fenster(fenster(1, 0.0, 8.0, {{4.0, 255, 1, 1.0f}}), w.jetzt());
    w.bis(8 * SPB);
    std::printf("F08 Note 255: %.2f (Soll 0,25, vorher 0,75)\n", w.aus_l[4 * SPB]);
    PRUEF(w.aus_l[4 * SPB] == 0.25f);
  }
  {  // F16/F11 Fix A (Prüfung 06.10.): Raub im Block B, Kit-Tausch vor Block B+1. Dann gibt es 33 Ausklänge (1 Raub + 32
     // Tausch) bei 32 Stimmen. ERZ_AUSKLANG < Block: jeder Ausklang endet im Block nach seiner Entstehung, aber der
     // Raub-Ausklang ist beim Tausch noch voll. Mit nur ERZ_STIMMEN Plätzen überschriebe der Tausch einen von ihnen: harter
     // Abbruch (Prüfer: 0,566). Grenze: 33 Ausklänge je ERZ_AUSKLANG+1 Rampenschritt (0,5 · 33 / 241 = 0,0685) + Toleranz;
     // Prüfer-Kontrolle ohne vorigen Raub (32 Ausklänge) 0,066.
    auto k1 = std::make_unique<cdj::Kit>(), k2 = std::make_unique<cdj::Kit>();
    for (cdj::Kit* k : {k1.get(), k2.get()}) {
      k->klang[0].frames = 8 * 48000;
      k->klang[0].daten.assign(2 * 8 * 48000, 0.5f);
      k->n = 1;
    }
    auto wp = std::make_unique<Welt>();
    Welt& w = *wp;
    w.erz.setze_strom(1, k1.get(), ERZ1);
    cdj::ErzFenster f = fenster(1, 0.0, 16.0, {});
    for (int j = 0; j < 33; ++j) f.ev[f.n++] = cdj::ErzEv{0.25 * j, 0, 1, 1.0f};
    w.erz.fenster(f, w.jetzt());
    w.bis(704 * N);  // Block mit Sample 180000 ist [179968, 180224): der 33. Einsatz raubt dort
    const int64_t t = w.s;
    w.erz.setze_strom(1, k2.get(), ERZ1);  // Kit-Tausch als Befehl vor dem nächsten Block
    PRUEF(w.erz.stimmen() == 0 && w.erz.ausklaenge() == 33);
    w.bis(t + 2 * N);
    const double s = groesster_sprung(w.aus_l, t, t + cdj::ERZ_AUSKLANG + 2);
    const double grenze = 0.5 * 33 / (cdj::ERZ_AUSKLANG + 1) + 1e-5;
    std::printf("F16 Fix A: Raub + Tausch, groesster Sprung %.5f (Grenze %.5f, Pruefer vorher 0,566)\n", s, grenze);
    PRUEF(s <= grenze);
  }
  {  // F16 Fix B1 (Prüfung 06.10.): 32 belegte Stimmen verschiedenen Alters, die 33. raubt die ÄLTESTE. Klang i hat den
     // Wert 0,01 · (i + 1), Einsatz i alle 1/64 Beat (351,56 Samples). Nach dem Ausklang bleibt die Summe der Klänge 1..32.
    auto kk = std::make_unique<cdj::Kit>();
    for (int i = 0; i < 33; ++i) {
      kk->klang[i].frames = 16384;
      kk->klang[i].daten.assign(2 * 16384, 0.01f * (float)(i + 1));
    }
    kk->n = 33;
    auto wp = std::make_unique<Welt>();
    Welt& w = *wp;
    w.erz.setze_strom(1, kk.get(), ERZ1);
    cdj::ErzFenster f = fenster(1, 0.0, 1.0, {});
    for (int j = 0; j < 33; ++j) f.ev[f.n++] = cdj::ErzEv{j / 64.0, j, 1, 1.0f};
    w.erz.fenster(f, w.jetzt());
    w.bis(14000);
    double soll = 0.0;
    for (int i = 1; i < 33; ++i) soll += 0.01 * (i + 1);
    std::printf("F16 Fix B1: Summe nach dem Raub %.4f (Soll %.4f: Klang 0 geraubt)\n", (double)w.aus_l[13000], soll);
    PRUEF(w.erz.stimmen() == 32 && w.erz.ausklaenge() == 0);
    PRUEF_NAH(w.aus_l[13000], soll, 1e-3);
  }
  {  // F11 Fix B2: Kit-Tausch mit 20 klingenden Stimmen: jede bekommt einen eigenen Ausklang. Summensprung höchstens 20
     // Rampenschritte 0,5 / (ERZ_AUSKLANG + 1); auf einem gemeinsamen Platz bliebe einer, der Rest bräche hart ab.
    auto k1 = std::make_unique<cdj::Kit>(), k2 = std::make_unique<cdj::Kit>();
    for (cdj::Kit* k : {k1.get(), k2.get()}) {
      k->klang[0].frames = 48000;
      k->klang[0].daten.assign(2 * 48000, 0.5f);
      k->n = 1;
    }
    auto wp = std::make_unique<Welt>();
    Welt& w = *wp;
    w.erz.setze_strom(1, k1.get(), ERZ1);
    cdj::ErzFenster f = fenster(1, 0.0, 1.0, {});
    for (int j = 0; j < 20; ++j) f.ev[f.n++] = cdj::ErzEv{j / 64.0, 0, 1, 1.0f};
    w.erz.fenster(f, w.jetzt());
    w.bis(8192);
    PRUEF(w.erz.stimmen() == 20);
    const int64_t t = w.s;
    w.erz.setze_strom(1, k2.get(), ERZ1);
    PRUEF(w.erz.stimmen() == 0 && w.erz.ausklaenge() == 20);
    w.bis(t + 2 * N);
    const double s = groesster_sprung(w.aus_l, t, t + cdj::ERZ_AUSKLANG + 2);
    const double grenze = 0.5 * 20 / (cdj::ERZ_AUSKLANG + 1) + 1e-5;
    std::printf("F11 Fix B2: 20 Stimmen im Tausch, groesster Sprung %.5f (Grenze %.5f)\n", s, grenze);
    PRUEF(s <= grenze);
    PRUEF(w.aus_l[t + cdj::ERZ_AUSKLANG] == 0.0f && w.erz.ausklaenge() == 0);
  }
  PRUEF_ENDE();
}
