package dockerx

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"
)

// errEOF is yaml's end of an empty document.
var errEOF = io.EOF

// HubURL is Docker Hub's web API.
const HubURL = "https://hub.docker.com"

// ErrRefused means Docker Hub didn't accept the username and token.
var ErrRefused = errors.New("the username or token was refused by Docker Hub: check the token is a personal access token with Read & Write permission, and not expired")

// Hub talks to Docker Hub's web API: sign in, list namespaces, ask whether a tag exists.
// It needs the network; a push does not go through it.
type Hub struct {
	// Base is the API address (HubURL when empty).
	Base string
	HTTP *http.Client
}

func (h *Hub) base() string {
	if h.Base != "" {
		return h.Base
	}
	return HubURL
}

func (h *Hub) client() *http.Client {
	if h.HTTP != nil {
		return h.HTTP
	}
	return &http.Client{Timeout: 20 * time.Second}
}

func (h *Hub) do(ctx context.Context, method, path, jwt string, in, out any) (int, error) {
	var body io.Reader
	if in != nil {
		b, err := json.Marshal(in)
		if err != nil {
			return 0, err
		}
		body = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, h.base()+path, body)
	if err != nil {
		return 0, err
	}
	req.Header.Set("Accept", "application/json")
	if in != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if jwt != "" {
		req.Header.Set("Authorization", "JWT "+jwt)
	}
	resp, err := h.client().Do(req)
	if err != nil {
		return 0, fmt.Errorf("can't reach Docker Hub: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return resp.StatusCode, err
	}
	if out != nil && resp.StatusCode == http.StatusOK {
		if err := json.Unmarshal(raw, out); err != nil {
			return resp.StatusCode, errors.New("the answer from Docker Hub can't be read")
		}
	}
	return resp.StatusCode, nil
}

// Login signs in with a username and a personal access token and returns Docker Hub's session token.
func (h *Hub) Login(ctx context.Context, username, token string) (string, error) {
	var out struct {
		Token string `json:"token"`
	}
	code, err := h.do(ctx, http.MethodPost, "/v2/users/login", "", map[string]string{"username": username, "password": token}, &out)
	switch {
	case err != nil:
		return "", err
	case code == http.StatusUnauthorized || code == http.StatusForbidden:
		return "", ErrRefused
	case code != http.StatusOK || out.Token == "":
		return "", fmt.Errorf("signing in failed: Docker Hub answered %d", code)
	}
	return out.Token, nil
}

// Namespaces lists the namespaces an account can use: its own username and the
// organisations it belongs to. The organisations are best effort: if Docker Hub won't say,
// only the username is returned.
func (h *Hub) Namespaces(ctx context.Context, jwt, username string) []string {
	out := []string{username}
	var page struct {
		Results []struct {
			Orgname string `json:"orgname"`
		} `json:"results"`
	}
	if code, err := h.do(ctx, http.MethodGet, "/v2/user/orgs/?page_size=100", jwt, nil, &page); err != nil || code != http.StatusOK {
		return out
	}
	for _, o := range page.Results {
		if namePattern.MatchString(o.Orgname) {
			out = append(out, o.Orgname)
		}
	}
	return out
}

// TagExists reports whether the repository already has the tag. A repository that doesn't
// exist yet has no tags.
func (h *Hub) TagExists(ctx context.Context, jwt, repository, tag string) (bool, error) {
	if !ValidRepository(repository) {
		return false, fmt.Errorf("%q isn't a Docker Hub repository", repository)
	}
	code, err := h.do(ctx, http.MethodGet, "/v2/repositories/"+repository+"/tags/"+url.PathEscape(tag)+"/", jwt, nil, nil)
	switch {
	case err != nil:
		return false, err
	case code == http.StatusOK:
		return true, nil
	case code == http.StatusNotFound:
		return false, nil
	}
	return false, fmt.Errorf("looking for the tag failed: Docker Hub answered %d", code)
}
