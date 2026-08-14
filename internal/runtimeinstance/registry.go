package runtimeinstance

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"syscall"
	"time"
)

const (
	RuntimeFile = "runtime.json"
	LockFile    = "runtime.lock"
)

type Record struct {
	InstanceID string    `json:"instanceId"`
	PID        int       `json:"pid"`
	APIURL     string    `json:"apiUrl"`
	StartedAt  time.Time `json:"startedAt"`
	Version    string    `json:"version"`
}

type AlreadyRunningError struct{ Record Record }

func (e *AlreadyRunningError) Error() string {
	return fmt.Sprintf("AgentShell is already running.\nPID: %d\nDashboard:\n%s", e.Record.PID, e.Record.APIURL)
}

type Handle struct {
	dataDir string
	file    *os.File
	record  Record
	closed  bool
}

func Acquire(dataDir, version string) (*Handle, error) {
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		return nil, err
	}
	if err := os.Chmod(dataDir, 0o700); err != nil {
		return nil, err
	}
	lockPath := filepath.Join(dataDir, LockFile)
	f, err := os.OpenFile(lockPath, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, err
	}
	if err = syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		_ = f.Close()
		if existing, discoverErr := Discover(context.Background(), dataDir); discoverErr == nil {
			return nil, &AlreadyRunningError{Record: existing}
		}
		return nil, errors.New("another AgentShell runtime is starting; try again shortly")
	}
	h := &Handle{dataDir: dataDir, file: f, record: Record{InstanceID: newID(), PID: os.Getpid(), StartedAt: time.Now().UTC(), Version: version}}
	// Holding the exclusive lock proves any leftover record is stale.
	_ = os.Remove(filepath.Join(dataDir, RuntimeFile))
	return h, nil
}

func (h *Handle) Publish(apiURL string) (Record, error) {
	h.record.APIURL = apiURL
	raw, err := json.MarshalIndent(h.record, "", "  ")
	if err != nil {
		return Record{}, err
	}
	tmp := filepath.Join(h.dataDir, RuntimeFile+".tmp")
	if err = os.WriteFile(tmp, raw, 0o600); err != nil {
		return Record{}, err
	}
	if err = os.Chmod(tmp, 0o600); err != nil {
		_ = os.Remove(tmp)
		return Record{}, err
	}
	if err = os.Rename(tmp, filepath.Join(h.dataDir, RuntimeFile)); err != nil {
		_ = os.Remove(tmp)
		return Record{}, err
	}
	return h.record, nil
}

func (h *Handle) Record() Record { return h.record }

func (h *Handle) Close() error {
	if h == nil || h.closed {
		return nil
	}
	h.closed = true
	path := filepath.Join(h.dataDir, RuntimeFile)
	if current, err := Read(h.dataDir); err == nil && current.InstanceID == h.record.InstanceID {
		_ = os.Remove(path)
	}
	_ = syscall.Flock(int(h.file.Fd()), syscall.LOCK_UN)
	return h.file.Close()
}

func Read(dataDir string) (Record, error) {
	raw, err := os.ReadFile(filepath.Join(dataDir, RuntimeFile))
	if err != nil {
		return Record{}, err
	}
	var record Record
	if err = json.Unmarshal(raw, &record); err != nil {
		return Record{}, err
	}
	if record.InstanceID == "" || record.PID <= 0 || record.APIURL == "" {
		return Record{}, errors.New("runtime.json is incomplete")
	}
	return record, nil
}

func Discover(ctx context.Context, dataDir string) (Record, error) {
	record, err := Read(dataDir)
	if err != nil {
		return Record{}, runtimeUnavailable(err)
	}
	if !pidAlive(record.PID) {
		return Record{}, runtimeUnavailable(errors.New("recorded PID is not alive"))
	}
	requestCtx, cancel := context.WithTimeout(ctx, 750*time.Millisecond)
	defer cancel()
	req, err := http.NewRequestWithContext(requestCtx, http.MethodGet, record.APIURL+"/api/runtime", nil)
	if err != nil {
		return Record{}, runtimeUnavailable(err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return Record{}, runtimeUnavailable(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return Record{}, runtimeUnavailable(fmt.Errorf("health returned HTTP %d", resp.StatusCode))
	}
	var status struct {
		InstanceID string `json:"instance_id"`
		Status     string `json:"status"`
	}
	if err = json.NewDecoder(resp.Body).Decode(&status); err != nil {
		return Record{}, runtimeUnavailable(err)
	}
	if status.InstanceID != record.InstanceID || (status.Status != "running" && status.Status != "stopping") {
		return Record{}, runtimeUnavailable(errors.New("runtime identity did not match"))
	}
	return record, nil
}

func runtimeUnavailable(cause error) error {
	return fmt.Errorf("AgentShell Runtime is not running. Start it with ./start.sh: %w", cause)
}

func pidAlive(pid int) bool {
	err := syscall.Kill(pid, 0)
	return err == nil || errors.Is(err, syscall.EPERM)
}

func newID() string {
	var value [12]byte
	_, _ = rand.Read(value[:])
	return "runtime_" + hex.EncodeToString(value[:])
}
