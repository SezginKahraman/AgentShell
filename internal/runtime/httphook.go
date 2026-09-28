package runtime

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/agentshell/agentshell/internal/domain"
)

const (
	httpHookHarnessVersion = "1"
	httpHookRunTimeout     = 10 * time.Second
	httpHookBuildTimeout   = 60 * time.Second
	maxHTTPHookLog         = 32 << 10
)

var httpHookBuildMu sync.Mutex

type httpHookRequest struct {
	Method  string            `json:"Method"`
	URL     string            `json:"URL"`
	Headers map[string]string `json:"Headers"`
	Body    string            `json:"Body"`
	Env     map[string]string `json:"Env"`
}

type httpHookResponse struct {
	Status  int               `json:"Status"`
	Headers map[string]string `json:"Headers"`
	Body    string            `json:"Body"`
}

type httpHookOutput struct {
	Request  httpHookRequest  `json:"Request"`
	Response httpHookResponse `json:"Response"`
	Log      string           `json:"Log"`
	Error    string           `json:"Error"`
}

func (m *Manager) runHTTPHook(ctx context.Context, phase, script string, req *httpHookRequest, res *httpHookResponse) (string, error) {
	binary, err := m.httpHookBinary(ctx, script)
	if err != nil {
		return "", err
	}
	if req.Headers == nil {
		req.Headers = map[string]string{}
	}
	if req.Env == nil {
		req.Env = map[string]string{}
	}
	response := httpHookResponse{}
	if res != nil {
		response = *res
	}
	if response.Headers == nil {
		response.Headers = map[string]string{}
	}
	raw, err := json.Marshal(struct {
		Phase    string           `json:"Phase"`
		Request  httpHookRequest  `json:"Request"`
		Response httpHookResponse `json:"Response"`
	}{Phase: phase, Request: *req, Response: response})
	if err != nil {
		return "", err
	}
	runCtx, cancel := context.WithTimeout(ctx, httpHookRunTimeout)
	defer cancel()
	cmd := exec.CommandContext(runCtx, binary)
	cmd.Stdin = bytes.NewReader(raw)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	runErr := cmd.Run()
	var out httpHookOutput
	if jsonErr := json.Unmarshal(stdout.Bytes(), &out); jsonErr != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = strings.TrimSpace(stdout.String())
		}
		if msg == "" && runErr != nil {
			msg = runErr.Error()
		}
		if runCtx.Err() != nil && ctx.Err() == nil {
			msg = "timed out"
		}
		if msg == "" {
			msg = jsonErr.Error()
		}
		return "", fmt.Errorf("http hook: %s", msg)
	}
	*req = out.Request
	if res != nil {
		*res = out.Response
	}
	if out.Error != "" {
		return truncateHookLog(out.Log), fmt.Errorf("http hook: %s", out.Error)
	}
	if runErr != nil {
		return truncateHookLog(out.Log), fmt.Errorf("http hook: %s", runErr.Error())
	}
	return truncateHookLog(out.Log), nil
}

func (m *Manager) persistHTTPHookEnv(ctx context.Context, lib *domain.EnvironmentLibrary, envName string, before, after map[string]string) error {
	next, changed := domain.ApplyHTTPHookEnv(*lib, envName, before, after)
	if !changed {
		return nil
	}
	if err := m.store.SaveEnvironmentLibrary(ctx, next); err != nil {
		return err
	}
	*lib = next
	return nil
}

func (m *Manager) httpHookBinary(ctx context.Context, script string) (string, error) {
	if _, err := exec.LookPath("go"); err != nil {
		return "", fmt.Errorf("http hook: go toolchain not found")
	}
	hasPre, hasPost, err := httpHookFuncs(script)
	if err != nil {
		return "", fmt.Errorf("http hook: %w", err)
	}
	if !hasPre && !hasPost {
		return "", fmt.Errorf("http hook: script must define Pre or Post")
	}
	sum := sha256.Sum256([]byte(httpHookHarnessVersion + "\n" + script))
	dir := filepath.Join(m.httpHookRoot(), hex.EncodeToString(sum[:]))
	binary := filepath.Join(dir, "hook.bin")
	httpHookBuildMu.Lock()
	defer httpHookBuildMu.Unlock()
	if info, statErr := os.Stat(binary); statErr == nil && !info.IsDir() {
		return binary, nil
	}
	if err = os.MkdirAll(filepath.Join(dir, "hook"), 0o755); err != nil {
		return "", err
	}
	files := map[string]string{
		"go.mod":                            httpHookGoMod,
		"main.go":                           httpHookMain,
		filepath.Join("hook", "request.go"): httpHookTypes,
		filepath.Join("hook", "script.go"):  script,
	}
	if !hasPre || !hasPost {
		files[filepath.Join("hook", "missing.go")] = httpHookStubs(hasPre, hasPost)
	}
	for name, content := range files {
		if err = os.WriteFile(filepath.Join(dir, name), []byte(content), 0o644); err != nil {
			return "", err
		}
	}
	buildCtx, cancel := context.WithTimeout(ctx, httpHookBuildTimeout)
	defer cancel()
	cmd := exec.CommandContext(buildCtx, "go", "build", "-o", binary, ".")
	cmd.Dir = dir
	cmd.Env = replaceEnv(os.Environ(), map[string]string{
		"GO111MODULE": "on",
		"GOSUMDB":     "off",
		"GOPROXY":     "off",
		"GOTOOLCHAIN": "local",
		"CGO_ENABLED": "0",
	})
	output, err := cmd.CombinedOutput()
	if err != nil {
		_ = os.RemoveAll(dir)
		msg := strings.TrimSpace(string(output))
		if msg == "" {
			msg = err.Error()
		}
		return "", fmt.Errorf("http hook: %s", msg)
	}
	if err = os.Chmod(binary, 0o755); err != nil {
		return "", err
	}
	return binary, nil
}

