-- Proves the class gate does what the specification says it does.
--
-- This runs as part of the FIS verification. If someone drops a trigger or
-- relaxes a constraint to make a build green, this stops being green.
\set ON_ERROR_STOP 0

INSERT INTO recipe (recipe_digest, input_sha256, input_merkle, env, body)
VALUES ('t-mixed', repeat('a',64), repeat('b',64), '{}', '{}'),
       ('t-pure',  repeat('a',64), repeat('b',64), '{}', '{}'),
       ('t-ext',   repeat('a',64), repeat('b',64), '{}', '{}');

INSERT INTO recipe_step (recipe_digest,i,operator_id,version,container_digest,registry_digest,class,params,params_digest,output_kind,external_process)
VALUES ('t-mixed',0,'V-CLR-1','1.0.0','sha256:x','sha256:y','E','{}','p0','raster/raw-u16',false),
       ('t-mixed',1,'V-CLR-3','1.0.0','sha256:x','sha256:y','D','{}','p1','raster/raw-u16',false),
       ('t-pure', 0,'V-CLR-1','1.0.0','sha256:x','sha256:y','E','{}','p0','raster/raw-u16',false),
       ('t-ext',  0,'V-CLR-1','1.0.0','sha256:x','sha256:y','E','{}','p0','raster/raw-u16',true);

-- Every writer below claims 'E'. The trigger overwrites all three.
INSERT INTO derivative (derivative_id,parent_sha256,recipe_digest,output_digest,output_kind,byte_len,object_key,class_floor,produced_by)
VALUES ('t-d-mixed',repeat('a',64),'t-mixed','o1','raster/raw-u16',10,'k1','E','gate-test'),
       ('t-d-pure', repeat('a',64),'t-pure', 'o2','raster/raw-u16',10,'k2','E','gate-test'),
       ('t-d-ext',  repeat('a',64),'t-ext',  'o3','raster/raw-u16',10,'k3','E','gate-test');

\echo '--- computed class floors: mixed must be D, pure E, external I ---'
SELECT derivative_id, class_floor FROM derivative WHERE derivative_id LIKE 't-d-%' ORDER BY derivative_id;

INSERT INTO disclosure_bundle (bundle_id,incident_id,recipient_class,created_by)
VALUES ('t-b1','INC-GATE','court','gate-test');

\echo '--- an evidentiary item is admitted ---'
INSERT INTO disclosure_item (bundle_id,derivative_id,added_by) VALUES ('t-b1','t-d-pure','gate-test');

\echo '--- a demonstrative item is refused ---'
INSERT INTO disclosure_item (bundle_id,derivative_id,added_by) VALUES ('t-b1','t-d-mixed','gate-test');

\echo '--- an externally processed item is refused too ---'
INSERT INTO disclosure_item (bundle_id,derivative_id,added_by) VALUES ('t-b1','t-d-ext','gate-test');

\echo '--- an acknowledgement without a written reason is refused ---'
INSERT INTO demonstrative_ack (bundle_id,derivative_id,approved_by,reason) VALUES ('t-b1','t-d-mixed','sup','nope');

\echo '--- with a written reason, the item is admitted ---'
INSERT INTO demonstrative_ack (bundle_id,derivative_id,approved_by,reason)
VALUES ('t-b1','t-d-mixed','supervisor','demonstrative aid for the bench, listed separately in the exhibit index');
INSERT INTO disclosure_item (bundle_id,derivative_id,added_by) VALUES ('t-b1','t-d-mixed','gate-test');

\echo '--- final bundle contents ---'
SELECT d.derivative_id, d.class_floor FROM disclosure_item i JOIN derivative d USING (derivative_id)
 WHERE i.bundle_id = 't-b1' ORDER BY 1;

\echo '--- a class E operator may not be declared gpu ---'
INSERT INTO operator (operator_id,version,class,container_digest,registry_digest,params_schema,input_kinds,output_kinds,gpu,deterministic,runtime)
VALUES ('X-BAD','1.0.0','E','sha256:x','sha256:y','{}','{a}','{b}',true,true,'operator-video');

\echo '--- a class E operator may not be declared nondeterministic ---'
INSERT INTO operator (operator_id,version,class,container_digest,registry_digest,params_schema,input_kinds,output_kinds,gpu,deterministic,runtime)
VALUES ('X-BAD2','1.0.0','E','sha256:x','sha256:y','{}','{a}','{b}',false,false,'operator-video');

DELETE FROM disclosure_bundle WHERE bundle_id = 't-b1';
DELETE FROM derivative WHERE derivative_id LIKE 't-d-%';
DELETE FROM recipe WHERE recipe_digest LIKE 't-%';
