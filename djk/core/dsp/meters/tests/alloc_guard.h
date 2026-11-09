// Allokationswächter: zählt malloc/calloc/realloc (per -Wl,--wrap, erfasst auch libebur128)
// und operator new, solange g_alloc_zaehlen gesetzt ist. Nur für Tests, einfädig.
#pragma once

extern bool g_alloc_zaehlen;
extern long g_allokationen;

struct AllocFenster {
  AllocFenster() { g_allokationen = 0; g_alloc_zaehlen = true; }
  ~AllocFenster() { g_alloc_zaehlen = false; }
  long zahl() const { return g_allokationen; }
};
