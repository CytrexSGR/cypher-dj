// Scheibe 18: Neustart-Zustand (INTERFACES §6.3). Datei anlegen und wieder öffnen, falsche Version legt neu an,
// Seqlock mit zwei Fächern: ein Schreiber, der mitten im Schreiben stirbt, hinterlässt das ältere Fach lesbar
// (Fehlerfall: mit nur einem Fach wäre der Zustand weg), z_lies_befehle liest das neueste fertige Fach.
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>

#include <cstdio>
#include <cstring>
#include <memory>
#include <string>
#include <vector>

#include "cypherdj/signalbox/controls.h"
#include "cypherdj/state_file.h"
#include "check.h"

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
  // 6) E1 (2026-10-20): controller ceiling 512 -> 1024, CDJ_ZUSTAND_VERSION 1 -> 2; A1a (2026-11-03): 1024 -> 2048, version 2 -> 3; arr-bk (2026-11-11): 2048 -> 4096, version 3 -> 4; container core K2: 4096 -> 8192, version 4 -> 5;
  //    strand 1 slice 3: 8192 -> 16384, version 5 -> 6 (an EQ and a compressor per strip, 96 + 96 pool slots); slice 3b: 16384 -> 24576 for 128 tracks,
  //    version 6 unchanged (no shipped core wrote a 16384-row version 6 file).
  //    The ceiling of the state must not be below that of the table, or core_state.cpp cuts off silently (nr < CDJ_Z_REGLER).
  PRUEF(CDJ_Z_REGLER >= cypherdj::stellwerk::MAX_REGLER);
  PRUEF(CDJ_ZUSTAND_VERSION == 6u);
  PRUEF(CDJ_Z_REGLER == 24576);   // slice 3b: 16384 -> 24576, version 6 unchanged, never shipped at 16384 (strand 1 slice 3 had taken it 8192 -> 16384, version 5 -> 6)
  //    Eine Datei im Format Version 1 (512 Regler, 253 792 Bytes, gemessen mit dem Stand vor E1) wird nie gelesen: der
  //    Kern legt neu an (Größe passt nicht), meldet es und übernimmt nichts aus dem alten Inhalt.
  {
    constexpr size_t GROESSE_V1 = 253792;
    PRUEF(GROESSE_V1 + 2 * (CDJ_Z_REGLER - 512) * sizeof(cdj_z_regler) == sizeof(cdj_z_datei));   // zwei Fächer, 96 Bytes je Regler
    std::vector<unsigned char> alt(GROESSE_V1, 0xAB);   // jedes Byte belegt: Reste des alten Inhalts wären zu sehen
    std::memcpy(alt.data(), "CDJZ", 4);
    const uint32_t v1 = 1, g1 = static_cast<uint32_t>(GROESSE_V1);
    std::memcpy(alt.data() + 4, &v1, 4);   // Kopf: magic[4], version, groesse (state.h)
    std::memcpy(alt.data() + 8, &g1, 4);
    const std::string alt_pfad = ordner + "/zustand_v1";
    const int fd = open(alt_pfad.c_str(), O_CREAT | O_WRONLY | O_TRUNC, 0600);
    PRUEF(fd >= 0 && write(fd, alt.data(), alt.size()) == static_cast<ssize_t>(alt.size()));
    if (fd >= 0) close(fd);
    cdj::ZustandDatei z;
    PRUEF(z.oeffne(alt_pfad));
    PRUEF(z.neu());
    PRUEF(z.meldung().find("253792") != std::string::npos && z.meldung().find("neu angelegt") != std::string::npos);
    PRUEF(z.daten()->version == CDJ_ZUSTAND_VERSION && z.daten()->groesse == sizeof(cdj_z_datei));
    const unsigned char* roh = reinterpret_cast<const unsigned char*>(z.daten());
    size_t rest = 0;
    for (size_t i = 64; i < sizeof(cdj_z_datei); ++i) rest += roh[i] != 0;   // hinter dem 64-Byte-Kopf alles leer
    PRUEF(rest == 0);
    auto f = std::make_unique<cdj_z_echtzeit>();
    PRUEF(cdj::z_neuestes(z.daten()->echtzeit, *f) == -1);
    unlink(alt_pfad.c_str());
  }
  //    A1a: a file of version 2 (1024 controllers, 352 096 bytes, measured at the base 2f26eeb9) is recreated the same way.
  {
    constexpr size_t GROESSE_V2 = 352096;
    std::vector<unsigned char> alt(GROESSE_V2, 0xAB);
    std::memcpy(alt.data(), "CDJZ", 4);
    const uint32_t v2 = 2, g2 = static_cast<uint32_t>(GROESSE_V2);
    std::memcpy(alt.data() + 4, &v2, 4);
    std::memcpy(alt.data() + 8, &g2, 4);
    const std::string alt_pfad = ordner + "/zustand_v2";
    const int fd = open(alt_pfad.c_str(), O_CREAT | O_WRONLY | O_TRUNC, 0600);
    PRUEF(fd >= 0 && write(fd, alt.data(), alt.size()) == static_cast<ssize_t>(alt.size()));
    if (fd >= 0) close(fd);
    cdj::ZustandDatei z;
    PRUEF(z.oeffne(alt_pfad));
    PRUEF(z.neu());
    PRUEF(z.meldung().find("352096") != std::string::npos && z.meldung().find("neu angelegt") != std::string::npos);
    PRUEF(z.daten()->version == CDJ_ZUSTAND_VERSION && z.daten()->groesse == sizeof(cdj_z_datei));
    const unsigned char* roh = reinterpret_cast<const unsigned char*>(z.daten());
    size_t rest = 0;
    for (size_t i = 64; i < sizeof(cdj_z_datei); ++i) rest += roh[i] != 0;
    PRUEF(rest == 0);
    unlink(alt_pfad.c_str());
  }
  //    arr-bk, K2 and strand 1 slice 3: a file of version 3 (2048 controllers, 548 704 bytes = 253 792 + 2 * 1536 * 96), version 4 (4096 controllers, the cores before the
  //    strom/<n>/bk/<k> rows) or version 5 (8192 controllers, the cores before the per-strip EQ and compressor pool) is TAKEN OVER, not recreated: the live studio keeps its
  //    mixer rows, tempo plan and decks over the first restart of a version 6 core. The test image is built with literal offsets (not from the
  //    header), every byte of the body is a distinct pattern, so a misplaced section is seen.
  for (const uint32_t ver : {3u, 4u, 5u}) {
    const size_t ZEILEN = ver == 3 ? 2048 : ver == 4 ? 4096 : 8192;   // controller rows of the old file
    const size_t GROESSE_V3 = 253792 + 2 * (ZEILEN - 512) * sizeof(cdj_z_regler);
    PRUEF(ver != 3 || GROESSE_V3 == 548704);
    const size_t E3 = 208 + 2 * 64 * 48 + 256 * 256 + ZEILEN * 96 + 32 * 144 + 4 * 168;   // one subject of the old version
    const size_t REGLER_AB = 208 + 2 * 64 * 48 + 256 * 256;                              // the table starts here inside a subject
    PRUEF(64 + 2 * E3 + 2 * (32 + 8 * 64) == GROESSE_V3);
    std::vector<unsigned char> alt(GROESSE_V3);
    for (size_t k = 0; k < alt.size(); ++k) alt[k] = static_cast<unsigned char>((k * 7 + k / 251) % 255 + 1);   // never 0
    std::memcpy(alt.data(), "CDJZ", 4);
    const uint32_t v3 = ver, g3 = static_cast<uint32_t>(GROESSE_V3);
    std::memcpy(alt.data() + 4, &v3, 4);
    std::memcpy(alt.data() + 8, &g3, 4);
    const std::string alt_pfad = ordner + "/zustand_v" + std::to_string(ver);
    const int fd = open(alt_pfad.c_str(), O_CREAT | O_WRONLY | O_TRUNC, 0600);
    PRUEF(fd >= 0 && write(fd, alt.data(), alt.size()) == static_cast<ssize_t>(alt.size()));
    if (fd >= 0) close(fd);
    {
      cdj::ZustandDatei z;
      PRUEF(z.oeffne(alt_pfad));
      PRUEF(!z.neu());   // taken over: the time axis goes on
      PRUEF(z.meldung().find("version " + std::to_string(ver) + " taken over") != std::string::npos);
      PRUEF(z.daten()->version == 6u && z.daten()->groesse == sizeof(cdj_z_datei));
      PRUEF(std::memcmp(z.daten()->magic, "CDJZ", 4) == 0);
      const unsigned char* roh = reinterpret_cast<const unsigned char*>(z.daten());
      PRUEF(std::memcmp(roh + 12, alt.data() + 12, 52) == 0);   // reserve words of the head
      for (size_t i = 0; i < 2; ++i) {
        const unsigned char* von = alt.data() + 64 + i * E3;
        const unsigned char* nach = reinterpret_cast<const unsigned char*>(&z.daten()->echtzeit[i]);
        PRUEF(std::memcmp(nach, von, REGLER_AB + ZEILEN * 96) == 0);   // everything in front of the table and its old rows, byte for byte
        PRUEF(std::memcmp(nach + offsetof(cdj_z_echtzeit, hoerscheine), von + REGLER_AB + ZEILEN * 96, 32 * 144 + 4 * 168) == 0);   // the sections behind it moved, unchanged
        size_t neu_rest = 0;
        for (size_t k = REGLER_AB + ZEILEN * 96; k < REGLER_AB + CDJ_Z_REGLER * 96; ++k) neu_rest += nach[k] != 0;
        PRUEF(neu_rest == 0);   // the rows the old table did not have are empty
      }
      for (size_t i = 0; i < 2; ++i)
        PRUEF(std::memcmp(&z.daten()->abos[i], alt.data() + 64 + 2 * E3 + i * (32 + 8 * 64), 32 + 8 * 64) == 0);
      z.daten()->echtzeit[0].n_regler = 2036;   // a version 6 core writes on
    }
    {
      cdj::ZustandDatei z;   // the next open sees an ordinary version 6 file
      PRUEF(z.oeffne(alt_pfad));
      PRUEF(!z.neu() && z.meldung() == "vorhanden" && z.daten()->echtzeit[0].n_regler == 2036);
    }
    // an old file whose head and size disagree is not trusted: recreated, nothing taken over
    {
      const uint32_t falsch = g3 + 8;
      std::memcpy(alt.data() + 8, &falsch, 4);
      const int fd2 = open(alt_pfad.c_str(), O_CREAT | O_WRONLY | O_TRUNC, 0600);
      PRUEF(fd2 >= 0 && write(fd2, alt.data(), alt.size()) == static_cast<ssize_t>(alt.size()));
      if (fd2 >= 0) close(fd2);
      cdj::ZustandDatei z;
      PRUEF(z.oeffne(alt_pfad));
      PRUEF(z.neu());
      const unsigned char* roh = reinterpret_cast<const unsigned char*>(z.daten());
      size_t rest = 0;
      for (size_t i = 64; i < sizeof(cdj_z_datei); ++i) rest += roh[i] != 0;
      PRUEF(rest == 0);
    }
    unlink(alt_pfad.c_str());
  }
  //    Strand 1 slice 3: a version 5 file as a version 5 core wrote it (8192 rows, compact: n_regler rows by path, then decks behind the table). Not a byte
  //    pattern this time but real values, read back the way the core restores them (z_neuestes, then the rows by path), so a wrong old row count or a
  //    section read at the new offset shows as a lost fader, a lost insert switch or a lost deck.
  {
    constexpr size_t ZEILEN = 8192;
    constexpr size_t REGLER_AB = 208 + 2 * 64 * 48 + 256 * 256;
    constexpr size_t E5 = REGLER_AB + ZEILEN * 96 + 32 * 144 + 4 * 168;
    constexpr size_t GROESSE_V5 = 64 + 2 * E5 + 2 * (32 + 8 * 64);
    PRUEF(GROESSE_V5 == 1728352);   // 253 792 + 2 * (8192 - 512) * 96
    std::vector<unsigned char> alt(GROESSE_V5, 0);
    std::memcpy(alt.data(), "CDJZ", 4);
    const uint32_t v5 = 5, g5 = static_cast<uint32_t>(GROESSE_V5);
    std::memcpy(alt.data() + 4, &v5, 4);
    std::memcpy(alt.data() + 8, &g5, 4);
    auto zeile = [&](unsigned char* fach, size_t i, const char* pfad, float wert) {
      unsigned char* z = fach + REGLER_AB + i * 96;   // pfad[48], halter[40], wert, reserve
      std::memcpy(z, pfad, std::strlen(pfad));
      std::memcpy(z + 48, "frei", 4);
      std::memcpy(z + 88, &wert, 4);
    };
    for (size_t i = 0; i < 2; ++i) {
      unsigned char* fach = alt.data() + 64 + i * E5;
      const uint64_t seq = 4, stand = 6 + i;   // slot 1 holds the newer stand
      const int32_t n_regler = 2, n_decks = 1;
      std::memcpy(fach + offsetof(cdj_z_echtzeit, seq), &seq, 8);
      std::memcpy(fach + offsetof(cdj_z_echtzeit, stand), &stand, 8);
      std::memcpy(fach + offsetof(cdj_z_echtzeit, n_regler), &n_regler, 4);
      std::memcpy(fach + offsetof(cdj_z_echtzeit, n_decks), &n_decks, 4);
      zeile(fach, 0, "spur/1/fader", -6.0f);
      zeile(fach, 1, "ins/komp/1/an", 1.0f);
      unsigned char* deck = fach + REGLER_AB + ZEILEN * 96 + 32 * 144;   // decks[0]: material_id[24], fassung, mit_stems, basis_bpm
      std::memcpy(deck, "00112233aabbccdd", 16);
      const double bpm = 128.5 + static_cast<double>(i);
      std::memcpy(deck + 32, &bpm, 8);
    }
    const std::string alt_pfad = ordner + "/zustand_v5_werte";
    const int fd = open(alt_pfad.c_str(), O_CREAT | O_WRONLY | O_TRUNC, 0600);
    PRUEF(fd >= 0 && write(fd, alt.data(), alt.size()) == static_cast<ssize_t>(alt.size()));
    if (fd >= 0) close(fd);
    {
      cdj::ZustandDatei z;
      PRUEF(z.oeffne(alt_pfad));
      PRUEF(!z.neu());
      PRUEF(z.meldung().find("version 5 taken over (control table 8192 -> 24576)") != std::string::npos);
      PRUEF(z.daten()->version == CDJ_ZUSTAND_VERSION && z.daten()->groesse == sizeof(cdj_z_datei));
      auto f = std::make_unique<cdj_z_echtzeit>();
      PRUEF(cdj::z_neuestes(z.daten()->echtzeit, *f) == 1 && f->stand == 7);
      PRUEF(f->n_regler == 2 && f->n_decks == 1);
      auto wert_von = [&](const char* pfad, float& w) {
        for (int i = 0; i < f->n_regler; ++i)
          if (std::strncmp(f->regler[i].pfad, pfad, sizeof f->regler[i].pfad) == 0) { w = f->regler[i].wert; return true; }
        return false;
      };
      float w = 0.0f;
      PRUEF(wert_von("spur/1/fader", w) && w == -6.0f);
      PRUEF(wert_von("ins/komp/1/an", w) && w == 1.0f);
      PRUEF(std::strncmp(f->decks[0].material_id, "00112233aabbccdd", sizeof f->decks[0].material_id) == 0);
      PRUEF(f->decks[0].basis_bpm == 129.5);
    }
    {
      cdj::ZustandDatei z;   // the next open sees an ordinary version 6 file with the same values
      PRUEF(z.oeffne(alt_pfad));
      PRUEF(!z.neu() && z.meldung() == "vorhanden");
      auto f = std::make_unique<cdj_z_echtzeit>();
      PRUEF(cdj::z_neuestes(z.daten()->echtzeit, *f) == 1 && f->n_regler == 2 && f->decks[0].basis_bpm == 129.5);
    }
    struct stat st;
    PRUEF(stat(alt_pfad.c_str(), &st) == 0 && st.st_size == static_cast<off_t>(sizeof(cdj_z_datei)));
    unlink(alt_pfad.c_str());
  }
  //    Slice 3b: a version 6 file of the old size (16384 rows, only ever written by a development or test core of this branch) is not taken over: the
  //    size check fails and the file is recreated with the current size (a new timeline).
  {
    constexpr size_t ZEILEN_ALT = 16384;
    constexpr size_t REGLER_AB = 208 + 2 * 64 * 48 + 256 * 256;
    constexpr size_t E6_ALT = REGLER_AB + ZEILEN_ALT * 96 + 32 * 144 + 4 * 168;
    constexpr size_t GROESSE_V6_ALT = 64 + 2 * E6_ALT + 2 * (32 + 8 * 64);
    PRUEF(GROESSE_V6_ALT == 3301216);
    PRUEF(GROESSE_V6_ALT != sizeof(cdj_z_datei));
    std::vector<unsigned char> alt(GROESSE_V6_ALT, 0);
    std::memcpy(alt.data(), "CDJZ", 4);
    const uint32_t v6 = 6, g6 = static_cast<uint32_t>(GROESSE_V6_ALT);
    std::memcpy(alt.data() + 4, &v6, 4);
    std::memcpy(alt.data() + 8, &g6, 4);
    const std::string alt_pfad = ordner + "/zustand_v6_16384";
    const int fd = open(alt_pfad.c_str(), O_CREAT | O_WRONLY | O_TRUNC, 0600);
    PRUEF(fd >= 0 && write(fd, alt.data(), alt.size()) == static_cast<ssize_t>(alt.size()));
    if (fd >= 0) close(fd);
    {
      cdj::ZustandDatei z;
      PRUEF(z.oeffne(alt_pfad));
      PRUEF(z.neu());
      PRUEF(z.meldung().find("neu angelegt") != std::string::npos);
      PRUEF(z.meldung().find("taken over") == std::string::npos);
      PRUEF(z.daten()->version == CDJ_ZUSTAND_VERSION && z.daten()->groesse == sizeof(cdj_z_datei));
    }
    struct stat st;
    PRUEF(stat(alt_pfad.c_str(), &st) == 0 && st.st_size == static_cast<off_t>(sizeof(cdj_z_datei)));
    unlink(alt_pfad.c_str());
  }
  //    Same size, but version 1 in the header (a core with another layout and the same size): recreated as well.
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
