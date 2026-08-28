-- Vault v2: chunk trees, device keys and signature verdicts.
--
-- A whole-file digest proves an object is intact and nothing more. Chunk trees
-- let one segment of a long recording be proved a member of the original
-- without shipping the rest, which is what a partial disclosure needs.
--
-- Device signing turns provenance from an assertion into a check. Until now
-- `observations.device_signature` was an opaque string that nothing verified,
-- and it nonetheless decided the authenticity verdict shown to an operator.

CREATE TABLE IF NOT EXISTS evidence_merkle (
  sha256      TEXT PRIMARY KEY REFERENCES evidence(sha256) ON DELETE CASCADE,
  root        TEXT NOT NULL,
  chunk_size  INTEGER NOT NULL,
  leaf_count  INTEGER NOT NULL,
  algo        TEXT NOT NULL DEFAULT 'sha256-16m-v1',
  computed_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS evidence_chunks (
  sha256 TEXT NOT NULL REFERENCES evidence(sha256) ON DELETE CASCADE,
  idx    INTEGER NOT NULL,
  offset INTEGER NOT NULL,
  len    INTEGER NOT NULL,
  digest TEXT NOT NULL,
  PRIMARY KEY (sha256, idx)
);

-- Enrolled capture keys. Without a hardware root of trust this is trust on
-- first use: the chain proves an object was signed by the key enrolled for a
-- source, not that the device was ever the only holder of that key. That
-- limitation is stated in the certificate rather than left for someone to
-- discover.
CREATE TABLE IF NOT EXISTS device_keys (
  key_id           TEXT PRIMARY KEY,
  source_id        TEXT NOT NULL REFERENCES sources(source_id) ON DELETE CASCADE,
  public_key       TEXT NOT NULL,           -- base64, raw 32 byte ed25519
  algo             TEXT NOT NULL DEFAULT 'ed25519',
  enrolled_at      INTEGER NOT NULL,
  enrolled_by      TEXT NOT NULL,
  enrolment_method TEXT NOT NULL DEFAULT 'operator-entered',
  revoked_at       INTEGER,
  revoked_reason   TEXT
);
CREATE INDEX IF NOT EXISTS idx_device_keys_source ON device_keys(source_id, revoked_at);

CREATE TABLE IF NOT EXISTS device_signatures (
  sha256      TEXT PRIMARY KEY REFERENCES evidence(sha256) ON DELETE CASCADE,
  key_id      TEXT,
  verdict     TEXT NOT NULL,               -- verified | bad_signature | no_key | unverified
  detail      TEXT NOT NULL DEFAULT '',
  signed_over TEXT,                        -- the digest the signature covers
  verified_at INTEGER NOT NULL
);
