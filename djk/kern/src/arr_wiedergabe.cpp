// D1 K1: Wiedergabe lesen, prüfen, Audio laden (arr_wiedergabe.h). Muster: fassung.cpp (nlohmann, Feldprüfung mit
// Namen), lader.cpp (mmap + MAP_POPULATE + mlock, Budget vor dem Einblenden).
#include "cypherdj/arr_wiedergabe.h"
#include "cypherdj/arr_pdc.h"
#include "cypherdj/arr_schluessel.h"
#include "cypherdj/arr_inserts.h"

#include "cypherdj/cypher_bk_ffi.h"

#include <fcntl.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>

#include <algorithm>
#include <cerrno>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iterator>
#include <new>
#include <set>
#include <stdexcept>

#include <nlohmann/json.hpp>

namespace cdj {

namespace {

using json = nlohmann::json;

// Fehler mit Grund-Code (Spec 3.1) und Meldung
struct Abbruch : std::runtime_error {
  std::string grund;
  Abbruch(std::string g, const std::string& m) : std::runtime_error(m), grund(std::move(g)) {}
};

[[noreturn]] void format(const std::string& m) { throw Abbruch("format", m); }

// The one table of lane targets (automation slice 2): project string -> core target, device parameter index, range and form rule. The ranges
// repeat ZIEL_BEREICH in modell.ts. nur_sprung: only jump points (form 2) with the value 0 or 1 (mute, solo).
// 1.12 slice 5 (D7, D9): rel_min/rel_max is the range of a RELATIVE lane of that target (a summand: dB for the fader, pan units, device units); for mute and solo
// nur_sprung also means "no relative lane".
struct AutoZiel {
  const char* name;
  uint8_t ziel, param;
  double min, max;
  bool nur_sprung;
  double rel_min, rel_max;
};
constexpr AutoZiel AUTO_ZIELE[] = {
    {"fader", ARR_AUTO_FADER, 0, -200.0, 6.0, false, -60.0, 6.0},
    {"pan", ARR_AUTO_PAN, 0, -1.0, 1.0, false, -2.0, 2.0},
    {"mute", ARR_AUTO_MUTE, 0, 0.0, 1.0, true, 0.0, 0.0},
    {"solo", ARR_AUTO_SOLO, 0, 0.0, 1.0, true, 0.0, 0.0},
    {"geraet.lautstaerke", ARR_AUTO_GERAET, 0, 0.0, 1.0, false, -1.0, 1.0},   // param = index into the device parameter names
    {"geraet.cutoff", ARR_AUTO_GERAET, 1, 0.0, 1.0, false, -1.0, 1.0},
    {"geraet.resonanz", ARR_AUTO_GERAET, 2, 0.0, 1.0, false, -1.0, 1.0},
    {"geraet.env_mod", ARR_AUTO_GERAET, 3, 0.0, 1.0, false, -1.0, 1.0},
};
static_assert(2 * sizeof(AUTO_ZIELE) / sizeof(AUTO_ZIELE[0]) == ARR_AUTO_LANES_JE_SPUR, "one absolute and one relative lane per target and track: 2 x 8");

constexpr bool gleich(const char* a, const char* b) {
  while (*a && *a == *b) ++a, ++b;
  return *a == *b;
}
constexpr bool geraet_namen_gebunden() {   // every geraet.* entry carries the name ARR_GERAET_PARAM_NAME[param] after the prefix
  for (const AutoZiel& z : AUTO_ZIELE)
    if (z.ziel == ARR_AUTO_GERAET && !gleich(z.name + 7, ARR_GERAET_PARAM_NAME[z.param])) return false;
  return true;
}
static_assert(geraet_namen_gebunden(), "AUTO_ZIELE geraet.* entries must match ARR_GERAET_PARAM_NAME");

const json& feld(const json& o, const char* name, const std::string& wo) {
  if (!o.is_object() || !o.contains(name)) format(wo + name + " fehlt");
  return o.at(name);
}
double zahl(const json& o, const char* name, const std::string& wo) {
  const json& w = feld(o, name, wo);
  if (!w.is_number()) format(wo + name + " ist keine Zahl");
  const double d = w.get<double>();
  if (!std::isfinite(d)) format(wo + name + " nicht endlich");
  return d;
}
int64_t ganz(const json& o, const char* name, const std::string& wo) {
  const json& w = feld(o, name, wo);
  if (!w.is_number_integer()) format(wo + name + " ist keine ganze Zahl");
  return w.get<int64_t>();
}
std::string text(const json& o, const char* name, const std::string& wo) {
  const json& w = feld(o, name, wo);
  if (!w.is_string()) format(wo + name + " ist kein Text");
  return w.get<std::string>();
}

// D1 Spec 6.14: lexikalisch normalisiert, ohne abschließenden Schrägstrich (Symlinks löst sie nicht auf)
std::string normal(const std::string& p) {
  std::string n = std::filesystem::path(p).lexically_normal().string();
  while (n.size() > 1 && n.back() == '/') n.pop_back();
  return n;
}

// Index des ersten nicht endlichen Werts, −1: alle endlich. Bitweise (Exponent alle Einsen), damit der Vergleich ohne
// Gleitkomma-Ausnahmen und vektorisiert läuft; je 1024 Werte ein Ausstieg.
int64_t erstes_unendliches(const float* x, int64_t n) {
  for (int64_t a = 0; a < n; a += 1024) {
    const int64_t e = std::min<int64_t>(n, a + 1024);
    uint32_t schlecht = 0;
    for (int64_t i = a; i < e; ++i) {
      uint32_t u;
      std::memcpy(&u, x + i, sizeof u);
      schlecht |= static_cast<uint32_t>((u & 0x7f800000u) == 0x7f800000u);
    }
    if (schlecht)
      for (int64_t i = a; i < e; ++i)
        if (!std::isfinite(x[i])) return i;
  }
  return -1;
}

// 1.10 slice 4a/4b: the insert chain of a strip, `chain: [{art: "komp" | "eq" | "saett" | "lim", slot: 1..pool of the kind, an: bool}, ...]` (at most ARR_KETTE stages,
// optional; an defaults to true). A slot belongs to one stage of the whole playback (the pool is shared): slot_belegt (ARR_INS_ALLE entries, global index) marks the used ones.
void lese_kette(const json& o, const std::string& wo, ArrKette& k, bool* slot_belegt) {
  if (!o.contains("chain")) return;
  const json& ch = o.at("chain");
  if (!ch.is_array()) format(wo + "chain ist keine Liste");
  if (ch.size() > static_cast<size_t>(ARR_KETTE)) format(wo + "chain: kette_voll (more than " + std::to_string(ARR_KETTE) + " stages)");
  for (size_t j = 0; j < ch.size(); ++j) {
    const json& x = ch[j];
    const std::string wx = wo + "chain[" + std::to_string(j) + "].";
    const std::string art = text(x, "art", wx);
    ArrInsArt a = ArrInsArt::leer;
    int pool = 0, versatz = 0;
    if (art == "komp") { a = ArrInsArt::komp; pool = ARR_INS_KOMP; versatz = 0; }
    else if (art == "eq") { a = ArrInsArt::eq; pool = ARR_INS_EQ; versatz = ARR_INS_KOMP; }
    else if (art == "saett") { a = ArrInsArt::saett; pool = ARR_INS_SAETT; versatz = ARR_INS_KOMP + ARR_INS_EQ; }
    else if (art == "lim") { a = ArrInsArt::lim; pool = ARR_INS_LIM; versatz = ARR_INS_KOMP + ARR_INS_EQ + ARR_INS_SAETT; }
    else format(wx + "art " + art + " unbekannt (art_unbekannt; komp, eq, saett, lim)");
    const int64_t sl = ganz(x, "slot", wx);
    if (sl < 1 || sl > pool) format(wx + "slot außerhalb 1 bis " + std::to_string(pool) + " (" + art + ")");
    if (slot_belegt[versatz + sl - 1]) format(wx + "slot " + art + "/" + std::to_string(sl) + " doppelt");
    slot_belegt[versatz + sl - 1] = true;
    bool an = true;
    if (x.contains("an")) {
      if (!x.at("an").is_boolean()) format(wx + "an ist kein Wahrheitswert");
      an = x.at("an").get<bool>();
    }
    ArrSchluessel key;
    if (x.contains("key")) {   // 1.10 slice 5: the structural sidechain key {q: "spur" | "grp" | "ret" | "pm", nr, punkt: "pre" | "post"}; only a compressor has a key
      const json& kj = x.at("key");                       // which strip may listen to which source is the table of arr_schluessel_pruefe(), called once all strips are read
      const std::string wk = wx + "key.";
      if (!kj.is_object()) format(wk + "key ist kein Objekt");
      if (a != ArrInsArt::komp) format(wk + "only a komp stage has a sidechain key (" + art + ")");
      const std::string q = text(kj, "q", wk);
      int nmax = 0;
      bool dj = false;
      if (q == "spur") { key.quelle = ARR_SCHL_SPUR; nmax = ARR_SPUREN; }
      else if (q == "grp") { key.quelle = ARR_SCHL_GRP; nmax = ARR_GRUPPEN; }
      else if (q == "ret") { key.quelle = ARR_SCHL_RET; nmax = ARR_RETURNS; }
      else if (q == "pm") key.quelle = ARR_SCHL_PM;   // refused by the table (sidechain_zyklus); the number means nothing
      else if (q == "deck" || q == "erz" || q == "pad") dj = true;   // slice 5 U2b: the DJ inputs; the generated list says which are allowed
      else format(wk + "q " + q + " unbekannt (spur, grp, ret, pm, deck, erz, pad)");
      if (dj) {
        const int64_t kn = ganz(kj, "nr", wk);
        if (const uint8_t ant = arr_schluessel_dj_urteil(q, kn); ant != SCHL_JA)   // erz/2..8, pad/1..2: not available in the block; erz/4: the arrangement's own output
          format(wk + q + "/" + std::to_string(kn) + " cannot be a key (" + SCHL_GRUND[ant] + ")");
        key.quelle = q == "deck" ? ARR_SCHL_DECK : ARR_SCHL_ERZ;
        key.nr = static_cast<uint8_t>(kn);
        key.punkt = ARR_SCHL_POST;   // a DJ input has no pre and post; punkt may be left out, "pre" and "post" are both accepted and mean the same
        if (kj.contains("punkt")) {
          const std::string punkt = text(kj, "punkt", wk);
          if (punkt != "pre" && punkt != "post") format(wk + "punkt " + punkt + " unbekannt (pre, post)");
        }
      } else {
        if (nmax > 0) {
          const int64_t kn = ganz(kj, "nr", wk);
          if (kn < 1 || kn > nmax) format(wk + "nr außerhalb 1 bis " + std::to_string(nmax) + " (" + q + ")");
          key.nr = static_cast<uint8_t>(kn);
        }
        const std::string punkt = text(kj, "punkt", wk);
        if (punkt != "pre" && punkt != "post") format(wk + "punkt " + punkt + " unbekannt (pre, post)");
        key.punkt = punkt == "pre" ? ARR_SCHL_PRE : ARR_SCHL_POST;
        for (const auto& z : SCHL_NUR_ZEILE)   // the generated list of sources that exist only as the row sc (today: track pre; the pair has one writer)
          if (static_cast<int>(key.quelle) - 1 == z[0] && key.punkt == z[1])
            format(wk + "punkt " + punkt + " of " + q + " is the row sc, not a key (the pair has one writer)");
      }
    }
    k.st[k.n++] = ArrStufe{a, static_cast<uint8_t>(sl - 1), an, key};
  }
}

// 1.10 slice 4c T15: the rack of a strip, `rack: {slot: 1..ARR_RACKS, ziele: [{makro: 0..3, stufe: position in the chain of the strip, param: parameter index of the stage kind, von, bis}, ...]}`
// (optional; only on a strip with a chain; at most ARR_MAKRO_ZIELE targets). A rack slot belongs to one strip of the whole playback; a target (stufe, param) is driven by one macro only
// (one writer per parameter, spec D13). The stage switch (index 0) and the compressor key cannot be mapped. Every refusal names the field and the rule (reason `format`).
int ins_param_zahl(ArrInsArt a) {
  return a == ArrInsArt::komp ? INS_KOMP_PARAM : a == ArrInsArt::eq ? INS_EQ_PARAM : a == ArrInsArt::lim ? INS_LIM_PARAM : INS_SAETT_PARAM;
}
void lese_rack(const json& o, const std::string& wo, const ArrKette& k, ArrRack& r, bool* rack_belegt) {
  if (!o.contains("rack")) return;
  const json& rj = o.at("rack");
  const std::string wr = wo + "rack.";
  if (!rj.is_object()) format(wr + "rack ist kein Objekt");
  if (k.n == 0) format(wr + "rack_ohne_kette (a rack maps parameters of the stages of the chain; the strip has none)");
  const int64_t sl = ganz(rj, "slot", wr);
  if (sl < 1 || sl > ARR_RACKS) format(wr + "slot außerhalb 1 bis " + std::to_string(ARR_RACKS));
  if (rack_belegt[sl - 1]) format(wr + "slot " + std::to_string(sl) + " doppelt");
  rack_belegt[sl - 1] = true;
  const json& zl = feld(rj, "ziele", wr);
  if (!zl.is_array()) format(wr + "ziele ist keine Liste");
#ifdef CYPHERDJ_MUTATION_MAKRO_LIMIT_17
  const size_t grenze = zl.size() > static_cast<size_t>(ARR_MAKRO_ZIELE) ? static_cast<size_t>(ARR_MAKRO_ZIELE) : zl.size();   // error case: the 17th and later targets are silently cut
#else
  if (zl.size() > static_cast<size_t>(ARR_MAKRO_ZIELE)) format(wr + "ziele: makro_voll (more than " + std::to_string(ARR_MAKRO_ZIELE) + " targets)");
  const size_t grenze = zl.size();
#endif
  bool belegt[ARR_KETTE][INS_PARAM_MAX] = {};
  r.slot = static_cast<int8_t>(sl - 1);
  r.n = 0;
  for (size_t j = 0; j < grenze; ++j) {
    const json& x = zl[j];
    const std::string wx = wr + "ziele[" + std::to_string(j) + "].";
    if (!x.is_object()) format(wx + "kein Objekt");
    const int64_t mk = ganz(x, "makro", wx), st = ganz(x, "stufe", wx), pa = ganz(x, "param", wx);
    if (mk < 0 || mk >= ARR_MAKROS) format(wx + "makro außerhalb 0 bis " + std::to_string(ARR_MAKROS - 1));
    if (st < 0 || st >= k.n) format(wx + "stufe " + std::to_string(st) + " ist nicht in der Kette (" + std::to_string(k.n) + " Stufen)");
    const ArrInsArt art = k.st[st].art;
    if (pa < 0 || pa >= ins_param_zahl(art)) format(wx + "param " + std::to_string(pa) + " außerhalb der Parameter der Stufe");
    if (pa == 0) format(wx + "param 0 (an) kann nicht gemappt werden");
    if (art == ArrInsArt::komp && pa == 9) format(wx + "param 9 (sc, der Schlüssel) kann nicht gemappt werden");
    if (belegt[st][pa]) format(wx + "ziel (stufe " + std::to_string(st) + ", param " + std::to_string(pa) + ") doppelt (ein Parameter hat eine Quelle)");
    belegt[st][pa] = true;
    ArrMakroZiel z;
    z.makro = static_cast<uint8_t>(mk);
    z.stufe = static_cast<uint8_t>(st);
    z.param = static_cast<uint8_t>(pa);
    z.von = static_cast<float>(zahl(x, "von", wx));
    z.bis = static_cast<float>(zahl(x, "bis", wx));
    if (!std::isfinite(z.von) || !std::isfinite(z.bis)) format(wx + "von/bis nicht als float darstellbar");
    r.z[r.n++] = z;
  }
}

// S20: the graph name rule = GRAPH_NAME in oberflaeche/graphen.ts = BK_GRAPH_NAME in modell.ts = kit_name_ok in netz_erz.cpp
bool bk_name_ok(const std::string& n) {
  if (n.empty() || n.size() > 32) return false;
  for (char c : n)
    if (!((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_' || c == '-')) return false;
  return true;
}
bool bk_knopf_ok(const std::string& k) { return k.size() == 2 && k[0] == 'k' && k[1] >= '1' && k[1] <= '8'; }

bool hex64(const std::string& s) {
  if (s.size() != 64) return false;
  for (char c : s)
    if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;
  return true;
}

}  // namespace

namespace {
// Die Bereiche eines Schnappschusses, die der Callback liest: Kopf und die vier Felder (je eigene Seiten)
template <class F>
void je_bereich(ArrSnapshot& s, F f) {
  f(static_cast<void*>(&s), arr_seiten(sizeof(ArrSnapshot)));
  if (s.clips.capacity()) f(static_cast<void*>(s.clips.data()), arr_seiten(s.clips.capacity() * sizeof(ArrClip)));
  if (s.noten.capacity()) f(static_cast<void*>(s.noten.data()), arr_seiten(s.noten.capacity() * sizeof(ArrNote)));
  if (s.noten_id.capacity())
    f(static_cast<void*>(s.noten_id.data()), arr_seiten(s.noten_id.capacity() * sizeof(uint64_t)));
  if (s.noten_id_index.capacity())
    f(static_cast<void*>(s.noten_id_index.data()), arr_seiten(s.noten_id_index.capacity() * sizeof(int32_t)));
  if (s.warps.capacity()) f(static_cast<void*>(s.warps.data()), arr_seiten(s.warps.capacity() * sizeof(ArrWarp)));   // Paket 1.13
  if (s.warp_beat.capacity()) f(static_cast<void*>(s.warp_beat.data()), arr_seiten(s.warp_beat.capacity() * sizeof(double)));
  if (s.warp_frame.capacity()) f(static_cast<void*>(s.warp_frame.data()), arr_seiten(s.warp_frame.capacity() * sizeof(double)));
  if (s.auto_lane_liste.capacity())   // Automation Slice 1
    f(static_cast<void*>(s.auto_lane_liste.data()), arr_seiten(s.auto_lane_liste.capacity() * sizeof(ArrAutoLane)));
  if (s.auto_punkte.capacity()) f(static_cast<void*>(s.auto_punkte.data()), arr_seiten(s.auto_punkte.capacity() * sizeof(ArrAutoPunkt)));
#ifndef CYPHERDJ_MUTATION_ARR_HK_NICHT_GEBUCHT   // error case: the gain envelope points are neither booked nor locked (pageable, past the account)
  if (s.hk_punkte.capacity())   // 1.12 slice 5 (D8): the gain envelopes of the clips
    f(static_cast<void*>(s.hk_punkte.data()), arr_seiten(s.hk_punkte.capacity() * sizeof(ArrAutoPunkt)));
#endif
}
}  // namespace

bool ArrAudioCache::sperre(ArrSnapshot& s, std::string& grund, std::string& meldung) {
#ifdef CYPHERDJ_MUTATION_ARR_SCHNAPPSCHUSS_OFFEN
  (void)s;
  (void)grund;
  (void)meldung;
  return true;   // Fehlerfall: weder gesperrt noch gebucht (auslagerbar, am Konto vorbei)
#else
  int64_t b = 0;
  je_bereich(s, [&](void*, size_t n) { b += static_cast<int64_t>(n); });
  if (konto_ && !konto_->belaste(b)) {
    grund = "zu_gross";
    meldung = "speicher_budget (Schnappschuss): " + std::to_string((konto_->gesperrt() + b) >> 20) + " MiB > " +
              std::to_string(konto_->budget() >> 20) + " MiB";
    return false;
  }
  if (sperren_) {
    int e = 0;
    je_bereich(s, [&](void* p, size_t n) {
      if (!e && mlock(p, n) != 0) e = errno;
    });
    if (e) {
      je_bereich(s, [&](void* p, size_t n) { munlock(p, n); });
      if (konto_) konto_->entlaste(b);
      grund = "zu_gross";
      meldung = std::string("Schnappschuss: mlock ") + std::strerror(e);
      return false;
    }
  }
  s.gesperrt_bytes = b;
  return true;
#endif
}

void ArrAudioCache::entsperre(ArrSnapshot& s) {
  if (!s.gesperrt_bytes) return;
  if (sperren_) je_bereich(s, [&](void* p, size_t n) { munlock(p, n); });
  if (konto_) konto_->entlaste(s.gesperrt_bytes);
  s.gesperrt_bytes = 0;
}

std::string wiedergabe_pfad(const std::string& ordner, int64_t nr) {
  return ordner + "/wiedergabe-" + std::to_string(nr) + ".json";
}

ArrAudioCache::~ArrAudioCache() {
  // S20: free every instance without asking the sink: the cache outlives the kern only in the render, where the kern is gone first, and
  // in the kern the loader thread (and so this cache) ends after the callback has stopped
  for (BkEintrag& e : bk_)
    if (e.h) cypher_bk_frei(e.h);
  for (CypherBk* h : bk_aufgeschoben_) cypher_bk_frei(h);
  for (KitEintrag& e : kit_)   // 1.9: the same for the kit store, with unlock and unbooking
    if (e.k) kit_freigeben(std::move(e));
  for (KitEintrag& e : kit_aufgeschoben_) kit_freigeben(std::move(e));
  for (auto& [sha, a] : audio_) {
    if (a->gesperrt) munlock(a->abbild, a->bytes);
    munmap(a->abbild, a->bytes);
    if (konto_) konto_->entlaste(static_cast<int64_t>(a->bytes) + arr_audio_kopf());   // Daten und Kopf
  }
}

ArrAudio* ArrAudioCache::hole(const std::string& sha256, const std::string& datei, int64_t frames, std::string& grund,
                              std::string& meldung) {
  auto it = audio_.find(sha256);
  if (it != audio_.end()) {
    if (it->second->frames != frames) {
      grund = "format";
      meldung = datei + ": frames " + std::to_string(frames) + ", geladen " + std::to_string(it->second->frames);
      return nullptr;
    }
#ifndef CYPHERDJ_MUTATION_ARR_CACHE_OHNE_REF
    ++it->second->ref;   // Fehlerfall ohne: ein geteiltes Audio fiele mit dem ersten Schnappschuss
#endif
    return it->second.get();
  }
  const int fd = open(datei.c_str(), O_RDONLY | O_CLOEXEC);
  if (fd < 0) {
    grund = "audio_fehlt";
    meldung = datei + ": " + std::strerror(errno);
    return nullptr;
  }
  struct stat st {};
  const size_t bytes = static_cast<size_t>(frames) * 2 * sizeof(float);
  if (fstat(fd, &st) != 0 || static_cast<size_t>(st.st_size) != bytes) {
    close(fd);
    grund = "format";
    meldung = datei + ": Größe " + std::to_string(st.st_size) + " statt frames · 8 = " + std::to_string(bytes);
    return nullptr;
  }
  const int64_t b = static_cast<int64_t>(bytes);
  if (gesperrt_ + b > budget_) {
    close(fd);
    grund = "zu_gross";
    meldung = "arr_budget: " + std::to_string((gesperrt_ + b) >> 20) + " MiB > " + std::to_string(budget_ >> 20) + " MiB";
    return nullptr;
  }
  const int64_t kb = b + arr_audio_kopf();   // K1-Fix-2 Punkt 3: auf dem Konto Daten und Kopf (eigene Seiten)
#ifdef CYPHERDJ_MUTATION_ARR_OHNE_KONTO
  if (false) {   // Fehlerfall: am gemeinsamen Konto vorbei (Decks und Arrangement verdrängen sich mit ENOMEM)
#else
  if (konto_ && !konto_->belaste(kb)) {
#endif
    close(fd);
    grund = "zu_gross";
    meldung = "speicher_budget: " + std::to_string((konto_->gesperrt() + kb) >> 20) + " MiB > " +
              std::to_string(konto_->budget() >> 20) + " MiB";
    return nullptr;
  }
  void* p = mmap(nullptr, bytes, PROT_READ, MAP_SHARED | (sperren_ ? MAP_POPULATE : 0), fd, 0);
  close(fd);
  if (p == MAP_FAILED) {
    if (konto_) konto_->entlaste(kb);
    grund = "zu_gross";
    meldung = datei + ": mmap " + std::strerror(errno);
    return nullptr;
  }
  bool gesperrt = false;
  if (sperren_) {
    if (mlock(p, bytes) != 0) {
      const int e = errno;
      munmap(p, bytes);
      if (konto_) konto_->entlaste(kb);
      grund = "zu_gross";
      meldung = datei + ": mlock " + std::strerror(e);
      return nullptr;
    }
    gesperrt = true;
  }
  // K1-Fix 5: NaN oder Inf im Audio wie im Deck-Lader (§13.2) abgelehnt, Grund format. Anders als dort die ganze Datei,
  // nicht 4096 Stichproben: Arrangement-Audio ist durch arr_budget begrenzt, und ein einziges NaN legt den Mix lahm.
#ifndef CYPHERDJ_MUTATION_ARR_OHNE_ENDLICH
  if (const int64_t bei = erstes_unendliches(static_cast<const float*>(p), frames * 2); bei >= 0) {
    if (gesperrt) munlock(p, bytes);
    munmap(p, bytes);
    if (konto_) konto_->entlaste(kb);
    grund = "format";
    meldung = datei + ": NaN oder Inf bei Frame " + std::to_string(bei / 2);
    return nullptr;
  }
#endif
  // K1-Fix-2 Punkt 3: der Kopf, den der Callback je Sample liest, in eigenen Seiten und gesperrt (der Kern sperrt beim
  // Start nur MCL_CURRENT; später angelegter Heap wäre auslagerbar)
  std::unique_ptr<ArrAudio> a;
  int kopf_fehler = 0;
  try {
    a = std::make_unique<ArrAudio>();
  } catch (const std::bad_alloc&) {
    kopf_fehler = ENOMEM;
  }
#ifndef CYPHERDJ_MUTATION_ARR_AUDIO_KOPF_OFFEN
  if (a && sperren_ && mlock(a.get(), static_cast<size_t>(arr_audio_kopf())) != 0) kopf_fehler = errno;
#endif
  if (kopf_fehler) {
    if (gesperrt) munlock(p, bytes);
    munmap(p, bytes);
    if (konto_) konto_->entlaste(kb);
    grund = "zu_gross";
    meldung = datei + ": Kopf " + std::strerror(kopf_fehler);
    return nullptr;
  }
  std::snprintf(a->sha256, sizeof a->sha256, "%s", sha256.c_str());
  a->daten = static_cast<const float*>(p);
  a->frames = frames;
  a->abbild = p;
  a->bytes = bytes;
  a->ref = 1;
  a->gesperrt = gesperrt;
  gesperrt_ += b;
  ArrAudio* roh = a.get();
  audio_.emplace(sha256, std::move(a));
  return roh;
}

void ArrAudioCache::gib(ArrAudio* a) {
  if (!a || --a->ref > 0) return;
  auto it = audio_.find(a->sha256);
  if (it == audio_.end()) return;
  if (a->gesperrt) munlock(a->abbild, a->bytes);
  munmap(a->abbild, a->bytes);
  if (konto_) konto_->entlaste(static_cast<int64_t>(a->bytes) + arr_audio_kopf());   // Daten und Kopf
  gesperrt_ -= static_cast<int64_t>(a->bytes);
  audio_.erase(it);   // gibt den Kopf frei (munmap seiner Seiten hebt die Sperre auf)
}

// ---- S20: graph store -------------------------------------------------------------------------------------------------
namespace {
constexpr size_t BK_DATEI_MAX = 4u << 20;   // a graph file larger than this is refused (a real graph is a few KiB)
}

int32_t ArrAudioCache::bk_hole(int nr, const std::string& graph, CypherBk** h, uint64_t* gen, std::string& grund,
                               std::string& meldung) {
  grund = "format";
  if (bk_ordner_.empty()) {
    meldung = "graph " + graph + ": no graph folder set";
    return -1;
  }
  const std::string pfad = bk_ordner_ + "/" + graph + ".json";
  std::ifstream f(pfad, std::ios::binary);
  if (!f) {
    meldung = "graph " + graph + ": " + pfad + " cannot be read";
    return -1;
  }
  const std::string text((std::istreambuf_iterator<char>(f)), std::istreambuf_iterator<char>());
  if (text.size() > BK_DATEI_MAX) {
    meldung = "graph " + graph + ": file larger than " + std::to_string(BK_DATEI_MAX >> 20) + " MiB";
    return -1;
  }
#ifdef CYPHERDJ_MUTATION_ARR_BK_OHNE_TEILEN
  const std::string schluessel = std::to_string(nr) + "|" + graph + "|" + std::to_string(arr_id(text)) + "|" + std::to_string(++bk_zaehler_);   // fault: never shared
  --bk_zaehler_;
#else
  const std::string schluessel = std::to_string(nr) + "|" + graph + "|" + std::to_string(arr_id(text));
#endif
  for (size_t i = 0; i < bk_.size(); ++i) {
    if (bk_[i].schluessel != schluessel) continue;
    ++bk_[i].ref;
    *h = bk_[i].h;
    *gen = bk_[i].gen;
    return static_cast<int32_t>(i);
  }
  char fehler[256] = {};
  const std::string wurzel = bk_ordner_ + "/samples";
  CypherBk* b = cypher_bk_neu_wurzel(text.c_str(), 48000.0, wurzel.c_str(), fehler, sizeof fehler);
  if (!b) {
    meldung = "graph " + graph + ": " + fehler;
    return -1;
  }
#ifndef CYPHERDJ_MUTATION_ARR_BK_EFFEKT_OFFEN
  if (cypher_bk_hat_eingang(b)) {
    cypher_bk_frei(b);
    meldung = "graph " + graph + " is an effect graph, an instrument is expected";
    return -1;
  }
#endif
  if (const uint32_t lat = cypher_bk_latenz(b); lat > 0) {
    cypher_bk_frei(b);
    meldung = "graph " + graph + " has a latency of " + std::to_string(lat) + " samples (not supported on a project track)";
    return -1;
  }
  size_t slot = 0;
  while (slot < bk_.size() && !bk_[slot].schluessel.empty()) ++slot;
  if (slot == bk_.size()) bk_.emplace_back();
  bk_[slot].schluessel = schluessel;
  bk_[slot].h = b;
  bk_[slot].gen = ++bk_zaehler_;
  bk_[slot].ref = 1;
  *h = b;
  *gen = bk_[slot].gen;
  return static_cast<int32_t>(slot);
}

void ArrAudioCache::bk_gib(int32_t slot) {
  if (slot < 0 || static_cast<size_t>(slot) >= bk_.size() || bk_[slot].schluessel.empty()) return;
  BkEintrag& e = bk_[slot];
  if (--e.ref > 0) return;
  CypherBk* h = e.h;
  e.schluessel.clear();
  e.h = nullptr;
  e.ref = 0;
#ifdef CYPHERDJ_MUTATION_ARR_BK_FREI_OHNE_LESER
  cypher_bk_frei(h);   // fault: freed although the sink may still fade this instance
  return;
#else
  if (bk_leser_ && bk_leser_->nutzt(h)) {
    bk_aufgeschoben_.push_back(h);   // the sink fades it for one more block: freed in a later pass
    return;
  }
  cypher_bk_frei(h);
#endif
}

bool ArrAudioCache::bk_nachholen() {
  bool arbeit = false;
  for (size_t i = 0; i < bk_aufgeschoben_.size();) {
    if (bk_leser_ && bk_leser_->nutzt(bk_aufgeschoben_[i])) {
      ++i;
      continue;
    }
    cypher_bk_frei(bk_aufgeschoben_[i]);
    bk_aufgeschoben_[i] = bk_aufgeschoben_.back();
    bk_aufgeschoben_.pop_back();
    arbeit = true;
  }
  return arbeit;
}

int ArrAudioCache::bk_eintraege() const {
  int n = 0;
  for (const BkEintrag& e : bk_) n += e.h != nullptr;
  return n;
}

// ---- 1.9: kit store ----------------------------------------------------------------------------------------------------
namespace {
// Lock the pages a range touches. The unlock below takes only the pages the range owns completely: Linux locks do not count, so a
// munlock on a boundary page that a heap neighbour shares would also drop the neighbour's lock (the core's mlockall at start, or another
// kit). A sound smaller than a page therefore stays locked after its Kit is freed; that is a few KiB of resident memory, not a risk.
void kit_bereich_sperren(const void* p, size_t n, size_t* seite_aus, int* e) {
  const size_t seite = static_cast<size_t>(sysconf(_SC_PAGESIZE));
  const uintptr_t a = reinterpret_cast<uintptr_t>(p) & ~(seite - 1);
  const uintptr_t z = (reinterpret_cast<uintptr_t>(p) + n + seite - 1) & ~(seite - 1);
  *seite_aus = z - a;
  if (mlock(reinterpret_cast<void*>(a), z - a) != 0) *e = errno;
}
void kit_bereich_entsperren(const void* p, size_t n) {
  const size_t seite = static_cast<size_t>(sysconf(_SC_PAGESIZE));
  const uintptr_t a = (reinterpret_cast<uintptr_t>(p) + seite - 1) & ~(seite - 1);
  const uintptr_t z = (reinterpret_cast<uintptr_t>(p) + n) & ~(seite - 1);
  if (z > a) munlock(reinterpret_cast<void*>(a), z - a);
}
int64_t kit_bytes(const Kit& k) {
  int64_t b = 0;
  for (const KitKlang& kl : k.klang) b += kl.frames * 2 * static_cast<int64_t>(sizeof(float));
  return b;
}
}  // namespace

void ArrAudioCache::kit_freigeben(KitEintrag&& e) {
  if (!e.k) return;
  if (sperren_)
    for (const KitKlang& kl : e.k->klang)
      if (!kl.daten.empty()) kit_bereich_entsperren(kl.daten.data(), kl.daten.size() * sizeof(float));
  if (konto_) konto_->entlaste(e.bytes);
  e.k.reset();
  e.bytes = 0;
}

int32_t ArrAudioCache::kit_hole(const std::string& name, const Kit** k, uint64_t* gen, std::string& grund, std::string& meldung) {
  grund = "format";
  if (!bk_name_ok(name)) {   // the parser has checked it already; this is the last line before a path is built from the name
    meldung = "kit_hole: invalid kit name";
    return -1;
  }
  if (!kit_lader_) {
    meldung = "kit " + name + ": no kit loader";
    return -1;
  }
  const std::string ordner = kit_ordner_ + "/" + name;
  struct stat st {};
  if (kit_ordner_.empty() || stat((ordner + "/kit.json").c_str(), &st) != 0) {
    meldung = "kit " + name + ": folder " + ordner + " has no readable kit.json";
    return -1;
  }
#ifdef CYPHERDJ_MUTATION_ARR_KIT_OHNE_TEILEN
  const std::string schluessel = name + "|" + std::to_string(st.st_mtim.tv_sec) + "." + std::to_string(st.st_mtim.tv_nsec) + "|" +
                                 std::to_string(st.st_size) + "|" + std::to_string(kit_zaehler_ + 1);   // fault: never shared
#else
  const std::string schluessel =
      name + "|" + std::to_string(st.st_mtim.tv_sec) + "." + std::to_string(st.st_mtim.tv_nsec) + "|" + std::to_string(st.st_size);
#endif
  for (size_t i = 0; i < kit_.size(); ++i) {
    if (kit_[i].schluessel != schluessel) continue;
    ++kit_[i].ref;
    *k = kit_[i].k.get();
    *gen = kit_[i].gen;
    return static_cast<int32_t>(i);
  }
  std::string fehler;
  std::unique_ptr<Kit> neu = kit_lader_(ordner, &fehler);
  if (!neu) {
    meldung = "kit " + name + ": " + fehler;
    return -1;
  }
  const int64_t bytes = kit_bytes(*neu);
  if (konto_ && !konto_->belaste(bytes)) {
    grund = "zu_gross";
    meldung = "speicher_budget (kit " + name + "): " + std::to_string((konto_->gesperrt() + bytes) >> 20) + " MiB > " +
              std::to_string(konto_->budget() >> 20) + " MiB";
    return -1;
  }
  if (sperren_) {
    int e = 0;
    for (const KitKlang& kl : neu->klang) {
      size_t n = 0;
      if (!kl.daten.empty() && !e) kit_bereich_sperren(kl.daten.data(), kl.daten.size() * sizeof(float), &n, &e);
    }
    if (e) {
      for (const KitKlang& kl : neu->klang)
        if (!kl.daten.empty()) kit_bereich_entsperren(kl.daten.data(), kl.daten.size() * sizeof(float));
      if (konto_) konto_->entlaste(bytes);
      grund = "zu_gross";
      meldung = "kit " + name + ": mlock " + std::strerror(e);
      return -1;
    }
  }
  size_t slot = 0;
  while (slot < kit_.size() && !kit_[slot].schluessel.empty()) ++slot;
  if (slot == kit_.size()) kit_.emplace_back();
  kit_[slot].schluessel = schluessel;
  kit_[slot].k = std::move(neu);
  kit_[slot].gen = ++kit_zaehler_;
  kit_[slot].ref = 1;
  kit_[slot].bytes = bytes;
  *k = kit_[slot].k.get();
  *gen = kit_[slot].gen;
  return static_cast<int32_t>(slot);
}

void ArrAudioCache::kit_gib(int32_t slot) {
  if (slot < 0 || static_cast<size_t>(slot) >= kit_.size() || kit_[slot].schluessel.empty()) return;
  KitEintrag& e = kit_[slot];
  if (--e.ref > 0) return;
  KitEintrag frei = std::move(e);
  e.schluessel.clear();
  e.ref = 0;
  e.bytes = 0;
#ifdef CYPHERDJ_MUTATION_ARR_KIT_FREI_OHNE_LESER
  kit_freigeben(std::move(frei));   // fault: freed although the sink may still play a sound of this Kit
  return;
#else
  if (kit_leser_ && kit_leser_->nutzt(frei.k.get())) {
    kit_aufgeschoben_.push_back(std::move(frei));   // the sink plays it for one more block: freed in a later pass
    return;
  }
  kit_freigeben(std::move(frei));
#endif
}

bool ArrAudioCache::kit_nachholen() {
  bool arbeit = false;
  for (size_t i = 0; i < kit_aufgeschoben_.size();) {
    if (kit_leser_ && kit_leser_->nutzt(kit_aufgeschoben_[i].k.get())) {
      ++i;
      continue;
    }
    kit_freigeben(std::move(kit_aufgeschoben_[i]));
    if (i + 1 != kit_aufgeschoben_.size()) kit_aufgeschoben_[i] = std::move(kit_aufgeschoben_.back());
    kit_aufgeschoben_.pop_back();
    arbeit = true;
  }
  return arbeit;
}

int ArrAudioCache::kit_eintraege() const {
  int n = 0;
  for (const KitEintrag& e : kit_) n += e.k != nullptr;
  return n;
}

void gib_wiedergabe(ArrSnapshot* s, ArrAudioCache& cache) {
  if (!s) return;
  cache.entsperre(*s);
  for (ArrAudio* a : s->audios) cache.gib(a);
#ifndef CYPHERDJ_MUTATION_ARR_BK_OHNE_REF
  for (int32_t sl : s->bk_refs) cache.bk_gib(sl);
#endif
#ifndef CYPHERDJ_MUTATION_ARR_KIT_OHNE_REF
  for (int32_t sl : s->kit_refs) cache.kit_gib(sl);   // 1.9: kit references
#endif
  delete s;
}

ArrLadeErgebnis lade_wiedergabe(const std::string& ordner, int64_t nummer, ArrAudioCache& cache) {
  ArrLadeErgebnis erg;
  const std::string pfad = wiedergabe_pfad(ordner, nummer);
  const std::string erlaubt = normal(ordner) + "/";   // Spec 6.14: Audio nur darunter (audio/<sha>.f32, freeze-*.f32)
  std::ifstream f(pfad);
  if (!f) {
    erg.grund = "datei_fehlt";
    erg.meldung = pfad + " fehlt";
    return erg;
  }
  auto snap = std::make_unique<ArrSnapshot>();
  std::vector<ArrAudio*> geholt;  // bei Abbruch zurückgeben
  try {
    json j;
    try {
      j = json::parse(f);
    } catch (const json::parse_error& e) {
      format(std::string("kein JSON: ") + e.what());
    }
    const std::string fmt = text(j, "format", "");
    const bool v2 = fmt == "cypherdj-arr/2";
    if (fmt != "cypherdj-arr/1" && !v2) format("format ist weder cypherdj-arr/1 noch cypherdj-arr/2");
    // Spec 3.2, 6.1: Schlüssel "nr" (Wiedergabe-Nummer der Instanz, wie S2 sie schreibt), gleich der Nummer im Dateinamen
    if (ganz(j, "nr", "") != nummer) format("nr in der Datei weicht von " + std::to_string(nummer) + " ab");
    const json& spuren = feld(j, "spuren", "");
    if (!spuren.is_array()) format("spuren ist keine Liste");
    if (spuren.size() > static_cast<size_t>(ARR_SPUREN))
      throw Abbruch("spur_bereich", "mehr als " + std::to_string(ARR_SPUREN) + " Spuren");
    snap->nr = nummer;
    // 1.10: Gruppen (nur /2). Tiefe 1: ausgang einer Gruppe ist master; jede Nummer 1..ARR_GRUPPEN höchstens einmal.
    bool gruppe_da[ARR_GRUPPEN + 1] = {};
    bool rack_belegt[ARR_RACKS] = {};      // 1.10 slice 4c: rack pool slots used by a strip
    bool ins_belegt[ARR_INS_ALLE] = {};   // 1.10 slice 4a/4b: pool slots (global index) used by a stage
    if (j.contains("gruppen")) {
      if (!v2) format("gruppen gibt es erst in cypherdj-arr/2");
      const json& gl = j.at("gruppen");
      if (!gl.is_array()) format("gruppen ist keine Liste");
      for (size_t gi = 0; gi < gl.size(); ++gi) {
        const json& g = gl[gi];
        const std::string wg = "gruppen[" + std::to_string(gi) + "].";
        const int64_t gn = ganz(g, "nr", wg);
        if (gn < 1 || gn > ARR_GRUPPEN) format(wg + "nr außerhalb 1 bis " + std::to_string(ARR_GRUPPEN));
        if (gruppe_da[gn]) format(wg + "nr doppelt");
        gruppe_da[gn] = true;
        const json& ag = feld(g, "ausgang", wg);
        if (text(ag, "art", wg + "ausgang.") != "master") format(wg + "ausgang: Gruppen verschachteln nicht (nur master)");
        lese_kette(g, wg, snap->kette[ARR_SPUREN + gn - 1], ins_belegt);
        lese_rack(g, wg, snap->kette[ARR_SPUREN + gn - 1], snap->rack[ARR_SPUREN + gn - 1], rack_belegt);   // 1.10 slice 4c T15
      }
    }
    // 1.10 slice 4a T3: the chain of the production master, `pm: {chain: [...]}` (only /2), before the PM fader.
    if (j.contains("pm")) {
      if (!v2) format("pm gibt es erst in cypherdj-arr/2");
      if (!j.at("pm").is_object()) format("pm ist kein Objekt");
      lese_kette(j.at("pm"), "pm.", snap->kette[ARR_KETTE_PM], ins_belegt);
      lese_rack(j.at("pm"), "pm.", snap->kette[ARR_KETTE_PM], snap->rack[ARR_KETTE_PM], rack_belegt);
    }
    // 1.10 Slice 3: returns (only /2). The core needs only WHICH returns exist; the sends are controls, not data (spec 5.1).
    // nr 1..ARR_RETURNS at most once, the output is master (returns do not feed returns or groups).
    if (j.contains("returns")) {
      if (!v2) format("returns gibt es erst in cypherdj-arr/2");
      const json& rl = j.at("returns");
      if (!rl.is_array()) format("returns ist keine Liste");
      for (size_t ri = 0; ri < rl.size(); ++ri) {
        const json& r = rl[ri];
        const std::string wr = "returns[" + std::to_string(ri) + "].";
        const int64_t rn = ganz(r, "nr", wr);
        if (rn < 1 || rn > ARR_RETURNS) format(wr + "nr außerhalb 1 bis " + std::to_string(ARR_RETURNS));
        if (snap->ret_da[rn - 1]) format(wr + "nr doppelt");
        snap->ret_da[rn - 1] = true;
        if (r.contains("pre")) {   // 1.10 slice 4a: the sends into this return are taken before the fader and pan of their source
          if (!r.at("pre").is_boolean()) format(wr + "pre ist kein Wahrheitswert");
          snap->ret_pre[rn - 1] = r.at("pre").get<bool>();
        }
        const json& ar = feld(r, "ausgang", wr);
        if (text(ar, "art", wr + "ausgang.") != "master") format(wr + "ausgang: Returns senden nicht weiter (nur master)");
        lese_kette(r, wr, snap->kette[ARR_KETTE_RET0 + rn - 1], ins_belegt);
        lese_rack(r, wr, snap->kette[ARR_KETTE_RET0 + rn - 1], snap->rack[ARR_KETTE_RET0 + rn - 1], rack_belegt);   // 1.10 slice 4c T15
      }
    }
    // Zählen, dann reservieren: die Zeiger in ArrSpur zeigen in die Vektoren, die danach nie wachsen
    size_t n_clips = 0, n_noten = 0, n_warps = 0, n_punkte = 0, n_lanes = 0, n_auto_p = 0, n_hk_p = 0;
    for (const json& s : spuren) {
      if (s.contains("clips") && s.at("clips").is_array()) {
        n_clips += s.at("clips").size();
        for (const json& c : s.at("clips")) {   // Paket 1.13: Warps und Marker zählen, bevor reserviert wird (die Zeiger bleiben gültig)
          if (c.is_object() && c.contains("gain_hk") && c.at("gain_hk").is_array()) n_hk_p += c.at("gain_hk").size();   // 1.12 slice 5: the hk points, own vector
          if (c.is_object() && c.contains("warp") && c.at("warp").is_object() && c.at("warp").contains("w") && c.at("warp").at("w").is_array()) {
            ++n_warps;
            n_punkte += c.at("warp").at("w").size();
            if (c.at("warp").contains("e") && c.at("warp").at("e").is_array()) n_punkte += c.at("warp").at("e").size();   // Slice 4: die Einheiten liegen hinter den Markern
          }
        }
      }
      if (s.contains("noten") && s.at("noten").is_array()) n_noten += s.at("noten").size();
      if (s.contains("auto") && s.at("auto").is_array()) {   // Automation Slice 1: count lanes and points (the checks follow in the track loop)
        n_lanes += s.at("auto").size();
        for (const json& l : s.at("auto")) {
          if (!(l.is_object() && l.contains("punkte") && l.at("punkte").is_array())) continue;
          if (l.at("punkte").size() > static_cast<size_t>(ARR_AUTO_LANE_PUNKTE_MAX))
            throw Abbruch("zu_gross", "more than " + std::to_string(ARR_AUTO_LANE_PUNKTE_MAX) + " points in one automation lane");
          n_auto_p += l.at("punkte").size();
        }
      }
    }
    if (n_auto_p > static_cast<size_t>(ARR_AUTO_PUNKTE_MAX))
      throw Abbruch("zu_gross", "more than " + std::to_string(ARR_AUTO_PUNKTE_MAX) + " automation points in all lanes");
    // 1.12 slice 5: the gain envelopes count against the same budget as the lanes (one number for the server's roll-out, D7)
    if (n_auto_p + n_hk_p > static_cast<size_t>(ARR_AUTO_PUNKTE_MAX))
      throw Abbruch("zu_gross", "more than " + std::to_string(ARR_AUTO_PUNKTE_MAX) + " automation and gain envelope points in all");
    if (n_clips > static_cast<size_t>(ARR_CLIPS_MAX)) throw Abbruch("zu_gross", "mehr als 4096 Clips");
    if (n_noten > static_cast<size_t>(ARR_NOTEN_MAX)) throw Abbruch("zu_gross", "mehr als 65536 Noten");
#ifndef CYPHERDJ_MUTATION_ARR_WARP_OHNE_GESAMT   // Fehlerfall: die Gesamtgrenze der Marker aller Clips fehlt (Slice 3a, Task 15)
    if (n_punkte > static_cast<size_t>(ARR_WARP_PUNKTE_MAX))
      throw Abbruch("zu_gross", "mehr als " + std::to_string(ARR_WARP_PUNKTE_MAX) + " Warp-Marker in allen Clips");
#endif
    snap->clips.reserve(n_clips);
    snap->noten.reserve(n_noten);
    snap->noten_id.reserve(n_noten);
    snap->noten_id_index.reserve(n_noten);
    snap->warps.reserve(n_warps);
    snap->warp_beat.reserve(n_punkte);
    snap->warp_frame.reserve(n_punkte);
    snap->auto_lane_liste.reserve(n_lanes);
    snap->auto_punkte.reserve(n_auto_p);
    snap->hk_punkte.reserve(n_hk_p);   // before any push_back: ArrClip::hk points into this vector
    std::map<std::string, ArrAudio*> je_sha;  // jedes Audio einmal je Schnappschuss
    int n_bk = 0;                              // S20: bk tracks of this playback (at most ARR_BK_MAX)
    int n_kit = 0;                             // 1.9: kit tracks of this playback (at most ARR_KIT_MAX)
    std::set<int> nr_gesehen;
    // 1.9 U6: the device of a track or of a rack member (the one code for both): art "intern" with geraet rb338, bk or kit, or art "wirt" with a
    // slot. glied: the object is a rack member (its device goes to snap->glied_spur, a graph instance is keyed by its member slot, a Surge slot
    // must not be used by another member or track, a rack does not nest). The checks and the texts are those of a track.
    std::set<int> wirt_slot_spur, wirt_slot_glied;   // Surge slots in use by tracks / by rack members
    auto geraet_lesen = [&](const json& s, const std::string& wo, ArrSpur& sp, int bk_nr, bool glied) {
      const std::string art = text(s, "art", wo);
      if (art == "intern") {
        sp.art = ArrArt::intern;
        const std::string g = text(s, "geraet", wo);
        if (glied && g == "rack") format(wo + "geraet rack: a rack does not nest");
        if (g != "rb338" && g != "bk" && g != "kit") format(wo + "geraet " + g + " unbekannt (rb338, bk oder kit)");
        std::snprintf(sp.geraet, sizeof sp.geraet, "%s", g.c_str());
        const bool ist_bk = g == "bk";
        const bool ist_kit = g == "kit";
        if (!ist_kit && s.contains("kit")) format(wo + "kit gibt es nur bei geraet kit");
        if (ist_kit) {   // 1.9: a kit track names a kit folder; it has no graph and no device parameter (the kit is the whole device)
          if (++n_kit > ARR_KIT_MAX) throw Abbruch("zu_gross", wo + "more than " + std::to_string(ARR_KIT_MAX) + " kit tracks");
          const std::string kn = text(s, "kit", wo);
#ifndef CYPHERDJ_MUTATION_ARR_KIT_NAME_UNGEPRUEFT
          if (!bk_name_ok(kn)) format(wo + "kit \"" + kn + "\": name must be 1 to 32 characters of [a-z0-9_-]");
#endif
          if (s.contains("parameter")) format(wo + "parameter gibt es nicht bei geraet kit");
          std::snprintf(sp.kit, sizeof sp.kit, "%s", kn.c_str());
        }
        if (ist_bk) {   // S20: a Baukasten graph; built here (loader thread), handed to the callback inside the snapshot
          if (++n_bk > ARR_BK_MAX) throw Abbruch("zu_gross", wo + "more than " + std::to_string(ARR_BK_MAX) + " bk tracks");
          const std::string gr = text(s, "graph", wo);
          if (!bk_name_ok(gr)) format(wo + "graph \"" + gr + "\": name must be 1 to 32 characters of [a-z0-9_-]");
          std::snprintf(sp.graph, sizeof sp.graph, "%s", gr.c_str());
        } else if (s.contains("graph")) {
          format(wo + "graph gibt es nur bei geraet bk");
        }
        if (s.contains("parameter")) {
          const json& p = s.at("parameter");
          if (!p.is_object()) format(wo + "parameter ist kein Objekt");
          for (auto it = p.begin(); it != p.end(); ++it) {
            if (ist_bk && !bk_knopf_ok(it.key())) format(wo + "parameter." + it.key() + ": a bk track knows k1 to k8");
            if (sp.n_param >= ARR_PARAMETER) format(wo + "mehr als " + std::to_string(ARR_PARAMETER) + " parameter");
            if (it.key().empty() || it.key().size() >= sizeof sp.param[0].name) format(wo + "parameter-Name zu lang");
            if (!it.value().is_number()) format(wo + "parameter." + it.key() + " ist keine Zahl");
            const double w = it.value().get<double>();
            if (!(w >= 0.0 && w <= 1.0)) format(wo + "parameter." + it.key() + " außerhalb 0 bis 1");
            std::snprintf(sp.param[sp.n_param].name, sizeof sp.param[0].name, "%s", it.key().c_str());
            sp.param[sp.n_param++].wert = static_cast<float>(w);
          }
        }
        if (ist_bk) {   // all of the track's checks passed up to here: only now build or share the instance
          std::string grund, meldung;
          const int32_t slot = cache.bk_hole(bk_nr, sp.graph, &sp.bk, &sp.bk_gen, grund, meldung);
          if (slot < 0) throw Abbruch(grund, wo + meldung);
          snap->bk_refs.push_back(slot);
        }
        if (ist_kit) {   // same rule as bk: only now take (or load) the shared Kit
          std::string grund, meldung;
          const int32_t slot = cache.kit_hole(sp.kit, &sp.kit_ptr, &sp.kit_gen, grund, meldung);
          if (slot < 0) throw Abbruch(grund, wo + meldung);
          snap->kit_refs.push_back(slot);
        }
      } else if (art == "wirt") {
        sp.art = ArrArt::wirt;
        const int64_t slot = ganz(s, "slot", wo);
        if (slot < 1 || slot > ARR_WIRT_SLOTS) throw Abbruch("spur_bereich", wo + "slot außerhalb 1 bis 2");
        sp.slot = static_cast<int>(slot);
        // a Surge slot is one host: a rack member must not share it with another member or a track (two tracks of one slot stay legal, the sink
        // knows "another track plays the slot")
#ifndef CYPHERDJ_MUTATION_ARR_RACK_SLOT_DOPPELT
        const int sl = static_cast<int>(slot);
        if (glied ? (wirt_slot_glied.count(sl) || wirt_slot_spur.count(sl)) : wirt_slot_glied.count(sl))
          format(wo + "slot " + std::to_string(slot) + " is used twice (a Surge slot belongs to one rack member or track)");
        (glied ? wirt_slot_glied : wirt_slot_spur).insert(sl);
#endif
      } else {
        format(wo + "art " + art + " unbekannt");
      }
    };
    int n_rack = 0, n_platz = 0;   // rack tracks and member slots handed out so far
    for (size_t si = 0; si < spuren.size(); ++si) {
      const json& s = spuren[si];
      const std::string wo = "spuren[" + std::to_string(si) + "].";
      const int64_t nr = ganz(s, "nr", wo);
      if (nr < 1 || nr > ARR_SPUREN)
        throw Abbruch("spur_bereich", wo + "nr " + std::to_string(nr) + " außerhalb 1 bis " + std::to_string(ARR_SPUREN));
      if (!nr_gesehen.insert(static_cast<int>(nr)).second) throw Abbruch("spur_bereich", wo + "nr doppelt");
      ArrSpur& sp = snap->spur[nr - 1];
      sp.nr = static_cast<int>(nr);
      if (s.contains("rack") && !v2) format(wo + "rack gibt es erst in cypherdj-arr/2");
      if (s.contains("chain") && !v2) format(wo + "chain gibt es erst in cypherdj-arr/2");   // like ausgang below
      lese_kette(s, wo, snap->kette[nr - 1], ins_belegt);
      lese_rack(s, wo, snap->kette[nr - 1], snap->rack[nr - 1], rack_belegt);   // 1.10 slice 4c T15
      if (s.contains("ausgang")) {   // 1.10: master (Vorgabe) oder eine Gruppe aus der Liste; nur in /2
        if (!v2) format(wo + "ausgang gibt es erst in cypherdj-arr/2");
        const json& ag = s.at("ausgang");
        const std::string a_art = text(ag, "art", wo + "ausgang.");
        if (a_art == "gruppe") {
          const int64_t gn = ganz(ag, "nr", wo + "ausgang.");
          if (gn < 1 || gn > ARR_GRUPPEN) format(wo + "ausgang.nr außerhalb 1 bis " + std::to_string(ARR_GRUPPEN));
          if (!gruppe_da[gn]) format(wo + "ausgang.nr " + std::to_string(gn) + " steht nicht in gruppen");
          sp.ausgang = static_cast<int8_t>(gn);
        } else if (a_art != "master") {
          format(wo + "ausgang.art " + a_art + " unbekannt (master oder gruppe)");
        }
      }
      const std::string art = text(s, "art", wo);
      if (art == "audio") {
        sp.art = ArrArt::audio;
      } else if (art == "intern" && text(s, "geraet", wo) == "rack") {   // 1.9 U6: an instrument rack (spec E9, E10)
        if (!v2) format(wo + "geraet rack gibt es erst in cypherdj-arr/2");
        sp.art = ArrArt::rack;
        std::snprintf(sp.geraet, sizeof sp.geraet, "rack");
        if (++n_rack > ARR_RACK_MAX) throw Abbruch("zu_gross", wo + "more than " + std::to_string(ARR_RACK_MAX) + " racks");
        for (const char* nein : {"parameter", "graph", "kit"})
          if (s.contains(nein)) format(wo + nein + " gibt es nicht bei geraet rack (die Glieder tragen die Geräte)");
        const int64_t kette = ganz(s, "kette", wo);
        if (kette < 0 || kette > 127) format(wo + "kette außerhalb 0 bis 127");
        sp.kette = static_cast<int>(kette);
        const json& gl = feld(s, "glieder", wo);
        if (!gl.is_array()) format(wo + "glieder ist keine Liste");
        if (gl.empty() || gl.size() > static_cast<size_t>(ARR_RACK_GLIEDER))
          format(wo + "glieder hat " + std::to_string(gl.size()) + " Einträge, erlaubt sind 1 bis " + std::to_string(ARR_RACK_GLIEDER));
        std::set<uint64_t> glied_ids;
        for (size_t gi = 0; gi < gl.size(); ++gi) {
          const json& g = gl[gi];
          const std::string wg = wo + "glieder[" + std::to_string(gi) + "].";
          if (!g.is_object()) format(wg + "kein Objekt");
          if (n_platz >= ARR_GLIED_PLAETZE) throw Abbruch("zu_gross", wg + "more than " + std::to_string(ARR_GLIED_PLAETZE) + " rack members");
          for (const char* nein : {"noten", "clips", "auto"})
            if (g.contains(nein)) format(wg + nein + " gibt es nicht bei einem Glied (die Noten liegen auf der Rack-Spur)");
          ArrGlied& gd = sp.glied[gi];
          const std::string gid = text(g, "id", wg);
          if (gid.empty()) format(wg + "id leer");
          gd.id = arr_id(gid);
          if (!glied_ids.insert(gd.id).second) format(wg + "id doppelt: " + gid);
          gd.platz = ARR_SPUREN + n_platz++;
          ArrSpur& dev = snap->glied_spur[gd.platz - ARR_SPUREN];
          dev.nr = gd.platz + 1;
          geraet_lesen(g, wg, dev, gd.platz + 1, true);   // the device; a graph instance is keyed by the member slot
          gd.art = dev.art;
          gd.slot = dev.slot;
          if (dev.art == ArrArt::wirt) ++snap->rack_wirt;
          // zones: inclusive ranges, absent = the whole range; gain_db absent = 0
          auto zone = [&](const char* name, int lo_min, int hi_max, uint8_t& lo, uint8_t& hi) {
            if (!g.contains(name)) return;
            const json& z = g.at(name);
            if (!z.is_array() || z.size() != 2 || !z[0].is_number_integer() || !z[1].is_number_integer())
              format(wg + name + " ist kein Paar [von, bis] ganzer Zahlen");
            const int64_t a = z[0].get<int64_t>(), b = z[1].get<int64_t>();
#ifndef CYPHERDJ_MUTATION_ARR_RACK_ZONE_UNGEPRUEFT   // error case: an inverted or out-of-range zone is taken as it is
            if (a < lo_min || b > hi_max || a > b)
              format(wg + name + " [" + std::to_string(a) + ", " + std::to_string(b) + "]: needs " + std::to_string(lo_min) + " <= von <= bis <= " +
                     std::to_string(hi_max));
#endif
            lo = static_cast<uint8_t>(a);
            hi = static_cast<uint8_t>(b);
          };
          zone("ton", 0, 127, gd.ton_lo, gd.ton_hi);
          zone("vel", 1, 127, gd.vel_lo, gd.vel_hi);
          zone("kette", 0, 127, gd.kette_lo, gd.kette_hi);
          if (g.contains("gain_db")) {
            const double gdb = zahl(g, "gain_db", wg);
            if (gdb < ARR_GLIED_GAIN_DB_MIN || gdb > ARR_GLIED_GAIN_DB_MAX) format(wg + "gain_db außerhalb −60 bis +12");
            gd.gain = static_cast<float>(std::pow(10.0, gdb / 20.0));
          }
          ++sp.n_glieder;
        }
      } else {
        geraet_lesen(s, wo, sp, static_cast<int>(nr), false);   // intern or wirt, or the refusal of an unknown art
      }
      if (sp.art == ArrArt::audio) {
        const json& clips = feld(s, "clips", wo);
        if (!clips.is_array()) format(wo + "clips ist keine Liste");
        const size_t c0 = snap->clips.size();
        std::set<uint64_t> ids;
        for (size_t ci = 0; ci < clips.size(); ++ci) {
          const json& c = clips[ci];
          const std::string wc = wo + "clips[" + std::to_string(ci) + "].";
          ArrClip x{};
          const std::string id = text(c, "id", wc);
          if (id.empty()) format(wc + "id leer");
          x.id = arr_id(id);
          if (!ids.insert(x.id).second) format(wc + "id doppelt: " + id);
          x.start_beat = zahl(c, "start_beat", wc);
          x.laenge_beats = zahl(c, "laenge_beats", wc);
          if (x.start_beat < 0.0) format(wc + "start_beat negativ");
          if (!(x.laenge_beats > 0.0)) format(wc + "laenge_beats nicht positiv");
          const std::string sha = text(c, "sha256", wc);
          if (!hex64(sha)) format(wc + "sha256 nicht 64 Hex-Zeichen");
          const std::string datei = normal(text(c, "datei", wc));
#ifdef CYPHERDJ_MUTATION_ARR_ORDNER_ROH
          const std::string roh = ordner + "/";   // Fehlerfall: Ordner ungeprüft angehängt (ein / am Ende lehnt alles ab)
          if (datei.compare(0, roh.size(), roh) != 0) format(wc + "datei liegt nicht im Arbeitsordner: " + datei);
#else
          if (datei.size() <= erlaubt.size() || datei.compare(0, erlaubt.size(), erlaubt) != 0)
            format(wc + "datei liegt nicht unterhalb des Arbeitsordners " + erlaubt + ": " + datei);
#endif
          const int64_t frames = ganz(c, "frames", wc);
          if (frames < 1) format(wc + "frames < 1");
          x.offset_frames = ganz(c, "offset_frames", wc);
          if (x.offset_frames < 0 || x.offset_frames >= frames) format(wc + "offset_frames außerhalb [0, frames)");
          // Spec 6.27: ein Wertebereich mit S2 (modell.ts): gain_db −96..+24; Blenden ≥ 0 und zusammen höchstens
          // laenge_beats, mit S2s Toleranz 1e-9 (0,1 + 0,2 auf 0,3 Beats ist gültig)
          const double gain_db = zahl(c, "gain_db", wc);
#ifdef CYPHERDJ_MUTATION_ARR_GAIN_ALT
          if (gain_db < -200.0 || gain_db > 24.0) format(wc + "gain_db außerhalb −200 bis +24");   // Fehlerfall: alt
#else
          if (gain_db < ARR_GAIN_DB_MIN || gain_db > ARR_GAIN_DB_MAX) format(wc + "gain_db außerhalb −96 bis +24");
#endif
          x.gain = static_cast<float>(std::pow(10.0, gain_db / 20.0));
          if (c.contains("gain_hk")) {   // 1.12 slice 5 (D8): the gain envelope of this loop copy [copy beat, dB, formcode], the point checks of a lane, range -200..0
#ifndef CYPHERDJ_MUTATION_ARR_HK_OHNE_PRUEFUNG   // error case: /1 takes it, and no value is checked (a rising dB value or falling beats play)
            if (!v2) format(wc + "gain_hk exists only in cypherdj-arr/2");
#endif
            const json& hl = c.at("gain_hk");
            if (!hl.is_array() || hl.empty()) format(wc + "gain_hk is not a non-empty list");
            const size_t h0 = snap->hk_punkte.size();
            for (size_t hi = 0; hi < hl.size(); ++hi) {
              const json& q = hl[hi];
              const std::string wq = wc + "gain_hk[" + std::to_string(hi) + "]";
              if (!q.is_array() || q.size() != 3) format(wq + " is not [beat, wert, form]");
              if (!q[0].is_number() || !q[1].is_number() || !q[2].is_number_integer()) format(wq + " has a non-number");
              ArrAutoPunkt p{};
              p.beat = q[0].get<double>();
              const double w = q[1].get<double>();
              const int64_t fm = q[2].get<int64_t>();
#ifndef CYPHERDJ_MUTATION_ARR_HK_OHNE_PRUEFUNG
              if (!std::isfinite(p.beat) || p.beat < 0.0) format(wq + " beat negative or not finite");
              if (!(w >= ARR_HK_DB_MIN && w <= ARR_HK_DB_MAX)) format(wq + " wert outside -200 to 0 dB");
              if (fm < 0 || fm > 2) format(wq + " form outside 0 to 2");
              if (hi > 0 && p.beat < snap->hk_punkte.back().beat) format(wq + " beats fall");
              if (hi > 1 && p.beat == snap->hk_punkte[snap->hk_punkte.size() - 1].beat && p.beat == snap->hk_punkte[snap->hk_punkte.size() - 2].beat)
                format(wq + " three points at one beat");
#endif
              p.wert = static_cast<float>(w);
              p.form = static_cast<uint8_t>(fm);
              snap->hk_punkte.push_back(p);
            }
            x.hk = snap->hk_punkte.data() + h0;
            x.hk_n = static_cast<int>(hl.size());
          }
          x.ein_beats = zahl(c, "ein_beats", wc);
          x.aus_beats = zahl(c, "aus_beats", wc);
#ifdef CYPHERDJ_MUTATION_ARR_GAIN_ALT
          const double toleranz = 0.0;
#else
          const double toleranz = ARR_BLENDE_TOLERANZ;
#endif
          if (x.ein_beats < 0.0 || x.aus_beats < 0.0 || x.ein_beats + x.aus_beats > x.laenge_beats + toleranz)
            format(wc + "ein_beats/aus_beats negativ oder zusammen länger als der Clip");
          ArrAudio*& a = je_sha[sha];
          if (!a) {
            std::string grund, meldung;
            a = cache.hole(sha, datei, frames, grund, meldung);
            if (!a) throw Abbruch(grund, wc + meldung);
            geholt.push_back(a);
          } else if (a->frames != frames) {
            format(wc + "frames weicht für dasselbe sha256 ab");
          }
          x.audio = a;
#ifndef CYPHERDJ_MUTATION_ARR_WARP_IN_V1
          if (c.contains("warp") && !v2) format(wc + "warp gibt es erst in cypherdj-arr/2");   // auch null, wie ausgang (Fehlerfall: auch /1 nimmt einen Warp)
#endif
          if (c.contains("warp") && !c.at("warp").is_null()) {   // Paket 1.13
            const std::string ww = wc + "warp.";
            const json& wj = c.at("warp");
            if (!wj.is_object()) format(wc + "warp ist kein Objekt");
            const int64_t modus = ganz(wj, "modus", ww);
            if (modus != ARR_WARP_REPITCH && modus != ARR_WARP_BEATS && !arr_warp_werk_modus(static_cast<int32_t>(modus)))
              format(ww + "modus " + std::to_string(modus) + " ist nicht gebaut (0 repitch, 1 beats, 2 complex, 3 tones)");
            if (modus != ARR_WARP_BEATS && (wj.contains("e") || wj.contains("loop") || wj.contains("huelle")))
              format(ww + "e, loop und huelle gibt es nur bei modus 1 (beats)");
            // Paket 1.13 Slice 2: complex und tones rechnet Bungee im Warp-Werk. Ein Kern ohne Bungee lehnt sie beim Laden ab, statt still
            // RE-PITCH zu spielen (falsche Tonhöhe, im Takt): die vorige Wiedergabe spielt weiter, der Seiten-Server meldet den Grund.
#if !defined(CYPHERDJ_BUNGEE) || defined(CYPHERDJ_TEST_OHNE_MASCHINE)
#ifndef CYPHERDJ_MUTATION_ARR_WARP_MASCHINE_STILL   // Fehlerfall: der Lader nimmt den Modus ohne Maschine an und spielt ihn als RE-PITCH
            if (arr_warp_werk_modus(static_cast<int32_t>(modus)))
              throw Abbruch("warp_maschine_fehlt", ww + "modus " + std::to_string(modus) + " braucht einen Kern mit Bungee (CYPHERDJ_BUNGEE)");
#endif
#endif
            double pitch = 1.0;   // Slice 5: fehlt = 1
            if (wj.contains("pitch")) {
              pitch = zahl(wj, "pitch", ww);   // Text, null, nicht endlich: format
#ifndef CYPHERDJ_MUTATION_ARR_WARP_PITCH_OHNE_GRENZE   // Fehlerfall: jedes positive pitch gilt (Bungee bekäme ein Korn über seinem Puffer)
              if (!(pitch >= ARR_WARP_PITCH_MIN * (1.0 - 1e-9) && pitch <= ARR_WARP_PITCH_MAX * (1.0 + 1e-9)))
                format(ww + "pitch " + std::to_string(pitch) + " außerhalb " + std::to_string(ARR_WARP_PITCH_MIN) + " bis " + std::to_string(ARR_WARP_PITCH_MAX));
#else
              if (!(pitch > 0.0)) format(ww + "pitch nicht positiv");
#endif
              if (modus == ARR_WARP_REPITCH && pitch != 1.0) format(ww + "pitch bei repitch: RE-PITCH folgt dem Tempo");
              if (modus == ARR_WARP_BEATS && pitch != 1.0) format(ww + "pitch bei beats: BEATS nimmt keine Tonhöhe (D6b)");
            }
            const json& wl = feld(wj, "w", ww);
            if (!wl.is_array()) format(ww + "w ist keine Liste");
#ifdef CYPHERDJ_MUTATION_ARR_WARP_OHNE_GRENZE   // Fehlerfall: ein Marker und mehr als 4096 gelten als gültig
            if (wl.empty())
#else
            if (wl.size() < 2 || wl.size() > static_cast<size_t>(ARR_WARP_MARKER_MAX))
#endif
              format(ww + "w hat " + std::to_string(wl.size()) + " Marker, erlaubt sind 2 bis " + std::to_string(ARR_WARP_MARKER_MAX));
            const size_t p0 = snap->warp_beat.size();
            for (size_t mi = 0; mi < wl.size(); ++mi) {
              const json& m = wl[mi];
              const std::string wm = ww + "w[" + std::to_string(mi) + "]";
              if (!m.is_array() || m.size() != 2 || !m[0].is_number() || !m[1].is_number()) format(wm + " ist kein Paar [beat, frame]");
              const double b = m[0].get<double>(), fr = m[1].get<double>();
              if (!std::isfinite(b) || !std::isfinite(fr)) format(wm + " nicht endlich");
              if (std::fabs(b) > 1e6) format(wm + " beat außerhalb ±1e6");
              if (fr < 0.0 || fr > 1.1e12) format(wm + " frame außerhalb 0 bis 1,1e12");
#ifndef CYPHERDJ_MUTATION_ARR_WARP_OHNE_STEIGEND   // Fehlerfall: fallende Marker laden (W(b) wäre nicht mehr eindeutig)
              if (mi > 0 && !(b > snap->warp_beat.back())) format(wm + " beat nicht streng steigend");
              if (mi > 0 && !(fr > snap->warp_frame.back())) format(wm + " frame nicht streng steigend");
#endif
              snap->warp_beat.push_back(b);
              snap->warp_frame.push_back(fr);
            }
            ArrWarp w;
            w.modus = static_cast<int32_t>(modus);
            w.pitch = pitch;
            w.n = static_cast<int32_t>(wl.size());
            w.beat = snap->warp_beat.data() + p0;
            w.frame = snap->warp_frame.data() + p0;
            if (modus == ARR_WARP_BEATS) {   // Slice 4: Einheiten [Clip-Beat, Quell-Frame] hinter den Markern, dazu loop und huelle
              const int64_t lp = ganz(wj, "loop", ww), hu = ganz(wj, "huelle", ww);
              if (lp < 0 || lp > 2) format(ww + "loop " + std::to_string(lp) + " außerhalb 0 bis 2");
              if (hu < 0 || hu > 100) format(ww + "huelle " + std::to_string(hu) + " außerhalb 0 bis 100");
              const json& el = feld(wj, "e", ww);
              if (!el.is_array()) format(ww + "e ist keine Liste");
              if (el.empty() || el.size() > static_cast<size_t>(ARR_BEATS_EINHEITEN_MAX))
                format(ww + "e hat " + std::to_string(el.size()) + " Einheiten, erlaubt sind 1 bis " + std::to_string(ARR_BEATS_EINHEITEN_MAX));
              const size_t e0 = snap->warp_beat.size();
              for (size_t ei = 0; ei < el.size(); ++ei) {
                const json& m = el[ei];
                const std::string we = ww + "e[" + std::to_string(ei) + "]";
                if (!m.is_array() || m.size() != 2 || !m[0].is_number() || !m[1].is_number()) format(we + " ist kein Paar [beat, frame]");
                const double b = m[0].get<double>(), fr = m[1].get<double>();
                if (!std::isfinite(b) || !std::isfinite(fr)) format(we + " nicht endlich");
                if (std::fabs(b) > 1e6) format(we + " beat außerhalb ±1e6");
                if (fr < 0.0 || fr > 1.1e12) format(we + " frame außerhalb 0 bis 1,1e12");
#ifndef CYPHERDJ_MUTATION_ARR_BEATS_OHNE_STEIGEND   // Fehlerfall: fallende Einheiten laden (beats_einheit fände die falsche)
                if (ei > 0 && !(b > snap->warp_beat.back())) format(we + " beat nicht streng steigend");
                if (ei > 0 && !(fr > snap->warp_frame.back())) format(we + " frame nicht streng steigend");
#endif
                snap->warp_beat.push_back(b);
                snap->warp_frame.push_back(fr);
              }
              w.e_n = static_cast<int32_t>(el.size());
              w.e_beat = snap->warp_beat.data() + e0;
              w.e_frame = snap->warp_frame.data() + e0;
              w.loop = static_cast<int32_t>(lp);
              w.huelle = static_cast<int32_t>(hu);
            }
            snap->warps.push_back(w);
            x.warp = &snap->warps.back();
          }
          snap->clips.push_back(x);
        }
        std::sort(snap->clips.begin() + static_cast<long>(c0), snap->clips.end(),
                  [](const ArrClip& a, const ArrClip& b) { return a.start_beat < b.start_beat; });
        sp.n_clips = static_cast<int>(snap->clips.size() - c0);
        sp.clips = sp.n_clips ? snap->clips.data() + c0 : nullptr;
      } else {
        const json& noten = feld(s, "noten", wo);
        if (!noten.is_array()) format(wo + "noten ist keine Liste");
        const size_t n0 = snap->noten.size();
        for (size_t ni = 0; ni < noten.size(); ++ni) {
          const json& n = noten[ni];
          const std::string wn = wo + "noten[" + std::to_string(ni) + "].";
          ArrNote x{};
          const std::string id = text(n, "id", wn);
          if (id.empty()) format(wn + "id leer");
          x.id = arr_id(id);
          x.beat = zahl(n, "beat", wn);
          x.laenge = zahl(n, "laenge", wn);
          if (x.beat < 0.0) format(wn + "beat negativ");
          if (!(x.laenge > 0.0)) format(wn + "laenge nicht positiv");
          const int64_t ton = ganz(n, "ton", wn), vel = ganz(n, "vel", wn);
          if (ton < 0 || ton > 127) format(wn + "ton außerhalb 0 bis 127");
          if (vel < 1 || vel > 127) format(wn + "vel außerhalb 1 bis 127");
          x.ton = static_cast<uint8_t>(ton);
          x.vel = static_cast<uint8_t>(vel);
          snap->noten.push_back(x);
        }
        std::sort(snap->noten.begin() + static_cast<long>(n0), snap->noten.end(),
                  [](const ArrNote& a, const ArrNote& b) { return a.beat < b.beat || (a.beat == b.beat && a.ton < b.ton); });
        sp.n_noten = static_cast<int>(snap->noten.size() - n0);
        sp.noten = sp.n_noten ? snap->noten.data() + n0 : nullptr;
        // ID-Index: aufsteigend, je Spur eindeutig
        std::vector<std::pair<uint64_t, int32_t>> ix;
        for (int i = 0; i < sp.n_noten; ++i) ix.push_back({sp.noten[i].id, i});
        std::sort(ix.begin(), ix.end());
        for (size_t i = 1; i < ix.size(); ++i)
          if (ix[i].first == ix[i - 1].first) format(wo + "Noten-ID doppelt");
        const size_t i0 = snap->noten_id.size();
        for (const auto& [id, i] : ix) {
          snap->noten_id.push_back(id);
          snap->noten_id_index.push_back(i);
        }
        sp.noten_id = sp.n_noten ? snap->noten_id.data() + i0 : nullptr;
        sp.noten_id_index = sp.n_noten ? snap->noten_id_index.data() + i0 : nullptr;
      }
      if (s.contains("auto")) {   // Automation Slice 1: lanes of this track, only in /2; one lane per (target, parameter), see AUTO_ZIELE
        if (!v2) format(wo + "auto exists only in cypherdj-arr/2");
        const json& al = s.at("auto");
        if (!al.is_array()) format(wo + "auto is not a list");
        const size_t l0 = snap->auto_lane_liste.size();
        for (size_t li = 0; li < al.size(); ++li) {
          const json& l = al[li];
          const std::string wl = wo + "auto[" + std::to_string(li) + "].";
          const std::string zname = text(l, "ziel", wl);
          const AutoZiel* az = nullptr;
          for (const AutoZiel& z : AUTO_ZIELE)
            if (zname == z.name) az = &z;
          if (!az) format(wl + "ziel " + zname + " unknown");
          if (az->ziel == ARR_AUTO_GERAET && !(sp.art == ArrArt::intern && std::strcmp(sp.geraet, "rb338") == 0))   // 1.12: the four parameters are the RB-338's; the bk sink has no auto_parameter
            format(wl + "ziel " + zname + " only on an RB-338 track");
          bool relativ = false;   // 1.12 slice 5: a summand lane of the value stack; absent or false: an absolute lane (only in /2, like `auto` itself)
          if (l.contains("relativ")) {
            if (!l.at("relativ").is_boolean()) format(wl + "relativ is not a boolean");
            relativ = l.at("relativ").get<bool>();
          }
          if (relativ && az->nur_sprung) format(wl + "ziel " + zname + " takes no relative lane");
          for (size_t k = l0; k < snap->auto_lane_liste.size(); ++k)
#ifdef CYPHERDJ_MUTATION_ARR_REL_OHNE_EINDEUTIG   // error case: the uniqueness check ignores the flag, an absolute and a relative lane of one target count as "twice"
            if (snap->auto_lane_liste[k].ziel == az->ziel && snap->auto_lane_liste[k].param == az->param)
#else
            if (snap->auto_lane_liste[k].ziel == az->ziel && snap->auto_lane_liste[k].param == az->param && snap->auto_lane_liste[k].relativ == relativ)
#endif
              format(wl + "ziel " + zname + (relativ ? " relative twice on one track" : " twice on one track"));
          const json& pl = feld(l, "punkte", wl);
          if (!pl.is_array() || pl.empty()) format(wl + "punkte is not a non-empty list");
          const size_t p0 = snap->auto_punkte.size();
          for (size_t pi = 0; pi < pl.size(); ++pi) {
            const json& q = pl[pi];
            const std::string wq = wl + "punkte[" + std::to_string(pi) + "]";
            if (!q.is_array() || q.size() != 3) format(wq + " is not [beat, wert, form]");
            if (!q[0].is_number() || !q[1].is_number() || !q[2].is_number_integer()) format(wq + " has a non-number");
            ArrAutoPunkt x{};
            x.beat = q[0].get<double>();
            const double w = q[1].get<double>();
            const int64_t fm = q[2].get<int64_t>();
            if (!std::isfinite(x.beat) || x.beat < 0.0) format(wq + " beat negative or not finite");
            if (relativ ? !(w >= az->rel_min && w <= az->rel_max) : !(w >= az->min && w <= az->max))
              format(wq + " wert outside the " + (relativ ? "relative " : "") + "range of " + zname);
            if (fm < 0 || fm > 2) format(wq + " form outside 0 to 2");
            if (az->nur_sprung && (fm != 2 || (w != 0.0 && w != 1.0))) format(wq + " " + zname + " takes only 0 or 1 with form 2 (jump)");
            x.wert = static_cast<float>(w);
            x.form = static_cast<uint8_t>(fm);
            if (pi > 0 && x.beat < snap->auto_punkte.back().beat) format(wq + " beats fall");
            if (pi > 1 && x.beat == snap->auto_punkte[snap->auto_punkte.size() - 1].beat &&
                x.beat == snap->auto_punkte[snap->auto_punkte.size() - 2].beat)
              format(wq + " three points at one beat");
            snap->auto_punkte.push_back(x);
          }
          ArrAutoLane lane{};
          lane.ziel = az->ziel;
          lane.param = az->param;
          lane.n = static_cast<int>(pl.size());
          lane.p = snap->auto_punkte.data() + p0;
          lane.relativ = relativ;
          snap->auto_lane_liste.push_back(lane);
        }
        sp.n_auto = static_cast<int>(snap->auto_lane_liste.size() - l0);
        sp.auto_lanes = sp.n_auto ? snap->auto_lane_liste.data() + l0 : nullptr;
        snap->n_auto_lanes += sp.n_auto;
      }
    }
    // 1.10 slice 5 U2a: every structural key against the table of docs/schnittstellen/schluessel_regeln.json (a source computed after the consumer, a strip keyed by itself, the PM)
    if (std::string m; !arr_schluessel_pruefe(*snap, &m)) format(m);
    // 1.10 slice 5 U1: the order the tracks run in when a stage listens to the post of another track; a track keyed by itself or a cycle is refused
    if (std::string m; !arr_schluessel_rechnen(*snap, &m)) format(m);
    // 1.10 slice 4b T13: the delays that align every path at the sums (spec 2.4); the routing and all chains are known now
    if (!arr_pdc_rechnen(*snap)) throw Abbruch("zu_gross", "pdc_zu_lang: the latency of the insert chains needs a delay longer than " + std::to_string(ARR_PDC_RING - 1) + " samples");
    // 1.10 slice 5 U2b (plan E9): the delay of every key against the input of its stage, from the arrival times of the table just computed; a key that needs a longer delay than the ring holds is refused
    if (std::string m; !arr_schluessel_versatz(*snap, &m)) format(m);
  } catch (const Abbruch& a) {
    for (int32_t sl : snap->bk_refs) cache.bk_gib(sl);   // S20: graph references taken so far
#ifndef CYPHERDJ_MUTATION_ARR_KIT_FEHLER_OHNE_GIB
    for (int32_t sl : snap->kit_refs) cache.kit_gib(sl);   // 1.9: kit references taken so far
#endif
    for (ArrAudio* x : geholt) cache.gib(x);
    erg.grund = a.grund;
    erg.meldung = pfad + ": " + a.what();
    return erg;
  } catch (const std::exception& e) {
    for (int32_t sl : snap->bk_refs) cache.bk_gib(sl);   // S20: graph references taken so far
#ifndef CYPHERDJ_MUTATION_ARR_KIT_FEHLER_OHNE_GIB
    for (int32_t sl : snap->kit_refs) cache.kit_gib(sl);   // 1.9: kit references taken so far
#endif
    for (ArrAudio* x : geholt) cache.gib(x);
    erg.grund = "format";
    erg.meldung = pfad + ": " + e.what();
    return erg;
  }
  if (std::string g, m; !cache.sperre(*snap, g, m)) {   // K1-Fix 8: Kopf und Felder gesperrt und gebucht
    for (int32_t sl : snap->bk_refs) cache.bk_gib(sl);   // S20: graph references taken so far
#ifndef CYPHERDJ_MUTATION_ARR_KIT_FEHLER_OHNE_GIB
    for (int32_t sl : snap->kit_refs) cache.kit_gib(sl);   // 1.9: kit references taken so far
#endif
    for (ArrAudio* x : geholt) cache.gib(x);
    erg.grund = g;
    erg.meldung = pfad + ": " + m;
    return erg;
  }
  snap->audios = geholt;
  erg.snap = std::move(snap);
  return erg;
}

}  // namespace cdj
