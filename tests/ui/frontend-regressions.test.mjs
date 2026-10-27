import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { CONTENT } from '../../src/core/content.js';
import { composeArgument, escapeHtml } from '../../src/ui/state.js';
import { ApiError, mayUseLocalFallback } from '../../src/network/client.js';
import { createSubmissionQueue } from '../../src/network/queue.js';

const main = fs.readFileSync(new URL('../../src/main.js', import.meta.url), 'utf8');
const between = (start, end) => {
  const from = main.indexOf(start); const to = main.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `실제 프런트 코드 구간을 찾지 못했습니다: ${start}`);
  return main.slice(from, to);
};
function activityFixture() {
  return { step: 'evidence', stance: '찬성', reasonId: 'RP1', reasonText: CONTENT.reasons.find(x => x.id === 'RP1').text,
    cardId: 'PA', argText: '이것은 학생이 직접 고쳐 쓴 입론입니다. 출처를 비교하고 표현도 바꾸었습니다.', argumentDraftReady: true };
}
function frontendContext(activity = activityFixture()) {
  const callbacks = new Map();
  const context = { state: { activity }, CONTENT, composeArgument, busy: false, errorMessage: '', lessonIsOpen: () => true,
    document: { addEventListener: (name, fn) => callbacks.set(name, fn), querySelector: () => null },
    selectedCard: () => CONTENT.evidenceCards.find(card => card.id === activity.cardId),
    markProgress() {}, persist() {}, render() {}, scrollToMain() {}, setError(message) { throw new Error(message); }, containsPrivateData: () => false };
  vm.runInNewContext(between('function invalidateArgumentDraft(', 'function turnPayload(')
    + between('async function nextStep()', 'async function commitAnswer()')
    + between("document.addEventListener('click'", "document.addEventListener('input'")
    + between("document.addEventListener('input'", "document.addEventListener('change'")
    + ';globalThis.runNext = nextStep;', context);
  return {
    context,
    click: async (action, dataset = {}) => callbacks.get('click')({ target: { closest: () => ({ disabled: false, dataset: { action, ...dataset } }) } }),
    input: (key, value) => callbacks.get('input')({ target: { dataset: { input: key }, value } }),
  };
}

test('수정한 입론에서 이전으로 나갔다가 같은 카드로 돌아와도 수정본을 보존한다', async () => {
  const activity = activityFixture(); const { context, click } = frontendContext(activity); const edited = activity.argText;
  activity.step = 'argument'; await click('previous'); assert.equal(activity.step, 'evidence');
  await context.runNext(); assert.equal(activity.step, 'argument'); assert.equal(activity.argText, edited);
});

test('같은 입장·이유·카드 재클릭과 직접쓰기 재클릭은 학생 초안을 지우지 않는다', async () => {
  const activity = activityFixture(); const { click } = frontendContext(activity); const edited = activity.argText;
  await click('stance', { value: '찬성' }); await click('reason', { id: 'RP1' }); await click('card', { id: 'PA' });
  assert.equal(activity.argText, edited);
  activity.reasonId = 'RX'; activity.reasonText = '학생이 직접 쓴 이유를 그대로 남깁니다.';
  await click('reason', { id: 'RX' }); assert.equal(activity.reasonText, '학생이 직접 쓴 이유를 그대로 남깁니다.'); assert.equal(activity.argText, edited);
});

test('입론을 비워서 고치던 중에도 같은 카드 이전·다음은 빈 편집 상태를 보존한다', async () => {
  const activity = activityFixture(); const { context, input } = frontendContext(activity);
  input('argText', ''); assert.equal(activity.argumentDraftReady, true);
  await context.runNext(); assert.equal(activity.argText, ''); assert.equal(activity.step, 'argument');
});

test('실제로 카드·이유·입장이 바뀌었을 때만 초안을 초기화하고 새 선택으로 조립한다', async () => {
  const activity = activityFixture(); const { context, click } = frontendContext(activity);
  await click('card', { id: 'PD' }); assert.equal(activity.argText, ''); assert.equal(activity.argumentDraftReady, false);
  await context.runNext(); assert.match(activity.argText, /한빛시청 시범 사업 보고서/);
  await click('reason', { id: 'RP2' }); assert.equal(activity.argText, ''); assert.equal(activity.cardId, 'PD');
  await click('stance', { value: '반대' }); assert.equal(activity.reasonId, ''); assert.equal(activity.reasonText, ''); assert.equal(activity.cardId, '');
});

