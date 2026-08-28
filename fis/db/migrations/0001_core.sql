-- FIS core: operators, recipes, derivatives, jobs, and the class gate.
--
-- The class gate is the reason most of this exists. Every tool is an operator
-- carrying an evidence class: E is evidentiary and must be deterministic and
-- non-generative, I is investigative and needs a human to adjudicate it, D is
-- demonstrative and may be generative. A chain of operators is a recipe, and the
-- derivative it produces is only as strong as its weakest step.
--
-- That rule is enforced here rather than in application code, because an export
-- is the moment it matters and a future route author must not be able to route
-- around it by writing their own query.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TYPE evidence_class AS ENUM ('E', 'I', 'D');

-- Strength ordering, used by the gate. E is strongest.
CREATE FUNCTION class_rank(c evidence_class) RETURNS int
  LANGUAGE sql IMMUTABLE PARALLEL SAFE AS
$$ SELECT CASE c WHEN 'E' THEN 3 WHEN 'I' THEN 2 ELSE 1 END $$;

CREATE FUNCTION weaker_of(a evidence_class, b evidence_class) RETURNS evidence_class
  LANGUAGE sql IMMUTABLE PARALLEL SAFE AS
$$ SELECT CASE WHEN class_rank(a) <= class_rank(b) THEN a ELSE b END $$;

-- ---------------------------------------------------------------- operators

-- One row per operator version per container build. The registry is dumped at
-- image build time and its digest is an image label, so what an operator was
-- when it ran is recoverable from the recipe alone.
CREATE TABLE operator (
  operator_id      text        NOT NULL,
  version          text        NOT NULL,
  class            evidence_class NOT NULL,
  container_digest text        NOT NULL,
  registry_digest  text        NOT NULL,
  params_schema    jsonb       NOT NULL,
  input_kinds      text[]      NOT NULL,
  output_kinds     text[]      NOT NULL,
  gpu              boolean     NOT NULL DEFAULT false,
  deterministic    boolean     NOT NULL DEFAULT false,
  runtime          text        NOT NULL,
  max_runtime_s    int         NOT NULL DEFAULT 300,
  summary          text        NOT NULL DEFAULT '',
  registered_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (operator_id, version, container_digest),

  -- Class E means CPU. A GPU float reduction is not reproducible across driver
  -- versions, and this host will get driver updates. Nothing evidentiary needs
  -- the GPU, so the contradiction is resolved by refusing the combination
  -- rather than by weakening what E means.
  CONSTRAINT class_e_is_cpu_only CHECK (NOT (class = 'E' AND gpu)),
  CONSTRAINT class_e_is_deterministic CHECK (NOT (class = 'E' AND NOT deterministic))
);

-- ------------------------------------------------------------------ vault

