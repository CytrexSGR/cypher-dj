# Cypher Hall: Mathematik

Stand 2026-10-11. Quellen: Vickers u. a., *Frequency Domain Artificial Reverberation using Spectral
Magnitude Decay* (Kopie in `~/messungen/2026-10-11-cypher-eq/vickers.pdf`); Roth u. a. (ETH), *FDverb:
A Frequency-Domain Artificial Reverberator Plug-In*, arXiv:2608.27695 (27.08.2026); Roads, *Computer
Music Tutorial* Kap. 33; Puckette, *Theory and Technique* (Echodichte ≥ 1000/s); Pirkle Kap. 17/20
(RT60, Phase-Vocoder, COLA).

## 1 Aufbau

    y = (1 − mix)·x + mix·( early·ER(x) + spät·T(x) )

- **ER** (frühe Reflexionen): dünnes FIR im Zeitbereich, keine Blocklatenz. E Taps je Kanal, Zeiten
  quadratisch verteilt in [T_pre, T_pre + L_er] (Dichte wächst mit der Zeit wie im Raum), Gewichte
  ±10^(−3(t_i − T_pre)/T60_er), Energie auf 1 normiert. Eigener Zufallssamen je Kanal (Stereo).
- **T** (Fahne): STFT-Hall nach Vickers/FDverb, beginnt um T_pre + L_er/2 verzögert und blendet
  über das Analysefenster ein. Weil die Fahne ohnehin später einsetzt als die STFT-Latenz,
  meldet das Plugin **keine Latenz**; der trockene Weg bleibt unverzögert.

## 2 STFT

Rahmen N (512…8192), Hop H = N/4, Fenster √Hann (periodisch) bei Analyse und Synthese.
√Hann·√Hann = Hann, Σ Hann bei Hop N/4 = 2 (COLA). Vickers: bei R = N/4 ist der Rippel der
Überlagerung zu einer Exponentialkurve vernachlässigbar.

## 3 Abklingen je Bin

Nachhallzeit T60(f) (Sekunden bis −60 dB). Pro Hop fällt die Amplitude um g:

    20·log10(g_k) / (H/fs) = −60 / T60(f_k)   ⇒   g_k = 10^(−3H / (fs·T60(f_k)))

(Vickers Gl. für g(Ω_k); FDverb Fußnote 5 identisch mit β = 1 − g.)

T60(f) aus drei Stützwerten: Decay bei 1 kHz, Faktor tief (bei 150 Hz), Faktor hoch (bei 8 kHz),
dazwischen linear in log2(f) interpoliert, außen konstant.

## 4 Energie statt Amplitude akkumulieren

Vickers akkumuliert Beträge (Y = X + g·Y). Bei zufälliger Phase addieren sich Reflexionen aber
**inkohärent**, also in der Leistung. Deshalb hier

    P_k(u) = g_k² · P_k(u−1) + |X_k(u)|²
    M_k(u) = √( (1 − g_k²) · P_k(u) )

Für einen Impuls ist Σ_u M_k(u)² = Σ_u |X_k(u)|²: die Fahne trägt genau die eingespeiste Energie,
unabhängig von T60. Die Lautstärke hängt damit am Regler „Level“, nicht an der Länge.

## 5 Phase: Kohärenz gegen Diffusion

Vickers 6.3 (Partial Phase Randomization): φ_s = φ + V·θ, θ ~ U[−π, π], V ∈ [0, 1].
Die Phasenfortschreibung braucht eine Frequenz je Bin, die nach Vickers 5.1.3 „nach Betrag und
Jüngstem gewichtet, im Takt des Abklingens“ aus der Geschichte kommen soll. Das leistet ein
komplexer Akkumulator mit DERSELBEN Rückkopplung wie die Energie:

    Δ_in,k(u) = princarg( ∠X_k(u) − ∠X_k(u−1) )
    C_k(u)    = g_k² · C_k(u−1) + |X_k(u)|² · e^{jΔ_in,k(u)}
    φ_k(u)    = φ_k(u−1) + ∠C_k(u) + V · π · r,   r ~ U[−1, 1]

V = 0: tonaler, „eingefrorener“ Hall (Vickers 3.1, klingt bei Impulsen periodisch);
V = 1: volle Diffusion (FDverb, Rauschträger). Parameter „Diffusion“.

## 6 Stereo

Zwei Fahnen mit unabhängigen Zufallsfolgen (L aus x_L, R aus x_R). Breite w über M/S:
M = (t_L + t_R)/2, S = (t_L − t_R)/2, Ausgang L = M + w·S, R = M − w·S.

## 7 Ducking je Frequenz (Cypher-eigen)

Der Hall räumt die Bins, die das trockene Signal gerade belegt (Wiener-Form):

    D_k: Hüllkurve von |X_k|² des UNVERZÖGERTEN Trockenen (eigene Analyse, Anstieg sofort,
         Abfall 80 ms in der Amplitude = 40 ms in der Leistung)
    d_k = √( M_k² / (M_k² + a · D_k) ),   a = 30 · duck²

duck = 0 ⇒ d_k = 1. Wo Trockenes dominiert, geht der Hall zurück, sonst bleibt er.

## 8 Freeze, Kill

Freeze: g_k = 1 und keine Einspeisung (P bleibt stehen, Phase läuft weiter).
Kill: P = C = 0.

## 9 Messgrößen (Abnahme)

- **T60 je Band**: Rückwärtsintegration nach Schroeder, EDC(t) = ∫_t^∞ h²(τ) dτ, Gerade durch
  −5 … −35 dB (T30), ×2.
- **Echodichte**: normiertes Echodichte-Profil nach Abel & Huang (WASPAA 2006, aus dem
  Gedächtnis, nicht im Netz gegengelesen): Anteil der Samples im 20-ms-Fenster, die über der
  lokalen Standardabweichung liegen, geteilt durch erfc(1/√2) ≈ 0,3173. Gauß-Rauschen ⇒ 1. Das
  Maß wird im Test selbst gegen Rauschen (≈ 1) und einen dünnen Impulszug (≪ 1) geeicht.
- **Energie**: Impuls rein ⇒ Fahnenenergie = Level (±0,5 dB).
