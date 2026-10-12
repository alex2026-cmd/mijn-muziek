-- Eenmalige uitbreiding van de BESTAANDE music_guests-tabel.
-- Voer dit één keer uit op de bestaande Cloudflare D1-database.
-- Behoudt bestaande gasten, favorieten en afspeellijsten.
ALTER TABLE music_guests ADD COLUMN password_hash TEXT;
ALTER TABLE music_guests ADD COLUMN failed_logins INTEGER NOT NULL DEFAULT 0;
ALTER TABLE music_guests ADD COLUMN locked_until INTEGER;
