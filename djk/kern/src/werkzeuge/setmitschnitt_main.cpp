// cypherdj-setmitschnitt: records the live master of a running kern for the length of a whole set. Read only, like
// cypherdj-mitschnitt: it maps the audio ring (/dev/shm/cypherdj[-$CYPHERDJ_INSTANZ]/bus, INTERFACES §6.1) and never
// touches the audio graph or the realtime thread. The ring carries the master behind the master limiter, so the file is
// what leaves the kern (with a voice on stimme_eingang it is the sum of music and voice).
//
// Differences to cypherdj-mitschnitt (which holds at most 600 s in memory): no length limit, the samples go to a WAV file
// (float32 stereo 48 kHz) continuously through a writer thread, the header is brought up to date about once a second (a
// killed recorder still leaves a readable file), and a ring overrun or a kern restart does not end the recording.
//  - overrun (the reader fell behind more than the ring holds): a new reader starts at the current write position, the
//    missing frames are filled with silence (same time axis, so the file keeps its length), noted as a gap.
//  - jump (sample_minus_w changed: the kern restarted with a new time axis): a new reader starts, nothing is filled (the
//    length of the pause is unknown in kern samples), noted as a jump with the wall clock time.
//  - the ring stands still (no kern): the recorder waits and notes it; when the kern comes back it goes on.
// Stop: SIGINT, SIGTERM, or the file given with --stopp appearing. --max-minuten is a safety limit (default 180, at most
// 185: a WAV header holds 4 GiB). While it runs, the ring stays mapped: djk-start then refuses to start the same instance
// (fuser sees the mapping), so stop the recording before a deliberate djk-stop / djk-start.
//
// Call: cypherdj-setmitschnitt --aus <file.wav> [--ring path] [--stopp file] [--max-minuten N]
// Beside the WAV: <file.wav>.json with start time (wall clock), s0 (kern sample of the first frame), frames, gaps, jumps,
// end reason. Every 10 s one line on stderr with the peak of the last 10 s in dBFS.
// Return: 0 written, 2 call, 3 ring missing or invalid, 5 writing failed.
#include <fcntl.h>
#include <signal.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

#include <atomic>
#include <cmath>
#include <condition_variable>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <deque>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include "cypherdj/aufruf_zahl.h"
#include "cypherdj/instanz.h"
#include "cypherdj/json_text.h"
#include "cypherdj/ring_mitschnitt.h"

namespace {

std::atomic<bool> g_halt{false};
void halt(int) { g_halt = true; }

int64_t wanduhr_ns() {
  timespec t;
  clock_gettime(CLOCK_REALTIME, &t);
  return static_cast<int64_t>(t.tv_sec) * 1000000000LL + t.tv_nsec;
}

std::string iso(int64_t ns) {
  const time_t s = static_cast<time_t>(ns / 1000000000LL);
  tm z;
  localtime_r(&s, &z);
  char b[64];
  std::strftime(b, sizeof b, "%Y-%m-%dT%H:%M:%S", &z);
  char c[96];
  char off[8];
  std::strftime(off, sizeof off, "%z", &z);
  std::snprintf(c, sizeof c, "%s.%03lld%.3s:%s", b, static_cast<long long>((ns / 1000000LL) % 1000), off, off + 3);
  return c;
}

// WAV float32 stereo 48 kHz: RIFF, fmt (18 bytes, IEEE float), fact, data. Sizes are patched by kopf().
class WavDatei {
 public:
  bool oeffne(const std::string& pfad) {
    fd_ = ::open(pfad.c_str(), O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC, 0644);
    if (fd_ < 0) return false;
    return kopf();
  }
  bool schreibe(const float* f, size_t frames) {
    const char* p = reinterpret_cast<const char*>(f);
    size_t rest = frames * 2 * sizeof(float);
    while (rest > 0) {
      const ssize_t n = ::pwrite(fd_, p, rest, static_cast<off_t>(KOPF + bytes_));
      if (n < 0) {
        if (errno == EINTR) continue;
        return false;
      }
      p += n;
      rest -= static_cast<size_t>(n);
      bytes_ += static_cast<uint64_t>(n);
    }
    return true;
  }
  bool kopf() {
    unsigned char k[KOPF];
    const uint32_t daten = bytes_ > 0xFFFFFFFFull - KOPF ? 0xFFFFFFFFu - KOPF : static_cast<uint32_t>(bytes_);
    auto u32 = [&](int o, uint32_t v) { for (int i = 0; i < 4; ++i) k[o + i] = static_cast<unsigned char>(v >> (8 * i)); };
    auto u16 = [&](int o, uint16_t v) { k[o] = v & 0xFF; k[o + 1] = v >> 8; };
    std::memcpy(k + 0, "RIFF", 4);
    u32(4, KOPF - 8 + daten);
    std::memcpy(k + 8, "WAVE", 4);
    std::memcpy(k + 12, "fmt ", 4);
    u32(16, 18);
    u16(20, 3);   // WAVE_FORMAT_IEEE_FLOAT
    u16(22, 2);
    u32(24, 48000);
    u32(28, 48000 * 2 * 4);
    u16(32, 8);
    u16(34, 32);
    u16(36, 0);
    std::memcpy(k + 38, "fact", 4);
    u32(42, 4);
    u32(46, daten / 8);
    std::memcpy(k + 50, "data", 4);
    u32(54, daten);
    return ::pwrite(fd_, k, KOPF, 0) == static_cast<ssize_t>(KOPF);
  }
  bool schliessen() {
    const bool ok = kopf() && ::fsync(fd_) == 0;
    return ::close(fd_) == 0 && ok;
  }
  uint64_t frames() const { return bytes_ / 8; }

