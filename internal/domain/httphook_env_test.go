package domain

import "testing"

func TestApplyHTTPHookEnvWritesChangedKeysOnly(t *testing.T) {
	lib := EnvironmentLibrary{
		Names:      []string{"local"},
		Keys:       []string{"API_URL", "TOKEN"},
		SecretKeys: []string{"TOKEN"},
		Values:     map[string]map[string]string{"API_URL": {"local": "https://api.example"}, "TOKEN": {"local": "old"}},
	}
	before := map[string]string{"API_URL": "https://api.example", "TOKEN": "old"}
	after := map[string]string{"API_URL": "https://api.example", "TOKEN": "next", "SEEN": "1", "not-a key": "skip"}
	got, changed := ApplyHTTPHookEnv(lib, "local", before, after)
	if !changed {
		t.Fatal("expected changes")
	}
	if got.Values["TOKEN"]["local"] != "next" || got.Values["SEEN"]["local"] != "1" || got.Values["API_URL"]["local"] != "https://api.example" {
		t.Fatalf("values=%v", got.Values)
	}
	if len(got.SecretKeys) != 1 || got.SecretKeys[0] != "TOKEN" {
		t.Fatalf("secret_keys=%v", got.SecretKeys)
	}
	if _, ok := got.Values["not-a key"]; ok {
		t.Fatalf("invalid key stored: %v", got.Values)
	}
	_, changed = ApplyHTTPHookEnv(got, "local", after, after)
	if changed {
		t.Fatal("unchanged env should not write")
	}
}
