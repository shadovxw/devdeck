package secrets

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/rs/zerolog"
	"github.com/zalando/go-keyring"
)

const sample = "sample-secret-value"

func TestValueNeverPrintsTheSecret(t *testing.T) {
	v := NewValue(sample)

	var logs bytes.Buffer
	logger := zerolog.New(&logs)
	logger.Info().Interface("v", v).Stringer("s", v).Msg("x")

	jsonOut, err := json.Marshal(struct{ Token Value }{v})
	if err != nil {
		t.Fatal(err)
	}

	for name, out := range map[string]string{
		"%v":   fmt.Sprintf("%v", v),
		"%+v":  fmt.Sprintf("%+v", v),
		"%#v":  fmt.Sprintf("%#v", v),
		"%s":   fmt.Sprint(v),
		"json": string(jsonOut),
		"log":  logs.String(),
	} {
		if strings.Contains(out, sample) {
			t.Errorf("%s leaked the secret: %q", name, out)
		}
	}
	if v.Reveal() != sample {
		t.Fatal("Reveal must return the real value")
	}
}

func TestKeyringRoundTrip(t *testing.T) {
	keyring.MockInit() // in-memory provider; never touches the real credential store
	k := NewKeyring()

	if _, err := k.Get("github-work"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("Get before Set: err = %v, want ErrNotFound", err)
	}
	if err := k.Set("github-work", NewValue(sample)); err != nil {
		t.Fatal(err)
	}
	got, err := k.Get("github-work")
	if err != nil || got.Reveal() != sample {
		t.Fatalf("Get = %v, %v", got, err)
	}
	if err := k.Delete("github-work"); err != nil {
		t.Fatal(err)
	}
	if err := k.Delete("github-work"); err != nil {
		t.Fatalf("deleting a missing secret should not fail: %v", err)
	}
	if _, err := k.Get("github-work"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("Get after Delete: err = %v, want ErrNotFound", err)
	}
}
