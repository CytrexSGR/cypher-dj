# Presets for instruments and effects: decisions (package 1.16 "Browser")

Status 2026-11-02. Scope: storage, description, register, HTTP routes and a browser panel for presets of our own Rust
devices (`djk/instruments`: eq, komp, hall, saett, rb338, baukasten). Everything here is new files only; the hook-up into
`server.ts` and the page is delivered as two patches in this folder and is not applied yet.

This module joins two branches that were built in parallel:

- `claude/presets-storage-browsing-tvcke3`: data model, device catalogue, on-disk store, routes, panel, patches (D1 to D12);
- `claude/presets-descriptions-registry-nts9wc`: closed vocabulary, descriptions, register with drift check and query,
  command line (P-V1 to P-V6, P-R1 to P-R7).

The decisions that were needed to make one module out of the two are D13 to D21. Every product decision has a number;
the code refers to these numbers. Open questions for the product owner are at the end (F1 and following), including the
list of vocabulary words that are proposals and need approval (F9).

## Files

| File | Role |
| --- | --- |
| `presets/model.ts` | Data model, names, validation of a preset (values and description), list filter and search |
| `presets/devices.ts` | Device catalogue: parameter IDs, titles, ranges of the six Rust devices |
| `presets/vokabular.json` | The one closed, versioned vocabulary for descriptions |
| `presets/vocabulary.ts` | Loading and checking the vocabulary, validating a description |
| `presets/store.ts` | On-disk store: list, read, save, rename, delete; factory and user origin |
| `presets/register.ts` | Register over the store: rebuild, verify (drift), query, agent tool schema |
| `presets/tool.ts` | Command line: `bauen`, `pruefen`, `frage`, `schema`, `pruefsumme` |
| `presets/area.ts` | HTTP routes under `/presets` |
| `presets/werk/<geraet>/<slug>.preset.json` | Factory presets (today: the six compressor presets) |
| `presets/register.json` | Committed register of the factory presets |
| `public/presets.js`, `public/presets.css` | Browser panel |
| `tests/presets_*.test.mjs`, `tests/fixtures/presets/` | Tests and fixtures (`register/` holds a small store layout) |

## What a preset looks like

One JSON file per preset, `<root>/<geraet>/<slug>.preset.json`:

```json
{
 "schema": 1,
 "name": "Drum Bus",
 "geraet_typ": "effekt",
 "geraet": "komp",
 "werte": {
  "thresh": -18, "ratio": 4, "knee": 6, "attack": 30, "release": 100,
  "makeup": 3, "mix": 1, "extsc": false, "schp": 90
 },
 "beschreibung": {
  "art": "compressor", "unterart": "bus", "charakter": ["punchy", "tight"],
  "genre": ["techno", "house", "tech_house"], "einsatz": ["drop", "mixdown"], "energie": 4,
  "text": "Medium ratio with a slow attack that lets transients through and holds the drum group together."
 },
 "tags": ["drums", "bus"],
 "notiz": "Starting point from practice, not measured.",
 "angelegt": "2026-11-02T00:00:00.000Z",
 "geaendert": "2026-11-02T00:00:00.000Z"
}
```

| Field | Meaning |
|---|---|
| `schema` | Format version, today `1`. A file with any other value is refused on read (409 `schema_unbekannt`) and never rewritten. |
| `name` | Display name, 1..64 characters, spaces collapsed, no control characters, at least one letter or digit. |
| `geraet_typ` | `effekt` or `instrument`; must match the device. |
| `geraet` | Device id: `eq`, `komp`, `hall`, `saett`, `rb338`, `baukasten` (catalogue in `devices.ts`). |
| `werte` | Parameter values by **stable parameter name** (the nih-plug `#[id = "..."]`), plain values (not normalised 0..1). |
| `beschreibung` | **Required.** Kind, sub-kind, character, genre, use, energy and one sentence, words from `vokabular.json` (P-V1). |
| `tags` | Up to 16 free lower-case tags, `a-z 0-9 space -`, 1..24 characters each, duplicates dropped. |
| `notiz` | Free text, up to 500 characters. |
| `angelegt`, `geaendert` | ISO 8601 UTC. Overwriting keeps `angelegt` and sets `geaendert`. |

Origin (`werk`/`nutzer`) and slug are **not** stored in the file; they follow from where the file lives (D3), so a
copied file cannot claim to be a factory preset.

## Storage decisions

