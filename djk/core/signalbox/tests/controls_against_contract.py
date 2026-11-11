#!/usr/bin/env python3
"""Regler-Tabelle des Stellwerks gegen INTERFACES.md §1.5 (Vertragstext): Pfade, Bereich, Vorgabe, Schaltrampe,
Wer darf. Vorher ein Selbsttest (Fehlerfall): derselbe Abgleich gegen einen im Speicher verfälschten Vertragstext
(Kill-Schaltrampe 5 -> 8 ms, Fader nur Hand) muss Abweichungen finden. Rückgabe 0 nur, wenn der Selbsttest rot und der
echte Abgleich grün ist und die Zahl der Pfade gleich ist.
Aufruf: controls_against_contract.py <stellwerk_regler_liste> <INTERFACES.md>

Festlegungen dieser Scheibe, die der Abgleich kennt: `10-ms-Blende` (ziel) und `sofort mit Überblendung`
(fx/<n>/notenwert) setzt das Stellwerk sofort (0 ms), die Blende macht der Mischer bzw. das Echo; `<k>` sind
deck/1..4, erz/1..8, pad/1..2, bus/1..4 (bus ohne ziel); fx/<n>/rueckkopplung nur für fx/1 und fx/2 (§1.5: für fx/3
und fx/4 gilt nur rueckweg).

S14: the row `<k>/bk/<n>` does NOT expand over all channels: it expands over the channel list of its own "Wer darf" cell
(deck/1..4, erz/1, 2, 3, 5, 6, 7 and pad/1, 2) with n = 1 to N read from the row. The row `fx/<n>/bk/<m>` (S14) expands over the
n and m it names (fx/3, fx/4, m = 1 to 8). Both counts are asserted to be 8 (the Baukasten library has eight knobs). Before this
repair the checker expanded `<k>/bk/<n>` over all 18 channels with a literal `<n>` and was red (measured at origin/main aa95b5f9).

1.15 A1b (mix tools): the rows `<k>/gate/*`, `<k>/util/*`, `bus/<n>/mb/*`, `bus/<n>/lim/*` do NOT expand over all channels: they expand over
the channel list of their own "Wer darf" cell ("alle; nur Quellkanäle ausser erz/8" = deck/1..4, erz/1..7, pad/1..2; "alle; Quellkanäle ausser
erz/8 und Busse" = those plus bus/1..4; "alle; nur Busse" = bus/1..4), the same pattern as `<k>/bk/<n>`. `<b>` in a multiband row expands over the
bands named in its first cell ("b = tief, mitte, hoch"). The total is asserted to be 345 (117 + 119 + 96 + 12 + 1) in the contract and in the
table, classified by the five hand regexes of INTERFACES section 1.5 (an exact set, not a prefix). `spektrum/kanal` is a plain path.
"""
import re
import subprocess
import sys

SPUREN = [0]   # E3: Zahl der Spur-Slots, aus dem Vertragstext gelesen (`spur/<n>/*` ... n = 1 bis N), nicht fest verdrahtet
GRUPPEN = [0]   # 1.10: Zahl der Gruppen-Slots, aus dem Vertragstext gelesen (`grp/<n>/*` ... n = 1 bis N)
RACKS = [0]   # 1.10 slice 4c: number of racks, read from the contract text (`rack/<k>/m<n>` (k = 1 to N; ...); 4 macro rows each
INSERTS = {'komp': 0, 'eq': 0, 'saett': 0, 'lim': 0, 'host': 0, 'utility': 0, 'bk': 0}   # 1.10 slice 4a/4b: pool size per insert kind, read from the contract text (`ins/<art>/<n>/*` ... n = 1 to N)
RETURNS = [0]   # 1.10 Slice 3: Zahl der Returns, aus dem Vertragstext gelesen (`ret/<r>/*` ... r = 1 to N)
BK_KNOEPFE = 8  # S14: graph knobs per channel / per send return (`regler nr 1..8` of the Baukasten library)
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
    z = zelle.replace('−', '-').replace(' to ', ' bis ')   # 1.10 Slice 3 rows are written in English ("-200 to +6")
    if re.fullmatch(r'\s*0/1\s*', z):
        return 0.0, 1.0
    if 'bis' in z:
        lo, hi = z.split('bis', 1)
        return zahl(lo), zahl(re.sub(r'^[^-\d]*', '', hi.strip()))
    werte = [float(x) for x in re.findall(r'(-?\d+)\s*=', z)] + [float(x) for x in re.findall(r'bis (\d+)', z)]
    return min(werte), max(werte)


