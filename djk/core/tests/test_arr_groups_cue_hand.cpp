// Live modules task 6: the headphone cue of a group through the real hand path. A /k/teil on grp/<n>/cue with the source "andreas" goes through the Stellwerk, the Arrangement and the
// mixer PFL to the cue output of the whole kern and is audible there; any other source is refused (the row is hand only, nur_hand) and the cue bus stays silent. The block-level
// cases are in test_arr_groups_cue.cpp (its mutation builds link only the Arrangement, so this kern-level case lives in its own file).
#include <cmath>
#include <string>

#include "arr_run.h"

bool g_waechter = false;

static const double MITTE = 0.70710677;

int main() {
  {  // hand -> Stellwerk -> Arrangement -> mixer PFL -> cue output of the whole kern
    k35::Arbeitsbestand ab("test_arr_gruppen_cue_hand");
    arr35::Lauf x(ab.pfad, "test_arr_gruppen_cue_hand");
    const std::string au = x.ordner.audio('a', 400000, 0.25f);
    const std::string clip = x.ordner.clip("c1", 0.0, 8.0, au, 400000);
    x.lauf(4 * k35::N);
    x.laden2(1, "{\"nr\":1,\"art\":\"audio\",\"ausgang\":{\"art\":\"gruppe\",\"nr\":1},\"clips\":[" + clip + "]}", "{\"nr\":1,\"ausgang\":{\"art\":\"master\"}}");
    x.lauf(8 * k35::N);
    x.start(0.0, 0);
    x.teil("grp/1/cue", 1.0f, 0.0, 0.0, "pruefstand");   // refused: the row is hand only
    x.lauf(60 * k35::N);
    PRUEF(x.wert("grp/1/cue") == 0.0);
    PRUEF(arr35::Lauf::erster(x.l, 0, 60 * k35::N) >= 0);                 // the group sounds on the master (positive control)
    PRUEF(arr35::Lauf::erster(x.cue_l, 0, 60 * k35::N) == -1);            // and the cue bus is silent
    x.teil("grp/1/cue", 1.0f, 0.0, 0.0, "andreas");
    x.lauf(120 * k35::N);
    PRUEF(x.wert("grp/1/cue") == 1.0);
    const int64_t ec = arr35::Lauf::erster(x.cue_l, 60 * k35::N, 120 * k35::N);
    PRUEF(ec >= 0);
    if (ec >= 0) PRUEF_NAH(x.cue_l[ec + 2 * k35::N], 0.25 * MITTE * 0.25118864, 1e-4);   // the group signal (one track at 0.25 in the middle) at cue/pegel -12 dB, as in test_kern_arr case 7
  }
  PRUEF_ENDE();
}
