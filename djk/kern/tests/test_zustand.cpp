// Scheibe 18: Neustart-Zustand (INTERFACES §6.3). Datei anlegen und wieder öffnen, falsche Version legt neu an,
// Seqlock mit zwei Fächern: ein Schreiber, der mitten im Schreiben stirbt, hinterlässt das ältere Fach lesbar
// (Fehlerfall: mit nur einem Fach wäre der Zustand weg), z_lies_befehle liest das neueste fertige Fach.
#include <fcntl.h>
#include <unistd.h>

#include <cstdio>
#include <cstring>
#include <memory>
#include <string>
#include <vector>

#include "cypherdj/stellwerk/regler.h"
#include "cypherdj/zustand_datei.h"
#include "pruef.h"

int main() {
  const std::string ordner = "/dev/shm/cypherdj-test18-" + std::to_string(getpid());
  const std::string pfad = ordner + "/zustand";

  // 1) Anlegen: neu, Kopf gültig, beide Fächer ungelesen
  {
    cdj::ZustandDatei z;
    PRUEF(z.oeffne(pfad));
    PRUEF(z.neu());
    PRUEF(z.daten()->version == CDJ_ZUSTAND_VERSION);
    PRUEF(z.daten()->groesse == sizeof(cdj_z_datei));
    auto f = std::make_unique<cdj_z_echtzeit>();
    PRUEF(cdj::z_neuestes(z.daten()->echtzeit, *f) == -1);  // Negativ-Kontrolle: nie geschrieben, nichts gültig

    // 2) Schreiben mit Stand 1 und 2: Fach 1, dann Fach 0; das neueste ist Stand 2
    cdj::FachSchreiber<cdj_z_echtzeit> w;
    w.verbinde(z.daten()->echtzeit, 0);
    for (int s = 1; s <= 2; ++s) {
      cdj_z_echtzeit* e = w.beginne();
      e->anker_sample = 1000 * s;
      e->n_befehle = 1;
      e->befehle[0].id = 40 + s;
      e->befehle[0].stand = 2;
      w.beende();
    }
    PRUEF(cdj::z_neuestes(z.daten()->echtzeit, *f) == 0);
    PRUEF(f->stand == 2 && f->anker_sample == 2000);

    // 3) Fehlerfall "Tod mitten im Schreiben": Stand 3 beginnt in Fach 1, beende() kommt nie
    cdj_z_echtzeit* halb = w.beginne();
    halb->anker_sample = 999999;
    PRUEF(z.daten()->echtzeit[1].seq & 1u);                   // ungerade: wird geschrieben
    PRUEF(cdj::z_neuestes(z.daten()->echtzeit, *f, 3) == 0);  // das ältere, fertige Fach bleibt
    PRUEF(f->anker_sample == 2000);
    cdj_z_befehl b[CDJ_Z_BEFEHLE];
    int n = -1;
    PRUEF(cdj::z_lies_befehle(z.daten(), b, n));
    PRUEF(n == 1 && b[0].id == 42);
  }

  // 4) Wieder öffnen (neuer Prozess nach kill -9): vorhanden, nicht neu; der nächste Schreiber setzt am Stand fort
  {
    cdj::ZustandDatei z;
    PRUEF(z.oeffne(pfad));
    PRUEF(!z.neu());
    auto f = std::make_unique<cdj_z_echtzeit>();
    PRUEF(cdj::z_neuestes(z.daten()->echtzeit, *f, 3) == 0 && f->stand == 2);
    cdj::FachSchreiber<cdj_z_echtzeit> w;
    w.verbinde(z.daten()->echtzeit, f->stand);
    cdj_z_echtzeit* e = w.beginne();  // Stand 3 in Fach 1, das der tote Schreiber ungerade hinterließ
    e->anker_sample = 3000;
    e->n_befehle = 0;
    w.beende();
    PRUEF(!(z.daten()->echtzeit[1].seq & 1u));
    PRUEF(cdj::z_neuestes(z.daten()->echtzeit, *f) == 1 && f->stand == 3 && f->anker_sample == 3000);

    // Abonnenten-Fach: eigener Schreiber, eigener Stand
    cdj::FachSchreiber<cdj_z_abos> wa;
    wa.verbinde(z.daten()->abos, 0);
    cdj_z_abos* a = wa.beginne();
    a->n = 1;
    std::snprintf(a->a[0].name, sizeof a->a[0].name, "leitstand");
    a->a[0].port = 47110;
    wa.beende();
    cdj_z_abos g{};
    PRUEF(cdj::z_neuestes(z.daten()->abos, g) == 1 && g.n == 1 && g.a[0].port == 47110);
  }

  // 5) Falsche Version im Kopf: neu angelegt, alter Inhalt weg (eine andere Layout-Fassung wird nie gelesen)
  {
    cdj::ZustandDatei z;
    PRUEF(z.oeffne(pfad));
    z.daten()->version = CDJ_ZUSTAND_VERSION + 1;
  }
  {
    cdj::ZustandDatei z;
    PRUEF(z.oeffne(pfad));
    PRUEF(z.neu());
    auto f = std::make_unique<cdj_z_echtzeit>();
    PRUEF(cdj::z_neuestes(z.daten()->echtzeit, *f) == -1);
  }
  // 6) E1 (2026-10-20): Regler-Deckel 512 → 1024, CDJ_ZUSTAND_VERSION 1 → 2. Der Deckel des Zustands darf nicht unter dem
  //    der Tabelle liegen, sonst schneidet kern_zustand.cpp still ab (nr < CDJ_Z_REGLER).
  PRUEF(CDJ_Z_REGLER >= cypherdj::stellwerk::MAX_REGLER);
  PRUEF(CDJ_ZUSTAND_VERSION == 2u);
  //    Eine Datei im Format Version 1 (512 Regler, 253 792 Bytes, gemessen mit dem Stand vor E1) wird nie gelesen: der
  //    Kern legt neu an (Größe passt nicht), meldet es und übernimmt nichts aus dem alten Inhalt.
  {
    constexpr size_t GROESSE_V1 = 253792;
    PRUEF(GROESSE_V1 + 2 * (CDJ_Z_REGLER - 512) * sizeof(cdj_z_regler) == sizeof(cdj_z_datei));   // zwei Fächer, 96 Bytes je Regler
    std::vector<unsigned char> alt(GROESSE_V1, 0xAB);   // jedes Byte belegt: Reste des alten Inhalts wären zu sehen
    std::memcpy(alt.data(), "CDJZ", 4);
    const uint32_t v1 = 1, g1 = static_cast<uint32_t>(GROESSE_V1);
    std::memcpy(alt.data() + 4, &v1, 4);   // Kopf: magic[4], version, groesse (zustand.h)
    std::memcpy(alt.data() + 8, &g1, 4);
    const std::string alt_pfad = ordner + "/zustand_v1";
    const int fd = open(alt_pfad.c_str(), O_CREAT | O_WRONLY | O_TRUNC, 0600);
    PRUEF(fd >= 0 && write(fd, alt.data(), alt.size()) == static_cast<ssize_t>(alt.size()));
    if (fd >= 0) close(fd);
    cdj::ZustandDatei z;
    PRUEF(z.oeffne(alt_pfad));
    PRUEF(z.neu());
    PRUEF(z.meldung().find("253792") != std::string::npos && z.meldung().find("neu angelegt") != std::string::npos);
    PRUEF(z.daten()->version == 2u && z.daten()->groesse == sizeof(cdj_z_datei));
    const unsigned char* roh = reinterpret_cast<const unsigned char*>(z.daten());
    size_t rest = 0;
    for (size_t i = 64; i < sizeof(cdj_z_datei); ++i) rest += roh[i] != 0;   // hinter dem 64-Byte-Kopf alles leer
    PRUEF(rest == 0);
    auto f = std::make_unique<cdj_z_echtzeit>();
    PRUEF(cdj::z_neuestes(z.daten()->echtzeit, *f) == -1);
    unlink(alt_pfad.c_str());
  }
  //    Gleiche Größe, aber Version 1 im Kopf (ein Kern mit anderem Layout, derselben Größe): ebenfalls neu angelegt.
  {
    cdj::ZustandDatei z;
    PRUEF(z.oeffne(pfad));
    z.daten()->version = 1u;
  }
  {
    cdj::ZustandDatei z;
    PRUEF(z.oeffne(pfad));
    PRUEF(z.neu() && z.meldung().find("Version 1") != std::string::npos);
    PRUEF(z.daten()->version == CDJ_ZUSTAND_VERSION);
  }
  PRUEF(cdj::ZustandDatei::pfad_fuer("") == "/dev/shm/cypherdj/zustand");
  PRUEF(cdj::ZustandDatei::pfad_fuer("a") == "/dev/shm/cypherdj-a/zustand");
  unlink(pfad.c_str());
  rmdir(ordner.c_str());
  PRUEF_ENDE();
}
