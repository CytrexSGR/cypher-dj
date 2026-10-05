// K2 Review: die Faust-Hilfstypen (Meta, UI, FaustBasis) liegen in namespace cdjfaust und kollidieren nicht mit
// OpenSSLs `typedef struct ui_st UI;` (<openssl/ui.h>). Übersetzt nur, wenn beide Header in einer Einheit stehen dürfen.
#include <openssl/evp.h>
#include <openssl/ui.h>

#include "cypherdj/mixer.h"
#include "pruef.h"

int main() {
  UI* ssl_ui = nullptr;   // OpenSSLs UI (global)
  cdjfaust::UI faust_ui;  // Fausts Stub (Namensraum)
  PRUEF(ssl_ui == nullptr);
  PRUEF(faust_ui.zone("nichts") == nullptr);
  PRUEF_ENDE();
}