- **D1 Parameter names, not indices.** Values are keyed by the nih-plug parameter ID. That ID is what the host stores in
  its own project state, so it survives reordering and renaming of the display text. `tests/presets_devices.test.mjs`
  reads the Rust sources and fails when the catalogue and the `#[id]` list drift apart.
- **D2 EQ band parameters** carry the suffix nih-plug gives a nested array: `freq_1` ... `freq_8`, `on_1`, `type_1`, ...
  plus `out` and `propq`. Band count is `eq_dsp::BAENDER` (8), checked by the test.
- **D3 Where presets live.**
  - Factory: `djk/ui/presets/werk/<geraet>/<slug>.preset.json`, in the repository, read-only for the server.
  - User: `~/.config/cypherdj/presets/<geraet>/<slug>.preset.json`; a test instance `a..i` uses
    `~/.config/cypherdj-<i>/presets` (same scheme as `geraeteDatei()` and `controllerOrdner()` in `paths.ts`). Both
    folders can be overridden through `ServerOptionen.presets` (`{ werk, nutzer }`).
  - Deleted user presets move to `<nutzer>/.papierkorb/` (as sets do in `collection.ts`); nothing is removed for good.
- **D4 Naming rules.** The slug is the folded name (lower case, umlauts spelled out `ä→ae`, accents dropped, everything
  else `-`, at most 48 characters). Names are unique per device and origin by slug, so `Lead` and `LEAD` are the same
  preset; the same name on two devices is fine. A second save under a taken name is refused (409 `name_vergeben`)
  unless the caller asks to overwrite. Unlike sets there is no automatic `-2` suffix: presets are found by name, and two
  presets called "Lead" on one device would be confusing.
- **D5 Factory vs user.** Factory presets are shipped with the repository and are never written by the server (any write
  on `/presets/werk/...` answers 403 `werk_schreibgeschuetzt`). To change one, save it under a new name as a user preset.
  A user preset and a factory preset may have the same slug; the list shows user presets first, then factory.
  The first factory set is the six compressor presets that `djk/instruments/comp/presets/presets.json` already ships,
  values unchanged; `tests/presets_devices.test.mjs` and `tests/presets_factory.test.mjs` keep both identical, and the
  latter also keeps them equal to `KOMP_PRESETS` of the page through the kern mapping of D9.
- **D6 Reading is tolerant only for removed parameters.** Writing is strict: an unknown parameter name, a wrong type or a
  value outside the plugin's range is refused (400 with an English text naming the parameter and the range). Reading drops
  parameter names the device no longer has and reports them as `verworfen`, so a plugin update that removes a parameter
  does not kill all presets. A wrong type or an out-of-range value in a file is 409 `preset_ungueltig`.
- **D7 Damaged files are shown, never repaired.** Unreadable JSON, a foreign schema, invalid content, an invalid
  description (D20), a file over 256 KB: the list shows the entry with its reason (`fehler`), reading answers 409, and
  the bytes stay as they are. A user may overwrite such a file on purpose by saving with `ueberschreiben`.
- **D8 Atomic writes and concurrency.** A write goes to a complete temp file (fsync), then `rename` (overwrite) or
  `link` (create, fails atomically if the name exists meanwhile). Read-change-write runs under a lock per device folder
  (`lock.ts`, the same lock as sets) against other processes; a lock held by a live foreign process answers 409
  `preset_busy` at once and the HTTP handler retries up to 4 times after 25 ms, as for sets. Overwrite can carry the
  `geaendert` stamp the caller last saw (`erwartet`); if the file changed since, 409 `veraltet`. Symlinks in the store
  are not presets and are never followed.
