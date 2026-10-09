// Keylock Task 7 (Plan docs/superpowers/plans/2026-10-06-keylock-echtzeit.md, Detailschnitt 7a, Tests K2 und K3): die
// Loop-Box mit Dehner im echten Kern ohne JACK, Dehner synchron (Kern::keylock_vorbereiten, keylock_fuellen nach jedem
// Zyklus). K1 (echte Fäden) steht in test_kern_keylock_faeden (`box`).
//   K2 kern_box_ende_zu_ende   Netz -> Kern: Loop laden über /k/loop/laden, 135 BPM, 416 Hz: Master ±2 ct je 100-ms-Fenster
//                              nach der Brücke ohne jeden Auftrag an den Render-Faden (Haken zählt 0; der Haken zählt nur
//                              REC, darum Wache ohne Fehlerweg, Positiv-Kontrolle REC -> 1, Keylock 7b.4). C128: Direktweg,
//                              bitgleich zum Kern ohne Keylock.
//   K4 box_zaehler             Keylock 7b.3: /zustand/box (§5.5b) trägt die Zähler der Box über das Netz: Arbeits-Thread der
//                              Box setzt lange aus (Unterlauf, 8 Fristen, aufgegeben), Knopf aus/an, kurz aus (zweiter
//                              Unterlauf): zuletzt gemeldet 2 / 1 / 0 = Leser und Dehner (Mutation BOX_ZAEHLER_VERTAUSCHT rot)
//   K3 rec_wiedergabe_dehner   REC bei 135 BPM: die Umrechnung (rendere_rec, bleibt offline, ADR 027 Entsch. 6) ergibt eine
//                              Datei ±2 ct; ihre Wiedergabe bei 135 BPM mit Dehner ±2 ct (Referenz ADR 027: −0,00 / −0,01 ct).
#include <atomic>
#include <chrono>
#include <cmath>
#include <fstream>
#include <thread>

#include "cypherdj/loop.h"
#include "cypherdj/loop_stretch.h"
#include "cypherdj/loopbox.h"
#include "cypherdj/netz.h"
#include "gegenstelle.h"
#include "kern35.h"

bool g_waechter = false;

using namespace k35;
namespace v = cypherdj::osc;
namespace fs = std::filesystem;
using Uhr = std::chrono::steady_clock;

static constexpr double PI = 3.14159265358979323846;

static void loop_schreiben(const std::string& ordner, const char* name, const std::vector<float>& d, int beats) {
  fs::create_directories(ordner + "/" + name);
  std::ofstream(ordner + "/" + name + "/loop.f32", std::ios::binary)
      .write(reinterpret_cast<const char*>(d.data()), (std::streamsize)(d.size() * 4));
  std::ofstream(ordner + "/" + name + "/loop.json") << R"({"schema":1,"name":")" << name << R"(","beats":)" << beats
                                                    << R"(,"bpm":128,"frames":)" << d.size() / 2
                                                    << R"(,"datei":"loop.f32"})";
}

static std::vector<float> sinus(double hz, int64_t frames, float amp = 0.3f) {
  std::vector<float> d((size_t)frames * 2);
  for (int64_t i = 0; i < frames; ++i) d[(size_t)(2 * i)] = d[(size_t)(2 * i + 1)] = amp * (float)std::sin(2 * PI * hz * (double)i / 48000.0);
  return d;
}

// Frequenz über aufwärts gerichtete Nulldurchgänge in [a, b)
static double frequenz(const std::vector<float>& l, int64_t a, int64_t b) {
  double erste = -1, letzte = -1;
  int zahl = 0;
  for (int64_t i = a; i + 1 < b && i + 1 < (int64_t)l.size(); ++i) {
    const double x0 = l[(size_t)i], x1 = l[(size_t)i + 1];
    if (x0 < 0 && x1 >= 0) {
      const double t = (double)i + (-x0) / (x1 - x0);
      if (erste < 0) erste = t;
      letzte = t;
      ++zahl;
    }
  }
  return zahl < 2 ? 0.0 : (zahl - 1) * 48000.0 / (letzte - erste);
}

struct Ton {
  double max_ct = 0;
  int fenster = 0, ueber = 0;
};
static Ton ton(const std::vector<float>& l, int64_t a, int64_t b, double hz) {
  Ton t;
  for (int64_t s = a; s + 4800 <= b; s += 4800) {
    const double ct = 1200.0 * std::log2(frequenz(l, s, s + 4800) / hz);
    ++t.fenster;
    if (std::fabs(ct) > std::fabs(t.max_ct)) t.max_ct = ct;
    if (std::fabs(ct) > 2.0) ++t.ueber;
  }
  return t;
}

