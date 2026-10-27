import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { CONTENT } from '../../src/core/content.js';
import { createEngine } from '../../src/core/engine.js';
import { createService } from '../../backend/service.js';
import { createApiClient } from '../../src/network/client.js';
import { createSubmissionQueue } from '../../src/network/queue.js';

function fixture() {
  const sheets = new Map(); const props = new Map([['PASSCODE', 'fixture-teacher-only'], ['AI_PROVIDER', 'none']]);
  const store = { read: tab => sheets.get(tab) || [], append(tab, value) { sheets.set(tab, [...(sheets.get(tab) || []), value]); }, withLock: fn => fn() };
  const properties = { get: key => props.get(key) || '', set: (key, value) => props.set(key, String(value)) };
  const service = createService({ content: CONTENT, store, properties, hash: text => createHash('sha256').update(text).digest('hex') });
  const fetchImpl = async (raw, options = {}) => {
    const request = options.method === 'POST' ? JSON.parse(options.body) : Object.fromEntries(new URL(raw).searchParams);
    return { ok: true, json: async () => service.respond(options.method || 'GET', request) };
  };
  const api = createApiClient({ endpoint: 'https://fixture.invalid/exec', fetchImpl });
  return { api, sheets };
}

test('the frontend protocol completes a scripted dialogue, persists once, and shares aggregates without student text', async () => {
  const { api, sheets } = fixture(); const engine = createEngine(CONTENT);
  const studentId = '20315'; const sessionId = 's_ui_flow_000001'; const selection = { stance: '찬성', reasonId: 'RP2', reasonText: CONTENT.reasons.find(x => x.id === 'RP2').text, cardId: 'PB' };
  let local = engine.buildSession({ ...selection, sessionId, seed: sessionId }); selection.argText = local.argText;
  const history = [];
  await api.post('progress', { lesson: 2, studentId, cls: 3, sessionId, stage: 'entry' });
  for (let turn = 1; turn <= 3; turn++) {
    const { data } = await api.post('turn', { lesson: 2, studentId, cls: 3, sessionId, mode: 'question', turn, selection, history });
    const localQuestion = engine.getQuestion(local, turn);
    assert.equal(data.question.id, localQuestion.id); assert.deepEqual(data.question.helpCards.map(c => c.id), localQuestion.helpCards.map(c => c.id));
    const help = data.question.helpCards[0];
    const answer = `맞습니다. 그 부분은 인정합니다. 다만 [자료 ${help.id}] ${help.source}의 가상 자료를 참고해 이유와 주장을 함께 살펴야 하기 때문에 제 입론을 보완하겠습니다.`;
    local = engine.recordAnswer(local, { turn, answer, helpIds: [help.id] }); history.push({ questionId: data.question.id, answer, helpIds: [help.id] });
  }
  const feedback = await api.post('turn', { lesson: 2, studentId, cls: 3, sessionId, mode: 'feedback', turn: 3, selection, history });
  assert.equal(feedback.data.feedback.items.length, 3);
  const finished = engine.finishSession(local, { reflection: '다음 입론에서는 출처와 자료의 시기를 함께 살피겠습니다.' });
  const payload = { lesson: 2, kind: 'l2_session', studentId, cls: 3, sessionId, submissionId: 'sub_ui_flow_00001', appVersion: '5.0.0', data: { ...finished, mode: 'script', durationSec: 300 } };
  const data = new Map(); const storage = { getItem: k => data.get(k) || null, setItem: (k, v) => data.set(k, v) };
  const queue = createSubmissionQueue({ api, storage }); queue.enqueue(payload); await queue.flush({ force: true });
  assert.equal(queue.getItems().length, 0); assert.equal(sheets.get('l2_sessions').length, 1);
  await api.post('submit', payload); assert.equal(sheets.get('l2_sessions').length, 1);
  const publicResult = await api.get('public_summary', { cls: 3 }); const serialized = JSON.stringify(publicResult.data);
  assert.equal(publicResult.data.completed, 1); assert.equal(serialized.includes(studentId), false); assert.equal(serialized.includes(finished.reflection), false); assert.equal(serialized.includes(history[0].answer), false);
  await assert.rejects(api.get('list', { tab: 'l2_sessions', cls: 3, passcode: 'wrong' }), error => error.code === 'UNAUTHORIZED');
  const teacher = await api.get('list', { tab: 'l2_sessions', cls: 3, passcode: 'fixture-teacher-only', latest: 1 });
  assert.equal(teacher.data.rows[0].a1Text, history[0].answer);
  assert.equal(JSON.stringify([...sheets.values()]).includes('fixture-teacher-only'), false);
});

test('an unrelated answer returns to the same turn once and does not lock the rejected answer', async () => {
  const { api } = fixture(); const engine = createEngine(CONTENT); const sessionId = 's_ui_retry_00001';
  const selection = { stance: '반대', reasonId: 'RN1', reasonText: CONTENT.reasons.find(x => x.id === 'RN1').text, cardId: 'NB' };
  const local = engine.buildSession({ ...selection, sessionId, seed: sessionId }); selection.argText = local.argText;
  const first = await api.post('turn', { lesson: 2, studentId: '20315', cls: 3, sessionId, selection, mode: 'question', turn: 1, history: [] });
  const badHistory = [{ questionId: first.data.question.id, answer: '점심 메뉴가 뭐야', helpIds: [] }];
  const retried = await api.post('turn', { lesson: 2, studentId: '20315', cls: 3, sessionId, selection, mode: 'question', turn: 2, history: badHistory });
  assert.equal(retried.data.retry, true); assert.equal(retried.data.turn, 1);
  const corrected = [{ questionId: first.data.question.id, answer: '맞습니다. 출처가 밝혀지지 않았다는 한계를 인정하고 다른 자료를 살피겠습니다.', helpIds: [] }];
  const next = await api.post('turn', { lesson: 2, studentId: '20315', cls: 3, sessionId, selection, mode: 'question', turn: 2, history: corrected });
  assert.equal(next.data.turn, 2); assert.ok(next.data.question);
});
