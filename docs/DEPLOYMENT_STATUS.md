# 배포 상태

확인일: 2026년 10월 27일(한국 시간). 수업안 v6·웹앱 스펙 v5 기준이다.

| 항목 | 현재 상태 |
|---|---|
| 2차시 학습·활동·공유 화면 | 로컬 구현 |
| 대본 엔진·선택적 AI 어댑터 | 로컬 구현. 실제 AI 키·모델 미설정 |
| Google Sheets 스키마 | 9탭·155개 헤더와 초기 설정 준비 |
| Google 계정 | 요청한 개인 계정 연결과 소유권 확인 완료 |
| 실제 Google Sheet | 비공개 시트 생성. 9탭·155개 헤더·설정 8행·Asia/Seoul 확인 |
| Apps Script 프로젝트·웹 앱 | 사용자가 초기 실행 완료 및 배포 /exec URL 제공. 공개 설정에 연결, GitHub 원격 접속 검사 진행 |
| GitHub | blink-24/toronbalpyo의 PR #1 Checks 통과 후 main 병합 완료. 구현 커밋 5d6313105fcc2fe7ec6dda7db4fa6039afb7e2b5 |
| GitHub Pages | main 검사·빌드·공개 파일 경계 검사 통과. Pages 미활성으로 Configure GitHub Pages 단계에서 Not Found, 사이트 미게시 |
| 브라우저·학교 태블릿 | 실제 실행 검증 미실시 |
| 3·4차시 앱·녹음 업로드 | 이번 2차시 구현의 후속 범위 |

`config.js`의 `apiUrl`에 사용자가 제공한 실제 `/exec` URL을 반영했다. URL 설정과 실서버 검증 결과는 구분한다. 현재 실행 환경의 직접 요청은 통신 제한으로 403을 받아 서버 권한 오류 여부를 판정할 수 없으므로, GitHub의 Live API connection에서 공개 상태·설정·익명 집계·교사 무암호 거부·저장 전 잘못된 입력 거부를 확인한다. 학생 기록을 생성하지 않는 검사이며 실제 정상 제출 저장·브라우저 CORS·교사 암호 로그인은 별도 확인 대상이다.

## 연결에 필요한 정보

1. Google 시트 생성·개인 계정 소유·비공개 상태를 확인했다. 시트 URL은 계정 소유자에게 직접 전달하며 이 공개 문서에는 학생 기록과 함께 게시하지 않는다.
2. 대상 저장소는 blink-24/toronbalpyo다. 소유자의 최초 화면 작업은 [OWNER_SETUP.md](OWNER_SETUP.md)를 따른다.
3. 시트와 연결된 Apps Script 편집기에 `backend/ServerBundle.gs` 하나를 넣고 `setupDB()`를 실행한다. 최초 Google 권한 승인은 계정 소유자가 수행한다. 세부 설정은 `backend/README.md`를 따른다.
4. 웹 앱 배포 후 실행 URL을 공개 설정에 연결하고 가상 입력으로 실제 제출·재전송·익명 집계·교사 조회를 확인한다. 비밀키나 교사 암호는 대화·저장소·프런트 설정에 넣지 않는다.

현재 연결 도구에는 Apps Script 프로젝트 생성·권한 승인·웹 앱 배포 기능이 없다. 이 초기 단계는 소유자의 화면 작업이 필요하다. 이후 프런트 설정·코드 수정·PR·병합은 지정한 저장소에서 이어서 처리할 수 있다.

## 2026년 10월 27일 원격 확인

- [구현 PR #1](https://github.com/blink-24/toronbalpyo/pull/1): 자동검사 성공 후 병합 완료.
- [Pages 실행](https://github.com/blink-24/toronbalpyo/actions/runs/40445969544): `checks / Test and validate`, 정적 빌드, 공개 파일 경계 검사 성공. `Configure GitHub Pages`는 사이트 설정을 찾지 못해 실패했으며 게시 단계는 실행하지 않았다.
- 소유자가 Settings → Pages → Source를 GitHub Actions로 설정한 뒤 다시 실행한다. 실제 게시 URL은 성공 결과에서 확인하며 아직 확정하지 않는다.
- [최초 연결·수업 전 확인 이슈 #2](https://github.com/blink-24/toronbalpyo/issues/2): 남은 소유자 설정·실제 왕복·학교 기기 검증과 유지보수 요청 창구.

공식 참고: [Apps Script 웹 앱](https://developers.google.com/apps-script/guides/web), [Content Service](https://developers.google.com/apps-script/guides/content), [GitHub Pages 워크플로](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).
