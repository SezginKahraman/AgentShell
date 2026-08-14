package platform

import "testing"

func TestParseProcAddress(t *testing.T) {
	address, port := parseProcAddress("0100007F:1F90")
	if address != "127.0.0.1" || port != 8080 {
		t.Fatalf("got %s:%d", address, port)
	}
	address, port = parseProcAddress("00000000000000000000000000000000:0050")
	if address != "::" || port != 80 {
		t.Fatalf("got %s:%d", address, port)
	}
}
