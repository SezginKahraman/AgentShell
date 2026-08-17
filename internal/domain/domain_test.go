package domain

import (
	"testing"
	"time"
)

func TestCommandFingerprintIgnoresMetadataAndNormalizesDefaults(t *testing.T) {
	base := CommandDefinition{ProjectID: "project", Command: "  make   go ", Cwd: "/workspace", Kind: "service"}
	variant := base
	variant.Command = "make go"
	variant.Shell = "/bin/sh"
	variant.Name = "Renamed"
	variant.Description = "new description"
	variant.ExpectedPorts = []ExpectedPort{{Port: 8080, Name: "HTTP"}}
	variant.Tags = []string{"internal"}
	if CommandFingerprint(base) != CommandFingerprint(variant) {
		t.Fatalf("metadata changed fingerprint: %s != %s", CommandFingerprint(base), CommandFingerprint(variant))
	}
	variant.ProjectID = "other"
	if CommandFingerprint(base) == CommandFingerprint(variant) {
		t.Fatal("project identity must affect fingerprint")
	}
}

func TestCommandParametersRejectSecretDefaultsAndResolveTransientBindings(t *testing.T) {
	invalid := []CommandParameter{{Key: "token", Label: "Token", Type: "secret", Required: true, Default: "must-not-persist", Binding: "stdin"}}
	if err := ValidateCommandParameters(invalid); err == nil {
		t.Fatal("secret default must be rejected")
	}
	parameters := []CommandParameter{
		{Key: "token", Label: "Token", Type: "secret", Required: true, Binding: "stdin"},
		{Key: "region", Label: "Region", Type: "choice", Default: "eu", Options: []string{"eu", "us"}, Binding: "env", EnvVar: "APP_REGION"},
	}
	env, stdin, err := ResolveCommandParameters(parameters, map[string]string{"token": "one-shot-secret"})
	if err != nil {
		t.Fatal(err)
	}
	if string(stdin) != "one-shot-secret" || env["APP_REGION"] != "eu" {
		t.Fatalf("stdin=%q env=%v", stdin, env)
	}
	if _, _, err = ResolveCommandParameters(parameters, map[string]string{"token": "x", "unknown": "y"}); err == nil {
		t.Fatal("unknown runtime parameter must be rejected")
	}
}

func TestCommandParametersAllowOnlyOneStdinBinding(t *testing.T) {
	parameters := []CommandParameter{
		{Key: "first", Label: "First", Type: "text", Binding: "stdin"},
		{Key: "second", Label: "Second", Type: "text", Binding: "stdin"},
	}
	if err := ValidateCommandParameters(parameters); err == nil {
		t.Fatal("multiple stdin parameters must be rejected")
	}
}

func TestPrerequisiteMemberReadyAndStackGraphCycles(t *testing.T) {
	if PrerequisiteMemberReady("managed", "", true) != true {
		t.Fatal("managed can_stop must be up enough")
	}
	if PrerequisiteMemberReady("managed", "", false) {
		t.Fatal("stopped managed member must not be up enough")
	}
	if PrerequisiteMemberReady("external", "running", true) != true {
		t.Fatal("external running must be up enough")
	}
	if PrerequisiteMemberReady("external", "checking", true) != true {
		t.Fatal("external checking must be up enough")
	}
	if PrerequisiteMemberReady("external", "unknown", true) != true {
		t.Fatal("started unverified must be up enough")
	}
	if PrerequisiteMemberReady("external", "unknown", false) {
		t.Fatal("unknown without can_stop must not be up enough")
	}
	if PrerequisiteMemberReady("external", "stopped", false) {
		t.Fatal("stopped external must not be up enough")
	}

	normalized := NormalizeStackPrerequisites([]StackPrerequisite{{StackID: " stack-a ", WaitTimeoutMS: 0}})
	if len(normalized) != 1 || normalized[0].StackID != "stack-a" || normalized[0].WaitTimeoutMS != DefaultStackPrerequisiteTimeoutMS {
		t.Fatalf("normalize=%+v", normalized)
	}

	graph := map[string][]string{"stack-a": {"stack-b"}, "stack-b": {"stack-c"}}
	if id := StackPrerequisiteCycle("stack-c", []StackPrerequisite{{StackID: "stack-a"}}, graph); id == "" {
		t.Fatal("transitive cycle C→A→B→C must be detected")
	}
	if id := StackPrerequisiteCycle("stack-app", []StackPrerequisite{{StackID: "stack-a"}}, graph); id != "" {
		t.Fatalf("acyclic graph reported cycle at %s", id)
	}
	if id := StackPrerequisiteCycle("stack-a", []StackPrerequisite{{StackID: "stack-a"}}, nil); id != "stack-a" {
		t.Fatalf("self cycle=%q", id)
	}
}

func TestObserveExternalRunSeparatesLifecycleFromCurrentState(t *testing.T) {
	now := time.Now().UTC()
	tests := []struct {
		name       string
		run        Run
		state      string
		confidence string
	}{
		{name: "start without evidence is unknown", run: Run{LifecycleAction: "start", Status: RunCompleted}, state: "unknown", confidence: "action"},
		{name: "verified listener is running", run: Run{LifecycleAction: "start", Status: RunCompleted, PortVerifications: []PortVerification{{Port: 8080, Status: "verified", Current: "listening", CheckedAt: now}}}, state: "running", confidence: "high"},
		{name: "preexisting listener is available but unattributed", run: Run{LifecycleAction: "start", Status: RunCompleted, PortVerifications: []PortVerification{{Port: 8080, Status: "preexisting", Current: "listening", CheckedAt: now}}}, state: "running", confidence: "observed"},
		{name: "verified listener later closed is stopped", run: Run{LifecycleAction: "start", Status: RunCompleted, PortVerifications: []PortVerification{{Port: 8080, Status: "verified", Current: "closed", CheckedAt: now}}}, state: "stopped", confidence: "high"},
		{name: "completed stop is stopped", run: Run{LifecycleAction: "stop", Status: RunCompleted, PortVerifications: []PortVerification{{Port: 8080, Status: "stopped", Current: "closed", CheckedAt: now}}}, state: "stopped", confidence: "high"},
		{name: "failed stop with listening port remains running", run: Run{LifecycleAction: "stop", Status: RunFailed, PortVerifications: []PortVerification{{Port: 8080, Status: "still_listening", Current: "listening", CheckedAt: now}}}, state: "running", confidence: "observed"},
		{name: "active lifecycle is checking", run: Run{LifecycleAction: "start", Status: RunRunning}, state: "checking", confidence: "action"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := ObserveExternalRun(test.run)
			if got.State != test.state || got.Confidence != test.confidence {
				t.Fatalf("observation=%+v want state=%s confidence=%s", got, test.state, test.confidence)
			}
		})
	}
}
