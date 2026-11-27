// cdj_noten: internal interface shared by the library and the command files (owned by task A3, not edited by later tasks: they add
// headers of their own, src/detector.h, src/teiltoene.h, src/render.h). Types and the JSON files are in cdj_noten/vertrag.h.
#pragma once
#include <complex>
#include <cstdint>
#include <map>
#include <nlohmann/json.hpp>
#include <optional>
#include <string>
#include <variant>
#include <vector>

#include "cdj_noten/contract.h"

namespace cdj::noten {

// ---- audio files: float32 little endian, interleaved stereo, 48 kHz (the sample rate and the frame count come from the file) --------

/// Reads a stereo f32 file. datei_fehlt when it does not exist, datei_kaputt when the size is not a multiple of 8 bytes (or it cannot be
/// read). Reads in chunks and polls abbruchAngefordert(), so a pipe works too; on SIGTERM the Fehler has the code "abbruch".
std::variant<Stereo, Fehler> liesF32(const std::string& pfad);
/// Writes to `<pfad>.tmp` and renames when complete (schreiben on failure). A pending SIGTERM removes the tmp file and gives "abbruch".
std::optional<Fehler> schreibeF32(const std::string& pfad, const Stereo& s);
/// (L + R) / 2: the detector and the segmenter run on this, one curve for both channels.
std::vector<float> mitte(const Stereo& s);
/// Mono s16le file (the golden vectors): samples scaled by 1/32768. Empty when the file cannot be read.
std::vector<float> liesS16(const std::string& pfad);
/// Whole text file; datei_fehlt or datei_kaputt.
std::variant<std::string, Fehler> liesText(const std::string& pfad);
/// Writes text to `<pfad>.tmp` and renames (the same rules as schreibeF32).
std::optional<Fehler> schreibeText(const std::string& pfad, const std::string& text);

// ---- process control -----------------------------------------------------------------------------------------------------------

/// SIGTERM handling: the handler of the program calls abbruchAnfordern(); loops poll abbruchAngefordert() and end early; the command then
/// removes its tmp file (the writers do it themselves) and exits 143. abbruchZuruecksetzen() is for tests.
void abbruchAnfordern();
bool abbruchAngefordert();
void abbruchZuruecksetzen();
/// CPU seconds of the process (getrusage, user plus system): the `sekunden` of a result line. A wall clock never decides a limit.
double cpuSekunden();

/// Progress on stderr: `@@fortschritt {"stufe":k,"von":n,"name":"...","prozent":p}`, at most ten lines per second (a sliding window; a
/// line the window refuses is dropped). Names: laden, tonhoehe, noten, pruefen, rendern, schreiben.
class Fortschritt {
 public:
  explicit Fortschritt(int von);
  void stufe(int k, const char* name, double prozent);
 private:
  int von_;
  std::vector<double> gesendet_;  // times (seconds) of the last lines, ring of ten
  size_t naechste_ = 0;
};

// ---- segmenter and curve statistics ----------------------------------------------------------------------------------------------

/// Port of `noten_hmm` of the bench (messungen/M21-noten/m21_k_pyin.py, parameters SEG verbatim): notes from the curve and the mono
/// audio. Times are source seconds. The short-source rule is not here but in the commands. Version: SEGMENTIERER_VERSION.
std::vector<NoteQ> segmentiere(const Kurve& k, const std::vector<float>& mono, int sr);
/// Share of voiced frames (f0_ct > 0), 0 for an empty curve.
double stimmhaftAnteil(const Kurve& k);
/// A source this short gets no notes from `analyse` and `segment` (KURZ_QUELLE_FRAMES).
inline bool kurzeQuelle(int64_t frames) { return frames < KURZ_QUELLE_FRAMES; }
/// A sidecar holds at most MAX_NOTEN notes: the later ones of a longer list are dropped (a source of more than 4096 notes).
void kappeNoten(std::vector<NoteQ>& noten);

// ---- FFT -------------------------------------------------------------------------------------------------------------------------

/// In place iterative radix-2 complex FFT in double, size a power of two (std::invalid_argument otherwise), tested for 64..65536.
/// Forward: X[k] = sum x[n] exp(-2 pi i k n / N). Inverse: the conjugate kernel, scaled by 1/N, so fft then inverse returns the input.
void fft(std::vector<std::complex<double>>& x, bool invers);

// ---- command line ----------------------------------------------------------------------------------------------------------------

/// Parsed arguments of one command: positional arguments and `--name value` options (name without dashes). The dispatcher (cli.cpp)
/// has checked the number of positional arguments, the option names and that `--nur` comes with `--vorher`.
struct Argumente {
  std::vector<std::string> pos;
  std::map<std::string, std::string> opt;
  bool hat(const std::string& name) const { return opt.count(name) > 0; }
  std::string wert(const std::string& name) const { auto i = opt.find(name); return i == opt.end() ? std::string() : i->second; }
};

/// The source sha: the file name stem when it is 64 lowercase hex digits, else `--sha` (also 64 hex), else a Fehler "argument".
std::variant<std::string, Fehler> quellSha(const std::string& quelle, const Argumente& a);
/// Prints the one result line (compact JSON, one LF) to stdout; returns 0.
int endeOk(const nlohmann::ordered_json& zeile);
/// Prints {"status":"fehler","fehler":code,"text":text}; returns 2 for `argument`, 1 otherwise. With a pending SIGTERM (or the code
/// "abbruch") it prints nothing and returns 143.
int endeFehler(const Fehler& f);

int cliVersion(const Argumente& a);
int cliAnalyse(const Argumente& a);
int cliSegment(const Argumente& a);
int cliPruefe(const Argumente& a);
int cliRender(const Argumente& a);

}  // namespace cdj::noten
