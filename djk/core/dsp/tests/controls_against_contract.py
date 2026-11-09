#!/usr/bin/env python3
"""Task 2: Reglertabelle der Bibliothek gegen INTERFACES.md §1.5 (Vertragstext).

Aufruf: controls_against_contract.py <regler_liste-Programm> <INTERFACES.md>
Prüft je Kanalzug-Regler Bereich, Vorgabe, Dauer und Art der Schaltrampe. Vorher ein Selbsttest:
derselbe Abgleich gegen einen im Speicher verfälschten Vertragstext muss rot werden (Fehlerfall),
sonst taugt die Prüfung nicht. Rückgabe 0 nur, wenn der Selbsttest rot und der echte Abgleich grün ist.
"""
import re
import subprocess
import sys

# Regler-Pfade des Vertrags, die NICHT in den Kanalzug-DSP gehören (Mixer, Deck: Scheibe 25 und 31).
NICHT_IM_KANALZUG = {'ziel', 'xseite', 'pfl', 'stem/drums', 'stem/bass', 'stem/vocals', 'stem/other',
                     # bk/<n>: Baukasten graph knobs live in the mixer, not in the dsp strip (INTERFACES.md:168)
                     'bk/<n>',
                     # Kompressor je Quellkanal (2026-10-11): lebt im Mixer (cdj::Komp), nicht im dsp-Kanalzug
                     'komp/an', 'komp/schwelle', 'komp/ratio', 'komp/attack', 'komp/release', 'komp/makeup', 'komp/mix', 'komp/sc'}


# 1.15 A1b: the mix-tool rows `<k>/gate/*` and `<k>/util/*` (and `bus/<n>/mb/*`, `bus/<n>/lim/*`, which this reader never sees) live in the mixer
# inserts, not in the dsp channel strip: skipped by prefix like the exact names above. `bk/` (graph knobs) is skipped by prefix as well.
NICHT_IM_KANALZUG_PRAEFIX = ('gate/', 'util/', 'mb/', 'lim/', 'bk/')


def nicht_im_kanalzug(pfad):
    return pfad in NICHT_IM_KANALZUG or pfad.startswith(NICHT_IM_KANALZUG_PRAEFIX)


def zahl(t):
    t = t.strip().replace('−', '-').replace(',', '.')
    m = re.match(r'^[-+]?\d+(\.\d+)?', t)
    return float(m.group(0)) if m else None


def vertrag_zeilen(text):
    """{pfad: (min, max, vorgabe|None, ms, form)} aus den Zeilen `| `<k>/…` | …` von §1.5."""
    ab = text.index('### 1.5 Kanäle und Regler-Pfade')
    bis = text.index('### 1.6', ab)
    erg = {}
    for zeile in text[ab:bis].splitlines():
        if not zeile.startswith('| `<k>/'):
            continue
        zellen = [z.strip() for z in zeile.strip().strip('|').split('|')]
        pfade = [p.replace('<k>/', '').lstrip('/') for p in re.findall(r'`([^`]+)`', zellen[0])]
        if ' bis ' in zellen[0] and len(pfade) == 2:  # `<k>/send/1` bis `/send/4`
            stamm, a = pfade[0].rsplit('/', 1)
            b = pfade[1].rsplit('/', 1)[1]
            pfade = [f'{stamm}/{i}' for i in range(int(a), int(b) + 1)]
        if all(nicht_im_kanalzug(p) for p in pfade):
            continue
        # Bereich steht in Spalte 3; beim Filter steht er in Spalte 2 und Spalte 3 ist leer
        bereich = zellen[2] if zellen[2] else zellen[1]
        if '/' in bereich and 'bis' not in bereich:  # Schalter "0/1"
            lo, hi = (float(x) for x in bereich.split('/'))
        else:
            lo, hi = (zahl(x) for x in bereich.split('bis'))
        vorgabe = zahl(zellen[3])
        if vorgabe is None and 'Busse 0' in zellen[3]:
            vorgabe = 0.0
        ms = zahl(zellen[4])
        # Review 04 Punkt 3: B3 schlägt vor, die Kill-Zelle umzuformulieren; "S-Rampe" zählt wie "zweite Ordnung"
        form = 'zweite_ordnung' if ('zweite Ordnung' in zellen[4] or 'S-Rampe' in zellen[4]) else ('glaettung' if 'Glättung' in zellen[4] else 'rampe')
        for p in pfade:
            erg[p] = (lo, hi, vorgabe, ms, form)
    return erg


