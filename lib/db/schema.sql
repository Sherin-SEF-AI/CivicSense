-- CivicSense store.
--
-- This is the system of record. Everything the console shows is a row here, and
-- everything an operator does writes one. There is no seeded content: the
-- database starts empty and fills as real sources are registered and real
-- observations arrive.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sources (
  source_id            TEXT PRIMARY KEY,
  source_type          TEXT NOT NULL,
  label                TEXT NOT NULL,
  site                 TEXT NOT NULL,
  zone_id              TEXT,
  lat                  REAL NOT NULL,
  lon                  REAL NOT NULL,
  heading_deg          REAL,
  fov_deg              REAL,
  range_m              REAL,
  -- How the platform actually reaches this device.
  stream_url           TEXT,
  stream_kind          TEXT,          -- rtsp | hls | file | none
  state                TEXT NOT NULL DEFAULT 'down',
  sync_quality         TEXT NOT NULL DEFAULT 'D',
  clock_offset_ms      INTEGER NOT NULL DEFAULT 0,
  calibrated_at        INTEGER,
  calibration_residual_m REAL,
  homography           TEXT,          -- JSON, row-major 3x3
  firmware             TEXT,
  edge_device          TEXT,
  privacy_class        TEXT NOT NULL DEFAULT 'public-space',
  sensor_kind          TEXT,
  representativity_m   REAL,
  owner                TEXT,
  registered_at        INTEGER NOT NULL,
  last_observation_at  INTEGER,
  attestation          REAL NOT NULL DEFAULT 0.5,
  learned_precision    REAL NOT NULL DEFAULT 0.5,
  quality              REAL NOT NULL DEFAULT 0.5
);

CREATE TABLE IF NOT EXISTS source_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id  TEXT NOT NULL REFERENCES sources(source_id) ON DELETE CASCADE,
  t          INTEGER NOT NULL,
  kind       TEXT NOT NULL,
  detail     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_source_events ON source_events(source_id, t DESC);

CREATE TABLE IF NOT EXISTS source_health (
  source_id  TEXT NOT NULL REFERENCES sources(source_id) ON DELETE CASCADE,
  t          INTEGER NOT NULL,
  uptime     REAL NOT NULL,
  fps        REAL NOT NULL,
  drops      INTEGER NOT NULL,
  latency_ms INTEGER NOT NULL,
  PRIMARY KEY (source_id, t)
);

-- The unified observation model. Every adapter writes here and nothing else
-- enters the platform.
CREATE TABLE IF NOT EXISTS observations (
  observation_id  TEXT PRIMARY KEY,
  source_id       TEXT NOT NULL REFERENCES sources(source_id) ON DELETE CASCADE,
  t_start         INTEGER NOT NULL,
  t_end           INTEGER NOT NULL,
  sync_quality    TEXT NOT NULL,
  clock_offset_ms INTEGER NOT NULL DEFAULT 0,
  lat             REAL,
  lon             REAL,
  heading_deg     REAL,
  fov_deg         REAL,
  range_m         REAL,
  pose_source     TEXT NOT NULL DEFAULT 'none',
  accuracy_m      REAL NOT NULL DEFAULT 0,
  h3              TEXT,
  payload_kind    TEXT NOT NULL,
  content_ref     TEXT,             -- sha-256 of the stored bytes
  content_meta    TEXT,             -- JSON from ffprobe or the upload
  derived         TEXT,             -- JSON: classes, counts, trigger
  quality         TEXT,             -- JSON: blur, exposure, occlusion, tamper
  privacy_class   TEXT NOT NULL DEFAULT 'public-space',
  retention_class TEXT NOT NULL DEFAULT 'incident-2y',
  device_signature TEXT,
  adapter_version TEXT NOT NULL DEFAULT 'unknown',
  received_at     INTEGER NOT NULL,
  incident_id     TEXT
);
CREATE INDEX IF NOT EXISTS idx_observations_time ON observations(t_start DESC);
CREATE INDEX IF NOT EXISTS idx_observations_source ON observations(source_id, t_start DESC);
CREATE INDEX IF NOT EXISTS idx_observations_incident ON observations(incident_id);

