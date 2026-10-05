// Lader des Kerns (lader.h). Scheibe 31. Nur Lade-Faden und Start, nie der Callback.
#include "cypherdj/lader.h"

#include <fcntl.h>
#include <openssl/evp.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>

#include <cerrno>
#include <cmath>
#include <cstdio>
#include <cstring>

namespace cdj {

const char* grund_text(LadeGrund g) {
  switch (g) {
    case LadeGrund::ok: return "";
    case LadeGrund::material_fehlt: return "material_fehlt";
    case LadeGrund::pruefung: return "pruefung";
    case LadeGrund::budget_speicher: return "budget_speicher";
  }
  return "pruefung";
}

namespace {

constexpr int STICHPROBE = 4096;  // §13.2: NaN in einer Stichprobe von 4096 Frames

std::string sha256_hex(const void* p, size_t n) {
  unsigned char md[EVP_MAX_MD_SIZE];
  unsigned int len = 0;
  if (EVP_Digest(p, n, md, &len, EVP_sha256(), nullptr) != 1) return "";
  static const char* hex = "0123456789abcdef";
  std::string s(2 * len, '0');
  for (unsigned i = 0; i < len; ++i) {
    s[2 * i] = hex[md[i] >> 4];
    s[2 * i + 1] = hex[md[i] & 15];
  }
  return s;
}

// Stichprobe: 4096 Frames gleichmäßig von Frame 0 bis frames − 1, beide Kanäle endlich (NaN und ±Inf).
bool stichprobe_endlich(const float* x, int64_t frames, int64_t& bei) {
  for (int j = 0; j < STICHPROBE; ++j) {
    const int64_t f = frames > 1 ? (frames - 1) * j / (STICHPROBE - 1) : 0;
    if (!std::isfinite(x[2 * f]) || !std::isfinite(x[2 * f + 1])) {
      bei = f;
      return false;
    }
  }
  return true;
}

void ausblenden(Material* m, int bis) {
  for (int i = 0; i < bis; ++i) {
    if (!m->abbild[i]) continue;
    munlock(m->abbild[i], m->bytes[i]);
    munmap(m->abbild[i], m->bytes[i]);
    m->abbild[i] = nullptr;
  }
}

}  // namespace

Lader::Lader(std::string arbeitsbestand, int64_t budget_bytes) : ab_(std::move(arbeitsbestand)), budget_(budget_bytes) {}

Material* Lader::lade(const LadeAuftrag& a, LadeGrund& grund, std::string& meldung, const LaderOptionen& opt) {
  auto fehler = [&](LadeGrund g, const std::string& text) -> Material* {
    grund = g;
    meldung = text;
    return nullptr;
  };
  grund = LadeGrund::ok;
  meldung.clear();
  if (!material_id_gueltig(a.material_id)) return fehler(LadeGrund::pruefung, "material_id nicht 16 Hex-Zeichen");
  const std::string ordner = fassung_ordner(ab_, a.material_id, a.basis_bpm, a.fassung);
  FassungInfo fi;
  std::string m;
  switch (lies_fassung(ordner, fi, m)) {
    case FassungFehler::fehlt: return fehler(LadeGrund::material_fehlt, m);
    case FassungFehler::form: return fehler(LadeGrund::pruefung, m);
    case FassungFehler::keiner: break;
  }
  if (fi.material_id != a.material_id || std::fabs(fi.basis_bpm - a.basis_bpm) > 1e-9 || fi.fassung != a.fassung)
    return fehler(LadeGrund::pruefung, ordner + ": fassung.json passt nicht zu Material, Basis oder Fassung");
  const bool stems = a.mit_stems != 0;
  if (stems != (fi.analyse_quelle == "stems") || (stems && !fi.hat_stems))
    return fehler(LadeGrund::pruefung, ordner + ": mit_stems passt nicht zu analyse_quelle " + fi.analyse_quelle);
  // „Rate“ (§13.2): fassung.json hat kein Ratenfeld; das Raster bei 48 kHz muss die Datei decken (Festlegung F2)
  const double soll = frame_von(fi.beats, fi.erster_schlag_frame, fi.basis_bpm);
  if (std::fabs(soll - static_cast<double>(fi.frames)) > 1.0 + 0.001 * static_cast<double>(fi.frames))
    return fehler(LadeGrund::pruefung, ordner + ": beats und erster_schlag_frame decken frames bei 48 kHz nicht");

  const int n = stems ? STEM_ANZAHL : 1;
  std::string datei[STEM_ANZAHL], sha[STEM_ANZAHL];
  for (int i = 0; i < n; ++i) {
    datei[i] = ordner + "/" + (stems ? fi.stems[i].datei : fi.datei);
    sha[i] = stems ? fi.stems[i].sha256 : fi.sha256;
    if (stems && fi.stems[i].frames != fi.frames)
      return fehler(LadeGrund::pruefung, datei[i] + ": frames weicht von der Fassung ab");
  }
  // Größe (§13.2: frames · 2 · 4) und Budget vor dem Einblenden
  const size_t bytes = static_cast<size_t>(fi.frames) * 2 * sizeof(float);
  int fd[STEM_ANZAHL] = {-1, -1, -1, -1};
  auto schliesse = [&] {
    for (int i = 0; i < n; ++i)
      if (fd[i] >= 0) close(fd[i]);
  };
  for (int i = 0; i < n; ++i) {
    fd[i] = open(datei[i].c_str(), O_RDONLY | O_CLOEXEC);
    if (fd[i] < 0) {
      schliesse();
      return fehler(LadeGrund::material_fehlt, datei[i] + ": " + std::strerror(errno));
    }
    struct stat st;
    if (fstat(fd[i], &st) != 0 || static_cast<size_t>(st.st_size) != bytes) {
      schliesse();
      return fehler(LadeGrund::pruefung, datei[i] + ": Größe weicht von frames · 8 ab");
    }
  }
  const int64_t bedarf = static_cast<int64_t>(bytes) * n;
  if (gesperrt() + bedarf > budget_) {
    schliesse();
    return fehler(LadeGrund::budget_speicher, "Budget: " + std::to_string((gesperrt() + bedarf) >> 20) + " MiB > " +
                                                  std::to_string(budget_ >> 20) + " MiB");
  }
  auto* mat = new Material{};
  std::snprintf(mat->material_id, sizeof mat->material_id, "%s", a.material_id);
  mat->basis_bpm = fi.basis_bpm;
  mat->fassung = fi.fassung;
  mat->mit_stems = stems ? 1 : 0;
  mat->n_quellen = n;
  mat->erste_eins_quell_beat = fi.erste_eins_quell_beat;
  mat->frames = fi.frames;
  mat->erster_schlag_frame = fi.erster_schlag_frame;
  mat->beats = fi.beats;
  mat->lufs_integriert = fi.lufs_integriert;
  for (int i = 0; i < n; ++i) {
    void* p = mmap(nullptr, bytes, PROT_READ, MAP_SHARED | (opt.sperren ? MAP_POPULATE : 0), fd[i], 0);
    if (p == MAP_FAILED) {
      const int e = errno;
      ausblenden(mat, i);
      delete mat;
      schliesse();
      return fehler(e == ENOMEM ? LadeGrund::budget_speicher : LadeGrund::pruefung, datei[i] + ": mmap " + std::strerror(e));
    }
    mat->abbild[i] = p;
    mat->bytes[i] = bytes;
    mat->quelle[i] = static_cast<const float*>(p);
    if (opt.sperren && mlock(p, bytes) != 0) {  // 10 Probe d: 4200 MiB scheitert mit ENOMEM
      const int e = errno;
      ausblenden(mat, i + 1);
      delete mat;
      schliesse();
      return fehler(LadeGrund::budget_speicher, datei[i] + ": mlock " + std::strerror(e));
    }
  }
  schliesse();
  for (int i = 0; i < n; ++i) {
    if (opt.pruefsumme && sha256_hex(mat->abbild[i], bytes) != sha[i]) {
      ausblenden(mat, n);
      delete mat;
      return fehler(LadeGrund::pruefung, datei[i] + ": sha256 stimmt nicht");
    }
    int64_t bei = 0;
    if (!stichprobe_endlich(mat->quelle[i], fi.frames, bei)) {
      ausblenden(mat, n);
      delete mat;
      return fehler(LadeGrund::pruefung, datei[i] + ": NaN oder Inf in der Stichprobe bei Frame " + std::to_string(bei));
    }
    // Fehlerfall der Abnahme (M8, Prüfschalter): die Stichprobe liegt über die ganze Datei verteilt; bei einer Datei
    // unter rund 300 MiB ist ihr Abstand kleiner als die 16 Seiten, die der Kern je Seitenfehler mit einblendet
    // (fault-around), und der Lade-Faden hätte die Seiten so schon ganz eingetragen (gemessen an mfbass r1, 185 MiB:
    // 1 Seitenfehler beim Lesen statt rund 150). Die Einträge wieder weg: der Callback berührt die Seiten als Erster.
    if (!opt.sperren) madvise(mat->abbild[i], bytes, MADV_DONTNEED);
  }
  mat->gesperrt = bedarf;
  gesperrt_.fetch_add(bedarf, std::memory_order_relaxed);
  return mat;
}

void Lader::gib_frei(Material* m) {
  if (!m) return;
  ausblenden(m, m->n_quellen);
  gesperrt_.fetch_sub(m->gesperrt, std::memory_order_relaxed);
  delete m;
}

bool Lader::einmal(LaderRinge& r, const LaderOptionen& opt) {
  bool arbeit = false;
  Material* m = nullptr;
  while (r.rueckgabe.hole(m)) {
    std::fprintf(stderr, "Lader: %s/%s_r%d freigegeben\n", m->material_id, bpm_text(m->basis_bpm).c_str(), m->fassung);
    gib_frei(m);
    arbeit = true;
  }
  LadeAuftrag a;
  if (r.auftraege.hole(a)) {
    LadeErgebnis e{};
    e.auftrag = a;
    std::string meldung;
    e.material = lade(a, e.grund, meldung, opt);
    if (e.material)
      std::fprintf(stderr, "Lader: Deck %d %s/%s_r%d eingeblendet, %lld MiB gesperrt\n", a.deck, a.material_id,
                   bpm_text(a.basis_bpm).c_str(), a.fassung, (long long)(gesperrt() >> 20));
    else
      std::fprintf(stderr, "Lader: Deck %d %s abgelehnt (%s): %s\n", a.deck, a.material_id, grund_text(e.grund),
                   meldung.c_str());
    int versuche = 0;
    while (!r.ergebnisse.schiebe(e)) {  // der Callback leert je Zyklus; steht er, nach 1 s aufgeben
      if (++versuche > 1000) {
        std::fprintf(stderr, "Lader: Ergebnisring voll, Deck %d verworfen\n", a.deck);
        gib_frei(e.material);
        break;
      }
      usleep(1000);
    }
    arbeit = true;
  }
  return arbeit;
}

void Lader::laufen(LaderRinge& r, const std::atomic<bool>& stop, const LaderOptionen& opt) {
  while (!stop.load(std::memory_order_relaxed))
    if (!einmal(r, opt)) usleep(1000);
}

}  // namespace cdj
