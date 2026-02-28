# openapi-mock-darksol

Mock REST APIs directly from OpenAPI 3 specs.

- npm: `openapi-mock-darksol`
- CLI binary: `openapi-mock`
- GitHub: <https://github.com/darks0l/openapi-mock>

## Why this exists

When frontend/backend teams need progress before real APIs are ready, this gives a deterministic mock server from spec-first contracts. It supports strict validation, response examples, schema fallback generation, and controlled failure simulation.

## Install

```bash
npm i -D openapi-mock-darksol
```

or run directly:

```bash
npx openapi-mock-darksol mock:start --spec ./openapi.yaml
```

## Quick start

```bash
openapi-mock mock:start --spec ./examples/petstore.yaml --port 4010 --strict --verbose
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

openapi-mock mock:check --spec <path-or-url>
openapi-mock mock:build --spec <path-or-url> [--out ./.mock-snapshot]
```

## Response strategy

For each operation, the server returns response content in this order:

1. `example`
2. `examples`
3. schema-generated payload
4. fallback object

Success response selection priority:

1. `200`
2. `201`
3. first `2xx`
4. first response entry

## Error simulation

- `x-mock-error: 503` header forces an error for that request
- `--error-rate` injects random failures globally
- `--config` supports per-operation overrides

Example config:

```yaml
operations:
  getPet:
    errorRate: 0.2
    errorStatus: 503
```

## Deterministic generation

Given the same seed + operation + request fingerprint, generated data is stable.

Includes deterministic UUID generation for `format: uuid`.

## MVP limitations

Current MVP is intentionally narrow:

- Focused on OpenAPI 3.x request/response mocking only
- No auth simulation profiles (OAuth/JWT flows are not emulated)
- No proxy/pass-through mode yet
- No advanced stateful scenario engine yet (response scripting is static per request fingerprint)
- Request body validation currently targets `application/json`

## Roadmap

Planned next upgrades:

- auth simulation presets (unauthorized/expired-token scopes)
- stateful scenarios (create/update/delete mutation memory)
- proxy hybrid mode (fallback to real upstream for unmapped routes)
- richer media-type support and multipart validation
- optional OpenAPI examples coverage report

## Project docs

- Architecture: `docs/ARCHITECTURE.md`
- Release flow: `docs/RELEASE.md`
- Changelog: `CHANGELOG.md`

## Local development

```bash
npm ci
npm test
npm run mock:check -- --spec ./examples/petstore.yaml
```
