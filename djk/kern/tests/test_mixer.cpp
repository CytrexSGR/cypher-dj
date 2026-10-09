// Scheibe 25: der Mixer als Zuweisungstabelle (mixer.h). Offline, ohne Kern und ohne Stellwerk-Zyklus.
//  1. Tabelle: jeder Regler des Stellwerks hat eine Zuweisung; die Vorgaben aus §1.5 stimmen zwischen Stellwerk
//     (Scheibe 11) und Kanalzug-Bibliothek (Scheibe 04) überein.
//  2. Negativ-Kontrolle: alle Regler auf Vorgabe, Rauschen in allen 18 Eingängen → Master und Cue exakt 0.
//  3. Weg: deck/2 mit Fader 0 dB ist bitgleich zu einem allein gerechneten Kanalzug; deck/3 über bus/1 bitgleich zu
//     zwei Kanalzügen hintereinander; Crossfader Mixxx additiv (A bei +0,5 halb, bei +1 still; B bei +1 voll).
//  4. Zielwechsel: 10-ms-Blende (480 Samples, S-Kurve) statt Sprung.
//  5. master/pegel, PFL vor dem Fader (Vorhören hinter geschlossenem Fader), cue/mix, cue/split, cue/pegel.
#include <cmath>
#include <cstdint>
#include <cstring>
#include <memory>
#include <vector>

#include "cypherdj/mixer.h"
#include "pruef.h"

namespace sw = cypherdj::stellwerk;
namespace dsp = cypherdj::dsp;

static float rauschen(uint32_t& z) {  // deterministisch, −0,5 .. 0,5
  z = z * 1664525u + 1013904223u;
  return static_cast<float>(z >> 8) / 16777216.0f - 0.5f;
}

struct Pruefling {
  sw::ReglerTabelle tab;
  std::unique_ptr<cdj::Mixer> m;
  float ml[256], mr[256], cl[256], cr[256];
  Pruefling() : m(std::make_unique<cdj::Mixer>(tab)) {}
  int r(const char* pfad) const { return tab.suche(pfad); }
  void setze(const char* pfad, float w) { m->setze_sofort(r(pfad), w); }
  void block(int k, const float* x) {  // Eingang von Kanal k (links = rechts), ein Block
    std::memcpy(m->eingang_l(k), x, sizeof(float) * 256);
    std::memcpy(m->eingang_r(k), x, sizeof(float) * 256);
    m->verarbeite(256, ml, mr, cl, cr);
  }
};

