// Plan 2026-09-27 Task 5: Erzeuger-OSC im Netz (INTERFACES §4.8, ADR 024). /erz/strom kit:<name> lädt das Kit und
// reicht es als Zeiger weiter; Fehler als /q Status 6. Bundles /erz/fenster + /erz/ev werden als ein ErzFenster
// weitergereicht; Formfehler als /e/protokollfehler, nichts im Ring. ERZ_QUITTUNG wird /erz/quittung, ERZ_ALT frei.
#include <arpa/inet.h>
#include <netinet/in.h>
#include <poll.h>
#include <sys/socket.h>
#include <unistd.h>

#include <cmath>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <string>
#include <vector>

#include "cypherdj/cypher_bk_ffi.h"
#include "cypherdj/erzeuger.h"
#include "cypherdj/netz.h"
#include "cypherdj/stellwerk/regler.h"
#include "gegenstelle.h"
#include "pruef.h"

namespace v = cypherdj::osc;
namespace fs = std::filesystem;

static std::vector<char> bundle(std::initializer_list<const cdj::osc::Schreiber*> msgs) {
  std::vector<char> b(16, 0);
  std::memcpy(b.data(), "#bundle", 8);
  b[15] = 1;  // Zeitmarke 1 = sofort
  for (const auto* m : msgs) {
    const uint32_t n = htonl((uint32_t)m->groesse());
    const char* p = reinterpret_cast<const char*>(&n);
    b.insert(b.end(), p, p + 4);
    b.insert(b.end(), m->daten(), m->daten() + m->groesse());
  }
  return b;
}

static void strom(cdj::Netz& n, int64_t id, const char* ziel, const char* kanal) {
  cdj::osc::Schreiber s(v::erz_strom);
  s.h(id).s("erzeuger").i(1).s(ziel).s(kanal);
  n.paket(s.daten(), s.groesse());
}

