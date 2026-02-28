#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const { Command } = require('commander');
const SwaggerParser = require('@apidevtools/swagger-parser');
const YAML = require('yaml');
const Ajv = require('ajv');

const program = new Command();

program
  .name('openapi-mock')
  .description('Mock API server from OpenAPI spec');

program
  .command('mock:start')
  .requiredOption('--spec <pathOrUrl>', 'Path or URL to OpenAPI 3 spec (yaml/json)')
  .option('--config <path>', 'Path to mock config json/yaml for per-operation behavior')
  .option('--port <port>', 'Port to run mock server on', '4010')
  .option('--seed <seed>', 'Seed for deterministic data', '42')
  .option('--examples <mode>', 'Example selection mode: first|random', 'first')
  .option('--strict', 'Validate request params/body against schema', false)
  .option('--cors', 'Enable permissive CORS', false)
  .option('--verbose', 'Verbose request logs', false)
  .option('--error-rate <rate>', 'Global error injection rate [0..1]', '0')
  .option('--error-status <code>', 'Error status for injected failures', '500')
  .option('--watch', 'Watch local spec/config and reload routes automatically', false)
  .action(async (opts) => {
    await startServer(opts);
  });

program
  .command('mock:build')
  .requiredOption('--spec <pathOrUrl>', 'Path or URL to OpenAPI 3 spec (yaml/json)')
  .option('--out <dir>', 'Output directory for frozen mock snapshot', './.mock-snapshot')
  .option('--seed <seed>', 'Seed for deterministic data', '42')
  .option('--examples <mode>', 'Example selection mode: first|random', 'first')
  .action(async (opts) => {
    await buildSnapshot(opts);
  });

program
  .command('mock:check')
  .requiredOption('--spec <pathOrUrl>', 'Path or URL to OpenAPI 3 spec (yaml/json)')
  .action(async (opts) => {
    await checkSpec(opts);
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});

async function startServer(opts) {
  assertExamplesMode(opts.examples);

  const app = express();
  app.use(express.json({ limit: '2mb' }));
  if (opts.cors) app.use(cors());

  let runtime = await loadRuntime(opts);

  app.use(async (req, res, next) => {
    let route = null;
    let pathParams = {};
    for (const r of runtime.routes) {
      if (r.method !== req.method.toLowerCase()) continue;
      const m = extractOpenApiParams(r.openapiPath, req.path);
      if (m) {
        route = r;
        pathParams = m;
        break;
      }
    }

    if (!route) return next();
    req.params = { ...(req.params || {}), ...pathParams };

    try {
      const opCfg = runtime.cfg.operations?.[route.operationId] || {};
      const forcedStatus = req.header('x-mock-error');
      const errorRate = num(opCfg.errorRate, Number(opts.errorRate || 0));
      const errorStatus = num(opCfg.errorStatus, Number(opts.errorStatus || 500));

      const fp = requestFingerprint(req);
      const shouldError = forcedStatus || randomFloat(`${opts.seed}|error|${route.operationId}|${fp}`) < errorRate;

      if (shouldError) {
        const status = Number(forcedStatus || errorStatus || 500);
        return res.status(status).json({
          error: { code: 'MOCK_ERROR', message: 'Simulated error', status },
        });
      }

      if (opts.strict) {
        const validation = validateRequest(route, req);
        if (!validation.ok) {
          return res.status(400).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Request validation failed',
              status: 400,
              details: validation.errors,
            },
          });
        }
      }

      const responseDef = pickResponse(route.responses);
      if (!responseDef) {
        return res.status(500).json({
          error: {
            code: 'NO_RESPONSE_DEFINED',
            message: 'No mockable response found in spec',
            status: 500,
          },
        });
      }

      const { statusCode, mediaType, payload, source } = makeResponsePayload(responseDef, {
        seed: opts.seed,
        route,
        req,
        examplesMode: opts.examples,
      });

      if (mediaType) res.type(mediaType);
      if (opts.verbose) {
        console.log(`${req.method} ${req.originalUrl} -> ${statusCode} [${route.operationId}] (${source})`);
      }
      return res.status(statusCode).send(payload);
    } catch (err) {
      return res.status(500).json({
        error: {
          code: 'MOCK_RUNTIME_ERROR',
          message: err.message,
          status: 500,
        },
      });
    }
  });

  app.use((req, res) => {
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: `No mock route for ${req.method} ${req.path}`,
        status: 404,
      },
    });
  });

  app.listen(Number(opts.port), () => {
    console.log(`openapi-mock listening on http://localhost:${opts.port}`);
    console.log(`Loaded ${runtime.routes.length} route(s) from spec: ${opts.spec}`);
    if (opts.config) console.log(`Loaded config: ${opts.config}`);
  });

  if (opts.watch) {
    console.log('Watch mode enabled. Listening for spec/config changes...');
    const watched = [opts.spec, opts.config].filter(Boolean).filter((p) => !/^https?:\/\//i.test(p));
    for (const rel of watched) {
      const abs = path.resolve(process.cwd(), rel);
      fs.watchFile(abs, { interval: 500 }, async (curr, prev) => {
        if (curr.mtimeMs === prev.mtimeMs) return;
        try {
          runtime = await loadRuntime(opts);
          console.log(`Reloaded runtime from ${rel} (${runtime.routes.length} routes)`);
        } catch (err) {
          console.error(`Reload failed for ${rel}: ${err.message}`);
        }
      });
    }
  }
}