// Ein Kern mit Netz; mit_dehner: setze_keylock_vorgabe(true) vor dem ersten Zyklus, synchron gefüllt. Box 1 spielt den Loop
// name ab der ersten Eins nach dem Start. Ausgabe: Master links (Ring des Kerns, um den Vorhalt zurückgerechnet).
struct NetzLauf {
  Arbeitsbestand ab{"test_kern_box_keylock"};
  std::unique_ptr<Lauf> x;
  std::unique_ptr<cdj::Netz> netz;
  std::atomic<int> render{0};
  bool dehner;
  bool halte_box1 = false;  // K4: der Arbeits-Thread von Box 1 (Quelle 5) setzt aus
  NetzLauf(bool mit_dehner) : dehner(mit_dehner) {
    x = std::make_unique<Lauf>(ab.pfad, nullptr);
    x->abholen = false;  // das Netz leert den Ereignisring
    if (dehner) PRUEF(x->kern->setze_keylock_vorgabe(true));
    netz = std::make_unique<cdj::Netz>(0, false, x->bef.get(), x->ere.get());
    netz->setze_loop_ordner(ab.pfad);
    cdj::KeylockOpt opt;
    opt.niedrige_prio = false;
    // Haken: jeder Auftrag an den Render-Faden des Netzes zählt (seit Task 7 nur noch die REC-Umrechnung)
    opt.rec_fn = [this](const float*, int64_t, int64_t frames) {
      ++render;
      return std::vector<float>((size_t)frames * 2, 0.0f);
    };
    netz->setze_keylock(opt);
  }
  void zyklus(int n) {
    for (int i = 0; i < n; ++i) {
      x->zyklen(x->kern->sample() + N);
      if (dehner) {
        x->kern->keylock_vorbereiten();
        for (int q = 1; q <= 6; ++q)
          if (!(halte_box1 && q == 5)) x->kern->keylock_fuellen(q);
      }
      netz->ereignisse_senden();
    }
  }
  void echtzeit(int ms) {
    const auto t0 = Uhr::now();
    while (Uhr::now() - t0 < std::chrono::milliseconds(ms)) {
      zyklus(1);
      std::this_thread::sleep_for(std::chrono::milliseconds(1));
    }
  }
  void set_neu(double bpm) {
    auto sn = x->neu(cdj::Befehl::SET_NEU);
    sn.bpm = bpm;
    x->sende(sn);
    zyklus(4);
  }
  void laden(const char* name) {
    cdj::osc::Schreiber s(v::k_loop_laden);
    s.h(7).s("pruefstand").i(1).s(name);
    netz->paket(s.daten(), s.groesse());
  }
  int64_t start() {
    auto st = x->neu(cdj::Befehl::LOOP_START, "pruefstand");
    st.deck = 1;
    x->sende(st);
    return x->kern->sample();
  }
  void aufraeumen() {  // Box entladen; das Netz gibt frei, was über LOOP_ALT kommt (auch nach der Quittung des Dehners)
    auto e = x->neu(cdj::Befehl::LOOP_LADEN, "pruefstand");
    e.deck = 1;
    e.zeiger = nullptr;
    x->sende(e);
    zyklus(400);
  }
};

// Erstes Sample mit |x| > 0,05 ab a
static int64_t erstes(const std::vector<float>& l, int64_t a) {
  for (int64_t i = a; i < (int64_t)l.size(); ++i)
    if (std::fabs(l[(size_t)i]) > 0.05f) return i;
  return -1;
}

