#include "cypherdj/netz.h"
#include "hand/mapping.h"

#include <arpa/inet.h>
#include <netinet/in.h>
#include <poll.h>
#include <sys/socket.h>
#include <time.h>
#include <unistd.h>

#include <cctype>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <thread>

#include "cypherdj/fassung.h"
#include "cypherdj/mixer.h"

namespace cdj {

namespace v = cypherdj::osc;  // der Vertrag als Code (djk/vertrag/osc_adressen.h)

static void kopiere(char* ziel, const char* quelle, size_t n) {
  std::strncpy(ziel, quelle, n - 1);
  ziel[n - 1] = '\0';
}

// Ohr T12, §4.5: inhalt bindet den Hörschein an das, was klingt: "<material_id 16 Hex>/<bpm_milli>_r<fassung>"
// (z. B. "3fa1c09b2e7d4410/128000_r1"). Netz-Faden, nicht Echtzeit: unlesbar -> false, Befehl wird verworfen.
static bool inhalt_zerlegen(const char* inhalt, char* material_id, size_t material_id_n, int32_t& bpm_milli,
                             int32_t& fassung) {
  const char* trenner = std::strchr(inhalt, '/');
  if (!trenner) return false;
  const size_t mat_n = (size_t)(trenner - inhalt);
  if (mat_n != 16 || mat_n >= material_id_n) return false;
  std::memcpy(material_id, inhalt, mat_n);
  material_id[mat_n] = '\0';
  if (!material_id_gueltig(material_id)) return false;
  const char* rest = trenner + 1;  // "128000_r1"
  const char* r = std::strchr(rest, '_');
  if (!r || r[1] != 'r') return false;
  const size_t bpm_n = (size_t)(r - rest);
  if (bpm_n == 0 || bpm_n > 9) return false;
  char bpm_text[10];
  for (size_t i = 0; i < bpm_n; ++i) {
    if (!std::isdigit((unsigned char)rest[i])) return false;
    bpm_text[i] = rest[i];
  }
  bpm_text[bpm_n] = '\0';
  const char* fassung_text = r + 2;
  if (!fassung_text[0]) return false;
  for (const char* p = fassung_text; *p; ++p)
    if (!std::isdigit((unsigned char)*p)) return false;
  char* ende = nullptr;
  const long bpm_val = std::strtol(bpm_text, &ende, 10);
  if (ende == bpm_text || *ende != '\0') return false;
  ende = nullptr;
  const long fassung_val = std::strtol(fassung_text, &ende, 10);
  if (ende == fassung_text || *ende != '\0' || fassung_val < 1) return false;
  bpm_milli = (int32_t)bpm_val;
  fassung = (int32_t)fassung_val;
  return true;
}

// §1.4: die sechs Quellen; das Stellwerk kennt nur sie (Scheibe 25)
static bool quelle_bekannt(const char* q) {
  for (const auto& n : v::werte::quelle)
    if (n == q) return true;
  return false;
}

static int64_t jetzt_mono_ns() {
  timespec ts;
  clock_gettime(CLOCK_MONOTONIC, &ts);
  return (int64_t)ts.tv_sec * 1000000000LL + ts.tv_nsec;
}

Netz::Netz(int udp_port, bool pruefmodus, Befehlsring* befehle, Ereignisring* ereignisse, int64_t frist_ns)
    : pruefmodus_(pruefmodus), frist_ns_(frist_ns), befehle_(befehle), ereignisse_(ereignisse),
      tabelle_(std::make_unique<cypherdj::stellwerk::ReglerTabelle>()) {
  int s = socket(AF_INET, SOCK_DGRAM, 0);
  if (s < 0) return;
  sockaddr_in a{};
  a.sin_family = AF_INET;
  a.sin_port = htons((uint16_t)udp_port);
  a.sin_addr.s_addr = htonl(INADDR_LOOPBACK);  // nur Loopback (§2)
  if (bind(s, (sockaddr*)&a, sizeof a) != 0) { std::perror("bind"); close(s); return; }
  socklen_t l = sizeof a;
  getsockname(s, (sockaddr*)&a, &l);
  port_ = ntohs(a.sin_port);
  sock_ = s;
}

Netz::~Netz() { if (sock_ >= 0) close(sock_); }

void Netz::an_port(int port, const osc::Schreiber& s) {
  if (sock_ < 0 || !s.ok()) return;
  sockaddr_in a{};
  a.sin_family = AF_INET;
  a.sin_port = htons((uint16_t)port);
  a.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  sendto(sock_, s.daten(), s.groesse(), 0, (sockaddr*)&a, sizeof a);
}

void Netz::an_alle(const osc::Schreiber& s) {
  for (auto& a : abo_) if (a.aktiv) an_port(a.port, s);
}

int Netz::abonnenten() const {
  int n = 0;
  for (const auto& a : abo_) n += a.aktiv ? 1 : 0;
  return n;
}

void Netz::protokollfehler(const char* adresse, const char* grund, int nur_port) {
  char adr[48];
  kopiere(adr, adresse, sizeof adr);  // OSC-Zeichenketten höchstens 47 Bytes (§1.4)
  osc::Schreiber s(v::e_protokollfehler);
  s.s(adr).s(grund);
  if (nur_port) an_port(nur_port, s); else an_alle(s);
}

void Netz::quittung(int64_t id, const char* quelle, int32_t status, int64_t smp, double b, const char* grund) {
  osc::Schreiber s(v::q);
  s.h(id).s(quelle).i(status).h(smp).d(b).s(grund);
  an_alle(s);
}

bool Netz::einreihen(const Befehl& b, bool melden) {
  for (int versuch = 0; versuch < 100; ++versuch) {  // höchstens 100 ms warten, der Callback leert je Zyklus
    if (befehle_->schiebe(b)) return true;
    std::this_thread::sleep_for(std::chrono::milliseconds(1));
  }
  // Befehlsring voll: der Callback liest nicht mehr. Genau oder gemeldet (§16.1): verworfen und gemeldet.
  if (!melden) return false;
  std::fprintf(stderr, "Befehlsring voll, Befehl %lld verworfen\n", (long long)b.id);
  quittung(b.id, b.quelle, 4, stand_sample_, stand_beat_, "zu_spaet");
  return false;
}

void Netz::hallo(const osc::Nachricht& m, int64_t jetzt_ns) {
  const char* name = m.werte[0].s;
  const int port = m.werte[1].i, protokoll = m.werte[2].i;
  if (protokoll != v::vertrag) { protokollfehler(m.adresse, "protokoll", port); return; }
  // Audit F17: der eigene Port machte den Kern zu seinem Abonnenten (Selbst-Flut, Netz-Faden im Livelock); htons brach
  // Ports über 65535 still auf einen anderen um
  // gemeldet an alle: an den genannten Port ginge die Meldung an den Kern selbst oder an einen umgebrochenen Port
  if (port < 1 || port > 65535 || port == port_) { protokollfehler(m.adresse, "ausserhalb_bereich", 0); return; }
  Abonnent* platz = nullptr;
  for (auto& a : abo_) if (a.aktiv && !std::strcmp(a.name, name)) platz = &a;  // Herzschlag eines Bekannten
  const bool bekannt = platz != nullptr;
  for (auto& a : abo_) if (!platz && !a.aktiv) platz = &a;
  if (!platz) {  // §4.1: höchstens 8 Abonnenten; §16.2 kennt keinen Grund dafür (Befund B6 g im Plan)
    std::fprintf(stderr, "mehr als %d Abonnenten, %s abgewiesen\n", MAX_ABONNENTEN, name);
    return;
  }
  // Scheibe 18, §4.1: wer sich in einer fortgesetzten Generation zum ersten Mal meldet, bekommt nach /k/willkommen
  // /e/neustart und je offenem Befehl /q/stand
  const bool erstes_in_generation = !bekannt || platz->hallo_generation != stand_generation_;
  kopiere(platz->name, name, sizeof platz->name);
  platz->port = port;
  platz->aktiv = true;
  platz->zuletzt_ns = jetzt_ns;
  platz->protokoll = protokoll;
  platz->hallo_generation = stand_generation_;
  osc::Schreiber w(v::k_willkommen);  // auf jedes /k/hallo, auch den Herzschlag (wie Scheibe 01)
  w.i(v::vertrag).i(stand_generation_).h(stand_sample_).d(stand_beat_).d(stand_bpm_).s(KERN_VERSION);
  an_port(port, w);
  if (stand_generation_ >= 1 && erstes_in_generation) {
    sende_neustart(port);
    sende_stand(port);
  }
  schreibe_abonnenten();
}

void Netz::verbinde_zustand(cdj_z_datei* d, uint64_t letzter_abo_stand) {
  zustand_ = d;
  if (d) {
    abo_schreiber_.verbinde(d->abos, letzter_abo_stand);
    stand_puffer_ = std::make_unique<cdj_z_befehl[]>(CDJ_Z_BEFEHLE);
  }
}

void Netz::setze_abonnenten(const cdj_z_abonnent* a, int n, int64_t jetzt_ns) {
  int k = 0;
  for (int i = 0; i < n && k < MAX_ABONNENTEN; ++i) {
    if (a[i].port < 1 || a[i].port > 65535 || a[i].port == port_ || a[i].name[0] == '\0') continue;  // Audit F17
    Abonnent& z = abo_[k++];
    std::memcpy(z.name, a[i].name, sizeof z.name - 1);
    z.name[sizeof z.name - 1] = '\0';
    z.port = a[i].port;
    z.aktiv = true;
    z.zuletzt_ns = jetzt_ns;  // §4.1: die 5-s-Frist beginnt mit dem Neustart neu
    z.protokoll = a[i].protokoll;
    z.hallo_generation = -1;
  }
  for (; k < MAX_ABONNENTEN; ++k) abo_[k].aktiv = false;
  schreibe_abonnenten();
}

void Netz::sende_neustart(int nur_port) {
  osc::Schreiber s(v::e_neustart);
  s.i(stand_generation_).h(neustart_sample_);
  if (nur_port) an_port(nur_port, s); else an_alle(s);
  // Ohr T17 (§5.12): gleich danach einmal das FX-Routing des Kerns; nach einem Kern-Neustart die Vorgabe 0, der Seiten-Server
  // sendet Andreas' Wahl daraufhin erneut. Der Kern selbst behält sie nicht.
  osc::Schreiber r(v::e_fx_routing);
  r.i(fx_routing_stand_);
  if (nur_port) an_port(nur_port, r); else an_alle(r);
}

void Netz::sende_stand(int port) {
  if (!zustand_ || !stand_puffer_) return;
  int n = 0;
  if (!z_lies_befehle(zustand_, stand_puffer_.get(), n)) return;
  for (int i = 0; i < n; ++i) {
    const cdj_z_befehl& b = stand_puffer_[i];
    if (b.stand != 1 && b.stand != 2) continue;  // §5.1: nur wartende und laufende
    char quelle[48];
    std::memcpy(quelle, b.quelle, sizeof quelle - 1);
    quelle[sizeof quelle - 1] = '\0';
    osc::Schreiber s(v::q_stand);
    s.h(b.id).s(quelle).i(b.stand).h(b.ist_sample).d(b.ist_beat).s("");
    an_port(port, s);
  }
}

void Netz::schreibe_abonnenten() {
  if (!abo_schreiber_.verbunden()) return;
  cdj_z_abos* f = abo_schreiber_.beginne();
  int n = 0;
  for (const auto& a : abo_) {
    if (!a.aktiv) continue;
    cdj_z_abonnent& z = f->a[n++];
    std::memset(&z, 0, sizeof z);
    std::memcpy(z.name, a.name, sizeof z.name - 1);
    z.port = a.port;
    z.protokoll = a.protokoll;
    z.letzte_ns = a.zuletzt_ns;
  }
  f->n = n;
  abo_schreiber_.beende();
}

void Netz::abonnenten_pruefen(int64_t jetzt_ns) {
  bool geaendert = false;
  for (auto& a : abo_)
    if (a.aktiv && jetzt_ns - a.zuletzt_ns > frist_ns_) {
      a.aktiv = false;
      geaendert = true;
      std::fprintf(stderr, "Abonnent %s (Port %d) nach %.1f s ohne /k/hallo gestrichen\n", a.name, a.port,
                   (double)frist_ns_ / 1e9);
    }
  if (geaendert) schreibe_abonnenten();  // Scheibe 18
}

void Netz::paket(const char* p, size_t n) { paket(p, n, jetzt_mono_ns()); }

void Netz::paket(const char* p, size_t n, int64_t jetzt_ns) {
  if (n >= 8 && std::memcmp(p, "#bundle", 8) == 0) {  // §4.8: Bundles gibt es nur als Erzeuger-Fenster
    erz_bundle(p, n);
    return;
  }
  osc::Nachricht m;
  if (!osc::lesen(p, n, m)) { protokollfehler("", "falsche_typen", 0); return; }
  const char* adr = m.adresse;
  const v::Adresse* a = v::finde(adr);
  // §4: unbekannte Adresse (auch: Ausgabe-Adresse, /test/* ohne Prüfmodus §19.0) oder falsche Typen -> verworfen
  const bool nur_pruef = a && a->nur_pruefmodus && !pruefmodus_ && !(hand_osc_ && a->pfad == v::test_hand.pfad);
  if (!a || a->richtung != v::Richtung::an_kern || nur_pruef) {
    protokollfehler(adr, "unbekannte_adresse", 0);
    return;
  }
  if (std::strcmp(m.typen, a->typen.data() + 1) != 0) { protokollfehler(adr, "falsche_typen", 0); return; }

  if (a->pfad == v::k_hallo.pfad) {
    hallo(m, jetzt_ns);
  } else if (a->pfad == v::k_tschuess.pfad) {
    for (auto& x : abo_) if (x.aktiv && !std::strcmp(x.name, m.werte[0].s)) x.aktiv = false;
    schreibe_abonnenten();  // Scheibe 18
  } else if (a->pfad == v::k_set_neu.pfad) {
    Befehl b{};
    b.art = Befehl::SET_NEU;
    b.id = m.werte[v::feld::k_set_neu::id].h;
    kopiere(b.quelle, m.werte[v::feld::k_set_neu::quelle].s, sizeof b.quelle);
    b.bpm = m.werte[v::feld::k_set_neu::start_bpm].d;
    if (!(b.bpm >= 60.0 && b.bpm <= 200.0)) {
      quittung(b.id, b.quelle, 6, stand_sample_, stand_beat_, "ausserhalb_bereich");
      return;
    }
    einreihen(b);
  } else if (a->pfad == v::k_tempo_rampe.pfad) {
    namespace f = v::feld::k_tempo_rampe;
    namespace g = v::bereich::k_tempo_rampe;
    Befehl b{};
    b.art = Befehl::TEMPO_RAMPE;
    b.id = m.werte[f::id].h;
    kopiere(b.quelle, m.werte[f::quelle].s, sizeof b.quelle);
    b.ab_beat = m.werte[f::ab_beat].d;
    b.ziel_bpm = m.werte[f::ziel_bpm].d;
    b.dauer_beats = m.werte[f::dauer_beats].d;
    if (!std::isfinite(b.ab_beat) || !(b.ziel_bpm >= g::ziel_bpm_min && b.ziel_bpm <= g::ziel_bpm_max) ||
        !(b.dauer_beats >= g::dauer_beats_min) || !std::isfinite(b.dauer_beats)) {
      quittung(b.id, b.quelle, 6, stand_sample_, stand_beat_, "ausserhalb_bereich");
      return;
    }
    einreihen(b);
  } else if (a->pfad == v::k_storno.pfad) {
    Befehl b{};
    b.art = Befehl::STORNO;
    b.id = m.werte[v::feld::k_storno::id].h;
    kopiere(b.quelle, m.werte[v::feld::k_storno::quelle].s, sizeof b.quelle);
    b.ziel_id = m.werte[v::feld::k_storno::ziel_id].h;
    einreihen(b);
  } else if (a->pfad == v::test_klick.pfad) {
    namespace f = v::feld::test_klick;
    Befehl b{};
    b.art = Befehl::KLICK;
    b.id = m.werte[f::id].h;
    kopiere(b.quelle, m.werte[f::quelle].s, sizeof b.quelle);
    b.an = m.werte[f::an].i;
    // Z1: master oder ein Kanal aus §1.5 mit Kanalzug (Scheibe 25; bis dahin nur master)
    if (std::strcmp(m.werte[f::kanal].s, "master") && Mixer::kanal_index(m.werte[f::kanal].s) < 0) {
      quittung(b.id, b.quelle, 6, stand_sample_, stand_beat_, "unbekannter_regler");
      return;
    }
    kopiere(b.pfad, m.werte[f::kanal].s, sizeof b.pfad);
    if (b.an != 0 && b.an != 1) {
      quittung(b.id, b.quelle, 6, stand_sample_, stand_beat_, "ausserhalb_bereich");
      return;
    }
    einreihen(b);
  } else if (a->pfad == v::k_teil.pfad) {  // Scheibe 25, §4.3: Bereiche prüft das Stellwerk (ausserhalb_bereich)
    namespace f = v::feld::k_teil;
    Befehl b{};
    b.art = Befehl::TEIL;
    b.id = m.werte[f::id].h;
    kopiere(b.quelle, m.werte[f::quelle].s, sizeof b.quelle);
    kopiere(b.plan, m.werte[f::plan].s, sizeof b.plan);
    b.nr = m.werte[f::teil].i;
    kopiere(b.pfad, m.werte[f::pfad].s, sizeof b.pfad);
    b.ab_beat = m.werte[f::ab_beat].d;
    b.dauer_beats = m.werte[f::dauer_beats].d;
    b.wert = m.werte[f::nach].f;
    b.form = m.werte[f::form].i;
    b.politik = m.werte[f::politik].i;
    kopiere(b.gruppe, m.werte[f::gruppe].s, sizeof b.gruppe);
    kopiere(b.hoerschein, m.werte[f::hoerschein].s, sizeof b.hoerschein);
    if (!quelle_bekannt(b.quelle) || b.nr < 0) {
      quittung(b.id, b.quelle, 6, stand_sample_, stand_beat_, "ausserhalb_bereich");
      return;
    }
    einreihen(b);
  } else if (a->pfad == v::k_hoerschein.pfad) {  // Ohr T12, §4.5: Annahme; die Prüfung (I3a) kommt in T13/T14
    namespace f = v::feld::k_hoerschein;
    Befehl b{};
    b.art = Befehl::HOERSCHEIN;
    b.id = m.werte[f::id].h;
    kopiere(b.quelle, m.werte[f::quelle].s, sizeof b.quelle);
    kopiere(b.hoerschein, m.werte[f::hs_id].s, sizeof b.hoerschein);
    kopiere(b.pfad, m.werte[f::kanal].s, sizeof b.pfad);
    kopiere(b.urteil, m.werte[f::urteil].s, sizeof b.urteil);
    b.bpm = m.werte[f::bpm_messung].d;
    b.ab_beat = m.werte[f::gueltig_bis_beat].d;
    b.quell_von = m.werte[f::quell_von].d;
    b.quell_bis = m.werte[f::quell_bis].d;
    b.sync_ms = m.werte[f::sync_ms].f;
    b.pegel_diff_db = m.werte[f::pegel_diff_db].f;
    b.lufs_kurz = m.werte[f::lufs_kurz].f;
    if (!quelle_bekannt(b.quelle)) {
      quittung(b.id, b.quelle, 6, stand_sample_, stand_beat_, "ausserhalb_bereich");
      return;
    }
    if (!inhalt_zerlegen(m.werte[f::inhalt].s, b.material_id, sizeof b.material_id, b.bpm_milli, b.fassung)) {
      quittung(b.id, b.quelle, 6, stand_sample_, stand_beat_, "form");  // §16.2: Eingabe verletzt das Schema
      return;
    }
    einreihen(b);
  } else if (a->pfad == v::k_hoerschein_weg.pfad) {  // Ohr T12, §4.5: zieht ihn zurück; nur hs_id
    namespace f = v::feld::k_hoerschein_weg;
    Befehl b{};
    b.art = Befehl::HOERSCHEIN_WEG;
    b.id = m.werte[f::id].h;
    kopiere(b.quelle, m.werte[f::quelle].s, sizeof b.quelle);
    kopiere(b.hoerschein, m.werte[f::hs_id].s, sizeof b.hoerschein);
    if (!quelle_bekannt(b.quelle)) {
      quittung(b.id, b.quelle, 6, stand_sample_, stand_beat_, "ausserhalb_bereich");
      return;
    }
    einreihen(b);
  } else if (a->pfad == v::k_abbruch.pfad) {  // §4.3 /k/abbruch; die Liste der Teile liest der Callback
    namespace f = v::feld::k_abbruch;
    Befehl b{};
    b.art = Befehl::ABBRUCH;
    b.id = m.werte[f::id].h;
    kopiere(b.quelle, m.werte[f::quelle].s, sizeof b.quelle);
    kopiere(b.plan, m.werte[f::plan].s, sizeof b.plan);
    kopiere(b.liste, m.werte[f::teile].s, sizeof b.liste);
    if (!quelle_bekannt(b.quelle)) {
      quittung(b.id, b.quelle, 6, stand_sample_, stand_beat_, "ausserhalb_bereich");
      return;
    }
    einreihen(b);
  } else if (a->pfad == v::k_ki_stopp.pfad || a->pfad == v::k_ki_frei.pfad || a->pfad == v::k_ki_spur.pfad ||
             a->pfad == v::k_ki_stufe.pfad) {  // §4.7
    Befehl b{};
    b.art = a->pfad == v::k_ki_stopp.pfad  ? Befehl::KI_STOPP
            : a->pfad == v::k_ki_frei.pfad ? Befehl::KI_FREI
            : a->pfad == v::k_ki_spur.pfad ? Befehl::KI_SPUR
                                           : Befehl::KI_STUFE;
    b.id = m.werte[0].h;
    kopiere(b.quelle, m.werte[1].s, sizeof b.quelle);
    if (b.art == Befehl::KI_SPUR) kopiere(b.liste, m.werte[v::feld::k_ki_spur::kanaele].s, sizeof b.liste);
    if (b.art == Befehl::KI_STUFE) b.an = m.werte[v::feld::k_ki_stufe::stufe].i;
    const bool stufe_ok = b.art != Befehl::KI_STUFE || (b.an >= v::bereich::k_ki_stufe::stufe_min &&
                                                        b.an <= v::bereich::k_ki_stufe::stufe_max);
    if (!quelle_bekannt(b.quelle) || !stufe_ok) {
      quittung(b.id, b.quelle, 6, stand_sample_, stand_beat_, "ausserhalb_bereich");
      return;
    }
    einreihen(b);
  } else if (a->pfad == v::k_mapping.pfad) {  // Scheibe 35, §4.7: Datei im Nicht-Echtzeit-Faden lesen und prüfen
    namespace f = v::feld::k_mapping;
    Befehl b{};
    b.art = Befehl::MAPPING;
    b.id = m.werte[f::id].h;
    kopiere(b.quelle, m.werte[f::quelle].s, sizeof b.quelle);
    const char* geraet = m.werte[f::geraet].s;
    if (!quelle_bekannt(b.quelle)) {
      quittung(b.id, b.quelle, 6, stand_sample_, stand_beat_, "ausserhalb_bereich");
      return;
    }
    auto neu = std::make_unique<hand::Mapping>();
    hand::Fehler fe{};
    const std::string pfad = controller_ordner_ + "/" + geraet + ".json";
    if (controller_ordner_.empty() || !geraet[0] || std::strchr(geraet, '/') || geraet[0] == '.') {
      std::fprintf(stderr, "Mapping: Gerät '%s' ist kein Gerätename im Controller-Ordner (bleibt beim alten)\n", geraet);
      quittung(b.id, b.quelle, 6, stand_sample_, stand_beat_, "pruefung");
      return;
    }
    if (!hand::lade_datei(pfad.c_str(), *tabelle_, neu.get(), &fe)) {
      std::fprintf(stderr, "Mapping %s: %s (bleibt beim alten)\n", pfad.c_str(), fe.text);  // fe.text trägt Zeile und Art
      quittung(b.id, b.quelle, 6, stand_sample_, stand_beat_, "pruefung");
      return;
    }
    b.zeiger = neu.get();
    if (einreihen(b)) neu.release();  // der Kern besitzt es jetzt; sonst hat einreihen() `zu_spaet` gemeldet
  } else if (a->pfad == v::test_hand.pfad) {  // §19.0 Prüf-Handeingang (nur im Prüfmodus, oben geprüft)
    namespace f = v::feld::test_hand;
    Befehl b{};
    b.art = Befehl::HAND;
    kopiere(b.pfad, m.werte[f::pfad].s, sizeof b.pfad);
    b.wert = m.werte[f::midi_roh].f;
    b.sample = m.werte[f::sample].h;
    const int r = tabelle_->suche(b.pfad);
    int dn = 0;
    bool play = false;
    hand::Taste tk;
    if (test_taste_pfad(b.pfad, &tk)) {  // Zusatz 35: taste/<name>, Bereichsprüfung wie bei den Deck-Tasten
      if (!(b.wert >= v::bereich::test_hand::midi_roh_min && b.wert <= v::bereich::test_hand::midi_roh_max) ||
          b.sample < 0) {
        protokollfehler(adr, "ausserhalb_bereich", 0);
        return;
      }
      einreihen(b);
      return;
    }
    if (deck_taste_pfad(b.pfad, &dn, &play)) {  // Scheibe 35 E5 a: deck/<n>/play|cue, midi_roh >= 0,5 Druck, sonst Loslassen
      if (!(b.wert >= v::bereich::test_hand::midi_roh_min && b.wert <= v::bereich::test_hand::midi_roh_max) ||
          b.sample < 0) {
        protokollfehler(adr, "ausserhalb_bereich", 0);
        return;
      }
      einreihen(b);
      return;
    }
    if (r < 0 || tabelle_->def(r).transport) {  // kein Befehl mit Kennung: gemeldet als Protokollfehler (Befund B5)
      protokollfehler(adr, "unbekannter_regler", 0);
      return;
    }
    if (!(b.wert >= v::bereich::test_hand::midi_roh_min && b.wert <= v::bereich::test_hand::midi_roh_max) ||
        b.sample < 0) {
      protokollfehler(adr, "ausserhalb_bereich", 0);
      return;
    }
    einreihen(b);
  } else if (!erz_paket(a, m) && !loop_paket(a, m) && !deck_paket(a, m)) {  // erz, loop zuerst: deck_paket liest werte[1] als s
    // Adresse steht im Vertrag, ist aber noch nicht gebaut (Hörscheine, LEDs, Loop ...): bis zu ihrer Scheibe
    // wie unbekannt (Befund B6 h im Plan)
    protokollfehler(adr, "unbekannte_adresse", 0);
  }
}

void Netz::ereignisse_senden() {
  Ereignis e;
  while (ereignisse_->hole(e)) {
    if (e.art == Ereignis::UHR) {
      stand_sample_ = e.sample;
      stand_beat_ = e.beat;
      stand_bpm_ = e.bpm;
      keylock_tempo(e.bpm);
      stand_generation_ = e.generation;
      osc::Schreiber s(v::uhr);
      s.h(e.sample).h(e.mono_ns).d(e.beat).d(e.bpm).d(e.k);
      an_alle(s);
    } else if (e.art == Ereignis::TAKT) {
      osc::Schreiber s(v::takt);
      s.i((int32_t)e.takt).i((int32_t)e.phrase).h(e.sample).d(e.beat).d(e.bpm);
      an_alle(s);
    } else if (e.art == Ereignis::QUITTUNG) {
      quittung(e.id, e.quelle, e.status, e.sample, e.beat, e.grund);
    } else if (e.art == Ereignis::ZYKLUS) {
      fenster_.zyklus(e);
      verteilung_.zaehle(e.dauer_us);  // Scheibe 25
    } else if (e.art == Ereignis::REGLER) {  // Scheibe 25, §5.7
      osc::Schreiber s(v::e_regler);
      s.s(e.pfad).f(e.wert).s(e.text).h(e.sample).d(e.beat);
      an_alle(s);
    } else if (e.art == Ereignis::PEGEL) {  // §5.6
      osc::Schreiber s(v::pegel);
      s.s(e.pfad);
      for (int i = 0; i < 7; ++i) s.f(e.pegel[i]);
      an_alle(s);
    } else if (e.art == Ereignis::MAPPING_ALT) {  // Scheibe 35: abgelöstes Mapping freigeben (nur hier, nie im Callback)
      delete static_cast<const hand::Mapping*>(e.zeiger);
    } else if (e.art == Ereignis::TASTE) {  // §5.8 /e/taste: name, wert, sample, beat (Scheibe 35)
      osc::Schreiber s(v::e_taste);
      s.s(e.pfad).i(e.status).h(e.sample).d(e.beat);
      an_alle(s);
    } else if (e.art == Ereignis::HAND) {  // §5.8
      osc::Schreiber s(v::e_hand);
      s.s(e.pfad).f(e.wert).h(e.sample).d(e.beat);
      an_alle(s);
    } else if (e.art == Ereignis::HALTER) {  // §5.9
      osc::Schreiber s(v::e_halter);
      s.s(e.pfad).s(e.text).h(e.sample).d(e.beat);
      an_alle(s);
    } else if (e.art == Ereignis::KI) {  // §5.9
      ki_gestoppt_ = e.status;
      osc::Schreiber s(v::e_ki);
      s.i(e.status).s(e.grund).h(e.sample);
      an_alle(s);
    } else if (e.art == Ereignis::INVARIANTE) {  // §5.9 (Prüfer ab Scheibe 43)
      osc::Schreiber s(v::e_invariante);
      s.s(e.grund).s(e.text).i(e.teil).h(e.sample).d(e.beat);
      an_alle(s);
    } else if (e.art == Ereignis::LUECKE) {
      osc::Schreiber s(v::e_luecke);
      s.h(e.sample).i(e.frames).i(e.zyklen);
      an_alle(s);
    } else if (e.art == Ereignis::NEUSTART) {
      // Scheibe 18, §4.1: erste Nachricht der neuen Generation an alle gespeicherten Abonnenten
      stand_generation_ = e.generation;
      stand_sample_ = e.sample;
      neustart_sample_ = e.sample;
      sende_neustart(0);
    } else if (e.art == Ereignis::QUANTUM) {
      osc::Schreiber s(v::e_quantum);
      s.i(e.alt).i(e.neu).h(e.sample);
      an_alle(s);
    } else {
      if (!deck_ereignis(e) && !erz_ereignis(e)) loop_ereignis(e);  // Scheibe 31, Plan 2026-09-27, MVP 2
    }
  }
  keylock_zyklus();  // Keylock Slice 3: fertige Varianten einreihen, Render auslösen
}

void Netz::zustand_senden(int64_t jetzt_ns) {
  KernZustand w = fenster_.werte(jetzt_ns);
  w.ki_gestoppt = ki_gestoppt_;  // Scheibe 25
  osc::Schreiber s(v::zustand_kern);
  s.i(w.generation).i(w.quantum).h(w.sample).i(w.frame_luecken).i(w.ausgelassene_perioden).i(w.cb_max_us)
      .i(w.cb_p99_us).i(w.aufwach_max_us).i(w.stretcher_aktiv).i(w.befehle_wartend).i(w.ki_gestoppt);
  an_alle(s);
}

void Netz::laufen(const std::atomic<bool>& stop) {
  char buf[osc::MAX_PAKET + 4];
  pollfd pf{sock_, POLLIN, 0};
  int64_t naechster_zustand = jetzt_mono_ns();
  while (!stop.load()) {
    if (poll(&pf, 1, 2) > 0 && (pf.revents & POLLIN)) {
      // Audit F17: höchstens 64 Pakete je Runde, dann Ereignisse senden und Frist prüfen; ein schneller Strom hielt den
      // Faden sonst für immer in dieser Schleife (kein /uhr, keine Quittung, kein Stopp)
      for (int k = 0; k < 64; ++k) {
        ssize_t r = recv(sock_, buf, sizeof buf, MSG_DONTWAIT);
        if (r <= 0) break;
        paket(buf, (size_t)r);
      }
    }
    ereignisse_senden();
    const int64_t jetzt = jetzt_mono_ns();
    abonnenten_pruefen(jetzt);
    if (jetzt >= naechster_zustand) {
      zustand_senden(jetzt);
      naechster_zustand = jetzt + ZUSTAND_ABSTAND_NS;
    }
  }
  keylock_beenden();  // Slice 3b (F6): ein laufender Render bricht ab, kein weiterer startet (auch nicht aus main nach dem join)
}

}  // namespace cdj
