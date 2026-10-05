// Scheibe 08: der Befehlsweg im Callback ohne JACK (Kern::zyklus). Quittungen je Befehl nach §5.1, Ziel-Samples nach
// §1.3, Verspätung nach §16.1, Storno nach §4.2, Karte voll nach §1.3; keine Allokation im Zyklus (ADR 002).
#include <cstdlib>
#include <cstring>
#include <new>
#include <vector>

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

struct Stand {
  cdj_ring_kopf* ring;
  cdj::Befehlsring* bef = new cdj::Befehlsring();
  cdj::Ereignisring* ere = new cdj::Ereignisring();
  cdj::Kern* kern;
  std::vector<cdj::Ereignis> q;     // alle Quittungen
  std::vector<cdj::Ereignis> takt;  // alle /takt
  Stand() {
    ring = (cdj_ring_kopf*)std::aligned_alloc(64, CDJ_RING_BYTES);
    std::memset(ring, 0, CDJ_RING_BYTES);
    std::memcpy(ring->magic, "CDJB", 4);
    ring->version = CDJ_RING_VERSION; ring->rate = CDJ_RING_RATE; ring->kanaele = CDJ_RING_KANAELE;
    ring->cap = CDJ_RING_CAP;
    kern = new cdj::Kern(128.0, ring, bef, ere);
  }
  ~Stand() { delete kern; delete bef; delete ere; std::free(ring); }
  void befehl(int32_t art, int64_t id, double a = 0, double b = 0, double c = 0, int64_t ziel = 0) {
    cdj::Befehl x{};
    x.art = art; x.id = id; std::strcpy(x.quelle, "pruefstand");
    x.bpm = a; x.ab_beat = a; x.ziel_bpm = b; x.dauer_beats = c; x.ziel_id = ziel;
    bef->schiebe(x);
  }
  // Zyklen zu 256, bis das Kern-Sample bis erreicht; sammelt Quittungen und Takte
  void bis(int64_t s) {
    g_waechter = true;
    while (kern->sample() < s) {
      kern->zyklus(256, 0);
      cdj::Ereignis e;
      while (ere->hole(e)) {  // hole() allokiert nicht; push_back nur außerhalb des Wächters
        g_waechter = false;
        if (e.art == cdj::Ereignis::QUITTUNG) q.push_back(e);
        if (e.art == cdj::Ereignis::TAKT) takt.push_back(e);
        g_waechter = true;
      }
    }
    g_waechter = false;
  }
  std::vector<int> stati(int64_t id) const {
    std::vector<int> v;
    for (auto& e : q) if (e.id == id) v.push_back(e.status);
    return v;
  }
  const cdj::Ereignis* quittung(int64_t id, int status) const {
    for (auto& e : q) if (e.id == id && e.status == status) return &e;
    return nullptr;
  }
  int64_t takt_sample(int64_t nr) const {
    for (auto& e : takt) if (e.takt == nr) return e.sample;
    return -1;
  }
};

