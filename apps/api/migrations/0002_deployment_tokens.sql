PRAGMA foreign_keys = ON;

CREATE TABLE deployment_tokens (
  id TEXT PRIMARY KEY,
  certificate_id TEXT NOT NULL REFERENCES certificates(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  last_version_id TEXT REFERENCES certificate_versions(id) ON DELETE SET NULL,
  revoked_at TEXT
);

CREATE INDEX deployment_tokens_certificate_idx
  ON deployment_tokens(certificate_id, created_at DESC);
