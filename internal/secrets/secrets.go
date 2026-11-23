// Package secrets keeps connection secrets (tokens, passwords) in the OS
// keyring: Windows Credential Manager, macOS Keychain or the Secret Service.
// They never go into YAML, SQLite, logs or Claude/MCP context (plan §6.1).
package secrets

import (
	"errors"
	"fmt"

	"github.com/zalando/go-keyring"
)

// service is the keyring namespace every devdeck secret lives under.
const service = "devdeck"

// ErrNotFound means no secret is stored under that name.
var ErrNotFound = errors.New("secret not found")

// Value holds a secret and refuses to print it. Fmt verbs, JSON and
// structured logging all show a mask; call Reveal at the point of use.
type Value struct{ s string }

const mask = "••••••••"

// NewValue wraps a secret string.
func NewValue(s string) Value { return Value{s: s} }

// Reveal returns the plain secret. Use it only where it is sent to the
// system that needs it, and never log the result.
func (v Value) Reveal() string { return v.s }

// IsSet reports whether the value is non-empty.
func (v Value) IsSet() bool { return v.s != "" }

// String implements fmt.Stringer.
func (v Value) String() string { return mask }

// GoString implements fmt.GoStringer (the %#v verb).
func (v Value) GoString() string { return "secrets.Value(" + mask + ")" }

// MarshalJSON implements json.Marshaler.
func (v Value) MarshalJSON() ([]byte, error) { return []byte(`"` + mask + `"`), nil }

// MarshalText implements encoding.TextMarshaler (used by zerolog and YAML).
func (v Value) MarshalText() ([]byte, error) { return []byte(mask), nil }

// Store reads and writes secrets by name.
type Store interface {
	Get(name string) (Value, error)
	Set(name string, v Value) error
	Delete(name string) error
}

// Keyring is the Store backed by the operating system's credential store.
type Keyring struct{}

// NewKeyring returns the OS-backed store.
func NewKeyring() Keyring { return Keyring{} }

// Get returns the secret, or ErrNotFound.
func (Keyring) Get(name string) (Value, error) {
	s, err := keyring.Get(service, name)
	if errors.Is(err, keyring.ErrNotFound) {
		return Value{}, fmt.Errorf("%s: %w", name, ErrNotFound)
	}
	if err != nil {
		return Value{}, fmt.Errorf("read secret %q: %w", name, err)
	}
	return NewValue(s), nil
}

// Set stores or replaces the secret.
func (Keyring) Set(name string, v Value) error {
	if err := keyring.Set(service, name, v.Reveal()); err != nil {
		return fmt.Errorf("store secret %q: %w", name, err)
	}
	return nil
}

// Delete removes the secret. Deleting a missing secret is not an error.
func (Keyring) Delete(name string) error {
	err := keyring.Delete(service, name)
	if err != nil && !errors.Is(err, keyring.ErrNotFound) {
		return fmt.Errorf("delete secret %q: %w", name, err)
	}
	return nil
}
