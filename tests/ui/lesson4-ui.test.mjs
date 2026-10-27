import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createLesson4Controller } from '../../src/ui/lesson4.js';
import { freshLesson4, normalizeGroupIdentity, sameGroupRoster, groupDraftKey } from '../../src/ui/lesson4-state.js';
import { normalizeLessonConfig, lessonAccess } from '../../src/ui/lesson-policy.js';
import { STATE_KEY, loadState } from '../../src/ui/state.js';
import { createApiClient } from '../../src/network/client.js';
import { createService, HEADERS } from '../../backend/service.js';
import { CONTENT } from '../../src/core/content.js';

const memory = () => { const saved = new Map(); return { getItem: key => saved.get(key) || null, setItem: (key, value) => saved.set(key, String(value)), removeItem: key => saved.delete(key) }; };
const members = ['20301', '20302', '20303', '20304'];
const arg1 = '공공 의료 상담의 도입은 의료 접근성을 넓힐 수 있지만 자료의 출처와 이용 조건을 함께 검토해야 합니다.';
const reflection = '다음에는 출처의 범위와 정책 주장 사이의 연결을 함께 확인하겠습니다.';
function entryData({ representative = members[0], groupName = '모형 모둠', roster = members } = {}) {
  const form = new FormData(); form.set('representative', representative); form.set('groupName', groupName);
  Array.from({ length: 5 }, (_, i) => form.set(`member${i + 1}`, roster[i] || '')); return form;
}
function serverFixture(questionCount = 4) {
  const db = Object.fromEntries(Object.keys(HEADERS).map(key => [key, []]));
  db.config = [{ key: 'acceptLessons', value: '2,4' }, { key: 'l4Questions', value: String(questionCount) }];
  const props = new Map([['PASSCODE', 'fixture-only'], ['AI_PROVIDER', 'none']]);
  const service = createService({ content: CONTENT, store: { read: tab => db[tab], append: (tab, row) => db[tab].push({ ...row }), withLock: fn => fn(), writeConfig: (key, value) => { const row = db.config.find(x => x.key === key); if (row) row.value = value; else db.config.push({ key, value }); } },
    properties: { get: key => props.get(key), set: (key, value) => props.set(key, value) }, hash: value => createHash('sha256').update(value).digest('hex') });
  let offline = false; const requests = [];
  const api = createApiClient({ endpoint: 'https://fixture.invalid/exec', fetchImpl: async (url, options = {}) => {
    if (offline) throw new Error('virtual offline');
    const request = options.method === 'POST' ? JSON.parse(options.body) : Object.fromEntries(new URL(url).searchParams); requests.push(request);
    return { ok: true, json: async () => service.respond(options.method || 'GET', request) };
  } });
  return { service, db, api, requests, offline(value) { offline = value; } };
}
function controllerFixture(server, { storage = memory(), initial = freshLesson4() } = {}) {
  let state = initial, config = normalizeLessonConfig(server.service.respond('GET', { action: 'config' }).data), downloaded;
  const controller = createLesson4Controller({ api: server.api, storage, getState: () => state, setState: value => { state = value; }, persist() {}, render() {}, toast() {},
    getConfig: () => config, getAccess: () => lessonAccess(config, 4, true), closedView: () => '<div>4차시 닫힘</div>', getAppVersion: () => '5.1.0',
    downloadFile: (text, filename) => { downloaded = { text, filename }; } });
  return { controller, storage, state: () => state, config(value) { config = normalizeLessonConfig(value); controller.onConfigChanged(); }, downloaded: () => downloaded };
}
async function prepare(f, stance = '찬성') {
  await f.controller.handleForm(entryData()); f.controller.handleInput('l4-arg1', arg1);
  await f.controller.handleClick('l4-stance', { dataset: { value: stance } });
  await f.controller.handleClick('l4-start', { dataset: {} }); assert.equal(f.state().stage, 'dialogue');
}
async function answer(f) {
  f.controller.handleInput('l4-answer', '맞습니다. 다만 자료의 출처와 이용 조건을 확인해야 하기 때문에 공공 의료 도입 주장의 범위를 보완하겠습니다.');
  await f.controller.handleClick('l4-answer-next', { dataset: {} });
}

