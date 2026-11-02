import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { X509Certificate } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createAppHandler, createOnboardingHandler, serve } from '../scripts/mobile-serve.js';
import { prepare } from '../scripts/mobile-prepare.js';
import { options } from '../scripts/mobile-config.js';

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'lane-mobile-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const dist = path.join(directory, 'dist');
  await mkdir(path.join(dist, 'assets'), { recursive: true });
  await writeFile(path.join(dist, 'index.html'), '<h1>Built app</h1>');
  await writeFile(path.join(dist, 'assets/app.js'), 'console.log("built");');
  await writeFile(path.join(directory, 'server.key'), 'PRIVATE KEY NEVER EXPOSE');
  await writeFile(path.join(dist, 'accidental.key'), 'PRIVATE KEY NEVER EXPOSE');
  await symlink(path.join(directory, 'server.key'), path.join(dist, 'escape.txt'));
  await symlink(path.join(dist, 'accidental.key'), path.join(dist, 'inside-key.txt'));
  await symlink(directory, path.join(dist, 'outside'));
  return { directory, dist };
}
async function listen(t, server) {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return server.address().port;
}
function request(port, pathname, { method = 'GET', ca } = {}) {
  return new Promise((resolve, reject) => {
    const transport = ca ? https : http;
    const req = transport.request({ host: '127.0.0.1', port, path: pathname, method, ...(ca ? { ca } : {}) }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject); req.end();
  });
}
test('built files only: traversal, hidden paths, private key extensions and escaping symlinks are denied', async t => {
  const { dist } = await fixture(t);
  const port = await listen(t, http.createServer(await createAppHandler(dist)));
  assert.match((await request(port, '/')).body.toString(), /Built app/);
  const asset = await request(port, '/assets/app.js?v=1');
  assert.equal(asset.status, 200); assert.match(asset.headers['content-type'], /javascript/);
  for (const target of ['/../server.key', '/%2e%2e/server.key', '/assets/%2e%2e/%2e%2e/server.key', '/%252e%252e/server.key', '/%2f..%2fserver.key', '/.local/mobile-test/ca.key', '/.git/config', '/src/main.js', '/scripts/mobile-serve.js', '/escape.txt', '/inside-key.txt', '/outside/server.key', '/accidental.key', '/ca.pem', '/server.key', '/assets/missing.js', '/unknown-route', '/assets/', '/%00', '/%ZZ', '/%5c..%5cserver.key', '//server.key']) {
    const response = await request(port, target);
    assert.equal(response.status, 404, target);
    assert.doesNotMatch(response.body.toString(), /PRIVATE KEY|Built app/, target);
  }
  assert.equal((await request(port, '/', { method: 'POST' })).status, 405);
  assert.equal((await request(port, '/', { method: 'HEAD' })).body.length, 0);
  const diagnostic = await request(port, '/test-environment');
  assert.equal(diagnostic.status, 200);
  assert.match(diagnostic.body.toString(), /localStorageReadAccessible/);
  assert.doesNotMatch(diagnostic.body.toString(), /setItem|removeItem|requestStorageAccess\(/);
});
test('HTTP only exposes onboarding and public CA, never build files or certificate-directory files', async t => {
  const ca = Buffer.from('PUBLIC DER');
  const port = await listen(t, http.createServer(createOnboardingHandler({ host: '127.0.0.1', httpsPort: 8443, certificate: ca, fingerprint: 'AA:BB', validTo: 'test expiry' })));
  const page = (await request(port, '/')).body.toString();
  assert.match(page, /https:\/\/127.0.0.1:8443\/test-environment/);
  assert.match(page, /AA:BB/);
  assert.deepEqual((await request(port, '/ca.cer')).body, ca);
  for (const target of ['/server.key', '/ca.key', '/ca.pem', '/environment.json', '/index.html', '/test-environment', '/assets/app.js', '/%2e%2e/server.key', '/.local/mobile-test/ca.key']) assert.equal((await request(port, target)).status, 404, target);
});
test('prepare reuses current CA, regenerates on IP change, and serves a verifiable TLS chain', async t => {
  const { directory, dist } = await fixture(t);
  const certDirectory = path.join(directory, 'certs');
  prepare('127.0.0.1', certDirectory);
  const initialKey = await readFile(path.join(certDirectory, 'ca.key'));
  prepare('127.0.0.1', certDirectory);
  assert.deepEqual(await readFile(path.join(certDirectory, 'ca.key')), initialKey);
  for (const file of ['ca.key', 'server.key']) assert.equal((await stat(path.join(certDirectory, file))).mode & 0o777, 0o600);
  const ca = await readFile(path.join(certDirectory, 'ca.pem'));
  const cert = await readFile(path.join(certDirectory, 'server.pem'));
  const serverCert = new X509Certificate(cert), caCert = new X509Certificate(ca);
  assert.equal(serverCert.checkIP('127.0.0.1'), '127.0.0.1');
  assert.equal(serverCert.checkHost('localhost'), 'localhost');
  assert.equal(serverCert.verify(caCert.publicKey), true);
  assert.ok(Date.parse(caCert.validTo) - Date.parse(caCert.validFrom) <= 7 * 86400000);
  assert.deepEqual(new X509Certificate(await readFile(path.join(certDirectory, 'ca.cer'))).raw, caCert.raw);
  const port = await listen(t, https.createServer({ key: await readFile(path.join(certDirectory, 'server.key')), cert }, await createAppHandler(dist)));
  assert.equal((await request(port, '/', { ca })).status, 200);
  prepare('127.0.0.2', certDirectory);
  assert.notDeepEqual(await readFile(path.join(certDirectory, 'ca.key')), initialKey);
  assert.equal(new X509Certificate(await readFile(path.join(certDirectory, 'server.pem'))).checkIP('127.0.0.2'), '127.0.0.2');
  const secondKey = await readFile(path.join(certDirectory, 'ca.key'));
  const expired = spawnSync('openssl', ['x509', '-req', '-in', 'server.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial', '-days', '0', '-sha256', '-extfile', 'server.cnf', '-extensions', 'server', '-out', 'server.pem'], { cwd: certDirectory });
  assert.equal(expired.status, 0, expired.stderr.toString());
  await assert.rejects(serve({ host: '127.0.0.2', httpsPort: 8443, httpPort: 8080 }, certDirectory, dist), /expired/);
  prepare('127.0.0.2', certDirectory);
  assert.notDeepEqual(await readFile(path.join(certDirectory, 'ca.key')), secondKey);
});
test('CLI restricts bind addresses and ports', () => {
  assert.deepEqual(options([]), { host: '172.30.74.82', httpsPort: 8443, httpPort: 8080 });
  assert.equal(options(['--host', '192.168.1.4', '--https-port', '9443']).httpsPort, 9443);
  for (const args of [['--host', '0.0.0.0;anything'], ['--host', 'localhost'], ['--http-port', '0'], ['--https-port', '8080'], ['--unknown', '1']]) assert.throws(() => options(args));
});
