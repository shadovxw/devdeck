-- Key/value settings for devdeck itself (UI preferences, last workspace, ...).
-- Never store secrets here; those go in the OS keyring.
CREATE TABLE settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
