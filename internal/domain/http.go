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
const MaxHTTPBodyTemplates = 20
const DefaultHTTPBodyTemplateID = "default"
const DefaultHTTPBodyTemplateName = "Default"

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

func NormalizeHTTPBodyTemplates(body string, templates []HTTPBodyTemplate, activeID string) (string, []HTTPBodyTemplate, string) {
	out := make([]HTTPBodyTemplate, 0, len(templates))
	seen := map[string]bool{}
	for _, item := range templates {
		id := strings.TrimSpace(item.ID)
		name := strings.TrimSpace(item.Name)
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		if name == "" {
			name = "Template"
		}
		out = append(out, HTTPBodyTemplate{ID: id, Name: name, Body: item.Body})
		if len(out) >= MaxHTTPBodyTemplates {
			break
		}
	}
	if len(out) == 0 {
		out = []HTTPBodyTemplate{{ID: DefaultHTTPBodyTemplateID, Name: DefaultHTTPBodyTemplateName, Body: body}}
		return body, out, DefaultHTTPBodyTemplateID
	}
	active := strings.TrimSpace(activeID)
	found := false
	for i := range out {
		if out[i].ID == active {
			out[i].Body = body
			found = true
			break
		}
	}
	if !found {
		active = out[0].ID
		out[0].Body = body
	}
	return body, out, active
}

func SwitchHTTPBodyTemplate(body string, templates []HTTPBodyTemplate, activeID, nextID string) (string, []HTTPBodyTemplate, string, error) {
	body, templates, activeID = NormalizeHTTPBodyTemplates(body, templates, activeID)
	nextID = strings.TrimSpace(nextID)
	for _, item := range templates {
		if item.ID == nextID {
			return item.Body, templates, nextID, nil
		}
	}
	return body, templates, activeID, fmt.Errorf("%w: unknown body template", ErrHTTPRequest)
}

func AddHTTPBodyTemplate(body string, templates []HTTPBodyTemplate, activeID, id, name, newBody string) (string, []HTTPBodyTemplate, string, error) {
	body, templates, activeID = NormalizeHTTPBodyTemplates(body, templates, activeID)
	if len(templates) >= MaxHTTPBodyTemplates {
		return body, templates, activeID, fmt.Errorf("%w: at most %d body templates", ErrHTTPRequest, MaxHTTPBodyTemplates)
	}
	id = strings.TrimSpace(id)
	if id == "" {
		return body, templates, activeID, fmt.Errorf("%w: body template id is required", ErrHTTPRequest)
	}
	for _, item := range templates {
		if item.ID == id {
			return body, templates, activeID, fmt.Errorf("%w: duplicate body template", ErrHTTPRequest)
		}
	}
	name = strings.TrimSpace(name)
	if name == "" {
		name = fmt.Sprintf("Template %d", len(templates)+1)
	}
	templates = append(append([]HTTPBodyTemplate{}, templates...), HTTPBodyTemplate{ID: id, Name: name, Body: newBody})
	return newBody, templates, id, nil
}

func RemoveHTTPBodyTemplate(body string, templates []HTTPBodyTemplate, activeID, removeID string) (string, []HTTPBodyTemplate, string, error) {
	body, templates, activeID = NormalizeHTTPBodyTemplates(body, templates, activeID)
	if len(templates) <= 1 {
		return body, templates, activeID, fmt.Errorf("%w: keep at least one body template", ErrHTTPRequest)
	}
	removeID = strings.TrimSpace(removeID)
	out := make([]HTTPBodyTemplate, 0, len(templates)-1)
	for _, item := range templates {
		if item.ID != removeID {
			out = append(out, item)
		}
	}
	if len(out) == len(templates) {
		return body, templates, activeID, fmt.Errorf("%w: unknown body template", ErrHTTPRequest)
	}
	if activeID == removeID {
		return out[0].Body, out, out[0].ID, nil
	}
	return body, out, activeID, nil
}

func RenameHTTPBodyTemplate(templates []HTTPBodyTemplate, id, name string) ([]HTTPBodyTemplate, error) {
	id = strings.TrimSpace(id)
	name = strings.TrimSpace(name)
	if name == "" {
		return templates, fmt.Errorf("%w: body template name is required", ErrHTTPRequest)
	}
	out := append([]HTTPBodyTemplate{}, templates...)
	for i := range out {
		if out[i].ID == id {
			out[i].Name = name
			return out, nil
		}
	}
	return templates, fmt.Errorf("%w: unknown body template", ErrHTTPRequest)
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
