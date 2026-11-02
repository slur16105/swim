# Command Store 두 탭 수동 검증

실제 사용자 데이터가 없는 **새 테스트 전용 localhost origin**에서만 실행한다. 기존 앱 origin이나 기존 데이터는 지우거나 덮어쓰지 않는다. 다음 예의 포트가 이미 사용된 적 있다면 새 포트를 선택한다.

1. 프로젝트에서 `npm run dev -- --port 51987 --strictPort`를 실행한다. 같은 브라우저 작업 공간에 `http://127.0.0.1:51987/tests/fixtures/command-store.html` 탭 A와 탭 B를 연다. 양쪽 콘솔에서 `commandStoreFixtureReady === true`와 `localStorage.getItem('lane-club:v1') === null`을 확인한다. null이 아니면 중단하고 다른 새 포트를 사용한다.
2. 탭 A 콘솔에서 아래를 실행한다. 테스트 전용 잠금을 먼저 잡고, 두 쓰기 요청이 실제 대기 목록에 들어온 뒤 해제한다. BroadcastChannel은 수동 탭 전환 때문에 5초 제한을 넘지 않도록 테스트 시작을 전달한다.

```js
window.testStore = createTestStore({ eventTarget: null });
window.testChannel = new BroadcastChannel('command-store-check');
window.testHeld = navigator.locks.request('lane-club:write', { mode: 'exclusive' }, () =>
  new Promise(resolve => { window.testRelease = resolve; }));
while (!window.testRelease) await new Promise(resolve => setTimeout(resolve, 0));
testChannel.onmessage = async ({ data }) => {
  if (data !== 'b-queued') return;
  const deadline = performance.now() + 1000;
  while (performance.now() < deadline) {
    const { pending } = await navigator.locks.query();
    if (pending.filter(lock => lock.name === 'lane-club:write').length === 2) {
      console.log('두 요청 대기 확인');
      testRelease();
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  testRelease();
  console.error('실패: 두 요청 대기 상태를 확인하지 못함');
};
```

3. 탭 B 콘솔에서 준비한다. 아직 저장 요청은 시작하지 않는다.

```js
window.testStore = createTestStore({ eventTarget: null });
window.testChannel = new BroadcastChannel('command-store-check');
testChannel.onmessage = async ({ data }) => {
  if (data !== 'start') return;
  window.testPending = testStore.saveCharacter({ cap: 'pink', goggles: 'pink', suit: 'pink' });
  await Promise.resolve();
  testChannel.postMessage('b-queued');
  window.testResult = await testPending;
  console.log(testResult);
};
```

4. 탭 A 콘솔에서 동시 검증을 시작한다.

```js
window.testPending = testStore.saveCharacter({ cap: 'orange', goggles: 'dark', suit: 'dark' });
testChannel.postMessage('start');
window.testResult = await testPending;
console.log(testResult);
```

A 콘솔에 `두 요청 대기 확인`이 나타나야 한다. 양쪽 `testResult`를 비교해 정확히 하나는 `ok: true`, 다른 하나는 `{ok: false, code: 'CONFLICT'}`인지 확인한다. 양쪽에서 `JSON.parse(localStorage.getItem('lane-club:v1'))`을 조회하면 같은 외형, `version: 2`, `revision: 1`, 빈 records여야 한다. 실패 탭의 `testStore.get().data.character`는 아직 null이고 `get().code`는 CONFLICT여야 한다.

5. **CONFLICT를 받은 탭**에서 다음을 실행한다.

```js
console.log(await testStore.reload()); // ok:true, data.revision:1
console.log(await testStore.saveCharacter({ cap: 'green', goggles: 'green', suit: 'dark' }));
console.log(JSON.parse(localStorage.getItem('lane-club:v1'))); // revision:2, green/green/dark
```

재읽기와 후속 저장 모두 성공하고 revision은 정확히 2여야 한다. 양쪽 탭에서 같은 저장 원문이 보이는지 확인한다. 테스트 종료 시 각 탭에서 `testStore.dispose(); testChannel.close()`를 실행하고 테스트 탭과 개발 서버를 종료한다. 브라우저 버전·테스트 origin·두 결과·revision 1/2 확인을 검증 기록에 남긴다.
