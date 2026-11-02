import { mkdirSync, writeFileSync, readFileSync, chmodSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { X509Certificate, createPrivateKey } from 'node:crypto';
import { isIP } from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { localDirectory, options } from './mobile-config.js';

export function prepare(host, directory = localDirectory) {
  if (isIP(host) !== 4) throw new Error('Host must be an IPv4 address');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  try {
    const read = name => readFileSync(path.join(directory, name));
    const ca = new X509Certificate(read('ca.pem')), server = new X509Certificate(read('server.pem'));
    const valid = certificate => Date.now() >= Date.parse(certificate.validFrom) && Date.now() < Date.parse(certificate.validTo);
    if (JSON.parse(read('environment.json')).host === host && valid(ca) && valid(server) && server.checkIP(host)
      && server.verify(ca.publicKey) && ca.checkPrivateKey(createPrivateKey(read('ca.key')))
      && server.checkPrivateKey(createPrivateKey(read('server.key'))) && new X509Certificate(read('ca.cer')).raw.equals(ca.raw)) {
      for (const name of ['ca.key', 'server.key']) chmodSync(path.join(directory, name), 0o600);
      console.log(`Reusing valid test certificates until ${server.validTo}.\nCA SHA-256: ${ca.fingerprint256}`);
      return;
    }
  } catch { /* Missing or invalid local material needs a fresh test CA. */ }
  const run = (...args) => {
    const result = spawnSync('openssl', args, { cwd: directory, encoding: 'utf8' });
    if (result.error || result.status !== 0) throw new Error(`OpenSSL failed: ${result.error?.message || result.stderr}`);
  };
  const write = (name, value) => writeFileSync(path.join(directory, name), value, { mode: 0o600 });
  write('ca.cnf', `[req]\nprompt=no\ndistinguished_name=dn\nx509_extensions=ca\n[dn]\nCN=LANE CLUB Local Mobile Test CA\n[ca]\nbasicConstraints=critical,CA:TRUE,pathlen:0\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\n`);
  write('server.cnf', `[req]\nprompt=no\ndistinguished_name=dn\n[dn]\nCN=${host}\n[server]\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=IP:${host},IP:127.0.0.1,DNS:localhost\n`);
  run('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '7', '-config', 'ca.cnf', '-keyout', 'ca.key', '-out', 'ca.pem');
  run('req', '-new', '-newkey', 'rsa:2048', '-nodes', '-config', 'server.cnf', '-keyout', 'server.key', '-out', 'server.csr');
  run('x509', '-req', '-in', 'server.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial', '-days', '7', '-sha256', '-extfile', 'server.cnf', '-extensions', 'server', '-out', 'server.pem');
  run('x509', '-in', 'ca.pem', '-outform', 'DER', '-out', 'ca.cer');
  for (const name of ['ca.key', 'server.key']) chmodSync(path.join(directory, name), 0o600);
  write('environment.json', JSON.stringify({ host }, null, 2));
  const ca = new X509Certificate(readFileSync(path.join(directory, 'ca.pem')));
  console.log(`Prepared test-only certificates (7 days). Remove any previous mobile test CA trust; compare this new fingerprint before trusting.\nCA SHA-256: ${ca.fingerprint256}\nPrivate keys: ${directory} (never served)`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { prepare(options().host); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
