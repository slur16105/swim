export const diagnosticPage = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>모바일 테스트 환경</title><style>body{font:16px system-ui;max-width:760px;margin:32px auto;padding:0 20px;line-height:1.6}textarea{box-sizing:border-box;width:100%;height:360px}button{padding:12px;margin:12px 0}</style><h1>모바일 테스트 환경</h1><p>환경 API 지원 여부만 확인합니다. 제품 데이터·저장 키를 읽거나 저장소에 쓰지 않습니다. 지원 여부는 실제 앱 동작의 통과 판정이 아닙니다.</p><textarea id="output" readonly aria-label="환경 JSON"></textarea><button id="copy" type="button">환경 JSON 복사</button><p id="status" role="status"></p><a href="/">앱 열기</a><script>
(async () => {
  let storageAccess = 'API unavailable';
  if (typeof document.hasStorageAccess === 'function') {
    try { storageAccess = await document.hasStorageAccess(); } catch { storageAccess = 'query denied'; }
  }
  let localStorageReadAccessible = false;
  try { window.localStorage.getItem('lane-club:diagnostic:probe'); localStorageReadAccessible = true; } catch {}
  const environment = {
    checkedAt: new Date().toISOString(), origin: location.origin, userAgent: navigator.userAgent,
    secureContext: window.isSecureContext,
    webLocks: typeof navigator.locks?.request === 'function',
    dialog: typeof HTMLDialogElement !== 'undefined' && typeof HTMLDialogElement.prototype.showModal === 'function',
    localStorageReadAccessible, storageAccess,
    clipboardWrite: typeof navigator.clipboard?.writeText === 'function',
    viewport: { width: innerWidth, height: innerHeight, devicePixelRatio }
  };
  const output = document.getElementById('output');
  output.value = JSON.stringify(environment, null, 2);
  document.getElementById('copy').onclick = async () => {
    try { await navigator.clipboard.writeText(output.value); document.getElementById('status').textContent = '복사했습니다.'; }
    catch { output.focus(); output.select(); document.getElementById('status').textContent = '텍스트를 선택했습니다. 직접 복사해 주세요.'; }
  };
})();
</script></html>`;
