// Zielabnahme AK18 (Paket 1.13 Warp, AK18 neu gefasst in Slice 3b, Andreas 2026-10-29) gegen eine PRÜFINSTANZ: ein echter Track der Nachtanalyse, Auto-Warp aus
// seiner Karte, Export eines Fensters, dann der Vergleich Export gegen Quelle (python -m werkstatt.kick_messer, art anschlag seit 29.10.: Versatz je Schlag aus der
// Kreuzkorrelation der Hochpass-Hüllkurven): p90 ≤ 8 ms bei ≥ 64 Paaren. Negativ-Kontrolle je Track: derselbe Karten-Warp, Marker 20 ms versetzt, reißt und
// wird als −20 ± 3 ms gemessen (bei ≥ 64 Paaren, sonst wäre das Reißen ein Blindwert). Bis 29.10. war sie ein konstanter Warp aus Mediathek-BPM, der bei geradem Tempo nicht riss.
// Warum Vergleich: das Tor raster (Tief-Band, alle Anschläge) lag schon an der Quelle 26 und 52 ms neben der Karte (~/messungen/2026-10-29-s3a-ziel/bericht.md).
//   node pruef/ak18_aufbau.mjs --ziel /tmp/ak18-ziel > /tmp/ak18-ziel/aufbau.json
//   CYPHERDJ_PYTHON=$HOME/cypher-dj/djk/werkstatt/.venv/bin/python CYPHERDJ_ANALYSE=/tmp/ak18-ziel/analyse CYPHERDJ_MEDIATHEK=/tmp/ak18-ziel/mediathek.sqlite \
//     CYPHERDJ_KATALOG=/tmp/ak18-ziel/katalog.sqlite DJK=<worktree>/djk djk/start/djk-start --instanz a --arr1
//   node pruef/ak18_ziel.mjs --url http://127.0.0.1:48300 --aufbau /tmp/ak18-ziel/aufbau.json --werkstatt <worktree>/djk/werkstatt --python $HOME/cypher-dj/djk/werkstatt/.venv/bin/python
import { execFileSync } from 'node:child_process';
import { starte, Fehl } from './w3a_ziel.mjs';

const z = starte('ak18_ziel', 'ak18', { werkstatt: { type: 'string' }, python: { type: 'string' } });
const { AUFBAU: A, CYPHER, notiere, info, aendern, aktuell, exportiere, fmt } = z;
if (!z.opt.werkstatt || !z.opt.python) { process.stderr.write('ak18_ziel: --werkstatt <djk/werkstatt des Worktrees> und --python <venv-python> fehlen\n'); process.exit(2); }
// Export beginnt an Projekt-Beat von (Sekunde 0); Projekt-Beat k ↔ Karten-Beat k + erste_eins_quell_beat (D2: der Clip beginnt an der Eins)
const vergleich = (wav, t) => JSON.parse(execFileSync('nice', ['-n', '19', z.opt.python, '-m', 'werkstatt.kick_messer', '--export', wav, '--bpm', '128', '--raster-start-s', '0',
  '--quelle', t.pfad, '--material', `${A.analyse}/${t.mid}/material.json`, '--von-beat', String(t.fenster[0]), '--bis-beat', String(t.fenster[1])],
{ cwd: z.opt.werkstatt, encoding: 'utf8' }).trim().split('\n').at(-1));

async function lauf() {
  for (const t of A.tracks) {
    z.punkt = t.name;
    await z.neuesProjekt(t.mid.slice(0, 6));
    await z.setzeTempo(128);
    await aendern(`AK18 ${t.name}`, [{ befehl: 'spur_neu', art: 'audio', name: t.name },
      { befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 0, laenge_beats: 1, sha256: t.sha, warp: 'auto' }], CYPHER);
    const c = (await aktuell()).projekt.spuren[0].clips[0];
    notiere(`${t.name} Auto-Warp aus der Karte`, c.warp?.quelle === 'werkstatt' && c.warp.marker.length === t.schlaege, `quelle ${c.warp?.quelle}, ${c.warp?.marker?.length} Marker (Karte: ${t.schlaege})`);
    const [von, bis] = t.fenster, wav = await exportiere(von, bis, `${t.mid}-karte`);
    const r = vergleich(wav.datei, t);
    notiere(`${t.name} AK18: Kick Export gegen Quelle p90 ≤ 8 ms bei ≥ 64 Paaren (Fenster ${von}..${bis})`, r.ok === true,
      `${r.paare} Paare von ${r.schlaege} Schlägen, p90 ${r.wert_ms} ms, Median ${r.median_ms} ms (Quelle gegen Karte p90 ${r.quelle_p90_ms}, Export gegen Raster p90 ${r.export_p90_ms}, Kick-Lage ${r.kick_lage_quelle_ms} ms${r.mehrdeutig ? ', MEHRDEUTIG' : ''})`);
    // Negativ-Kontrolle: derselbe Karten-Warp, jeder Marker 20 ms später in der Quelle, die Fassung also 20 ms früher (die Fehlerklasse von Queen of
    // Pain 4282cd99, Render-Fehler 29.10.). Der konstante Warp aus der Mediathek-BPM taugte nicht: bei geradem Tempo ist er richtig und riss nicht (Queen 7,4 ms).
    const VERSATZ_S = 0.020;
    const verschoben = { ...c.warp, marker: c.warp.marker.map(([s, b]) => [s + VERSATZ_S, b]) };
    await aendern(`AK18 NK ${t.name}`, [{ befehl: 'warp_setzen', clip_id: c.id, warp: verschoben }], CYPHER);
    const wavK = await exportiere(von, bis, `${t.mid}-versetzt`);
    const k = vergleich(wavK.datei, t);
    notiere(`${t.name} AK18 Negativ-Kontrolle: Karten-Warp 20 ms versetzt reißt bei ≥ 64 Paaren und wird als −20 ± 3 ms gemessen`,
      k.ok === false && k.paare >= 64 && k.wert_ms > 8.0 && Math.abs(k.median_ms + 20) <= 3, `${k.paare} Paare, p90 ${k.wert_ms} ms, Median ${k.median_ms} ms`);
    info(`${t.name}: Abstand Tor ${fmt(8.0 - r.wert_ms)} ms, Abstand Negativ-Kontrolle ${fmt(k.wert_ms - 8.0)} ms`);
  }
}
try {
  await lauf();
} catch (e) {
  if (e instanceof Fehl) notiere(z.punkt, false, e.message); else notiere('ABBRUCH', false, `${z.punkt}: ${e.stack ?? String(e)}`);
}
await z.ende('AK18 Slice 3a', /^ak18-[0-9a-f]{6}-\d{8}t\d{6}/i);