def ms(zelle):
    if 'Blende' in zelle or 'Überblendung' in zelle or zelle.strip().startswith(('sofort', 'immediate')):
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


def expandiere_r(p):
    # 1.10 Slice 3: spur|grp/<n>/send/<r> -> r = 1..4
    return [p.replace('<r>', str(i)) for i in range(1, RETURNS[0] + 1)] if p.endswith('/send/<r>') else [p]


def expandiere(p):
    if p.startswith('<k>/'):
        rest = p[4:]
        return [f'{k}/{rest}' for k in KANAELE if not (k.startswith('bus/') and (rest == 'ziel' or rest.startswith('komp/')))]
    if p.startswith('deck/<n>/'):
        return [f'deck/{i}/{p[9:]}' for i in range(1, 5)]
    if p.startswith('spur/<n>/'):                       # D1 K1: Spur-Regler des Arrangements, n = 1..32
        return [q for i in range(1, SPUREN[0] + 1) for q in expandiere_r(f'spur/{i}/{p[9:]}')]
    if p.startswith('grp/<n>/'):                        # 1.10 Slice 1: Gruppen-Regler des Arrangements, n = 1..8
        return [q for i in range(1, GRUPPEN[0] + 1) for q in expandiere_r(f'grp/{i}/{p[8:]}')]
    if p.startswith('ret/<r>/'):                        # 1.10 Slice 3: return strips, r = 1..4
        return [f'ret/{i}/{p[8:]}' for i in range(1, RETURNS[0] + 1)]
    m = re.match(r'ins/(komp|eq|saett|lim|host|utility|bk)/<n>/(.*)$', p)
    if m:                                               # 1.10 slice 4a/4b: insert pools, n = 1..pool size; the EQ band rows b<m>/... expand over the 8 bands
        rest = [m.group(2).replace('<m>', str(b)) for b in range(1, 9)] if '<m>' in m.group(2) else [m.group(2)]
        return [f'ins/{m.group(1)}/{i}/{r}' for i in range(1, INSERTS[m.group(1)] + 1) for r in rest]
    if p == 'rack/<k>/m<n>':                            # 1.10 slice 4c: the macro knobs of the rack pool, k = 1..RACKS, n = 1..4
        return [f'rack/{k}/m{i}' for k in range(1, RACKS[0] + 1) for i in range(1, 5)]
    if p.startswith('fx/<n>/'):
        rest = p[7:]
        return [f'fx/{i}/{rest}' for i in FX_N[rest]]
    return [p]


def bk_kanaele(zelle):
    """S14: 'nur `<k>` = deck/1..4 (...), erz/1, 2, 3, 5, 6, 7 und pad/1, 2 (...)' -> ['deck/1', ..., 'pad/2'] (the channel list of the
    `<k>/bk/<n>` row, read from its "Wer darf" cell like djk/contract/check_name_lists.py does)."""
    aus = []
    for gruppe in ('deck', 'erz', 'pad'):
        m = re.search(gruppe + r'/(\d+(?:\.\.\d+|(?:, \d+)*))', zelle)
        assert m, f'Vertrag §1.5, Zeile `<k>/bk/<n>`: keine Kanäle für {gruppe}'
        t = m.group(1)
        nummern = range(int(t.split('..')[0]), int(t.split('..')[1]) + 1) if '..' in t else [int(x) for x in t.split(', ')]
        aus += [f'{gruppe}/{n}' for n in nummern]
    return aus


