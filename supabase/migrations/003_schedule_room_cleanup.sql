-- Enable Supabase Cron (pg_cron) under Integrations before running this migration.
-- Kept separate so lifecycle/scoring tests can run in embedded PostgreSQL.
select cron.schedule('hot-takes-room-cleanup','*/5 * * * *','select hot_private.cleanup_rooms();');
