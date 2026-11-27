// JSON files of the contract (notes.md): sidecar, external curve, render order. The checks mirror notes_contract.ts rule by rule and in
// the same order, so that both sides give the same reason code for every example of djk/contract/cases/noten/ (gruende.json).
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <regex>

#include "intern.h"

namespace cdj::noten {
namespace {

using json = nlohmann::json;
using ojson = nlohmann::ordered_json;

constexpr const char* KURVE_FORMAT = "cdj-noten-kurve/1";
constexpr const char* ROH_FORMAT = "cdj-noten-kurve-roh/1";
constexpr const char* AUFTRAG_FORMAT = "cdj-noten-auftrag/1";

// ---- helpers ---------------------------------------------------------------------------------------------------------------------

std::string zahlText(double x) {
  char b[40];
  std::snprintf(b, sizeof b, "%.10g", x);
  return b;
}

bool passt(const std::string& s, const char* muster) {
  if (s.size() > 64) return false;   // no pattern here matches more; std::regex_match recurses per character and overflows the stack on long strings
  static thread_local std::map<std::string, std::regex> cache;
  auto it = cache.find(muster);
  if (it == cache.end()) it = cache.emplace(muster, std::regex(muster)).first;
  return std::regex_match(s, it->second);
}
bool kurveIdOk(const json& j) { return j.is_string() && passt(j.get<std::string>(), "[a-z0-9_]+-[0-9]+\\.[a-z0-9_]+-[0-9]+"); }
bool shaOk(const json& j) { return j.is_string() && passt(j.get<std::string>(), "[0-9a-f]{64}"); }

bool istZahl(const json& j) { return j.is_number() && std::isfinite(j.get<double>()); }
bool istGanz(const json& j) {
  if (j.is_number_integer()) return true;
  if (!j.is_number_float()) return false;
  const double v = j.get<double>();
  return std::isfinite(v) && std::floor(v) == v;
}
double num(const json& j) { return j.get<double>(); }
bool imBereich(const json& j, double von, double bis) { return istZahl(j) && num(j) >= von && num(j) <= bis; }
bool nachkommaOk(double x, int stellen) {
  const double s = std::pow(10.0, stellen);
  return std::fabs(std::round(x * s) - x * s) < 1e-6;
}

/// Missing required field, then unknown field: the text of the first problem, or empty.
std::string nurFelder(const json& o, const std::vector<std::string>& erlaubt, const std::vector<std::string>& pflicht, const std::string& wo) {
  for (const auto& k : pflicht) if (!o.contains(k)) return wo + ": missing field " + k;
  for (auto it = o.begin(); it != o.end(); ++it) {
    if (std::find(erlaubt.begin(), erlaubt.end(), it.key()) == erlaubt.end()) return wo + ": unknown field " + it.key();
  }
  return {};
}

Fehler formFehler(const std::string& text) { return Fehler{"format", text}; }

// ---- note lists --------------------------------------------------------------------------------------------------------------------

// form: the schema refuses it; bereich: `ton` outside 0..127; regel: a rule that compares values; grenze: `ton` beyond the span
enum class Art { Form, Bereich, Regel, Grenze };
struct ListFehler {
  Art art;
  std::string text;
};

std::optional<ListFehler> noteForm(const json& n, const std::string& wo, bool mitZiel, AudioNote& aus) {
  if (!n.is_object()) return ListFehler{Art::Form, wo + ": must be an object"};
  std::vector<std::string> basis = mitZiel ? std::vector<std::string>{"id", "qa", "qe", "qton", "p"} : std::vector<std::string>{"qa", "qe", "qton", "p"};
  std::vector<std::string> erlaubt = basis;
  if (mitZiel) for (const char* z : {"a", "e", "ton", "vib", "drift", "formant", "gain_db"}) erlaubt.push_back(z);
  if (auto f = nurFelder(n, erlaubt, basis, wo); !f.empty()) return ListFehler{Art::Form, f};
  if (mitZiel) {
    if (!n["id"].is_string() || !passt(n["id"].get<std::string>(), "t[1-9][0-9]{0,5}"))
      return ListFehler{Art::Form, wo + ".id: id must match ^t[1-9][0-9]{0,5}$"};
    aus.id = n["id"].get<std::string>();
  }
  if (!istZahl(n["qa"]) || num(n["qa"]) < 0) return ListFehler{Art::Form, wo + ".qa: must be a number >= 0"};
  if (!istZahl(n["qe"]) || num(n["qe"]) <= 0) return ListFehler{Art::Form, wo + ".qe: must be a number > 0"};
  if (!imBereich(n["qton"], 0, 127)) return ListFehler{Art::Form, wo + ".qton: must be a number in 0..127"};
  if (!imBereich(n["p"], 0, 1)) return ListFehler{Art::Form, wo + ".p: must be a number in 0..1"};
  aus.qa = num(n["qa"]);
  aus.qe = num(n["qe"]);
  aus.qton = num(n["qton"]);
  aus.p = num(n["p"]);
  if (!mitZiel) return std::nullopt;
  if (n.contains("a")) {
    if (!istZahl(n["a"]) || num(n["a"]) < 0) return ListFehler{Art::Form, wo + ".a: must be a number >= 0"};
    aus.a = num(n["a"]);
  }
  if (n.contains("e")) {
    if (!istZahl(n["e"]) || num(n["e"]) <= 0) return ListFehler{Art::Form, wo + ".e: must be a number > 0"};
    aus.e = num(n["e"]);
  }
  if (n.contains("ton")) {
    if (!istZahl(n["ton"])) return ListFehler{Art::Form, wo + ".ton: must be a number"};
    const double t = num(n["ton"]);
    if (t < 0 || t > 127) return ListFehler{Art::Bereich, wo + ".ton: " + zahlText(t) + " is outside the limit 0..127"};
    aus.ton = t;
  }
  struct Faktor { const char* name; double von, bis, vorgabe; std::optional<double> AudioNote::*feld; };
  const Faktor faktoren[] = {{"vib", 0, 4, 1, &AudioNote::vib}, {"drift", 0, 4, 1, &AudioNote::drift},
                             {"formant", -12, 12, 0, &AudioNote::formant}, {"gain_db", -48, 12, 0, &AudioNote::gain_db}};
  for (const auto& f : faktoren) {
    if (!n.contains(f.name)) continue;
    const std::string w = wo + "." + f.name;
    if (!imBereich(n[f.name], f.von, f.bis))
      return ListFehler{Art::Form, w + ": must be a number in " + zahlText(f.von) + ".." + zahlText(f.bis)};
    if (num(n[f.name]) == f.vorgabe) return ListFehler{Art::Form, w + ": " + zahlText(f.vorgabe) + " is the default and is not stored"};
    aus.*(f.feld) = num(n[f.name]);
  }
  return std::nullopt;
}

/// Rules that compare values, shape already checked. Fixed order, each rule across the whole list before the next one: duplicate ids,
/// duration, targets against detected values (per note: ton equal, ton span, a equal, e equal, effective end), order, overlap, and
/// (sidecar only, endeMax given) the end of the last note inside the source.
std::optional<ListFehler> noteRegeln(const std::vector<AudioNote>& l, const std::string& wo, bool mitZiel, std::optional<double> endeMax) {
  auto stelle = [&](size_t i) { return wo + "[" + std::to_string(i) + "]"; };
  if (mitZiel) {
    std::vector<std::string> ids;
    ids.reserve(l.size());
    for (size_t i = 0; i < l.size(); ++i) {
      if (std::find(ids.begin(), ids.end(), l[i].id) != ids.end()) return ListFehler{Art::Regel, stelle(i) + ".id: duplicate id " + l[i].id};
      ids.push_back(l[i].id);
    }
  }
  for (size_t i = 0; i < l.size(); ++i) {
    if (l[i].qe <= l[i].qa + 0.01) return ListFehler{Art::Regel, stelle(i) + ": duration must be greater than 0.01 s (qe > qa + 0.01)"};
  }
  if (mitZiel) {
    for (size_t i = 0; i < l.size(); ++i) {
      const AudioNote& n = l[i];
      const std::string w = stelle(i);
      if (n.ton) {
        if (*n.ton == n.qton) return ListFehler{Art::Regel, w + ".ton: equals qton, a target that equals the detected value is not stored"};
        if (!tonImSpann(*n.ton, n.qton))
          return ListFehler{Art::Grenze, w + ".ton: " + zahlText(*n.ton) + " is more than 24 semitones from qton " + zahlText(n.qton) + " (limit)"};
      }
      if (n.a && *n.a == n.qa) return ListFehler{Art::Regel, w + ".a: equals qa, a target that equals the detected value is not stored"};
      if (n.e && *n.e == n.qe) return ListFehler{Art::Regel, w + ".e: equals qe, a target that equals the detected value is not stored"};
      if (n.e.value_or(n.qe) <= n.a.value_or(n.qa)) return ListFehler{Art::Regel, w + ": e must be greater than a (qe and qa count where a target is absent)"};
    }
  }
  for (size_t i = 1; i < l.size(); ++i) {
    if (l[i].qa < l[i - 1].qa) return ListFehler{Art::Regel, stelle(i) + ": notes must be in order of qa (qa " + zahlText(l[i].qa) + " comes before " + zahlText(l[i - 1].qa) + ")"};
  }
  for (size_t i = 1; i < l.size(); ++i) {
    if (l[i - 1].qe > l[i].qa) return ListFehler{Art::Regel, stelle(i) + ": notes overlap (qe " + zahlText(l[i - 1].qe) + " is after the next qa " + zahlText(l[i].qa) + ")"};
  }
  if (endeMax) {
    for (size_t i = 0; i < l.size(); ++i) {
      if (l[i].qe > *endeMax) return ListFehler{Art::Regel, stelle(i) + ": note ends after the end of the source (qe " + zahlText(l[i].qe) + ", at most " + zahlText(*endeMax) + ")"};
    }
  }
  return std::nullopt;
}

/// Shape of every note (into `aus`), then the rules of the whole list; nullopt = valid.
std::optional<ListFehler> listeFehler(const json& liste, const std::string& wo, bool mitZiel, std::optional<double> endeMax, std::vector<AudioNote>& aus) {
  if (!liste.is_array()) return ListFehler{Art::Form, wo + ": must be an array"};
  if (liste.size() > static_cast<size_t>(MAX_NOTEN)) return ListFehler{Art::Form, wo + ": at most " + std::to_string(MAX_NOTEN) + " notes"};
  aus.clear();
  aus.reserve(liste.size());
  for (size_t i = 0; i < liste.size(); ++i) {
    AudioNote n;
    if (auto f = noteForm(liste[i], wo + "[" + std::to_string(i) + "]", mitZiel, n)) return f;
    aus.push_back(std::move(n));
  }
  return noteRegeln(aus, wo, mitZiel, endeMax);
}

/// Code of a failed list inside a file: what the schema refuses (the ton range included) is `format`, a broken list rule (the span included) is `noten_ungueltig`.
Fehler dateiFehler(const ListFehler& f) {
  return Fehler{f.art == Art::Form || f.art == Art::Bereich ? "format" : "noten_ungueltig", f.text};
}

// ---- curves --------------------------------------------------------------------------------------------------------------------------

std::string felderFehler(const json& o, const std::string& wo) {
  const json& f0 = o["f0_ct"];
  const json& konf = o["konf"];
  if (!f0.is_array()) return wo + ".f0_ct: must be an array";
  if (!konf.is_array()) return wo + ".konf: must be an array";
  for (size_t i = 0; i < f0.size(); ++i) {
    const json& v = f0[i];
    if (!((istZahl(v) && num(v) == 0.0) || imBereich(v, 1500, 11000))) return wo + ".f0_ct[" + std::to_string(i) + "]: must be 0 or in 1500..11000";
  }
  for (size_t i = 0; i < konf.size(); ++i) {
    if (!imBereich(konf[i], 0, 1)) return wo + ".konf[" + std::to_string(i) + "]: must be a number in 0..1";
  }
  return {};
}

std::string laengeFehler(const json& o) {
  const int64_t n = frameZahl(static_cast<int64_t>(num(o["frames"])));
  const json& f0 = o["f0_ct"];
  const json& konf = o["konf"];
  if (static_cast<int64_t>(f0.size()) != n)
    return "length of f0_ct is " + std::to_string(f0.size()) + ", expected " + std::to_string(n) + " (floor(frames / 256) + 1)";
  if (static_cast<int64_t>(konf.size()) != n)
    return "length of konf is " + std::to_string(konf.size()) + ", expected " + std::to_string(n) + " (floor(frames / 256) + 1)";
  for (size_t i = 0; i < f0.size(); ++i) if (!nachkommaOk(num(f0[i]), 2)) return "f0_ct[" + std::to_string(i) + "]: at most two decimals";
  for (size_t i = 0; i < konf.size(); ++i) if (!nachkommaOk(num(konf[i]), 3)) return "konf[" + std::to_string(i) + "]: at most three decimals";
  return {};
}

std::string kopfFehler(const json& o, const char* format) {
  if (!o["format"].is_string() || o["format"].get<std::string>() != format) return std::string("format: must be ") + format;
  if (!istGanz(o["frames"]) || num(o["frames"]) < 0) return "frames: must be an integer >= 0";
  if (!istZahl(o["sr"]) || num(o["sr"]) != SR) return "sr: must be 48000";
  if (!istZahl(o["hop"]) || num(o["hop"]) != HOP) return "hop: must be 256";
  return {};
}

std::vector<double> alsVektor(const json& a) {
  std::vector<double> v;
  v.reserve(a.size());
  for (const auto& e : a) v.push_back(num(e));
  return v;
}

/// Checks a sidecar document (precedence: shape of the file, mono rules, shape of all notes, array lengths and decimals, list rules)
/// and fills the struct.
std::variant<Seitendatei, Fehler> pruefeKurve(const json& x) {
  if (!x.is_object()) return formFehler("curve must be an object");
  const std::vector<std::string> pflicht = {"format", "quelle", "frames", "sr", "hop", "detektor", "kurve", "f0_ct", "konf", "noten", "stimmhaft_anteil"};
  std::vector<std::string> erlaubt = pflicht;
  erlaubt.push_back("mono");
  if (auto f = nurFelder(x, erlaubt, pflicht, "curve"); !f.empty()) return formFehler(f);
  if (auto f = kopfFehler(x, KURVE_FORMAT); !f.empty()) return formFehler(f);
  if (!shaOk(x["quelle"])) return formFehler("quelle: must be 64 lowercase hex digits");
  if (!x["detektor"].is_string() || (x["detektor"] != "pyin" && x["detektor"] != "netz")) return formFehler("detektor: must be pyin or netz");
  if (!kurveIdOk(x["kurve"])) return formFehler("kurve: must be <detector version>.<segmenter version>, for example pyin-1.noten_hmm-1");
  const std::string detektor = x["detektor"].get<std::string>();
  const std::string kurve = x["kurve"].get<std::string>();
  if (kurve.rfind(detektor + "-", 0) != 0) return formFehler("kurve: must start with the version of the detector " + detektor);
  if (auto f = felderFehler(x, "curve"); !f.empty()) return formFehler(f);
  if (!imBereich(x["stimmhaft_anteil"], 0, 1)) return formFehler("stimmhaft_anteil: must be a number in 0..1");
  std::optional<Mono> mono;
  if (x.contains("mono")) {
    const json& m = x["mono"];
    if (!m.is_object()) return formFehler("mono: must be an object");
    const std::vector<std::string> mf = {"geprueft_frames", "anteil", "mehrstimmig", "hrr_db_schwelle", "periode_schwelle"};
    if (auto f = nurFelder(m, mf, mf, "mono"); !f.empty()) return formFehler(f);
    if (!istGanz(m["geprueft_frames"]) || num(m["geprueft_frames"]) < 0) return formFehler("mono.geprueft_frames: must be an integer >= 0");
    if (!imBereich(m["anteil"], 0, 1)) return formFehler("mono.anteil: must be a number in 0..1");
    if (!m["mehrstimmig"].is_boolean()) return formFehler("mono.mehrstimmig: must be a boolean");
    if (!istZahl(m["hrr_db_schwelle"]) || !istZahl(m["periode_schwelle"])) return formFehler("mono thresholds: must be numbers");
    const double anteil = num(m["anteil"]);
    const bool soll = anteil > MONO_ANTEIL_MAX;
    if (m["mehrstimmig"].get<bool>() != soll)
      return formFehler(std::string("mono.mehrstimmig: must be ") + (soll ? "true" : "false") + " for anteil " + zahlText(anteil) + " (true only above 0.3)");
    if (num(m["geprueft_frames"]) == 0 && anteil != 0) return formFehler("mono.geprueft_frames: 0 checked frames means anteil 0 and mehrstimmig false");
    mono = Mono{static_cast<int64_t>(num(m["geprueft_frames"])), anteil, m["mehrstimmig"].get<bool>(), num(m["hrr_db_schwelle"]), num(m["periode_schwelle"])};
  }
  const double frames = num(x["frames"]);
  std::vector<AudioNote> noten;
  const auto l = listeFehler(x["noten"], "noten", false, (frames + HOP) / SR + 1e-6, noten);
  if (l && l->art == Art::Form) return dateiFehler(*l);
  if (auto f = laengeFehler(x); !f.empty()) return formFehler(f);
  if (l) return dateiFehler(*l);
  Seitendatei s;
  s.quelle = x["quelle"].get<std::string>();
  s.k.sr = SR;
  s.k.hop = HOP;
  s.k.frames = static_cast<int64_t>(frames);
  s.k.detektor = detektor;
  s.k.kurve = kurve;
  s.k.f0_ct = alsVektor(x["f0_ct"]);
  s.k.konf = alsVektor(x["konf"]);
  for (const auto& n : noten) s.noten.push_back(NoteQ{n.qa, n.qe, n.qton, n.p});
  s.stimmhaft_anteil = num(x["stimmhaft_anteil"]);
  s.mono = mono;
  return s;
}

std::variant<json, Fehler> liesJson(const std::string& pfad) {
  auto t = liesText(pfad);
  if (auto* f = std::get_if<Fehler>(&t)) return *f;
  json j = json::parse(std::get<std::string>(t), nullptr, false);
  if (j.is_discarded()) return Fehler{"datei_kaputt", "The file is not valid JSON: " + pfad};
  return j;
}

double runde(double x, double faktor) { return std::round(x * faktor) / faktor; }

}  // namespace

double rundeS(double x) { return runde(x, 1e6); }
double rundeTon(double x) { return runde(x, 1e4); }

std::variant<Seitendatei, Fehler> liesSeitendatei(const std::string& pfad) {
  auto j = liesJson(pfad);
  if (auto* f = std::get_if<Fehler>(&j)) return *f;
  return pruefeKurve(std::get<json>(j));
}

std::optional<Fehler> schreibeSeitendatei(const std::string& pfad, const Seitendatei& s) {
  ojson j;
  j["format"] = KURVE_FORMAT;
  j["quelle"] = s.quelle;
  j["frames"] = s.k.frames;
  j["sr"] = s.k.sr;
  j["hop"] = s.k.hop;
  j["detektor"] = s.k.detektor;
  j["kurve"] = s.k.kurve;
  ojson f0 = ojson::array();
  for (double v : s.k.f0_ct) {
    if (v == 0.0) f0.push_back(0);
    else f0.push_back(runde(v, 100.0));
  }
  ojson konf = ojson::array();
  for (double v : s.k.konf) konf.push_back(runde(std::min(1.0, std::max(0.0, v)), 1000.0));
  j["f0_ct"] = std::move(f0);
  j["konf"] = std::move(konf);
  ojson noten = ojson::array();
  for (const auto& n : s.noten) {
    ojson o;
    o["qa"] = rundeS(n.qa);
    o["qe"] = rundeS(n.qe);
    o["qton"] = rundeTon(n.qton);
    o["p"] = rundeTon(n.p);
    noten.push_back(std::move(o));
  }
  j["noten"] = std::move(noten);
  j["stimmhaft_anteil"] = runde(s.stimmhaft_anteil, 1e4);
  if (s.mono) {
    ojson m;
    m["geprueft_frames"] = s.mono->geprueft_frames;
    m["anteil"] = s.mono->anteil;
    m["mehrstimmig"] = s.mono->mehrstimmig;
    m["hrr_db_schwelle"] = s.mono->hrr_db_schwelle;
    m["periode_schwelle"] = s.mono->periode_schwelle;
    j["mono"] = std::move(m);
  }
  // the file must be one that liesSeitendatei accepts
  const std::string text = j.dump();
  const json pruef = json::parse(text, nullptr, false);
  if (pruef.is_discarded()) return Fehler{"format", "the sidecar cannot be written as JSON (non-finite number)"};
  const std::variant<Seitendatei, Fehler> geprueft = pruefeKurve(pruef);
  if (const auto* f = std::get_if<Fehler>(&geprueft)) return *f;
  return schreibeText(pfad, text + "\n");
}

std::variant<Kurve, Fehler> liesRoh(const std::string& pfad) {
  auto j = liesJson(pfad);
  if (auto* f = std::get_if<Fehler>(&j)) return *f;
  const json& x = std::get<json>(j);
  if (!x.is_object()) return formFehler("curve must be an object");
  const std::vector<std::string> pflicht = {"format", "frames", "sr", "hop", "detektor", "detektor_version", "f0_ct", "konf"};
  if (auto f = nurFelder(x, pflicht, pflicht, "curve"); !f.empty()) return formFehler(f);
  if (auto f = kopfFehler(x, ROH_FORMAT); !f.empty()) return formFehler(f);
  if (!x["detektor"].is_string() || x["detektor"] != "netz") return formFehler("detektor: must be netz");
  if (!x["detektor_version"].is_string() || !passt(x["detektor_version"].get<std::string>(), "netz-[0-9]+"))
    return formFehler("detektor_version: must be netz-<n>");
  if (auto f = felderFehler(x, "curve"); !f.empty()) return formFehler(f);
  if (auto f = laengeFehler(x); !f.empty()) return formFehler(f);
  Kurve k;
  k.frames = static_cast<int64_t>(num(x["frames"]));
  k.detektor = "netz";
  k.kurve = x["detektor_version"].get<std::string>() + "." + std::string(SEGMENTIERER_VERSION);
  k.f0_ct = alsVektor(x["f0_ct"]);
  k.konf = alsVektor(x["konf"]);
  return k;
}

std::variant<std::vector<AudioNote>, Fehler> liesAuftrag(const std::string& pfad, const std::string& kurveId) {
  auto j = liesJson(pfad);
  if (auto* f = std::get_if<Fehler>(&j)) return *f;
  const json& x = std::get<json>(j);
  if (!x.is_object()) return formFehler("order must be an object");
  const std::vector<std::string> pflicht = {"format", "kurve", "liste"};
  if (auto f = nurFelder(x, pflicht, pflicht, "order"); !f.empty()) return formFehler(f);
  if (!x["format"].is_string() || x["format"].get<std::string>() != AUFTRAG_FORMAT) return formFehler(std::string("format: must be ") + AUFTRAG_FORMAT);
  if (!kurveIdOk(x["kurve"])) return formFehler("kurve: must be <detector version>.<segmenter version>, for example pyin-1.noten_hmm-1");
  std::vector<AudioNote> liste;
  if (auto l = listeFehler(x["liste"], "liste", true, std::nullopt, liste)) return dateiFehler(*l);
  if (x["kurve"].get<std::string>() != kurveId)
    return Fehler{"kurve_passt_nicht", "the order is for curve " + x["kurve"].get<std::string>() + ", the sidecar holds " + kurveId};
  return liste;
}

}  // namespace cdj::noten
