package domain

import (
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"unicode"
)

type ParsedCurl struct {
	Name      string
	Method    string
	URL       string
	Headers   map[string]string
	Body      string
	TimeoutMS int
}

func ParseCurl(raw string) (ParsedCurl, error) {
	tokens, err := splitCurl(raw)
	if err != nil {
		return ParsedCurl{}, err
	}
	if len(tokens) == 0 || !isCurlBinary(tokens[0]) {
		return ParsedCurl{}, fmt.Errorf("%w: command must start with curl", ErrHTTPRequest)
	}
	headers := map[string]string{}
	var data []string
	var explicitMethod string
	head := false
	jsonBody := false
	timeoutMS := 0
	target := ""
	for i := 1; i < len(tokens); i++ {
		token := tokens[i]
		next := func() (string, error) {
			if i+1 >= len(tokens) {
				return "", fmt.Errorf("%w: flag %s requires a value", ErrHTTPRequest, token)
			}
			i++
			return tokens[i], nil
		}
		switch token {
		case "-X", "--request":
			value, valueErr := next()
			if valueErr != nil {
				return ParsedCurl{}, valueErr
			}
			explicitMethod = value
		case "-H", "--header":
			value, valueErr := next()
			if valueErr != nil {
				return ParsedCurl{}, valueErr
			}
			key, headerValue, ok := strings.Cut(value, ":")
			if !ok || strings.TrimSpace(key) == "" {
				return ParsedCurl{}, fmt.Errorf("%w: invalid header %q", ErrHTTPRequest, value)
			}
			headers[strings.TrimSpace(key)] = strings.TrimSpace(headerValue)
		case "-d", "--data", "--data-raw", "--data-binary", "--data-urlencode":
			value, valueErr := next()
			if valueErr != nil {
				return ParsedCurl{}, valueErr
			}
			data = append(data, value)
		case "--json":
			value, valueErr := next()
			if valueErr != nil {
				return ParsedCurl{}, valueErr
			}
			jsonBody = true
			data = append(data, value)
			if _, ok := headers["Content-Type"]; !ok {
				headers["Content-Type"] = "application/json"
			}
			if _, ok := headers["Accept"]; !ok {
				headers["Accept"] = "application/json"
			}
		case "--url":
			value, valueErr := next()
			if valueErr != nil {
				return ParsedCurl{}, valueErr
			}
			target = value
		case "-A", "--user-agent":
			value, valueErr := next()
			if valueErr != nil {
				return ParsedCurl{}, valueErr
			}
			headers["User-Agent"] = value
		case "-m", "--max-time":
			value, valueErr := next()
			if valueErr != nil {
				return ParsedCurl{}, valueErr
			}
			seconds, parseErr := strconv.ParseFloat(value, 64)
			if parseErr != nil || seconds < 0 {
				return ParsedCurl{}, fmt.Errorf("%w: invalid max-time", ErrHTTPRequest)
			}
			timeoutMS = int(seconds * 1000)
		case "-I", "--head":
			head = true
		case "-u", "--user":
			if _, skipErr := next(); skipErr != nil {
				return ParsedCurl{}, skipErr
			}
			return ParsedCurl{}, fmt.Errorf("%w: curl -u credentials cannot be imported; use a header placeholder instead", ErrHTTPRequest)
		default:
			if strings.HasPrefix(token, "-") {
				if flagTakesValue(token) {
					if _, skipErr := next(); skipErr != nil {
						return ParsedCurl{}, skipErr
					}
				}
				continue
			}
			if target == "" {
				target = token
			}
		}
	}
	if strings.TrimSpace(target) == "" {
		return ParsedCurl{}, fmt.Errorf("%w: curl is missing a url", ErrHTTPRequest)
	}
	method := "GET"
	if head {
		method = "HEAD"
	}
	body := strings.Join(data, "&")
	if jsonBody && len(data) == 1 {
		body = data[0]
	}
	if explicitMethod != "" {
		method = explicitMethod
	} else if (len(data) > 0 || jsonBody) && method == "GET" {
		method = "POST"
	}
	normalized, err := NormalizeHTTPMethod(method)
	if err != nil {
		return ParsedCurl{}, err
	}
	return ParsedCurl{
		Name:      curlRequestName(target),
		Method:    normalized,
		URL:       strings.TrimSpace(target),
		Headers:   headers,
		Body:      body,
		TimeoutMS: timeoutMS,
	}, nil
}