test('직접 쓴 이유의 값이 같으면 유지하고 실제 문장이 바뀌면 다음 초안을 새로 준비한다', () => {
  const activity = activityFixture(); activity.reasonId = 'RX'; activity.reasonText = '학생이 직접 쓴 이유입니다.';
  const { input } = frontendContext(activity); const edited = activity.argText;
  input('reasonText', activity.reasonText); assert.equal(activity.argText, edited);
  input('reasonText', '학생이 다른 근거를 생각하며 이유를 바꾸었습니다.'); assert.equal(activity.argText, ''); assert.equal(activity.argumentDraftReady, false);
});

test('이전 버전의 비어 있지 않은 수정 초안도 새 준비 플래그 없이 보존한다', async () => {
  const activity = activityFixture(); delete activity.argumentDraftReady;
  const { context } = frontendContext(activity); const edited = activity.argText;
  await context.runNext(); assert.equal(activity.argText, edited); assert.equal(activity.argumentDraftReady, true);
});

test('게시 앱은 배포 설정 주소만 선택하고 주소 입력·기기 덮어쓰기 경로를 제공하지 않는다', () => {
  const init = main.match(/^const api = createApiClient\(.*\);$/m)?.[0]; assert.ok(init);
  let selected;
  const context = { runtime: { apiUrl: 'https://script.google.com/macros/s/trusted-deployment/exec', apiEndpoint: 'https://untrusted.invalid/alias' },
    storage: { getItem() { throw new Error('기기의 덮어쓰기 주소를 읽으면 안 됩니다.'); } },
    createApiClient(options) { selected = options.endpoint; return {}; } };
  vm.runInNewContext(init, context);
  assert.equal(selected, context.runtime.apiUrl);
  assert.doesNotMatch(main, /chaeum:public-endpoint|connect-endpoint|api-endpoint|api\.setEndpoint|adminSettings/);
  const teacher = { serverConfig: { classCount: 13 }, teacherPasscode: '', teacherData: null, teacherClass: 11, busy: false, api: { isConfigured: () => true }, h: escapeHtml, button: () => '<button>돌아가기</button>', errorHtml: () => '' };
  vm.runInNewContext(between('function teacherView()', 'function render()') + ';globalThis.screen=teacherView();', teacher);
  assert.match(teacher.screen, /value="13"/); assert.doesNotMatch(teacher.screen, /value="14"/); assert.match(teacher.screen, /교사용 암호/); assert.doesNotMatch(teacher.screen, /type="url"|연결 설정|api-endpoint/);
});

function queueFixture() {
  const saved = new Map(); return { getItem: key => saved.get(key) || null, setItem: (key, value) => saved.set(key, String(value)) };
}
test('LESSON_CLOSED는 자동 재시도하지 않고 활동을 연 뒤 명시적 재전송으로만 복구한다', async () => {
  let closed = true, calls = 0, clock = 0; const ids = [];
  const api = { isConfigured: () => true, async post(action, payload) { calls++; ids.push(payload.submissionId); if (closed) throw new ApiError('활동이 닫혀 있습니다.', 'LESSON_CLOSED'); return { ok: true, data: { accepted: true } }; } };
  const queue = createSubmissionQueue({ storage: queueFixture(), api, now: () => clock });
  queue.enqueue({ submissionId: 'sub_closed_fix_01', data: { reflection: '출처를 다시 확인하겠습니다.' } });
  await queue.flush(); assert.equal(calls, 1); assert.equal(queue.getItems()[0].blocked, true);
  closed = false; clock = 600000; await queue.flush(); assert.equal(calls, 1);
  await queue.flush({ force: true }); assert.equal(calls, 2); assert.equal(queue.getItems().length, 0); assert.deepEqual(ids, ['sub_closed_fix_01', 'sub_closed_fix_01']);
});

