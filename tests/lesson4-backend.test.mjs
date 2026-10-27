import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import content from '../src/core/content.js';
import lesson4Content from '../src/core/lesson4-content.js';
import { createEngine } from '../src/core/engine.js';
import { createLesson4Engine } from '../src/core/lesson4.js';
import { createService, HEADERS, COMMON_HEADERS, VERSION } from '../backend/service.js';

const engine = createLesson4Engine(lesson4Content);
const members = ['20301', '20302', '20303', '20304'];
const arg1 = '환자의 선택과 근거의 범위를 함께 확인하여 제도를 시행할 조건을 검토해야 합니다.';
const arg5 = '반대 측이 제기한 비용과 접근성 문제도 자료의 조건을 확인하며 검토해야 합니다.';
function fixture({ opened = '2,4', questionCount = 4, beforeAppend = null, beforePropertySet = null, beforeLock = null } = {}) {
  const db = Object.fromEntries(Object.keys(HEADERS).map(key => [key, []]));
  db.config.push({ key: 'acceptLessons', value: opened, note: '기존 설정 설명' }, { key: 'l4Questions', value: String(questionCount) });
  const props = new Map([['PASSCODE', 'virtual-teacher-passcode'], ['AI_PROVIDER', 'gemini'], ['AI_MODEL', 'virtual-model'], ['AI_API_KEY', 'not-a-real-key']]);
  let held = false, aiCalls = 0;
  const store = {
    read: tab => db[tab],
    append: (tab, row) => { assert.ok(held); if (beforeAppend) beforeAppend(tab, row); db[tab].push({ ...row }); },
    withLock: fn => { assert.equal(held, false); if (beforeLock) beforeLock(db); held = true; try { return fn(); } finally { held = false; } },
    writeConfig: (key, value) => { assert.ok(held); assert.equal(key, 'acceptLessons'); const row = db.config.find(x => x.key === key); if (row) row.value = value; else db.config.push({ key, value }); },
  };
  // 기본 정본 인자로 4차시 엔진을 만들며 실제 AI 호출은 허용하지 않습니다.
  const service = createService({ content, store, properties: { get: key => props.get(key), set: (key, value) => {
    if (beforePropertySet) beforePropertySet(key, value); props.set(key, value);
  } }, clock: () => 1800000000000, hash: value => createHash('sha256').update(value).digest('hex'),
  providerCall: () => { aiCalls++; throw Error('4차시에서 실제 AI를 호출하면 안 됩니다.'); } });
  return { service, db, props, get aiCalls() { return aiCalls; } };
}
function session({ questionCount = 4, count = questionCount, ...overrides } = {}) {
  let s = engine.buildSession({ stance: '찬성', arg1, arg5, sessionId: 'lesson4-session-001', questionCount, ...overrides });
  for (let turn = 1; turn <= count; turn++) s = engine.recordAnswer(s, { turn, answer: '맞습니다. 다만 자료의 출처와 적용 조건을 함께 확인해야 하기 때문에 주장의 범위를 보완하겠습니다.', helpIds: [] });
  return { ...s, reflection: '다음에는 자료의 출처와 적용 조건을 먼저 확인하겠습니다.', earlyFinish: count < questionCount, mode: 'script-local' };
}
function envelope(s, extra = {}) {
  return { lesson: 4, studentId: '20301', cls: 3, groupName: '비밀모둠', memberStudentIds: members.slice(), sessionId: s.sessionId, ...extra };
}
function turn(s = session({ count: 0 }), extra = {}) {
  return { ...envelope(s), action: 'turn', mode: 'question', turn: s.answers.length + 1,
    selection: { stance: s.stance, arg1: s.arg1, arg5: s.arg5, seed: s.seed }, history: s.answers, ...extra };
}
function submit(s = session(), extra = {}) {
  return { ...envelope(s), action: 'submit', kind: 'l4_session', submissionId: 'lesson4-submit-001', data: s, ...extra };
}
function savedState(f) {
  const row = f.db.progress.at(-1);
  return JSON.parse([1, 2, 3, 4, 5, 6, 7, 8].map(n => String(row[`state${n}`] || '').slice(1)).join(''));
}

