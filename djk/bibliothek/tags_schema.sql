-- Schema of the tag store (tags.sqlite). Read by BOTH sides: bibliothek/tags_store.py and ui/tags/speicher.ts.
-- Versioned through PRAGMA user_version: a side applies this file ONCE, in one BEGIN IMMEDIATE transaction, when the store's
-- user_version is below the number on the next line, then sets user_version. An open of a current store runs no statement of
-- this file and takes no write lock. Change a table or a view rule: raise the number.
-- schema-version: 2

CREATE TABLE IF NOT EXISTS item(
  id TEXT PRIMARY KEY,
  art TEXT NOT NULL,                      -- id kind, or the catalogue typ (track|loop|oneshot|midi) for datei: items
  name TEXT NOT NULL DEFAULT '',
  kopf TEXT NOT NULL DEFAULT '',          -- fingerprint of the catalogue columns Pass A read
  katalog INTEGER NOT NULL DEFAULT 0,     -- 1 = Pass A took it from the catalogue, only those can get weg = 1
  weg INTEGER NOT NULL DEFAULT 0,
  geaendert REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS item_tag(
  item TEXT NOT NULL,
  tag TEXT NOT NULL,
  herkunft TEXT NOT NULL CHECK (herkunft IN ('gemessen', 'abgeleitet', 'nutzer', 'agent')),
  quelle TEXT NOT NULL DEFAULT '',        -- producer: messen (gemessen), erbe / preset (abgeleitet), '' (manual)
  an INTEGER NOT NULL DEFAULT 1,          -- 0 on a manual row = the tag is removed everywhere
  wert REAL,
  zeit REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (item, tag, herkunft, quelle)
);
CREATE INDEX IF NOT EXISTS it_tag ON item_tag(tag, item);

CREATE TABLE IF NOT EXISTS relation(
  von TEXT NOT NULL,
  art TEXT NOT NULL CHECK (art IN ('made_from', 'used_in', 'similar_to')),
  nach TEXT NOT NULL,
  herkunft TEXT NOT NULL DEFAULT '',      -- producer: messen, scan or melde
  wert REAL,
  zeit REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (von, art, nach)
);
CREATE INDEX IF NOT EXISTS rel_nach ON relation(nach, art);

CREATE TABLE IF NOT EXISTS merkmal(sha TEXT PRIMARY KEY, v INTEGER NOT NULL, daten TEXT NOT NULL, zeit REAL NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS merkmal_fehl(
  pfad TEXT NOT NULL, groesse INTEGER NOT NULL, mtime_ns INTEGER NOT NULL, zeit REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (pfad, groesse, mtime_ns)
);
CREATE TABLE IF NOT EXISTS gespeichert(
  name TEXT PRIMARY KEY, tags TEXT NOT NULL DEFAULT '', text TEXT NOT NULL DEFAULT '', art TEXT NOT NULL DEFAULT '',
  angelegt REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS stand(schluessel TEXT PRIMARY KEY, wert TEXT NOT NULL);

-- Owner of a scan row (v2). A relation of herkunft scan is written by the scan of ONE source (a preset, kit, project or loop) and only
-- that source's scan may delete it; one relation can have several owners and goes when the last owner lets go. Rows of the other
-- producers (melde, messen) never appear here.
CREATE TABLE IF NOT EXISTS scan_eigner(
  eigner TEXT NOT NULL, von TEXT NOT NULL, art TEXT NOT NULL, nach TEXT NOT NULL,
  PRIMARY KEY (eigner, von, art, nach)
);
CREATE INDEX IF NOT EXISTS scan_eigner_rel ON scan_eigner(von, art, nach);
CREATE INDEX IF NOT EXISTS item_geaendert ON item(geaendert);
-- Lift from v1: scan rows written before owners existed have none, so they could never be removed correctly. They go, and the scan
-- signatures with them, so the next scan writes everything again with owners. On a fresh store both statements find nothing.
DELETE FROM relation WHERE herkunft = 'scan' AND NOT EXISTS (SELECT 1 FROM scan_eigner e WHERE e.von = relation.von AND e.art = relation.art AND e.nach = relation.nach);
DELETE FROM stand WHERE substr(schluessel, 1, 5) = 'scan_';

-- Effective tags. Per (item, tag) the best row wins: manual (nutzer, agent) > gemessen > abgeleitet, newest first inside a
-- class; a winning manual row with an = 0 hides the tag. For the single-valued arts tempo, tonart and energie only ONE tag per
-- item survives: that of the best origin class, the newest inside it.
DROP VIEW IF EXISTS wirksam;
DROP VIEW IF EXISTS wirksam_roh;
-- wirksam_roh is written without a window function (a row wins when no other row of its (item, tag) beats it), so joins on
-- `item` use the primary key of item_tag instead of building the view for the whole store.
CREATE VIEW wirksam_roh AS
  SELECT t.item, t.tag, t.herkunft, t.quelle, t.wert, t.prio, t.zeit
  FROM (SELECT *, CASE herkunft WHEN 'gemessen' THEN 2 WHEN 'abgeleitet' THEN 1 ELSE 3 END AS prio FROM item_tag) t
  WHERE t.an = 1 AND NOT EXISTS (
    SELECT 1 FROM (SELECT *, CASE herkunft WHEN 'gemessen' THEN 2 WHEN 'abgeleitet' THEN 1 ELSE 3 END AS prio FROM item_tag) u
    WHERE u.item = t.item AND u.tag = t.tag
      AND (u.prio > t.prio
           OR (u.prio = t.prio AND u.zeit > t.zeit)
           OR (u.prio = t.prio AND u.zeit = t.zeit AND u.herkunft > t.herkunft)
           OR (u.prio = t.prio AND u.zeit = t.zeit AND u.herkunft = t.herkunft AND u.quelle < t.quelle)));
CREATE VIEW wirksam AS
  SELECT item, tag, herkunft, quelle, wert FROM (
    SELECT item, tag, herkunft, quelle, wert,
           ROW_NUMBER() OVER (
             PARTITION BY item, CASE WHEN substr(tag, 1, instr(tag, ':') - 1) IN ('tempo', 'tonart', 'energie')
                                     THEN substr(tag, 1, instr(tag, ':') - 1) ELSE tag END
             ORDER BY prio DESC, zeit DESC, tag) AS rn
    FROM wirksam_roh
  ) WHERE rn = 1;
