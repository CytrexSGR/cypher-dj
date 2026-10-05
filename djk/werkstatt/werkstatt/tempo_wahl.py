"""Halb- oder Doppeltempo-Wahl (SCHNITTSTELLEN §12.3 „Tempo-Wahl“).

Unter Quell-BPM x {1/2, 1, 2} gilt das Vielfache, dessen Streckfaktor basis_bpm / (Quell-BPM * v)
am naechsten bei 1 liegt. Gleichstand: 1 vor 2 vor 1/2 (keine Umdeutung ohne Gewinn)."""

KANDIDATEN = (1.0, 2.0, 0.5)
TOR_STRECKFAKTOR = 0.20   # §2.1 tor_streckfaktor, 0,20 aus M19 (2026-09-25), vorlaeufig bis M18


def waehle_vielfaches(quell_bpm, basis_bpm=128.0):
    """Rueckgabe (vielfaches, streckfaktor)."""
    if quell_bpm <= 0:
        raise ValueError(f"Quell-BPM muss positiv sein: {quell_bpm}")
    v = min(KANDIDATEN, key=lambda k: abs(basis_bpm / (quell_bpm * k) - 1.0))
    return v, basis_bpm / (quell_bpm * v)


def tor_streckfaktor(streckfaktor, grenze=TOR_STRECKFAKTOR):
    """Tor `streckfaktor` aus §12.3: ok, wenn |f - 1| <= grenze."""
    return abs(streckfaktor - 1.0) <= grenze
