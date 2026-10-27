import { createEngine, DomainError, invariant, normalizeStance, validateStudentId, validateFreeText, sanitizeCell,
  detectPII, validateQuestionOutput, validateFeedbackOutput, isClearlyUnrelated } from '../src/core/engine.js';

export const COMMON_HEADERS = ['receivedAt', 'submissionId', 'studentId', 'cls', 'groupNo', 'lesson', 'clientTs', 'appVersion'];
export const HEADERS = {
  config: ['key', 'value', 'note'],
  l2_sessions: [...COMMON_HEADERS, 'sessionId', 'stance', 'reasonId', 'reasonText', 'cardId', 'argText',
    ...[1, 2, 3].flatMap(n => [`q${n}Id`, `q${n}Crit`, `q${n}Text`, `a${n}Text`, `a${n}Help`]),
    'feedback', 'reflection', 'mode', 'durationSec', 'ruleFeedback', 'aiFeedback', 'earlyFinish', 'completedQuestionCount', 'payloadHash'],
  ai_log: [...COMMON_HEADERS, 'sessionId', 'turn', 'role', 'text', 'meta', 'mode', 'provider', 'model', 'latencyMs', 'error'],
  l3_args: [...COMMON_HEADERS, 'arg1', 'cards1', 'arg5', 'cards5', 'sources', 'chk1', 'chk2', 'chk3', 'chk4', 'chk5'],
  l4_sessions: [...COMMON_HEADERS, 'sessionId', 'part', ...[1, 2, 3, 4, 5].flatMap(n => [`q${n}`, `a${n}`, `help${n}`]), 'feedback', 'reflection', 'mode'],
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
function compactFeedback(feedback) {
  if (!feedback) return null;
  return { items: feedback.items.map(x => ({ turn: x.turn, criterion: x.criterion, reliability: x.reliability, validity: x.validity,
    attitude: x.attitude, comment: x.comment.slice(0, 100), better: x.better.slice(0, 100) })),
    summary: { good: feedback.summary.good.slice(0, 100), improve: feedback.summary.improve.slice(0, 100) } };
}
function constantEqual(a, b) {
  if (!a || !b) return false;
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
export function createService({ content, store, properties, clock = () => Date.now(), hash, providerCall = null }) {
  const engine = createEngine(content);
  const now = () => new Date(clock()).toISOString();
  const prop = key => safeText(properties.get(key));
  const rows = tab => store.read(tab) || [];
  const locked = fn => store.withLock(fn);
  function append(tab, values) {
    const safe = {};
    for (const field of HEADERS[tab]) {
      const val = values[field] ?? '';
      const cell = typeof val === 'object' ? JSON.stringify(val) : val;
      invariant(typeof cell !== 'string' || cell.length <= 2000, 'STORAGE_LENGTH', '기록할 입력란이 너무 깁니다.');
      safe[field] = sanitizeCell(cell);
    }
    store.append(tab, safe);
  }
  function config() {
    const source = Object.fromEntries(rows('config').map(x => [x.key, x.value]));
    const integer = (key, base, low, high) => { const n = Number(source[key] || base); return Number.isInteger(n) && n >= low && n <= high ? n : base; };
    const accepts = safeText(source.acceptLessons || '2').split(',').map(Number).filter(x => x === 2);
    const provider = prop('AI_PROVIDER');
    return { grade: integer('grade', 2, 1, 3), classCount: integer('classCount', 11, 1, 99), groupMax: integer('groupMax', 8, 1, 20),
      acceptLessons: accepts, l2Questions: integer('l2Questions', 3, 2, 3), aiEnabled: ['anthropic', 'gemini'].includes(provider) && Boolean(prop('AI_MODEL') && prop('AI_API_KEY')),
      publicSharing: safeText(source.publicSharing || 'true') === 'true', appVersion: content.version,
      lessons: { 2: { enabled: accepts.includes(2) }, 3: { enabled: false, reason: '아직 열리지 않음' }, 4: { enabled: false, reason: '아직 열리지 않음' } } };
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
  function requireLesson(request) {
    invariant(Number(request.lesson || 2) === 2, 'LESSON_NOT_IMPLEMENTED', '현재는 2차시 체험만 열려 있습니다.');
    invariant(config().acceptLessons.includes(2), 'LESSON_CLOSED', '아직 2차시 활동이 열리지 않았습니다.');
  }
  function common(request, actor) {
    return { receivedAt: now(), submissionId: request.submissionId || '', studentId: actor.studentId, cls: actor.cls, groupNo: '', lesson: 2,
      clientTs: safeText(request.clientTs || ''), appVersion: safeText(request.appVersion || content.version) };
  }
  function stateFor(sessionId) {
    const found = rows('progress').filter(x => x.sessionId === sessionId && x.state1);
    if (!found.length) return null;
    const latest = found[found.length - 1];
    return parseJSON([1, 2, 3, 4, 5, 6, 7, 8].map(n => { const part = latest[`state${n}`] || ''; return String(part).startsWith('~') ? String(part).slice(1) : part; }).join(''));
  }
  function saveState(state, request, actor, stage) {
    const text = JSON.stringify(state);
    invariant(text.length <= 15992, 'STORAGE_LENGTH', '세션 기록이 너무 깁니다.');
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
  function historyInto(state, history = []) {
    invariant(Array.isArray(history) && history.length <= state.questionCount, 'INVALID_HISTORY', '대담 기록을 확인해 주세요.');
    let next = state;
    for (let i = 0; i < history.length; i++) {
      const value = history[i], question = engine.getQuestion(next, i + 1);
      invariant(!value.questionId || value.questionId === question.id, 'QUESTION_MISMATCH', '질문 계획과 기록이 다릅니다.');
      next = engine.recordAnswer(next, { turn: i + 1, answer: value.answer ?? value.a, helpIds: value.helpIds || value.help || [] });
    }
    return next;
  }
  function logTurn(state, actor, request, turn, role, text, question, mode, meta = {}) {
    const marker = `log:${state.sessionId}:${turn}:${role}`;
    if (properties.get(marker)) return;
    append('ai_log', { ...common(request, actor), sessionId: state.sessionId, turn, role, text,
      meta: { questionId: question?.id || '', criterion: question?.criterion || '', targetKey: question?.targetKey || '', helpIds: question?.helpCards?.map(x => x.id) || [], ...meta },
      mode, provider: mode === 'ai' ? prop('AI_PROVIDER') : 'none', model: mode === 'ai' ? prop('AI_MODEL') : '', latencyMs: meta.latencyMs || 0, error: meta.error || '' });
    properties.set(marker, '1');
  }
  function settings() { return { provider: prop('AI_PROVIDER'), model: prop('AI_MODEL'), key: prop('AI_API_KEY') }; }
  function aiAllowed(actor) {
    if (!config().aiEnabled || !providerCall) return false;
    return locked(() => {
      const key = `rate:${actor.studentId}:${Math.floor(clock() / 3600000)}`, used = Number(prop(key) || 0), requestedMax = Number(prop('AI_RATE_PER_HOUR') || 30);
      const max = Number.isInteger(requestedMax) && requestedMax >= 1 && requestedMax <= 300 ? requestedMax : 30;
      if (used >= max) return false;
      properties.set(key, String(used + 1)); return true;
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
      let state = buildFrom(request, actor, stateFor(sid));
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
        const current = stateFor(sid);
        const next = { ...current, aiFeedback: mode === 'ai' ? compactFeedback(feedback) : null, feedbackMode: mode };
        saveState(next, request, actor, 'feedback');
        logTurn(next, actor, request, 0, 'system', '피드백을 생성했습니다.', null, mode);
      });
      return { sessionId: sid, feedback, ruleFeedback, mode };
    }
    const generated = makeQuestion(state, actor, request.forceMode);
    locked(() => {
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
  function submit(request) {
    requireLesson(request); invariant(request.kind === 'l2_session', 'KIND_LESSON_MISMATCH', '현재는 2차시 체험 제출만 가능합니다.');
    const actor = identity(request), id = checkId(request.submissionId, '제출 식별자'), data = request.data || {};
    const fingerprint = hash(JSON.stringify({ actor: actor.studentId, lesson: 2, sessionId: request.sessionId || data.sessionId,
      stance: data.stance, reasonId: data.reasonId, reasonText: data.reasonText, cardId: data.cardId, argText: data.argText, answers: data.answers, reflection: data.reflection, earlyFinish: data.earlyFinish }));
    return locked(() => {
      const dedupe = parseJSON(properties.get(`submission:${id}`));
      if (dedupe) { invariant(dedupe.fingerprint === fingerprint, 'IDEMPOTENCY_CONFLICT', '같은 제출 식별자로 다른 내용을 보낼 수 없습니다.'); return { ...dedupe.result, duplicate: true }; }
      const durable = rows('l2_sessions').find(x => x.submissionId === id);
      if (durable) {
        invariant(durable.payloadHash === fingerprint, 'IDEMPOTENCY_CONFLICT', '같은 제출 식별자로 다른 내용을 보낼 수 없습니다.');
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
      properties.set(`submission:${id}`, JSON.stringify({ fingerprint, result }));
      return result;
    });
  }
  function latest(tab, cls) {
    const map = {};
    for (const row of rows(tab).filter(x => !cls || Number(x.cls) === cls)) map[row.studentId || row.sessionId] = row;
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
    if (action === 'ping') return { status: 'ok', version: content.version, implementedLessons: [2] };
    if (action === 'config') return config();
    if (action === 'public_summary' || action === 'shared_summary') {
      invariant(config().publicSharing, 'SHARING_DISABLED', '공개 활동 공유가 열리지 않았습니다.'); return summary(classFilter(request.cls));
    }
    teacher(request);
    const cls = classFilter(request.cls);
    if (action === 'l2_summary') {
      const records = latest('l2_sessions', cls), progress = latest('progress', cls).map(x => ({ studentId: x.studentId, masked: `${String(x.studentId).slice(0, 3)}**`, cls: x.cls, stage: x.stage, receivedAt: x.receivedAt, mode: stateFor(x.sessionId)?.mode || 'script' }));
      const answers = records.flatMap(row => [1, 2, 3].filter(n => row[`q${n}Id`]).map(n => ({ questionId: row[`q${n}Id`], answer: row[`a${n}Text`], masked: `${String(row.studentId).slice(0, 3)}**`, sessionId: row.sessionId })));
      return { ...summary(cls), records, progress, answers };
    }
    if (action === 'list') {
      invariant(['l2_sessions', 'ai_log', 'l3_args', 'l4_sessions', 'recordings', 'uploads', 'progress'].includes(request.tab), 'INVALID_TAB', '조회할 탭을 확인해 주세요.');
      return { rows: request.latest === '1' || request.latest === 1 ? latest(request.tab, cls) : rows(request.tab).filter(x => !cls || Number(x.cls) === cls).slice(-2000) };
    }
    if (action === 'status') return { rows: rows('recordings').filter(x => !cls || Number(x.cls) === cls) };
    throw new DomainError('UNKNOWN_ACTION', '지원하지 않는 조회입니다.');
  }
  function handlePost(request = {}) {
    collectLimits(request);
    if (request.action === 'turn') return handleTurn(request);
    if (request.action === 'submit') return submit(request);
    if (request.action === 'progress') {
      requireLesson(request); const actor = identity(request), sid = checkId(request.sessionId, '세션 식별자');
      invariant(['entry', 'reason', 'card', 'argument'].includes(request.stage), 'INVALID_STAGE', '진행 단계를 확인해 주세요.');
      const saved = locked(() => {
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
  return { respond, handleGet, handlePost, config, engine, headers: HEADERS };
}