test('INVALID_LENGTH·INVALID_STUDENT_ID는 수동 force로도 반복 전송하지 않는다', async () => {
  for (const code of ['INVALID_LENGTH', 'INVALID_STUDENT_ID']) {
    let calls = 0;
    const api = { isConfigured: () => true, async post() { calls++; throw new ApiError('입력을 확인해 주세요.', code); } };
    const queue = createSubmissionQueue({ storage: queueFixture(), api }); queue.enqueue({ submissionId: `sub_permanent_${code}` });
    await queue.flush(); await queue.flush({ force: true }); assert.equal(calls, 1); assert.equal(queue.getItems()[0].blocked, true);
  }
});

test('첫 BUSY는 차단하지 않고 backoff 뒤 같은 제출 ID로 자동 복구한다', async () => {
  let clock = 0, calls = 0; const ids = [];
  const api = { isConfigured: () => true, async post(action, payload) { calls++; ids.push(payload.submissionId); if (calls === 1) throw new ApiError('잠시 후 다시 시도해 주세요.', 'BUSY'); return { ok: true, data: { accepted: true } }; } };
  const queue = createSubmissionQueue({ storage: queueFixture(), api, now: () => clock }); queue.enqueue({ submissionId: 'sub_busy_fix_001' });
  await queue.flush(); assert.equal(queue.getItems()[0].blocked, undefined); assert.equal(queue.getItems()[0].nextAttemptAt, 30000);
  await queue.flush(); assert.equal(calls, 1);
  clock = 30000; await queue.flush(); assert.equal(calls, 2); assert.equal(queue.getItems().length, 0); assert.deepEqual(ids, ['sub_busy_fix_001', 'sub_busy_fix_001']);
});

test('질문 요청의 BUSY는 학생을 막지 않고 기기 대본을 이어 간다', async () => {
  const context = { state: { activity: { session: {}, turn: 1, remoteQuestions: {}, mode: 'script' } }, requestGeneration: 0, busy: false,
    api: { isConfigured: () => true, async post() { throw new ApiError('서버 사용 중', 'BUSY'); } },
    mayUseLocalFallback, lessonIsOpen: () => true, render() {}, persist() {}, turnPayload: () => ({}), errorMessage: '' };
  vm.runInNewContext(between('async function ensureQuestion()', 'async function showFeedback(') + ';globalThis.run=ensureQuestion;', context);
  await context.run(); assert.equal(context.state.activity.mode, 'script-local'); assert.notEqual(context.state.activity.blocked, true); assert.equal(context.busy, false);
});

test('비동기 render가 입장 학번과 포커스·커서를 보존한다', () => {
  let nodes = new Map(); let active = null; let markup = '';
  const field = (id, value = '') => ({ id, value, selectionStart: 2, selectionEnd: 4,
    focus() { active = this; }, setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; } });
  const old = field('student-id', '21199'); nodes.set(old.id, old); active = old;
  const app = { contains: node => [...nodes.values()].includes(node) };
  Object.defineProperty(app, 'innerHTML', { set(value) { markup = value; const replacement = field('student-id'); nodes = new Map([[replacement.id, replacement]]); } });
  const document = { getElementById: id => nodes.get(id) || null, get activeElement() { return active; } };
  const context = { app, document, state: { tab: 'activity' }, header: () => '', isTeacher: () => false, hero: () => '', tabs: () => '',
    activityView: () => '<input id="student-id">', footer: () => '', tickTimer() {} };
  vm.runInNewContext(between('function captureEntryForm()', 'async function refreshConfig()') + ';globalThis.run=render;', context);
  context.run();
  assert.equal(nodes.get('student-id').value, '21199'); assert.equal(active, nodes.get('student-id'));
  assert.equal(active.selectionStart, 2); assert.equal(active.selectionEnd, 4);
  assert.equal(markup.includes('21199'), false, '학번을 복원하려고 HTML 문자열에 삽입하지 않습니다.');
});

