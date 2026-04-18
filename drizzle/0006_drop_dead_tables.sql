-- Drop dead tables per audit triage Pattern 5 + C1.
-- Corresponding tRPC procedures and service files were deleted in the
-- same remediation wave.

DROP TABLE IF EXISTS "issue_saved_view" CASCADE;
DROP TABLE IF EXISTS "issue_dependency" CASCADE;
DROP TABLE IF EXISTS "issue_attachment" CASCADE;