- **D9 Applying in the page.** The page can today read and set only the kern's own channel compressor (`POST /regler
  <kanal>/komp/<feld>`). A `komp` preset applied there sets `schwelle, ratio, attack, release, makeup, mix` (same ranges
  as the plugin) and reports what it skipped (`knee`, `extsc`, `schp`: the kern compressor has a fixed 6 dB knee and no
  external sidechain filter). SAVE CURRENT on `komp` reads the same six fields of the channel selected in EFFECTS. All
  other plugin devices can be browsed, searched, renamed and deleted, but not applied or captured from the page yet (F1). The kern mix tools are the exception since A8 (D22).
- **D10 Routes** live under their own prefix `/presets` (never `/proj/`), as one router `Bereich` named `presets`:

  | Method | Path | Answer |
  |---|---|---|
  | GET | `/presets?geraet=&geraet_typ=&herkunft=&tag=&q=` and description filters `&familie=&art=&unterart=&charakter=&genre=&einsatz=&energie=` | list of entries (`herkunft, geraet, geraet_typ, slug, name, tags, geaendert, beschreibung, familie, fehler?`) |
  | GET | `/presets/geraete` | device catalogue (parameter names, titles, ranges, enum values) |
  | GET | `/presets/vokabular` | the vocabulary: `version, pruefsumme, inhalt, anzahl` (tag counts) |
  | POST | `/presets/suche` | register query (P-R5) → `{gesamt, treffer}`; the agent tool endpoint |
  | GET | `/presets/suche/schema` | the agent tool definition `presets_suchen` (P-R7) |
  | GET | `/presets/register` | the register built now from the store: `{register, ungueltig, doppelt}` |
  | GET | `/presets/register/pruefen` | drift of the committed `register.json` against the factory presets (P-R4) |
  | GET | `/presets/<herkunft>/<geraet>/<slug>` | the preset, plus `herkunft`, `slug`, `hash`, `verworfen?` |
  | POST | `/presets` | `{name, geraet, werte, beschreibung, geraet_typ?, tags?, notiz?, ueberschreiben?, erwartet?}` → 201 new / 200 overwritten |
  | POST | `/presets/nutzer/<geraet>/<slug>/umbenennen` | `{name}` → `{ok, slug}` (the slug follows the new name) |
  | POST | `/presets/nutzer/<geraet>/<slug>/loeschen` | `{ok}` |

  List filters in the query string: lists are comma separated (`art=bass,pad`), `energie` is one value (`3`) or a range
  (`2-4`, `2-`, `-3`). They are validated like the register query (P-R6): an invented word is 400
  `anfrage_ungueltig`, never ignored. Every POST carries `schutz: fremdePost` (415 without JSON, 403 from a foreign
  origin, checked by the router). Error reasons and their English texts are local to `model.ts` (`PRESET_TEXT`),
  because `http/reasons.ts` is outside this package. A refusal is `{fehler, text}`, and for `beschreibung_ungueltig`
  and `anfrage_ungueltig` also `details`: every single error `{feld, code, wert?, erlaubt?}` with the allowed words.
- **D11 Andreas and Cypher** may both save, rename and delete; every change is logged (`preset_gespeichert`,
  `preset_umbenannt`, `preset_geloescht` with `quelle`). See F4.
- **D12 Enum values** are stored as the variant's `#[name]` text (`"Low Cut"`, `"24 dB/oct"`, `"8192 (smooth)"`), the
  text the host shows; the test compares them with the Rust enums. See F3.

## Describable presets

- **P-V1 Structured description with seven fields.** Every preset file carries `beschreibung`:
  - `art` / `unterart`: kind and sub-kind. This follows the Type / Sub-Type / Character idea that preset browsers in
    the industry use, but the lists are our own. Kinds are grouped into two families, `instrument` (bass, lead, pad,
    keys, pluck, drums, percussion, fx) and `effekt` (reverb, delay, compressor, eq, saturation, filter, modulation,
    utility). A kind name exists in exactly one family, so the family is derived and not stored in the preset.
  - `charakter`: 1 to 6 words; `genre`: 0 to 6 (effects are often genre-neutral); `einsatz` (use): 1 to 5.
  - `energie`: integer 1 (calm) to 5 (peak).
  - `text`: exactly one sentence, 10 to 160 characters.

  All fields are required. Unknown fields are errors. Field names follow the existing German scheme of the codebase.
- **P-V2 One closed, versioned vocabulary.** All admissible words live only in `presets/vokabular.json` under `inhalt`.
  The file records `version`, `pruefsumme` (first 16 hex digits of the SHA-256 of the canonical JSON of `inhalt`) and
  a `verlauf` (history) with one entry per version. Loading refuses the file when the checksum of `inhalt` differs from
  `pruefsumme` (a list was edited without a version bump), when the last `verlauf` entry does not carry the current
  version and checksum, when versions in `verlauf` do not rise strictly or a checksum repeats, when a word is malformed
  (`^[a-z][a-z0-9_]*$`) or duplicated, a kind sits in two families, or an opposite pair names an unknown character
  word. Extending the vocabulary is a deliberate edit: change the list, `node presets/tool.ts pruefsumme`, raise
  `version`, append a `verlauf` entry, set `pruefsumme`, update the pinned line in `tests/presets_vocabulary.test.mjs`,
  then `node presets/tool.ts bauen`. Agents cannot invent words: no code path accepts a word outside the file.
