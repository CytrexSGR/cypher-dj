// Kern schreibt den Hüllkurven-Ring §6.2 am Mess-Abgriff (vor dem Fader, nach EQ und Filter, ADR 008): ein
// geschlossenes Deck (Fader −200 dB, Vorgabe) ist im Kanal deck/1 sichtbar, erreicht aber master nicht; ein nie
// belegter Kanal (erz/4) bleibt konstant null; das 48er-Raster hält auch über einen Sample-Sprung (/k/set/neu, M1).
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <vector>

#include "cypherdj/huellen.h"
#include "kern35.h"

bool g_waechter = false;

using namespace k35;

static cdj_huellen_kopf* neue_huellen() {
  auto* h = (cdj_huellen_kopf*)std::aligned_alloc(64, CDJ_HUELLEN_BYTES);
  cdj_huellen_init(h);
  return h;
}

// Alle Datensätze eines Kanals von r_von bis r_bis (exklusiv) aus dem Ring lesen.
static std::vector<cdj_huellen_satz> lies(cdj_huellen_kopf* h, uint64_t r_von, uint64_t r_bis, unsigned kanal) {
  std::vector<cdj_huellen_satz> v;
  for (uint64_t r = r_von; r < r_bis; ++r) v.push_back(*cdj_huellen_ort(h, r, kanal));
  return v;
}

