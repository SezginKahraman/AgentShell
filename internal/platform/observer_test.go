package platform

import (
	"net"
	"testing"
)

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

func TestPortListeningChecksObservableTCPHealth(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	if !PortListening(port) {
		t.Fatal("open TCP port was not detected")
	}
	_ = listener.Close()
	if PortListening(port) {
		t.Fatal("closed TCP port was reported listening")
	}
}

func TestPortOpenDetectsBoundUDPPorts(t *testing.T) {
	conn, err := net.ListenPacket("udp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := conn.LocalAddr().(*net.UDPAddr).Port
	if !PortOpen(port, "udp") {
		t.Fatal("bound UDP port was not detected")
	}
	_ = conn.Close()
	if PortOpen(port, "udp") {
		t.Fatal("closed UDP port was reported bound")
	}
	if PortOpen(port, "tcp") {
		t.Fatal("UDP-only port was reported as TCP listening")
	}
}
