# 채움 AI 교실

화법과 언어 수업의 **2차시 학습 자료·반대 신문 체험** 웹앱이다. 학습 자료와 개인 체험을 두 탭으로 제공하며, 교사는 가상 근거 카드 선택 분포와 답변 사례를 확인한다.

현재 우선 구현 범위는 2차시다. 스펙에 설명된 3차시 입론 제출·4차시 모둠 대담·녹음 업로드 앱은 후속 구현 대상이다. 실제 배포·데이터 연결 상태는 [배포 상태](docs/DEPLOYMENT_STATUS.md)에서 별도로 관리한다.

## 수업 흐름

정책 논제 ‘보행 중에 스마트폰을 사용하면 벌금을 부과해야 한다.’에 찬반을 정하고 이유와 근거 카드로 입론을 만든다. 반대 신문 3개에 답한 뒤 신뢰성·타당성·태도 피드백과 한 줄 성찰을 남긴다. 시간이 부족하면 두 번째 답 뒤 피드백으로 이동할 수 있다.

근거·도움 카드는 모두 가상의 ‘한빛시’를 배경으로 한 **수업용 가상 자료**다. 교과서 202쪽 입론의 긴 본문은 포함하지 않는다. AI가 없어도 대본 모드로 같은 체험 흐름을 진행한다.

## 로컬 확인

Node.js 22 이상을 사용한다. 외부 npm 의존성 설치는 필요 없다.

```bash
npm test
npm run check
npm run build
```

`dist/`가 공개용 정적 파일이다. Python 3가 있다면 다음처럼 로컬에서 미리 볼 수 있다.

```bash
python3 -m http.server 4173 --bind 127.0.0.1 --directory dist
```

브라우저에서 `http://127.0.0.1:4173`을 연다. 원본 자료나 서버 파일을 공개하기 위해 저장소 전체를 웹 루트로 올리지 않는다.

## 데이터 연결

계정 소유자의 최초 화면 작업은 [처음 한 번 하는 설정](docs/OWNER_SETUP.md)에 정리했다. 현재 저장소는 `blink-24/toronbalpyo`다.

1. 이 저장소의 `backend/` 안내에 따라 필요한 스프레드시트와 Apps Script 서버를 준비한다.
2. 교사 암호·AI 키·모델 설정은 Apps Script의 서버 설정에 둔다. 저장소나 `config.js`에 넣지 않는다.
3. `config.js`의 `window.CLASSROOM_CONFIG.apiUrl`에 Apps Script의 실행 URL을 넣는다.
4. 가상 입력으로 제출·공유 집계·교사 조회를 실제로 왕복 확인한다.

API 주소가 비어 있으면 화면 배포와 별개로 서버 제출·공유·교사 기능의 연결은 완료되지 않은 상태다. 화면에서 체험하거나 로컬에 저장한 결과를 서버 제출 완료로 보지 않는다. 관리자용 확인·복구 절차는 [유지보수 안내](docs/MAINTENANCE.md)를 따른다.

## GitHub Pages

대상 저장소가 정해진 뒤 이 소스를 PR로 반영한다. 저장소 관리자 또는 유지관리자는 처음 한 번 **Settings → Pages → Source: GitHub Actions**를 설정해야 할 수 있다.

- PR은 읽기 권한의 `Checks` 워크플로에서 테스트·프로젝트 검사·정적 빌드를 수행한다.
- `main`에 반영되면 검사 통과 후 `dist/`만 Pages 아티팩트로 올린다.
- `backend/`, `docs/`, 시험·원본·교사용 서버 프롬프트는 사이트 배포물에 포함하지 않는다.
- Pages 성공 표시와 실제 API·데이터 연결 확인을 구분한다.

설정 근거는 [GitHub Pages 사용자 지정 워크플로 안내](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)와 [게시 소스 설정 안내](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)다.

## 개선 요청

저장소의 **Issues → New issue**에서 오류 신고 또는 개선 요청을 남긴다. 학생 식별 정보·실제 답변·녹음·교과서 원본·비밀키를 첨부하지 않는다. 이슈 접수는 자동 상주 관리·무단 수정·자동 배포 요청이 아니다. 이후 요청과 현재 작업 범위에 따라 수정하고 PR·검증 기록으로 남긴다.

개발 기준은 [AGENTS.md](AGENTS.md), 콘텐츠 근거는 [CONTENT_TRACE.md](docs/CONTENT_TRACE.md), 인터페이스는 [API_CONTRACT.md](docs/API_CONTRACT.md)를 참고한다.
