/* Neustart-Zustand /dev/shm/cypherdj/zustand (SCHNITTSTELLEN.md §6.3), Layout Version 1. Kern-intern: außer dem Kern
 * liest ihn nur der Prüfstand, und nur lesend (Werkzeug cypherdj-zustand). Gemeinsam für C und C++; die Prüfungen am
 * Ende binden die Lage. Little Endian, Kopf 64 Bytes (§6).
 *
 * Aufbau: Kopf, zwei Echtzeit-Fächer (schreibt nur der Callback, jeden Zyklus), zwei Abonnenten-Fächer (schreibt nur
 * der Netz-Faden, bei jeder Änderung). Jedes Fach ist ein Seqlock: `seq` ungerade = wird geschrieben, gerade = fertig.
 * `stand` steigt mit jedem Schreiben (0 = nie geschrieben) und läuft über Kern-Neustarts weiter. Schreiben mit Stand s
 * geht in Fach s % 2: stirbt der Kern mitten im Schreiben (kill -9, Watchdog), bleibt das zuletzt fertige Fach heil.
 * Wer liest, nimmt das fertige Fach mit dem höchsten Stand.
 *
 * Abschnitte für Regler (Scheibe 25), Decks (31, 38) und Hörscheine (43) stehen im Layout und haben bis zu ihrer
 * Scheibe die Anzahl 0. Ändert eine Scheibe ein Feld, erhöht sie CDJ_ZUSTAND_VERSION; ein Kern mit anderer Version
 * legt die Datei neu an (neue Zeitachse, Meldung auf stderr). Scheibe 18. */
#ifndef CYPHERDJ_ZUSTAND_H
#define CYPHERDJ_ZUSTAND_H

#include <stddef.h>
#include <stdint.h>

#define CDJ_ZUSTAND_VERSION 1u
#define CDJ_Z_SEGMENTE 64    /* §1.3 */
#define CDJ_Z_BEFEHLE 256    /* §6.3: ausstehende Befehle bis 256 */
#define CDJ_Z_REGLER 512     /* §1.5 */
#define CDJ_Z_HOERSCHEINE 32 /* §4.5 */
#define CDJ_Z_DECKS 4        /* §1.5 */
#define CDJ_Z_HOTCUES 8      /* §4.4 */
#define CDJ_Z_ABONNENTEN 8   /* §4.1 */

/* Befehlsarten im Zustand, gleiche Zahlen wie cdj::Befehl::Art (kern.h) */
#define CDJ_Z_ART_KLICK 2    /* ROADMAP Z1 /test/klick an (Scheibe 25: je Kanal, Name in d.klick.kanal) */
#define CDJ_Z_ART_RAMPE 3    /* §4.2 /k/tempo/rampe */
#define CDJ_Z_ART_TEIL 5     /* §4.3 /k/teil, Scheibe 25 */
#define CDJ_Z_ART_DECK_START 14 /* §4.4 /k/deck/start, Scheibe 31 */
#define CDJ_Z_ART_DECK_STOPP 15 /* §4.4 /k/deck/stopp, Scheibe 31 */

typedef struct cdj_z_teil { /* Nutzlast eines Planteils (Scheibe 25; 176 Bytes, passt in cdj_z_befehl.d) */
  double ab_beat;     /* Anfang der Kurve, die das Stellwerk fährt (nach einem späten Start: dessen Beat) */
  double dauer_beats; /* ab_beat + dauer_beats = unveränderter Ende-Beat */
  float nach;
  int32_t nr;
  uint8_t form;
  uint8_t politik;
  uint8_t reserve[6];
  char pfad[32];
  char plan[32];
  char gruppe[40];    /* länger als 39 Zeichen: gekürzt (Befund an die Hauptinstanz, §1.4 nennt keine Länge) */
  char hoerschein[40];
} cdj_z_teil;