static void test_k2() {
  const std::vector<float> s416 = sinus(416.0, SPB);
  {  // 135 BPM mit Dehner: ±2 ct nach der Brücke (Vorlauf: ab dem Einsatz), Render-Aufträge gezählt
    NetzLauf n(true);
    loop_schreiben(n.ab.pfad, "sinus", s416, 1);
    n.set_neu(135.0);
    n.x->teil("pad/1/fader", 0.0f, 0.0, 0.0);
    n.laden("sinus");
    n.echtzeit(800);
    const int64_t s0 = n.start();
    while (n.x->kern->sample() < s0 + 14 * 22500) n.zyklus(1);
    const int64_t e = erstes(n.x->l, s0);
    // nach der Brücke: ab s_h + 1408 + 960 des Lesers (liegt der Start dicht vor der Eins, klingt bis dahin Varispeed),
    // dazu der Vorhalt des Master-Limiters (der Ring des Kerns ist um ihn verzögert)
    const int64_t s_h = n.x->kern->loopboxen().keylock_leser(1)->s_h();
    const int64_t ab = std::max(e, s_h + 1408 + 960 + n.x->vh);
    const Ton t = ton(n.x->l, ab, ab + 10 * 21333, 416.0);
    std::printf("K2 135 BPM: s_h %lld, gemessen ab %lld; ", (long long)s_h, (long long)ab);
    std::printf("K2 135 BPM: Start %lld, erster Ton %lld, %d Fenster, max %+.3f ct, über 2 ct %d, Render-Aufträge des Netzes %d, "
                "Ring hörbar %d\n",
                (long long)s0, (long long)e, t.fenster, t.max_ct, t.ueber, n.render.load(),
                (int)n.x->kern->loopboxen().keylock_leser(1)->ring_hoerbar());
    PRUEF(e > 0 && t.fenster >= 40 && t.ueber == 0);
    PRUEF(n.render.load() == 0);  // Step 8: ohne Varianten-Weg rendert das Netz beim Abspielen nichts
    // Keylock 7b.4 (Prüfung n1): der Haken zählt nur die REC-Umrechnung, beim Abspielen hat er keinen Aufrufer mehr; die 0
    // oben kann also nicht rot werden (Wache ohne Fehlerweg, so gekennzeichnet). Positiv-Kontrolle, dass der Haken lebt:
    // ein REC über 4 Beats bei 135 BPM erreicht ihn genau einmal.
    {
      cdj::osc::Schreiber r(v::k_loop_rec);
      r.h(8).s("pruefstand").i(4).s("k2_rec");
      n.netz->paket(r.daten(), r.groesse());
    }
    const int64_t s_rec = n.x->kern->sample();
    while (n.x->kern->sample() < s_rec + 10 * 21333) n.zyklus(1);
    for (int w = 0; w < 200 && n.render.load() == 0; ++w) n.echtzeit(10);
    std::printf("K2 Positiv-Kontrolle: REC 4 Beats bei 135 BPM -> Render-Aufträge %d (Soll 1)\n", n.render.load());
    PRUEF(n.render.load() == 1);
    n.aufraeumen();
  }
  {  // C128: Direktweg, bitgleich zum Kern ohne Keylock (Negativ-Kontrolle)
    std::vector<float> l[2];
    for (int m = 0; m < 2; ++m) {
      NetzLauf n(m == 0);
      loop_schreiben(n.ab.pfad, "sinus", s416, 1);
      n.set_neu(128.0);
      n.x->teil("pad/1/fader", 0.0f, 0.0, 0.0);
      n.laden("sinus");
      n.zyklus(40);
      const int64_t s0 = n.start();
      while (n.x->kern->sample() < s0 + 10 * 22500) n.zyklus(1);
      l[m] = n.x->l;
      n.aufraeumen();
    }
    int64_t u = 0;
    const size_t m = std::min(l[0].size(), l[1].size());
    for (size_t i = 0; i < m; ++i) u += l[0][i] != l[1][i] ? 1 : 0;
    std::printf("K2 C128: %lld von %zu Samples ungleich zum Kern ohne Keylock\n", (long long)u, m);
    PRUEF(u == 0 && m > 200000);
  }
}