 private:
  static constexpr size_t KOPF = 58;
  int fd_ = -1;
  uint64_t bytes_ = 0;
};

struct Ereignis {
  std::string art;   // luecke | sprung | steht | weiter
  int64_t bei_frame = 0;
  int64_t frames = 0;
  int64_t wanduhr_ns = 0;
};

const cdj_ring_kopf* ring_oeffnen(const std::string& pfad) {
  const int fd = open(pfad.c_str(), O_RDONLY | O_CLOEXEC);
  struct stat st;
  if (fd < 0) return nullptr;
  if (fstat(fd, &st) != 0 || st.st_size != static_cast<off_t>(CDJ_RING_BYTES)) {
    close(fd);
    return nullptr;
  }
  void* p = mmap(nullptr, CDJ_RING_BYTES, PROT_READ, MAP_SHARED, fd, 0);
  close(fd);
  return p == MAP_FAILED ? nullptr : static_cast<const cdj_ring_kopf*>(p);
}

}  // namespace

int main(int argc, char** argv) {
  if (!cdj::instanz_gueltig("cypherdj-setmitschnitt")) return 2;
  std::string aus, ring_pfad, stopp;
  double max_min = 180.0;   // a WAV header holds at most 4 GiB = 186 min of float stereo
  bool falsch = false;
  for (int i = 1; i < argc; ++i) {
    const bool wert = i + 1 < argc;
    if (!std::strcmp(argv[i], "--aus") && wert) aus = argv[++i];
    else if (!std::strcmp(argv[i], "--ring") && wert) ring_pfad = argv[++i];
    else if (!std::strcmp(argv[i], "--stopp") && wert) stopp = argv[++i];
    else if (!std::strcmp(argv[i], "--max-minuten") && wert) {
      if (!cdj::lies_zahl(argv[++i], max_min) || !(max_min > 0.0 && max_min <= 185.0))
        return cdj::wert_falsch("cypherdj-setmitschnitt", "--max-minuten", argv[i], "number in (0, 185] (WAV limit 4 GiB)");
    } else falsch = true;
  }
  if (falsch || aus.empty()) {
    std::fprintf(stderr, "usage: cypherdj-setmitschnitt --aus <file.wav> [--ring path] [--stopp file] [--max-minuten N]\n");
    return 2;
  }
  if (ring_pfad.empty()) {
    char ordner[128];
    cdj_shm_ordner(ordner, sizeof ordner, cdj_instanz());
    ring_pfad = std::string(ordner) + "/bus";
  }
  const cdj_ring_kopf* ring = ring_oeffnen(ring_pfad);
  if (!ring || !cdj_ring_gueltig(ring)) {
    std::fprintf(stderr, "%s: missing or not a ring of version 1\n", ring_pfad.c_str());
    return 3;
  }
  WavDatei wav;
  if (!wav.oeffne(aus)) {
    std::fprintf(stderr, "%s: %s\n", aus.c_str(), std::strerror(errno));
    return 5;
  }
  struct sigaction sa{};
  sa.sa_handler = halt;
  sigaction(SIGINT, &sa, nullptr);
  sigaction(SIGTERM, &sa, nullptr);

  // writer thread: takes whole blocks from the queue, writes them, patches the header about once a second
  std::mutex m;
  std::condition_variable cv;
  std::deque<std::vector<float>> schlange;
  bool fertig = false;
  std::atomic<bool> schreibfehler{false};
  std::thread schreiber([&] {
    auto letzter_kopf = std::chrono::steady_clock::now();
    for (;;) {
      std::vector<float> b;
      {
        std::unique_lock<std::mutex> g(m);
        cv.wait_for(g, std::chrono::milliseconds(200), [&] { return fertig || !schlange.empty(); });
        if (schlange.empty()) {
          if (fertig) break;
          continue;
        }
        b = std::move(schlange.front());
        schlange.pop_front();
      }
      if (!schreibfehler && !wav.schreibe(b.data(), b.size() / 2)) schreibfehler = true;
      if (std::chrono::steady_clock::now() - letzter_kopf > std::chrono::seconds(1)) {
        wav.kopf();
        letzter_kopf = std::chrono::steady_clock::now();
      }
    }
  });
  auto abgeben = [&](std::vector<float>&& b) {
    if (b.empty()) return;
    {
      std::lock_guard<std::mutex> g(m);
      schlange.push_back(std::move(b));
    }
    cv.notify_one();
  };

  std::vector<Ereignis> ereignisse;
  const int64_t start_ns = wanduhr_ns();
  int64_t s0 = -1;           // kern sample of frame 0 of the file
  int64_t erwartet = -1;     // kern sample of the next frame (same time axis)
  int64_t gesamt = 0;        // frames handed to the writer
  const int64_t max_frames = static_cast<int64_t>(max_min * 60.0 * 48000.0);
  std::string ende = "signal";
  float spitze = 0.0f;
  int64_t letzte_meldung = start_ns;
  bool steht = false;
  int still = 0;

  auto leser = std::make_unique<cdj::RingLeser>(ring);
  cdj::RingMitschnitt mt;
  bool neu = true;   // the next lies() is the first of a reader: it only fixes the start
  while (!g_halt) {
    if (!stopp.empty() && access(stopp.c_str(), F_OK) == 0) { ende = "stoppdatei"; break; }
    if (gesamt >= max_frames) { ende = "max_minuten"; break; }
    mt.l.clear();
    mt.r.clear();
    mt.fehler.clear();
    if (!leser->lies(mt)) {
      const std::string f = mt.fehler;
      if (f == "sprung" && !mt.l.empty()) {   // the frames up to the jump are in mt (ring w is continuous): keep them
        std::vector<float> b(mt.l.size() * 2);
        for (size_t i = 0; i < mt.l.size(); ++i) { b[2 * i] = mt.l[i]; b[2 * i + 1] = mt.r[i]; }
        abgeben(std::move(b));
        gesamt += static_cast<int64_t>(mt.l.size());
      }
      leser = std::make_unique<cdj::RingLeser>(ring);
      neu = true;
      if (f == "sprung") {
        ereignisse.push_back({"sprung", gesamt, 0, wanduhr_ns()});
        erwartet = -1;   // a new time axis: no fill
      } else {
        ereignisse.push_back({f == "ueberlauf" ? "luecke" : f, gesamt, 0, wanduhr_ns()});
      }
      std::fprintf(stderr, "setmitschnitt: %s at %.1f s\n", f.c_str(), gesamt / 48000.0);
      if (f != "sprung" && f != "ueberlauf") {   // invalid ring: do not spin
        const timespec t{0, 200 * 1000 * 1000};
        nanosleep(&t, nullptr);
      }
      continue;
    }
    if (neu) {
      neu = false;
      if (s0 < 0) s0 = mt.s0;
      if (erwartet >= 0 && mt.s0 > erwartet) {   // overrun: fill the missing frames with silence, same time axis
        int64_t fehlt = mt.s0 - erwartet;
        if (!ereignisse.empty() && ereignisse.back().art == "luecke") ereignisse.back().frames = fehlt;
        while (fehlt > 0) {
          const int64_t k = std::min<int64_t>(fehlt, 48000);
          abgeben(std::vector<float>(static_cast<size_t>(k) * 2, 0.0f));
          gesamt += k;
          fehlt -= k;
        }
      }
      erwartet = mt.s0;
    }
    const size_t n = mt.l.size();
    if (n > 0) {
      if (steht) {
        ereignisse.push_back({"weiter", gesamt, 0, wanduhr_ns()});
        steht = false;
      }
      still = 0;
      std::vector<float> b(n * 2);
      for (size_t i = 0; i < n; ++i) {
        b[2 * i] = mt.l[i];
        b[2 * i + 1] = mt.r[i];
        spitze = std::fmax(spitze, std::fmax(std::fabs(mt.l[i]), std::fabs(mt.r[i])));
      }
      abgeben(std::move(b));
      gesamt += static_cast<int64_t>(n);
      erwartet += static_cast<int64_t>(n);
    } else if (++still == 50 && !steht) {   // 1 s without new frames: no kern
      steht = true;
      ereignisse.push_back({"steht", gesamt, 0, wanduhr_ns()});
      std::fprintf(stderr, "setmitschnitt: ring stands still at %.1f s, waiting\n", gesamt / 48000.0);
    }
    const int64_t jetzt = wanduhr_ns();
    if (jetzt - letzte_meldung >= 10000000000LL) {
      std::fprintf(stderr, "setmitschnitt: %.0f s, peak %.1f dBFS%s\n", gesamt / 48000.0,
                   spitze > 0.0f ? 20.0 * std::log10(spitze) : -200.0, schreibfehler ? ", WRITE ERROR" : "");
      spitze = 0.0f;
      letzte_meldung = jetzt;
    }
    const timespec t{0, 20 * 1000 * 1000};
    nanosleep(&t, nullptr);
  }
  {
    std::lock_guard<std::mutex> g(m);
    fertig = true;
  }
  cv.notify_one();
  schreiber.join();
  const bool ok = wav.schliessen() && !schreibfehler;

  const std::string jpfad = aus + ".json";
  if (FILE* f = std::fopen((jpfad + ".teil").c_str(), "w")) {
    std::fprintf(f, "{\"datei\":%s,\"start\":%s,\"start_unix_ns\":%lld,\"s0\":%lld,\"rate\":48000,\"frames\":%llu,"
                    "\"sekunden\":%.3f,\"ende\":%s,\"ok\":%s,\"ereignisse\":[",
                 cdj::json_text(aus).c_str(), cdj::json_text(iso(start_ns)).c_str(), static_cast<long long>(start_ns),
                 static_cast<long long>(s0), static_cast<unsigned long long>(wav.frames()), wav.frames() / 48000.0,
                 cdj::json_text(ende).c_str(), ok ? "true" : "false");
    for (size_t i = 0; i < ereignisse.size(); ++i)
      std::fprintf(f, "%s{\"art\":%s,\"bei_s\":%.3f,\"frames\":%lld,\"zeit\":%s}", i ? "," : "",
                   cdj::json_text(ereignisse[i].art).c_str(), ereignisse[i].bei_frame / 48000.0,
                   static_cast<long long>(ereignisse[i].frames), cdj::json_text(iso(ereignisse[i].wanduhr_ns)).c_str());
    std::fprintf(f, "]}\n");
    std::fclose(f);
    std::rename((jpfad + ".teil").c_str(), jpfad.c_str());
  }
  std::printf("{\"datei\":%s,\"sekunden\":%.3f,\"ereignisse\":%zu,\"ende\":%s}\n", cdj::json_text(aus).c_str(),
              wav.frames() / 48000.0, ereignisse.size(), cdj::json_text(ende).c_str());
  if (!ok) {
    std::fprintf(stderr, "%s: writing failed\n", aus.c_str());
    return 5;
  }
  return 0;
}
