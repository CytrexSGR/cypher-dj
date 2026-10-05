// Druckt die Reglertabelle als TSV für tests/regler_gegen_vertrag.py:
// pfad  einheit  min  max  vorgabe  schaltrampe_ms  form
#include <cypherdj/dsp/regler.h>

#include <cstdio>

int main() {
    using namespace cypherdj::dsp;
    const char* einheit[] = {"db", "schalter", "filter"};
    const char* form[] = {"s_kurve", "zweite_ordnung", "glaettung"};
    for (const ReglerInfo& r : kReglerInfo) {
        std::printf("%.*s\t%s\t%g\t%g\t%g\t%g\t%s\n", static_cast<int>(r.pfad.size()), r.pfad.data(),
                    einheit[static_cast<int>(r.einheit)], r.min, r.max, r.vorgabe, r.schaltrampe_ms,
                    form[static_cast<int>(r.form)]);
    }
    return 0;
}
