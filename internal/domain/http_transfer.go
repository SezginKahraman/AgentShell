package domain

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"
)

const HTTPCollectionExportKind = "agentshell.http_collection"

var ErrHTTPCollectionImport = errors.New("invalid http collection import")

// HTTPCollectionDocument is a portable HTTP collection. It has no ids, stack bind, or last_result.
type HTTPCollectionDocument struct {
	Kind        string                    `json:"kind,omitempty"`
	Name        string                    `json:"name,omitempty"`
	Description string                    `json:"description,omitempty"`
	Environment string                    `json:"environment,omitempty"`
	Requests    []HTTPRequestDocument     `json:"requests,omitempty"`
}

type HTTPRequestDocument struct {
	Name          string             `json:"name"`
	Method        string             `json:"method,omitempty"`
	URL           string             `json:"url"`
	Headers       map[string]string  `json:"headers,omitempty"`
	Body          string             `json:"body,omitempty"`
	BodyTemplates []HTTPBodyTemplate `json:"body_templates,omitempty"`
	ActiveBodyID  string             `json:"active_body_id,omitempty"`
	TimeoutMS     int                `json:"timeout_ms,omitempty"`
}

func ExportHTTPCollection(collection HTTPCollection) HTTPCollectionDocument {
	out := HTTPCollectionDocument{
		Kind:        HTTPCollectionExportKind,
		Name:        strings.TrimSpace(collection.Name),
		Description: strings.TrimSpace(collection.Description),
		Environment: strings.TrimSpace(collection.Environment),
		Requests:    make([]HTTPRequestDocument, 0, len(collection.Requests)),
	}
	for _, request := range collection.Requests {
		out.Requests = append(out.Requests, HTTPRequestDocument{
			Name:          request.Name,
			Method:        request.Method,
			URL:           request.URL,
			Headers:       cloneHTTPHeaders(request.Headers),
			Body:          request.Body,
			BodyTemplates: cloneHTTPBodyTemplates(request.BodyTemplates),
			ActiveBodyID:  request.ActiveBodyID,
			TimeoutMS:     request.TimeoutMS,
		})
	}
	return out
}

func ExportHTTPCollectionFileName(name string) string {
	cleaned := strings.TrimSpace(name)
	if cleaned == "" {
		return "collection.json"
	}
	replacer := strings.NewReplacer("/", "-", "\\", "-", ":", "-", "\n", " ", "\r", "")
	cleaned = strings.TrimSpace(replacer.Replace(cleaned))
	if cleaned == "" {
		return "collection.json"
	}
	return cleaned + ".json"
}

func ParseHTTPCollectionDocument(raw []byte) (HTTPCollectionDocument, error) {
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 {
		return HTTPCollectionDocument{}, fmt.Errorf("%w: empty document", ErrHTTPCollectionImport)
	}
	var peek map[string]json.RawMessage
	if err := json.Unmarshal(raw, &peek); err != nil {
		return HTTPCollectionDocument{}, fmt.Errorf("%w: %v", ErrHTTPCollectionImport, err)
	}
	if kind, ok := peek["kind"]; ok && string(kind) != "null" {
		var doc HTTPCollectionDocument
		if err := json.Unmarshal(raw, &doc); err != nil {
			return HTTPCollectionDocument{}, fmt.Errorf("%w: %v", ErrHTTPCollectionImport, err)
		}
		if strings.TrimSpace(doc.Kind) != HTTPCollectionExportKind {
			return HTTPCollectionDocument{}, fmt.Errorf("%w: unsupported kind", ErrHTTPCollectionImport)
		}
		if strings.TrimSpace(doc.Name) == "" {
			return HTTPCollectionDocument{}, fmt.Errorf("%w: name is required", ErrHTTPCollectionImport)
		}
		return doc, nil
	}
	if info, ok := peek["info"]; ok && looksLikePostmanSchema(info, peek["item"]) {
		return parsePostmanCollection(raw)
	}
	return HTTPCollectionDocument{}, fmt.Errorf("%w: expected an AgentShell or Postman collection", ErrHTTPCollectionImport)
}

func cloneHTTPHeaders(in map[string]string) map[string]string {
	if len(in) == 0 {
		return nil
	}
	out := make(map[string]string, len(in))
	for key, value := range in {
		out[key] = value
	}
	return out
}