def bk_pfade(p, z):
    """S14: the two graph-knob rows expand over what the row itself names; None for every other path."""
    if p == '<k>/bk/<n>':
        m = re.search(r'n = 1 bis (\d+)', z[0])
        assert m and int(m.group(1)) == BK_KNOEPFE, 'Vertrag §1.5: Zeile `<k>/bk/<n>` ohne "n = 1 bis 8"'
        return [f'{k}/bk/{n}' for k in bk_kanaele(z[5]) for n in range(1, BK_KNOEPFE + 1)]
    if p == 'fx/<n>/bk/<m>':
        mn = re.search(r'n = (\d+(?: and \d+)*)', z[0])
        mm = re.search(r'm = 1 to (\d+)', z[0])
        assert mn and mm and int(mm.group(1)) == BK_KNOEPFE, 'Vertrag §1.5: Zeile `fx/<n>/bk/<m>` ohne "n = A and B, m = 1 to 8"'
        return [f'fx/{n}/bk/{m}' for n in mn.group(1).split(' and ') for m in range(1, BK_KNOEPFE + 1)]
    return None


# INTERFACES section 1.5: the exact set of the 345 mix-tool paths, five regexes with the count each must have
WERKZEUG_REGEX = [
    (r'^(deck/[1-4]|erz/[1-7]|pad/[12])/gate/(an|schwelle|hysterese|ratio|bereich|attack|hold|release|sc)$', 117),
    (r'^(deck/[1-4]|erz/[1-7]|pad/[12]|bus/[1-4])/util/(balance|breite|bassmono|phase_l|phase_r|tausch|dc)$', 119),
    (r'^bus/[1-4]/mb/(an|grenze_tief|grenze_hoch|(tief|mitte|hoch)/(schwelle|ratio|attack|release|knie|makeup|umgehen))$', 96),
    (r'^bus/[1-4]/lim/(an|decke|abklingen)$', 12),
    (r'^spektrum/kanal$', 1),
]
WERKZEUG_ZEILE = re.compile(r'^(<k>/(gate|util)/|bus/<n>/(mb|lim)/)')


def werkzeug_kanaele(zelle):
    """1.15 A1b: channel list of a mix-tool row, read from its "Wer darf" cell: 'Quellkanäle' = deck/1..4, erz/1..8, pad/1..2 without the
    channels named after 'ausser'; 'Busse' = bus/1..4 (so 'nur Busse' gives the buses only)."""
    kanaele = []
    if 'Quellkanäle' in zelle:
        ausser = set(re.findall(r'(?:erz|deck|pad)/\d', zelle.split('ausser', 1)[1])) if 'ausser' in zelle else set()
        kanaele += [k for k in KANAELE if not k.startswith('bus/') and k not in ausser]
    if 'Busse' in zelle:
        kanaele += [k for k in KANAELE if k.startswith('bus/')]
    assert kanaele, f'Contract 1.5: no channels in the "Wer darf" cell of a mix-tool row: {zelle!r}'
    return kanaele


def werkzeug_pfade(p, z):
    """1.15 A1b: expand a mix-tool row over the channel list of its own "Wer darf" cell (z[5]); None for every other path."""
    if not WERKZEUG_ZEILE.match(p):
        return None
    rest = p.split('/', 2)[2] if p.startswith('bus/<n>/') else p[4:]
    baender = [None]
    if '<b>' in rest:
        mb = re.search(r'b = (\w+(?:, \w+)*)', z[0])
        assert mb, f'Contract 1.5: row `{p}` without "b = tief, mitte, hoch"'
        baender = mb.group(1).split(', ')
    return [f'{k}/{rest.replace("<b>", b) if b else rest}' for k in werkzeug_kanaele(z[5]) for b in baender]


WERKZEUG_SOLL = [n for _, n in WERKZEUG_REGEX]
WERKZEUG_PFAD = re.compile(r'^((deck|erz|pad|bus)/\d+/(gate|util|mb|lim)/|spektrum/)')


def werkzeug_zaehlen(pfade):
    """Counts the mix-tool paths per hand regex. Returns (counts, strays): a path with a tool prefix (gate, util, mb, lim, spektrum) that
    matches none of the five regexes, or more than one, is a stray (a 13th limiter path `bus/1/lim/zz` is one) and must be reported."""
    zaehler = [0] * len(WERKZEUG_REGEX)
    verirrt = []
    for q in sorted(pfade):
        if not WERKZEUG_PFAD.match(q):
            continue
        treffer = [i for i, (muster, _) in enumerate(WERKZEUG_REGEX) if re.match(muster, q)]
        if len(treffer) != 1:
            verirrt.append(q)
        for i in treffer:
            zaehler[i] += 1
    return zaehler, verirrt