-- Content-addressed evidence. The hash is computed over the real bytes on
-- ingest, and the file on disk is named by it.
CREATE TABLE IF NOT EXISTS evidence (
  sha256        TEXT PRIMARY KEY,
  bytes         INTEGER NOT NULL,
  media_type    TEXT NOT NULL,
  original_name TEXT,
  stored_path   TEXT NOT NULL,
  width         INTEGER,
  height        INTEGER,
  duration_ms   INTEGER,
  fps           REAL,
  codec         TEXT,
  captured_at   INTEGER,
  ingested_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS custody (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  sha256      TEXT NOT NULL REFERENCES evidence(sha256) ON DELETE CASCADE,
  t           INTEGER NOT NULL,
  actor       TEXT NOT NULL,
  role        TEXT NOT NULL,
  action      TEXT NOT NULL,
  purpose     TEXT NOT NULL,
  hash_after  TEXT NOT NULL,
  prev_hash   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_custody ON custody(sha256, t);

CREATE TABLE IF NOT EXISTS sensor_readings (
  source_id TEXT NOT NULL REFERENCES sources(source_id) ON DELETE CASCADE,
  t         INTEGER NOT NULL,
  value     REAL NOT NULL,
  unit      TEXT NOT NULL,
  valid     INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (source_id, t)
);

CREATE TABLE IF NOT EXISTS incidents (
  incident_id     TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  domain          TEXT NOT NULL,
  situation_key   TEXT NOT NULL,
  status          TEXT NOT NULL,
  priority        TEXT NOT NULL,
  css             REAL NOT NULL,
  css_lo          REAL NOT NULL,
  css_hi          REAL NOT NULL,
  zone_id         TEXT,
  zone_label      TEXT,
  lat             REAL NOT NULL,
  lon             REAL NOT NULL,
  h3              TEXT NOT NULL,
  detected_at     INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  corroboration   REAL NOT NULL DEFAULT 0,
  acknowledged    INTEGER NOT NULL DEFAULT 0,
  department      TEXT,
  sla_due_at      INTEGER,
  dismissed_reason TEXT,
  -- The intelligence package, written by the reasoning layer when it runs.
  package_json    TEXT,
  package_at      INTEGER
);
CREATE INDEX IF NOT EXISTS idx_incidents_time ON incidents(detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status);

CREATE TABLE IF NOT EXISTS incident_actions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  incident_id TEXT NOT NULL REFERENCES incidents(incident_id) ON DELETE CASCADE,
  t           INTEGER NOT NULL,
  actor       TEXT NOT NULL,
  action      TEXT NOT NULL,
  reason      TEXT
);
CREATE INDEX IF NOT EXISTS idx_incident_actions ON incident_actions(incident_id, t);

CREATE TABLE IF NOT EXISTS zones (
  zone_id     TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  kind        TEXT NOT NULL,
  sensitivity REAL NOT NULL,
  polygon     TEXT NOT NULL,   -- JSON [[lon,lat],...]
  centroid_lat REAL NOT NULL,
  centroid_lon REAL NOT NULL,
  osm_id      INTEGER
);

CREATE TABLE IF NOT EXISTS departments (
  department    TEXT PRIMARY KEY,
  label         TEXT NOT NULL,
  domains       TEXT NOT NULL,   -- JSON string[]
  contacts      TEXT NOT NULL,   -- JSON
  sla_seconds   TEXT NOT NULL,   -- JSON by priority band
  escalation_to TEXT
);

CREATE TABLE IF NOT EXISTS playbooks (
  playbook_id  TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  domain       TEXT NOT NULL,
  min_priority TEXT NOT NULL,
  version      INTEGER NOT NULL DEFAULT 1,
  updated_at   INTEGER NOT NULL,
  steps        TEXT NOT NULL     -- JSON
);

CREATE TABLE IF NOT EXISTS budgets (
  scope           TEXT NOT NULL,
  key             TEXT NOT NULL,
  label           TEXT NOT NULL,
  daily_usd       REAL NOT NULL,
  monthly_usd     REAL NOT NULL,
  PRIMARY KEY (scope, key)
);

CREATE TABLE IF NOT EXISTS users (
  user_id            TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  email              TEXT NOT NULL,
  role               TEXT NOT NULL,
  department         TEXT,
  investigation_flag INTEGER NOT NULL DEFAULT 0,
  last_active        INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cases (
  case_id            TEXT PRIMARY KEY,
  reference          TEXT NOT NULL,
  title              TEXT NOT NULL,
  state              TEXT NOT NULL DEFAULT 'open',
  opened_at          INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL,
  owner              TEXT NOT NULL,
  legal_hold         INTEGER NOT NULL DEFAULT 0,
  investigation_flag INTEGER NOT NULL DEFAULT 0,
  certificate        TEXT
);

CREATE TABLE IF NOT EXISTS case_incidents (
  case_id     TEXT NOT NULL REFERENCES cases(case_id) ON DELETE CASCADE,
  incident_id TEXT NOT NULL,
  PRIMARY KEY (case_id, incident_id)
);

CREATE TABLE IF NOT EXISTS case_evidence (
  case_id TEXT NOT NULL REFERENCES cases(case_id) ON DELETE CASCADE,
  sha256  TEXT NOT NULL,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (case_id, sha256)
);

CREATE TABLE IF NOT EXISTS case_notes (
  note_id      TEXT PRIMARY KEY,
  case_id      TEXT NOT NULL REFERENCES cases(case_id) ON DELETE CASCADE,
  t            INTEGER NOT NULL,
  author       TEXT NOT NULL,
  text         TEXT NOT NULL,
  evidence_ids TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS case_tasks (
  task_id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(case_id) ON DELETE CASCADE,
  text    TEXT NOT NULL,
  owner   TEXT NOT NULL,
  due_at  INTEGER,
  state   TEXT NOT NULL DEFAULT 'open'
);

CREATE TABLE IF NOT EXISTS case_bundles (
  bundle_id        TEXT PRIMARY KEY,
  case_id          TEXT NOT NULL REFERENCES cases(case_id) ON DELETE CASCADE,
  recipient_class  TEXT NOT NULL,
  recipient        TEXT NOT NULL,
  created_at       INTEGER NOT NULL,
  evidence_ids     TEXT NOT NULL,
  redaction_preset TEXT NOT NULL,
  redactions       TEXT NOT NULL,
  manifest_hash    TEXT NOT NULL,
  certificate_issued INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS case_exports (
  export_id     TEXT PRIMARY KEY,
  case_id       TEXT NOT NULL REFERENCES cases(case_id) ON DELETE CASCADE,
  t             INTEGER NOT NULL,
  actor         TEXT NOT NULL,
  kind          TEXT NOT NULL,
  recipient     TEXT NOT NULL,
  manifest_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS saved_searches (
  saved_search_id       TEXT PRIMARY KEY,
  name                  TEXT NOT NULL,
  query                 TEXT NOT NULL,
  created_at            INTEGER NOT NULL,
  rerun_on_new_evidence INTEGER NOT NULL DEFAULT 1,
  last_run_at           INTEGER NOT NULL,
  new_hits              INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS warnings (
  warning_id   TEXT PRIMARY KEY,
  level        TEXT NOT NULL,
  domain       TEXT NOT NULL,
  zone_id      TEXT,
  zone_label   TEXT,
  lat          REAL NOT NULL,
  lon          REAL NOT NULL,
  h3           TEXT NOT NULL,
  headline     TEXT NOT NULL,
  issued_at    INTEGER NOT NULL,
  horizon_h    INTEGER NOT NULL,
  crossing_at  INTEGER NOT NULL,
  confidence   REAL NOT NULL,
  indicators   TEXT NOT NULL,
  cascade      TEXT NOT NULL,
  interventions TEXT NOT NULL,
  acknowledged INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS taskings (
  tasking_id        TEXT PRIMARY KEY,
  warning_id        TEXT,
  intervention_id   TEXT NOT NULL,
  intervention_label TEXT NOT NULL,
  zone_label        TEXT NOT NULL,
  department        TEXT NOT NULL,
  assigned_source_id TEXT,
  assigned_label    TEXT,
  eta_minutes       REAL,
  created_at        INTEGER NOT NULL,
  state             TEXT NOT NULL DEFAULT 'tasked'
);

CREATE TABLE IF NOT EXISTS calibration_runs (
  run_id     TEXT PRIMARY KEY,
  source_id  TEXT NOT NULL REFERENCES sources(source_id) ON DELETE CASCADE,
  started_at INTEGER NOT NULL,
  state      TEXT NOT NULL,
  detail     TEXT NOT NULL,
  residual_m REAL
);

CREATE TABLE IF NOT EXISTS interventions_applied (
  outcome_id        TEXT PRIMARY KEY,
  intervention_label TEXT NOT NULL,
  zone_label        TEXT NOT NULL,
  domain            TEXT NOT NULL,
  applied_at        INTEGER NOT NULL,
  before_rate       REAL NOT NULL,
  after_rate        REAL NOT NULL,
  delta_pct         REAL NOT NULL,
  ci_lo             REAL NOT NULL,
  ci_hi             REAL NOT NULL,
  control_zones     INTEGER NOT NULL,
  significant       INTEGER NOT NULL
);

-- Hash-chained audit. Every stage transition and every operator action.
CREATE TABLE IF NOT EXISTS audit (
  seq       INTEGER PRIMARY KEY AUTOINCREMENT,
  t         INTEGER NOT NULL,
  actor     TEXT NOT NULL,
  action    TEXT NOT NULL,
  subject   TEXT NOT NULL,
  detail    TEXT NOT NULL,
  hash      TEXT NOT NULL,
  prev_hash TEXT NOT NULL
);

-- Every model call the reasoning layer makes, with what it cost.
CREATE TABLE IF NOT EXISTS model_calls (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  t           INTEGER NOT NULL,
  incident_id TEXT,
  role        TEXT NOT NULL,
  model       TEXT NOT NULL,
  tier        TEXT NOT NULL,
  tokens_in   INTEGER NOT NULL,
  tokens_out  INTEGER NOT NULL,
  cost_usd    REAL NOT NULL,
  latency_ms  INTEGER NOT NULL,
  cached      INTEGER NOT NULL DEFAULT 0,
  fallback_from TEXT,
  ok          INTEGER NOT NULL DEFAULT 1,
  error       TEXT
);
CREATE INDEX IF NOT EXISTS idx_model_calls_time ON model_calls(t DESC);

CREATE TABLE IF NOT EXISTS queries (
  query_id   TEXT PRIMARY KEY,
  question   TEXT NOT NULL,
  asked_at   INTEGER NOT NULL,
  asked_by   TEXT NOT NULL,
  guard      TEXT NOT NULL,
  trace      TEXT NOT NULL,
  answer     TEXT NOT NULL,
  citations  TEXT NOT NULL,
  table_json TEXT,
  model      TEXT NOT NULL,
  cost_usd   REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
