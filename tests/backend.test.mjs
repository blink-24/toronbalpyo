import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import content from '../src/core/content.js';
import { createEngine } from '../src/core/engine.js';
import { createService, HEADERS } from '../backend/service.js';
const engine = createEngine(content);
function fixture({ ai = false, providerCall = null, questionCount = 3, beforeAppend = null, beforePropertySet = null } = {}) {
  const db = Object.fromEntries(Object.keys(HEADERS).map(k => [k, []]));
  db.config.push({ key: 'l2Questions', value: String(questionCount) }, { key: 'acceptLessons', value: '2' });
  const props = new Map([['PASSCODE', 'test-teacher-passcode'], ['AI_PROVIDER', ai ? 'gemini' : 'none'], ['AI_MODEL', ai ? 'test-model' : ''], ['AI_API_KEY', ai ? 'not-a-real-key' : '']]);
  let held = false, lockCount = 0;
  const store = { read: tab => db[tab], append: (tab, row) => { assert.ok(held); if (beforeAppend) beforeAppend(tab, row); db[tab].push({ ...row }); },
    withLock: fn => { assert.equal(held, false, '잠금을 중첩하지 않는다'); held = true; lockCount++; try { return fn(); } finally { held = false; } } };
  const service = createService({ content, store, properties: { get: key => props.get(key), set: (key, val) => {
    if (beforePropertySet) beforePropertySet(key, val); props.set(key, val);
  } },
    hash: text => createHash('sha256').update(text).digest('hex'), clock: () => 1800000000000,
    providerCall: providerCall ? (...args) => { assert.equal(held, false, 'AI 호출 중에는 잠금을 유지하지 않는다'); return providerCall(...args); } : null });
  return { service, db, props, get locks() { return lockCount; } };
}
function session(overrides = {}, answers = 3) {
  let s = engine.buildSession({ stance: '찬성', reasonId: 'RP2', cardId: 'PB', sessionId: 'backend-session-001', ...overrides });
  for (let n = 1; n <= answers; n++) s = engine.recordAnswer(s, { turn: n, answer: '맞습니다. 다만 한빛시 교통안전연구원(가상) 2025년 분석과 비교해 설명해야 하기 때문에 주장의 범위를 줄이고 근거를 보완하겠습니다.', helpIds: [] });
  return { ...s, reflection: '다음에는 출처와 조사 방법을 먼저 확인하겠습니다.', earlyFinish: answers === 2 && s.questionCount === 3, mode: 'script-local' };
}
function submission(data = session(), extra = {}) {
  return { action: 'submit', kind: 'l2_session', lesson: 2, submissionId: 'submission-test-001', studentId: '20315', cls: 3, sessionId: data.sessionId, appVersion: content.version, clientTs: '2026-10-26T00:00:00Z', data, ...extra };
}
function turnRequest(input = session({}, 0), extra = {}) {
  return { action: 'turn', mode: 'question', lesson: 2, studentId: '20315', cls: 3, sessionId: input.sessionId, turn: 1,
    selection: { stance: input.stance, reasonId: input.reasonId, reasonText: input.reasonText, cardId: input.cardId, argText: input.argText }, history: [], ...extra };
}
test('동일 제출 재전송은 한 행이고 내용변경 재사용을 거부한다; 복구도 시트로 중복검사', () => {
  const { service, db, props } = fixture(), request = submission();
  assert.equal(service.respond('POST', request).ok, true);
  assert.equal(service.respond('POST', request).data.duplicate, true); assert.equal(db.l2_sessions.length, 1);
  props.delete('submission:submission-test-001');
  assert.equal(service.respond('POST', request).data.duplicate, true); assert.equal(db.l2_sessions.length, 1);
  assert.equal(service.respond('POST', { ...request, data: { ...request.data, reflection: '전송 내용을 변경하여 다시 제출하려 합니다.' } }).error.code, 'IDEMPOTENCY_CONFLICT');
});
test('학번·반·kind/차시·허용값·최대길이·PII·위조계획을 서버가 다시 검사한다', () => {
  for (const [patch, code] of [[{ studentId: '20300' }, 'INVALID_STUDENT_ID'], [{ cls: 4 }, 'INVALID_CLASS'], [{ lesson: 3 }, 'LESSON_NOT_IMPLEMENTED'], [{ kind: 'l3_arg' }, 'KIND_LESSON_MISMATCH']]) {
    const f = fixture(); assert.equal(f.service.respond('POST', submission(undefined, patch)).error.code, code);
  }
  for (const [patch, code] of [[{ cardId: 'NA' }, 'INVALID_CARD'], [{ stance: '중립' }, 'INVALID_STANCE'], [{ argText: '제 이름은 홍길동입니다.' }, 'PII_DETECTED'], [{ argText: '가'.repeat(2001) }, 'INVALID_LENGTH']]) {
    const f = fixture(), data = session(); assert.equal(f.service.respond('POST', submission({ ...data, ...patch })).error.code, code);
  }
  const f = fixture(), data = session(); data.plan.reverse(); data.feedback = { summary: '위조된 피드백' };
  assert.equal(f.service.respond('POST', submission(data)).ok, true);
  assert.equal(f.db.l2_sessions[0].q1Id, 'Q-REL-PB'); assert.doesNotMatch(f.db.l2_sessions[0].feedback, /위조/);
});
test('공개 집계는 30명에도 식별자·입론·답변·성찰·교사암호를 절대 내보내지 않는다', () => {
  const f = fixture();
  for (let n = 1; n <= 30; n++) assert.equal(f.service.respond('POST', submission(session({ sessionId: `session-student-${n}` }), { studentId: `203${String(n).padStart(2, '0')}`, submissionId: `submission-student-${n}` })).ok, true);
  const publicData = f.service.respond('GET', { action: 'public_summary', cls: '3', tab: 'l2_sessions', passcode: 'test-teacher-passcode' });
  assert.equal(publicData.data.count, 30); assert.equal(publicData.data.stanceCounts.찬성, 30); assert.equal(publicData.data.lowReliability.count, 30);
  assert.doesNotMatch(JSON.stringify(publicData), /studentId|argText|a1Text|reflection|test-teacher-passcode|20315|홍길동/);
  assert.equal(f.service.respond('GET', { action: 'l2_summary', cls: 3 }).error.code, 'UNAUTHORIZED');
  const teacher = f.service.respond('GET', { action: 'l2_summary', cls: 3, passcode: 'test-teacher-passcode' });
  assert.equal(teacher.data.records.length, 30); assert.equal(teacher.data.answers.length, 90);
  f.db.config.push({ key: 'publicSharing', value: 'false' }); assert.equal(f.service.respond('GET', { action: 'public_summary' }).error.code, 'SHARING_DISABLED');
});
test('교사전용 모든 조회는 서버 인증; config는비밀을허용목록으로차단', () => {
  const f = fixture();
  for (const action of ['l2_summary', 'list', 'status', 'not-real']) assert.equal(f.service.respond('GET', { action, tab: 'ai_log', passcode: 'wrong' }).error.code, 'UNAUTHORIZED');
  f.db.config.push({ key: 'PASSCODE', value: 'should-not-leak' }, { key: 'AI_API_KEY', value: 'never-in-public-config' });
  assert.doesNotMatch(JSON.stringify(f.service.respond('GET', { action: 'config' })), /should-not-leak|never-in-public-config|PASSCODE|AI_API_KEY/);
  assert.equal(f.service.respond('GET', { action: 'list', tab: 'config', passcode: 'test-teacher-passcode' }).error.code, 'INVALID_TAB');
});
test('수식주입 방지와 칸당2000자 제한을 모든 저장 열에 적용하고 상태도 복원한다', () => {
  const f = fixture(), data = session(); data.argText = '=HYPERLINK("https://example.com")';
  // 진행 중 상태를 시트 조각으로 저장한 뒤 최종 제출에서 원래 입론·답변을 복원합니다.
  assert.equal(f.service.respond('POST', turnRequest(data)).ok, true);
  const result = f.service.respond('POST', submission(data, { clientTs: '  =NOW()' })); assert.equal(result.ok, true);
  assert.ok(f.db.l2_sessions[0].argText.startsWith("'=")); assert.ok(f.db.l2_sessions[0].clientTs.startsWith("'"));
  for (const rows of Object.values(f.db)) for (const row of rows) for (const value of Object.values(row)) if (typeof value === 'string') { assert.ok(value.length <= 2000); assert.doesNotMatch(value, /^[\s\x00-\x20]*[=+\-@]/); }
  assert.equal(f.db.progress.at(-1).stage, 'submitted'); assert.equal(f.db.l2_sessions[0].completedQuestionCount, 3);
});
test('수식 방지 접두사를 더한 실제 저장 문자열에도 2000자 경계를 적용한다', () => {
  for (const clientTs of ['x'.repeat(2000), '=' + 'x'.repeat(1998)]) {
    const f = fixture(), result = f.service.respond('POST', submission(session(), { clientTs }));
    assert.equal(result.ok, true); assert.equal(f.db.l2_sessions[0].clientTs.length, 2000);
    assert.doesNotMatch(f.db.l2_sessions[0].clientTs, /^[\s\x00-\x20]*[=+\-@]/);
  }
  const f = fixture(), result = f.service.respond('POST', submission(session(), { clientTs: '=' + 'x'.repeat(1999) }));
  assert.equal(result.error.code, 'STORAGE_LENGTH'); assert.equal(f.db.l2_sessions.length, 0);
});
test('로그·제출 캐시 쓰기가 실패해도 대본 체험과 제출·시트 기반 중복 검사가 계속된다', () => {
  const failedKeys = [], f = fixture({ beforePropertySet: key => {
    if (/^(log:|submission:)/.test(key)) { failedKeys.push(key); throw Error('가상 캐시 쓰기 실패'); }
  } });
  const initial = session({}, 0), first = turnRequest(initial);
  assert.equal(f.service.respond('POST', first).data.mode, 'script');
  assert.equal(f.service.respond('POST', first).ok, true); assert.equal(f.db.ai_log.length, 1);
  const second = turnRequest(initial, { turn: 2, history: session({}, 1).answers });
  assert.equal(f.service.respond('POST', second).ok, true);
  const request = submission(), result = f.service.respond('POST', request);
  assert.equal(result.ok, true); assert.equal(result.data.accepted, true); assert.equal(f.db.progress.at(-1).stage, 'submitted');
  const logs = f.db.ai_log.length;
  assert.equal(new Set(f.db.ai_log.map(row => `${row.sessionId}:${row.turn}:${row.role}`)).size, logs);
  assert.equal(f.service.respond('POST', request).data.duplicate, true);
  assert.equal(f.db.l2_sessions.length, 1); assert.equal(f.db.ai_log.length, logs);
  assert.ok(failedKeys.some(key => key.startsWith('log:'))); assert.ok(failedKeys.some(key => key.startsWith('submission:')));
  assert.equal(f.props.has(`submission:${request.submissionId}`), false);
});
test('AI 한도 기록 실패는 대본으로 전환하며 학생별 사용량 한도를 우회하지 않는다', () => {
  let failRateWrite = true, calls = 0;
  const f = fixture({ ai: true, beforePropertySet: key => { if (key.startsWith('rate:') && failRateWrite) throw Error('가상 사용량 기록 실패'); },
    providerCall: (_task, payload) => { calls++; return { confirm: '그 자료를 근거로 드셨지요?', verify: '다른 자료로도 확인되었습니까?', criterion: payload.plan.criterion }; } });
  f.props.set('AI_RATE_PER_HOUR', '1');
  assert.equal(f.service.respond('POST', turnRequest()).data.mode, 'script');
  const s = session({}, 2);
  assert.equal(f.service.respond('POST', turnRequest(s, { mode: 'feedback', history: s.answers })).data.mode, 'script');
  assert.equal(f.service.respond('POST', submission(s)).ok, true); assert.equal(calls, 0);
  failRateWrite = false;
  const another = session({ sessionId: 'rate-failure-student-02' }, 0);
  assert.equal(f.service.respond('POST', turnRequest(another, { studentId: '20316' })).data.mode, 'ai'); assert.equal(calls, 1);
  const next = session({ sessionId: 'rate-failure-student-03' }, 0);
  assert.equal(f.service.respond('POST', turnRequest(next, { studentId: '20316' })).data.mode, 'script'); assert.equal(calls, 1);
  // 앞 학생의 실패는 다른 학생의 한도를 소모하지 않으며, 복구 뒤에는 각자 한도가 적용됩니다.
  const original = session({ sessionId: 'rate-failure-student-01' }, 0);
  assert.equal(f.service.respond('POST', turnRequest(original)).data.mode, 'ai'); assert.equal(calls, 2);
  assert.equal([...f.props].filter(([key]) => key.startsWith('rate:')).length, 2);
});
test('2답 조기 제출과 설정2질문은 세번째 빈문항을 저장하지 않는다', () => {
  for (const questionCount of [2, 3]) {
    const f = fixture({ questionCount }), s = session({ questionCount }, 2);
    const response = f.service.respond('POST', submission(s)); assert.equal(response.ok, true);
    assert.equal(f.db.l2_sessions[0].q3Id, ''); assert.equal(f.db.l2_sessions[0].completedQuestionCount, 2);
    assert.equal(JSON.parse(f.db.l2_sessions[0].ruleFeedback).items.length, 2);
  }
});
test('서버는 세션 소유자와 잠긴 첫 답을 지키고 주제밖 답에는 한번만 재요청한다', () => {
  const f = fixture(), first = turnRequest(); assert.equal(f.service.respond('POST', first).ok, true);
  assert.equal(f.service.respond('POST', { ...first, studentId: '20316' }).error.code, 'SESSION_OWNER_MISMATCH');
  const unrelated = [{ answer: '오늘 날씨는 어떻습니까?', helpIds: [] }];
  assert.equal(f.service.respond('POST', { ...first, turn: 2, history: unrelated }).data.retry, true);
  const second = f.service.respond('POST', { ...first, turn: 2, history: unrelated }); assert.equal(second.ok, true); assert.equal(second.data.turn, 2);
  assert.equal(f.service.respond('POST', { ...first, turn: 2, history: [{ answer: '이미 보낸 답을 바꿔 보내려고 합니다.', helpIds: [] }] }).error.code, 'ANSWER_LOCKED');
});
test('AI에는 식별자가 없고 잠금밖에서 호출하며 질문을 캐시한다; 실패·개방형·PII는 대본으로 복구', () => {
  let calls = 0, sent;
  const f = fixture({ ai: true, providerCall: (_task, payload) => { calls++; sent = payload; return { confirm: '그 자료를 근거로 드셨지요?', verify: '다른 자료로도 확인되었습니까?', criterion: payload.plan.criterion }; } });
  const req = turnRequest(), one = f.service.respond('POST', req); assert.equal(one.data.mode, 'ai');
  assert.doesNotMatch(JSON.stringify(sent), /studentId|sessionId|20315|cls|groupNo|passcode/);
  assert.equal(f.service.respond('POST', req).data.mode, 'ai'); assert.equal(calls, 1);
  for (const output of [null, { confirm: '확인하셨지요?', verify: '어떻게 생각하십니까?', criterion: '신뢰성' }, { confirm: '20315 학생이 맞습니까?', verify: '확인하셨습니까?', criterion: '신뢰성' }]) {
    const g = fixture({ ai: true, providerCall: () => { if (!output) throw Error('network'); return output; } });
    assert.equal(g.service.respond('POST', turnRequest()).data.mode, 'script');
  }
});
test('AI 시간당 호출 한도는 학생별이며 초과하면 대본을 이어간다', () => {
  const f = fixture({ ai: true, providerCall: (_task, payload) => ({ confirm: '그 자료를 근거로 드셨지요?', verify: '다른 자료로도 확인되었습니까?', criterion: payload.plan.criterion }) });
  f.props.set('AI_RATE_PER_HOUR', '1');
  assert.equal(f.service.respond('POST', turnRequest()).data.mode, 'ai');
  const another = session({ sessionId: 'another-session-01' }, 0);
  assert.equal(f.service.respond('POST', turnRequest(another)).data.mode, 'script');
});
test('늦게 온 AI 질문은 이미 로컬 대본으로 제출한 상태·질문 기록을 되돌리지 않는다', () => {
  let f;
  f = fixture({ ai: true, providerCall: (_task, payload) => {
    // AI 응답을 기다리다 브라우저가 로컬 대본으로 2답을 제출한 동시 상황을 모사한다.
    assert.equal(f.service.respond('POST', submission(session({}, 2))).ok, true);
    return { confirm: '다른 표현으로 다시 물으셨지요?', verify: '자료를 다시 확인하셨습니까?', criterion: payload.plan.criterion };
  } });
  const returned = f.service.respond('POST', turnRequest());
  assert.equal(returned.ok, true); assert.equal(returned.data.mode, 'script');
  assert.equal(f.db.progress.at(-1).stage, 'submitted');
  assert.equal(f.db.l2_sessions.length, 1);
  assert.doesNotMatch(f.db.l2_sessions[0].q1Text, /다른 표현/);
});
test('제출을 마친 세션의 피드백 재요청과 세번째 질문은 완료 상태를 바꾸지 않는다', () => {
  const f = fixture(), s = session({}, 2);
  assert.equal(f.service.respond('POST', submission(s)).ok, true);
  const progress = JSON.stringify(f.db.progress), records = JSON.stringify(f.db.l2_sessions);
  for (const extra of [{ mode: 'feedback', history: s.answers }, { turn: 3, history: s.answers }]) {
    const result = f.service.respond('POST', turnRequest(s, extra));
    assert.equal(result.error.code, 'SESSION_COMPLETED');
    assert.equal(JSON.stringify(f.db.progress), progress); assert.equal(JSON.stringify(f.db.l2_sessions), records);
  }
  assert.equal(f.db.progress.at(-1).stage, 'submitted');
});
test('늦게 온 AI 피드백은 먼저 완료된 제출의 단계·판정을 덮어쓰지 않는다', () => {
  let f, completedProgress, completedRecords;
  const s = session({}, 2);
  f = fixture({ ai: true, providerCall: (task, payload) => {
    assert.equal(task, 'feedback'); assert.equal(f.service.respond('POST', submission(s)).ok, true);
    completedProgress = JSON.stringify(f.db.progress); completedRecords = JSON.stringify(f.db.l2_sessions);
    return { items: payload.plan.map((x, i) => ({ turn: i + 1, criterion: x.criterion, reliability: '○', validity: '○', attitude: '보통',
      comment: '뒤늦게 생성된 AI 코멘트입니다.', better: '뒤늦게 생성된 보완 방향입니다.' })), summary: { good: '질문에 답했습니다.', improve: '근거를 살펴보세요.' } };
  } });
  const result = f.service.respond('POST', turnRequest(s, { mode: 'feedback', history: s.answers, earlyFinish: true }));
  assert.equal(result.ok, true); assert.equal(result.data.mode, 'script');
  assert.equal(result.data.feedback.items[0].reliability, result.data.ruleFeedback.items[0].reliability);
  assert.equal(JSON.stringify(f.db.progress), completedProgress); assert.equal(JSON.stringify(f.db.l2_sessions), completedRecords);
  assert.equal(f.db.progress.at(-1).stage, 'submitted'); assert.equal(f.db.l2_sessions[0].aiFeedback, '');
});
test('제출 행 뒤 진행 기록 저장이 실패해도 중복 재전송으로 원래 완료 상태를 복구한다', () => {
  for (const questionCount of [2, 3]) {
    let failSubmitted = true;
    const f = fixture({ questionCount, beforeAppend: (tab, row) => {
      if (tab === 'progress' && row.stage === 'submitted' && failSubmitted) { failSubmitted = false; throw Error('가상 진행 기록 저장 실패'); }
    } });
    const s = session({ questionCount }, 2), request = submission(s);
    assert.equal(f.service.respond('POST', request).error.code, 'SERVER_ERROR');
    assert.equal(f.db.l2_sessions.length, 1); assert.equal(f.db.progress.length, 0);
    // 부분 저장 후 도착한 질문과 관리자의 문항 수 변경도 저장된 제출을 바꾸지 않습니다.
    if (questionCount === 3) assert.equal(f.service.respond('POST', turnRequest(s, { turn: 3, history: s.answers })).ok, true);
    f.db.config.find(x => x.key === 'l2Questions').value = String(questionCount === 2 ? 3 : 2);
    const recovered = f.service.respond('POST', request);
    assert.equal(recovered.ok, true); assert.equal(recovered.data.duplicate, true); assert.equal(recovered.data.completedQuestionCount, 2);
    assert.equal(f.db.l2_sessions.length, 1); assert.equal(f.db.progress.at(-1).stage, 'submitted');
    const row = f.db.progress.at(-1);
    const state = JSON.parse([1, 2, 3, 4, 5, 6, 7, 8].map(n => String(row[`state${n}`] || '').slice(1)).join(''));
    assert.equal(state.questionCount, questionCount); assert.equal(state.completedQuestionCount, 2); assert.equal(state.answers.length, 2);
    assert.equal(state.reflection, s.reflection);
    const count = f.db.progress.length;
    assert.equal(f.service.respond('POST', request).data.duplicate, true); assert.equal(f.db.progress.length, count);
    const teacher = f.service.respond('GET', { action: 'l2_summary', passcode: 'test-teacher-passcode' });
    assert.equal(teacher.data.progress[0].stage, 'submitted'); assert.equal(teacher.data.completed, 1);
  }
});
test('AI 피드백과 규칙 판정은 서로 분리해 저장하고 클라이언트 판정은 믿지 않는다', () => {
  const s = session({}, 2);
  const f = fixture({ ai: true, providerCall: (task, payload) => {
    assert.equal(task, 'feedback');
    return { items: payload.plan.map((x, i) => ({ turn: i + 1, criterion: x.criterion, reliability: '○', validity: '○', attitude: '보통', comment: '자료를 더 구체적으로 밝혀 보세요.', better: '출처와 주장을 연결하여 설명해 보세요.' })), summary: { good: '질문에 답했습니다.', improve: '근거를 살펴보세요.' } };
  } });
  const result = f.service.respond('POST', turnRequest(s, { mode: 'feedback', history: s.answers, earlyFinish: true }));
  assert.equal(result.data.mode, 'ai'); assert.equal(result.data.feedback.items[0].reliability, '○'); assert.equal(result.data.ruleFeedback.items[0].reliability, '●');
  assert.equal(f.service.respond('POST', submission({ ...s, feedback: '위조결과' })).ok, true);
  const row = f.db.l2_sessions[0]; assert.equal(JSON.parse(row.aiFeedback).items[0].reliability, '○'); assert.equal(JSON.parse(row.ruleFeedback).items[0].reliability, '●');
});
test('전송 대기 초기 진행 정보가 늦게 도착해도 제출 단계를 되돌리지 않는다', () => {
  const f = fixture(), request = submission(); assert.equal(f.service.respond('POST', request).ok, true);
  const count = f.db.progress.length;
  const late = f.service.respond('POST', { action: 'progress', lesson: 2, studentId: '20315', cls: 3, sessionId: request.sessionId, stage: 'argument' });
  assert.equal(late.data.ignored, true); assert.equal(f.db.progress.length, count); assert.equal(f.db.progress.at(-1).stage, 'submitted');
});
test('9개 탭과 append-only 머리글, GAS doPost text/plain JSON 포장', async () => {
  assert.equal(Object.keys(HEADERS).length, 9);
  const sandbox = { PropertiesService: {}, SpreadsheetApp: {}, LockService: {}, ContentService: { MimeType: { JSON: 'application/json' }, createTextOutput: text => ({ text, setMimeType(type) { this.mime = type; return this; } }) } };
  vm.createContext(sandbox); vm.runInContext(await fs.readFile(new URL('../backend/ServerBundle.gs', import.meta.url), 'utf8'), sandbox);
  let actual = ['legacy', 'receivedAt'], writes = [];
  const sheet = { getLastColumn: () => actual.length, getName: () => 'test', getRange: (r, c, nr, nc) => ({ getValues: () => [actual], setValues: rows => { writes.push({ c, rows }); actual = actual.concat(rows[0]); } }), setFrozenRows() {} };
  sandbox.classroomHeaders_(sheet, ['receivedAt', 'submissionId']);
  assert.equal(writes[0].c, 3); assert.deepEqual(actual, ['legacy', 'receivedAt', 'submissionId']);
  sandbox.classroomService_ = () => fixture().service;
  const result = sandbox.doPost({ postData: { type: 'text/plain;charset=utf-8', contents: JSON.stringify(submission()) } });
  assert.equal(JSON.parse(result.text).ok, true); assert.equal(result.mime, 'application/json');
  assert.equal(JSON.parse(sandbox.doPost({ postData: { contents: 'bad-json' } }).text).error.code, 'INVALID_JSON');
});