static void test_k3() {
  // REC bei 135 BPM, 4 Beats: roh 4 · 60/135 · 48000 = 85 333 Frames eines Tons 130,81 Hz, offline auf 90 000 Frames bei 128
  // gerechnet (rendere_rec, die REC-Umrechnung bleibt, ADR 027 Entsch. 6), dann im Kern bei 135 mit Dehner gespielt.
  constexpr double F = 130.81;
  const int64_t roh = (int64_t)std::llround(4 * 60.0 / 135.0 * 48000.0), frames = 4 * SPB;
  const std::vector<float> ein = sinus(F, roh);
  const std::vector<float> datei = cdj::rendere_rec(ein.data(), roh, frames);
  PRUEF((int64_t)datei.size() == 2 * frames);
  std::vector<float> dl((size_t)frames);
  for (int64_t i = 0; i < frames; ++i) dl[(size_t)i] = datei[(size_t)(2 * i)];
  const double fd = frequenz(dl, 4800, frames - 4800);
  const double ct_d = 1200.0 * std::log2(fd / F);
  std::printf("K3 Datei: %lld Frames, %.3f Hz = %+.2f ct\n", (long long)(datei.size() / 2), fd, ct_d);
  PRUEF(std::fabs(ct_d) <= 2.0);
  NetzLauf n(true);
  loop_schreiben(n.ab.pfad, "rec135", datei, 4);
  n.set_neu(135.0);
  n.x->teil("pad/1/fader", 0.0f, 0.0, 0.0);
  n.laden("rec135");
  n.echtzeit(600);
  const int64_t s0 = n.start();
  while (n.x->kern->sample() < s0 + 16 * 21333) n.zyklus(1);
  const int64_t e = erstes(n.x->l, s0);
  // 130,81 Hz hat in 4 Beats keine ganze Periodenzahl (245,27): die Naht des Mitschnitts springt. Gemessen wird je
  // 100-ms-Fenster, das keine Naht enthält (Nähte bei e + m · 4 Beats, ±50 ms Abstand); die Brücke (bis s_h + 1408 + 960)
  // liegt vor dem ersten gewerteten Fenster.
  const double spb135 = 60.0 / 135.0 * 48000.0;
  double max_ct = 0;
  int fenster = 0, ueber = 0;
  for (int64_t s = e + 9600; s + 4800 <= e + 12 * (int64_t)spb135; s += 4800) {
    bool naht = false;
    for (int m = 1; m <= 4; ++m) {
      const int64_t sn = e + (int64_t)std::llround(m * 4 * spb135);
      naht = naht || (s - 2400 < sn && sn < s + 4800 + 2400);
    }
    if (naht) continue;
    const double ct = 1200.0 * std::log2(frequenz(n.x->l, s, s + 4800) / F);
    ++fenster;
    if (std::fabs(ct) > std::fabs(max_ct)) max_ct = ct;
    if (std::fabs(ct) > 2.0) ++ueber;
  }
  std::printf("K3 Wiedergabe bei 135 BPM mit Dehner: %d Fenster ohne Naht, max %+.3f ct, über 2 ct %d (Referenz ADR 027 −0,01 ct; "
              "Varispeed wäre +92 ct)\n",
              fenster, max_ct, ueber);
  PRUEF(e > 0 && fenster >= 30 && ueber == 0);
  n.aufraeumen();
}

