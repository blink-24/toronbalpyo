import test from 'node:test';
import assert from 'node:assert/strict';
import lesson4Content from '../src/core/lesson4-content.js';
import { DEBATE_SEQUENCE_LABELS, DEBATE_LIMITS, buildDebatePlan, validateGroupTurn, validateDebateArguments, checkAiOutput, parseAiContent,
  selectDebateMaterials, realSourcesFor, weaknessFor, debateReview, WEAKNESS_KEYS } from '../src/core/lesson4-debate.js';

const aiSteps = plan => [...new Set(plan.turns.filter(turn => ['constructive', 'rebuttal'].includes(turn.kind) || turn.kind === 'cross_question').map(turn => turn.step))];

test('12단계 순서는 2차시 학습 화면의 기존 순서와 같다', () => {
  assert.deepEqual(DEBATE_SEQUENCE_LABELS, ['찬성 1 입론', '반대 2 신문', '반대 1 입론', '찬성 1 신문', '찬성 2 입론', '반대 1 신문', '반대 2 입론', '찬성 2 신문', '반대 1 반박', '찬성 1 반박', '반대 2 반박', '찬성 2 반박']);
});

test('모둠 입장에 따라 AI가 반대 자리를 맡고 양측 6단계씩 진행한다', () => {
  const pro = buildDebatePlan({ stance: '찬성', exchanges: 2, rebuttal: true });
  const con = buildDebatePlan({ stance: '반대', exchanges: 2, rebuttal: true });
  assert.equal(pro.aiStance, '반대'); assert.equal(con.aiStance, '찬성');
  assert.deepEqual(aiSteps(pro), [2, 3, 6, 7, 9, 11]);
  assert.deepEqual(aiSteps(con), [1, 4, 5, 8, 10, 12]);
  // 모둠 찬성이면 모둠이, 모둠 반대이면 AI가 마지막 발언을 한다.
  assert.equal(pro.turns.at(-1).actor, 'group'); assert.equal(con.turns.at(-1).actor, 'ai'); assert.equal(con.turns.at(-1).final, true);
  for (const plan of [pro, con]) {
    assert.equal(plan.turns.length, 24); assert.equal(plan.turns.filter(turn => turn.actor === 'ai').length, 12);
    assert.deepEqual(plan.turns.map(turn => turn.turnNo), Array.from({ length: 24 }, (_, i) => i + 1));
    // 신문 단계는 질문→답변이 문답 수만큼 반복되고, 질문 대상은 직전 입론이다.
    const step2 = plan.turns.filter(turn => turn.step === 2);
    assert.deepEqual(step2.map(turn => [turn.exchange, turn.kind.includes('question') ? 'Q' : 'A']), [[1, 'Q'], [1, 'A'], [2, 'Q'], [2, 'A']]);
    assert.ok(step2.every(turn => turn.slot === 1)); assert.ok(plan.turns.filter(turn => turn.step === 6).every(turn => turn.slot === 2));
    assert.equal(plan.earlyFinishTurn, plan.turns.filter(turn => turn.step <= 4).length);
  }
  assert.deepEqual(con.turns.filter(turn => turn.kind === 'group_constructive').map(turn => [turn.step, turn.slot]), [[3, 1], [7, 2]]);
});

test('문답 수와 반박 생략 설정을 반영한다', () => {
  assert.equal(buildDebatePlan({ stance: '찬성', exchanges: 1 }).turns.length, 4 + 4 * 2 + 4);
  assert.equal(buildDebatePlan({ stance: '찬성', exchanges: 3 }).turns.length, 4 + 4 * 6 + 4);
  const short = buildDebatePlan({ stance: '반대', exchanges: 2, rebuttal: false });
  assert.equal(short.turns.length, 20); assert.equal(Math.max(...short.turns.map(turn => turn.step)), 8); assert.ok(short.turns.at(-1).final);
  assert.throws(() => buildDebatePlan({ stance: '찬성', exchanges: 4 }), { code: 'INVALID_EXCHANGES' });
  assert.throws(() => buildDebatePlan({ stance: '중립' }), { code: 'INVALID_STANCE' });
});

