# 채움 2·4차시 서버

수업안 v6·웹앱 스펙 v5와 최신 사용자 요청에 따른 2차시 개인 체험·4차시 모둠 대본을 구현한다. 저장소 서버는 5.1.0이며 현재 실행 중인 Apps Script에 자동 적용되지 않는다. 소유자의 전체 코드 교체·`setupDB()`·기존 웹앱 새 버전 배포가 필요하다. 실제 연결 상태는 [배포 상태](../docs/DEPLOYMENT_STATUS.md)와 [서버 갱신 안내](../docs/SERVER_UPDATE.md)를 따른다. 실제 AI 연결은 보류다.

## 파일과 로컬 확인

- `../src/core/engine.js`·`../data/content.json`: 기존 2차시 순수 엔진·정본.
- `../src/core/lesson4.js`·`../data/lesson4.json`: 4차시 순수 대본 엔진·독자 콘텐츠. lesson4-content.js는 동일 정본의 named/default LESSON4_CONTENT 모듈이다.
- `service.js`: 입력·세션·모둠·개방·저장·집계 검증. createService는 선택 lesson4Content를 받고 기본 정본을 사용한다.
- `Native.gs`: Google Sheets·잠금·속성·기존 선택적 AI 어댑터. 4차시 대담에서는 AI를 호출하지 않는다.
- `ServerBundle.gs`: 두 차시 엔진·콘텐츠·서비스·Native를 합친 자동 생성 파일. Apps Script에는 이 파일 하나만 붙인다.
- `schema.json`: 9탭의 현재 머리글·초기 설정. 기존 열 순서를 유지하며 L4 열을 뒤에 추가한다.

```bash
node backend/sync.mjs
node backend/sync.mjs --check
npm test
npm run check
npm run build
```

--check는 정본과 생성본의 일치를 확인하며 Google에 접속하지 않는다. 가상 저장소 시험·브라우저·실제 Google 왕복·학교 기기 확인을 구분한다.

## 계정 소유자 적용

기존 개인 계정 소유·비공개 시트를 유지한다. 기존 Apps Script의 코드 전체를 새 ServerBundle.gs로 교체하고 SPREADSHEET_ID·PASSCODE 등 기존 속성은 보존한다. `AI_PROVIDER=none`을 유지하며 이번에 AI 키·모델을 추가하지 않는다. setupDB()는 기존 탭·열·행을 삭제하지 않고 빠진 머리글·기본 설정만 보완한다. 기존 배포를 새 버전으로 갱신하면 같은 /exec 주소를 유지할 수 있다. 상세 단계는 [소유자 설정](../docs/OWNER_SETUP.md)을 따른다.

암호·시트 ID·AI 키를 프런트·공개 저장소·시트 config에 넣지 않는다. 기존 선택적 AI 속성·어댑터의 존재는 실제 AI 사용 승인이나 연결 완료를 뜻하지 않는다.

## 2차시 유지 계약

찬반 2×이유 4×근거 4의 32조합, 기본 3질문·설정 2질문·2답 뒤 조기 종료를 유지한다. 각 기준의 서로 다른 대상을 심각도와 고정 동률 순서로 묻고 질문마다 가상 도움 자료 2장을 제시한다. 답변 300자·첫 답 잠금·성찰 10~150자·교사 조회·익명 집계·초안 복원·중복 ACK를 유지한다. 세 번째 빈 문항을 만들지 않고 실제 답한 문항만 평가·저장한다. 자세한 기존 계약은 [API_CONTRACT](../docs/API_CONTRACT.md) 1~5절이다.

## 4차시 모둠·대본 계약

논제는 인공 지능 의료 상담 도우미의 공공 의료 도입이다. 대표 포함 같은 반 4~5명의 학번 memberStudentIds와 1~30자 groupName을 받되 실명은 받지 않는다. 반＋정규화 모둠명으로 groupKey를 만들고 최신 모둠 이력을 묶는다. 대표가 바뀌어도 동일 명단의 같은 모둠 세션을 복원한다.

작성한 arg1 20~1500자와 선택 arg5 최대 1500자를 대필 없이 사용한다. 기본 4질문(3~5), 입론 단서·시드 적응, 확인→검증, 각 가상 자료 2~3개, 답변 600자·첫 답 잠금·3답 이상 조기 종료·성찰 10~150자를 검사한다. 질문 기준·숨은 검토 방향은 피드백 전 정답 표식으로 표시하지 않는다. ⑦의 불명확한 설문을 검증된 사실로 쓰지 않고 근거 카드 5·6의 사용 보류를 유지한다. 의료 조언·새 실통계·AI 호출은 제공하지 않는다.

turn·progress·submit에서 lesson:4와 별도 모둠 필드를 검증한다. 제출 kind는 l4_session, 교사 조회는 l4_summary, 공개 집계는 public_summary?lesson=4다. 모둠명·전체 학번·입론·답변·성찰 원문은 공개 응답에 포함하지 않는다. 상세는 [4차시 구현 계약](../docs/LESSON4_IMPLEMENTATION_CONTRACT.md)을 따른다.

## 개방 설정과 기록 보호

공개 config는 implementedLessons:[2,4], l4Questions:3~5, l4AiEnabled:false를 반환한다. 기본 acceptLessons='2'로 4차시는 처음 닫힘이다. 교사는 PASSCODE 인증된 set_lessons로 2·4를 열거나 닫으며 []로 모두 닫을 수 있다. 프런트의 15초 설정 확인과 별개로 서버가 학생 요청마다 닫힘을 검사한다. 닫혔을 때 초안·완료 상태를 지우지 않고 재개 후 이어 간다.

9탭은 config,l2_sessions,ai_log,l3_args,l4_sessions,recordings,uploads,log,progress다. 기존 L4 열 뒤에 groupName,groupKey,memberStudentIds,stance,arg1,arg5,completedQuestionCount,earlyFinish,durationSec,ruleFeedback,payloadHash를 추가한다. 3차시 자동 입론 제출·녹음 업로드는 이번 확장에 포함하지 않는다.

같은 제출 ID의 다른 내용은 거부하고 캐시 쓰기 실패 뒤에도 시트 행으로 중복을 확인한다. 학생 자유 글의 길이·제어 문자·PII 표현을 검사하고 저장 전 수식 접두사를 방어한다. 실제 셀 문자열 2000자 한도를 검사하며 상태는 1999자 조각으로 저장·복원한다. 차시·세션으로 L2/L4를 구분하고 늦은 질문·진행·재전송이 완료를 되돌리지 않게 한다. 교사 조회에는 서버 PASSCODE 인증을 적용한다.

## 기존 선택적 AI 어댑터의 경계

2차시에 기존 어댑터 코드는 남아 있지만 이번 4차시는 항상 대본이다. 실제 AI 공급자·모델·연령·학교 승인은 미확인이고 새 호출을 하지 않는다. 기존 브라우저 20초 마감·대본 전환·늦은 응답 무시·식별자 제외 보호는 2차시 계약으로 유지한다. 키·암호는 공개 코드에 없어야 하며 속성이 설정되어 있다는 이유만으로 4차시 AI를 활성화하지 않는다.
