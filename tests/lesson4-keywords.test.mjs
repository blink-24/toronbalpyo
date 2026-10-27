import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import content from '../src/core/lesson4-content.js';
import { createLesson4Engine } from '../src/core/lesson4.js';

const engine = createLesson4Engine(content);
const argument = keyword => `입론은 다음 쟁점에 관한 판단을 담고 있습니다: ${keyword}. 그 조건을 구체적으로 검토하겠습니다.`;
const input = patch => ({ stance: '찬성', arg1: argument('별도의 검토 항목'), sessionId: 'keyword-session-0001', seed: 'keyword-test', ...patch });
const questions = session => session.plan.map((_, i) => engine.getQuestion(session, i + 1));
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

test('30개 단서·찬반 각2변형120개와 가상 도움 자료123개가 완비된다', () => {
  assert.equal(content.keywordProfiles.length, 30);
  assert.equal(new Set(content.keywordProfiles.map(p => p.id)).size, 30);
  assert.equal(content.questions.length, 22);
  assert.equal(content.keywordQuestions.length, 120);
  assert.equal(content.helpCards.length, 123);
  assert.equal(new Set([...content.questions, ...content.keywordQuestions].map(q => q.id)).size, 142);
  for (const profile of content.keywordProfiles) for (const stance of ['찬성', '반대']) {
    const variants = content.keywordQuestions.filter(q => q.cueId === profile.id && q.stance === stance);
    assert.equal(variants.length, 2);
    assert.equal(new Set(variants.map(q => q.verify)).size, 2);
    assert.ok(variants.every(q => q.verify.endsWith('?') && q.criterion === profile.criterion));
    const cards = content.helpCards.filter(card => card.topic === `keyword.${profile.id}`);
    assert.equal(cards.length, 3);
    assert.ok(cards.every(card => card.virtual && /수업용 가상 자료/.test(card.source)));
  }
});

for (const profile of content.keywordProfiles) {
  test(`${profile.label}: 모든 동의어·띄어쓰기·찬반의 관련 질문과 두 변형을 선택한다`, () => {
    for (const stance of ['찬성', '반대']) {
      const seen = new Set();
      for (const word of profile.keywords) {
        // 일부 표현은 고의로 글자마다 공백을 넣고 Unicode·기호 정규화도 적용한다.
        for (const keyword of [word, [...word].join(' ')]) {
          const session = engine.buildSession(input({ stance, arg1: argument(keyword), questionCount: 5 }));
          const q = questions(session).find(q => q.targetKey === `argument.keyword.${profile.id}`);
          assert.ok(q, `${profile.id}/${stance}/${keyword}`);
          assert.match(q.confirm, /입론 ①/);
          assert.equal(q.criterion, profile.criterion);
          assert.ok(q.helpCards.every(card => card.topic === `keyword.${profile.id}`));
          assert.equal(new Set(session.plan.map(q => q.targetKey)).size, 5);
          assert.equal(new Set(session.plan.map(q => q.criterion)).size, 3);
        }
      }
      for (let i = 0; i < 24; i++) {
        const session = engine.buildSession(input({ stance, arg1: argument(profile.keywords[0]), seed: `variant-${i}` }));
        const q = questions(session).find(q => q.targetKey === `argument.keyword.${profile.id}`);
        assert.ok(q); seen.add(q.id);
        const restored = JSON.parse(JSON.stringify(session));
        assert.deepEqual(questions(restored), questions(session));
      }
      assert.equal(seen.size, 2, `${profile.id}/${stance}: 두 관점을 실제로 사용`);
    }
  });
}

test('기존1.0.0 세션은 이전 엔진으로 동결한18가지 계획·질문·자료와 완전히 같다', async () => {
  const frozen = JSON.parse(await fs.readFile(new URL('./fixtures/lesson4-legacy.json', import.meta.url), 'utf8'));
  for (const item of frozen.cases) {
    const session = engine.buildSession({ ...item.input, scriptVersion: '1.0.0' });
    assert.equal(digest({ session, questions: questions(session) }), item.digest);
  }
});

