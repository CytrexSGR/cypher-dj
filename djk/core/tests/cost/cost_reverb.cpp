// 1.10 Slice 3 Task 1: cost of Cypher Hall as a return effect, measured before anything is built on it.
// Not a test: the numbers go into the report. Usage: kern_kosten_hall [blocks [runs]]   (default 20000 blocks, 10 runs)
// Parts (env KOSTEN_TEILE = comma list, default all):
//   block   1..4 cdj::Hall instances (frame index 1 and 2), noise input, blocks of 256 samples: median, p99, p99.9, max per block
//   setze   one Hall::setze with a changed structure, per parameter alone (decay, groesse, pre, tief, highcut, fahne) and combined,
//           2000 repetitions per run: median, p90, p99, max (the worst of all runs is what the gate reads)
//   neu     Hall::neu (constructor) and Hall::leeren, resident memory per instance (VmRSS difference)
//   alloc   allocations during block, setze and leeren (alloc_intercept.h), with a positive control
//   worst   the cycle in which one setze and four block calls fall together: p99.9 and max
// One JSON line per result ({"teil":...}) for the report folder.
#include <sched.h>
#include <time.h>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <random>
#include <string>
#include <vector>

#include "cypherdj/reverb.h"
#include "alloc_intercept.h"   // last: replaces malloc and relatives

namespace {

constexpr int BLOCK = 256;

double jetzt_us() {
  timespec ts;
  clock_gettime(CLOCK_MONOTONIC, &ts);
  return static_cast<double>(ts.tv_sec) * 1e6 + static_cast<double>(ts.tv_nsec) / 1e3;
}

struct Stat { double med, p90, p99, p999, max; };

Stat statistik(std::vector<double>& v) {
  std::sort(v.begin(), v.end());
  auto q = [&](double p) { return v[std::min(v.size() - 1, static_cast<size_t>(p * static_cast<double>(v.size())))]; };
  return {q(0.5), q(0.9), q(0.99), q(0.999), v.back()};
}

long vmrss_kb() {
  FILE* f = std::fopen("/proc/self/status", "r");
  if (!f) return -1;
  char z[256];
  long kb = -1;
  while (std::fgets(z, sizeof z, f))
    if (std::strncmp(z, "VmRSS:", 6) == 0) { std::sscanf(z + 6, "%ld", &kb); break; }
  std::fclose(f);
  return kb;
}

struct Rauschen {
  std::mt19937 g{12345};
  std::uniform_real_distribution<float> d{-0.25f, 0.25f};
  void fuelle(float* a, int n) { for (int i = 0; i < n; ++i) a[i] = d(g); }
};

CypherHallEinstellung mit_rahmen(uint32_t r) {
  CypherHallEinstellung e = cypher_hall_vorgabe();
  e.rahmen = r;
  return e;
}

// change of one parameter: alternates between two values so that every call changes the structure
void aendere(CypherHallEinstellung& e, int param, int i) {
  const bool a = (i & 1) == 0;
  switch (param) {
    case 0: e.decay_s = a ? 2.0 : 2.7; break;
    case 1: e.groesse_ms = a ? 60.0 : 75.0; break;
    case 2: e.pre_ms = a ? 10.0 : 25.0; break;
    case 3: e.tief_faktor = a ? 1.2 : 1.6; break;
    case 4: e.highcut_hz = a ? 12000.0 : 8000.0; break;
    case 5: e.fahne_db = a ? 0.0 : -6.0; break;
    default:
      e.decay_s = a ? 2.0 : 2.7; e.groesse_ms = a ? 60.0 : 75.0; e.pre_ms = a ? 10.0 : 25.0;
      e.tief_faktor = a ? 1.2 : 1.6; e.highcut_hz = a ? 12000.0 : 8000.0; e.fahne_db = a ? 0.0 : -6.0; break;
  }
}
const char* PNAME[] = {"decay", "groesse", "pre", "tief", "highcut", "fahne", "kombiniert"};

void json_stat(const char* teil, const std::string& beschr, int lauf, const Stat& s) {
  std::printf("{\"teil\":\"%s\",\"fall\":\"%s\",\"lauf\":%d,\"med\":%.1f,\"p90\":%.1f,\"p99\":%.1f,\"p999\":%.1f,\"max\":%.1f}\n", teil,
              beschr.c_str(), lauf, s.med, s.p90, s.p99, s.p999, s.max);
  std::fflush(stdout);
}

}  // namespace

