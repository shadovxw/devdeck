package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/shadovxw/devdeck/internal/gitx"
)

func gitTools(c *client) []Tool {
	const switched = " Needs git access: the person can switch it off in devdeck's Claude access setting. Tokens are never available."
	return []Tool{
		{
			Name:        "git_accounts",
			Description: "The GitHub accounts devdeck knows: which accounts `gh` is signed in as, devdeck's connections (an account plus the name and email used for commits) and the rules that choose a connection for a repository address." + switched,
			Schema:      objectSchema(map[string]any{}),
			Call:        c.gitAccounts,
		},
		{
			Name:        "git_repos",
			Description: "The repositories of the user's workspaces, each with its remote, the connection a rule picks, the commit identity it should have and the one git would use now, and whether they match." + switched,
			Schema:      objectSchema(map[string]any{}),
			Call:        c.gitRepos,
		},
	}
}

func (c *client) gitAccounts(ctx context.Context, args json.RawMessage) (string, error) {
	if err := decodeArgs(args, &struct{}{}); err != nil {
		return "", err
	}
	body, err := c.get(ctx, "/api/v1/git")
	if err != nil {
		return "", err
	}
	var o gitx.Overview
	if err := json.Unmarshal(body, &o); err != nil {
		return "", errors.New("devdeck sent an answer that can't be read")
	}
	if !o.GHInstalled {
		return withJSON("GitHub's `gh` program isn't installed, so no accounts can be listed.", o)
	}
	var logins []string
	for _, a := range o.Accounts {
		logins = append(logins, a.Login)
	}
	return withJSON(fmt.Sprintf("gh is signed in as: %s. %d connections, %d rules.", orNone(logins), len(o.Connections), len(o.Rules)), o)
}

func (c *client) gitRepos(ctx context.Context, args json.RawMessage) (string, error) {
	if err := decodeArgs(args, &struct{}{}); err != nil {
		return "", err
	}
	body, err := c.get(ctx, "/api/v1/git/repos")
	if err != nil {
		return "", err
	}
	var rows []map[string]any
	if err := json.Unmarshal(body, &rows); err != nil {
		return "", errors.New("devdeck sent an answer that can't be read")
	}
	return withJSON(fmt.Sprintf("%d repositories.", len(rows)), rows)
}

func orNone(s []string) string {
	if len(s) == 0 {
		return "no one"
	}
	return strings.Join(s, ", ")
}
