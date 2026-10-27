/* v5 대본 엔진. 외부 호출·저장소·식별자 전송 없이 같은 입력에서 같은 결과를 냅니다. */
export class DomainError extends Error {
  constructor(code, message) { super(message); this.name = 'DomainError'; this.code = code; }
}
export function invariant(condition, code, message) {
  if (!condition) throw new DomainError(code, message);
}
export function normalizeStance(value) {
  if (value === '찬성' || value === 'pro') return '찬성';
  if (value === '반대' || value === 'con') return '반대';
  throw new DomainError('INVALID_STANCE', '찬성 또는 반대를 선택해 주세요.');
}
export function validateStudentId(value, config = {}) {
  const id = String(value ?? '');
  invariant(/^\d{5}$/.test(id), 'INVALID_STUDENT_ID', '학번은 숫자 5자리로 입력해 주세요.');
  const grade = Number(config.grade || 2), cls = Number(id.slice(1, 3)), number = Number(id.slice(3));
  invariant(Number(id[0]) === grade && cls >= 1 && cls <= Number(config.classCount || 11) && number >= 1 && number <= 99,
    'INVALID_STUDENT_ID', '학년·반·번호를 확인해 주세요.');
  return { studentId: id, grade, cls, number, masked: `${id.slice(0, 3)}**` };
}
export function detectPII(text) {
  const value = String(text ?? '').normalize('NFKC');
  const rules = [
    ['email', /[A-Z0-9._%+-]+\s*@\s*[A-Z0-9.-]+\s*\.\s*[A-Z]{2,}/i],
    ['phone', /(?:\+?82[\s.-]*)?0?1[016789][\s().-]*\d{3,4}[\s.-]*\d{4}|0\d{1,2}[\s.-]+\d{3,4}[\s.-]+\d{4}/],
    ['resident_number', /\b\d{6}\s*[-–]\s*[1-4]\d{6}\b/],
    ['student_id', /(?:학번|학생\s*번호)\s*[:：]?\s*\d{5}|(?:^|[^\d])\d{5}(?!\d)/],
    ['name', /제\s*이름은|저의\s*이름은|(?:이름|성명)\s*[:：]\s*[가-힣A-Za-z]/],
    ['class_number', /\d\s*학년\s*\d{1,2}\s*반|\d{1,2}\s*반\s*\d{1,2}\s*번/],
  ];
  return rules.filter(([, pattern]) => pattern.test(value)).map(([kind]) => kind);
}
export function validateFreeText(value, field, { min = 0, max = 2000, pii = true } = {}) {
  invariant(typeof value === 'string', 'INVALID_TEXT', `${field}은 글로 입력해 주세요.`);
  const result = value.normalize('NFC').trim();
  invariant(!/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(result), 'INVALID_TEXT', '사용할 수 없는 제어 문자가 있습니다.');
  invariant(result.length >= min && result.length <= max, 'INVALID_LENGTH', `${field}은 ${min}~${max}자로 입력해 주세요.`);
  invariant(!pii || detectPII(result).length === 0, 'PII_DETECTED', '이름·학번·전화번호·이메일을 글에서 빼고 다시 입력해 주세요.');
  return result;
}
export function sanitizeCell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? value : '';
  if (typeof value === 'boolean') return value;
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return /^[\s\u0000-\u0020]*[=+\-@]/.test(text) ? `'${text}` : text;
}
export function seedHash(value) {
  let h = 2166136261;
  for (const char of String(value)) { h ^= char.codePointAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function seededShuffle(list, seed) {
  let state = seedHash(seed) || 1;
  const result = list.slice();
  const random = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; };
  for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; }
  return result;
}
function cleanSentence(value) { return String(value).trim().replace(/[.。]+$/, ''); }
function category(id) { return id.startsWith('Q-REL-') ? '신뢰성' : id.startsWith('Q-VAL-') ? '타당성' : '공정성'; }
function broadTarget(id) {
  if (id.startsWith('Q-REL-')) return 'card-source';
  if (id === 'Q-VAL-RN2' || id === 'Q-FAIR-P' || id === 'Q-FAIR-N') return 'stance';
  if (/^Q-(?:VAL|FAIR)-R/.test(id)) return 'reason';
  return 'card-content';
}
export function planQuestions(selection, content, count = 3) {
  const stance = normalizeStance(selection.stance), r = selection.reasonId, c = selection.cardId;
  invariant([2, 3].includes(Number(count)), 'INVALID_QUESTION_COUNT', '질문 수는 2개 또는 3개입니다.');
  const reason = content.reasons.find(x => x.id === r), card = content.evidenceCards.find(x => x.id === c);
  invariant(reason && (r === 'RX' || normalizeStance(reason.stance) === stance), 'INVALID_REASON', '입장에 맞는 이유를 선택해 주세요.');
  invariant(card && normalizeStance(card.stance) === stance, 'INVALID_CARD', '입장에 맞는 근거 카드를 선택해 주세요.');
  const low = ['PB', 'PC', 'NB', 'NC'].includes(c);
  const plans = [{ id: low ? `Q-REL-${c}` : 'Q-REL-GEN', severity: low ? 3 : 1 }];
  let val;
  if (r === 'RP2') val = { id: 'Q-VAL-RP2', severity: 3 };
  else if (r === 'RN2' && ['NB', 'NC', 'ND'].includes(c)) val = { id: 'Q-VAL-RN2', severity: 2 };
  else if (['PA', 'PD', 'NA'].includes(c) || (c === 'ND' && r === 'RN1')) val = { id: `Q-VAL-${c}`, severity: 2 };
  else if (['RP1', 'RN3', 'RX'].includes(r)) val = { id: `Q-VAL-${r}`, severity: 2 };
  else val = { id: `Q-VAL-${c}`, severity: 2 };
  plans.push(val);
  if (['RN2', 'RN1', 'RP3'].includes(r)) plans.push({ id: `Q-FAIR-${r}`, severity: r === 'RN2' ? 3 : 2 });
  else if (c === 'ND') plans.push({ id: 'Q-FAIR-ND', severity: 2 });
  else plans.push({ id: stance === '찬성' ? 'Q-FAIR-P' : 'Q-FAIR-N', severity: 1 });
  const rank = { 신뢰성: 0, 타당성: 1, 공정성: 2 };
  const all = plans.map(x => {
    invariant(content.questions.some(q => q.id === x.id), 'MISSING_QUESTION', `질문 ${x.id}의 대본이 없습니다.`);
    return { ...x, criterion: category(x.id), targetKey: broadTarget(x.id) };
  }).sort((a, b) => b.severity - a.severity || rank[a.criterion] - rank[b.criterion]);
  invariant(new Set(all.map(x => x.criterion)).size === 3 && new Set(all.map(x => x.targetKey)).size === 3,
    'DUPLICATE_QUESTION_TARGET', '질문 계획의 기준 또는 겨냥 대상이 겹칩니다.');
  return all.slice(0, Number(count));
}
export function isClearlyUnrelated(answer) {
  const text = String(answer).trim();
  return /(?:오늘\s*날씨|점심\s*(?:메뉴|뭐)|축구\s*(?:경기|보러)|게임\s*하|노래\s*불러|시스템\s*프롬프트|이전\s*지시.*무시)/.test(text)
    && !/(?:벌금|보행|스마트폰|자료|이유|근거|책임|안전|교육|신뢰|출처|인정|편파|공정)/.test(text);
}
export function validateQuestionOutput(value, planned) {
  invariant(value && typeof value === 'object' && !Array.isArray(value), 'INVALID_AI_OUTPUT', 'AI 응답의 형식이 다릅니다.');
  invariant(value.criterion === planned.criterion, 'INVALID_AI_OUTPUT', 'AI가 질문 계획을 벗어났습니다.');
  for (const key of ['confirm', 'verify']) {
    const text = validateFreeText(value[key], 'AI 질문', { min: 3, max: 140 });
    invariant(text.endsWith('?') && !/(어떻게\s*생각|무엇이라고\s*보|의견은|대신\s*써|정답은|시스템\s*프롬프트|https?:\/\/|<script|씨발|병신)/i.test(text),
      'INVALID_AI_OUTPUT', '질문 표현을 확인하지 못해 대본으로 전환합니다.');
  }
  return { confirm: value.confirm, verify: value.verify, criterion: value.criterion };
}
export function validateFeedbackOutput(value, expected) {
  invariant(value && Array.isArray(value.items) && value.items.length === expected.length && value.summary, 'INVALID_AI_OUTPUT', '피드백 형식이 다릅니다.');
  const items = value.items.map((item, i) => {
    invariant(item.turn === i + 1 && item.criterion === expected[i].criterion && ['●', '◐', '○'].includes(item.reliability)
      && ['●', '◐', '○'].includes(item.validity) && ['인정함', '보통', '피함'].includes(item.attitude), 'INVALID_AI_OUTPUT', '피드백의 기준이나 판정이 다릅니다.');
    return { ...expected[i], reliability: item.reliability, validity: item.validity, attitude: item.attitude,
      comment: validateFreeText(item.comment, 'AI 코멘트', { min: 1, max: 160 }),
      better: validateFreeText(item.better, 'AI 보완 방향', { min: 1, max: 200 }) };
  });
  return { items, summary: { good: validateFreeText(value.summary.good, 'AI 요약', { min: 1, max: 160 }),
    improve: validateFreeText(value.summary.improve, 'AI 요약', { min: 1, max: 160 }) } };
}
export function createEngine(content) {
  invariant(content && content.questions && content.helpCards, 'MISSING_CONTENT', '수업 콘텐츠를 불러오지 못했습니다.');
  function assembleArgument(input) {
    const stance = normalizeStance(input.stance), reason = content.reasons.find(x => x.id === input.reasonId), card = content.evidenceCards.find(x => x.id === input.cardId);
    planQuestions(input, content, 3);
    const reasonText = input.reasonId === 'RX' ? validateFreeText(input.reasonText, '직접 쓴 이유', { min: 10, max: 120 }) : reason.text;
    const year = card.year && card.year !== '밝혀지지 않음' ? `의 ${card.year} 자료` : '';
    return `저는 '${content.topic || content.motion}'는 논제에 ${stance}합니다.\n그 이유는 ${cleanSentence(reasonText)}.\n${card.source}${year}에 따르면 '${cleanSentence(card.content)}'라고 합니다.`;
  }
  function buildSession(input) {
    const stance = normalizeStance(input.stance), count = Number(input.questionCount || 3);
    invariant(/^[A-Za-z0-9_-]{8,64}$/.test(input.sessionId || ''), 'INVALID_SESSION_ID', '세션 식별자가 올바르지 않습니다.');
    const plan = planQuestions({ ...input, stance }, content, count), reason = content.reasons.find(x => x.id === input.reasonId);
    const reasonText = input.reasonId === 'RX' ? validateFreeText(input.reasonText, '직접 쓴 이유', { min: 10, max: 120 }) : reason.text;
    const assembled = assembleArgument({ ...input, stance, reasonText });
    const argText = validateFreeText(input.argText === undefined ? assembled : input.argText, '입론', { min: 1, max: 300 });
    return { version: content.version, lesson: 2, sessionId: input.sessionId, stance, reasonId: input.reasonId, reasonText,
      cardId: input.cardId, argText, questionCount: count, seed: String(input.seed || input.sessionId), plan, answers: [], mode: 'script' };
  }
  function getQuestion(session, turn) {
    invariant(Number.isInteger(turn) && turn >= 1 && turn <= session.plan.length, 'INVALID_TURN', '질문 순서를 확인해 주세요.');
    const planned = session.plan[turn - 1], bank = content.questions.find(x => x.id === planned.id), card = content.evidenceCards.find(x => x.id === session.cardId);
    let confirm = bank.confirm;
    if (planned.id === 'Q-REL-GEN' && (!card.year || card.year === '밝혀지지 않음')) confirm = bank.confirmWithoutYear || '근거로 든 자료는 {source}의 자료이지요?';
    const stanceClaim = session.stance === '찬성' ? '보행 중에 스마트폰을 사용하면 벌금을 부과해야 한다' : '보행 중에 스마트폰을 사용해도 벌금을 부과해서는 안 된다';
    const replacements = { source: card.source, year: card.year, snippet: session.reasonText.slice(0, 30), stanceClaim };
    const render = text => String(text).replace(/\{(source|year|snippet|stanceClaim)\}/g, (_, key) => replacements[key]);
    const helpCards = seededShuffle(content.helpCards.filter(x => x.criterion === planned.criterion && (x.stance === '공통' || x.stance === session.stance)), `${session.seed}:${turn}:${planned.id}`).slice(0, 2);
    invariant(helpCards.length === 2, 'MISSING_HELP_CARDS', '도움 자료가 부족합니다.');
    return { ...planned, turn, confirm: render(confirm), verify: render(bank.verify), helpCards: helpCards.map(x => ({ ...x })), better: bank.better };
  }
  function recordAnswer(session, input) {
    const turn = Number(input.turn), answers = session.answers || [];
    const answer = validateFreeText(input.answer, '답변', { min: 1, max: 300 });
    if (turn <= answers.length) {
      invariant(answers[turn - 1].answer === answer && JSON.stringify(answers[turn - 1].helpIds) === JSON.stringify(input.helpIds || []), 'ANSWER_LOCKED', '이미 다음 질문으로 넘긴 답변은 바꿀 수 없습니다.');
      return JSON.parse(JSON.stringify(session));
    }
    invariant(turn === answers.length + 1 && turn <= session.questionCount, 'INVALID_TURN', '이전 질문부터 답해 주세요.');
    const question = getQuestion(session, turn), helpIds = input.helpIds || [];
    const quotedIds = [...answer.matchAll(/\[자료\s+(H\d+)\]/g)].map(x => x[1]);
    invariant(quotedIds.every(id => content.helpCards.some(card => card.id === id)), 'INVALID_HELP_CARD', '존재하는 도움 자료 번호를 인용해 주세요.');
    invariant(Array.isArray(helpIds) && helpIds.length <= 2 && new Set(helpIds).size === helpIds.length
      && helpIds.every(id => question.helpCards.some(card => card.id === id)), 'INVALID_HELP_CARD', '현재 질문에 제시된 도움 자료를 선택해 주세요.');
    return { ...session, answers: [...answers, { turn, questionId: question.id, answer, helpIds: helpIds.slice() }] };
  }
  function evaluateAnswer(answer, allowedHelpIds = []) {
    const text = String(answer).trim();
    const quoted = [...text.matchAll(/\[자료\s+(H\d+)\]/g)].map(x => x[1]);
    const validCitation = quoted.some(id => allowedHelpIds.includes(id) && content.helpCards.some(x => x.id === id));
    const knownSource = /한빛시/.test(text) && /연구원|보고서|교육청|시민\s*설문|정책\s*연구\s*모임|시범\s*사업|교통안전\s*캠페인|분석|조사/.test(text);
    const sourceAndDate = /(?:20\d{2}년)/.test(text) && /(?:기관|연구|조사|분석|설문|보고서|가상)/.test(text);
    const reliability = validCitation || knownSource || sourceAndDate ? '●' : /조사|자료|통계|수치/.test(text) ? '◐' : '○';
    const connective = /때문에|따라서|그러므로|왜냐하면|즉/.test(text), longEnough = text.length >= 40;
    const validity = connective && longEnough ? '●' : connective || longEnough ? '◐' : '○';
    const attitude = text.length < 10 || /모르겠|상관없|아무튼|그건\s*중요하지\s*않/.test(text) ? '피함'
      : /맞습니다|인정합니다|말씀대로|다만/.test(text) ? '인정함' : '보통';
    return { reliability, validity, attitude };
  }
  function getFeedback(session) {
    const items = session.answers.map((entry, i) => {
      const q = getQuestion(session, i + 1), scores = evaluateAnswer(entry.answer, q.helpCards.map(x => x.id));
      const comment = scores.reliability === '○' ? '출처를 밝힌 자료를 들어 답변을 뒷받침해 보세요.'
        : scores.validity === '○' ? '자료와 이유가 자신의 주장으로 어떻게 이어지는지 설명해 보세요.'
        : scores.attitude === '피함' ? '질문이 겨냥한 부분에 직접 답하고 인정할 점을 확인해 보세요.' : '자료와 주장 사이의 연결을 더 구체적으로 살펴보세요.';
      return { turn: i + 1, questionId: q.id, criterion: q.criterion,
        criterionDescription: (content.criterionDescriptions || content.criterionExplanations || {})[q.criterion] || '',
        confirm: q.confirm, verify: q.verify, answer: entry.answer, ...scores, comment, better: q.better };
    });
    const reliabilityGood = items.filter(x => x.reliability === '●').length, validityGood = items.filter(x => x.validity === '●').length;
    const card = content.evidenceCards.find(x => x.id === session.cardId);
    const points = { '●': 2, '◐': 1, '○': 0, 인정함: 2, 보통: 1, 피함: 0 };
    const totals = ['reliability', 'validity', 'attitude'].map((key, rank) => ({ key, rank, score: items.reduce((sum, x) => sum + points[x[key]], 0) }));
    totals.sort((a, b) => a.score - b.score || a.rank - b.rank);
    const weakest = totals[0].key;
    return { items, summary: { reliabilityGood, validityGood,
      good: reliabilityGood ? '출처나 도움 자료를 밝혀 답변을 뒷받침했습니다.' : validityGood ? '이유와 주장의 연결을 풀어 설명했습니다.' : '반대 신문의 질문을 읽고 자신의 답변을 남겼습니다.',
      improve: weakest === 'reliability' ? '자료를 인용할 때 출처와 시기를 함께 밝혀 보세요.' : weakest === 'validity' ? '이유와 주장을 연결어로 이어 설명해 보세요.' : '인정할 부분과 유지할 주장을 구별해 더 정교하게 답해 보세요.',
      cardWarning: card.reliability === '낮음' ? '처음 고른 근거 카드의 출처를 다시 살펴보세요(203쪽 신뢰성 기준).' : '' } };
  }
  function finishSession(session, options = {}) {
    const actual = session.answers.length, early = Boolean(options.earlyFinish);
    invariant(actual >= 2 && (actual === session.questionCount || early), 'NOT_ENOUGH_ANSWERS', '두 번째 답까지 마친 뒤 피드백과 성찰을 제출해 주세요.');
    const reflection = validateFreeText(options.reflection, '성찰', { min: 10, max: 150 });
    return { ...session, reflection, earlyFinish: actual < session.questionCount, completedQuestionCount: actual, feedback: getFeedback(session) };
  }
  return { buildSession, assembleArgument, getQuestion, recordAnswer, evaluateAnswer, getFeedback, finishSession,
    planQuestions: (selection, count = 3) => planQuestions(selection, content, count) };
}
