import { isIP } from 'node:net';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const projectRoot = fileURLToPath(new URL('../', import.meta.url));
export function options(args = process.argv.slice(2)) {
  const result = { host: '172.30.74.82', httpsPort: 8443, httpPort: 8080 };
  for (let i = 0; i < args.length; i += 2) {
    const key = { '--host': 'host', '--https-port': 'httpsPort', '--http-port': 'httpPort' }[args[i]];
    if (!key || !args[i + 1]) throw new Error('Usage: --host <LAN IPv4> --https-port <port> --http-port <port>');
    result[key] = key === 'host' ? args[i + 1] : Number(args[i + 1]);
  }
  if (isIP(result.host) !== 4) throw new Error('--host must be an IPv4 address');
  for (const port of [result.httpsPort, result.httpPort]) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port');
  }
  if (result.httpsPort === result.httpPort) throw new Error('HTTP and HTTPS ports must differ');
  return result;
}
export const localDirectory = path.join(projectRoot, '.local/mobile-test');