test('모둠 입론 ①·⑤와 차례 입력의 길이·개인정보를 검사한다', () => {
  assert.throws(() => validateDebateArguments({ arg1: '[가상] 접근을 넓혀야 한다는 입론입니다.', arg5: '' }), { code: 'INVALID_LENGTH' });
  const question = { kind: 'group_question' }, answer = { kind: 'group_answer' }, rebuttal = { kind: 'group_rebuttal' };
  assert.throws(() => validateGroupTurn(question, '근거는요?'), { code: 'INVALID_LENGTH' });
  assert.equal(validateGroupTurn(answer, '네'), '네');
  assert.throws(() => validateGroupTurn(rebuttal, 'x'.repeat(DEBATE_LIMITS.group.group_rebuttal[1] + 1)), { code: 'INVALID_LENGTH' });
  assert.throws(() => validateGroupTurn(answer, '연락은 010-1234-5678로 주세요.'), { code: 'PII_DETECTED' });
  assert.throws(() => validateGroupTurn({ kind: 'constructive' }, '내용'), { code: 'INVALID_STEP' });
});

const constructive = { kind: 'constructive' }, question = { kind: 'cross_question' }, answer = { kind: 'cross_answer' }, rebuttal = { kind: 'rebuttal' };
const goodConstructive = '공공 상담 도우미는 신중하게 도입해야 합니다. 상담이 진료로 이어지는 절차가 아직 분명하지 않습니다. 주민이 안내만 받고 기다릴 수 있습니다. 그래서 지금은 도입을 서두르기 어렵습니다.';
const reason = (fn, code) => { try { fn(); } catch (error) { return error.reason || error.code; } return code === 'none' ? 'none' : 'not-thrown'; };

test('AI 출력 검사: 정상 발언은 통과하고 새 숫자·주소·개인정보는 거절한다', () => {
  assert.deepEqual(checkAiOutput(constructive, { text: goodConstructive, refs: [] }, { allowedText: '' }), { text: goodConstructive, refs: [] });
  assert.equal(reason(() => checkAiOutput(constructive, { text: `${goodConstructive} 주민의 70%가 반대합니다.` }, { allowedText: '' })), 'NUMBER_NOT_IN_SOURCE');
  assert.equal(checkAiOutput(constructive, { text: `${goodConstructive} 입론의 30분 기준도 살펴야 합니다.` }, { allowedText: '모둠 입론: 30분 안에 연결' }).refs.length, 0);
  assert.equal(reason(() => checkAiOutput(constructive, { text: `${goodConstructive} 자세한 것은 www.example.com에 있습니다.` })), 'URL');
  assert.equal(reason(() => checkAiOutput(answer, { text: '제 연락처는 010-1234-5678입니다. 확인해 보세요.' })), 'PII');
  assert.equal(reason(() => checkAiOutput(answer, { text: '' })), 'EMPTY');
  assert.equal(reason(() => checkAiOutput(constructive, { text: '짧은 입론입니다.' })), 'TOO_SHORT');
  assert.equal(reason(() => checkAiOutput(rebuttal, { text: '가'.repeat(451) })), 'TOO_LONG');
  // 조금 넘친 발언은 상한 안의 마지막 완결 문장까지만 남긴다(94.9% 같은 소수점에서는 자르지 않음).
  const long = `${goodConstructive} 실험에서 상태를 94.9% 맞혔다는 결과도 있습니다. ${'주민의 불편을 함께 살펴야 합니다. '.repeat(24)}`;
  const trimmed = checkAiOutput(constructive, { text: long }, { allowedText: '94.9%' }).text;
  assert.ok(long.length > 500 && trimmed.length <= 500 && /합니다\.$/.test(trimmed) && trimmed.includes('94.9%'));
  assert.equal(reason(() => checkAiOutput(question, { text: `${'입론에서 접근을 넓힌다고 하셨지요'.repeat(15)}? 그 근거를 확인하셨습니까?` })), 'TOO_LONG');
});

