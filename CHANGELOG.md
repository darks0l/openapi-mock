# Changelog

## 0.2.1
- Publish package as unscoped `openapi-mock-darksol` for broad installability

## 0.2.0
- Rename package to `@darksol/openapi-mock` with `openapi-mock` CLI binary
- Add `--watch` hot-reload mode for local spec/config changes
- Add integration test suite (`node --test`)
- Add release hardening fields in package metadata (`repository`, `bugs`, `homepage`)

## 0.1.2
- Add `mock:build` command to generate frozen route payload snapshots + `routes.json` manifest
- Add `mock:check` command for CI-style spec validation (operations + mockable responses)

## 0.1.1
- Add `--config` for per-operation error simulation (`errorRate`, `errorStatus`)
- Make UUID generation deterministic with seeded UUID v4
- Improve deterministic request fingerprinting for error-rate decisions
- Add package publish prep files (`.npmignore`, changelog, package files list)

## 0.1.0
- Initial MVP: `mock:start`, OpenAPI route parsing, example/schema response generation, strict validation, error simulation