- **P-V3 Validation rejects, it does not repair.** Every error comes back at once as `{feld, code, wert, erlaubt}`;
  `erlaubt` lists the admissible words (for `unterart`: those of the given kind), so an agent that sent `fat` sees
  `thick` and can correct itself. Codes: `unbekanntes_feld`, `fehlt`, `typ`, `unbekanntes_wort`, `doppelt`, `anzahl`,
  `widerspruch`, `bereich`, `laenge`, `satz`, and `familie` (D14). Nothing is lower-cased, mapped to a synonym or
  dropped silently: a silent repair would teach agents that invented words work.
- **P-V4 Bounded tag counts.** A preset tagged with every character word classifies nothing. 1..6 character words is
  enough to describe a sound and forces a choice.
- **P-V5 Opposites and one sentence.** `gegensaetze` lists character pairs that cannot both hold (bright/dark, dry/wet,
  mono/wide, clean/dirty, static/evolving, soft/aggressive, thick/thin, tight/loose). `analog/digital` is not a pair:
  hybrids are real. The text is one sentence: no line break, ends in `.`, `!` or `?`, and no sentence end followed by a
  capital letter inside it (`1.5 s` and `e.g.` stay allowed).
- **P-V6 Language.** Vocabulary words, texts and error texts are English, like the user interface. Identifiers stay in
  the German scheme (`art`, `charakter`, `einsatz`). The page shows `_` as a space (`deep house`) but sends the word.

## Preset register

- **P-R1 One index over the store.** The register indexes exactly what `PresetSpeicher` lists, for the origins asked
  for (`werk`, `nutzer`, each at most once). It never scans or parses files itself (D16).
- **P-R2 Entry and stable id.** `id = "<herkunft>:<geraet>/<slug>"`, for example `werk:komp/drum-bus`. It depends on
  nothing that changes when the content changes, so references from collections or projects survive edits (a rename
  changes the slug and therefore the id, as it changes the file). An entry holds `id, herkunft, geraet, slug, name,
  pfad, tags, familie`, the seven description fields and two hashes: `hash` (SHA-256 of the canonical JSON of the whole
  file; any change shows) and `klang` (SHA-256 of `{geraet, werte}`; the same sound saved twice shows as a duplicate
  even with different names or descriptions). Canonical JSON sorts keys, so reformatting a file is not a change.
- **P-R3 Rebuild.** `bauen(speicher, herkuenfte)` returns the register sorted by id plus `ungueltig` (damaged files and
  invalid descriptions with their errors) and `doppelt` (same sound). Invalid presets are **not** in the register: a
  query never returns an unclassified preset. The register records the vocabulary version and checksum it was built
  with. `presets/register.json` is the committed register of the factory presets, one entry per line so a diff shows
  which preset changed, written atomically. `tests/presets_factory.test.mjs` fails when it drifts from the factory files.
- **P-R4 Verify (drift).** `pruefe(register, speicher, herkuenfte)` compares a stored register with the store:

  | Field | Meaning |
  | --- | --- |
  | `fehlend` | missing: in the register, file gone |
  | `verwaist` | orphaned: valid file in the store, not in the register |
  | `doppelt` | duplicate: same id twice in the stored register (`art: "id"`), or the same sound in several files (`art: "klang"`) |
  | `geaendert` | changed: hash differs, with `teile` = `klang`, `beschreibung`, `name`, `geraet` or `sonstiges` |
  | `ungueltig` | file exists but cannot be read or fails validation (reported here, not as missing) |
  | `vokabular_veraltet` | register built against another vocabulary version or checksum |

  `sauber` is true only when all lists are empty and the vocabulary matches. Only the given origins are compared: a
  factory-only check ignores user entries in a combined register. Command line: `node presets/tool.ts pruefen`
  exits 1 on drift; `bauen` exits 1 when a preset is invalid. HTTP: `GET /presets/register/pruefen`.
- **P-R5 Query.** `frage(register, anfrage, vok)` filters by `familie`, `art`, `unterart`, `geraet`, `herkunft` (any
  of), `charakter` (all must be present), `genre` and `einsatz` (any), `energie` (value or `{min, max}`) and free
  `text` (D21; at most 12 words). Results are sorted by name, then id, and cut at `grenze` (default 50, at most 500);
  `gesamt` is the full count. The register is small, so a linear filter in memory is enough; no index or database.
