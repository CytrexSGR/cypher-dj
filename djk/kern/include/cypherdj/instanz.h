/* Z2 Prüfinstanzen (docs/architektur/ROADMAP.md Abschnitt 3): CYPHERDJ_INSTANZ leer oder ein Buchstabe a bis i.
 * Gesetzt: "cypherdj/" in festen Pfaden wird "cypherdj-<i>/", JACK-Namen bekommen "-<i>", Ports + 1000*k (a=1 ... i=9).
 * Gemeinsam für C (Notbahn) und C++ (Kern). */
#ifndef CYPHERDJ_INSTANZ_H
#define CYPHERDJ_INSTANZ_H

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* Die Instanz aus der Umgebung; "" wenn nicht gesetzt. */
static inline const char* cdj_instanz(void) {
  const char* e = getenv("CYPHERDJ_INSTANZ");
  return e ? e : "";
}

/* 0 für die Vorgabe-Instanz, 1 bis 9 für a bis i, -1 für einen ungültigen Wert. */
static inline int cdj_instanz_k(const char* i) {
  if (!i || !i[0]) return 0;
  if (i[1] == '\0' && i[0] >= 'a' && i[0] <= 'i') return i[0] - 'a' + 1;
  return -1;
}

/* JACK-Name, Unit-Name, node.group: basis oder basis-<i> */
static inline void cdj_name(char* aus, size_t n, const char* basis, const char* i) {
  if (i && i[0]) snprintf(aus, n, "%s-%s", basis, i);
  else snprintf(aus, n, "%s", basis);
}

/* Ordner der geteilten Speicherbereiche: /dev/shm/cypherdj oder /dev/shm/cypherdj-<i> */
static inline void cdj_shm_ordner(char* aus, size_t n, const char* i) {
  if (i && i[0]) snprintf(aus, n, "/dev/shm/cypherdj-%s", i);
  else snprintf(aus, n, "/dev/shm/cypherdj");
}

/* UDP-Port aus SCHNITTSTELLEN.md §2 für diese Instanz */
static inline int cdj_port(int basis, const char* i) { return basis + 1000 * cdj_instanz_k(i); }

#endif
