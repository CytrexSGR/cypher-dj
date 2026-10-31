// Baukasten S3c Task 5 (Plan 2026-10-29-baukasten-s3c-effekt.md, D10, D11; INTERFACES §4.10 /k/kanal/graph): der Befehl
// KANAL_GRAPH bis in den Mixer, ohne JACK und ohne Netz (das Netz prüft test_netz_erz). Rahmen wie test_kern_fx_routing.cpp.
//  1. Setzen von andreas: Quittungen 1, 2, 3; nach der Blende hat deck/2 (Träger 200 Hz) im Master die halbe Spitze (−6,02 dB ±0,05).
//  2. Entfernen (zeiger null): Quittungen 1, 2, 3, danach wieder volle Spitze; genau ein ERZ_BK_ALT mit dem gesetzten Zeiger.
//  3. Quelle cypher darf setzen (D11).
//  4. Kanal außerhalb (erz/1): Quittung 6 ausserhalb_bereich, der Zeiger kommt als ERZ_BK_ALT zurück.
//  5. KI-Stopp, Quelle cypher: Quittung 6 ki_gestoppt, der Zeiger kommt als ERZ_BK_ALT zurück; andreas darf weiter.
//  6. Allokationsfrei: Blöcke mit gesetztem Graphen, Wechsel und Blende allokieren nicht.
//  9. (S5r) Graph-Regler <kanal>/bk/1: deck/2/bk/1 setzt den Pegel des Graphen auf deck/2 (Eingang x Regler -> Ausgang), deck/3/bk/1
//     ändert deck/2 nicht, ein getauschter Graph steht auf dem aktuellen Wert, keine Allokation über die Reglerfahrt.
//  7. Wechsel A -> B -> A vor demselben Block: jeder Zeiger kommt genau einmal zurück (kein Doppel-Free), A bleibt gesetzt.
// Der Kern gibt einen übergebenen Graphen nie selbst frei, nur über ERZ_BK_ALT (der Test sammelt und gibt frei).
#include <unistd.h>

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <map>
#include <memory>
#include <new>
#include <string>
#include <vector>

#include "cypherdj/cypher_bk_ffi.h"
#include "cypherdj/huellen.h"
#include "cypherdj/kern.h"
#include "pruef.h"

static bool g_waechter = false;
static long g_allokationen = 0;
void* operator new(std::size_t n) {
  if (g_waechter) ++g_allokationen;
  void* p = std::malloc(n ? n : 1);
  if (!p) throw std::bad_alloc();
  return p;
}
void operator delete(void* p) noexcept { std::free(p); }
void operator delete(void* p, std::size_t) noexcept { std::free(p); }

namespace fs = std::filesystem;
static const std::string DJK = CYPHERDJ_DJK;
static std::string AB;
constexpr int N = 256;
constexpr int64_t SPB = 22500;  // Samples je Beat bei 128

static CypherBk* graph(const char* json) {
  char f[256] = {};
  CypherBk* g = cypher_bk_neu(json, 48000.0, f, sizeof f);
  if (!g) std::fprintf(stderr, "Graph: %s\n", f);
  PRUEF(g != nullptr);
  return g;
}
static const char* HALB =
    R"({"format":"baukasten/2","name":"halb","stimmen":1,"knoten":[{"id":"e","art":"eingang"},{"id":"a","art":"mul","b":0.5},{"id":"b","art":"mul","b":0.5},{"id":"o","art":"ausgang"}],"kanten":[{"von":"e.l","nach":"a.a"},{"von":"e.r","nach":"b.a"},{"von":"a.aus","nach":"o.l"},{"von":"b.aus","nach":"o.r"}]})";
static const char* DURCH =
    R"({"format":"baukasten/2","name":"durch","stimmen":1,"knoten":[{"id":"e","art":"eingang"},{"id":"o","art":"ausgang"}],"kanten":[{"von":"e.l","nach":"o.l"},{"von":"e.r","nach":"o.r"}]})";

