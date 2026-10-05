// Task 9: Abnahme „0 Allokationen in 10⁶ Prozessaufrufen“, dazu 0 Freigaben und 0 Mutex-Sperren.
// Im Fenster laufen verarbeite(), setze(), setze_sofort(), rampe() und verlauf() mit wechselnden
// Teilblocklängen und allen vier Send-Bussen. Vorher die Positiv-Kontrolle: der Wächter sieht eine
// Allokation und eine Sperre, sonst ist die Null nichts wert.
// Aufruf: test_waechter [1]   (1 = Mutationsbau, der je Aufruf allokiert: 1000 Aufrufe, muss > 0 zählen)
#include <cypherdj/dsp/kanalzug.h>

#include <cstdio>
#include <cstdlib>
#include <memory>
#include <mutex>
#include <vector>

#include "pruef.h"
#include "waechter.h"

using namespace cypherdj::dsp;

int main(int argc, char** argv) {
    const bool mutation = argc > 1 && std::atoi(argv[1]) == 1;
    // Positiv-Kontrolle des Instruments
    waechter::nullen();
    waechter::an();
    { std::vector<float> v(1000); v[1] = 1.0f; }
    waechter::aus();
    const long a0 = waechter::allokationen(), f0 = waechter::freigaben();
    waechter::nullen();
    std::mutex m;
    waechter::an();
    m.lock();
    m.unlock();
    waechter::aus();
    const long s0 = waechter::sperren();
    std::printf("Positiv-Kontrolle: vector → %ld Allokationen, %ld Freigaben; mutex → %ld Sperren\n", a0, f0, s0);
    PRUEF(a0 >= 1 && f0 >= 1 && s0 >= 1);

    // Aufbau außerhalb des Fensters
    auto kz = std::make_unique<Kanalzug>();
    kz->setze_sofort(Regler::trim, 0.0f);
    kz->setze_sofort(Regler::fader, 0.0f);
    std::vector<float> x(kMaxFrames), hl(kMaxFrames), hr(kMaxFrames);
    std::vector<std::vector<float>> bus(8, std::vector<float>(kMaxFrames, 0.0f));
    for (int i = 0; i < kMaxFrames; ++i) x[i] = static_cast<float>((i % 97) / 97.0 - 0.5);
    KanalzugAusgang aus;
    aus.haupt_l = hl.data();
    aus.haupt_r = hr.data();
    for (int s = 0; s < kAnzahlSends; ++s) { aus.send_l[s] = bus[2 * s].data(); aus.send_r[s] = bus[2 * s + 1].data(); }
    const int laengen[] = {256, 1, 17, 64, 255, 128, 1024};
    const long aufrufe = mutation ? 1000 : 1000000;
    std::vector<float> verlauf_eq(kMaxFrames);
    for (int i = 0; i < kMaxFrames; ++i) verlauf_eq[i] = -3.0f * static_cast<float>(i) / kMaxFrames;

    waechter::nullen();
    waechter::an();
    for (long a = 0; a < aufrufe; ++a) {
        switch (a % 400) {  // Befehle wie aus dem Stellwerk, alle Regler kommen dran
            case 0: kz->setze(Regler::kill_mitte, 1.0f); break;
            case 7: kz->setze(Regler::eq_tief, -26.0f); break;
            case 13: kz->rampe(Regler::fader, -12.0f, 3000, Form::s_kurve); break;
            case 29: kz->setze(Regler::filter, -0.7f); break;
            case 41: kz->rampe(Regler::send_1, 0.0f, 2000, Form::linear); break;
            case 53: kz->setze(Regler::send_4, -6.0f); break;
            case 67: kz->setze(Regler::trim, 4.0f); break;
            case 200: kz->setze(Regler::kill_mitte, 0.0f); break;
            case 207: kz->setze(Regler::eq_tief, 0.0f); break;
            case 213: kz->rampe(Regler::fader, 0.0f, 3000, Form::linear); break;
            case 229: kz->setze(Regler::filter, 0.4f); break;
            case 241: kz->setze(Regler::send_1, -200.0f); break;
            case 253: kz->setze_sofort(Regler::send_4, -200.0f); break;
            case 267: kz->setze(Regler::trim, 0.0f); break;
            case 300: kz->setze(Regler::filter, 0.0f); break;
            case 350: kz->verlauf(Regler::eq_mitte, verlauf_eq.data()); break;
            default: break;
        }
        kz->verarbeite(x.data(), x.data(), laengen[a % 7], aus);
    }
    waechter::aus();
    const long a1 = waechter::allokationen(), f1 = waechter::freigaben(), s1 = waechter::sperren();
    std::printf("%ld Prozessaufrufe: %ld Allokationen, %ld Freigaben, %ld Sperren\n", aufrufe, a1, f1, s1);
    if (mutation) {
        PRUEF(a1 >= aufrufe);   // Fehlerfall: die Mutation allokiert je Aufruf, der Wächter muss es sehen
    } else {
        PRUEF(a1 == 0);
        PRUEF(f1 == 0);
        PRUEF(s1 == 0);
    }
    return pruef::ende();
}
