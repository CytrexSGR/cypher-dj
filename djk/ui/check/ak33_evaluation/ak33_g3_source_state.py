# AK33 G3: where the engine put a clip against its marker map (export against the warped source). usage:
#   ak33_g3_source_state.py <source audio> <export.wav> --t0 <source s of clip beat 0> --bpm <source BPM of the straight line>   (a straight line map)
#   ak33_g3_source_state.py <source audio> <export.wav> --projekt <project.json> --spur s3                                       (the markers of the first clip of that track)
# --beat0 <n>: the clip beat that sits at export sample 0 (default 0; the jam's track clip c3 has versatz_beats 128 and start_beat 64, an export from project beat 64 starts at clip beat 128:
#   clip beat = project beat - start_beat + versatz_beats). Project tempo 128. Prints the lag in ms per window (positive = export later than the mapped source).
import json, sys
import numpy as np
import ak33_offset as v
a = sys.argv
xs, xe = v.lies(a[1]), v.lies(a[2])
if '--projekt' in a:
    p = json.load(open(a[a.index('--projekt') + 1])); s = next(s for s in p['spuren'] if s['id'] == a[a.index('--spur') + 1]); m = s['clips'][0]['warp']['marker']
    mk = np.array(json.loads(m) if isinstance(m, str) else m, float); f = lambda beat: np.interp(beat, mk[:, 1], mk[:, 0])
else:
    t0, bpm = float(a[a.index('--t0') + 1]), float(a[a.index('--bpm') + 1]); f = lambda beat: t0 + np.asarray(beat) * 60.0 / bpm
b0 = float(a[a.index('--beat0') + 1]) if '--beat0' in a else 0.0
g = f; f = lambda beat: g(np.asarray(beat) + b0)
lag = v.quell_lag(xs, xe, f, suche_ms=float(a[a.index('--suche-ms') + 1]) if '--suche-ms' in a else 50.0)
print(json.dumps({'export': a[2].split('/')[-1], 'lag_ms': [round(x, 2) for x in lag]}))
