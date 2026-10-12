"""Ohr-Vergleich: Andreas hört blind zwei Ausschnitte und sagt, welcher mehr zieht (Paarvergleich).

Zweck (Andreas 2026-10-10, „ok machen wir das"): eine Energie-Skala nach SEINEM Ohr statt nach MIK. Paarurteile
sind verlässlicher als Noten 1..10; Bradley-Terry macht daraus eine Skala. Danach lernt energie_modell aus denselben
Merkmalen (cues/merkmale) dieses Ziel statt MIK.

Pool:     die Tracks mit fertigen Merkmalen (cues/merkmale/labels.csv), gestreut über die MIK-Stufen.
Ausschnitt: 30 s ab 45 % der Dauer, auf -14 LUFS normalisiert (der Pegel soll nicht entscheiden; Vorobyev:
            „The volume isn't the issue"). Blind: Seite zeigt weder Titel noch MIK noch unseren Wert.
Ablage:   cues/merkmale/ohr/ (pool.json, urteile.jsonl, clips/). Nur stdlib + ffmpeg, kein Ton auf dem Desktop.

Aufruf:   python3 -m tonart_energie.ohr_vergleich dienen [--port 8799]    (aus djk/)
          python3 -m tonart_energie.ohr_vergleich auswerten

RUNDE 2 (Andreas 2026-10-10 nach Runde 1: „hard techno und house gemischt" · „mehrfach die breaks der tracks drin,
wie willst du da was hören"; gemessen: in 11 von 14 entschiedenen Paaren gewann der schnellere Track). Darum:
10 feste Paare, gleiches Genre, BPM-Abstand <= 6, MIK-Stufen verschieden; beide Ausschnitte per `rubberband -3`
(wie werkstatt/warp.py) auf das gemeinsame Tempo gestreckt, Tonhöhe bleibt; Ausschnitt = das Fenster mit der
durchgehendsten Kick (20.-Perzentil des Pegels unter 120 Hz, Ränder 10 % ausgenommen), also kein Break.
          ~/cypher-dj/cues/venv-mik/bin/python -m tonart_energie.ohr_vergleich dienen --runde 2   (braucht numpy)
          python3 -m tonart_energie.ohr_vergleich auswerten --runde 2
"""
from __future__ import annotations

import argparse
import csv
import http.server
import json
import math
import random
import subprocess
import threading
import time
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import parse_qs, urlparse

CACHE = Path.home() / "cypher-dj/cues/merkmale"
ABLAGE = CACHE / "ohr"
CLIPS = ABLAGE / "clips"
POOL = ABLAGE / "pool.json"
URTEILE = ABLAGE / "urteile.jsonl"
JE_STUFE_MAX = 60
CLIP_S = 30
CLIP_START = 0.45
LUFS = -14
R2 = ABLAGE / "runde2"
R2_PAARE = R2 / "paare.json"
R2_URTEILE = R2 / "urteile.jsonl"
R2_ANZAHL = 10
R2_BPM_ABSTAND = 6


def baue_pool() -> list[dict]:
    if POOL.exists():
        return json.loads(POOL.read_text())
    zeilen = list(csv.DictReader(open(CACHE / "labels.csv")))
    rnd = random.Random(20261010)
    rnd.shuffle(zeilen)
    zaehl: Counter = Counter()
    pool = []
    for z in sorted(zeilen, key=lambda z: z["energy"]):
        if not z["energy"] or not Path(z["pfad"]).exists() or zaehl[z["energy"]] >= JE_STUFE_MAX:
            continue
        zaehl[z["energy"]] += 1
        pool.append({"id": z["id"], "pfad": z["pfad"], "dauer": float(z["dauer_s"]), "mik": int(z["energy"])})
    ABLAGE.mkdir(parents=True, exist_ok=True)
    POOL.write_text(json.dumps(pool, ensure_ascii=False, indent=1))
    return pool


