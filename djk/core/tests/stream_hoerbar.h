// Container core X1: a stream has no strip and no fader. It sounds at the master only through a strom track of a /4 arrangement:
// strom track -> group 1 -> DJ output 3 -> container pad/1 (art module, fader 0 dB) -> master. This helper builds that path for the
// tests that used to open the channel erz/<n> (fader row erz/<n>/fader) to hear a host return or an Erzeuger stream.
// The arrangement starts at beat 0 without count-in; the stream plays at latency 0 (Container core K7).
#pragma once

#include <string>

#include "arr_run.h"

namespace arr35 {

inline void strom_hoerbar(Lauf& x, int strom) {
  x.teil("pad/1/fader", 0.0f, 0.0, 0.0);
  {   // since K8 the default art is player: container C (pad/1) takes the module, otherwise the arrangement is not heard in C
    cdj::Befehl b = x.neu(cdj::Befehl::CONTAINER_QUELLE, "andreas");
    b.nr = 3;
    b.an = cdj::Kern::CONTAINER_ART_MODUL;
    x.sende(b);
  }
  const std::string spur = "{\"nr\":1,\"art\":\"intern\",\"quelle\":{\"art\":\"strom\",\"strom\":" + std::to_string(strom) +
                           "},\"ausgang\":{\"art\":\"gruppe\",\"nr\":1}}";
  const std::string text = "{\"format\":\"cypherdj-arr/4\",\"nr\":1,\"spuren\":[" + spur +
                           "],\"live\":true,\"gruppen\":[{\"nr\":1,\"ausgang\":{\"art\":\"dj\",\"nr\":3}}]}";
  x.ordner.roh(1, text);
  cdj::ArrLadeErgebnis e = cdj::lade_wiedergabe(x.ordner.pfad, 1, x.cache);
  PRUEF(e.snap != nullptr);
  if (!e.snap) return;
  cdj::Befehl b = x.neu(cdj::Befehl::ARR_LADEN, "andreas");
  b.zeiger = e.snap.release();
  b.arr_nr = 1;
  x.sende(b);
  x.start(0.0, 0);
}

}  // namespace arr35
