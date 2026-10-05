// Audit F20, Slice 4 (B5): die Bremse am Betrieb::starte selbst. Eine Zustandsdatei mit Fach, dreimal gestartet ohne dass
// der Stand um 1000 Zyklen wächst: der dritte Start setzt nicht fort. Negativ-Kontrolle: mit Fortschritt dazwischen
// setzt jeder Start fort. Dazu: die Datei `neustarts` liegt neben `zustand`.
#include <sys/stat.h>
#include <unistd.h>

#include <cstdio>
#include <fstream>
#include <memory>
#include <string>

#include "cypherdj/neustart.h"
#include "cypherdj/zustand.h"
#include "pruef.h"

namespace {

constexpr int N = 256;

struct Ring {
  std::unique_ptr<unsigned char[]> mem{new unsigned char[CDJ_RING_BYTES]()};
  cdj_ring_kopf* k = reinterpret_cast<cdj_ring_kopf*>(mem.get());
  Ring() {
    k->version = CDJ_RING_VERSION;
    k->rate = CDJ_RING_RATE;
    k->kanaele = CDJ_RING_KANAELE;
    k->cap = CDJ_RING_CAP;
    std::memcpy(k->magic, "CDJB", 4);
  }
};

// Ein Prozess: Kern + Betrieb, startet, läuft n Zyklen, stirbt (alles weg, Datei bleibt).
cdj::Wiederaufnahme lauf(const std::string& pfad, int zyklen, bool ki_stoppen = false, bool* ki_nachher = nullptr) {
  Ring r;
  cdj::Befehlsring bef;
  cdj::Ereignisring ere;
  cdj::Kern kern(128.0, r.k, &bef, &ere);
  cdj::Betrieb b;
  const cdj::Wiederaufnahme w = b.starte(pfad, kern);
  if (ki_stoppen) {  // Andreas drückt Stop Cypher
    cdj::Befehl bk{};
    bk.art = cdj::Befehl::KI_STOPP;
    bk.id = 6;
    std::snprintf(bk.quelle, sizeof bk.quelle, "andreas");
    bef.schiebe(bk);
  }
  int64_t mono = 1'000'000;
  for (int i = 0; i < zyklen; ++i) {
    b.zyklus_anfang(256, mono, kern);
    kern.zyklus(N, mono);
    b.zyklus_ende(256, mono, N, kern);
    mono += 5'333'333;
  }
  if (ki_nachher) *ki_nachher = kern.ki_gestoppt();
  return w;
}

std::string lies(const std::string& p) {
  std::ifstream f(p);
  std::string s;
  std::getline(f, s);
  return s;
}

}  // namespace