test('교사 로그인 암호·반 선택은 DOM 값으로만 유지하고 다음 질문의 답변에는 복원하지 않는다', () => {
  let nodes = new Map(); let active = null; let markup = '';
  const field = (id, value = '') => ({ id, value, selectionStart: null, selectionEnd: null, focus() { active = this; } });
  const password = field('teacher-passcode', 'fixture-secret-never-persist'); const cls = field('teacher-class', '11'); const answer = field('answer-text', '이전 질문의 답변');
  nodes = new Map([[password.id, password], [cls.id, cls], [answer.id, answer]]); active = password;
  const app = { contains: node => [...nodes.values()].includes(node) };
  Object.defineProperty(app, 'innerHTML', { set(value) { markup = value; nodes = new Map(['teacher-passcode', 'teacher-class', 'answer-text'].map(id => [id, field(id)])); } });
  const context = { app, document: { getElementById: id => nodes.get(id) || null, get activeElement() { return active; } }, state: { tab: 'activity' },
    header: () => '', isTeacher: () => true, teacherView: () => '<input type="password" id="teacher-passcode"><select id="teacher-class"></select><textarea id="answer-text"></textarea>',
    footer: () => '', tickTimer() {}, storage: { setItem() { throw new Error('암호를 저장소에 쓰면 안 됩니다.'); } } };
  vm.runInNewContext(between('function captureEntryForm()', 'async function refreshConfig()') + ';globalThis.run=render;', context);
  context.run();
  assert.equal(nodes.get('teacher-passcode').value, 'fixture-secret-never-persist'); assert.equal(active, nodes.get('teacher-passcode'));
  assert.equal(nodes.get('teacher-class').value, '11'); assert.equal(nodes.get('answer-text').value, '');
  assert.equal(markup.includes('fixture-secret-never-persist'), false);
});

test('2차시도 학생의 입장과 반대인 상대 토론자를 표시한다', () => {
  for (const stance of ['찬성', '반대']) {
    const context = { state: { activity: { stance, turn: 1, questionCount: 3, answerDrafts: {}, mode: 'script' } },
      currentQuestion: () => ({ confirm: '질문의 확인 부분인가요?', verify: '질문의 검증 부분인가요?', helpCards: [] }),
      h: escapeHtml, CONTENT, busy: false, errorHtml: () => '', actionBar: () => '', committed: () => [] };
    vm.runInNewContext(between('function dialogueView()', 'const ratingLabel') + ';globalThis.screen=dialogueView();', context);
    const opponent = stance === '찬성' ? '반대' : '찬성';
    assert.match(context.screen, new RegExp(`class="chat-person"[^]*?</span>${opponent}측 토론자<span`));
  }
});

test('온라인 복귀도 닫힘 차단은 풀지 않고 일시 오류의 backoff를 지킨다', async () => {
  async function reconnect(queue) {
    const callbacks = new Map(), flushes = [];
    vm.runInNewContext(between("window.addEventListener('online'", "window.addEventListener('beforeunload'"), {
      window: { addEventListener: (event, callback) => callbacks.set(event, callback) },
      refreshConfig: async () => {}, queue: { flush: options => { const promise = queue.flush(options); flushes.push(promise); return promise; } },
      flushProgress() {}, lesson4: { recover() {} },
    });
    callbacks.get('online')(); await new Promise(resolve => setImmediate(resolve)); await Promise.all(flushes);
  }
  let clock = 0, calls = 0, closed = true;
  const api = { isConfigured: () => true, async post() {
    calls++; if (closed) throw new ApiError('활동이 닫혀 있습니다.', 'LESSON_CLOSED');
    return { ok: true, data: { accepted: true } };
  } };
  const queue = createSubmissionQueue({ storage: queueFixture(), api, now: () => clock }); queue.enqueue({ submissionId: 'sub_closed_online_01' });
  await queue.flush(); closed = false; clock = 600000; await reconnect(queue);
  assert.equal(calls, 1); assert.equal(queue.getItems()[0].blocked, true);
  await queue.flush({ force: true }); assert.equal(calls, 2); assert.equal(queue.getItems().length, 0);

  let temporaryCalls = 0; clock = 0;
  const temporary = createSubmissionQueue({ storage: queueFixture(), now: () => clock, api: { isConfigured: () => true, async post() {
    temporaryCalls++; if (temporaryCalls === 1) throw new ApiError('연결을 확인해 주세요.', 'NETWORK');
    return { ok: true, data: { accepted: true } };
  } } });
  temporary.enqueue({ submissionId: 'sub_network_online_01' }); await temporary.flush();
  await reconnect(temporary); assert.equal(temporaryCalls, 1); assert.equal(temporary.getItems().length, 1);
  clock = 30000; await reconnect(temporary); assert.equal(temporaryCalls, 2); assert.equal(temporary.getItems().length, 0);
});
