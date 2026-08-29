-- Clock models, and the observations they are fitted from.
--
-- Every source has its own clock and every one of them is wrong. The question a
-- forensic record has to answer is not what a device's timestamp said but what
-- true time that timestamp corresponds to, and with what uncertainty. Those are
-- different questions and only the second one can be defended.
--
-- Raw timestamps are never edited. An observation is a measurement of the
-- relationship between a source's clock and true time, and the model is fitted
-- from those. That way the correction is always visible and always reversible,
-- and a later, better observation improves the answer rather than compounding
-- an earlier adjustment.

CREATE TYPE sync_method AS ENUM (
  'ntp',          -- the source disciplined itself and reported the offset
  'gnss',         -- pulse per second, the best a field device gets
  'burned_ocr',   -- the recorder's own overlay, read from the picture
  'pts_anchor',   -- container timing against a known arrival
  'gcc_phat',     -- a transient heard by two sources at once
  'visual_event', -- a flash or an object crossing a surveyed line, seen by two
  'manual'        -- an operator stated it, which is a claim not a measurement
);

CREATE TABLE sync_observation (
  observation_id bigserial PRIMARY KEY,
  source_id      text NOT NULL,
  -- What the source's own clock read, and what true time that was.
  t_source_ms    bigint NOT NULL,
  t_utc_ms       bigint NOT NULL,
  sigma_ms       double precision NOT NULL,
  method         sync_method NOT NULL,
  -- For a pairwise method, the other source involved.
  peer_source_id text,
  evidence_ref   text,
  detail         text NOT NULL DEFAULT '',
  created_at     timestamptz NOT NULL DEFAULT now(),

  -- An observation with no stated uncertainty is not a measurement.
  CONSTRAINT sigma_is_positive CHECK (sigma_ms > 0)
);
CREATE INDEX idx_sync_observation_source ON sync_observation(source_id, t_source_ms);

-- A clock model holds over a span and no further. A reboot, a manual set or an
-- NTP step ends one segment and begins another, and fitting across such a break
-- produces a drift rate that describes the step rather than the oscillator.
CREATE TABLE clock_segment (
  source_id    text NOT NULL,
  seq          int  NOT NULL,
  t_from_ms    bigint NOT NULL,
  t_to_ms      bigint NOT NULL,
  offset_ms    double precision NOT NULL,
  drift_ppm    double precision NOT NULL,
  -- Standard error of the fit, and of the drift term, kept apart because they
  -- grow differently with distance from the observations.
  offset_se_ms double precision NOT NULL,
  drift_se_ppm double precision NOT NULL,
  n_obs        int NOT NULL,
  residual_ms  double precision NOT NULL,
  drift_measurable boolean NOT NULL DEFAULT false,
  fitted_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_id, seq)
);
