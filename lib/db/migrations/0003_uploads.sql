-- Operator uploads, and the adjudication that stands between a model's reading
-- and an incident record.
--
-- Everything else in this system arrives from a registered device that says
-- what it saw. An uploaded file says nothing: its location, its time and its
-- provenance are whatever the person handing it over states, and a model
-- looking at sampled frames is the only thing that can say what is in it.
--
-- So an upload never forms an incident on its own. The detection is stored as a
-- proposal with the frames it was drawn from, and a person confirms or rejects
-- it. That gate is the whole reason this table exists rather than the upload
-- path simply calling the same trigger the edge agents call.

CREATE TABLE IF NOT EXISTS uploads (
  upload_id        TEXT PRIMARY KEY,
  sha256           TEXT NOT NULL REFERENCES evidence(sha256) ON DELETE CASCADE,
  source_id        TEXT NOT NULL REFERENCES sources(source_id) ON DELETE CASCADE,
  observation_id   TEXT,
  uploaded_by      TEXT NOT NULL,
  uploaded_at      INTEGER NOT NULL,
  purpose          TEXT NOT NULL,
  original_name    TEXT,
  media_kind       TEXT NOT NULL,          -- video | audio | image | sensor
  -- Stated by the uploader, not measured. Kept apart from anything the platform
  -- established for itself so the two are never confused downstream.
  stated_lat       REAL,
  stated_lon       REAL,
  stated_captured_at INTEGER,
  stated_note      TEXT NOT NULL DEFAULT '',
  -- What the file itself claims, from its own container metadata.
  container_captured_at INTEGER,
  duration_ms      INTEGER,
  analysis         TEXT,                   -- JSON: detection, transcript, acquisition
  state            TEXT NOT NULL DEFAULT 'analysed'
);
CREATE INDEX IF NOT EXISTS idx_uploads_state ON uploads(state, uploaded_at DESC);

CREATE TABLE IF NOT EXISTS upload_detections (
  detection_id     TEXT PRIMARY KEY,
  upload_id        TEXT NOT NULL REFERENCES uploads(upload_id) ON DELETE CASCADE,
  classes          TEXT NOT NULL DEFAULT '[]',
  confidence       REAL NOT NULL DEFAULT 0,
  summary          TEXT NOT NULL DEFAULT '',
  proposed_situation TEXT,
  situation_confidence REAL NOT NULL DEFAULT 0,
  situation_reason TEXT NOT NULL DEFAULT '',
  frames_examined  INTEGER NOT NULL DEFAULT 0,
  model            TEXT NOT NULL DEFAULT '',
  -- open until a person rules on it. an incident cannot exist without this
  -- having been set to confirmed by a named actor.
  adjudication     TEXT NOT NULL DEFAULT 'open',
  adjudicated_by   TEXT,
  adjudicated_at   INTEGER,
  adjudication_note TEXT NOT NULL DEFAULT '',
  incident_id      TEXT
);
CREATE INDEX IF NOT EXISTS idx_upload_detections_open ON upload_detections(adjudication, detection_id);
