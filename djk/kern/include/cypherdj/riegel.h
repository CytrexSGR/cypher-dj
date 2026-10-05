/* Riegel gegen ungefragten Ton (SCHNITTSTELLEN.md §8, 00-anforderungen §9 „Kein Ton ohne Frage“): ein Zielport ist
 * erlaubt, wenn sein Name „stumm“ enthält oder mit „cypherdj-pruef-“ beginnt; jedes andere Ziel nur mit --ton-frei,
 * das erst nach Andreas' Freigabe für sein Interface gesetzt wird. */
#ifndef CYPHERDJ_RIEGEL_H
#define CYPHERDJ_RIEGEL_H

#include <string.h>

static inline int riegel_erlaubt(const char* port, int ton_frei) {
  if (!port || !port[0]) return 0;
  if (ton_frei) return 1;
  return strstr(port, "stumm") != NULL || strncmp(port, "cypherdj-pruef-", 15) == 0;
}

#endif
