-- =============================================================================
-- Extend free-text search to include the `description` column
-- =============================================================================
--
-- The original FULLTEXT index ft_reports_text covered (title, place, author,
-- activity) only, so report descriptions (added later) were not searchable.
-- Add a second FULLTEXT index that also includes description, used by the
-- search query's MATCH clause.

CREATE FULLTEXT INDEX ft_reports_text_desc
  ON reports (title, place, author, activity, description);
