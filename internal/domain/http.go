package domain

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
)

var (
	ErrHTTPRequest         = errors.New("invalid http request")
	httpPlaceholderPattern = regexp.MustCompile(`\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}`)
)

const DefaultHTTPRequestTimeoutMS = 10000
const MaxHTTPRequestTimeoutMS = 120000
const MaxHTTPRequestBody = 256 << 10

func HTTPCollectionEnvironment(lib EnvironmentLibrary, collectionEnv string, stack *Stack) string {
	if stack != nil {
		return MemberEnvironmentName(stack.Environment, "")
	}
	if name := strings.TrimSpace(collectionEnv); name != "" {
		return strings.ToLower(name)
	}
	return DefaultEnvironmentNameIn(lib.Names)
}

func ResolveHTTPRequestVars(lib EnvironmentLibrary, collectionEnv string, stack *Stack) (string, map[string]string) {
	name := HTTPCollectionEnvironment(lib, collectionEnv, stack)
	out := map[string]string{}
	for key, value := range LayerValues(lib.Values, name) {
		out[key] = value
	}
	if stack != nil {
		for key, value := range LayerValues(stack.Env, name) {
			out[key] = value
		}
	}
	return name, out
}

func Interpolate(template string, vars map[string]string) (string, error) {
	var missing []string
	seen := map[string]bool{}
	out := httpPlaceholderPattern.ReplaceAllStringFunc(template, func(match string) string {
		sub := httpPlaceholderPattern.FindStringSubmatch(match)
		key := sub[1]
		value, ok := vars[key]
		if !ok {
			if !seen[key] {
				seen[key] = true
				missing = append(missing, key)
			}
			return match
		}
		return value
	})
	if len(missing) > 0 {
		return "", fmt.Errorf("%w: unresolved placeholders: %s", ErrHTTPRequest, strings.Join(missing, ", "))
	}
	if strings.Contains(out, "{{") {
		return "", fmt.Errorf("%w: invalid placeholder syntax", ErrHTTPRequest)
	}
	return out, nil
}

func RemapHTTPCollectionEnvironment(collection *HTTPCollection, deleted, fallback string) {
	if collection == nil {
		return
	}
	if collection.Environment == deleted {
		collection.Environment = fallback
	}
}

func NormalizeHTTPMethod(method string) (string, error) {
	method = strings.ToUpper(strings.TrimSpace(method))
	if method == "" {
		method = "GET"
	}
	switch method {
	case "GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS":
		return method, nil
	default:
		return "", fmt.Errorf("%w: unsupported HTTP method %q", ErrHTTPRequest, method)
	}
}

func NormalizeHTTPRequestTimeout(ms int) int {
	if ms <= 0 {
		return DefaultHTTPRequestTimeoutMS
	}
	if ms < 100 {
		return 100
	}
	if ms > MaxHTTPRequestTimeoutMS {
		return MaxHTTPRequestTimeoutMS
	}
	return ms
}
