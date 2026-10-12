// Probe Browser an einer Prüfinstanz (djk-start --instanz i, stumme Senke) gegen den echten Katalog. Kein Ton.
// Aufruf: node pruef/probe_stoebern.mjs [URL] [--slice N] [--von M]  (prüft die Slices M..N; --von 3 überspringt S2/S2b, z. B. an einem Stapel ohne Muster-Quellen; --von 5 nur S5)
import { starteBrowser } from './cdp.mjs';
const URL = process.argv[2]?.startsWith('http') ? process.argv[2] : 'http://127.0.0.1:56300/';
const BIS = Number(process.argv[process.argv.indexOf('--slice') + 1]) || 1;
const VON = Number(process.argv[process.argv.indexOf('--von') + 1]) || 1;
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
let fehl = 0;
const pruefe = (ok, was) => { console.log(`${ok ? 'OK  ' : 'FEHL'} ${was}`); if (!ok) fehl++; };
// --baue-fixture ORDNER (S5): schreibt einen Scratch-Katalog samt Mediathek, Sammlungen und Mustern, damit die Fehlerfälle der Detail-Spalte
// (fehlende Datei, Ableton-geschützt, ffmpeg-unlesbares .aif) und gleichnamige Samples auch ohne die echte Mediathek prüfbar sind.
// Danach den Stapel mit --katalog/--mediathek/--sammlungen/--muster-* auf diesen Ordner starten und die Probe mit --slice 5 --fixture fahren.
if (process.argv.includes('--baue-fixture')) {
  const fs = await import('node:fs'), path = await import('node:path'), { execFileSync } = await import('node:child_process');
  const dir = path.resolve(process.argv[process.argv.indexOf('--baue-fixture') + 1]);
  const { baueKatalog } = await import('../tests/hilfen/katalog.mjs');
  const { baueMediathek, sha: msha } = await import('../tests/hilfen/mediathek.mjs');
  fs.mkdirSync(dir, { recursive: true });
  const mt = baueMediathek(path.join(dir, 'mt'));
  const d = path.join(dir, 'daten');
  const wav = (rel, sek) => { const p = path.join(d, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); execFileSync('ffmpeg', ['-v', 'quiet', '-y', '-f', 'lavfi', '-i', `sine=f=${220 * (1 + sek)}:d=${sek}`, '-ar', '44100', p]); return p; };
  const roh = (rel) => { const p = path.join(d, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, 'FORM....AIFFkein Audio'); return p; };
  const h = (c) => c.repeat(64);
  baueKatalog(dir, [
    { typ: 'track', werk_id: 1, sha: msha(2), shas: `${msha(1)} ${msha(2)}`, titel: 'Tech Wolf (Edit)', kuenstler: 'Alpha', bpm: 127.5, camelot: '8A', energie: 6, genre: 'Tech House', dauer_s: 3, pfad: wav('Tracks/Fixture Track.wav', 3) },
    { typ: 'track', werk_id: 2, sha: msha(3), shas: msha(3), titel: 'Missing Track', kuenstler: 'Beta', bpm: 122, camelot: '5B', energie: 5, genre: 'House', dauer_s: 200, pfad: path.join(d, 'Tracks/fehlt.mp3') },
    { typ: 'oneshot', sha: h('a'), shas: h('a'), instrument: 'kick', pack: 'Pack A', dauer_s: 0.4, pfad: wav('Kits/A/Drums/1 F1.wav', 0.4) },
    { typ: 'oneshot', sha: h('b'), shas: h('b'), instrument: 'kick', pack: 'Pack B', dauer_s: 1.2, pfad: wav('Kits/B/Drums/1 F1.wav', 1.2) },
    { typ: 'oneshot', sha: h('c'), shas: h('c'), instrument: 'kick', pack: 'Pack C', dauer_s: 0.9, schutz: 'ableton', pfad: roh('Kits/C/Samples/1 F1.aif') },
    { typ: 'oneshot', sha: h('d'), shas: h('d'), pack: 'Pack D', dauer_s: 0.5, pfad: roh('Kits/D/broken.aif') },
    { typ: 'oneshot', sha: h('e'), shas: h('e'), pack: 'Pack E', dauer_s: 0.5, pfad: path.join(d, 'Kits/E/weg.wav') },
    { typ: 'loop', sha: h('f'), shas: h('f'), bpm: 128, takte: 2, pack: 'Loop Pack', dauer_s: 3.75, pfad: wav('Loops/Loop 128.wav', 3.75) },
    { typ: 'loop', sha: h('7'), shas: h('7'), bpm: 120, takte: 2, pack: 'Live Pack', dauer_s: 4, schutz: 'ableton', pfad: roh('Loops/Live Loop.aif') },
    // S6: importierbar (1 Takt @120 = 2 s), ohne BPM (deaktiviert mit Grund), Datei da aber nicht dekodierbar (Import scheitert mit 422)
    { typ: 'loop', sha: h('8'), shas: h('8'), bpm: 120, takte: 1, pack: 'S6 Pack', dauer_s: 2, pfad: wav('Loops/S6 Loop 120.wav', 2) },
    { typ: 'loop', sha: h('9'), shas: h('9'), bpm: null, takte: null, pack: 'S6 Pack', dauer_s: 2, pfad: wav('Loops/S6 Ohne BPM.wav', 2) },
    { typ: 'loop', sha: h('6'), shas: h('6'), bpm: 120, takte: 1, pack: 'S6 Pack', dauer_s: 2, pfad: roh('Loops/S6 Kaputt.wav') },
  ]);
  fs.mkdirSync(path.join(dir, 'sets'), { recursive: true }); fs.mkdirSync(path.join(dir, 'sammlungen'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'muster', 'eigen'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'muster/eigen/a-drums.js'), 's("bd*4, ~ cp ~ cp").bank("RolandTR909")\n');
  fs.writeFileSync(path.join(dir, 'muster/eigen/a-drums.json'), JSON.stringify({ rolle: 'drums', bpm: 128 }));
  fs.writeFileSync(path.join(dir, 'muster/eigen/b-bass.js'), 'note("c2 eb2 g2 bb2").s("sawtooth").lpf(600)\n');
  fs.writeFileSync(path.join(dir, 'muster/eigen/b-bass.json'), JSON.stringify({ rolle: 'bass' }));
  fs.writeFileSync(path.join(dir, 'sets/alt.json'), JSON.stringify({ blocks: [{ name: 'Archiv Block', bars: 8, bpm: 124, code: 's("hh*8").gain(0.5)' }] }));
  console.log(JSON.stringify({ katalog: path.join(dir, 'katalog.sqlite'), mediathek: mt.db, sammlungen: path.join(dir, 'sammlungen'), musterBibliothek: path.join(dir, 'muster/eigen'), musterSets: path.join(dir, 'sets') }));
  process.exit(0);
}
const b = await starteBrowser();
const zeilen = () => b.werte('document.querySelectorAll("#libliste tr").length');
// Konsole (Plan-Review M4): Chrome meldet jede Antwort ≥ 400 als level error („Failed to load resource … status of N"),
// auch wenn die Seite sie abfängt. Erwartete Fehler meldet die Probe VORHER an (Pfad + Status) und prüft am Ende, dass jeder
// genau so auftrat. Alles andere — Exceptions, andere Pfade, andere Status — ist rot.
const erwartet = [];   // { pfad: RegExp, status: number, gesehen: 0 }
const erwarte = (pfad, status) => erwartet.push({ pfad, status, gesehen: 0 });
function konsolePruefen() {
  const fremd = [];
  for (const k of b.konsole) {
    if (k.typ !== 'exception' && k.typ !== 'error') continue;
    const st = Number(/status of (\d{3})/.exec(k.text ?? '')?.[1]);
    const passt = (x) => x.status === st && x.pfad.test(k.url ?? '');
    const e = erwartet.find((x) => passt(x) && x.gesehen === 0) ?? erwartet.find(passt);   // zwei gleiche Erwartungen: jede bekommt ihren Treffer
    if (e) e.gesehen++; else fremd.push(k);
  }
  pruefe(fremd.length === 0, `Konsole ohne unerwartete Fehler ${JSON.stringify(fremd)}`);
  for (const e of erwartet) pruefe(e.gesehen > 0, `erwarteter Fehler ${e.status} an ${e.pfad} kam wirklich`);
}
// „Die übrige Seite lebt“ (Review S1 MINOR 7): Decks im DOM UND ein anderer Endpunkt antwortet. Eine Länge >= 0 hätte nie scheitern können.
const seiteLebt = () => b.werte('document.querySelectorAll("[data-deck]").length > 0 && fetch("/bestand").then((r) => r.status === 200)');
const info = () => b.werte('document.querySelector("#bestand-info").textContent');
try {
  await b.oeffne(URL);
  await warte(1500);
  if (process.argv.includes('--katalog-fehlt')) {          // S1-Fehlerfall: vorher katalog.sqlite umbenannt
    erwarte(/\/stoebern/, 503);
    await b.klick('[data-reiter="library"]'); await warte(1200);
    pruefe(/Catalog missing/.test(await info()), `Meldung: ${await info()}`);
    pruefe(await seiteLebt(), 'Seite lebt (Decks da, /bestand antwortet 200)');
    konsolePruefen();
    await b.zu(); process.exit(fehl ? 1 : 0);
  }
  await b.klick('[data-reiter="library"]');
  await warte(1200);
  if (VON < 5) {                                            // S1-Durchstich läuft immer, außer --von 5 (Scratch-Katalog hat nicht 100 Zeilen je Typ)
  // S1: drei Typen, Liste, Sortierung, Seiten
  for (const [typ, text] of [['loop', 'LOOPS'], ['oneshot', 'SAMPLES'], ['track', 'ALL TRACKS']]) {
    pruefe((await b.werte(`document.querySelector('[data-typ="${typ}"]')?.textContent`)) === text, `Typ-Knopf ${text}`);
    await b.klick(`[data-typ="${typ}"]`);
    await warte(800);
    pruefe((await zeilen()) === 100, `${text}: 100 Zeilen`);
    pruefe(/^[\d,]+ (tracks|loops|samples)/.test(await info()), `${text}: Zähler „${await info()}"`);
  }
  await b.klick('[data-typ="oneshot"]'); await warte(600);
  const erste = await b.werte('document.querySelector("#libliste tr td")?.textContent');
  await b.klick('#st-kopfzeile th[data-sort="name"]'); await warte(600);
  pruefe((await b.werte('document.querySelector("#libliste tr td")?.textContent')) !== erste, 'Klick auf Name dreht die Sortierung');
  await b.klick('#st-weiter'); await warte(600);
  pruefe(/^Page 2 /.test(await b.werte('document.querySelector("#st-seite").textContent')), 'Seite 2');
  const t0 = Date.now(); await b.klick('#st-weiter'); await warte(50);
  for (let i = 0; i < 40 && !/^Page 3 /.test(await b.werte('document.querySelector("#st-seite").textContent')); i++) await warte(25);
  pruefe(Date.now() - t0 < 1000, `Blättern unter 1 s (${Date.now() - t0} ms, mit Proben-Takt)`);
  // Review S1 MINOR 8: Doppelklick auf › an der vorletzten Seite darf nicht hinter das Ende führen (LOOPS: 78 Seiten)
  await b.klick('[data-typ="loop"]'); await warte(600);
  const seiteText = () => b.werte('document.querySelector("#st-seite").textContent');
  const m = /of (\d+)/.exec(await seiteText()); const letzte = Number(m?.[1]);
  for (let i = 0; i < letzte - 2; i++) { const vor = await seiteText(); await b.klick('#st-weiter'); for (let k = 0; k < 80 && (await seiteText()) === vor; k++) await warte(10); }
  pruefe((await seiteText()).startsWith(`Page ${letzte - 1} of`), `vorletzte Seite erreicht: ${await seiteText()}`);
  await b.werte('(() => { const k = document.querySelector("#st-weiter"); k.click(); k.click(); })()');   // zwei Klicks vor der Antwort
  await warte(700);
  pruefe((await seiteText()).startsWith(`Page ${letzte} of ${letzte}`), `Doppelklick endet auf der letzten Seite: ${await seiteText()}`);
  pruefe((await zeilen()) > 0, `letzte Seite hat Zeilen (${await zeilen()})`);
  }
  if (BIS >= 2 && VON <= 2) {
    // Task 2.3: Baum und Facetten (Samples: Facette „kick" filtert, Ordner im Baum)
    await b.klick('[data-typ="oneshot"]'); await warte(800);
    const vorher = await b.werte('Number(document.querySelector("#bestand-info").textContent.split(" ")[0].replace(/,/g, ""))');
    const kick = await b.werte(`[...document.querySelectorAll('#st-baum .st-knoten')].find((d) => d.textContent.startsWith('kick '))?.textContent ?? ''`);
    pruefe(/^kick [\d,]+$/.test(kick), `Facette kick: ${kick}`);
    await b.werte(`[...document.querySelectorAll('#st-baum .st-knoten')].find((d) => d.textContent.startsWith('kick ')).click()`); await warte(800);
    const n = await b.werte('Number(document.querySelector("#bestand-info").textContent.split(" ")[0].replace(/,/g, ""))');
    pruefe(n === Number(kick.split(' ')[1].replace(/,/g, '')) && n < vorher, `Facette filtert: ${n} von ${vorher}`);
    const ordner = await b.werte(`document.querySelectorAll('#st-baum .st-knoten[title]').length`);
    pruefe(ordner >= 1, `Ordner im Baum: ${ordner}`);
    // Task 2.4: großer Modus (G / ⤢): Browser fast bildschirmhoch, Decks als schmale Leiste
    const sichtbar = () => b.werte(`(() => { const l = document.querySelector('.st-liste').getBoundingClientRect();
      return [...document.querySelectorAll('#libliste tr')].filter((tr) => { const r = tr.getBoundingClientRect(); return r.top >= l.top && r.bottom <= l.bottom; }).length; })()`);
    const taste = (k) => b.werte(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '${k}', bubbles: true }))`);
    const klein = await sichtbar();
    await taste('g'); await warte(400);
    const gross = await sichtbar();
    console.log(`GROSS vorher ${klein} Zeilen, nachher ${gross}`);
    pruefe(gross >= 3 * klein && gross >= 20, `großer Modus: ${klein} → ${gross} sichtbare Zeilen`);
    pruefe(await b.werte(`(() => { const r = document.querySelector('.deck[data-deck="1"] .deckkopf').getBoundingClientRect(); return r.height > 0 && r.bottom <= innerHeight; })()`), 'Deck-Kopf A bleibt sichtbar');
    pruefe(await b.werte(`[...document.querySelectorAll('#bestand .tabelle')].filter((t) => !t.hidden && getComputedStyle(t).display !== 'none').length === 1`), 'genau eine Tabelle sichtbar (Reiter übereinander wäre der Plan-Review-Fehler)');
    if (process.env.PROBE_BILD) await b.bild(process.env.PROBE_BILD);
    await taste('g'); await warte(400);
    pruefe((await sichtbar()) === klein, 'G zurück: wieder wie vorher');
    await taste('g'); await warte(300);
    await taste('l'); await warte(300);
    pruefe(await b.werte(`!document.body.classList.contains('lib-gross') && document.body.classList.contains('lib-zu')`), 'L im großen Modus: zu und nicht mehr groß');
    await taste('l'); await warte(300);
    pruefe((await sichtbar()) === klein, 'L wieder auf: normale Größe');
    await taste('g'); await warte(300); await taste('Escape'); await warte(300);
    pruefe(await b.werte(`!document.body.classList.contains('lib-gross') && !document.body.classList.contains('lib-zu')`), 'Esc im großen Modus: nur groß beenden, Library bleibt offen');
    await taste('Escape'); await warte(300);
    pruefe(await b.werte(`document.body.classList.contains('lib-zu')`), 'zweites Esc schließt die Library');
    await taste('l'); await warte(300);
  }
  if (BIS >= 2.5 && VON <= 2) {
    // Task 2b.5: Listen (PLAYLIST, LOOP LIST, STRUDEL LIST), Reihenfolge, STRUDEL-Typ. Eindeutiger Name je Lauf, Selektoren auf den
    // EXAKTEN Slug (Review 2, m3: Reste abgebrochener Läufe sortieren sonst davor). Aufgeräumt wird im finally (Papierkorb).
    const NAME = `probe-${process.pid}-${Date.now()}`;       // slugVon lässt ihn unverändert: [a-z0-9-], < 48 Zeichen
    const angelegt = [];
    const post_ = (u, k) => fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(k) }).then((r) => r.json());
    const loesche = async () => { for (const n of angelegt) await fetch(`${URL}sammlungen/${n}/loeschen`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).catch(() => {}); };
    const posten = () => b.werte('[...document.querySelectorAll("#libliste tr")].map((tr) => tr.dataset.posten)');
    const knoten = (sel) => b.klick(sel);
    const taste = (el, k) => b.werte(`(() => { const i = document.querySelector(${JSON.stringify(el)}); i.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true })); return 1; })()`);
    const setze = (el, v) => b.werte(`(() => { const i = document.querySelector(${JSON.stringify(el)}); i.value = ${JSON.stringify(v)}; i.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()`);
    const baumKnoten = (art, slug) => (slug ? `#st-baum .st-knoten[data-liste="${slug}"]` : `#st-baum [data-listenart="${art}"]`);
    // Namen: Playlist = NAME, Loop-Liste und Strudel-Liste hängen eine Art an (jeder Slug bleibt unter 48 Zeichen)
    const PL = NAME, LL = `${NAME}-ll`, SL = `${NAME}-sl`;
    angelegt.push(PL, LL, SL);
    try {
      // --- PLAYLIST: „New list…“ + Enter legt die Liste an UND die erste Zeile hinein
      await b.klick('[data-typ="track"]'); await warte(800);
      await b.klick('#libliste tr:first-child button.in-liste'); await warte(500);
      pruefe(await b.werte(`!document.querySelector('#listen-menue').hidden`), 'Menü + LIST ▾ ist offen');
      await setze('#listen-neu', PL); await taste('#listen-neu', 'Enter'); await warte(1000);
      pruefe(await b.werte(`document.querySelector('#listen-menue').hidden`), 'Menü schließt nach Enter');
      await b.klick('#libliste tr:nth-child(2) button.in-liste'); await warte(500);
      await b.klick(`#listen-menue [data-liste="${PL}"]`); await warte(600);
      await knoten(baumKnoten('playlist')); await warte(600);
      await knoten(baumKnoten('playlist', PL)); await warte(800);
      const vor = await posten();
      pruefe(JSON.stringify(vor) === JSON.stringify(['p1', 'p2']), `Playlist hat p1, p2 (Enter in „New list“ legt die erste Zeile mit ab): ${JSON.stringify(vor)}`);
      pruefe(await b.werte(`[...document.querySelectorAll('#libliste tr')].every((tr) => /LOAD A|PREPARE|MISSING|PREPARING/.test(tr.querySelector('td.aktion')?.textContent ?? ''))`),
        'Listenzeilen haben die Track-Aktionen des Browsers (Review 2, M3)');
      pruefe(await b.werte(`document.querySelector('#st-kopfzeile').textContent.startsWith('Title') && !document.querySelector('[data-typ].an')`), 'Kopf: Spalten der Playlist, kein Typ-Knopf markiert');
      await b.klick('#libliste tr:nth-child(2) button.hoch'); await warte(800);
      const nach = await posten();
      pruefe(JSON.stringify(nach) === JSON.stringify(['p2', 'p1']), `↑ tauscht: ${JSON.stringify(nach)}`);
      await b.klick('#libliste tr:nth-child(1) button.runter'); await warte(800);
      pruefe(JSON.stringify(await posten()) === JSON.stringify(['p1', 'p2']), `↓ tauscht zurück: ${JSON.stringify(await posten())}`);
      // Ziehen: p2 auf die obere Hälfte von p1 (die Drop-Behandlung der Seite, mit echtem DataTransfer)
      await b.werte(`(() => { const z = [...document.querySelectorAll('#libliste tr')]; const von = z.find((r) => r.dataset.posten === 'p2'), nach = z.find((r) => r.dataset.posten === 'p1');
        const dt = new DataTransfer(); von.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }));
        nach.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, clientY: nach.getBoundingClientRect().top + 2 })); return 1; })()`); await warte(900);
      pruefe(JSON.stringify(await posten()) === JSON.stringify(['p2', 'p1']), `Ziehen p2 vor p1: ${JSON.stringify(await posten())}`);
      // Gegenprobe zu Review S2b Befund 2: p1 steht schon hinter p2. Ziehen auf die UNTERE Hälfte von p2 darf nichts ändern.
      const dropAuf = (von, nach, unten) => b.werte(`(() => { const z = [...document.querySelectorAll('#libliste tr')]; const v = z.find((r) => r.dataset.posten === '${von}'), n = z.find((r) => r.dataset.posten === '${nach}');
        const dt = new DataTransfer(); v.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }));
        const rc = n.getBoundingClientRect(); n.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, clientY: rc.top + ${unten ? 'rc.height - 2' : '2'} })); return 1; })()`);
      await dropAuf('p1', 'p2', true); await warte(900);
      pruefe(JSON.stringify(await posten()) === JSON.stringify(['p2', 'p1']), `Ziehen von p1 auf die untere Hälfte von p2 ändert nichts: ${JSON.stringify(await posten())}`);
      await dropAuf('p2', 'p1', true); await warte(900);
      pruefe(JSON.stringify(await posten()) === JSON.stringify(['p1', 'p2']), `Gegenprobe: p2 hinter p1 vertauscht wirklich: ${JSON.stringify(await posten())}`);
      await dropAuf('p2', 'p1', false); await warte(900);   // p2 vor p1: zurück auf [p2, p1] für die folgenden Schritte
      pruefe(JSON.stringify(await posten()) === JSON.stringify(['p2', 'p1']), `wieder [p2, p1]: ${JSON.stringify(await posten())}`);
      const serverReihenfolge = await (await fetch(`${URL}sammlungen/${PL}`)).json();
      pruefe(JSON.stringify(serverReihenfolge.posten.map((p) => p.id)) === JSON.stringify(['p2', 'p1']) && serverReihenfolge.art === 'playlist', 'Server hat die neue Reihenfolge und Art playlist');
      if (process.env.PROBE_BILD) await b.bild(`${process.env.PROBE_BILD}-playlist.png`);
      // Umbenennen am Listenknoten
      await b.klick(`${baumKnoten('playlist', PL)} button[title="Rename"]`); await warte(300);
      await setze('#st-baum input.st-eingabe', `${PL} neu`); await taste('#st-baum input.st-eingabe', 'Enter'); await warte(900);
      pruefe((await (await fetch(`${URL}sammlungen/${PL}`)).json()).name === `${PL} neu`, 'Umbenennen: Name geändert, Slug bleibt');
      // Traktor-Playlist als PLAYLIST importieren (die kleinste Liste; „Import Traktor…“ unter Playlists)
      const vorherSlugs = (await (await fetch(`${URL}sammlungen?art=playlist`)).json()).map((e) => e.slug);
      const gewaehlt = await b.werte(`(() => { const sel = document.querySelector('#st-baum select.st-import'); if (!sel) return null;
        const o = [...sel.options].filter((x) => x.value).map((x) => [Number(/\\((\\d+)\\)$/.exec(x.textContent)?.[1]), x]).filter(([n]) => n > 0).sort((a, b) => a[0] - b[0])[0];
        if (!o) return null; sel.value = o[1].value; sel.dispatchEvent(new Event('change', { bubbles: true })); return [o[1].textContent, o[0]]; })()`); await warte(1500);
      const nachher = (await (await fetch(`${URL}sammlungen?art=playlist`)).json());
      const neu = nachher.filter((e) => !vorherSlugs.includes(e.slug));
      pruefe(gewaehlt !== null && neu.length === 1 && neu[0].posten === gewaehlt[1], `Traktor-Import als Playlist: ${JSON.stringify(gewaehlt)} → ${JSON.stringify(neu.map((e) => [e.slug, e.posten]))}`);
      for (const e of neu) angelegt.push(e.slug);
      // Fehlerfall: ein Loop gehört nicht in eine Playlist (der Server sagt 400; das Menü bietet für Loops nur Loop-Listen an)
      erwarte(/\/sammlungen\//, 400);
      const abgewiesen = await b.werte(`fetch(${JSON.stringify(`/sammlungen/${PL}/posten`)}, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ art: 'loop', material_id: '${'0'.repeat(16)}' }) }).then(async (r) => [r.status, (await r.json()).fehler])`);
      pruefe(abgewiesen[0] === 400 && abgewiesen[1] === 'art_passt_nicht_zur_liste', `Loop in Playlist: 400 art_passt_nicht_zur_liste (${JSON.stringify(abgewiesen)})`);
      // --- LOOP LIST: Loops und Samples gemischt
      await b.klick('[data-typ="loop"]'); await warte(800);
      await b.klick('#libliste tr:first-child button.in-liste'); await warte(500);
      pruefe(!(await b.werte(`[...document.querySelectorAll('#listen-menue .listen-eintrag')].some((e) => e.dataset.liste === ${JSON.stringify(PL)})`)), 'Menü für einen Loop zeigt keine Playlist');
      await setze('#listen-neu', LL); await taste('#listen-neu', 'Enter'); await warte(1000);
      await b.klick('[data-typ="oneshot"]'); await warte(800);
      await b.klick('#libliste tr:first-child button.in-liste'); await warte(500);
      await b.klick(`#listen-menue [data-liste="${LL}"]`); await warte(600);
      await knoten(baumKnoten('looplist')); await warte(600);
      await knoten(baumKnoten('looplist', LL)); await warte(800);
      pruefe(JSON.stringify(await posten()) === JSON.stringify(['p1', 'p2']), `Loop-Liste hat Loop und Sample: ${JSON.stringify(await posten())}`);
      const typen = await b.werte(`[...document.querySelectorAll('#libliste tr')].map((tr) => tr.cells[1].textContent)`);
      pruefe(JSON.stringify(typen) === JSON.stringify(['LOOP', 'SAMPLE']), `Spalte Type: ${JSON.stringify(typen)}`);
      await b.klick('#libliste tr:nth-child(1) button.runter'); await warte(800);
      pruefe(JSON.stringify(await posten()) === JSON.stringify(['p2', 'p1']), `Loop-Liste ↓: ${JSON.stringify(await posten())}`);
      if (process.env.PROBE_BILD) await b.bild(`${process.env.PROBE_BILD}-looplist.png`);
      // --- STRUDEL-Typ und STRUDEL LIST
      await b.klick('[data-typ="strudel"]'); await warte(900);
      pruefe((await zeilen()) > 0, `STRUDEL zeigt Muster (${await zeilen()} Zeilen)`);
      pruefe(/patterns$/.test(await info()), `STRUDEL: Zähler „${await info()}"`);
      const ladbar = await b.werte(`!!document.querySelector('#libliste button.in-editor')`);
      pruefe(ladbar, 'mindestens ein ladbares Muster (track/mine)');
      await b.werte(`[...document.querySelectorAll('#st-baum .st-knoten')].find((d) => d.textContent.startsWith('track '))?.click()`); await warte(800);
      pruefe((await b.werte(`[...document.querySelectorAll('#libliste tr')].every((tr) => tr.cells[2].textContent === 'track')`)) && (await zeilen()) > 0, 'Facette Source=track filtert die Muster');
      if (ladbar) {
        const strom = await b.werte(`Number(document.querySelector('#libliste button.in-editor').dataset.strom)`);
        const stand = async () => { const s = await (await fetch(`${URL}strudel?strom=${strom}`)).json(); return JSON.stringify([s.text, s.zeit]); };
        const vorher = await stand();
        // Review S2b Befund 3: ungesendeter Text im Editor wird nicht still überschrieben
        const feldSel = `#deck-c .instanz[data-strom="${strom}"] .muster-feld`;
        await b.werte(`window.__fragen = 0; window.__antwort = false; window.confirm = () => { window.__fragen++; return window.__antwort; }; 1`);
        await setze(feldSel, 'note("e2 g2")'); await warte(200);
        await b.klick(`#libliste button.in-editor[data-strom="${strom}"]`); await warte(500);
        pruefe((await b.werte(`document.querySelector('${feldSel}').value`)) === 'note("e2 g2")' && (await b.werte('window.__fragen')) === 1, 'ungesendeter Text + „Nein“: Editor bleibt, es wurde gefragt');
        await b.werte(`window.__antwort = true; 1`);
        await b.klick(`#libliste button.in-editor[data-strom="${strom}"]`); await warte(500);
        pruefe((await b.werte(`document.querySelector('${feldSel}').value`)) !== 'note("e2 g2")' && (await b.werte('window.__fragen')) === 2, 'mit „Ja“ wird ersetzt');
        await b.klick(`#deck-c .instanz[data-strom="${strom}"] .muster-zurueck`); await warte(300);   // sauber: nichts Ungesendetes mehr
        await b.klick(`#libliste button.in-editor[data-strom="${strom}"]`); await warte(500);
        pruefe((await b.werte('window.__fragen')) === 2, 'Negativkontrolle: sauberer Editor → keine Rückfrage');
        await b.werte(`window.confirm = () => true; 1`);
        await b.klick(`#deck-c .instanz[data-strom="${strom}"] .muster-zurueck`); await warte(300);
        const vorherServer2 = await stand();
        pruefe(vorherServer2 === vorher, 'Server-Stand der Instanz blieb bei alledem gleich');
        await b.klick('#libliste button.in-editor'); await warte(800);
        pruefe((await b.werte(`document.querySelector('#deck-c .instanz[data-strom="${strom}"] .muster-feld').value.length`)) > 0, 'Muster steht im Editor der Instanz');
        pruefe((await stand()) === vorher, 'nichts gesendet: Text und Zeit der Instanz unverändert');
      }
      await b.klick('#libliste tr:first-child button.in-liste'); await warte(500);
      await setze('#listen-neu', SL); await taste('#listen-neu', 'Enter'); await warte(1000);
      await b.klick('#libliste tr:nth-child(2) button.in-liste'); await warte(500);
      await b.klick(`#listen-menue [data-liste="${SL}"]`); await warte(600);
      await knoten(baumKnoten('strudellist')); await warte(600);
      await knoten(baumKnoten('strudellist', SL)); await warte(800);
      pruefe(JSON.stringify(await posten()) === JSON.stringify(['p1', 'p2']), `Strudel-Liste hat zwei Muster: ${JSON.stringify(await posten())}`);
      await b.klick('#libliste tr:nth-child(2) button.hoch'); await warte(800);
      pruefe(JSON.stringify(await posten()) === JSON.stringify(['p2', 'p1']), `Strudel-Liste ↑: ${JSON.stringify(await posten())}`);
      if (process.env.PROBE_BILD) await b.bild(`${process.env.PROBE_BILD}-strudellist.png`);
      pruefe(await b.werte(`document.querySelectorAll('#libliste tr button.in-editor').length === 6`), 'Strudel-Listenzeilen haben → DRUMS/BASS/MELODY');
      // Löschen aus dem Baum: Papierkorb, die Liste verschwindet und die Mitte verlässt sie
      await b.werte(`window.confirm = () => true`);
      await b.klick(`${baumKnoten('strudellist', SL)} button[title="Move to the trash"]`); await warte(900);
      pruefe(!(await b.werte(`!!document.querySelector('#st-baum .st-knoten[data-liste="${SL}"]')`)), 'Strudel-Liste aus dem Baum gelöscht');
      pruefe((await fetch(`${URL}sammlungen/${SL}`)).status === 404, 'Server: gelöschte Liste 404');
      angelegt.splice(angelegt.indexOf(SL), 1);
      // --- Review S2b Befund 5: ein Muster im Set heißt „pattern“
      const SET = `${NAME}-set`;
      angelegt.push(SET);
      await post_(`${URL}sammlungen`, { name: SET });
      await b.werte(`localStorage.setItem('djk-set', ${JSON.stringify(SET)}); 1`);
      await b.klick('[data-typ="strudel"]'); await warte(900);
      await b.klick('#libliste tr:first-child button.in-set'); await warte(700);
      await b.klick('[data-reiter="sets"]'); await warte(1000);
      const hinweis = await b.werte(`[...document.querySelectorAll('#setliste tr td.aktion .grund')].map((e) => e.textContent)`);
      pruefe(JSON.stringify(hinweis) === JSON.stringify(['pattern']), `Muster im Set: Beschriftung ${JSON.stringify(hinweis)}`);
      await b.klick('[data-reiter="library"]'); await warte(500);
      // --- Alte Seite lebt: Reiter SETS zeigt nur Sets (kein Listen-Name im Auswahlfeld)
      await b.klick('[data-reiter="sets"]'); await warte(800);
      pruefe(!(await b.werte(`[...document.querySelectorAll('#set-wahl option')].some((o) => o.value.startsWith('probe-') && o.value !== ${JSON.stringify(SET)})`)), 'Auswahlfeld der Sets enthält keine Probe-LISTEN (nur das Probe-Set selbst)');
      await b.klick('[data-reiter="library"]'); await warte(500);
      // --- SAVE am Strudel-Deck (nur gegen eine Instanz mit eigener Ablage: --save; schreibt bibliothek/muster/<name>.js)
      if (process.argv.includes('--save')) {
        const M = `probe-save-${process.pid}`;
        const muster = 'note("c2 eb2 g2").s("sawtooth").lpf(600)';
        await b.werte(`window.confirm = () => false`);
        await b.klick('.rollen [data-rolle="2"]'); await warte(300);
        await setze('#deck-c .instanz[data-strom="2"] .muster-feld', muster); await warte(200);
        // erst NICHTS spielend: SAVE auf Melody (Strom 3) hat kein laufendes Muster → 409 kein_muster
        erwarte(/\/muster$/, 409);
        await b.klick('.rollen [data-rolle="3"]'); await warte(300);
        await b.klick('#deck-c .instanz[data-strom="3"] .muster-sichern'); await warte(300);
        await setze('#deck-c .instanz[data-strom="3"] .muster-name', 'nichts-da'); await taste('#deck-c .instanz[data-strom="3"] .muster-name', 'Enter'); await warte(700);
        pruefe(/Nothing is playing/.test(await b.werte(`document.querySelector('#deck-c .instanz[data-strom="3"] .muster-fehler').textContent`)), 'SAVE ohne laufendes Muster: „Nothing is playing“ (409)');
        pruefe(!(await b.werte(`fetch('/stoebern?typ=strudel&limit=500').then((r) => r.json()).then((j) => j.treffer.some((t) => t.name === 'nichts-da'))`)), 'ohne Muster wurde nichts gespeichert');
        // Muster spielen lassen (PLAY ⏎ → djk-muster prüft und schreibt strom1.js), dann SAVE
        await b.klick('.rollen [data-rolle="2"]'); await warte(300);
        await b.klick('#deck-c .instanz[data-strom="2"] .muster-senden'); await warte(2500);
        const spielt = await (await fetch(`${URL}strudel?strom=2`)).json();
        pruefe(spielt.text === muster, `Instanz 2 spielt das Muster: ${JSON.stringify(spielt.text)} ${JSON.stringify(spielt.status?.fehler ?? '')}`);
        // gespeichert wird das SPIELENDE, nicht das Feld: Feld ändern, dann SAVE
        await setze('#deck-c .instanz[data-strom="2"] .muster-feld', 's("hh*16")'); await warte(300);
        await b.klick('#deck-c .instanz[data-strom="2"] .muster-sichern'); await warte(300);
        await setze('#deck-c .instanz[data-strom="2"] .muster-name', M); await taste('#deck-c .instanz[data-strom="2"] .muster-name', 'Enter'); await warte(900);
        pruefe(/saved as/.test(await b.werte(`document.querySelector('#deck-c .instanz[data-strom="2"] .muster-fehler').textContent`)), 'SAVE meldet „saved as“');
        // doppelter Name: confirm → Nein, nichts überschrieben (409)
        await b.klick('#deck-c .instanz[data-strom="2"] .muster-sichern'); await warte(300);
        await setze('#deck-c .instanz[data-strom="2"] .muster-name', M); await taste('#deck-c .instanz[data-strom="2"] .muster-name', 'Enter'); await warte(700);
        // wieder laden: STRUDEL › Source=mine › → BASS
        await b.klick('[data-typ="strudel"]'); await warte(800);
        await b.werte(`[...document.querySelectorAll('#st-baum .st-knoten')].find((d) => d.textContent.startsWith('mine '))?.click()`); await warte(800);
        const zeile = await b.werte(`(() => { const tr = [...document.querySelectorAll('#libliste tr')].find((t) => t.cells[0].textContent === ${JSON.stringify(M)}); return tr ? [...tr.cells].map((c) => c.textContent).slice(0, 3) : null; })()`);
        pruefe(Array.isArray(zeile) && zeile[1] === 'BASS' && zeile[2] === 'mine', `gespeichertes Muster in der Liste (Rolle BASS, Quelle mine): ${JSON.stringify(zeile)}`);
        await setze('#deck-c .instanz[data-strom="2"] .muster-feld', ''); await warte(200);
        await b.werte(`window.confirm = () => true`);   // der Editor ist jetzt „schmutzig“ (leer ≠ laufend): die Rückfrage von Befund 3 mit Ja beantworten
        const vorherServer = JSON.stringify(await (await fetch(`${URL}strudel?strom=2`)).json());
        await b.werte(`[...document.querySelectorAll('#libliste tr')].find((t) => t.cells[0].textContent === ${JSON.stringify(M)}).querySelector('button.in-editor[data-strom="2"]').click()`); await warte(600);
        pruefe((await b.werte(`document.querySelector('#deck-c .instanz[data-strom="2"] .muster-feld').value`)) === muster, 'wieder geladen: der Editor zeigt das gespeicherte (spielende) Muster, nicht das Feld von damals');
        pruefe(JSON.stringify(await (await fetch(`${URL}strudel?strom=2`)).json()).replace(/"autonom":(true|false)/, '') === vorherServer.replace(/"autonom":(true|false)/, ''), 'Laden sendet nichts: Server-Stand unverändert (bis auf AUTO)');
        if (process.env.PROBE_BILD) await b.bild(`${process.env.PROBE_BILD}-save.png`);
      }
    } finally {
      await loesche();                                        // Papierkorb (bibliothek/sets/.papierkorb, steht in .gitignore)
    }
  }
  if (BIS >= 3 && VON <= 3) {
    // S2-Review B3/B4: Ordner vor den Facetten und sichtbar markiert, abgeschnittene Knoten behalten Zähler und vollen Namen
    for (const typ of ['oneshot', 'loop']) {
      await b.klick(`[data-typ="${typ}"]`); await warte(900);
      const kopf = await b.werte(`[...document.querySelectorAll('#st-baum h4')].map((h) => h.textContent)`);
      pruefe(kopf.indexOf('Folders') >= 0 && kopf.indexOf('Folders') < kopf.findIndex((h) => !['Lists', 'Folders'].includes(h)), `${typ}: Folders vor den Facetten (${kopf.join(' · ')})`);
      const knoten = await b.werte(`(() => { const nav = document.querySelector('#st-baum'); const nr = nav.getBoundingClientRect();
        const h = [...nav.querySelectorAll('h4')].find((x) => x.textContent === 'Folders'); const hr = h.getBoundingClientRect();
        return { oben: hr.top - nr.top, hoehe: nr.height, abgeschnitten: [...nav.querySelectorAll('.st-knoten[title^="/"]')].filter((d) => { const n = d.querySelector('.st-name'); return d.scrollWidth > d.clientWidth + 1 || (n && n.scrollWidth > n.clientWidth + 1); }).map((d) => { const z = d.querySelector('.zahl').getBoundingClientRect(), dr = d.getBoundingClientRect(), n = d.querySelector('.st-name'); return { title: d.title, zahl: z.width > 0 && z.right <= dr.right + 1 && z.left >= dr.left, vorn: !!n && getComputedStyle(n).direction === 'rtl', name: n ? n.textContent : d.textContent }; }) }; })()`);
      pruefe(knoten.oben >= 0 && knoten.oben < knoten.hoehe, `${typ}: „Folders" steht im sichtbaren Teil des Baums (${Math.round(knoten.oben)} von ${Math.round(knoten.hoehe)} px)`);
      pruefe(knoten.abgeschnitten.length > 0 && knoten.abgeschnitten.every((k) => k.zahl), `${typ}: ${knoten.abgeschnitten.length} abgeschnittene Ordnerknoten, Zähler immer sichtbar`);
      pruefe(knoten.abgeschnitten.every((k) => k.title.endsWith(k.name.trim())), `${typ}: voller Pfad im title`);
      pruefe(knoten.abgeschnitten.every((k) => k.vorn), `${typ}: Ordner kürzen vorn (Ellipse links, Ende sichtbar)`);
      // den untersten sichtbaren Ordner-Ast wählen: der gewählte Knoten ist markiert UND im Bild
      for (let tiefe = 0; tiefe < 3; tiefe++) {
        await b.werte(`(() => { const k = [...document.querySelectorAll('#st-baum .st-knoten[title^="/"]')].filter((d) => !d.classList.contains('an')); const w = document.querySelector('#st-baum .st-knoten.an[title^="/"]'); const kand = k.filter((d) => !w || d.title.startsWith(w.title + '/')); (kand[0] ?? k[0]).click(); return 1; })()`);
        await warte(800);
      }
      const an = await b.werte(`(() => { const nav = document.querySelector('#st-baum'); const a = nav.querySelector('.st-knoten.an[title^="/"]'); if (!a) return null; const r = a.getBoundingClientRect(), v = nav.getBoundingClientRect(); return { im_bild: r.top >= v.top - 1 && r.bottom <= v.bottom + 1, markiert: getComputedStyle(a).fontWeight >= 600 && getComputedStyle(a).boxShadow !== 'none', title: a.title }; })()`);
      pruefe(an?.im_bild === true && an.markiert === true, `${typ}: gewählter Ordner ist markiert und im Bild (${an?.title})`);
      if (process.env.PROBE_BILD) await b.bild(`${process.env.PROBE_BILD}-baum-${typ}.png`);
      await b.werte(`document.querySelector('#st-baum .st-knoten').click()`); await warte(600);
    }
  }
  if (BIS >= 3 && VON <= 3) {
    // S3: Filterleiste Key (+Nachbarn), BPM, Energie — an Tracks und an Loops, mit Fehlerfall (400 mit Meldung, nicht leer)
    const zahlAnz = () => b.werte('Number(document.querySelector("#bestand-info").textContent.split(" ")[0].replace(/,/g, ""))');
    const spalte = (n) => b.werte(`[...document.querySelectorAll("#libliste tr td:nth-child(${n})")].map((td) => td.textContent)`);
    const setze = (id, wert) => b.werte(`(() => { const e = document.querySelector(${JSON.stringify(id)}); e.value = ${JSON.stringify(wert)}; e.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return 1; })()`);
    await b.klick('[data-typ="track"]'); await warte(800);
    const alle = await zahlAnz();
    await setze('#lib-key', '8A'); await warte(800);
    const exakt = await zahlAnz();
    await b.klick('#lib-nachbarn'); await warte(800);
    const nb = await zahlAnz();
    pruefe(exakt > 0 && exakt < nb && nb < alle, `Key 8A ${exakt} < mit Nachbarn ${nb} < alle ${alle}`);
    const keys = await spalte(4);
    pruefe(keys.length > 0 && keys.every((k) => ['8A', '7A', '9A', '8B'].includes(k)), `nur Nachbar-Keys in der Liste (${[...new Set(keys)].join(' ')})`);
    pruefe(new Set(keys).size > 1 || nb === exakt, 'mit ±1 erscheinen mehrere Keys');
    if (process.env.PROBE_BILD) await b.bild(`${process.env.PROBE_BILD}-key8a-nachbarn.png`);
    await setze('#lib-bpm', '124 - 130'); await warte(800);
    const mitBpm = await zahlAnz();
    const bpms = (await spalte(3)).map(Number);
    pruefe(mitBpm > 0 && mitBpm < nb && bpms.every((x) => x >= 124 && x <= 130), `BPM 124–130 zusätzlich: ${mitBpm} Treffer, BPM ${Math.min(...bpms)}–${Math.max(...bpms)}`);
    await b.werte(`(() => { const e = document.querySelector('#lib-energie'); e.value = '2'; e.dispatchEvent(new Event('change', { bubbles: true })); return 1; })()`); await warte(800);
    const hoch = await zahlAnz();
    const en = (await spalte(5)).map(Number);
    pruefe(hoch > 0 && hoch <= mitBpm && en.every((x) => x > 7), `Energie hoch (>7) zusätzlich: ${hoch} Treffer, Energie ${Math.min(...en)}–${Math.max(...en)}`);
    if (process.env.PROBE_BILD) await b.bild(`${process.env.PROBE_BILD}-key-bpm-energie.png`);
    // Fehlerfall: Unsinn im Feld → 400, die Seite meldet es und die Liste ist leer, nichts bleibt stehen
    erwarte(/\/stoebern/, 400);
    await setze('#lib-key', '13A'); await warte(800);
    pruefe(/camelot_ungueltig/.test(await info()) && (await zeilen()) === 0, `Key 13A: Meldung „${await info()}“, Liste leer`);
    await setze('#lib-key', ''); await b.werte(`(() => { document.querySelector('#lib-nachbarn').checked = false; return 1; })()`);
    await setze('#lib-bpm', ''); await b.werte(`(() => { const e = document.querySelector('#lib-energie'); e.value = ''; e.dispatchEvent(new Event('change', { bubbles: true })); return 1; })()`); await warte(800);
    pruefe((await zahlAnz()) === alle, `Filter geleert: wieder alle ${alle}`);
    // Loops: BPM-Bereich gilt auch dort
    await b.klick('[data-typ="loop"]'); await warte(800);
    await setze('#lib-bpm', '127-129'); await warte(800);
    const lb = (await spalte(3)).map(Number);
    pruefe(lb.length > 0 && lb.every((x) => x >= 127 && x <= 129), `LOOPS BPM 127–129: ${lb.length} Zeilen auf der Seite`);
    await setze('#lib-bpm', ''); await warte(500);
    // Filter je Typ (S3-Concern): was ein Typ nicht hat, ist weg UND zurückgesetzt, nie unsichtbar wirksam
    const sichtbar = (id) => b.werte(`(() => { const e = document.querySelector(${JSON.stringify(id)}); return !!e && e.offsetParent !== null; })()`);
    const bar = async () => JSON.stringify([await sichtbar('#lib-key'), await sichtbar('#lib-bpm'), await sichtbar('#lib-energie')]);
    const gesamt = (q) => fetch(`${URL}stoebern?${q}&limit=1`).then((r) => r.json()).then((j) => j.gesamt);
    await b.klick('[data-typ="track"]'); await warte(700);
    pruefe((await bar()) === '[true,true,true]', `TRACKS zeigen Key, BPM, Energie: ${await bar()}`);
    await setze('#lib-key', '8A'); await warte(500);
    await b.werte(`(() => { const e = document.querySelector('#lib-energie'); e.value = '2'; e.dispatchEvent(new Event('change', { bubbles: true })); return 1; })()`); await warte(600);
    await b.klick('[data-typ="loop"]'); await warte(900);
    pruefe((await bar()) === '[true,true,false]', `LOOPS: Energie weg: ${await bar()}`);
    pruefe((await b.werte(`document.querySelector('#lib-energie').value`)) === '' && (await b.werte(`document.querySelector('#lib-key').value`)) === '8A', 'LOOPS: Energie zurückgesetzt, Key bleibt (Loops haben Keys)');
    const loopsKey = await gesamt('typ=loop&camelot=8A');
    pruefe((await zahlAnz()) === loopsKey, `LOOPS gefiltert nur nach Key (${loopsKey}), die Energie wirkt nicht unsichtbar weiter`);
    await setze('#lib-bpm', '127-129'); await warte(700);
    await b.klick('[data-typ="oneshot"]'); await warte(1000);
    pruefe((await bar()) === '[false,false,false]', `SAMPLES: kein Filter sichtbar: ${await bar()}`);
    const samplesAlle = await gesamt('typ=oneshot');
    pruefe((await zahlAnz()) === samplesAlle, `SAMPLES ungefiltert: alle ${samplesAlle}`);
    await b.klick('[data-typ="strudel"]'); await warte(900);
    pruefe((await bar()) === '[false,true,false]', `STRUDEL: nur BPM sichtbar: ${await bar()}`);
    pruefe((await b.werte(`document.querySelector('#lib-bpm').value`)) === '' && (await b.werte(`document.querySelector('#lib-key').value`)) === '', 'Rest vom Samples-Besuch ist weg (Key und BPM leer)');
    const musterAlle = await zahlAnz();
    await setze('#lib-bpm', '140-150'); await warte(800);
    const mb = (await spalte(4)).map(Number), mn = await zahlAnz();
    pruefe(mn > 0 && mn < musterAlle && mb.length > 0 && mb.every((x) => x >= 140 && x <= 150), `STRUDEL BPM 140–150: ${mn} von ${musterAlle}, BPM ${Math.min(...mb)}–${Math.max(...mb)}`);
    await setze('#lib-bpm', 'abc'); await warte(800);
    pruefe(/bpm_ungueltig/.test(await info()), `STRUDEL BPM „abc“: Meldung „${await info()}“`);
    await setze('#lib-bpm', ''); await warte(600);
    pruefe((await zahlAnz()) === musterAlle, `STRUDEL Filter geleert: wieder alle ${musterAlle}`);
    await b.klick('[data-typ="track"]'); await warte(800);
    pruefe((await bar()) === '[true,true,true]' && (await b.werte(`document.querySelector('#lib-key').value`)) === '', `zurück zu TRACKS: Leiste voll, Felder leer: ${await bar()}`);
  }
  if (BIS >= 4 && VON <= 4) {
    // S4: Volltext mit Feld-Präfixen. Zahlen gegen den Server (/stoebern) gegengeprüft, Fehlerfall und Negativkontrollen dabei.
    const anz = () => b.werte('Number(document.querySelector("#bestand-info").textContent.split(" ")[0].replace(/,/g, ""))');
    const gesamt = (q) => fetch(`${URL}stoebern?${q}&limit=1`).then((r) => r.json()).then((j) => j.gesamt);
    const suche = async (text) => {
      await b.werte(`(() => { const i = document.querySelector('#lib-suche'); i.value = ${JSON.stringify(text)}; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return 1; })()`);
      await warte(150);
    };
    const bis = async (fn, ms = 2500) => { const t0 = Date.now(); let v; do { v = await fn(); if (v) return [v, Date.now() - t0]; await warte(25); } while (Date.now() - t0 < ms); return [false, Date.now() - t0]; };
    pruefe(await b.werte(`getComputedStyle(document.querySelector('#lib-suche')).display !== 'none'`), 'Suchfeld ist sichtbar');
    // S4-Review 4: ein ECHTER Tastendruck (Input.dispatchKeyEvent, löst in Chrome zusätzlich „search“ aus) schickt genau EINE Anfrage;
    // das synthetische KeyboardEvent der übrigen Probe löst kein „search“ aus und hätte das Doppel nie gezeigt.
    {
      await b.werte(`window.__n = 0; if (!window.__fetchGezaehlt) { window.__fetchGezaehlt = true; const f = window.fetch; window.fetch = (u, ...r) => { if (String(u).startsWith('/stoebern?')) window.__n++; return f(u, ...r); }; } 1`);
      const taste = async (key, code, vk, text) => { for (const type of ['rawKeyDown', ...(text ? ['char'] : []), 'keyUp']) await b.sende('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, ...(type === 'char' ? { text } : {}) }); };
      await b.klick('#lib-suche'); await b.sende('Input.insertText', { text: 'kick' });
      await b.werte('window.__n = 0; 1');
      await taste('Enter', 'Enter', 13, '\r'); await warte(700);
      const nEnter = await b.werte('window.__n');
      pruefe(nEnter === 1, `echtes Enter im Suchfeld: genau 1 Anfrage (${nEnter})`);
      await b.werte('window.__n = 0; 1');
      await taste('Escape', 'Escape', 27); await warte(700);   // Chrome leert ein Suchfeld mit Esc (wie das ×) und feuert input + search
      const nEsc = await b.werte('window.__n');
      pruefe(nEsc === 1 && (await b.werte(`document.querySelector('#lib-suche').value`)) === '', `Esc/× leert und sucht genau 1 Mal neu (${nEsc} Anfragen, Feld leer)`);
      await b.werte('window.__n = 0; 1');
      await taste('Escape', 'Escape', 27); await warte(500);
      pruefe((await b.werte('window.__n')) === 0, 'Negativkontrolle: Esc im schon leeren Feld schickt nichts');
      pruefe(await b.werte(`!document.body.classList.contains('lib-zu')`), 'Esc im Suchfeld schließt die Library nicht (stopPropagation)');
    }
    // SAMPLES: kick
    await b.klick('[data-typ="oneshot"]'); await warte(800);
    const alleS = await anz();
    await suche('kick');
    let [ok, ms] = await bis(async () => (await anz()) < alleS);
    const nKick = await anz();
    pruefe(ok && nKick > 1000 && nKick === (await gesamt('typ=oneshot&text=kick')), `SAMPLES „kick“: ${nKick} von ${alleS} (nach 150 ms schon da), gleich dem Server`);
    // pack:battery kick (zwei Wörter, ein Feld) schneidet weiter
    await suche('pack:battery kick'); await warte(700);
    const nPb = await anz();
    pruefe(nPb > 0 && nPb < nKick && nPb === (await gesamt('typ=oneshot&text=pack%3Abattery+kick')), `SAMPLES „pack:battery kick“: ${nPb} < ${nKick}`);
    const zeilen4 = await b.werte(`[...document.querySelectorAll('#libliste tr')].slice(0, 20).map((tr) => [tr.cells[0].textContent, tr.cells[2].textContent])`);
    pruefe(zeilen4.length > 0 && zeilen4.every(([n, pack]) => /battery/i.test(pack)), `alle sichtbaren Zeilen haben Pack Battery (${zeilen4.length})`);
    if (process.env.PROBE_BILD) await b.bild(`${process.env.PROBE_BILD}-pack-battery-kick.png`);
    // Der Text bleibt beim Typwechsel stehen und gilt dort (Loops: pack:battery)
    await b.klick('[data-typ="loop"]'); await warte(900);
    pruefe((await b.werte(`document.querySelector('#lib-suche').value`)) === 'pack:battery kick', 'Text bleibt beim Typwechsel im Feld');
    pruefe((await anz()) === (await gesamt('typ=loop&text=pack%3Abattery+kick')), `LOOPS mit demselben Text: ${await anz()} (gleich dem Server)`);
    // TRACKS: label:drumcode, artist:liebing
    await b.klick('[data-typ="track"]'); await warte(800);
    await suche('label:drumcode'); await warte(700);
    const nDc = await anz();
    pruefe(nDc > 50 && nDc === (await gesamt('typ=track&text=label%3Adrumcode')), `TRACKS „label:drumcode“: ${nDc}`);
    if (process.env.PROBE_BILD) await b.bild(`${process.env.PROBE_BILD}-label-drumcode.png`);
    await suche('artist:liebing'); await warte(700);
    const nLi = await anz();
    const kuenstler = await b.werte(`[...new Set([...document.querySelectorAll('#libliste tr')].map((tr) => tr.cells[1].textContent))]`);
    pruefe(nLi > 50 && kuenstler.every((k) => /liebing/i.test(k)), `TRACKS „artist:liebing“: ${nLi}, Künstler auf der Seite: ${kuenstler.join(' | ')}`);
    if (process.env.PROBE_BILD) await b.bild(`${process.env.PROBE_BILD}-artist-liebing.png`);
    // Text + Filter (S3) schneiden sich
    await b.werte(`(() => { const e = document.querySelector('#lib-bpm'); e.value = '124-130'; return 1; })()`);
    await suche('artist:liebing');
    await warte(700);
    const nLiB = await anz();
    pruefe(nLiB > 0 && nLiB < nLi && nLiB === (await gesamt('typ=track&text=artist%3Aliebing&bpm=124-130')), `Text + BPM 124–130: ${nLiB} < ${nLi}`);
    await b.werte(`(() => { document.querySelector('#lib-bpm').value = ''; return 1; })()`);
    // folder: ist der LIKE-Pfad
    await suche('folder:beatport'); await warte(700);
    pruefe((await anz()) > 1000 && (await anz()) === (await gesamt('typ=track&text=folder%3Abeatport')), `TRACKS „folder:beatport“: ${await anz()}`);
    // Negativ: Unsinn findet nichts, kein Fehler
    await suche('zzqxnichtda'); await warte(700);
    pruefe((await zeilen()) === 0 && (await anz()) === 0 && /^0 tracks/.test(await info()), `Negativ: Unsinn findet nichts („${await info()}“)`);
    // Text mit FTS-Syntax ist Text: kein 500
    await suche('"NEAR( AND *'); await warte(700);
    pruefe(/tracks/.test(await info()) && !/Library:/.test(await info()), `FTS-Syntax im Text bricht nichts („${await info()}“)`);
    // × / leeres Feld: alle wieder da
    await suche(''); await warte(800);
    pruefe((await anz()) === (await gesamt('typ=track')) && (await zeilen()) === 100, 'Feld geleert: wieder alle Tracks');
    // STRUDEL: einfacher Textvergleich über Name, Code, Rolle; Katalog-Felder sind ein klares 400
    await b.klick('[data-typ="strudel"]'); await warte(900);
    const alleM = await anz();
    await suche('bass'); await warte(700);
    const nBass = await anz();
    pruefe(nBass > 0 && nBass < alleM && nBass === (await gesamt('typ=strudel&text=bass')), `STRUDEL „bass“ (Name, Code, Rolle): ${nBass} von ${alleM}`);
    erwarte(/\/stoebern/, 400);
    await suche('label:drumcode'); await warte(800);
    pruefe(/patterns have only name: and rolle:/.test(await info()) && (await zeilen()) === 0, `STRUDEL „label:drumcode“: klare Meldung „${await info()}“, Liste leer`);
    await suche(''); await warte(800);
    pruefe((await anz()) === alleM, 'STRUDEL Feld geleert: wieder alle Muster');
    await b.klick('[data-typ="track"]'); await warte(800);
  }
  if (BIS >= 5 && VON <= 5) {
    // S5: Detail-Spalte. Welle, Angaben mit Quelle, Aktionen je Typ, ↑/↓/S. Echter Katalog ODER --fixture (Scratch, mit Fehlerfällen).
    const FIX = process.argv.includes('--fixture');
    const NAME5 = `probe5-${process.pid}-${Date.now()}`;
    const angelegt5 = [];
    const bild5 = async (n) => { if (process.env.PROBE_BILD) await b.bild(`${process.env.PROBE_BILD}-${n}.png`); };
    const post5 = (u, k) => fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(k) }).then((r) => r.json());
    const bis5 = async (fn, ms = 30000) => { const t0 = Date.now(); let v; do { v = await fn(); if (v) return [v, Date.now() - t0]; await warte(40); } while (Date.now() - t0 < ms); return [false, Date.now() - t0]; };
    const taste5 = (k, ziel = 'document.body') => b.werte(`${ziel}.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true }))`);
    const suche5 = async (text) => {
      await b.werte(`(() => { const i = document.querySelector('#lib-suche'); i.value = ${JSON.stringify(text)}; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return 1; })()`);
      await warte(700);
    };
    const waehle5 = async (i) => { await b.klick(`#libliste tr:nth-child(${i + 1}) td`); await warte(250); };
    const dt = (sel) => b.werte(`document.querySelector('#st-detail ${sel}')?.textContent ?? ''`);
    const fakt = (k) => b.werte(`(() => { const dts = [...document.querySelectorAll('#st-detail dt')]; const e = dts.find((x) => x.textContent === ${JSON.stringify(k)}); return e ? e.nextElementSibling.textContent : null; })()`);
    const hatCanvas = () => b.werte(`!!document.querySelector('#st-detail canvas.st-welle')`);
    const pixel = () => b.werte(`(() => { const c = document.querySelector('#st-detail canvas.st-welle'); if (!c) return -1; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n; })()`);
    const knopfTexte = () => b.werte(`[...document.querySelectorAll('#st-detail .st-aktionen button')].map((x) => x.textContent)`);
    const anfragen = (teil) => b.werte(`window.__anfragen.filter((u) => u.includes(${JSON.stringify(teil)})).length`);
    const ueberschrift = () => dt('h3');
    // Anfragen der Seite mitschreiben: performance.getEntriesByType hat einen Deckel von 250 Einträgen, das hier nicht
    await b.werte(`(() => { if (window.__anfragen) return 1; window.__anfragen = []; const f = window.fetch; window.fetch = (...a) => { window.__anfragen.push(String(a[0])); return f(...a); }; return 1; })()`);
    try {
      // --- Track: Angaben mit Quelle, Welle, ↑/↓
      await b.klick('[data-typ="track"]'); await warte(900);
      await waehle5(0);
      const [angaben] = await bis5(async () => (await dt('table.st-angaben th:nth-child(3)')) === 'Source', 8000);
      pruefe(angaben, 'Track: Detail zeigt die Angaben mit Spalte „Source"');
      pruefe(/\S+ – \S+/.test(await ueberschrift()) || FIX, `Track: Überschrift „${await ueberschrift()}"`);
      pruefe(/^(BPM|Key)/.test(await b.werte(`document.querySelector('#st-detail dt')?.textContent ?? ''`)), 'Track: Fakten oben (BPM, Key, …)');
      const erstesDa = await b.werte('window.djk.stoebern.treffer[0].pfad_da');
      if (erstesDa) {
        const [w, ms] = await bis5(hatCanvas);
        pruefe(w, `Track: Wellenform-Fläche da (${ms} ms, kalt oder aus dem Cache)`);
        pruefe((await pixel()) > 500, `Track: Welle ist gezeichnet (${await pixel()} Pixel)`);
      } else pruefe(/not found/i.test(await dt('.st-wellefeld')) && !(await hatCanvas()), 'Track: Datei fehlt → Grund statt Welle');
      await bild5('track-detail');
      const h0 = await ueberschrift();
      await taste5('ArrowDown'); await warte(500);
      pruefe((await b.werte('document.querySelector("#libliste tr.gewaehlt")?.dataset.i')) === '1', '↓ wählt die nächste Zeile');
      pruefe((await ueberschrift()) !== h0 && (await ueberschrift()) !== '', `↓ wechselt das Detail („${await ueberschrift()}")`);
      await taste5('ArrowUp'); await warte(500);
      pruefe((await b.werte('document.querySelector("#libliste tr.gewaehlt")?.dataset.i')) === '0' && (await ueberschrift()) === h0, '↑ geht zurück');
      await taste5('ArrowUp'); await warte(300);
      pruefe((await b.werte('document.querySelector("#libliste tr.gewaehlt")?.dataset.i')) === '0', '↑ an der ersten Zeile bleibt dort');
      await taste5('ArrowDown', `document.querySelector('#lib-energie')`); await warte(300);
      pruefe((await b.werte('document.querySelector("#libliste tr.gewaehlt")?.dataset.i')) === '0', '↓ im Energie-Auswahlfeld wählt keine Zeile (Negativkontrolle)');
      // --- S legt die gewählte Zeile ins aktive Set; im Textfeld tippen tut es nicht (Negativkontrolle)
      await post5(`${URL}sammlungen`, { name: NAME5 }); angelegt5.push(NAME5);
      await b.werte(`localStorage.setItem('djk-set', ${JSON.stringify(NAME5)}); 1`);
      const nPosten = async () => (await fetch(`${URL}sammlungen/${NAME5}`).then((r) => r.json())).posten.map((p) => p.art);
      await b.werte(`document.querySelector('#lib-suche').focus(); 1`);
      await taste5('s', `document.querySelector('#lib-suche')`); await warte(500);
      pruefe(JSON.stringify(await nPosten()) === '[]', 'S im Suchfeld legt nichts ab (Negativkontrolle)');
      await b.werte(`document.activeElement.blur(); 1`);
      await taste5('s'); await warte(700);
      pruefe(JSON.stringify(await nPosten()) === '["track"]', `S legt den gewählten Track ins aktive Set: ${JSON.stringify(await nPosten())}`);
      // --- S5-Review B5: echte Tastendrücke (Input.dispatchKeyEvent), Fokus im Suchfeld nach Enter. dispatchEvent auf body hätte den Fokus umgangen.
      const echt = async (key, code, vk, text) => {
        for (const type of text ? ['keyDown', 'char', 'keyUp'] : ['keyDown', 'keyUp'])
          await b.sende('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, ...(text && type !== 'keyUp' ? { text } : {}) });
        await warte(350);
      };
      await b.klick('[data-typ="oneshot"]'); await warte(900);
      await b.werte(`document.querySelector('#lib-suche').focus(); 1`);
      await b.sende('Input.insertText', { text: 'name:"1 F1"' });
      await echt('Enter', 'Enter', 13); await warte(600);
      pruefe(await b.werte(`document.activeElement === document.querySelector('#lib-suche')`), 'Fokus steht nach Enter im Suchfeld (der Fall des Reviews)');
      await echt('ArrowDown', 'ArrowDown', 40);
      pruefe((await b.werte('document.querySelector("#libliste tr.gewaehlt")?.dataset.i')) === '0' && !(await b.werte(`document.activeElement === document.querySelector('#lib-suche')`)), 'echtes ↓ im Suchfeld: Zeile 0 gewählt, Fokus in der Liste');
      await echt('ArrowDown', 'ArrowDown', 40);
      pruefe((await b.werte('document.querySelector("#libliste tr.gewaehlt")?.dataset.i')) === '1', 'echtes ↓ danach: Zeile 1');
      await echt('ArrowUp', 'ArrowUp', 38);
      pruefe((await b.werte('document.querySelector("#libliste tr.gewaehlt")?.dataset.i')) === '0', 'echtes ↑: Zeile 0');
      // Re-Review L4: ↑ auf der ersten Zeile (↓ auf der letzten ebenso) startet die Welle nicht von vorn
      await warte(1200);
      const nW = await anfragen('/welle?sha='), nD = await anfragen('/stoebern/detail');
      const knoten0 = await b.werte(`(window.__d0 = document.querySelector('#st-detail h3')) !== null`);
      await echt('ArrowUp', 'ArrowUp', 38); await warte(500);
      pruefe(knoten0 && (await anfragen('/welle?sha=')) === nW && (await anfragen('/stoebern/detail')) === nD && await b.werte(`window.__d0 === document.querySelector('#st-detail h3')`),
        `↑ auf der ersten Zeile: keine neue Welle- und Detail-Anfrage, Detail nicht neu gebaut (${nW} Wellen, ${nD} Details)`);
      const vorS = (await nPosten()).length;
      await echt('s', 'KeyS', 83, 's'); await warte(400);
      pruefe((await nPosten()).length === vorS + 1 && (await nPosten()).at(-1) === 'oneshot', `echtes S legt das Sample ins aktive Set: ${JSON.stringify(await nPosten())}`);
      await b.werte(`document.querySelector('#lib-suche').focus(); 1`);
      await echt('s', 'KeyS', 83, 's');
      pruefe((await nPosten()).length === vorS + 1 && (await b.werte(`document.querySelector('#lib-suche').value`)).endsWith('s'), 'S im Suchfeld tippt nur (legt nichts ab)');
      await suche5('');
      // --- S5-Review B2: schnelles ↓ durch Tracks — die Seite bricht alte Wellen-Anfragen ab, es läuft höchstens EIN ffmpeg (Dekodierung der Welle)
      await b.klick('[data-typ="track"]'); await warte(900);
      const { execFileSync: ps } = await import('node:child_process');
      const laeuft = () => ps('ps', ['-eo', 'args=']).toString().split('\n').filter((z) => z.includes('-nostdin') && z.includes('-map 0:a:0')).length;
      let maxFf = 0; const takt5 = setInterval(() => { try { maxFf = Math.max(maxFf, laeuft()); } catch { /* ps */ } }, 20);
      await waehle5(0);
      for (let i = 0; i < 7; i++) { await echt('ArrowDown', 'ArrowDown', 40); await warte(100); }
      const [lastW] = await bis5(hatCanvas, 40000);
      await warte(400); clearInterval(takt5);
      pruefe(lastW, 'acht Zeilen in 1 s durchlaufen: die letzte hat ihre Welle');
      pruefe(maxFf <= 1, `höchstens ein ffmpeg zugleich (gemessen ${maxFf}; ${FIX ? 'Fixture: kurze Dateien, kaum Überlappung' : 'echte Tracks, kalter Cache'})`);
      pruefe(laeuft() === 0, 'danach läuft kein ffmpeg mehr');
      // --- Loop: Live-Loop ohne Welle-Anfrage; normaler Loop mit Welle; kein toter Knopf „→ L1/L2"
      await b.klick('[data-typ="loop"]'); await warte(900);
      const finde = (typ, bed) => b.werte(`(async () => { for (let s = 0; s < 60; s++) { const j = await fetch('/stoebern?typ=${typ}&limit=200&seite=' + s).then((r) => r.json()); const t = j.treffer.find((x) => ${bed}); if (t) return t; if (!j.treffer.length) return null; } return null; })()`);
      const live = await finde('loop', 'x.nur_live');
      if (live) {
        await suche5(`name:"${live.name.replace(/"/g, ' ')}"`);
        const i = await b.werte(`[...document.querySelectorAll('#libliste tr')].findIndex((tr) => tr.dataset.sha === ${JSON.stringify(live.sha)})`);
        pruefe(i >= 0, `Live-Loop „${live.name}" gefunden (Zeile ${i})`);
        if (i >= 0) {
          await waehle5(i); await warte(900);
          pruefe(/Live only/.test(await dt('.st-wellefeld')) && !(await hatCanvas()), `Live-Loop: Grund statt Welle („${await dt('.st-wellefeld')}")`);
          pruefe((await anfragen(`/welle?sha=${live.sha}`)) === 0, 'Live-Loop: die Seite hat gar keine Welle angefordert (kein 422 in der Konsole)');
          pruefe((await knopfTexte()).includes('+ SET'), `Live-Loop: + SET im Detail (${(await knopfTexte()).join(' | ')})`);
          await bild5('loop-live');
        }
        await suche5('');
      } else console.log('kein Live-Loop im Katalog — Prüfung übersprungen');
      const normal = await finde('loop', '!x.nur_live && x.pfad_da');
      if (normal) {
        await suche5(`name:"${normal.name.replace(/"/g, ' ')}"`);
        const i = await b.werte(`[...document.querySelectorAll('#libliste tr')].findIndex((tr) => tr.dataset.sha === ${JSON.stringify(normal.sha)})`);
        await waehle5(Math.max(0, i));
        const [w] = await bis5(hatCanvas);
        pruefe(w && (await pixel()) > 100, `Loop „${normal.name}": Welle gezeichnet`);
        const k = await knopfTexte();
        pruefe(k.includes('+ SET') && k.some((x) => x.startsWith('+ LIST')) && k.includes('→ L1') && k.includes('→ L2'), `Loop: Aktionen ${k.join(' | ')} (→ L1/L2 seit S6)`);
        await suche5('');
      }
      // --- Samples: gleichnamige unterscheidbar (voller Ordnerpfad, Pack, Länge, Welle)
      await b.klick('[data-typ="oneshot"]'); await warte(900);
      await suche5('name:"1 F1"');
      const anzahl = await zeilen();
      pruefe(anzahl >= 2, `„1 F1": ${anzahl} gleichnamige Samples`);
      const sicht = await b.werte(`[...document.querySelectorAll('#libliste tr')].map((tr, i) => [i, tr.dataset.sha])`);
      const tdet = await b.werte(`window.djk.stoebern.treffer.map((t) => [t.nur_live, t.pfad_da])`);
      const lesbar = sicht.filter(([i]) => !tdet[i][0] && tdet[i][1]).map(([i]) => i);
      const merk = [];
      for (const i of lesbar.slice(0, 2)) {
        await waehle5(i);
        const [w] = await bis5(hatCanvas);
        const png = await b.werte(`document.querySelector('#st-detail canvas.st-welle')?.toDataURL() ?? ''`);
        merk.push({ i, ordner: await fakt('Folder'), pack: await fakt('Pack'), laenge: await fakt('Length'), datei: await fakt('File'), welle: png.length > 0 && w ? png : '', px: await pixel() });
        if (merk.length === 1) await b.werte(`(() => { const d = document.querySelector('#st-detail'), k = d.cloneNode(true); k.id = 'st-detail-alt';
          const von = d.querySelectorAll('canvas'), nach = k.querySelectorAll('canvas');
          von.forEach((c, n) => { nach[n].width = c.width; nach[n].height = c.height; nach[n].getContext('2d').drawImage(c, 0, 0); });
          const r = d.getBoundingClientRect(); k.style.cssText = 'position:fixed;top:' + r.top + 'px;left:' + (r.left - r.width - 12) + 'px;width:' + r.width + 'px;height:' + r.height + 'px;background:var(--bg);border:1px solid var(--line);padding:0 8px;z-index:50;overflow:hidden';
          document.body.append(k); return 1; })()`);
      }
      pruefe(merk.length === 2, `zwei lesbare gleichnamige Samples gewählt (${merk.map((m) => m.i).join(', ')})`);
      if (merk.length === 2) {
        const [m1, m2] = merk;
        pruefe(m1.ordner !== m2.ordner && m1.ordner.length > 20, `Ordner unterscheiden sich, voller Pfad: „${m1.ordner}" ≠ „${m2.ordner}"`);
        pruefe(m1.laenge !== m2.laenge || m1.pack !== m2.pack, `Länge/Pack: ${m1.pack} ${m1.laenge} ≠ ${m2.pack} ${m2.laenge}`);
        pruefe(m1.welle !== '' && m2.welle !== '' && m1.welle !== m2.welle, 'Wellenformen sind gezeichnet und verschieden');
        console.log(JSON.stringify(merk.map(({ welle, ...r }) => r)));
      }
      await bild5('samples-gleichnamig');
      await b.werte(`document.querySelector('#st-detail-alt')?.remove(); 1`);
      await suche5('');                                         // der Suchtext bleibt beim Typwechsel stehen (S4) und würde STRUDEL leeren
      // --- Fehlerfälle (Scratch-Katalog): Ableton-Sample, fehlende Datei, unlesbares .aif
      if (FIX) {
        const sel = async (name, pack) => { const i = await b.werte(`window.djk.stoebern.treffer.findIndex((t) => t.pack === ${JSON.stringify(pack)})`); await waehle5(i); await warte(1000); return i; };
        await suche5('');
        await b.klick('[data-typ="oneshot"]'); await warte(800);
        const grund = () => dt('.st-wellefeld');
        await sel('1 F1', 'Pack C');
        pruefe(/Live only/.test(await grund()) && !(await hatCanvas()) && (await anfragen(`/welle?sha=${'c'.repeat(64)}`)) === 0, `Ableton-Sample: „${await grund()}", keine Welle-Anfrage`);
        await sel('weg', 'Pack E');
        pruefe(/not found/i.test(await grund()) && !(await hatCanvas()) && (await anfragen(`/welle?sha=${'e'.repeat(64)}`)) === 0, `fehlende Datei: „${await grund()}", keine Welle-Anfrage`);
        erwarte(/\/welle\?sha=d{64}/, 422);
        await sel('broken', 'Pack D');
        const [fail] = await bis5(async () => /unavailable/.test(await grund()), 10000);
        pruefe(fail && !(await hatCanvas()), `ffmpeg-unlesbares .aif: „${await grund()}" (422 erwartet und gemeldet)`);
        pruefe((await anfragen(`/welle?sha=${'d'.repeat(64)}`)) === 1, 'unlesbares .aif: genau eine Anfrage, kein Wiederholen');
        pruefe(await b.werte(`document.querySelectorAll('#st-detail button.in-set').length === 1`), 'auch im Fehlerfall: + SET im Detail');
        await bild5('fehlerfall-422');
        await b.klick('[data-typ="track"]'); await warte(800);
        await waehle5(0);   // Missing Track (Titel-Sortierung: „Missing Track" vor „Tech Wolf")
        pruefe(/Missing Track/.test(await ueberschrift()) || /Probe|Beta/.test(await ueberschrift()), `Track ohne Datei: Detail „${await ueberschrift()}"`);
        pruefe(/not found/i.test(await grund()) && !(await hatCanvas()), `Track ohne Datei: „${await grund()}"`);
        // Fixture hat zwei Objekte zum Werk 1: beide Angaben mit Quelle, der Verlierer durchgestrichen
        await waehle5(1); await warte(600);
        const ang = await b.werte(`[...document.querySelectorAll('#st-detail table.st-angaben tr')].slice(1).map((tr) => [tr.cells[0].textContent, tr.cells[1].textContent, tr.cells[2].textContent, tr.className])`);
        const tit = ang.filter((a) => a[0] === 'Title');
        pruefe(JSON.stringify(tit.map((a) => a.slice(1))) === JSON.stringify([['Tech Wolf (Edit)', 'andreas', ''], ['Techno Wolf', 'beatport', 'ueberstimmt']]), `Title-Angaben: Gewinner zuerst, Verlierer durchgestrichen ${JSON.stringify(tit)}`);
        await bild5('track-angaben-quellen');
      }
      // --- STRUDEL: Code, Rolle, Quelle; → DRUMS/BASS/MELODY mit Rückfrage; Archiv nur COPY; kein Server-Detail
      await b.klick('[data-typ="strudel"]'); await warte(1000);
      // Ladbare Muster (eigen, track) liegen nicht auf Seite 1 der Namenssortierung (197 Archiv-Blöcke „b…" davor): erst die Quelle wählen
      await b.werte(`(() => { const k = [...document.querySelectorAll('#st-baum .st-knoten')]; (k.find((d) => d.textContent.startsWith('mine ')) ?? k.find((d) => d.textContent.startsWith('track ')))?.click(); return 1; })()`);
      await warte(900);
      const vorher = await anfragen('/stoebern/detail');
      const ladbar = await b.werte(`window.djk.stoebern.treffer.map((t, i) => [i, t.ladbar, t.text, t.id]).filter((x) => x[1])`);
      pruefe(ladbar.length >= 2, `Muster mit „ladbar": ${ladbar.length}`);
      await waehle5(ladbar[0][0]); await warte(300);
      pruefe(/^Role/.test(await b.werte(`document.querySelector('#st-detail dt')?.textContent ?? ''`)) && (await fakt('Source')) !== null, `Strudel: Rolle „${await fakt('Role')}", Quelle „${await fakt('Source')}"`);
      pruefe((await dt('pre.st-code')).trim() === ladbar[0][2].trim(), 'Strudel: der Code steht im Detail');
      pruefe(!(await hatCanvas()) && (await anfragen('/stoebern/detail')) === vorher, 'Strudel: keine Welle, keine Detail-Anfrage an den Server');
      const kn = await knopfTexte();
      pruefe(['→ DRUMS', '→ BASS', '→ MELODY', '+ SET'].every((x) => kn.includes(x)) && kn.some((x) => x.startsWith('+ LIST')), `Strudel: Aktionen ${kn.join(' | ')}`);
      await bild5('strudel-detail');
      await b.werte(`window.__frage = []; window.__antwort = false; window.confirm = (m) => { window.__frage.push(m); return window.__antwort; }; 1`);
      const feldWerte = () => b.werte(`[...document.querySelectorAll('.muster-feld')].map((f) => f.value)`);
      await b.klick('#st-detail button[data-strom="1"]'); await warte(400);
      pruefe((await feldWerte()).includes(ladbar[0][2]), '→ DRUMS: der Code steht im Editor');
      pruefe((await b.werte('window.__frage.length')) === 0, '→ DRUMS in einen unveränderten Editor: keine Rückfrage');
      await waehle5(ladbar[1][0]); await warte(300);
      await b.klick('#st-detail button[data-strom="1"]'); await warte(400);
      pruefe((await b.werte('window.__frage.length')) === 1 && (await feldWerte()).includes(ladbar[0][2]) && !(await feldWerte()).includes(ladbar[1][2]),
        'Editor mit ungesendetem Text: Rückfrage, bei Nein bleibt der Text (Negativkontrolle)');
      await b.werte('window.__antwort = true; 1');
      await b.klick('#st-detail button[data-strom="1"]'); await warte(400);
      pruefe((await feldWerte()).includes(ladbar[1][2]), 'bei Ja: ersetzt');
      // Archiv-Muster: nur COPY
      const arch = await b.werte(`[...document.querySelectorAll('#st-baum .st-knoten')].find((d) => d.textContent.startsWith('archive '))?.click() ?? null`);
      await warte(900);
      const archIdx = await b.werte(`window.djk.stoebern.treffer.findIndex((t) => !t.ladbar)`);
      if (archIdx >= 0) {
        await waehle5(archIdx); await warte(300);
        const ka = await knopfTexte();
        pruefe(ka.includes('COPY') && !ka.some((x) => x.startsWith('→')), `Archiv-Muster: ${ka.join(' | ')} (kein Laden in den Editor)`);
        pruefe(/Archive pattern/.test(await dt('.st-hinweis')), 'Archiv-Muster: Hinweis „view and copy only"');
      } else console.log('kein Archiv-Muster — Prüfung übersprungen');
      // --- Listen-Zeilen öffnen das Detail ebenfalls (PLAYLIST · LOOP LIST · STRUDEL LIST)
      const track2 = await b.werte(`fetch('/stoebern?typ=track&limit=2').then((r) => r.json()).then((j) => j.treffer.map((t) => t.material_id))`);
      const loop1 = await finde('loop', '!x.nur_live && x.pfad_da'), os1 = await finde('oneshot', '!x.nur_live && x.pfad_da');
      const mid = (t) => t.sha.slice(0, 16);
      const strRefs = ladbar.slice(0, 2).map((x) => x[3]);
      const mache = async (slug, art, posten) => {
        await post5(`${URL}sammlungen`, { name: slug, art }); angelegt5.push(slug);
        for (const p of posten) await post5(`${URL}sammlungen/${slug}/posten`, p);
      };
      const PL5 = `${NAME5}-pl`, LL5 = `${NAME5}-ll`, SL5 = `${NAME5}-sl`;
      await mache(PL5, 'playlist', track2.map((m) => ({ art: 'track', material_id: m })));
      await mache(LL5, 'looplist', [{ art: 'loop', material_id: mid(loop1) }, { art: 'oneshot', material_id: mid(os1) }]);
      await mache(SL5, 'strudellist', strRefs.map((r) => ({ art: 'muster', ref: r })));
      await b.klick('[data-typ="track"]'); await warte(900);
      const oeffneListe = async (art, slug) => {
        await b.werte(`(() => { const k = document.querySelector('#st-baum [data-listenart="${art}"]'); if (k.getAttribute('aria-expanded') !== 'true') k.click(); return 1; })()`); await warte(500);
        await b.klick(`#st-baum .st-knoten[data-liste="${slug}"]`); await warte(900);
      };
      await oeffneListe('playlist', PL5);
      await waehle5(0);
      const [angP] = await bis5(async () => (await dt('table.st-angaben th:nth-child(3)')) === 'Source', 8000);
      pruefe(angP && (await ueberschrift()).length > 3, `PLAYLIST-Zeile öffnet das Detail mit Angaben („${await ueberschrift()}")`);
      const hP = await ueberschrift();
      await taste5('ArrowDown'); await warte(700);
      pruefe((await ueberschrift()) !== hP && (await b.werte('document.querySelector("#libliste tr.gewaehlt")?.dataset.i')) === '1', '↓ in der Liste wählt die nächste Zeile');
      await oeffneListe('looplist', LL5);
      await waehle5(1);
      const [wL] = await bis5(hatCanvas);
      pruefe(wL && (await fakt('Folder'))?.length > 5, `LOOP LIST: Sample-Zeile zeigt Ordner „${(await fakt('Folder'))?.slice(-40)}" und Welle`);
      await waehle5(0);
      pruefe((await fakt('Bars')) !== null, 'LOOP LIST: Loop-Zeile zeigt Bars');
      await bild5('looplist-detail');
      await oeffneListe('strudellist', SL5);
      await waehle5(0);
      pruefe((await dt('pre.st-code')).length > 3 && (await knopfTexte()).includes('→ DRUMS'), 'STRUDEL LIST: Zeile zeigt Code und → DRUMS');
    } finally {
      for (const n of angelegt5) await fetch(`${URL}sammlungen/${n}/loeschen`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).catch(() => {});
    }
  }
  if (BIS >= 6 && VON <= 6) {
    // S6: Loop aus der Mediathek in die Loop-Box. Echter Katalog ODER --fixture. Die Loop-Ablage der Prüfinstanz liegt auf Scratch (--loops),
    // nie in ~/.config/cypherdj/loops. Der Import läuft wirklich (ffmpeg + Rubber Band); geladen wird in die Kern-Attrappe der Prüfinstanz.
    const FIX6 = process.argv.includes('--fixture');
    const bild6 = async (n) => { if (process.env.PROBE_BILD) await b.bild(`${process.env.PROBE_BILD}-${n}.png`); };
    const bis6 = async (fn, ms = 90000) => { const t0 = Date.now(); let v; do { v = await fn(); if (v) return [v, Date.now() - t0]; await warte(40); } while (Date.now() - t0 < ms); return [false, Date.now() - t0]; };
    const loopsListe = () => fetch(`${URL}loops`).then((r) => r.json());
    const post6 = (u, k) => fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(k) }).then(async (r) => ({ code: r.status, j: await r.json() }));
    const suche6 = async (text) => {
      await b.werte(`(() => { const i = document.querySelector('#lib-suche'); i.value = ${JSON.stringify(text)}; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return 1; })()`);
      await warte(700);
    };
    const finde6 = (bed) => b.werte(`(async () => { for (let s = 0; s < 80; s++) { const j = await fetch('/stoebern?typ=loop&limit=200&seite=' + s).then((r) => r.json()); const t = j.treffer.find((x) => ${bed}); if (t) return t; if (!j.treffer.length) return null; } return null; })()`);
    const sucheName = async (t) => { await suche6(`name:"${String(t.name).replace(/"/g, ' ')}"`); return b.werte(`[...document.querySelectorAll('#libliste tr')].findIndex((tr) => tr.dataset.sha === ${JSON.stringify(t.sha)})`); };
    const zeilenKnoepfe = (i) => b.werte(`[...document.querySelectorAll('#libliste tr:nth-child(${i + 1}) button.in-box')].map((x) => [x.textContent, x.disabled, x.title])`);
    const grund = (i) => b.werte(`document.querySelector('#libliste tr:nth-child(${i + 1}) .loopbox-grund')?.textContent ?? ''`);
    const klickeZeile6 = async (n) => { await b.klick(`#libliste tr:nth-child(${n + 1}) td`); await warte(250); };
    const info6 = () => b.werte('document.querySelector("#bestand-info").textContent');
    const alleAus = () => b.werte(`[...document.querySelectorAll('button.in-box')].every((x) => x.disabled)`);
    const vor = (await loopsListe()).length;
    await b.klick('[data-typ="loop"]'); await warte(900);
    // --- Ableton-geschützt: kein aktiver Knopf, der Grund steht da
    const live = await finde6('x.nur_live');
    if (live) {
      const i = await sucheName(live);
      pruefe(i >= 0 && (await zeilenKnoepfe(i)).length === 0 && /Live only/.test(await grund(i)), `Live-Loop „${live.name}": kein → L-Knopf, Grund „${await grund(i)}"`);
      await klickeZeile6(i);
    } else console.log('kein Live-Loop — übersprungen');
    // --- ohne BPM: deaktiviert mit Grund (Tooltip und Kurztext)
    const ohne = await finde6('!x.nur_live && x.pfad_da && x.import_grund === "bpm_unbekannt"');
    if (ohne) {
      const i = await sucheName(ohne);
      const k = await zeilenKnoepfe(i);
      pruefe(i >= 0 && k.length === 2 && k.every(([, aus, titel]) => aus && /No BPM/.test(titel)) && (await grund(i)) === 'No BPM', `Loop ohne BPM „${ohne.name}": → L1/L2 deaktiviert, Grund „${await grund(i)}", Tooltip „${k[0]?.[2]}"`);
    } else console.log('kein Loop ohne BPM — übersprungen');
    // --- Datei fehlt: deaktiviert (Titel „File not found")
    const weg = await finde6('!x.nur_live && !x.pfad_da');
    if (weg) {
      const i = await sucheName(weg);
      const k = await zeilenKnoepfe(i);
      pruefe(i >= 0 && k.length === 2 && k.every(([, aus, titel]) => aus && /File not found/.test(titel)), `Loop ohne Datei: → L1/L2 deaktiviert (${k[0]?.[2]})`);
    }
    // --- importierbarer Loop: Knöpfe in Zeile UND Detail, Klick importiert, lädt, entsperrt wieder
    const gut = await finde6('!x.nur_live && x.pfad_da && x.import_beats && x.bpm !== 128 && x.name !== "S6 Kaputt" && !x.name.includes("\\"")');   // nicht 128 BPM: es soll wirklich gedehnt werden
    pruefe(!!gut, `importierbarer Loop im Katalog: „${gut?.name}" (${gut?.import_beats} Beats @ ${gut?.bpm} BPM)`);
    const i = await sucheName(gut);
    const k = await zeilenKnoepfe(i);
    pruefe(k.length === 2 && k.every(([, aus]) => !aus) && k[0][0] === '→ L1' && k[1][0] === '→ L2', `Zeile hat aktive Knöpfe ${JSON.stringify(k.map((x) => x[0]))}`);
    await klickeZeile6(i);
    pruefe(JSON.stringify(await b.werte(`[...document.querySelectorAll('#st-detail button.in-box')].map((x) => [x.textContent, x.disabled])`)) === JSON.stringify([['→ L1', false], ['→ L2', false]]), 'Detail hat dieselben aktiven Knöpfe');
    // Klick: im selben Tick sind alle → L-Knöpfe gesperrt (ein Import zur Zeit), danach kommt der Loop in die Ablage
    const t0 = Date.now();
    const [gesperrt, laeuftMeldung] = await b.werte(`(() => { document.querySelector('#libliste tr:nth-child(${i + 1}) button.in-box.l1').click(); return [[...document.querySelectorAll('button.in-box')].every((x) => x.disabled), document.querySelector('#meldung').textContent]; })()`);
    pruefe(gesperrt === true, 'Während des Imports sind alle → L-Knöpfe gesperrt (Zeile und Detail)');
    pruefe(/^Importing .* stretching to 128 BPM/.test(laeuftMeldung), `Meldung während des Imports: „${laeuftMeldung}“`);
    const [neu, ms] = await bis6(async () => (await loopsListe()).length === vor + 1);
    pruefe(neu, `Loop in der Ablage der Prüfinstanz nach ${ms} ms (Klick bis Datei; vorher ${vor})`);
    const liste = await loopsListe();
    const l = liste.find((x) => x.quelle === 'mediathek' && x.name !== undefined && x.ladbar && x.beats === gut.import_beats);
    pruefe(!!l, `neuer Loop ladbar, quelle mediathek, ${gut.import_beats} Beats: ${JSON.stringify(l)}`);
    const [entsperrt] = await bis6(async () => !(await alleAus()), 20000);
    pruefe(entsperrt, `Knöpfe sind nach dem Import wieder frei (${Date.now() - t0} ms nach dem Klick)`);
    const geladen = await b.werte(`window.djkGesendet.filter((x) => x.loop?.aktion === 'laden' && x.loop.name === ${JSON.stringify(l?.name)}).map((x) => [x.loop.box, x.code, x.antwort.quittung?.status ?? null])`);
    pruefe(geladen.length === 1 && geladen[0][0] === 1 && geladen[0][1] === 200 && geladen[0][2] !== 6, `Ladebefehl an Box 1 gesendet, vom Kern nicht abgelehnt: ${JSON.stringify(geladen)}`);
    const meldung = await b.werte(`document.body.innerText.match(/“[^”]+” (imported|was already imported)[^\\n]*/)?.[0] ?? ''`);
    pruefe(/imported/.test(meldung), `Meldung: ${meldung}`);
    await bild6('loop-importiert');
    // --- zweiter Klick auf dieselbe Quelle (L2): kein Doppelgänger, lädt den vorhandenen
    await b.werte(`document.querySelector('#libliste tr:nth-child(${i + 1}) button.in-box.l2').click(); 1`);
    const [zwei] = await bis6(async () => (await b.werte(`window.djkGesendet.filter((x) => x.loop?.aktion === 'laden' && x.loop.box === 2).length`)) >= 1, 30000);
    pruefe(zwei && (await loopsListe()).length === vor + 1, `zweiter Klick (→ L2): Loop wieder geladen, aber kein zweiter Import (${(await loopsListe()).length} Loops)`);
    pruefe(/already imported/.test(await b.werte(`document.body.innerText.match(/“[^”]+” was already imported[^\\n]*/)?.[0] ?? ''`)), 'Meldung „was already imported"');
    // --- LOOP LIST: die Listenzeile trägt dieselben Knöpfe
    const LL6 = `probe6-${process.pid}-${Date.now()}`;
    try {
      await post6(`${URL}sammlungen`, { name: LL6, art: 'looplist' });
      await post6(`${URL}sammlungen/${LL6}/posten`, { art: 'loop', material_id: gut.sha.slice(0, 16) });
      await b.klick('[data-typ="track"]'); await warte(700);
      await b.werte(`(() => { const k = document.querySelector('#st-baum [data-listenart="looplist"]'); if (k.getAttribute('aria-expanded') !== 'true') k.click(); return 1; })()`); await warte(500);
      await b.klick(`#st-baum .st-knoten[data-liste="${LL6}"]`); await warte(900);
      const kl = await zeilenKnoepfe(0);
      pruefe(kl.length === 2 && kl.every(([, aus]) => !aus), `LOOP LIST-Zeile hat aktive → L1/L2: ${JSON.stringify(kl.map((x) => x[0]))}`);
      await bild6('looplist-zeile');
    } finally { await post6(`${URL}sammlungen/${LL6}/loeschen`, {}).catch(() => {}); }
    // --- Sample hat nie → L (Negativkontrolle)
    await b.klick('[data-typ="oneshot"]'); await warte(900);
    pruefe((await b.werte(`document.querySelectorAll('#libliste button.in-box').length`)) === 0, 'Negativkontrolle: SAMPLES-Zeilen haben keine → L-Knöpfe');
    // --- Fehlerfall (Fixture): Datei da, aber nicht dekodierbar → 422, Meldung, Knöpfe wieder frei, nichts angelegt
    if (FIX6) {
      await b.klick('[data-typ="loop"]'); await warte(900);
      const kaputt = await finde6('x.pack === "S6 Pack" && x.name === "S6 Kaputt"');
      const j = await sucheName(kaputt);
      const nVor = (await loopsListe()).length;
      erwarte(/\/loops\/aus-katalog/, 422);
      await b.werte(`document.querySelector('#libliste tr:nth-child(${j + 1}) button.in-box.l1').click(); 1`);
      const [fm] = await bis6(async () => /Loop import: the file could not be decoded/.test(await b.werte(`document.body.innerText`)), 30000);
      pruefe(fm, 'Fehlerfall: nicht dekodierbare Datei → Meldung „Loop import: the file could not be decoded"');
      const [frei] = await bis6(async () => !(await alleAus()), 10000);
      pruefe(frei && (await loopsListe()).length === nVor, 'Fehlerfall: Knöpfe wieder frei, nichts angelegt');
      await bild6('loop-fehler');
    }
    await suche6('');
  }
  if (BIS >= 7 && VON <= 7) {
    // S7: Vorhören als Kern-Eingang. Die Prüfinstanz hängt den Cue an die stumme Senke cypher_stumm-<i>; die Probe läuft den Ton-Weg
    // ganz ohne Lautsprecher, /pegel misst Master und Cue des Prüf-Kerns. Mit PROBE_BILD=<präfix> entstehen Bilder.
    const bild7 = async (n) => { if (process.env.PROBE_BILD) await b.bild(`${process.env.PROBE_BILD}-${n}.png`); };
    const leertaste = () => b.werte(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })); 1`);
    const taste7 = (key) => b.werte(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true })); 1`);
    const stand7 = async () => (await fetch(URL + 'vorhoeren')).json();
    const meldung7 = () => b.werte('document.querySelector("#meldung").textContent');
    const waehle7 = async (typ, pruefung) => {                // erste Zeile des Typs, die spielbar ist (Datei da, nicht Live only)
      await b.klick(`[data-typ="${typ}"]`); await warte(900);
      const i = await b.werte(`[...document.querySelectorAll('#libliste tr')].findIndex((tr) => !tr.textContent.includes('Live only') && !tr.classList.contains('fehlt')${pruefung ?? ''})`);
      await b.werte(`document.querySelectorAll('#libliste tr')[${i}].scrollIntoView({ block: 'center' }); 1`);   // sonst liegt die Zelle außerhalb der Tabelle und der Klick trifft nichts
      await b.klick(`#libliste tr:nth-child(${i + 1}) td`); await warte(900);
      return i;
    };
    const stoppe7 = async () => { await fetch(URL + 'vorhoeren', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ aktion: 'stopp' }) }); await warte(700); };   // der Poll der Seite räumt stz.hoert ab
    // Ein Track braucht Sekunden bis zum Ton (der Vorhörer dekodiert die ganze Datei): warten, bis er spielt, nicht eine feste Zeit
    const warteSpielt7 = async (bed = () => true, ms = 40000) => { const t0 = Date.now(); let z; while (Date.now() - t0 < ms) { z = await stand7(); if (z.spielt && bed(z)) return z; await warte(150); } return z; };
    const kopf = await stand7();
    await waehle7('oneshot'); await stoppe7();
    if (!kopf.kopfhoerer) erwarte(/\/vorhoeren$/, 409);       // ohne Cue-Kante der erwartete Weg
    await leertaste(); await warte(300);
    const s = await stand7();
    await bild7('sample-vorhoeren');
    if (kopf.kopfhoerer) {
      pruefe(s.typ === 'oneshot' && s.dauer_s > 0 && (s.spielt === true || s.s >= s.dauer_s - 0.1), `Leertaste: das Sample lief einmal (${JSON.stringify(s)})`);
      // Review S7 M4: die Wege in den Master WEIT AUF, Master bleibt trotzdem still (sonst bestünde die Messung auch ohne S7)
      for (const pfad of ['erz/8/fader', 'erz/8/send/2']) {
        const o = await (await fetch(URL + 'regler', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pfad, nach: 0, takte: 0, ab: 'jetzt' }) })).json();
        pruefe(!o.fehler, `${pfad} auf 0 dB: ${JSON.stringify(o)}`);
      }
      await warte(600);
      // Das Sample ist kurz: für die Pegelmessung ein Loop (läuft, bis gestoppt wird)
      await waehle7('loop'); await stoppe7(); await leertaste(); await warte(1500);
      const sl = await stand7(); pruefe(sl.spielt === true && sl.typ === 'loop', `Loop spielt geloopt (${JSON.stringify(sl)})`);
      const p = await (await fetch(URL + 'pegel?sek=1')).json();
      const pegel = { master_db: p.kanaele.master.max_db, cue_db: p.kanaele.cue.max_db };
      console.log(`PEGEL ${JSON.stringify(pegel)}`);
      pruefe(pegel.master_db <= -120, `Master still beim Vorhören (Fader und Send offen): ${pegel.master_db} dB`);
      pruefe(pegel.cue_db > -80, `Cue hört: ${pegel.cue_db} dB`);
      if (process.env.PROBE_PEGEL) (await import('node:fs')).writeFileSync(process.env.PROBE_PEGEL, JSON.stringify({ ...pegel, fader: 'erz/8/fader 0 dB', send: 'erz/8/send/2 0 dB', loop: sl, zeit: new Date().toISOString() }, null, 1));
      const nach = (await stand7()).s; await warte(700);
      pruefe(Math.abs((await stand7()).s - nach) > 0.2 || sl.dauer_s < 1.5, 'Position läuft');
      // Leertaste auf derselben Zeile stoppt
      await leertaste(); await warte(500);
      pruefe((await stand7()).spielt === false, 'Leertaste: stoppt');
      // Track: beginnt bei 25 %, ←/→ springen, Position läuft in der Detail-Welle mit
      await waehle7('track'); await stoppe7(); await leertaste(); await warteSpielt7((z) => z.typ === 'track'); await warte(1000);
      const st = await stand7();
      pruefe(st.spielt === true && st.typ === 'track' && st.s >= st.dauer_s * 0.25 - 0.1 && st.s < st.dauer_s * 0.25 + 3, `Track beginnt bei 25 % (${st.s?.toFixed(2)} s von ${st.dauer_s})`);
      const welle = async () => b.werte(`document.querySelector('#st-detail canvas.st-welle')?.toDataURL().length ?? 0`);
      const [wOk] = await (async () => { const t0 = Date.now(); while (Date.now() - t0 < 30000) { if (await welle()) return [true]; await warte(200); } return [false]; })();
      pruefe(wOk, 'Detail-Welle ist da');
      const w1 = await b.werte(`document.querySelector('#st-detail canvas.st-welle')?.toDataURL()`); await warte(1200);
      const w2 = await b.werte(`document.querySelector('#st-detail canvas.st-welle')?.toDataURL()`);
      pruefe(w1 !== w2, 'Position läuft in der Detail-Welle mit (Bild ändert sich)');
      await bild7('track-welle');
      const vor = (await stand7()).s; await taste7('ArrowRight'); await warte(500);
      const nachR = (await stand7()).s;
      pruefe(nachR > vor + 5, `→ springt vor (${vor.toFixed(1)} → ${nachR.toFixed(1)} s)`);
      await taste7('ArrowLeft'); await warte(500);
      pruefe((await stand7()).s < nachR - 5, `← springt zurück (${(await stand7()).s.toFixed(1)} s)`);
      // Wechsel der Wahl während des Hörens: die neue Zeile spielt sofort
      const shaVor = (await stand7()).sha;
      await taste7('ArrowDown');
      const wechsel = await warteSpielt7((z) => z.sha !== shaVor);
      pruefe(wechsel.spielt === true && wechsel.sha !== shaVor, `↓ während des Hörens: die nächste Zeile spielt (${wechsel.sha?.slice(0, 8)} statt ${shaVor?.slice(0, 8)})`);
      // Kopfhörer ab: das Gerät verschwindet wirklich (die stumme Senke dieser Prüfinstanz wird entladen; eine einzelne Kante löst der
      // Selbst-Wächter des Kerns binnen 0,4 s wieder). Meldung, das Vorhören hält an. Danach Senke zurück, der Wächter verbindet neu.
      const inst = process.env.CYPHERDJ_INSTANZ ?? '';
      const senke = `cypher_stumm-${inst}`;
      const { execFileSync } = await import('node:child_process');
      pruefe(inst !== '' && /^[a-f]$/.test(inst), `Prüfinstanz ${inst} (nur die eigene stumme Senke wird angefasst, nie ein echtes Gerät)`);
      const modul = execFileSync('pactl', ['list', 'short', 'modules']).toString().split('\n').map((z) => z.split('\t')).find((z) => z[1] === 'module-null-sink' && (z[2] ?? '').includes(`sink_name=${senke}`));
      pruefe(!!modul, `Senke ${senke} als Modul gefunden (${modul?.[0]})`);
      if (modul && inst) {
        try {
          execFileSync('pactl', ['unload-module', modul[0]]); await warte(2200);
          pruefe(/Headphones not connected/.test(await meldung7()), `Kopfhörer ab: Meldung (${await meldung7()})`);
          pruefe((await stand7()).spielt === false, 'Kopfhörer ab: das Vorhören hält an');
          await bild7('kopfhoerer-ab');
          await leertaste(); await warte(1200);
          pruefe(/Headphones not connected/.test(await meldung7()), 'Leertaste ohne Kopfhörer: dieselbe Meldung');
        } finally {
          execFileSync('pactl', ['load-module', 'module-null-sink', `sink_name=${senke}`, 'channels=4', 'channel_map=front-left,front-right,rear-left,rear-right', `sink_properties=node.description=${senke}`]);
        }
        const t0 = Date.now();
        while (Date.now() - t0 < 20000 && !(await (await fetch(URL + 'vorhoeren')).json()).kopfhoerer) await warte(300);
        pruefe((await stand7()).kopfhoerer === true, `Kopfhörer wieder da (Wächter verband nach ${Date.now() - t0} ms)`);
        await leertaste();
        pruefe((await warteSpielt7()).spielt === true, 'Kopfhörer wieder da: Leertaste spielt wieder');
      }
      erwarte(/\/vorhoeren$/, 409);                           // die Probe löst die Kante absichtlich (kein_kopfhoerer), das Ende von „Leertaste ohne Kopfhörer"
      await stoppe7();                                          // die Probe hinterlässt nichts, was weiterspielt
    } else pruefe(/Headphones not connected/.test(await b.werte('document.querySelector("#meldung").textContent')), 'Meldung ohne Kopfhörer');
    if (kopf.kopfhoerer) {
      // Ableton-geschützt: Meldung, nichts spielt
      await b.klick('[data-typ="oneshot"]'); await warte(900);
      const live = await b.werte(`[...document.querySelectorAll('#libliste tr')].findIndex((tr) => tr.textContent.includes('Live only'))`);
      pruefe(live >= 0, 'eine Live-only-Zeile unter den Samples gefunden');
      if (live >= 0) {
        erwarte(/\/vorhoeren$/, 409);
        await b.werte(`document.querySelectorAll('#libliste tr')[${live}].scrollIntoView({ block: 'center' }); 1`);
        await b.klick(`#libliste tr:nth-child(${live + 1}) td`); await warte(700); await leertaste(); await warte(900);
        pruefe(/Ableton Live only/.test(await meldung7()), `Live only: Meldung (${await meldung7()})`);
        pruefe((await stand7()).spielt === false, 'Live only: nichts spielt');
        await bild7('live-only');
      }
    }
  }
  pruefe((await b.werte('document.documentElement.scrollWidth <= innerWidth')) === true, 'kein Querscrollen');
  konsolePruefen();
} finally { await b.zu(); }
process.exit(fehl ? 1 : 0);
