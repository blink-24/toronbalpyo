/* 4차시 대본 전용 순수 엔진. 학생 입론을 완성하거나 외부 AI를 호출하지 않습니다. */
import { invariant, normalizeStance, seedHash, validateFreeText } from './engine.js';

const clone = value => JSON.parse(JSON.stringify(value));
const canonical = value => String(value).normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
const criteria = ['신뢰성', '타당성', '공정성'];
const sessionIdPattern = /^[A-Za-z0-9_-]{8,64}$/;
const helpPattern = /\[자료\s+([A-Za-z][A-Za-z0-9_-]*)\]/g;

function shuffle(values, seed) {
  const result = values.slice();
  let state = seedHash(seed) || 1;
  const next = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; };
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function clueCount(text, keywords) {
  const value = canonical(text);
  return keywords.reduce((sum, keyword) => sum + Number(value.includes(canonical(keyword))), 0);
}

function keywordMatches(text, keywords) {
  const normalized = canonical(text);
  // 수치 단서는 단위·소수점을 지켜 70회/303명 같은 다른 수치를 오인하지 않습니다.
  const numericText = String(text).normalize('NFKC').toLowerCase().replace(/\s/gu, '');
  return [...new Set(keywords)].filter(word => {
    const cue = String(word).normalize('NFKC').toLowerCase().replace(/\s/gu, '');
    if (/^\d+(?:\.\d+)?%?$/.test(cue)) {
      const escaped = cue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`(?<![\\d.])${escaped}(?!\\d|\\.\\d)`, 'u').test(numericText);
    }
    return normalized.includes(canonical(word));
  });
}

function pairs(value) {
  const text = canonical(value), result = new Set();
  for (let i = 0; i < text.length - 1; i++) result.add(text.slice(i, i + 2));
  return result;
}

// 같은 주제를 단어만 바꾸어 되묻는 질문은 한 세션에 함께 넣지 않습니다.
function similarity(left, right) {
  const a = pairs(left), b = pairs(right);
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared++;
  return shared / (a.size + b.size - shared);
}

