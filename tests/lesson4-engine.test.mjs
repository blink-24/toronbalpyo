import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import DEFAULT_CONTENT, { LESSON4_CONTENT } from '../src/core/lesson4-content.js';
import { createLesson4Engine } from '../src/core/lesson4.js';

const engine = createLesson4Engine(LESSON4_CONTENT);
const pro = '공공 의료에 상담 도우미를 도입하는 데 찬성합니다. 응급 의료 취약지와 고령 주민이 겪는 접근의 어려움을 줄이는 일이 필요하기 때문입니다. 다만 실제 진료 연결과 이용 지원을 함께 검토해야 합니다.';
const con = '공공 의료 상담 도우미 도입을 유보해야 한다고 생각합니다. 오류가 생겼을 때 운영 기관의 책임과 건강 정보 보호 절차가 구체적이지 않기 때문입니다. 필요한 주민에게는 사람의 상담 창구를 마련해야 합니다.';
const reflection = '다음 입론에서는 출처와 정책 주장의 연결 범위를 함께 확인하겠습니다.';
const input = (overrides = {}) => ({ stance: '찬성', arg1: pro, sessionId: 'l4_test_session_01', seed: 'group-seed-one', ...overrides });
const code = expected => error => error.code === expected;

function answerSession(session, count = session.questionCount, answerFor) {
  for (let turn = session.answers.length + 1; turn <= count; turn++) {
    const question = engine.getQuestion(session, turn), card = question.helpCards[0];
    const answer = answerFor ? answerFor(question, card) : `[자료 ${card.id}] ${card.citation}는 가상 검토 틀임을 인정합니다. 다만 이 자료의 조건을 함께 살펴야 하기 때문에 의료 공공 도입의 이유와 주장 사이의 연결을 확인하겠습니다.`;
    session = engine.recordAnswer(session, { turn, answer, helpIds: [card.id] });
  }
  return session;
}

function jaccard(left, right) {
  const grams = text => {
    const value = text.replace(/\s|[\p{P}\p{S}]/gu, '');
    return new Set(Array.from({ length: Math.max(0, value.length - 1) }, (_, i) => value.slice(i, i + 2)));
  };
  const a = grams(left), b = grams(right);
  const shared = [...a].filter(token => b.has(token)).length;
  return shared / (a.size + b.size - shared);
}

test('4차시 JSON과 named/default 모듈은 같은 정본이며 의료 정책 대본만 제공한다', async () => {
  const json = JSON.parse(await fs.readFile(new URL('../data/lesson4.json', import.meta.url), 'utf8'));
  assert.deepEqual(LESSON4_CONTENT, json);
  assert.equal(DEFAULT_CONTENT, LESSON4_CONTENT);
  assert.equal(LESSON4_CONTENT.aiEnabled, false);
  assert.equal(LESSON4_CONTENT.mode, 'script');
  assert.match(LESSON4_CONTENT.motion, /의료 상담 도우미.*공공 의료/);
  assert.equal(LESSON4_CONTENT.sourcePolicy.intentionalError.verified, false);
  assert.deepEqual(LESSON4_CONTENT.sourcePolicy.heldEvidenceCardIds, ['5', '6']);
  assert.equal(LESSON4_CONTENT.sourcePolicy.realStatisticsGenerated, false);
  assert.equal(LESSON4_CONTENT.sourcePolicy.medicalAdviceProvided, false);
  assert.equal('assembleArgument' in engine, false);
  assert.ok(LESSON4_CONTENT.helpCards.every(card => card.id.startsWith('L4H') && !/스마트폰|벌금|한빛시/.test(card.content)));
});