typedef struct cdj_z_deck_teil { /* Nutzlast eines wartenden Deck-Befehls start oder stopp (Scheibe 31; 144 Bytes) */
  double ab_beat;
  double quell_beat; /* nur start */
  int32_t deck;      /* 1 bis 4 */
  int32_t politik;
  uint32_t seq;
  uint8_t reserve[4];
  char plan[32];
  char gruppe[40];
  char hoerschein[40];
} cdj_z_deck_teil;

typedef struct cdj_z_segment { /* ein Segment der Tempo-Karte, §1.3 (48 Bytes) */
  int64_t s0;
  double b0;
  double bpm0;
  double k;
  double dauer_s; /* INFINITY für das letzte */
  int64_t reserve;
} cdj_z_segment;

typedef struct cdj_z_befehl { /* ein offener Befehl mit Stand (256 Bytes) */
  int64_t id;
  char quelle[48];
  uint8_t art;        /* CDJ_Z_ART_* */
  uint8_t stand;      /* §5.1 /q/stand: 1 wartet, 2 läuft */
  uint8_t verspaetet; /* Rampe: startet mit Quittung 5 statt 2 */
  uint8_t gestartet;  /* Rampe: schon in der Grundkarte */
  uint8_t reserve0[4];
  int64_t ist_sample; /* für /q/stand: läuft -> Start-Sample, wartet -> Ziel-Sample */
  double ist_beat;
  union {
    struct {
      double start_beat;
      double ende_beat;
      double ziel_bpm;
    } rampe;
    struct {
      char kanal[16]; /* "" (Scheibe 18) oder "master": Master; sonst ein Kanal aus §1.5 */
    } klick;
    cdj_z_teil teil;  /* Scheibe 25 */
    cdj_z_deck_teil deck_teil; /* Scheibe 31 */
    uint8_t roh[176]; /* Platz für spätere Befehlsarten (Deck-Teile) */
  } d;
} cdj_z_befehl;

typedef struct cdj_z_regler { /* ein Regler mit Wert und Halter, §1.5, §5.7 (ab Scheibe 25; 96 Bytes) */
  char pfad[48];
  char halter[40]; /* frei | mensch | plan:<id> | <quelle> */
  float wert;
  int32_t reserve;
} cdj_z_regler;

typedef struct cdj_z_hoerschein { /* ein Hörschein, §4.5 (ab Scheibe 43; 144 Bytes) */
  char hs_id[32];
  char kanal[16];
  char inhalt[48];
  double bpm_messung;
  double gueltig_bis_beat;
  double quell_von;
  double quell_bis;
  float sync_ms;
  float pegel_diff_db;
  float lufs_kurz;
  float reserve;
} cdj_z_hoerschein;

typedef struct cdj_z_deck { /* ein Deck, §4.4, §5.5 (ab Scheibe 31 und 38; 168 Bytes) */
  char material_id[24]; /* 16 Hex-Zeichen, "" = leer */
  int32_t fassung;
  int32_t mit_stems;
  double basis_bpm;
  int32_t status;  /* §5.5: 0 leer, 1 geladen, 2 läuft, 3 Loop, 4 Roll, 5 Rückfall */
  int32_t hoerweg; /* §5.5: 0 direkt, 1 Stretcher, 2 Puffer */
  double anker_master_beat; /* Master-Beat <-> Quell-Beat */
  double anker_quell_beat;
  double loop_von;
  double loop_laenge; /* 0 = aus */
  double roll_laenge; /* 0 = aus */
  int32_t roll_art;
  int32_t slip;
  double schatten_quell_beat;
  double hotcue[CDJ_Z_HOTCUES]; /* NaN = leer */
} cdj_z_deck;

