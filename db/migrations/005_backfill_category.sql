-- =============================================================================
-- Backfill `category` for existing reports
-- =============================================================================
--
-- Sets the normalized single category for rows that don't have one yet, using
-- the SAME priority order as crawler/src/categories.js:
--   Skitour > Freeride > Hochtour > Schneeschuh > Eisklettern > Klettersteig >
--   Klettertour > Bike > Canyoning > Wanderung > andere
--
-- The `activity` column holds a comma-separated token list (e.g.
-- "rock_climbing, mountain_climbing"); we lower-case it and match tokens with
-- LIKE. The first matching WHEN (highest priority) wins — this mirrors the
-- JS categorize() tie-break. "paragliding" is not matched here, so a report
-- whose only activity is paragliding falls through to 'andere' (as intended);
-- combined ones are decided by their main activity.
--
-- Idempotent: only touches rows where category IS NULL, so re-running (or a
-- later crawl that already set the category) is safe.

UPDATE reports
SET category = CASE
  WHEN LOWER(activity) LIKE '%skitour%'                                          THEN 'skitour'
  WHEN LOWER(activity) LIKE '%freeride%'                                         THEN 'freeride'
  WHEN LOWER(activity) LIKE '%mountain%climb%'
    OR LOWER(activity) LIKE '%alpin%'
    OR LOWER(activity) LIKE '%mountaineer%'
    OR LOWER(activity) LIKE '%hochtour%'
    OR LOWER(activity) LIKE '%snow%ice%'                                         THEN 'hochtour'
  WHEN LOWER(activity) LIKE '%snowshoe%'
    OR LOWER(activity) LIKE '%schneeschuh%'
    OR LOWER(activity) LIKE '%raquette%'                                         THEN 'schneeschuh'
  WHEN LOWER(activity) LIKE '%ice%climb%'
    OR LOWER(activity) LIKE '%cascade%'
    OR LOWER(activity) LIKE '%glace%'                                            THEN 'eisklettern'
  WHEN LOWER(activity) LIKE '%via%ferrata%'
    OR LOWER(activity) LIKE '%klettersteig%'                                     THEN 'klettersteig'
  WHEN LOWER(activity) LIKE '%rock%climb%'
    OR LOWER(activity) LIKE '%escalade%'
    OR LOWER(activity) LIKE '%klettern%'                                         THEN 'klettertour'
  WHEN LOWER(activity) LIKE '%bike%'
    OR LOWER(activity) LIKE '%biking%'
    OR LOWER(activity) LIKE '%vtt%'
    OR LOWER(activity) LIKE '%velo%'                                             THEN 'bike'
  WHEN LOWER(activity) LIKE '%canyon%'                                           THEN 'canyoning'
  WHEN LOWER(activity) LIKE '%hik%'
    OR LOWER(activity) LIKE '%rando%'
    OR LOWER(activity) LIKE '%wander%'                                           THEN 'wanderung'
  ELSE 'andere'
END
WHERE category IS NULL;
