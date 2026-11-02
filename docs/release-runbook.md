# 공개 전 전환·롤백 실행서

작성일: 2026.11.02 (KST). 이 문서는 로컬에서 준비할 수 있는 절차와 이후 실행할 수용 기준이다. 호스팅 선정·계약·배포·공개 주소 접속·사용자 데이터 변경을 수행했다는 기록이 아니다. **실제 공개 origin의 이관·롤백 리허설은 NOT EXECUTED(미실행)** 이며 공개 준비 완료를 선언하지 않는다.

## 근거와 현재 판정

- [Story 1.7 수용 보고서](../_bmad-output/implementation-artifacts/story-1-7-acceptance.md): 2026.11.02 Node 테스트 100/100 통과, Vite 빌드 성공 및 기존 번들 크기 경고. 이 문서 작성 중 다시 실행한 결과가 아니다.
- 같은 보고서의 Story 1.2~1.6 브라우저 근거: 로컬 Chromium의 v1 읽기 무쓰기·첫 성공 이관·실패 원문 보존, 실제 Web Locks 두 탭 충돌·명시 재읽기, 실제 LocalStorage 재방문. 메모리 fixture 결과와 실제 저장 결과를 구분한다.
- [Story 1.7 추가 브라우저 기록](../_bmad-output/implementation-artifacts/story-1-7-browser-verification.json): Chromium 키보드·360×480 viewport·CDP 감소 움직임 매칭. 실제 iOS/Android·실제 200% 확대·스크린리더 실행 증거가 아니다.
- 현재 구현 정책: [model.js](../src/model.js), [storage.js](../src/storage.js), [이관 테스트](../tests/command-store.test.js), [읽기 테스트](../tests/storage-read.test.js). 아래 리허설의 기준이며 운영 실행을 증명하지 않는다.

실제 휴대폰 결과는 사용자가 별도로 제공한다. 기기명, OS/브라우저 버전, 주소, 실행 시각, 확대·키보드·보조기술 설정, 단계별 결과와 캡처를 받아 Story 1.7 근거와 연결한다. 결과가 올 때까지 실기기 항목과 Story 1.7/Epic 1의 in-progress 상태를 유지한다.

## 저장 계약과 중단 기준

저장 키는 payload v2에서도 **`lane-club:v1`** 이다. origin은 protocol + host + port의 조합이며 다른 포트·도메인·HTTP/HTTPS 간 자동 이관은 없다. 데이터는 해당 브라우저 프로필의 LocalStorage에 남는다.

- v1은 읽을 때만 v2 형태로 정규화한다. 디스크 원문은 그대로이고 메모리 revision은 0, 기존 cap을 유지하며 goggles/suit는 dark로 채운다.
- 첫 성공한 변경 명령이 같은 키에 v2와 revision 1을 한 번 저장한다. 이후 실제 변경 commit마다 revision이 1 증가한다. 이미 complete인 기록의 재완료는 쓰기/revision/XP 증가가 없다.
- 기록 배열의 순서·ID·상태와 기존 기록의 부가 필드는 보존한다. v1의 임의 최상위 부가 필드까지 보존한다는 계약은 없다. XP는 complete 기록 거리로 계산하며 pending은 0XP다.
- 현재 writer는 `lane-club:write` Web Lock 안에서 원문 비교 후 저장한다. 잠금을 따르지 않는 구형 writer와의 혼재를 안전하다고 간주하지 않는다. 구형 탭 종료는 전환의 선행 조건이다.
- 충돌·손상·미지원 버전·저장소 접근 차단이면 진행을 중단한다. 명시적 최신 내용 불러오기 또는 원인 조사로 처리하며 **사용자 저장소 삭제, v1 역변환, 구형 writer 재실행으로 고치지 않는다.** QUOTA/실패 때 성공 문구·XP 지급·원문 변경이 없어야 한다.

## 리허설 준비와 구버전 탭 종료

아래 체크는 아직 완료 표시하지 않는다. 로컬에서는 별도 빈 테스트 origin과 테스트 프로필로 먼저 연습하고, 공개 origin이 정해지면 동일 절차를 다시 수행한다. 로컬 연습 통과를 공개 origin 통과로 승격하지 않는다.

