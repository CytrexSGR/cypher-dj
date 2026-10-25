// D1 K1: Wiedergabe lesen, prüfen, Audio laden (arr_wiedergabe.h). Muster: fassung.cpp (nlohmann, Feldprüfung mit
// Namen), lader.cpp (mmap + MAP_POPULATE + mlock, Budget vor dem Einblenden).
#include "cypherdj/arr_wiedergabe.h"

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

void gib_wiedergabe(ArrSnapshot* s, ArrAudioCache& cache) {
  if (!s) return;
  cache.entsperre(*s);
  for (ArrAudio* a : s->audios) cache.gib(a);
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
      }
    }
    // Zählen, dann reservieren: die Zeiger in ArrSpur zeigen in die Vektoren, die danach nie wachsen
    size_t n_clips = 0, n_noten = 0, n_warps = 0, n_punkte = 0;
    for (const json& s : spuren) {
      if (s.contains("clips") && s.at("clips").is_array()) {
        n_clips += s.at("clips").size();
        for (const json& c : s.at("clips"))   // Paket 1.13: Warps und Marker zählen, bevor reserviert wird (die Zeiger bleiben gültig)
          if (c.is_object() && c.contains("warp") && c.at("warp").is_object() && c.at("warp").contains("w") && c.at("warp").at("w").is_array()) {
            ++n_warps;
            n_punkte += c.at("warp").at("w").size();
          }
      }
      if (s.contains("noten") && s.at("noten").is_array()) n_noten += s.at("noten").size();
    }
    if (n_clips > static_cast<size_t>(ARR_CLIPS_MAX)) throw Abbruch("zu_gross", "mehr als 4096 Clips");
    if (n_noten > static_cast<size_t>(ARR_NOTEN_MAX)) throw Abbruch("zu_gross", "mehr als 65536 Noten");
    if (n_punkte > static_cast<size_t>(ARR_WARP_PUNKTE_MAX))
      throw Abbruch("zu_gross", "mehr als " + std::to_string(ARR_WARP_PUNKTE_MAX) + " Warp-Marker in allen Clips");
    snap->clips.reserve(n_clips);
    snap->noten.reserve(n_noten);
    snap->noten_id.reserve(n_noten);
    snap->noten_id_index.reserve(n_noten);
    snap->warps.reserve(n_warps);
    snap->warp_beat.reserve(n_punkte);
    snap->warp_frame.reserve(n_punkte);
    std::map<std::string, ArrAudio*> je_sha;  // jedes Audio einmal je Schnappschuss
    std::set<int> nr_gesehen;
    for (size_t si = 0; si < spuren.size(); ++si) {
      const json& s = spuren[si];
      const std::string wo = "spuren[" + std::to_string(si) + "].";
      const int64_t nr = ganz(s, "nr", wo);
      if (nr < 1 || nr > ARR_SPUREN)
        throw Abbruch("spur_bereich", wo + "nr " + std::to_string(nr) + " außerhalb 1 bis " + std::to_string(ARR_SPUREN));
      if (!nr_gesehen.insert(static_cast<int>(nr)).second) throw Abbruch("spur_bereich", wo + "nr doppelt");
      ArrSpur& sp = snap->spur[nr - 1];
      sp.nr = static_cast<int>(nr);
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
      } else if (art == "intern") {
        sp.art = ArrArt::intern;
        const std::string g = text(s, "geraet", wo);
        if (g != "rb338") format(wo + "geraet " + g + " unbekannt (D1: rb338)");
        std::snprintf(sp.geraet, sizeof sp.geraet, "%s", g.c_str());
        if (s.contains("parameter")) {
          const json& p = s.at("parameter");
          if (!p.is_object()) format(wo + "parameter ist kein Objekt");
          for (auto it = p.begin(); it != p.end(); ++it) {
            if (sp.n_param >= ARR_PARAMETER) format(wo + "mehr als " + std::to_string(ARR_PARAMETER) + " parameter");
            if (it.key().empty() || it.key().size() >= sizeof sp.param[0].name) format(wo + "parameter-Name zu lang");
            if (!it.value().is_number()) format(wo + "parameter." + it.key() + " ist keine Zahl");
            const double w = it.value().get<double>();
            if (!(w >= 0.0 && w <= 1.0)) format(wo + "parameter." + it.key() + " außerhalb 0 bis 1");
            std::snprintf(sp.param[sp.n_param].name, sizeof sp.param[0].name, "%s", it.key().c_str());
            sp.param[sp.n_param++].wert = static_cast<float>(w);
          }
        }
      } else if (art == "wirt") {
        sp.art = ArrArt::wirt;
        const int64_t slot = ganz(s, "slot", wo);
        if (slot < 1 || slot > ARR_WIRT_SLOTS) throw Abbruch("spur_bereich", wo + "slot außerhalb 1 bis 2");
        sp.slot = static_cast<int>(slot);
      } else {
        format(wo + "art " + art + " unbekannt");
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
            if (modus != ARR_WARP_REPITCH) format(ww + "modus " + std::to_string(modus) + " ist nicht gebaut (nur 0 = repitch)");
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
            w.n = static_cast<int32_t>(wl.size());
            w.beat = snap->warp_beat.data() + p0;
            w.frame = snap->warp_frame.data() + p0;
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
    }
  } catch (const Abbruch& a) {
    for (ArrAudio* x : geholt) cache.gib(x);
    erg.grund = a.grund;
    erg.meldung = pfad + ": " + a.what();
    return erg;
  } catch (const std::exception& e) {
    for (ArrAudio* x : geholt) cache.gib(x);
    erg.grund = "format";
    erg.meldung = pfad + ": " + e.what();
    return erg;
  }
  if (std::string g, m; !cache.sperre(*snap, g, m)) {   // K1-Fix 8: Kopf und Felder gesperrt und gebucht
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
