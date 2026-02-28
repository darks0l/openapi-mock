const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');

function waitForReady(proc, timeoutMs = 7000) {
  return new Promise((resolve, reject) => {
    let out = '';
    const t = setTimeout(() => reject(new Error(`Server timeout. Output:\n${out}`)), timeoutMs);
    proc.stdout.on('data', (d) => {
      out += d.toString();
      if (out.includes('openapi-mock listening')) {
        clearTimeout(t);
        resolve();
      }
    });
    proc.stderr.on('data', (d) => {
      out += d.toString();
    });
    proc.on('exit', (code) => {
      clearTimeout(t);
      reject(new Error(`Server exited early (${code}). Output:\n${out}`));
    });
  });
}

async function withServer(args, fn) {
  const proc = spawn(process.execPath, ['src/index.js', 'mock:start', ...args], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForReady(proc);
  try {
    await fn();
  } finally {
    proc.kill('SIGTERM');
  }
}

test('example-first + schema fallback + strict + forced error', async () => {
  const port = 4123;
  await withServer(['--spec', './examples/petstore.yaml', '--port', String(port), '--strict'], async () => {
    const petsRes = await fetch(`http://localhost:${port}/pets`);
    assert.equal(petsRes.status, 200);
    const pets = await petsRes.json();
    assert.equal(pets[0].name, 'Nova');

    const petRes = await fetch(`http://localhost:${port}/pets/abc`);
    assert.equal(petRes.status, 200);
    const pet = await petRes.json();
    assert.ok(typeof pet.id === 'string');

    const petRes2 = await fetch(`http://localhost:${port}/pets/abc`);
    const pet2 = await petRes2.json();
    assert.equal(pet.id, pet2.id);

    const errRes = await fetch(`http://localhost:${port}/pets`, { headers: { 'x-mock-error': '503' } });
    assert.equal(errRes.status, 503);
  });
});