typedef struct cdj_z_echtzeit { /* Echtzeit-Fach: alles, was der Callback besitzt */
  uint64_t seq;
  uint64_t stand;
  int64_t anker_sample;  /* Kern-Sample am Anfang des Blocks, in dem geschrieben wurde (nach den Befehlen) */
  int64_t anker_mono_ns; /* derselbe Blockanfang laut jack_get_cycle_times (µs · 1000), CLOCK_MONOTONIC */
  uint32_t anker_frames; /* Frame-Zähler des Treibers am selben Blockanfang (läuft nach 2^32 über) */
  uint32_t quantum;
  int32_t generation;
  int32_t n_segmente; /* wirksame Karte */
  int32_t n_grund;    /* Grundkarte: alles schon Gestartete (Tempoplan) */
  int32_t n_befehle;
  int32_t ki_gestoppt; /* ab Scheibe 25 */
  int32_t n_regler;
  int32_t n_hoerscheine;
  int32_t n_decks;
  int32_t reserve[2];
  char ki_spur[128];   /* ab Scheibe 25 */
  cdj_z_segment segmente[CDJ_Z_SEGMENTE];
  cdj_z_segment grund[CDJ_Z_SEGMENTE];
  cdj_z_befehl befehle[CDJ_Z_BEFEHLE];
  cdj_z_regler regler[CDJ_Z_REGLER];
  cdj_z_hoerschein hoerscheine[CDJ_Z_HOERSCHEINE];
  cdj_z_deck decks[CDJ_Z_DECKS];
} cdj_z_echtzeit;

typedef struct cdj_z_abonnent { /* ein Abonnent, §4.1 (64 Bytes) */
  char name[48];
  int32_t port;
  int32_t protokoll;
  int64_t letzte_ns; /* letzte Meldung, CLOCK_MONOTONIC */
} cdj_z_abonnent;

typedef struct cdj_z_abos { /* Abonnenten-Fach: gehört dem Netz-Faden */
  uint64_t seq;
  uint64_t stand;
  int32_t n;
  int32_t reserve[3];
  cdj_z_abonnent a[CDJ_Z_ABONNENTEN];
} cdj_z_abos;

typedef struct cdj_z_datei {
  char magic[4]; /* "CDJZ" */
  uint32_t version;
  uint32_t groesse; /* sizeof(cdj_z_datei) */
  uint32_t reserve[13];
  cdj_z_echtzeit echtzeit[2];
  cdj_z_abos abos[2];
} cdj_z_datei;

#ifdef __cplusplus
#define CDJ_Z_PRUEFE static_assert
#else
#define CDJ_Z_PRUEFE _Static_assert
#endif
CDJ_Z_PRUEFE(sizeof(cdj_z_segment) == 48, "Segment 48 Bytes");
CDJ_Z_PRUEFE(sizeof(cdj_z_befehl) == 256, "Befehl 256 Bytes");
CDJ_Z_PRUEFE(offsetof(cdj_z_befehl, d) == 80, "Nutzlast ab Byte 80");
CDJ_Z_PRUEFE(sizeof(cdj_z_teil) == 176, "Teil 176 Bytes (Scheibe 25)");
CDJ_Z_PRUEFE(sizeof(cdj_z_regler) == 96, "Regler 96 Bytes");
CDJ_Z_PRUEFE(sizeof(cdj_z_deck_teil) == 144, "Deck-Teil 144 Bytes (Scheibe 31)");
CDJ_Z_PRUEFE(sizeof(cdj_z_hoerschein) == 144, "Hörschein 144 Bytes");
CDJ_Z_PRUEFE(sizeof(cdj_z_deck) == 168, "Deck 168 Bytes");
CDJ_Z_PRUEFE(sizeof(cdj_z_abonnent) == 64, "Abonnent 64 Bytes");
CDJ_Z_PRUEFE(offsetof(cdj_z_echtzeit, segmente) == 208, "Segmente ab Byte 208");
CDJ_Z_PRUEFE(sizeof(cdj_z_echtzeit) == 208 + 2 * 64 * 48 + 256 * 256 + 512 * 96 + 32 * 144 + 4 * 168, "Echtzeit-Fach");
CDJ_Z_PRUEFE(sizeof(cdj_z_abos) == 32 + 8 * 64, "Abonnenten-Fach");
CDJ_Z_PRUEFE(offsetof(cdj_z_datei, echtzeit) == 64, "Kopf 64 Bytes");
#undef CDJ_Z_PRUEFE

#endif
