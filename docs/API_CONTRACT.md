# 2차시 API와 4차시 확장

기준: 수업안 v6·웹앱 스펙 v5 및 2026-10-27 사용자 확장 요청. 1~5절은 기존 2차시 계약을 유지한다. 4차시 대본·모둠·개방 설정은7절과 [확장 구현 계약](LESSON4_IMPLEMENTATION_CONTRACT.md)을 따른다. 서버 버전 5.1.0과 실제 Apps Script 적용 상태는 구분한다. 이번 4차시는 실제 AI를 호출하지 않는다.

## 1. 콘텐츠와 공통 엔진

정본 콘텐츠는 `data/content.json`, 브라우저·Node 모듈은 `src/core/content.js`다. `CONTENT`를 `createEngine(CONTENT)`에 전달한다. 서버도 같은 데이터와 규칙을 사용하며 브라우저의 피드백 값을 최종 판정으로 신뢰하지 않는다.

| 엔진 함수 | 입력·결과 |
|---|---|
| `buildSession(...)` | `{stance, reasonId, reasonText, cardId, argText, sessionId, questionCount, seed}` → 세션 |
| `getQuestion(session, turn)` | `turn`은 1부터. 확인·검증 질문과 해당 차례의 도움 자료 |
| `recordAnswer(session, ...)` | `{turn, answer, helpIds}` → 답을 확정한 새 세션 |
| `getFeedback(session)` | 질문별 평가와 요약 |
| `finishSession(session, ...)` | `{reflection, earlyFinish}` → 제출 가능한 새 세션 |

입장은 `찬성`·`반대`, 기준은 `신뢰성`·`타당성`·`공정성`을 API 정본 값으로 쓴다. `reasonId`, `cardId`, `questionId`, `helpIds`는 콘텐츠 ID를 사용한다. UI의 `pro`·`con`은 한글 입장으로 정규화한다.

`session.answers`의 각 항목은 `{turn, questionId, answer, helpIds}`다. 제출 전 답변은 고칠 수 있으나 다음 질문으로 확정한 첫 답을 평가한다. 기본 질문 3개, 설정 2개 또는 두 번째 답 뒤 조기 종료가 가능하다. 300자 답변, 필수 성찰 10~150자를 검사한다.

## 2. 요청·응답 공통 형태

POST는 `Content-Type: text/plain;charset=utf-8`, 본문은 JSON 문자열이다. 실제 연결은 브라우저·Apps Script 배포 환경에서 별도로 확인한다.

| 공통 필드 | 용도 |
|---|---|
| `action` | `turn` 또는 `submit` |
| `kind` | 제출 시 `l2_session` |
| `lesson` | 이 절의 기존 계약은2. 4차시는7절의 별도필드·검증 사용 |
| `studentId`, `cls` | 5자리 학번과 반. AI 요청에는 전달하지 않음 |
| `sessionId` | 하나의 체험 흐름 식별 |
| `submissionId` | 제출 중복 방지. 재시도할 때 같은 값 유지 |
| `clientTs`, `appVersion` | 기기 시각·앱 버전 |

성공 응답은 `{ok: true, data: {...}}`, 실패는 `{ok: false, error: {code, message}}`다. 서버는 허용한 필드를 명시적으로 저장하고 임의의 입력 필드를 그대로 저장하지 않는다.

## 3. 대담 차례 `action: turn`

**`mode`, `selection`, `history`, `turn`은 요청 최상위 필드다. `data` 안에 넣지 않는다.**

| 필드 | 값 |
|---|---|
| `mode` | 요청 종류 `question` 또는 `feedback` |
| `selection` | `{stance, reasonId, reasonText, cardId, argText}` |
| `history` | 확정한 답의 목록 `[{questionId, answer, helpIds}]` |
| `turn` | 요청하는 질문 차례, 1부터 |

서버는 선택·기록을 검사하고 질문 계획을 같은 규칙으로 다시 만든다. 질문은 기준 중복 없이 심각도 내림차순, 동률이면 신뢰성→타당성→공정성이다. 클라이언트가 보낸 계획이나 평가로 규칙을 우회하지 않는다.

질문 응답의 `data`는 `{question, mode, sessionId, turn}`이다. 이때 응답 `mode`는 실행 방식인 `script` 또는 `ai`이며 요청의 `question`·`feedback`과 의미가 다르다. 질문에는 확인 질문과 검증 질문을 함께 제시한다. UI는 피드백 전 질문의 기준·숨은 약점·정답성 메타데이터를 표시하지 않는다.