test('모둠 입장은 대표 포함 4~5명·동일 반·중복 없음과 모둠명을 검사한다', () => {
  const identity = normalizeGroupIdentity({ representative: members[0], groupName: '  Ａ   B  ', memberEntries: members });
  assert.equal(identity.groupKey, '3:a b'); assert.deepEqual(identity.memberStudentIds, members);
  assert.equal(sameGroupRoster(identity, { ...identity, studentId: members[1] }), true);
  for (const patch of [{ memberEntries: members.slice(0, 3) }, { memberEntries: [...members, '20305', '20306'] },
    { memberEntries: ['20301', '20302', '20303', '20303'] }, { memberEntries: ['20301', '20302', '20303', '20404'] },
    { representative: '20305' }, { groupName: '' }]) {
    assert.throws(() => normalizeGroupIdentity({ representative: members[0], groupName: '모형 모둠', memberEntries: members, ...patch }));
  }
});

test('기존 version5의 2차시 초안은 유지하고 4차시 상태만 추가한다', () => {
  const storage = memory(); storage.setItem(STATE_KEY, JSON.stringify({ version: 5, studentId: '20301', tab: 'activity', activity: { step: 'dialogue', turn: 2, argText: '기존 수정 입론', answerDrafts: { 2: '쓰던 답변' } } }));
  const loaded = loadState(storage); assert.equal(loaded.version, 5); assert.equal(loaded.activity.argText, '기존 수정 입론'); assert.equal(loaded.activity.answerDrafts[2], '쓰던 답변');
  assert.equal(loaded.lesson4.stage, 'entry'); assert.notEqual(loaded.lesson4.sessionId, loaded.activity.sessionId);
});

test('구서버에서는 2차시만 작동하며 신서버에서는 2·4 개방이 독립적이다', () => {
  const old = normalizeLessonConfig({ acceptLessons: [2] }); assert.equal(lessonAccess(old, 2).allowed, true); assert.equal(lessonAccess(old, 4).reason, 'preparing');
  const newer = normalizeLessonConfig({ implementedLessons: [2, 4], acceptLessons: [4] }); assert.equal(lessonAccess(newer, 2).allowed, false); assert.equal(lessonAccess(newer, 4).allowed, true);
  assert.equal(lessonAccess(newer, 4, false).allowed, false);
  assert.equal(lessonAccess(normalizeLessonConfig({ implementedLessons: [2, 4], acceptLessons: [] }), 4).reason, 'closed');
});

test('닫힌 4차시는 진입·초안 입력·시작을 막고 기존 초안을 보존한다', async () => {
  const server = serverFixture(), f = controllerFixture(server); f.state().arg1 = arg1;
  f.config({ implementedLessons: [2, 4], acceptLessons: [2] }); const before = JSON.stringify(f.state());
  await f.controller.handleForm(entryData()); f.controller.handleInput('l4-arg1', '지워지면 안 됩니다.'); await f.controller.handleClick('l4-start', { dataset: {} });
  assert.equal(JSON.stringify(f.state()), before); assert.equal(server.requests.length, 0); assert.match(f.controller.render(), /4차시 닫힘/);
});

test('4차시 모둠 4답·성찰은 실제 서비스 모형으로 한 번 저장되고 내려받을 수 있다', async () => {
  const server = serverFixture(), f = controllerFixture(server); await prepare(f);
  assert.doesNotMatch(f.controller.render(), /criterion-badge|겨냥한 기준|숨은 약점/);
  assert.equal((f.controller.render().match(/수업용 가상 자료/g) || []).length >= 2, true);
  for (let i = 0; i < 4; i++) await answer(f);
  assert.equal(f.state().stage, 'feedback'); assert.equal(f.state().feedback.items.length, 4);
  f.controller.handleInput('l4-reflection', reflection); await f.controller.handleClick('l4-submit', { dataset: {} });
  assert.equal(f.state().status, 'sent'); assert.equal(server.db.l4_sessions.length, 1); assert.equal(server.db.l2_sessions.length, 0);
  assert.equal(server.db.l4_sessions[0].groupName, '모형 모둠');
  await f.controller.handleClick('l4-download', { dataset: {} }); assert.match(f.downloaded().filename, /^4차시_모형 모둠_/); assert.match(f.downloaded().text, /대표: 20301/); assert.match(f.downloaded().text, /검토 기준:/);
  const summary = await server.api.get('public_summary', { lesson: 4, cls: 3 }); assert.equal(summary.data.completed, 1); assert.doesNotMatch(JSON.stringify(summary.data), /모형 모둠|20301|memberStudentIds|arg1|reflection/);
  f.controller.stop();
});

