// Container core K0: fixture of the production render oracle (tests/test_render_production_bit_exact.cpp is written in K3).
// Header-only (generate.h), no library: g++ -std=c++20 -O2 schreibe.cpp -o schreibe
//   schreibe aufbau <ordner>   writes <ordner>/audio/<sha>.f32 (two 8 s stereo files: a 220 Hz sine with a 3 Hz tremolo and a
//                              fixed xorshift noise) and <ordner>/wiedergabe-1.json from wiedergabe-1.json.vorlage
//   schreibe digest <datei.wav>  FNV-1a 64 over the float samples of a cypherdj-render WAV (58 byte header, f32 stereo,
//                              interleaved L0 R0 L1 R1 ...), printed as 0x%016llx
// Render command (base d65f349e0 and, after K3, the lane tree must give the same digests):
//   cypherdj-render --nr 1 --von-beat 0 --bis-beat 16 --bpm 120 --aus out.wav --arr-ordner <ordner> --ohne-zustand
//                   --spur-regler regler.json [--abgriff produktion|set]
// Content: two audio tracks into group 1 into the master (the PM chain), spur fader -2/-4 dB, track 2 pan 0.3 and clip gain -1.5 dB,
// group fader -3 dB, pm/fader -1 dB. 16 beats at 120 bpm = 8 s, no live flag.
#include "generate.h"

int main(int argc, char** argv) {
  if (argc == 3 && !std::strcmp(argv[1], "aufbau")) {
    const std::string self = argv[0];
    const std::string vorlage = self.substr(0, self.rfind('/') + 1) + "wiedergabe-1.json.vorlage";
    if (!schreibe_projekt(argv[2], vorlage)) {
      std::fprintf(stderr, "template not found: %s (call schreibe by a path in its own directory)\n", vorlage.c_str());
      return 1;
    }
    return 0;
  }
  if (argc == 3 && !std::strcmp(argv[1], "digest")) {
    std::ifstream in(argv[2], std::ios::binary);
    std::vector<char> b((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
    if (b.size() < 58) return 1;
    uint64_t h = 0xcbf29ce484222325ull;
    for (size_t i = 58; i < b.size(); ++i) {
      h ^= static_cast<uint8_t>(b[i]);
      h *= 0x100000001b3ull;
    }
    std::printf("0x%016llx frames %zu\n", static_cast<unsigned long long>(h), (b.size() - 58) / 8);
    return 0;
  }
  std::fprintf(stderr, "usage: schreibe aufbau <folder> | schreibe digest <file.wav>\n");
  return 2;
}