int main(int argc, char** argv) {
  const int bloecke = argc > 1 ? std::atoi(argv[1]) : 20000;
  const int laeufe = argc > 2 ? std::atoi(argv[2]) : 10;
  const char* teile = std::getenv("KOSTEN_TEILE");
  auto an = [&](const char* t) { return !teile || std::strstr(teile, t); };
  float ein_l[BLOCK], ein_r[BLOCK], aus_l[BLOCK], aus_r[BLOCK];
  Rauschen rs;
  int rc = 0;

  if (an("neu")) {
    for (int lauf = 0; lauf < laeufe; ++lauf) {
      const long m0 = vmrss_kb();
      std::vector<double> t;
      std::vector<std::unique_ptr<cdj::Hall>> hs;
      for (int i = 0; i < 4; ++i) {
        const double a = jetzt_us();
        hs.push_back(std::make_unique<cdj::Hall>());
        t.push_back(jetzt_us() - a);
      }
      // touch: run blocks so that lazily mapped pages are counted
      for (auto& h : hs) {
        rs.fuelle(ein_l, BLOCK);
        rs.fuelle(ein_r, BLOCK);
        for (int b = 0; b < 40; ++b) h->block(ein_l, ein_r, aus_l, aus_r, BLOCK);
      }
      const long m1 = vmrss_kb();
      std::vector<double> tl;
      for (int i = 0; i < 200; ++i) {
        const double a = jetzt_us();
        hs[0]->leeren();
        tl.push_back(jetzt_us() - a);
      }
      const Stat sn = statistik(t), sl = statistik(tl);
      std::printf("{\"teil\":\"neu\",\"lauf\":%d,\"neu_med_us\":%.0f,\"neu_max_us\":%.0f,\"leeren_med_us\":%.1f,\"leeren_max_us\":%.1f,\"rss_je_instanz_kb\":%ld}\n",
                  lauf, sn.med, sn.max, sl.med, sl.max, (m1 - m0) / 4);
    }
  }

  if (an("block")) {
    for (uint32_t rahmen : {1u, 2u})
      for (int n = 1; n <= 4; ++n)
        for (int lauf = 0; lauf < laeufe; ++lauf) {
          std::vector<std::unique_ptr<cdj::Hall>> hs;
          for (int i = 0; i < n; ++i) {
            hs.push_back(std::make_unique<cdj::Hall>());
            hs.back()->setze(mit_rahmen(rahmen));
          }
          for (int b = 0; b < 600; ++b) {
            rs.fuelle(ein_l, BLOCK);
            rs.fuelle(ein_r, BLOCK);
            for (auto& h : hs) h->block(ein_l, ein_r, aus_l, aus_r, BLOCK);
          }
          std::vector<double> t;
          t.reserve(static_cast<size_t>(bloecke));
          for (int b = 0; b < bloecke; ++b) {
            rs.fuelle(ein_l, BLOCK);
            rs.fuelle(ein_r, BLOCK);
            const double a = jetzt_us();
            for (auto& h : hs) h->block(ein_l, ein_r, aus_l, aus_r, BLOCK);
            t.push_back(jetzt_us() - a);
          }
          json_stat("block", "rahmen" + std::to_string(rahmen) + "_n" + std::to_string(n), lauf, statistik(t));
        }
  }

  if (an("setze")) {
    for (uint32_t rahmen : {1u, 2u})
      for (int p = 0; p < 7; ++p)
        for (int lauf = 0; lauf < laeufe; ++lauf) {
          cdj::Hall h;
          CypherHallEinstellung e = mit_rahmen(rahmen);
          h.setze(e);
          for (int b = 0; b < 200; ++b) {
            rs.fuelle(ein_l, BLOCK);
            rs.fuelle(ein_r, BLOCK);
            h.block(ein_l, ein_r, aus_l, aus_r, BLOCK);
          }
          std::vector<double> t;
          for (int i = 0; i < 2000; ++i) {
            aendere(e, p, i);
            rs.fuelle(ein_l, BLOCK);
            rs.fuelle(ein_r, BLOCK);
            h.block(ein_l, ein_r, aus_l, aus_r, BLOCK);   // keeps the tail warm between the calls
            const double a = jetzt_us();
            h.setze(e);
            t.push_back(jetzt_us() - a);
          }
          json_stat("setze", std::string(PNAME[p]) + "_rahmen" + std::to_string(rahmen), lauf, statistik(t));
        }
  }

  if (an("worst")) {
    for (uint32_t rahmen : {1u, 2u})
      for (int lauf = 0; lauf < laeufe; ++lauf) {
        std::vector<std::unique_ptr<cdj::Hall>> hs;
        for (int i = 0; i < 4; ++i) {
          hs.push_back(std::make_unique<cdj::Hall>());
          hs.back()->setze(mit_rahmen(rahmen));
        }
        CypherHallEinstellung e = mit_rahmen(rahmen);
        for (int b = 0; b < 600; ++b) {
          rs.fuelle(ein_l, BLOCK);
          rs.fuelle(ein_r, BLOCK);
          for (auto& h : hs) h->block(ein_l, ein_r, aus_l, aus_r, BLOCK);
        }
        std::vector<double> t, nur;
        for (int b = 0; b < bloecke; ++b) {
          rs.fuelle(ein_l, BLOCK);
          rs.fuelle(ein_r, BLOCK);
          const bool mit_setze = (b % 7) == 0;   // one setze in 7 blocks (7 is coprime to the frame cadence 4 and 8 blocks, so the setze meets every phase incl. the heavy frame block), on the Hall that rotates
          if (mit_setze) aendere(e, 6, b / 7);
          const double a = jetzt_us();
          if (mit_setze) hs[static_cast<size_t>((b / 7) % 4)]->setze(e);
          for (auto& h : hs) h->block(ein_l, ein_r, aus_l, aus_r, BLOCK);
          t.push_back(jetzt_us() - a);
          if (mit_setze) nur.push_back(t.back());
        }
        // the gate reads the blocks that carry a setze: report them apart from all blocks
        json_stat("worst", "rahmen" + std::to_string(rahmen) + "_nur_setze_bloecke_n4", lauf, statistik(nur));
        json_stat("worst", "rahmen" + std::to_string(rahmen) + "_alle_bloecke_n4", lauf, statistik(t));
      }
  }

  if (an("alloc")) {
    cdj::Hall h;
    CypherHallEinstellung e = mit_rahmen(2);
    h.setze(e);
    for (int b = 0; b < 200; ++b) {
      rs.fuelle(ein_l, BLOCK);
      rs.fuelle(ein_r, BLOCK);
      h.block(ein_l, ein_r, aus_l, aus_r, BLOCK);
    }
    abfang_an();
    for (int b = 0; b < 2000; ++b) h.block(ein_l, ein_r, aus_l, aus_r, BLOCK);
    const long a_block = abfang_aus();
    abfang_an();
    for (int i = 0; i < 500; ++i) {
      aendere(e, 6, i);
      h.setze(e);
    }
    const long a_setze = abfang_aus();
    abfang_an();
    for (int i = 0; i < 500; ++i) h.leeren();
    const long a_leeren = abfang_aus();
    abfang_an();
    void* p = std::malloc(16);
    const long positiv = abfang_aus();
    std::free(p);
    std::printf("{\"teil\":\"alloc\",\"block\":%ld,\"setze\":%ld,\"leeren\":%ld,\"positiv\":%ld}\n", a_block, a_setze, a_leeren, positiv);
    if (positiv < 1) rc = 2;   // the guard did not work: the zeros would mean nothing
  }
  return rc;
}
