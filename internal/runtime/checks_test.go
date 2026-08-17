package runtime

import (
	"context"
	"strings"
	"testing"
)

func TestValidateHTTPCheckURLScopes(t *testing.T) {
	tests := []struct {
		name  string
		url   string
		scope string
		ok    bool
	}{
		{name: "local loopback", url: "http://127.0.0.1:8080/health", scope: "local", ok: true},
		{name: "local hostname", url: "http://localhost:8080/health", scope: "local", ok: true},
		{name: "remote public", url: "https://9984-b2b-ots.gcp.enuygun.dev/health", scope: "remote", ok: true},
		{name: "remote private vpn", url: "http://10.42.0.8:8080/ready", scope: "remote", ok: true},
		{name: "implicit remote blocked", url: "https://example.com/health", scope: "local", ok: false},
		{name: "mislabelled local blocked", url: "http://127.0.0.1:8080/health", scope: "remote", ok: false},
		{name: "metadata blocked", url: "http://169.254.169.254/latest/meta-data", scope: "remote", ok: false},
		{name: "credentials blocked", url: "https://user:secret@example.com/health", scope: "remote", ok: false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := validateHTTPCheckURL(test.url, test.scope)
			if (err == nil) != test.ok {
				t.Fatalf("validate error=%v, want ok=%v", err, test.ok)
			}
		})
	}
}

func TestRemoteHTTPDialerRejectsDNSResolvingToLoopback(t *testing.T) {
	_, err := scopedHTTPDialer("remote")(context.Background(), "tcp", "localhost:4242")
	if err == nil || !strings.Contains(err.Error(), "forbidden local address") {
		t.Fatalf("dial error=%v", err)
	}
}
