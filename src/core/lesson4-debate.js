/* 4차시 AI 토론의 공용 규칙. 브라우저·Node·Apps Script가 같은 코드를 씁니다.
   AI 프롬프트와 키는 이 파일에 두지 않습니다(서버 전용). */
import { DomainError, invariant, normalizeStance, validateFreeText, detectPII, seedHash } from './engine.js';

export const DEBATE_VERSION = '1.0.0';
// 2차시 학습 화면과 같은 2대2 반대 신문식 토론 12단계입니다.
export const DEBATE_SEQUENCE = [
  ['찬성', 1, '입론'], ['반대', 2, '신문'], ['반대', 1, '입론'], ['찬성', 1, '신문'],
  ['찬성', 2, '입론'], ['반대', 1, '신문'], ['반대', 2, '입론'], ['찬성', 2, '신문'],
  ['반대', 1, '반박'], ['찬성', 1, '반박'], ['반대', 2, '반박'], ['찬성', 2, '반박'],
].map(([side, no, kind], index) => ({ step: index + 1, side, no, kind }));
export const DEBATE_SEQUENCE_LABELS = DEBATE_SEQUENCE.map(item => `${item.side} ${item.no} ${item.kind}`);

export const DEBATE_LIMITS = {
  argMin: 20, argMax: 1500, exchangesMin: 1, exchangesMax: 3, exchangesDefault: 2,
  group: { group_question: [10, 150], group_answer: [1, 300], group_rebuttal: [20, 500] },
  // 입론·반박은 완결된 발언, 신문의 질문·답변은 짧게 응수합니다(사용자 운영 의견 2026-11-02).
  ai: { constructive: [80, 500], cross_question: [15, 260], cross_answer: [10, 160], rebuttal: [60, 450] },
  // 모둠 차례의 제한 시간(초). 시작 화면에 먼저 알리고, 시간이 끝나면 쓴 내용을 그대로 보냅니다.
  groupSeconds: { group_question: 90, group_answer: 90, group_rebuttal: 150 },
  // 고1 수준을 위한 출발값입니다. 교사 리허설로 조정합니다.
  sentenceMax: 100, sentenceAverageMax: 70,
  // 양측 첫 입론과 신문(1~4단계)을 마친 뒤에만 조기 종료할 수 있습니다.
  earlyFinishAfterStep: 4, reflectionMin: 10, reflectionMax: 150,
};

export const DEBATE_KIND_LABELS = {
  group_constructive: '우리 모둠 입론', group_question: '우리 모둠 질문', group_answer: '우리 모둠 답변', group_rebuttal: '우리 모둠 반박',
  constructive: 'AI 입론', cross_question: 'AI 질문', cross_answer: 'AI 답변', rebuttal: 'AI 반박',
};

// AI 입론에 일부러 남기는 논리적 빈틈입니다. 사실을 틀리게 쓰는 방식은 쓰지 않습니다.
export const WEAKNESS_TYPES = {
  scope_overgeneralization: { label: '일부 사례를 전체로 넓힘', guide: '몇몇 사례나 일부 지역의 이야기를 모든 주민에게 같은 결과가 생긴다는 결론으로 넓혔습니다.' },
  missing_condition: { label: '필요한 조건을 빠뜨림', guide: '도입하거나 유보할 때 꼭 갖추어야 할 조건(담당자·절차·점검 방법)을 말하지 않았습니다.' },
  alternative_not_compared: { label: '다른 대안과 비교하지 않음', guide: '같은 목표를 이룰 다른 방법과 비교하지 않고 자기 측 방안만 옳다고 했습니다.' },
  burden_shift: { label: '한쪽 집단만 봄', guide: '혜택이나 부담을 받는 사람 중 일부만 보고 판단했습니다.' },
};
export const WEAKNESS_KEYS = Object.keys(WEAKNESS_TYPES);

const other = stance => stance === '찬성' ? '반대' : '찬성';

export function normalizeDebateOptions({ exchanges = DEBATE_LIMITS.exchangesDefault, rebuttal = true } = {}) {
  const count = Number(exchanges);
  invariant(Number.isInteger(count) && count >= DEBATE_LIMITS.exchangesMin && count <= DEBATE_LIMITS.exchangesMax,
    'INVALID_EXCHANGES', '신문 문답 수는 1~3회입니다.');
  return { exchanges: count, rebuttal: rebuttal !== false && rebuttal !== 'false' };
}