피드백 응답의 `data`는 `{feedback, ruleFeedback, mode, sessionId}`다. 질문별 피드백 항목은 다음 필드를 갖는다.

```text
turn, questionId, criterion, criterionDescription, answer,
reliability: ● / ◐ / ○,
validity: ● / ◐ / ○,
attitude: 인정함 / 보통 / 피함,
comment, better
```

요약은 `{good, improve, reliabilityGood, validityGood, cardWarning}`이다. AI 모드에서도 규칙 판정을 함께 저장·확인한다. API 키·AI 모델 설정·시스템 프롬프트는 서버에만 둔다. AI에는 입론·질문·답변 글만 전달하고 학번·반·모둠·이름은 보내지 않는다.

## 4. 최종 제출 `action: submit`

공통 필드에 `kind: l2_session`을 사용한다. **`data`는 제출 내용에만 사용**하며 `session`의 선택·계획·답변 등 세션 데이터에 `reflection`, `earlyFinish`, `mode`, `durationSec`를 포함한 객체다.

클라이언트 피드백은 참고 입력이다. 서버가 선택·답변·문항·도움 카드·글자 수·차례 수를 검증하고 규칙 피드백을 다시 계산한다. 수신시각·제출 ID·검증된 허용 필드를 `l2_sessions`에 기록한다. 같은 제출 ID는 새 행을 만들지 않고 성공으로 응답한다.

기기 큐는 처음 생성한 제출 ID와 payload를 함께 보존한다. 네트워크·일시적 서버 실패는 재시도하며, 사용자 입력을 고쳐야 하는 오류는 반복 전송하지 않고 해당 안내를 보여 준다. 서버 연결이 없거나 늦어도 대담은 `script-local`로 계속하고 기록은 전송 대기로 구분한다. 로컬 저장을 서버 제출 완료로 표시하지 않는다.

## 5. 조회와 공유

| GET action | 접근·반환 |
|---|---|
| `ping` | 공개 상태 응답 |
| `config` | `grade`, `classCount`, `groupMax`, `acceptLessons`, `l2Questions`, `aiEnabled`, `publicSharing` |
| `public_summary` | 공개 익명 집계. `shared_summary`는 같은 기능의 별칭 |
| `l2_summary` | 교사 암호를 서버에서 검증. 반별 분포·지표와 교사용 기록 |
| `list` | 교사 암호 검증 후 허용 탭 목록·마지막 제출 보기 |
| `status` | 교사 암호 검증 후 현재 구현된 현황 |

공개 집계의 키는 `count`, `total`, `completed`, `stanceCounts`, `cardCounts`, `feedbackCounts`, `byStance`, `byReason`, `byCard`, `lowReliability: {count, rate}`, `metrics`다. **학번·개인별 식별자·입론·답변·성찰 원문은 공개 응답에 포함하지 않는다.**

교사 인증 응답은 필요한 집계와 `records`·`progress`·`answers`를 구분한다. 교사가 수업 정리용으로 투사하는 답변 화면은 학번을 숨긴다. 익명 집계 공유와 교사의 답변 사례 투사는 서로 다른 경로다.

## 6. 범위와 검증

1차시 웹앱 녹음 제출은 없다. 2차시 `l2_session` 계약을4차시 제출에 혼용하지 않는다. 이번 4차시는 독자적인 의료 정책 질문은행·가상 자료·`l4_session` 대본을 추가했다. 3차시 자동 입론 제출과 녹음 업로드는 별도 범위다. 실제 AI연결은 보류하며, 새 서버의 실서비스 적용은 소유자 갱신 뒤에 검증한다.

공통 엔진은 양 입장의 이유 4종(직접쓰기 포함)×근거 카드 4종, 총 32조합을 검사한다. 기준 중복·심각도·확인 대상, 두 번째 답 뒤 종료, 피드백 예시 3종, 자료 인용, 제출 중복·큐 복구, 공개/교사 응답 경계를 검증한다. 실제 시트 왕복·교사 인증·공개 집계·브라우저 전송은 배포된 서비스에 대한 별도 시험 결과로 기록한다.

## 7. 4차시·개방 제어 확장

