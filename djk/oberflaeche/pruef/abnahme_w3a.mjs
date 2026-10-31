// Zielabnahme Paket 1.13 Warp, Slice 3a (Auto-Warp lang) gegen eine PRÜFINSTANZ (Seiten-Server mit Kern, Bungee ON, Export-Senke), Katalog/Ablage/Mediathek aus w3a_aufbau.mjs:
//   node pruef/w3a_aufbau.mjs --ziel /tmp/w3a-ziel --instanz a > /tmp/w3a-ziel/aufbau.json
//   CYPHERDJ_PYTHON=$HOME/cypher-dj/djk/werkstatt/.venv/bin/python CYPHERDJ_ANALYSE=/tmp/w3a-ziel/analyse CYPHERDJ_MEDIATHEK=/tmp/w3a-ziel/mediathek.sqlite \
//     CYPHERDJ_KATALOG=/tmp/w3a-ziel/katalog.sqlite DJK=<worktree>/djk djk/start/djk-start --instanz a --arr1
//   (Umgebungsvariablen, keine Optionen: djk-start reicht sie an die Oberfläche durch, Task 14 Step 5; CYPHERDJ_PYTHON, weil der Worktree kein .venv hat und Z4 die echte Werkstatt startet)
//   node pruef/abnahme_w3a.mjs --url http://127.0.0.1:48300 --aufbau /tmp/w3a-ziel/aufbau.json [--ausgabe <Ordner>]
//   Z1  AK10  Drift-Track (255 Schläge) per clip_neu warp auto: quelle werkstatt, 255 Marker, COMPLEX; Export 0..250 Beats: Anschläge gegen das 128er Raster, Rest p90 ≤ 1 ms
//   NK1 AK10  derselbe Track mit konstantem Warp zur Ausgleichs-BPM (zwei Marker): Rest p90 > 5 ms (mit demselben Messgerät)
//   Z1b       Bericht: dieselbe Karte als RE-PITCH (kein Gate)
//   Z2  AK19  Eins bei Karten-Beat 2, Clip auf Projekt-Beat 16 (Takt 5): proj_warp bei_beat 16 = Quellsekunde der Eins, eins_unsicher; Export 16..24: erster Anschlag ± 1 ms vom Takt
//   Z3  AK20  je ein Fall werkstatt, traktor, takte, mediathek, keine Quelle (kein Warp, Hinweis kein_tempo), One-Shot (kein Warp, kein Hinweis)
//   Z4  Analyse auf Abruf mit der echten Werkstatt: langer Track ohne Karte (echte sha) → sofort Warp mediathek (F2), Hinweis analyse_angefordert, analyse in /proj/aktuell,
//       nach Ankunft Warp werkstatt (100 bis 4096 Marker), ein Verlaufseintrag Auto-Warp mit Quelle cypher, analyse leer (der Transport steht, der Clip klingt nicht)
//   Z5  AK2   Marker hinter der Quelle → 400 warp_marker, 4097 Marker → 400 warp_marker; Positivkontrollen (4096, innerhalb) 200
// Rückgabe: 0 alle Punkte OK, 1 mindestens ein Punkt FEHL, 2 Aufruf. Aufräumen: nur die eigenen Projekte (Slug w3a-...). KI-Stopp (AK28): abnahme_ea.mjs 1.5 (unverändert).
import { starte, Fehl } from './w3a_ziel.mjs';
import { messe } from './w3a_messen.mjs';

const z = starte('abnahme_w3a', 'w3a');
const { AUFBAU: A, CYPHER, notiere, info, aendern, aktuell, exportiere, fmt } = z;
const clips = async () => (await aktuell()).projekt.spuren.flatMap((s) => s.clips);
const warpLage = async (id, bei) => z.erwarte200('/proj/warp', await z.ruf('GET', `/proj/warp?clip_id=${id}${bei === undefined ? '' : `&bei_beat=${bei}`}&marker_max=4096`)).j;