// 모둠 입장의 반대 자리를 AI가 맡습니다. 순서는 입장과 관계없이 고정합니다.
export function buildDebatePlan({ stance, exchanges, rebuttal } = {}) {
  const groupStance = normalizeStance(stance), aiStance = other(groupStance);
  const options = normalizeDebateOptions({ exchanges, rebuttal });
  const turns = [];
  const slotOf = (side, kind, step) => DEBATE_SEQUENCE.filter(item => item.side === side && item.kind === kind && item.step <= step).length;
  for (const item of DEBATE_SEQUENCE) {
    if (item.kind === '반박' && !options.rebuttal) continue;
    const actorOf = side => side === groupStance ? 'group' : 'ai';
    const base = { step: item.step, side: item.side, label: `${item.side} ${item.no} ${item.kind === '신문' ? '반대 신문' : item.kind}` };
    if (item.kind === '입론') {
      const actor = actorOf(item.side);
      turns.push({ ...base, exchange: 1, actor, kind: actor === 'group' ? 'group_constructive' : 'constructive', slot: slotOf(item.side, '입론', item.step) });
    } else if (item.kind === '신문') {
      const questioner = actorOf(item.side), target = DEBATE_SEQUENCE[item.step - 2];
      const slot = slotOf(target.side, '입론', target.step);
      for (let exchange = 1; exchange <= options.exchanges; exchange++) {
        turns.push({ ...base, exchange, actor: questioner, kind: questioner === 'group' ? 'group_question' : 'cross_question', slot });
        turns.push({ ...base, exchange, actor: questioner === 'group' ? 'ai' : 'group', kind: questioner === 'group' ? 'cross_answer' : 'group_answer', slot });
      }
    } else {
      const actor = actorOf(item.side);
      turns.push({ ...base, exchange: 1, actor, kind: actor === 'group' ? 'group_rebuttal' : 'rebuttal', slot: slotOf(item.side, '반박', item.step) });
    }
  }
  turns.forEach((turn, index) => { turn.turnNo = index + 1; });
  const lastStep = turns[turns.length - 1].step;
  turns.forEach(turn => { turn.final = turn.turnNo === turns.length && turn.step === lastStep; });
  return { version: DEBATE_VERSION, stance: groupStance, aiStance, ...options, turns,
    earlyFinishTurn: turns.filter(turn => turn.step <= DEBATE_LIMITS.earlyFinishAfterStep).length };
}

export function validateDebateArguments({ arg1, arg5 }) {
  return { arg1: validateFreeText(arg1, '① 입론', { min: DEBATE_LIMITS.argMin, max: DEBATE_LIMITS.argMax }),
    arg5: validateFreeText(arg5 ?? '', '⑤ 입론', { min: DEBATE_LIMITS.argMin, max: DEBATE_LIMITS.argMax }) };
}

export function validateGroupTurn(turn, text) {
  const range = DEBATE_LIMITS.group[turn?.kind];
  invariant(range, 'INVALID_STEP', '지금은 모둠이 입력할 차례가 아닙니다.');
  const field = { group_question: '질문', group_answer: '답변', group_rebuttal: '반박' }[turn.kind];
  return validateFreeText(text, field, { min: range[0], max: range[1] });
}

export function weaknessFor(seed, slot) {
  return WEAKNESS_KEYS[(seedHash(String(seed)) + Number(slot || 1)) % WEAKNESS_KEYS.length];
}

const canonical = value => String(value).normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
// 현재 글에서 감지한 쟁점에 맞는 실제 자료 요약만 고릅니다(4차시는 가상 자료를 쓰지 않음, 사용자 결정 2026-11-02).
export function selectDebateMaterials(content, text, { max = 3 } = {}) {
  const value = canonical(text || '');
  if (!value || !content) return [];
  const topics = new Set();
  for (const profile of content.keywordProfiles || []) if (profile.keywords.some(word => value.includes(canonical(word)))) topics.add(`keyword.${profile.id}`);
  for (const topic of content.topics || []) if ((topic.keywords || []).some(word => value.includes(canonical(word)))) topics.add(topic.id);
  return realSourcesFor(content, [...topics]).slice(0, max);
}

// 쟁점 주제(가상 자료 topic 또는 단서 분류)에 맞는 실제 자료 요약입니다. ⑦·보류 근거 주제에는 붙이지 않습니다.
export function realSourcesFor(content, topics) {
  const families = new Set((Array.isArray(topics) ? topics : [topics]).map(topic => String(topic).startsWith('keyword.')
    ? (content.keywordProfiles || []).find(profile => `keyword.${profile.id}` === topic)?.family : topic).filter(Boolean));
  return (content.realSources || []).filter(item => item.topics.some(topic => families.has(topic))).map(item => ({ id: item.id, title: item.title,
    content: item.summary, source: `${item.publisher} · ${item.date}`, url: item.url, kind: item.kind, badge: `실제 자료 · ${item.kind}`, virtual: false }));
}

