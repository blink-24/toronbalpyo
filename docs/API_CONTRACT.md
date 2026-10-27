# 2차시 API·공통 엔진 계약

기준: 수업안 v6·웹앱 스펙 v5. 콘텐츠·프런트엔드·서버 담당이 맞춘 구현 계약이다. 이 문서가 있다는 사실은 실서버 배포·학교 기기 검증 완료를 뜻하지 않는다.

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
| `lesson` | 현재 구현 범위는 2 |
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

현재 구현 중심은 2차시다. 1차시 웹앱 녹음 제출은 없으며, 3·4차시를 2차시 제출 API에 섞지 않는다. 4차시는 모둠과 챗봇 대담으로 변경되었고 구체 의료 질문은행은 후속 확정 대상이다.

공통 엔진은 양 입장의 이유 4종(직접쓰기 포함)×근거 카드 4종, 총 32조합을 검사한다. 기준 중복·심각도·확인 대상, 두 번째 답 뒤 종료, 피드백 예시 3종, 자료 인용, 제출 중복·큐 복구, 공개/교사 응답 경계를 검증한다. 실제 시트 왕복·교사 인증·공개 집계·브라우저 전송은 배포된 서비스에 대한 별도 시험 결과로 기록한다.
