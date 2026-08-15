package platform

import (
	"bufio"
	"context"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/agentshell/agentshell/internal/domain"
)

// StartToken distinguishes a process from a later process that reuses its PID.
func StartToken(ctx context.Context, pid int) string {
	out, err := exec.CommandContext(ctx, "ps", "-o", "lstart=", "-p", strconv.Itoa(pid)).Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

func Alive(pid int, token string) bool {
	if pid <= 0 {
		return false
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	current := StartToken(ctx, pid)
	return current != "" && (token == "" || current == token)
}

// Processes returns the processes in pgid. ps is available on both supported platforms.
func Processes(ctx context.Context, pgid int) ([]domain.Process, error) {
	if pgid <= 0 {
		return nil, nil
	}
	out, err := exec.CommandContext(ctx, "ps", "-axo", "pid=,ppid=,pgid=,%cpu=,rss=,command=").Output()
	if err != nil {
		return nil, err
	}
	var result []domain.Process
	s := bufio.NewScanner(strings.NewReader(string(out)))
	for s.Scan() {
		f := strings.Fields(s.Text())
		if len(f) < 6 {
			continue
		}
		p, _ := strconv.Atoi(f[0])
		pp, _ := strconv.Atoi(f[1])
		pg, _ := strconv.Atoi(f[2])
		if pg != pgid {
			continue
		}
		cpu, _ := strconv.ParseFloat(f[3], 64)
		rss, _ := strconv.ParseInt(f[4], 10, 64)
		result = append(result, domain.Process{PID: p, PPID: pp, PGID: pg, CPUPercent: cpu, MemoryBytes: rss * 1024, Command: strings.Join(f[5:], " ")})
	}
	return result, s.Err()
}

// Listeners uses lsof when available. Failure is non-fatal because lsof is optional on Linux.
func Listeners(ctx context.Context, pids map[int]bool) ([]domain.Listener, error) {
	if len(pids) == 0 {
		return nil, nil
	}
	if runtime.GOOS == "linux" {
		if listeners, err := procListeners(pids); err == nil {
			return listeners, nil
		}
	}
	out, err := exec.CommandContext(ctx, "lsof", "-nP", "-iTCP", "-sTCP:LISTEN", "-FpnPT").Output()
	if err != nil {
		return nil, nil
	}
	var result []domain.Listener
	var pid int
	var transport = "tcp"
	for _, line := range strings.Split(string(out), "\n") {
		if len(line) < 2 {
			continue
		}
		switch line[0] {
		case 'p':
			pid, _ = strconv.Atoi(line[1:])
		case 'P':
			transport = strings.ToLower(line[1:])
		case 'n':
			if !pids[pid] {
				continue
			}
			addr, port := splitAddress(line[1:])
			if port > 0 {
				result = append(result, domain.Listener{PID: pid, Address: addr, Port: port, Transport: transport})
			}
		}
	}
	return result, nil
}

// procListeners attributes Linux listening sockets without shelling out to
// lsof. Socket inodes from the owned PIDs' fd directories are joined with the
// kernel TCP tables. Permission errors cause the caller to use its lsof fallback.
func procListeners(pids map[int]bool) ([]domain.Listener, error) {
	inodePID := map[string]int{}
	for pid := range pids {
		entries, err := os.ReadDir(filepath.Join("/proc", strconv.Itoa(pid), "fd"))
		if err != nil {
			continue
		}
		for _, entry := range entries {
			target, err := os.Readlink(filepath.Join("/proc", strconv.Itoa(pid), "fd", entry.Name()))
			if err != nil {
				continue
			}
			if strings.HasPrefix(target, "socket:[") && strings.HasSuffix(target, "]") {
				inodePID[strings.TrimSuffix(strings.TrimPrefix(target, "socket:["), "]")] = pid
			}
		}
	}
	var out []domain.Listener
	for _, table := range []string{"/proc/net/tcp", "/proc/net/tcp6"} {
		f, err := os.Open(table)
		if err != nil {
			return nil, err
		}
		scan := bufio.NewScanner(f)
		first := true
		for scan.Scan() {
			if first {
				first = false
				continue
			}
			fields := strings.Fields(scan.Text())
			if len(fields) < 10 || fields[3] != "0A" {
				continue
			}
			pid, owned := inodePID[fields[9]]
			if !owned {
				continue
			}
			address, port := parseProcAddress(fields[1])
			if port > 0 {
				out = append(out, domain.Listener{PID: pid, Address: address, Port: port, Transport: "tcp"})
			}
		}
		err = scan.Err()
		_ = f.Close()
		if err != nil {
			return nil, err
		}
	}
	return out, nil
}
func parseProcAddress(value string) (string, int) {
	parts := strings.SplitN(value, ":", 2)
	if len(parts) != 2 {
		return "", 0
	}
	port64, err := strconv.ParseInt(parts[1], 16, 32)
	if err != nil {
		return "", 0
	}
	hexAddr := parts[0]
	if len(hexAddr) == 8 {
		bytes := make([]byte, 4)
		for i := 0; i < 4; i++ {
			v, e := strconv.ParseUint(hexAddr[i*2:i*2+2], 16, 8)
			if e != nil {
				return "", 0
			}
			bytes[3-i] = byte(v)
		}
		return net.IP(bytes).String(), int(port64)
	}
	if strings.Trim(hexAddr, "0") == "" {
		return "::", int(port64)
	}
	return hexAddr, int(port64)
}

func splitAddress(s string) (string, int) {
	s = strings.TrimSuffix(s, " (LISTEN)")
	i := strings.LastIndex(s, ":")
	if i < 0 {
		return s, 0
	}
	p, _ := strconv.Atoi(s[i+1:])
	return strings.Trim(s[:i], "[]"), p
}

func PortAvailable(port int) bool {
	if port < 1 || port > 65535 {
		return false
	}
	l, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		return false
	}
	_ = l.Close()
	return true
}

// PortListening checks observable TCP health without claiming ownership. It is
// used for detached/external resources whose processes are outside the managed
// process group.
func PortListening(port int) bool {
	if port < 1 || port > 65535 {
		return false
	}
	for _, host := range []string{"127.0.0.1", "::1"} {
		conn, err := net.DialTimeout("tcp", net.JoinHostPort(host, strconv.Itoa(port)), 150*time.Millisecond)
		if err == nil {
			_ = conn.Close()
			return true
		}
	}
	return false
}