def vertrag(text):
    ab = text.index('### 1.5 Kanäle und Regler-Pfade')
    bis = text.index('### 1.6', ab)
    m = re.search(r'`spur/<n>/\*`[^\n]*?n = 1 bis (\d+)', text[ab:bis])
    assert m, 'Vertrag §1.5: der Satz "`spur/<n>/*` (...n = 1 bis N)" fehlt'
    SPUREN[0] = int(m.group(1))   # Text sagt 8, Kern hat 32 Pfade: "im Stellwerk, nicht im Vertrag"; umgekehrt "fehlt im Stellwerk"
    mg = re.search(r'`grp/<n>/\*`[^\n]*?n = 1 bis (\d+)', text[ab:bis])
    assert mg, 'Vertrag §1.5: der Satz "`grp/<n>/*` (...n = 1 bis N)" fehlt'
    GRUPPEN[0] = int(mg.group(1))
    mr = re.search(r'`ret/<r>/\*`[^\n]*?r = 1 to (\d+)', text[ab:bis])
    assert mr, 'Vertrag §1.5: der Satz "`ret/<r>/*` (...r = 1 to N...)" fehlt'
    RETURNS[0] = int(mr.group(1))
    for art in INSERTS:
        mi = re.search(r'`ins/' + art + r'/<n>/\*` \(n = 1 to (\d+)', text[ab:bis])
        assert mi, f'Vertrag §1.5: der Satz "`ins/{art}/<n>/*` (n = 1 to N; ...)" fehlt'
        INSERTS[art] = int(mi.group(1))
    mk = re.search(r'`rack/<k>/m<n>` \(k = 1 to (\d+)', text[ab:bis])
    assert mk, 'Vertrag §1.5: der Satz "`rack/<k>/m<n>` (k = 1 to N; ...)" fehlt'
    RACKS[0] = int(mk.group(1))
    erg = {}
    for zeile in text[ab:bis].splitlines():
        if not zeile.startswith('| `'):
            continue
        z = [c.strip() for c in zeile.strip().strip('|').split('|')]
        lo, hi = bereich(z[2] if z[2] else z[1])
        vorgabe = zahl(z[3]) if zahl(z[3]) is not None else (0.0 if 'Busse 0' in z[3] else None)
        nur_hand_alle = z[5].startswith('nur Hand')
        for p in pfade(z[0]):
            for q in (bk_pfade(p, z) or werkzeug_pfade(p, z) or expandiere(p)):
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
    soll = {p for p in bib if '/kill/' in p} | {p for p in bib if p.endswith('/fader') and not p.startswith(('bus/', 'spur/', 'grp/', 'pm/', 'ret/'))}
    ist = {f.split(':')[0] for f in f_falsch}
    print(f'Selbsttest verfälschter Vertrag: {len(f_falsch)} Abweichungen, erwartet {len(soll)} (alle Kills, Fader außer Bus)')
    if ist != soll or len(f_falsch) != len(soll):
        print('FEHLER: der Abgleich sieht den verfälschten Vertrag nicht wie erwartet', sorted(ist ^ soll)[:5])
        return 1
    # Selbsttest 2 (E3 Review-Nachzug): sagt der Vertragstext „n = 1 bis 8“, muss der Abgleich die Pfade der Slots 9 bis 32 melden (24 mal 4 Regler plus 24 mal 4 Sends)
    acht = text.replace('n = 1 bis 32', 'n = 1 bis 8')
    assert acht != text, 'Selbsttest: Satz "n = 1 bis 32" im Vertrag nicht gefunden'
    f_acht = abgleich(bib, vertrag(acht))
    # slots 9..32 (24) x (fader, pan, mute, solo + one send per return); the sends of slice 3 are keyed to the same n, so 96 was stale
    erwartet_acht = 24 * (4 + RETURNS[0])
    print(f'Selbsttest Vertragstext n = 1 bis 8: {len(f_acht)} Abweichungen, erwartet {erwartet_acht} (Slots 9 bis 32 mal 4 Regler plus {RETURNS[0]} Sends)')
    if len(f_acht) != erwartet_acht:
        print('FEHLER: der Abgleich liest den Bereich nicht aus dem Vertragstext')
        return 1
    # Selbsttest 3 (1.10): sagt der Vertragstext „n = 1 bis 4“ für die Gruppen, muss der Abgleich die Pfade der Gruppen 5 bis 8 melden (4 mal 4 Regler plus 4 mal 4 Sends)
    satz = '`grp/<n>/*` (1.10, ADR 033, n = 1 bis 8)'
    assert satz in text, 'Selbsttest: Satz der Gruppen-Regler im Vertrag nicht gefunden'
    f_vier = abgleich(bib, vertrag(text.replace(satz, satz.replace('n = 1 bis 8', 'n = 1 bis 4'))))
    erwartet_vier = 4 * (4 + RETURNS[0])   # groups 5..8 x (4 controls + one send per return); the 16 of 1.10 slice 1 predate the sends
    print(f'Selbsttest Vertragstext Gruppen n = 1 bis 4: {len(f_vier)} Abweichungen, erwartet {erwartet_vier} (Gruppen 5 bis 8 mal 4 Regler plus {RETURNS[0]} Sends)')
    if len(f_vier) != erwartet_vier:
        print('FEHLER: der Abgleich liest die Gruppenzahl nicht aus dem Vertragstext')
        return 1
    # Selbsttest 4 (S14): the fx row names only fx/3 -> exactly the eight paths of fx/4 must be reported
    zeile_fx = '(n = 3 and 4, m = 1 to 8)'
    assert zeile_fx in text, 'Selbsttest: Zeile `fx/<n>/bk/<m>` im Vertrag nicht gefunden'
    f_fx = abgleich(bib, vertrag(text.replace(zeile_fx, '(n = 3, m = 1 to 8)')))
    soll_fx = {f'fx/4/bk/{m}' for m in range(1, 9)}
    print(f'Selbsttest fx-Zeile n = 3: {len(f_fx)} Abweichungen, erwartet 8 (fx/4/bk/1..8)')
    if {f.split(':')[0] for f in f_fx} != soll_fx or len(f_fx) != 8 or any('im Stellwerk, nicht im Vertrag' not in f for f in f_fx):
        print('FEHLER: der Abgleich liest die fx-Knopfzeile nicht aus dem Vertragstext', f_fx[:3])
        return 1
    # Selbsttest 5 (S14): the channel list of the `<k>/bk/<n>` row loses pad/2 -> exactly pad/2/bk/1..8
    kanalsatz = 'erz/1, 2, 3, 5, 6, 7 und pad/1, 2'
    assert kanalsatz in text, 'Selbsttest: Kanalliste der Zeile `<k>/bk/<n>` im Vertrag nicht gefunden'
    f_pad = abgleich(bib, vertrag(text.replace(kanalsatz, 'erz/1, 2, 3, 5, 6, 7 und pad/1')))
    soll_pad = {f'pad/2/bk/{n}' for n in range(1, 9)}
    print(f'Selbsttest Kanalliste ohne pad/2: {len(f_pad)} Abweichungen, erwartet 8 (pad/2/bk/1..8)')
    if {f.split(':')[0] for f in f_pad} != soll_pad or len(f_pad) != 8:
        print('FEHLER: der Abgleich liest die Kanalliste der bk-Zeile nicht aus dem Vertragstext', f_pad[:3])
        return 1
    # Self-test 6 (A1b): the gate cell loses "ausser erz/8" -> exactly the nine gate paths of erz/8 are in the contract but not in the table
    gate_zelle = '| alle; nur Quellkanäle ausser erz/8 |'
    assert text.count(gate_zelle) == 9, 'Self-test: the nine gate rows are not in the contract'
    f_erz8 = abgleich(bib, vertrag(text.replace(gate_zelle, '| alle; nur Quellkanäle |')))
    soll_erz8 = {f'erz/8/gate/{f}' for f in ('an', 'schwelle', 'hysterese', 'ratio', 'bereich', 'attack', 'hold', 'release', 'sc')}
    print(f'Self-test gate cells with erz/8: {len(f_erz8)} deviations, expected 9 (erz/8/gate/*)')
    if {f.split(':')[0] for f in f_erz8} != soll_erz8 or len(f_erz8) != 9 or any('steht im Vertrag, fehlt im Stellwerk' not in f for f in f_erz8):
        print('ERROR: the comparison does not read the channel list of the gate rows from the contract text', f_erz8[:3])
        return 1
    # Self-test 7 (A1b): the multiband switch row says "nur Busse" -> "Quellkanäle ausser erz/8 und Busse": the 13 sources get a multiband
    mb_zeile = [zl for zl in text.splitlines() if zl.startswith('| `bus/<n>/mb/an`')]
    assert len(mb_zeile) == 1 and mb_zeile[0].endswith('| alle; nur Busse |'), 'Self-test: row bus/<n>/mb/an is not in the contract'
    f_mb = abgleich(bib, vertrag(text.replace(mb_zeile[0], mb_zeile[0].replace('alle; nur Busse', 'alle; Quellkanäle ausser erz/8 und Busse'))))
    print(f'Self-test mb/an on the source channels: {len(f_mb)} deviations, expected 13 (source channel/mb/an)')
    if len(f_mb) != 13 or any(not f.split(':')[0].endswith('/mb/an') or 'steht im Vertrag, fehlt im Stellwerk' not in f for f in f_mb):
        print('ERROR: the comparison does not read the channel list of the mb row from the contract text', f_mb[:3])
        return 1
    # Self-test 8 (A2): one more limiter path (a 13th, `bus/1/lim/zz`) matches none of the five regexes: the counter must report exactly that path
    # as a stray and leave the counts per regex alone (the old counter saw only the five regexes and stayed green). Relative to the real
    # table, so a stray that is really there makes the real check below red, not this self-test.
    z_bib0, v_bib0 = werkzeug_zaehlen(bib)
    extra = 'bus/1/lim/zz_selbsttest'
    z_zz, v_zz = werkzeug_zaehlen(list(bib) + [extra])
    print(f'Self-test extra limiter path: counts {z_zz}, new strays {sorted(set(v_zz) - set(v_bib0))}')
    if z_zz != z_bib0 or sorted(set(v_zz) - set(v_bib0)) != [extra]:
        print('ERROR: the mix-tool counter does not report a tool path outside the five regexes', z_zz, v_zz)
        return 1
    mehr = ['bus/1/lim/an/x', 'deck/1/gate/hold2', 'spektrum/kanal/1']
    z_dop, v_dop = werkzeug_zaehlen(list(bib) + mehr)
    print(f'Self-test three more strays: new strays {sorted(set(v_dop) - set(v_bib0))}')
    if sorted(set(v_dop) - set(v_bib0)) != sorted(mehr) or z_dop != z_bib0:
        print('ERROR: the mix-tool counter does not report several strays', z_dop, v_dop)
        return 1
    # negative control: paths without a tool prefix are no strays
    if werkzeug_zaehlen(list(bib) + ['deck/1/komp/an', 'bus/9/fader']) != (z_bib0, v_bib0):
        print('ERROR: the mix-tool counter reports a path without a tool prefix')
        return 1
    ver = vertrag(text)
    # A1b: 345 mix-tool paths, in the contract and in the table, by the five hand regexes (117, 119, 96, 12, 1); A2: and nothing else with a
    # tool prefix (every such path matches exactly one regex, the sum is 345)
    soll_wz = WERKZEUG_SOLL
    (z_ver, v_ver), (z_bib, v_bib) = werkzeug_zaehlen(ver), werkzeug_zaehlen(bib)
    print(f'Mix-tool paths per regex: contract {z_ver}, table {z_bib}, expected {soll_wz} (together {sum(soll_wz)}); '
          f'strays: contract {v_ver}, table {v_bib}')
    if z_ver != soll_wz or z_bib != soll_wz or sum(z_ver) != 345 or sum(z_bib) != 345 or v_ver or v_bib:
        print('ERROR: the number of mix-tool paths is wrong or a tool path is outside the five regexes (345 = 117 + 119 + 96 + 12 + 1)')
        return 1
    fehler = abgleich(bib, ver)
    for f in fehler:
        print('ABWEICHUNG', f)
    print(f'Vertrag §1.5: {len(ver)} Pfade, Stellwerk: {len(bib)} Pfade, {len(fehler)} Abweichungen')
    return 1 if fehler or len(ver) != len(bib) else 0


if __name__ == '__main__':
    sys.exit(main())
