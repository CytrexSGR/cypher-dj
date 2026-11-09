// Paket K3 (Spec D1 2.5): WAV 48 kHz, 32 bit float, Stereo (WAVE_FORMAT_IEEE_FLOAT 3, fmt 18 Bytes, fact, data mit L und
// R verschränkt). Schreiben als <pfad>.<pid>.teil plus Umbenennen, das nie ersetzt (Fix L9, wie der Freeze nach Spec
// 6.25: renameat2 RENAME_NOREPLACE, sonst link() + unlink()); besteht das Ziel, false mit *besteht = true. Lesen nur genau
// dieses Format. Nicht im Callback.
#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace cdj {

// Fix L3: der Kopf trägt Längen als u32. RIFF-Größe 50 + 8 · frames ≤ 2^32 − 1, also höchstens 536 870 905 Frames
// (rund 3 h 6 min bei 48 kHz); darüber lehnt schreibe_wav_f32 ab, statt den Kopf überlaufen zu lassen.
constexpr int64_t WAV_F32_MAX_FRAMES = (0xFFFFFFFFLL - 50) / 8;

bool schreibe_wav_f32(const std::string& pfad, const std::vector<float>& l, const std::vector<float>& r,
                      std::string& fehler, bool* besteht = nullptr);
bool lies_wav_f32(const std::string& pfad, std::vector<float>& l, std::vector<float>& r, std::string& fehler);

}  // namespace cdj