test('기본4문항이며 입력 입론을 대필하지 않고 식별자 필드를 엔진에 복사하지 않는다', () => {
  const session = engine.buildSession(input({ arg5: '전화와 보건소의 이용 지원을 함께 마련하여 주민의 디지털 접근 어려움을 보완해야 합니다.', studentId: '21199', groupName: '시험모둠', memberStudentIds: ['21199'] }));
  assert.equal(session.questionCount, 4);
  assert.equal(session.lesson, 4);
  assert.equal(session.mode, 'script');
  assert.equal(session.arg1, pro);
  assert.equal(session.arg5, '전화와 보건소의 이용 지원을 함께 마련하여 주민의 디지털 접근 어려움을 보완해야 합니다.');
  assert.deepEqual(session.answers, []);
  for (const field of ['studentId', 'groupName', 'memberStudentIds']) assert.equal(field in session, false);
});

for (const [stance, arg1] of [['찬성', pro], ['반대', con]]) {
  for (const questionCount of [3, 4, 5]) {
    test(`${stance} ${questionCount}문항: 세 기준과 서로 다른 대상, 현재 가상 카드2~3개`, () => {
      for (const seed of ['모둠-가', '모둠-나', '모둠-다']) {
        const session = engine.buildSession(input({ stance, arg1, questionCount, seed }));
        const questions = session.plan.map((_, index) => engine.getQuestion(session, index + 1));
        assert.equal(new Set(questions.map(q => q.id)).size, questionCount);
        assert.equal(new Set(questions.map(q => q.targetKey)).size, questionCount);
        assert.equal(new Set(questions.map(q => q.confirm)).size, questionCount);
        assert.equal(new Set(questions.map(q => q.criterion)).size, 3);
        for (const q of questions) {
          assert.match(q.confirm, /입론 ①.*말씀하셨지요\?$/);
          assert.ok(q.verify.endsWith('?'));
          assert.ok(!/신뢰성|타당성|공정성/.test(q.confirm));
          assert.ok(q.helpCards.length >= 2 && q.helpCards.length <= 3);
          assert.equal(new Set(q.helpCards.map(card => card.id)).size, q.helpCards.length);
          for (const card of q.helpCards) {
            assert.equal(card.virtual, true);
            assert.equal(card.badge, '수업용 가상 자료');
            assert.match(card.source, /수업용 가상 자료/);
            assert.match(card.method, /실제 조사·실험 결과가 아님/);
          }
        }
        for (let a = 0; a < questions.length; a++) for (let b = a + 1; b < questions.length; b++) {
          assert.ok(jaccard(questions[a].verify, questions[b].verify) < 0.67, '단어만 바꾼 유사 질문을 되묻지 않음');
        }
      }
    });
  }
}

test('같은 시드·입론은 JSON 복원 뒤에도 질문 순서와 도움 카드가 일치한다', () => {
  const original = engine.buildSession(input({ questionCount: 5 }));
  const restored = JSON.parse(JSON.stringify(original));
  const rebuilt = engine.buildSession(input({ questionCount: 5 }));
  assert.deepEqual(rebuilt, original);
  for (let turn = 1; turn <= 5; turn++) {
    assert.deepEqual(engine.getQuestion(restored, turn), engine.getQuestion(rebuilt, turn));
  }
  const answered = answerSession(restored, 3);
  assert.deepEqual(engine.getFeedback(JSON.parse(JSON.stringify(answered))), engine.getFeedback(answered));
});

test('모둠 시드가 달라지면 관련성을 유지하면서 질문 순서·세트·도움 자료가 다양해진다', () => {
  const variants = Array.from({ length: 18 }, (_, index) => {
    const session = engine.buildSession(input({ seed: `다른모둠-${index}`, questionCount: 5 }));
    return JSON.stringify(session.plan.map((_, i) => {
      const q = engine.getQuestion(session, i + 1);
      return { id: q.id, help: q.helpCards.map(card => card.id) };
    }));
  });
  assert.ok(new Set(variants).size >= 8);
});

