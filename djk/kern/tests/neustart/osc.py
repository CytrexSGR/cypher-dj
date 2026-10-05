"""OSC 1.0 kodieren und lesen für die Prüfskripte der Scheibe 18 (Typen s, i, h, f, d; SCHNITTSTELLEN §4, §5)."""
import struct


def _str(s):
    roh = s.encode("ascii") + b"\0"
    return roh + b"\0" * (-len(roh) % 4)


def kodiere(adresse, typen, *werte):
    """typen mit Komma, z. B. ",hsd"."""
    b = _str(adresse) + _str(typen)
    for t, v in zip(typen[1:], werte):
        if t == "i":
            b += struct.pack(">i", int(v))
        elif t == "h":
            b += struct.pack(">q", int(v))
        elif t == "f":
            b += struct.pack(">f", float(v))
        elif t == "d":
            b += struct.pack(">d", float(v))
        elif t == "s":
            b += _str(v)
        else:
            raise ValueError(f"Typ {t}")
    return b


def _lies_str(b, i):
    e = b.index(b"\0", i)
    s = b[i:e].decode("ascii", "replace")
    return s, (e + 4) & ~3


def lies(b):
    """(adresse, typen, [werte]) oder None bei Formfehler."""
    try:
        adr, i = _lies_str(b, 0)
        typen, i = _lies_str(b, i)
        if not typen.startswith(","):
            return None
        werte = []
        for t in typen[1:]:
            if t == "i":
                werte.append(struct.unpack_from(">i", b, i)[0]); i += 4
            elif t == "h":
                werte.append(struct.unpack_from(">q", b, i)[0]); i += 8
            elif t == "f":
                werte.append(struct.unpack_from(">f", b, i)[0]); i += 4
            elif t == "d":
                werte.append(struct.unpack_from(">d", b, i)[0]); i += 8
            elif t == "s":
                s, i = _lies_str(b, i); werte.append(s)
            else:
                return None
        return adr, typen, werte
    except (ValueError, struct.error):
        return None


if __name__ == "__main__":
    p = kodiere("/k/hallo", ",sii", "pruefstand", 47140, 1)
    assert lies(p) == ("/k/hallo", ",sii", ["pruefstand", 47140, 1]), lies(p)
    q = kodiere("/q/stand", ",hsihds", 2**40, "cypher", 2, 1440000, 64.0, "")
    assert lies(q) == ("/q/stand", ",hsihds", [2**40, "cypher", 2, 1440000, 64.0, ""]), lies(q)
    assert lies(b"kaputt") is None
    print("osc.py: alles grün")
