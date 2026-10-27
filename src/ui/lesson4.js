import { createLesson4Engine } from '../core/lesson4.js';
import { LESSON4_CONTENT } from '../core/lesson4-content.js';
import { createSubmissionQueue } from '../network/queue.js';
import { mayUseLocalFallback } from '../network/client.js';
import { escapeHtml as h, containsPrivateData, maskStudentId, publicCard } from './state.js';
import { freshLesson4, normalizeGroupIdentity, sameGroupRoster, groupDraftKey, lesson4Storage } from './lesson4-state.js';

const parse = value => { try { return JSON.parse(value); } catch { return null; } };
const label = value => ({ '●': '잘 바탕함', '◐': '조금', '○': '보완 필요' }[value] || '확인 중');

export function createLesson4Controller({ api, storage, getState, setState, persist, render, toast, getConfig, getAccess, closedView, getAppVersion, downloadFile }) {
  const engine = createLesson4Engine(LESSON4_CONTENT);
  let busy = false, error = '', generation = 0, previousPayloads = [], progressSending = false;
  const progressKey = 'chaeum:v5:l4:progress';
  let progress = parse(storage.getItem(progressKey)) || {};
  const a = () => getState();
  const safeApi = { isConfigured: () => api.isConfigured() && getAccess().allowed, post: (...args) => api.post(...args) };
  const save = () => {
    persist();
    if (a().identity && a().stage !== 'entry') storage.setItem(groupDraftKey(a().identity), JSON.stringify(a()));
  };
  const queue = createSubmissionQueue({ storage: lesson4Storage(storage), api: safeApi, onChange(items) {
    const ids = new Set(items.map(item => item.payload.submissionId));
    for (const old of previousPayloads.filter(payload => !ids.has(payload.submissionId))) {
      const key = groupDraftKey({ groupKey: `${old.cls}:${old.groupName.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()}` });
      const saved = parse(storage.getItem(key));
      if (saved?.submissionId === old.submissionId) { saved.status = 'sent'; storage.setItem(key, JSON.stringify(saved)); }
      if (a().submissionId === old.submissionId) { a().status = 'sent'; save(); }
    }
    previousPayloads = items.map(item => item.payload); render();
  } });
  previousPayloads = queue.getItems().map(item => item.payload);
  const ensureOpen = () => { if (getAccess().allowed) return true; render(); return false; };
  const fail = message => { error = message; render(); };
  const errorHtml = () => error ? `<p class="error-message" role="alert">${h(error)}</p>` : '';
  const btn = (text, action, { primary = false, disabled = false, extra = '' } = {}) => `<button type="button" class="btn ${primary ? 'primary' : ''}" data-action="l4-${action}" ${disabled || busy ? 'disabled' : ''} ${extra}>${text}</button>`;
  const count = (key, value, max) => `<div class="char-count"><span data-l4-count="${key}">${value.length}</span> / ${max}자</div>`;
  const selection = () => ({ stance: a().stance, arg1: a().arg1, arg5: a().arg5 });
  const common = () => ({ lesson: 4, sessionId: a().sessionId, ...a().identity, clientTs: new Date().toISOString(), appVersion: getAppVersion() });
  const request = mode => ({ ...common(), mode, turn: a().turn, selection: selection(), history: a().answers.map(item => ({ questionId: item.questionId, answer: item.answer, helpIds: item.helpIds })), earlyFinish: a().earlyFinish });
  const currentQuestion = () => ({ ...engine.getQuestion(a().session, a().turn), ...(a().remoteQuestions[a().turn] || {}) });
  function show() { save(); render(); }
  function cardHtml(raw) {
    const card = publicCard(raw);
    return `<article class="evidence-card"><div class="virtual-strip"><span>수업용 가상 자료</span><span>${h(card.id)}</span></div><div class="evidence-body"><p>${h(card.content)}</p><dl class="card-facts"><dt>출처</dt><dd>${h(card.source)}</dd><dt>시기</dt><dd>${h(card.year)}</dd><dt>방법</dt><dd>${h(card.method)}</dd></dl></div><button class="evidence-select" data-action="l4-cite" data-id="${h(card.id)}" ${busy ? 'disabled' : ''}>＋ 이 자료 인용</button></article>`;
  }
  function entryView() {
    const draft = a();
    return `<section class="activity-panel l4-entry"><div class="section-kicker">4차시 · 모둠 반대 신문</div><h2>모둠 정보를 입력해 주세요.</h2><p class="section-intro">모둠 대표 한 명이 입력합니다. 이름은 받지 않아요.<br>대표를 포함한 같은 반 모둠원 4~5명의 학번을 적어 주세요.</p><form data-form="l4-entry"><div class="l4-entry-main"><label class="field-label" for="l4-representative">대표 학번<input id="l4-representative" name="representative" data-input="l4-representative" inputmode="numeric" maxlength="5" pattern="[0-9]{5}" autocomplete="off" value="${h(draft.representative)}" placeholder="예: 20315" required></label><label class="field-label" for="l4-group-name">모둠명<input id="l4-group-name" name="groupName" data-input="l4-groupName" maxlength="30" autocomplete="off" value="${h(draft.groupName)}" placeholder="우리 모둠 이름 · 1~30자" required></label></div><fieldset class="l4-members"><legend>모둠원 학번 · 대표 포함</legend><div class="l4-member-grid">${Array.from({ length: 5 }, (_, i) => `<label for="l4-member-${i + 1}">${i + 1}번째 모둠원${i === 4 ? ' (선택)' : ''}<input id="l4-member-${i + 1}" name="member${i + 1}" data-input="l4-member-${i}" inputmode="numeric" maxlength="5" pattern="[0-9]{5}" autocomplete="off" value="${h(draft.memberEntries[i] || '')}" placeholder="학번 5자리" ${i < 4 ? 'required' : ''}></label>`).join('')}</div></fieldset><p class="field-help">학번은 대표와 같은 반이어야 하며 중복될 수 없습니다. 모둠명·학번은 공개 결과에 표시하지 않습니다.</p>${errorHtml()}<div class="action-bar"><span></span><button id="l4-entry-submit" class="btn primary" type="submit" ${busy ? 'disabled' : ''}>모둠 활동 시작 →</button></div></form></section>`;
  }
  function argumentView() {
    return `<section class="activity-panel"><div class="section-kicker">STEP 01 · 우리 모둠 입론</div><h2>이미 작성한 입론을 넣어 주세요.</h2><p class="section-intro">모둠이 쓴 ① 입론은 필수, ⑤ 입론은 선택입니다.<br>내용을 읽고 질문을 받은 뒤, 모둠에서 상의해 답하게 됩니다.</p><div class="motion"><span class="motion-tag">토론 논제</span>${h(LESSON4_CONTENT.motion || LESSON4_CONTENT.topic || '인공 지능 의료 상담 도우미 서비스를 공공 의료에 도입해야 한다.')}</div><div class="choice-grid l4-stance">${['찬성', '반대'].map(stance => `<button class="reason-button ${a().stance === stance ? 'selected' : ''}" data-action="l4-stance" data-value="${stance}" aria-pressed="${a().stance === stance}"><span class="radio-mark">${a().stance === stance ? '✓' : ''}</span><span>${stance}</span></button>`).join('')}</div><label class="field-label" for="l4-arg1">① 우리 모둠 입론 · 20~1500자</label><textarea id="l4-arg1" data-input="l4-arg1" maxlength="1500" rows="8" placeholder="모둠에서 작성한 입론을 붙여 넣거나 적어 주세요.">${h(a().arg1)}</textarea>${count('arg1', a().arg1, 1500)}<label class="field-label" for="l4-arg5" style="margin-top:25px">⑤ 추가 입론 · 선택, 최대 1500자</label><textarea id="l4-arg5" data-input="l4-arg5" maxlength="1500" rows="5" placeholder="두 번째 입론이 있으면 입력해 주세요.">${h(a().arg5)}</textarea>${count('arg5', a().arg5, 1500)}<p class="field-help">이름·학번·연락처는 입론에 적지 않습니다. 학생이 작성한 입론을 바탕으로 연습용 대본이 질문합니다.</p>${errorHtml()}<div class="action-bar">${btn('모둠 정보 확인', 'entry')}<div class="trailing">${btn('반대 신문 시작 →', 'start', { primary: true })}</div></div></section>`;
  }
  function dialogueView() {
    const q = currentQuestion();
    return `<section class="activity-panel"><div class="section-kicker">STEP 02 · 모둠 반대 신문</div><h2>상의한 내용을 대표가 답해 주세요.</h2><p class="section-intro">질문 ${a().turn} / ${a().questionCount} · 답변 최대 600자</p><div class="chat-notice">질문의 내용도 교과서 203쪽의 타당성·신뢰성·공정성 기준으로 판단하세요.</div><div class="script-notice">지금은 연습용 대본으로 진행합니다.</div><div class="chat-person"><span class="bot-avatar" aria-hidden="true">?</span>${a().stance === '반대' ? '찬성' : '반대'}측 토론자</div><div class="question-bubble" aria-live="polite"><span class="question-index">확인하고, 검증하기</span><p>${h(q.confirm)}</p><p>${h(q.verify)}</p></div>${busy ? '<p class="busy-note"><span class="spinner"></span>질문을 확인하고 있어요.</p>' : ''}<div class="help-heading"><strong>답변에 활용할 도움 자료</strong><span>필요한 자료만 인용해요.</span></div><div class="evidence-grid help-cards l4-help-cards">${q.helpCards.map(cardHtml).join('')}</div><div class="answer-field"><label class="field-label" for="l4-answer">우리 모둠의 답변</label><textarea id="l4-answer" data-input="l4-answer" maxlength="600" rows="6" placeholder="질문을 피하지 않고, 자료와 출처를 활용해 답해 보세요.">${h(a().answerDrafts[a().turn] || '')}</textarea>${count('answer', a().answerDrafts[a().turn] || '', 600)}<p class="field-help">다음 질문으로 넘긴 답은 바꿀 수 없습니다.</p></div>${errorHtml()}<div class="action-bar"><span></span>${btn(a().turn >= a().questionCount ? '답변 마치고 피드백 보기 →' : '답변 보내고 다음 질문 →', 'answer-next', { primary: true })}</div>${a().answers.length >= 3 ? `<div class="early-exit">${btn('시간이 부족해요: 피드백 보기', 'early-feedback')}</div>` : ''}</section>`;
  }
  function feedbackHtml(feedback, readOnly = false) {
    return `<div class="feedback-overview"><h3>우리 모둠 답변 돌아보기</h3><p><b>잘한 점</b> &nbsp;${h(feedback.summary?.good)}</p><p><b>보완할 점</b> &nbsp;${h(feedback.summary?.improve)}</p></div><div class="feedback-legend">● 잘 바탕함 &nbsp; ◐ 조금 &nbsp; ○ 보완 필요<br>신뢰성·타당성·태도를 살피는 연습용 피드백입니다.</div>${feedback.items.map((item, index) => `<article class="feedback-item"><span class="criterion-badge">질문 ${index + 1} · ${h(item.criterion)}</span><p class="criterion-meaning">${h(item.criterionDescription || '')}</p><p class="feedback-question">${h(a().answers[index]?.question?.confirm || item.confirm || '')}<br>${h(a().answers[index]?.question?.verify || item.verify || '')}</p><div class="my-answer"><span>우리 모둠의 답변</span>${h(item.answer || a().answers[index]?.answer)}</div><div class="ratings"><span class="rating">신뢰성 ${h(item.reliability)} ${h(label(item.reliability))}</span><span class="rating">타당성 ${h(item.validity)} ${h(label(item.validity))}</span><span class="rating">태도 ${h(item.attitude)}</span></div><p class="feedback-comment">${h(item.comment)}</p><div class="better"><strong>보완할 방향</strong>${h(item.better)}</div></article>`).join('')}${readOnly ? `<div class="my-answer"><span>모둠 성찰</span>${h(a().reflection)}</div>` : ''}`;
  }
  function feedbackView() {
    return `<section class="activity-panel"><div class="section-kicker">STEP 03 · 피드백과 성찰</div><h2>모둠의 답변을 함께 돌아보세요.</h2>${busy ? '<p class="busy-note"><span class="spinner"></span>피드백을 확인하고 있어요.</p>' : ''}${feedbackHtml(a().feedback)}<div class="reflection-box"><label class="field-label" for="l4-reflection">모둠 성찰 · 10~150자</label><textarea id="l4-reflection" data-input="l4-reflection" maxlength="150" rows="4" placeholder="다음 입론과 답변에서는 어떤 점을 보완할까요?">${h(a().reflection)}</textarea>${count('reflection', a().reflection, 150)}</div>${errorHtml()}<div class="action-bar"><span></span>${btn('모둠 결과 저장하기 →', 'submit', { primary: true })}</div></section>`;
  }
  function completeView() {
    const pending = queue.getItems().find(item => item.payload.submissionId === a().submissionId);
    const closed = pending?.errorCode === 'LESSON_CLOSED';
    return `<section class="activity-panel"><div class="complete-symbol" aria-hidden="true">✓</div><div class="section-kicker">4차시 · 모둠 활동 기록</div><h2>모둠의 결과와 성찰</h2><div class="status-banner ${a().status === 'sent' ? 'sent' : ''}" role="status">${a().status === 'sent' ? '<b>선생님께 전달했어요.</b><br>모둠 단위로 결과가 저장되었습니다.' : closed ? '<b>활동이 닫혀 전송을 기다리고 있어요.</b><br>선생님이 다시 열면 아래에서 다시 전송해 주세요.' : pending?.blocked ? '<b>기록을 확인해야 해요.</b><br>이 기기에 결과를 보관 중입니다. 선생님께 알려 주세요.' : '<b>전송 대기 중이에요.</b><br>기기에 결과를 보관했어요. 연결되면 자동으로 다시 보냅니다.'}</div><div class="my-answer"><span>모둠 성찰</span>${h(a().reflection)}</div><div class="action-bar">${btn('피드백 다시 보기', 'review')}<div class="trailing">${a().status !== 'sent' ? btn('다시 전송', 'retry') : ''}${btn('결과 내려받기 ↓', 'download', { primary: true })}</div></div>${a().showReview ? feedbackHtml(a().feedback, true) : ''}</section>`;
  }
  function view() {
    if (!getAccess().allowed) return `<div id="main-content" tabindex="-1">${closedView(4)}</div>`;
    const titles = { entry: '모둠 정보', argument: '입론 입력', dialogue: '반대 신문', feedback: '피드백·성찰', complete: '활동 결과' };
    return `<div id="main-content" tabindex="-1" class="l4-layout"><div class="hero"><div><div class="eyebrow">화법과 언어 · LESSON 04</div><h1>모둠 입론으로<br><em>반대 신문에 답해요.</em></h1><p>작성한 입론을 읽고 모둠이 상의해 답하는 대본 활동입니다.</p></div>${a().identity ? `<div class="l4-group-label"><b>${h(a().identity.groupName)}</b><span>${a().identity.cls}반 · ${a().identity.memberStudentIds.length}명 · 대표 ${h(maskStudentId(a().identity.studentId))}</span></div>` : ''}</div><ol class="stepper l4-stepper">${Object.entries(titles).map(([stage, name], i) => `<li class="${stage === a().stage ? 'current' : ''}"><b>${i + 1}</b><span>${name}</span></li>`).join('')}</ol>${({ entry: entryView, argument: argumentView, dialogue: dialogueView, feedback: feedbackView, complete: completeView }[a().stage] || entryView)()}</div>`;
  }
  async function sendProgress(stage) {
    if (!a().identity) return;
    progress[a().sessionId] = { ...common(), stage }; storage.setItem(progressKey, JSON.stringify(progress)); await flushProgress();
  }
  async function flushProgress() {
    if (progressSending || !safeApi.isConfigured() || globalThis.navigator?.onLine === false) return;
    progressSending = true;
    try { for (const [id, payload] of Object.entries(progress)) {
      try { await api.post('progress', payload); if (progress[id]?.clientTs === payload.clientTs) delete progress[id]; }
      catch (caught) { if (!mayUseLocalFallback(caught) && caught.code !== 'LESSON_CLOSED') delete progress[id]; }
      storage.setItem(progressKey, JSON.stringify(progress));
    } } finally { progressSending = false; }
  }
  function retryQuestion(data) {
    const draft = a(), turn = Number(data.turn) || Math.max(1, draft.turn - 1), kept = draft.answers.slice(0, turn - 1);
    let session = engine.buildSession({ ...selection(), sessionId: draft.sessionId, questionCount: draft.questionCount, seed: draft.sessionId });
    kept.forEach(item => { session = engine.recordAnswer(session, { turn: item.turn, answer: item.answer, helpIds: item.helpIds }); });
    draft.session = session; draft.answers = kept; draft.turn = turn; draft.stage = 'dialogue'; draft.feedback = null; draft.earlyFinish = false;
    Object.keys(draft.remoteQuestions).forEach(key => { if (Number(key) >= turn) delete draft.remoteQuestions[key]; });
    draft.remoteQuestions[turn] = data.question; error = data.prompt || '질문에 대한 답을 써 주세요.';
  }
  async function remote(mode) {
    if (!ensureOpen()) return;
    if (!api.isConfigured()) { a().mode = 'script-local'; save(); return; }
    const token = ++generation, sid = a().sessionId; busy = true; render();
    try {
      const { data } = await api.post('turn', request(mode));
      if (token !== generation || sid !== a().sessionId || !getAccess().allowed) return;
      if (data.retry) retryQuestion(data);
      else if (mode === 'question' && data.question?.confirm && data.question.verify) { a().remoteQuestions[a().turn] = data.question; a().mode = 'script'; a().blocked = false; }
      else if (mode === 'feedback' && data.feedback?.items) { a().feedback = data.feedback; a().mode = 'script'; a().blocked = false; }
      else throw Object.assign(new Error('응답을 확인하지 못했어요.'), { code: 'INVALID_RESPONSE' });
    } catch (caught) {
      if (token !== generation || sid !== a().sessionId) return;
      if (mayUseLocalFallback(caught)) a().mode = 'script-local';
      else if (caught.code === 'LESSON_CLOSED') { error = '선생님이 4차시를 닫았습니다. 입력한 내용은 보관했어요.'; }
      else { a().blocked = true; error = caught.message; }
    } finally { if (token === generation) { busy = false; show(); } }
  }
  async function start() {
    if (!ensureOpen()) return;
    const draft = a();
    try {
      draft.questionCount = [3, 4, 5].includes(Number(getConfig().l4Questions)) ? Number(getConfig().l4Questions) : 4;
      draft.session = engine.buildSession({ ...selection(), sessionId: draft.sessionId, questionCount: draft.questionCount, seed: draft.sessionId });
      draft.stage = 'dialogue'; draft.turn = 1; draft.blocked = false; draft.startedAt ||= Date.now(); error = '';
      delete progress[draft.sessionId]; storage.setItem(progressKey, JSON.stringify(progress)); show(); await remote('question');
    } catch (caught) { fail(caught.message); }
  }
  async function feedback(early = false) {
    a().earlyFinish = early; a().feedback = engine.getFeedback(a().session); a().stage = 'feedback'; error = ''; show(); await remote('feedback');
  }
  async function answerNext() {
    if (!ensureOpen() || a().blocked) return fail('이전 안내를 확인하고 선생님께 알려 주세요.');
    const answer = String(a().answerDrafts[a().turn] || '').trim();
    if (!answer) return fail('질문에 대한 답을 써 주세요.');
    try {
      const q = currentQuestion(), helpIds = a().helpSelections[a().turn] || [];
      a().session = engine.recordAnswer(a().session, { turn: a().turn, answer, helpIds });
      a().answers.push({ turn: a().turn, questionId: q.id, question: q, answer, helpIds }); error = '';
      if (a().turn >= a().questionCount) return feedback(false);
      a().turn++; show(); await remote('question');
    } catch (caught) { fail(caught.message); }
  }
  async function submit() {
    if (!ensureOpen() || a().blocked) return;
    try {
      const finished = engine.finishSession(a().session, { reflection: a().reflection.trim(), earlyFinish: a().earlyFinish });
      const payload = { ...common(), kind: 'l4_session', submissionId: a().submissionId, groupNo: '',
        data: { ...finished, reflection: a().reflection.trim(), earlyFinish: a().earlyFinish, mode: a().mode, durationSec: Math.max(0, Math.round((Date.now() - a().startedAt) / 1000)) } };
      a().reflection = payload.data.reflection; a().stage = 'complete'; a().status = 'pending'; error = ''; save(); queue.enqueue(payload); render(); await queue.flush({ force: true }); render();
    } catch (caught) { fail(caught.message); }
  }
  async function handleForm(formData) {
    if (!ensureOpen()) return;
    try {
      const identity = normalizeGroupIdentity({ representative: formData.get('representative'), groupName: formData.get('groupName'), memberEntries: Array.from({ length: 5 }, (_, i) => formData.get(`member${i + 1}`)) }, getConfig());
      const saved = parse(storage.getItem(groupDraftKey(identity)));
      const draft = saved && sameGroupRoster(saved.identity, identity) ? { ...freshLesson4(), ...saved } : { ...freshLesson4(), arg1: a().arg1, arg5: a().arg5, stance: a().stance };
      draft.identity = identity; draft.representative = identity.studentId; draft.groupName = identity.groupName;
      draft.memberEntries = [...identity.memberStudentIds, ...Array(5 - identity.memberStudentIds.length).fill('')];
      if (draft.stage === 'entry') draft.stage = 'argument';
      generation++; busy = false; error = ''; setState(draft); show();
      if (draft.stage === 'argument') sendProgress('argument');
      if (draft.stage === 'dialogue' && !draft.remoteQuestions[draft.turn]) remote('question');
    } catch (caught) { fail(caught.message); }
  }
  function handleInput(key, value) {
    if (!ensureOpen()) return;
    const field = key.replace(/^l4-/, '');
    if (/^member-\d$/.test(field)) a().memberEntries[Number(field.split('-')[1])] = value;
    else if (field === 'answer') a().answerDrafts[a().turn] = value;
    else if (['representative', 'groupName', 'arg1', 'arg5', 'reflection'].includes(field)) a()[field] = value;
    else return;
    const node = globalThis.document?.querySelector(`[data-l4-count="${field}"]`); if (node) node.textContent = String(value.length); save();
  }
  function resultText() {
    const draft = a();
    return ['4차시 모둠 반대 신문 활동 결과', `모둠: ${draft.identity.groupName} / ${draft.identity.cls}반`, `대표: ${draft.identity.studentId}`, `모둠원: ${draft.identity.memberStudentIds.join(', ')}`, `전송 상태: ${draft.status === 'sent' ? '서버 저장 완료' : '전송 대기 · 기기 보관'}`, '', `입장: ${draft.stance}`, '① 입론', draft.arg1, ...(draft.arg5 ? ['', '⑤ 입론', draft.arg5] : []), '', ...draft.answers.flatMap((item, index) => [`질문 ${index + 1}`, item.question.confirm, item.question.verify, `답변: ${item.answer}`, `인용 자료: ${item.helpIds.join(', ') || '없음'}`, `검토 기준: ${draft.feedback.items[index]?.criterion || ''}`, `신뢰성 ${draft.feedback.items[index]?.reliability || ''} / 타당성 ${draft.feedback.items[index]?.validity || ''} / 태도 ${draft.feedback.items[index]?.attitude || ''}`, `보완 방향: ${draft.feedback.items[index]?.better || ''}`, '']), '모둠 성찰', draft.reflection, '', '질문과 도움 자료는 수업용 대본·가상 자료입니다.'].join('\n');
  }
  async function handleClick(action, node) {
    if (!ensureOpen() || busy) return;
    error = '';
    if (action === 'l4-stance') { a().stance = node.dataset.value; show(); }
    else if (action === 'l4-entry') { a().stage = 'entry'; show(); }
    else if (action === 'l4-start') await start();
    else if (action === 'l4-answer-next') await answerNext();
    else if (action === 'l4-early-feedback' && a().answers.length >= 3) await feedback(true);
    else if (action === 'l4-submit') await submit();
    else if (action === 'l4-review') { a().showReview = !a().showReview; show(); }
    else if (action === 'l4-retry') { await queue.flush({ force: true }); render(); }
    else if (action === 'l4-cite') {
      const card = currentQuestion().helpCards.find(item => item.id === node.dataset.id); if (!card) return;
      const citation = `[자료 ${card.id}] ${card.source || '출처 밝혀지지 않음'} ${card.year && card.year !== '밝혀지지 않음' ? card.year : ''}`.trim();
      const value = `${a().answerDrafts[a().turn] || ''}${a().answerDrafts[a().turn] ? '\n' : ''}${citation}`;
      if (value.length > 600) return toast('자료 인용을 넣을 공간을 조금 남겨 주세요.');
      a().answerDrafts[a().turn] = value; a().helpSelections[a().turn] = [...new Set([...(a().helpSelections[a().turn] || []), card.id])]; show(); globalThis.document?.querySelector('#l4-answer')?.focus();
    } else if (action === 'l4-download' && a().stage === 'complete') {
      const filename = `4차시_${a().identity.groupName.replace(/[\\/:*?"<>|]/g, '_')}_${new Date().toISOString().slice(0, 10)}.txt`;
      downloadFile(resultText(), filename);
    }
  }
  function onConfigChanged() { if (!getAccess().allowed) { generation++; busy = false; } }
  function suspend() { save(); generation++; busy = false; error = ''; }
  function startRecovery() { queue.start(); flushProgress(); }
  async function recover() {
    if (!getAccess().allowed || busy) return;
    await queue.flush(); await flushProgress();
    if (a().stage === 'dialogue' && a().session && !a().remoteQuestions[a().turn]) await remote('question');
    else if (a().stage === 'feedback' && a().blocked) await remote('feedback');
  }
  return { render: view, handleForm, handleInput, handleClick, onConfigChanged, startRecovery, recover, resultText, suspend,
    hasPending: () => queue.getItems().length > 0, stop: () => queue.stop(), isBusy: () => busy };
}
