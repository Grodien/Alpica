-- =============================================================================
-- Normalized single activity category
-- =============================================================================

-- One canonical category per report, derived at crawl time from the raw
-- `activity` token list (see crawler/src/categories.js). Lets the API filter
-- with an indexed `category IN (...)` instead of FIND_IN_SET over tokens.
-- Values: skitour, freeride, hochtour, schneeschuh, eisklettern, klettersteig,
--         klettertour, bike, canyoning, wanderung, andere.
ALTER TABLE reports
  ADD COLUMN category VARCHAR(32) NULL AFTER activity;

CREATE INDEX idx_reports_category ON reports (category);