test('AI 출력 검사: 의료 조언·대필·보류 자료·긴 문장·영어 약어를 거절한다', () => {
  assert.equal(reason(() => checkAiOutput(answer, { text: '열이 나면 해열제를 복용하면 됩니다. 걱정하지 마세요.' })), 'MEDICAL_ADVICE');
  assert.equal(reason(() => checkAiOutput(answer, { text: '모둠 입론을 이렇게 고쳐 보세요. 근거를 앞에 두면 됩니다.' })), 'GHOSTWRITING');
  assert.equal(reason(() => checkAiOutput(rebuttal, { text: `${goodConstructive} 의료 잡지 설문에서 의사 열 명 중 일곱 명이 반대했습니다.` }, { allowedText: '' })), 'HELD_SOURCE');
  assert.equal(reason(() => checkAiOutput(rebuttal, { text: `${goodConstructive} 카드 5의 내용도 그렇습니다.` }, { allowedText: '카드 5' })), 'HELD_SOURCE');
  // 질문으로 원출처를 확인하는 것은 반대 신문의 목적에 맞으므로 허용한다.
  const heldQuestion = '입론에서 “의료 잡지 설문”을 근거로 드셨지요? 그 설문의 원출처를 확인하셨습니까?';
  assert.equal(checkAiOutput(question, { text: heldQuestion }).text, heldQuestion);
  assert.equal(reason(() => checkAiOutput(constructive, { text: `${goodConstructive} ${'주민의 불편과 담당자의 부담과 지역의 사정과 예산의 범위와 정보 보호의 조건과 의료인 연결의 절차를 모두 함께 생각하지 않으면 이 정책은 결국 실패할 수밖에 없다는 점을 우리는 처음부터 끝까지 분명히 기억해야 합니다'}.` })), 'SENTENCE_TOO_LONG');
  assert.equal(reason(() => checkAiOutput(constructive, { text: `${goodConstructive} 이는 UX 문제입니다.` })), 'LATIN_WORD');
  assert.equal(checkAiOutput(constructive, { text: `${goodConstructive} AI 상담의 한계입니다.` }).text.includes('AI'), true);
});

test('반대 신문 질문 앞에는 직전 답에 대한 짧은 응수를 둘 수 있다', () => {
  const reply = '그 점은 이해합니다. 세계보건기구도 승인 기관을 먼저 정하라고 권했습니다. 그렇다면 그 기관은 누가 맡습니까? 입론에 그 조건이 들어 있습니까?';
  assert.equal(checkAiOutput(question, { text: reply }).text, reply);
  assert.equal(reason(() => checkAiOutput(question, { text: '첫째 응수입니다. 둘째 응수입니다. 셋째 응수입니다. 그 근거는 무엇입니까?' })), 'NOT_QUESTION');
  assert.equal(reason(() => checkAiOutput(question, { text: '그 근거는 무엇입니까? 그 점은 이해합니다.' })), 'NOT_QUESTION');
});

test('AI 질문 형식과 인용 자료 번호를 검사한다', () => {
  assert.equal(reason(() => checkAiOutput(question, { text: '입론에서 접근을 넓힌다고 하셨지요. 그 근거를 말씀해 주세요.' })), 'NOT_QUESTION');
  assert.equal(reason(() => checkAiOutput(question, { text: '접근을 넓힌다고 하셨지요? 근거가 있습니까? 출처는 어디입니까?' })), 'NOT_QUESTION');
  const cited = `${goodConstructive} [자료 L4H01]처럼 연결 방안을 나누어 보아야 합니다.`;
  assert.equal(reason(() => checkAiOutput(constructive, { text: cited, refs: [] }, { allowedText: '"id":"L4H01"', allowedRefs: ['L4H01'] })), 'BRACKET_REF');
  assert.equal(reason(() => checkAiOutput(constructive, { text: cited, refs: [] }, { allowedRefs: [] })), 'REF_UNKNOWN');
  const plainCite = `${goodConstructive} 가온군 공공 상담 검토안에 따르면 연결 방안을 나누어 보아야 합니다.`;
  assert.deepEqual(checkAiOutput(constructive, { text: plainCite, refs: ['L4H01'] }, { allowedRefs: ['L4H01'] }).refs, ['L4H01']);
  assert.equal(reason(() => checkAiOutput(constructive, { text: goodConstructive, refs: ['L4H99'] }, { allowedRefs: ['L4H01'] })), 'REF_UNKNOWN');
});

