# Prototype Traktor waveform (2026-09-27)

Throwaway template for spec `docs/specs/2026-09-27-djk-oberflaeche-kompakt-strudel-design.md` E4. Andreas: "awesome".

Regenerate (Adam Beyer: Antistius, 929d8039c3732eed):

    B=~/cypher-dj/bestand/929d8039c3732eed/fassungen/128000_r1/basis.f32
    djk/werkstatt/.venv/bin/python welle.py $B welle.bin      # 0.9 s, 90 463 Spalten zu 256 Frames
    ffmpeg -f f32le -ar 48000 -ac 2 -i $B -c:a libopus -b:a 160k ton.opus
    python3 -m http.server 8932 --bind 127.0.0.1

Measured (devtools, left monitor 2560×1297, 143 Hz, static): drawing p99 0.2 ms with tiles, before 2.5 ms column by column. Not measured during playback (new tiles then arise in the picture).
