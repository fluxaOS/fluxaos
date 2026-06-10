-- FLX-266 (2026-06-10): restore Realtime publication membership.
--
-- Supabase Realtime postgres_changes only delivers events for tables in
-- the `supabase_realtime` publication. The FLX-239 Stage 1 rip-and-replace
-- migration dropped + recreated most tables, which silently removed them
-- from the publication. Live subscribers that broke:
--   - ActivityFeed            → issue_event   (comment/event live updates)
--   - LiveOutput              → event         (stdout streaming)
--   - RunDetailModal          → stage_run     (stage transitions)
--   - mission-control client  → issue_pull_request
-- (`issue` and `pipeline_run` survived because Stage 1 altered them in
-- place.)
--
-- Idempotent: ALTER PUBLICATION ADD TABLE errors when the table is already
-- a member, so guard each via pg_publication_tables.
--
-- Hand-written per FLX-16.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'issue_event',
    'event',
    'stage_run',
    'issue_pull_request'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;
