#!/usr/bin/env python3
"""Regler-Tabelle des Stellwerks gegen INTERFACES.md §1.5 (Vertragstext): Pfade, Bereich, Vorgabe, Schaltrampe,
Wer darf. Vorher ein Selbsttest (Fehlerfall): derselbe Abgleich gegen einen im Speicher verfälschten Vertragstext
(Kill-Schaltrampe 5 -> 8 ms, Fader nur Hand) muss Abweichungen finden. Rückgabe 0 nur, wenn der Selbsttest rot und der
echte Abgleich grün ist und die Zahl der Pfade gleich ist.
Aufruf: regler_gegen_vertrag.py <stellwerk_regler_liste> <INTERFACES.md>

Festlegungen dieser Scheibe, die der Abgleich kennt: `10-ms-Blende` (ziel) und `sofort mit Überblendung`
(fx/<n>/notenwert) setzt das Stellwerk sofort (0 ms), die Blende macht der Mischer bzw. das Echo; `<k>` sind
deck/1..4, erz/1..8, pad/1..2, bus/1..4 (bus ohne ziel); fx/<n>/rueckkopplung nur für fx/1 und fx/2 (§1.5: für fx/3
und fx/4 gilt nur rueckweg).
"""
import re
import subprocess
import sys

SPUREN = [0]   # E3: Zahl der Spur-Slots, aus dem Vertragstext gelesen (`spur/<n>/*` ... n = 1 bis N), nicht fest verdrahtet
GRUPPEN = [0]   # 1.10: Zahl der Gruppen-Slots, aus dem Vertragstext gelesen (`grp/<n>/*` ... n = 1 bis N)
KANAELE = [f'deck/{i}' for i in range(1, 5)] + [f'erz/{i}' for i in range(1, 9)] + [f'pad/{i}' for i in (1, 2)] + \
          [f'bus/{i}' for i in range(1, 5)]
FX_N = {'rueckkopplung': (1, 2), 'rueckweg': (1, 2, 3, 4), 'notenwert': (1, 2)}


def zahl(t):
    t = t.strip().replace('−', '-').replace(',', '.').replace('+', '')
    m = re.match(r'^-?\d+(/\d+)?(\.\d+)?', t)
    if not m:
        return None
    s = m.group(0)
    if '/' in s:
        a, b = s.split('/')
        return float(a) / float(b)
    return float(s)


def bereich(zelle):
    z = zelle.replace('−', '-')
    if re.fullmatch(r'\s*0/1\s*', z):
        return 0.0, 1.0
    if 'bis' in z:
        lo, hi = z.split('bis', 1)
        return zahl(lo), zahl(re.sub(r'^[^-\d]*', '', hi.strip()))
    werte = [float(x) for x in re.findall(r'(-?\d+)\s*=', z)] + [float(x) for x in re.findall(r'bis (\d+)', z)]
    return min(werte), max(werte)


def ms(zelle):
    if 'Blende' in zelle or 'Überblendung' in zelle or zelle.strip().startswith('sofort'):
        return 0.0
    return zahl(zelle)


def pfade(zelle):
    roh = re.findall(r'`([^`]+)`', zelle)
    if ' bis ' in zelle and len(roh) == 2:              # `<k>/send/1` bis `/send/4`
        stamm, a = roh[0].rsplit('/', 1)
        roh = [f'{stamm}/{i}' for i in range(int(a), int(roh[1].rsplit('/', 1)[1]) + 1)]
    erste = roh[0]
    aus = []
    for p in roh:
        if p.startswith('/'):                            # `/eq/mitte` nach `<k>/eq/tief`, `/stem/bass` nach `deck/<n>/stem/drums`
            p = '/'.join(erste.split('/')[:-p.count('/')]) + p
        aus.append(p)
    return aus


def expandiere(p):
    if p.startswith('<k>/'):
        rest = p[4:]
        return [f'{k}/{rest}' for k in KANAELE if not (k.startswith('bus/') and (rest == 'ziel' or rest.startswith('komp/')))]
    if p.startswith('deck/<n>/'):
        return [f'deck/{i}/{p[9:]}' for i in range(1, 5)]
    if p.startswith('spur/<n>/'):                       # D1 K1: Spur-Regler des Arrangements, n = 1..32
        return [f'spur/{i}/{p[9:]}' for i in range(1, SPUREN[0] + 1)]
    if p.startswith('grp/<n>/'):                        # 1.10 Slice 1: Gruppen-Regler des Arrangements, n = 1..8
        return [f'grp/{i}/{p[8:]}' for i in range(1, GRUPPEN[0] + 1)]
    if p.startswith('fx/<n>/'):
        rest = p[7:]
        return [f'fx/{i}/{rest}' for i in FX_N[rest]]
    return [p]


