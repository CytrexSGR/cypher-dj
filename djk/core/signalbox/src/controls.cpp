// Stellwerk-RT: Regler-Tabelle nach INTERFACES §1.5, Standard-Kurven nach §7.2, Deck-Halter nach §7.3 Punkt 5.
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>

#include "cypherdj/signalbox/controls.h"
#include "cypherdj/signalbox/types.h"
#include "cypherdj/signalbox/tool_controls.h"

namespace cypherdj::stellwerk {

namespace {
int nr_hinter(const char* pfad, const char* praefix) {
  const size_t n = std::strlen(praefix);
  if (std::strncmp(pfad, praefix, n) != 0) return 0;
  const char* p = pfad + n;
  if (*p < '1' || *p > '9') return 0;
  int zahl = 0, ziffern = 0;
  while (*p >= '0' && *p <= '9') { zahl = zahl * 10 + (*p - '0'); ++p; if (++ziffern > 3) return 0; }
  return *p == '/' && p[1] != '\0' ? zahl : 0;
}
}  // namespace

int spur_nr(const char* pfad) { return nr_hinter(pfad, "spur/"); }
int grp_nr(const char* pfad) { return nr_hinter(pfad, "grp/"); }
int ret_nr(const char* pfad) { return nr_hinter(pfad, "ret/"); }
int send_nr(const char* pfad) {
  const char* s = std::strstr(pfad, "/send/");
  if (!s) return 0;
  const char* p = s + 6;
  if (*p < '1' || *p > '9') return 0;
  int zahl = 0, ziffern = 0;
  while (*p >= '0' && *p <= '9') { zahl = zahl * 10 + (*p - '0'); ++p; if (++ziffern > 3) return 0; }
  return *p == '\0' ? zahl : 0;
}

namespace {
#include "insert_zeilen.inc"   // 1.10 slice 4a T1: struct InsertZeile, INSERT_ZEILEN (komp rows), INSERT_VERTRAG_PFADE (whole vocabulary)
}  // namespace

int insert_vertrag_anzahl() { return static_cast<int>(sizeof INSERT_VERTRAG_PFADE / sizeof INSERT_VERTRAG_PFADE[0]); }
const char* insert_vertrag_pfad(int i) {
#ifdef CYPHERDJ_MUTATION_INS_PFAD_ZU_LANG
  if (i == 5) return "ins/komp/1/aaaaaaaaaaaaaaaaaaaaa";   // mutation: 32 characters, the length test must go red
#endif
  return INSERT_VERTRAG_PFADE[i];
}

namespace {

constexpr int MS(double ms) { return static_cast<int>(ms * SR / 1000.0 + 0.5); }
constexpr Kurve K_FADER{KurvenTyp::fader_db, -200.0f, 0.0f, false};
// D1 Spec 6.16: Spur-Fader bis +6 dB. Gleiche Kurve wie K_FADER, nur oben +6: ganz oben +6 dB, 0 dB bei Stellung ≈ 0,501
constexpr Kurve K_SPUR_FADER{KurvenTyp::fader_db, -200.0f, 6.0f, false};
constexpr Kurve K_EQ{KurvenTyp::linear, -26.0f, 6.0f, true};      // §7.2 Beispiel: linear -26..+6, kill_unter_min
constexpr Kurve K_SCHALTER{KurvenTyp::schalter, 0.0f, 1.0f, false};

Kurve linear(float a, float b) { return Kurve{KurvenTyp::linear, a, b, false}; }
Kurve stufen(float a, float b) { return Kurve{KurvenTyp::stufen, a, b, false}; }

}  // namespace

ReglerTabelle::ReglerTabelle() {
  auto kanal = [&](const char* n) { std::snprintf(kanal_[n_kanal_], sizeof kanal_[0], "%.11s", n); return n_kanal_++; };
  auto neu = [&](const char* pfad, int k, Rolle rolle, float mn, float mx, float vorgabe, int schalt, bool nur_hand,
                 bool db, bool keine_rampe, bool ganz, Kurve kurve, int deck = 0) {
    if (n_ >= MAX_REGLER) {   // K2 Task 0.2: vorher schrieb neu() ohne Prüfung über def_ hinaus
      std::fprintf(stderr, "ReglerTabelle: mehr als %d Regler, %s verworfen\n", MAX_REGLER, pfad);
      std::abort();           // Tabelle wird einmal beim Start gebaut: lieber laut sterben als still Speicher zerstören
    }
    ReglerDef& d = def_[n_++];
    std::snprintf(d.pfad, sizeof d.pfad, "%s", pfad);
    d.kanal = static_cast<int8_t>(k);
    d.deck = static_cast<int8_t>(deck);
    d.rolle = rolle;
    d.min = mn;
    d.max = mx;
    d.vorgabe = vorgabe;
    d.schalt_samples = schalt;
    d.nur_hand = nur_hand;
    d.db = db;
    d.keine_rampe = keine_rampe;
    d.ganzzahlig = ganz;
    d.transport = rolle == Rolle::transport;
    d.kurve = kurve;
  };
  // Kanäle mit Kanalzug (§1.5): deck/1..4, erz/1..8, pad/1..2, bus/1..4
  struct Gruppe { const char* name; int anzahl; };
  const Gruppe gruppen[] = {{"deck", 4}, {"erz", 8}, {"pad", 2}, {"bus", 4}};
  char p[32];
  char kn[16];
  for (const Gruppe& g : gruppen) {
    for (int i = 1; i <= g.anzahl; i++) {
      std::snprintf(kn, sizeof kn, "%s/%d", g.name, i);
      const int k = kanal(kn);
      const bool bus = std::strcmp(g.name, "bus") == 0;
      const bool deck = std::strcmp(g.name, "deck") == 0;
      auto pf = [&](const char* rest) { std::snprintf(p, sizeof p, "%s/%s", kn, rest); return p; };
      neu(pf("fader"), k, Rolle::fader, -200, 0, -200, MS(10), bus, true, false, false, K_FADER);
      neu(pf("trim"), k, Rolle::trim, -24, 24, 0, MS(10), false, false, false, false, linear(-24, 24));
      neu(pf("eq/tief"), k, Rolle::eq_tief, -200, 6, 0, MS(10), false, true, false, false, K_EQ);
      neu(pf("eq/mitte"), k, Rolle::eq_mitte, -200, 6, 0, MS(10), false, true, false, false, K_EQ);
      neu(pf("eq/hoch"), k, Rolle::eq_hoch, -200, 6, 0, MS(10), false, true, false, false, K_EQ);
      neu(pf("kill/tief"), k, Rolle::kill_tief, 0, 1, 0, MS(5), false, false, true, true, K_SCHALTER);
      neu(pf("kill/mitte"), k, Rolle::kill_mitte, 0, 1, 0, MS(5), false, false, true, true, K_SCHALTER);
      neu(pf("kill/hoch"), k, Rolle::kill_hoch, 0, 1, 0, MS(5), false, false, true, true, K_SCHALTER);
      neu(pf("filter"), k, Rolle::filter, -1, 1, 0, MS(20), false, false, false, false, linear(-1, 1));
      for (int s = 1; s <= 4; s++) {
        char rest[16];
        std::snprintf(rest, sizeof rest, "send/%d", s);
        neu(pf(rest), k, Rolle::send, -200, 0, -200, MS(10), false, true, false, false, K_FADER);
      }
      if (!bus) neu(pf("ziel"), k, Rolle::ziel, 0, 4, 0, 0, true, false, true, true, stufen(0, 4));
      if (deck) {
        neu(pf("stem/drums"), k, Rolle::stem_drums, -200, 6, 0, MS(10), false, true, false, false, K_EQ, i);
        neu(pf("stem/bass"), k, Rolle::stem_bass, -200, 6, 0, MS(10), false, true, false, false, K_EQ, i);
        neu(pf("stem/vocals"), k, Rolle::stem_vocals, -200, 6, 0, MS(10), false, true, false, false, K_EQ, i);
        neu(pf("stem/other"), k, Rolle::stem_other, -200, 6, 0, MS(10), false, true, false, false, K_EQ, i);
      }
      neu(pf("xseite"), k, Rolle::xseite, 0, 2, 1, 0, true, false, true, true, stufen(0, 2));
      neu(pf("pfl"), k, Rolle::pfl, 0, 1, 0, 0, true, false, true, true, K_SCHALTER);
      if (!bus) {   // Kompressor je Quellkanal (Plan 2026-10-11-effekt-sektion.md): nach EQ/Filter, vor dem Fader; alle dürfen
        neu(pf("komp/an"), k, Rolle::komp_an, 0, 1, 0, 0, false, false, true, true, K_SCHALTER);
        neu(pf("komp/schwelle"), k, Rolle::komp_schwelle, -60, 0, -18, MS(10), false, false, false, false, linear(-60, 0));
        neu(pf("komp/ratio"), k, Rolle::komp_ratio, 1, 20, 4, MS(10), false, false, false, false, linear(1, 20));
        neu(pf("komp/attack"), k, Rolle::komp_attack, 0.1f, 100, 10, MS(10), false, false, false, false, linear(0.1f, 100));
        neu(pf("komp/release"), k, Rolle::komp_release, 10, 1000, 120, MS(10), false, false, false, false, linear(10, 1000));
        neu(pf("komp/makeup"), k, Rolle::komp_makeup, 0, 24, 0, MS(10), false, false, false, false, linear(0, 24));
        neu(pf("komp/mix"), k, Rolle::komp_mix, 0, 1, 1, MS(10), false, false, false, false, linear(0, 1));
        // Sidechain: 0 = eigenes Signal, sonst Quellkanal + 1 (deck/1 = 1 … erz/1 = 5 … pad/2 = 14), Schlüssel ist dessen Eingang
        neu(pf("komp/sc"), k, Rolle::komp_sc, 0, 14, 0, 0, false, false, true, true, stufen(0, 14));
      }
      if (deck) neu(pf("transport"), k, Rolle::transport, 0, 0, 0, 0, true, false, true, true, K_SCHALTER, i);
    }
  }
  const int master = kanal("master");
  const int cue = kanal("cue");
  neu("xfader", -1, Rolle::xfader, -1, 1, 0, MS(10), true, false, false, false, linear(-1, 1));
  neu("master/pegel", master, Rolle::master_pegel, -200, 0, 0, MS(10), true, true, false, false, K_FADER);
  neu("master/kleber", master, Rolle::master_kleber, 0, 1, 0, MS(10), true, false, false, false, linear(0, 1));
  neu("cue/mix", cue, Rolle::cue_mix, -1, 1, -1, MS(10), true, false, false, false, linear(-1, 1));
  neu("cue/pegel", cue, Rolle::cue_pegel, -200, 0, -12, MS(10), true, true, false, false, K_FADER);
  neu("cue/split", cue, Rolle::cue_split, 0, 1, 0, 0, true, false, true, true, K_SCHALTER);
  for (int n = 1; n <= 2; n++) {
    std::snprintf(p, sizeof p, "fx/%d/notenwert", n);
    neu(p, -1, Rolle::fx_notenwert, 1.0f / 32, 4, 0.75f, 0, false, false, true, false, linear(1.0f / 32, 4));
  }
  for (int n = 1; n <= 2; n++) {
    std::snprintf(p, sizeof p, "fx/%d/rueckkopplung", n);
    neu(p, -1, Rolle::fx_rueckkopplung, 0, 0.95f, 0.5f, MS(10), false, false, false, false, linear(0, 0.95f));
  }
  for (int n = 1; n <= 4; n++) {
    std::snprintf(p, sizeof p, "fx/%d/rueckweg", n);
    neu(p, -1, Rolle::fx_rueckweg, -200, 0, 0, MS(10), false, true, false, false, K_FADER);
  }
  neu("duck/tiefe", -1, Rolle::duck_tiefe, -24, 0, 0, MS(10), false, true, false, false, linear(-24, 0));
  neu("duck/release", -1, Rolle::duck_release, 50, 600, 200, 0, false, false, true, false, linear(50, 600));
  // Keylock Task 3 (Plan 2026-10-06-keylock-echtzeit.md, Fassung 4; Andreas 06.10.: „an jeder dj software gibts nen knopf
  // der über alles die tonhöhe gleichhält“): EIN Schalter für Decks, Loop-Boxen und Loop auf dem Deck, Vorgabe 1, kein
  // Deck-Argument (sonst keine_stems, Prüfer B1), alle Quellen; Argumentfolge wie transport.
  neu("keylock", -1, Rolle::keylock, 0, 1, 1, 0, false, false, true, true, K_SCHALTER);
  // MASTER CUE (Andreas 2026-10-10: „master braucht auch pfl“): Master in die PFL-Summe des Kopfhörers, nur Hand
  neu("master/pfl", master, Rolle::master_pfl, 0, 1, 0, 0, true, false, true, true, K_SCHALTER);
  // SOUND COLOR FX (Andreas 2026-10-11: „lass erstmal wie am xz machen“): Art und PARAMETER global wie am Pult, der
  // COLOR-Regler ist <k>/filter. Art 0 FILTER, 1 SPACE, 2 DUB ECHO, 3 SWEEP, 4 NOISE, 5 CRUSH; alle dürfen.
  neu("color/art", -1, Rolle::color_art, 0, 5, 0, 0, false, false, true, true, stufen(0, 5));
  neu("color/param", -1, Rolle::color_param, 0, 1, 0.5f, MS(10), false, false, false, false, linear(0, 1));
  // D1 K1 (Spec 2.3): Spur-Regler des Arrangements, global (Kanal −1, keine neuen Kanäle), alle dürfen. Fader −200 bis
  // +6 dB (Spec 6.16), Vorgabe 0 dB (die Gruppe regelt erz/4), Mute und Solo schalten ohne Rampe: die 10-ms-Blende macht
  // das Modul Arrangement.
  for (int n = 1; n <= SPUR_REGLER_SPUREN; n++) {
    std::snprintf(p, sizeof p, "spur/%d/fader", n);
    neu(p, -1, Rolle::spur_fader, -200, 6, 0, MS(10), false, true, false, false, K_SPUR_FADER);
    std::snprintf(p, sizeof p, "spur/%d/pan", n);
    neu(p, -1, Rolle::spur_pan, -1, 1, 0, MS(10), false, false, false, false, linear(-1, 1));
    std::snprintf(p, sizeof p, "spur/%d/mute", n);
    neu(p, -1, Rolle::spur_mute, 0, 1, 0, 0, false, false, true, true, K_SCHALTER);
    std::snprintf(p, sizeof p, "spur/%d/solo", n);
    neu(p, -1, Rolle::spur_solo, 0, 1, 0, 0, false, false, true, true, K_SCHALTER);
  }
  // The four controls of one group; used for groups 1..8 here and for groups 9..16 at the end of the table (nested groups task 1).
  auto gruppen_regler = [&](int n) {
    std::snprintf(p, sizeof p, "grp/%d/fader", n);
    neu(p, -1, Rolle::grp_fader, -200, 6, 0, MS(10), false, true, false, false, K_SPUR_FADER);
    std::snprintf(p, sizeof p, "grp/%d/pan", n);
    neu(p, -1, Rolle::grp_pan, -1, 1, 0, MS(10), false, false, false, false, linear(-1, 1));
    std::snprintf(p, sizeof p, "grp/%d/mute", n);
    neu(p, -1, Rolle::grp_mute, 0, 1, 0, 0, false, false, true, true, K_SCHALTER);
    std::snprintf(p, sizeof p, "grp/%d/solo", n);
    neu(p, -1, Rolle::grp_solo, 0, 1, 0, 0, false, false, true, true, K_SCHALTER);
  };
  // 1.10 Slice 1 (Spec 5.3): Gruppen-Regler und Fader des Produktions-Masters, global (Kanal −1), alle dürfen. Werte und Rampen wie
  // spur/<n>/*; die Blende von Mute und Solo macht das Modul Arrangement (arr_output.cpp). Am Ende der Tabelle: kein Index wandert.
  for (int n = 1; n <= GRP_REGLER_GRUPPEN; n++) {
    gruppen_regler(n);
  }
  neu("pm/fader", -1, Rolle::pm_fader, -200, 6, 0, MS(10), false, true, false, false, K_SPUR_FADER);
  // S5r: acht Graph-Regler je Kanal, auf dem der Kern einen Baukasten-Graphen annimmt: deck/1..4 (Effekt über
  // /k/kanal/graph) und die Instrument-Kanäle von /erz/strom bk:<name> (net_erz.cpp: erz/1..8 und pad/1..2 ohne erz/4,
  // reserviert für die Produktion, und ohne erz/8, Nur-Cue-Vorhöreingang). Am Tabellenende, damit kein Index wandert.
  // Schaltrampe 0: die FFI glättet selbst 20 ms (K15). Gegen das echte Verhalten gepinnt in test_net_erz.cpp.
  for (const char* kn_bk : {"deck/1", "deck/2", "deck/3", "deck/4", "erz/1", "erz/2", "erz/3", "erz/5", "erz/6", "erz/7", "pad/1", "pad/2"}) {
    const int k = kanal_suche(kn_bk);
    for (int nr = 1; nr <= 8; nr++) {
      std::snprintf(p, sizeof p, "%s/bk/%d", kn_bk, nr);
      neu(p, k, Rolle::bk_regler, 0, 1, 0.5f, 0, false, false, false, false, linear(0, 1));
    }
  }
  // 1.10 Slice 3 (Spec 5.3), 204 controls, global (channel -1), everybody may. Appended after the bk block: no index moves.
  // Sends and the return fader: -200..+6 dB, curve K_SPUR_FADER, ramp 10 ms; a send defaults to -200 (off), the return fader to 0 dB.
  // ret/<r>/pan is a balance like grp/<n>/pan. ret/<r>/hall/* are normalised 0..1 (mapping to units: arr_returns.cpp), defaults hit the
  // Cypher Hall defaults (decay 2 s, size 60 ms, pre 10 ms, low decay 1.2, high cut 12 kHz, tail 0 dB). hall/an is a switch without ramp.
  // NAME TRAP: ret/<r>/hall/pre is the pre-delay of the hall, NOT a pre/post fader switch (that comes as a structure in slice 4).
  for (int r = 1; r <= RET_REGLER_RETURNS; r++) {
    for (int n = 1; n <= SPUR_REGLER_SPUREN; n++) {
      std::snprintf(p, sizeof p, "spur/%d/send/%d", n, r);
      neu(p, -1, Rolle::snd_spur, -200, 6, -200, MS(10), false, true, false, false, K_SPUR_FADER);
    }
    for (int n = 1; n <= GRP_REGLER_GRUPPEN; n++) {
      std::snprintf(p, sizeof p, "grp/%d/send/%d", n, r);
      neu(p, -1, Rolle::snd_grp, -200, 6, -200, MS(10), false, true, false, false, K_SPUR_FADER);
    }
    std::snprintf(p, sizeof p, "ret/%d/fader", r);
    neu(p, -1, Rolle::ret_fader, -200, 6, 0, MS(10), false, true, false, false, K_SPUR_FADER);
    std::snprintf(p, sizeof p, "ret/%d/pan", r);
    neu(p, -1, Rolle::ret_pan, -1, 1, 0, MS(10), false, false, false, false, linear(-1, 1));
    std::snprintf(p, sizeof p, "ret/%d/mute", r);
    neu(p, -1, Rolle::ret_mute, 0, 1, 0, 0, false, false, true, true, K_SCHALTER);
    std::snprintf(p, sizeof p, "ret/%d/solo", r);
    neu(p, -1, Rolle::ret_solo, 0, 1, 0, 0, false, false, true, true, K_SCHALTER);
    std::snprintf(p, sizeof p, "ret/%d/hall/an", r);
    neu(p, -1, Rolle::ret_hall_an, 0, 1, 1, 0, false, false, true, true, K_SCHALTER);
    struct HallW { const char* feld; Rolle rolle; float vorgabe; };
    const HallW hall[] = {{"pre", Rolle::ret_hall_pre, 0.04f},         {"decay", Rolle::ret_hall_decay, 0.5252f},
                          {"groesse", Rolle::ret_hall_groesse, 0.282f}, {"tief", Rolle::ret_hall_tief, 0.5658f},
                          {"highcut", Rolle::ret_hall_highcut, 0.8039f}, {"fahne", Rolle::ret_hall_fahne, 0.66667f}};
    for (const HallW& h : hall) {
      std::snprintf(p, sizeof p, "ret/%d/hall/%s", r, h.feld);
      neu(p, -1, h.rolle, 0, 1, h.vorgabe, MS(10), false, false, false, false, linear(0, 1));
    }
  }
  // S14: eight graph knobs per send return fx/3, fx/4 (effect graph of section 4.10 on send bus 3, 4). Global (channel -1) like
  // fx/<n>/rueckweg: fx/3 is a send bus, not a mixer channel. The kern maps them to the rows MIX_BK_SEND_ZEILE + 0/1 of its
  // knob matrix (core.cpp). Appended after the ret block: no index moves (897..912). Same shape as the kn_bk loop above,
  // so djk/contract/check_name_lists.py reads the list. Ramp 0: the FFI smooths 20 ms.
  for (const char* kn_bk_send : {"fx/3", "fx/4"}) {
    for (int nr = 1; nr <= 8; nr++) {
      std::snprintf(p, sizeof p, "%s/bk/%d", kn_bk_send, nr);
      neu(p, -1, Rolle::bk_regler, 0, 1, 0.5f, 0, false, false, false, false, linear(0, 1));
    }
  }
  // 1.15 A1b (mix tools, INTERFACES section 1.5), 345 controls, everybody may. Appended after the fx/3|4 bk block: no index moves
  // (913..1257). Dedicated loops over the one flat table tool_controls.h, never inside the per-channel loop above: erz/8 and the
  // buses must not get rows of tools they do not carry. Ramp 10 ms for continuous rows, none for switches and steps (like komp/*).
  for (const WerkzeugZeile& z : WERKZEUG_ZEILEN) {
    const Kurve kv{z.kurve, z.min, z.max, false};
    const bool ganz = z.ganz;
    const Rolle rolle = z.kanalart == WzKanalart::global ? Rolle::spektrum_kanal : Rolle::werkzeug;
    auto zeile = [&](const char* kn_wz) {
      if (kn_wz) std::snprintf(p, sizeof p, "%s/%s", kn_wz, z.suffix);
      else std::snprintf(p, sizeof p, "%s", z.suffix);
      neu(p, kn_wz ? kanal_suche(kn_wz) : -1, rolle, z.min, z.max, z.vorgabe, ganz ? 0 : MS(z.ms), false, false, ganz, ganz, kv);
    };
    if (z.kanalart == WzKanalart::global) zeile(nullptr);
    if (z.kanalart == WzKanalart::quellen || z.kanalart == WzKanalart::quellen_busse)
      for (const char* kn_wz : WERKZEUG_QUELLEN) zeile(kn_wz);
    if (z.kanalart == WzKanalart::busse || z.kanalart == WzKanalart::quellen_busse)
      for (const char* kn_wz : WERKZEUG_BUSSE) zeile(kn_wz);
  }
  // 1.10 slice 4a T1: the compressor inserts ins/komp/<1..12>/<parameter>, 120 controls, everybody may. Appended after the tool block: no
  // index moves (1258..1377). Generated from docs/interfaces/insert_module.json; the ranges equal the DJ-side komp/* rows (checked by
  // test_insert_vertrag). Curves: switch, steps or linear, as the DJ side. Global rows (channel -1): an insert belongs to a strip of the
  // arrangement, not to a mixer channel.
  for (const InsertZeile& z : INSERT_ZEILEN) {
    float mx = z.max;
#ifdef CYPHERDJ_MUTATION_INS_BEREICH
    if (z.rolle == Rolle::ins_komp_schwelle) mx = 6;   // mutation: threshold up to +6 dB, the range parity test must go red
#endif
    const Kurve kv{z.kurve, z.min, mx, false};
    neu(z.pfad, -1, z.rolle, z.min, mx, z.vorgabe, z.ganz ? 0 : MS(z.rampe_ms), false, false, z.ganz, z.ganz, kv);
  }
  // 32-knob widening (2026-11-11): the Baukasten knobs 9..32 of the channels and send returns. Appended after the insert block so that
  // no index of the rows above moves (the rows 1..8 stay at their old index; ins/bk/<n>/k9..k32 come with the generated block above).
  // Same channel lists as the two bk loops above (pinned against net_erz.cpp in test_net_erz.cpp), same role, range, default and ramp.
  for (const char* kn_bk_hoch : {"deck/1", "deck/2", "deck/3", "deck/4", "erz/1", "erz/2", "erz/3", "erz/5", "erz/6", "erz/7", "pad/1", "pad/2"}) {
    const int k = kanal_suche(kn_bk_hoch);
    for (int nr = 9; nr <= 32; nr++) {
      std::snprintf(p, sizeof p, "%s/bk/%d", kn_bk_hoch, nr);
      neu(p, k, Rolle::bk_regler, 0, 1, 0.5f, 0, false, false, false, false, linear(0, 1));
    }
  }
  for (const char* kn_bk_send_hoch : {"fx/3", "fx/4"}) {
    for (int nr = 9; nr <= 32; nr++) {
      std::snprintf(p, sizeof p, "%s/bk/%d", kn_bk_send_hoch, nr);
      neu(p, -1, Rolle::bk_regler, 0, 1, 0.5f, 0, false, false, false, false, linear(0, 1));
    }
  }
  // 64-knob widening (2026-11-11): the rows 33..64, appended behind the rows 9..32 (same two loops, same order), so that no index above moves.
  for (const char* kn_bk_hoch2 : {"deck/1", "deck/2", "deck/3", "deck/4", "erz/1", "erz/2", "erz/3", "erz/5", "erz/6", "erz/7", "pad/1", "pad/2"}) {
    const int k = kanal_suche(kn_bk_hoch2);
    for (int nr = 33; nr <= BK_REGLER_N; nr++) {
      std::snprintf(p, sizeof p, "%s/bk/%d", kn_bk_hoch2, nr);
      neu(p, k, Rolle::bk_regler, 0, 1, 0.5f, 0, false, false, false, false, linear(0, 1));
    }
  }
  for (const char* kn_bk_send_hoch2 : {"fx/3", "fx/4"}) {
    for (int nr = 33; nr <= BK_REGLER_N; nr++) {
      std::snprintf(p, sizeof p, "%s/bk/%d", kn_bk_send_hoch2, nr);
      neu(p, -1, Rolle::bk_regler, 0, 1, 0.5f, 0, false, false, false, false, linear(0, 1));
    }
  }
  // Nested groups, task 1 (2026-11-12): groups 9..16, 64 controls, global (channel -1), everybody may. Appended behind the 64-knob block so that no
  // index moves (the loops of grp/1..8 above sit inside the first 1258 hashed rows). Same values and ramps as grp/1..8: fader/pan/mute/solo first, then
  // the sends in the order of the ret loop (return outer, group inner).
  for (int n = GRP_REGLER_GRUPPEN + 1; n <= GRP_REGLER_GRUPPEN_ALLE; n++) {
    gruppen_regler(n);
  }
  for (int r = 1; r <= RET_REGLER_RETURNS; r++) {
    for (int n = GRP_REGLER_GRUPPEN + 1; n <= GRP_REGLER_GRUPPEN_ALLE; n++) {
      std::snprintf(p, sizeof p, "grp/%d/send/%d", n, r);
      neu(p, -1, Rolle::snd_grp, -200, 6, -200, MS(10), false, true, false, false, K_SPUR_FADER);
    }
  }
  // Live modules task 6: headphone cue per group, grp/1..16/cue. A switch like <kanal>/pfl: only the hand sets it (nur_hand), no ramp. Appended at the very end so that no index
  // moves (the first 1258 rows are hashed). The group signal behind its chain and in front of its fader goes to the cue bus (arr_output.cpp).
  for (int n = 1; n <= GRP_REGLER_GRUPPEN_ALLE; n++) {
    std::snprintf(p, sizeof p, "grp/%d/cue", n);
    neu(p, -1, Rolle::grp_cue, 0, 1, 0, 0, true, false, true, true, K_SCHALTER);
  }
  for (int i = 0; i < n_; i++) sortiert_[i] = static_cast<int16_t>(i);
  std::sort(sortiert_, sortiert_ + n_, [&](int16_t a, int16_t b) { return std::strcmp(def_[a].pfad, def_[b].pfad) < 0; });
}

int ReglerTabelle::suche(const char* pfad) const {
  int lo = 0, hi = n_ - 1;
  while (lo <= hi) {
    const int mitte = (lo + hi) / 2;
    const int c = std::strcmp(def_[sortiert_[mitte]].pfad, pfad);
    if (c == 0) return sortiert_[mitte];
    if (c < 0) lo = mitte + 1; else hi = mitte - 1;
  }
  return -1;
}

int ReglerTabelle::kanal_suche(const char* name) const {
  for (int k = 0; k < n_kanal_; k++) if (std::strcmp(kanal_[k], name) == 0) return k;
  return -1;
}

int ReglerTabelle::regler_von(int kanal, Rolle rolle) const {
  for (int r = 0; r < n_; r++) if (def_[r].kanal == kanal && def_[r].rolle == rolle) return r;
  return -1;
}

float ReglerTabelle::zu_x(const Kurve& k, float w) {
  float x = 0;
  switch (k.typ) {
    case KurvenTyp::fader_db: x = w <= STUMM_GRENZE ? 0.0f : std::pow(10.0f, (w - k.max) / 20.0f); break;
    case KurvenTyp::linear:
      if (k.kill_unter_min && w < k.min) x = 0.0f; else x = (w - k.min) / (k.max - k.min);
      break;
    case KurvenTyp::schalter: x = w; break;
    case KurvenTyp::stufen: x = (w - k.min) / (k.max - k.min); break;
  }
  return std::min(1.0f, std::max(0.0f, x));
}

float ReglerTabelle::aus_x(const Kurve& k, float x) {
  x = std::min(1.0f, std::max(0.0f, x));
  switch (k.typ) {
    case KurvenTyp::fader_db: return x < 0.001f ? STUMM : k.max + 20.0f * std::log10(x);   // §7.2: unter -60 dB stumm
    case KurvenTyp::linear:
      if (k.kill_unter_min && x <= 0.0f) return STUMM;
      return k.min + x * (k.max - k.min);
    case KurvenTyp::schalter: return x >= 0.5f ? 1.0f : 0.0f;
    case KurvenTyp::stufen: return k.min + std::round(x * (k.max - k.min));
  }
  return 0.0f;
}

}  // namespace cypherdj::stellwerk