static void test_k4() {
  const std::vector<float> s416 = sinus(416.0, SPB);
  NetzLauf n(true);
  Gegenstelle g;
  {
    cdj::osc::Schreiber h(v::k_hallo);
    h.s("pruefstand_k4").i(g.port).i(v::vertrag);
    n.netz->paket(h.daten(), h.groesse());
  }
  loop_schreiben(n.ab.pfad, "sinus", s416, 1);
  n.set_neu(135.0);
  n.x->teil("pad/1/fader", 0.0f, 0.0, 0.0);
  n.laden("sinus");
  n.echtzeit(600);
  const int64_t s0 = n.start();
  int z[6] = {-1, -1, -1, -1, -1, -1};
  int meldungen = 0;
  auto lies = [&] {  // alle bis jetzt angekommenen /zustand/box von Box 1, die letzte zählt
    for (;;) {  // den Empfang ganz leeren (alle Adressen), jede /zustand/box von Box 1 übernehmen
      pollfd pf{g.sock, POLLIN, 0};
      if (poll(&pf, 1, 0) <= 0) break;
      const ssize_t r = recv(g.sock, g.buf, sizeof g.buf, 0);
      if (r <= 0 || !cdj::osc::lesen(g.buf, (size_t)r, g.m) || std::strcmp(g.m.adresse, "/zustand/box")) continue;
      if (g.m.anzahl == 6 && g.m.werte[0].i == 1) {
        if (std::getenv("K4_JE") && (g.m.werte[2].i != z[2] || g.m.werte[3].i != z[3]))
          std::printf("  K4 Meldung %d bei Sample %lld: %d %d %d %d %d\n", meldungen, (long long)n.x->kern->sample(),
                      g.m.werte[0].i, g.m.werte[1].i, g.m.werte[2].i, g.m.werte[3].i, g.m.werte[4].i);
        for (int i = 0; i < 6; ++i) z[i] = g.m.werte[i].i;
        ++meldungen;
      }
    }
  };
  auto bis = [&](int64_t ende) {
    while (n.x->kern->sample() < ende) {
      n.zyklus(1);
      lies();
    }
  };
  bis(s0 + 8 * 22500);
  const cdj::StreckLeser& l = *n.x->kern->loopboxen().keylock_leser(1);
  const bool ring0 = l.ring_hoerbar();
  n.halte_box1 = true;
  bis(n.x->kern->sample() + 48000);  // Unterlauf, dann 8 verpasste Fristen -> aufgegeben
  const uint64_t u1 = l.unterlauf_n(), a1 = l.aufgegeben_n();
  n.halte_box1 = false;
  const double b = n.x->kern->karte().beat_at((double)n.x->kern->sample());
  n.x->teil("keylock", 0.0f, b + 0.25, 0.0, "cypher");
  bis(n.x->kern->sample() + 14400);
  n.x->teil("keylock", 1.0f, n.x->kern->karte().beat_at((double)n.x->kern->sample()) + 0.25, 0.0, "cypher");
  bis(n.x->kern->sample() + 48000);
  const bool ring1 = l.ring_hoerbar();
  n.halte_box1 = true;
  bis(n.x->kern->sample() + 1920);  // kurz: ein Unterlauf
  n.halte_box1 = false;
  bis(n.x->kern->sample() + 48000);
  const cdj::DehnerBasis* d = n.x->kern->keylock_dehner(cdj::DECKS + 1);
  std::printf("K4 Ende bei Sample %lld, Start %lld\n", (long long)n.x->kern->sample(), (long long)s0);
  std::printf("K4 /zustand/box: %d Meldungen von Box 1, zuletzt box %d status %d unterlauf %d aufgegeben %d ring_voll %d; Leser "
              "%llu / %llu, Dehner ring_voll %llu; Ring %d / %d, nach langem Aussetzen %llu / %llu\n",
              meldungen, z[0], z[1], z[2], z[3], z[4], (unsigned long long)l.unterlauf_n(), (unsigned long long)l.aufgegeben_n(),
              (unsigned long long)(d ? d->ring_voll() : 999), (int)ring0, (int)ring1, (unsigned long long)u1,
              (unsigned long long)a1);
  PRUEF(ring0 && ring1 && u1 == 1 && a1 == 1);
  PRUEF(meldungen > 100 && z[0] == 1 && z[1] == 3);
  PRUEF(l.unterlauf_n() == 2 && l.aufgegeben_n() == 1 && d && d->ring_voll() == 0);
  // keylock_ring_voll: Wache ohne Fehlerweg im Test (der Ring des Dehners läuft hier nie über; ein falscher Weg in Feld 5
  // bliebe grün, Nachprüfung 7b N7). Gezeigt ist nur, dass es mit dem Zähler des Dehners übereinstimmt (0 = 0).
  PRUEF(z[2] == 2 && z[3] == 1 && z[4] == 0);
  // Keylock 7c.3: keylock_kein_platz mit einem Wert ungleich 0. Arbeits-Thread der Box hält (keine Quittung), dann werden
  // fünf andere Loops in die klingende Box geladen (F13, je ein neues Band): ab dem vierten ist kein Platz der Leihe frei.
  for (int j = 2; j <= 6; ++j) {
    const std::string nm = "sinus" + std::to_string(j);
    loop_schreiben(n.ab.pfad, nm.c_str(), sinus(416.0 * j / 2.0, SPB), 1);
  }
  n.halte_box1 = true;
  for (int j = 2; j <= 6; ++j) {
    n.laden(("sinus" + std::to_string(j)).c_str());
    bis(n.x->kern->sample() + 4 * 256);
  }
  bis(n.x->kern->sample() + 9600);
  const uint64_t kp = n.x->kern->loopboxen().keylock_kein_platz(1);
  n.halte_box1 = false;
  bis(n.x->kern->sample() + 9600);
  std::printf("K4 kein_platz: Kern %llu, zuletzt gemeldet %d\n", (unsigned long long)n.x->kern->loopboxen().keylock_kein_platz(1),
              z[5]);
  PRUEF(kp > 0 && z[5] == (int)n.x->kern->loopboxen().keylock_kein_platz(1));
  n.aufraeumen();
}

int main(int argc, char** argv) {
  std::setvbuf(stdout, nullptr, _IOLBF, 0);  // Zeilen auch dann, wenn LeakSanitizer das Ende übernimmt
  const std::string nur = argc > 1 ? argv[1] : "";
  if (nur.empty() || nur == "k2") test_k2();
  if (nur.empty() || nur == "k3") test_k3();
  if (nur.empty() || nur == "k4") test_k4();
  PRUEF_ENDE();
}