const URL_PATTERN = /https?:\/\/|www\.|\.(?:com|kr|org|net)\b/i;
const MEDICAL_ADVICE = /복용|\d+\s*mg\b|밀리그램|용량을|약을\s*(?:드|먹)|드세요|드시기|처방(?:을)?\s*받으세요|증상이\s*(?:있|나타나)(?:으면|면)/;
const GHOSTWRITING = /이렇게\s*(?:써|고쳐|바꿔)|수정안|모범\s*답안|(?:입론|반박|답변)을\s*(?:다시\s*)?(?:대신|고쳐|써\s*드|만들어\s*드)|다음과\s*같이\s*(?:쓰|고치)/;
const HELD_LIMIT = /사용\s*보류|확인되지|확인하지\s*못|출처.{0,8}(?:불명확|모호)|사실로\s*(?:쓰지|보기\s*어렵)|단정할\s*수\s*없/;
const HELD_CARD = /(?:카드|자료)\s*[⑤⑥56](?:\s*[·,와과]\s*[⑤⑥56])?(?!\d)|[56]\s*번\s*카드/;
const HELP_TAG = /\[자료\s+([A-Za-z][A-Za-z0-9_-]*)\]/g;

export const AI_REJECTION_REASONS = {
  EMPTY: '본문이 비어 있음', TOO_SHORT: '너무 짧음', TOO_LONG: '글자 수 상한을 넘음', URL: '인터넷 주소를 씀',
  PII: '개인정보 형태가 있음', NUMBER_NOT_IN_SOURCE: '제공되지 않은 숫자·통계를 씀', LATIN_WORD: '영어 단어·약어를 씀',
  SENTENCE_TOO_LONG: '문장이 너무 길어 고1 수준을 넘음', MEDICAL_ADVICE: '개인 건강 조언을 함', GHOSTWRITING: '학생 글을 대신 쓰거나 고쳐 줌',
  HELD_SOURCE: '⑦ 설문이나 사용 보류 카드를 사실처럼 씀', NOT_QUESTION: '질문 형식이 아님(짧은 응수 두 문장 이하 뒤에 물음표로 끝나는 질문 한두 문장)', REF_UNKNOWN: '제공되지 않은 자료 번호를 인용함', BRACKET_REF: '본문에 [자료 번호]를 씀(자료 제목을 문장으로 풀어 쓰고 번호는 refs에만)',
};
function reject(reason) {
  const error = new DomainError('AI_OUTPUT_REJECTED', AI_REJECTION_REASONS[reason] || '출력 규칙을 지키지 않았습니다.');
  error.reason = reason; return error;
}

function sentences(text) { return text.split(/(?<=[.?!。？！])\s+|\n+/u).map(value => value.trim()).filter(Boolean); }