def bibliothek(programm):
    erg = {}
    for zeile in subprocess.run([programm], check=True, capture_output=True, text=True).stdout.splitlines():
        pfad, einheit, lo, hi, vorgabe, ms, form = zeile.split('\t')
        erg[pfad] = (float(lo), float(hi), float(vorgabe), float(ms), form)
    return erg


def abgleich(bib, vertrag):
    fehler = []
    for pfad, (lo, hi, vorgabe, ms, form) in vertrag.items():
        if nicht_im_kanalzug(pfad):
            continue
        if pfad not in bib:
            fehler.append(f'{pfad}: steht im Vertrag, fehlt in der Bibliothek')
            continue
        blo, bhi, bvorgabe, bms, bform = bib[pfad]
        if (blo, bhi) != (lo, hi):
            fehler.append(f'{pfad}: Bereich {blo}..{bhi}, Vertrag {lo}..{hi}')
        if vorgabe is not None and bvorgabe != vorgabe:
            fehler.append(f'{pfad}: Vorgabe {bvorgabe}, Vertrag {vorgabe}')
        if bms != ms:
            fehler.append(f'{pfad}: Schaltrampe {bms} ms, Vertrag {ms} ms')
        if form != 'rampe' and bform != form:
            fehler.append(f'{pfad}: Schaltform {bform}, Vertrag {form}')
        if form == 'rampe' and bform != 's_kurve':
            fehler.append(f'{pfad}: Schaltform {bform}, erwartet s_kurve (Auslegung Scheibe 04)')
    for pfad in bib:
        if pfad not in vertrag:
            fehler.append(f'{pfad}: in der Bibliothek, nicht im Vertrag')
    return fehler


def main():
    programm, vertrag_pfad = sys.argv[1], sys.argv[2]
    text = open(vertrag_pfad, encoding='utf-8').read()
    bib = bibliothek(programm)
    # Selbsttest (Fehlerfall): Kill-Schaltrampe im Text von 5 auf 8 ms verfälscht → muss auffallen.
    # Review 04 Punkt 3: die Zahl der Kill-Zeile über einen Ausdruck verfälschen, nicht über den genauen Wortlaut
    falsch = re.sub(r'(\|[^\n]*kill/tief[^\n]*?\| )5( ms)', r'\g<1>8\g<2>', text, count=1)
    assert falsch != text, 'Selbsttest: Kill-Zeile im Vertrag nicht gefunden'
    f_falsch = abgleich(bib, vertrag_zeilen(falsch))
    print(f'Selbsttest verfälschter Vertrag: {len(f_falsch)} Abweichung(en)')
    for f in f_falsch:
        print('  ', f)
    if not f_falsch:
        print('FEHLER: der Abgleich sieht einen verfälschten Vertrag nicht')
        return 1
    # Self-test 2 (A1b): a mix-tool row with a wrong number is skipped (it is not in the library), a real library row (filter) with a wrong
    # number is still compared. Both edits at once: exactly one deviation, and it is the filter.
    schwelle, filt = '| `<k>/gate/schwelle` | dBFS | −90 bis 0 |', '| `<k>/filter` | −1 bis +1 | | 0 | 20 ms'
    assert schwelle in text and filt in text, 'Self-test 2: gate or filter row is not in the contract'
    zwei = text.replace(schwelle, schwelle.replace('−90', '−80')).replace(filt, filt.replace('20 ms', '30 ms'))
    f_zwei = abgleich(bib, vertrag_zeilen(zwei))
    print(f'Self-test mix-tool row skipped, filter compared: {len(f_zwei)} deviation(s)')
    if len(f_zwei) != 1 or not f_zwei[0].startswith('filter:'):
        print('ERROR: a mix-tool row is not skipped or filter is no longer compared', f_zwei[:3])
        return 1
    vertrag = vertrag_zeilen(text)
    geprueft = sorted(p for p in vertrag if not nicht_im_kanalzug(p))
    print(f'Vertrag §1.5: {len(geprueft)} Kanalzug-Pfade: {" ".join(geprueft)}')
    fehler = abgleich(bib, vertrag)
    for f in fehler:
        print('ABWEICHUNG', f)
    if len(geprueft) != len(bib):
        print(f'FEHLER: {len(geprueft)} Pfade im Vertrag, {len(bib)} in der Bibliothek')
        return 1
    return 1 if fehler else 0


if __name__ == '__main__':
    sys.exit(main())
