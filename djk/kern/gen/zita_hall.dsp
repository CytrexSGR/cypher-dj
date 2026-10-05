// K2 Slice 2: Hall für den Send/Return fx/2. re.zita_rev1_stereo(rdel ms, f1 Hz, f2 Hz, t60dc s, t60m s, fsmax)
// Werte: 20 ms Vorverzögerung, Übergänge 200 Hz / 6 kHz, Nachhall tief 3 s, mitte 2 s (Recherche C, gemessen 6,3 µs/Block)
import("stdfaust.lib");
process = re.zita_rev1_stereo(20, 200, 6000, 3, 2, 48000);
