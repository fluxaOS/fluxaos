DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'issue'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE issue;
  END IF;
END $$;

ALTER TABLE issue REPLICA IDENTITY FULL;
