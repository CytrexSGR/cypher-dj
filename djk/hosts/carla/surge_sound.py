"""Surge-Klang (Studio S5.3). Ein Klang ist eine Surge-.fxp, dasselbe Format wie Surges Werkspatches:
60 Byte fxp-Kopf (big endian: CcnK, Größe-8, FPCh, 1, cjs3, 1, 1, Name[28], Chunkgröße) + Surge-Patch.
Surge-Patch: b"sub3" + uint32 LE XML-Länge + 6 x uint32 LE Wavetable-Größen + XML + Wavetable-Daten.
Carla speichert denselben Patch als LV2-CustomData `…surge-xt:StateString` in JUCE-Base64 ("<bytes>.<zeichen>").
Befund und Rohdaten: ~/messungen/2026-09-29-s53-klang/BEFUND.md. Nur Standardbibliothek, keine Datei-I/O."""
import re
import struct

ALPHA = ".ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+"
_WERT = {c: i for i, c in enumerate(ALPHA)}
FXP = struct.Struct(">4si4si4sii28si")  # 60 Byte
KOPF = struct.Struct("<4sI6I")  # 32 Byte
# Leerraum um den Wert bleibt stehen: Carla schreibt "\n<wert>\n    ", die Vorprobe stürzte ohne ihn ab (BEFUND 6).
STATE = re.compile(r"(StateString</Key>\s*<Value>\s*)(\S+)(\s*</Value>)")


def juce64_dekodiere(s: str) -> bytes:
    groesse, daten = s.split(".", 1)
    n = int(groesse)
    aus = bytearray(n)
    bit = 0
    for ch in daten:
        v = _WERT[ch]
        for b in range(6):
            if bit >= n * 8:
                break
            if v >> b & 1:
                aus[bit >> 3] |= 1 << (bit & 7)
            bit += 1
    return bytes(aus)


def juce64_enkodiere(b: bytes) -> str:
    bits = len(b) * 8
    zeichen = []
    for i in range(0, bits, 6):
        v = 0
        for j in range(6):
            k = i + j
            if k < bits and b[k >> 3] >> (k & 7) & 1:
                v |= 1 << j
        zeichen.append(ALPHA[v])
    return f"{len(b)}." + "".join(zeichen)


def _kopf(patch: bytes):
    if len(patch) < KOPF.size:
        raise ValueError("Surge-Patch zu kurz")
    tag, n, *wt = KOPF.unpack_from(patch)
    if tag != b"sub3":
        raise ValueError(f"kein Surge-Patch (Kennung {tag!r})")
    return n, wt


def xml_aus_patch(patch: bytes) -> str:
    n, _ = _kopf(patch)
    # Werkspatch Leads/µcomputer trägt ein rohes Latin-1-Byte (0xb5) im XML trotz UTF-8-Prolog (S5.3 T5, gemessen); replace ersetzt es durch U+FFFD. Nicht surrogateescape: die Antwort des Wirts geht als JSON mit ensure_ascii=False über den Socket und würde an Surrogaten scheitern.
    return patch[KOPF.size:KOPF.size + n].decode("utf-8", "replace")


def patch_mit_xml(patch: bytes, xml: str) -> bytes:
    n, wt = _kopf(patch)
    xb = xml.encode("utf-8")
    return KOPF.pack(b"sub3", len(xb), *wt) + xb + patch[KOPF.size + n:]


def fxp_bauen(patch: bytes, name: str) -> bytes:
    _kopf(patch)
    nb = name.encode("utf-8")[:27]
    return FXP.pack(b"CcnK", FXP.size - 8 + len(patch), b"FPCh", 1, b"cjs3", 1, 1, nb, len(patch)) + patch


