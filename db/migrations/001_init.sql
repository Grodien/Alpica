-- =============================================================================
-- Mountain-Radar initial schema
-- =============================================================================

-- Raw, untouched payloads from source APIs. Kept so we can re-normalize later
-- without re-crawling. One row per (source, source_id), latest payload wins.
CREATE TABLE IF NOT EXISTS raw_reports (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  source        VARCHAR(64)     NOT NULL,
  source_id     VARCHAR(191)    NOT NULL,
  payload       JSON            NOT NULL,
  fetched_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_raw_source (source, source_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Normalized, queryable schema. The API reads only this table.
CREATE TABLE IF NOT EXISTS reports (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  source        VARCHAR(64)     NOT NULL,
  source_id     VARCHAR(191)    NOT NULL,
  title         VARCHAR(512)    NULL,
  report_date   DATETIME        NULL,
  latitude      DECIMAL(9,6)    NULL,
  longitude     DECIMAL(9,6)    NULL,
  place         VARCHAR(512)    NULL,
  author        VARCHAR(255)    NULL,
  thumbnail     VARCHAR(1024)   NULL,
  activity      VARCHAR(64)     NULL,
  url           VARCHAR(1024)   NULL,
  created_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_reports_source (source, source_id),
  KEY idx_reports_date (report_date),
  KEY idx_reports_latlng (latitude, longitude),
  FULLTEXT KEY ft_reports_text (title, place, author, activity)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Per-source watermark so each crawl only fetches the delta since last run.
CREATE TABLE IF NOT EXISTS crawler_state (
  source            VARCHAR(64)  NOT NULL,
  last_fetched_at   DATETIME     NULL,
  last_run_at       DATETIME     NULL,
  last_status       VARCHAR(32)  NULL,
  last_error        TEXT         NULL,
  PRIMARY KEY (source)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- API keys that authorize access to the API. Only the hash is stored.
CREATE TABLE IF NOT EXISTS api_keys (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  label         VARCHAR(255)    NOT NULL,
  key_hash      CHAR(64)        NOT NULL,
  is_active     TINYINT(1)      NOT NULL DEFAULT 1,
  created_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at  DATETIME        NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_api_keys_hash (key_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
