package store

import (
	"context"
	"path/filepath"
	"testing"
	"testing/fstest"
)

func TestOpenAppliesMigrationsOnce(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "nested", "state.db")

	s, err := Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.DB.ExecContext(ctx, `INSERT INTO settings (key, value) VALUES ('theme', 'dark')`); err != nil {
		t.Fatalf("settings table missing: %v", err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}

	// Reopening must not re-run migrations or lose data.
	s, err = Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = s.Close() }()
	var value string
	if err := s.DB.QueryRowContext(ctx, `SELECT value FROM settings WHERE key = 'theme'`).Scan(&value); err != nil || value != "dark" {
		t.Fatalf("value = %q, err = %v", value, err)
	}
	var n int
	if err := s.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM schema_migrations`).Scan(&n); err != nil || n != 2 {
		t.Fatalf("applied migrations = %d, err = %v, want 2 (settings, claude_calls)", n, err)
	}
}

func TestMigrationsRunInOrderAndRollBackOnError(t *testing.T) {
	ctx := context.Background()
	s, err := Open(ctx, ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = s.Close() }()

	files := fstest.MapFS{
		"migrations/0001_a.sql":   {Data: []byte(`CREATE TABLE a (id INTEGER);`)},
		"migrations/0003_bad.sql": {Data: []byte(`CREATE TABLE c (id INTEGER); THIS IS NOT SQL;`)},
		"migrations/0002_b.sql":   {Data: []byte(`CREATE TABLE b (id INTEGER);`)},
	}
	if err := s.migrate(ctx, files); err == nil {
		t.Fatal("expected the bad migration to fail")
	}

	var applied int
	if err := s.DB.QueryRowContext(ctx, `SELECT MAX(version) FROM schema_migrations`).Scan(&applied); err != nil || applied != 2 {
		t.Fatalf("highest applied = %d, err = %v, want 2", applied, err)
	}
	// The failed migration's CREATE TABLE c must have been rolled back.
	if _, err := s.DB.ExecContext(ctx, `INSERT INTO c VALUES (1)`); err == nil {
		t.Fatal("table c exists; the failed migration was not rolled back")
	}
}

func TestLoadMigrationsRejectsBadNames(t *testing.T) {
	for name, files := range map[string]fstest.MapFS{
		"no version":        {"migrations/init.sql": {Data: []byte("")}},
		"zero version":      {"migrations/0000_x.sql": {Data: []byte("")}},
		"duplicate version": {"migrations/0001_a.sql": {Data: []byte("")}, "migrations/0001_b.sql": {Data: []byte("")}},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := loadMigrations(files); err == nil {
				t.Fatal("expected an error")
			}
		})
	}
}
