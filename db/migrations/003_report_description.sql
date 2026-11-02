-- =============================================================================
-- Report description
-- =============================================================================

-- A short free-text description/summary of the report, extracted per source
-- (powderguide title, skitour recit/cond, gipfelbuch route). May be NULL when
-- the source provides no description (e.g. camptocamp), in which case the UI
-- falls back to the `place` field.
ALTER TABLE reports
  ADD COLUMN description VARCHAR(1024) NULL AFTER place;
