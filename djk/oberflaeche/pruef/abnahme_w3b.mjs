// Zielabnahme Paket 1.13 Warp, Slice 3b (Marker von Hand) gegen eine PRÜFINSTANZ (Seiten-Server mit Kern, Bungee ON, Export-Senke), Material aus w3b_aufbau.mjs:
//   node pruef/w3b_aufbau.mjs --ziel /tmp/w3b-ziel --instanz a > /tmp/w3b-ziel/aufbau.json
//   CYPHERDJ_PYTHON=$HOME/cypher-dj/djk/werkstatt/.venv/bin/python CYPHERDJ_ANALYSE=/tmp/w3b-ziel/analyse CYPHERDJ_MEDIATHEK=/tmp/w3b-ziel/mediathek.sqlite \
//     CYPHERDJ_KATALOG=/tmp/w3b-ziel/katalog.sqlite CYPHERDJ_KORREKTUREN=/tmp/w3b-ziel/bestand DJK=<worktree>/djk djk/start/djk-start --instanz a --arr1
//   node pruef/abnahme_w3b.mjs --url http://127.0.0.1:48300 --aufbau /tmp/w3b-ziel/aufbau.json [--ausgabe <Ordner>] [--rueckweg]
//   Z0  D5    Pin, kein Fehlerfall: der Auto-Warp eines Tracks aus der Karte legt den Clip mit COMPLEX an (das war schon vor D5 so; den Fehlerfall trennt nur der Unit-Test, Task 6)
//   Z1  AK21  jeder Befehl (Marker setzen, ziehen, löschen, Warp From Here gerade und start, Set 1.1.1 Here, ×2, :2, Set project tempo) ist EIN Verlaufseintrag, der Kern lädt ihn,
//             ein Undo stellt den Stand davor her, Redo den danach; nach ×2 sind alle Segment-BPM doppelt und die Clip-Länge in Beats doppelt
//   Z2  AK22  RE-PITCH: Export 0..40 Beats mit dem ganzen Clip gegen Export mit dem bei Beat 20 geteilten Clip: außerhalb ± 96 Samples um die Teilstelle Sample für Sample gleich
//   NK2       dieselbe Messung, der zweite Teil um 0,05 Beat falsch versetzt: das Messgerät sieht es (mehr als 1000 abweichende Samples)
//   Z3  AK22  COMPLEX: die Klicks beider Exporte liegen höchstens 16 Samples neben dem Raster des ganzen Clips (gleiche Klickzahl)
//   NK3       dieselbe Messung mit dem falsch versetzten zweiten Teil: mehr als 16 Samples
//   Z6  ×2    Sinus 440 Hz, ×2 in COMPLEX: Tonhöhe ± 5 ct bei doppelter Länge; NK6 dieselbe Messung in RE-PITCH liegt bei 1200 · log2(128/125/2) = −1159 ct ± 20
//             (der Loop läuft in RE-PITCH mit 128/125 schneller als sein Original, ×2 halbiert das Tempo)
//   Z4  AK28  dieselben Befehle mit Quelle cypher: Verlauf nennt cypher (KI-Stopp: abnahme_ea.mjs 1.5, unverändert)
//   Z5  D3    (nur mit --rueckweg und CYPHERDJ_KORREKTUREN) Set 1.1.1 Here auf dem Track mit Bestand: Hinweis eins_gemeldet, eine Zeile von andreas in korrekturen.jsonl, der nächste
//             Auto-Warp desselben Tracks beginnt an der neuen Eins und ist sicher
// Rückgabe: 0 alle Punkte OK, 1 mindestens ein Punkt FEHL, 2 Aufruf. Aufräumen: nur die eigenen Projekte (Slug w3b-...).
import fs from 'node:fs';
import path from 'node:path';
import { starte, Fehl } from './w3a_ziel.mjs';
import { abweichungAusserhalb, klickStellen, klickVersatz, rasterAbweichung } from './w3b_messen.mjs';
import { frequenz, cent } from './w1_wav.mjs';

