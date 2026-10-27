# 2·4차시 확장 구현 계약

2026-10-27 최신 사용자 요청. 실제 AI API 연결은 사용자가 보류하고 대본 우선 구현을 선택했다. 모둠 정보는 모든 모둠원 학번＋모둠명이며 실명을 추가하지 않는다. 이전 2차시 전용 제한은 이 요청으로 대체한다. 서버·원본 수업 자료·기존 데이터는 서로 구분한다.

## 화면과 차시 개방

- 첫 화면 상위 탭은 2차시·4차시. 기존 PPT 학습/활동·공유는 2차시 안에 유지한다. 기존 #/learn·#/lesson2 주소는 계속 2차시로 연결한다.
- 교사 화면은 차시 선택과 2차시·4차시 개방 제어를 제공한다. GET config는 공개 허용값만 반환하고 POST set_lessons는 서버 PASSCODE 인증 후 acceptLessons를 갱신한다. 허용값은 2·4뿐이다.
- 기존 기본 설정 acceptLessons='2'를 유지해 4차시는 최초 닫힘이다. 학생 화면은 주기적으로 공개 config를 확인하고 닫힌 차시는 진입·다음 동작을 막되 초안을 지우지 않는다. 서버도 학생 POST마다 닫힘을 검사한다.
- 최초 서버에는 새 기능이 없으므로 4차시와 교사 개방 제어는 서버 갱신 전 준비 상태로 표시한다. 4차시를 AI 모드라고 표시하지 않는다.

## 모둠과 입론

- 대표 학번 studentId, groupName(1~30자), memberStudentIds(대표 포함, 같은 반 4~5명, 중복 없음). 반은 학번에서 검증한다. groupNo는 기존 공통 열을 유지하되 이번 UI에서 추가로 요구하지 않는다.
- stance='찬성'|'반대', arg1(20~1500자), arg5(선택, 최대1500자). ①·⑤를 넣을 수 있으나 이미 작성한 학생 입론을 앱이 대필하지 않는다. groupName·모든 학번은 교사 전용 저장 필드이며 공개 집계에 내보내지 않는다.
- groupKey는 반＋정규화 모둠명으로 일관되게 만들고 저장 이력은 추가만 한다. 최신 결과는 모둠 기준으로 묶는다. 대표만 바꿨다고 결과를 개인별로 나누지 않는다.

## 순수 엔진

- data/lesson4.json과 src/core/lesson4-content.js(LESSON4_CONTENT named/default export)는 동일한 데이터다. 학생용 자료는 자체 작성한 대본·수업용 가상 자료이며 ⑦의 불명확한 설문을 검증된 사실로 쓰지 않는다. 실제 건강 조언·허위 실통계 생성은 하지 않는다.
- src/core/lesson4.js: createLesson4Engine(content). 메서드는 buildSession, getQuestion, recordAnswer, getFeedback, finishSession이며 2차시와 같은 형태다.
- buildSession({stance,arg1,arg5,sessionId,questionCount=4,seed}) → session. 입론의 단서와 시드에 따라 중복 없는 질문 3~5개를 선택하고 질문마다 가상 도움 카드 2~3개를 고른다. 기본4개, 조기 종료는3답 이상. 같은 시드는 복원 가능하며 다른 모둠 시드에는 질문 다양성이 있다.
- getQuestion(session,turn) → {id,criterion,targetKey,confirm,verify,helpCards,better,turn}. 각 질문은 확인→검증이며 기준·숨은 약점은 피드백 전 UI에서 공개하지 않는다.
- recordAnswer(session,{turn,answer,helpIds})는 답변 최대600자·첫 확정 답 잠금을 검사한다. finishSession(session,{reflection,earlyFinish})는 실제 답한 문항 수와 성찰10~150자를 검사한다.

## API와 저장

- createService는 lesson4Content를 선택 인자로 받고 기본은 정본 콘텐츠를 사용한다. 엔진은 Node·브라우저·GAS에서 같은 코드로 실행한다. root가 sync.mjs·Native.gs·schema 생성 담당이다.
- POST turn: 기존 최상위 mode='question'|'feedback', lesson=4, sessionId, studentId, cls, groupName, memberStudentIds, selection:{stance,arg1,arg5}, history:[{questionId,answer,helpIds}], turn. 이번 응답 mode는 script다.
- POST submit: kind='l4_session',lesson=4,공통 모둠 필드,data=완료 session＋reflection/earlyFinish/mode/durationSec. server가 문항·답변·피드백을 재계산하며 중복 ID는 한 행이다.
- POST progress: lesson=4, 공통 모둠 필드, stage='entry'|'argument'. 세션 완료 뒤 초기 진행이 역전하지 않는다.
- GET l4_summary: PASSCODE 인증, cls 필터. {count,total,completed,records,progress,answers}를 모둠별로 반환한다. 공개 public_summary?lesson=4는 식별자·모둠명·원문 없는 집계만 반환한다.
- POST set_lessons: {passcode,acceptLessons:[2,4]}를 서버 인증·검증 후 store.writeConfig('acceptLessons', '2,4')로 저장한다. 잘못된 값과 무암호 요청은 거부한다. 학생 프런트에서만 가리는 것으로 완료하지 않는다.
- GET config에 implementedLessons:[2,4],l4Questions(3~5),l4AiEnabled:false를 추가한다. 서버 버전5.1.0. L2 교육 콘텐츠 version5.0.0과는 구분하며 기존 L2 세션을 유지한다.
- l4_sessions는 기존 열 뒤에 groupName,groupKey,memberStudentIds,stance,arg1,arg5,completedQuestionCount,earlyFinish,durationSec,ruleFeedback,payloadHash를 추가한다. 과거 열·탭·행은 삭제하지 않는다. progress·ai_log는 기존 공통 열과 sessionId로 연결하며 lesson=4를 구분한다.
- 닫힘·저장 장애·늦은 응답·일시 BUSY·수식/길이·중복·개인정보 보호의 기존 보완을 4차시에도 적용한다. 모둠 학번은 AI/공개 응답에 전달하지 않는다. 실제 AI 어댑터는 이번에 호출하지 않는다.

## 검증과 반영

기존 53개 시험을 유지하고 L4 모둠·3/4/5문항·대본 적응·도움카드·저장/중복·권한·차시 닫힘/재개 회귀를 추가한다. 새 서버는 소유자 코드 교체·setupDB·기존 배포 새 버전이 필요하며 한 번에 묶는다. 새 서버 적용 전 새 기능이 실서비스에서 동작한다고 표현하지 않는다.
