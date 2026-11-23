package dockerx

import (
	"encoding/json"
	"errors"
	"io"
	"net/url"
	"strings"

	"github.com/shadovxw/devdeck/internal/secrets"
)

// HelperName is the name docker looks for: a credential store called "devdeck" is the
// program docker-credential-devdeck.
const HelperName = "docker-credential-devdeck"

// The account a build signs in with, handed to docker's helper through the environment.
const (
	EnvAccount  = "DEVDECK_DOCKER_ACCOUNT"
	EnvUsername = "DEVDECK_DOCKER_USER"
)

const notFound = "credentials not found in native keychain"

// hubHosts are the names docker uses for Docker Hub.
var hubHosts = map[string]bool{
	"index.docker.io":         true,
	"docker.io":               true,
	"registry-1.docker.io":    true,
	"registry.hub.docker.com": true,
}

func isHub(server string) bool {
	s := strings.TrimSpace(server)
	if u, err := url.Parse(s); err == nil && u.Host != "" {
		s = u.Host
	}
	return hubHosts[strings.TrimSuffix(s, "/")]
}

// CredentialCommand is docker's credential helper protocol (docker-credential-devdeck):
// `get` reads a registry address on stdin and answers with the username and token as JSON.
// It answers only for Docker Hub, and only with the account the build was started for
// (EnvAccount), whose token it reads from the keyring itself, so the token is never in a
// file or on a command line. Any other registry gets "not found", and docker then goes
// without credentials, as it would for a public image. store and erase do nothing: devdeck
// keeps the tokens. It returns the exit code.
func CredentialCommand(args []string, stdin io.Reader, stdout io.Writer, getenv func(string) string, sec secrets.Store) int {
	if len(args) == 0 {
		return 1
	}
	switch args[0] {
	case "get":
		raw, _ := io.ReadAll(io.LimitReader(stdin, 4096))
		server := strings.TrimSpace(string(raw))
		id, user := getenv(EnvAccount), getenv(EnvUsername)
		if !isHub(server) || id == "" || user == "" {
			_, _ = io.WriteString(stdout, notFound)
			return 1
		}
		tok, err := sec.Get(SecretName(id))
		if err != nil || !tok.IsSet() {
			if err != nil && !errors.Is(err, secrets.ErrNotFound) {
				_, _ = io.WriteString(stdout, "the keychain can't be read")
				return 1
			}
			_, _ = io.WriteString(stdout, notFound)
			return 1
		}
		b, _ := json.Marshal(map[string]string{"ServerURL": server, "Username": user, "Secret": tok.Reveal()})
		_, _ = stdout.Write(b)
		return 0
	case "list":
		_, _ = io.WriteString(stdout, "{}")
		return 0
	case "store", "erase":
		_, _ = io.Copy(io.Discard, io.LimitReader(stdin, 1<<20))
		return 0
	}
	return 1
}
