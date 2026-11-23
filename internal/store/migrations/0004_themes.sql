-- The themes a person made on the Appearance page, and nothing else about them: a name, which built-in
-- theme they start from, and the colours they changed as JSON ({"primary": "#0b3d91"}). Colours only,
-- checked before they are saved; never anything a person typed that a stylesheet could read as text.
-- Which theme is in use is the 'theme.active' row of settings.
CREATE TABLE themes (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    base       TEXT NOT NULL,
    colors     TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