// S5r: Eingang x Regler 1 (0..1) -> Ausgang, beide Seiten; der Regler skaliert den Pegel linear
static const char* REGLER_PEGEL =
    R"({"format":"baukasten/2","name":"rp","stimmen":1,"knoten":[{"id":"e","art":"eingang"},{"id":"r","art":"regler","nr":1,"min":0,"max":1},{"id":"a","art":"mul"},{"id":"b","art":"mul"},{"id":"o","art":"ausgang"}],"kanten":[{"von":"e.l","nach":"a.a"},{"von":"r.aus","nach":"a.b"},{"von":"e.r","nach":"b.a"},{"von":"r.aus","nach":"b.b"},{"von":"a.aus","nach":"o.l"},{"von":"b.aus","nach":"o.r"}]})";

static void material(const std::string& skript, const std::string& args) {
  const std::string c = "python3 " + DJK + "/kern/tests/" + skript + " --ziel " + AB + " " + args + " > /dev/null";
  PRUEF(std::system(c.c_str()) == 0);
}

struct Q {
  int64_t id;
  int32_t status;
  int64_t sample;
  std::string grund;
};

struct Lauf {
  std::unique_ptr<unsigned char[]> mem{new unsigned char[CDJ_RING_BYTES]()};
  cdj_ring_kopf* ring = reinterpret_cast<cdj_ring_kopf*>(mem.get());
  std::unique_ptr<cdj::Befehlsring> bef{new cdj::Befehlsring()};
  std::unique_ptr<cdj::Ereignisring> ere{new cdj::Ereignisring()};
  std::unique_ptr<cdj::LaderRinge> lr{new cdj::LaderRinge()};
  cdj::Lader lader{AB, 3800LL << 20};
  std::unique_ptr<cdj::Kern> kern;
  cdj_huellen_kopf* huellen = nullptr;
  std::vector<float> l;   // Master rechts (der Träger des Materials liegt rechts)
  std::vector<CypherBk*> spaeter;   // Zeiger erst am Ende freigeben: eine frühere Freigabe ließe die Adresse wiederverwenden und die Zählung täuschen
  std::vector<Q> q;
  std::map<const void*, int> alt;   // ERZ_BK_ALT je Zeiger gezählt
  int64_t id = 100;
  bool bewachen = false;
  Lauf() {
    ring->version = CDJ_RING_VERSION;
    ring->rate = CDJ_RING_RATE;
    ring->kanaele = CDJ_RING_KANAELE;
    ring->cap = CDJ_RING_CAP;
    std::memcpy(ring->magic, "CDJB", 4);
    huellen = (cdj_huellen_kopf*)std::aligned_alloc(64, CDJ_HUELLEN_BYTES);
    cdj_huellen_init(huellen);
    kern.reset(new cdj::Kern(128.0, ring, bef.get(), ere.get()));
    kern->verbinde_lader(lr.get());
    kern->verbinde_huellen(huellen);
    l.reserve(1'000'000);
  }
  ~Lauf() {
    std::free(huellen);
    for (CypherBk* g : spaeter)
      if (zurueck(g) > 0) cypher_bk_frei(g);   // nur, was der Kern zurückgab; sonst gehört er noch dem Mixer (kein Doppel-Free bei einem Fehler)
  }
  cdj::Befehl neu(int art, const char* quelle) {
    cdj::Befehl b{};
    b.art = art;
    b.id = ++id;
    std::snprintf(b.quelle, sizeof b.quelle, "%s", quelle);
    return b;
  }
  int64_t sende(const cdj::Befehl& b) {
    PRUEF(bef->schiebe(b));
    return b.id;
  }
  int64_t graph_setzen(const char* kanal, CypherBk* g, const char* quelle = "andreas") {
    cdj::Befehl b = neu(cdj::Befehl::KANAL_GRAPH, quelle);
    std::snprintf(b.pfad, sizeof b.pfad, "%s", kanal);
    b.zeiger = g;
    return sende(b);
  }
  void zyklen(int64_t bis_sample) {
    const int vh = kern->mixer().limiter_vorhalt();
    while (kern->sample() < bis_sample) {
      const int64_t n0 = kern->sample();
      const uint64_t w0 = cdj_lade(&ring->w);
      g_waechter = bewachen;
      kern->zyklus(N, n0 * 20833);
      g_waechter = false;
      lader.einmal(*lr);
      const float* d = cdj_ring_daten_c(ring);
      if ((int64_t)l.size() < n0 + N) l.resize(n0 + N);
      for (int i = 0; i < N; ++i)
        if (n0 + i - vh >= 0) l[n0 + i - vh] = d[((w0 + (uint64_t)i) % CDJ_RING_CAP) * 4 + 1];   // rechts: dort liegt der Träger
      cdj::Ereignis e;
      while (ere->hole(e)) {
        if (e.art == cdj::Ereignis::QUITTUNG) q.push_back({e.id, e.status, e.sample, e.grund});
        if (e.art == cdj::Ereignis::ERZ_BK_ALT) ++alt[e.zeiger];
      }
    }
  }
  const Q* quittung(int64_t i, int32_t st) const {
    for (const auto& x : q)
      if (x.id == i && x.status == st) return &x;
    return nullptr;
  }
  bool angenommen(int64_t i) const { return quittung(i, 1) && quittung(i, 2) && quittung(i, 3) && !quittung(i, 6); }
  std::string abgelehnt(int64_t i) const {
    const Q* x = quittung(i, 6);
    return x ? x->grund : std::string("(nicht abgelehnt)");
  }
  int zurueck(const void* p) const {
    auto it = alt.find(p);
    return it == alt.end() ? 0 : it->second;
  }
  float spitze(int64_t von, int64_t bis) const {
    float m = 0.0f;
    for (int64_t i = von; i < bis && i < (int64_t)l.size(); ++i) m = std::max(m, std::fabs(l[i]));
    return m;
  }
};

