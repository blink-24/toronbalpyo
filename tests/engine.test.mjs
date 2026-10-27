import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import content from '../src/core/content.js';
import { createEngine, planQuestions, validateStudentId, detectPII, sanitizeCell, validateQuestionOutput } from '../src/core/engine.js';
const engine = createEngine(content);
const example = { stance: '찬성', reasonId: 'RP2', cardId: 'PB', sessionId: 'session-test-001', questionCount: 3 };
const answer = '맞습니다. 다만 [자료 H1] 한빛시 교통안전연구원(가상) 2025년 분석에서도 위험을 확인했기 때문에 출처가 분명한 자료로 근거를 보완하겠습니다.';
function complete(input = example, count = 3) {
  let session = engine.buildSession(input);
  for (let i = 1; i <= count; i++) session = engine.recordAnswer(session, { turn: i, answer: '맞습니다. 다만 출처가 밝혀진 자료와 이유를 함께 살펴야 하기 때문에 주장의 범위를 좁혀 설명하겠습니다.', helpIds: [] });
  return session;
}

test('32조합은 기준3개·네범주에서 독립한 대상3개·심각도 및 고정동률순서를 만족한다', () => {
  let tested = 0;
  for (const stance of ['찬성', '반대']) for (const reason of content.reasons.filter(r => r.stance === stance || r.id === 'RX')) for (const card of content.evidenceCards.filter(c => c.stance === stance)) {
    const selection = { stance, reasonId: reason.id, cardId: card.id, reasonText: '사고를 줄이기 위해 알맞은 방법을 찾아야 하기 때문입니다', sessionId: `combination-${++tested}` };
    const session = engine.buildSession(selection);
    assert.equal(new Set(session.plan.map(x => x.criterion)).size, 3);
    assert.equal(new Set(session.plan.map(x => x.targetKey)).size, 3);
    const priority = { 신뢰성: 0, 타당성: 1, 공정성: 2 };
    for (let i = 1; i < 3; i++) assert.ok(session.plan[i - 1].severity > session.plan[i].severity || (session.plan[i - 1].severity === session.plan[i].severity && priority[session.plan[i - 1].criterion] < priority[session.plan[i].criterion]));
    for (let turn = 1; turn <= 3; turn++) {
      const q = engine.getQuestion(session, turn);
      assert.equal(q.helpCards.length, 2); assert.equal(new Set(q.helpCards.map(x => x.id)).size, 2);
      assert.ok(q.helpCards.every(x => x.virtual && x.criterion === q.criterion && [stance, '공통'].includes(x.stance)));
      assert.ok(q.confirm.endsWith('?') && q.verify.endsWith('?'));
      assert.ok(q.confirm.length <= 140 && q.verify.length <= 140);
      assert.doesNotMatch(q.confirm + q.verify, /어떻게 생각|무엇이라고 보|의견은|\{snippet\}|\{source\}/);
      assert.deepEqual(engine.getQuestion(session, turn), q);
    }
  }
  assert.equal(tested, 32);
});
test('명시된 심각도 예시와 RN2 확인 대상의 충돌 방지', () => {
  assert.deepEqual(planQuestions(example, content).map(x => x.id), ['Q-REL-PB', 'Q-VAL-RP2', 'Q-FAIR-P']);
  const plan = planQuestions({ stance: '반대', reasonId: 'RN2', cardId: 'ND' }, content);
  assert.deepEqual(plan.map(x => [x.id, x.targetKey]), [['Q-FAIR-RN2', 'reason'], ['Q-VAL-RN2', 'stance'], ['Q-REL-GEN', 'card-source']]);
});
test('v5 피드백 예시3개를 그대로 판정하고 짧은 인정 표현은 회피 조건 우선', () => {
  assert.deepEqual(engine.evaluateAnswer(answer, ['H1', 'H2']), { reliability: '●', validity: '●', attitude: '인정함' });
  assert.deepEqual(engine.evaluateAnswer('통계를 보면 위험한 건 사실입니다.'), { reliability: '◐', validity: '○', attitude: '보통' });
  assert.deepEqual(engine.evaluateAnswer('그건 중요하지 않습니다.'), { reliability: '○', validity: '○', attitude: '피함' });
  assert.equal(engine.evaluateAnswer('맞습니다.').attitude, '피함');
  assert.notEqual(engine.evaluateAnswer('[자료 H99]를 참고합니다.', ['H1']).reliability, '●');
});
test('첫 다음 누른 답은 잠기고 도움 자료 위조·다른 차례·빈 답을 거부한다', () => {
  let s = engine.buildSession(example);
  assert.throws(() => engine.recordAnswer(s, { turn: 2, answer }), /이전 질문/);
  assert.throws(() => engine.recordAnswer(s, { turn: 1, answer: ' ' }), /답변/);
  assert.throws(() => engine.recordAnswer(s, { turn: 1, answer, helpIds: ['H12'] }), /도움 자료/);
  assert.throws(() => engine.recordAnswer(s, { turn: 1, answer: '[자료 H99]를 인용하려 합니다.' }), /도움 자료/);
  s = engine.recordAnswer(s, { turn: 1, answer, helpIds: ['H1'] });
  assert.equal(s.answers.length, 1); assert.equal(engine.recordAnswer(s, { turn: 1, answer, helpIds: ['H1'] }).answers.length, 1);
  assert.throws(() => engine.recordAnswer(s, { turn: 1, answer: '바꾼 첫 번째 답변입니다.', helpIds: [] }), /바꿀 수 없습니다/);
});
test('2답 조기 종료와 설정2개 종료는 실제 답한 문항만 평가', () => {
  const twoOfThree = complete(example, 2);
  assert.throws(() => engine.finishSession(twoOfThree, { reflection: '다음에는 자료의 출처를 먼저 확인하겠습니다.' }), /두 번째 답/);
  const finished = engine.finishSession(twoOfThree, { reflection: '다음에는 자료의 출처를 먼저 확인하겠습니다.', earlyFinish: true });
  assert.equal(finished.feedback.items.length, 2); assert.equal(finished.earlyFinish, true);
  const configured = engine.finishSession(complete({ ...example, questionCount: 2 }, 2), { reflection: '다음에는 자료의 출처를 먼저 확인하겠습니다.' });
  assert.equal(configured.earlyFinish, false); assert.equal(configured.completedQuestionCount, 2);
});
test('요약의 보완점은 세 항목 중 실제 가장 약한 규칙 판정을 따른다', () => {
  let s = engine.buildSession(example);
  for (let turn = 1; turn <= 2; turn++) s = engine.recordAnswer(s, { turn, answer: '통계를 보면 위험한 건 사실입니다.', helpIds: [] });
  // 신뢰성◐, 타당성○, 태도보통이므로 타당성 보완이 먼저다.
  assert.match(engine.getFeedback(s).summary.improve, /연결어/);
});
test('입장·카드·직접쓴이유·개인정보·학번·수식 경계를 검사한다', () => {
  assert.throws(() => engine.buildSession({ ...example, stance: '반대' }), /이유/);
  assert.throws(() => engine.buildSession({ ...example, cardId: 'NA' }), /근거 카드/);
  assert.throws(() => engine.buildSession({ ...example, reasonId: 'RX', reasonText: '짧음' }), /10~120/);
  assert.throws(() => engine.buildSession({ ...example, argText: '제 이름은 홍길동입니다.' }), /개인정보|이름/);
  for (const text of ['010-1234-5678', 'safety@example.com', '학번 20315', '제 이름은 홍길동', '20315']) assert.ok(detectPII(text).length);
  for (const text of ['2025년 가상 자료입니다.', '보행자 1,200명을 관찰했습니다.']) assert.equal(detectPII(text).length, 0);
  assert.equal(validateStudentId('20315').cls, 3);
  for (const id of ['20300', '21201', '10301', '2031', '2a315']) assert.throws(() => validateStudentId(id));
  for (const text of ['=HYPERLINK("https://example.com")', ' +1', '\t@SUM(A1)', '-2']) assert.ok(sanitizeCell(text).startsWith("'"));
});
test('AI 질문의 개인정보·개방형·계획변조·길이·물음표를 거부한다', () => {
  const planned = { criterion: '신뢰성' }, good = { confirm: '그 자료를 근거로 드셨지요?', verify: '다른 자료로도 확인되었습니까?', criterion: '신뢰성' };
  assert.deepEqual(validateQuestionOutput(good, planned), good);
  for (const changes of [{ criterion: '타당성' }, { verify: '어떻게 생각하십니까?' }, { confirm: '학번 20315가 맞습니까?' }, { verify: '그렇습니다.' }, { verify: '가'.repeat(141) + '?' }]) assert.throws(() => validateQuestionOutput({ ...good, ...changes }, planned));
});
test('자동 생성 GAS와 Node 엔진이 32분기 및 피드백에서 실제 같은 결과를 낸다', async () => {
  const bundle = await fs.readFile(new URL('../backend/ServerBundle.gs', import.meta.url), 'utf8');
  const sandbox = {}; vm.createContext(sandbox); vm.runInContext(bundle, sandbox);
  const gas = sandbox.ClassroomCore.createEngine(content);
  for (const stance of ['찬성', '반대']) for (const reason of content.reasons.filter(r => r.stance === stance || r.id === 'RX')) for (const card of content.evidenceCards.filter(c => c.stance === stance)) {
    const input = { stance, reasonId: reason.id, cardId: card.id, reasonText: '안전을 위한 방법을 살펴야 하기 때문입니다', sessionId: 'parity-session-01' };
    assert.equal(JSON.stringify(gas.buildSession(input)), JSON.stringify(engine.buildSession(input)));
  }
  const s = complete(); assert.equal(JSON.stringify(gas.getFeedback(s)), JSON.stringify(engine.getFeedback(s)));
});
