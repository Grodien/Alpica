-- =============================================================================
-- Per-API-key rate limiting
-- =============================================================================

-- Optional hourly request cap per API key.
--   NULL  => unlimited (no counting, no limit)
--   N     => at most N requests per fixed hour window
ALTER TABLE api_keys
  ADD COLUMN rate_limit_per_hour INT UNSIGNED NULL DEFAULT NULL AFTER is_active;

-- Request counters per key and fixed hour window. One row per (key, hour).
-- Counting uses INSERT ... ON DUPLICATE KEY UPDATE so it is atomic and survives
-- restarts (unlike an in-memory counter).
CREATE TABLE IF NOT EXISTS api_key_usage (
  api_key_id    BIGINT UNSIGNED NOT NULL,
  window_start  DATETIME        NOT NULL,
  request_count INT UNSIGNED    NOT NULL DEFAULT 0,
  PRIMARY KEY (api_key_id, window_start),
  CONSTRAINT fk_usage_api_key
    FOREIGN KEY (api_key_id) REFERENCES api_keys (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
