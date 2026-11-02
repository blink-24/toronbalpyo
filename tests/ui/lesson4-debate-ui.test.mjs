import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createLesson4Controller } from '../../src/ui/lesson4.js';
import { freshLesson4 } from '../../src/ui/lesson4-state.js';
import { normalizeLessonConfig, lessonAccess } from '../../src/ui/lesson-policy.js';
import { createApiClient } from '../../src/network/client.js';
import { createService, HEADERS } from '../../backend/service.js';
import { CONTENT } from '../../src/core/content.js';

// 가상 모둠·가상 Solar 응답만 사용합니다.
const members = ['20301', '20302', '20303', '20304'];
const arg1 = '[가상] 공공 상담 창구가 부족한 지역 주민의 상담 접근을 넓히기 위해 조건을 갖추어 도입해야 합니다.';
const arg5 = '[가상] 의료인 연결 절차와 정보 보호 기준을 함께 마련하면 이용 격차를 줄일 수 있습니다.';
const AI_TEXT = {
  constructive: '공공 상담 도우미는 신중하게 도입해야 합니다. 상담이 진료로 이어지는 절차가 아직 분명하지 않습니다. 주민이 안내만 받고 기다릴 수 있습니다. 그래서 지금은 도입을 서두르기 어렵습니다.',
  cross_question: '입론에서 “접근을 넓힌다”고 하셨지요? 그 효과가 실제 진료 연결까지 이어진다는 근거를 확인하셨습니까?',
  cross_answer: '그 점은 인정합니다. 다만 안내가 늦어지는 문제를 먼저 살펴야 한다고 봅니다.',
  rebuttal: '모둠은 접근을 넓힌다고 했지만 진료 연결 조건은 충분히 설명하지 않았습니다. 그래서 신중하게 도입해야 한다는 우리 주장이 유지됩니다.',
};
const GROUP_TEXT = {
  group_question: 'AI 입론에서 절차가 분명하지 않다는 근거는 무엇입니까?',
  group_answer: '맞습니다. 다만 의료인 연결 절차를 함께 마련하기 때문에 효과가 이어진다고 봅니다.',
  group_rebuttal: 'AI 측은 절차가 불분명하다고 했지만 우리는 연결 절차와 정보 보호 기준을 조건으로 제시했기 때문에 도입 주장이 유지됩니다.',
};
const memory = () => { const saved = new Map(); return { getItem: key => saved.get(key) || null, setItem: (key, value) => saved.set(key, String(value)), removeItem: key => saved.delete(key) }; };

function setup({ failConstructive = false } = {}) {
  const db = Object.fromEntries(Object.keys(HEADERS).map(key => [key, []]));
  db.config = [{ key: 'acceptLessons', value: '2,4' }, { key: 'l4Mode', value: 'debate' }, { key: 'l4DebateExchanges', value: '1' }];
  const props = new Map(Object.entries({ PASSCODE: 'fixture-only', AI_PROVIDER: 'none', L4_DEBATE_PROVIDER: 'solar', SOLAR_API_KEY: 'not-real', SOLAR_MODEL: 'virtual' }));
  const service = createService({ content: CONTENT, store: { read: tab => db[tab], append: (tab, row) => db[tab].push({ ...row }), withLock: fn => fn(),
    writeConfig: (key, value) => { const row = db.config.find(x => x.key === key); if (row) row.value = value; else db.config.push({ key, value }); } },
  properties: { get: key => props.get(key), set: (key, value) => props.set(key, value) }, hash: value => createHash('sha256').update(value).digest('hex'),
  debateCall: request => {
    const kind = JSON.parse(request.messages[1].content).task.kind;
    if (failConstructive && kind === 'constructive') { const error = new Error('virtual outage'); error.code = 'AI_UPSTREAM'; throw error; }
    return { content: JSON.stringify({ text: AI_TEXT[kind], refs: [] }) };
  } });
  const requests = [];
  const api = createApiClient({ endpoint: 'https://fixture.invalid/exec', fetchImpl: async (url, options = {}) => {
    const request = options.method === 'POST' ? JSON.parse(options.body) : Object.fromEntries(new URL(url).searchParams); requests.push(request);
    return { ok: true, json: async () => service.respond(options.method || 'GET', request) };
  } });
  let state = freshLesson4(), downloaded;
  const config = normalizeLessonConfig(service.respond('GET', { action: 'config' }).data);
  const controller = createLesson4Controller({ api, storage: memory(), getState: () => state, setState: value => { state = value; }, persist() {}, render() {}, toast() {},
    getConfig: () => config, getAccess: () => lessonAccess(config, 4, true), closedView: () => '<div>닫힘</div>', getAppVersion: () => '5.4.0',
    downloadFile: (text, filename) => { downloaded = { text, filename }; } });
  return { controller, db, requests, config, state: () => state, downloaded: () => downloaded };
}
async function enter(f, stance) {
  const form = new FormData(); form.set('representative', members[0]); form.set('groupName', '가상 모둠');
  members.forEach((id, i) => form.set(`member${i + 1}`, id)); form.set('member5', '');
  await f.controller.handleForm(form);
  f.controller.handleInput('l4-arg1', arg1); f.controller.handleInput('l4-arg5', arg5);
  await f.controller.handleClick('l4-stance', { dataset: { value: stance } });
}