async function buildSnapshot(opts) {
  assertExamplesMode(opts.examples);
  const spec = await loadSpec(opts.spec);
  const routes = buildRoutes(spec);
  const outDir = path.resolve(process.cwd(), opts.out);
  fs.mkdirSync(outDir, { recursive: true });

  const manifest = [];

  for (const route of routes) {
    const responseDef = pickResponse(route.responses);
    if (!responseDef) continue;

    const mockReq = {
      method: route.method.toUpperCase(),
      originalUrl: fillPathWithSample(route.openapiPath),
      body: {},
    };

    const { statusCode, mediaType, payload, source } = makeResponsePayload(responseDef, {
      seed: opts.seed,
      route,
      req: mockReq,
      examplesMode: opts.examples,
    });

    const fileName = `${route.method}_${sanitize(route.operationId)}.json`;
    const filePath = path.join(outDir, fileName);
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));

    manifest.push({
      operationId: route.operationId,
      method: route.method.toUpperCase(),
      path: route.openapiPath,
      statusCode,
      mediaType,
      source,
      payloadFile: fileName,
    });
  }

  const manifestPath = path.join(outDir, 'routes.json');
  fs.writeFileSync(manifestPath, JSON.stringify({ spec: opts.spec, generatedAt: new Date().toISOString(), routes: manifest }, null, 2));
  console.log(`Built snapshot at ${outDir}`);
  console.log(`Generated ${manifest.length} mocked route payload(s)`);
}

async function checkSpec(opts) {
  const spec = await loadSpec(opts.spec);
  const routes = buildRoutes(spec);

  if (!routes.length) {
    throw new Error('Spec loaded but no HTTP operations found under paths.');
  }

  const withResponses = routes.filter((r) => pickResponse(r.responses));
  if (!withResponses.length) {
    throw new Error('Spec has routes but no mockable responses (2xx/any response).');
  }

  console.log('mock:check passed');
  console.log(`Routes: ${routes.length}`);
  console.log(`Mockable routes: ${withResponses.length}`);
}

async function loadRuntime(opts) {
  const spec = await loadSpec(opts.spec);
  const cfg = loadConfig(opts.config);
  const routes = buildRoutes(spec);
  return { spec, cfg, routes };
}

function assertExamplesMode(mode) {
  const allowed = new Set(['first', 'random']);
  if (!allowed.has(mode)) {
    throw new Error(`Invalid --examples value "${mode}". Allowed: first, random`);
  }
}

function extractOpenApiParams(openapiPath, requestPath) {
  const openapiParts = String(openapiPath).split('/').filter(Boolean);
  const requestParts = String(requestPath).split('/').filter(Boolean);
  if (openapiParts.length !== requestParts.length) return null;

  const params = {};
  for (let i = 0; i < openapiParts.length; i++) {
    const p = openapiParts[i];
    if (p.startsWith('{') && p.endsWith('}')) {
      const key = p.slice(1, -1);
      params[key] = requestParts[i];
      continue;
    }
    if (p !== requestParts[i]) return null;
  }
  return params;
}

