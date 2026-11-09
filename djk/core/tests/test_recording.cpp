// 1.8 Task 22: Modul Aufnahme. Einsatz und Ende kommen aus der Arrangement-Lage; der Abgriff ist bitgleich; Lücken-Zähler; Ablehnungen.
#include <cstring>
#include <vector>

#include "cypherdj/recording.h"
#include "check.h"

using cdj::Aufnahme;
using cdj::ArrLage;
using cdj::AufnahmeMeldung;
using cdj::RecSpur;
using cdj::RecMidi;
using cdj::MidiEinEreignis;

static float sig_l(int64_t s) { return 0.0001f * static_cast<float>(s % 9973 + 1); }
static float sig_r(int64_t s) { return -sig_l(s) * 0.5f; }

// Treiber: ein Block [s0, s0+m) mit dem Signal auf allen drei Abgriffen; verschiedene Vielfache, damit Verwechseln auffällt (erz/2 = Faktor 2)
static void block(Aufnahme& a, int64_t s0, int m, const ArrLage& lage) {
  std::vector<float> l[3], r[3];
  const float* tl[3];
  const float* tr[3];
  for (int k = 0; k < 3; ++k) {
    l[k].resize(m);
    r[k].resize(m);
    for (int i = 0; i < m; ++i) { l[k][i] = sig_l(s0 + i) * (k + 1); r[k][i] = sig_r(s0 + i) * (k + 1); }
    tl[k] = l[k].data();
    tr[k] = r[k].data();
  }
  a.block(s0, m, lage, tl, tr);
}
// alle Chunks einer Spur einsammeln
static std::vector<cdj::AufnahmeChunk> leere(RecSpur* p) {
  std::vector<cdj::AufnahmeChunk> v;
  cdj::AufnahmeChunk c;
  while (p->ring.hole(c)) v.push_back(c);
  return v;
}

// 1.8 S2a: one take of 512 frames from the start (Einsatz 0, planned stop 512, no tail) on the given tracks; el/er are the external pairs ein_1..4 of the
// sub-block (nullptr = no port). Returns the frames of every track by spur number (index spur - 1) after the take has ended.
struct Roh { std::vector<float> l, r; bool ende = false; int64_t ende_s = -1; };
static void nimm_ext(const std::vector<RecSpur*>& spuren, const float* const* el, const float* const* er, Roh* aus /* [ARR_SPUREN] */, int64_t nachlauf = 0) {
  Aufnahme a;
  for (RecSpur* p : spuren) PRUEF(a.setze(p->spur, p) == nullptr);
  static const std::vector<float> still(512, 0.0f);
  const float* tl[cdj::REC_ABGRIFFE];
  const float* tr[cdj::REC_ABGRIFFE];
  for (int k = 0; k < cdj::REC_ABGRIFFE; ++k) { tl[k] = still.data(); tr[k] = still.data(); }
  PRUEF(a.starte(1, 1, static_cast<int32_t>(nachlauf), false, 0, ArrLage{0, -1, -1, -1}) == nullptr);
  const float* el2[4];   // the second sub-block reads the pairs from frame 256 on (the pointers are offset to the sub-block, like the core does)
  const float* er2[4];
  for (int k = 0; k < 4; ++k) { el2[k] = el[k] ? el[k] + 256 : nullptr; er2[k] = er[k] ? er[k] + 256 : nullptr; }
  a.block(0, 256, ArrLage{2, 0, -1, -1}, tl, tr, el, er);
  a.block(256, 256, ArrLage{2, 0, -1, 512}, tl, tr, el2, er2);
  AufnahmeMeldung m{};
  while (a.hole_meldung(m)) {}
  for (RecSpur* p : spuren) {
    Roh& o = aus[p->spur - 1];
    o.ende = p->phase.load() == 2;
    o.ende_s = p->ende_s;
    for (const cdj::AufnahmeChunk& c : leere(p))
      for (int i = 0; i < c.n; ++i) { o.l.push_back(c.l[i]); o.r.push_back(c.r[i]); }
  }
}