func (m *Manager) httpHookRoot() string {
	root := strings.TrimSpace(m.cfg.DataDir)
	if root == "" {
		root = os.TempDir()
	}
	return filepath.Join(root, "http-hooks")
}

func httpHookFuncs(src string) (hasPre, hasPost bool, err error) {
	file, err := parser.ParseFile(token.NewFileSet(), "script.go", src, 0)
	if err != nil {
		return false, false, err
	}
	if file.Name == nil || file.Name.Name != "hook" {
		return false, false, fmt.Errorf("script must be package hook")
	}
	for _, decl := range file.Decls {
		fn, ok := decl.(*ast.FuncDecl)
		if !ok || fn.Recv != nil || fn.Name == nil {
			continue
		}
		switch fn.Name.Name {
		case "Pre":
			hasPre = true
		case "Post":
			hasPost = true
		}
	}
	return hasPre, hasPost, nil
}

func httpHookStubs(hasPre, hasPost bool) string {
	var b strings.Builder
	b.WriteString("package hook\n\n")
	if !hasPre {
		b.WriteString("func Pre(req *Request) error { return nil }\n\n")
	}
	if !hasPost {
		b.WriteString("func Post(req *Request, res *Response) error { return nil }\n")
	}
	return b.String()
}

func cloneStringMap(in map[string]string) map[string]string {
	out := make(map[string]string, len(in))
	for key, value := range in {
		out[key] = value
	}
	return out
}

func joinHookLog(base, extra string) string {
	extra = strings.TrimRight(extra, "\n")
	if extra == "" {
		return truncateHookLog(base)
	}
	if strings.TrimSpace(base) == "" {
		return truncateHookLog(extra)
	}
	return truncateHookLog(base + "\n" + extra)
}

func truncateHookLog(text string) string {
	if len(text) <= maxHTTPHookLog {
		return text
	}
	return text[:maxHTTPHookLog]
}

func replaceEnv(base []string, overrides map[string]string) []string {
	out := make([]string, 0, len(base)+len(overrides))
	for _, item := range base {
		key, _, ok := strings.Cut(item, "=")
		if ok {
			if _, replace := overrides[key]; replace {
				continue
			}
		}
		out = append(out, item)
	}
	for key, value := range overrides {
		out = append(out, key+"="+value)
	}
	return out
}

const httpHookGoMod = `module agentshell.http.hook

go 1.25.0
`

const httpHookTypes = `package hook

type Request struct {
	Method  string
	URL     string
	Headers map[string]string
	Body    string
	Env     map[string]string
}

type Response struct {
	Status  int
	Headers map[string]string
	Body    string
}
`

const httpHookMain = `package main

import (
	"encoding/json"
	"fmt"
	"io"
	"os"

	"agentshell.http.hook/hook"
)

type envelope struct {
	Phase    string
	Request  hook.Request
	Response hook.Response
}

type result struct {
	Request  hook.Request
	Response hook.Response
	Log      string
	Error    string
}

func main() {
	raw, err := io.ReadAll(os.Stdin)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	var in envelope
	if err = json.Unmarshal(raw, &in); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	if in.Request.Headers == nil {
		in.Request.Headers = map[string]string{}
	}
	if in.Request.Env == nil {
		in.Request.Env = map[string]string{}
	}
	if in.Response.Headers == nil {
		in.Response.Headers = map[string]string{}
	}
	realStdout := os.Stdout
	reader, writer, err := os.Pipe()
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	os.Stdout = writer
	os.Stderr = writer
	logged := make(chan []byte, 1)
	go func() {
		buf, _ := io.ReadAll(io.LimitReader(reader, 32768))
		_, _ = io.Copy(io.Discard, reader)
		logged <- buf
	}()
	var callErr error
	func() {
		defer func() {
			if recovered := recover(); recovered != nil {
				callErr = fmt.Errorf("%v", recovered)
			}
		}()
		switch in.Phase {
		case "pre":
			callErr = hook.Pre(&in.Request)
		case "post":
			callErr = hook.Post(&in.Request, &in.Response)
		default:
			callErr = fmt.Errorf("unknown phase %q", in.Phase)
		}
	}()
	_ = writer.Close()
	logText := string(<-logged)
	os.Stdout = realStdout
	message := ""
	if callErr != nil {
		message = callErr.Error()
	}
	_ = json.NewEncoder(realStdout).Encode(result{Request: in.Request, Response: in.Response, Log: logText, Error: message})
	if callErr != nil {
		os.Exit(1)
	}
}
`
