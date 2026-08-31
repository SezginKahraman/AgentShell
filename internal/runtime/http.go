package runtime

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/agentshell/agentshell/internal/domain"
	"github.com/agentshell/agentshell/internal/store"
)

func (m *Manager) SendHTTPRequest(ctx context.Context, request domain.HTTPRequest) (domain.HTTPRequest, error) {
	collection, err := m.store.HTTPCollection(ctx, request.CollectionID)
	if err != nil {
		return request, err
	}
	lib, err := m.store.EnvironmentLibrary(ctx)
	if err != nil {
		return request, err
	}
	var stack *domain.Stack
	if collection.StackID != "" {
		loaded, stackErr := m.store.Stack(ctx, collection.StackID)
		if stackErr != nil {
			if errors.Is(stackErr, store.ErrNotFound) {
				return request, fmt.Errorf("%w: unknown stack_id %q", domain.ErrHTTPRequest, collection.StackID)
			}
			return request, stackErr
		}
		stack = &loaded
	}
	envName, vars := domain.ResolveHTTPRequestVars(lib, collection.Environment, stack)
	if collection.Environment != "" || stack != nil {
		if _, err = domain.NormalizeStackEnvironment(envName, lib.Names); err != nil {
			return request, err
		}
	}
	method, err := domain.NormalizeHTTPMethod(request.Method)
	if err != nil {
		return request, err
	}
	resolvedURL, err := domain.Interpolate(request.URL, vars)
	if err != nil {
		return request, err
	}
	target, err := validateHTTPClientURL(resolvedURL)
	if err != nil {
		return request, err
	}
	body, err := domain.Interpolate(request.Body, vars)
	if err != nil {
		return request, err
	}
	headers := map[string]string{}
	for key, value := range request.Headers {
		interpolated, headerErr := domain.Interpolate(value, vars)
		if headerErr != nil {
			return request, headerErr
		}
		headers[key] = interpolated
	}
	timeout := time.Duration(domain.NormalizeHTTPRequestTimeout(request.TimeoutMS)) * time.Millisecond
	result := domain.HTTPResult{URL: target.String(), Method: method, Environment: envName, SentAt: time.Now().UTC()}
	sendCtx, cancel := context.WithTimeout(m.ctx, timeout)
	defer cancel()
	if ctx.Err() != nil {
		sendCtx, cancel = context.WithTimeout(ctx, timeout)
		defer cancel()
	}
	httpRequest, err := http.NewRequestWithContext(sendCtx, method, target.String(), strings.NewReader(body))
	if err != nil {
		result.Error = err.Error()
		return m.persistHTTPResult(ctx, request, result, vars, lib.SecretKeys)
	}
	for key, value := range headers {
		httpRequest.Header.Set(key, value)
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	client := &http.Client{
		Timeout:   timeout,
		Transport: transport,
		CheckRedirect: func(next *http.Request, via []*http.Request) error {
			if _, redirectErr := validateHTTPClientURL(next.URL.String()); redirectErr != nil {
				return redirectErr
			}
			if len(via) >= 5 {
				return errors.New("too many redirects")
			}
			return nil
		},
	}
	start := time.Now()
	response, err := client.Do(httpRequest)
	result.DurationMS = int(time.Since(start).Round(time.Millisecond) / time.Millisecond)
	if result.DurationMS == 0 && time.Since(start) > 0 {
		result.DurationMS = 1
	}
	if err != nil {
		result.Error = err.Error()
		return m.persistHTTPResult(ctx, request, result, vars, lib.SecretKeys)
	}
	defer response.Body.Close()
	result.Status = response.StatusCode
	result.Headers = map[string]string{}
	for key, values := range response.Header {
		if len(values) > 0 {
			result.Headers[key] = values[0]
		}
	}
	raw, readErr := io.ReadAll(io.LimitReader(response.Body, domain.MaxHTTPRequestBody+1))
	if readErr != nil {
		result.Error = readErr.Error()
		return m.persistHTTPResult(ctx, request, result, vars, lib.SecretKeys)
	}
	if len(raw) > domain.MaxHTTPRequestBody {
		raw = raw[:domain.MaxHTTPRequestBody]
		result.Truncated = true
	}
	result.Body = string(raw)
	return m.persistHTTPResult(ctx, request, result, vars, lib.SecretKeys)
}

func (m *Manager) persistHTTPResult(ctx context.Context, request domain.HTTPRequest, result domain.HTTPResult, vars map[string]string, secretKeys []string) (domain.HTTPRequest, error) {
	domain.RedactHTTPResult(&result, vars, secretKeys)
	now := time.Now().UTC()
	request.LastResult = &result
	request.UpdatedAt = now
	if err := m.store.SaveHTTPRequest(ctx, &request); err != nil {
		return request, err
	}
	return request, nil
}

func validateHTTPClientURL(raw string) (*url.URL, error) {
	target, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || target.Scheme == "" || target.Host == "" {
		return nil, fmt.Errorf("%w: url must be an absolute HTTP(S) URL", domain.ErrHTTPRequest)
	}
	if target.Scheme != "http" && target.Scheme != "https" {
		return nil, fmt.Errorf("%w: url must use http or https", domain.ErrHTTPRequest)
	}
	if target.User != nil {
		return nil, fmt.Errorf("%w: url must not contain credentials", domain.ErrHTTPRequest)
	}
	if strings.TrimSuffix(strings.ToLower(target.Hostname()), ".") == "" {
		return nil, fmt.Errorf("%w: url must contain a hostname", domain.ErrHTTPRequest)
	}
	return target, nil
}