int main() {
  Aufnahme a;
  RecSpur* p1 = RecSpur::neu(1, 12);   // erz/2
  RecSpur* p2 = RecSpur::neu(5, 11);   // erz/1
  PRUEF(a.setze(1, p1) == nullptr && a.setze(5, p2) == nullptr && a.scharf() == 2);
  ArrLage steht{0, -1, -1, -1};
  {  // Ablehnungen
    Aufnahme leer;
    PRUEF(std::strcmp(leer.starte(1, 7, 0, false, 100, steht), "kein_eingang") == 0);
    PRUEF(std::strcmp(a.starte(1, 7, 0, false, 100, ArrLage{2, 50, -1, -1}), "ueberlappung") == 0);   // Transport läuft schon
  }
  PRUEF(a.starte(1, 7, 0, false, 100, steht) == nullptr && a.status() == 2);
  PRUEF(std::strcmp(a.starte(2, 8, 0, false, 100, steht), "aufnahme_laeuft") == 0);
  // 3 Blöcke, in denen das Arrangement wartet; kein Chunk
  block(a, 256, 256, ArrLage{1, 1000, -1, -1});
  block(a, 512, 256, ArrLage{1, 1000, -1, -1});
  PRUEF(leere(p1).empty() && leere(p2).empty() && a.status() == 2);
  // Einsatz bei 1000 im Block [768, 1024): der Take beginnt EXAKT bei 1000
  block(a, 768, 256, ArrLage{2, 1000, -1, -1});
  AufnahmeMeldung m{};
  PRUEF(a.hole_meldung(m) && m.art == AufnahmeMeldung::EINSATZ && m.id == 1 && m.sample == 1000);
  PRUEF(a.status() == 3 && p1->phase.load() == 1 && p1->start_s == 1000 && p1->kennung == 7);
  // weiter bis 3000, Stopp geplant bei 2500 (Quant), Ende des Arrangements bei 2500
  for (int64_t s = 1024; s < 3072; s += 256)   // das Arrangement stoppt bei 2500: bis dahin spielt es mit geplantem Stopp, danach steht es und hat bei 2500 geendet
    block(a, s, 256, s + 256 <= 2500 ? ArrLage{2, 1000, -1, 2500} : ArrLage{0, 1000, 2500, -1});
  PRUEF(a.hole_meldung(m) && m.art == AufnahmeMeldung::ENDE && m.id == 1 && m.sample == 2500);
  PRUEF(a.status() == 0 && p1->phase.load() == 2 && p1->ende_s == 2500);
  PRUEF(!a.aendern_erlaubt());   // m1: der Callback ist fertig (status 0), der Faden hat die Datei noch nicht geschlossen (phase 2): kein Wechsel der Spuren
  // Inhalt: erste Sample 1000, letztes 2499, bitgleich; erz/2 (Faktor 2) auf p1, erz/1 (Faktor 1) auf p2
  const std::vector<cdj::AufnahmeChunk> c1 = leere(p1), c2 = leere(p2);
  int64_t frames = 0;
  bool gleich = !c1.empty() && c1.front().s0 == 1000;
  int64_t naechstes = 1000;
  for (const cdj::AufnahmeChunk& c : c1) {
    gleich = gleich && c.s0 == naechstes;
    for (int i = 0; i < c.n; ++i) gleich = gleich && c.l[i] == sig_l(c.s0 + i) * 2 && c.r[i] == sig_r(c.s0 + i) * 2;
    naechstes = c.s0 + c.n;
    frames += c.n;
  }
  PRUEF(gleich && frames == 1500 && naechstes == 2500);
  PRUEF(!c2.empty() && c2.front().l[0] == sig_l(1000) * 1);   // die zweite Spur hört einen anderen Abgriff
  // Negativ-Kontrolle: nichts außerhalb [1000, 2500) im Ring, und ein zweiter Block nach dem Ende schreibt nichts mehr
  block(a, 3072, 256, steht);
  PRUEF(leere(p1).empty());
  // Abbruch vor dem Einsatz: Stopp-Befehl (ABBRUCH, kein Chunk); Frist; Cypher-KI-Stopp nur für wartende Starts von cypher
  PRUEF(p1->phase.load() == 2);   // bleibt, bis der Faden 3 setzt
  p1->phase.store(3);
  p2->phase.store(3);
  PRUEF(a.aendern_erlaubt());   // Negativ-Kontrolle zu m1: der Faden ist fertig, jetzt geht es wieder
  PRUEF(a.starte(3, 9, 0, true, 5000, steht) == nullptr);
  a.ki_stopp(5100);
  PRUEF(a.hole_meldung(m) && m.art == AufnahmeMeldung::ABBRUCH && m.id == 3 && std::strcmp(m.grund, "ki_stopp") == 0 && a.status() == 0);
  PRUEF(a.starte(4, 10, 0, false, 6000, steht) == nullptr);
  a.ki_stopp(6100);   // wartender Start von Andreas bleibt
  PRUEF(a.status() == 2 && !a.hole_meldung(m));
  a.stopp(6200);
  PRUEF(a.hole_meldung(m) && m.art == AufnahmeMeldung::ABBRUCH && m.id == 4 && std::strcmp(m.grund, "abbruch") == 0 && a.status() == 0);
  // Frist: kein Transportstart innerhalb von 2 s (96000 Samples) beendet den wartenden Start
  PRUEF(a.starte(5, 11, 0, false, 10000, steht) == nullptr);
  block(a, 10256, 256, steht);   // noch innerhalb der Frist: bleibt
  PRUEF(a.status() == 2);
  block(a, 10000 + 96000, 256, steht);
  PRUEF(a.hole_meldung(m) && m.art == AufnahmeMeldung::ABBRUCH && m.id == 5 && a.status() == 0);
  // M1 (Nachbesserung 1): die Frist endet, sobald das Arrangement wartet. Frist 48000; das Arrangement wartet auf einen Einsatz weit dahinter (Quant)
  PRUEF(a.starte(7, 13, 0, false, 300000, steht, 48000) == nullptr);
  block(a, 300256, 256, ArrLage{1, 500000, -1, -1});                    // wartet: gesehen
  block(a, 300000 + 48000 + 256, 256, ArrLage{1, 500000, -1, -1});      // hinter der Frist, das Arrangement wartet noch
  PRUEF(a.status() == 2 && !a.hole_meldung(m));
  block(a, 499968, 256, ArrLage{2, 500000, -1, -1});                    // Einsatz bei 500000
  PRUEF(a.hole_meldung(m) && m.art == AufnahmeMeldung::EINSATZ && m.sample == 500000 && a.status() == 3);
  block(a, 500224, 256, ArrLage{0, 500000, 500256, -1});                // das Arrangement endet bei 500256
  PRUEF(a.hole_meldung(m) && m.art == AufnahmeMeldung::ENDE && m.sample == 500256 && a.status() == 0);
  PRUEF(leere(p1).size() == 1 && leere(p2).size() == 1);                // 224 + 32 Frames, am Ende als EIN Chunk ausgeschoben
  p1->phase.store(3);
  p2->phase.store(3);
  // Negativ-Kontrolle: die kürzere Frist gilt, solange nichts wartet
  PRUEF(a.starte(8, 14, 0, false, 600000, steht, 48000) == nullptr);
  block(a, 600000 + 48000 - 256, 256, steht);
  PRUEF(a.status() == 2);
  block(a, 600000 + 48000, 256, steht);
  PRUEF(a.hole_meldung(m) && m.art == AufnahmeMeldung::ABBRUCH && m.id == 8 && std::strcmp(m.grund, "zu_spaet") == 0);
  {  // Review-Nachzug Teil B (MAJOR 1, Spec 1.8 F2 „ein Durchgang“): mit Loop-Klammer endet der Take am ERSTEN Wrap, nicht erst am Stopp
    PRUEF(a.starte(9, 15, 0, false, 700000, steht) == nullptr);
    block(a, 700000, 256, ArrLage{2, 700100, -1, -1, 500});   // Einsatz bei 700100; die Naht 500 stammt von einem früheren Lauf und liegt vor dem Einsatz: kein Ende
    PRUEF(a.status() == 3);
    for (int64_t s = 700256; s < 701024; s += 256) block(a, s, 256, ArrLage{2, 700100, -1, -1, 500});
    PRUEF(a.status() == 3);
    block(a, 701024, 256, ArrLage{2, 700100, -1, -1, 701200});   // der Wrap liegt im Block [701024, 701280) bei 701200
    PRUEF(a.status() == 0);
    AufnahmeMeldung nm{};
    bool ende = false;
    while (a.hole_meldung(nm)) ende = ende || (nm.art == AufnahmeMeldung::ENDE && nm.id == 9 && nm.sample == 701200);
    PRUEF(ende);
    PRUEF(p1->phase.load() == 2 && p1->ende_s == 701200);
    int64_t n = 0;
    for (const cdj::AufnahmeChunk& c : leere(p1)) n += c.n;
    PRUEF(n == 701200 - 700100);   // genau ein Durchgang: vom Einsatz bis zur Naht, je ±0
    leere(p2);
    p1->phase.store(3);
    p2->phase.store(3);
  }
  {  // 1.8 S2a (D14): external slots and the channel mode. Source L = impulse 0.5 at frame 100, R = silence.
    std::vector<float> L(512, 0.0f), R(512, 0.0f);
    L[100] = 0.5f;
    const float* el[4] = {L.data(), nullptr, nullptr, nullptr};
    const float* er[4] = {R.data(), nullptr, nullptr, nullptr};
    auto lauf = [&](int modus, Roh* o) {
      RecSpur* p = RecSpur::neu(1, 1);
      p->modus = static_cast<int8_t>(modus);
      nimm_ext({p}, el, er, o);
      RecSpur::frei(p);
    };
    auto gleich = [&](const Roh& o, const std::vector<float>& el_, const std::vector<float>& er_) {
      bool ok = o.l.size() == 512 && o.r.size() == 512;
      for (size_t i = 0; ok && i < 512; ++i) ok = o.l[i] == el_[i] && o.r[i] == er_[i];   // sample for sample, residual exactly 0
      return ok;
    };
    const std::vector<float> nullen(512, 0.0f);
    std::vector<float> halb(512, 0.0f);
    halb[100] = 0.25f;
    Roh o[cdj::ARR_SPUREN];
    lauf(0, o);
    PRUEF(gleich(o[0], L, R) && o[0].l[100] == 0.5f && o[0].r[100] == 0.0f);   // stereo: L to L, R to R
    PRUEF(o[0].ende && o[0].ende_s == 512);
    for (Roh& x : o) x = Roh{};
    lauf(1, o);
    PRUEF(gleich(o[0], L, L));   // links: L to both
    for (Roh& x : o) x = Roh{};
    lauf(2, o);
    PRUEF(gleich(o[0], nullen, nullen));   // rechts: R (silent) to both; silence is valid content, the take is complete
    PRUEF(o[0].ende && o[0].ende_s == 512 && o[0].l.size() == 512);
    for (Roh& x : o) x = Roh{};
    lauf(3, o);
    PRUEF(gleich(o[0], halb, halb));   // summe: 0.5 * (L + R) to both
    PRUEF(o[0].l[100] == 0.25f);       // negative control of the test itself: the impulse is half, so a sum without 0.5 (0.5) cannot pass
    // L = R = 0.5 constant: summe keeps a centred source at its level (D14), stereo as well
    std::vector<float> C(512, 0.5f);
    const float* elc[4] = {C.data(), nullptr, nullptr, nullptr};
    const float* erc[4] = {C.data(), nullptr, nullptr, nullptr};
    for (int modus : {3, 0}) {
      RecSpur* p = RecSpur::neu(1, 1);
      p->modus = static_cast<int8_t>(modus);
      for (Roh& x : o) x = Roh{};
      nimm_ext({p}, elc, erc, o);
      RecSpur::frei(p);
      PRUEF(gleich(o[0], C, C));
    }
    // general signal: the mode is applied to every sample, exactly the float expression 0.5f * (l + r)
    std::vector<float> G(512), H(512), S(512);
    for (int i = 0; i < 512; ++i) { G[i] = sig_l(i + 7); H[i] = sig_r(i + 3) * 3.0f; S[i] = (G[i] + H[i]) * 0.5f; }
    const float* elg[4] = {nullptr, G.data(), nullptr, nullptr};   // pair 2
    const float* erg[4] = {nullptr, H.data(), nullptr, nullptr};
    {
      RecSpur* p = RecSpur::neu(2, 2);
      p->modus = 3;
      for (Roh& x : o) x = Roh{};
      nimm_ext({p}, elg, erg, o);
      RecSpur::frei(p);
      PRUEF(gleich(o[1], S, S));
    }
    // a missing pair (nullptr) records zeros without a crash; a neighbouring track on a present pair and an internal track in the same take are untouched
    {
      RecSpur* pa = RecSpur::neu(1, 1);      // pair 1: present
      RecSpur* pb = RecSpur::neu(2, 3);      // pair 3: no port
      RecSpur* pc = RecSpur::neu(3, 11);     // internal erz/1: bit identical to the tap, modus ignored
      pc->modus = 3;
      for (Roh& x : o) x = Roh{};
      nimm_ext({pa, pb, pc}, el, er, o);
      RecSpur::frei(pa); RecSpur::frei(pb); RecSpur::frei(pc);
      PRUEF(gleich(o[0], L, R));
      PRUEF(gleich(o[1], nullen, nullen) && o[1].ende && o[1].ende_s == 512);
      PRUEF(gleich(o[2], nullen, nullen));   // the internal tap of this fixture is silence: stereo path, not the sum of an external pair
    }
  }
  {  // 1.8 S2a.4 (D10): the take runs on for nachlauf samples behind the loop seam; nachlauf 0 keeps Andreas' "A" (end exactly at the seam)
    for (int32_t nachlauf : {0, 300, 480}) {
      Aufnahme b;
      RecSpur* q = RecSpur::neu(2, 11);
      PRUEF(b.setze(2, q) == nullptr);
      PRUEF(b.starte(11, 21, nachlauf, false, 0, steht) == nullptr);
      const int64_t einsatz = 100, naht = 1200;
      for (int64_t s0 = 0; s0 < 1024; s0 += 256) block(b, s0, 256, ArrLage{2, einsatz, -1, -1, -1});
      PRUEF(b.status() == 3);
      block(b, 1024, 256, ArrLage{2, einsatz, -1, -1, naht});   // the seam lies in [1024, 1280)
      PRUEF(nachlauf == 0 ? b.status() == 0 : b.status() == 4);   // with a tail the take is still open behind the seam
      AufnahmeMeldung nm{};
      PRUEF(!(nachlauf > 0 && b.hole_meldung(nm) && nm.art == AufnahmeMeldung::ENDE));   // no end receipt before the tail is over (EINSATZ may be pending)
      for (int64_t s0 = 1280; b.status() != 0 && s0 < 4000; s0 += 256) block(b, s0, 256, ArrLage{2, einsatz, -1, -1, naht});
      PRUEF(b.status() == 0 && q->phase.load() == 2);
      PRUEF(q->ende_s == naht + nachlauf);   // the seam plus the tail, to the sample
      bool ende = false;
      while (b.hole_meldung(nm)) ende = ende || (nm.art == AufnahmeMeldung::ENDE && nm.id == 11 && nm.sample == naht + nachlauf);
      PRUEF(ende);
      int64_t n = 0, nxt = einsatz;
      bool gleich = true;
      for (const cdj::AufnahmeChunk& c : leere(q)) {
        gleich = gleich && c.s0 == nxt;
        for (int i = 0; i < c.n; ++i) gleich = gleich && c.l[i] == sig_l(c.s0 + i);   // bit identical across the seam
        nxt = c.s0 + c.n;
        n += c.n;
      }
      PRUEF(gleich && n == naht + nachlauf - einsatz);
      RecSpur::frei(q);
    }
  }
  {  // 1.8 S4a.3 (D8): a take starts inside a RUNNING transport at ab_sample. Without ab_sample the old ueberlappung stays (negative control).
    const int64_t ab = 3000;
    {
      Aufnahme b;
      RecSpur* q = RecSpur::neu(2, 11);
      PRUEF(b.setze(2, q) == nullptr);
      const ArrLage laeuft{2, 1000, -1, -1, -1};
      PRUEF(std::strcmp(b.starte(31, 41, 0, false, 2000, laeuft), "ueberlappung") == 0);            // no ab_sample: refused as before
      PRUEF(b.starte(31, 41, 0, false, 2000, laeuft, 0, ab) == nullptr && b.status() == 2);
      for (int64_t s0 = 2048; s0 < 2816; s0 += 256) block(b, s0, 256, laeuft);                       // behind the command, before ab: waits
      PRUEF(b.status() == 2 && q->phase.load() == 0);
      AufnahmeMeldung nm{};
      PRUEF(!b.hole_meldung(nm));
      block(b, 2816, 256, laeuft);                                                                   // [2816, 3072) holds ab
      PRUEF(b.status() == 3 && q->start_s == ab);                                                    // started AT ab, not at the block start 2816
      PRUEF(b.hole_meldung(nm) && nm.art == AufnahmeMeldung::EINSATZ && nm.id == 31 && nm.sample == ab);
      b.stopp(3200);                                                                                  // /k/rec/stopp: only the recording ends
      block(b, 3072, 256, laeuft);
      PRUEF(b.status() == 0 && q->ende_s == 3200);
      int64_t n = 0, nxt = ab;
      bool gleich = true;
      for (const cdj::AufnahmeChunk& c : leere(q)) {
        gleich = gleich && c.s0 == nxt;
        for (int i = 0; i < c.n; ++i) gleich = gleich && c.l[i] == sig_l(c.s0 + i);
        nxt = c.s0 + c.n;
        n += c.n;
      }
      PRUEF(gleich && n == 3200 - ab);
      RecSpur::frei(q);
    }
    {  // the transport stops before ab: the wait is abandoned (abbruch), nothing is recorded
      Aufnahme b;
      RecSpur* q = RecSpur::neu(2, 11);
      PRUEF(b.setze(2, q) == nullptr);
      PRUEF(b.starte(32, 42, 0, false, 2000, ArrLage{2, 1000, -1, -1, -1}, 0, ab) == nullptr);
      block(b, 2304, 256, ArrLage{2, 1000, -1, -1, -1});
      block(b, 2560, 256, ArrLage{0, 1000, 2600, -1, -1});
      AufnahmeMeldung nm{};
      PRUEF(b.status() == 0 && b.hole_meldung(nm) && nm.art == AufnahmeMeldung::ABBRUCH && std::strcmp(nm.grund, "abbruch") == 0);
      PRUEF(q->phase.load() == 0);
      RecSpur::frei(q);
    }
    {  // a stop of the recording while it waits for ab: abbruch; a planned stop of the transport at or before ab is refused (the take could never start)
      Aufnahme b;
      RecSpur* q = RecSpur::neu(2, 11);
      PRUEF(b.setze(2, q) == nullptr);
      PRUEF(std::strcmp(b.starte(33, 43, 0, false, 2000, ArrLage{2, 1000, -1, 2900, -1}, 0, ab), "ueberlappung") == 0);
      PRUEF(b.starte(33, 43, 0, false, 2000, ArrLage{2, 1000, -1, 3500, -1}, 0, ab) == nullptr);       // the stop is behind ab: fine
      b.stopp(2100);
      AufnahmeMeldung nm{};
      PRUEF(b.status() == 0 && b.hole_meldung(nm) && nm.art == AufnahmeMeldung::ABBRUCH);
      RecSpur::frei(q);
    }
    {  // ab_sample with a stopped transport is the slice 1 path (the arrangement starts after the command): ab is ignored
      Aufnahme b;
      RecSpur* q = RecSpur::neu(2, 11);
      PRUEF(b.setze(2, q) == nullptr);
      PRUEF(b.starte(34, 44, 0, false, 100, steht, 0, ab) == nullptr);
      block(b, 256, 256, ArrLage{1, 1000, -1, -1, -1});
      block(b, 1024, 256, ArrLage{2, 1000, -1, -1, -1});
      PRUEF(b.status() == 3 && q->start_s == 1000);   // at the einsatz of the arrangement, not at ab
      RecSpur::frei(q);
    }
    {  // a seam equal to the start sample does not end the take (the take began ON the seam); the next seam does, exactly one pass later
      Aufnahme b;
      RecSpur* q = RecSpur::neu(2, 11);
      PRUEF(b.setze(2, q) == nullptr);
      const int64_t pass = 1500;
      PRUEF(b.starte(35, 45, 0, false, 2000, ArrLage{2, 100, -1, -1, 1500}, 0, ab) == nullptr);
      block(b, 2816, 256, ArrLage{2, 100, -1, -1, ab});                // the wrap at ab lies in this block: seam == start
      PRUEF(b.status() == 3 && q->start_s == ab);
      for (int64_t s0 = 3072; s0 < ab + pass - 256; s0 += 256) block(b, s0, 256, ArrLage{2, 100, -1, -1, ab});
      PRUEF(b.status() == 3);                                           // still the old seam: no end
      block(b, 4352, 256, ArrLage{2, 100, -1, -1, ab + pass});         // [4352, 4608) holds the next seam 4500
      PRUEF(b.status() == 0 && q->ende_s == ab + pass);
      int64_t n = 0;
      for (const cdj::AufnahmeChunk& c : leere(q)) n += c.n;
      PRUEF(n == pass);                                                 // exactly one pass
      RecSpur::frei(q);
    }
  }
  // Ring voll: die abgelehnten Chunks werden gezählt
  PRUEF(a.starte(6, 12, 0, false, 200000, steht) == nullptr);
  block(a, 200256, 256, ArrLage{2, 200256, -1, -1});
  for (int i = 0; i < 600; ++i) block(a, 200512 + i * 256, 256, ArrLage{2, 200256, -1, -1});   // 600 Chunks ohne Leser: 512 passen
  PRUEF(a.luecken() > 0 && a.luecken() == p1->abgelehnt.load() + p2->abgelehnt.load());
  {  // m4 (Nachbesserung 1): kleine Teilblöcke füllen den Ring nicht schneller. 2000 Blöcke zu 64 Frames = 128 000 Frames passen in 512 Chunks zu 256 (131 072 Frames)
    Aufnahme b;
    RecSpur* q = RecSpur::neu(2, 12);
    PRUEF(b.setze(2, q) == nullptr);
    PRUEF(b.starte(1, 1, 0, false, 0, steht) == nullptr);
    const std::vector<float> l(64, 0.5f), r(64, -0.5f);
    const float* tl[3] = {l.data(), l.data(), l.data()};
    const float* tr[3] = {r.data(), r.data(), r.data()};
    for (int i = 0; i < 2000; ++i) b.block(64 + i * 64, 64, ArrLage{2, 64, -1, -1}, tl, tr);
    PRUEF(b.luecken() == 0);
    for (int i = 2000; i < 2100; ++i) b.block(64 + i * 64, 64, ArrLage{2, 64, -1, -1}, tl, tr);
    PRUEF(b.luecken() > 0);   // Negativ-Kontrolle: der Ring ist endlich, der Test kann einen Verlust sehen
    RecSpur::frei(q);
  }
  // ---- 1.8 T7a: MIDI recorder (eingang 30), bit per track, start rule, take window, status machine without any RecSpur ----
  const auto leere_midi = [](RecMidi* m) {
    std::vector<MidiEinEreignis> v;
    MidiEinEreignis e;
    while (m->ring.hole(e)) v.push_back(e);
    return v;
  };
  const auto ein = [](Aufnahme& b, int64_t s, uint8_t st, uint8_t d1, uint8_t d2) {
    const uint8_t d[3] = {st, d1, d2};
    b.midi(s, d, 3);
  };
  {  // bit set and cleared: bit = track nr - 1, the first RecMidi is adopted, a second one is handed back, the last disarm returns the adopted one
    Aufnahme b;
    RecMidi* m1 = RecMidi::neu();
    RecMidi* m2 = RecMidi::neu();
    PRUEF(b.midi_scharf() == 0 && b.midi_maske() == 0u && b.midi_spur() == nullptr);
    PRUEF(b.setze_midi(3, true, m1) == nullptr);
    PRUEF(b.midi_scharf() == 1 && b.midi_maske() == (1u << 2) && b.midi_spur() == m1 && b.scharf() == 0);   // no RecSpur, the audio count stays 0
    PRUEF(b.setze_midi(5, true, m2) == m2);                       // not adopted: the caller frees it
    PRUEF(b.midi_scharf() == 2 && b.midi_maske() == ((1u << 2) | (1u << 4)) && b.midi_spur() == m1);
    PRUEF(b.setze_midi(3, false, nullptr) == nullptr);            // another bit is still set: the recorder stays
    PRUEF(b.midi_scharf() == 1 && b.midi_maske() == (1u << 4) && b.midi_spur() == m1);
    PRUEF(b.setze_midi(5, false, nullptr) == m1);                 // last bit gone: the RecMidi comes back
    PRUEF(b.midi_scharf() == 0 && b.midi_maske() == 0u && b.midi_spur() == nullptr);
    PRUEF(b.setze_midi(0, true, m2) == m2 && b.setze_midi(cdj::ARR_SPUREN + 1, true, m2) == m2 && b.midi_scharf() == 0);   // out of range
    PRUEF(b.setze_midi(cdj::ARR_SPUREN, true, m2) == nullptr && b.midi_maske() == (1u << (cdj::ARR_SPUREN - 1)));   // the last track is bit 31
    PRUEF(b.setze_midi(cdj::ARR_SPUREN, false, nullptr) == m2);
    PRUEF(b.setze_midi(2, false, nullptr) == nullptr);            // clearing a bit that was never set changes nothing
    RecMidi::frei(m1);
    RecMidi::frei(m2);
  }
  {  // a run with only eingang 30 armed: no kein_eingang, status 2 -> 3 -> 0 without any RecSpur, the take window [start_s, ende_s) in the ring
    Aufnahme b;
    RecMidi* m = RecMidi::neu();
    PRUEF(b.setze_midi(4, true, m) == nullptr);
    PRUEF(b.starte(9, 70, 0, false, 100, steht) == nullptr && b.status() == 2);
    PRUEF(m->phase.load() == 0);
    // cycle 1 [256, 512): the arrangement waits; events of this cycle belong to no take
    b.midi_beginn();
    ein(b, 300, 0x90, 60, 100);
    block(b, 256, 256, ArrLage{1, 1000, -1, -1});
    PRUEF(b.status() == 2 && leere_midi(m).empty());
    // cycle 2 [768, 1024) holds the entry 1000: the events at 990 (before) and 1000, 1010 (from the start) arrive BEFORE the status changes (the core stamps first)
    b.midi_beginn();
    ein(b, 990, 0x90, 61, 100);
    ein(b, 1000, 0x90, 62, 90);
    ein(b, 1010, 0xB0, 1, 64);
    block(b, 768, 256, ArrLage{2, 1000, -1, -1});
    PRUEF(b.status() == 3 && m->phase.load() == 1 && m->start_s == 1000 && m->kennung == 70);
    // cycle 3 [1024, 1280): the transport stops at 1100 (the take ends there); the event at 1099 is in, 1100 and 1200 are out
    b.midi_beginn();
    ein(b, 1050, 0x80, 62, 0);
    ein(b, 1099, 0x90, 63, 80);
    ein(b, 1100, 0x80, 63, 0);
    ein(b, 1200, 0x90, 64, 70);
    block(b, 1024, 256, ArrLage{2, 1000, -1, 1100});
    PRUEF(b.status() == 0 && m->phase.load() == 2 && m->ende_s == 1100);
    const std::vector<MidiEinEreignis> v = leere_midi(m);
    PRUEF(v.size() == 4);
    if (v.size() == 4) {
      PRUEF(v[0].sample == 1000 && v[0].b[0] == 0x90 && v[0].b[1] == 62 && v[0].b[2] == 90 && v[0].n == 3);
      PRUEF(v[1].sample == 1010 && v[1].b[0] == 0xB0 && v[1].b[1] == 1 && v[1].b[2] == 64);
      PRUEF(v[2].sample == 1050 && v[2].b[0] == 0x80 && v[2].b[1] == 62);
      PRUEF(v[3].sample == 1099 && v[3].b[0] == 0x90 && v[3].b[1] == 63);
    }
    AufnahmeMeldung nm{};
    bool einsatz = false, ende = false;
    while (b.hole_meldung(nm)) { einsatz = einsatz || nm.art == AufnahmeMeldung::EINSATZ; ende = ende || (nm.art == AufnahmeMeldung::ENDE && nm.sample == 1100); }
    PRUEF(einsatz && ende);
    PRUEF(m->abgelehnt.load() == 0);
    PRUEF(!b.aendern_erlaubt());                 // the thread has not closed the take yet (phase 2)
    m->phase.store(3, std::memory_order_release);
    PRUEF(b.aendern_erlaubt());
    RecMidi::frei(b.setze_midi(4, false, nullptr));
  }
  {  // start rule: nothing armed at all still refuses kein_eingang; a MIDI bit alone is enough
    Aufnahme b;
    PRUEF(std::strcmp(b.starte(1, 1, 0, false, 100, steht), "kein_eingang") == 0 && b.status() == 0);
    RecMidi* m = RecMidi::neu();
    PRUEF(b.setze_midi(1, true, m) == nullptr);
    PRUEF(b.starte(1, 1, 0, false, 100, steht) == nullptr);
    b.stopp(100);
    PRUEF(b.status() == 0);                      // a waiting start is aborted by stop
    PRUEF(b.setze_midi(1, false, nullptr) == m);
    PRUEF(std::strcmp(b.starte(2, 2, 0, false, 100, steht), "kein_eingang") == 0);   // the bit is gone again
    RecMidi::frei(m);
  }
  {  // a mixed run: the audio take and the MIDI take begin and end on the same samples; the MIDI events are cut by the same window
    Aufnahme b;
    RecSpur* q = RecSpur::neu(1, 11);
    RecMidi* m = RecMidi::neu();
    PRUEF(b.setze(1, q) == nullptr && b.setze_midi(2, true, m) == nullptr);
    PRUEF(b.starte(3, 71, 0, false, 0, steht) == nullptr);
    b.midi_beginn();
    ein(b, 540, 0x90, 60, 99);
    block(b, 512, 256, ArrLage{2, 512, -1, -1});
    PRUEF(q->start_s == 512 && m->start_s == 512 && q->kennung == 71 && m->kennung == 71 && q->phase.load() == 1 && m->phase.load() == 1);
    b.midi_beginn();
    ein(b, 800, 0x80, 60, 0);
    ein(b, 1000, 0x90, 61, 99);   // behind the planned end
    block(b, 768, 256, ArrLage{2, 512, -1, 900});
    PRUEF(b.status() == 0 && q->ende_s == 900 && m->ende_s == 900 && q->phase.load() == 2 && m->phase.load() == 2);
    const std::vector<MidiEinEreignis> v = leere_midi(m);
    PRUEF(v.size() == 2 && v[0].sample == 540 && v[1].sample == 800);
    PRUEF(!b.aendern_erlaubt());
    q->phase.store(3, std::memory_order_release);
    PRUEF(!b.aendern_erlaubt());                 // the MIDI take is still open
    m->phase.store(3, std::memory_order_release);
    PRUEF(b.aendern_erlaubt());
    RecSpur::frei(b.setze(1, nullptr));
    RecMidi::frei(b.setze_midi(2, false, nullptr));
  }
  {  // what is recorded: note on, note off, control change on any channel; nothing else (pitch bend, program change, short or long messages), nothing without a bit
    Aufnahme b;
    RecMidi* m = RecMidi::neu();
    PRUEF(b.setze_midi(1, true, m) == nullptr);
    PRUEF(b.starte(4, 72, 0, false, 0, steht) == nullptr);
    b.midi_beginn();
    ein(b, 300, 0x93, 60, 100);       // channel 4
    ein(b, 301, 0xE0, 0, 64);         // pitch bend: not recorded
    ein(b, 302, 0xC0, 5, 0);          // program change: not recorded
    ein(b, 303, 0x8F, 60, 0);         // channel 16
    ein(b, 304, 0xBF, 7, 127);
    const uint8_t kurz[2] = {0x90, 60};
    b.midi(305, kurz, 2);             // two bytes: not recorded
    const uint8_t sysex[4] = {0xF0, 1, 2, 0xF7};
    b.midi(306, sysex, 4);
    block(b, 256, 256, ArrLage{2, 256, -1, -1});
    const std::vector<MidiEinEreignis> v = leere_midi(m);
    PRUEF(v.size() == 3 && v[0].sample == 300 && v[0].b[0] == 0x93 && v[1].sample == 303 && v[1].b[0] == 0x8F && v[2].sample == 304 && v[2].b[0] == 0xBF);
    b.stopp(300);
    b.midi_beginn();
    block(b, 512, 256, ArrLage{2, 256, -1, -1});
    PRUEF(b.status() == 0);
    m->phase.store(3, std::memory_order_release);
    RecMidi::frei(b.setze_midi(1, false, nullptr));
    Aufnahme c;   // no bit: the module keeps nothing, a run is refused anyway
    ein(c, 10, 0x90, 60, 100);
    PRUEF(std::strcmp(c.starte(1, 1, 0, false, 0, steht), "kein_eingang") == 0);
  }
  {  // a full ring counts (abgelehnt), a full cycle buffer counts too; the take goes on
    Aufnahme b;
    RecMidi* m = RecMidi::neu();
    PRUEF(b.setze_midi(1, true, m) == nullptr);
    PRUEF(b.starte(5, 73, 0, false, 0, steht) == nullptr);
    int64_t s0 = 256;
    for (int c = 0; c < 20; ++c, s0 += 256) {   // 20 cycles of 256 events = 5120 events into a ring of 4096 without a reader
      b.midi_beginn();
      for (int i = 0; i < 256; ++i) ein(b, s0 + i, 0xB0, 1, static_cast<uint8_t>(i & 127));
      block(b, s0, 256, ArrLage{2, 256, -1, -1});
    }
    PRUEF(m->abgelehnt.load() == 5120 - 4096 && b.status() == 3);
    const std::vector<MidiEinEreignis> v = leere_midi(m);
    PRUEF(v.size() == 4096 && v[0].sample == 256 && v[4095].sample == 256 + 4095);   // the first 4096 stay, the rest was refused
    b.midi_beginn();
    for (int i = 0; i < 300; ++i) ein(b, s0 + (i & 255), 0xB0, 1, 0);   // more than a cycle buffer holds (256): the rest counts as abgelehnt
    block(b, s0, 256, ArrLage{2, 256, -1, -1});
    PRUEF(m->abgelehnt.load() == 5120 - 4096 + 44 && leere_midi(m).size() == 256);
    b.stopp(s0 + 256);
    b.midi_beginn();
    block(b, s0 + 256, 256, ArrLage{0, 256, s0 + 300, -1});
    m->phase.store(3, std::memory_order_release);
    RecMidi::frei(b.setze_midi(1, false, nullptr));
  }
  RecSpur::frei(p1);
  RecSpur::frei(p2);
  PRUEF_ENDE();
}
