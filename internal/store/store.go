// Package store owns devdeck's local SQLite database (state.db) and its
// embedded, versioned schema migrations.
package store

import (
	"context"
	"database/sql"
	"embed"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	_ "modernc.org/sqlite" // pure-Go SQLite driver, no CGO
)

//go:embed migrations/*.sql
var migrationFiles embed.FS

// Store is the open database.
type Store struct {
	DB *sql.DB
}

// Open opens (creating if needed) the database at path and applies any
// pending migrations. Pass ":memory:" for an in-memory database.
func Open(ctx context.Context, path string) (*Store, error) {
	dsn := path
	if path != ":memory:" {
		if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
			return nil, fmt.Errorf("create data dir: %w", err)
		}
		dsn = "file:" + filepath.ToSlash(path) +
			"?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=foreign_keys(1)"
	}
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	if path == ":memory:" {
		db.SetMaxOpenConns(1) // each connection would otherwise get its own empty database
	}
	s := &Store{DB: db}
	if err := s.migrate(ctx, migrationFiles); err != nil {
		_ = db.Close()
		return nil, err
	}
	return s, nil
}

// Close closes the database.
func (s *Store) Close() error { return s.DB.Close() }

type migration struct {
	version int
	name    string
	sql     string
}

// migrate applies every migration newer than the recorded version, each in
// its own transaction. Files are named NNNN_description.sql.
func (s *Store) migrate(ctx context.Context, files fs.FS) error {
	migs, err := loadMigrations(files)
	if err != nil {
		return err
	}
	if _, err := s.DB.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (
		version    INTEGER PRIMARY KEY,
		name       TEXT NOT NULL,
		applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
	)`); err != nil {
		return fmt.Errorf("create schema_migrations: %w", err)
	}
	var current int
	if err := s.DB.QueryRowContext(ctx, `SELECT COALESCE(MAX(version), 0) FROM schema_migrations`).Scan(&current); err != nil {
		return err
	}
	for _, m := range migs {
		if m.version <= current {
			continue
		}
		if err := s.apply(ctx, m); err != nil {
			return fmt.Errorf("migration %04d_%s: %w", m.version, m.name, err)
		}
	}
	return nil
}

func (s *Store) apply(ctx context.Context, m migration) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, m.sql); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO schema_migrations (version, name) VALUES (?, ?)`, m.version, m.name); err != nil {
		return err
	}
	return tx.Commit()
}

func loadMigrations(files fs.FS) ([]migration, error) {
	entries, err := fs.Glob(files, "migrations/*.sql")
	if err != nil {
		return nil, err
	}
	var migs []migration
	seen := map[int]string{}
	for _, path := range entries {
		base := strings.TrimSuffix(filepath.Base(path), ".sql")
		num, name, ok := strings.Cut(base, "_")
		version, convErr := strconv.Atoi(num)
		if !ok || convErr != nil || version < 1 {
			return nil, fmt.Errorf("migration file %q: want NNNN_description.sql", path)
		}
		if prev, dup := seen[version]; dup {
			return nil, fmt.Errorf("migration version %d used by both %q and %q", version, prev, path)
		}
		seen[version] = path
		body, err := fs.ReadFile(files, path)
		if err != nil {
			return nil, err
		}
		migs = append(migs, migration{version: version, name: name, sql: string(body)})
	}
	sort.Slice(migs, func(i, j int) bool { return migs[i].version < migs[j].version })
	return migs, nil
}
