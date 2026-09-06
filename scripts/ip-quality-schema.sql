CREATE TABLE IF NOT EXISTS ip_quality_reports (
  server_id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  last_attempt INTEGER,
  last_success INTEGER,
  ip_fingerprint TEXT,
  report TEXT,
  error TEXT
);
