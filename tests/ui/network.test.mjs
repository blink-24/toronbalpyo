import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiClient, ApiError, mayUseLocalFallback } from '../../src/network/client.js';
import { createSubmissionQueue } from '../../src/network/queue.js';
import { validateStudentId, maskStudentId, containsPrivateData, publicCard, initialState, loadState, saveState, composeArgument } from '../../src/ui/state.js';
import { CONTENT } from '../../src/core/content.js';
import { createEngine } from '../../src/core/engine.js';
const memoryStorage = () => { const data = new Map(); return { getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, String(value)) }; };

test('POST uses the agreed plain-text JSON envelope and accepts an explicit server acknowledgement', async () => {
  let captured;
  const api = createApiClient({ endpoint: 'https://example.invalid/exec', fetchImpl: async (url, options) => { captured = { url, options }; return { ok: true, json: async () => ({ ok: true, data: { accepted: true } }) }; } });
  const result = await api.post('submit', { kind: 'l2_session', submissionId: 'sub_12345678' });
  assert.equal(captured.options.headers['Content-Type'], 'text/plain;charset=utf-8');
  assert.equal(JSON.parse(captured.options.body).action, 'submit');
  assert.equal(captured.options.credentials, 'omit'); assert.equal(result.data.accepted, true);
});
test('an empty or negative response never becomes submission success', async () => {
  for (const response of [{}, { ok: false, error: { code: 'PII', message: '개인정보를 지워 주세요.' } }]) {
    const api = createApiClient({ endpoint: 'https://example.invalid/exec', fetchImpl: async () => ({ ok: true, json: async () => response }) });
    await assert.rejects(api.post('submit', {}), ApiError);
  }
  assert.equal(mayUseLocalFallback({ code: 'PII' }), false);
  assert.equal(mayUseLocalFallback({ code: 'AUTH_FAILED' }), false);
});
test('the response deadline returns TIMEOUT even when the transport does not settle', async () => {
  const api = createApiClient({ endpoint: 'https://example.invalid/exec', timeoutMs: 10, fetchImpl: () => new Promise(() => {}) });
  await assert.rejects(api.get('ping'), error => error.code === 'TIMEOUT');
});
test('an unconfigured or offline queue retains the original submission instead of inventing an acknowledgement', async () => {
  const storage = memoryStorage(); let calls = 0;
  const api = { isConfigured: () => false, post: async () => { calls++; return { ok: true }; } };
  const queue = createSubmissionQueue({ storage, api }); queue.enqueue({ submissionId: 'sub_offline001', studentId: '20315' });
  await queue.flush({ force: true }); assert.equal(calls, 0); assert.equal(queue.getItems().length, 1);
  const restored = createSubmissionQueue({ storage, api: { ...api, isConfigured: () => true }, online: () => false });
  await restored.flush({ force: true }); assert.equal(calls, 0); assert.equal(restored.getItems()[0].payload.submissionId, 'sub_offline001');
});
test('a lost acknowledgement is recovered after reload using the same ID and one server row', async () => {
  const storage = memoryStorage(); const serverIds = new Set(); const attempts = [];
  const api = { isConfigured: () => true, post: async (action, payload) => {
    attempts.push(payload.submissionId); const duplicate = serverIds.has(payload.submissionId); serverIds.add(payload.submissionId);
    if (!duplicate) throw new ApiError('acknowledgement lost', 'TIMEOUT');
    return { ok: true, data: { accepted: true, duplicate: true } };
  } };
  const first = createSubmissionQueue({ storage, api }); first.enqueue({ submissionId: 'sub_replay001', data: { reflection: '출처와 시기를 함께 살피겠습니다.' } });
  await first.flush({ force: true }); assert.equal(first.getItems().length, 1);
  const restored = createSubmissionQueue({ storage, api }); await restored.flush({ force: true });
  assert.deepEqual(attempts, ['sub_replay001', 'sub_replay001']); assert.equal(serverIds.size, 1); assert.equal(restored.getItems().length, 0);
});
test('validation failures remain visible in the queue without a repeated automatic request', async () => {
  const storage = memoryStorage(); let calls = 0;
  const api = { isConfigured: () => true, post: async () => { calls++; throw new ApiError('입력을 확인해 주세요.', 'INVALID_LENGTH'); } };
  const queue = createSubmissionQueue({ storage, api }); queue.enqueue({ submissionId: 'sub_invalid01' });
  await queue.flush({ force: true }); await queue.flush({ force: true });
  assert.equal(calls, 1); assert.equal(queue.getItems()[0].blocked, true);
});
test('public cards expose source, date and method without weakness or reliability answer tags', () => {
  for (const card of [...CONTENT.evidenceCards, ...CONTENT.helpCards]) {
    const visible = publicCard(card);
    assert.equal(visible.virtual, true); assert.ok(visible.source); assert.ok(visible.year); assert.ok(visible.method);
    assert.equal('weakness' in visible, false); assert.equal('reliability' in visible, false); assert.equal('criterion' in visible, false);
  }
});
test('student identity is validated and masked; free-text personal details are rejected', () => {
  assert.equal(validateStudentId('20315'), true); assert.equal(validateStudentId('21129'), true);
  for (const id of ['2031', '203150', '20015', '21215', '10315', '20300']) assert.equal(validateStudentId(id), false);
  assert.equal(maskStudentId('20315'), '203**');
  for (const text of ['제 이름은 홍길동', '20315입니다', '010-1234-5678', 'test@example.com']) assert.equal(containsPrivateData(text), true);
  assert.equal(containsPrivateData('2025년 가상 자료를 참고하겠습니다.'), false);
});
test('a saved dialogue resumes with committed answers and an unfinished draft', () => {
  const storage = memoryStorage(); const state = initialState(); state.studentId = '20315'; state.activity.step = 'dialogue'; state.activity.turn = 2;
  state.activity.committedAnswers = [{ turn: 1, answer: '이미 확정한 첫 답변입니다.' }]; state.activity.answerDrafts[2] = '두 번째 답을 쓰던 중';
  saveState(storage, state); const restored = loadState(storage);
  assert.equal(restored.activity.turn, 2); assert.equal(restored.activity.committedAnswers[0].answer, '이미 확정한 첫 답변입니다.'); assert.equal(restored.activity.answerDrafts[2], '두 번째 답을 쓰던 중');
});
test('every stance/reason/card UI combination produces an editable argument within 300 characters and the same engine help cards', () => {
  const engine = createEngine(CONTENT); let count = 0;
  for (const stance of CONTENT.stances) {
    const reasons = CONTENT.reasons.filter(reason => reason.stance === stance.value || reason.custom);
    const cards = CONTENT.evidenceCards.filter(card => card.stance === stance.value);
    for (const reason of reasons) for (const card of cards) {
      const reasonText = reason.custom ? '교통 안전과 개인의 자유를 함께 살펴야 하기 때문입니다' : reason.text;
      const argText = composeArgument({ stance: stance.value, reasonText, card, motion: CONTENT.motion });
      assert.ok(argText.length <= 300);
      const sessionId = `s_ui_${String(count).padStart(8, '0')}`;
      const local = engine.buildSession({ stance: stance.value, reasonId: reason.id, reasonText, cardId: card.id, argText, sessionId, seed: sessionId });
      const server = engine.buildSession({ ...local, seed: sessionId });
      assert.deepEqual(engine.getQuestion(local, 1).helpCards, engine.getQuestion(server, 1).helpCards); count++;
    }
  }
  assert.equal(count, 32);
});