상위 화면은 2차시·4차시이며, 기존 2차시 내부 학습/활동·공유와 저장 세션을 유지한다. 공개 config를 15초 간격으로 확인해 닫힌 차시의 새 동작을 막고 초안을 지우지 않는다. 서버도 학생의 질문·제출·진행 요청마다 개방 여부를 검사한다. 교사 제어는 서버 PASSCODE 인증을 거친다.

| 요청 | 4차시/공통 확장 |
|---|---|
| `GET config` | 기존 필드에 `implementedLessons:[2,4]`, `l4Questions:3~5`, `l4AiEnabled:false`. 기본 `acceptLessons:[2]` |
| `POST set_lessons` | `{passcode,acceptLessons:[2,4]}`. 2·4만 허용하며 `[]`로 둘 다 닫을 수 있음. 암호·값 검증 뒤 config에 저장 |
| `POST turn` | `lesson:4`, `mode:'question'|'feedback'`, `sessionId`, 대표 `studentId`, `cls`, `groupName`, `memberStudentIds`, `selection:{stance,arg1,arg5}`, `history:[{questionId,answer,helpIds}]`, `turn`. mode·선택·history는 기존처럼 최상위 |
| `POST submit` | `lesson:4`, `kind:'l4_session'`, 제출 ID·세션 ID·모둠 필드. data에는 완료 세션·성찰·조기 종료·소요시간. 서버가 문항·답변·피드백을 재계산 |
| `POST progress` | `lesson:4`, 모둠 필드, `stage:'entry'|'argument'`. 완료 상태를 초기 진행으로 되돌리지 않음 |
| `GET l4_summary` | 교사 PASSCODE와 선택 cls. 모둠별 `{count,total,completed,records,progress,answers}` |
| `GET public_summary?lesson=4` | 식별자·모둠명·입론·답변·성찰 원문이 없는 집계만 반환 |

대표 포함 같은 반 4~5명의 중복 없는 5자리 학번을 `memberStudentIds`에 넣고 `groupName`은 1~30자다. 실명이나 추가 모둠번호를 요구하지 않는다. 반＋정규화 모둠명의 `groupKey`로 이력을 묶는다. 같은 명단 안에서 대표가 바뀌어도 개인별 결과로 나누지 않는다. 명단·모둠명은 엔진의 입론 문자열과 분리해 서버가 검증·저장한다.

4차시 엔진은 `createLesson4Engine(LESSON4_CONTENT)`의 5메서드를 사용한다. 입력 ①은 20~1500자, ⑤는 선택·최대 1500자이며 원문을 유지한다. 기본 4문항(3~5), 질문마다 가상 자료 2~3개, 답변 600자, 3답 이상 조기 종료, 성찰 10~150자다. `getQuestion`의 기준·대상·보완 방향은 내부/피드백용으로 두고 대담 중 정답 표식처럼 공개하지 않는다. 이번 응답 실행 모드는 `script`이며 실제 AI를 호출하지 않는다.

`l4_sessions`는 기존 열 뒤에 `groupName,groupKey,memberStudentIds,stance,arg1,arg5,completedQuestionCount,earlyFinish,durationSec,ruleFeedback,payloadHash`를 추가한다. 기존 행·열을 지우지 않고 같은 제출 ID의 재시도는 한 행이다. 상태·로그는 차시와 세션으로 구분한다.

현재 Apps Script가 이 확장을 지원하지 않으면 4차시와 개방 제어는 준비 상태다. 코드 전체 교체·`setupDB()`·기존 배포 새 버전 적용이 끝나기 전 실제 연결 완료로 표현하지 않는다. [서버 갱신 안내](SERVER_UPDATE.md)와 [배포 상태](DEPLOYMENT_STATUS.md)를 따른다.

## 8. 학생 로그아웃과 로컬 복원(화면5.1.1)

사용자는 같은 기기·브라우저 복원을 선택했다. 서버 API·GAS코드는 그대로5.1.0이며, 새 학생 기록 조회 API를 만들지 않는다. 학생 로그아웃은 개인·모둠 초안을 기존 기기 키에 저장한 뒤 활성 학생/모둠 정보를 초기화하고 입장 화면으로 이동한다. 전송 대기 큐와 제출ID는 유지한다. 같은 학번은 자신의 학습 위치·활동 단계·문항·확정 답·초안을 복원하며4차시는 같은모둠명/명단으로 복원한다. 로그아웃 후 늦은 비동기 응답은 새 로그인에 적용하지 않는다.
