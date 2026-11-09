// Package 1.15 part B: the multiband compressor in the real-time path makes no allocation, no free and takes
// no mutex in 200 000 calls of verarbeite() with changing block lengths (1 .. kMaxFrames) and setze_band(),
// setze_grenzen() and the metering reads in between. Positive control first: the watcher sees a vector
// allocation, otherwise the zero would be worth nothing. Not built with ASan (ASan replaces malloc).
#include <cypherdj/dsp/multiband.h>

#include <cstdio>
#include <memory>
#include <vector>

#include "check.h"
#include "guard.h"

using namespace cypherdj::dsp;

int main() {
    waechter::nullen();
    waechter::an();
    { std::vector<float> v(1000); v[1] = 1.0f; }
    waechter::aus();
    std::printf("positive control: vector -> %ld allocations\n", waechter::allokationen());
    PRUEF(waechter::allokationen() >= 1);

    auto k = std::make_unique<MultibandKompressor>();
    std::vector<float> x(kMaxFrames), yl(kMaxFrames), yr(kMaxFrames);
    for (int i = 0; i < kMaxFrames; ++i) x[i] = static_cast<float>((i % 97) / 97.0 - 0.5);
    const int laengen[] = {256, 1, 17, 64, 255, 128, kMaxFrames};
    MbBandEinstellung e;
    e.schwelle_db = -20.0f;
    e.verhaeltnis = 4.0f;
    float summe = 0.0f;

    waechter::nullen();
    waechter::an();
    for (long i = 0; i < 200000; ++i) {
        const int n = laengen[i % 7];
        if (i % 50 == 0) {
            e.solo = (i / 50) % 3 == 0;
            e.umgehen = (i / 50) % 5 == 0;
            e.aufholen_db = static_cast<float>(i % 7);
            k->setze_band(static_cast<Band>(i % 3), e);
        }
        if (i % 1000 == 0) k->setze_grenzen(150.0 + static_cast<double>(i % 3) * 50.0, 2500.0);
        k->verarbeite(x.data(), x.data(), yl.data(), yr.data(), n);
        summe += k->aktuelle_absenkung_db(Band::mitte) + k->groesste_absenkung_db(Band::tief) + yl[0];
    }
    waechter::aus();
    std::printf("200000 calls: %ld allocations, %ld frees, %ld locks (sum %g)\n", waechter::allokationen(),
                waechter::freigaben(), waechter::sperren(), static_cast<double>(summe));
    PRUEF(waechter::allokationen() == 0);
    PRUEF(waechter::freigaben() == 0);
    PRUEF(waechter::sperren() == 0);
    return pruef::ende();
}
