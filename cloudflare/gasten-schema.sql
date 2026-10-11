-- Mijn Muziek: voorbereidende gasttabellen voor Cloudflare D1.
-- Nog NIET actief: voer dit pas uit bij de uitrol van een beveiligde gast-API.
-- Alle tijden zijn UNIX-seconden. Geen Google Drive-tokens voor gasten.
CREATE TABLE IF NOT EXISTS music_guests (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  status TEXT NOT NULL DEFAULT 'invited' CHECK(status IN ('invited','active','revoked')),
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE TABLE IF NOT EXISTS music_guest_codes (
  id TEXT PRIMARY KEY,
  guest_id TEXT NOT NULL REFERENCES music_guests(id),
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  consumed_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_music_guest_codes_guest ON music_guest_codes(guest_id, expires_at);
CREATE TABLE IF NOT EXISTS music_guest_sessions (
  token_hash TEXT PRIMARY KEY,
  guest_id TEXT NOT NULL REFERENCES music_guests(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_music_guest_sessions_guest ON music_guest_sessions(guest_id);
CREATE TABLE IF NOT EXISTS music_guest_favorites (
  guest_id TEXT NOT NULL REFERENCES music_guests(id),
  youtube_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (guest_id, youtube_id)
);
CREATE TABLE IF NOT EXISTS music_guest_playlists (
  id TEXT PRIMARY KEY,
  guest_id TEXT NOT NULL REFERENCES music_guests(id),
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_music_guest_playlists_owner ON music_guest_playlists(guest_id);
CREATE TABLE IF NOT EXISTS music_guest_playlist_tracks (
  playlist_id TEXT NOT NULL REFERENCES music_guest_playlists(id) ON DELETE CASCADE,
  youtube_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY (playlist_id, youtube_id)
);

CREATE TABLE IF NOT EXISTS music_shared_collection (id INTEGER PRIMARY KEY CHECK(id=1), content TEXT NOT NULL, updated_at INTEGER NOT NULL);