- **P-R6 Queries are validated like descriptions.** Unknown query fields and words outside the vocabulary or the device
  catalogue raise `FrageFehler` (HTTP 400 `anfrage_ungueltig`) with the same error shape as P-V3. An unknown word never
  degrades to "no filter" or "no results": an agent learns that the word does not exist and which words do.
- **P-R7 Ready to be an agent tool.** `frageSchema(vok)` returns `{ name: "presets_suchen", description, input_schema }`
  in the shape tool-using models expect. Its enums come from the vocabulary and the device catalogue, so the tool
  definition and the validation cannot disagree, and `additionalProperties: false` matches P-R6. It is served at
  `GET /presets/suche/schema` and answered at `POST /presets/suche`; registering it with an agent runtime is a later
  step (F13).

## Decisions made to join the two branches

- **D13 One file format, one naming scheme.** The storage branch's model (`schema: 1`, values by parameter ID,
  timestamps, tags, note) plus the description branch's required `beschreibung`. The description branch's own format
  (`format: 1`, kern field names such as `schwelle`, `sc`) is gone. Files are `<slug>.preset.json` with the storage
  branch's slug rule (D4: `a-z 0-9 -`, no subfolders): the double extension marks preset files, so notes or other JSON
  in a device folder are never read as presets. Neither draft format ever shipped, so `schema` stays `1`.
- **D14 Kind and device type agree.** The family of `art` must equal the device type: a `komp` preset (effect) cannot be
  described as `bass`. The error is `art: familie` with the kinds of the right family as `erlaubt`. Which kinds fit a
  device beyond the family (e.g. only `compressor` on `komp`) is not restricted (F11).
- **D15 Kind prefilled when saving.** The save form suggests a kind per device (`komp → compressor`, `eq → eq`,
  `hall → reverb`, `saett → saturation`, `rb338 → bass`, none for `baukasten`) and offers only the kinds of the device
  family. It is a suggestion; the user can pick another kind.
- **D16 The register reads the store.** Naming, reading and validation exist only in `model.ts` and `store.ts`.
  Consequently the register sees exactly what the browser sees: files whose name is not a slug, files outside a known
  device folder, symlinks and temp files are not presets for either of them (the description branch reported misnamed
  files as invalid; now they are ignored like in the store). Damaged files appear in `ungueltig` with the store's
  reason (`json_kaputt`, `schema_unbekannt`, `preset_ungueltig`, `zu_gross`) or with the description errors.
- **D17 Free tags and the note stay beside the description.** The description answers "what is it" with closed words;
  `tags` (free, e.g. a project name) and `notiz` (free text, e.g. the source of the values) remain for the user's own
  use. Both are searchable. See F7 and F12.
- **D18 Factory compressor presets.** Parameter values are the plugin values of the storage branch (checked against
  `devices.ts` and `presets.json`); descriptions are those of the description branch. One text was corrected: "Kick
  Sidechain" said "Keyed from the drum group", which is the kern compressor's key channel `sc = 5` (DRUMS); the plugin
  preset uses its external sidechain input (`extsc: true`), so the text now says "Keyed from the external sidechain
  input with a fast attack so the channel ducks and pumps on every kick."
- **D19 Where the register lives.** `presets/register.json` holds only the factory presets and is checked by tests and
  `GET /presets/register/pruefen`. For user presets there is no stored register: `GET /presets/register` and `POST
  /presets/suche` build it from the store on each request (milliseconds for hundreds of files), so it can never be
  stale after a save, rename or delete. See F14 if the user collection grows large.
- **D20 Validation on read.** A file whose description fails the current vocabulary is its own reason,
  409 `beschreibung_ungueltig` with `details`, listed with that reason and left untouched (D7); a description filter
  never returns it. It can be fixed by saving over it. This also applies when a future vocabulary version removes a
  word (F10).
- **D21 One search rule.** The list's `q`, the register query's `text` and the page's instant search use the same rule:
  every word (folded, `_` equals a space) must occur in the name, tags, device id, device title, the sentence or a
  description word. The list also searches the note; the register query also matches the id (the register carries no
  note). The page filter and the server list are checked against each other in `tests/presets_page.test.mjs`.

## Hook-up (applied 2026-11-02)

