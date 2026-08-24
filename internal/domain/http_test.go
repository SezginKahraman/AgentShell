package domain

import (
	"errors"
	"strings"
	"testing"
)

func TestInterpolateReplacesPlaceholders(t *testing.T) {
	got, err := Interpolate("{{API_URL}}/health", map[string]string{"API_URL": "http://127.0.0.1:8080"})
	if err != nil || got != "http://127.0.0.1:8080/health" {
		t.Fatalf("got=%q err=%v", got, err)
	}
	got, err = Interpolate("{{ API_URL }}/v1", map[string]string{"API_URL": "https://api"})
	if err != nil || got != "https://api/v1" {
		t.Fatalf("spaces: got=%q err=%v", got, err)
	}
	got, err = Interpolate("{{EMPTY}}", map[string]string{"EMPTY": ""})
	if err != nil || got != "" {
		t.Fatalf("empty string should interpolate empty, got=%q err=%v", got, err)
	}
}

func TestInterpolateUnresolvedAndInvalid(t *testing.T) {
	if _, err := Interpolate("{{API_URL}}/{{TOKEN}}", map[string]string{"API_URL": "http://x"}); err == nil || !errors.Is(err, ErrHTTPRequest) || !strings.Contains(err.Error(), "TOKEN") {
		t.Fatalf("missing key: %v", err)
	}
	if _, err := Interpolate("{{not a key}}", map[string]string{}); err == nil || !errors.Is(err, ErrHTTPRequest) {
		t.Fatalf("invalid syntax: %v", err)
	}
}

func TestResolveHTTPRequestVarsBoundStackBeatsLibrary(t *testing.T) {
	lib := EnvironmentLibrary{Names: []string{"local", "prod"}, Keys: []string{"API_URL", "FEATURE"}, Values: map[string]map[string]string{
		"API_URL": {"local": "http://lib-local", "prod": "http://lib-prod"},
		"FEATURE": {"prod": "0"},
	}}
	stack := &Stack{Environment: "prod", Env: map[string]map[string]string{
		"API_URL": {"prod": "http://stack-prod"},
		"FEATURE": {"prod": "1"},
	}}
	name, vars := ResolveHTTPRequestVars(lib, "local", stack)
	if name != "prod" {
		t.Fatalf("bound collection must use stack environment, got %q", name)
	}
	if vars["API_URL"] != "http://stack-prod" || vars["FEATURE"] != "1" {
		t.Fatalf("stack extras must beat library: %v", vars)
	}
	name, vars = ResolveHTTPRequestVars(lib, "prod", nil)
	if name != "prod" || vars["API_URL"] != "http://lib-prod" {
		t.Fatalf("unbound uses collection env: name=%q vars=%v", name, vars)
	}
	name, vars = ResolveHTTPRequestVars(lib, "", nil)
	if name != "local" || vars["API_URL"] != "http://lib-local" {
		t.Fatalf("unbound default local: name=%q vars=%v", name, vars)
	}
}

func TestNormalizeHTTPBodyTemplatesSeedsDefault(t *testing.T) {
	body, templates, active := NormalizeHTTPBodyTemplates(`{"ok":true}`, nil, "")
	if body != `{"ok":true}` || active != DefaultHTTPBodyTemplateID || len(templates) != 1 {
		t.Fatalf("seeded: body=%q active=%q templates=%+v", body, active, templates)
	}
	if templates[0].ID != DefaultHTTPBodyTemplateID || templates[0].Name != DefaultHTTPBodyTemplateName || templates[0].Body != body {
		t.Fatalf("default template: %+v", templates[0])
	}
}

func TestNormalizeHTTPBodyTemplatesSyncsActiveBody(t *testing.T) {
	templates := []HTTPBodyTemplate{
		{ID: "search", Name: "Search", Body: `{"q":"ist"}`},
		{ID: "detail", Name: "Detail", Body: `{"id":1}`},
	}
	body, got, active := NormalizeHTTPBodyTemplates(`{"q":"ank"}`, templates, "search")
	if body != `{"q":"ank"}` || active != "search" || got[0].Body != `{"q":"ank"}` || got[1].Body != `{"id":1}` {
		t.Fatalf("sync: body=%q active=%q templates=%+v", body, active, got)
	}
	body, got, active = NormalizeHTTPBodyTemplates(`{"id":9}`, templates, "missing")
	if active != "search" || body != `{"id":9}` || got[0].Body != `{"id":9}` {
		t.Fatalf("missing active falls back to first: active=%q body=%q templates=%+v", active, body, got)
	}
}

func TestSwitchAddRemoveHTTPBodyTemplates(t *testing.T) {
	templates := []HTTPBodyTemplate{
		{ID: "search", Name: "Search", Body: `{"q":"ist"}`},
		{ID: "detail", Name: "Detail", Body: `{"id":1}`},
	}
	body, got, active, err := SwitchHTTPBodyTemplate(`{"q":"izmir"}`, templates, "search", "detail")
	if err != nil || body != `{"id":1}` || active != "detail" || got[0].Body != `{"q":"izmir"}` {
		t.Fatalf("switch: body=%q active=%q templates=%+v err=%v", body, active, got, err)
	}
	body, got, active, err = AddHTTPBodyTemplate(body, got, active, "promo", "Promo", `{"code":"X"}`)
	if err != nil || body != `{"code":"X"}` || active != "promo" || len(got) != 3 {
		t.Fatalf("add: body=%q active=%q templates=%+v err=%v", body, active, got, err)
	}
	body, got, active, err = RemoveHTTPBodyTemplate(body, got, active, "promo")
	if err != nil || active != "search" || body != `{"q":"izmir"}` || len(got) != 2 {
		t.Fatalf("remove active: body=%q active=%q templates=%+v err=%v", body, active, got, err)
	}
	if _, _, _, err = RemoveHTTPBodyTemplate(body, got[:1], "search", "search"); err == nil || !errors.Is(err, ErrHTTPRequest) {
		t.Fatalf("keep one template: %v", err)
	}
}