test('모델 응답의 JSON·코드 블록·일반 글을 같은 검사로 보낸다', () => {
  assert.deepEqual(parseAiContent('{"text":"가","refs":[]}'), { text: '가', refs: [] });
  assert.deepEqual(parseAiContent('```json\n{"text":"나","refs":["L4H01"]}\n```'), { text: '나', refs: ['L4H01'] });
  assert.deepEqual(parseAiContent('설명입니다 {"text":"다"} 끝'), { text: '다' });
  assert.deepEqual(parseAiContent('그냥 문장입니다.'), { text: '그냥 문장입니다.', refs: [] });
});

test('AI 토론 근거는 쟁점이 맞는 실제 자료만 고르고 보류·⑦ 주제에는 붙이지 않는다', () => {
  const cards = selectDebateMaterials(lesson4Content, '개인정보와 건강정보 보호 기준이 필요합니다.');
  assert.ok(cards.length > 0 && cards.length <= 3 && cards.some(card => card.id === 'R07'));
  assert.ok(cards.every(card => card.virtual === false && card.badge.startsWith('실제 자료') && card.url.startsWith('https://')));
  assert.deepEqual(selectDebateMaterials(lesson4Content, '오늘 점심은 무엇인가요'), []);
  assert.deepEqual(selectDebateMaterials(lesson4Content, '카드5 사용보류 근거 카드6 의료잡지 설문'), []);
});

test('두 AI 입론의 허점 종류가 다르고 돌아보기에 공개된다', () => {
  for (const seed of ['a', 'b', 'session-123']) assert.notEqual(weaknessFor(seed, 1), weaknessFor(seed, 2));
  assert.ok(WEAKNESS_KEYS.includes(weaknessFor('x', 1)));
  const plan = buildDebatePlan({ stance: '찬성' });
  const review = debateReview(plan, [{ turnNo: 6, actor: 'ai', kind: 'constructive', weaknessType: 'missing_condition', mode: 'ai' },
    { turnNo: 2, actor: 'ai', kind: 'cross_question', mode: 'script-fallback' }, { turnNo: 1, actor: 'group', kind: 'group_constructive' }]);
  assert.equal(review.weaknesses[0].label, '반대 1 입론'); assert.equal(review.weaknesses[0].weaknessLabel, '필요한 조건을 빠뜨림');
  assert.deepEqual([review.aiTurns, review.fallbackTurns, review.groupTurns], [2, 1, 1]);
});

test('실제 자료는 출처·날짜·링크를 갖추고 ⑦·보류 주제에는 붙지 않는다', () => {
  const families = new Set(lesson4Content.topics.map(topic => topic.id));
  assert.equal(new Set(lesson4Content.realSources.map(item => item.id)).size, lesson4Content.realSources.length);
  for (const item of lesson4Content.realSources) {
    assert.match(item.url, /^https:\/\//); assert.match(item.date, /^\d{4}-\d{2}(-\d{2})?$/);
    assert.ok(item.title && item.publisher && item.summary.length <= 220 && ['기사', '보고서', '법령', '연구', '책'].includes(item.kind), item.id);
    assert.ok(item.topics.every(topic => families.has(topic) && !['source', 'held', 'analogy'].includes(topic)), item.id);
  }
  assert.deepEqual(realSourcesFor(lesson4Content, 'keyword.privacy').map(item => item.id), ['R07']);
  assert.deepEqual(realSourcesFor(lesson4Content, ['source', 'held', 'keyword.survey']), []);
});