1. 실행표에 origin, 브라우저 프로필/기기, 현재 빌드 식별자, 후보 빌드 식별자, v2 호환 롤백 빌드 식별자, 시각과 담당자를 기록한다. 배포 산출물은 별도 디렉터리에 보관하고 파일 목록·체크섬·빌드 명령을 남긴다. 후보와 롤백 산출물을 덮어쓰지 않는다.
2. 동일 origin의 모든 창/탭, 백그라운드 창, 설치된 웹앱 창과 관련 브라우저 프로필을 목록화한다. 구형 화면에서 입력 중인 변경을 저장할지 폐기할지 사용자가 결정하고, 완료 여부를 확인한 뒤 **모든 구형 탭/창을 닫는다.** 일시정지나 비활성화만으로 종료를 대신하지 않는다.
3. 다른 기기·브라우저 프로필은 각자 별도 저장소지만 각각의 전환 때 같은 종료 절차를 적용한다. 닫힘을 확인하지 못한 실행 컨텍스트가 있으면 중단한다. 구형 코드를 열어 두고 새 코드를 병렬로 검증하지 않는다.
4. 같은 작업의 기존 브라우저 작업 공간을 재사용한다. 종료한 구형 탭 대신 검증용 빈 탭에서 시작하고, 새 빌드가 로드됐는지 식별자와 실제 JS 파일로 확인한다. 이전 구형 페이지를 뒤로 가기/세션 복원으로 되살리지 않는다.
5. 사용자 데이터가 없는 전용 테스트 프로필인지 확인한다. 키가 이미 존재하거나 테스트 데이터인지 확신할 수 없으면 쓰기·삭제하지 않는다. 로컬은 다른 빈 포트/프로필을 사용한다. 공개 origin 리허설은 동일 공개 주소의 전용 테스트 프로필에서만 테스트 seed를 사용한다. 사용자 데이터가 있는 프로필에 seed를 넣지 않는다.

닫힌 탭의 개수만으로 구형 코드가 다시 실행되지 않음을 증명할 수는 없다. 운영 전환 시 구형 산출물 재실행/캐시 정책을 확인할 수 없으면 그 항목을 미확인으로 남기고 공개를 보류한다.

## 테스트 전용 v1 seed와 이관 수용 절차

**미실행 프로토콜.** 다음 seed는 사용자 데이터가 없는 전용 테스트 프로필에만 사용한다. `2026-11-01` 이후 실행에 유효한 날짜이며 오늘 이전인지 확인한다. 기존 키가 null이 아닐 때 중단하는 가드가 있다. 이 코드는 앱이 열린 상태가 아닌 같은 origin의 빈 검증 문서에서 실행하고, 원문을 실행표에 보관한 다음 후보 앱 `/`로 이동한다.

```js
const testKey = 'lane-club:v1';
if (localStorage.getItem(testKey) !== null) throw new Error('기존 데이터: seed 금지');
const seed = {
  version: 1,
  cap: 'pink',
  records: [
    { id: 'release-complete-001', date: '2026-11-01', stroke: '자유형',
      distance: 1000, minutes: 40, status: 'complete',
      note: '기록 부가값 유지', extra: { source: 'release-test', tags: ['keep', 7] } },
    { id: 'release-pending-002', date: '2026-11-01', stroke: '배영',
      distance: 500, minutes: 20, status: 'pending',
      note: '완료 전 XP 없음', extra: { preserve: true } }
  ]
};
const seedRaw = JSON.stringify(seed);
localStorage.setItem(testKey, seedRaw);
```

|단계|행동|필수 기대값|
|---|---|---|
|읽기|후보 앱을 열고 pending 복구 연출은 즉시 일시정지한다. 쓰기 없는 관찰 단계에서 자동 완료되지 않게 한다.|키 원문이 seedRaw와 바이트 단위 동일. v1 유지. cap pink / goggles dark / suit dark. ID·순서·상태·note·extra 동일. 총 거리1500m, 시간60분, XP400 / LV3 / 100 of 300. 메모리 정규화 revision0은 디스크 revision이 아니다.|
|실패 연습|로컬 메모리 fixture/어댑터에서 첫 저장 QUOTA 등을 주입한다. 운영 프로필의 저장 API를 바꾸지 않는다.|실패 시 v1 원문/초안 유지, 이관·revision 증가 없음. 이는 기존 자동/fixture 근거와 별도로 실행 기록한다.|
|첫 성공 변경|pending을 멈춘 상태에서 꾸미기를 열고 수경 green만 저장한다.|같은 키에 version2/revision1. character는 pink/green/dark. 기록 두 개의 모든 필드·순서·상태 동일, XP400. seed의 최상위 cap은 v2 character.cap으로 이동한다.|
|재방문|reload 후 pending 연출을 다시 일시정지한다.|version2/revision1 그대로, 외형·기록·부가값·XP400 유지. 단순 읽기는 추가 이관/쓰기 없음.|
|완료|500m pending 연출을 끝낸다.|두 번째 기록만 complete, version2/revision2. XP600 / LV4 / 0 of 400. 두 note/extra·ID·순서·거리/분 유지.|
|다시 보기·재방문|완료 기록을 다시 보고 reload한다.|revision2와 XP600 유지, 기록 중복 없음. 완료된 재생은 추가 XP 없음.|

일시정지 전에 완료가 발생했다면 위 revision/XP 경로와 다르므로 결과를 통과 처리하지 않는다. 다른 빈 테스트 프로필에서 처음부터 재실행하고 원래 시험 원문은 보존한다. fixture는 reload 영속성을 증명하지 못하므로 실제 LocalStorage 단계와 분리한다.

