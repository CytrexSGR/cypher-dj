// 1.10 slice 5 U1/U2a: the structural sidechain key of a compressor stage (spec 5.5, plan E2/E3/E8/E20, section 3.1).
//
// U2a: which strip may listen to which source is DATA: docs/interfaces/schluessel_regeln.json, generated into schluessel_regeln.inc (generate_key.py). arr_schluessel_pruefe()
// reads the generated table and the two dynamic rules (a strip keyed by its own output, a member keyed by its own group) and refuses every cell that is not `ja` with the reason
// of the answer in the message (sidechain_spaet, sidechain_zyklus, sidechain_quelle). The track cycle is found by arr_schluessel_rechnen().
//
// A key `{quelle: spur, nr, punkt: post}` names the output of track `nr` after its fader, pan and mute/solo fade. The mixer runs the tracks one after the other (chain,
// then fader loop); the post key of track B is only there when B has run, so a track whose stage listens to B's post must run after B. arr_schluessel_rechnen() fills
// ArrSnapshot::spur_ordnung with a stable topological order over these edges (the smallest ready track first, so the order is the identity when no edge exists and a
// project without such keys sums in the same order as before this slice) and refuses a playback with an edge that cannot be ordered: a track keyed by its own post (the
// strip depends on itself) and a cycle of tracks (A keyed by B post, B keyed by A post). The edges come from the stages of the TRACK chains only; a group, return or PM stage
// listening to a track post needs no edge, because every track has run before the group pass starts.
//
// U2b: DJ sources. `deck/1..4` and `erz/1` are inputs of the production mixer that the kernel hands to the arrangement before its block (Arrangement::dj_schluessel); the list of what
// is allowed is the generated SCHL_DJ. A DJ key is live only (an export has no deck signal, plan E7). Key alignment (plan E9): arr_schluessel_versatz() compares, for every compressor
// stage, the arrival of the key at its capture point with the arrival of the stage input, both read from the delay compensation table (arr_pdc.h) and the chains, and writes the delay of
// the key (a ring in ArrInserts) or the lag (shown, not corrected) into the stage.
//
// Header only, like arr_pdc.h: the loader and the test harness (arr_build.h) call the same function once the chains are known. Runs in the load thread, never in the callback.
#pragma once

#include <algorithm>
#include <cstdint>
#include <string>

#include "cypherdj/arr_pdc.h"
#include "cypherdj/arr_playback.h"

