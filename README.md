# openapi-mock-darksol

Generate a local mock API server from an OpenAPI 3 spec.

## Install

```bash
npm i -D openapi-mock-darksol
```

Or run directly:

```bash
npx openapi-mock-darksol mock:start --spec ./openapi.yaml
```

## Quickstart

```bash
npm install
npm run mock:start -- --spec ./examples/petstore.yaml --port 4010 --strict --cors --verbose
```

## CLI

```bash
openapi-mock mock:start \
  --spec <path-or-url> \
  [--config ./mock.config.yaml] \
  [--port 4010] \
  [--seed 42] \
  [--examples first|random] \
  [--strict] \
  [--cors] \
  [--verbose] \
  [--watch] \
  [--error-rate 0.0] \
  [--error-status 500]

openapi-mock mock:build \
  --spec <path-or-url> \
  [--out ./.mock-snapshot] \
  [--seed 42] \
  [--examples first|random]

openapi-mock mock:check \
  --spec <path-or-url>
```

## Error simulation

- Header `x-mock-error: <status>` forces an error status for that request.
- `--error-rate` injects probabilistic errors globally.
- `--config` enables per-operation overrides.

Example `mock.config.yaml`:

```yaml
operations:
  getPet:
    errorRate: 0.2
    errorStatus: 503
```

Error payload:

```json
{
  "error": {
    "code": "MOCK_ERROR",
    "message": "Simulated error",
    "status": 500
  }
}
```

## Notes

- Prefers response examples first (`example`/`examples`).
- Falls back to schema-derived payload generation.
- `--strict` validates query/path/header and JSON body.
- Chooses success responses in this order: `200`, `201`, first `2xx`.
- UUID schema format uses deterministic seeded UUID generation.
- `--watch` reloads local spec/config updates without restarting.
