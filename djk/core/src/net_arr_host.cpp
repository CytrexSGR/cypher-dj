// Plan 1.11 T5 (INTERFACES §4.11 /k/arr/ins_host, /k/arr/ins_mess; §5.13 /e/ins_host, /e/ins_mess, /zustand/ins_host): the net thread's side of the effect-host health and measurement.
// It checks the fields (cypher in the AI stop refuses first, before any range check, §4.7) and hands the command to the callback, which applies it (Kern::ins_host_befehl, ins_mess_befehl) and
// reports back as events; the answers are sent from those events. Nothing here waits, allocates a buffer or touches a file.
#include <cstring>

#include "cypherdj/net.h"

namespace cdj {

namespace v = cypherdj::osc;

bool Netz::arr_host_paket(const osc::Nachricht& m, bool messung) {
  Befehl b{};
  b.id = m.werte[0].h;
  std::strncpy(b.quelle, m.werte[1].s, sizeof b.quelle - 1);
  b.quelle[sizeof b.quelle - 1] = '\0';
  auto ab = [&](const char* grund) {
    quittung(b.id, b.quelle, 6, stand_sample_, stand_beat_, grund);
    return true;
  };
  bool quelle_ok = false;
  for (const auto& n : v::werte::quelle) quelle_ok = quelle_ok || n == b.quelle;
  if (!quelle_ok) return ab("ausserhalb_bereich");
  if (!std::strcmp(b.quelle, "cypher") && ki_gestoppt_) return ab("ki_gestoppt");   // §4.7; the kern is not asked
  if (messung) {
    b.art = Befehl::ARR_INS_MESS;
    b.nr = m.werte[v::feld::k_arr_ins_mess::h].i;
  } else {
    b.art = Befehl::ARR_INS_HOST;
    b.nr = m.werte[v::feld::k_arr_ins_host::h].i;
    b.an = m.werte[v::feld::k_arr_ins_host::gesund].i;
    if (b.an != 0 && b.an != 1) return ab("ausserhalb_bereich");
  }
  if (b.nr < 1 || b.nr > ARR_INS_HOST) return ab("ausserhalb_bereich");
  einreihen(b);
  return true;
}

bool Netz::arr_host_ereignis(const Ereignis& e) {
  if (e.art == Ereignis::INS_HOST) {   // /e/ins_host: h, gesund
    osc::Schreiber s(v::e_ins_host);
    s.i(e.deck).i(e.status);
    an_alle(s);
    return true;
  }
  if (e.art == Ereignis::INS_MESS) {   // /e/ins_mess: h, rundweg, grund
    osc::Schreiber s(v::e_ins_mess);
    s.i(e.deck).i(e.status).s(e.grund);
    an_alle(s);
    return true;
  }
  if (e.art == Ereignis::INS_HOST_ZUSTAND) {   // /zustand/ins_host: (h, gesund, rundweg) for hosts 1 to 4
    osc::Schreiber s(v::zustand_ins_host);
    for (int h = 0; h < ARR_INS_HOST; ++h) s.i(h + 1).i(e.host_gesund[h]).i(e.host_rundweg[h]);
    an_alle(s);
    return true;
  }
  return false;
}

}  // namespace cdj
