package gitx

import (
	"context"
	"slices"
	"strings"
)

// Service is everything the git accounts feature needs, in one place for the API.
type Service struct {
	Store *Store
	GH    *GH
	Setup *Setup
	Git   Git
}

// NewService builds the service for a data folder. exe is the devdeck program git is
// told to run as the credential helper.
func NewService(dataDir, exe string) *Service {
	return &Service{
		Store: &Store{Dir: dataDir},
		GH:    NewGH(""),
		Setup: &Setup{Exe: exe, DataDir: dataDir},
		Git:   Git{},
	}
}

// ConnectionView is a connection and whether its gh account is signed in.
type ConnectionView struct {
	Connection
	SignedIn bool `json:"signed_in"`
}

// Overview is what the Connections page shows.
type Overview struct {
	GHInstalled bool             `json:"gh_installed"`
	GHPath      string           `json:"gh_path,omitempty"`
	Accounts    []Account        `json:"accounts"`
	Connections []ConnectionView `json:"connections"`
	Rules       []Rule           `json:"rules"`
	// AccountsError says why gh's accounts couldn't be listed, when they couldn't.
	AccountsError string `json:"accounts_error,omitempty"`
}

// Overview reads the configuration and asks gh who is signed in.
func (s *Service) Overview(ctx context.Context) (Overview, error) {
	cfg, err := s.Store.Load()
	if err != nil {
		return Overview{}, err
	}
	o := Overview{GHInstalled: s.GH.Installed(), GHPath: s.GH.Path(), Accounts: []Account{}, Connections: []ConnectionView{}, Rules: cfg.Rules}
	if o.Rules == nil {
		o.Rules = []Rule{}
	}
	if o.GHInstalled {
		accounts, err := s.GH.Accounts(ctx)
		if err != nil {
			o.AccountsError = err.Error()
		}
		if accounts != nil {
			o.Accounts = accounts
		}
	}
	for _, cn := range cfg.Connections {
		signedIn := slices.ContainsFunc(o.Accounts, func(a Account) bool { return strings.EqualFold(a.Login, cn.User) })
		o.Connections = append(o.Connections, ConnectionView{Connection: cn, SignedIn: signedIn})
	}
	return o, nil
}
