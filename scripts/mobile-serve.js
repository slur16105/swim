import http from 'node:http';
import https from 'node:https';
import { readFile, realpath, stat, lstat } from 'node:fs/promises';
import { X509Certificate } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { projectRoot, localDirectory, options } from './mobile-config.js';
import { diagnosticPage } from './mobile-environment.js';

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wasm': 'application/wasm' };
function respond(req, res, status, type, body) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
  res.end(req.method === 'HEAD' ? undefined : body);
}
function requestPath(req) {
  const raw = req.url?.split('?')[0];
  if (!raw?.startsWith('/') || raw.startsWith('//')) return null;
  let decoded;
  try { decoded = decodeURIComponent(raw); } catch { return null; }
  if (/[\\\x00-\x1f\x7f]/.test(decoded) || decoded.includes('#')) return null;
  // Check before URL normalization so encoded dot segments cannot disappear.
  if (decoded.split('/').some(segment => segment.startsWith('.'))) return null;
  return decoded;
}
function allowMethod(req, res) {
  if (req.method === 'GET' || req.method === 'HEAD') return true;
  res.setHeader('Allow', 'GET, HEAD');
  respond(req, res, 405, 'text/plain', 'Method not allowed');
  return false;
}
export async function createAppHandler(distDirectory) {
  if ((await lstat(distDirectory)).isSymbolicLink()) throw new Error('Build output must not be a symbolic link');
  const root = await realpath(distDirectory);
  if (!(await stat(root)).isDirectory()) throw new Error('Build output is not a directory');
  return async (req, res) => {
    if (!allowMethod(req, res)) return;
    const pathname = requestPath(req);
    if (pathname === '/test-environment') return respond(req, res, 200, 'text/html; charset=utf-8', diagnosticPage);
    if (!pathname || /\.(key|pem|csr|srl|cnf)$/i.test(pathname)) return respond(req, res, 404, 'text/plain', 'Not found');
    try {
      const target = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
      if (!target.startsWith(root + path.sep)) throw new Error('Outside build');
      const resolved = await realpath(target);
      if (!resolved.startsWith(root + path.sep) || /\.(key|pem|csr|srl|cnf)$/i.test(resolved) || !(await stat(resolved)).isFile()) throw new Error('Outside build');
      const body = await readFile(resolved);
      respond(req, res, 200, mime[path.extname(resolved).toLowerCase()] || 'application/octet-stream', body);
    } catch {
      respond(req, res, 404, 'text/plain', 'Not found');
    }
  };
}
export function createOnboardingHandler({ host, httpsPort, certificate, fingerprint, validTo }) {
  const appUrl = `https://${host}:${httpsPort}`;
  const page = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LANE CLUB 모바일 테스트 연결</title><style>body{font:16px system-ui;max-width:760px;margin:32px auto;padding:0 20px;line-height:1.7}code{overflow-wrap:anywhere}</style><h1>모바일 테스트 연결</h1><p>휴대폰과 컴퓨터를 같은 신뢰할 수 있는 Wi-Fi에 연결하세요. 이 서버는 로컬 테스트 전용입니다.</p><ol><li>컴퓨터 터미널의 SHA-256 지문과 아래 값을 비교한 뒤 <a href="/ca.cer">테스트 CA 인증서 다운로드</a>를 누르세요.</li><li>iPhone/iPad: 설정 → 일반 → VPN 및 기기 관리에서 다운로드한 프로파일 설치 → 일반 → 정보 → 인증서 신뢰 설정에서 이 테스트 CA의 신뢰를 켜세요. Android: 설정에서 인증서 설치 → CA 인증서로 설치하세요. 제조사에 따라 메뉴 이름이 다릅니다.</li><li><a href="${appUrl}/test-environment">HTTPS 환경 진단</a>에서 secureContext와 webLocks를 확인한 뒤 <a href="${appUrl}/">앱 열기</a>를 누르세요.</li></ol><p>CA SHA-256: <code>${fingerprint}</code><br>유효 기한: ${validTo}<br>HTTPS 주소: <code>${appUrl}/</code></p><p><strong>테스트 전용 신뢰:</strong> 이 CA는 해당 키 보유자가 서명한 인증서를 신뢰하게 만듭니다. 테스트 종료 후 휴대폰 설정에서 설치한 인증서/프로파일과 신뢰를 제거하세요. 인증서는 7일 후 만료되며 mobile:prepare는 같은 IP의 유효한 인증서를 재사용하며, IP 변경·만료 시 CA를 새로 만듭니다. 이전 CA 신뢰를 제거하고 새 지문을 비교하세요. 컴퓨터의 시스템 신뢰는 자동 변경하지 않습니다. 인증서 경고를 무시한 채 진행하지 마세요.</p></html>`;
  return (req, res) => {
    if (!allowMethod(req, res)) return;
    const pathname = requestPath(req);
    if (pathname === '/') return respond(req, res, 200, 'text/html; charset=utf-8', page);
    if (pathname === '/ca.cer') {
      res.setHeader('Content-Disposition', 'attachment; filename="lane-club-mobile-test-ca.cer"');
      return respond(req, res, 200, 'application/pkix-cert', certificate);
    }
    respond(req, res, 404, 'text/plain', 'Not found');
  };
}
export async function serve(config = options(), directory = localDirectory, dist = path.join(projectRoot, 'dist')) {
  const [manifest, key, cert, caPem, certificate] = await Promise.all([
    readFile(path.join(directory, 'environment.json'), 'utf8'),
    readFile(path.join(directory, 'server.key')),
    readFile(path.join(directory, 'server.pem')),
    readFile(path.join(directory, 'ca.pem')),
    readFile(path.join(directory, 'ca.cer')),
  ]);
  if (JSON.parse(manifest).host !== config.host) throw new Error('Host changed: run npm run mobile:prepare -- --host <IP> first');
  const ca = new X509Certificate(caPem), serverCert = new X509Certificate(cert);
  const now = Date.now();
  if ([ca, serverCert].some(value => now < Date.parse(value.validFrom) || now >= Date.parse(value.validTo))) throw new Error('Certificates expired or not yet valid: run mobile:prepare');
  if (!serverCert.checkIP(config.host) || !serverCert.verify(ca.publicKey) || !new X509Certificate(certificate).raw.equals(ca.raw)) throw new Error('Certificate mismatch: run mobile:prepare');
  const secureServer = https.createServer({ key, cert, minVersion: 'TLSv1.2' }, await createAppHandler(dist));
  const onboardingServer = http.createServer(createOnboardingHandler({ ...config, certificate, fingerprint: ca.fingerprint256, validTo: ca.validTo }));
  const listen = (server, port) => new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, config.host, () => { server.removeListener('error', reject); resolve(); });
  });
  try {
    await listen(secureServer, config.httpsPort);
    await listen(onboardingServer, config.httpPort);
  } catch (error) {
    secureServer.close(); onboardingServer.close(); throw error;
  }
  console.log(`Phone onboarding: http://${config.host}:${config.httpPort}/\nApp: https://${config.host}:${config.httpsPort}/\nDiagnostics: https://${config.host}:${config.httpsPort}/test-environment\nCA SHA-256: ${ca.fingerprint256}\nTest-only CA expires ${ca.validTo}. Stop with Ctrl+C; remove phone CA trust after testing.`);
  return { secureServer, onboardingServer };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  serve().then(({ secureServer, onboardingServer }) => {
    const stop = () => { secureServer.close(); onboardingServer.close(); secureServer.closeAllConnections(); onboardingServer.closeAllConnections(); };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
  }).catch(error => { console.error(`Mobile server: ${error.message}`); process.exitCode = 1; });
}
