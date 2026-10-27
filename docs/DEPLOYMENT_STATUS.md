# 배포 상태

확인일: 2026년 10월 27일(한국 시간). 수업안 v6·웹앱 스펙 v5 기준이다.

| 항목 | 현재 상태 |
|---|---|
| 2차시 학습·활동·공유 화면 | 자체 검토 수정분 PR #6 병합·Pages 게시 완료. Chromium 데스크톱·모바일 크기 검사 통과 |
| 대본 엔진·선택적 AI 어댑터 | 기본 대본 모드 연결. AI 키·모델 미설정 |
| Google Sheets 스키마 | 9탭·155개 헤더와 초기 설정 준비 |
| Google 계정 | 요청한 개인 계정 연결과 소유권 확인 완료 |
| 실제 Google Sheet | 비공개 시트 생성. 9탭·155개 헤더·설정 8행·Asia/Seoul 확인 |
| Apps Script 프로젝트·웹 앱 | 최초 배포 서버로 실제 정상 저장·중복 ACK 확인. 추가 안정성 보완은 저장소 코드에 반영됐으며 소유자의 새 버전 배포 대기 |
| GitHub | 구현·연결·자체 검토 PR #1·#3·#4·#5·#6 병합 완료 |
| GitHub Pages | 자체 검토 수정분 실행 40486746828 게시 및 공개 파일 검사 성공. https://blink-24.github.io/toronbalpyo/ |
| 브라우저·학교 태블릿 | Chromium 자동 브라우저 데스크톱·모바일 크기 통과. 학교 실제 기기·망과 교사 실제 암호 로그인은 별도 확인 |
| 3·4차시 앱·녹음 업로드 | 이번 2차시 구현의 후속 범위 |

`config.js`에 실제 `/exec` URL을 반영했다. [Live API connection](https://github.com/blink-24/toronbalpyo/actions/runs/40481995409)의 5개 검사에 이어 [전체 브라우저 검사](https://github.com/blink-24/toronbalpyo/actions/runs/40486318647)에서 수정 후보 화면과 실제 Google 서버의 질문·답변·제출·중복 ACK·익명 공유를 확인했다. 모바일 오프라인 2문항 종료와 재연결 후 저장도 통과했고 실제 시트에서 문항 수와 한 세션당 한 행을 대조했다. 시험 세션 3개의 제출·대담·진행 기록 49행만 정리하고 재조회로 확인했다.

자체 검토 결과와 적용 범위는 [AUDIT_20261027.md](AUDIT_20261027.md), 서버의 남은 소유자 작업은 [SERVER_UPDATE.md](SERVER_UPDATE.md)에 있다. **GitHub의 서버 파일 수정은 현재 실행 중인 Apps Script 서버를 자동 갱신하지 않는다.**

공개 사이트: [채움 토론과 반대 신문](https://blink-24.github.io/toronbalpyo/). 배포 뒤 HTML·설정·메인 모듈·스타일 HTTP 확인을 수행하도록 워크플로를 추가했다. HTTP 파일 확인과 실제 브라우저 실행은 구분한다.

## 연결에 필요한 정보

1. Google 시트 생성·개인 계정 소유·비공개 상태를 확인했다. 시트 URL은 계정 소유자에게 직접 전달하며 이 공개 문서에는 학생 기록과 함께 게시하지 않는다.
2. 대상 저장소는 blink-24/toronbalpyo다. 소유자의 최초 화면 작업은 [OWNER_SETUP.md](OWNER_SETUP.md)를 따른다.
3. 시트와 연결된 Apps Script 편집기에 `backend/ServerBundle.gs` 하나를 넣고 `setupDB()`를 실행한다. 최초 Google 권한 승인은 계정 소유자가 수행한다. 세부 설정은 `backend/README.md`를 따른다.
4. 웹 앱 배포 후 실행 URL을 공개 설정에 연결하고 가상 입력으로 실제 제출·재전송·익명 집계·교사 조회를 확인한다. 비밀키나 교사 암호는 대화·저장소·프런트 설정에 넣지 않는다.

현재 연결 도구에는 Apps Script 프로젝트 생성·권한 승인·웹 앱 배포 기능이 없다. 이 초기 단계는 소유자의 화면 작업이 필요하다. 이후 프런트 설정·코드 수정·PR·병합은 지정한 저장소에서 이어서 처리할 수 있다.

## 2026년 10월 27일 원격 확인

- [구현 PR #1](https://github.com/blink-24/toronbalpyo/pull/1): 자동검사 성공 후 병합 완료.
- [Pages 실행](https://github.com/blink-24/toronbalpyo/actions/runs/40445969544): `checks / Test and validate`, 정적 빌드, 공개 파일 경계 검사 성공. `Configure GitHub Pages`는 사이트 설정을 찾지 못해 실패했으며 게시 단계는 실행하지 않았다.
- 사용자가 Settings → Pages → Source를 GitHub Actions로 설정한 뒤 같은 실행 40481995416의 실패 작업만 재실행했다. 2번째 시도에서 build·deploy 성공, 배포 로그의 실제 환경 URL을 확인했다.
- [최초 연결·수업 전 확인 이슈 #2](https://github.com/blink-24/toronbalpyo/issues/2): 남은 소유자 설정·실제 왕복·학교 기기 검증과 유지보수 요청 창구.

공식 참고: [Apps Script 웹 앱](https://developers.google.com/apps-script/guides/web), [Content Service](https://developers.google.com/apps-script/guides/content), [GitHub Pages 워크플로](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).
