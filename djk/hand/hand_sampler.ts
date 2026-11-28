// Moved unchanged out of hand.ts: the module blend, sampler, patch field, tag and import tools of the tool table.
import path from 'node:path';
import { type Json, http, httpGrund, zahl, deck, raster, isObj, type Werkzeug, fehlerAntwort, mitRev } from './hand_core.ts';

export const WERKZEUGE_SAMPLER: Werkzeug[] = [
  // Live modules task 8 (decisions 7, 16): the blend of one stem of a module between the original and the new instrument path
  { name: 'modul_blend', description: 'Blend one stem of a live module between the original stem and its new instrument path (Drums: drums-909, Bass: synth-neuro, '
    + 'with the MIDI that was extracted from the stem). wert 0..1: 0 = the original alone, 1 = the new path alone, in between an equal-power crossfade of the two track faders. '
    + 'takte (0, 1, 2, 4, 8, 16; default 0): over that many bars on the core clock, answered at once with zustand rampe (the end follows in GET /modul/stand under blend); '
    + '0 sets it now, one undo step. Only stems with a new path can be blended. Answers {slot, stem, gruppe_id, wert, takte, zustand, rev, fader_db {original, neu}}. '
    + 'Refused: kein_neuer_pfad (409, that stem has no new path: Other, Vocals, Guitar and Piano never do, Drums and Bass only once their MIDI is in; GET /modul/stand shows midi_fehler when it failed), '
    + 'slot_leer, kein_liveprojekt, rampe_laeuft, ki_gestoppt (Stop Cypher), argument_ungueltig.',
    inputSchema: { type: 'object', required: ['slot', 'stem', 'wert'], properties: { slot: { enum: ['A', 'B', 'C', 'D', 1, 2, 3, 4], description: 'place A to D or 1 to 4 (A deck/1, B deck/2, C pad/1, D pad/2)' },
      stem: { type: 'string', enum: ['drums', 'bass', 'other', 'vocals', 'guitar', 'piano'] }, wert: zahl('0 = original, 1 = new path', { minimum: 0, maximum: 1 }),
      takte: { type: 'integer', enum: [0, 1, 2, 4, 8, 16], description: 'bars of the blend ramp (default 0 = at once)' } } },
    lauf: (p) => http('POST', '/modul/blend', { slot: p.slot, stem: p.stem, wert: p.wert, ...(p.takte === undefined ? {} : { takte: p.takte }) }) },
  // Sampler A1 task 9: the cut store and SLICE TO TRACK of the page server (routes /sampler/*, areas/sampler/area.ts). Plans B and C add `kit` and `ton` to the aktion enum (C: `ton`, below).
  { name: 'sampler', description: 'Sampler: cut a library loop or the audio of a workbench module into slices, and put the slices on a workbench track. '
    + 'aktion quellen = what can be cut, {loops: [{name, beats}], module: [{id, titel, beats, bpm, audio: [{stem, name}]}]} (stem null = the module\'s Loop track, else drums, bass, other, vocals, guitar, piano). '
    + 'liste = the cuts that exist, {schnitte: [{id, name, quelle, bpm, beats, scheiben, geraet}]}. '
    + 'neu {quelle, name?, scheiben?} = make a cut and answer {schnitt}: quelle {art: loop, ref: <loop name from quellen>} or {art: modul, ref: <module id>, stem?}; scheiben (4, 8, 16, 32 or 64 slices) default: the finest of 1/16, 1/8, 1/4, 1/2, 1 beat with at most 64 slices; the slices are equal steps of the beat grid. '
    + 'lies {id} = the cut as text: a header line (id, name, source, tempo, beats, slice count) and one line per slice with its number, start and length in beats, strength and grid distance (the answer is that text, not JSON). '
    + 'spur {id} or {quelle, name?, scheiben?} = SLICE TO TRACK: a new instrument track with a generated sampler device that plays the cut in its original order (with quelle the cut is made first and removed again if the track is refused); answers {rev, projekt, spur_id, schnitt_id, fit}. '
    + 'The tempo of the project is fitted to the cut on the SPEED knob when it is within 0.25x to 4x (fit is that value, else null and SPEED stays at 1). '
    + 'kit {id, nummern, namen?, kit?} = a drum kit of the slices nummern (numbers from 1, as in lies) of the cut id, written into the kit folder: every slice becomes one sound, in ascending slice order from note 36 whatever the order of nummern (the lowest slice number gets note 36, the next 37 ...; a number listed twice is refused, and namen follow their numbers), '
    + 'the slice as it is with a 5 ms fade at its end; answers {kit, klaenge: [{scheibe, note, name, datei, frames}]} (scheibe is 0-based) and the text "kit <name>: bd:0 = slice 1 (note 36), sd:0 = slice 3 (note 37)". '
    + 'namen (one bank per number, a-z, 0-9 and _, starting with a letter, at most 16 characters, e.g. bd, sd, hh, cp, perc) are the banks; absent, every bank is proposed from the low/mid/high balance of the first 100 ms of the slice (bd, sd, hh or perc). '
    + 'Numbers are given per bank in slice order (banks bd, sd, bd become bd:0, sd:0, bd:1), so write the bank only, never bd:1. kit is the kit name (a-z, 0-9, _ and -, 1 to 32 characters); absent, it is made from the name of the cut. '
    + 'A slice may be at most 10 s (klang_zu_lang); an existing kit name is refused (kit_vorhanden) and nothing is written. To place the kit on a track: proj_aendern werkbank_spur_neu {name, geraet: {art: \'intern\', name: \'kit\', kit}}. '
    + 'To play it from a Strudel text: proj_muster on that track with s("bd sd"); bd:1 is the second sound of the bank bd. The live DRUMS stream does not see a new kit: its base kit is fixed when the studio starts. '
    + 'ton {id, von, bis?, grund?, name?, spur?} = TONE: slice von (or the run von..bis of neighbouring slices, numbered from 1) of the cut id becomes a playable tone: a generated 8-voice sampler device that plays that piece at the pitch of the note you play, relative to its root note. grund = the root, a MIDI note 16 to 95 (60 = C3), by default proposed from a pitch detection, else from the key of the cut, else C3. spur (default true) also puts it on a new NOTE track of the open workbench module with one note at the root (one undo step; kein_werkbank and werkbank_voll as for spur); spur false only makes the tone; name is the name of the tone and of that track (default made from the cut and the slices). The answer text names the device (graph), root and how it was found, the detected note and its confidence (0 to 1). '
    + 'Numbering: slices are numbered from 1 in every text and grid; slice n plays on note n - 1 and reversed on note n + 63 (note 0..63 forward, 64..127 reversed). '
    + 'spur needs an open workbench module (kein_werkbank otherwise) with a free instrument slot (werkbank_voll); it changes the project in one undo step. '
    + 'Patterns of slice notes (a new order, repeats, reversed hits) are written with proj_aendern (noten_neu, noten_aendern) on that track, with ton = slice number - 1 (reversed: + 64). '
    + 'Names that look alike: scheiben (count of slices of a new cut, with neu and spur) is not scheibe (marke: the number of one slice, from 2) and not the 0-based scheibe in the kit answer; von and bis (ton) and nummern (kit) are slice numbers from 1; the field spur (ton: also make a track) is not the aktion spur and not spur_id (ursprung: the id of an existing track). '
    + 'Sampler A2: methode anschlag (neu, spur with quelle, schneiden) cuts at the hits found in the audio instead of the grid; empfindlichkeit 0..1 (default 0.5) sets how many are found; no hit at all is refused keine_anschlaege (422) and nothing is written. '
    + 'Every slice of a cut has a strength 0..1 (the hit at its marker; 0 = no hit there) and a grid distance in beats (to the nearest 1/16 step; 0 = on the grid), both shown by lies and by the answers below. '
    + 'schneiden {id, methode, scheiben?, empfindlichkeit?} = cut the same audio again under the same id (the cut, its generated device and its tracks follow); the patterns keep their slice numbers; answers the route text and then the cut as text. '
    + 'marke {id, art, scheibe?, beat?, einrasten?} = edit one marker of the cut and answer the route text and then the cut as text: art schieben moves the marker where slice scheibe starts to beat (scheibe 4 moves the marker between slices 3 and 4; scheibe 2 is marker 1, so the refusal marke_unbekannt, which counts markers 1..n - 1, names marker k for scheibe k + 1); neu adds a marker at beat and splits the slice there; weg removes the marker where slice scheibe starts and merges it with the slice before. '
    + 'The cut then has methode hand. Moving a marker never changes a pattern; adding or removing one renumbers the patterns of the open module that play this cut in one undo step (a split slice keeps its hits on its first part), modules that are not open keep their numbers; an undo in PRODUCTION reverts the renumbering only, not the marker. '
    + 'Refused: marke_unbekannt (404, no such marker), marke_zu_nah (409, a slice under 4 frames or two markers on one frame), zu_viele_scheiben (409, a cut has 64 slices at most). '
    + 'liste shows the cuts that exist, each with the name of its device (geraet); loeschen {id} = delete that cut together with its tones, and loeschen {ton_graph} = delete only one tone (ton_graph is the graph name of the tone, as the answer of ton names it; graphen lists it as an instrument). Both answer {ok: true}. A cut or tone that a track of the open project, a stored project or a module still plays is refused schnitt_in_gebrauch or ton_in_gebrauch (409) and nothing is deleted: the detail of the refusal lists fundstellen (which project, module or track uses it) and spuren, so remove the track there first and then delete again; ton_unbekannt (404) for a tone that does not exist. '
    + 'ursprung {spur_id} = write the original order again on that track: its first MIDI clip gets one note per slice, in cut order (the old notes of that clip are replaced, one undo step); needs an open workbench module; refused spur_unbekannt (404), kein_schnitt_geraet (409, the track does not play a cut), kein_clip (409). '
    + 'Sample player: dateien {wurzel?, ordner?, suche?} = the sample files of the sample roots (GET /sampler/dateien): without wurzel it lists the roots, {wurzeln: [{name, fehlt?}]}; with wurzel it lists that folder (ordner = a path inside the root, default the root itself), {wurzel, ordner, ordner_liste, ordner_zahl, dateien, instrument?, mehr?}, and instrument is present when the folder reads as a multisample instrument; with suche (words that all occur in the path) it searches below ordner instead, {dateien, mehr?} (at most 300 hits). ordner and suche need wurzel. '
    + 'instrument {wurzel, ordner?, name?, release?, spur?} = INSTRUMENT FROM FILES (POST /sampler/instrument): the audio files of that folder become a playable multisample instrument (a generated sampler device, one zone per file or pitch), answers the text of the instrument and the JSON; release true also builds the release sounds (default false); spur true also puts the instrument on a new NOTE track of the open workbench module (one undo step; kein_projekt, kein_werkbank, werkbank_voll; default false: only the instrument is made). Stop Cypher is refused (409 ki_gestoppt). '
    + 'Refused: argument_ungueltig (400, also locally without a request: spur needs exactly one of id and quelle, lies needs id, neu needs quelle, kit needs id and nummern from 1 and namen of the same length when given, ton needs id and von from 1, bis not before von, grund 16 to 95; schneiden needs id and methode raster or anschlag; marke schieben and weg need scheibe from 2, schieben and neu need beat, weg takes no beat; ursprung needs spur_id; loeschen needs exactly one of id and ton_graph; scheiben only with raster, empfindlichkeit only with anschlag), aktion_unbekannt, schnitt_unbekannt (404), kein_projekt, kein_werkbank, werkbank_voll, ki_gestoppt (Stop Cypher is set: wait for Andreas); the kit refusals klang_zu_lang (400) and kit_vorhanden (409); the ton refusals toene_voll (409) and ton_in_gebrauch (409, also from loeschen); the cut refusals zu_lang, kein_raster, quelle_unbekannt and the rest answer with their reason and an English text.',
    inputSchema: { type: 'object', required: ['aktion'], properties: {
      aktion: { type: 'string', enum: ['quellen', 'liste', 'neu', 'lies', 'spur', 'kit', 'ton', 'schneiden', 'marke', 'ursprung', 'loeschen', 'dateien', 'instrument'] },
      id: { type: 'string', description: 'cut id from neu or liste (lies, spur, kit, ton, schneiden, marke, loeschen)' },
      quelle: { type: 'object', required: ['art', 'ref'], description: 'what to cut (neu, spur): a library loop or the audio of a module',
        properties: { art: { type: 'string', enum: ['loop', 'modul'] }, ref: { type: 'string', description: 'loop name (art loop) or module id (art modul), from quellen' },
          stem: { type: 'string', description: 'art modul only: drums, bass, other, vocals, guitar or piano; absent = the module\'s Loop track' } } },
      name: { type: 'string', description: 'neu, spur with quelle: name of the cut and the track, default the source name; ton: name of the tone (its device graph) and of the NOTE track, default made from the cut and the slices' },
      scheiben: { type: 'integer', enum: [4, 8, 16, 32, 64], description: 'number of slices (neu, spur with quelle); default: the finest grid step with at most 64 slices' },
      nummern: { type: 'array', items: { type: 'integer', minimum: 1 }, description: 'kit: the slice numbers from 1 (as in lies) that become the sounds of the kit, at most 92' },
      namen: { type: 'array', items: { type: 'string' }, description: 'kit: one bank per number (bd, sd, hh, cp, perc ...; the bank only, the number follows from the slice order); absent: proposed from the sound' },
      kit: { type: 'string', description: 'kit: the kit name (a-z, 0-9, _ and -, 1 to 32 characters); absent: made from the name of the cut' },
      von: { type: 'integer', minimum: 1, description: 'ton: the first slice, numbered from 1' },
      bis: { type: 'integer', minimum: 1, description: 'ton: the last slice of a run of neighbouring slices (default: von)' },
      grund: { type: 'integer', minimum: 16, maximum: 95, description: 'ton: root note, MIDI 16 to 95 (60 = C3); default: proposed' },
      spur: { type: 'boolean', description: 'ton: also put the tone on a new NOTE track (default true); instrument: also put the instrument on a new NOTE track (default false); this is a flag of the ton action and has nothing to do with the aktion spur (SLICE TO TRACK) or with spur_id' },
      // Sampler A2 task 9
      methode: { type: 'string', enum: ['raster', 'anschlag'], description: 'neu, spur with quelle, schneiden: raster = equal steps of the beat grid, anschlag = one slice per hit found in the audio (the count follows the hits). hand is never given: it is the state of a cut after marker edits' },
      empfindlichkeit: { type: 'number', minimum: 0, maximum: 1, description: 'with methode anschlag only: hit sensitivity 0..1 (default 0.5; higher finds more hits)' },
      art: { type: 'string', enum: ['schieben', 'neu', 'weg'], description: 'marke: schieben = move a marker (scheibe, beat), neu = add a marker (beat), weg = remove a marker (scheibe)' },
      scheibe: { type: 'integer', minimum: 2, description: 'marke schieben and weg: the number (from 1, as in lies) of the slice that starts at the marker, 2 to the slice count; slice 1 starts at 0 and has no marker' },
      beat: { type: 'number', description: 'marke schieben and neu: the position in beats from the start of the cut' },
      einrasten: { type: 'boolean', description: 'marke schieben and neu: snap to the nearest hit or 1/16 step within 1/16 beat (default true)' },
      spur_id: { type: 'string', description: 'ursprung: the id of a track of the open project that plays a cut (from proj_lage)' },
      wurzel: { type: 'string', description: 'dateien, instrument: the name of a sample root (from dateien without wurzel)' },
      ordner: { type: 'string', description: 'dateien, instrument: a folder path inside the root, default the root itself' },
      suche: { type: 'string', description: 'dateien: words that all occur in the path of a file; the search runs below ordner' },
      release: { type: 'boolean', description: 'instrument: also build the release sounds (default false)' },
      ton_graph: { type: 'string', description: 'loeschen: the graph name of the tone to delete (instead of id, which deletes a whole cut); sent to the server as graph' } } },
    // the low-level server does not check the schema: a wrong shape is refused here without a request
    lauf: async (p) => {
      const nein = (text: string) => fehlerAntwort(400, 'argument_ungueltig', text);
      const hat = (k: string) => Object.prototype.hasOwnProperty.call(p, k) && p[k] !== undefined;
      if (p.aktion === 'quellen') return http('GET', '/sampler/quellen');
      if (p.aktion === 'liste') return http('GET', '/sampler/liste');
      if (p.aktion === 'kit') {
        // slices from 1 as in lies; the server counts from 0
        if (typeof p.id !== 'string' || p.id === '') return nein('id must be a non-empty string (the id of a cut, from neu or liste)');
        const n = p.nummern;
        if (!Array.isArray(n) || n.length === 0 || n.some((x) => typeof x !== 'number' || !Number.isInteger(x) || x < 1)) return nein('nummern must be a non-empty list of slice numbers from 1');
        if (hat('namen') && (!Array.isArray(p.namen) || p.namen.length !== n.length || p.namen.some((x) => typeof x !== 'string'))) {
          return nein('namen must be a list of strings, one bank per number in nummern');
        }
        if (hat('kit') && typeof p.kit !== 'string') return nein('kit must be a string (the kit name)');
        const r = await http('POST', '/sampler/kit', { id: p.id, scheiben: (n as number[]).map((x) => x - 1), ...(hat('namen') ? { banken: p.namen } : {}), ...(hat('kit') ? { kit: p.kit } : {}) });
        if (r.code !== 200 || !Array.isArray(r.j.klaenge)) return r;
        const zeilen = (r.j.klaenge as Json[]).map((k) => `${String(k.name)} = slice ${Number(k.scheibe) + 1} (note ${String(k.note)})`);
        return { ...r, text: `kit ${String(r.j.kit)}: ${zeilen.join(', ')}\n${JSON.stringify(r.j)}` };
      }
      // Sampler A2 task 9: methode, scheiben and empfindlichkeit as the routes take them (the routes refuse the same; this saves the request)
      const optionenFehler = (): { code: number; j: Json } | null => {
        if (hat('methode') && p.methode !== 'raster' && p.methode !== 'anschlag') return nein('methode must be raster or anschlag');
        if (hat('scheiben') && p.methode === 'anschlag') return nein('scheiben: only with methode raster; the hits decide the count');
        if (hat('empfindlichkeit')) {
          if (p.methode !== 'anschlag') return nein('empfindlichkeit: only with methode anschlag');
          if (typeof p.empfindlichkeit !== 'number' || !(p.empfindlichkeit >= 0 && p.empfindlichkeit <= 1)) return nein('empfindlichkeit must be a number from 0 to 1');
        }
        return null;
      };
      // the answer text of a cut change, then the cut as text (the cut text is left out when it cannot be read)
      const mitSchnittText = async (r: { code: number; j: Json }, id: string): Promise<{ code: number; j: Json; text?: string }> => {
        if (r.code !== 200 || typeof r.j.text !== 'string') return r;
        const g = await http('GET', `/sampler/schnitt?id=${encodeURIComponent(id)}&format=text`);
        return { ...r, text: g.code === 200 && typeof g.j.text === 'string' ? `${r.j.text}\n${g.j.text}` : r.j.text };
      };
      if (p.aktion === 'schneiden') {
        if (typeof p.id !== 'string' || p.id === '') return nein('id must be a non-empty string (the id of a cut, from neu or liste)');
        if (p.methode !== 'raster' && p.methode !== 'anschlag') return nein('methode must be raster or anschlag');
        if (hat('scheiben') && ![4, 8, 16, 32, 64].includes(p.scheiben as number)) return nein('scheiben must be 4, 8, 16, 32 or 64');
        const f = optionenFehler();
        if (f) return f;
        return mitSchnittText(await http('POST', '/sampler/neu_schneiden', { id: p.id, methode: p.methode, ...(hat('scheiben') ? { scheiben: p.scheiben } : {}), ...(hat('empfindlichkeit') ? { empfindlichkeit: p.empfindlichkeit } : {}) }), p.id);
      }
      if (p.aktion === 'marke') {
        if (typeof p.id !== 'string' || p.id === '') return nein('id must be a non-empty string (the id of a cut, from neu or liste)');
        if (p.art !== 'schieben' && p.art !== 'neu' && p.art !== 'weg') return nein('art must be schieben, neu or weg');
        if (hat('einrasten') && typeof p.einrasten !== 'boolean') return nein('einrasten must be true or false');
        if (hat('beat') && (typeof p.beat !== 'number' || !Number.isFinite(p.beat))) return nein('beat must be a number (beats from the start of the cut)');
        if (hat('scheibe') && (typeof p.scheibe !== 'number' || !Number.isInteger(p.scheibe) || p.scheibe < 2)) return nein('scheibe must be an integer from 2 (the number of the slice that starts at the marker, as in lies)');
        if (p.art === 'neu') {
          if (hat('scheibe')) return nein('scheibe: only for schieben and weg; neu takes the position in beat');
          if (!hat('beat')) return nein('neu needs beat (where the new marker goes)');
        } else if (!hat('scheibe')) return nein(`${p.art} needs scheibe (the number of the slice that starts at the marker, from 2)`);
        else if (p.art === 'schieben' && !hat('beat')) return nein('schieben needs beat (where the marker goes)');
        else if (p.art === 'weg' && (hat('beat') || hat('einrasten'))) return nein('weg takes no beat and no einrasten');
        // slices are numbered from 1 in the tool; the server counts the bound index: the marker where slice n starts is bound n - 1
        const k = {
          id: p.id, art: p.art,
          ...(hat('scheibe') ? { marke: (p.scheibe as number) - 1 } : {}),
          ...(hat('beat') ? { beat: p.beat } : {}),
          ...(hat('einrasten') ? { einrasten: p.einrasten } : {}),
        };
        return mitSchnittText(await http('POST', '/sampler/marke', k), p.id);
      }
      if (p.aktion === 'loeschen') {
        // Sampler fix round 3: a cut (with its tones) by id, or one tone by its graph name (the route field is `graph`)
        if (hat('id') === hat('ton_graph')) return nein('loeschen needs exactly one of id (a cut) and ton_graph (a tone)');
        const wer = hat('id') ? p.id : p.ton_graph;
        if (typeof wer !== 'string' || wer === '') return nein(`${hat('id') ? 'id' : 'ton_graph'} must be a non-empty string`);
        const r = await http('POST', hat('id') ? '/sampler/loeschen' : '/sampler/ton/loeschen', hat('id') ? { id: wer } : { graph: wer });
        // the refusal lists where the device is still used: the hand's error form carries `detail`, so the places go there
        if (r.code >= 400 && (Array.isArray(r.j.fundstellen) || Array.isArray(r.j.spuren))) {
          return { code: r.code, j: { fehler: r.j.fehler, text: r.j.text, detail: { fundstellen: r.j.fundstellen, spuren: r.j.spuren } } };
        }
        return r;
      }
      if (p.aktion === 'ursprung') {
        if (typeof p.spur_id !== 'string' || p.spur_id === '') return nein('spur_id must be a non-empty string (the id of a track of the open project)');
        const r = await http('POST', '/sampler/ursprung', { spur_id: p.spur_id });
        return r.code === 200 && typeof r.j.text === 'string' ? { ...r, text: r.j.text } : r;
      }
      // sample player: the file list and the instrument of a folder. Fields that belong to no call of the action are refused, not dropped
      const fremdFelder = (erlaubt: string[]): { code: number; j: Json } | null => {
        const f = Object.keys(p).filter((k) => p[k] !== undefined && k !== 'aktion' && !erlaubt.includes(k));
        return f.length > 0 ? nein(`${f.join(', ')}: not a field of ${String(p.aktion)} (it takes ${erlaubt.join(', ')})`) : null;
      };
      const textOk = (k: string): boolean => !hat(k) || (typeof p[k] === 'string' && (p[k] as string).trim() !== '');
      if (p.aktion === 'dateien') {
        const f = fremdFelder(['wurzel', 'ordner', 'suche']);
        if (f) return f;
        if (!textOk('wurzel') || !textOk('suche') || (hat('ordner') && typeof p.ordner !== 'string')) return nein('wurzel and suche must be non-empty strings, ordner a string (a folder path inside the root)');
        if (!hat('wurzel') && (hat('ordner') || hat('suche'))) return nein('ordner and suche need wurzel (the name of a sample root, from dateien without wurzel)');
        const q = [...(hat('wurzel') ? [`wurzel=${encodeURIComponent(p.wurzel as string)}`] : []), ...(hat('ordner') ? [`ordner=${encodeURIComponent(p.ordner as string)}`] : []),
          ...(hat('suche') ? [`suche=${encodeURIComponent(p.suche as string)}`] : [])];
        return http('GET', `/sampler/dateien${q.length > 0 ? `?${q.join('&')}` : ''}`);
      }
      if (p.aktion === 'instrument') {
        const f = fremdFelder(['wurzel', 'ordner', 'name', 'release', 'spur']);
        if (f) return f;
        if (typeof p.wurzel !== 'string' || p.wurzel === '') return nein('wurzel must be a non-empty string (the name of a sample root, from dateien without wurzel)');
        if (hat('ordner') && typeof p.ordner !== 'string') return nein('ordner must be a string (a folder path inside the root)');
        if (!textOk('name')) return nein('name must be a non-empty string');
        if (hat('release') && typeof p.release !== 'boolean') return nein('release must be true or false');
        if (hat('spur') && typeof p.spur !== 'boolean') return nein('spur must be true or false');
        const r = await http('POST', '/sampler/instrument', { wurzel: p.wurzel, ...(hat('ordner') ? { ordner: p.ordner } : {}), ...(hat('name') ? { name: p.name } : {}),
          ...(hat('release') ? { release: p.release } : {}), ...(hat('spur') ? { spur: p.spur } : {}) });
        return r.code === 200 && typeof r.j.text === 'string' ? { ...r, text: r.j.text } : r;
      }
      if (p.aktion !== 'neu' && p.aktion !== 'lies' && p.aktion !== 'spur' && p.aktion !== 'ton') return fehlerAntwort(400, 'aktion_unbekannt', 'aktion is one of quellen, liste, neu, lies, spur, kit, ton, schneiden, marke, ursprung, loeschen, dateien, instrument');
      const idOk = (): boolean => typeof p.id === 'string' && p.id !== '';
      if (p.aktion === 'lies') {
        if (!idOk()) return nein('id must be a non-empty string (the id of a cut, from neu or liste)');
        const r = await http('GET', `/sampler/schnitt?id=${encodeURIComponent(p.id as string)}&format=text`);
        return r.code === 200 && typeof r.j.text === 'string' ? { ...r, text: r.j.text } : r;
      }
      if (p.aktion === 'ton') {   // plan C: slice numbers from 1 here, 0-based on the page server
        const ganz = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x);
        const fremd = Object.keys(p).filter((k) => p[k] !== undefined && !['aktion', 'id', 'von', 'bis', 'grund', 'name', 'spur'].includes(k));
        if (fremd.length > 0) return nein(`${fremd.join(', ')}: not a field of ton (ton takes id, von, bis, grund, name and spur)`);
        if (!idOk()) return nein('id must be a non-empty string (the id of a cut, from neu or liste)');
        if (!ganz(p.von) || p.von < 1) return nein('von must be a whole number from 1 (the first slice, numbered from 1)');
        if (hat('bis') && (!ganz(p.bis) || p.bis < p.von)) return nein('bis must be a whole number, not before von (the last slice of the run)');
        if (hat('grund') && (!ganz(p.grund) || p.grund < 16 || p.grund > 95)) return nein('grund must be a whole number 16 to 95 (a MIDI note, 60 = C3)');
        if (hat('name') && (typeof p.name !== 'string' || p.name.trim() === '')) return nein('name must be a non-empty string');
        if (hat('spur') && typeof p.spur !== 'boolean') return nein('spur must be true or false');
        const r = await http('POST', '/sampler/ton', { id: p.id, von: p.von - 1, ...(hat('bis') ? { bis: (p.bis as number) - 1 } : {}),
          ...(hat('grund') ? { grund: p.grund } : {}), ...(hat('name') ? { name: p.name } : {}), spur: hat('spur') ? p.spur : true });
        return r.code === 200 && typeof r.j.text === 'string' ? { ...r, text: r.j.text } : r;
      }
      // neu and spur: the optional name and scheiben, and the source when a cut is made
      if (hat('name') && typeof p.name !== 'string') return nein('name must be a string');
      if (hat('scheiben') && ![4, 8, 16, 32, 64].includes(p.scheiben as number)) return nein('scheiben must be 4, 8, 16, 32 or 64');
      const of = optionenFehler();
      if (of) return of;
      const mitId = p.aktion === 'spur' && hat('id');
      if (p.aktion === 'spur') {
        if (hat('id') && hat('quelle')) return nein('give id (a cut that exists) or quelle (a cut to make), not both');
        if (!hat('id') && !hat('quelle')) return nein('give id (a cut from neu or liste) or quelle (a cut to make)');
        if (mitId) {
          if (!idOk()) return nein('id must be a non-empty string (the id of a cut, from neu or liste)');
          if (hat('name') || hat('scheiben') || hat('methode') || hat('empfindlichkeit')) return nein('name, scheiben, methode and empfindlichkeit belong to a new cut: leave them out with id');
          return http('POST', '/sampler/spur', { id: p.id });
        }
      }
      const q = p.quelle as Json | undefined;
      if (!isObj(q)) return nein('quelle must be an object {art: loop | modul, ref, stem?}');
      if (q.art !== 'loop' && q.art !== 'modul') return nein('quelle.art must be loop or modul');
      if (typeof q.ref !== 'string' || q.ref === '') return nein('quelle.ref must be a non-empty string (a loop name or a module id from quellen)');
      if (q.stem !== undefined && typeof q.stem !== 'string') return nein('quelle.stem must be a string (drums, bass, other, vocals, guitar or piano)');
      const koerper = { quelle: q, ...(hat('name') ? { name: p.name } : {}), ...(hat('scheiben') ? { scheiben: p.scheiben } : {}),
        ...(hat('methode') ? { methode: p.methode } : {}), ...(hat('empfindlichkeit') ? { empfindlichkeit: p.empfindlichkeit } : {}) };
      return http('POST', p.aktion === 'neu' ? '/sampler/schnitt' : '/sampler/spur', koerper);
    } },
  // Kraken patch field task 5: the pin matrix of a Baukasten track (block `matrix`, 16 x 16, two sets A/B). Shapes of the page server: GET /proj/steckfeld, project commands geraet_stift_setzen / geraet_stifte_setzen.
  { name: 'steckfeld', description: 'Patch field (pin matrix) of a Baukasten track whose graph has a matrix block: a 16 x 16 field of 16 rows (sources) and 16 columns (destinations), two sets A and B (the instrument morphs between them), '
    + 'a pin is a weight -1..1 from one row to one column, 0 = no pin. Rows and columns have labels from the graph; the labels come from zeige. '
    + 'aktion zeige {spur_id} = both sets as lines "A  VCO 1 > Cutoff  +0.40" (set, row > column, weight), the row and column labels, and whether the track still has the graph\'s default pins or its own. '
    + 'setze {spur_id, zeile, spalte, wert, satz?} = put a pin (geraet_stift_setzen; sounds at once while a note plays, one undo step per drag of the same pin). loesche {spur_id, zeile, spalte, satz?} = remove one pin (wert 0). '
    + 'leere {spur_id, satz?} = remove every pin of one set. kopiere {spur_id} = replace set B by a copy of set A. '
    + 'zeile and spalte: a label (case-insensitive, exact, from zeige) or an index 1..16 (a number, or a string of digits); satz is A or B (default A); wert -1..1. '
    + 'A track that has no pins of its own gets the graph defaults written into its list first, so the first setze keeps them. Answers of the writes: {rev, ...} of proj_aendern. '
    + 'Refused locally without a write request: argument_ungueltig (unknown or ambiguous label, index outside 1..16, wert outside -1..1, bad satz, missing argument). '
    + 'Refused by the server: spur_unbekannt, geraet_falsch (not a Baukasten track), kein_steckfeld (the graph has no matrix), kein_projekt, rev_veraltet, ki_gestoppt (Stop Cypher).',
    inputSchema: { type: 'object', required: ['aktion', 'spur_id'], properties: {
      aktion: { type: 'string', enum: ['zeige', 'setze', 'loesche', 'leere', 'kopiere'] },
      spur_id: { type: 'string', description: 'the id of the Baukasten track (from proj_lage)' },
      zeile: { anyOf: [{ type: 'string' }, { type: 'integer', minimum: 1, maximum: 16 }], description: 'setze, loesche: the row (source), a label from zeige or an index 1..16' },
      spalte: { anyOf: [{ type: 'string' }, { type: 'integer', minimum: 1, maximum: 16 }], description: 'setze, loesche: the column (destination), a label from zeige or an index 1..16' },
      wert: zahl('setze: the weight of the pin, -1..1 (0 removes it)', { minimum: -1, maximum: 1 }),
      satz: { type: 'string', enum: ['A', 'B'], description: 'setze, loesche, leere: the set, default A' },
      rev: { type: 'integer', minimum: 0, description: 'writes: the project revision to build on (default: the current one)' } } },
    // the low-level server does not check the schema: a wrong shape is refused here without a write request
    lauf: async (p) => {
      const nein = (text: string) => fehlerAntwort(400, 'argument_ungueltig', text);
      const aktion = p.aktion;
      if (aktion !== 'zeige' && aktion !== 'setze' && aktion !== 'loesche' && aktion !== 'leere' && aktion !== 'kopiere') return nein('aktion is one of zeige, setze, loesche, leere, kopiere');
      if (typeof p.spur_id !== 'string' || p.spur_id === '') return nein('spur_id must be a non-empty string (the id of a Baukasten track)');
      if (p.satz !== undefined && p.satz !== 'A' && p.satz !== 'B') return nein('satz must be A or B');
      const satz = p.satz === 'B' ? 1 : 0;
      const holen = (): Promise<{ code: number; j: Json }> => http('GET', `/proj/steckfeld?spur_id=${encodeURIComponent(p.spur_id as string)}`);
      const schreibe = (label: string, befehl: Json) => mitRev(p, '/proj/aendern', { label, befehle: [befehl] });
      const SATZ = ['A', 'B'];
      const bez = (l: unknown, i: number, was: string): string => (Array.isArray(l) && typeof l[i] === 'string' && l[i] !== '' ? (l[i] as string) : `${was} ${i + 1}`);
      if (aktion === 'zeige') {
        const r = await holen();
        if (r.code !== 200) return r;
        const j = r.j;
        const stifte = (Array.isArray(j.stifte) ? j.stifte : []) as number[][];
        const zeilen = Array.isArray(j.zeilen) ? j.zeilen : [], spalten = Array.isArray(j.spalten) ? j.spalten : [];
        const kopf = `Patch field of ${String(j.spur_id)} (graph ${String(j.graph)}, rev ${String(j.rev)}): ${j.eigene === false ? 'graph defaults, no pins of its own yet' : 'own pins'}`;
        const zeilenText: string[] = [];
        for (let s = 0; s < 2; ++s) {
          const dieser = stifte.filter((x) => x[0] === s);
          if (dieser.length === 0) { zeilenText.push(`${SATZ[s]}  (no pins)`); continue; }
          for (const [, z, sp, w] of dieser) zeilenText.push(`${SATZ[s]}  ${bez(zeilen, z, 'row')} > ${bez(spalten, sp, 'column')}  ${w >= 0 ? '+' : '-'}${Math.abs(w).toFixed(2)}`);
        }
        const namen = (l: unknown[], was: string) => l.map((_, i) => bez(l, i, was)).join(', ');
        return { code: 200, j, text: [kopf, ...zeilenText, `Rows: ${namen(zeilen, 'row')}`, `Columns: ${namen(spalten, 'column')}`].join('\n') };
      }
      if (aktion === 'leere') return schreibe(`Patch field: clear set ${SATZ[satz]}`, { befehl: 'geraet_stifte_setzen', spur_id: p.spur_id, satz, stifte: [] });
      if (aktion === 'kopiere') {
        const r = await holen();
        if (r.code !== 200) return r;
        const a = ((Array.isArray(r.j.stifte) ? r.j.stifte : []) as number[][]).filter((x) => x[0] === 0).map((x) => [1, x[1], x[2], x[3]]);
        return schreibe('Patch field: copy set A to B', { befehl: 'geraet_stifte_setzen', spur_id: p.spur_id, satz: 1, stifte: a });
      }
      // setze, loesche: arguments first (no request on a bad one), then the labels (one read), then the write
      if (aktion === 'setze' && (typeof p.wert !== 'number' || !Number.isFinite(p.wert) || p.wert < -1 || p.wert > 1)) return nein('setze needs wert, a number from -1 to 1');
      const wert = aktion === 'loesche' ? 0 : (p.wert as number);
      const index = (v: unknown): number | null | undefined => {      // 0-based; null = not an index form, undefined = refused
        if (typeof v === 'number') return Number.isInteger(v) && v >= 1 && v <= 16 ? v - 1 : undefined;
        if (typeof v === 'string' && /^[0-9]+$/.test(v)) { const n = Number(v); return n >= 1 && n <= 16 ? n - 1 : undefined; }
        return typeof v === 'string' && v !== '' ? null : undefined;
      };
      const z0 = index(p.zeile), s0 = index(p.spalte);
      if (z0 === undefined) return nein('zeile must be a label from zeige or an index 1..16');
      if (s0 === undefined) return nein('spalte must be a label from zeige or an index 1..16');
      let zeile = z0, spalte = s0;
      if (zeile === null || spalte === null) {
        const r = await holen();
        if (r.code !== 200) return r;
        const finde = (v: unknown, liste: unknown, was: string): number | { fehler: string } => {
          const gesucht = String(v).toLowerCase();
          const treffer = (Array.isArray(liste) ? liste : []).map((l, i) => [String(l).toLowerCase(), i] as const).filter(([l]) => l === gesucht).map(([, i]) => i);
          if (treffer.length === 0) return { fehler: `${was} "${String(v)}" is not a label of this field; zeige lists them` };
          if (treffer.length > 1) return { fehler: `${was} "${String(v)}" is ambiguous (indices ${treffer.map((i) => i + 1).join(', ')}); use an index 1..16` };
          return treffer[0];
        };
        if (zeile === null) { const f = finde(p.zeile, r.j.zeilen, 'zeile'); if (typeof f !== 'number') return nein(f.fehler); zeile = f; }
        if (spalte === null) { const f = finde(p.spalte, r.j.spalten, 'spalte'); if (typeof f !== 'number') return nein(f.fehler); spalte = f; }
      }
      return schreibe(`Patch field: ${aktion === 'loesche' ? 'remove' : 'set'} pin ${SATZ[satz]} ${zeile + 1}/${spalte + 1}`, { befehl: 'geraet_stift_setzen', spur_id: p.spur_id, satz, zeile, spalte, wert });
    } },
  // plan 7: tags
  { name: 'tags', description: 'Tags of items (files, presets, kits, devices, projects, takes, exports, loops) are full <art>:<wort> strings taken from aktion vokabular (typ:kick, charakter:dark, tempo:128, frei:favorites); a tag set by a user or by me beats a measured one, and a removal (an false) survives every re-measurement. '
    + 'aktion lesen {item}: the effective tags of one item with their origin; setzen {items, tags, an}: add (an true, the default) or remove up to 500 items x 20 tags in one call, all or nothing; suchen {tags?, text?, art?}: items that carry every tag and whose name or tag words contain every word of text, art narrows to loop, oneshot, track, midi, preset, kit, ...; vokabular; gespeichert: the saved searches, each with its live count (anzahl null and frisch false: not counted yet or out of date, ask again); merken {name, tags?, text?, art?}: save a search; vergessen {name}. A refusal is {ok: false, grund, text}.',
    inputSchema: { type: 'object', required: ['aktion'], properties: {
      aktion: { type: 'string', enum: ['lesen', 'setzen', 'suchen', 'vokabular', 'gespeichert', 'merken', 'vergessen'] },
      item: { type: 'string', description: 'item id, e.g. datei:<sha256>, preset:werk:surge/pad, kit:<name>, loop:<name>' },
      items: { type: 'array', items: { type: 'string' }, description: 'setzen: up to 500 item ids' },
      tags: { type: 'array', items: { type: 'string' }, description: 'full <art>:<wort> tags' },
      an: { type: 'boolean', description: 'setzen: true adds (default), false removes' },
      text: { type: 'string', description: 'suchen, merken: words matched against names and tag words' },
      art: { type: 'string', description: 'suchen, merken: item kind such as loop, oneshot, track, midi, preset, kit' },
      name: { type: 'string', description: 'merken, vergessen: name of the saved search (1 to 40 characters)' } } },
    lauf: async (p) => {
      const nein = (text: string) => ({ code: 400, j: { fehler: 'argument_ungueltig', text }, roh: JSON.stringify({ ok: false, grund: 'argument_ungueltig', text }) });
      const tagListe = (v: unknown): string[] | null => (Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]) : null);
      const mitGrund = (r: { code: number; j: Json }): { code: number; j: Json; roh?: string } => {
        if (r.code >= 400 && r.j.grund !== undefined) return { ...r, roh: JSON.stringify({ ok: false, grund: r.j.grund, text: r.j.text, ...(r.j.betroffen !== undefined ? { betroffen: r.j.betroffen } : {}) }) };
        return r;
      };
      switch (p.aktion) {
        case 'lesen':
          return typeof p.item === 'string' && p.item !== '' ? mitGrund(await http('GET', `/tags?item=${encodeURIComponent(p.item)}`)) : nein('lesen needs item');
        case 'setzen': {
          const items = tagListe(p.items), tags = tagListe(p.tags);
          if (!items || items.length === 0) return nein('setzen needs items: a non-empty list of item ids');
          if (!tags || tags.length === 0) return nein('setzen needs tags: a non-empty list of <art>:<wort> strings');
          if (p.an !== undefined && typeof p.an !== 'boolean') return nein('an must be true or false');
          return mitGrund(await http('POST', '/tags/setzen', { items, tags, an: p.an ?? true }));
        }
        case 'suchen': {
          const tags = p.tags === undefined ? [] : tagListe(p.tags);
          if (!tags) return nein('tags must be a list of <art>:<wort> strings');
          const q: string[] = [];
          if (tags.length > 0) q.push(`tags=${tags.map(encodeURIComponent).join(',')}`);
          if (typeof p.text === 'string' && p.text !== '') q.push(`text=${encodeURIComponent(p.text)}`);
          if (typeof p.art === 'string' && p.art !== '') q.push(`art=${encodeURIComponent(p.art)}`);
          return mitGrund(await http('GET', `/tags/suche${q.length ? `?${q.join('&')}` : ''}`));
        }
        case 'vokabular': return http('GET', '/tags/vokabular');
        case 'gespeichert': return http('GET', '/tags/gespeichert');
        case 'merken': {
          if (typeof p.name !== 'string' || p.name.trim() === '') return nein('merken needs name');
          const tags = p.tags === undefined ? [] : tagListe(p.tags);
          if (!tags) return nein('tags must be a list of <art>:<wort> strings');
          return mitGrund(await http('POST', '/tags/gespeichert', { name: p.name, tags, text: typeof p.text === 'string' ? p.text : '', ...(typeof p.art === 'string' ? { art: p.art } : {}) }));
        }
        case 'vergessen':
          return typeof p.name === 'string' && p.name.trim() !== '' ? mitGrund(await http('POST', '/tags/gespeichert/weg', { name: p.name })) : nein('vergessen needs name');
        default: return nein(`unknown aktion ${String(p.aktion)}: lesen, setzen, suchen, vokabular, gespeichert, merken or vergessen`);
      }
    } },
  { name: 'verwandt', description: 'Related items of one item: gemacht_aus (what it was made from), steckt_in (where it is used), passt_zu (same kind, neighbouring key and tempo within 6 percent, computed on read), aehnlich (nearest by sound), daraus (items made from it), enthaelt (items used in it). Empty lists mean nothing is known, not that nothing exists.',
    inputSchema: { type: 'object', required: ['item'], properties: { item: { type: 'string', description: 'item id, e.g. datei:<sha256>, loop:<name>, kit:<name>, projekt:<slug>' } } },
    lauf: async (p) => {
      if (typeof p.item !== 'string' || p.item === '') return { code: 400, j: { fehler: 'argument_ungueltig', text: 'verwandt needs item' }, roh: JSON.stringify({ ok: false, grund: 'argument_ungueltig', text: 'verwandt needs item' }) };
      const r = await http('GET', `/tags/verwandt?item=${encodeURIComponent(p.item)}`);
      return r.code >= 400 && r.j.grund !== undefined ? { ...r, roh: JSON.stringify({ ok: false, grund: r.j.grund, text: r.j.text, ...(r.j.betroffen !== undefined ? { betroffen: r.j.betroffen } : {}) }) } : r;
    } },
  // browser plan 1 task 9: import a file by path, and drive the sample catalogue
  { name: 'import_datei',
    description: 'Imports a file from this machine by path. Audio lands in the import folder and is catalogued by itself; ziel auto decides by type, bibliothek forces the library, projekt forces the project. Only the allowed folders are accepted; anything else is refused with pfad_ausserhalb.',
    inputSchema: { type: 'object', properties: {
      pfad: { type: 'string', description: 'Absolute path of the file on this machine.' },
      ziel: { type: 'string', enum: ['auto', 'bibliothek', 'projekt'], description: 'Where it goes; default auto.' } }, required: ['pfad'] },
    lauf: (p) => httpGrund('POST', '/import/pfad', { pfad: p.pfad, ziel: p.ziel ?? 'auto' }) },
  { name: 'bibliothek_bauen',
    description: 'The sample catalogue. aktion bauen (default) starts a build and returns at once; stand shows the build state; quellen lists the registered folders; dazu registers a folder (needs pfad, optional typ auto, track, loop or oneshot).',
    inputSchema: { type: 'object', properties: {
      aktion: { type: 'string', enum: ['bauen', 'stand', 'quellen', 'dazu'], description: 'Default bauen.' },
      pfad: { type: 'string', description: 'Folder to register (aktion dazu).' },
      typ: { type: 'string', enum: ['auto', 'track', 'loop', 'oneshot'], description: 'Kind of the folder (aktion dazu); default auto.' } } },
    lauf: (p) => {
      const aktion = p.aktion ?? 'bauen';
      if (aktion === 'stand') return httpGrund('GET', '/bibliothek/stand');
      if (aktion === 'quellen') return httpGrund('GET', '/bibliothek/quellen');
      if (aktion === 'dazu') {
        if (typeof p.pfad !== 'string' || p.pfad === '') return fehlerAntwort(400, 'argument_ungueltig', 'aktion dazu needs pfad (the folder to register)');
        return httpGrund('POST', '/bibliothek/quellen/dazu', { pfad: p.pfad, typ: p.typ ?? 'auto' });
      }
      return httpGrund('POST', '/bibliothek/bauen');
    } },
  { name: 'preset_vorhoeren', description: 'Play a short preview of one preset on Andreas\' headphone preview. id is the register id <werk|nutzer>:<geraet>/<slug> as presets_suchen returns it. The page server renders the preview (first call, cached after that) and plays it on the headphones; I get no audio and no measurement back, so this is for Andreas to listen, not for me to judge. Answer {ok, aus_cache}. kein_kopfhoerer means no headphone edge is running, nobody is listening. A hall or other effect without a preview, an unknown id or a silent render comes back as a refusal with a reason. Whether a preset sounds good is Andreas\' call.',
    inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string', description: 'register id, e.g. werk:komp/drum-bus or nutzer:rb338/my-bass' } } },
    lauf: async (p) => {
      if (typeof p.id !== 'string' || p.id === '') return fehlerAntwort(400, 'argument_fehlt', 'id is required: a preset register id like werk:komp/drum-bus');
      return httpGrund('POST', '/presets/vorhoeren', { id: p.id });
    } },
];