async function lauf() {
  // --- Z1 / NK1 / Z1b: AK10
  z.punkt = 'Z1';
  await z.neuesProjekt('drift');
  await z.setzeTempo(128);
  await aendern('W3a Aufbau', [{ befehl: 'spur_neu', art: 'audio', name: 'Drift' },
    { befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 0, laenge_beats: 1, sha256: A.shas[1], warp: 'auto' }], CYPHER);
  const c1 = (await clips())[0];
  notiere('Z1a Auto-Warp aus der Karte: quelle werkstatt, 255 Marker, COMPLEX, Beat 0 = erster Schlag, Länge ≥ 254 Beats', c1.warp?.quelle === 'werkstatt' && c1.warp.marker.length === 255 && c1.warp.modus === 'complex'
    && c1.warp.marker[0][1] === 0 && c1.laenge_beats >= 254, `quelle ${c1.warp?.quelle}, ${c1.warp?.marker?.length} Marker, ${c1.warp?.modus}, Länge ${c1.laenge_beats}`);
  const w1 = await exportiere(0, 250, 'z1-drift-complex');
  const m1 = messe(w1.l, 128);
  notiere('Z1 AK10: Anschläge im Export gegen das 128er Raster, Rest p90 ≤ 1 ms bei ≥ 240 Anschlägen', m1.n >= 240 && m1.p90 <= 1.0, `${m1.n} Anschläge, p90 ${fmt(m1.p90)} ms, Median ${fmt(m1.median)}, Maximum ${fmt(m1.max)}`);
  const t0 = m1.t[0] * 1000;   // Gerätekonstante: Anschlag 0 liegt auf Sample 0 des Exports; sein Messwert ist der Versatz der Hüllkurve (Anstieg 2 ms)
  info(`Gerätekonstante (erster Anschlag des Exports): ${fmt(t0)} ms`);
  // Ausgleichs-BPM: Kleinste Quadrate der Schlagzeiten über dem Index
  const s = A.schlaege_s, n = s.length;
  const mk = (n - 1) / 2, ms = s.reduce((a, b) => a + b, 0) / n;
  const a = s.reduce((acc, y, i) => acc + (i - mk) * (y - ms), 0) / s.reduce((acc, _, i) => acc + (i - mk) ** 2, 0), c = ms - a * mk;
  const konstant = { an: true, modus: 'complex', marker: [[c, 0], [c + a * (n - 1), n - 1]], versatz_beats: 0, quelle: 'mediathek', transpose_st: 0, detune_ct: 0 };
  await aendern('W3a NK1 konstant', [{ befehl: 'warp_setzen', clip_id: c1.id, warp: konstant }], CYPHER);
  const wk = await exportiere(0, 250, 'nk1-konstant');
  const mk1 = messe(wk.l, 128);
  notiere('NK1 AK10 Negativ-Kontrolle: konstanter Warp zur Ausgleichs-BPM reißt p90 > 5 ms (dasselbe Messgerät)', mk1.n >= 200 && mk1.p90 > 5.0, `${mk1.n} Anschläge, p90 ${fmt(mk1.p90)} ms (Ausgleichs-BPM ${fmt(60 / a)})`);
  await aendern('W3a Z1b zurück', [{ befehl: 'warp_auto', clip_id: c1.id }, { befehl: 'warp_setzen', clip_id: c1.id, modus: 'repitch' }], CYPHER);
  const wr = await exportiere(0, 250, 'z1b-drift-repitch');
  const mr = messe(wr.l, 128);
  info(`Z1b RE-PITCH mit derselben Karte: ${mr.n} Anschläge, p90 ${fmt(mr.p90)} ms, Maximum ${fmt(mr.max)} ms (Bericht, kein Gate)`);

  // --- Z2: AK19
  z.punkt = 'Z2';
  await z.neuesProjekt('eins');
  await aendern('W3a Eins', [{ befehl: 'spur_neu', art: 'audio', name: 'Eins' },
    { befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 16, laenge_beats: 1, sha256: A.shas[2], warp: 'auto' }], CYPHER);
  const c2 = (await clips())[0], l2 = await warpLage(c2.id, 16);
  notiere('Z2a AK19: Projekt-Beat 16 klingt die Quellsekunde der ersten Eins (Schlag 2), eins_unsicher in proj_warp', l2.warp.eins_unsicher === true && Math.abs(l2.bei.quell_s - A.schlaege_s[2]) < 1e-9 && l2.warp.marker[0].beat === -2,
    `bei 16: ${l2.bei?.quell_s} s (Schlag 2: ${A.schlaege_s[2]} s), eins_unsicher ${l2.warp.eins_unsicher}, erster Marker-Beat ${l2.warp.marker[0].beat}`);
  const w2 = await exportiere(16, 24, 'z2-eins');
  const m2 = messe(w2.l, 128), versatz = m2.t[0] * 1000 - t0;
  notiere('Z2 AK19: die Eins liegt auf Projekt-Beat 16 ± 1 ms (Anschlag 0 des Exports minus Gerätekonstante)', m2.n >= 6 && Math.abs(versatz) <= 1.0, `${m2.n} Anschläge, erster bei ${fmt(m2.t[0] * 1000)} ms, Versatz ${fmt(versatz)} ms`);

  // --- Z3: AK20
  z.punkt = 'Z3';
  await z.neuesProjekt('reihe');
  const r3 = await aendern('W3a Reihenfolge', [{ befehl: 'spur_neu', art: 'audio', name: 'Quellen' },
    ...[[1, 0], [3, 400], [4, 800], [5, 1000], [6, 1100], [7, 1200]].map(([n, b]) => ({ befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: b, laenge_beats: 2, sha256: A.shas[n], warp: 'auto' }))], CYPHER);
  const c3 = await clips(), q = (i) => c3[i].warp?.quelle ?? null;
  notiere('Z3 AK20: werkstatt, traktor, takte, mediathek, keine Quelle, One-Shot (kein Warp)', JSON.stringify([0, 1, 2, 3, 4, 5].map(q)) === JSON.stringify(['werkstatt', 'traktor', 'takte', 'mediathek', null, null]),
    JSON.stringify([0, 1, 2, 3, 4, 5].map(q)));
  notiere('Z3b AK20: Hinweis kein_tempo nur für die Quelle-lose (Index 5 in der Befehlsliste, die Spur ist Index 0), keiner für den One-Shot', JSON.stringify(r3.hinweise) === JSON.stringify([{ index: 5, hinweis: 'kein_tempo' }]), JSON.stringify(r3.hinweise));

  // --- Z4: Analyse auf Abruf, echte Werkstatt
  z.punkt = 'Z4';
  await z.neuesProjekt('lang');
  const r4 = await aendern('W3a Lang', [{ befehl: 'spur_neu', art: 'audio', name: 'Lang' },
    { befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 0, laenge_beats: 1, sha256: A.shas[8], warp: 'auto' }], CYPHER);
  const c4 = (await clips())[0], lauf4 = (await aktuell()).analyse;
  notiere('Z4a langer Track ohne Karte: sofort der Mediathek-Warp (F2), Hinweis analyse_angefordert, analyse in /proj/aktuell', c4.warp?.quelle === 'mediathek' && JSON.stringify(r4.hinweise) === JSON.stringify([{ index: 1, hinweis: 'analyse_angefordert' }])
    && Array.isArray(lauf4) && lauf4[0]?.clip_id === c4.id, `quelle ${c4.warp?.quelle}, hinweise ${JSON.stringify(r4.hinweise)}, analyse ${JSON.stringify(lauf4)}`);
  const t4 = Date.now();
  const da = await z.bisWahr(async () => (await clips())[0].warp?.quelle === 'werkstatt', 600000);
  const c4b = (await clips())[0], a4 = (await aktuell()), verlauf = z.erwarte200('/proj/verlauf', await z.ruf('GET', '/proj/verlauf')).j;
  notiere('Z4b nach Ankunft: Warp werkstatt mit 100 bis 4096 Markern, ein Verlaufseintrag Auto-Warp (Quelle cypher), analyse leer', da && c4b.warp.marker.length >= 100 && c4b.warp.marker.length <= 4096
    && verlauf.at(-1)?.label === 'Auto-Warp' && verlauf.at(-1)?.quelle === 'cypher' && a4.analyse === undefined,
    `${da ? `nach ${Math.round((Date.now() - t4) / 1000)} s` : 'keine Ankunft nach 600 s'}, ${c4b.warp?.marker?.length} Marker, letzter Eintrag „${verlauf.at(-1)?.label}“ von ${verlauf.at(-1)?.quelle}, eins_unsicher ${c4b.warp?.eins_unsicher}`);
  if (da) { const w4 = await exportiere(0, 64, 'z4-lang'); const m4 = messe(w4.l, 128); info(`Z4 Export 0..64 nach der Ankunft: ${m4.n} Anschläge, p90 ${fmt(m4.p90)} ms (Bericht; die echte Analyse an einem Klick-Track, kein Gate)`); }

  // --- Z5: AK2 Grenzen (Clip aus Z1, Dauer der Quelle aus dem Katalog)
  z.punkt = 'Z5';
  await z.neuesProjekt('grenze');
  await aendern('W3a Grenze', [{ befehl: 'spur_neu', art: 'audio', name: 'G' }, { befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 0, laenge_beats: 8, sha256: A.shas[3] }], CYPHER);
  const cg = (await clips())[0];
  const warp = (marker) => ({ an: true, modus: 'complex', marker, versatz_beats: 0, quelle: 'hand', transpose_st: 0, detune_ct: 0 });
  const innen = await z.aendernRoh('W3a innen', [{ befehl: 'warp_setzen', clip_id: cg.id, warp: warp([[0, 0], [99, 200]]) }], CYPHER);
  const aussen = await z.aendernRoh('W3a außen', [{ befehl: 'warp_setzen', clip_id: cg.id, warp: warp([[0, 0], [101, 200]]) }], CYPHER);
  notiere('Z5a AK2: Marker innerhalb der Quelle (99 s von 100 s) gilt, hinter der Quelle (101 s) → warp_marker', innen.code === 200 && aussen.code >= 400 && aussen.j?.fehler === 'warp_marker', `innen ${z.grundVon(innen)}, außen ${z.grundVon(aussen)}`);
  const linie = (k) => Array.from({ length: k }, (_, i) => [i * 90 / (k - 1), i * 0.025]);   // k Marker über 90 s, 0,025 Beat je Schritt: Segment-Tempo rund 68 BPM (gültig)
  const g4096 = await z.aendernRoh('W3a 4096', [{ befehl: 'warp_setzen', clip_id: cg.id, warp: warp(linie(4096)) }], CYPHER);
  const g4097 = await z.aendernRoh('W3a 4097', [{ befehl: 'warp_setzen', clip_id: cg.id, warp: warp(linie(4097)) }], CYPHER);
  notiere('Z5b AK2: 4096 Marker gelten, 4097 → warp_marker', g4096.code === 200 && g4097.code >= 400 && g4097.j?.fehler === 'warp_marker', `4096: ${z.grundVon(g4096)}, 4097: ${z.grundVon(g4097)}`);
}

try {
  await lauf();
} catch (e) {
  if (e instanceof Fehl) notiere(z.punkt, false, e.message); else notiere('ABBRUCH', false, `${z.punkt}: ${e.stack ?? String(e)}`);
}
await z.ende('Abnahme W3a Slice 3a', /^w3a-(drift|eins|reihe|lang|grenze)-\d{8}t\d{6}/i);
