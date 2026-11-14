# s8_map.py: Traktor Kontrol S8 (17cc:1370) controls -> MIDI messages of the bridge.
# Byte offsets include the report id at byte 0. Source of the offsets: Encdr's S8 descriptor (foreign), checked on the
# device in the sandbox for right_play (17/0x10), left_pad_5 (8/0x20), active-high buttons, padding bytes 1..3 = 0xff,
# heartbeat bytes 26..33 (never state). See ~/sandbox-ws/ni/03-PROTOKOLL-S8.md. Everything else is unverified here.
#
# MIDI layout (mapping channels 1..16; status channel = kanal - 1). Channels 1..8 belong to the APC20, so the S8 uses:
#   9..12  mixer channel A..D      CC 1 gain, 2 eq hi, 3 eq mid, 4 eq low, 5 filter, 7 fader
#                                   notes 1 cue, 2 filter on, 3 fx 1, 4 fx 2
#   13/14  left/right deck section notes 10 play, 11 cue, 12 sync, 13 shift, 14 hotcue, 15 loop, 16 freeze, 17 remix,
#                                   18 flux, 19 deck, 20..27 pads 1..8, 30 fx select, 31..34 fx 1..4, 35..38 on 1..4,
#                                   40..43 screen left 1..4, 44..47 screen right 1..4, 48 back, 49 capture, 50 edit
#                                   CC 20..23 fx dials 1..4, 24..27 remix faders 1..4, 40..43 screen encoders (relative)
#   15     global                  CC 8 crossfader; notes 1 snap, 2 quantize, 3 tempo, 4/5 mic 1/2,
#                                   10..13 deck assign A..D, 20..27 crossfader assign (left/right A..D)

MIX = {"a": 9, "b": 10, "c": 11, "d": 12}
SEITE = {"left": 13, "right": 14}
GLOBAL = 15

# buttons of report 0x01: (byte, mask) per side; right = left + 8 bytes
_DECK_TASTEN = {
    "fx_select": (4, 0x40, 30), "fx_1": (4, 0x80, 31), "fx_2": (5, 0x04, 32), "fx_3": (5, 0x02, 33), "fx_4": (5, 0x01, 34),
    "on_1": (6, 0x10, 35), "on_2": (6, 0x08, 36), "on_3": (6, 0x04, 37), "on_4": (6, 0x02, 38),
    "screen_left_1": (4, 0x20, 40), "screen_left_2": (4, 0x10, 41), "screen_left_3": (4, 0x01, 42),
    "screen_left_4": (6, 0x40, 43), "screen_right_1": (5, 0x08, 44), "screen_right_2": (5, 0x10, 45),
    "screen_right_3": (5, 0x20, 46), "screen_right_4": (5, 0x40, 47),
    "play": (9, 0x10, 10), "cue": (9, 0x20, 11), "sync": (9, 0x40, 12), "shift": (9, 0x80, 13),
    "hotcue": (9, 0x08, 14), "loop": (9, 0x04, 15), "freeze": (9, 0x02, 16), "remix": (9, 0x01, 17),
    "flux": (8, 0x10, 18), "deck": (8, 0x04, 19),
    "pad_1": (8, 0x08, 20), "pad_2": (8, 0x01, 21), "pad_3": (7, 0x01, 22), "pad_4": (7, 0x02, 23),
    "pad_5": (8, 0x20, 24), "pad_6": (8, 0x40, 25), "pad_7": (8, 0x80, 26), "pad_8": (8, 0x02, 27),
    "back": (6, 0x80, 48), "capture": (6, 0x20, 49), "edit": (6, 0x01, 50),
}
_MIX_TASTEN = {  # channel letter -> (cue, filter_on, fx_1, fx_2) as (byte, mask)
    "a": ((20, 0x08), (20, 0x02), (22, 0x20), (22, 0x40)),
    "b": ((23, 0x20), (23, 0x08), (25, 0x10), (25, 0x20)),
    "c": ((20, 0x04), (20, 0x01), (22, 0x08), (22, 0x10)),
    "d": ((23, 0x40), (23, 0x10), (25, 0x40), (25, 0x80)),
}
_GLOBAL_TASTEN = {
    "snap": (22, 0x80, 1), "quantize": (25, 0x08, 2), "tempo": (23, 0x04, 3), "mic_1": (22, 0x04, 4), "mic_2": (25, 0x01, 5),
    "deck_assign_a": (22, 0x02, 10), "deck_assign_b": (25, 0x02, 11), "deck_assign_c": (22, 0x01, 12),
    "deck_assign_d": (25, 0x04, 13),
    "xfader_assign_left_a": (24, 0x20, 20), "xfader_assign_right_a": (24, 0x10, 21),
    "xfader_assign_left_b": (24, 0x08, 22), "xfader_assign_right_b": (24, 0x04, 23),
    "xfader_assign_left_c": (24, 0x80, 24), "xfader_assign_right_c": (24, 0x40, 25),
    "xfader_assign_left_d": (24, 0x02, 26), "xfader_assign_right_d": (24, 0x01, 27),
}


