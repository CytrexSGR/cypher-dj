# AK33 G3: compact before/after table from ak33_g3_auswertung.py json files. usage: ak33_g3_tabelle.py <json>... ; per comparison: click 50 % (all beats), body 50 % on beats 2+4 and 1+3, and the click range over the thresholds.
import json, sys
print(f'{"run":34} {"click50 alle":>12} {"click25..75":>14} {"body50 2+4":>11} {"body50 1+3":>11}')
for f in sys.argv[1:]:
    d = json.load(open(f)); print(f'-- ref {d["ref"].split("/")[-1]}')
    for n, r in d['laeufe'].items():
        c = r['alle']; cl = [c[f'click 2-8k@{a}']['median'] for a in (25, 50, 75)]
        print(f'{n:34} {cl[1]:+12.2f} {min(cl):+7.2f}..{max(cl):+6.2f} {r["beat 2+4"]["body 100-600@50"]["median"]:+11.2f} {r["beat 1+3"]["body 100-600@50"]["median"]:+11.2f}')