int main() {
  // 1. Tabelle
  {
    Pruefling p;
    int n[16] = {};
    for (int r = 0; r < p.tab.anzahl(); ++r) ++n[static_cast<int>(p.m->zuweisung(r).rolle)];
    std::printf("Regler %d: ohne %d, spaeter %d, kanalzug %d, ziel %d, xseite %d, pfl %d, global %d\n", p.tab.anzahl(),
                n[0], n[1], n[2], n[3], n[4], n[5], n[6] + n[7] + n[8] + n[9] + n[10]);
    PRUEF(n[static_cast<int>(cdj::MixRolle::kanalzug)] == 18 * dsp::kAnzahlRegler);  // 18 Kanäle · 13 Regler
    PRUEF(n[static_cast<int>(cdj::MixRolle::ziel)] == 14);                           // Busse haben keinen
    PRUEF(n[static_cast<int>(cdj::MixRolle::xseite)] == 18 && n[static_cast<int>(cdj::MixRolle::pfl)] == 18);
    PRUEF(n[static_cast<int>(cdj::MixRolle::ohne)] == 4);                            // deck/<n>/transport
    for (int g = static_cast<int>(cdj::MixRolle::xfader); g <= static_cast<int>(cdj::MixRolle::cue_split); ++g)
      PRUEF(n[g] == 1);
    PRUEF(n[static_cast<int>(cdj::MixRolle::duck_tiefe)] == 1 && n[static_cast<int>(cdj::MixRolle::duck_release)] == 1);
    PRUEF(n[static_cast<int>(cdj::MixRolle::master_kleber)] == 1);
    PRUEF(n[static_cast<int>(cdj::MixRolle::spaeter)] == 16 + 4 + 1);  // stem/* (31), fx/notenwert, fx/rueckkopplung (47); keylock (Kern, Keylock 3)
    PRUEF(n[static_cast<int>(cdj::MixRolle::fx_rueckweg)] == 4);                     // fx/1..4/rueckweg (K2 Slice 2)
    int abweichend = 0;
    for (int r = 0; r < p.tab.anzahl(); ++r) {
      const cdj::MixZuweisung& z = p.m->zuweisung(r);
      if (z.rolle != cdj::MixRolle::kanalzug) continue;
      const float w = p.m->kanalzug(z.kanal).wert(z.regler);
      if (w != p.tab.def(r).vorgabe || dsp::info(z.regler).vorgabe != p.tab.def(r).vorgabe) {
        std::printf("Vorgabe weicht ab: %s Stellwerk %g, dsp %g\n", p.tab.def(r).pfad, p.tab.def(r).vorgabe,
                    dsp::info(z.regler).vorgabe);
        ++abweichend;
      }
    }
    PRUEF(abweichend == 0);
    PRUEF(cdj::Mixer::kanal_index("deck/2") == 1 && cdj::Mixer::kanal_index("bus/1") == 14);
    PRUEF(cdj::Mixer::kanal_index("master") == -1 && cdj::Mixer::kanal_index("deck/5") == -1);
    PRUEF(p.m->zuweisung(p.r("deck/2/eq/tief")).rolle == cdj::MixRolle::kanalzug &&
          p.m->zuweisung(p.r("deck/2/eq/tief")).kanal == 1 &&
          p.m->zuweisung(p.r("deck/2/eq/tief")).regler == dsp::Regler::eq_tief);
  }
  float x[256];
  uint32_t z = 12345;
  for (float& v : x) v = rauschen(z);

  // 2. Negativ-Kontrolle: Vorgaben (alle Fader −200, PFL aus, cue/mix −1) → Master und Cue exakt 0
  {
    Pruefling p;
    for (int b = 0; b < 4; ++b) {
      for (int k = 0; k < cdj::MIX_KANAELE; ++k) {
        std::memcpy(p.m->eingang_l(k), x, sizeof x);
        std::memcpy(p.m->eingang_r(k), x, sizeof x);
      }
      p.m->verarbeite(256, p.ml, p.mr, p.cl, p.cr);
      for (int i = 0; i < 256; ++i) PRUEF(p.ml[i] == 0.0f && p.mr[i] == 0.0f && p.cl[i] == 0.0f && p.cr[i] == 0.0f);
    }
  }

  // 3. Weg: deck/2 direkt, deck/3 über bus/1, Crossfader
  {
    Pruefling p;
    auto ref = std::make_unique<dsp::Kanalzug>();
    auto ref_bus = std::make_unique<dsp::Kanalzug>();
    ref->zuruecksetzen();
    ref_bus->zuruecksetzen();
    ref->setze_sofort(dsp::Regler::fader, 0.0f);
    ref_bus->setze_sofort(dsp::Regler::fader, 0.0f);
    p.setze("deck/2/fader", 0.0f);
    float rl[256], rr[256], bl[256], br[256];
    dsp::KanalzugAusgang ra, ba;
    ra.haupt_l = rl;
    ra.haupt_r = rr;
    ba.haupt_l = bl;
    ba.haupt_r = br;
    bool gleich = true;
    for (int b = 0; b < 8; ++b) {
      p.block(1, x);
      ref->verarbeite(x, x, 256, ra);
      for (int i = 0; i < 256; ++i) gleich = gleich && p.ml[i] == rl[i] && p.mr[i] == rr[i];
    }
    PRUEF(gleich);
    // deck/2 aus, deck/3 auf bus/1 (Fader 0), bus/1 Fader 0
    p.setze("deck/2/fader", -200.0f);
    p.setze("deck/3/fader", 0.0f);
    p.setze("deck/3/ziel", 1.0f);
    p.setze("bus/1/fader", 0.0f);
    PRUEF(p.m->ziel_ist(2) == 1);
    ref->zuruecksetzen();
    ref->setze_sofort(dsp::Regler::fader, 0.0f);
    for (int k = 0; k < 2; ++k) p.block(1, x);  // deck/2 klingt aus (Fader −200: exakt 0)
    gleich = true;
    for (int b = 0; b < 8; ++b) {
      p.block(2, x);
      ref->verarbeite(x, x, 256, ra);
      ref_bus->verarbeite(rl, rr, 256, ba);
      for (int i = 0; i < 256; ++i) gleich = gleich && p.ml[i] == bl[i] && p.mr[i] == br[i];
    }
    PRUEF(gleich);
    // Crossfader an deck/3 wirkt nicht (Ziel Bus), an bus/1 schon: Seite A, +0,5 → halb, +1 → still
    p.setze("bus/1/xseite", 0.0f);
    p.setze("xfader", 0.5f);
    gleich = true;
    for (int b = 0; b < 4; ++b) {
      p.block(2, x);
      ref->verarbeite(x, x, 256, ra);
      ref_bus->verarbeite(rl, rr, 256, ba);
      for (int i = 0; i < 256; ++i) gleich = gleich && p.ml[i] == bl[i] * 0.5f;
    }
    PRUEF(gleich);
    p.setze("xfader", 1.0f);
    p.block(2, x);
    ref->verarbeite(x, x, 256, ra);
    ref_bus->verarbeite(rl, rr, 256, ba);
    for (int i = 0; i < 256; ++i) PRUEF(p.ml[i] == 0.0f);
    p.setze("bus/1/xseite", 2.0f);  // Seite B bei +1: voll
    p.block(2, x);
    ref->verarbeite(x, x, 256, ra);
    ref_bus->verarbeite(rl, rr, 256, ba);
    for (int i = 0; i < 256; ++i) PRUEF(p.ml[i] == bl[i]);
    PRUEF(cdj::seitengewicht(0, -0.3f) == 1.0f && cdj::seitengewicht(2, -0.25f) == 0.75f &&
          cdj::seitengewicht(1, 1.0f) == 1.0f);
  }

  // 4. Zielwechsel mit Blende: Gleichspannung 1,0 in deck/1 (Fader 0), eingeschwungen; bus/1 Fader −200.
  //    Bei Sample 10 wechselt deck/1/ziel von 0 auf 1: der Master fällt über 480 Samples in S-Form auf 0.
  {
    Pruefling p;
    float eins[256];
    for (float& v : eins) v = 1.0f;
    p.setze("deck/1/fader", 0.0f);
    for (int b = 0; b < 400; ++b) p.block(0, eins);  // LR8 schwingt ein (Gruppenlaufzeit einige ms)
    const float voll = p.ml[255];
    PRUEF_NAH(voll, 1.0, 1e-3);
    float zv[256];
    for (int i = 0; i < 256; ++i) zv[i] = i < 10 ? 0.0f : 1.0f;
    float m[512];
    p.m->verlauf(p.r("deck/1/ziel"), zv);
    p.block(0, eins);
    std::memcpy(m, p.ml, sizeof p.ml);
    p.block(0, eins);
    std::memcpy(m + 256, p.ml, sizeof p.ml);
    PRUEF_NAH(m[9], voll, 1e-6);
    PRUEF_NAH(m[10], voll, 1e-6);                      // erstes Sample der Blende: noch voll
    PRUEF_NAH(m[10 + 240], 0.5 * voll, 2e-3);          // Mitte der S-Kurve
    PRUEF_NAH(m[10 + 120], (1.0 - 0.15625) * voll, 2e-3);  // u = 0,25: 3u² − 2u³ = 0,15625
    bool monoton = true;
    for (int i = 11; i < 512; ++i) monoton = monoton && m[i] <= m[i - 1] + 1e-6f;
    PRUEF(monoton);
    PRUEF(m[10 + 479] > 0.0f && m[10 + 480] == 0.0f);  // nach genau 480 Samples ganz auf bus/1 (stumm)
    PRUEF(p.m->ziel_ist(0) == 1);
  }

  // 5. master/pegel, PFL, cue/mix, cue/split, cue/pegel
  {
    Pruefling p;
    p.setze("deck/1/pfl", 1.0f);  // Fader bleibt −200: Vorhören hinter geschlossenem Fader
    p.block(0, x);
    const float g_cue = static_cast<float>(dsp::db_zu_linear(-12.0));  // cue/pegel Vorgabe −12 dB
    const float* al = p.m->kanalzug(0).abgriff(0);
    bool ok = true;
    for (int i = 0; i < 256; ++i) ok = ok && p.ml[i] == 0.0f && p.cl[i] == al[i] * g_cue;
    PRUEF(ok);
    p.setze("deck/2/fader", 0.0f);
    p.setze("master/pegel", -6.0206f);
    p.setze("cue/mix", 1.0f);  // nur Master im Kopfhörer
    std::memcpy(p.m->eingang_l(1), x, sizeof x);
    std::memcpy(p.m->eingang_r(1), x, sizeof x);
    p.block(0, x);
    const float g_m = static_cast<float>(dsp::db_zu_linear(-6.0206));
    const float* hl = p.m->kanalzug(1).abgriff(0);  // Fader 0 dB: Haupt = Abgriff
    ok = true;
    for (int i = 0; i < 256; ++i) ok = ok && p.ml[i] == hl[i] * g_m && p.cl[i] == p.ml[i] * 1.0f * g_cue;
    PRUEF(ok);
    PRUEF_NAH(g_m, 0.5, 1e-5);
    p.setze("cue/split", 1.0f);  // links Kopf mono, rechts Master mono
    std::memcpy(p.m->eingang_l(1), x, sizeof x);
    std::memcpy(p.m->eingang_r(1), x, sizeof x);
    p.block(0, x);
    ok = true;
    for (int i = 0; i < 256; ++i)
      ok = ok && std::fabs(p.cr[i] - 0.5f * (p.ml[i] + p.mr[i]) * g_cue) < 1e-7f &&
           std::fabs(p.cl[i] - 0.5f * (p.ml[i] + p.mr[i]) * g_cue) < 1e-7f;  // Kopf = Master (cue/mix +1)
    PRUEF(ok);
  }

  // Audit 2026-10-01 F01 (Paket „Nie still"): ein einziges NaN auf einem geschlossenen Kanal (erz/5, Fader −200)
  // vergiftete die Filterzustände; NaN · 0 bleibt NaN, die Summe war ab da für immer NaN (am Ausgang still). Jetzt:
  // der Block mit dem Treffer ist still, ab dem übernächsten klingt erz/1 wieder endlich. Negativ-Kontrolle: bis zum
  // Treffer ist der Lauf bitgleich zu einem Lauf ohne NaN.
  {
    Pruefling mit, ohne;
    for (Pruefling* p : {&mit, &ohne}) p->setze("erz/1/fader", 0.0f);
    uint32_t z1 = 7, z2 = 7;
    float x[256], y[256];
    bool vorher_gleich = true, nachher_endlich = true;
    float nachher_max = 0.0f;
    for (int blk = 0; blk < 30; ++blk) {
      for (int i = 0; i < 256; ++i) { x[i] = 0.2f * rauschen(z1); y[i] = 0.2f * rauschen(z2); }
      for (Pruefling* p : {&mit, &ohne}) {
        std::memset(p->m->eingang_l(8), 0, sizeof(float) * 256);
        std::memset(p->m->eingang_r(8), 0, sizeof(float) * 256);
      }
      if (blk == 10) mit.m->eingang_l(8)[17] = std::nanf("");
      mit.block(4, x);
      ohne.block(4, y);
      if (blk < 10) vorher_gleich = vorher_gleich && !std::memcmp(mit.ml, ohne.ml, sizeof mit.ml);
      if (blk >= 12)
        for (int i = 0; i < 256; ++i) {
          nachher_endlich = nachher_endlich && std::isfinite(mit.ml[i]) && std::isfinite(mit.cl[i]);
          nachher_max = std::max(nachher_max, std::fabs(mit.ml[i]));
        }
    }
    std::printf("F01: nach dem NaN Master max %.4f, endlich %d\n", nachher_max, (int)nachher_endlich);
    PRUEF(vorher_gleich);
    PRUEF(nachher_endlich);
    PRUEF(nachher_max > 0.01f);
    PRUEF(mit.m->nan_treffer() >= 1 && ohne.m->nan_treffer() == 0);
  }
  PRUEF_ENDE();
}