async function loadSpec(pathOrUrl) {
  if (/^https?:\/\//i.test(pathOrUrl)) {
    return SwaggerParser.dereference(pathOrUrl);
  }

  const abs = path.resolve(process.cwd(), pathOrUrl);
  const raw = fs.readFileSync(abs, 'utf8');
  if (abs.endsWith('.yaml') || abs.endsWith('.yml')) {
    return SwaggerParser.dereference(YAML.parse(raw));
  }
  return SwaggerParser.dereference(JSON.parse(raw));
}

function loadConfig(configPath) {
  if (!configPath) return {};
  const abs = path.resolve(process.cwd(), configPath);
  const raw = fs.readFileSync(abs, 'utf8');
  if (abs.endsWith('.yaml') || abs.endsWith('.yml')) return YAML.parse(raw) || {};
  return JSON.parse(raw);
}

function buildRoutes(spec) {
  const paths = spec.paths || {};
  const routes = [];

  for (const [openapiPath, pathItem] of Object.entries(paths)) {
    for (const method of ['get', 'post', 'put', 'patch', 'delete', 'options', 'head']) {
      if (!pathItem[method]) continue;
      const op = pathItem[method];
      routes.push({
        method,
        openapiPath,
        expressPath: openapiPath.replace(/\{([^}]+)\}/g, ':$1'),
        operationId: op.operationId || `${method.toUpperCase()}_${openapiPath}`,
        parameters: [...(pathItem.parameters || []), ...(op.parameters || [])],
        requestBody: op.requestBody,
        responses: op.responses || {},
      });
    }
  }

  return routes;
}

function pickResponse(responses) {
  const entries = Object.entries(responses || {});
  if (!entries.length) return null;

  const twoX = entries
    .filter(([code]) => /^2\d\d$/.test(code))
    .sort((a, b) => Number(a[0]) - Number(b[0]));

  const preferred = twoX.find(([code]) => code === '200') ||
    twoX.find(([code]) => code === '201') ||
    twoX[0] || entries[0];

  return {
    statusCode: Number(preferred[0]) || 200,
    response: preferred[1],
  };
}

function makeResponsePayload(responseDef, ctx) {
  const content = responseDef.response?.content || {};
  const mediaType = content['application/json']
    ? 'application/json'
    : Object.keys(content)[0];

  const media = mediaType ? content[mediaType] : null;

  if (!media) {
    return {
      statusCode: responseDef.statusCode,
      mediaType: 'application/json',
      payload: { ok: true },
      source: 'fallback',
    };
  }

  const examplePayload = pickExample(media, ctx);
  if (examplePayload !== undefined) {
    return {
      statusCode: responseDef.statusCode,
      mediaType,
      payload: examplePayload,
      source: 'example',
    };
  }

  const schema = media.schema;
  if (schema) {
    return {
      statusCode: responseDef.statusCode,
      mediaType,
      payload: generateFromSchema(schema, mkPrng(`${ctx.seed}|${ctx.route.operationId}|${ctx.req.method}|${ctx.req.originalUrl}`)),
      source: 'schema',
    };
  }

  return {
    statusCode: responseDef.statusCode,
    mediaType,
    payload: { ok: true },
    source: 'fallback',
  };
}

function pickExample(media, ctx) {
  if (media.example !== undefined) return media.example;

  const examples = media.examples ? Object.values(media.examples) : [];
  if (!examples.length) return undefined;

  if (ctx.examplesMode === 'random') {
    const r = mkPrng(`${ctx.seed}|example|${ctx.route.operationId}|${ctx.req.originalUrl}`)();
    const idx = Math.floor(r * examples.length);
    return examples[idx]?.value;
  }

  return examples[0]?.value;
}

