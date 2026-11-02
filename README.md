# LANE CLUB · 탑뷰 수영 프로토타입 v0.1

실제 수영 기록으로 캐릭터가 성장하는 Phaser + HTML/CSS + Vanilla JavaScript 프로젝트입니다. 이미지, 폰트, API 요청 없이 번들에 포함된 그래픽과 로컬 저장소만 사용합니다.

## 실행

Node.js 20.19+ 또는 22.12+ 환경에서:

```sh
npm install
npm run dev
```

터미널의 로컬 주소를 브라우저에서 엽니다. `index.html`을 직접 더블클릭하지 마세요.

```sh
npm test          # 데이터/성장/저장소 검증
npm run build    # dist 정적 배포 파일 생성
npm run preview  # 빌드 결과 확인
```

실제 휴대폰에서는 같은 Wi-Fi의 Mac에서 아래 명령으로 HTTPS 테스트 서버를 실행합니다. 출력된 HTTP 안내 주소에서 테스트 CA를 설치·신뢰한 뒤 HTTPS 앱 주소를 엽니다. LAN HTTP 앱 접속은 Web Locks 보안 컨텍스트 조건을 충족하지 못할 수 있습니다.

```sh
npm run mobile:prepare
npm run mobile:serve
```

[휴대폰 접속·인증서·기능/접근성 체크리스트](docs/mobile-device-test.md)와 [실제 기기 결과표](docs/mobile-device-results.md)를 따르세요. 실기기 결과는 아직 미실행이며 공개 배포와 별개입니다.

## 구현 범위

- 코드로 그린 25m / 5레인 탑뷰 수영장과 자유형 픽셀 캐릭터, 턴·물보라
- 날짜·영법·거리·시간 입력, 기록 수정, 다시 보기
- 25m당 10 XP. 레벨 N → N+1에 N×100 XP 필요
- 25m 한 구간당 0.8초 연출, 1×/2×/4× 속도, 일시정지
- 1,000m = 40구간(20왕복), 기본 약 32초. 실제 운동 시간은 기록에 보존
- 연출 완료 후 XP 지급. 연출 중 새로고침하면 미완료 기록을 처음부터 재생하고 한 번만 지급
- 완료 기록 수정 시 XP를 새 거리로 재계산. 다시 보기는 추가 XP 없음
- 첫 캐릭터 생성과 수모·수경·수영복 색상 편집, 취소·변경 폐기 확인
- 주간 수영 횟수(월요일 시작), 누적 거리·시간, 연속 수영일
- LocalStorage 저장, 손상/미지원 데이터 보호, 저장 실패·다른 탭 충돌 안내와 명시적 재읽기
- Web Locks·dialog 등 안전한 저장에 필요한 기능 미지원 시 읽기 전용 보호
- 반응형 화면, 키보드 접근 가능한 네이티브 입력 모달

## 구조

- `src/model.js`: 검증, 경험치·레벨, 통계
- `src/storage.js`: 저장 데이터 읽기, 보호 및 명령 처리
- `src/ui/`: 캐릭터 편집과 dialog 초점 처리
- `src/main.js`: DOM UI, 데이터와 게임 연결, 세션 시작/완료
- `src/game/PoolScene.js`: Phaser 탑뷰 렌더링·수영 연출
- `src/game/art.js`: 코드 생성 픽셀 그래픽
- `src/style.css`: PC·모바일 UI
- `tests/*.test.js`: 데이터·저장·외형·UI·세션 회귀 검사

다른 시점은 `play(record)`, 진행 콜백, 완료 콜백을 동일하게 구현하는 Scene으로 확장할 수 있습니다. 영법은 기록에 저장하지만 v0.1에서는 모두 자유형 애니메이션을 사용합니다. 사이드뷰·아이소메트릭·계정·서버 동기화·커뮤니티는 포함하지 않습니다.

저장 키는 `lane-club:v1`입니다. 데이터는 브라우저/접속 주소별로 독립적이며, 브라우저 데이터 삭제 시 사라집니다. 날짜와 통계는 기기의 현지 날짜를 따릅니다. 연속 기록은 오늘 또는 어제부터 이어진 날짜 수이며 같은 날 여러 기록은 1일로 계산합니다. 브라우저가 백그라운드인 동안 연출은 느려지거나 중단될 수 있습니다.

Phaser 크기 조정 구성 참고: [Scale Manager](https://docs.phaser.io/phaser/concepts/scale-manager)


## GitHub Pages

공개 테스트 주소: https://slur16105.github.io/swim/

main에 push하면 GitHub Actions가 테스트 후 `/swim/` 경로로 빌드해 dist만 배포합니다. 공개 서버는 정적 파일을 제공하며 수영 기록은 각 브라우저 LocalStorage에 남습니다. 로컬 주소의 기록은 공개 주소로 자동 이관되지 않습니다. 실기기 수용 검증은 진행 중입니다.

배포 경로의 로컬 빌드 확인: `npm run build -- --base=/swim/`.
로컬 인증서와 내부 BMAD 파일은 Git에 포함하지 않습니다.