def clip(t: dict) -> Path:
    ziel = CLIPS / f"{t['id']}.mp3"
    if ziel.exists():
        return ziel
    CLIPS.mkdir(parents=True, exist_ok=True)
    start = max(0.0, min(t["dauer"] * CLIP_START, t["dauer"] - CLIP_S))
    tmp = ziel.with_suffix(".tmp.mp3")
    subprocess.run(["nice", "-n", "15", "ffmpeg", "-v", "error", "-y", "-ss", f"{start:.2f}", "-t", str(CLIP_S),
                    "-i", t["pfad"], "-af", f"loudnorm=I={LUFS}:TP=-1.5:LRA=11,afade=t=in:d=0.3,"
                    f"afade=t=out:st={CLIP_S - 0.5}:d=0.5", "-ar", "44100", "-ac", "2", "-b:a", "192k", str(tmp)],
                   check=True)
    tmp.rename(ziel)
    return ziel


def lies_urteile(datei: Path = URTEILE) -> list[dict]:
    if not datei.exists():
        return []
    return [json.loads(z) for z in datei.open() if z.strip()]


def hauptteil_start(pfad: str, laenge_s: float) -> float:
    """Start des Fensters (laenge_s, Quellzeit) mit der durchgehendsten Kick: 20.-Perzentil des Sekundenpegels
    unter 120 Hz, maximal. Ein Break hat keine Kick, sein Fenster verliert. Ränder (10 %) zählen nicht."""
    import numpy as np
    sr = 4000
    roh = subprocess.run(["ffmpeg", "-v", "error", "-i", pfad, "-af", "lowpass=f=120,lowpass=f=120", "-ac", "1",
                          "-ar", str(sr), "-f", "f32le", "-"], capture_output=True, check=True).stdout
    x = np.frombuffer(roh, dtype=np.float32)
    sek = len(x) // sr
    pegel = np.sqrt(np.mean(x[:sek * sr].reshape(sek, sr) ** 2, axis=1))
    lang = int(math.ceil(laenge_s))
    von, bis = int(sek * 0.1), int(sek * 0.9) - lang
    if bis <= von:
        return max(0.0, (sek - laenge_s) / 2)
    guete = [np.percentile(pegel[s:s + lang], 20) for s in range(von, bis + 1)]
    return float(von + int(np.argmax(guete)))


def clip_r2(t: dict, ziel_bpm: float) -> Path:
    """30 s Ausgabe im Zieltempo: Quellfenster 30·ziel/quell s aus dem Hauptteil, rubberband -3 auf ziel_bpm, -14 LUFS."""
    ziel = R2 / "clips" / f"{t['id']}_{ziel_bpm:g}.mp3"
    if ziel.exists():
        return ziel
    ziel.parent.mkdir(parents=True, exist_ok=True)
    quell_s = CLIP_S * ziel_bpm / t["bpm"]
    start = hauptteil_start(t["pfad"], quell_s)
    roh, gestreckt = ziel.with_suffix(".roh.wav"), ziel.with_suffix(".str.wav")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{start:.2f}", "-t", f"{quell_s:.3f}", "-i", t["pfad"],
                    "-ar", "44100", "-ac", "2", str(roh)], check=True)
    subprocess.run(["nice", "-n", "15", "rubberband", "-3", "-q", "-T", f"{ziel_bpm / t['bpm']:.6f}", str(roh),
                    str(gestreckt)], check=True, capture_output=True)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(gestreckt), "-af",
                    f"loudnorm=I={LUFS}:TP=-1.5:LRA=11,afade=t=in:d=0.3,afade=t=out:st={CLIP_S - 0.5}:d=0.5",
                    "-t", str(CLIP_S), "-b:a", "192k", str(ziel)], check=True)
    roh.unlink()
    gestreckt.unlink()
    return ziel


