-- What Claude Code's connector asked devdeck for (the audit list on the Claude access page).
-- Arguments only: the path and the query, never an answer and never a request body.
CREATE TABLE claude_calls (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    at     TEXT    NOT NULL,
    tool   TEXT    NOT NULL DEFAULT '',
    method TEXT    NOT NULL,
    path   TEXT    NOT NULL,
    query  TEXT    NOT NULL DEFAULT '',
    status INTEGER NOT NULL,
    bytes  INTEGER NOT NULL DEFAULT 0
);