int main() {
  const std::string ordner = "/dev/shm/cypherdj-testbremse-" + std::to_string(getpid());
  mkdir(ordner.c_str(), 0700);
  const std::string pfad = ordner + "/zustand";
  const std::string nd = ordner + "/neustarts";
  unlink(pfad.c_str());
  unlink(nd.c_str());

  // Fehlerfall: Absturzschleife. Start 0 legt die Datei an (Frischstart), danach 10 Zyklen Stand, dann stirbt er.
  cdj::Wiederaufnahme w = lauf(pfad, 10);
  PRUEF(w.datei_ok && !w.fortgesetzt);
  {  // B3-Vorbereitung: ein Abonnenten-Fach mit zwei Abonnenten, wie der Netz-Faden des toten Kerns es hinterließ
    cdj::ZustandDatei z;
    PRUEF(z.oeffne(pfad));
    cdj_z_abos& a = z.daten()->abos[1];
    a.n = 2;
    a.stand = 1;
    a.seq = 2;
  }
  PRUEF(access(nd.c_str(), F_OK) != 0 || lies(nd) == "0 0");  // Frischstart: kein Zähler
  w = lauf(pfad, 0);
  PRUEF(w.fortgesetzt && w.stand == 10);                      // Zähler 1
  w = lauf(pfad, 0);
  PRUEF(w.fortgesetzt);                                       // Zähler 2
  w = lauf(pfad, 0);
  std::fprintf(stderr, "   dritter Start ohne Fortschritt: fortgesetzt=%d meldung=\"%s\" datei=\"%s\"\n", w.fortgesetzt,
               w.meldung.c_str(), lies(nd).c_str());
  PRUEF(!w.fortgesetzt);                                      // Zähler 3: ohne Zustand
  PRUEF(w.meldung.find("Absturzschleife") != std::string::npos);
  PRUEF(w.datei_ok && w.n_abonnenten == 2);                   // B3: Abonnenten werden im gebremsten Start übernommen
  PRUEF(lies(nd) == "3 10");
  PRUEF(access((ordner + "/neustarts.tmp").c_str(), F_OK) != 0);  // atomar: kein Rest

  // Negativ-Kontrolle: Fortschritt zwischen den Starten löst die Bremse. Stand 10 -> 1010 (+1000).
  w = lauf(pfad, 1000);  // vierter Start (ohne Zustand, Zähler 4), läuft aber 1000 Zyklen: Stand 1010
  PRUEF(!w.fortgesetzt);
  w = lauf(pfad, 0);
  PRUEF(w.fortgesetzt);
  PRUEF(w.meldung.find("Absturzschleife") == std::string::npos);
  PRUEF(lies(nd) == "0 1010");

  // Kein Fortschritt reicht nicht: +500 Zyklen zwischen den Starten
  w = lauf(pfad, 500);
  PRUEF(w.fortgesetzt);  // Zähler 1
  w = lauf(pfad, 500);
  PRUEF(w.fortgesetzt);  // Zähler 2
  w = lauf(pfad, 0);
  PRUEF(!w.fortgesetzt);  // Zähler 3: der Stand ist 1010 -> 1510 -> 2010 aber jeweils nur 500 seit dem Start davor

  // Q3: neustarts nicht schreibbar (Ordner ohne Schreibrecht): Meldung, kein .tmp-Rest, der Kern startet trotzdem
  if (geteuid() == 0) {
    // root ignoriert chmod 0500: der Ordner bleibt schreibbar, die Meldung kann nicht entstehen (Umgebung, kein Fehler im Kern).
    std::fprintf(stderr, "   SKIP Q3 schreibgeschützter Ordner: läuft als root (chmod wirkt nicht)\n");
  } else {
    chmod(ordner.c_str(), 0500);
    w = lauf(pfad, 0);
    chmod(ordner.c_str(), 0700);
    std::fprintf(stderr, "   Ordner schreibgeschützt: meldung=\"%s\"\n", w.meldung.c_str());
    PRUEF(w.datei_ok && w.meldung.find("Bremse aus: neustarts nicht schreibbar") != std::string::npos);
  }
  PRUEF(access((ordner + "/neustarts.tmp").c_str(), F_OK) != 0);
  // Schreibfehler nach dem tmp (rename scheitert, `neustarts` ist ein Ordner): tmp wird aufgeräumt
  unlink(nd.c_str());
  mkdir(nd.c_str(), 0700);
  w = lauf(pfad, 0);
  PRUEF(w.meldung.find("Bremse aus: neustarts nicht schreibbar") != std::string::npos);
  PRUEF(access((ordner + "/neustarts.tmp").c_str(), F_OK) != 0);
  rmdir(nd.c_str());
  // Negativ-Kontrolle: schreibbar ⇒ keine solche Meldung
  w = lauf(pfad, 0);
  PRUEF(w.meldung.find("Bremse aus") == std::string::npos);

  // Review Slice 5 (Beifang): auch der gebremste Start behält Stop Cypher. Sonst hob eine Absturzschleife Andreas'
  // Stopp still auf (der Server übernimmt ki_gestoppt aus /zustand/kern). Negativ-Kontrolle: ohne Stopp bleibt es frei.
  for (const bool gestoppt : {true, false}) {
    unlink(pfad.c_str());
    unlink(nd.c_str());
    bool ki = !gestoppt;
    w = lauf(pfad, 10, gestoppt, &ki);
    PRUEF(ki == gestoppt);
    for (int k = 0; k < 2; ++k) w = lauf(pfad, 0);
    w = lauf(pfad, 3, false, &ki);  // dritter Start ohne Fortschritt: gebremst
    std::fprintf(stderr, "   gebremst, Stop Cypher vorher %d: fortgesetzt=%d ki_gestoppt=%d\n", gestoppt, w.fortgesetzt, ki);
    PRUEF(!w.fortgesetzt && w.meldung.find("Absturzschleife") != std::string::npos);
    PRUEF(ki == gestoppt);
  }

  unlink(pfad.c_str());
  unlink(nd.c_str());
  rmdir(ordner.c_str());
  PRUEF_ENDE();
}