func cloneHTTPBodyTemplates(in []HTTPBodyTemplate) []HTTPBodyTemplate {
	if len(in) == 0 {
		return nil
	}
	out := make([]HTTPBodyTemplate, len(in))
	copy(out, in)
	return out
}

func looksLikePostmanSchema(info json.RawMessage, items json.RawMessage) bool {
	var meta postmanInfo
	if err := json.Unmarshal(info, &meta); err != nil {
		return false
	}
	schema := strings.ToLower(meta.Schema)
	if strings.Contains(schema, "schema.getpostman.com") && strings.Contains(schema, "collection") {
		return true
	}
	return items != nil && strings.TrimSpace(meta.Name) != ""
}

type postmanCollection struct {
	Info postmanInfo     `json:"info"`
	Auth *postmanAuth    `json:"auth"`
	Item []postmanItem   `json:"item"`
}

type postmanInfo struct {
	Name        string          `json:"name"`
	Description json.RawMessage `json:"description"`
	Schema      string          `json:"schema"`
}

type postmanItem struct {
	Name     string          `json:"name"`
	Disabled bool            `json:"disabled"`
	Request  json.RawMessage `json:"request"`
	Item     []postmanItem   `json:"item"`
}

type postmanRequest struct {
	Method string          `json:"method"`
	Header []postmanHeader `json:"header"`
	Body   *postmanBody    `json:"body"`
	URL    json.RawMessage `json:"url"`
	Auth   *postmanAuth    `json:"auth"`
}

type postmanHeader struct {
	Key      string `json:"key"`
	Value    string `json:"value"`
	Disabled bool   `json:"disabled"`
}

type postmanBody struct {
	Mode       string              `json:"mode"`
	Raw        string              `json:"raw"`
	URLEncoded []postmanFormField  `json:"urlencoded"`
	FormData   []postmanFormField  `json:"formdata"`
}

type postmanFormField struct {
	Key      string `json:"key"`
	Value    string `json:"value"`
	Type     string `json:"type"`
	Disabled bool   `json:"disabled"`
}

type postmanAuth struct {
	Type   string              `json:"type"`
	Bearer []postmanAuthEntry  `json:"bearer"`
	Apikey []postmanAuthEntry  `json:"apikey"`
}

type postmanAuthEntry struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

type postmanURL struct {
	Raw   string   `json:"raw"`
	Query []struct {
		Key      string `json:"key"`
		Value    string `json:"value"`
		Disabled bool   `json:"disabled"`
	} `json:"query"`
}

func parsePostmanCollection(raw []byte) (HTTPCollectionDocument, error) {
	var src postmanCollection
	if err := json.Unmarshal(raw, &src); err != nil {
		return HTTPCollectionDocument{}, fmt.Errorf("%w: %v", ErrHTTPCollectionImport, err)
	}
	name := strings.TrimSpace(src.Info.Name)
	if name == "" {
		return HTTPCollectionDocument{}, fmt.Errorf("%w: Postman collection name is required", ErrHTTPCollectionImport)
	}
	out := HTTPCollectionDocument{
		Name:        name,
		Description: postmanDescription(src.Info.Description),
	}
	walkPostmanItems(&out, src.Item, nil, src.Auth)
	return out, nil
}

func walkPostmanItems(out *HTTPCollectionDocument, items []postmanItem, path []string, collectionAuth *postmanAuth) {
	for _, item := range items {
		if item.Disabled {
			continue
		}
		name := strings.TrimSpace(item.Name)
		next := path
		if name != "" {
			next = append(append([]string{}, path...), name)
		}
		if len(item.Item) > 0 {
			walkPostmanItems(out, item.Item, next, collectionAuth)
			continue
		}
		if len(item.Request) == 0 || string(item.Request) == "null" {
			continue
		}
		req, ok := postmanRequestDocument(item.Request, strings.Join(next, " / "), collectionAuth)
		if ok {
			out.Requests = append(out.Requests, req)
		}
	}
}