검증에는 seed 원문과 각 저장 후 원문, 산출물 식별자, UI 캡처, 단계 시각을 첨부한다. 예상과 다른 필드·revision·XP·새 키 생성·v1 쓰기가 있으면 실패다. 테스트 종료 뒤에도 사용자 저장소 정리를 하지 않는다. 폐기 가능한 전용 테스트 프로필은 정상 종료하고 사용자에게 필요한 최종 화면만 남긴다.

## v2 호환 롤백 수용 절차

**NOT EXECUTED.** 롤백은 v2를 읽고 쓰는 검증된 산출물로 코드만 전환한다. 기존 v1 writer 산출물로 역배포하거나 payload를 v1로 낮추는 것을 롤백으로 인정하지 않는다. 보관한 seed/스냅샷은 대조 증거이며 사용자 저장소에 덮어쓸 복원본이 아니다.

1. 위 이관 리허설의 version2/revision2 원문을 보존한다. 후보 앱의 모든 탭/웹앱 창을 닫고 롤백 산출물 식별자와 v2 reader/writer·공유 Web Lock·충돌 차단 계약을 확인한다. 이 조건을 만족하는 산출물이 없으면 롤백 준비 실패다.
2. 동일 origin·동일 전용 프로필에서 롤백 코드를 연다. 첫 읽기 후 원문이 동일하고 외형/기록/부가값/XP600이 같아야 한다. 브라우저 캐시에서 후보 또는 구형 writer가 섞여 로드되지 않았는지 실제 asset을 확인한다.
3. 수영복을 orange로 한 번 저장한다. version2/revision3, cap pink/goggles green/suit orange, 기존 기록 전체와 XP600이 유지돼야 한다. reload 후에도 동일해야 한다.
4. 같은 v2 롤백 빌드의 두 탭에서 같은 revision을 읽는다. A 변경 성공 후 B 변경은 충돌로 차단되고 초안이 남아야 한다. B의 명시적 최신 내용 불러오기 성공 후에만 최신 상태로 전환한다. 구형 writer와의 경합 실험으로 대신하지 않는다.
5. 재전환도 모든 롤백 탭을 닫은 뒤 후보 코드로 시행한다. 현재 v2 revision을 낮추지 않고 읽기 무쓰기·다음 성공 commit +1·XP 보존을 확인한다. 미지원/손상/접근 오류에서 쓰기 차단 여부도 로컬 fixture 근거와 대조한다.

실패하면 추가 쓰기를 멈추고 원문·오류·빌드 식별자를 보존한다. **사용자 키 삭제, 저장소 초기화, 구형 writer 실행, 자동 downgrade는 금지한다.**

## 공개 주소가 정해진 뒤의 실행 체크리스트

모두 미실행/미확인이다. 호스팅을 선택하거나 배포할 권한을 이 문서가 부여하지 않는다.

- [ ] 고정 HTTPS origin, 인증서 오류 없음, `isSecureContext`, LocalStorage 읽기/쓰기, 실제 Web Locks, native dialog를 지원 대상 기기에서 확인한다. localhost의 secure-context 예외로 대신하지 않는다.
- [ ] `dist/index.html` 및 참조 JS/CSS/static asset의 경로·응답 MIME·오류 없는 로드를 확인한다. 현재 앱은 `/` 단일 진입점이고 client-side router/deep link가 없다. `/`와 reload 동작을 검증하며 현재 범위에 SPA fallback 설정을 필수로 추가하지 않는다. 하위 경로 배포는 별도 base/asset 검증 전 지원 완료로 표시하지 않는다.
- [ ] 실제 전환 주소에서 위 구형 탭 종료→v1→v2→재방문→v2 호환 롤백 절차를 실행하고 증거를 보관한다. origin을 바꾸어 통과시키지 않는다.
- [ ] 구형 HTML/JS가 다시 실행되지 않는 캐시·산출물 제공 정책, 후보/롤백 보관 위치와 식별자를 기록한다.
- [ ] src/index.html 정적 점검에서는 기록/외형 전송용 fetch/XHR/sendBeacon/WebSocket, 추적 SDK·계정·서버 API 경로를 찾지 못했다. 실제 공개 산출물의 Network 요청과 제3자 요청·쿠키를 확인한다. 정적 asset 다운로드도 네트워크 요청이므로 무통신으로 안내하지 않는다.
- [ ] 호스팅 접근 로그 유무·내용·보관 기간·운영자 접근 정책은 **미확인**이다. 소스에 tracking/API가 없다는 사실을 호스팅 무로그의 증거로 사용하지 않는다. 실제 설정과 사용자 저장 안내를 대조한다.
- [ ] 사용자가 제공하는 실제 휴대폰·확대·스크린리더 결과를 Story 1.7에 연결하고 누락/실패를 해소한다. 열린 앱의 offline 동작과 오프라인 첫 방문/재실행 보장을 구분한다. 서비스워커는 현재 범위에 없다.

실행 기록에는 각 항목을 `PASS / FAIL / NOT EXECUTED`로 표시하고 환경·빌드·origin·시각·원문 대조·증거 링크·실패 후 조치를 남긴다. 이 문서가 존재한다는 사실만으로 어느 항목도 PASS가 되지 않는다.