test('버전·차시 개방 계약과 기존 l4 열 순서를 보존한다', () => {
  const f = fixture({ opened: '2' }), cfg = f.service.respond('GET', { action: 'config' }).data;
  assert.equal(VERSION, '5.1.0'); assert.equal(content.version, '5.0.0'); assert.equal(cfg.appVersion, VERSION);
  assert.deepEqual(cfg.implementedLessons, [2, 4]); assert.equal(cfg.l4Questions, 4); assert.equal(cfg.l4AiEnabled, false);
  assert.deepEqual(cfg.acceptLessons, [2]); assert.equal(cfg.lessons[4].enabled, false);
  assert.deepEqual(HEADERS.l4_sessions.slice(0, 28), [...COMMON_HEADERS, 'sessionId', 'part', ...[1, 2, 3, 4, 5].flatMap(n => [`q${n}`, `a${n}`, `help${n}`]), 'feedback', 'reflection', 'mode']);
  assert.deepEqual(HEADERS.l4_sessions.slice(28), ['groupName', 'groupKey', 'memberStudentIds', 'stance', 'arg1', 'arg5', 'completedQuestionCount', 'earlyFinish', 'durationSec', 'ruleFeedback', 'payloadHash']);
});
test('교사 인증 후 2·4만 열거나 모두 닫고, 잘못된 설정은 쓰지 않는다', () => {
  const f = fixture(), before = JSON.stringify(f.db.config);
  assert.equal(f.service.respond('POST', { action: 'set_lessons', acceptLessons: [4] }).error.code, 'UNAUTHORIZED');
  for (const acceptLessons of [[3], [2, 2], ['4'], '2,4', null]) {
    assert.equal(f.service.respond('POST', { action: 'set_lessons', passcode: 'virtual-teacher-passcode', acceptLessons }).error.code, 'INVALID_LESSONS');
    assert.equal(JSON.stringify(f.db.config), before);
  }
  const close = f.service.respond('POST', { action: 'set_lessons', passcode: 'virtual-teacher-passcode', acceptLessons: [] });
  assert.equal(close.ok, true); assert.deepEqual(close.data.acceptLessons, []); assert.equal(f.db.config[0].value, ''); assert.equal(f.db.config[0].note, '기존 설정 설명');
  for (const lesson of [2, 4]) assert.equal(f.service.respond('GET', { action: 'public_summary', lesson }).error.code, 'LESSON_CLOSED');
  assert.equal(f.service.respond('GET', { action: 'l4_summary', passcode: 'virtual-teacher-passcode' }).ok, true);
  const reopen = f.service.respond('POST', { action: 'set_lessons', passcode: 'virtual-teacher-passcode', acceptLessons: [4, 2] });
  assert.deepEqual(reopen.data.acceptLessons, [2, 4]); assert.equal(f.db.config[0].value, '2,4');
  for (const [value, expected] of [['', []], [[], []], [null, [2]], [undefined, [2]]]) {
    f.db.config[0].value = value; assert.deepEqual(f.service.respond('GET', { action: 'config' }).data.acceptLessons, expected);
  }
});
test('닫힌 4차시의 질문·제출·진행을 서버가 거부하고 재개 뒤 대본을 이어 간다', () => {
  const f = fixture({ opened: '2' }), s = session({ count: 0 });
  for (const request of [turn(s), submit(), { ...envelope(s), action: 'progress', stage: 'entry' }]) assert.equal(f.service.respond('POST', request).error.code, 'LESSON_CLOSED');
  assert.equal(f.db.progress.length, 0); assert.equal(f.db.l4_sessions.length, 0);
  f.service.respond('POST', { action: 'set_lessons', passcode: 'virtual-teacher-passcode', acceptLessons: [2, 4] });
  assert.equal(f.service.respond('POST', turn(s)).data.mode, 'script');
  f.service.respond('POST', { action: 'set_lessons', passcode: 'virtual-teacher-passcode', acceptLessons: [] });
  assert.equal(f.service.respond('POST', turn(session({ count: 1 }))).error.code, 'LESSON_CLOSED');
  f.service.respond('POST', { action: 'set_lessons', passcode: 'virtual-teacher-passcode', acceptLessons: [4] });
  assert.equal(f.service.respond('POST', turn(session({ count: 1 }))).ok, true); assert.equal(f.aiCalls, 0);
});
test('대표 포함 같은 반 4~5명·중복 없는 학번과 실명 없는 모둠명을 검사한다', () => {
  for (const patch of [{ memberStudentIds: members.slice(0, 3) }, { memberStudentIds: [...members, '20305', '20306'] },
    { memberStudentIds: ['20301', '20302', '20303', '20303'] }, { memberStudentIds: ['20302', '20303', '20304', '20305'] },
    { memberStudentIds: ['20301', '20302', '20303', '20404'] }, { memberStudentIds: ['20301', '20302', '20303', 20304] },
    { groupName: '' }, { groupName: '가'.repeat(31) }, { groupName: '이름: 홍길동' }]) {
    const f = fixture(), result = f.service.respond('POST', turn(undefined, patch)); assert.equal(result.ok, false); assert.equal(f.db.progress.length, 0);
  }
  const f = fixture(); assert.equal(f.service.respond('POST', turn(undefined, { memberStudentIds: [...members, '20305'] })).ok, true);
});
test('요청 검사 뒤 교사가 차시를 닫아도 잠금 안에서 다시 확인해 기록하지 않는다', () => {
  for (const request of [turn(), submit(), { ...envelope(session({ count: 0 })), action: 'progress', stage: 'entry' }]) {
    const f = fixture({ beforeLock: db => { db.config[0].value = ''; } });
    assert.equal(f.service.respond('POST', request).error.code, 'LESSON_CLOSED');
    assert.equal(f.db.l4_sessions.length, 0); assert.equal(f.db.progress.length, 0); assert.equal(f.db.ai_log.length, 0);
  }
});
test('4차시 입론·답변·성찰 길이와 개인정보를 저장 전에 검사한다', () => {
  const base = session();
  for (const [patch, expected] of [[{ arg1: '가'.repeat(1501) }, 'INVALID_LENGTH'], [{ arg5: '가'.repeat(1501) }, 'INVALID_LENGTH'],
    [{ arg1: '제 이름은 홍길동이며 이것은 우리 모둠의 입론입니다.' }, 'PII_DETECTED'],
    [{ reflection: '가'.repeat(151) }, 'INVALID_LENGTH'], [{ answers: [{ ...base.answers[0], answer: '가'.repeat(601) }] }, 'INVALID_LENGTH']]) {
    const f = fixture(), result = f.service.respond('POST', submit({ ...base, ...patch }));
    assert.equal(result.error.code, expected); assert.equal(f.db.l4_sessions.length, 0); assert.equal(f.db.ai_log.length, 0);
  }
});
test('3·4·5문항 대담·도움 자료·피드백·서버 재계산 제출이 모두 대본으로 동작한다', () => {
  for (const questionCount of [3, 4, 5]) {
    const f = fixture({ questionCount }); let s = engine.buildSession({ stance: '찬성', arg1, arg5, sessionId: 'lesson4-session-001', questionCount });
    const ids = [];
    for (let n = 1; n <= questionCount; n++) {
      const result = f.service.respond('POST', turn(s)); assert.equal(result.ok, true); assert.equal(result.data.mode, 'script');
      const q = result.data.question; ids.push(q.id); assert.ok(q.helpCards.length >= 2 && q.helpCards.length <= 3);
      assert.doesNotMatch(JSON.stringify(result), /memberStudentIds|groupName|groupKey|20301/);
      s = engine.recordAnswer(s, { turn: n, answer: '자료의 출처와 적용 조건을 확인해야 하기 때문에 우리 모둠은 주장의 범위를 제한하겠습니다.', helpIds: [q.helpCards[0].id] });
    }
    assert.equal(new Set(ids).size, questionCount);
    const feedback = f.service.respond('POST', turn(s, { mode: 'feedback' })); assert.equal(feedback.data.feedback.items.length, questionCount);
    const finished = { ...s, plan: s.plan.slice().reverse(), reflection: '다음에는 근거의 적용 조건을 먼저 확인하겠습니다.', feedback: { items: '클라이언트 위조' }, mode: 'ai' };
    assert.equal(f.service.respond('POST', submit(finished)).ok, true);
    const row = f.db.l4_sessions[0]; assert.equal(row.mode, 'script'); assert.equal(row.completedQuestionCount, questionCount);
    assert.equal(JSON.parse(row.ruleFeedback).items.length, questionCount); assert.doesNotMatch(row.ruleFeedback, /위조/);
    if (questionCount < 5) assert.equal(row[`q${questionCount + 1}`], '');
    assert.equal(f.aiCalls, 0);
  }
});
test('세 답 뒤 조기 종료만 허용하고 실제 답변만 저장한다', () => {
  const f = fixture({ questionCount: 5 });
  assert.equal(f.service.respond('POST', submit(session({ questionCount: 5, count: 2 }))).error.code, 'NOT_ENOUGH_ANSWERS');
  assert.equal(f.db.l4_sessions.length, 0);
  const s = session({ questionCount: 5, count: 3 }); assert.equal(f.service.respond('POST', submit(s)).ok, true);
  const row = f.db.l4_sessions[0]; assert.equal(row.completedQuestionCount, 3); assert.equal(row.earlyFinish, true); assert.equal(row.q4, ''); assert.equal(row.q5, '');
  assert.equal(JSON.parse(row.feedback).questionCount, 5);
});
test('그룹 소유권과 첫 확정 답을 잠그되 같은 명단 내 대표 변경은 복원한다', () => {
  const f = fixture(), s = session({ count: 0 }); assert.equal(f.service.respond('POST', turn(s)).ok, true);
  assert.equal(f.service.respond('POST', turn(s, { studentId: '20302', memberStudentIds: members.slice().reverse() })).ok, true);
  for (const patch of [{ groupName: '다른모둠' }, { memberStudentIds: ['20301', '20302', '20303', '20305'] }]) assert.equal(f.service.respond('POST', turn(s, patch)).error.code, 'SESSION_OWNER_MISMATCH');
  assert.equal(f.service.respond('POST', turn({ ...s, arg1: arg1 + ' 바뀐 문장입니다.' })).error.code, 'SESSION_LOCKED');
  const answered = session({ count: 1 }); assert.equal(f.service.respond('POST', turn(answered)).ok, true);
  const changed = { ...answered, answers: [{ ...answered.answers[0], answer: '이미 확정한 답을 바꾸어 보내려고 합니다.' }] };
  assert.equal(f.service.respond('POST', turn(changed)).error.code, 'ANSWER_LOCKED');
});
test('진행·질문·피드백 재전송이 제출 완료 상태를 되돌리지 않는다', () => {
  const f = fixture(), s = session({ count: 0 });
  assert.equal(f.service.respond('POST', { ...envelope(s), action: 'progress', stage: 'entry' }).data.saved, true);
  assert.equal(f.service.respond('POST', { ...envelope(s), action: 'progress', stage: 'argument' }).data.saved, true);
  assert.equal(f.service.respond('POST', { ...envelope(s), action: 'progress', stage: 'entry' }).data.ignored, true);
  assert.equal(f.service.respond('POST', turn(s)).ok, true);
  assert.equal(f.service.respond('POST', { ...envelope(s), action: 'progress', stage: 'argument' }).data.ignored, true);
  const complete = session(); assert.equal(f.service.respond('POST', submit(complete)).ok, true);
  const progress = JSON.stringify(f.db.progress);
  assert.equal(f.service.respond('POST', turn(complete, { mode: 'feedback' })).error.code, 'SESSION_COMPLETED');
  assert.equal(f.service.respond('POST', { ...envelope(s), action: 'progress', stage: 'entry' }).data.ignored, true);
  assert.equal(JSON.stringify(f.db.progress), progress); assert.equal(f.db.progress.at(-1).stage, 'submitted');
});
test('대표가 바뀌어도 정규화 모둠별 최신 집계이며 공개 응답에 명단·원문이 없다', () => {
  const f = fixture(); assert.equal(f.service.respond('POST', submit(session(), { groupName: 'Ａ   B' })).ok, true);
  const second = session({ sessionId: 'lesson4-session-002', stance: '반대' });
  assert.equal(f.service.respond('POST', submit(second, { groupName: 'a b', studentId: '20302', submissionId: 'lesson4-submit-002' })).ok, true);
  assert.equal(f.db.l4_sessions.length, 2);
  const summary = f.service.respond('GET', { action: 'public_summary', lesson: 4, cls: 3 });
  assert.equal(summary.data.count, 1); assert.equal(summary.data.stanceCounts.반대, 1);
  assert.doesNotMatch(JSON.stringify(summary), /memberStudentIds|groupName|groupKey|studentId|arg1|arg5|reflection|sessionId|2030[1-5]|환자의|모둠/);
  assert.equal(f.service.respond('GET', { action: 'l4_summary', cls: 3 }).error.code, 'UNAUTHORIZED');
  const teacher = f.service.respond('GET', { action: 'l4_summary', cls: 3, passcode: 'virtual-teacher-passcode' }).data;
  assert.equal(teacher.records.length, 1); assert.deepEqual(teacher.records[0].memberStudentIds, members); assert.equal(teacher.records[0].studentId, '20302');
  assert.equal(teacher.progress.length, 1); assert.equal(teacher.answers.length, 4); assert.equal(teacher.total, 1);
  const l2 = f.service.respond('GET', { action: 'l2_summary', cls: 3, passcode: 'virtual-teacher-passcode' }).data;
  assert.equal(l2.count, 0); assert.equal(l2.total, 0);
});
test('캐시 쓰기 실패에도 4차시 로그·제출은 시트로 중복을 막고 내용 충돌을 거부한다', () => {
  const f = fixture({ beforePropertySet: key => { if (/^(log:|submission:)/.test(key)) throw Error('가상 캐시 실패'); } });
  const start = session({ count: 0 }); assert.equal(f.service.respond('POST', turn(start)).ok, true); assert.equal(f.service.respond('POST', turn(start)).ok, true); assert.equal(f.db.ai_log.length, 1);
  const request = submit(); assert.equal(f.service.respond('POST', request).ok, true); const logs = f.db.ai_log.length;
  assert.equal(f.service.respond('POST', request).data.duplicate, true); assert.equal(f.db.l4_sessions.length, 1); assert.equal(f.db.ai_log.length, logs);
  assert.equal(f.service.respond('POST', { ...request, data: { ...request.data, reflection: '성찰을 변경하여 같은 제출 번호를 재사용합니다.' } }).error.code, 'IDEMPOTENCY_CONFLICT');
});
test('4차시 부분 저장 복구는 당시 5문항·3답 종료와 교사 완료 집계를 보존한다', () => {
  let fail = true;
  const f = fixture({ questionCount: 5, beforeAppend: (tab, row) => { if (tab === 'progress' && row.stage === 'submitted' && fail) { fail = false; throw Error('가상 진행 저장 실패'); } } });
  const s = session({ questionCount: 5, count: 3 }), request = submit(s);
  assert.equal(f.service.respond('POST', request).error.code, 'SERVER_ERROR'); assert.equal(f.db.l4_sessions.length, 1);
  f.db.config.find(row => row.key === 'l4Questions').value = '3';
  assert.equal(f.service.respond('POST', request).data.duplicate, true);
  const recovered = savedState(f); assert.equal(recovered.questionCount, 5); assert.equal(recovered.answers.length, 3); assert.equal(recovered.completedQuestionCount, 3);
  assert.equal(f.db.progress.at(-1).stage, 'submitted'); assert.equal(f.db.l4_sessions.length, 1);
  assert.equal(f.service.respond('GET', { action: 'l4_summary', passcode: 'virtual-teacher-passcode' }).data.progress[0].stage, 'submitted');
});
test('최대 입론·다섯 답의 JSON 이스케이프를 복원하고 한도 초과는 제출 행 전에 거부한다', () => {
  const f = fixture({ questionCount: 5 }), maxArg = '\\"'.repeat(750), maxAnswer = '\\"'.repeat(300);
  let s = engine.buildSession({ stance: '찬성', arg1: maxArg, arg5: maxArg, sessionId: 'lesson4-max-text-001', questionCount: 5 });
  for (let n = 1; n <= 5; n++) s = engine.recordAnswer(s, { turn: n, answer: maxAnswer, helpIds: [] });
  s = { ...s, reflection: '다음에는 자료의 출처와 조건을 확인하겠습니다.' };
  assert.equal(f.service.respond('POST', submit(s, { groupName: '=가상모둠' })).ok, true);
  const restored = savedState(f); assert.equal(restored.arg1, maxArg); assert.equal(restored.arg5, maxArg); assert.equal(restored.answers[4].answer, maxAnswer);
  assert.equal(restored.feedback, undefined); assert.equal(restored.questionCache, undefined); assert.equal(restored.completedQuestionCount, 5);
  assert.ok(f.db.l4_sessions[0].groupName.startsWith("'="));
  for (const rows of Object.values(f.db)) for (const row of rows) for (const value of Object.values(row)) if (typeof value === 'string') assert.ok(value.length <= 2000);
  const rejected = fixture({ questionCount: 5 });
  let huge = engine.buildSession({ stance: '찬성', arg1: '\ud800'.repeat(1500), arg5: '\ud800'.repeat(1500), sessionId: 'lesson4-reject-max-001', questionCount: 5 });
  for (let n = 1; n <= 5; n++) huge = engine.recordAnswer(huge, { turn: n, answer: '\ud800'.repeat(600), helpIds: [] });
  huge = { ...huge, reflection: '다음에는 자료의 출처와 조건을 확인하겠습니다.' };
  for (let n = 0; n < 2; n++) assert.equal(rejected.service.respond('POST', submit(huge)).error.code, 'STORAGE_LENGTH');
  assert.equal(rejected.db.l4_sessions.length, 0); assert.equal(rejected.db.ai_log.length, 0); assert.equal(rejected.db.progress.length, 0);
});
test('같은 세션 식별자를 써도 2·4차시의 상태·로그를 혼동하지 않는다', () => {
  const f = fixture(), s = session({ count: 0 }); assert.equal(f.service.respond('POST', turn(s)).ok, true);
  const l2 = createEngine(content).buildSession({ stance: '찬성', reasonId: 'RP2', cardId: 'PB', sessionId: s.sessionId });
  assert.equal(f.service.respond('POST', { action: 'turn', mode: 'question', lesson: 2, studentId: '20301', cls: 3, sessionId: s.sessionId, selection: l2, history: [], turn: 1, forceMode: 'script' }).ok, true);
  assert.equal(f.db.ai_log.length, 2); assert.deepEqual(f.db.ai_log.map(row => row.lesson).sort(), [2, 4]);
  assert.equal(f.service.respond('POST', turn(s)).ok, true);
});