// AI 출력의 규칙 검사입니다. 의미 이해나 사실 검증이 아니며 걸러지지 않는 오류가 있을 수 있습니다.
export function checkAiOutput(turn, output, { allowedText = '', allowedRefs = [] } = {}) {
  const range = DEBATE_LIMITS.ai[turn?.kind];
  invariant(range, 'INVALID_STEP', '지금은 AI가 발언할 차례가 아닙니다.');
  const raw = typeof output === 'string' ? output : output?.text;
  if (typeof raw !== 'string' || !raw.trim()) throw reject('EMPTY');
  const cleaned = raw.normalize('NFC').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (cleaned.length < range[0]) throw reject('TOO_SHORT');
  let text = cleaned;
  // 조금 넘친 발언은 다시 생성하지 않고, 상한 안의 마지막 완결 문장까지만 씁니다. 질문은 두 문장이 짝이라 자르지 않습니다.
  if (text.length > range[1] && turn.kind !== 'cross_question') {
    const ends = [...text.matchAll(/[.?!。？！](?=\s|$)/gu)].map(match => match.index + 1).filter(end => end <= range[1]);
    if (ends.length && ends.at(-1) >= range[0]) text = text.slice(0, ends.at(-1)).trim();
  }
  if (text.length > range[1]) throw reject('TOO_LONG');
  if (URL_PATTERN.test(text)) throw reject('URL');
  if (detectPII(text).length) throw reject('PII');
  const tagged = [...text.matchAll(HELP_TAG)].map(match => match[1]);
  // 자료 번호([자료 L4H01])와 원문자(①·⑤)는 수치 검사에서 제외합니다.
  const plain = text.replace(HELP_TAG, ' ');
  const numberTokens = value => String(value).replace(/[①-⑳]/g, ' ').normalize('NFKC').replace(/(\d),(?=\d{3})/g, '$1').match(/\d+(?:\.\d+)?%?/g) || [];
  const allowedNumbers = new Set(numberTokens(allowedText));
  if (numberTokens(plain).some(number => !allowedNumbers.has(number))) throw reject('NUMBER_NOT_IN_SOURCE');
  const allowedLatin = new Set((String(allowedText).match(/[A-Za-z]{2,}/g) || []).map(word => word.toLowerCase()));
  if ((plain.match(/[A-Za-z]{2,}/g) || []).some(word => word.toUpperCase() !== 'AI' && !allowedLatin.has(word.toLowerCase()))) throw reject('LATIN_WORD');
  const parts = sentences(plain);
  if (parts.some(part => part.length > DEBATE_LIMITS.sentenceMax)
    || parts.reduce((sum, part) => sum + part.length, 0) / Math.max(parts.length, 1) > DEBATE_LIMITS.sentenceAverageMax) throw reject('SENTENCE_TOO_LONG');
  if (MEDICAL_ADVICE.test(text)) throw reject('MEDICAL_ADVICE');
  if (GHOSTWRITING.test(text)) throw reject('GHOSTWRITING');
  // AI가 질문으로 ⑦을 확인하는 것은 허용하고, 주장·답변에서 사실처럼 쓰는 것만 막습니다.
  if (turn.kind !== 'cross_question' && !HELD_LIMIT.test(text)
    && (HELD_CARD.test(text) || (/의료\s*잡지/.test(text) && /일곱|7\s*명|70\s*%/.test(text)))) throw reject('HELD_SOURCE');
  if (turn.kind === 'cross_question') {
    // 앞의 답에 대한 짧은 응수(두 문장·100자 이하)를 먼저 둘 수 있고, 그 뒤는 물음표로 끝나는 질문 한두 문장이어야 합니다.
    const first = parts.findIndex(part => /[?？]$/.test(part)), lead = first < 0 ? parts : parts.slice(0, first), asks = first < 0 ? [] : parts.slice(first);
    if (!asks.length || asks.length > 2 || asks.some(part => !/[?？]$/.test(part)) || lead.length > 2 || lead.join(' ').length > 100) throw reject('NOT_QUESTION');
  }
  const refs = [...new Set([...(Array.isArray(output?.refs) ? output.refs : []), ...tagged].map(String))];
  if (refs.some(id => !allowedRefs.includes(id))) throw reject('REF_UNKNOWN');
  // 학생이 읽기 어려운 [자료 번호] 표기는 본문에 남기지 않습니다(카드는 발언 아래에 따로 보임).
  if (tagged.length) throw reject('BRACKET_REF');
  return { text, refs };
}

// 모델이 JSON 대신 코드 블록이나 일반 글을 돌려줄 때도 본문을 꺼내 같은 검사를 받게 합니다.
export function parseAiContent(content) {
  if (content && typeof content === 'object') return content;
  const value = String(content ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { const parsed = JSON.parse(value); if (parsed && typeof parsed === 'object') return parsed; } catch { /* 아래에서 다시 시도 */ }
  const start = value.indexOf('{'), end = value.lastIndexOf('}');
  if (start >= 0 && end > start) { try { return JSON.parse(value.slice(start, end + 1)); } catch { /* 일반 글로 처리 */ } }
  return { text: value, refs: [] };
}

export function debateReview(plan, transcript = []) {
  const constructives = transcript.filter(row => row.actor === 'ai' && row.kind === 'constructive' && row.weaknessType);
  return {
    weaknesses: constructives.map(row => ({ turnNo: row.turnNo, label: plan.turns[row.turnNo - 1]?.label || 'AI 입론',
      weaknessType: row.weaknessType, weaknessLabel: WEAKNESS_TYPES[row.weaknessType]?.label || '확인 필요', guide: WEAKNESS_TYPES[row.weaknessType]?.guide || '' })),
    aiTurns: transcript.filter(row => row.actor === 'ai').length,
    fallbackTurns: transcript.filter(row => row.actor === 'ai' && row.mode !== 'ai').length,
    groupTurns: transcript.filter(row => row.actor === 'group').length,
  };
}
