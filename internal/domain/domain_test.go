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
