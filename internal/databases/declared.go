package databases

import (
	"context"
	"slices"
)

// FromFile is a database only the project's file names: devdeck found nothing that points at it.
const FromFile = "file"

// Declared is a database project.yaml names (dev-plans/2026-11-22-projects §6, PJ9): where it runs
// (one of Compose, Local or URLEnv) and who uses it. Never a password.
type Declared struct {
	ID, Engine, Name string
	Compose          string // a compose service of a run mode
	Local            bool   // installed on this machine, on Port
	URLEnv           string // the env var in a repo's .env that points at it
	Port             int
	UsedBy           []string
}

// Merge puts what the file says on top of what was found. A declared database that matches a found
// one (the same compose service; the same engine and port here; or the env database its repos use)
// gives it its id, name and used_by. One that matches nothing is listed as named in the file, and
// checked when it is on this machine.
func Merge(ctx context.Context, rep Report, decl []Declared, dial Dial) Report {
	taken := map[int]bool{}
	for _, d := range decl {
		i := slices.IndexFunc(rep.Databases, func(f Database) bool { return matches(d, f) })
		if i >= 0 && !taken[i] {
			taken[i] = true
			f := &rep.Databases[i]
			f.ID = d.ID
			if d.Name != "" {
				f.Name = d.Name
			}
			if len(d.UsedBy) > 0 {
				f.UsedBy = slices.Clone(d.UsedBy)
			}
			continue
		}
		db := Database{ID: d.ID, Engine: d.Engine, From: FromFile, Where: "named in project.yaml", Port: d.Port, Name: d.Name, UsedBy: slices.Clone(d.UsedBy), Status: "unknown"}
		if db.UsedBy == nil {
			db.UsedBy = []string{}
		}
		if d.Local && d.Port > 0 {
			db.Host, db.Where = "127.0.0.1", "installed on this machine"
			db.Status = "down"
			if dial(ctx, d.Port) {
				db.Status = "up"
			}
		}
		rep.Databases = append(rep.Databases, db)
	}
	return rep
}

func matches(d Declared, f Database) bool {
	if d.Engine != f.Engine {
		return false
	}
	switch {
	case d.Compose != "":
		return f.From == FromCompose && f.ID == d.Compose
	case d.Local:
		return local(f.Host) && f.Port == d.Port
	case d.URLEnv != "":
		return f.From == FromEnv && slices.ContainsFunc(d.UsedBy, func(r string) bool { return slices.Contains(f.UsedBy, r) })
	}
	return false
}

// ToDeclare is what a conversion writes into project.yaml for the databases found: compose ones by
// their service, ones on this machine by their port. One on another host is left out (it may not
// be the same on another machine).
func ToDeclare(rep Report) []Declared {
	var out []Declared
	for _, f := range rep.Databases {
		d := Declared{ID: f.ID, Engine: f.Engine, Name: f.Name, UsedBy: slices.Clone(f.UsedBy)}
		switch {
		case f.From == FromCompose:
			d.Compose = f.ID
		case local(f.Host):
			d.Local, d.Port = true, f.Port
		default:
			continue
		}
		out = append(out, d)
	}
	return out
}