def baue_runde2() -> list[dict]:
    """10 feste Paare: gleiches Genre, BPM-Abstand <= 6, MIK verschieden, jeder Track nur einmal, keiner aus Runde 1."""
    if R2_PAARE.exists():
        return json.loads(R2_PAARE.read_text())
    runde1 = {i for u in lies_urteile() for i in (u["a"], u["b"])}
    zeilen = [z for z in csv.DictReader(open(CACHE / "labels.csv"))
              if z["energy"] and z["tbpm"] and z["genre"] and z["id"] not in runde1 and Path(z["pfad"]).exists()]
    rnd = random.Random(20261010)
    rnd.shuffle(zeilen)
    je_genre: dict = defaultdict(list)
    for z in zeilen:
        je_genre[z["genre"]].append(z)
    benutzt, paare = set(), []
    # reihum über die Genres, damit nicht alle 10 Paare aus dem größten Topf kommen
    while len(paare) < R2_ANZAHL:
        vorher = len(paare)
        for genre in sorted(je_genre, key=lambda g: -len(je_genre[g])):
            frei = [z for z in je_genre[genre] if z["id"] not in benutzt]
            gefunden = next(((a, b) for i, a in enumerate(frei) for b in frei[i + 1:]
                             if a["energy"] != b["energy"] and abs(float(a["tbpm"]) - float(b["tbpm"])) <= R2_BPM_ABSTAND),
                            None)
            if gefunden and len(paare) < R2_ANZAHL:
                a, b = gefunden if rnd.random() < 0.5 else gefunden[::-1]
                benutzt |= {a["id"], b["id"]}
                ziel_bpm = round((float(a["tbpm"]) + float(b["tbpm"])) / 2)
                paare.append({"nr": len(paare) + 1, "genre": genre, "ziel_bpm": ziel_bpm, **{
                    k: {"id": z["id"], "pfad": z["pfad"], "bpm": float(z["tbpm"]), "mik": int(z["energy"])}
                    for k, z in (("a", a), ("b", b))}})
        if len(paare) == vorher:
            break
    R2.mkdir(parents=True, exist_ok=True)
    R2_PAARE.write_text(json.dumps(paare, ensure_ascii=False, indent=1))
    return paare


class Paarwahl:
    """Nächstes Paar: der am wenigsten verglichene Track gegen einen ebenfalls wenig verglichenen, kein Paar doppelt."""

    def __init__(self, pool: list[dict]):
        self.pool = {t["id"]: t for t in pool}
        self.lock = threading.Lock()
        self.rnd = random.Random()

    def naechstes(self) -> tuple[str, str]:
        with self.lock:
            urteile = lies_urteile()
            n: Counter = Counter({i: 0 for i in self.pool})
            gesehen = set()
            for u in urteile:
                n[u["a"]] += 1
                n[u["b"]] += 1
                gesehen.add(frozenset((u["a"], u["b"])))
            ids = sorted(self.pool, key=lambda i: (n[i], self.rnd.random()))
            a = ids[0]
            for b in ids[1:]:
                if frozenset((a, b)) not in gesehen:
                    return (a, b) if self.rnd.random() < 0.5 else (b, a)
            return a, ids[1]