int main() {
  const fs::path dir = fs::path("/dev/shm") / ("test_netz_erz_" + std::to_string(getpid()));
  fs::create_directories(dir / "gut");
  {
    const float d[4] = {0.5f, 0.5f, 0.25f, 0.25f};
    std::ofstream(dir / "gut/bd_0.f32", std::ios::binary).write(reinterpret_cast<const char*>(d), sizeof d);
    std::ofstream(dir / "gut/kit.json") << R"({"schema":1,"name":"gut","klaenge":[{"note":0,"name":"bd:0","datei":"bd_0.f32","frames":2}]})";
  }
  auto* bef = new cdj::Befehlsring();
  auto* ere = new cdj::Ereignisring();
  cdj::Befehl b;
  {
    cdj::Netz netz(0, false, bef, ere);
    netz.setze_kit_ordner(dir.string());
    Gegenstelle g;
    {
      cdj::osc::Schreiber s(v::k_hallo);
      s.s("x").i(g.port).i(1);
      netz.paket(s.daten(), s.groesse());
      PRUEF(g.warte("/k/willkommen", 200));
    }
    // 1. gutes Kit
    strom(netz, 51, "kit:gut", "erz/1");
    PRUEF(bef->hole(b) && b.art == cdj::Befehl::ERZ_STROM && b.id == 51 && b.nr == 1 && !std::strcmp(b.pfad, "erz/1"));
    if (b.zeiger) {
      const auto* k = static_cast<const cdj::Kit*>(b.zeiger);
      PRUEF(k->n == 1 && k->klang[0].frames == 2);
      delete k;
    }
    // 2. Kit fehlt → pruefung; 3. midi: noch nicht gebaut; 4. Kanal deck/1; 5. Name mit Pfad
    strom(netz, 52, "kit:fehlt", "erz/1");
    PRUEF(g.warte("/q", 200) && g.m.werte[0].h == 52 && g.m.werte[2].i == 6 && !std::strcmp(g.s(5), "pruefung"));
    // Studio S5.1 T2: midi:<port>:<kanal> wird angenommen (kein /q vom Netz; Quittung 1/3 kommt vom Kern): ein
    // ERZ_STROM-Befehl mit form = Port, politik = Kanal, ohne Kit; midi:5:1 (Port ausserhalb) → Status 6, kein Befehl.
    strom(netz, 53, "midi:1:1", "erz/1");
    {
      cdj::Befehl mb{};
      PRUEF(bef->hole(mb) && mb.art == cdj::Befehl::ERZ_STROM && mb.id == 53 && mb.form == 1 && mb.politik == 1 &&
            mb.zeiger == nullptr);
      PRUEF(!bef->hole(mb));
    }
    strom(netz, 57, "midi:5:1", "erz/1");
    PRUEF(g.warte("/q", 200) && g.m.werte[0].h == 57 && g.m.werte[2].i == 6 && !std::strcmp(g.s(5), "ausserhalb_bereich"));
    {
      cdj::Befehl mb{};
      PRUEF(!bef->hole(mb));
    }
    // Review-Kern m3: erz/8 ist der Nur-Cue-Vorhöreingang, ein Strom dort bliebe im Saal still → Status 6, kein Befehl
    strom(netz, 61, "kit:gut", "erz/8");
    PRUEF(g.warte("/q", 200) && g.m.werte[0].h == 61 && g.m.werte[2].i == 6 && !std::strcmp(g.s(5), "ausserhalb_bereich"));
    strom(netz, 62, "midi:1:1", "erz/8");
    PRUEF(g.warte("/q", 200) && g.m.werte[0].h == 62 && g.m.werte[2].i == 6);
    {
      cdj::Befehl mb{};
      PRUEF(!bef->hole(mb));
    }
    strom(netz, 63, "kit:gut", "erz/7");   // Negativ-Kontrolle: erz/7 wird weiter angenommen
    PRUEF(bef->hole(b) && b.art == cdj::Befehl::ERZ_STROM && b.id == 63);
    if (b.zeiger) delete static_cast<const cdj::Kit*>(b.zeiger);
    strom(netz, 54, "kit:gut", "deck/1");
    PRUEF(g.warte("/q", 200) && g.m.werte[0].h == 54 && g.m.werte[2].i == 6);
    strom(netz, 55, "kit:../gut", "erz/1");
    PRUEF(g.warte("/q", 200) && g.m.werte[0].h == 55 && g.m.werte[2].i == 6);
    PRUEF(!bef->hole(b));
    // Baukasten S3a: bk:<name> lädt <bk_ordner>/<name>.json, übersetzt im Netz-Faden; ERZ_STROM mit form = -1 und
    // zeiger = CypherBk*. Fehlt die Datei oder ist der Graph falsch → pruefung; Name mit Pfad → ausserhalb_bereich.
    {
      fs::create_directories(dir / "bk");
      std::ofstream(dir / "bk/saege.json") << R"({"format":"baukasten/2","name":"t","stimmen":1,"knoten":[{"id":"n","art":"note"},{"id":"s","art":"saege"},{"id":"o","art":"ausgang"}],"kanten":[{"von":"n.hz","nach":"s.hz"},{"von":"s.aus","nach":"o.x"}]})";
      std::ofstream(dir / "bk/kaputt.json") << R"({"format":"baukasten/2","name":"t","stimmen":1,"knoten":[{"id":"x","art":"gibtsnicht"}],"kanten":[]})";
      netz.setze_bk_ordner((dir / "bk").string());
      strom(netz, 71, "bk:saege", "erz/2");
      cdj::Befehl bb{};
      PRUEF(bef->hole(bb) && bb.art == cdj::Befehl::ERZ_STROM && bb.id == 71 && bb.form == -1 && bb.zeiger != nullptr);
      if (bb.zeiger) cypher_bk_frei(static_cast<CypherBk*>(const_cast<void*>(bb.zeiger)));
      strom(netz, 72, "bk:fehlt", "erz/2");
      PRUEF(g.warte("/q", 200) && g.m.werte[0].h == 72 && g.m.werte[2].i == 6 && !std::strcmp(g.s(5), "pruefung"));
      strom(netz, 73, "bk:kaputt", "erz/2");
      PRUEF(g.warte("/q", 200) && g.m.werte[0].h == 73 && g.m.werte[2].i == 6 && !std::strcmp(g.s(5), "pruefung"));
      strom(netz, 74, "bk:../saege", "erz/2");
      PRUEF(g.warte("/q", 200) && g.m.werte[0].h == 74 && g.m.werte[2].i == 6 && !std::strcmp(g.s(5), "ausserhalb_bereich"));
      PRUEF(!bef->hole(bb));   // keiner der Fehlerfälle reiht einen Befehl ein
      // ERZ_BK_ALT: der Netz-Faden gibt den Graphen frei (Weg wie ERZ_ALT in Fall 10, über den Ring; im normalen Bau nur
      // „kein Absturz“, das Leck sähe der Sanitizer-Bau)
      char f[64] = {};
      cdj::Ereignis x{};
      x.art = cdj::Ereignis::ERZ_BK_ALT;
      x.zeiger = cypher_bk_neu(R"({"format":"baukasten/2","name":"t","stimmen":1,"knoten":[{"id":"o","art":"ausgang"}],"kanten":[]})", 48000.0, f, sizeof f);
      PRUEF(x.zeiger != nullptr);
      PRUEF(ere->schiebe(x));
      netz.ereignisse_senden();
    }

    // Baukasten S3c: /k/kanal/graph ,hsss lädt <bk_ordner>/<name>.json im Netz-Faden und prüft: ein Effekt-Graph (eingang,
    // Latenz 0) wird als KANAL_GRAPH mit zeiger eingereiht; ein Instrument → kein_eingang, Limiter → pruefung (Latenz),
    // leerer Name → eingereiht mit zeiger null (entfernen), Kanal außerhalb deck/1..4 → ausserhalb_bereich.
    {
      const fs::path beispiele = fs::path(CYPHERDJ_DJK) / "instrumente/baukasten_dsp/beispiele";
      fs::copy_file(beispiele / "fx-echo-achtel.json", dir / "bk/fx-echo-achtel.json", fs::copy_options::overwrite_existing);
      fs::copy_file(beispiele / "juno-pad.json", dir / "bk/juno-pad.json", fs::copy_options::overwrite_existing);
      std::ofstream(dir / "bk/fx-limit.json") << R"({"format":"baukasten/2","name":"fx-limit","stimmen":1,"knoten":[{"id":"e","art":"eingang"},{"id":"lim","art":"limiter"},{"id":"o","art":"ausgang"}],"kanten":[{"von":"e.l","nach":"lim.l"},{"von":"e.r","nach":"lim.r"},{"von":"lim.l","nach":"o.l"},{"von":"lim.r","nach":"o.r"}]})";
      const auto graph = [&](int64_t id, const char* quelle, const char* kanal, const char* name) {
        cdj::osc::Schreiber s(v::k_kanal_graph);
        s.h(id).s(quelle).s(kanal).s(name);
        netz.paket(s.daten(), s.groesse());
      };
      cdj::Befehl kb{};
      graph(81, "andreas", "deck/2", "fx-echo-achtel");   // (1) Effekt-Graph: eingereiht
      PRUEF(bef->hole(kb) && kb.art == cdj::Befehl::KANAL_GRAPH && kb.id == 81 && kb.zeiger != nullptr &&
            !std::strcmp(kb.pfad, "deck/2") && !std::strcmp(kb.quelle, "andreas"));
      if (kb.zeiger) cypher_bk_frei(static_cast<CypherBk*>(const_cast<void*>(kb.zeiger)));
      graph(82, "andreas", "deck/2", "juno-pad");         // (2) Instrument: kein_eingang
      PRUEF(g.warte("/q", 200) && g.m.werte[0].h == 82 && g.m.werte[2].i == 6 && !std::strcmp(g.s(5), "kein_eingang"));
      graph(83, "andreas", "deck/2", "fx-limit");         // (3) Latenz > 0: pruefung
      PRUEF(g.warte("/q", 200) && g.m.werte[0].h == 83 && g.m.werte[2].i == 6 && !std::strcmp(g.s(5), "pruefung"));
      kb = cdj::Befehl{};
      graph(84, "cypher", "deck/3", "");                  // (4) leerer Name (und cypher darf): eingereiht, zeiger null
      PRUEF(bef->hole(kb) && kb.art == cdj::Befehl::KANAL_GRAPH && kb.id == 84 && kb.zeiger == nullptr &&
            !std::strcmp(kb.pfad, "deck/3") && !std::strcmp(kb.quelle, "cypher"));
      graph(85, "andreas", "deck/5", "fx-echo-achtel");   // (5) Kanal außerhalb: ausserhalb_bereich
      PRUEF(g.warte("/q", 200) && g.m.werte[0].h == 85 && g.m.werte[2].i == 6 && !std::strcmp(g.s(5), "ausserhalb_bereich"));
      graph(86, "andreas", "deck/1", "fehlt");            // Datei fehlt: pruefung
      PRUEF(g.warte("/q", 200) && g.m.werte[0].h == 86 && g.m.werte[2].i == 6 && !std::strcmp(g.s(5), "pruefung"));
      graph(87, "andreas", "deck/1", "../juno-pad");      // Name mit Pfad: ausserhalb_bereich
      PRUEF(g.warte("/q", 200) && g.m.werte[0].h == 87 && g.m.werte[2].i == 6 && !std::strcmp(g.s(5), "ausserhalb_bereich"));
      PRUEF(!bef->hole(kb));   // keiner der Fehlerfälle reiht einen Befehl ein
    }

    // S5r K2: die Regler <kanal>/bk/<1..8> der Stellwerk-Tabelle gibt es genau auf den Kanälen, auf denen der Kern einen
    // Baukasten-Graphen annimmt. Gemessen am echten Verhalten: für jeden Kanal der Tabelle ein Instrument-Graph über
    // /erz/strom (bk:) und ein Effekt-Graph über /k/kanal/graph; "angenommen" heißt, ein Befehl liegt im Ring.
    {
      cypherdj::stellwerk::ReglerTabelle tab;
      int angenommen = 0, mit_pfad = 0;
      int64_t id = 900;
      for (int k = 0; k < tab.kanaele(); k++) {
        const char* kanal = tab.kanal_name(k);
        bool nimmt = false;
        cdj::Befehl pb{};
        strom(netz, id++, "bk:saege", kanal);
        if (bef->hole(pb)) {
          nimmt = true;
          PRUEF(pb.art == cdj::Befehl::ERZ_STROM && pb.zeiger);
          if (pb.zeiger) cypher_bk_frei(static_cast<CypherBk*>(const_cast<void*>(pb.zeiger)));
        } else {
          PRUEF(g.warte("/q", 200) && g.m.werte[2].i == 6);
        }
        cdj::osc::Schreiber s(v::k_kanal_graph);
        s.h(id++).s("andreas").s(kanal).s("fx-echo-achtel");
        netz.paket(s.daten(), s.groesse());
        pb = cdj::Befehl{};
        if (bef->hole(pb)) {
          nimmt = true;
          PRUEF(pb.art == cdj::Befehl::KANAL_GRAPH && pb.zeiger);
          if (pb.zeiger) cypher_bk_frei(static_cast<CypherBk*>(const_cast<void*>(pb.zeiger)));
        } else {
          PRUEF(g.warte("/q", 200) && g.m.werte[2].i == 6);
        }
        char p[40];
        std::snprintf(p, sizeof p, "%s/bk/1", kanal);
        const bool hat_pfad = tab.suche(p) >= 0;
        if (hat_pfad != nimmt) std::fprintf(stderr, "bk-Pfade und Graph-Annahme weichen bei %s ab (Pfad %d, Annahme %d)\n", kanal, hat_pfad, nimmt);
        PRUEF(hat_pfad == nimmt);
        angenommen += nimmt;
        mit_pfad += hat_pfad;
      }
      PRUEF(angenommen == 12 && mit_pfad == 12);   // Positivkontrolle: es gibt Kanäle, die treffen (deck/1..4, 6 x erz, pad/1..2)
      PRUEF(angenommen < tab.kanaele());           // und Kanäle, die nicht treffen (erz/4, erz/8, bus, master, cue)
    }

    // MVP 2 Scheibe 3 (E2): kit:<a>+<b> verschmilzt; b fehlt → nur a; zwei '+' oder leerer Teil → ausserhalb_bereich
    fs::create_directories(dir / "rec");
    {
      const float d[2] = {0.75f, 0.75f};
      std::ofstream(dir / "rec/rec0_0.f32", std::ios::binary).write(reinterpret_cast<const char*>(d), sizeof d);
      std::ofstream(dir / "rec/kit.json") << R"({"schema":1,"name":"rec","klaenge":[{"note":112,"name":"rec0:0","datei":"rec0_0.f32","frames":1}]})";
    }
    b = cdj::Befehl{};
    strom(netz, 56, "kit:gut+rec", "erz/1");
    PRUEF(bef->hole(b) && b.art == cdj::Befehl::ERZ_STROM && b.id == 56 && b.zeiger);
    if (b.zeiger) {
      const auto* k = static_cast<const cdj::Kit*>(b.zeiger);
      PRUEF(k->n == 2 && k->klang[0].frames == 2 && k->klang[cdj::KIT_NOTEN + 112].frames == 1 && k->name == "gut+rec");
      delete k;
    }
    b = cdj::Befehl{};
    strom(netz, 57, "kit:gut+nochnicht", "erz/1");
    PRUEF(bef->hole(b) && b.id == 57 && b.zeiger);
    if (b.zeiger) {
      PRUEF(static_cast<const cdj::Kit*>(b.zeiger)->n == 1);
      delete static_cast<const cdj::Kit*>(b.zeiger);
    }
    strom(netz, 58, "kit:gut+rec+rec", "erz/1");
    PRUEF(g.warte("/q", 200) && g.m.werte[0].h == 58 && g.m.werte[2].i == 6 && !std::strcmp(g.s(5), "ausserhalb_bereich"));
    strom(netz, 59, "kit:gut+", "erz/1");
    PRUEF(g.warte("/q", 200) && g.m.werte[0].h == 59 && g.m.werte[2].i == 6 && !std::strcmp(g.s(5), "ausserhalb_bereich"));
    b = cdj::Befehl{};
    PRUEF(!bef->hole(b));
    // 6. gutes Bundle: Fenster [4, 12) mit zwei Ereignissen
    cdj::osc::Schreiber f(v::erz_fenster);
    f.i(1).i(9).i(66).i(0).d(4.0).d(12.0).h(0);
    cdj::osc::Schreiber e1(v::erz_ev);
    e1.i(1).i(3).i(1).i(0).d(8.0).d(0.25).f(1.0f);
    cdj::osc::Schreiber e2(v::erz_ev);
    e2.i(1).i(3).i(2).i(0).d(8.5).d(0.25).f(0.5f);
    const auto gut = bundle({&f, &e1, &e2});
    netz.paket(gut.data(), gut.size());
    PRUEF(bef->hole(b) && b.art == cdj::Befehl::ERZ_FENSTER && b.zeiger);
    if (b.zeiger) {
      const auto* fe = static_cast<const cdj::ErzFenster*>(b.zeiger);
      PRUEF(fe->strom == 1 && fe->sendung == 9 && fe->n == 2 && fe->ev[1].beat == 8.5 && fe->ev[1].velocity == 0.5f);
      delete fe;
    }
    // 7. Ereignis außerhalb des Fensters → protokoll, nichts im Ring
    cdj::osc::Schreiber e3(v::erz_ev);
    e3.i(1).i(3).i(3).i(0).d(12.0).d(0.25).f(1.0f);
    const auto draussen = bundle({&f, &e3});
    netz.paket(draussen.data(), draussen.size());
    PRUEF(g.warte("/e/protokollfehler", 200) && !std::strcmp(g.s(1), "protokoll"));
    PRUEF(!bef->hole(b));
    // 8. /erz/ev ohne Bundle → protokoll
    netz.paket(e1.daten(), e1.groesse());
    PRUEF(g.warte("/e/protokollfehler", 200) && !std::strcmp(g.s(0), "/erz/ev") && !std::strcmp(g.s(1), "protokoll"));
    // 9. Bundle, das mit /erz/ev beginnt → unbekannte_adresse
    const auto verkehrt = bundle({&e1});
    netz.paket(verkehrt.data(), verkehrt.size());
    PRUEF(g.warte("/e/protokollfehler", 200) && !std::strcmp(g.s(1), "unbekannte_adresse"));
    PRUEF(!bef->hole(b));
    // 11. Scheibe 3: Parameter-Schwanz (nr, wert). begin/end kommen an, ohne Schwanz gelten 0 und 1,
    //     eine unbekannte nr wird überlesen, zehn Paare (27 Werte) passen.
    {
      cdj::osc::Schreiber p1("/erz/ev", "iiiiddfifif");
      p1.i(1).i(3).i(4).i(0).d(8.0).d(0.25).f(1.0f).i(0).f(0.5f).i(1).f(0.75f);
      cdj::osc::Schreiber p2("/erz/ev", "iiiiddfif");
      p2.i(1).i(3).i(5).i(0).d(9.0).d(0.25).f(1.0f).i(7).f(3.0f);
      const std::string t3 = std::string("iiiiddf") + "ifififififififififif";  // zehn Paare
      cdj::osc::Schreiber p3("/erz/ev", t3.c_str());
      p3.i(1).i(3).i(6).i(0).d(10.0).d(0.25).f(1.0f);
      for (int k = 0; k < 9; ++k) p3.i(9).f(1.0f);
      p3.i(0).f(0.25f);
      PRUEF(p1.ok() && p2.ok() && p3.ok());
      const auto mit = bundle({&f, &e1, &p1, &p2, &p3});
      netz.paket(mit.data(), mit.size());
      b = cdj::Befehl{};  // kein alter Zeiger aus Fall 6, falls hole() scheitert
      PRUEF(bef->hole(b) && b.art == cdj::Befehl::ERZ_FENSTER && b.zeiger);
      if (b.zeiger) {
        const auto* fe = static_cast<const cdj::ErzFenster*>(b.zeiger);
        PRUEF(fe->n == 4);
        PRUEF(fe->ev[0].begin == 0.0f && fe->ev[0].end == 1.0f);
        PRUEF(fe->ev[1].begin == 0.5f && fe->ev[1].end == 0.75f);
        PRUEF(fe->ev[2].begin == 0.0f && fe->ev[2].end == 1.0f);
        PRUEF(fe->ev[3].begin == 0.25f && fe->ev[3].end == 1.0f);
        delete fe;
      }
    }
    // 12. halber Schwanz (nr ohne wert) → falsche_typen, nichts im Ring
    {
      cdj::osc::Schreiber h("/erz/ev", "iiiiddfi");
      h.i(1).i(3).i(7).i(0).d(8.0).d(0.25).f(1.0f).i(0);
      const auto halb = bundle({&f, &h});
      netz.paket(halb.data(), halb.size());
      PRUEF(g.warte("/e/protokollfehler", 200) && !std::strcmp(g.s(1), "falsche_typen"));
      PRUEF(!bef->hole(b));
    }
    // 13. begin nicht endlich → protokoll
    {
      cdj::osc::Schreiber n("/erz/ev", "iiiiddfif");
      n.i(1).i(3).i(8).i(0).d(8.0).d(0.25).f(1.0f).i(0).f(std::nanf(""));
      const auto nan = bundle({&f, &n});
      netz.paket(nan.data(), nan.size());
      PRUEF(g.warte("/e/protokollfehler", 200) && !std::strcmp(g.s(1), "protokoll"));
      PRUEF(!bef->hole(b));
    }
    // 14. (Abschluss-Review Scheibe 3 Fund 7) unbekannte nr mit NaN wird überlesen; begin = +Inf gilt (der Kern klemmt
    //     beim Spielen), nur NaN bei einem bekannten Parameter ist ein Formfehler.
    {
      cdj::osc::Schreiber u("/erz/ev", "iiiiddfifif");
      u.i(1).i(3).i(9).i(0).d(8.0).d(0.25).f(1.0f).i(9).f(std::nanf("")).i(0).f(INFINITY);
      const auto paket_u = bundle({&f, &u});
      netz.paket(paket_u.data(), paket_u.size());
      b = cdj::Befehl{};
      PRUEF(bef->hole(b) && b.art == cdj::Befehl::ERZ_FENSTER && b.zeiger);
      if (b.zeiger) {
        const auto* fe = static_cast<const cdj::ErzFenster*>(b.zeiger);
        PRUEF(fe->n == 1 && std::isinf(fe->ev[0].begin));
        delete fe;
      }
    }
    // 15. F08 (Glanz 2.4.2): Noten bis 255 (Zusatz-Kit auf 128 + note), 256 ist ein Formfehler
    {
      cdj::osc::Schreiber hoch(v::erz_ev);
      hoch.i(1).i(3).i(10).i(255).d(8.0).d(0.25).f(1.0f);
      const auto paket_h = bundle({&f, &hoch});
      netz.paket(paket_h.data(), paket_h.size());
      b = cdj::Befehl{};
      PRUEF(bef->hole(b) && b.art == cdj::Befehl::ERZ_FENSTER && b.zeiger);
      if (b.zeiger) {
        PRUEF(static_cast<const cdj::ErzFenster*>(b.zeiger)->ev[0].note == 255);
        delete static_cast<const cdj::ErzFenster*>(b.zeiger);
      }
      cdj::osc::Schreiber zu(v::erz_ev);
      zu.i(1).i(3).i(11).i(256).d(8.0).d(0.25).f(1.0f);
      const auto paket_z = bundle({&f, &zu});
      netz.paket(paket_z.data(), paket_z.size());
      PRUEF(g.warte("/e/protokollfehler", 200) && !std::strcmp(g.s(1), "protokoll"));
      b = cdj::Befehl{};
      PRUEF(!bef->hole(b));
    }
    // 10. Quittung und Freigaben aus dem Callback
    cdj::Ereignis q{};
    q.art = cdj::Ereignis::ERZ_QUITTUNG;
    q.deck = 1;
    q.fassung = 9;
    q.erz_zahl[0] = 2; q.erz_zahl[1] = 1; q.erz_zahl[2] = 3; q.erz_zahl[3] = 4; q.erz_zahl[4] = 0;
    q.zeiger = new cdj::ErzFenster();
    ere->schiebe(q);
    cdj::Ereignis a{};
    a.art = cdj::Ereignis::ERZ_ALT;
    a.zeiger = new cdj::Kit();
    ere->schiebe(a);
    netz.ereignisse_senden();  // gibt beide frei (ASan-Bau: kein Leck)
    PRUEF(g.warte("/erz/quittung", 200) && g.m.werte[0].i == 1 && g.m.werte[1].i == 9 && g.m.werte[2].i == 2 &&
          g.m.werte[3].i == 1 && g.m.werte[4].i == 3 && g.m.werte[5].i == 4 && g.m.werte[6].i == 0);
  }
  delete bef;
  delete ere;
  fs::remove_all(dir);
  PRUEF_ENDE();
}
