.PHONY: build test test-go test-web test-e2e run

build:
	cd web && npm ci && npm run build
	mkdir -p bin
	go build -o bin/agentshell ./cmd/agentshell

test: test-go test-web

test-go:
	go test ./...

test-web:
	cd web && npm test && npm run build

test-e2e:
	cd web && npm run test:e2e

run:
	go run ./cmd/agentshell server