static double db(double a, double b) { return 20.0 * std::log10(a / b); }

int main() {
  AB = "/dev/shm/test_kern_kanal_graph_" + std::to_string(::getpid());
  fs::create_directories(AB);
  material("hand/traeger_fassung.py", "--material-id f0f0000000000003 --beats 64 --freq 200 --ohne-klick --traeger 0.25");

  // ---------------------------------------------------------------- Fall 1, 2, 6, 7: deck/2 mit Träger, Fader offen
  {
    Lauf a;
    a.zyklen(10 * N);
    cdj::Befehl ld = a.neu(cdj::Befehl::DECK_LADEN, "leitstand");
    ld.deck = 2;
    std::snprintf(ld.material_id, sizeof ld.material_id, "%s", "f0f0000000000003");
    ld.bpm = 128.0;
    ld.fassung = 1;
    a.sende(ld);
    a.zyklen(20 * N);
    cdj::Befehl fd = a.neu(cdj::Befehl::TEIL, "pruefstand");
    std::snprintf(fd.pfad, sizeof fd.pfad, "%s", "deck/2/fader");
    fd.ab_beat = 2.0;
    fd.wert = 0.0f;
    fd.politik = 1;
    a.sende(fd);
    cdj::Befehl st = a.neu(cdj::Befehl::DECK_START, "andreas");
    st.deck = 2;
    st.ab_beat = 8.0;
    st.quell_beat = 0.0;
    a.sende(st);
    a.zyklen(10 * SPB);
    const float voll0 = a.spitze(10 * SPB - 6000, 10 * SPB - 500);
    PRUEF(voll0 > 0.05f);   // Positiv-Kontrolle: das Deck klingt im Master

    // Fall 1 + 6: setzen, ab dem zweiten Block mit Graph bewacht
    CypherBk* halb = graph(HALB);
    const int64_t i1 = a.graph_setzen("deck/2", halb);
    a.zyklen(10 * SPB + 2 * N);
    a.bewachen = true;
    a.zyklen(10 * SPB + 20 * N);
    a.bewachen = false;
    const float halb1 = a.spitze(10 * SPB + 8 * N, 10 * SPB + 20 * N);
    std::printf("Fall 1: voll %.5f, mit Halbierer %.5f (%.3f dB)\n", voll0, halb1, db(halb1, voll0));
    PRUEF(a.angenommen(i1));
    PRUEF(std::fabs(db(halb1, voll0) + 6.0206) < 0.05);
    PRUEF(a.zurueck(halb) == 0);                      // gesetzt und gehört: noch nicht zurück
    PRUEF(g_allokationen == 0);                       // Fall 6
    std::printf("Fall 6: Allokationen im Zyklus %ld\n", g_allokationen);

    // Fall 2: entfernen
    const int64_t i2 = a.graph_setzen("deck/2", nullptr);
    a.zyklen(12 * SPB);
    const float voll2 = a.spitze(12 * SPB - 6000, 12 * SPB - 500);
    std::printf("Fall 2: nach Entfernen %.5f (%.3f dB gegen vorher)\n", voll2, db(voll2, voll0));
    PRUEF(a.angenommen(i2));
    PRUEF(std::fabs(db(voll2, voll0)) < 0.05);
    PRUEF(a.zurueck(halb) == 1);                      // genau einmal zurück
    PRUEF(a.alt.size() == 1);
    a.spaeter.push_back(halb);

    // Fall 7: A -> B -> A vor demselben Block (zwei Befehle im selben Zyklus)
    CypherBk* ga = graph(HALB);
    CypherBk* gb = graph(DURCH);
    a.graph_setzen("deck/2", ga);
    a.zyklen(13 * SPB);                               // A ist gesetzt und gehört
    const int64_t j1 = a.graph_setzen("deck/2", gb);
    const int64_t j2 = a.graph_setzen("deck/2", ga);
    a.zyklen(14 * SPB);
    PRUEF(a.angenommen(j1) && a.angenommen(j2));
    PRUEF(a.zurueck(gb) == 1);                        // B nie gehört: genau einmal zurück
    PRUEF(a.zurueck(ga) == 0);                        // A bleibt gesetzt
    const float halb7 = a.spitze(14 * SPB - 6000, 14 * SPB - 500);
    PRUEF(std::fabs(db(halb7, voll0) + 6.0206) < 0.05);
    a.spaeter.push_back(gb);
    // ga gehört dem Mixer und wird mit dem Kern freigegeben
  }

  // ---------------------------------------------------------------- Fall 3, 4, 5, 8: nur Quittungen und Rückgabe
  {
    Lauf a;
    a.zyklen(10 * N);
    CypherBk* g3 = graph(HALB);
    const int64_t i3 = a.graph_setzen("deck/1", g3, "cypher");   // D11: cypher darf
    a.zyklen(20 * N);
    PRUEF(a.angenommen(i3));
    PRUEF(a.zurueck(g3) == 0);

    CypherBk* g4 = graph(HALB);
    const int64_t i4 = a.graph_setzen("erz/1", g4);
    a.zyklen(30 * N);
    PRUEF(a.abgelehnt(i4) == "ausserhalb_bereich");
    PRUEF(a.zurueck(g4) == 1);
    a.spaeter.push_back(g4);

    a.sende(a.neu(cdj::Befehl::KI_STOPP, "andreas"));
    a.zyklen(40 * N);
    CypherBk* g5 = graph(HALB);
    const int64_t i5 = a.graph_setzen("deck/3", g5, "cypher");
    CypherBk* g5b = graph(HALB);
    const int64_t i5b = a.graph_setzen("deck/3", g5b, "andreas");   // die Hand darf im Stopp
    a.zyklen(50 * N);
    PRUEF(a.abgelehnt(i5) == "ki_gestoppt");
    PRUEF(a.zurueck(g5) == 1);
    a.spaeter.push_back(g5);
    PRUEF(a.angenommen(i5b));
    PRUEF(a.zurueck(g5b) == 0);

    // Fall 8: Burst, zwölf Wechsel auf deck/4 im selben Zyklus (mehr als die Ablage MIX_BK_FREI fasst)
    CypherBk* b8[12];
    for (int i = 0; i < 12; ++i) {
      b8[i] = graph(i % 2 ? DURCH : HALB);
      a.graph_setzen("deck/4", b8[i]);
    }
    a.zyklen(60 * N);
    int einmal = 0;
    for (int i = 0; i < 11; ++i) einmal += a.zurueck(b8[i]) == 1;
    std::printf("Fall 8: %d von 11 abgelösten zurück, verloren %u\n", einmal, a.kern->mixer().bk_verloren());
    PRUEF(einmal == 11);
    PRUEF(a.zurueck(b8[11]) == 0);                    // der letzte bleibt gesetzt
    PRUEF(a.kern->mixer().bk_verloren() == 0);
    for (int i = 0; i < 11; ++i) a.spaeter.push_back(b8[i]);
  }

  // ---------------------------------------------------------------- Fall 9 (S5r): Graph-Regler deck/<n>/bk/1 bis in den Graphen
  {
    Lauf a;
    a.zyklen(10 * N);
    cdj::Befehl ld = a.neu(cdj::Befehl::DECK_LADEN, "leitstand");
    ld.deck = 2;
    std::snprintf(ld.material_id, sizeof ld.material_id, "%s", "f0f0000000000003");
    ld.bpm = 128.0;
    ld.fassung = 1;
    a.sende(ld);
    a.zyklen(20 * N);
    cdj::Befehl fd = a.neu(cdj::Befehl::TEIL, "pruefstand");
    std::snprintf(fd.pfad, sizeof fd.pfad, "%s", "deck/2/fader");
    fd.ab_beat = 2.0;
    fd.wert = 0.0f;
    fd.politik = 1;
    a.sende(fd);
    cdj::Befehl st = a.neu(cdj::Befehl::DECK_START, "andreas");
    st.deck = 2;
    st.ab_beat = 8.0;
    st.quell_beat = 0.0;
    a.sende(st);
    a.zyklen(10 * SPB);
    const float voll = a.spitze(10 * SPB - 6000, 10 * SPB - 500);
    PRUEF(voll > 0.05f);   // Positiv-Kontrolle: das Deck klingt im Master
    const auto regler = [&](const char* pfad, double beat, float wert) {
      cdj::Befehl t = a.neu(cdj::Befehl::TEIL, "pruefstand");
      std::snprintf(t.pfad, sizeof t.pfad, "%s", pfad);
      t.ab_beat = beat;
      t.wert = wert;
      t.politik = 1;
      a.sende(t);
    };
    // Fenster ab 9000 Samples nach dem Setzen: die FFI glättet über 20 ms, bei fallendem Wert läge die Spitze sonst im Einschwingen
    const auto pegel = [&](int64_t von) { return db(a.spitze(von, von + 6000), voll); };
    CypherBk* g1 = graph(REGLER_PEGEL);
    const int64_t i1 = a.graph_setzen("deck/2", g1);
    regler("deck/2/bk/1", 11.0, 1.0f);
    regler("deck/3/bk/1", 12.0, 0.0f);   // Gegenprobe: ein anderer Kanal
    regler("deck/2/bk/1", 13.0, 0.25f);
    g_allokationen = 0;
    a.bewachen = true;
    a.zyklen(11 * SPB + 15000);
    a.bewachen = false;
    const double p05 = db(a.spitze(10 * SPB + 8 * N, 10 * SPB + 20 * N), voll);   // Vorgabe 0,5
    const double p10 = pegel(11 * SPB + 9000);
    std::printf("Fall 9: Vorgabe 0,5 -> %.3f dB, 1,0 -> %.3f dB\n", p05, p10);
    PRUEF(a.angenommen(i1));
    PRUEF(std::fabs(p05 + 6.0206) < 0.05);
    PRUEF(std::fabs(p10) < 0.05);                      // deck/2/bk/1 = 1,0
    a.bewachen = true;
    a.zyklen(12 * SPB + 15000);
    a.bewachen = false;
    const double p_fremd = pegel(12 * SPB + 9000);
    std::printf("Fall 9: deck/3/bk/1 = 0 -> deck/2 %.3f dB\n", p_fremd);
    PRUEF(std::fabs(p_fremd) < 0.05);                  // deck/2 hört nichts von deck/3
    a.bewachen = true;
    a.zyklen(13 * SPB + 15000);
    a.bewachen = false;
    const double p025 = pegel(13 * SPB + 9000);
    std::printf("Fall 9: 0,25 -> %.3f dB (soll -12,041)\n", p025);
    PRUEF(std::fabs(p025 + 12.0412) < 0.05);
    std::printf("Fall 9: Allokationen über die Reglerfahrt %ld\n", g_allokationen);
    PRUEF(g_allokationen == 0);

    // Tausch (D5): Regler auf 0,9, danach neuer Graph; der steht auf 0,9, nicht auf seinem Vorgabewert
    regler("deck/2/bk/1", 14.0, 0.9f);
    a.zyklen(14 * SPB + 2000);
    CypherBk* g2 = graph(REGLER_PEGEL);
    a.graph_setzen("deck/2", g2);
    a.zyklen(14 * SPB + 21500);
    const double p09 = pegel(14 * SPB + 15000);
    std::printf("Fall 9: nach Tausch 0,9 -> %.3f dB (soll -0,915)\n", p09);
    PRUEF(std::fabs(p09 + 0.9151) < 0.05);
    PRUEF(a.zurueck(g1) == 1);                         // der abgelöste Graph kam zurück
    a.spaeter.push_back(g1);
  }
  fs::remove_all(AB);
  PRUEF_ENDE();
}