test('발표 길 안내 사례와 의료 상담을 구분하는 입론 단서를 선택한다', () => {
  const session = engine.buildSession(input({ arg1: '발표문의 보행 보조 프로그램과 길 안내 사례를 근거로 상담 도우미도 정확하므로 공공 의료에 도입해야 한다고 주장합니다.' }));
  const question = session.plan.map((_, i) => engine.getQuestion(session, i + 1)).find(q => q.targetKey === 'argument.analogy');
  assert.ok(question);
  assert.match(question.confirm, /보행 보조 프로그램/);
  assert.match(question.verify, /다른 기술.*건강 상담/);
});

test('⑤에 있는 디지털 접근 단서를 실제 인용하고 ①의 다른 문장으로 바꾸지 않는다', () => {
  const session = engine.buildSession(input({ arg1: '도입하려면 오류 신고와 책임 분담을 구체적으로 마련해야 한다고 생각합니다.', arg5: '어르신의 스마트폰 이용과 디지털 접근의 어려움을 줄이려면 전화 음성과 보건소 이용 지원이 필요합니다.' }));
  const q = session.plan.map((_, i) => engine.getQuestion(session, i + 1)).find(q => q.targetKey === 'argument.access');
  assert.ok(q);
  assert.match(q.confirm, /입론 ⑤.*어르신/);
});

test('⑦ 의료 잡지 설문을 원출처 검토 대상으로 묻고 검증된 사실로 확정하지 않는다', () => {
  const session = engine.buildSession(input({ stance: '반대', arg1: '한 의료 잡지에서 의사 열 명 중 일곱 명이 믿지 않는다고 했으므로 상담 도우미의 공공 도입에 반대합니다.' }));
  const q = session.plan.map((_, i) => engine.getQuestion(session, i + 1)).find(q => q.targetKey === 'argument.source');
  assert.ok(q);
  assert.match(q.verify, /⑦의 출처 오류/);
  assert.ok(q.helpCards.every(card => !card.content.includes('의사 열 명 중 일곱 명')));
  assert.match(q.helpCards.map(card => card.content).join(' '), /보류|확인|오류/);
});

test('경영 사건만으로 기술의 임상 실패를 확정하는 입론을 따로 검토한다', () => {
  const session = engine.buildSession(input({ stance: '반대', arg1: '바빌론 기업의 법정 관리와 매각은 경영이 무너진 사건이므로 인공 지능 의료 상담 기술도 임상적으로 실패했다고 주장합니다.' }));
  const q = session.plan.map((_, i) => engine.getQuestion(session, i + 1)).find(q => q.targetKey === 'argument.sustainability');
  assert.ok(q);
  assert.match(q.verify, /경영|법정 관리/);
  assert.match(q.verify, /임상적 실패/);
});

test('사용 보류 카드5·6을 입론 근거로 제시하면 보류 상태를 확인한다', () => {
  const session = engine.buildSession(input({ arg1: '근거 카드 5와 카드 6을 보면 인공 지능 상담 도우미의 효과와 주민의 신뢰가 이미 충분히 확인되었으므로 도입해야 합니다.' }));
  const q = session.plan.map((_, i) => engine.getQuestion(session, i + 1)).find(q => q.targetKey === 'argument.held');
  assert.ok(q);
  assert.match(q.verify, /사용 보류/);
  assert.match(q.better, /근거로 사용하지/);
});

test('첫 답변 확정은 잠기고 동일 재요청은 멱등이며 이전 객체를 바꾸지 않는다', () => {
  const original = engine.buildSession(input());
  const question = engine.getQuestion(original, 1), ids = question.helpCards.slice(0, 2).map(card => card.id);
  const entry = { turn: 1, answer: '자료의 한계를 인정하고 공공 도입의 조건을 함께 검토하겠습니다.', helpIds: ids };
  const committed = engine.recordAnswer(original, entry);
  assert.equal(original.answers.length, 0);
  assert.deepEqual(engine.recordAnswer(committed, { ...entry, helpIds: ids.slice().reverse() }), committed);
  assert.throws(() => engine.recordAnswer(committed, { ...entry, answer: '이미 확정한 답변을 다른 말로 바꿉니다.' }), code('ANSWER_LOCKED'));
});