def vertrag(text):
    ab = text.index('### 1.5 Kanäle und Regler-Pfade')
    bis = text.index('### 1.6', ab)
    m = re.search(r'`spur/<n>/\*`[^\n]*?n = 1 bis (\d+)', text[ab:bis])
    assert m, 'Vertrag §1.5: der Satz "`spur/<n>/*` (...n = 1 bis N)" fehlt'
    SPUREN[0] = int(m.group(1))   # Text sagt 8, Kern hat 32 Pfade: "im Stellwerk, nicht im Vertrag"; umgekehrt "fehlt im Stellwerk"
    mg = re.search(r'`grp/<n>/\*`[^\n]*?n = 1 bis (\d+)', text[ab:bis])
    assert mg, 'Vertrag §1.5: der Satz "`grp/<n>/*` (...n = 1 bis N)" fehlt'
    GRUPPEN[0] = int(mg.group(1))
    erg = {}
    for zeile in text[ab:bis].splitlines():
        if not zeile.startswith('| `'):
            continue
        z = [c.strip() for c in zeile.strip().strip('|').split('|')]
        lo, hi = bereich(z[2] if z[2] else z[1])
        vorgabe = zahl(z[3]) if zahl(z[3]) is not None else (0.0 if 'Busse 0' in z[3] else None)
        nur_hand_alle = z[5].startswith('nur Hand')
        for p in pfade(z[0]):
            for q in expandiere(p):
                nh = nur_hand_alle or (q.startswith('bus/') and q.endswith('/fader') and 'bus/<n>/fader` nur Hand' in z[5])
                erg[q] = (lo, hi, vorgabe, ms(z[4]), 1 if nh else 0)
    return erg


def bibliothek(programm):
    erg = {}
    for zeile in subprocess.run([programm], check=True, capture_output=True, text=True).stdout.splitlines():
        p, lo, hi, vg, m, nh = zeile.split('\t')
        erg[p] = (float(lo), float(hi), float(vg), float(m), int(nh))
    return erg


def abgleich(bib, ver):
    fehler = []
    for p, (lo, hi, vg, m, nh) in sorted(ver.items()):
        if p not in bib:
            fehler.append(f'{p}: steht im Vertrag, fehlt im Stellwerk')
            continue
        blo, bhi, bvg, bm, bnh = bib[p]
        if abs(blo - lo) > 1e-6 or abs(bhi - hi) > 1e-6:
            fehler.append(f'{p}: Bereich {blo}..{bhi}, Vertrag {lo}..{hi}')
        if vg is not None and abs(bvg - vg) > 1e-6:
            fehler.append(f'{p}: Vorgabe {bvg}, Vertrag {vg}')
        if abs(bm - m) > 0.01:
            fehler.append(f'{p}: Schaltrampe {bm} ms, Vertrag {m} ms')
        if bnh != nh:
            fehler.append(f'{p}: nur_hand {bnh}, Vertrag {nh}')
    for p in sorted(bib):
        if p not in ver:
            fehler.append(f'{p}: im Stellwerk, nicht im Vertrag')
    return fehler


def main():
    programm, pfad = sys.argv[1], sys.argv[2]
    text = open(pfad, encoding='utf-8').read()
    bib = bibliothek(programm)
    falsch = text.replace('| 5 ms, zweite Ordnung |', '| 8 ms, zweite Ordnung |').replace(
        '| 10 ms | alle; `bus/<n>/fader` nur Hand |', '| 10 ms | nur Hand |')
    assert falsch != text, 'Selbsttest: Zeilen im Vertrag nicht gefunden'
    f_falsch = abgleich(bib, vertrag(falsch))
    soll = {p for p in bib if '/kill/' in p} | {p for p in bib if p.endswith('/fader') and not p.startswith(('bus/', 'spur/', 'grp/', 'pm/'))}
    ist = {f.split(':')[0] for f in f_falsch}
    print(f'Selbsttest verfälschter Vertrag: {len(f_falsch)} Abweichungen, erwartet {len(soll)} (alle Kills, Fader außer Bus)')
    if ist != soll or len(f_falsch) != len(soll):
        print('FEHLER: der Abgleich sieht den verfälschten Vertrag nicht wie erwartet', sorted(ist ^ soll)[:5])
        return 1
    # Selbsttest 2 (E3 Review-Nachzug): sagt der Vertragstext „n = 1 bis 8“, muss der Abgleich die 96 Pfade der Slots 9 bis 32 melden
    acht = text.replace('n = 1 bis 32', 'n = 1 bis 8')
    assert acht != text, 'Selbsttest: Satz "n = 1 bis 32" im Vertrag nicht gefunden'
    f_acht = abgleich(bib, vertrag(acht))
    print(f'Selbsttest Vertragstext n = 1 bis 8: {len(f_acht)} Abweichungen, erwartet 96 (Slots 9 bis 32 mal 4 Regler)')
    if len(f_acht) != 96:
        print('FEHLER: der Abgleich liest den Bereich nicht aus dem Vertragstext')
        return 1
    # Selbsttest 3 (1.10): sagt der Vertragstext „n = 1 bis 4“ für die Gruppen, muss der Abgleich die 16 Pfade der Gruppen 5 bis 8 melden
    satz = '`grp/<n>/*` (1.10, ADR 033, n = 1 bis 8)'
    assert satz in text, 'Selbsttest: Satz der Gruppen-Regler im Vertrag nicht gefunden'
    f_vier = abgleich(bib, vertrag(text.replace(satz, satz.replace('n = 1 bis 8', 'n = 1 bis 4'))))
    print(f'Selbsttest Vertragstext Gruppen n = 1 bis 4: {len(f_vier)} Abweichungen, erwartet 16 (Gruppen 5 bis 8 mal 4 Regler)')
    if len(f_vier) != 16:
        print('FEHLER: der Abgleich liest die Gruppenzahl nicht aus dem Vertragstext')
        return 1
    ver = vertrag(text)
    fehler = abgleich(bib, ver)
    for f in fehler:
        print('ABWEICHUNG', f)
    print(f'Vertrag §1.5: {len(ver)} Pfade, Stellwerk: {len(bib)} Pfade, {len(fehler)} Abweichungen')
    return 1 if fehler or len(ver) != len(bib) else 0


if __name__ == '__main__':
    sys.exit(main())
