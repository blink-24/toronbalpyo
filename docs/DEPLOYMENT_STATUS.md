# 배포 상태

확인일: 2026년 10월 27일(한국 시간). 수업안 v6·웹앱 스펙 v5 기준이다.

| 항목 | 현재 상태 |
|---|---|
| 2차시 학습·활동·공유 화면 | 로컬 구현 |
| 대본 엔진·선택적 AI 어댑터 | 로컬 구현. 실제 AI 키·모델 미설정 |
| Google Sheets 스키마 | 9탭·155개 헤더와 초기 설정 준비 |
| Google 계정 | 요청한 개인 계정 연결과 소유권 확인 완료 |
| 실제 Google Sheet | 비공개 시트 생성. 9탭·155개 헤더·설정 8행·Asia/Seoul 확인 |
| Apps Script 프로젝트·웹 앱 | 코드 준비. 사용자 계정에서 초기 실행·권한 승인·배포 필요 |
| GitHub | 사용자 지정 blink-24/toronbalpyo(main) 확인. 빈 저장소 초기화 후 구현 PR 반영 진행 |
| GitHub Pages | 워크플로 준비. 실제 배포 미실시 |
| 브라우저·학교 태블릿 | 실제 실행 검증 미실시 |
| 3·4차시 앱·녹음 업로드 | 이번 2차시 구현의 후속 범위 |

`config.js`의 `apiUrl`은 실제 `/exec` URL이 생길 때까지 비어 있다. 이 상태에서는 대담을 로컬 대본으로 진행할 수 있고 제출 기록은 전송 대기로 남는다. 시트에 제출되었다거나 교사 조회·공유 서버가 연결되었다고 표시하지 않는다.

## 연결에 필요한 정보

1. Google 시트 생성·개인 계정 소유·비공개 상태를 확인했다. 시트 URL은 계정 소유자에게 직접 전달하며 이 공개 문서에는 학생 기록과 함께 게시하지 않는다.
2. 대상 저장소는 blink-24/toronbalpyo다. 소유자의 최초 화면 작업은 [OWNER_SETUP.md](OWNER_SETUP.md)를 따른다.
3. 시트와 연결된 Apps Script 편집기에 `backend/ServerBundle.gs` 하나를 넣고 `setupDB()`를 실행한다. 최초 Google 권한 승인은 계정 소유자가 수행한다. 세부 설정은 `backend/README.md`를 따른다.
4. 웹 앱 배포 후 실행 URL을 공개 설정에 연결하고 가상 입력으로 실제 제출·재전송·익명 집계·교사 조회를 확인한다. 비밀키나 교사 암호는 대화·저장소·프런트 설정에 넣지 않는다.

현재 연결 도구에는 Apps Script 프로젝트 생성·권한 승인·웹 앱 배포 기능이 없다. 이 초기 단계는 소유자의 화면 작업이 필요하다. 이후 프런트 설정·코드 수정·PR·병합은 지정한 저장소에서 이어서 처리할 수 있다.

공식 참고: [Apps Script 웹 앱](https://developers.google.com/apps-script/guides/web), [Content Service](https://developers.google.com/apps-script/guides/content), [GitHub Pages 워크플로](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).
