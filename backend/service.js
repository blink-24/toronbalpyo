import { createEngine, DomainError, invariant, normalizeStance, validateStudentId, validateFreeText, sanitizeCell,
  detectPII, validateQuestionOutput, validateFeedbackOutput, isClearlyUnrelated } from '../src/core/engine.js';
import { createLesson4Engine } from '../src/core/lesson4.js';
import LESSON4_CONTENT from '../src/core/lesson4-content.js';

export const VERSION = '5.2.0';
export const COMMON_HEADERS = ['receivedAt', 'submissionId', 'studentId', 'cls', 'groupNo', 'lesson', 'clientTs', 'appVersion'];
export const HEADERS = {
  config: ['key', 'value', 'note'],
  l2_sessions: [...COMMON_HEADERS, 'sessionId', 'stance', 'reasonId', 'reasonText', 'cardId', 'argText',
    ...[1, 2, 3].flatMap(n => [`q${n}Id`, `q${n}Crit`, `q${n}Text`, `a${n}Text`, `a${n}Help`]),
    'feedback', 'reflection', 'mode', 'durationSec', 'ruleFeedback', 'aiFeedback', 'earlyFinish', 'completedQuestionCount', 'payloadHash'],
  ai_log: [...COMMON_HEADERS, 'sessionId', 'turn', 'role', 'text', 'meta', 'mode', 'provider', 'model', 'latencyMs', 'error'],
  l3_args: [...COMMON_HEADERS, 'arg1', 'cards1', 'arg5', 'cards5', 'sources', 'chk1', 'chk2', 'chk3', 'chk4', 'chk5'],
  l4_sessions: [...COMMON_HEADERS, 'sessionId', 'part', ...[1, 2, 3, 4, 5].flatMap(n => [`q${n}`, `a${n}`, `help${n}`]), 'feedback', 'reflection', 'mode',
    'groupName', 'groupKey', 'memberStudentIds', 'stance', 'arg1', 'arg5', 'completedQuestionCount', 'earlyFinish', 'durationSec', 'ruleFeedback', 'payloadHash'],
  recordings: [...COMMON_HEADERS, 'members', 'mp4Url', 'txtUrl', 'mp4Name', 'txtName'],
  uploads: [...COMMON_HEADERS, 'uploadId', 'fileName', 'mimeType', 'bytes', 'fileId', 'fileUrl'],
  log: ['ts', 'level', 'action', 'submissionId', 'message'],
  progress: [...COMMON_HEADERS, 'sessionId', 'stage', ...[1, 2, 3, 4, 5, 6, 7, 8].map(n => `state${n}`)],
};