test('⑤의 단서와 긴 문장 뒤의 단서를 해당 입력에서 인용하며 부정도 그대로 확인한다', () => {
  const arg5 = `${'정책에 관해서는 확인할 조건과 비교할 대상을 검토하고 있습니다. '.repeat(8)}예산을 줄일 수 있다고 단정하지 않습니다.`;
  const session = engine.buildSession(input({ arg5 }));
  const q = questions(session).find(q => q.targetKey === 'argument.keyword.budget');
  assert.ok(q);
  assert.match(q.confirm, /입론 ⑤.*예산/);
  assert.match(q.confirm, /단정하지 않/);
  assert.equal(session.arg5, arg5);
});

test('알 수 없는 단서는 일반 질문으로 진행하고 핵심어 반복만으로 질문 점수가 늘지 않는다', () => {
  const unknown = engine.buildSession(input({ arg1: '그 판단은 여러 조건을 확인하고 충분히 논의한 뒤 내려야 한다고 생각합니다.' }));
  assert.ok(unknown.plan.every(q => !q.id.startsWith('L4K-')));
  const once = engine.buildSession(input({ arg1: argument('예산') }));
  const repeated = engine.buildSession(input({ arg1: argument('예산 '.repeat(60)) }));
  assert.deepEqual(repeated.plan, once.plan);
  assert.throws(() => engine.buildSession(input({ scriptVersion: 'untrusted-version' })), error => error.code === 'INVALID_SCRIPT_VERSION');
});

test('설문 비율·소수점 단서는 숫자 일부나 다른 단위와 혼동하지 않는다', () => {
  const has = (text, id) => engine.buildSession(input({ arg1: argument(text), questionCount: 5 })).plan.some(q => q.targetKey === `argument.keyword.${id}`);
  assert.equal(has('70%', 'survey'), true);
  assert.equal(has('７０ ％', 'survey'), true);
  assert.equal(has('170%', 'survey'), false);
  assert.equal(has('70회', 'survey'), false);
  assert.equal(has('30.3%', 'remote'), true);
  assert.equal(has('303명', 'remote'), false);
  assert.equal(has('130.3%', 'remote'), false);
});

test('혼합 단서는 보류·원출처 검토를 우선하고 중복 없이3~5답 완료·복원된다', () => {
  for (const stance of ['찬성', '반대']) for (const count of [3, 4, 5]) for (let i = 0; i < 30; i++) {
    // 30종 전체 및 서로 다른 부분 집합도 시험해 후보 부족·반복 질문을 찾는다.
    const clues = content.keywordProfiles.filter((_, n) => i === 0 || (n + i) % 3 !== 0).map(p => p.keywords[0]);
    let session = engine.buildSession(input({ stance, questionCount: count, arg1: argument(clues.join(' / ')), seed: `mixed-${i}` }));
    assert.equal(new Set(session.plan.map(q => q.targetKey)).size, count);
    assert.equal(new Set(session.plan.map(q => q.criterion)).size, 3);
    if (clues.includes('카드5')) assert.ok(session.plan.some(q => q.targetKey === 'argument.keyword.held'));
    else if (clues.includes('의료잡지')) assert.ok(session.plan.some(q => q.targetKey === 'argument.keyword.survey'));
    for (const q of questions(session)) {
      const bank = [...content.questions, ...content.keywordQuestions].find(item => item.id === q.id);
      assert.equal(bank.stance, stance);
    }
    for (let turn = 1; turn <= count; turn++) {
      const q = engine.getQuestion(session, turn), card = q.helpCards[0];
      session = engine.recordAnswer(session, { turn, answer: `[자료 ${card.id}]는 가상 검토 틀임을 인정합니다. 다만 의료 정책의 근거와 조건을 확인해야 하기 때문에 주장의 범위를 점검하겠습니다.`, helpIds: [card.id] });
    }
    const finished = engine.finishSession(session, { reflection: '입론의 단서와 근거가 연결되는 범위를 함께 점검하겠습니다.' });
    assert.equal(finished.completedQuestionCount, count);
    assert.equal(finished.feedback.items.length, count);
  }
});
