# AK33 G3: true tempo of the track from the drift of its kicks against the stored warp markers (the 126.9946 BPM line).
# usage: ak33_g3_tempo.py <audio> <project.json> <spur id> [--bpm-grid 127.0]   (the markers of the first clip of that track are the grid; --bpm-grid replaces them by a straight line
#        of that tempo through the first marker: the control "grid at the claimed true tempo")
import json, sys
import numpy as np
import ak33_versatz as v

audio, projekt, spur = sys.argv[1:4]
p = json.load(open(projekt)); s = next(s for s in p['spuren'] if s['id'] == spur)
mk = np.array(json.loads(s['clips'][0]['warp']['marker']) if isinstance(s['clips'][0]['warp']['marker'], str) else s['clips'][0]['warp']['marker'], float)
g = mk[:, 0]
if '--bpm-grid' in sys.argv: g = g[0] + np.arange(len(g)) * 60.0 / float(sys.argv[sys.argv.index('--bpm-grid') + 1])
r = v.tempo_schaetzung(v.lies(audio), g)
print(json.dumps({k: (list(map(float, x)) if isinstance(x, tuple) else x) for k, x in r.items()}, indent=1))