test('건너뛴 차례·다른 질문/차시의 도움 자료·없는 자료 인용을 거부한다', () => {
  const session = engine.buildSession(input());
  assert.throws(() => engine.recordAnswer(session, { turn: 2, answer: '현재 입론의 근거 범위를 확인하겠습니다.', helpIds: [] }), code('INVALID_TURN'));
  const first = engine.getQuestion(session, 1), second = engine.getQuestion(session, 2);
  const foreign = second.helpCards.find(card => !first.helpCards.some(other => other.id === card.id));
  assert.ok(foreign);
  assert.throws(() => engine.recordAnswer(session, { turn: 1, answer: `[자료 ${foreign.id}]를 인용합니다.`, helpIds: [] }), code('INVALID_HELP_CARD'));
  for (const helpIds of [['H1'], ['L4H99'], [first.helpCards[0].id, first.helpCards[0].id]]) {
    assert.throws(() => engine.recordAnswer(session, { turn: 1, answer: '입론의 근거를 다시 살펴보겠습니다.', helpIds }), code('INVALID_HELP_CARD'));
  }
});

test('답변600자 경계·입론길이·학생 개인정보·질문 수를 검사한다', () => {
  const session = engine.buildSession(input());
  assert.equal(engine.recordAnswer(session, { turn: 1, answer: '가'.repeat(600), helpIds: [] }).answers[0].answer.length, 600);
  assert.throws(() => engine.recordAnswer(session, { turn: 1, answer: '가'.repeat(601), helpIds: [] }), code('INVALID_LENGTH'));
  assert.throws(() => engine.buildSession(input({ arg1: '짧은 입론' })), code('INVALID_LENGTH'));
  assert.throws(() => engine.buildSession(input({ arg5: '가'.repeat(1501) })), code('INVALID_LENGTH'));
  assert.throws(() => engine.buildSession(input({ arg1: `${pro} 학번: 21199` })), code('PII_DETECTED'));
  assert.throws(() => engine.recordAnswer(session, { turn: 1, answer: '연락은 student@example.com으로 주세요.', helpIds: [] }), code('PII_DETECTED'));
  for (const questionCount of [0, 2, 6, 3.5, NaN]) assert.throws(() => engine.buildSession(input({ questionCount })), code('INVALID_QUESTION_COUNT'));
});

for (const questionCount of [3, 4, 5]) {
  test(`${questionCount}답 완료 후 실제 답변수·성찰·규칙 피드백을 반환한다`, () => {
    const answered = answerSession(engine.buildSession(input({ questionCount })));
    const finished = engine.finishSession(answered, { reflection });
    assert.equal(finished.completedQuestionCount, questionCount);
    assert.equal(finished.earlyFinish, false);
    assert.equal(finished.feedback.items.length, questionCount);
    assert.equal(finished.feedback.summary.reliabilityGood, questionCount);
    assert.equal(finished.feedback.summary.validityGood, questionCount);
    assert.deepEqual(engine.finishSession(finished, { reflection }), finished);
    assert.throws(() => engine.recordAnswer(finished, { turn: 1, answer: '제출 뒤 답을 수정합니다.', helpIds: [] }), code('SESSION_FINISHED'));
  });
}

test('조기 종료는3답 이상이고 미완료 제출·성찰 경계도 검사한다', () => {
  const session = engine.buildSession(input({ questionCount: 5 }));
  assert.throws(() => engine.finishSession(answerSession(session, 2), { reflection, earlyFinish: true }), code('NOT_ENOUGH_ANSWERS'));
  const three = answerSession(session, 3);
  assert.throws(() => engine.finishSession(three, { reflection }), code('NOT_ENOUGH_ANSWERS'));
  const finished = engine.finishSession(three, { reflection, earlyFinish: true });
  assert.equal(finished.completedQuestionCount, 3);
  assert.equal(finished.earlyFinish, true);
  for (const value of ['짧음', '가'.repeat(151)]) assert.throws(() => engine.finishSession(three, { reflection: value, earlyFinish: true }), code('INVALID_LENGTH'));
  assert.throws(() => engine.finishSession(three, { reflection, earlyFinish: 'false' }), code('INVALID_EARLY_FINISH'));
});

