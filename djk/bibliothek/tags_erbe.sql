-- Inheritance as set operations (no recursion, so cycles end). Run by both sides; this file only COMPUTES, it writes nothing to
-- the main database, so it holds no write lock. Contract:
--   in : temp.erbe_ziel(item TEXT PRIMARY KEY), created and seeded by the caller with the items to recompute.
--   out: temp.erbe_weg(item, tag)          derived rows (herkunft abgeleitet, quelle erbe) to delete
--        temp.erbe_dazu(item, tag, tiefe)  derived rows to insert; `tiefe` goes to item_tag.wert (hops from a real source)
-- The caller then applies erbe_weg and erbe_dazu in batches of at most 500 rows per transaction (weg first). Unchanged rows are in
-- neither table, so a second run writes nothing. Only rows with herkunft = 'abgeleitet' AND quelle = 'erbe' are ever touched.
DROP TABLE IF EXISTS temp.erbe_neu;
DROP TABLE IF EXISTS temp.erbe_q;
DROP TABLE IF EXISTS temp.erbe_eigen;
DROP TABLE IF EXISTS temp.erbe_weg;
DROP TABLE IF EXISTS temp.erbe_dazu;

-- The descendants of the seed (3 hops along made_from) must be recomputed too.
INSERT OR IGNORE INTO erbe_ziel SELECT von FROM relation WHERE art = 'made_from' AND nach IN (SELECT item FROM erbe_ziel);
INSERT OR IGNORE INTO erbe_ziel SELECT von FROM relation WHERE art = 'made_from' AND nach IN (SELECT item FROM erbe_ziel);
INSERT OR IGNORE INTO erbe_ziel SELECT von FROM relation WHERE art = 'made_from' AND nach IN (SELECT item FROM erbe_ziel);

CREATE TEMP TABLE erbe_neu(item TEXT NOT NULL, tag TEXT NOT NULL, tiefe INTEGER NOT NULL, PRIMARY KEY (item, tag));
CREATE TEMP TABLE erbe_q(item TEXT NOT NULL, tag TEXT NOT NULL, tiefe INTEGER NOT NULL, PRIMARY KEY (item, tag));

-- Targets with an own effective genre:* (any producer but erbe) inherit none.
CREATE TEMP TABLE erbe_eigen AS
  SELECT DISTINCT z.item AS item FROM erbe_ziel z CROSS JOIN wirksam_roh w ON w.item = z.item
  WHERE substr(w.tag, 1, 6) = 'genre:' AND NOT (w.herkunft = 'abgeleitet' AND w.quelle = 'erbe');

-- Genre sources: the sources of the targets. A source outside the targets counts with what it stores (derived rows with their
-- depth), a source inside the targets counts with its own rows only, the passes below add what it inherits.
INSERT OR IGNORE INTO erbe_q
  SELECT w.item, w.tag, CASE WHEN w.herkunft = 'abgeleitet' AND w.quelle = 'erbe' THEN COALESCE(w.wert, 0) ELSE 0 END
  FROM wirksam_roh w
  WHERE w.item IN (SELECT nach FROM relation WHERE art = 'made_from' AND von IN (SELECT item FROM erbe_ziel))
    AND substr(w.tag, 1, 6) = 'genre:'
    AND (w.item NOT IN (SELECT item FROM erbe_ziel) OR NOT (w.herkunft = 'abgeleitet' AND w.quelle = 'erbe'));

-- Genre along made_from: a target without its own genre takes the genre:* rows of its source. Three fixed passes = at most 3 hops
-- (pass k takes from sources at depth k - 1; a target that took in an earlier pass takes nothing later).
INSERT OR IGNORE INTO erbe_neu(item, tag, tiefe)
  SELECT r.von, q.tag, 1 FROM relation r JOIN erbe_q q ON q.item = r.nach AND q.tiefe = 0
  WHERE r.art = 'made_from' AND r.von IN (SELECT item FROM erbe_ziel) AND r.von NOT IN (SELECT item FROM erbe_eigen);
INSERT OR IGNORE INTO erbe_q SELECT item, tag, tiefe FROM erbe_neu WHERE tiefe = 1;
INSERT OR IGNORE INTO erbe_neu(item, tag, tiefe)
  SELECT r.von, q.tag, 2 FROM relation r JOIN erbe_q q ON q.item = r.nach AND q.tiefe = 1
  WHERE r.art = 'made_from' AND r.von IN (SELECT item FROM erbe_ziel) AND r.von NOT IN (SELECT item FROM erbe_eigen)
    AND NOT EXISTS (SELECT 1 FROM erbe_neu n WHERE n.item = r.von AND n.tiefe < 2);
INSERT OR IGNORE INTO erbe_q SELECT item, tag, tiefe FROM erbe_neu WHERE tiefe = 2;
INSERT OR IGNORE INTO erbe_neu(item, tag, tiefe)
  SELECT r.von, q.tag, 3 FROM relation r JOIN erbe_q q ON q.item = r.nach AND q.tiefe = 2
  WHERE r.art = 'made_from' AND r.von IN (SELECT item FROM erbe_ziel) AND r.von NOT IN (SELECT item FROM erbe_eigen)
    AND NOT EXISTS (SELECT 1 FROM erbe_neu n WHERE n.item = r.von AND n.tiefe < 3);

-- A kit takes the union of the typ:* of the items it is made from (their own effective rows, not what they inherited).
INSERT OR IGNORE INTO erbe_neu(item, tag, tiefe)
  SELECT r.von, w.tag, 0 FROM relation r JOIN wirksam_roh w ON w.item = r.nach AND substr(w.tag, 1, 4) = 'typ:'
  WHERE r.art = 'made_from' AND substr(r.von, 1, 4) = 'kit:' AND r.von IN (SELECT item FROM erbe_ziel)
    AND NOT (w.herkunft = 'abgeleitet' AND w.quelle = 'erbe');

CREATE TEMP TABLE erbe_weg AS
  SELECT t.item AS item, t.tag AS tag FROM item_tag t
  WHERE t.herkunft = 'abgeleitet' AND t.quelle = 'erbe' AND t.item IN (SELECT item FROM erbe_ziel)
    AND NOT EXISTS (SELECT 1 FROM erbe_neu n WHERE n.item = t.item AND n.tag = t.tag AND n.tiefe IS t.wert);
CREATE TEMP TABLE erbe_dazu AS
  SELECT n.item AS item, n.tag AS tag, n.tiefe AS tiefe FROM erbe_neu n
  WHERE NOT EXISTS (SELECT 1 FROM item_tag t WHERE t.item = n.item AND t.tag = n.tag AND t.herkunft = 'abgeleitet'
                      AND t.quelle = 'erbe' AND t.wert IS n.tiefe);
