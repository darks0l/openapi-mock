# Architecture

`openapi-mock-darksol` turns an OpenAPI 3 spec into a running mock server.

## Request lifecycle

1. Load + dereference spec (`swagger-parser`)
2. Build route table from `paths`
3. Match incoming request by method + OpenAPI path template
4. Optionally validate request (`--strict`)
5. Optionally inject error (`x-mock-error`, `--error-rate`, per-op config)
6. Select response in priority order:
   - `200`
   - `201`
   - first `2xx`
   - first available response
7. Build payload priority:
   - `example`
   - `examples`
   - schema-generated payload
   - fallback `{ ok: true }`

## Determinism model

Generation is seeded with:
- global `--seed`
- operation id
- request fingerprint (method + URL + stable body JSON)

This gives stable payloads for the same inputs and stable UUID generation.

## Commands

- `mock:start` → run server
- `mock:check` → CI-style spec health check
- `mock:build` → freeze generated payloads into snapshot files

## Watch mode

`--watch` watches local spec/config files and hot-reloads route/runtime state.
