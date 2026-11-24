// R9: the labs rows of docs/masterplan/SCOPE-1.0.md (second cell exactly `labs`) and the page elements that open or are that feature.
// `zeile` is the Feature cell verbatim; `text` (optional) keeps only the matched elements whose text matches it; `seite` lists CSS selectors, or null when the feature has no element in the page (hardware, operations,
// features only loaded by name or driven by tools). The rows with null are named in the README and the feature manual instead.
export const LAB_ZEILEN = [
  { zeile: "Beat FX tuned for the XDJ control scheme", seite: null },
  { zeile: "Scene follow actions (field `folge`)", seite: null },
  { zeile: "Launchpad Mini MK3 as SEQ grid", seite: null },
  { zeile: "Time signatures n/4 (2/4 to 12/4)", seite: null },
  { zeile: "Time signatures 6/8, 7/8 and other eighths", seite: null },
  { zeile: "Windows plugins through yabridge and Wine", seite: null },
  { zeile: "Native Instruments (Kontakt) route", seite: null },
  { zeile: "ANALYZE window (a view of the analysis)", seite: [".w-analyse-auf"] },
  { zeile: "FIND SOUND: a variant round to improve a Cypher Modular sound", seite: [".w-runde-auf"] },
  { zeile: "Structure and cue suggestion pipeline", seite: null },
  { zeile: "Greif 2, the three Juno Pad variants and the sync lead example", seite: null },
  { zeile: "Cypher Labor (experimental block)", seite: null },
  { zeile: "Command-line player for the agent (`player_cli`)", seite: null },
  { zeile: "Akai APC20: PRODUCTION functions with Shift", seite: null },
  { zeile: "Novation Launch Control 3", seite: [".reg-geraet-name"], text: /Launch Control 3/i },   // the device row of the CONTROLLERS register
  { zeile: "Maschine MK2 through the `cypherdj-pult` bridge", seite: null },
  { zeile: "Tablet pairing (control from a tablet)", seite: ["#kopplung-knopf"] },
  { zeile: "XDJ-XZ and Maschine Jam bindings", seite: null },
];
