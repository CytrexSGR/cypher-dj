// Container core K3 (F2): Quellpuffer holds 48 buffers of MIX_BLOCK frames (16 streams, 4 players, 4 inputs, left and right), all
// pointing into one block owned by the caller. leeren(n) zeroes n frames of every buffer and nothing beyond, and no two buffers overlap.
#include <cstdint>
#include <cstdio>
#include <set>
#include <vector>

#include "cypherdj/quellpuffer.h"
#include "check.h"

int main() {
  using namespace cdj;
  PRUEF(QP_PUFFER == 48);
  std::vector<float> mem(static_cast<size_t>(QP_PUFFER) * MIX_BLOCK, 7.0f);
  Quellpuffer q;
  q.binde(mem.data());

  std::vector<float*> alle;
  for (int i = 0; i < QP_STROEME; ++i) { alle.push_back(q.strom_l[i]); alle.push_back(q.strom_r[i]); }
  for (int i = 0; i < QP_PLAYER; ++i) { alle.push_back(q.player_l[i]); alle.push_back(q.player_r[i]); }
  for (int i = 0; i < QP_EINGAENGE; ++i) { alle.push_back(q.ein_l[i]); alle.push_back(q.ein_r[i]); }
  PRUEF(alle.size() == 48);
  std::set<float*> eindeutig(alle.begin(), alle.end());
  PRUEF(eindeutig.size() == 48);
  for (float* p : alle) {  // every buffer lies inside the block and on a MIX_BLOCK boundary: no overlap
    PRUEF(p >= mem.data() && p + MIX_BLOCK <= mem.data() + mem.size());
    PRUEF((p - mem.data()) % MIX_BLOCK == 0);
  }

  q.leeren(100);
  for (float* p : alle) {
    for (int i = 0; i < 100; ++i) PRUEF(p[i] == 0.0f);
    PRUEF(p[100] == 7.0f);                 // nothing beyond n is touched
    PRUEF(p[MIX_BLOCK - 1] == 7.0f);
  }
  q.leeren(MIX_BLOCK);
  for (float* p : alle) for (int i = 0; i < MIX_BLOCK; ++i) PRUEF(p[i] == 0.0f);

  q.strom_l[4][3] = 1.0f;                  // a write into one buffer reaches no other
  int treffer = 0;
  for (float v : mem) treffer += v != 0.0f;
  PRUEF(treffer == 1);
  q.leeren(MIX_BLOCK + 50);                // over-long n is clamped, no write past the block
  PRUEF(q.strom_l[4][3] == 0.0f);
  std::puts("test_quellpuffer: ok");
  PRUEF_ENDE();
}