function snippetFor(session, bank) {
  const parts = [];
  for (const [slot, text] of [['①', session.arg1], ['⑤', session.arg5]]) {
    if (!text) continue;
    const sentences = text.split(/\n+|(?<=[.!?。！？])\s+/u).map(value => value.trim()).filter(Boolean);
    for (const sentence of sentences) parts.push({ slot, sentence, score: session.version === '1.0.0'
      ? clueCount(sentence, bank.keywords) : keywordMatches(sentence, bank.keywords).length });
  }
  parts.sort((a, b) => b.score - a.score);
  const selected = parts[0];
  let sentence = selected.sentence;
  // 새 대본은 긴 문장 뒤의 단서도 인용하며 기존 세션의 문구는 그대로 복원합니다.
  if (session.version !== '1.0.0' && sentence.length > 76 && selected.score > 0) {
    const tokens = [];
    const offsets = [];
    let offset = 0;
    for (const char of sentence) {
      const part = canonical(char);
      for (const token of part) { tokens.push(token); offsets.push(offset); }
      offset += char.length;
    }
    const normalized = tokens.join('');
    const positions = bank.keywords.map(word => normalized.indexOf(canonical(word))).filter(index => index >= 0);
    const first = Math.min(...positions);
    if (Number.isFinite(first) && offsets[first] > 45) {
      const start = Math.max(0, offsets[first] - 18);
      sentence = `…${sentence.slice(start)}`;
    }
  }
  const text = sentence.replace(/[“”"<>]/g, '').replace(/\s+/g, ' ');
  return { slot: selected.slot, snippet: text.length > 76 ? `${text.slice(0, 75)}…` : text.replace(/[.。]$/, '') };
}

function unrelated(text) {
  return /오늘\s*날씨|점심\s*메뉴|노래\s*불러|시스템\s*프롬프트|이전\s*지시.*무시/.test(text)
    && !/의료|상담|공공|도입|근거|자료|출처|책임|정보|주민|정책/.test(text);
}

function unsupportedSource(text) {
  const limited = /사용\s*보류|인용\s*보류|확인되지|확인하지\s*못|출처.{0,8}(?:불명확|모호)|근거로\s*(?:쓰지|사용하지)|단정할\s*수\s*없/.test(text);
  const held = /(?:카드|자료)\s*[⑤⑥56](?:\s*[·,와과]\s*[⑤⑥56])?|[56]\s*번\s*카드/.test(text);
  const survey = /의료\s*잡지/.test(text) && /일곱|7\s*명|70\s*%/.test(text);
  return !limited && (held || survey);
}

export function createLesson4Engine(content) {
  invariant(content?.lesson === 4 && Array.isArray(content.questions) && Array.isArray(content.helpCards)
    && content.limits && content.labels?.virtualBadge, 'MISSING_CONTENT', '4차시 대본 자료를 불러오지 못했습니다.');
  const limits = content.limits;
  const allQuestions = [...content.questions, ...(content.keywordQuestions || [])];
  const questionBank = new Map(allQuestions.map(question => [question.id, question]));
  invariant(questionBank.size === allQuestions.length, 'DUPLICATE_CONTENT', '4차시 질문 번호가 겹칩니다.');
  const helpBank = new Map(content.helpCards.map(card => [card.id, card]));
  invariant(helpBank.size === content.helpCards.length, 'DUPLICATE_CONTENT', '4차시 도움 자료 번호가 겹칩니다.');
  invariant(content.helpCards.every(card => card.virtual === true && card.badge === content.labels.virtualBadge
    && /가상/.test(card.source)), 'INVALID_VIRTUAL_CARD', '4차시 도움 자료에는 가상 자료 표시가 필요합니다.');

  function checkSession(session) {
    invariant([content.version, '1.0.0'].includes(session?.version), 'INVALID_SCRIPT_VERSION', '대본 복원 버전을 확인해 주세요.');
    invariant(session?.lesson === 4 && sessionIdPattern.test(session.sessionId || '') && typeof session.seed === 'string'
      && [3, 4, 5].includes(session.questionCount) && Array.isArray(session.plan)
      && session.plan.length === session.questionCount && Array.isArray(session.answers),
    'INVALID_SESSION', '4차시 대담 기록을 확인해 주세요.');
    invariant(typeof session.arg1 === 'string' && session.arg1.length >= limits.argMin && typeof session.arg5 === 'string',
      'INVALID_SESSION', '우리 모둠 입론을 확인해 주세요.');
    invariant(new Set(session.plan.map(item => item.id)).size === session.questionCount
      && new Set(session.plan.map(item => item.targetKey)).size === session.questionCount,
    'DUPLICATE_QUESTION_TARGET', '질문 계획에 같은 검토 대상이 겹칩니다.');
    for (const item of session.plan) {
      const bank = questionBank.get(item.id);
      invariant(bank && bank.stance === session.stance && bank.targetKey === item.targetKey && bank.criterion === item.criterion,
        'INVALID_SESSION', '4차시 질문 계획을 확인해 주세요.');
      invariant(session.version !== '1.0.0' || !bank.cueId, 'INVALID_SCRIPT_VERSION', '기존 대본의 질문 계획을 확인해 주세요.');
    }
    invariant(session.answers.length <= session.questionCount && session.answers.every((entry, index) =>
      entry.turn === index + 1 && entry.questionId === session.plan[index].id),
    'INVALID_TURN', '확정한 답변의 차례를 확인해 주세요.');
  }

  function buildSession(input) {
    invariant(input && typeof input === 'object', 'INVALID_SESSION', '우리 모둠 입론을 입력해 주세요.');
    const stance = normalizeStance(input.stance);
    invariant(sessionIdPattern.test(input.sessionId || ''), 'INVALID_SESSION_ID', '세션 식별자가 올바르지 않습니다.');
    const questionCount = Number(input.questionCount ?? limits.questionDefault);
    invariant(Number.isInteger(questionCount) && questionCount >= limits.questionMin && questionCount <= limits.questionMax,
      'INVALID_QUESTION_COUNT', '4차시 질문 수는 3~5개입니다.');
    const arg1 = validateFreeText(input.arg1, '① 입론', { min: limits.argMin, max: limits.argMax });
    const arg5 = validateFreeText(input.arg5 ?? '', '⑤ 입론', { min: 0, max: limits.argMax });
    invariant(['string', 'number'].includes(typeof (input.seed ?? input.sessionId)), 'INVALID_SEED', '대담 복원 정보를 확인해 주세요.');
    const seed = String(input.seed ?? input.sessionId);
    invariant(seed.length > 0 && seed.length <= 256, 'INVALID_SEED', '대담 복원 정보를 확인해 주세요.');
    const scriptVersion = input.scriptVersion ?? content.version;
    invariant([content.version, '1.0.0'].includes(scriptVersion), 'INVALID_SCRIPT_VERSION', '지원하는 대본 버전을 확인해 주세요.');
    const text = `${arg1}\n${arg5}`;
    let candidates = shuffle(content.questions.filter(bank => bank.stance === stance), `${seed}:questions`)
      .map(bank => ({ bank, matches: scriptVersion === '1.0.0' ? clueCount(text, bank.keywords) : keywordMatches(text, bank.keywords).length }))
      .filter(item => !item.bank.requiresCue || item.matches > 0)
      .map(item => ({ ...item, score: item.matches * 10 + (item.matches ? item.bank.priority : 0) }))
      .sort((a, b) => b.score - a.score);
    if (scriptVersion !== '1.0.0') {
      const targeted = (content.keywordProfiles || []).flatMap(profile => {
        const matches = keywordMatches(text, profile.keywords).map(canonical);
        if (!matches.length) return [];
        const variants = allQuestions.filter(bank => bank.cueId === profile.id && bank.stance === stance);
        const bank = shuffle(variants, `${seed}:${profile.id}:${stance}:variant`)[0];
        invariant(bank, 'MISSING_QUESTION', '입론 단서의 대응 질문이 부족합니다.');
        // 동의어·반복 나열이 점수를 무한히 올리지 않으며 출처·보류 검토는 우선합니다.
        return [{ bank, matches: matches.length, score: profile.priority * 1000
          + Math.min(matches.length, 3) * 10 + Math.min(Math.max(...matches.map(word => word.length)), 20) }];
      });
      candidates = shuffle([...targeted, ...candidates.map(item => ({ ...item, score: Math.min(item.score, 99) }))], `${seed}:keyword-order`)
        .sort((a, b) => b.score - a.score);
    }
    const selected = [];
    const allowed = item => !selected.some(other => other.bank.targetKey === item.bank.targetKey
      || (scriptVersion !== '1.0.0' && Boolean(other.bank.cueId) !== Boolean(item.bank.cueId)
        && (other.bank.family || other.bank.topic) === (item.bank.family || item.bank.topic))
      || similarity(other.bank.verify, item.bank.verify) >= 0.67);
    // 기준은 반복될 수 있지만, 기본 세 기준은 한 번씩 다루고 대상은 겹치지 않습니다.
    // 새 대본은 감지된 단서를 먼저 확보한 뒤 부족한 기준을 일반 질문으로 채웁니다.
    const criterionOrder = scriptVersion === '1.0.0' ? criteria : criteria.slice().sort((left, right) =>
      (candidates.find(item => item.bank.criterion === right)?.score || 0)
      - (candidates.find(item => item.bank.criterion === left)?.score || 0));
    for (const criterion of criterionOrder) {
      const candidate = candidates.find(item => item.bank.criterion === criterion && allowed(item));
      invariant(candidate, 'MISSING_QUESTION', '입론에 맞는 4차시 질문이 부족합니다.');
      selected.push(candidate);
    }
    for (const candidate of candidates) {
      if (selected.length === questionCount) break;
      if (allowed(candidate)) selected.push(candidate);
    }
    invariant(selected.length === questionCount, 'MISSING_QUESTION', '겹치지 않는 4차시 질문이 부족합니다.');
    selected.sort((a, b) => b.score - a.score || candidates.indexOf(a) - candidates.indexOf(b));
    const plan = selected.map(({ bank, score }) => ({ id: bank.id, criterion: bank.criterion,
      targetKey: bank.targetKey, severity: score }));
    return { version: scriptVersion, lesson: 4, sessionId: input.sessionId, stance, arg1, arg5,
      questionCount, seed, plan, answers: [], mode: 'script' };
  }

  function getQuestion(session, turn) {
    checkSession(session);
    invariant(Number.isInteger(turn) && turn >= 1 && turn <= session.questionCount, 'INVALID_TURN', '질문 순서를 확인해 주세요.');
    const bank = questionBank.get(session.plan[turn - 1].id), selected = snippetFor(session, bank);
    const confirm = bank.confirm.replace('{slot}', selected.slot).replace('{snippet}', selected.snippet);
    const candidates = content.helpCards.filter(card => card.topic === bank.topic && (card.stance === '공통' || card.stance === session.stance));
    const count = limits.helpMin + seedHash(`${session.seed}:${turn}:${bank.id}:count`) % (limits.helpMax - limits.helpMin + 1);
    const helpCards = shuffle(candidates, `${session.seed}:${turn}:${bank.id}:cards`).slice(0, count);
    invariant(helpCards.length === count, 'MISSING_HELP_CARDS', '현재 질문의 가상 도움 자료가 부족합니다.');
    return { id: bank.id, criterion: bank.criterion, targetKey: bank.targetKey, confirm, verify: bank.verify,
      helpCards: helpCards.map(card => ({ ...card })), better: bank.better, turn };
  }

  function recordAnswer(session, input) {
    checkSession(session);
    invariant(!session.reflection, 'SESSION_FINISHED', '제출한 대담의 답변은 바꿀 수 없습니다.');
    const turn = Number(input?.turn);
    invariant(Number.isInteger(turn) && turn >= 1 && turn <= session.questionCount, 'INVALID_TURN', '질문 순서를 확인해 주세요.');
    const answer = validateFreeText(input.answer, '답변', { min: limits.answerMin, max: limits.answerMax });
    const question = getQuestion(session, turn), ids = input.helpIds ?? [];
    invariant(Array.isArray(ids) && ids.length <= limits.helpMax && new Set(ids).size === ids.length
      && ids.every(id => typeof id === 'string' && question.helpCards.some(card => card.id === id)),
    'INVALID_HELP_CARD', '현재 질문에 제시된 가상 도움 자료만 선택해 주세요.');
    const helpIds = ids.slice().sort();
    const quoted = [...answer.matchAll(helpPattern)].map(match => match[1]);
    invariant(quoted.every(id => question.helpCards.some(card => card.id === id)),
      'INVALID_HELP_CARD', '현재 질문에 제시된 자료 번호를 인용해 주세요.');
    if (turn <= session.answers.length) {
      const first = session.answers[turn - 1];
      invariant(first.answer === answer && JSON.stringify(first.helpIds.slice().sort()) === JSON.stringify(helpIds),
        'ANSWER_LOCKED', '이미 확정한 첫 답변은 바꿀 수 없습니다.');
      return clone(session);
    }
    invariant(turn === session.answers.length + 1, 'INVALID_TURN', '이전 질문부터 답해 주세요.');
    return { ...session, answers: [...session.answers, { turn, questionId: question.id, answer, helpIds }] };
  }

  function evaluate(entry, question) {
    const text = entry.answer.trim();
    const quoted = [...text.matchAll(helpPattern)].map(match => match[1]);
    const citation = question.helpCards.some(card => quoted.includes(card.id) || text.includes(card.citation));
    const unsafeSource = unsupportedSource(text);
    const offTopic = unrelated(text);
    const reliability = unsafeSource || offTopic ? '○' : citation ? '●'
      : /출처|원문|자료|조사|근거|확인하지\s*못/.test(text) ? '◐' : '○';
    const connector = /때문에|따라서|그러므로|왜냐하면|그렇기\s*때문|그러나|다만/.test(text);
    const relevant = /의료|상담|공공|도입|주민|정책|접근|이용|책임|법률|정보\s*보호|자료|근거/.test(text);
    const validity = offTopic ? '○' : connector && relevant && text.length >= 45 ? '●'
      : relevant && (connector || text.length >= 35) ? '◐' : '○';
    const admitsLimit = /인정|맞습니다|말씀대로|그\s*점은|다만|확인하지\s*못|단정할\s*수\s*없/.test(text);
    const avoids = /상관없|아무튼|그건\s*중요하지\s*않|답할\s*필요\s*없/.test(text)
      || (/모르겠/.test(text) && text.length < 25);
    const attitude = offTopic || avoids || text.length < 10 ? '피함' : admitsLimit ? '인정함' : '보통';
    return { reliability, validity, attitude, unsafeSource };
  }

  function getFeedback(session) {
    checkSession(session);
    const items = session.answers.map((entry, index) => {
      const question = getQuestion(session, index + 1);
      const { unsafeSource, ...scores } = evaluate(entry, question);
      const comment = unsafeSource ? '사용 보류 카드나 원출처가 불명확한 설문을 확인된 사실로 쓰지 마세요.'
        : scores.attitude === '피함' ? '질문이 겨냥한 부분에 직접 답하고 확인하지 못한 점은 솔직히 밝혀 보세요.'
        : scores.reliability !== '●' ? '현재 제공된 가상 자료의 출처나 번호를 밝히고 확인 범위를 구분해 보세요.'
        : scores.validity !== '●' ? '인용한 자료가 이유와 정책 주장으로 이어지는 범위를 설명해 보세요.'
        : '출처와 논리 연결을 표현했습니다. 가상 자료의 한계와 유지할 조건도 점검해 보세요.';
      return { turn: index + 1, questionId: question.id, criterion: question.criterion,
        criterionDescription: content.criterionDescriptions[question.criterion], confirm: question.confirm,
        verify: question.verify, answer: entry.answer, ...scores, comment, better: question.better };
    });
    const reliabilityGood = items.filter(item => item.reliability === '●').length;
    const validityGood = items.filter(item => item.validity === '●').length;
    const unsafe = session.answers.some(entry => unsupportedSource(entry.answer));
    const weakest = ['reliability', 'validity', 'attitude'].map((key, index) => ({ key, index,
      score: items.reduce((sum, item) => sum + ({ '●': 2, '◐': 1, '○': 0, 인정함: 2, 보통: 1, 피함: 0 }[item[key]]), 0) }))
      .sort((a, b) => a.score - b.score || a.index - b.index)[0].key;
    return { items, summary: { reliabilityGood, validityGood,
      good: reliabilityGood ? '가상 자료의 출처나 번호를 밝혀 답변을 뒷받침했습니다.'
        : validityGood ? '의료 공공 도입의 이유와 근거를 연결해 설명했습니다.' : '모둠 입론에 대한 반대 신문을 읽고 답변을 남겼습니다.',
      improve: weakest === 'reliability' ? '확인한 출처와 가상 자료의 한계를 구분해 밝혀 보세요.'
        : weakest === 'validity' ? '자료가 해당 정책 주장으로 이어지는 이유와 조건을 풀어 설명해 보세요.'
          : '인정할 한계와 유지할 주장을 구별하고 질문에 직접 답해 보세요.',
      cardWarning: unsafe ? '제시문 ⑦의 불명확한 설문과 사용 보류 카드 5·6을 검증된 사실로 쓰지 않습니다.' : '' } };
  }

  function finishSession(session, options = {}) {
    checkSession(session);
    invariant(options.earlyFinish === undefined || typeof options.earlyFinish === 'boolean',
      'INVALID_EARLY_FINISH', '조기 종료 여부를 확인해 주세요.');
    const actual = session.answers.length;
    invariant(actual >= limits.earlyFinishMin && (actual === session.questionCount || options.earlyFinish === true),
      'NOT_ENOUGH_ANSWERS', '세 번째 답까지 마친 뒤 피드백과 성찰을 제출해 주세요.');
    const reflection = validateFreeText(options.reflection, '성찰', { min: limits.reflectionMin, max: limits.reflectionMax });
    if (session.reflection) {
      invariant(session.reflection === reflection && session.earlyFinish === (actual < session.questionCount),
        'SESSION_FINISHED', '제출한 대담의 성찰은 바꿀 수 없습니다.');
      return clone(session);
    }
    return { ...session, reflection, earlyFinish: actual < session.questionCount,
      completedQuestionCount: actual, feedback: getFeedback(session) };
  }

  return { buildSession, getQuestion, recordAnswer, getFeedback, finishSession };
}
