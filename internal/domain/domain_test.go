package domain

import "testing"

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
