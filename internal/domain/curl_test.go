package domain

import (
	"errors"
	"strings"
	"testing"
)

func TestParseCurlPostJSON(t *testing.T) {
	got, err := ParseCurl(`curl -X POST 'https://api.example.com/v1/hotels' \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json' \
  --data-raw '{"city":"IST"}'`)
	if err != nil {
		t.Fatal(err)
	}
	if got.Method != "POST" || got.URL != "https://api.example.com/v1/hotels" || got.Body != `{"city":"IST"}` {
		t.Fatalf("parsed=%+v", got)
	}
	if got.Headers["Content-Type"] != "application/json" || got.Headers["Accept"] != "application/json" {
		t.Fatalf("headers=%v", got.Headers)
	}
	if got.Name != "hotels" {
		t.Fatalf("name=%q", got.Name)
	}
}

func TestParseCurlDefaultsGetAndIgnoresNoise(t *testing.T) {
	got, err := ParseCurl(`curl --silent --compressed -L --url http://127.0.0.1:8080/health -H "X-Trace: local"`)
	if err != nil {
		t.Fatal(err)
	}
	if got.Method != "GET" || got.URL != "http://127.0.0.1:8080/health" || got.Headers["X-Trace"] != "local" {
		t.Fatalf("parsed=%+v", got)
	}
}

func TestParseCurlJSONFlagAndMaxTime(t *testing.T) {
	got, err := ParseCurl(`curl --json '{"ok":true}' --max-time 2.5 https://api.example.com/v1/ready`)
	if err != nil {
		t.Fatal(err)
	}
	if got.Method != "POST" || got.Body != `{"ok":true}` || got.Headers["Content-Type"] != "application/json" || got.TimeoutMS != 2500 {
		t.Fatalf("parsed=%+v", got)
	}
}

func TestParseCurlHeadAndJoinedData(t *testing.T) {
	got, err := ParseCurl(`curl -I https://api.example.com/status -d a=1 -d b=2`)
	if err != nil {
		t.Fatal(err)
	}
	if got.Method != "HEAD" || got.Body != "a=1&b=2" {
		t.Fatalf("parsed=%+v", got)
	}
}

func TestParseCurlRejectsEmptyAndMissingURL(t *testing.T) {
	if _, err := ParseCurl("echo hi"); err == nil || !errors.Is(err, ErrHTTPRequest) {
		t.Fatalf("not curl: %v", err)
	}
	if _, err := ParseCurl("curl --silent"); err == nil || !strings.Contains(err.Error(), "url") {
		t.Fatalf("missing url: %v", err)
	}
}

func TestRewriteURLWithVarsLongestPrefix(t *testing.T) {
	got := RewriteURLWithVars("http://127.0.0.1:8080/health", map[string]string{"API_URL": "http://127.0.0.1:8080", "OTHER": "http://x"})
	if got != "{{API_URL}}/health" {
		t.Fatalf("got=%q", got)
	}
	if RewriteURLWithVars("https://elsewhere/v1", map[string]string{"API_URL": "http://127.0.0.1:8080"}) != "https://elsewhere/v1" {
		t.Fatal("unrelated host must stay")
	}
}