SEITE = """<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Energy by ear</title><style>
:root{--bg:#111;--fg:#eee;--dim:#888;--a:#e0a030;--b:#40a0e0;--ok:#5c5}
body{background:var(--bg);color:var(--fg);font:16px system-ui,sans-serif;margin:0;display:flex;justify-content:center}
main{max-width:640px;width:100%;padding:24px 16px}
h1{font-size:20px;margin:0 0 4px}.dim{color:var(--dim);font-size:14px}
.paar{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:24px 0}
.kachel{border:2px solid #333;border-radius:10px;padding:18px;text-align:center;cursor:pointer;user-select:none}
.kachel.spielt{border-color:var(--fg)}#ka .t{color:var(--a)}#kb .t{color:var(--b)}
.t{font-size:40px;font-weight:700}.zeit{height:4px;background:#333;margin-top:12px;border-radius:2px}
.zeit i{display:block;height:100%;width:0;background:var(--fg);border-radius:2px}
.knoepfe{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px}
button{font:inherit;padding:14px;border-radius:8px;border:1px solid #444;background:#222;color:var(--fg);cursor:pointer}
button:disabled{opacity:.35;cursor:default}#ba{border-color:var(--a)}#bb{border-color:var(--b)}
#skip{grid-column:1/4;background:none;border:none;color:var(--dim)}
kbd{border:1px solid #555;border-radius:3px;padding:0 4px;font-size:12px;color:var(--dim)}
</style></head><body><main>
<h1>Which one drives harder?</h1>
<div class="dim">Blind. Same loudness. 30 s each. Listen to both, then decide. Judged: <b id="n">0</b></div>
<div class="paar">
 <div class="kachel" id="ka"><div class="t">A</div><div class="dim"><kbd>Q</kbd> play</div><div class="zeit"><i id="za"></i></div></div>
 <div class="kachel" id="kb"><div class="t">B</div><div class="dim"><kbd>W</kbd> play</div><div class="zeit"><i id="zb"></i></div></div>
</div>
<div class="knoepfe">
 <button id="ba" disabled>A drives more <kbd>1</kbd></button>
 <button id="bg" disabled>Same <kbd>2</kbd></button>
 <button id="bb" disabled>B drives more <kbd>3</kbd></button>
 <button id="skip">skip pair <kbd>0</kbd></button>
</div>
<p class="dim">Space switches between A and B at the same position. Buttons unlock once both were played.</p>
</main><script>
const A=new Audio(),B=new Audio();let paar=null,t0=0,gehoert={a:false,b:false},wechsel=0;
const $=i=>document.getElementById(i);
async function lade(){const r=await (await fetch('paar')).json();paar=r;$('n').textContent=r.gesamt?r.n+' of '+r.gesamt:r.n;
 if(r.fertig){paar=null;document.querySelector('main').innerHTML='<h1>Done, thank you.</h1><p class="dim">'+r.n+' pairs judged.</p>';return;}
 A.src='clip/'+r.a;B.src='clip/'+r.b;gehoert={a:false,b:false};wechsel=0;sperre();t0=Date.now();markiere();}
function sperre(){const ok=gehoert.a&&gehoert.b;['ba','bg','bb'].forEach(i=>$(i).disabled=!ok);}
function markiere(){$('ka').classList.toggle('spielt',!A.paused);$('kb').classList.toggle('spielt',!B.paused);}
function spiel(x){const ich=x==='a'?A:B,du=x==='a'?B:A;if(!ich.paused){ich.pause();markiere();return;}
 if(!du.paused){ich.currentTime=du.currentTime;du.pause();wechsel++;}ich.play();gehoert[x]=true;sperre();markiere();}
function zeit(){$('za').style.width=(A.currentTime/30*100)+'%';$('zb').style.width=(B.currentTime/30*100)+'%';requestAnimationFrame(zeit)}
async function urteil(w){if(!paar)return;if(w!=='skip'&&!(gehoert.a&&gehoert.b))return;A.pause();B.pause();
 await fetch('urteil',{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({a:paar.a,b:paar.b,sieger:w,dauer_ms:Date.now()-t0,wechsel})});lade();}
$('ka').onclick=()=>spiel('a');$('kb').onclick=()=>spiel('b');
$('ba').onclick=()=>urteil('a');$('bb').onclick=()=>urteil('b');$('bg').onclick=()=>urteil('gleich');$('skip').onclick=()=>urteil('skip');
A.onended=B.onended=markiere;
document.onkeydown=e=>{const k=e.key.toLowerCase();if(k==='q')spiel('a');else if(k==='w')spiel('b');
 else if(k===' '){e.preventDefault();spiel(A.paused&&!B.paused?'a':(!A.paused?'b':'a'));}
 else if(k==='1')urteil('a');else if(k==='2')urteil('gleich');else if(k==='3')urteil('b');else if(k==='0')urteil('skip');};
zeit();lade();
</script></body></html>"""