const z = starte('abnahme_w3b', 'w3b', { rueckweg: { type: 'boolean' } });
const { AUFBAU: A, CYPHER, notiere, info, aendern, aktuell, exportiere, fmt } = z;
const clips = async () => (await aktuell()).projekt.spuren.flatMap((s) => s.clips);
const clipVon = async (id) => (await clips()).find((c) => c.id === id);
const verlauf = async () => z.erwarte200('/proj/verlauf', await z.ruf('GET', '/proj/verlauf')).j;
const stand = async () => { const p = (await aktuell()).projekt, c = p.spuren[0].clips.find((x) => x.id === 'c1'); return JSON.stringify([p.tempo_bpm, c.laenge_beats, c.warp]); };
const rueck = async (art) => z.erwarte200(`/proj/${art}`, await z.ruf('POST', `/proj/${art}`, { rev: await z.holeRev() }));
const warpLage = async (id, bei) => z.erwarte200('/proj/warp', await z.ruf('GET', `/proj/warp?clip_id=${id}${bei === undefined ? '' : `&bei_beat=${bei}`}&marker_max=4096`)).j;
const neu = async (name, sha = A.shas[1], start = 0) => {
  await z.neuesProjekt(name);
  await z.setzeTempo(128);
  await aendern('W3b Aufbau', [{ befehl: 'spur_neu', art: 'audio', name: 'Drift' },
    { befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: start, laenge_beats: 1, sha256: sha, warp: 'auto' }], CYPHER);
};
const S = A.schlaege_s;

