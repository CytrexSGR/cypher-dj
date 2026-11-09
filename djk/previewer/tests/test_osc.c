/* OSC-Leser und -Schreiber des Vorhörers: Rundreise je Typ, Formfehler werden abgewiesen. */
#include <assert.h>
#include <stdio.h>

#include "v_osc.h"

int main(void) {
  v_osc_puffer p;
  v_osc_neu(&p, "/v/loop", ",dd");
  v_anh_d(&p, 12.5);
  v_anh_d(&p, 14.25);
  assert(p.ok && p.n == 8 + 4 + 16);
  v_osc_nachricht m;
  assert(v_osc_lesen(p.b, p.n, &m) == 0);
  assert(!strcmp(m.adresse, "/v/loop") && !strcmp(m.typen, "dd") && m.n == 2 && m.w[0].d == 12.5 && m.w[1].d == 14.25);

  v_osc_neu(&p, "/v/laden", ",s");
  v_anh_s(&p, "/media/x y/ä.mp3");
  assert(v_osc_lesen(p.b, p.n, &m) == 0 && m.n == 1 && !strcmp(m.w[0].s, "/media/x y/ä.mp3"));

  v_osc_neu(&p, "/v/position", ",dh");
  v_anh_d(&p, 1.0);
  v_anh_h(&p, 4294967295LL);
  assert(v_osc_lesen(p.b, p.n, &m) == 0 && m.w[1].i == 4294967295LL);

  unsigned char f[8] = {'/', 'v', '/', 's', 'p', 'r', 'i', 'n'}; /* Adresse ohne Nullbyte */
  assert(v_osc_lesen(f, 8, &m) != 0);
  unsigned char x[8] = {'v', 0, 0, 0, ',', 0, 0, 0}; /* Adresse ohne Schrägstrich */
  assert(v_osc_lesen(x, 8, &m) != 0);
  unsigned char k[16] = {'/', 'v', 0, 0, ',', 'i', 0, 0, 0, 0}; /* int fehlt: nur 2 Bytes */
  assert(v_osc_lesen(k, 10, &m) != 0);
  unsigned char ohne[4] = {'/', 'v', 0, 0}; /* ohne Typen: erlaubt, keine Werte */
  assert(v_osc_lesen(ohne, 4, &m) == 0 && m.n == 0);
  v_osc_neu(&p, "/x", ",s");
  char lang[1500];
  memset(lang, 'a', sizeof lang - 1);
  lang[sizeof lang - 1] = 0;
  v_anh_s(&p, lang);
  assert(!p.ok);
  puts("osc ok");
  return 0;
}
