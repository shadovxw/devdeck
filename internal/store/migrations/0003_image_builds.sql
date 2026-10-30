-- Finished image builds (the history on the Images page). What was built and how it went:
-- never a token and never the build's output.
CREATE TABLE image_builds (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    at         TEXT    NOT NULL,
    workspace  TEXT    NOT NULL,
    repo       TEXT    NOT NULL,
    image      TEXT    NOT NULL,
    repository TEXT    NOT NULL,
    tag        TEXT    NOT NULL,
    revision   TEXT    NOT NULL DEFAULT '',
    dirty      INTEGER NOT NULL DEFAULT 0,
    account    TEXT    NOT NULL DEFAULT '',
    ok         INTEGER NOT NULL,
    error      TEXT    NOT NULL DEFAULT '',
    seconds    REAL    NOT NULL DEFAULT 0
);