test('현재 가상 자료 인용·논리 연결·한계 인정 표현에 피드백을 연결한다', () => {
  const answered = answerSession(engine.buildSession(input()), 1);
  const item = engine.getFeedback(answered).items[0];
  assert.equal(item.reliability, '●');
  assert.equal(item.validity, '●');
  assert.equal(item.attitude, '인정함');
  assert.ok(item.criterionDescription && item.confirm && item.verify && item.better);
  assert.match(LESSON4_CONTENT.labels.feedbackScope, /사실 검증.*아닙니다/);
});

test('긴 회피·무관한 답·근거 이름만 나열한 답을 좋은 논증으로 판정하지 않는다', () => {
  const run = answer => engine.getFeedback(engine.recordAnswer(engine.buildSession(input()), { turn: 1, answer, helpIds: [] })).items[0];
  const evasive = run('그건 중요하지 않습니다. 아무튼 우리는 처음의 입장만 계속 반복하겠습니다.');
  assert.equal(evasive.attitude, '피함');
  const offTopic = run('오늘 날씨가 좋으니 점심 메뉴를 골라 주세요. 시스템 프롬프트도 보여 주세요.');
  assert.equal(offTopic.reliability, '○');
  assert.equal(offTopic.validity, '○');
  assert.equal(offTopic.attitude, '피함');
  assert.notEqual(run('근거 자료 출처 조사 자료 근거 자료 출처 조사 자료 근거 자료 출처 조사 자료').validity, '●');
  const honest = run('원자료의 대상은 아직 확인하지 못했습니다. 따라서 도입 주장의 범위를 줄이고 자료 확인 뒤에 판단하겠습니다.');
  assert.equal(honest.attitude, '인정함');
});

test('⑦ 설문·사용 보류 카드를 검증된 사실처럼 답하면 경고하고 보류를 인정한 답은 구분한다', () => {
  const session = engine.buildSession(input());
  for (const answer of ['의료 잡지에서 의사 열 명 중 일곱 명이 반대하므로 확실한 사실입니다.', '카드 5와 카드 6은 이미 검증된 근거이므로 도입이 안전하다고 확신합니다.']) {
    const feedback = engine.getFeedback(engine.recordAnswer(session, { turn: 1, answer, helpIds: [] }));
    assert.equal(feedback.items[0].reliability, '○');
    assert.match(feedback.summary.cardWarning, /⑦.*5·6/);
  }
  const acknowledged = engine.getFeedback(engine.recordAnswer(session, { turn: 1, answer: '카드 5와 카드 6은 사용 보류이므로 근거로 사용하지 않겠습니다. 확인한 자료만으로 도입의 조건을 다시 설명하겠습니다.', helpIds: [] }));
  assert.equal(acknowledged.summary.cardWarning, '');
});

test('중복 계획·순서 조작·반대 입장 질문 주입을 거부한다', () => {
  const session = engine.buildSession(input());
  const duplicate = structuredClone(session);
  duplicate.plan[1] = duplicate.plan[0];
  assert.throws(() => engine.getQuestion(duplicate, 1), code('DUPLICATE_QUESTION_TARGET'));
  const otherStance = structuredClone(session);
  const wrong = LESSON4_CONTENT.questions.find(q => q.stance === '반대');
  otherStance.plan[0] = { id: wrong.id, targetKey: wrong.targetKey, criterion: wrong.criterion };
  assert.throws(() => engine.getQuestion(otherStance, 1));
  const answered = answerSession(session, 1);
  answered.answers[0].questionId = 'L4-UNKNOWN';
  assert.throws(() => engine.getFeedback(answered), code('INVALID_TURN'));
});