namespace cdj {

#include "cypherdj/schluessel_regeln.inc"   // GENERATED: SCHL_JA.., SCHL_ZELLEN, SCHL_NUR_ZEILE, SCHL_GRUND, SCHL_DJ

// The answer for a DJ source named in a playback file ("deck", "erz", "pad") with its number: SCHL_JA, SCHL_ZYKLUS or SCHL_QUELLE (everything not in the generated list is SCHL_QUELLE).
inline uint8_t arr_schluessel_dj_urteil(const std::string& quelle, int64_t nr) {
  for (const SchlDj& e : SCHL_DJ)
    if (quelle == e.quelle && nr >= e.von && nr <= e.bis) return e.antwort;
  return SCHL_QUELLE;
}

// The answer (SCHL_JA, SCHL_SPAET, SCHL_ZYKLUS) for the stage `stufe` of the strip with chain index `streifen` (tracks 0..31, groups 32..39, PM 40, returns 41..44) keyed by `k`.
// The table says what the block order allows; two rules need the project and sit here: a strip keyed by its own output or input is a cycle, and so is a member track keyed by
// its own group (the group sums the member). A source number outside its range or a source kind the loader does not know is not a cell: the loader has refused it before.
inline uint8_t arr_schluessel_urteil(const ArrSnapshot& s, int streifen, const ArrSchluessel& k) {
  int v = 0, nr = 0;   // consumer kind and number (1-based)
  if (streifen < ARR_SPUREN) { v = 0; nr = streifen + 1; }
  else if (streifen < ARR_SPUREN + ARR_GRUPPEN) { v = 1; nr = streifen - ARR_SPUREN + 1; }
  else if (streifen == ARR_KETTE_PM) { v = 3; nr = 0; }
  else { v = 2; nr = streifen - ARR_KETTE_RET0 + 1; }
  const int q = static_cast<int>(k.quelle) - 1;
  if (k.quelle == ARR_SCHL_DECK) return arr_schluessel_dj_urteil("deck", k.nr);   // slice 5 U2b: a DJ input is there before the arrangement block, for every consumer
  if (k.quelle == ARR_SCHL_ERZ) return arr_schluessel_dj_urteil("erz", k.nr);
  if (q < 0 || q > 3 || k.punkt > 1) return SCHL_QUELLE;
  uint8_t a = SCHL_ZELLEN[v][q][k.punkt];
  if (v == q && v != 3 && k.nr == nr) a = SCHL_ZYKLUS;                                  // its own strip: the key depends on the consumer
  if (v == 0 && q == 1 && s.spur[streifen].ausgang == static_cast<int8_t>(k.nr)) a = SCHL_ZYKLUS;   // a member keyed by its own group
  return a;
}

// Checks every structural key of the playback against the table (loader, load thread). Returns false and names the strip, the key and the reason in *meldung.
inline bool arr_schluessel_pruefe(const ArrSnapshot& s, std::string* meldung = nullptr) {
#ifdef CYPHERDJ_MUTATION_SC_TABELLE_OFFEN
  (void)s;
  (void)meldung;
  return true;   // error case: the table is not consulted, every key the loader can parse is accepted
#endif
  static const char* const art_name[] = {"spur", "grp", "ret", "pm", "deck", "erz"};
  for (int c = 0; c < ARR_KETTEN; ++c) {
    const ArrKette& kt = s.kette[c];
    for (int j = 0; j < kt.n && j < ARR_KETTE; ++j) {
      const ArrSchluessel& k = kt.st[j].key;
      if (k.quelle == ARR_SCHL_KEINE) continue;
      const uint8_t a = arr_schluessel_urteil(s, c, k);
      if (a == SCHL_JA) continue;
      if (meldung) {
        std::string wer = c < ARR_SPUREN ? "track " + std::to_string(c + 1) : c < ARR_KETTE_PM ? "group " + std::to_string(c - ARR_SPUREN + 1) : c == ARR_KETTE_PM ? "PM" : "return " + std::to_string(c - ARR_KETTE_RET0 + 1);
        const int q = static_cast<int>(k.quelle) - 1;
        *meldung = "stage " + std::to_string(j + 1) + " of " + wer + " is keyed by " + (q >= 0 && q < 6 ? art_name[q] : "?") + (k.quelle == ARR_SCHL_PM ? "" : "/" + std::to_string(k.nr)) + " " +
                   (k.punkt == ARR_SCHL_PRE ? "pre" : "post") + ": " + SCHL_GRUND[a];
      }
      return false;
    }
  }
  return true;
}

// Fills s.spur_ordnung. Returns false and names the reason in *meldung (when given) if a track depends on itself or on a cycle; s.spur_ordnung is then the identity.
inline bool arr_schluessel_rechnen(ArrSnapshot& s, std::string* meldung = nullptr) {
  for (int i = 0; i < ARR_SPUREN; ++i) s.spur_ordnung[i] = static_cast<uint8_t>(i);
  uint32_t vor[ARR_SPUREN] = {};   // vor[c] = tracks that must run before track c (bit = index)
  for (int c = 0; c < ARR_SPUREN; ++c) {
    const ArrKette& k = s.kette[c];
    for (int j = 0; j < k.n && j < ARR_KETTE; ++j) {
      const ArrSchluessel& key = k.st[j].key;
      if (key.quelle != ARR_SCHL_SPUR || key.punkt != ARR_SCHL_POST) continue;
      if (key.nr < 1 || key.nr > ARR_SPUREN) continue;   // the loader has refused it before; a snapshot built by hand with a bad number simply has no edge
      if (key.nr - 1 == c) {
        if (meldung) *meldung = "track " + std::to_string(c + 1) + " is keyed by its own post (sidechain_zyklus)";
        return false;
      }
      vor[c] |= uint32_t{1} << (key.nr - 1);
    }
  }
#ifdef CYPHERDJ_MUTATION_SC_ORDNUNG_FEST
  uint32_t egal = 0;   // error case: the edges are checked but the order stays the identity
  for (int c = 0; c < ARR_SPUREN; ++c) egal |= vor[c];
  (void)egal;
  return true;
#endif
  uint32_t fertig = 0;
  for (int n = 0; n < ARR_SPUREN; ++n) {
    int w = -1;
    for (int c = 0; c < ARR_SPUREN && w < 0; ++c)
      if (!((fertig >> c) & 1u) && (vor[c] & ~fertig) == 0) w = c;
    if (w < 0) {
      if (meldung) {
        std::string t;
        for (int c = 0; c < ARR_SPUREN; ++c)
          if (!((fertig >> c) & 1u)) t += (t.empty() ? "" : ", ") + std::to_string(c + 1);
        *meldung = "tracks " + t + " key each other in a cycle through their post (sidechain_zyklus)";
      }
      for (int i = 0; i < ARR_SPUREN; ++i) s.spur_ordnung[i] = static_cast<uint8_t>(i);
      return false;
    }
    s.spur_ordnung[n] = static_cast<uint8_t>(w);
    fertig |= uint32_t{1} << w;
  }
  return true;
}

// ---- key alignment (slice 5 U2b, plan E9)

// Arrival (samples after the raw input of a track) of the input of the strip `streifen` (tracks 0..31, groups 32..39, PM 40, returns 41..44) in front of its chain.
inline int arr_schluessel_streifen_ankunft(const ArrSnapshot& s, int streifen) {
  if (streifen < ARR_SPUREN) return 0;
  if (streifen < ARR_KETTE_PM) return s.pdc.t_trk;
  if (streifen == ARR_KETTE_PM) return s.pdc.p_in;
  return s.pdc.in_r;
}
// Arrival of the input of stage `j` of the chain of `streifen`: the strip input plus the latencies of the stages in front of it (a bypassed stage counts like a running one, D10).
inline int arr_schluessel_stufe_ankunft(const ArrSnapshot& s, int streifen, int j) {
  int n = arr_schluessel_streifen_ankunft(s, streifen);
  const ArrKette& k = s.kette[streifen];
  for (int i = 0; i < j && i < k.n && i < ARR_KETTE; ++i) n += ins_latenz(k.st[i].art);
  return n;
}
// Arrival of the key at its capture point. The row sc (a track input before any chain) and the DJ inputs are raw: 0. The capture points of the mixer sit behind the alignment of their
// sum (track post: t_trk, group pre: t_trk, group post: t_g, return pre: in_r, return post: in_r plus the latency of the return chain).
inline int arr_schluessel_quelle_ankunft(const ArrSnapshot& s, const ArrSchluessel& k) {
  switch (k.quelle) {
    case ARR_SCHL_SPUR: return k.punkt == ARR_SCHL_POST ? s.pdc.t_trk : 0;
    case ARR_SCHL_GRP: return k.punkt == ARR_SCHL_PRE ? s.pdc.t_trk : s.pdc.t_g;
    case ARR_SCHL_RET:
      if (k.nr < 1 || k.nr > ARR_RETURNS) return s.pdc.in_r;
      return k.punkt == ARR_SCHL_PRE ? s.pdc.in_r : s.pdc.in_r + arr_kette_latenz(s.kette[ARR_KETTE_RET0 + k.nr - 1]);
    default: return 0;
  }
}

// Fills schl_verz, schl_verz_zeile and schl_spaet of every compressor stage (call after arr_pdc_rechnen(); the PDC table must be current). Returns false and names the needed and the
// maximal delay in *meldung when a structural key would need a delay of `grenze` samples or more (the loader refuses it with `format`). `grenze` is the ring length; a test passes a
// smaller one because the pools hold at most two latency stages, which never reach the real bound.
inline bool arr_schluessel_versatz(ArrSnapshot& s, std::string* meldung = nullptr, int grenze = ARR_SCHL_VERZ_MAX) {
  for (int c = 0; c < ARR_KETTEN; ++c) {
    ArrKette& kt = s.kette[c];
    for (int j = 0; j < kt.n && j < ARR_KETTE; ++j) {
      ArrStufe& st = kt.st[j];
      st.schl_verz = st.schl_verz_zeile = st.schl_spaet = 0;
      if (st.art != ArrInsArt::komp) continue;
      const int ein = arr_schluessel_stufe_ankunft(s, c, j);
#ifdef CYPHERDJ_MUTATION_SC_VERSATZ_EINE_STUFE
      const int nah = j > 0 ? ins_latenz(kt.st[j - 1].art) : 0;   // error case: the delay is the latency of the nearest stage in front, not the path sum
      const int zeile = ein > 0 ? std::min(ein, nah) : 0;
#else
      const int zeile = ein;
#endif
      st.schl_verz_zeile = static_cast<uint16_t>(std::min(zeile, grenze - 1));   // the row key is dynamic: it cannot be refused, the delay is clamped to the ring
      if (st.key.quelle == ARR_SCHL_KEINE) continue;
      const int quelle = arr_schluessel_quelle_ankunft(s, st.key);
      if (quelle >= ein) {
        st.schl_spaet = static_cast<uint16_t>(std::min(quelle - ein, 65535));
        continue;
      }
#ifdef CYPHERDJ_MUTATION_SC_VERSATZ_EINE_STUFE
      const int d = std::min(ein - quelle, nah);
#else
      const int d = ein - quelle;
#endif
      if (d >= grenze) {
        if (meldung) {
          std::string wer = c < ARR_SPUREN ? "track " + std::to_string(c + 1) : c < ARR_KETTE_PM ? "group " + std::to_string(c - ARR_SPUREN + 1) : c == ARR_KETTE_PM ? "PM" : "return " + std::to_string(c - ARR_KETTE_RET0 + 1);
          *meldung = "stage " + std::to_string(j + 1) + " of " + wer + " needs a key delay of " + std::to_string(d) + " samples, the key ring holds at most " + std::to_string(grenze - 1) + " (key_verzoegerung_zu_lang)";
        }
        return false;
      }
      st.schl_verz = static_cast<uint16_t>(d);
    }
  }
  return true;
}

}  // namespace cdj
