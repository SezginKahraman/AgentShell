package runtime

import (
	"context"
	"strings"
)

type runSourceContextKey struct{}

// WithRunSource records the actor responsible for starts performed through
// this request context. The value is persisted on the resulting Run.
func WithRunSource(ctx context.Context, source string) context.Context {
	source = cleanRunSource(source)
	if source == "" {
		return ctx
	}
	return context.WithValue(ctx, runSourceContextKey{}, source)
}

// RunSource returns the request actor when one was supplied, otherwise the
// caller's honest fallback (for example catalog, check, or user).
func RunSource(ctx context.Context, fallback string) string {
	if ctx != nil {
		if source, ok := ctx.Value(runSourceContextKey{}).(string); ok && source != "" {
			return source
		}
	}
	return cleanRunSource(fallback)
}

func cleanRunSource(source string) string {
	source = strings.TrimSpace(strings.ReplaceAll(strings.ReplaceAll(source, "\r", " "), "\n", " "))
	if len(source) > 200 {
		source = source[:200]
	}
	return source
}