int main() {
  // 1) Negativ-Kontrolle: pünktliche Rampe -> genau angenommen, gestartet, fertig; Takte auf den Golden-Samples
  {
    Stand st;
    st.befehl(cdj::Befehl::SET_NEU, 1, 128.0);
    st.bis(2160000);  // Beat 96: 32 Beats Vorlauf
    st.befehl(cdj::Befehl::TEMPO_RAMPE, 2, 128.0, 132.0, 32.0);
    st.bis(4300000);
    PRUEF((st.stati(1) == std::vector<int>{1, 2}));
    PRUEF((st.stati(2) == std::vector<int>{1, 2, 3}));
    const cdj::Ereignis* g = st.quittung(2, 2);
    PRUEF(g && g->sample == 2880000);
    const cdj::Ereignis* f = st.quittung(2, 3);
    PRUEF(f && f->sample == 3588923);
    PRUEF(st.takt_sample(37) == 3237188);  // Beat 144
    PRUEF(st.takt_sample(41) == 3588923);  // Beat 160
    PRUEF(st.takt_sample(49) == 4287105);  // Beat 192
    for (auto& e : st.q) PRUEF(e.grund[0] == '\0');
  }
  // 2) zu spät: Rampe erreicht den Kern 10 Blöcke nach ihrem Start -> nur 5 (am Blockanfang) und 3, Ende-Beat 160
  {
    Stand st;
    st.befehl(cdj::Befehl::SET_NEU, 1, 128.0);
    st.bis(2880000 + 10 * 256);
    st.befehl(cdj::Befehl::TEMPO_RAMPE, 2, 128.0, 132.0, 32.0);
    st.bis(4300000);
    PRUEF((st.stati(2) == std::vector<int>{5, 3}));
    const cdj::Ereignis* v = st.quittung(2, 5);
    PRUEF(v && v->sample == 2880000 + 10 * 256);
    const cdj::Ereignis* f = st.quittung(2, 3);
    PRUEF(f != nullptr);
    if (f) PRUEF_NAH(f->beat, 160.0, 2.5e-5);  // ist_sample ganzzahlig: bis 0,5 Samples = 2,3e-5 Beats bei 132
  }
  // 3) Storno vor dem Start: Ziel 8, Storno selbst 1 und 2; Beat 96 bleibt bei 128 BPM (Sample 2 160 000)
  //    Storno einer laufenden Rampe: 6 zu_spaet, die Rampe läuft weiter
  {
    Stand st;
    st.befehl(cdj::Befehl::SET_NEU, 1, 128.0);
    st.bis(360000);
    st.befehl(cdj::Befehl::TEMPO_RAMPE, 2, 64.0, 132.0, 32.0);
    st.bis(720000);
    st.befehl(cdj::Befehl::STORNO, 3, 0, 0, 0, 2);
    st.bis(2200000);
    PRUEF((st.stati(2) == std::vector<int>{1, 8}));
    PRUEF((st.stati(3) == std::vector<int>{1, 2}));
    PRUEF(st.takt_sample(25) == 2160000);
    st.befehl(cdj::Befehl::TEMPO_RAMPE, 4, 128.0, 132.0, 32.0);
    st.bis(2880000 + 2560);
    st.befehl(cdj::Befehl::STORNO, 5, 0, 0, 0, 4);
    st.bis(3700000);
    PRUEF((st.stati(5) == std::vector<int>{6}));
    const cdj::Ereignis* a = st.quittung(5, 6);
    PRUEF(a && !std::strcmp(a->grund, "zu_spaet"));
    PRUEF((st.stati(4) == std::vector<int>{1, 2, 3}));
  }
  // 4) Überlappung: zweite Rampe im Zeitraum der ersten -> 6 ueberlappung
  {
    Stand st;
    st.befehl(cdj::Befehl::SET_NEU, 1, 128.0);
    st.bis(256);
    st.befehl(cdj::Befehl::TEMPO_RAMPE, 2, 64.0, 132.0, 32.0);
    st.befehl(cdj::Befehl::TEMPO_RAMPE, 3, 80.0, 136.0, 8.0);
    st.bis(1024);
    PRUEF((st.stati(3) == std::vector<int>{6}));
    const cdj::Ereignis* a = st.quittung(3, 6);
    PRUEF(a && !std::strcmp(a->grund, "ueberlappung"));
  }
  // 5) Karte voll: 62 Rampen Stoß an Stoß angenommen, die 63. bräuchte das 65. Segment -> 6 karte_voll
  {
    Stand st;
    st.befehl(cdj::Befehl::SET_NEU, 1, 128.0);
    st.bis(256);
    for (int i = 0; i < 63; ++i) st.befehl(cdj::Befehl::TEMPO_RAMPE, 10 + i, 8.0 + i, (i % 2) ? 128.0 : 129.0, 1.0);
    st.bis(1024);
    int angenommen = 0;
    for (int i = 0; i < 62; ++i) angenommen += (st.stati(10 + i) == std::vector<int>{1}) ? 1 : 0;
    PRUEF(angenommen == 62);
    PRUEF((st.stati(72) == std::vector<int>{6}));
    const cdj::Ereignis* a = st.quittung(72, 6);
    PRUEF(a && !std::strcmp(a->grund, "karte_voll"));
    PRUEF(st.kern->karte().anzahl() == cdj::MAX_SEGMENTE);
    PRUEF(st.kern->wartend() == 62);
  }
  // 6) /k/set/neu mit wartender Rampe: die Rampe endet mit 7 abbruch, dann 1 und 2 für /k/set/neu
  {
    Stand st;
    st.befehl(cdj::Befehl::SET_NEU, 1, 128.0);
    st.bis(256);
    st.befehl(cdj::Befehl::TEMPO_RAMPE, 2, 64.0, 132.0, 32.0);
    st.bis(512);
    st.befehl(cdj::Befehl::SET_NEU, 3, 124.0);
    st.bis(1024);
    PRUEF((st.stati(2) == std::vector<int>{1, 7}));
    const cdj::Ereignis* a = st.quittung(2, 7);
    PRUEF(a && !std::strcmp(a->grund, "abbruch"));
    PRUEF((st.stati(3) == std::vector<int>{1, 2}));
    PRUEF(st.kern->wartend() == 0);
  }
  // 7) Taktfelder im Audio-Ring (§6.1) nach einer Rampe, deren Segmente schon verworfen sind: Rampe 128 -> 132 ab
  //    Beat 128 über 30 Beats endet mitten im Takt 156..160. Soll aus einer Karte ohne Verwerfen (Referenz).
  {
    Stand st;
    st.befehl(cdj::Befehl::SET_NEU, 1, 128.0);
    st.bis(2160000);
    st.befehl(cdj::Befehl::TEMPO_RAMPE, 2, 128.0, 132.0, 30.0);
    cdj::Karte ref(128.0, 0);
    PRUEF(ref.rampe(128.0, 132.0, 30.0));
    auto s = [&](double b) { return (int64_t)std::llround(ref.sample_at(b)); };
    st.bis(s(159.0));  // im Takt 156..160, nach dem Ende der Rampe (Beat 158): ihre Segmente sind verworfen
    PRUEF(st.kern->karte().anzahl() == 1);
    PRUEF_NAH((double)cdj_lade(&st.ring->takt_anfang_w), (double)s(156.0), 0);
    PRUEF_NAH((double)cdj_lade(&st.ring->takt_frames), (double)(s(156.0) - s(152.0)), 0);
    st.bis(s(161.0));  // im Takt 160..164: der zuletzt vollendete Takt 156..160 lag halb in der Rampe
    PRUEF_NAH((double)cdj_lade(&st.ring->takt_anfang_w), (double)s(160.0), 0);
    PRUEF_NAH((double)cdj_lade(&st.ring->takt_frames), (double)(s(160.0) - s(156.0)), 0);
    st.bis(s(165.0));  // Negativ-Kontrolle: Takt 164..168, ganz konstant bei 132
    PRUEF_NAH((double)cdj_lade(&st.ring->takt_frames), (double)(s(164.0) - s(160.0)), 0);
  }
  PRUEF(g_allokationen == 0);
  PRUEF_ENDE();
}