func RewriteURLWithVars(raw string, vars map[string]string) string {
	bestKey, bestVal := "", ""
	for key, value := range vars {
		if value == "" || !strings.HasPrefix(raw, value) {
			continue
		}
		rest := raw[len(value):]
		if rest != "" && rest[0] != '/' && rest[0] != '?' && rest[0] != '#' {
			continue
		}
		if len(value) > len(bestVal) {
			bestKey, bestVal = key, value
		}
	}
	if bestKey == "" {
		return raw
	}
	return "{{" + bestKey + "}}" + raw[len(bestVal):]
}

func curlRequestName(raw string) string {
	parsed, err := url.Parse(raw)
	if err != nil {
		return "Imported request"
	}
	parts := strings.Split(strings.Trim(parsed.Path, "/"), "/")
	for i := len(parts) - 1; i >= 0; i-- {
		if parts[i] != "" {
			return parts[i]
		}
	}
	if parsed.Host != "" {
		return parsed.Host
	}
	return "Imported request"
}

func isCurlBinary(token string) bool {
	name := strings.ToLower(strings.Trim(token, `"'`))
	name = strings.TrimSuffix(name, ".exe")
	return name == "curl" || strings.HasSuffix(name, "/curl")
}

func flagTakesValue(flag string) bool {
	switch flag {
	case "-o", "--output", "-w", "--write-out", "-D", "--dump-header", "--retry", "--connect-timeout",
		"--resolve", "--proxy", "-x", "--cacert", "--cert", "--key", "-E", "-b", "--cookie", "-c", "--cookie-jar",
		"--unix-socket", "--interface", "--keepalive-time", "--limit-rate", "--max-redirs", "--retry-delay":
		return true
	default:
		return strings.HasPrefix(flag, "--") && !strings.Contains(flag, "=") && !isBooleanCurlFlag(flag)
	}
}

func isBooleanCurlFlag(flag string) bool {
	switch flag {
	case "-s", "--silent", "-S", "--show-error", "-v", "--verbose", "-k", "--insecure", "-L", "--location",
		"-g", "--globoff", "--compressed", "-f", "--fail", "-i", "--include", "-I", "--head", "-N", "--no-buffer":
		return true
	default:
		return false
	}
}

func splitCurl(raw string) ([]string, error) {
	raw = strings.ReplaceAll(raw, "\\\r\n", " ")
	raw = strings.ReplaceAll(raw, "\\\n", " ")
	var tokens []string
	var b strings.Builder
	var quote rune
	escape := false
	flush := func() {
		if b.Len() == 0 {
			return
		}
		tokens = append(tokens, b.String())
		b.Reset()
	}
	for _, r := range raw {
		if escape {
			b.WriteRune(r)
			escape = false
			continue
		}
		if quote != 0 {
			if r == '\\' && quote == '"' {
				escape = true
				continue
			}
			if r == quote {
				quote = 0
				continue
			}
			b.WriteRune(r)
			continue
		}
		if r == '\\' {
			escape = true
			continue
		}
		if r == '\'' || r == '"' {
			quote = r
			continue
		}
		if unicode.IsSpace(r) {
			flush()
			continue
		}
		b.WriteRune(r)
	}
	if quote != 0 {
		return nil, fmt.Errorf("%w: unterminated quote", ErrHTTPRequest)
	}
	flush()
	return tokens, nil
}