def tasten():
    """[(name, byte, mask, kanal, note)] for report 0x01."""
    t = []
    for seite, versatz in (("left", 0), ("right", 8)):
        for n, (b, m, note) in _DECK_TASTEN.items():
            t.append((f"{seite}_{n}", b + versatz, m, SEITE[seite], note))
    for ch, felder in _MIX_TASTEN.items():
        for (b, m), note, n in zip(felder, (1, 2, 3, 4), ("cue", "filter_on", "fx_1", "fx_2")):
            t.append((f"mixer_{n}_{ch}", b, m, MIX[ch], note))
    for n, (b, m, note) in _GLOBAL_TASTEN.items():
        t.append((n, b, m, GLOBAL, note))
    return t


# analog fields of report 0x02: (name, low byte offset, kanal, cc, kind); 16-bit little endian, 0..4095
# kind: "lin" plain 7-bit, "eq" warped so the knob centre lands on 0 dB of the kern's eq curve (linear -26..+6)
def analog():
    a = []
    for i, (seite, kanal) in enumerate((("left", 13), ("right", 14))):
        for k in range(4):
            a.append((f"{seite}_fx_dial_{k + 1}", 43 + 16 * i + 2 * k, kanal, 20 + k, "lin"))
            a.append((f"{seite}_fader_{k + 1}", 17 + 8 * i + 2 * k, kanal, 24 + k, "lin"))
    for j, ch in enumerate("abcd"):
        b = 69 + 10 * j  # gain, hi, mid, low, filter (low c/d at 95/105 by the pattern; Encdr lists single bytes 96/106)
        a.append((f"mixer_gain_{ch}", b, MIX[ch], 1, "lin"))
        a.append((f"mixer_eq_hi_{ch}", b + 2, MIX[ch], 2, "eq"))
        a.append((f"mixer_eq_mid_{ch}", b + 4, MIX[ch], 3, "eq"))
        a.append((f"mixer_eq_low_{ch}", b + 6, MIX[ch], 4, "eq"))
        a.append((f"mixer_filter_{ch}", b + 8, MIX[ch], 5, "lin"))
        a.append((f"mixer_fader_{ch}", 33 + 2 * j, MIX[ch], 7, "lin"))
    a.append(("crossfader", 41, GLOBAL, 8, "lin"))
    return a


# screen encoders: absolute 0..999, wrapping -> relative CC (two's complement), report 0x02 bytes 1..16
def encoder():
    return [(f"{seite}_screen_encoder_{k + 1}", 1 + 8 * i + 2 * k, kanal, 40 + k)
            for i, (seite, kanal) in enumerate((("left", 13), ("right", 14))) for k in range(4)]


ANALOG_MAX = 4078.0


def zu_7bit(roh, art):
    x = min(max(roh / ANALOG_MAX, 0.0), 1.0)
    if art == "eq":  # kern eq: dB = -26 + 32 * v; knob: left half -26..0 dB, right half 0..+6 dB
        db = -26.0 + 52.0 * x if x <= 0.5 else 12.0 * (x - 0.5)
        x = (db + 26.0) / 32.0
    return int(round(x * 127))
