-- Where a recorder burns its clock, and in what format.
--
-- This is deployment configuration, not something to detect. A reader turned
-- loose on an unknown overlay invents timestamps, and an invented timestamp on
-- a piece of evidence is worse than no timestamp at all. Recorded per source,
-- because it is a property of the recorder model and its installed position.
--
-- Without it the burned clock test reports that it could not run, which also
-- means frames removed from a quiet scene stay undetectable. That consequence
-- is stated on the source screen rather than left for someone to discover.

ALTER TABLE sources ADD COLUMN overlay TEXT;
