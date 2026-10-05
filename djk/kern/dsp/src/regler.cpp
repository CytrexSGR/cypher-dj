#include <cypherdj/dsp/regler.h>

namespace cypherdj::dsp {

std::optional<Regler> regler_aus_pfad(std::string_view teilpfad) {
    for (int i = 0; i < kAnzahlRegler; ++i) {
        if (kReglerInfo[i].pfad == teilpfad) return static_cast<Regler>(i);
    }
    return std::nullopt;
}

}  // namespace cypherdj::dsp