- Applied on `main` after the 1.12 S3 wave A merge, with the agreement of the wave that owns `server.ts`:
  one import, one option field `presets?: PresetOptionen`, one line
  `this.router.melde(presetsBereich(this.bereichKontext(), opt.presets ?? {}))` after the `lernen` Bereich in
  `server.ts`; in `index.html` the stylesheet, a third bottom-panel tab PRESETS and the empty `#presets` element; in
  `app.js` the import of `public/presets.js`, the tab switch and the compressor bridge of D9.
  `public/production/*` and `layout.js` are not touched.
- `tests/routes_golden.test.mjs` probes a fixed list of paths without `/presets`, so the golden file does not change.
- The patch files and their guard test `tests/presets_patch.test.mjs` were removed once applied.

## Open questions for the product owner

- **F1 Applying to plugins.** How should a preset reach a running Cypher EQ/Hall/Saett/RB-338/Modular instance? The page
  has no route that sets plugin parameters by ID today (the knobs in EFFECTS are kern fields and Baukasten graph knobs).
  Options: a kern/host route that takes `{instanz, parameter_id: wert}`; or let the plugins read the preset folder
  themselves. Until then only `komp` applies, onto the kern compressor (D9).
  *Answered (package 1.16 rest), see D25 (U3a): no plugin reads preset folders; the server computes an apply plan that the
  caller sends through the existing project and controller routes.*
- **F2 Baukasten presets.** A Cypher Modular preset stores `lautstaerke` and `knob1..8`, but the knobs mean something
  different per graph. Should a modular preset also store the graph name (and refuse to apply to another graph), or are
  graph sounds already covered by SAVE SOUND (S17) and modular presets unnecessary?
  *Answered (package 1.16 rest), see D23.*
- **F3 Enum storage.** Display text (D12) is readable but changes if someone renames a variant's `#[name]`. Alternative:
  give each variant a stable `#[id]` in Rust and store that. Which do you want?
- **F4 Cypher's rights.** May Cypher delete or overwrite user presets, or only save new ones (as with `nur_andreas` in
  MIDI learn)? May Cypher describe presets on its own, or should a description written by Cypher be marked as such?
  *Answered (package 1.16 rest), see D24.*
- **F5 More factory presets.** Only the six compressor presets exist. Who curates and describes factory presets for EQ,
  Hall, Saett and RB-338, and should they be checked by measurement (the compressor ones are starting points from
  practice, not measured)?
- **F6 Preset names across origins.** May a user preset share the name of a factory preset (allowed today, D5), or
  should saving warn about it?
- **F7 Free tags.** The description now covers kind, character, genre and use with closed words. Keep the free tags
  (D17), or drop them so there is only one way to classify a preset?
- **F8 Project link.** Should a project (`/proj/`) remember which preset a device came from (by register id), so the
  browser can mark "modified since preset"? That would touch the project format and needs its own decision.
  *Answered (package 1.16 rest), see D26 (U2).*
- **F9 Vocabulary approval.** Answered 2026-11-02, see "Vocabulary version 2" below.

- **F10 Removing words later.** When a later vocabulary version drops a word, user presets that use it become
  `beschreibung_ungueltig` (D20) until re-described. Is that acceptable, or should a version carry a mapping from old to
  new words that the store applies on read?
- **F11 Kinds per device.** Should a device restrict its kinds further than the family (D14), e.g. `komp` only
  `compressor`, `hall` only `reverb`? Today a Saett preset may be described as `filter` or `utility`.
- **F12 Note and sentence.** A preset has both `notiz` (free, up to 500 characters) and the description sentence. Keep
  both, or drop the note?
- **F13 Agent access.** Should Cypher get `presets_suchen` as a tool (the schema and route exist), and may it also save
  presets through `POST /presets`?
  *Answered (package 1.16 rest), see D24; the hand tools follow in U5 of the 1.16 rest plan.*
- **F14 Large user collections.** The register for user presets is built per request (D19). If collections reach many
  thousands of presets, should the server keep it in memory and update it on save, rename and delete?
- **F15 Plugin presets.** The description branch reserved a third origin `plugin` for presets converted from plugin
  formats. It is not in the store today. Wanted, and if so read-only like factory presets?

## Vocabulary version 2 (2026-11-02)

The character words were checked against a sourced study of sound vocabulary (timbre-semantics research: Saitis and
Weinzierl 2019, Zacharakis et al. 2011, 2014, 2015; mixing practice: Senior, Owsinski). The study itself and 46
sourced synthesis recipe cards (one per sub-kind) are kept outside the repository.

