package logs

import (
	"regexp"
	"strings"
	"time"
)

// Filter is a saved set of query filters, kept with the workspace so it can be
// used again (and shared with whoever has the workspace). Its time is relative
// ("15m") or absolute (RFC 3339), written the way a query takes it.
type Filter struct {
	ID   string `yaml:"id" json:"id"`
	Name string `yaml:"name" json:"name"`
	// Stack limits the filter to one stack; empty means any stack.
	Stack    string   `yaml:"stack,omitempty" json:"stack,omitempty"`
	Services []string `yaml:"services,omitempty" json:"services,omitempty"`
	Levels   []string `yaml:"levels,omitempty" json:"levels,omitempty"`
	Regex    string   `yaml:"regex,omitempty" json:"regex,omitempty"`
	// Fields are "path=value" or "path!=value".
	Fields []string `yaml:"fields,omitempty" json:"fields,omitempty"`
	Since  string   `yaml:"since,omitempty" json:"since,omitempty"`
}

var filterID = regexp.MustCompile(`^[a-z][a-z0-9-]{0,39}$`)

const maxFilterName = 60

// Validate reports why a filter can't be saved, in plain words.
func (f Filter) Validate() error {
	if !filterID.MatchString(f.ID) {
		return badQuery("id must be lowercase letters, digits and dashes, starting with a letter (up to 40)")
	}
	if strings.TrimSpace(f.Name) == "" || len(f.Name) > maxFilterName {
		return badQuery("name is needed, up to %d characters", maxFilterName)
	}
	if f.Stack != "" && !validNames("w", f.Stack, "") {
		return badQuery("stack %q isn't a valid stack name", f.Stack)
	}
	for _, s := range f.Services {
		if !validNames("w", "s", s) || s == "" {
			return badQuery("%q isn't a valid service", s)
		}
	}
	_, err := f.Query(time.Now())
	return err
}

// Query turns the filter into a query, with its relative time counted from now.
func (f Filter) Query(now time.Time) (Query, error) {
	q := Query{Services: f.Services, Levels: f.Levels, Regex: f.Regex}
	for _, raw := range f.Fields {
		ff, err := ParseField(raw)
		if err != nil {
			return Query{}, err
		}
		q.Fields = append(q.Fields, ff)
	}
	var err error
	if q.Since, err = ParseWhen(f.Since, now); err != nil {
		return Query{}, err
	}
	if _, err := q.matcher(); err != nil {
		return Query{}, err
	}
	return q, nil
}