function validateRequest(route, req) {
  const ajv = new Ajv({ allErrors: true, coerceTypes: true, strict: false });
  const errors = [];

  const paramBuckets = {
    query: {},
    path: {},
    header: {},
  };

  for (const p of route.parameters || []) {
    if (!p || !p.in || !p.name) continue;
    const bucket = paramBuckets[p.in];
    if (!bucket) continue;
    if (p.required) {
      if (!bucket.__required) bucket.__required = [];
      bucket.__required.push(p.name);
    }
    if (!bucket.properties) bucket.properties = {};
    bucket.properties[p.name] = p.schema || { type: 'string' };
  }

  for (const [kind, schemaBuilder] of Object.entries(paramBuckets)) {
    if (!schemaBuilder.properties) continue;
    const schema = {
      type: 'object',
      properties: schemaBuilder.properties,
      required: schemaBuilder.__required || [],
      additionalProperties: true,
    };
    const validate = ajv.compile(schema);
    const target = kind === 'query' ? req.query : kind === 'path' ? req.params : req.headers;
    const ok = validate(target);
    if (!ok) {
      for (const err of validate.errors || []) {
        errors.push({ where: kind, path: err.instancePath, message: err.message });
      }
    }
  }

  const bodySchema = route.requestBody?.content?.['application/json']?.schema;
  if (bodySchema) {
    const validateBody = ajv.compile(bodySchema);
    const okBody = validateBody(req.body);
    if (!okBody) {
      for (const err of validateBody.errors || []) {
        errors.push({ where: 'body', path: err.instancePath, message: err.message });
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

function generateFromSchema(schema, rand) {
  if (!schema || typeof schema !== 'object') return null;

  if (schema.oneOf?.length) return generateFromSchema(schema.oneOf[0], rand);
  if (schema.anyOf?.length) return generateFromSchema(schema.anyOf[0], rand);
  if (schema.allOf?.length) {
    return schema.allOf.reduce((acc, sub) => {
      const v = generateFromSchema(sub, rand);
      if (v && typeof v === 'object' && !Array.isArray(v)) return { ...acc, ...v };
      return acc;
    }, {});
  }

  if (schema.enum?.length) {
    const idx = Math.floor(rand() * schema.enum.length);
    return schema.enum[idx];
  }

  switch (schema.type) {
    case 'string': {
      if (schema.format === 'email') return `user${Math.floor(rand() * 1000)}@example.com`;
      if (schema.format === 'uuid') return seededUuidV4(rand);
      if (schema.format === 'date-time') return new Date(Date.now() - Math.floor(rand() * 1e9)).toISOString();
      if (schema.format === 'date') return new Date(Date.now() - Math.floor(rand() * 1e9)).toISOString().slice(0, 10);
      return `mock_${Math.floor(rand() * 100000)}`;
    }
    case 'integer': {
      const min = schema.minimum ?? 0;
      const max = schema.maximum ?? Math.max(min + 100, 100);
      return Math.floor(min + rand() * (max - min + 1));
    }
    case 'number': {
      const min = schema.minimum ?? 0;
      const max = schema.maximum ?? Math.max(min + 100, 100);
      return Number((min + rand() * (max - min)).toFixed(2));
    }
    case 'boolean':
      return rand() > 0.5;
    case 'array': {
      const min = schema.minItems ?? 2;
      const max = schema.maxItems ?? Math.max(min, 2);
      const len = Math.max(min, Math.min(max, 2));
      return Array.from({ length: len }, () => generateFromSchema(schema.items || { type: 'string' }, rand));
    }
    case 'object':
    default: {
      const properties = schema.properties || {};
      const required = new Set(schema.required || []);
      const out = {};
      for (const [key, child] of Object.entries(properties)) {
        const include = required.has(key) || rand() < 0.7;
        if (!include) continue;
        out[key] = generateFromSchema(child, rand);
      }
      return out;
    }
  }
}

function seededUuidV4(rand) {
  const bytes = Buffer.alloc(16);
  for (let i = 0; i < 16; i++) bytes[i] = Math.floor(rand() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function requestFingerprint(req) {
  const body = req.body ? stableStringify(req.body) : '';
  const base = `${req.method}|${req.originalUrl}|${body}`;
  return crypto.createHash('sha1').update(base).digest('hex');
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

function fillPathWithSample(openapiPath) {
  return openapiPath.replace(/\{([^}]+)\}/g, (_, name) => `sample-${name}`);
}

function sanitize(input) {
  return String(input).replace(/[^a-zA-Z0-9._-]/g, '_');
}

function mkPrng(seed) {
  let state = xmur3(seed)();
  return function random() {
    state += 0x6D2B79F5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

function randomFloat(seed) {
  return mkPrng(seed)();
}

function num(primary, fallback) {
  const n = Number(primary);
  return Number.isFinite(n) ? n : fallback;
}