async function lauf() {
  // --- Z1 und Z4: AK21, AK28
  z.punkt = 'Z1';
  await neu('befehle');
  await z.geladen();
  const c0 = await clipVon('c1');
  notiere('Z0 D5 (Pin, kein Fehlerfall von D5): der Auto-Warp eines Tracks aus der Karte legt den Clip mit COMPLEX an', c0.warp?.quelle === 'werkstatt' && c0.warp.modus === 'complex', `quelle ${c0.warp?.quelle}, modus ${c0.warp?.modus}`);
  const schritte = [
    ['Marker setzen', { befehl: 'warp_marker', clip_id: 'c1', setze: [{ quell_s: (S[10] + S[11]) / 2 }] }],
    ['Marker ziehen', { befehl: 'warp_marker', clip_id: 'c1', verschiebe: [{ beat: 20, neu_quell_s: S[20] + 0.01 }] }],
    ['Marker löschen', { befehl: 'warp_marker', clip_id: 'c1', loesche: [30] }],
    ['Warp From Here (Straight)', { befehl: 'warp_ab_hier', clip_id: 'c1', beat: 100, art: 'gerade' }],
    ['Warp From Here (Start)', { befehl: 'warp_ab_hier', clip_id: 'c1', beat: 50, art: 'start' }],
    ['Set 1.1.1 Here', { befehl: 'eins_hier', clip_id: 'c1', quell_s: S[4] }],
    ['×2', { befehl: 'warp_tempo', clip_id: 'c1', faktor: 2 }],
    [':2', { befehl: 'warp_tempo', clip_id: 'c1', faktor: 0.5 }],
  ];
  for (const [kz, kopf, name] of [['Z1', {}, 'andreas'], ['Z4', CYPHER, 'cypher']]) {
    z.punkt = kz;
    if (kz === 'Z4') { await neu('befehle-cypher'); await z.geladen(); }
    for (const [text, befehl] of schritte) {
      const vorher = await stand(), n0 = (await verlauf()).length;
      const lage0 = await warpLage('c1');
      await aendern(`W3b ${text}`, [befehl], kopf);
      await z.geladen();                                          // der Kern hat die neue Wiedergabe geladen (rev_geladen = wiedergabe_rev)
      const nachher = await stand(), v = await verlauf(), lage = await warpLage('c1');
      const ein = v.length === n0 + 1 && v.at(-1).quelle === name;
      let bpmOk = true;
      if (befehl.befehl === 'warp_tempo') {
        const f = befehl.faktor, c = await clipVon('c1'), c0 = JSON.parse(vorher)[1];
        bpmOk = Math.abs(c.laenge_beats - c0 * f) < 1e-6 && lage.warp.marker.slice(0, -1).every((m, i) => Math.abs(m.segment_bpm - lage0.warp.marker[i].segment_bpm * f) < 1e-9);
      }
      await rueck('undo'); const zurueck = await stand();
      await rueck('redo'); const wieder = await stand();
      notiere(`${kz} AK21${kz === 'Z4' ? '/AK28' : ''} ${text}: ein Verlaufseintrag (Quelle ${name}), Undo stellt den Stand davor her, Redo den danach${befehl.befehl === 'warp_tempo' ? ', Tempi und Länge ×Faktor' : ''}`,
        ein && nachher !== vorher && zurueck === vorher && wieder === nachher && bpmOk,
        `Einträge ${n0} → ${v.length} (letzte Quelle ${v.at(-1)?.quelle}), geändert ${nachher !== vorher}, Undo gleich ${zurueck === vorher}, Redo gleich ${wieder === nachher}, Tempi/Länge ${bpmOk}`);
    }
    // Set project tempo: das Projekttempo (128) wird das Fenstertempo des Clips (Drift 127,5..128,5 → rund 128); zuerst auf 120 stellen, damit es etwas zu tun gibt
    await z.setzeTempo(120);
    const n0 = (await verlauf()).length;
    await aendern('W3b Set project tempo', [{ befehl: 'tempo_vom_clip', clip_id: 'c1' }], kopf);
    const t = (await aktuell()).projekt.tempo_bpm;
    notiere(`${kz} AK21 Set project tempo: das Projekttempo wird das Fenstertempo des Clips (127,5 bis 128,5), ein Eintrag`, t > 127.4 && t < 128.6 && (await verlauf()).length === n0 + 1, `Tempo ${t}, Einträge ${n0} → ${(await verlauf()).length}`);
  }

  // --- Z2, NK2, Z3, NK3: AK22
  for (const modus of ['repitch', 'complex']) {
    z.punkt = modus === 'repitch' ? 'Z2' : 'Z3';
    await neu(`teilen-${modus}`);
    if (modus === 'repitch') await aendern('W3b RE-PITCH', [{ befehl: 'warp_setzen', clip_id: 'c1', modus: 'repitch' }], CYPHER);
    const ganz = await exportiere(0, 40, `${z.punkt.toLowerCase()}-ganz-${modus}`);
    await aendern('W3b Teilen', [{ befehl: 'clip_teilen', clip_id: 'c1', beat: 20 }], CYPHER);
    const geteilt = await exportiere(0, 40, `${z.punkt.toLowerCase()}-geteilt-${modus}`);
    const mitte = Math.round(20 * 60 / 128 * 48000);               // 450 000: die Teilstelle im Export
    if (modus === 'repitch') {
      const r = abweichungAusserhalb(ganz.l, geteilt.l, mitte, 96);
      notiere('Z2 AK22 RE-PITCH: der geteilte Clip klingt außerhalb ± 96 Samples um die Teilstelle Sample für Sample wie der ganze', r.laenge_gleich && r.n === 0, `Länge gleich ${r.laenge_gleich}, abweichende Samples ${r.n}, größte Abweichung ${r.max}, erste bei ${r.erst}`);
    } else {
      const per = 60 / 128 * 48000, null0 = klickStellen(ganz.l)[0] ?? 0;
      const rg = rasterAbweichung(ganz.l, null0, per), rt = rasterAbweichung(geteilt.l, null0, per), k = klickVersatz(ganz.l, geteilt.l);
      notiere('Z3 AK22 COMPLEX: die Klicks beider Exporte liegen höchstens 16 Samples neben dem Raster des ganzen Clips', rg.n === rt.n && rg.n > 0 && rg.max <= 16 && rt.max <= 16,
        `Klicks ${rg.n}/${rt.n}, neben dem Raster: ganz ${rg.max}, geteilt ${rt.max} (bei Sample ${rt.stelle}); paarweise ${k.max} (nur Auskunft)`);
    }
    z.punkt = modus === 'repitch' ? 'NK2' : 'NK3';
    await aendern('W3b falscher Versatz', [{ befehl: 'clip_aendern', clip_id: 'c2', versatz_beats: 20.05 }], CYPHER);
    const falsch = await exportiere(0, 40, `${z.punkt.toLowerCase()}-falsch-${modus}`);
    if (modus === 'repitch') {
      const r = abweichungAusserhalb(ganz.l, falsch.l, mitte, 96);
      notiere('NK2 AK22 Negativ-Kontrolle: um 0,05 Beat falsch versetzter zweiter Teil → mehr als 1000 abweichende Samples (das Messgerät sieht es)', r.n > 1000, `abweichende Samples ${r.n}`);
    } else {
      const r = rasterAbweichung(falsch.l, klickStellen(ganz.l)[0] ?? 0, 60 / 128 * 48000);
      notiere('NK3 AK22 Negativ-Kontrolle: um 0,05 Beat falsch versetzter zweiter Teil → mehr als 16 Samples neben dem Raster (das Messgerät sieht es)', r.max > 16, `Klicks ${r.n}, neben dem Raster ${r.max} Samples`);
    }
  }

  // --- Z6: ×2 hält die Tonhöhe (COMPLEX) und RE-PITCH nicht (Negativ-Kontrolle): Sinus 440 Hz (kurz.wav, Fall 4, ein Loop zu zwei Takten)
  z.punkt = 'Z6';
  await neu('tonhoehe', A.shas[4], 0);
  const sinus = async (name) => { const x = await exportiere(0, 16, name); return cent(frequenz(x.l, 48000, 6 * 48000), 440); };
  await aendern('W3b ×2', [{ befehl: 'warp_tempo', clip_id: 'c1', faktor: 2 }], CYPHER);
  const cx = await clipVon('c1');
  const ctC = await sinus('z6-complex-x2');
  notiere('Z6 ×2 in COMPLEX hält die Tonhöhe: 440 Hz ± 5 ct bei doppelter Länge (16 Beats)', cx.warp.modus === 'complex' && cx.laenge_beats === 16 && Math.abs(ctC) <= 5, `Modus ${cx.warp.modus}, Länge ${cx.laenge_beats}, ${fmt(ctC)} ct`);
  await aendern('W3b RE-PITCH', [{ befehl: 'warp_setzen', clip_id: 'c1', modus: 'repitch' }], CYPHER);
  const ctR = await sinus('z6-repitch-x2');
  notiere('NK6 Negativ-Kontrolle: dieselbe Messung in RE-PITCH liegt bei 1200 · log2(128/125/2) = −1159 ct ± 20', Math.abs(ctR + 1159) <= 20, `${fmt(ctR)} ct`);

  // --- Z5: D3, nur mit --rueckweg
  z.punkt = 'Z5';
  if (!z.opt.rueckweg) { info('Z5 D3 übersprungen: ohne --rueckweg (die Instanz braucht CYPHERDJ_KORREKTUREN=<bestand aus w3b_aufbau>)'); return; }
  const datei = path.join(A.bestand, A.shas[2].slice(0, 16), 'korrekturen.jsonl');
  fs.rmSync(datei, { force: true });
  await neu('rueckweg', A.shas[2], 16);
  const r = await aendern('W3b Set 1.1.1', [{ befehl: 'eins_hier', clip_id: 'c1', quell_s: S[5] }], CYPHER);
  const zeilen = fs.existsSync(datei) ? fs.readFileSync(datei, 'utf8').trim().split('\n').map((x) => JSON.parse(x)) : [];
  notiere('Z5a D3: Hinweis eins_gemeldet und eine Zeile von andreas (art eins, Karten-Beat 5) im Bestand', JSON.stringify(r.hinweise) === '[{"index":0,"hinweis":"eins_gemeldet"}]' && zeilen.length === 1
    && zeilen[0].von === 'andreas' && zeilen[0].art === 'eins' && zeilen[0].ab_quell_beat === 5, `Hinweise ${JSON.stringify(r.hinweise)}, Zeilen ${JSON.stringify(zeilen)}`);
  await aendern('W3b zweiter Clip', [{ befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 400, laenge_beats: 1, sha256: A.shas[2], warp: 'auto' }], CYPHER);
  const l = await warpLage('c2', 400);
  notiere('Z5b D3: der nächste Auto-Warp desselben Tracks beginnt an der Eins aus der Korrektur (Lage 1 = Schlag 1) und ist sicher', l.warp.eins_unsicher === false && Math.abs(l.bei.quell_s - S[1]) < 1e-6,
    `bei Beat 400: ${l.bei?.quell_s} s (Schlag 1: ${S[1]} s), eins_unsicher ${l.warp.eins_unsicher}`);
}

try {
  await lauf();
} catch (e) {
  if (e instanceof Fehl) notiere(z.punkt, false, e.message); else notiere('ABBRUCH', false, `${z.punkt}: ${e.stack ?? String(e)}`);
}
await z.ende('Abnahme W3b Slice 3b', /^w3b-(befehle|befehle-cypher|teilen-repitch|teilen-complex|tonhoehe|rueckweg)-\d{8}t\d{6}/i);