test('토론이 열리면 입론 화면에 AI 고지와 ⑤ 필수 안내를 보이고 ⑤ 없이 시작하지 않는다', async () => {
  const f = setup(); assert.equal(f.config.l4DebateAvailable, true);
  await enter(f, '찬성'); f.controller.handleInput('l4-arg5', '');
  const html = f.controller.render();
  assert.match(html, /AI 토론 시작/); assert.match(html, /외부 인공 지능 서비스로 전송/); assert.match(html, /⑤ 우리 모둠 입론2 · 20~1500자/);
  await f.controller.handleClick('l4-debate-start', { dataset: {} });
  assert.equal(f.state().stage, 'argument'); assert.equal(f.state().debate, null);
  assert.equal(f.requests.filter(r => r.action === 'l4_debate').length, 0);
});

for (const stance of ['찬성', '반대']) {
  test(`모둠 ${stance}: 화면에서 12단계를 마치고 성찰을 제출한다`, async () => {
    const f = setup(); await enter(f, stance);
    await f.controller.handleClick('l4-debate-start', { dataset: {} });
    assert.equal(f.state().stage, 'debate'); assert.match(f.controller.render(), /12단계 토론 순서/);
    for (let guard = 0; f.state().stage === 'debate' && guard < 40; guard++) {
      const next = f.state().debate.next; assert.equal(next.actor, 'group', '모둠 차례에서만 멈춘다');
      if (next.kind !== 'group_constructive') f.controller.handleInput('l4-debate-draft', GROUP_TEXT[next.kind]);
      assert.match(f.controller.render(), next.kind === 'group_constructive' ? /발표하기/ : /data-input="l4-debate-draft"/);
      await f.controller.handleClick('l4-debate-send', { dataset: {} });
    }
    assert.equal(f.state().stage, 'debate-review'); assert.equal(f.state().debate.finished, true);
    const review = f.controller.render(); assert.match(review, /AI 입론에 남겨 둔 허점/); assert.match(review, /AI 생성 발언/);
    f.controller.handleInput('l4-reflection', '근거와 조건을 함께 밝혀야 한다는 점을 배웠습니다.');
    await f.controller.handleClick('l4-debate-submit', { dataset: {} });
    assert.equal(f.state().stage, 'complete'); assert.equal(f.state().status, 'sent'); assert.equal(f.db.l4_debates.length, 1);
    // 학생 요청에는 AI 키·프롬프트가 없고, 내려받기 파일에는 AI 입론 전문이 없다.
    assert.ok(f.requests.every(r => !JSON.stringify(r).includes('not-real')));
    await f.controller.handleClick('l4-download', { dataset: {} });
    assert.ok(!f.downloaded().text.includes(AI_TEXT.constructive)); assert.match(f.downloaded().text, /AI 입론 전문은 화면에서만/);
    assert.match(f.downloaded().text, new RegExp(GROUP_TEXT.group_rebuttal.slice(0, 15)));
  });
}

test('AI 입론 생성 실패 시 다시 시도와 대본 활동 전환을 제공하고 입론을 지키며 전환한다', async () => {
  const f = setup({ failConstructive: true }); await enter(f, '반대');
  await f.controller.handleClick('l4-debate-start', { dataset: {} });
  assert.equal(f.state().stage, 'debate'); assert.equal(f.state().debate.aiError.reason, 'AI_UPSTREAM');
  const html = f.controller.render(); assert.match(html, /다시 시도/); assert.match(html, /대본 활동으로 바꾸기/);
  await f.controller.handleClick('l4-debate-to-script', { dataset: {} });
  assert.equal(f.state().stage, 'argument'); assert.equal(f.state().forceScript, true); assert.equal(f.state().arg1, arg1);
  assert.match(f.controller.render(), /반대 신문 시작/);
  await f.controller.handleClick('l4-start', { dataset: {} });
  assert.equal(f.state().stage, 'dialogue');
});
