// K2 Slice 3: Summen-Kleber. Snoman/Katz: höchstens 2:1, langsamer Attack. master/kleber stellt die SCHWELLE (Mixer:
// schwelle = +6 - 36 * master/kleber in dB auf dem Detektor |L|+|R|; 0 = aus = +60, unerreichbar), keine Parallelmischung.
import("stdfaust.lib");
schwelle = hslider("schwelle", 60, -30, 60, 0.1) : si.smoo;   // Detektor |L|+|R|: -6 hier = -12 dBFS je Kanal (Plan-Review M6)
process = co.compressor_stereo(2, schwelle, 0.03, 0.2);
