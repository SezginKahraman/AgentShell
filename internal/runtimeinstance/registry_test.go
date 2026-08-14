package runtimeinstance

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestAcquirePreventsDuplicateAndRemovesRecord(t *testing.T) {
	dir := t.TempDir()
	h, err := Acquire(dir, "test")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = h.Publish("http://127.0.0.1:1"); err != nil {
		t.Fatal(err)
	}
	if _, err = Acquire(dir, "test"); err == nil {
		t.Fatal("second runtime unexpectedly acquired the lock")
	}
	if err = h.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(filepath.Join(dir, RuntimeFile)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("runtime record remains: %v", err)
	}
}

func TestDiscoverValidatesRuntimeIdentity(t *testing.T) {
	dir := t.TempDir()
	h, err := Acquire(dir, "test")
	if err != nil {
		t.Fatal(err)
	}
	defer h.Close()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"instance_id": h.Record().InstanceID, "status": "running"})
	}))
	defer server.Close()
	if _, err = h.Publish(server.URL); err != nil {
		t.Fatal(err)
	}
	record, err := Discover(context.Background(), dir)
	if err != nil {
		t.Fatal(err)
	}
	if record.APIURL != server.URL || record.PID != os.Getpid() {
		t.Fatalf("record=%+v", record)
	}
}

func TestDiscoverRejectsStaleOrMismatchedRecord(t *testing.T) {
	dir := t.TempDir()
	h, err := Acquire(dir, "test")
	if err != nil {
		t.Fatal(err)
	}
	defer h.Close()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"instance_id": "different-runtime", "status": "running"})
	}))
	defer server.Close()
	if _, err = h.Publish(server.URL); err != nil {
		t.Fatal(err)
	}
	if _, err = Discover(context.Background(), dir); err == nil {
		t.Fatal("mismatched runtime record was accepted")
	}
}
