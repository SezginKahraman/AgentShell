package httpapi

import (
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/agentshell/agentshell/internal/domain"
)

const maxCommandSourceBytes = 512 << 10

type commandSource struct {
	Available bool   `json:"available"`
	Path      string `json:"path,omitempty"`
	Content   string `json:"content,omitempty"`
	Truncated bool   `json:"truncated,omitempty"`
	Reason    string `json:"reason,omitempty"`
}

// readCommandSource recognizes a deliberately small shell-script invocation
// shape. It never evaluates the command and only reads a regular .sh file
// contained by the launcher's canonical working directory.
func readCommandSource(command domain.CommandDefinition) (commandSource, error) {
	root, err := filepath.EvalSymlinks(command.Cwd)
	if err != nil {
		return commandSource{}, err
	}
	var candidate string
	for _, token := range strings.Fields(command.Command) {
		token = strings.Trim(token, "'\"")
		if strings.HasSuffix(strings.ToLower(token), ".sh") {
			candidate = token
			break
		}
	}
	if candidate == "" {
		return commandSource{Available: false, Reason: "This launcher does not directly reference a .sh file."}, nil
	}
	path := candidate
	if !filepath.IsAbs(path) {
		path = filepath.Join(root, filepath.FromSlash(path))
	}
	path, err = filepath.EvalSymlinks(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return commandSource{Available: false, Reason: "The referenced script no longer exists."}, nil
		}
		return commandSource{}, err
	}
	relative, err := filepath.Rel(root, path)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return commandSource{}, errors.New("script path must remain inside the launcher working directory")
	}
	info, err := os.Stat(path)
	if err != nil {
		return commandSource{}, err
	}
	if !info.Mode().IsRegular() {
		return commandSource{}, errors.New("script source is not a regular file")
	}
	f, err := os.Open(path)
	if err != nil {
		return commandSource{}, err
	}
	defer f.Close()
	buffer := make([]byte, maxCommandSourceBytes+1)
	n, err := f.Read(buffer)
	if err != nil && !errors.Is(err, io.EOF) {
		return commandSource{}, err
	}
	truncated := n > maxCommandSourceBytes
	if truncated {
		n = maxCommandSourceBytes
	}
	return commandSource{Available: true, Path: filepath.ToSlash(relative), Content: string(buffer[:n]), Truncated: truncated}, nil
}
