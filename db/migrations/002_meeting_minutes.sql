-- Migration 002: meeting minutes
-- OPTIONAL: the app also creates this table by itself at startup, so you do not have to run this.
-- Safe to run more than once.
--
--   docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < db/migrations/002_meeting_minutes.sql

CREATE TABLE IF NOT EXISTS meeting_minutes (
    minutes_id     SERIAL PRIMARY KEY,
    title          VARCHAR(200) NOT NULL,
    meeting_date   DATE NOT NULL,
    file_path      TEXT NOT NULL,
    original_name  VARCHAR(255),
    uploaded_by    INTEGER REFERENCES admins(admin_id),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_meeting_minutes_date ON meeting_minutes(meeting_date);