- **Dropped:** `loose`, `organic`, `gritty`, `glassy`, `static` (no source found for the meaning), `heavy` (a
  loudness or size factor, not timbre), `analog`, `digital` (origin, not timbre; `analog` stays a sub-kind of bass and
  pad). Opposite pairs that lost a word were dropped.
- **Added `bedeutung`:** every character word now carries its meaning (`sinn`), the measurable correlate
  (`messgroesse`), the typical move (`eingriff`, band and direction) and the source (`beleg`). The loader refuses a
  character word without a meaning and a meaning without a word. This is what lets every wave carry out a word the
  same way.
- **`warm`** means fullness in the low mids, about 100-200 Hz, as the product owner uses it ("mehr fülle", 2026-11-02).
  Research also uses warm for fewer highs; that reading is not meant here.
- **`transparent`** means without audible side effects of processing (Senior), not "further away".
- **Sub-kinds** proposed in version 1 are confirmed: each has a sourced recipe card.
- Stored presets with a dropped word fail validation with `beschreibung_ungueltig` and the list of admissible words;
  the factory presets and the test fixtures were updated. No user presets existed at the time of the change.

## Second kind of device: the kern mix tools (A8, 2026-11-03)

- **D22 The kern mix tools are devices of their own kind.** `GeraetDef` gets `herkunft` (`'plugin'`, the default, or `'kern'`) and,
  for `'kern'`, `kanalArten` (`quelle`, `bus`); each parameter carries `pfad`, its suffix in the controller table. Device ids
  `gate`, `utility`, `multiband`, `kanal-limiter` (the names of `docs/presets/devices/GERAET-*.md`). The source of truth is not a Rust
  file but the header `djk/core/signalbox/include/cypherdj/signalbox/tool_controls.h` (one `{...}` row per line); a parameter name is
  the suffix without the tool prefix and with `/` as `_` (`mb/tief/schwelle` is `tief_schwelle`, `util/phase_l` stays `phase_l`).
  `tests/presets_devices.test.mjs` parses the header with a strict parser (a line it does not understand throws; the real header gives
  44 rows = 345 controller rows) and holds names, paths, ranges, switches and channel kinds equal to the catalogue in both
  directions. The plugin check (`#[id]` of the Rust sources) skips kern devices.
- **Applying** a kern device preset is one `POST /regler` per field on the chosen channel (`<channel>/<pfad>`, `ab: "jetzt"`), switches
  stored as true/false and sent as 1/0. A channel kind the device lacks (Gate on a bus, Multiband on a source) is refused, nothing is
  sent. SAVE CURRENT reads the live values of the channel picked in EFFECTS and gives nothing for a kind the device lacks.
- **Kind prefilled when saving** (D15 extended): `VORGABE_ART` suggests `compressor` for `gate`, `multiband` and `kanal-limiter` (the vocabulary has no gate or
  limiter kind) and `utility` for `utility`; only a suggestion.
- **No factory presets** are added; the register and the store are unchanged (a preset is stored under its device id like any other).
  The page reaches the ten channels of `FX_KANAELE`; buses (Multiband, Limiter, Utility on a bus) are reachable by hand and API only.

## Package 1.16 rest (2026-11-04)

Each decision below is DECIDED (Cypher default, Andreas may override); source: `docs/b1-plaene/SPEC-1.16-rest.md`.

- **D23 Baukasten presets store their graph (answers F2).** A preset of the device `baukasten` carries `graph`, the name of
  the Baukasten graph its knobs belong to; it is required for `baukasten` and refused for every other device (`graph_fehlt`,
  `graph_verboten`, `graph_ungueltig`). The name rule is the project's `BK_GRAPH_NAME` (`/^[a-z0-9_-]{1,32}$/`), copied
  into `model.ts` as `GRAPH_NAME` and pinned equal by `tests/presets_store.test.mjs`. The register's `klang` hash covers
  `graph` only when present, so the 48 factory hashes (none of them Baukasten) do not change. `schema` stays 1. The SAVE
  form asks for the graph (instrument graphs of `GET /graphen`) when the device is Cypher Modular.
