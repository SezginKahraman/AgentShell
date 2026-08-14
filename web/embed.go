// Package webassets exposes the built dashboard for embedding in the AgentShell binary.
package webassets

import (
	"embed"
	"io/fs"
)

// content contains the Vite production build. Run npm run build before packaging.
//
//go:embed all:dist
var content embed.FS

// Dist returns the dashboard filesystem rooted at dist.
func Dist() (fs.FS, error) {
	return fs.Sub(content, "dist")
}
