package databases

import (
	"context"
	"strings"
	"testing"
)

func TestMerge(t *testing.T) {
	found := func() Report {
		return Report{Databases: []Database{
			{ID: "db", Engine: Postgres, From: FromCompose, Host: "127.0.0.1", Port: 55432, UsedBy: []string{"api"}, Status: "up"},
			{ID: "redis-6379", Engine: Redis, From: FromEnv, Host: "localhost", Port: 6379, UsedBy: []string{"worker"}, Status: "down"},
		}}
	}
	up := func(_ context.Context, port int) bool { return port == 3306 }
	tests := []struct {
		name string
		decl []Declared
		// want are "id from status used_by" per database, in order.
		want []string
	}{
		{name: "nothing declared", want: []string{"db compose up api", "redis-6379 env down worker"}},
		{name: "a compose service renamed, used by more", decl: []Declared{{ID: "shop", Engine: Postgres, Compose: "db", UsedBy: []string{"api", "worker"}}},
			want: []string{"shop compose up api,worker", "redis-6379 env down worker"}},
		{name: "local by port", decl: []Declared{{ID: "cache", Engine: Redis, Local: true, Port: 6379}},
			want: []string{"db compose up api", "cache env down worker"}},
		{name: "by the env of its repos", decl: []Declared{{ID: "cache", Engine: Redis, URLEnv: "REDIS_URL", UsedBy: []string{"worker"}}},
			want: []string{"db compose up api", "cache env down worker"}},
		{name: "named only in the file, here", decl: []Declared{{ID: "legacy", Engine: MySQL, Local: true, Port: 3306}},
			want: []string{"db compose up api", "redis-6379 env down worker", "legacy file up "}},
		{name: "named only in the file, elsewhere", decl: []Declared{{ID: "remote", Engine: Postgres, URLEnv: "REMOTE_URL", UsedBy: []string{"nobody"}}},
			want: []string{"db compose up api", "redis-6379 env down worker", "remote file unknown nobody"}},
		{name: "the engine must match", decl: []Declared{{ID: "x", Engine: MySQL, Compose: "db"}},
			want: []string{"db compose up api", "redis-6379 env down worker", "x file unknown "}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := Merge(context.Background(), found(), tt.decl, up)
			if len(got.Databases) != len(tt.want) {
				t.Fatalf("databases = %+v", got.Databases)
			}
			for i, d := range got.Databases {
				line := d.ID + " " + d.From + " " + d.Status + " " + strings.Join(d.UsedBy, ",")
				if line != tt.want[i] {
					t.Errorf("%d = %q, want %q", i, line, tt.want[i])
				}
			}
		})
	}
}


func TestToDeclare(t *testing.T) {
	rep := Report{Databases: []Database{
		{ID: "db", Engine: Postgres, From: FromCompose, Host: "127.0.0.1", Port: 55432, Name: "shop", UsedBy: []string{"api"}},
		{ID: "redis-6379", Engine: Redis, From: FromEnv, Host: "localhost", Port: 6379, UsedBy: []string{"worker"}},
		{ID: "postgres-5432", Engine: Postgres, From: FromEnv, Host: "db.example.com", Port: 5432},
	}}
	got := ToDeclare(rep)
	if len(got) != 2 || got[0].Compose != "db" || got[0].Name != "shop" || !got[1].Local || got[1].Port != 6379 {
		t.Errorf("declare = %+v", got)
	}
}
