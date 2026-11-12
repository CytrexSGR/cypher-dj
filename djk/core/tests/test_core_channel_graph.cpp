// Baukasten S3c Task 5 (Plan 2026-10-29-baukasten-s3c-effekt.md, D10, D11; INTERFACES §4.10 /k/kanal/graph): der Befehl
// KANAL_GRAPH bis in den Mixer, ohne JACK und ohne Netz (das Netz prüft test_netz_erz). Rahmen wie test_core_fx_routing.cpp.
//  1. Setzen von andreas: Quittungen 1, 2, 3; nach der Blende hat deck/2 (Träger 200 Hz) im Master die halbe Spitze (−6,02 dB ±0,05).
//  2. Entfernen (zeiger null): Quittungen 1, 2, 3, danach wieder volle Spitze; genau ein ERZ_BK_ALT mit dem gesetzten Zeiger.
//  3. Quelle cypher darf setzen (D11).
//  4. Kanal außerhalb (erz/1): Quittung 6 ausserhalb_bereich, der Zeiger kommt als ERZ_BK_ALT zurück.
//  5. KI-Stopp, Quelle cypher: Quittung 6 ki_gestoppt, der Zeiger kommt als ERZ_BK_ALT zurück; andreas darf weiter.
//  6. Allokationsfrei: Blöcke mit gesetztem Graphen, Wechsel und Blende allokieren nicht.
//  9. (S5r) Graph-Regler <kanal>/bk/1: deck/2/bk/1 setzt den Pegel des Graphen auf deck/2 (Eingang x Regler -> Ausgang), deck/3/bk/1
//     ändert deck/2 nicht, ein getauschter Graph steht auf dem aktuellen Wert, keine Allokation über die Reglerfahrt.
//  7. Wechsel A -> B -> A vor demselben Block: jeder Zeiger kommt genau einmal zurück (kein Doppel-Free), A bleibt gesetzt.
// S6 Task 2 (Plan 2026-10-31-baukasten-s6-send-graphen.md, send returns fx/3 and fx/4, notation fx/3, fx/4 only):
// 10. fx3_graph_set_and_audible: pass-through graph on fx/3 with deck/2/send/3 at 0 dB adds the send to the master (+6.02 dB),
//     quittungen 1, 2, 3, no allocation in the cycle.
// 11. fx4_ki_stopp: cypher may set fx/4; after the KI stop cypher gets ki_gestoppt and the graph comes back once, andreas may.
// 12. fx_burst_no_leak: 20 switches on fx/3 in one cycle: 19 come back exactly once, none lost, the last one stays.
// 13. fx2_rejected: fx/2 (the hall) and fx/5 reach the core only past the network: ausserhalb_bereich, graph comes back once.
// 14. fx3_ignores_deck3_knobs: a regler node on fx/3 does not hear deck/3/bk/1 (S5r binds knobs to channel names).
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
#include "cypherdj/hulls.h"
#include "cypherdj/core.h"
#include "cypherdj/state.h"
#include "check.h"

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
  const std::string c = "python3 " + DJK + "/core/tests/" + skript + " --ziel " + AB + " " + args + " > /dev/null";
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
  material("hand/carrier_rendition.py", "--material-id f0f0000000000003 --beats 64 --freq 200 --ohne-klick --traeger 0.25");

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

  // ---------------------------------------------------------------- S6 Fall 10, 14: deck/2 mit Träger auf send/3, Graph auf fx/3
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
    const auto regler = [&](const char* pfad, double beat, float wert) {
      cdj::Befehl t = a.neu(cdj::Befehl::TEIL, "pruefstand");
      std::snprintf(t.pfad, sizeof t.pfad, "%s", pfad);
      t.ab_beat = beat;
      t.wert = wert;
      t.politik = 1;
      a.sende(t);
    };
    regler("deck/2/fader", 2.0, 0.0f);
    regler("deck/2/send/3", 2.0, 0.0f);   // the send carries the deck at 0 dB; fx/3/rueckweg stays at its default 0 dB
    cdj::Befehl st = a.neu(cdj::Befehl::DECK_START, "andreas");
    st.deck = 2;
    st.ab_beat = 8.0;
    st.quell_beat = 0.0;
    a.sende(st);
    a.zyklen(10 * SPB);
    const float voll = a.spitze(10 * SPB - 6000, 10 * SPB - 500);
    PRUEF(voll > 0.05f);   // positive control: the deck sounds, the open send without a graph adds nothing

    // Fall 10: pass-through graph on fx/3
    CypherBk* durch = graph(DURCH);
    const int64_t i10 = a.graph_setzen("fx/3", durch);
    a.zyklen(10 * SPB + 2 * N);
    g_allokationen = 0;
    a.bewachen = true;
    a.zyklen(10 * SPB + 20 * N);
    a.bewachen = false;
    const float mit = a.spitze(10 * SPB + 8 * N, 10 * SPB + 20 * N);
    std::printf("Fall 10: ohne %.5f, mit Send-Graph %.5f (%.3f dB), Allokationen %ld\n", voll, mit, db(mit, voll), g_allokationen);
    PRUEF(a.angenommen(i10));
    PRUEF(std::fabs(db(mit, voll) - 6.0206) < 0.1);
    PRUEF(a.zurueck(durch) == 0);
    PRUEF(g_allokationen == 0);

    // Fall 14: replace by the knob graph (default 0.5 -> dry 1 + send 0.5 = +3.52 dB), then turn deck/3/bk/1 up
    CypherBk* knopf = graph(REGLER_PEGEL);
    a.graph_setzen("fx/3", knopf);
    a.zyklen(10 * SPB + 40 * N);
    const double p05 = db(a.spitze(10 * SPB + 30 * N, 10 * SPB + 40 * N), voll);
    regler("deck/3/bk/1", 11.0, 1.0f);   // another channel's knob
    regler("deck/4/bk/1", 11.0, 1.0f);
    a.zyklen(11 * SPB + 15000);
    const double p_fremd = db(a.spitze(11 * SPB + 9000, 11 * SPB + 15000), voll);
    std::printf("Fall 14: fx/3 mit Vorgabe 0,5 -> %.3f dB, nach deck/3/bk/1 und deck/4/bk/1 = 1 -> %.3f dB (soll beide 3,522)\n", p05, p_fremd);
    PRUEF(std::fabs(p05 - 3.5218) < 0.1);
    PRUEF(std::fabs(p_fremd - 3.5218) < 0.1);
    PRUEF(a.zurueck(durch) == 1);   // the replaced graph came back
    a.spaeter.push_back(durch);

    // Fall 15 (S14): the knobs fx/3/bk/1 and fx/4/bk/1 reach the graphs on the send returns. `knopf` is on fx/3, deck/2 on send/3.
    const auto stufe = [&](int64_t beat) {   // level in dB of the window 9000..15000 samples after the beat, relative to the dry deck
      a.zyklen(beat * SPB + 15000);
      return db(a.spitze(beat * SPB + 9000, beat * SPB + 15000), voll);
    };
    regler("fx/3/bk/1", 13.0, 1.0f);
    const double s_hoch = stufe(13);       // dry 1 + send 1: +6.02 dB
    regler("fx/3/bk/1", 15.0, 0.0f);
    const double s_null = stufe(15);       // dry only: 0.00 dB
    regler("fx/4/bk/1", 17.0, 1.0f);       // the other return's knob: fx/3 must not hear it (catches a row swap)
    const double s_fremd = stufe(17);
    std::printf("Fall 15: fx/3/bk/1 = 1 -> %.3f dB (soll 6,021), = 0 -> %.3f dB (soll 0), fx/4/bk/1 = 1 with fx/3 at 0 -> %.3f dB (soll 0)\n",
                s_hoch, s_null, s_fremd);
    PRUEF(std::fabs(s_hoch - 6.0206) < 0.1);
    PRUEF(std::fabs(s_null) < 0.1);
    PRUEF(std::fabs(s_fremd) < 0.1);

    // fx/4: a knob graph on the second return, the deck moves from send/3 to send/4. The slot value of fx/4/bk/1 is already 1 (A4:
    // the value belongs to the slot, the new graph gets it on its first block); fx/3/bk/1 is 0, so only the own row can lift it.
    CypherBk* knopf4 = graph(REGLER_PEGEL);
    a.graph_setzen("fx/4", knopf4);
    regler("deck/2/send/3", 18.0, -200.0f);
    regler("deck/2/send/4", 18.0, 0.0f);
    const double v_hoch = stufe(19);
    regler("fx/4/bk/1", 21.0, 0.0f);
    const double v_null = stufe(21);
    regler("fx/3/bk/1", 23.0, 1.0f);       // the other return's knob: fx/4 must not hear it
    const double v_fremd = stufe(23);
    std::printf("Fall 15: fx/4 graph, slot value 1 -> %.3f dB (soll 6,021), fx/4/bk/1 = 0 -> %.3f dB (soll 0), then fx/3/bk/1 = 1 -> %.3f dB (soll 0)\n",
                v_hoch, v_null, v_fremd);
    PRUEF(std::fabs(v_hoch - 6.0206) < 0.1);
    PRUEF(std::fabs(v_null) < 0.1);
    PRUEF(std::fabs(v_fremd) < 0.1);

    // swap (A4): fx/3/bk/1 is 1; a fresh knob graph on fx/3 gets the slot value, not its own 0.5
    CypherBk* knopf3 = graph(REGLER_PEGEL);
    a.graph_setzen("fx/3", knopf3);
    a.zyklen(24 * SPB + 15000);
    regler("deck/2/send/3", 25.0, 0.0f);
    regler("deck/2/send/4", 25.0, -200.0f);
    const double t_hoch = stufe(26);
    std::printf("Fall 15: fresh graph on fx/3 with the slot value 1 -> %.3f dB (soll 6,021; 3,522 would be the graph's own default)\n", t_hoch);
    PRUEF(std::fabs(t_hoch - 6.0206) < 0.1);
    PRUEF(a.zurueck(knopf) == 1);
    a.spaeter.push_back(knopf);
  }

  // ---------------------------------------------------------------- S14 Fall 16: knob values that arrive by restore or render
  // regler_setzen (project values) and regler_uebernehmen (render) write the control without a command; the graph knob must
  // still carry the value. Two own runs: deck/2 at 0 dB on send/3 resp. send/4 and a knob graph on that return.
  {
    // 32-knob widening: cases 2 and 3 take the two-digit knobs through the same two entries (regler_setzen: fx/3/bk/32, graph knob 32;
    // regler_uebernehmen: fx/4/bk/17, graph knob 17). A parser reading one digit, or a 3-bit packing, would seed knob 1 / 2 / 8 instead.
    // Cases 4 and 5: a state of the old format, fx/3/bk/1..8 all at 1.0 and nothing else (an old neustart state / project knows no knob above 8):
    // it loads (8 rows taken), the graph on knob 8 follows its row, the graph on knob 9 stays at the default 0.5 (3.522 dB instead of 6.021 dB)
    // 64-knob widening: case 6 (regler_setzen: fx/3/bk/64, graph knob 64) and case 7 (regler_uebernehmen: fx/4/bk/33, graph knob 33) take the
    // knobs above 32 through the same entries. Cases 8 and 9: a state of the 32-knob format, fx/3/bk/1..32 all at 1.0 and nothing else: it
    // loads (32 rows taken), the graph on knob 32 follows its row, the graph on knob 33 stays at the default 0.5 (3.522 dB). These graphs need an
    // engine that knows knobs 33..64 (hall_ffi REGLER 64): cases 6, 7 and 8 fail on a library older than the widening.
    for (const int teil : {0, 1, 2, 3, 4, 5, 6, 7, 8, 9}) {
      Lauf b;
      const bool fx4 = teil == 1 || teil == 3 || teil == 7;
      const bool alt_zustand = teil == 4 || teil == 5 || teil == 8 || teil == 9;
      const int knopf_nr = teil == 2 ? 32 : teil == 3 ? 17 : teil == 4 ? 9 : teil == 5 ? 8 : teil == 6 ? 64 : teil == 7 ? 33 : teil == 8 ? 33 : teil == 9 ? 32 : 1;
      const double soll_db = (teil == 4 || teil == 8) ? 3.5218 : 6.0206;
      const std::string knopf_pfad = std::string(fx4 ? "fx/4" : "fx/3") + "/bk/" + std::to_string(knopf_nr);
      std::string knopf_json = REGLER_PEGEL;
      if (knopf_nr != 1) {
        const size_t pos = knopf_json.find("\"nr\":1,");
        PRUEF(pos != std::string::npos);
        knopf_json.replace(pos, 7, "\"nr\":" + std::to_string(knopf_nr) + ",");
      }
      if (alt_zustand) {
        std::unique_ptr<cdj_z_echtzeit> f{new cdj_z_echtzeit()};
        const int n_alt = teil >= 8 ? 32 : 8;   // the old state names knobs 1..8 (before the 32-knob widening) or 1..32
        f->n_regler = n_alt;
        for (int i = 0; i < n_alt; ++i) {
          std::snprintf(f->regler[i].pfad, sizeof f->regler[i].pfad, "fx/3/bk/%d", i + 1);
          f->regler[i].wert = 1.0f;
        }
        PRUEF(b.kern->regler_uebernehmen(*f) == n_alt);
      } else if (!fx4) {
        PRUEF(b.kern->regler_setzen(knopf_pfad.c_str(), 1.0f));
        PRUEF(!b.kern->regler_setzen("fx/3/bk/65", 1.0f));   // negative control: no such knob (the knobs are 1..64)
      } else {
        std::unique_ptr<cdj_z_echtzeit> f{new cdj_z_echtzeit()};
        f->n_regler = 1;
        std::snprintf(f->regler[0].pfad, sizeof f->regler[0].pfad, "%s", knopf_pfad.c_str());
        f->regler[0].wert = 1.0f;
        PRUEF(b.kern->regler_uebernehmen(*f) == 1);
      }
      b.zyklen(10 * N);
      cdj::Befehl ld = b.neu(cdj::Befehl::DECK_LADEN, "leitstand");
      ld.deck = 2;
      std::snprintf(ld.material_id, sizeof ld.material_id, "%s", "f0f0000000000003");
      ld.bpm = 128.0;
      ld.fassung = 1;
      b.sende(ld);
      b.zyklen(20 * N);
      const auto regler = [&](const char* pfad, double beat, float wert) {
        cdj::Befehl t = b.neu(cdj::Befehl::TEIL, "pruefstand");
        std::snprintf(t.pfad, sizeof t.pfad, "%s", pfad);
        t.ab_beat = beat;
        t.wert = wert;
        t.politik = 1;
        b.sende(t);
      };
      regler("deck/2/fader", 2.0, 0.0f);
      regler(fx4 ? "deck/2/send/4" : "deck/2/send/3", 2.0, 0.0f);
      cdj::Befehl st = b.neu(cdj::Befehl::DECK_START, "andreas");
      st.deck = 2;
      st.ab_beat = 8.0;
      st.quell_beat = 0.0;
      b.sende(st);
      b.zyklen(10 * SPB);
      const float voll = b.spitze(10 * SPB - 6000, 10 * SPB - 500);
      PRUEF(voll > 0.05f);
      CypherBk* knopf = graph(knopf_json.c_str());
      b.graph_setzen(fx4 ? "fx/4" : "fx/3", knopf);
      b.zyklen(10 * SPB + 40 * N);
      const double pegel = db(b.spitze(10 * SPB + 30 * N, 10 * SPB + 40 * N), voll);
      std::printf("Fall 16: %s knob set by %s -> %.3f dB (soll 6,021; 3,522 would be the unseeded default)\n", knopf_pfad.c_str(),
                  (fx4 || alt_zustand) ? "regler_uebernehmen" : "regler_setzen", pegel);
      PRUEF(std::fabs(pegel - soll_db) < 0.1);
    }
  }

  // ---------------------------------------------------------------- S6 Fall 11, 12, 13: Quittungen und Rückgabe auf fx/3, fx/4
  {
    Lauf a;
    a.zyklen(10 * N);
    CypherBk* g0 = graph(HALB);
    const int64_t i0 = a.graph_setzen("fx/4", g0, "cypher");   // D11: cypher may set before the stop
    a.zyklen(20 * N);
    PRUEF(a.angenommen(i0));
    PRUEF(a.zurueck(g0) == 0);

    a.sende(a.neu(cdj::Befehl::KI_STOPP, "andreas"));
    a.zyklen(30 * N);
    CypherBk* g11 = graph(HALB);
    const int64_t i11 = a.graph_setzen("fx/4", g11, "cypher");
    CypherBk* g11b = graph(HALB);
    const int64_t i11b = a.graph_setzen("fx/4", g11b, "andreas");   // the hand may during the stop
    a.zyklen(40 * N);
    PRUEF(a.abgelehnt(i11) == "ki_gestoppt");
    PRUEF(a.zurueck(g11) == 1);                                      // Fall 11: back once, no leak
    a.spaeter.push_back(g11);
    PRUEF(a.angenommen(i11b));
    PRUEF(a.zurueck(g11b) == 0);
    PRUEF(a.zurueck(g0) == 1);                                       // replaced by the hand's graph
    a.spaeter.push_back(g0);

    // Fall 12: burst on fx/3, 20 switches in one cycle (more than the free list MIX_BK_FREI holds)
    CypherBk* b12[20];
    for (int i = 0; i < 20; ++i) {
      b12[i] = graph(i % 2 ? DURCH : HALB);
      a.graph_setzen("fx/3", b12[i]);
    }
    a.zyklen(50 * N);
    int einmal = 0;
    for (int i = 0; i < 19; ++i) einmal += a.zurueck(b12[i]) == 1;
    std::printf("Fall 12: %d von 19 abgelösten zurück, verloren %u\n", einmal, a.kern->mixer().bk_verloren());
    PRUEF(einmal == 19);
    PRUEF(a.zurueck(b12[19]) == 0);
    PRUEF(a.kern->mixer().bk_verloren() == 0);
    for (int i = 0; i < 19; ++i) a.spaeter.push_back(b12[i]);

    // Fall 13: fx/2 is the hall, fx/5 does not exist: past the network the core rejects them and returns the graph
    CypherBk* g2 = graph(HALB);
    const int64_t i13 = a.graph_setzen("fx/2", g2);
    CypherBk* g5 = graph(HALB);
    const int64_t i13b = a.graph_setzen("fx/5", g5);
    a.zyklen(60 * N);
    PRUEF(a.abgelehnt(i13) == "ausserhalb_bereich");
    PRUEF(a.abgelehnt(i13b) == "ausserhalb_bereich");
    PRUEF(a.zurueck(g2) == 1);
    PRUEF(a.zurueck(g5) == 1);
    a.spaeter.push_back(g2);
    a.spaeter.push_back(g5);
  }

  // ---------------------------------------------------------------- S23 Fall 17: a plan of chained RAMPS on a graph knob (the live automation track)
  // The live track (page server POST /spur) sends its moves as /k/teil of one plan "spur:<name>", teil 0, 1, 2, each with
  // dauer_beats > 0, the next starting where the last ends. Cases 9 and 14..16 only SET knobs (dauer_beats 0). This pins that
  // ramps of a plan reach the graph too, block by block: linear moves 1 -> 0 (4 beats), 0 -> 1 (4 beats), 1 -> 0.7 (2 beats),
  // checked at the middle and at the end of each move against the gain the knob stands for. Negative control: the same
  // ramp on deck/3/bk/1 afterwards leaves deck/2 where it is.
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
    PRUEF(voll > 0.05f);   // positive control: the deck sounds in the master
    CypherBk* g1 = graph(REGLER_PEGEL);
    a.graph_setzen("deck/2", g1);
    const auto teil = [&](const char* pfad, double ab, double dauer, float nach, int nr, const char* plan) {
      cdj::Befehl t = a.neu(cdj::Befehl::TEIL, "pruefstand");
      std::snprintf(t.pfad, sizeof t.pfad, "%s", pfad);
      std::snprintf(t.plan, sizeof t.plan, "%s", plan);
      t.ab_beat = ab;
      t.dauer_beats = dauer;
      t.wert = nach;
      t.form = 0;      // linear, so the middle of a move is the middle value
      t.politik = 0;   // music: a late part is dropped, as the live track sends it
      t.nr = nr;
      return a.sende(t);
    };
    const int64_t s0 = teil("deck/2/bk/1", 11.0, 0.0, 1.0f, 0, "");   // knob 1 before the track (a set)
    const int64_t m0 = teil("deck/2/bk/1", 12.0, 4.0, 0.0f, 0, "spur:t");
    const int64_t m1 = teil("deck/2/bk/1", 16.0, 4.0, 1.0f, 1, "spur:t");
    const int64_t m2 = teil("deck/2/bk/1", 20.0, 2.0, 0.7f, 2, "spur:t");
    // gain at a sample, short window around it (ramp 1/90000 per sample: +-750 samples move the gain by 0.8 %)
    const auto gewinn = [&](double beat) {
      a.zyklen(static_cast<int64_t>(beat * SPB) + 1000);
      return db(a.spitze(static_cast<int64_t>(beat * SPB) - 750, static_cast<int64_t>(beat * SPB) + 750), voll);
    };
    const double g_vor = gewinn(11.5);   // the set to 1
    const double g_m0 = gewinn(14.0);    // middle of 1 -> 0
    const double g_e0 = gewinn(16.0);    // end of the first move: 0
    const double g_m1 = gewinn(18.0);    // middle of 0 -> 1
    const double g_e1 = gewinn(20.0);    // end of the second move: 1
    const double g_m2 = gewinn(21.0);    // middle of 1 -> 0.7: 0.85
    const double g_e2 = gewinn(23.0);    // after the third move: 0.7
    std::printf("Fall 17: 1.0 -> %.2f dB | 1->0 middle %.2f dB (soll -6,02), end %.2f dB (soll < -30) | 0->1 middle %.2f dB (soll -6,02), end %.2f dB (soll 0) | 1->0.7 middle %.2f dB (soll -1,41), after %.2f dB (soll -3,10)\n",
                g_vor, g_m0, g_e0, g_m1, g_e1, g_m2, g_e2);
    PRUEF(a.angenommen(s0) && a.angenommen(m0) && a.angenommen(m1) && a.angenommen(m2));   // the kern took every part, as in the live acknowledgement
    PRUEF(std::fabs(g_vor) < 0.3);
    PRUEF(std::fabs(g_m0 + 6.0206) < 0.5);
    PRUEF(g_e0 < -30.0);
    PRUEF(std::fabs(g_m1 + 6.0206) < 0.5);
    PRUEF(std::fabs(g_e1) < 0.3);
    PRUEF(std::fabs(g_m2 + 1.4116) < 0.4);
    PRUEF(std::fabs(g_e2 + 3.0980) < 0.3);
    // negative control: the same kind of ramp on another channel's knob leaves deck/2 at 0.7
    teil("deck/3/bk/1", 24.0, 2.0, 0.0f, 0, "spur:u");
    const double g_fremd = gewinn(26.5);
    std::printf("Fall 17: deck/3/bk/1 ramped to 0 -> deck/2 %.2f dB (soll -3,10)\n", g_fremd);
    PRUEF(std::fabs(g_fremd + 3.0980) < 0.3);
    a.spaeter.push_back(g1);
  }
  fs::remove_all(AB);
  PRUEF_ENDE();
}