int main() {
  Arbeitsbestand ab("test_kern_huellen");
  traeger(ab.pfad, "c1c0000000000e01", "--freq 1000 --ohne-klick --traeger 0.25");

  // Fall 1+2: Ring im Speicher, verbunden, Deck geladen und gestartet (MINOR 3: nur geladen bleibt stumm).
  Lauf x(ab.pfad, "konfig/controller/softcontroller.json");
  cdj_huellen_kopf* h = neue_huellen();
  x.kern->verbinde_huellen(h);
  x.laden(1, "c1c0000000000e01");
  x.zyklen(10 * N);
  x.start(1, 2.0);
  const uint64_t r0 = cdj_lade(&h->w);

  // Fall 3+4: 1 s Zyklen fahren.
  x.zyklen(x.kern->sample() + 48000);
  const uint64_t r1 = cdj_lade(&h->w);
  const uint64_t geschrieben = r1 - r0;
  std::printf("huellen: %llu Datensaetze in ~1s (r0=%llu r1=%llu)\n", (unsigned long long)geschrieben,
              (unsigned long long)r0, (unsigned long long)r1);
  PRUEF(geschrieben >= 990);

  const auto deck1 = lies(h, r0, r1, 0);
  const auto master = lies(h, r0, r1, 14);
  const auto erz4 = lies(h, r0, r1, 7);  // erz/4: nie belegt

  bool deck1_sichtbar = false;
  for (const auto& s : deck1)
    if (s.spitze > 0.01f) deck1_sichtbar = true;
  PRUEF(deck1_sichtbar);  // hinter geschlossenem Fader sichtbar (Mess-Abgriff vor dem Fader)

  bool master_still = true;
  for (const auto& s : master)
    if (s.spitze >= 1e-6f) master_still = false;
  PRUEF(master_still);  // geschlossener Fader erreicht den Master nicht

  bool erz4_null = true;
  for (const auto& s : erz4)
    if (s.band[0] != 0.0f || s.band[1] != 0.0f || s.band[2] != 0.0f || s.band[3] != 0.0f || s.band[4] != 0.0f ||
        s.band[5] != 0.0f || s.spitze != 0.0f)
      erz4_null = false;
  PRUEF(erz4_null);

  // Fall 4: sample steigt je Datensatz um 48, (sample+1) % 48 == 0, beat steigt monoton.
  bool schritt48 = true, raster48 = true, monoton = true;
  for (size_t i = 0; i < master.size(); ++i) {
    if ((master[i].sample + 1) % 48 != 0) raster48 = false;
    if (i > 0) {
      if (master[i].sample - master[i - 1].sample != 48) schritt48 = false;
      if (master[i].beat <= master[i - 1].beat) monoton = false;
    }
  }
  PRUEF(schritt48);
  PRUEF(raster48);
  PRUEF(monoton);

  // Fall 5: Negativ-Kontrolle — ein zweiter Kern ohne verbundenen Ring stürzt nicht ab und schreibt nichts hinein.
  {
    Lauf x2(ab.pfad, "konfig/controller/softcontroller.json");
    cdj_huellen_kopf* h2 = neue_huellen();
    // bewusst NICHT verbinden (verbinde_huellen bleibt bei der Vorgabe nullptr)
    x2.laden(1, "c1c0000000000e01");
    x2.zyklen(10 * N);
    x2.start(1, 2.0);
    x2.zyklen(x2.kern->sample() + 20000);  // lief ohne Absturz bis hierher
    PRUEF(cdj_lade(&h2->w) == 0);  // der separate Puffer wurde nie berührt
    std::free(h2);
  }

  // Fall 6: Fader-Probe — deck/1/fader auf 0 (Quelle andreas, Dauer 0), 0,5 s fahren: jetzt erreicht master.
  const uint64_t r2 = cdj_lade(&h->w);
  x.teil("deck/1/fader", 0.0f, x.kern->karte().beat_at((double)x.kern->sample()), 0.0, "andreas");
  x.zyklen(x.kern->sample() + 24000);
  const uint64_t r3 = cdj_lade(&h->w);
  const auto master2 = lies(h, r2, r3, 14);
  bool master_jetzt_laut = false;
  for (const auto& s : master2)
    if (s.spitze > 0.01f) master_jetzt_laut = true;
  PRUEF(master_jetzt_laut);

  // Fall 7: Sample-Sprung /k/set/neu — danach wieder (sample+1)%48==0 für jeden Datensatz, und alle belegten
  // Kanäle (deck/1 geladen, master, cue immer) tragen im selben Datensatz dasselbe sample.
  const uint64_t r4 = cdj_lade(&h->w);
  cdj::Befehl neu_b = x.neu(cdj::Befehl::SET_NEU, "pruefstand");
  neu_b.bpm = 128.0;
  x.sende(neu_b);
  x.zyklen(x.kern->sample() + 20000);
  const uint64_t r5 = cdj_lade(&h->w);
  const auto master_nach = lies(h, r4, r5, 14);
  const auto deck1_nach = lies(h, r4, r5, 0);
  const auto cue_nach = lies(h, r4, r5, 15);
  PRUEF(!master_nach.empty());
  bool nach_raster48 = true, gleiches_sample = true;
  for (size_t i = 0; i < master_nach.size(); ++i) {
    if ((master_nach[i].sample + 1) % 48 != 0) nach_raster48 = false;
    if (i < deck1_nach.size() && deck1_nach[i].sample != master_nach[i].sample) gleiches_sample = false;
    if (i < cue_nach.size() && cue_nach[i].sample != master_nach[i].sample) gleiches_sample = false;
  }
  PRUEF(nach_raster48);
  PRUEF(gleiches_sample);

  std::free(h);

  // Fall 8 (Nachfahrt Hauptinstanz 2026-09-28): der Schreiber lief über MIX_KANAELE (18) statt 16 Ring-Kanäle und schrieb
  // an der letzten Ring-Zeile 128 Bytes hinter das Ende (Kosten-Lauf: free(): invalid next size; ASan: SEGV in
  // AnalyseBaender::verarbeite). Wächter-Bytes hinter dem Ring, einen vollen Umlauf fahren: sie bleiben unberührt, und
  // in jeder Zeile tragen alle 16 Kanäle dasselbe sample.
  {
    constexpr size_t WACHE = 4096;
    auto* roh = (unsigned char*)std::aligned_alloc(64, CDJ_HUELLEN_BYTES + WACHE);
    std::memset(roh + CDJ_HUELLEN_BYTES, 0xA5, WACHE);
    auto* hw = (cdj_huellen_kopf*)roh;
    cdj_huellen_init(hw);
    Lauf y(ab.pfad, "konfig/controller/softcontroller.json");
    y.kern->verbinde_huellen(hw);
    y.laden(1, "c1c0000000000e01");
    y.zyklen(10 * N);
    y.start(1, 2.0);
    y.zyklen(y.kern->sample() + (int64_t)CDJ_HUELLEN_CAP * 48 + 48000);   // mehr als ein Umlauf
    const uint64_t w = cdj_lade(&hw->w);
    PRUEF(w > CDJ_HUELLEN_CAP);
    bool wache_heil = true;
    for (size_t i = 0; i < WACHE; ++i)
      if (roh[CDJ_HUELLEN_BYTES + i] != 0xA5) wache_heil = false;
    PRUEF(wache_heil);
    bool zeilen_gleich = true;
    for (uint64_t r = w - 1000; r < w; ++r)
      for (unsigned c = 1; c < CDJ_HUELLEN_KANAELE; ++c)
        if (cdj_huellen_ort(hw, r, c)->sample != cdj_huellen_ort(hw, r, 0)->sample) zeilen_gleich = false;
    PRUEF(zeilen_gleich);
    std::printf("Fall 8: w=%llu, Wache %s, Zeilen %s\n", (unsigned long long)w, wache_heil ? "heil" : "ZERSTOERT",
                zeilen_gleich ? "gleich" : "VERSCHOBEN");
    std::free(roh);
  }
  PRUEF_ENDE();
}
