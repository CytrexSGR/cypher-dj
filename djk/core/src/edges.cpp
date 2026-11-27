#include "cypherdj/edges.h"
#include "cypherdj/input.h"

#include "cypherdj/arr_playback.h"
#include "cypherdj/generator.h"

namespace cdj {

std::vector<Kante> fehlende_kanten(const std::vector<Kante>& soll, const KantenIst& ist) {
  std::vector<Kante> fehlt;
  for (const Kante& k : soll)
    if (ist.existiert(ist.ctx, k.quelle.c_str()) && ist.existiert(ist.ctx, k.ziel.c_str()) &&
        !ist.verbunden(ist.ctx, k.quelle.c_str(), k.ziel.c_str()))
      fehlt.push_back(k);
  return fehlt;
}

std::vector<Kante> lies_kanten(const std::string& text) {
  std::vector<Kante> aus;
  size_t von = 0;
  while (von <= text.size()) {
    size_t bis = text.find('\n', von);
    if (bis == std::string::npos) bis = text.size();
    std::string zeile = text.substr(von, bis - von);
    von = bis + 1;
    if (!zeile.empty() && zeile.back() == '\r') zeile.pop_back();
    const size_t tab = zeile.find('\t');
    if (tab == std::string::npos || tab == 0 || tab + 1 >= zeile.size()) continue;
    aus.push_back({zeile.substr(0, tab), zeile.substr(tab + 1)});
  }
  return aus;
}

static bool ziffern(const std::string& s) {
  if (s.empty()) return false;
  for (char c : s)
    if (c < '0' || c > '9') return false;
  return true;
}

// Rest eines Rückweg-Ports hinter dem Präfix: N_L oder N_R
static bool nr_lr(const std::string& rest) {
  return rest.size() >= 3 && (rest.back() == 'L' || rest.back() == 'R') && rest[rest.size() - 2] == '_' &&
         ziffern(rest.substr(0, rest.size() - 2));
}

static bool kern_client(const std::string& quelle);   // defined below (any core instance: cypherdj-kern, cypherdj-kern-<i>)

// Rest of an effect-host port behind the prefix: <h>_L or <h>_R with h = 1..ARR_INS_HOST (plan 1.11 T3; unlike nr_lr, range checked)
static_assert(ARR_INS_HOST <= 9, "host_lr reads one digit");
static bool host_lr(const std::string& rest) {
  return rest.size() == 3 && rest[0] >= '1' && rest[0] < '1' + ARR_INS_HOST && rest[1] == '_' && (rest[2] == 'L' || rest[2] == 'R');
}

std::vector<Kante> filtere_kanten(const std::vector<Kante>& kanten, const std::string& kern_praefix,
                                  size_t* reserviert) {
  std::vector<Kante> ok;
  const std::string midi = kern_praefix + "midi_aus_", rueck = kern_praefix + "rueck_erz_";
  const std::string arr_midi = kern_praefix + "arr_midi_", arr_rueck = kern_praefix + "arr_rueck_";   // D1 K2b
  const std::string arr_ins = kern_praefix + "arr_ins_", arr_insret = kern_praefix + "arr_insret_";   // plan 1.11 T3
  const std::string arr_inskey = kern_praefix + "arr_inskey_";   // strand 2 task 3.3: sidechain key of a host stage (out)
  const std::string erz4 = kern_praefix + "rueck_erz_4_";
  if (reserviert) *reserviert = 0;
  for (const Kante& k : kanten) {
    bool zu = false;
    // Riegel: die Gegenseite darf kein Port des Kerns sein, sonst verbände die Datei den Kern mit sich selbst
    // (master_L -> rueck_erz_2_L, midi_aus_1 -> hand_in). Der Kern verbindet nur nach außen.
    const bool quelle_kern = k.quelle.compare(0, kern_praefix.size(), kern_praefix) == 0;
    const bool ziel_kern = k.ziel.compare(0, kern_praefix.size(), kern_praefix) == 0;
#ifndef CYPHERDJ_MUTATION_KANTEN_OHNE_RIEGEL
    if (quelle_kern && ziel_kern) continue;
#endif
    if (k.quelle.compare(0, midi.size(), midi) == 0) zu = ziffern(k.quelle.substr(midi.size()));
    if (!zu && k.ziel.compare(0, rueck.size(), rueck) == 0) zu = nr_lr(k.ziel.substr(rueck.size()));
#ifndef CYPHERDJ_MUTATION_ARR_KANTEN_ZU
    // D1 K2b (Spec 2.4): Wirt-Slots des Arrangements, arr_midi_<s> -> Wirt und Wirt -> arr_rueck_<s>_{L,R}
    if (!zu && k.quelle.compare(0, arr_midi.size(), arr_midi) == 0) zu = ziffern(k.quelle.substr(arr_midi.size()));
    if (!zu && k.ziel.compare(0, arr_rueck.size(), arr_rueck) == 0) zu = nr_lr(k.ziel.substr(arr_rueck.size()));
#endif
#ifndef CYPHERDJ_MUTATION_HOST_KANTEN_ZU
    // plan 1.11 T3: effect hosts, arr_ins_<h>_{L,R} -> host and host -> arr_insret_<h>_{L,R}, h = 1..ARR_INS_HOST.
    // T4 pre-step B: the far end of these two families is never a port of another core instance (kern_client), or the file would wire
    // kern-d:arr_ins_1_L to kern-e:arr_insret_1_L; the bolt above only covers this instance's own prefix.
#ifdef CYPHERDJ_MUTATION_HOST_KANTEN_KERN
    const bool fremd_ziel = true, fremd_quelle = true;   // error case: another core instance is accepted as the far end
#else
    const bool fremd_ziel = !kern_client(k.ziel), fremd_quelle = !kern_client(k.quelle);
#endif
    if (!zu && k.quelle.compare(0, arr_ins.size(), arr_ins) == 0) zu = fremd_ziel && host_lr(k.quelle.substr(arr_ins.size()));
    if (!zu && k.ziel.compare(0, arr_insret.size(), arr_insret) == 0) zu = fremd_quelle && host_lr(k.ziel.substr(arr_insret.size()));
    // strand 2 task 3.3: the key arr_inskey_<h>_{L,R} -> the plugin's third and fourth input, an output like the send and under the same owner rule. Without it the healing pass
    // never restored the key edges djk-insert wrote, and after a core restart the plugin heard silence on its key until the host restarted.
    if (!zu && k.quelle.compare(0, arr_inskey.size(), arr_inskey) == 0) zu = fremd_ziel && host_lr(k.quelle.substr(arr_inskey.size()));
#endif
#ifndef CYPHERDJ_MUTATION_ARR_KANTE_ERZ4
    if (zu && k.ziel.compare(0, erz4.size(), erz4) == 0) {   // D1 K1: rueck_erz_4 ist reserviert
      zu = false;
      if (reserviert) ++*reserviert;
    }
#endif
    if (zu) ok.push_back(k);
  }
  return ok;
}

static bool ein_port_name(const std::string& n) {
  if (n.size() == 10 && n.compare(0, 9, "midi_ein_") == 0 && n[9] >= '1' && n[9] <= '0' + MIDI_EIN_PORTS) return true;   // midi_ein_1..MIDI_EIN_PORTS
  return n.size() == 7 && n.compare(0, 4, "ein_") == 0 && n[4] >= '1' && n[4] <= '4' && n[5] == '_' && (n[6] == 'L' || n[6] == 'R');
}

// Port eines Kern-Clients irgendeiner Instanz? Client heißt cypherdj-kern oder cypherdj-kern-<i>, dahinter folgt ':' (instance.h cdj_name).
static bool kern_client(const std::string& quelle) {
  static const std::string basis = "cypherdj-kern";
  if (quelle.compare(0, basis.size(), basis) != 0) return false;
  const char c = quelle.size() > basis.size() ? quelle[basis.size()] : '\0';
  return c == ':' || c == '-';
}

std::vector<Kante> lies_eingangs_kanten(const std::string& text, const std::string& kern_praefix) {
  std::vector<Kante> aus;
  for (const Kante& k : lies_kanten(text)) {
#ifndef CYPHERDJ_MUTATION_EIN_KANTEN_OHNE_RIEGEL
#ifdef CYPHERDJ_MUTATION_EIN_KANTEN_NUR_EIGENES
    if (k.quelle.compare(0, kern_praefix.size(), kern_praefix) == 0) continue;  // Fehlerfall (m6): nur der eigene Kern fällt weg
#else
    if (k.quelle.compare(0, kern_praefix.size(), kern_praefix) == 0 || kern_client(k.quelle)) continue;  // Riegel: nie Kern -> Kern, jede Instanz
#endif
#endif
#ifndef CYPHERDJ_MUTATION_EIN_KANTEN_ZIEL_FREI
    if (!ein_port_name(k.ziel)) continue;
#endif
    aus.push_back({k.quelle, kern_praefix + k.ziel});
  }
  return aus;
}

std::vector<Kante> wegfallende_kanten(const std::vector<Kante>& alt, const std::vector<Kante>& soll) {
  std::vector<Kante> weg;
#ifndef CYPHERDJ_MUTATION_EIN_KANTEN_KEIN_TRENNEN  // Fehlerfall: nichts wird getrennt, alte und neue Quelle laufen summiert
  for (const Kante& a : alt) {
    bool noch = false;
    for (const Kante& s : soll) noch = noch || s == a;
    if (!noch) weg.push_back(a);
  }
#else
  (void)alt; (void)soll;
#endif
  return weg;
}

// fix B2: the worst case with one edge per core port the file may name: midi_aus_1..4, rueck_erz_{1..8 without 4}_{L,R}, per wirt slot arr_midi + arr_rueck_L/R,
// per host arr_ins_L/R + arr_insret_L/R + arr_inskey_L/R (72 at 8 hosts; it was 64 before the key and could overflow at 8 hosts)
static_assert(KANTEN_MAX >= ERZ_MIDI_PORTS + 7 * 2 + ARR_WIRT_SLOTS * 3 + ARR_INS_HOST * 6, "the edge file's worst case must fit KANTEN_MAX");

std::vector<Kante> entdoppeln_begrenzen(const std::vector<Kante>& kanten, size_t max, size_t* verworfen, size_t* ueber) {
  std::vector<Kante> aus;
  size_t n_ueber = 0;
  for (const Kante& k : kanten) {
    bool schon = false;
    for (const Kante& a : aus) schon = schon || a == k;
    if (schon) continue;
    if (aus.size() < max) aus.push_back(k);
    else ++n_ueber;   // counts every edge beyond the limit (a repeat of an edge already over the limit counts again)
  }
  if (verworfen) *verworfen = kanten.size() - aus.size();
  if (ueber) *ueber = n_ueber;
  return aus;
}

bool VerlustBuch::scheitern_melden(const Kante& k, int64_t jetzt_ns) {
  const auto it = fehl_.find(schluessel(k));
  if (it != fehl_.end() && jetzt_ns - it->second < 10'000'000'000LL) return false;
  fehl_[schluessel(k)] = jetzt_ns;
  return true;
}

void VerlustBuch::verbunden(const Kante& k) {
  offen_.erase(schluessel(k));
  fehl_.erase(schluessel(k));
}

void VerlustBuch::geheilte_abgleichen(const std::vector<Kante>& soll, const KantenIst& ist) {
  for (const Kante& k : soll)
    if (ist.verbunden(ist.ctx, k.quelle.c_str(), k.ziel.c_str())) verbunden(k);
}

std::vector<ZielEreignis> ZielUebergaenge::pruefe(const std::vector<Kante>& soll, const KantenIst& ist) {
  std::vector<ZielEreignis> ev;
  for (const Kante& k : soll) {
    const bool jetzt = ist.existiert(ist.ctx, k.ziel.c_str());
    const auto it = da_.find(k.ziel);
    const bool vorher = it == da_.end() ? true : it->second;
    if (vorher != jetzt) ev.push_back({k.ziel, jetzt});
    da_[k.ziel] = jetzt;
  }
  return ev;
}

uint32_t host_kanten_gesund(const std::vector<Kante>& soll, const std::string& kern_praefix, const KantenIst& ist) {
  uint32_t da = 0;   // bit (h - 1) * 4 + port: which of the four audio ports has an edge
  uint32_t key = 0;  // bit (h - 1) * 2 + side: which key port arr_inskey_<h>_L/R has an edge (strand 2 task 3.3)
  uint32_t schlecht = 0;
  const std::string aus = kern_praefix + "arr_ins_", rueck = kern_praefix + "arr_insret_", schl = kern_praefix + "arr_inskey_";
  for (const Kante& k : soll) {
    int h = 0, port = -1;
    for (int pass = 0; pass < 3 && port < 0; ++pass) {
      const std::string& pre = pass == 0 ? aus : pass == 1 ? rueck : schl;
      const std::string& name = pass == 1 ? k.ziel : k.quelle;   // a send and a key are the source of their edge, a return the target
      if (name.compare(0, pre.size(), pre) != 0) continue;
      const std::string rest = name.substr(pre.size());
      if (!host_lr(rest)) continue;
      h = rest[0] - '0';
      port = pass * 2 + (rest[2] == 'R' ? 1 : 0);
    }
    if (port < 0) continue;
    if (port < 4) da |= 1u << ((h - 1) * 4 + port);
    else key |= 1u << ((h - 1) * 2 + port - 4);
    if (!ist.existiert(ist.ctx, k.quelle.c_str()) || !ist.existiert(ist.ctx, k.ziel.c_str()) || !ist.verbunden(ist.ctx, k.quelle.c_str(), k.ziel.c_str()))
      schlecht |= 1u << (h - 1);
  }
  uint32_t ok = 0;
  for (int h = 1; h <= ARR_INS_HOST; ++h) {
    const uint32_t kp = (key >> ((h - 1) * 2)) & 0x3u;   // the key is optional (a plugin with two inputs has none), but when the record has it, both sides
    if (((da >> ((h - 1) * 4)) & 0xFu) == 0xFu && (kp == 0 || kp == 0x3u) && !(schlecht & (1u << (h - 1)))) ok |= 1u << (h - 1);
  }
  return ok;
}

int alle_aus_ereignisse(uint8_t out[][3], int max) {
  if (max < ALLE_AUS_N) return 0;
  for (int ch = 0; ch < 16; ++ch) {
    out[2 * ch][0] = (uint8_t)(0xB0 | ch);
    out[2 * ch][1] = 123;
    out[2 * ch][2] = 0;
    out[2 * ch + 1][0] = (uint8_t)(0xB0 | ch);
    out[2 * ch + 1][1] = 120;
    out[2 * ch + 1][2] = 0;
  }
  return ALLE_AUS_N;
}

}  // namespace cdj
