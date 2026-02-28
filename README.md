# openapi-mock-darksol

![DARKSOL](./assets/darksol-logo.svg)
Built by DARKSOL 🌑

Deterministic mock REST APIs from OpenAPI 3 specs, with strict validation and controllable failure simulation.

![npm](https://img.shields.io/npm/v/openapi-mock-darksol)
![license](https://img.shields.io/badge/license-MIT-green)
![node](https://img.shields.io/badge/node-%3E%3D18-3C873A)

## Why this exists
Contract-first teams need realistic APIs before production backends are ready. This CLI turns an OpenAPI file into a predictable mock server so frontend, QA, and integration work can move in parallel.

## What it does
- Serves routes directly from OpenAPI 3.x specs
- Uses response `example`/`examples` first, then schema generation fallback
- Validates request body/query/params in `--strict` mode
- Supports deterministic seeded output generation
- Simulates failures globally or per-operation (`errorRate`, `errorStatus`)
- Includes CI-friendly spec checks and snapshot build commands

## Quickstart
```bash
# one-shot run without global install
npx openapi-mock-darksol mock:start --spec ./examples/petstore.yaml --port 4010 --strict
```

```bash
# local dev setup
npm ci
npm run mock:check -- --spec ./examples/petstore.yaml
npm run mock:start -- --spec ./examples/petstore.yaml --port 4010
```

## Real example
```bash
# run deterministic mock server
openapi-mock mock:start --spec ./examples/petstore.yaml --seed 42 --examples first --strict

# force an error for one request
curl -H "x-mock-error: 503" http://localhost:4010/pets/1
```

## Config/options
| Option | Type | Default | Description |
|---|---|---:|---|
| `--spec` | string | required | Path or URL to OpenAPI spec |
| `--config` | string | none | YAML config for per-operation behavior |
| `--port` | number | `4010` | Server port |
| `--seed` | number | random | Seed for deterministic generation |
| `--examples` | `first\|random` | `first` | Example selection strategy |
| `--strict` | boolean | `false` | Enable stricter request validation |
| `--cors` | boolean | `false` | Enable CORS middleware |
| `--watch` | boolean | `false` | Reload on spec/config changes |
| `--error-rate` | number | `0` | Global random error injection rate |
| `--error-status` | number | `500` | HTTP status for injected errors |
| `--verbose` | boolean | `false` | Detailed route/debug logs |

## Architecture / flow
- Parse and dereference OpenAPI spec
- Build operation map + validation schemas
- Match request -> select response using status priority (`200`, `201`, first `2xx`, first defined)
- Resolve payload via `example` -> `examples` -> schema generation -> fallback object
- Apply deterministic seed logic and optional failure simulation

## Performance notes
No benchmark claims are published in this repo. Throughput/latency depends on spec complexity, validation mode, and host runtime.

## Limitations + roadmap
### Current limitations
- Focused on OpenAPI 3.x HTTP request/response mocking
- Request body validation currently targets JSON payloads
- No auth-flow emulation (OAuth/JWT lifecycle simulation)
- No stateful scenario engine yet

### Roadmap
- Auth simulation presets
- Stateful mutation scenarios
- Proxy/hybrid upstream fallback mode
- Expanded media-type + multipart support

## Security notes
- Do not run mocks against untrusted specs without review.
- Never commit secrets in config files.

## License + links
- License: MIT
- Changelog: `CHANGELOG.md`
- Architecture notes: `docs/ARCHITECTURE.md`
- GitHub: <https://github.com/darks0l/openapi-mock>
