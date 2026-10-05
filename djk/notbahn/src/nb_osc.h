/* /nb ,iiih nach SCHNITTSTELLEN.md §5.10 an Leitstand (47110) und Prüfstand (47140), je Instanz + 1000·k (§2).
 * Aus dem Hauptfaden, nie aus dem Callback. generation_gesehen: bis der Zustand-Seqlock (§6.x) die Kern-Generation
 * trägt, zählt die Notbahn die Rückkehren des Kerns seit ihrem Start (jede Rückkehr ist eine neue Generation). */
#ifndef CYPHERDJ_NB_OSC_H
#define CYPHERDJ_NB_OSC_H

#include <arpa/inet.h>
#include <netinet/in.h>
#include <stdint.h>
#include <string.h>
#include <sys/socket.h>

static inline void nb_be32(unsigned char* p, uint32_t v) { p[0] = v >> 24; p[1] = v >> 16; p[2] = v >> 8; p[3] = v; }

/* Baut die Nachricht in buf (32 Bytes) und gibt ihre Länge zurück. */
static inline int nb_osc_bauen(unsigned char* buf, int32_t zustand, int32_t takte, int32_t generation, uint64_t w) {
  memset(buf, 0, 32);
  memcpy(buf, "/nb", 3);          /* Adresse, auf 4 Bytes aufgefüllt */
  memcpy(buf + 4, ",iiih", 5);    /* Typen, auf 8 Bytes aufgefüllt */
  nb_be32(buf + 12, (uint32_t)zustand);
  nb_be32(buf + 16, (uint32_t)takte);
  nb_be32(buf + 20, (uint32_t)generation);
  nb_be32(buf + 24, (uint32_t)(w >> 32));
  nb_be32(buf + 28, (uint32_t)w);
  return 32;
}

static inline void nb_osc_senden(int fd, const int* ports, int n_ports, int32_t zustand, int32_t takte,
                                 int32_t generation, uint64_t w) {
  unsigned char buf[32];
  const int n = nb_osc_bauen(buf, zustand, takte, generation, w);
  for (int i = 0; i < n_ports; i++) {
    struct sockaddr_in a = {.sin_family = AF_INET, .sin_port = htons((uint16_t)ports[i])};
    a.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    sendto(fd, buf, (size_t)n, 0, (struct sockaddr*)&a, sizeof a);
  }
}

#endif