function checkId(value, label = '식별자') {
  invariant(typeof value === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(value), 'INVALID_ID', `${label} 형식을 확인해 주세요.`);
  return value;
}
function parseJSON(value, fallback = null) { try { return typeof value === 'string' ? JSON.parse(value) : value || fallback; } catch { return fallback; } }
function safeText(value) { return typeof value === 'string' ? value : value == null ? '' : String(value); }
function collectLimits(value, depth = 0) {
  invariant(depth < 12, 'INVALID_PAYLOAD', '입력 구조가 너무 복잡합니다.');
  if (typeof value === 'string') invariant(value.length <= 2000, 'INVALID_LENGTH', '한 입력란은 2000자를 넘을 수 없습니다.');
  else if (Array.isArray(value)) { invariant(value.length <= 40, 'INVALID_PAYLOAD', '입력 목록이 너무 깁니다.'); value.forEach(x => collectLimits(x, depth + 1)); }
  else if (value && typeof value === 'object') { invariant(Object.keys(value).length <= 80, 'INVALID_PAYLOAD', '입력 항목이 너무 많습니다.'); Object.values(value).forEach(x => collectLimits(x, depth + 1)); }
}
function compactFeedback(feedback, textLimit = 100) {
  if (!feedback) return null;
  return { items: feedback.items.map(x => ({ turn: x.turn, criterion: x.criterion, reliability: x.reliability, validity: x.validity,
    attitude: x.attitude, comment: x.comment.slice(0, textLimit), better: x.better.slice(0, textLimit) })),
    summary: { good: feedback.summary.good.slice(0, textLimit), improve: feedback.summary.improve.slice(0, textLimit) } };
}
function constantEqual(a, b) {
  if (!a || !b) return false;
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
export function createService({ content, lesson4Content = LESSON4_CONTENT, store, properties, clock = () => Date.now(), hash, providerCall = null }) {
  const engine = createEngine(content);
  const lesson4Engine = createLesson4Engine(lesson4Content);
  const now = () => new Date(clock()).toISOString();
  const prop = key => safeText(properties.get(key));
  const rows = tab => store.read(tab) || [];
  const locked = fn => store.withLock(fn);
  function cacheGet(key) { try { return properties.get(key); } catch { return null; } }
  function cacheSet(key, value) { try { properties.set(key, value); return true; } catch { return false; } }
  function append(tab, values) {
    const safe = {};
    for (const field of HEADERS[tab]) {
      const val = values[field] ?? '';
      const cell = typeof val === 'object' ? JSON.stringify(val) : val;
      safe[field] = sanitizeCell(cell);
      invariant(typeof safe[field] !== 'string' || safe[field].length <= 2000, 'STORAGE_LENGTH', '기록할 입력란이 너무 깁니다.');
    }
    store.append(tab, safe);
  }
  function config() {
    const source = Object.fromEntries(rows('config').map(x => [x.key, x.value]));
    const integer = (key, base, low, high) => { const n = Number(source[key] || base); return Number.isInteger(n) && n >= low && n <= high ? n : base; };
    const accepts = [...new Set(safeText(source.acceptLessons == null ? '2' : source.acceptLessons).split(',').map(Number).filter(x => x === 2 || x === 4))];
    const provider = prop('AI_PROVIDER');
    return { grade: integer('grade', 2, 1, 3), classCount: integer('classCount', 11, 1, 99), groupMax: integer('groupMax', 8, 1, 20),
      acceptLessons: accepts, l2Questions: integer('l2Questions', 3, 2, 3), aiEnabled: ['anthropic', 'gemini'].includes(provider) && Boolean(prop('AI_MODEL') && prop('AI_API_KEY')),
      publicSharing: safeText(source.publicSharing || 'true') === 'true', appVersion: VERSION, implementedLessons: [2, 4],
      l4Questions: integer('l4Questions', 4, 3, 5), l4AiEnabled: false, l4ScriptVersion: lesson4Content.version,
      lessons: { 2: { enabled: accepts.includes(2) }, 3: { enabled: false, reason: '아직 열리지 않음' }, 4: { enabled: accepts.includes(4), mode: 'script' } } };
  }
  function teacher(request) {
    invariant(prop('PASSCODE'), 'AUTH_NOT_CONFIGURED', '교사 화면 암호가 아직 설정되지 않았습니다.');
    const supplied = safeText(request.passcode);
    invariant(supplied.length <= 128 && constantEqual(prop('PASSCODE'), supplied), 'UNAUTHORIZED', '교사 암호를 확인해 주세요.');
  }
  function identity(request) {
    const result = validateStudentId(safeText(request.studentId), config());
    invariant(request.cls === undefined || Number(request.cls) === result.cls, 'INVALID_CLASS', '학번의 반과 입력한 반이 다릅니다.');
    return result;
  }
  function requireLesson(request, lesson = 2) {
    invariant(Number(request.lesson || 2) === lesson && [2, 4].includes(lesson), 'LESSON_NOT_IMPLEMENTED', '현재는 2차시·4차시 체험만 지원합니다.');
    invariant(config().acceptLessons.includes(lesson), 'LESSON_CLOSED', `아직 ${lesson}차시 활동이 열리지 않았습니다.`);
  }
  function common(request, actor) {
    return { receivedAt: now(), submissionId: request.submissionId || '', studentId: actor.studentId, cls: actor.cls, groupNo: '', lesson: Number(request.lesson || 2),
      clientTs: safeText(request.clientTs || ''), appVersion: safeText(request.appVersion || VERSION) };
  }
  function stateRowFor(sessionId, lesson = 2) {
    const found = rows('progress').filter(x => x.sessionId === sessionId && Number(x.lesson || 2) === lesson && x.state1);
    if (!found.length) return null;
    return found[found.length - 1];
  }
  function stateFromRow(latest) {
    if (!latest) return null;
    return parseJSON([1, 2, 3, 4, 5, 6, 7, 8].map(n => { const part = latest[`state${n}`] || ''; return String(part).startsWith('~') ? String(part).slice(1) : part; }).join(''));
  }
  function stateFor(sessionId, lesson = 2) { return stateFromRow(stateRowFor(sessionId, lesson)); }
  function stateText(state) {
    // 4차시 피드백은 엔진으로 다시 계산할 수 있으므로 긴 입론·답변을 상태에 중복 저장하지 않습니다.
    const snapshot = Number(state.lesson) === 4 ? Object.fromEntries(Object.entries(state).filter(([key]) => !['feedback', 'questionCache'].includes(key))) : state;
    const text = JSON.stringify(snapshot);
    invariant(text.length <= 15992, 'STORAGE_LENGTH', '세션 기록이 너무 깁니다.');
    return text;
  }
  function saveState(state, request, actor, stage) {
    const text = stateText(state);
    const value = { ...common(request, actor), sessionId: state.sessionId, stage };
    for (let n = 1; n <= 8; n++) { const part = text.slice((n - 1) * 1999, n * 1999); value[`state${n}`] = part ? `~${part}` : ''; }
    append('progress', value);
  }
  function publicState(state) {
    const { studentId, cls, reprompted, ...rest } = state;
    return rest;
  }
  function buildFrom(request, actor, existing = null) {
    const supplied = request.selection || request.data?.selection || request.data || {};
    const source = { stance: supplied.stance, reasonId: supplied.reasonId, reasonText: supplied.reasonText, cardId: supplied.cardId,
      argText: supplied.argText, sessionId: checkId(request.sessionId || supplied.sessionId, '세션 식별자'),
      questionCount: existing?.questionCount || config().l2Questions, seed: supplied.seed || request.seed || request.sessionId || supplied.sessionId };
    const fresh = engine.buildSession(source);
    if (!existing) return { ...fresh, studentId: actor.studentId, cls: actor.cls, reprompted: [] };
    invariant(existing.studentId === actor.studentId && Number(existing.cls) === actor.cls, 'SESSION_OWNER_MISMATCH', '다른 학생의 세션을 사용할 수 없습니다.');
    invariant(['stance', 'reasonId', 'reasonText', 'cardId', 'argText'].every(k => fresh[k] === existing[k]), 'SESSION_LOCKED', '대담을 시작한 입론은 새 세션에서 변경해 주세요.');
    return existing;
  }
  function historyInto(state, history = [], sessionEngine = engine) {
    invariant(Array.isArray(history) && history.length <= state.questionCount, 'INVALID_HISTORY', '대담 기록을 확인해 주세요.');
    let next = state;
    for (let i = 0; i < history.length; i++) {
      const value = history[i], question = sessionEngine.getQuestion(next, i + 1);
      invariant(!value.questionId || value.questionId === question.id, 'QUESTION_MISMATCH', '질문 계획과 기록이 다릅니다.');
      next = sessionEngine.recordAnswer(next, { turn: i + 1, answer: value.answer ?? value.a, helpIds: value.helpIds || value.help || [] });
    }
    return next;
  }
  function logTurn(state, actor, request, turn, role, text, question, mode, meta = {}) {
    const lesson = Number(request.lesson || 2), marker = `log:${lesson === 4 ? '4:' : ''}${state.sessionId}:${turn}:${role}`;
    if (cacheGet(marker)) return;
    // 속성은 가속용입니다. 기록한 로그가 있으면 캐시가 없어도 같은 차례를 다시 쓰지 않습니다.
    if (rows('ai_log').some(row => Number(row.lesson || 2) === lesson && row.sessionId === state.sessionId && Number(row.turn) === Number(turn) && row.role === role)) return;
    append('ai_log', { ...common(request, actor), sessionId: state.sessionId, turn, role, text,
      meta: { questionId: question?.id || '', criterion: question?.criterion || '', targetKey: question?.targetKey || '', helpIds: question?.helpCards?.map(x => x.id) || [], ...meta },
      mode, provider: mode === 'ai' ? prop('AI_PROVIDER') : 'none', model: mode === 'ai' ? prop('AI_MODEL') : '', latencyMs: meta.latencyMs || 0, error: meta.error || '' });
    cacheSet(marker, '1');
  }
  function settings() { return { provider: prop('AI_PROVIDER'), model: prop('AI_MODEL'), key: prop('AI_API_KEY') }; }
  function aiAllowed(actor) {
    if (!config().aiEnabled || !providerCall) return false;
    return locked(() => {
      const key = `rate:${actor.studentId}:${Math.floor(clock() / 3600000)}`, used = Number(prop(key) || 0), requestedMax = Number(prop('AI_RATE_PER_HOUR') || 30);
      const max = Number.isInteger(requestedMax) && requestedMax >= 1 && requestedMax <= 300 ? requestedMax : 30;
      if (used >= max) return false;
      // 사용량을 확정하지 못하면 AI 호출을 하지 않아 학생별 한도를 우회하지 않습니다.
      return cacheSet(key, String(used + 1));
    });
  }
  function aiPayload(state, task, question = null) {
    const card = content.evidenceCards.find(x => x.id === state.cardId);
    // 여기에 학생 식별자·반·모둠·세션ID·이름·기기정보를 넣지 않습니다.
    const payload = { task, lesson: 2, stance: state.stance, argText: state.argText,
      card: { id: card.id, source: card.source, year: card.year, method: card.method, content: card.content, virtual: true },
      history: state.answers.map((x, i) => { const q = engine.getQuestion(state, i + 1); return { q: `${q.confirm} ${q.verify}`, a: x.answer }; }) };
    if (question) {
      const targetText = question.targetKey === 'reason' ? state.reasonText : question.targetKey === 'card-source' ? card.source : question.targetKey === 'card-content' ? card.content : state.stance;
      payload.turn = question.turn;
      payload.plan = { criterion: question.criterion, target: question.targetKey, targetText, fallbackId: question.id };
    } else payload.plan = state.answers.map((x, i) => ({ turn: i + 1, criterion: state.plan[i].criterion, fallbackId: x.questionId }));
    invariant(detectPII(JSON.stringify(payload)).length === 0, 'PII_DETECTED', '개인정보를 제외한 글로 다시 입력해 주세요.');
    return payload;
  }
  function makeQuestion(state, actor, requestedMode) {
    const q = engine.getQuestion(state, state.answers.length + 1), start = clock();
    const cached = state.questionCache && state.questionCache[q.turn];
    if (cached) return { question: { ...q, confirm: cached.confirm, verify: cached.verify }, mode: cached.mode, latencyMs: 0 };
    if (requestedMode === 'script' || !aiAllowed(actor)) return { question: q, mode: 'script', latencyMs: 0 };
    try {
      const value = providerCall('question', aiPayload(state, 'question', q), settings());
      invariant(clock() - start <= 20000, 'AI_TIMEOUT', 'AI 응답 제한 시간을 넘었습니다.');
      const output = validateQuestionOutput(value, q);
      return { question: { ...q, ...output }, mode: 'ai', latencyMs: clock() - start };
    } catch (error) { return { question: q, mode: 'script', error: error.code || 'AI_UNAVAILABLE', latencyMs: clock() - start }; }
  }
  function handleTurn(request) {
    requireLesson(request); const actor = identity(request), sid = checkId(request.sessionId, '세션 식별자');
    const prepared = locked(() => {
      requireLesson(request);
      let state = buildFrom(request, actor, stateFor(sid));
      invariant(!state.completedQuestionCount, 'SESSION_COMPLETED', '이미 제출한 체험입니다. 새 체험에서 다시 시작해 주세요.');
      const history = request.history || [];
      // 명백히 주제 밖인 짧은 답은 한 번만 같은 질문으로 돌려보냅니다.
      const last = history[history.length - 1];
      if (last && history.length > state.answers.length && isClearlyUnrelated(last.answer || '') && !state.reprompted.includes(history.length)) {
        const turn = history.length; state = { ...state, reprompted: [...state.reprompted, turn] };
        saveState(state, request, actor, `question${turn}`);
        return { retry: true, state, question: engine.getQuestion(state, turn), turn };
      }
      const before = state.answers.length; state = historyInto(state, history);
      for (let i = before; i < state.answers.length; i++) {
        const q = engine.getQuestion(state, i + 1); logTurn(state, actor, request, i + 1, 'student', state.answers[i].answer, q, request.clientMode || 'script');
      }
      if (request.mode !== 'feedback') invariant(Number(request.turn) === state.answers.length + 1 && Number(request.turn) <= state.questionCount, 'INVALID_TURN', '질문 순서를 확인해 주세요.');
      else invariant(state.answers.length >= 2, 'NOT_ENOUGH_ANSWERS', '두 번째 답까지 마친 뒤 피드백을 볼 수 있습니다.');
      saveState(state, request, actor, request.mode === 'feedback' ? 'feedback' : `question${request.turn}`);
      return { state };
    });
    if (prepared.retry) return { sessionId: sid, turn: prepared.turn, question: prepared.question, retry: true, prompt: '질문에 대한 답을 써 주세요.', mode: 'script' };
    const state = prepared.state;
    if (request.mode === 'feedback') {
      const ruleFeedback = engine.getFeedback(state);
      ruleFeedback.items = ruleFeedback.items.map(item => ({ ...item, ...(state.questionCache && state.questionCache[item.turn] ? { confirm: state.questionCache[item.turn].confirm, verify: state.questionCache[item.turn].verify } : {}) }));
      let feedback = ruleFeedback, mode = 'script';
      if (request.forceMode !== 'script' && aiAllowed(actor)) {
        const start = clock();
        try {
          const output = providerCall('feedback', aiPayload(state, 'feedback'), settings());
          invariant(clock() - start <= 20000, 'AI_TIMEOUT', 'AI 응답 제한 시간을 넘었습니다.');
          const evaluated = validateFeedbackOutput(output, ruleFeedback.items);
          feedback = { ...evaluated, summary: { ...ruleFeedback.summary, ...evaluated.summary,
            reliabilityGood: evaluated.items.filter(x => x.reliability === '●').length,
            validityGood: evaluated.items.filter(x => x.validity === '●').length } }; mode = 'ai';
        } catch { feedback = ruleFeedback; }
      }
      locked(() => {
        requireLesson(request);
        const current = stateFor(sid);
        // 피드백 호출 중 로컬 대본 제출이 끝났으면 완료 기록을 그대로 보존합니다.
        if (current.completedQuestionCount) { feedback = engine.getFeedback(current); mode = 'script'; return; }
        const next = { ...current, aiFeedback: mode === 'ai' ? compactFeedback(feedback) : null, feedbackMode: mode };
        saveState(next, request, actor, 'feedback');
        logTurn(next, actor, request, 0, 'system', '피드백을 생성했습니다.', null, mode);
      });
      return { sessionId: sid, feedback, ruleFeedback, mode };
    }
    const generated = makeQuestion(state, actor, request.forceMode);
    locked(() => {
      requireLesson(request);
      const current = stateFor(sid), turn = generated.question.turn, cached = current.questionCache && current.questionCache[turn];
      // 브라우저가 20초 뒤 로컬 대본으로 답한 경우, 늦은 AI 응답으로 기록·단계를 되돌리지 않습니다.
      if (current.answers.length >= turn || current.completedQuestionCount) {
        generated.question = engine.getQuestion(current, turn); generated.mode = 'script'; return;
      }
      if (cached) { generated.question = { ...generated.question, confirm: cached.confirm, verify: cached.verify }; generated.mode = cached.mode; }
      else saveState({ ...current, mode: generated.mode, questionCache: { ...current.questionCache, [turn]: { confirm: generated.question.confirm, verify: generated.question.verify, mode: generated.mode } } }, request, actor, `question${turn}`);
      logTurn(state, actor, request, turn, 'ai', `${generated.question.confirm} ${generated.question.verify}`, generated.question, generated.mode,
        { latencyMs: generated.latencyMs, error: generated.error || '' });
    });
    return { sessionId: sid, turn: generated.question.turn, question: generated.question, mode: generated.mode };
  }
  function recoverSubmittedState(request, actor, durable) {
    const sid = checkId(durable.sessionId, '세션 식별자'), existing = stateFor(sid);
    if (existing?.completedQuestionCount && stateRowFor(sid)?.stage === 'submitted') return;
    invariant(!existing || existing.studentId === actor.studentId && Number(existing.cls) === actor.cls,
      'SESSION_OWNER_MISMATCH', '다른 학생의 세션을 사용할 수 없습니다.');
    const data = request.data || {}, count = Number(durable.completedQuestionCount);
    const early = durable.earlyFinish === true || durable.earlyFinish === 'true';
    // 이미 저장된 제출의 문항 수를 사용하므로 이후 설정 변경·진행 재시도에 영향을 받지 않습니다.
    let state = { ...engine.buildSession({ ...data, sessionId: sid, questionCount: early ? 3 : count,
      seed: existing?.seed || data.seed || sid }), studentId: actor.studentId, cls: actor.cls,
      reprompted: existing?.reprompted || [], questionCache: existing?.questionCache || {} };
    const answers = Array.isArray(data.answers) && data.answers.length >= count ? data.answers : existing?.answers || [];
    state = historyInto(state, answers.slice(0, count));
    state = engine.finishSession(state, { reflection: data.reflection, earlyFinish: early });
    const aiFeedback = parseJSON(durable.aiFeedback);
    saveState({ ...state, mode: durable.mode, ...(aiFeedback ? { aiFeedback, feedbackMode: 'ai' } : {}) }, request, actor, 'submitted');
  }
  function submit(request) {
    requireLesson(request); invariant(request.kind === 'l2_session', 'KIND_LESSON_MISMATCH', '현재는 2차시 체험 제출만 가능합니다.');
    const actor = identity(request), id = checkId(request.submissionId, '제출 식별자'), data = request.data || {};
    const fingerprint = hash(JSON.stringify({ actor: actor.studentId, lesson: 2, sessionId: request.sessionId || data.sessionId,
      stance: data.stance, reasonId: data.reasonId, reasonText: data.reasonText, cardId: data.cardId, argText: data.argText, answers: data.answers, reflection: data.reflection, earlyFinish: data.earlyFinish }));
    return locked(() => {
      requireLesson(request);
      const dedupe = parseJSON(cacheGet(`submission:${id}`));
      if (dedupe) { invariant(dedupe.fingerprint === fingerprint, 'IDEMPOTENCY_CONFLICT', '같은 제출 식별자로 다른 내용을 보낼 수 없습니다.'); return { ...dedupe.result, duplicate: true }; }
      const durable = [...rows('l2_sessions'), ...rows('l4_sessions')].find(x => x.submissionId === id);
      if (durable) {
        invariant(durable.payloadHash === fingerprint, 'IDEMPOTENCY_CONFLICT', '같은 제출 식별자로 다른 내용을 보낼 수 없습니다.');
        recoverSubmittedState(request, actor, durable);
        return { accepted: true, submissionId: id, sessionId: durable.sessionId, completedQuestionCount: Number(durable.completedQuestionCount), duplicate: true };
      }
      const sid = checkId(request.sessionId || data.sessionId, '세션 식별자'), old = stateFor(sid);
      let state = buildFrom({ ...request, sessionId: sid, selection: data }, actor, old);
      const before = state.answers.length;
      state = historyInto(state, data.answers || []);
      state = engine.finishSession(state, { reflection: data.reflection, earlyFinish: data.earlyFinish });
      const mode = ['ai', 'script', 'script-local'].includes(data.mode) ? data.mode : 'script';
      const row = { ...common(request, actor), sessionId: sid, stance: state.stance, reasonId: state.reasonId, reasonText: state.reasonText,
        cardId: state.cardId, argText: state.argText, reflection: state.reflection, mode,
        durationSec: Math.max(0, Math.min(86400, Number(data.durationSec) || 0)), earlyFinish: state.earlyFinish, completedQuestionCount: state.answers.length, payloadHash: fingerprint,
        feedback: { rule: state.feedback.items.map(({ reliability, validity, attitude }) => ({ reliability, validity, attitude })), ai: old?.aiFeedback?.items.map(({ reliability, validity, attitude }) => ({ reliability, validity, attitude })) || null },
        ruleFeedback: compactFeedback(state.feedback), aiFeedback: old?.aiFeedback || '' };
      for (let i = 0; i < state.answers.length; i++) {
        const q = engine.getQuestion(state, i + 1), a = state.answers[i], n = i + 1;
        const display = state.questionCache && state.questionCache[n] || q;
        row[`q${n}Id`] = q.id; row[`q${n}Crit`] = q.criterion; row[`q${n}Text`] = `${display.confirm} ${display.verify}`; row[`a${n}Text`] = a.answer; row[`a${n}Help`] = a.helpIds;
        if (i >= before) logTurn(state, actor, request, n, 'student', a.answer, q, mode);
        logTurn(state, actor, request, n, 'ai', row[`q${n}Text`], q, mode);
      }
      append('l2_sessions', row); saveState({ ...state, studentId: actor.studentId, cls: actor.cls, mode }, request, actor, 'submitted');
      const result = { accepted: true, submissionId: id, sessionId: sid, completedQuestionCount: state.answers.length, duplicate: false };
      cacheSet(`submission:${id}`, JSON.stringify({ fingerprint, result }));
      return result;
    });
  }
  function groupIdentity(request) {
    const actor = identity(request);
    invariant(typeof request.groupName === 'string', 'INVALID_GROUP', '모둠명을 입력해 주세요.');
    const groupName = validateFreeText(request.groupName.normalize('NFKC').trim().replace(/\s+/g, ' '), '모둠명', { min: 1, max: 30 });
    invariant(Array.isArray(request.memberStudentIds) && request.memberStudentIds.length >= 4 && request.memberStudentIds.length <= 5,
      'INVALID_MEMBERS', '대표를 포함한 모둠원 4~5명의 학번을 입력해 주세요.');
    const members = request.memberStudentIds.map(value => {
      invariant(typeof value === 'string', 'INVALID_MEMBERS', '모둠원 학번은 숫자 5자리로 입력해 주세요.');
      const member = validateStudentId(value, config());
      invariant(member.cls === actor.cls, 'INVALID_MEMBERS', '모둠원은 모두 같은 반이어야 합니다.'); return member.studentId;
    });
    invariant(new Set(members).size === members.length && members.includes(actor.studentId), 'INVALID_MEMBERS', '학번의 중복을 없애고 대표 학번도 포함해 주세요.');
    return { ...actor, groupName, groupKey: `${actor.cls}:${groupName.toLowerCase()}`, memberStudentIds: members.slice().sort() };
  }
  function groupMeta(actor) {
    return { studentId: actor.studentId, cls: actor.cls, groupName: actor.groupName, groupKey: actor.groupKey, memberStudentIds: actor.memberStudentIds };
  }
  function assertGroupOwner(state, actor) {
    invariant(Number(state.cls) === actor.cls && state.groupKey === actor.groupKey
      && JSON.stringify(state.memberStudentIds) === JSON.stringify(actor.memberStudentIds),
    'SESSION_OWNER_MISMATCH', '다른 대표·모둠원의 세션을 사용할 수 없습니다.');
  }
  function buildLesson4From(request, actor, existing = null, questionCount = null) {
    const supplied = request.selection || request.data || {}, sid = checkId(request.sessionId || supplied.sessionId, '세션 식별자');
    if (existing) assertGroupOwner(existing, actor);
    const fresh = lesson4Engine.buildSession({ stance: supplied.stance, arg1: supplied.arg1, arg5: supplied.arg5,
      sessionId: sid, questionCount: questionCount || existing?.questionCount || config().l4Questions,
      scriptVersion: existing?.version || supplied.scriptVersion || supplied.version
        || (/^5\.1\./.test(safeText(request.appVersion)) ? '1.0.0' : lesson4Content.version),
      seed: existing?.seed || supplied.seed || request.seed || sid });
    if (!existing || existing.draft) return { ...fresh, ...groupMeta(actor) };
    invariant(['stance', 'arg1', 'arg5'].every(key => fresh[key] === existing[key]), 'SESSION_LOCKED', '대담을 시작한 입론은 새 세션에서 변경해 주세요.');
    return { ...existing, studentId: actor.studentId };
  }
  function handleLesson4Turn(request) {
    requireLesson(request, 4); const actor = groupIdentity(request), sid = checkId(request.sessionId, '세션 식별자');
    invariant(['question', 'feedback'].includes(request.mode), 'INVALID_MODE', '질문 또는 피드백 요청을 확인해 주세요.');
    return locked(() => {
      requireLesson(request, 4);
      let state = buildLesson4From(request, actor, stateFor(sid, 4));
      invariant(!state.completedQuestionCount, 'SESSION_COMPLETED', '이미 제출한 체험입니다. 새 체험에서 다시 시작해 주세요.');
      const before = state.answers.length; state = historyInto(state, request.history || [], lesson4Engine);
      stateText(state);
      if (request.mode === 'feedback') invariant(state.answers.length >= 3, 'NOT_ENOUGH_ANSWERS', '세 번째 답까지 마친 뒤 피드백을 볼 수 있습니다.');
      else invariant(Number(request.turn) === state.answers.length + 1 && Number(request.turn) <= state.questionCount, 'INVALID_TURN', '질문 순서를 확인해 주세요.');
      for (let i = before; i < state.answers.length; i++) {
        const q = lesson4Engine.getQuestion(state, i + 1); logTurn(state, actor, request, i + 1, 'student', state.answers[i].answer, q, 'script');
      }
      if (request.mode === 'feedback') {
        const feedback = lesson4Engine.getFeedback(state);
        saveState(state, request, actor, 'feedback'); logTurn(state, actor, request, 0, 'system', '피드백을 생성했습니다.', null, 'script');
        return { sessionId: sid, feedback, ruleFeedback: feedback, mode: 'script' };
      }
      const question = lesson4Engine.getQuestion(state, Number(request.turn));
      saveState(state, request, actor, `question${request.turn}`);
      logTurn(state, actor, request, question.turn, 'ai', `${question.confirm} ${question.verify}`, question, 'script');
      return { sessionId: sid, turn: question.turn, question, mode: 'script' };
    });
  }
  function recoverLesson4Submitted(request, actor, durable) {
    const sid = checkId(durable.sessionId, '세션 식별자'), existing = stateFor(sid, 4);
    if (existing) assertGroupOwner(existing, actor);
    if (existing?.completedQuestionCount && stateRowFor(sid, 4)?.stage === 'submitted') return;
    const count = Number(durable.completedQuestionCount), data = request.data || {}, early = durable.earlyFinish === true || durable.earlyFinish === 'true';
    const questionCount = Number(parseJSON(durable.feedback)?.questionCount) || existing?.questionCount || (early ? Math.min(5, count + 1) : count);
    let state = buildLesson4From({ ...request, selection: { ...data, seed: existing?.seed || data.seed || sid } }, actor, null, questionCount);
    const answers = Array.isArray(data.answers) && data.answers.length >= count ? data.answers : existing?.answers || [];
    state = historyInto(state, answers.slice(0, count), lesson4Engine);
    state = lesson4Engine.finishSession(state, { reflection: data.reflection, earlyFinish: early });
    saveState({ ...state, mode: 'script' }, request, actor, 'submitted');
  }
  function submitLesson4(request) {
    requireLesson(request, 4); invariant(request.kind === 'l4_session', 'KIND_LESSON_MISMATCH', '4차시 모둠 체험 제출 형식을 확인해 주세요.');
    const actor = groupIdentity(request), id = checkId(request.submissionId, '제출 식별자'), data = request.data || {};
    const sid = checkId(request.sessionId || data.sessionId, '세션 식별자');
    const fingerprint = hash(JSON.stringify({ actor: actor.studentId, lesson: 4, sessionId: sid, groupKey: actor.groupKey,
      memberStudentIds: actor.memberStudentIds, stance: data.stance, arg1: data.arg1, arg5: data.arg5,
      answers: data.answers, reflection: data.reflection, earlyFinish: data.earlyFinish }));
    return locked(() => {
      requireLesson(request, 4);
      const dedupe = parseJSON(cacheGet(`submission:${id}`));
      if (dedupe) { invariant(dedupe.fingerprint === fingerprint, 'IDEMPOTENCY_CONFLICT', '같은 제출 식별자로 다른 내용을 보낼 수 없습니다.'); return { ...dedupe.result, duplicate: true }; }
      const durable = [...rows('l2_sessions'), ...rows('l4_sessions')].find(row => row.submissionId === id);
      if (durable) {
        invariant(durable.payloadHash === fingerprint, 'IDEMPOTENCY_CONFLICT', '같은 제출 식별자로 다른 내용을 보낼 수 없습니다.');
        recoverLesson4Submitted(request, actor, durable);
        return { accepted: true, submissionId: id, sessionId: sid, completedQuestionCount: Number(durable.completedQuestionCount), duplicate: true };
      }
      let state = buildLesson4From({ ...request, sessionId: sid, selection: data }, actor, stateFor(sid, 4));
      invariant(!state.completedQuestionCount, 'SESSION_COMPLETED', '이미 제출한 체험입니다. 새 체험에서 다시 시작해 주세요.');
      const before = state.answers.length;
      state = historyInto(state, data.answers || [], lesson4Engine);
      state = lesson4Engine.finishSession(state, { reflection: data.reflection, earlyFinish: data.earlyFinish });
      stateText(state); // 저장 크기 초과를 로그·제출 행을 쓰기 전에 거부합니다.
      const feedback = compactFeedback(state.feedback, 60);
      const row = { ...common(request, actor), sessionId: sid, part: data.arg5 ? '1,5' : '1', ...groupMeta(actor), stance: state.stance,
        arg1: state.arg1, arg5: state.arg5, completedQuestionCount: state.answers.length, earlyFinish: state.earlyFinish,
        durationSec: Math.max(0, Math.min(86400, Number(data.durationSec) || 0)), mode: 'script', reflection: state.reflection,
        feedback: { ...feedback, questionCount: state.questionCount }, ruleFeedback: feedback, payloadHash: fingerprint };
      for (let i = 0; i < state.answers.length; i++) {
        const q = lesson4Engine.getQuestion(state, i + 1), a = state.answers[i], n = i + 1;
        row[`q${n}`] = `${q.confirm} ${q.verify}`; row[`a${n}`] = a.answer; row[`help${n}`] = a.helpIds;
        if (i >= before) logTurn(state, actor, request, n, 'student', a.answer, q, 'script');
        logTurn(state, actor, request, n, 'ai', row[`q${n}`], q, 'script');
      }
      append('l4_sessions', row); saveState({ ...state, mode: 'script' }, request, actor, 'submitted');
      const result = { accepted: true, submissionId: id, sessionId: sid, completedQuestionCount: state.answers.length, duplicate: false };
      cacheSet(`submission:${id}`, JSON.stringify({ fingerprint, result })); return result;
    });
  }
  function progressLesson4(request) {
    requireLesson(request, 4); const actor = groupIdentity(request), sid = checkId(request.sessionId, '세션 식별자');
    invariant(['entry', 'argument'].includes(request.stage), 'INVALID_STAGE', '진행 단계를 확인해 주세요.');
    const saved = locked(() => {
      requireLesson(request, 4);
      const existing = stateFor(sid, 4);
      if (existing) {
        assertGroupOwner(existing, actor);
        if (!existing.draft || existing.stage === 'argument' || existing.stage === request.stage) return false;
      }
      saveState({ lesson: 4, sessionId: sid, ...groupMeta(actor), draft: true, stage: request.stage, mode: 'script' }, request, actor, request.stage); return true;
    });
    return { saved, ignored: !saved, stage: request.stage };
  }
  function latestGroups(tab, cls) {
    const map = new Map();
    for (const row of rows(tab).filter(value => Number(value.lesson) === 4 && (!cls || Number(value.cls) === cls))) {
      const state = tab === 'progress' ? stateFromRow(row) : null, groupKey = row.groupKey || state?.groupKey;
      if (groupKey) map.set(groupKey, tab === 'progress' ? { ...row, ...groupMeta(state) } : row);
    }
    return [...map.values()];
  }
  function summaryLesson4(cls) {
    const completed = latestGroups('l4_sessions', cls), progress = latestGroups('progress', cls);
    const stanceCounts = { 찬성: 0, 반대: 0 }, feedbackCounts = { reliability: { '●': 0, '◐': 0, '○': 0 }, validity: { '●': 0, '◐': 0, '○': 0 }, attitude: { 인정함: 0, 보통: 0, 피함: 0 } };
    let items = 0;
    for (const row of completed) {
      stanceCounts[row.stance] = (stanceCounts[row.stance] || 0) + 1;
      for (const item of parseJSON(row.ruleFeedback, { items: [] }).items || []) {
        items++; for (const key of ['reliability', 'validity', 'attitude']) if (Object.prototype.hasOwnProperty.call(feedbackCounts[key], item[key])) feedbackCounts[key][item[key]]++;
      }
    }
    return { count: completed.length, total: new Set([...completed, ...progress].map(row => row.groupKey)).size, completed: completed.length,
      stanceCounts, feedbackCounts, metrics: { answerCount: items, reliabilityGoodRate: items ? feedbackCounts.reliability['●'] / items : 0, validityGoodRate: items ? feedbackCounts.validity['●'] / items : 0 } };
  }
  function latest(tab, cls, lesson = 2) {
    const map = {};
    for (const row of rows(tab).filter(x => Number(x.lesson || 2) === lesson && (!cls || Number(x.cls) === cls))) map[row.studentId || row.sessionId] = row;
    return Object.values(map);
  }
  function summary(cls) {
    const completed = latest('l2_sessions', cls), progress = latest('progress', cls), allIds = new Set([...completed, ...progress].map(x => x.studentId));
    const stanceCounts = { 찬성: 0, 반대: 0 }, cardCounts = {}, reasonCounts = {};
    const feedbackCounts = { reliability: { '●': 0, '◐': 0, '○': 0 }, validity: { '●': 0, '◐': 0, '○': 0 }, attitude: { 인정함: 0, 보통: 0, 피함: 0 } };
    let low = 0, items = 0;
    for (const row of completed) {
      stanceCounts[row.stance] = (stanceCounts[row.stance] || 0) + 1; cardCounts[row.cardId] = (cardCounts[row.cardId] || 0) + 1; reasonCounts[row.reasonId] = (reasonCounts[row.reasonId] || 0) + 1;
      if (['PB', 'PC', 'NB', 'NC'].includes(row.cardId)) low++;
      const feedback = parseJSON(row.ruleFeedback, { items: [] });
      for (const item of feedback.items || []) { items++; for (const key of ['reliability', 'validity', 'attitude']) if (Object.prototype.hasOwnProperty.call(feedbackCounts[key], item[key])) feedbackCounts[key][item[key]]++; }
    }
    return { count: completed.length, total: allIds.size, completed: completed.length, stanceCounts, cardCounts, feedbackCounts,
      byStance: stanceCounts, byReason: reasonCounts, byCard: cardCounts, lowReliability: { count: low, rate: completed.length ? low / completed.length : 0 },
      metrics: { answerCount: items, reliabilityGoodRate: items ? feedbackCounts.reliability['●'] / items : 0, validityGoodRate: items ? feedbackCounts.validity['●'] / items : 0 } };
  }
  function classFilter(value) {
    if (value === undefined || value === '') return null;
    const n = Number(value); invariant(Number.isInteger(n) && n >= 1 && n <= config().classCount, 'INVALID_CLASS', '반을 확인해 주세요.'); return n;
  }
  function handleGet(request = {}) {
    const action = request.action || 'ping';
    if (action === 'ping') return { status: 'ok', version: VERSION, implementedLessons: [2, 4] };
    if (action === 'config') return config();
    if (action === 'public_summary' || action === 'shared_summary') {
      const lesson = Number(request.lesson || 2); requireLesson(request, lesson);
      invariant(config().publicSharing, 'SHARING_DISABLED', '공개 활동 공유가 열리지 않았습니다.');
      return lesson === 4 ? summaryLesson4(classFilter(request.cls)) : summary(classFilter(request.cls));
    }
    teacher(request);
    const cls = classFilter(request.cls);
    if (action === 'l2_summary') {
      const records = latest('l2_sessions', cls), progress = latest('progress', cls).map(x => ({ studentId: x.studentId, masked: `${String(x.studentId).slice(0, 3)}**`, cls: x.cls, stage: x.stage, receivedAt: x.receivedAt, mode: stateFor(x.sessionId)?.mode || 'script' }));
      const answers = records.flatMap(row => [1, 2, 3].filter(n => row[`q${n}Id`]).map(n => ({ questionId: row[`q${n}Id`], answer: row[`a${n}Text`], masked: `${String(row.studentId).slice(0, 3)}**`, sessionId: row.sessionId })));
      return { ...summary(cls), records, progress, answers };
    }
    if (action === 'l4_summary') {
      const records = latestGroups('l4_sessions', cls).map(row => ({ ...row, memberStudentIds: parseJSON(row.memberStudentIds, []) }));
      const progress = latestGroups('progress', cls).map(row => ({ studentId: row.studentId, masked: `${String(row.studentId).slice(0, 3)}**`,
        cls: row.cls, groupName: row.groupName, groupKey: row.groupKey, memberStudentIds: row.memberStudentIds,
        stage: row.stage, receivedAt: row.receivedAt, mode: 'script' }));
      const answers = records.flatMap(row => [1, 2, 3, 4, 5].filter(n => row[`q${n}`]).map(n => ({ questionId: `L4-${n}`,
        questionText: row[`q${n}`], answer: row[`a${n}`], groupName: row.groupName, sessionId: row.sessionId })));
      return { ...summaryLesson4(cls), records, progress, answers };
    }
    if (action === 'list') {
      invariant(['l2_sessions', 'ai_log', 'l3_args', 'l4_sessions', 'recordings', 'uploads', 'progress'].includes(request.tab), 'INVALID_TAB', '조회할 탭을 확인해 주세요.');
      return { rows: request.latest === '1' || request.latest === 1 ? (request.tab === 'l4_sessions' ? latestGroups(request.tab, cls) : latest(request.tab, cls, Number(request.lesson || 2))) : rows(request.tab).filter(x => !cls || Number(x.cls) === cls).slice(-2000) };
    }
    if (action === 'status') return { rows: rows('recordings').filter(x => !cls || Number(x.cls) === cls) };
    throw new DomainError('UNKNOWN_ACTION', '지원하지 않는 조회입니다.');
  }
  function handlePost(request = {}) {
    collectLimits(request);
    if (request.action === 'set_lessons') {
      teacher(request);
      invariant(Array.isArray(request.acceptLessons) && request.acceptLessons.length <= 2
        && new Set(request.acceptLessons).size === request.acceptLessons.length && request.acceptLessons.every(value => value === 2 || value === 4),
      'INVALID_LESSONS', '개방할 차시는 2차시·4차시 중에서 선택해 주세요.');
      invariant(typeof store.writeConfig === 'function', 'CONFIG_NOT_SUPPORTED', '차시 설정을 지원하는 서버로 갱신해 주세요.');
      locked(() => store.writeConfig('acceptLessons', request.acceptLessons.slice().sort().join(','))); return config();
    }
    if (request.action === 'turn') return Number(request.lesson || 2) === 4 ? handleLesson4Turn(request) : handleTurn(request);
    if (request.action === 'submit') return Number(request.lesson || 2) === 4 ? submitLesson4(request) : submit(request);
    if (request.action === 'progress') {
      if (Number(request.lesson || 2) === 4) return progressLesson4(request);
      requireLesson(request); const actor = identity(request), sid = checkId(request.sessionId, '세션 식별자');
      invariant(['entry', 'reason', 'card', 'argument'].includes(request.stage), 'INVALID_STAGE', '진행 단계를 확인해 주세요.');
      const saved = locked(() => {
        requireLesson(request);
        const existing = stateFor(sid);
        if (existing) {
          invariant(existing.studentId === actor.studentId, 'SESSION_OWNER_MISMATCH', '다른 학생의 세션을 사용할 수 없습니다.');
          return false; // 늦은 초기 단계 전송으로 대담·제출 단계를 되돌리지 않음
        }
        append('progress', { ...common(request, actor), sessionId: sid, stage: request.stage }); return true;
      });
      return { saved, ignored: !saved, stage: request.stage };
    }
    throw new DomainError('UNKNOWN_ACTION', '현재 지원하지 않는 활동입니다.');
  }
  function respond(method, request) {
    try { return { ok: true, data: method === 'GET' ? handleGet(request) : handlePost(request) }; }
    catch (error) { return { ok: false, error: { code: error instanceof DomainError ? error.code : 'SERVER_ERROR', message: error instanceof DomainError ? error.message : '서버 연결을 확인한 뒤 다시 시도해 주세요.' } }; }
  }
  return { respond, handleGet, handlePost, config, engine, lesson4Engine, headers: HEADERS };
}