- **D24 Cypher's preset rights (answers F4 and F13).** Cypher may search, read and save new presets, and may overwrite,
  rename or delete presets she saved herself. A save whose source is `cypher` (`x-djk-quelle`) writes `autor: "cypher"`;
  absent means Andreas (all files before this package). The rule for overwrite, rename and delete is one check in
  `store.ts` `cypherDarfNicht`: the file exists, the source is Cypher, and NOT (the file is readable AND marked as hers)
  → 403 `nur_andreas_preset`, the file untouched. A file that cannot be read (damaged JSON, too large, a vocabulary
  refusal) counts as unmarked, so only Andreas may replace or delete it (`loesche` now reads the file inside the lock for
  this). When Andreas overwrites a Cypher preset it becomes his (the mark goes); a rename by Cypher of her own preset keeps the mark, a rename by Andreas removes it (D27). The register
  entry and the list entry carry `autor` only when present; the page shows "by Cypher".
- **D26 Preset origin in the project (answers F8).** Optional field `preset` (register id, `presets/preset_id.ts`) on the
  intern devices (`rb338`, `bk`) of instrument tracks and on insert stages. Absent in every existing project; the format
  stays `cypherdj-projekt/2`. It is set only by an applied preset (`spur_neu`/`spur_aendern` with `geraet.preset`,
  `insert_setzen` with `preset`, the new command `insert_werte_setzen {insert_id, werte, preset?}` where `null` clears it).
  It is not playback: `spurSicht` strips it and stage values are controls, so a change of only `preset` needs no new
  playback and sends no controls. "Modified since preset" is computed by the page, not stored. A host device carries no
  preset. Freeze: the model allows a freeze only on host tracks, so a preset target (rb338, bk) never has one; the spec's
  rule "a change of only `preset` keeps a freeze" holds trivially and needs no code.
- **D25 Applying a preset (answers F1).** No plugin reads preset folders. `POST /presets/anwenden {id, ziel}` only computes a
  plan (`presets/apply.ts` `planeAnwendung`), the caller sends it through the existing routes: `{weg: 'proj', befehle,
  label, uebersprungen, hinweise?}` as one `POST /proj/aendern` (one undo step), or `{weg: 'regler', anfragen}` as one
  `POST /regler` per request. Targets: `{art: 'spur', spur_id}` (rb338 → `spur_aendern` with values normalised through
  `project/rb_mapping.ts`, the inverse of `rb_dsp` `Def::wert`; baukasten → bk device of the same graph, else
  `graph_anders`, `lautstaerke` skipped), `{art: 'insert', insert_id}` (`insert_werte_setzen`, values mapped through
  `INSERT_ARTEN[art].parameter[].geraet`, `extsc` skipped), `{art: 'insert_neu', strang_id}` (`insert_setzen` at the end
  of the chain), `{art: 'kanal', kanal}` (komp → kern channel compressor D9 on source channels; kern mix tools D22,
  switches 1/0, `kanal_art` for a kind the device lacks). Refusals: hall `kein_ziel` (Cypher Hall has no running
  instance in PRODUCTION), eq and saett on inserts `art_nicht_aktiv` until slice 4b (their mapping is ready and tested),
  `geraet_passt_nicht`, `ziel_unbekannt`, `kein_projekt`. Every skipped parameter is named in `uebersprungen`. A plan
  for a track with a freeze whose values change carries `hinweise: ['freeze_geht']` (only reachable on host tracks today,
  see D26). `POST /presets/von_ziel` saves the values of a track or stage through the same save path and source rule
  (D24); `GET /presets/katalog` lists the devices of the PRODUCTION browser.
- **D27 A rename by Andreas takes the Cypher mark (2026-11-05, review finding S1 of 1.16; Andreas 2026-11-05: ja so bauen).**
  When Andreas renames a preset or a collection that carries `autor: "cypher"`, the renamed item becomes his: the mark is
  removed, so Cypher can no longer overwrite, remove items from, rename or delete it (`nur_andreas_preset`,
  `nur_andreas_kollektion`). When Cypher renames her own item the mark stays, and she may still delete it. The rule sits in
  `benenne` of `presets/store.ts` and `collections/store.ts`: the mark is written back only when the source is
  `cypher` and the file was marked (the same check as `cypherDarfNicht` lets a Cypher rename through only then). It also
  holds for a rename that keeps the slug (case change). Before, `benenne` copied `autor` from the old file whatever the source.
  Tests: `rename by Andreas takes the Cypher mark (D27)` in `tests/presets_store.test.mjs` and
  `tests/collections_store.test.mjs`; mutants `umbenennen_behaelt_marke` in `check/mutation_presets_rights.mjs` and
  `check/mutation_collections.mjs`.
