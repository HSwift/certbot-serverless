PRAGMA foreign_keys = ON;

CREATE TABLE certificates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  authority TEXT NOT NULL CHECK (authority IN ('letsencrypt', 'cloudflare-origin')),
  primary_domain TEXT NOT NULL,
  domains_json TEXT NOT NULL,
  key_type TEXT NOT NULL CHECK (key_type IN ('ec-p256', 'rsa-2048')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'issuing', 'active', 'failed', 'revoked')),
  auto_renew INTEGER NOT NULL DEFAULT 1 CHECK (auto_renew IN (0, 1)),
  renew_before_days INTEGER NOT NULL DEFAULT 30,
  origin_validity_days INTEGER,
  acme_email TEXT,
  current_version_id TEXT,
  issuer TEXT,
  serial_number TEXT,
  fingerprint_sha256 TEXT,
  not_before TEXT,
  expires_at TEXT,
  next_renewal_at TEXT,
  last_issued_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX certificates_status_idx ON certificates(status);
CREATE INDEX certificates_renewal_idx ON certificates(auto_renew, next_renewal_at);

CREATE TABLE certificate_versions (
  id TEXT PRIMARY KEY,
  certificate_id TEXT NOT NULL REFERENCES certificates(id) ON DELETE CASCADE,
  authority_certificate_id TEXT,
  r2_key TEXT NOT NULL UNIQUE,
  issuer TEXT NOT NULL,
  serial_number TEXT,
  fingerprint_sha256 TEXT NOT NULL,
  not_before TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX certificate_versions_certificate_idx
  ON certificate_versions(certificate_id, created_at DESC);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  certificate_id TEXT NOT NULL REFERENCES certificates(id) ON DELETE CASCADE,
  workflow_instance_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('issue', 'renew')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  error TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
);

CREATE INDEX jobs_certificate_idx ON jobs(certificate_id, created_at DESC);

CREATE TABLE download_tokens (
  nonce TEXT PRIMARY KEY,
  certificate_id TEXT NOT NULL REFERENCES certificates(id) ON DELETE CASCADE,
  version_id TEXT NOT NULL REFERENCES certificate_versions(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX download_tokens_expiry_idx ON download_tokens(expires_at);

CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  certificate_id TEXT,
  detail_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX audit_log_created_idx ON audit_log(created_at DESC);
