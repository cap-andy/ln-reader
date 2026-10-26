CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  token      TEXT PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE novels (
  id                   TEXT PRIMARY KEY,
  novel_url            TEXT,
  title                TEXT NOT NULL,
  description          TEXT,
  description_html     TEXT,
  cover_url            TEXT,
  author               TEXT,
  status               TEXT,
  first_chapter_url    TEXT,
  latest_chapter_name  TEXT,
  latest_chapter_url   TEXT,
  added_by             UUID NOT NULL REFERENCES users(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE novel_genres (
  novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  genre    TEXT NOT NULL,
  PRIMARY KEY (novel_id, genre)
);

CREATE TABLE novel_chapters (
  novel_id   TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  chapter_id TEXT NOT NULL,
  title      TEXT NOT NULL,
  url        TEXT NOT NULL,
  position   INTEGER NOT NULL,
  PRIMARY KEY (novel_id, chapter_id)
);

CREATE TABLE progress (
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  novel_id      TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  chapter_id    TEXT,
  chapter_title TEXT,
  chapter_url   TEXT,
  novel_title   TEXT,
  percent       INTEGER NOT NULL DEFAULT 0 CHECK (percent BETWEEN 0 AND 100),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, novel_id)
);

CREATE TABLE bookmarks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  novel_id      TEXT REFERENCES novels(id) ON DELETE SET NULL,
  chapter_id    TEXT NOT NULL,
  chapter_title TEXT,
  url           TEXT NOT NULL,
  saved_at      TIMESTAMPTZ NOT NULL DEFAULT now(), novel_title TEXT,
  UNIQUE (user_id, chapter_id)
);