def dienen(port: int, runde: int = 1) -> None:
    schreib = threading.Lock()
    vorab = ThreadPoolExecutor(max_workers=2)   # Ausschnitte vorab rendern, nice: die Seite soll nie warten
    if runde == 1:
        pool = baue_pool()
        nach_id = {t["id"]: t for t in pool}
        wahl = Paarwahl(pool)
        datei = URTEILE
        for t in pool:
            vorab.submit(clip, t)

        def paar_json() -> dict:
            a, b = wahl.naechstes()
            return {"a": a, "b": b, "n": sum(1 for u in lies_urteile(datei) if u["sieger"] != "skip")}

        def clip_fuer(k: str):
            return clip(nach_id[k]) if k in nach_id else None
    else:
        paare = baue_runde2()
        datei = R2_URTEILE
        schluessel = {f"{p['nr']}{s}": (p[s], p["ziel_bpm"]) for p in paare for s in "ab"}
        for t, bpm in schluessel.values():
            vorab.submit(clip_r2, t, bpm)

        def paar_json() -> dict:
            erledigt = {u["a"] for u in lies_urteile(datei)}
            offen = [p for p in paare if f"{p['nr']}a" not in erledigt]
            n = len(paare) - len(offen)
            if not offen:
                return {"fertig": True, "n": n, "gesamt": len(paare)}
            return {"a": f"{offen[0]['nr']}a", "b": f"{offen[0]['nr']}b", "n": n, "gesamt": len(paare)}

        def clip_fuer(k: str):
            return clip_r2(*schluessel[k]) if k in schluessel else None
        nach_id = schluessel

    class H(http.server.BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def antwort(self, code: int, typ: str, daten: bytes) -> None:
            self.send_response(code)
            self.send_header("content-type", typ)
            self.send_header("content-length", str(len(daten)))
            self.send_header("cache-control", "no-store")
            self.end_headers()
            self.wfile.write(daten)

        def do_GET(self):
            p = urlparse(self.path).path
            if p == "/":
                return self.antwort(200, "text/html; charset=utf-8", SEITE.encode())
            if p == "/paar":
                return self.antwort(200, "application/json", json.dumps(paar_json()).encode())
            if p.startswith("/clip/") and p[6:] in nach_id:
                return self.antwort(200, "audio/mpeg", clip_fuer(p[6:]).read_bytes())
            self.antwort(404, "text/plain", b"not found")

        def do_POST(self):
            if urlparse(self.path).path != "/urteil":
                return self.antwort(404, "text/plain", b"not found")
            d = json.loads(self.rfile.read(int(self.headers.get("content-length", 0))))
            if d.get("a") not in nach_id or d.get("b") not in nach_id or d.get("sieger") not in ("a", "b", "gleich", "skip"):
                return self.antwort(400, "text/plain", b"bad request")
            z = {"zeit": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "a": d["a"], "b": d["b"], "sieger": d["sieger"],
                 "dauer_ms": int(d.get("dauer_ms", 0)), "wechsel": int(d.get("wechsel", 0))}
            with schreib, datei.open("a") as f:
                f.write(json.dumps(z) + "\n")
            self.antwort(200, "application/json", b'{"ok":true}')

    srv = http.server.ThreadingHTTPServer(("127.0.0.1", port), H)
    print(f"Ohr-Vergleich Runde {runde}: http://127.0.0.1:{port}/  Urteile {datei}", flush=True)
    srv.serve_forever()


def bradley_terry(ids: list[str], urteile: list[dict], iterationen: int = 500) -> dict[str, float]:
    """MM-Verfahren (Hunter 2004); „gleich" zählt je halb als Sieg. Leichte Regularisierung gegen Tracks ohne Niederlage."""
    siege: dict = defaultdict(float)
    paare: dict = defaultdict(float)
    for u in urteile:
        if u["sieger"] == "skip":
            continue
        a, b = u["a"], u["b"]
        paare[(a, b)] += 1
        paare[(b, a)] += 1
        if u["sieger"] == "a":
            siege[a] += 1
        elif u["sieger"] == "b":
            siege[b] += 1
        else:
            siege[a] += 0.5
            siege[b] += 0.5
    beteiligt = sorted({i for (i, _) in paare})
    s = {i: 1.0 for i in beteiligt}
    for _ in range(iterationen):
        neu = {}
        for i in beteiligt:
            nenner = sum(n / (s[i] + s[j]) for (k, j), n in paare.items() if k == i) + 1.0 / (s[i] + 1.0)
            neu[i] = (siege[i] + 0.5) / nenner
        g = math.exp(sum(math.log(v) for v in neu.values()) / len(neu))
        s = {i: v / g for i, v in neu.items()}
    return {i: math.log(v) for i, v in s.items()}


def spearman(x: list[float], y: list[float]) -> float:
    def raenge(v):
        o = sorted(range(len(v)), key=lambda i: v[i])
        r = [0.0] * len(v)
        i = 0
        while i < len(o):
            j = i
            while j + 1 < len(o) and v[o[j + 1]] == v[o[i]]:
                j += 1
            for k in range(i, j + 1):
                r[o[k]] = (i + j) / 2
            i = j + 1
        return r
    rx, ry = raenge(x), raenge(y)
    mx, my = sum(rx) / len(rx), sum(ry) / len(ry)
    sxy = sum((a - mx) * (b - my) for a, b in zip(rx, ry))
    sx = math.sqrt(sum((a - mx) ** 2 for a in rx))
    sy = math.sqrt(sum((b - my) ** 2 for b in ry))
    return sxy / (sx * sy) if sx and sy else float("nan")


def auswerten() -> None:
    pool = {t["id"]: t for t in baue_pool()}
    urteile = lies_urteile()
    gueltig = [u for u in urteile if u["sieger"] != "skip"]
    print(f"Urteile: {len(gueltig)} (dazu {len(urteile) - len(gueltig)} übersprungen), "
          f"gleich: {sum(u['sieger'] == 'gleich' for u in gueltig)}")
    # Wie oft stimmt das Ohr mit MIK überein, wo MIK einen Unterschied sieht?
    mit_diff = [u for u in gueltig if u["sieger"] != "gleich" and pool[u["a"]]["mik"] != pool[u["b"]]["mik"]]
    if mit_diff:
        ja = sum((pool[u["a"]]["mik"] > pool[u["b"]]["mik"]) == (u["sieger"] == "a") for u in mit_diff)
        print(f"Ohr = MIK-Richtung: {ja}/{len(mit_diff)} = {ja / len(mit_diff):.0%} (Zufall 50 %)")
    skala = bradley_terry(list(pool), gueltig)
    if len(skala) >= 5:
        ids = sorted(skala)
        print(f"Spearman Ohr-Skala ↔ MIK: {spearman([skala[i] for i in ids], [pool[i]['mik'] for i in ids]):.2f} "
              f"(n={len(ids)} Tracks)")
    (ABLAGE / "skala.json").write_text(json.dumps(skala, indent=1))


def auswerten_r2() -> None:
    paare = {f"{p['nr']}a": p for p in baue_runde2()}
    for u in lies_urteile(R2_URTEILE):
        p = paare[u["a"]]
        mik = "A" if p["a"]["mik"] > p["b"]["mik"] else "B"
        ohr = {"a": "A", "b": "B", "gleich": "=", "skip": "-"}[u["sieger"]]
        print(f"{p['nr']:2} {p['genre'][:22]:22} {p['ziel_bpm']:>3} BPM  MIK {p['a']['mik']}:{p['b']['mik']} → {mik}  "
              f"Ohr {ohr}  {'✓' if ohr == mik else ('·' if ohr in '=-' else '✗')}")
    entschieden = [u for u in lies_urteile(R2_URTEILE) if u["sieger"] in ("a", "b")]
    ja = sum((paare[u["a"]]["a"]["mik"] > paare[u["a"]]["b"]["mik"]) == (u["sieger"] == "a") for u in entschieden)
    if entschieden:
        print(f"Ohr = MIK: {ja}/{len(entschieden)}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("was", choices=["dienen", "auswerten"])
    ap.add_argument("--port", type=int, default=8799)
    ap.add_argument("--runde", type=int, default=1, choices=[1, 2])
    a = ap.parse_args()
    if a.was == "dienen":
        dienen(a.port, a.runde)
    else:
        auswerten() if a.runde == 1 else auswerten_r2()


if __name__ == "__main__":
    main()