def fxp_lesen(daten: bytes) -> bytes:
    if len(daten) < FXP.size:
        raise ValueError("fxp zu kurz")
    cc, _, fp, _, fxid, _, _, _, n = FXP.unpack_from(daten)
    if (cc, fp, fxid) != (b"CcnK", b"FPCh", b"cjs3"):
        raise ValueError(f"keine Surge-fxp ({cc!r} {fp!r} {fxid!r})")
    patch = daten[FXP.size:FXP.size + n]
    if len(patch) != n:
        raise ValueError("fxp abgeschnitten")
    _kopf(patch)
    return patch


def fxp_name(daten: bytes) -> str:
    return FXP.unpack_from(daten)[7].split(b"\0")[0].decode("utf-8", "replace")


def carxs_patch(text: str) -> bytes:
    m = STATE.search(text)
    if not m:
        raise ValueError("kein Surge-StateString im Carla-Zustand")
    return juce64_dekodiere(m.group(2))


def carxs_mit_patch(text: str, patch: bytes) -> str:
    _kopf(patch)
    neu, n = STATE.subn(lambda m: m.group(1) + juce64_enkodiere(patch) + m.group(3), text, count=1)
    if n != 1:
        raise ValueError("kein Surge-StateString im Carla-Zustand")
    return neu


def setze(xml: str, zuweisungen: dict) -> str:
    """zuweisungen: {"a_filter1_cutoff": "-30.0", "a_filter1_type.deactivated": "0"} (ohne Punkt: Attribut value).
    Jedes Element muss genau einmal als öffnender Tag dastehen (leer oder mit Kindern wie <modrouting>) und das Attribut schon tragen, sonst ValueError;
    das übergebene xml bleibt dann unverändert (Strings sind unveränderlich, geändert wird nur die Kopie)."""
    for schluessel, wert in zuweisungen.items():
        name, _, attr = schluessel.partition(".")
        attr = attr or "value"
        if re.search(r'["<>&]', str(wert)):  # würde das Patch-XML brechen (Final-Review S5.3)
            raise ValueError(f"{schluessel}: Wert {wert!r} enthält \" < > oder &")
        treffer = re.findall(rf"<{re.escape(name)} [^>]*>", xml)
        if len(treffer) != 1:
            raise ValueError(f"{name}: {len(treffer)} Treffer statt 1")
        alt = treffer[0]
        neu, n = re.subn(rf'(\s{re.escape(attr)}=")[^"]*(")', lambda m: m.group(1) + str(wert) + m.group(2), alt)
        if n != 1:
            raise ValueError(f"{name}: Attribut {attr} fehlt")
        xml = xml.replace(alt, neu, 1)
    return xml


def werte(xml: str, muster: str = "") -> list:
    """[(name, Attribute als Text)] aller leeren Elemente mit value=, deren Name das Regex muster trifft."""
    rx = re.compile(muster)
    return [(m.group(1), m.group(2).strip())
            for m in re.finditer(r'<([A-Za-z_]\w*) ([^>]*?value="[^"]*"[^>]*?)\s*/?>', xml) if rx.search(m.group(1))]


def normiert(punkte: list, wert: float) -> float:
    """XML-Wert → Carla-Parameter 0…1, stückweise linear über die gemessenen Stützpunkte an 0, 0,25, 0,5, 0,75, 1
    (surge_bereiche.json). Außerhalb wird geklemmt. Nicht monotone Punkte: ValueError."""
    n = len(punkte) - 1
    steigend = all(b >= a for a, b in zip(punkte, punkte[1:]))
    fallend = all(b <= a for a, b in zip(punkte, punkte[1:]))
    if not (steigend or fallend) or punkte[0] == punkte[-1]:
        raise ValueError(f"Stützpunkte nicht monoton: {punkte}")
    p = punkte if steigend else [-x for x in punkte]
    w = wert if steigend else -wert
    if w <= p[0]:
        return 0.0
    if w >= p[-1]:
        return 1.0
    for k in range(n):
        if p[k] <= w <= p[k + 1]:
            anteil = 0.0 if p[k + 1] == p[k] else (w - p[k]) / (p[k + 1] - p[k])
            return (k + anteil) / n
    raise ValueError(f"{wert} nicht einzuordnen in {punkte}")