test('5문항 설정에서 세 번째 답 뒤 조기 피드백은 3답만 제출한다', async () => {
  const server = serverFixture(5), f = controllerFixture(server); await prepare(f);
  for (let i = 0; i < 3; i++) await answer(f);
  assert.equal(f.state().turn, 4); assert.match(f.controller.render(), /l4-early-feedback/);
  await f.controller.handleClick('l4-early-feedback', { dataset: {} }); assert.equal(f.state().feedback.items.length, 3);
  f.controller.handleInput('l4-reflection', reflection); await f.controller.handleClick('l4-submit', { dataset: {} });
  assert.equal(f.state().status, 'sent'); assert.equal(Number(server.db.l4_sessions[0].completedQuestionCount), 3); assert.equal(server.db.l4_sessions[0].a4, ''); f.controller.stop();
});

test('4차시 오프라인 큐는 2차시 큐와 분리되고 backoff 뒤 같은 모둠 결과를 전달한다', async t => {
  let now = Date.now(); t.mock.method(Date, 'now', () => now);
  const server = serverFixture(), storage = memory(); storage.setItem('chaeum:v5:submission-queue', JSON.stringify([{ payload: { submissionId: 'l2_keep_000001' } }]));
  const f = controllerFixture(server, { storage }); server.offline(true); await prepare(f);
  for (let i = 0; i < 4; i++) await answer(f);
  f.controller.handleInput('l4-reflection', reflection); await f.controller.handleClick('l4-submit', { dataset: {} });
  assert.equal(f.state().status, 'pending'); assert.equal(f.controller.hasPending(), true); assert.equal(server.db.l4_sessions.length, 0);
  const originalId = f.state().submissionId; server.offline(false); await f.controller.recover();
  assert.equal(f.state().status, 'pending'); assert.equal(server.db.l4_sessions.length, 0);
  now += 30001; await f.controller.recover();
  assert.equal(f.state().status, 'sent'); assert.equal(server.db.l4_sessions.length, 1); assert.equal(server.db.l4_sessions[0].submissionId, originalId);
  assert.equal(JSON.parse(storage.getItem('chaeum:v5:submission-queue'))[0].payload.submissionId, 'l2_keep_000001'); f.controller.stop();
});

test('같은 모둠·같은 명단에서 대표만 바꾸면 기존 초안과 질문 차례를 복원한다', async () => {
  const server = serverFixture(), f = controllerFixture(server); await prepare(f); await answer(f);
  const originalSession = f.state().sessionId; const saved = JSON.parse(f.storage.getItem(groupDraftKey(f.state().identity)));
  const restored = controllerFixture(server, { storage: f.storage, initial: freshLesson4() });
  await restored.controller.handleForm(entryData({ representative: members[1] }));
  assert.equal(restored.state().sessionId, originalSession); assert.equal(restored.state().turn, saved.turn); assert.equal(restored.state().identity.studentId, members[1]);
  assert.equal(restored.state().answers[0].answer, saved.answers[0].answer);
  for (let i = 0; i < 3; i++) await answer(restored);
  restored.controller.handleInput('l4-reflection', reflection); await restored.controller.handleClick('l4-submit', { dataset: {} });
  assert.equal(restored.state().status, 'sent'); assert.equal(server.db.l4_sessions[0].studentId, members[1]); f.controller.stop(); restored.controller.stop();
});

test('600자를 넘는 답변은 차례를 넘기거나 첫 답을 확정하지 않는다', async () => {
  const server = serverFixture(), f = controllerFixture(server); await prepare(f);
  f.controller.handleInput('l4-answer', '가'.repeat(601)); await f.controller.handleClick('l4-answer-next', { dataset: {} });
  assert.equal(f.state().turn, 1); assert.equal(f.state().answers.length, 0); assert.match(f.controller.render(), /600/); f.controller.stop();
});

test('우리 모둠의 입장에 따라 상대 토론자의 찬반을 표시한다', async () => {
  for (const stance of ['찬성', '반대']) {
    const f = controllerFixture(serverFixture()); await prepare(f, stance);
    const opponent = stance === '찬성' ? '반대' : '찬성';
    assert.match(f.controller.render(), new RegExp(`class="chat-person"[^]*?</span>${opponent}측 토론자</div>`));
    f.controller.stop();
  }
});