func postmanRequestDocument(raw json.RawMessage, name string, collectionAuth *postmanAuth) (HTTPRequestDocument, bool) {
	if len(raw) > 0 && raw[0] == '"' {
		var url string
		if err := json.Unmarshal(raw, &url); err != nil {
			return HTTPRequestDocument{}, false
		}
		url = strings.TrimSpace(url)
		if url == "" {
			return HTTPRequestDocument{}, false
		}
		if name == "" {
			name = "Imported request"
		}
		headers := map[string]string{}
		applyPostmanAuth(headers, collectionAuth)
		return HTTPRequestDocument{Name: name, Method: "GET", URL: url, Headers: emptyToNil(headers)}, true
	}
	var src postmanRequest
	if err := json.Unmarshal(raw, &src); err != nil {
		return HTTPRequestDocument{}, false
	}
	url := postmanURLString(src.URL)
	if url == "" {
		return HTTPRequestDocument{}, false
	}
	method, err := NormalizeHTTPMethod(src.Method)
	if err != nil {
		return HTTPRequestDocument{}, false
	}
	if name == "" {
		name = "Imported request"
	}
	headers := map[string]string{}
	for _, header := range src.Header {
		if header.Disabled || strings.TrimSpace(header.Key) == "" {
			continue
		}
		headers[header.Key] = header.Value
	}
	if src.Auth != nil && strings.TrimSpace(src.Auth.Type) != "" && src.Auth.Type != "noauth" {
		applyPostmanAuth(headers, src.Auth)
	} else {
		applyPostmanAuth(headers, collectionAuth)
	}
	body := postmanBodyString(src.Body)
	return HTTPRequestDocument{
		Name:    name,
		Method:  method,
		URL:     url,
		Headers: emptyToNil(headers),
		Body:    body,
	}, true
}

func postmanURLString(raw json.RawMessage) string {
	if len(raw) == 0 || string(raw) == "null" {
		return ""
	}
	if raw[0] == '"' {
		var value string
		if err := json.Unmarshal(raw, &value); err != nil {
			return ""
		}
		return strings.TrimSpace(value)
	}
	var parsed postmanURL
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return ""
	}
	return strings.TrimSpace(parsed.Raw)
}

func postmanBodyString(body *postmanBody) string {
	if body == nil {
		return ""
	}
	switch body.Mode {
	case "", "raw":
		return body.Raw
	case "urlencoded":
		return encodePostmanFields(body.URLEncoded, false)
	case "formdata":
		return encodePostmanFields(body.FormData, true)
	default:
		return body.Raw
	}
}

func encodePostmanFields(fields []postmanFormField, skipFiles bool) string {
	parts := make([]string, 0, len(fields))
	for _, field := range fields {
		if field.Disabled || strings.TrimSpace(field.Key) == "" {
			continue
		}
		if skipFiles && strings.EqualFold(field.Type, "file") {
			continue
		}
		parts = append(parts, url.QueryEscape(field.Key)+"="+url.QueryEscape(field.Value))
	}
	return strings.Join(parts, "&")
}

func applyPostmanAuth(headers map[string]string, auth *postmanAuth) {
	if auth == nil {
		return
	}
	switch strings.ToLower(strings.TrimSpace(auth.Type)) {
	case "bearer":
		if token := postmanAuthValue(auth.Bearer, "token"); token != "" {
			headers["Authorization"] = "Bearer " + token
		}
	case "apikey":
		if postmanAuthValue(auth.Apikey, "in") == "query" {
			return
		}
		key := postmanAuthValue(auth.Apikey, "key")
		value := postmanAuthValue(auth.Apikey, "value")
		if key != "" && value != "" {
			headers[key] = value
		}
	}
}

func postmanAuthValue(entries []postmanAuthEntry, key string) string {
	for _, entry := range entries {
		if strings.EqualFold(entry.Key, key) {
			return entry.Value
		}
	}
	return ""
}

func postmanDescription(raw json.RawMessage) string {
	if len(raw) == 0 || string(raw) == "null" {
		return ""
	}
	if raw[0] == '"' {
		var value string
		if err := json.Unmarshal(raw, &value); err != nil {
			return ""
		}
		return strings.TrimSpace(value)
	}
	var obj struct {
		Content string `json:"content"`
	}
	if err := json.Unmarshal(raw, &obj); err != nil {
		return ""
	}
	return strings.TrimSpace(obj.Content)
}

func emptyToNil(in map[string]string) map[string]string {
	if len(in) == 0 {
		return nil
	}
	return in
}