-- The mirror of an evidence object. sha256 is the console's identity for it;
-- merkle_root is what a partial disclosure proves membership against.
CREATE TABLE evidence_object (
  sha256        text PRIMARY KEY,
  merkle_root   text NOT NULL,
  chunk_size    int  NOT NULL,
  leaf_count    int  NOT NULL,
  byte_len      bigint NOT NULL,
  media_type    text NOT NULL,
  bucket        text NOT NULL DEFAULT 'fis-vault',
  object_key    text,
  key_domain    text NOT NULL DEFAULT 'default',
  signature_verdict text NOT NULL DEFAULT 'unverified',
  imported_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE evidence_chunk (
  sha256 text NOT NULL REFERENCES evidence_object(sha256) ON DELETE CASCADE,
  idx    int  NOT NULL,
  "offset" bigint NOT NULL,
  len    int  NOT NULL,
  digest text NOT NULL,
  PRIMARY KEY (sha256, idx)
);

-- ------------------------------------------------------------------ recipes

CREATE TABLE recipe (
  recipe_digest text PRIMARY KEY,
  input_sha256  text NOT NULL,
  input_merkle  text NOT NULL,
  env           jsonb NOT NULL,
  body          jsonb NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE recipe_step (
  recipe_digest    text NOT NULL REFERENCES recipe(recipe_digest) ON DELETE CASCADE,
  i                int  NOT NULL,
  operator_id      text NOT NULL,
  version          text NOT NULL,
  container_digest text NOT NULL,
  registry_digest  text NOT NULL,
  class            evidence_class NOT NULL,
  params           jsonb NOT NULL,
  params_digest    text NOT NULL,
  output_kind      text NOT NULL,
  output_digest    text,
  external_process boolean NOT NULL DEFAULT false,
  PRIMARY KEY (recipe_digest, i)
);

-- ------------------------------------------------------------- derivatives

CREATE TABLE derivative (
  derivative_id text PRIMARY KEY,
  parent_sha256 text NOT NULL,
  recipe_digest text NOT NULL REFERENCES recipe(recipe_digest),
  output_digest text NOT NULL,
  output_kind   text NOT NULL,
  byte_len      bigint NOT NULL,
  bucket        text NOT NULL DEFAULT 'fis-derivatives',
  object_key    text NOT NULL,
  -- Maintained by trigger from the recipe steps. A writer cannot set it.
  class_floor   evidence_class NOT NULL DEFAULT 'D',
  incident_id   text,
  produced_by   text NOT NULL,
  produced_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_derivative_parent ON derivative(parent_sha256);
CREATE INDEX idx_derivative_incident ON derivative(incident_id);

-- The floor is computed, never supplied. Any explicit value is overwritten, so
-- a caller that tries to declare its own strength simply does not get to.
CREATE FUNCTION derivative_class_floor() RETURNS trigger
  LANGUAGE plpgsql AS
$$
DECLARE
  floor evidence_class;
  has_external boolean;
BEGIN
  -- The weakest step, taken as a class rather than as a rank so the value can
  -- be assigned straight back.
  SELECT s.class INTO floor
    FROM recipe_step s
   WHERE s.recipe_digest = NEW.recipe_digest
   ORDER BY class_rank(s.class) ASC, s.i ASC
   LIMIT 1;

  IF floor IS NULL THEN
    RAISE EXCEPTION 'recipe % has no steps, so it has no class', NEW.recipe_digest;
  END IF;

  SELECT bool_or(external_process) INTO has_external
    FROM recipe_step WHERE recipe_digest = NEW.recipe_digest;

  -- Bytes that left the container for a tool outside its pinned manifest cannot
  -- be shown to be deterministic, so they can never be evidentiary.
  IF has_external THEN
    floor := weaker_of(floor, 'I');
  END IF;

  NEW.class_floor := floor;
  RETURN NEW;
END
$$;

CREATE TRIGGER derivative_class_floor_trg
  BEFORE INSERT OR UPDATE ON derivative
  FOR EACH ROW EXECUTE FUNCTION derivative_class_floor();

-- ------------------------------------------------------------- disclosure

CREATE TABLE disclosure_bundle (
  bundle_id       text PRIMARY KEY,
  incident_id     text NOT NULL,
  case_id         text,
  recipient_class text NOT NULL,
  -- Every recipient class defaults to evidentiary only. Anything weaker has to
  -- be acknowledged in writing, by name.
  min_class       evidence_class NOT NULL DEFAULT 'E',
  created_by      text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  sealed_at       timestamptz
);

CREATE TABLE demonstrative_ack (
  bundle_id     text NOT NULL REFERENCES disclosure_bundle(bundle_id) ON DELETE CASCADE,
  derivative_id text NOT NULL REFERENCES derivative(derivative_id) ON DELETE CASCADE,
  approved_by   text NOT NULL,
  reason        text NOT NULL,
  approved_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bundle_id, derivative_id),
  CONSTRAINT reason_is_written CHECK (length(btrim(reason)) >= 20)
);

CREATE TABLE disclosure_item (
  bundle_id     text NOT NULL REFERENCES disclosure_bundle(bundle_id) ON DELETE CASCADE,
  derivative_id text NOT NULL REFERENCES derivative(derivative_id),
  added_by      text NOT NULL,
  added_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bundle_id, derivative_id)
);

-- The gate. An item weaker than the bundle's minimum is refused unless a named
-- person has acknowledged it in writing for that specific bundle.
CREATE FUNCTION disclosure_class_gate() RETURNS trigger
  LANGUAGE plpgsql AS
$$
DECLARE
  item_class evidence_class;
  bundle_min evidence_class;
  acked boolean;
BEGIN
  SELECT class_floor INTO item_class FROM derivative WHERE derivative_id = NEW.derivative_id;
  SELECT min_class    INTO bundle_min FROM disclosure_bundle WHERE bundle_id = NEW.bundle_id;

  IF class_rank(item_class) < class_rank(bundle_min) THEN
    SELECT EXISTS (
      SELECT 1 FROM demonstrative_ack
       WHERE bundle_id = NEW.bundle_id AND derivative_id = NEW.derivative_id
    ) INTO acked;

    IF NOT acked THEN
      RAISE EXCEPTION
        'class_floor_below_bundle_minimum: derivative % is class % and bundle % requires at least %',
        NEW.derivative_id, item_class, NEW.bundle_id, bundle_min
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER disclosure_class_gate_trg
  BEFORE INSERT OR UPDATE ON disclosure_item
  FOR EACH ROW EXECUTE FUNCTION disclosure_class_gate();

-- ------------------------------------------------------------------- jobs

CREATE TYPE job_state AS ENUM ('pending', 'ready', 'claimed', 'running', 'done', 'failed', 'cancelled');

CREATE TABLE job_graph (
  graph_id    text PRIMARY KEY,
  incident_id text,
  kind        text NOT NULL,
  budget      jsonb NOT NULL DEFAULT '{}'::jsonb,
  spent       jsonb NOT NULL DEFAULT '{}'::jsonb,
  state       job_state NOT NULL DEFAULT 'pending',
  created_by  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE TABLE job (
  job_id        text PRIMARY KEY,
  graph_id      text NOT NULL REFERENCES job_graph(graph_id) ON DELETE CASCADE,
  operator_id   text NOT NULL,
  version       text NOT NULL,
  queue         text NOT NULL DEFAULT 'cpu',
  params        jsonb NOT NULL,
  params_digest text NOT NULL,
  input_digest  text NOT NULL,
  state         job_state NOT NULL DEFAULT 'pending',
  attempts      int NOT NULL DEFAULT 0,
  claimed_by    text,
  claimed_at    timestamptz,
  finished_at   timestamptz,
  output_digest text,
  derivative_id text,
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now(),

  -- Redis delivers at least once. The same work identified the same way is the
  -- same row, so a redelivery finds a finished job and returns its result
  -- instead of doing it twice.
  CONSTRAINT job_is_idempotent UNIQUE (graph_id, operator_id, params_digest, input_digest)
);
CREATE INDEX idx_job_state ON job(state, queue);

CREATE TABLE job_edge (
  graph_id text NOT NULL REFERENCES job_graph(graph_id) ON DELETE CASCADE,
  from_job text NOT NULL REFERENCES job(job_id) ON DELETE CASCADE,
  to_job   text NOT NULL REFERENCES job(job_id) ON DELETE CASCADE,
  PRIMARY KEY (graph_id, from_job, to_job)
);

CREATE TABLE job_step_log (
  log_id     bigserial PRIMARY KEY,
  job_id     text NOT NULL REFERENCES job(job_id) ON DELETE CASCADE,
  at         timestamptz NOT NULL DEFAULT now(),
  level      text NOT NULL DEFAULT 'info',
  message    text NOT NULL,
  detail     jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX idx_job_step_log_job ON job_step_log(job_id, at);
