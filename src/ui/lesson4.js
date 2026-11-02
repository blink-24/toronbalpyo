import { createLesson4Engine } from '../core/lesson4.js';
import { LESSON4_CONTENT } from '../core/lesson4-content.js';
import { createSubmissionQueue } from '../network/queue.js';
import { mayUseLocalFallback } from '../network/client.js';
import { escapeHtml as h, containsPrivateData, maskStudentId, publicCard } from './state.js';
import { freshLesson4, normalizeGroupIdentity, sameGroupRoster, groupDraftKey, lesson4Storage, makeLesson4Id } from './lesson4-state.js';
import { DEBATE_SEQUENCE, DEBATE_LIMITS, DEBATE_KIND_LABELS, validateDebateArguments, validateGroupTurn, realSourcesFor } from '../core/lesson4-debate.js';

const parse = value => { try { return JSON.parse(value); } catch { return null; } };
const label = value => ({ '●': '잘 바탕함', '◐': '조금', '○': '보완 필요' }[value] || '확인 중');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const AI_NOTICE = '상대 토론자의 발언은 인공 지능이 만든 글입니다. 틀리거나 근거가 부족할 수 있으니 그대로 믿지 말고 질문으로 확인하세요. 우리 모둠의 입론과 발언은 상대 발언을 만들기 위해 외부 인공 지능 서비스로 전송됩니다. 이름·학번·연락처는 쓰지 마세요. 활동의 판단과 평가는 선생님이 합니다.';

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
  const selection = () => ({ stance: a().stance, arg1: a().arg1, arg5: a().arg5,
    scriptVersion: a().session?.version || (getConfig().l4ScriptVersion === LESSON4_CONTENT.version ? LESSON4_CONTENT.version : '1.0.0') });
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
    if (debateAvailable()) return debateArgumentView();
    return `<section class="activity-panel"><div class="section-kicker">STEP 01 · 우리 모둠 입론</div><h2>이미 작성한 입론을 넣어 주세요.</h2><p class="section-intro">모둠이 쓴 ① 입론은 필수, ⑤ 입론은 선택입니다.<br>내용을 읽고 질문을 받은 뒤, 모둠에서 상의해 답하게 됩니다.</p><div class="motion"><span class="motion-tag">토론 논제</span>${h(LESSON4_CONTENT.motion || LESSON4_CONTENT.topic || '인공 지능 의료 상담 도우미 서비스를 공공 의료에 도입해야 한다.')}</div><div class="choice-grid l4-stance">${['찬성', '반대'].map(stance => `<button class="reason-button ${a().stance === stance ? 'selected' : ''}" data-action="l4-stance" data-value="${stance}" aria-pressed="${a().stance === stance}"><span class="radio-mark">${a().stance === stance ? '✓' : ''}</span><span>${stance}</span></button>`).join('')}</div><label class="field-label" for="l4-arg1">① 우리 모둠 입론 · 20~1500자</label><textarea id="l4-arg1" data-input="l4-arg1" maxlength="1500" rows="8" placeholder="모둠에서 작성한 입론을 붙여 넣거나 적어 주세요.">${h(a().arg1)}</textarea>${count('arg1', a().arg1, 1500)}<label class="field-label" for="l4-arg5" style="margin-top:25px">⑤ 추가 입론 · 선택, 최대 1500자</label><textarea id="l4-arg5" data-input="l4-arg5" maxlength="1500" rows="5" placeholder="두 번째 입론이 있으면 입력해 주세요.">${h(a().arg5)}</textarea>${count('arg5', a().arg5, 1500)}<p class="field-help">이름·학번·연락처는 입론에 적지 않습니다. 학생이 작성한 입론을 바탕으로 연습용 대본이 질문합니다.</p>${errorHtml()}<div class="action-bar">${btn('모둠 정보 확인', 'entry')}<div class="trailing">${btn('반대 신문 시작 →', 'start', { primary: true })}</div></div></section>`;
  }
  // 가상 자료와 같은 쟁점의 실제 자료 요약입니다. 인용 버튼 없이 원문 확인용으로만 보여 줍니다.
  function realPanel(q) {
    const items = realSourcesFor(LESSON4_CONTENT, q.helpCards.map(card => card.topic)).slice(0, 2);
    return items.length ? `<div class="help-heading"><strong>실제 자료로 더 알아보기</strong><span>기사·보고서 요약이에요. 원문으로 확인해요.</span></div>${items.map(materialHtml).join('')}` : '';
  }
  function dialogueView() {
    const q = currentQuestion();
    return `<section class="activity-panel"><div class="section-kicker">STEP 02 · 모둠 반대 신문</div><h2>상의한 내용을 대표가 답해 주세요.</h2><p class="section-intro">질문 ${a().turn} / ${a().questionCount} · 답변 최대 600자</p><div class="chat-notice">질문의 내용도 교과서 203쪽의 타당성·신뢰성·공정성 기준으로 판단하세요.</div><div class="script-notice">지금은 연습용 대본으로 진행합니다.</div><div class="chat-person"><span class="bot-avatar" aria-hidden="true">?</span>${a().stance === '반대' ? '찬성' : '반대'}측 토론자</div><div class="question-bubble" aria-live="polite"><span class="question-index">확인하고, 검증하기</span><p>${h(q.confirm)}</p><p>${h(q.verify)}</p></div>${busy ? '<p class="busy-note"><span class="spinner"></span>질문을 확인하고 있어요.</p>' : ''}<div class="help-heading"><strong>답변에 활용할 도움 자료</strong><span>필요한 자료만 인용해요.</span></div><div class="evidence-grid help-cards l4-help-cards">${q.helpCards.map(cardHtml).join('')}</div>${realPanel(q)}<div class="answer-field"><label class="field-label" for="l4-answer">우리 모둠의 답변</label><textarea id="l4-answer" data-input="l4-answer" maxlength="600" rows="6" placeholder="질문을 피하지 않고, 자료와 출처를 활용해 답해 보세요.">${h(a().answerDrafts[a().turn] || '')}</textarea>${count('answer', a().answerDrafts[a().turn] || '', 600)}<p class="field-help">다음 질문으로 넘긴 답은 바꿀 수 없습니다.</p></div>${errorHtml()}<div class="action-bar"><span></span>${btn(a().turn >= a().questionCount ? '답변 마치고 피드백 보기 →' : '답변 보내고 다음 질문 →', 'answer-next', { primary: true })}</div>${a().answers.length >= 3 ? `<div class="early-exit">${btn('시간이 부족해요: 피드백 보기', 'early-feedback')}</div>` : ''}</section>`;
  }
  function feedbackHtml(feedback, readOnly = false) {
    return `<div class="feedback-overview"><h3>우리 모둠 답변 돌아보기</h3><p><b>잘한 점</b> &nbsp;${h(feedback.summary?.good)}</p><p><b>보완할 점</b> &nbsp;${h(feedback.summary?.improve)}</p></div><div class="feedback-legend">● 잘 바탕함 &nbsp; ◐ 조금 &nbsp; ○ 보완 필요<br>신뢰성·타당성·태도를 살피는 연습용 피드백입니다.</div>${feedback.items.map((item, index) => `<article class="feedback-item"><span class="criterion-badge">질문 ${index + 1} · ${h(item.criterion)}</span><p class="criterion-meaning">${h(item.criterionDescription || '')}</p><p class="feedback-question">${h(a().answers[index]?.question?.confirm || item.confirm || '')}<br>${h(a().answers[index]?.question?.verify || item.verify || '')}</p><div class="my-answer"><span>우리 모둠의 답변</span>${h(item.answer || a().answers[index]?.answer)}</div><div class="ratings"><span class="rating">신뢰성 ${h(item.reliability)} ${h(label(item.reliability))}</span><span class="rating">타당성 ${h(item.validity)} ${h(label(item.validity))}</span><span class="rating">태도 ${h(item.attitude)}</span></div><p class="feedback-comment">${h(item.comment)}</p><div class="better"><strong>보완할 방향</strong>${h(item.better)}</div></article>`).join('')}${readOnly ? `<div class="my-answer"><span>모둠 성찰</span>${h(a().reflection)}</div>` : ''}`;
  }
  function feedbackView() {
    return `<section class="activity-panel"><div class="section-kicker">STEP 03 · 피드백과 성찰</div><h2>모둠의 답변을 함께 돌아보세요.</h2>${busy ? '<p class="busy-note"><span class="spinner"></span>피드백을 확인하고 있어요.</p>' : ''}${feedbackHtml(a().feedback)}<div class="reflection-box"><label class="field-label" for="l4-reflection">모둠 성찰 · 10~150자</label><textarea id="l4-reflection" data-input="l4-reflection" maxlength="150" rows="4" placeholder="다음 입론과 답변에서는 어떤 점을 보완할까요?">${h(a().reflection)}</textarea>${count('reflection', a().reflection, 150)}</div>${errorHtml()}<div class="action-bar"><span></span>${btn('모둠 결과 저장하기 →', 'submit', { primary: true })}</div></section>`;
  }
  // ---- AI 토론 화면 ----
  const debateAvailable = () => getConfig().l4DebateAvailable === true && !a().forceScript;
  const drafts = () => (a().debateDrafts ||= {});
  function stanceButtons() {
    return `<div class="choice-grid l4-stance">${['찬성', '반대'].map(stance => `<button class="reason-button ${a().stance === stance ? 'selected' : ''}" data-action="l4-stance" data-value="${stance}" aria-pressed="${a().stance === stance}"><span class="radio-mark">${a().stance === stance ? '✓' : ''}</span><span>${stance}</span></button>`).join('')}</div>`;
  }
  function debateArgumentView() {
    return `<section class="activity-panel"><div class="section-kicker">STEP 01 · 우리 모둠 입론</div><h2>이미 작성한 입론을 넣어 주세요.</h2><p class="section-intro">AI 토론에서는 ①·⑤ 입론이 모두 필요합니다.<br>우리 모둠과 반대 입장을 맡은 AI가 교과서의 12단계 순서로 토론합니다.</p><div class="motion"><span class="motion-tag">토론 논제</span>${h(LESSON4_CONTENT.motion)}</div>${stanceButtons()}<label class="field-label" for="l4-arg1">① 우리 모둠 입론1 · 20~1500자</label><textarea id="l4-arg1" data-input="l4-arg1" maxlength="1500" rows="8" placeholder="모둠에서 작성한 입론을 붙여 넣거나 적어 주세요.">${h(a().arg1)}</textarea>${count('arg1', a().arg1, 1500)}<label class="field-label" for="l4-arg5" style="margin-top:25px">⑤ 우리 모둠 입론2 · 20~1500자</label><textarea id="l4-arg5" data-input="l4-arg5" maxlength="1500" rows="6" placeholder="두 번째 입론을 붙여 넣거나 적어 주세요.">${h(a().arg5)}</textarea>${count('arg5', a().arg5, 1500)}<div class="chat-notice ai-notice" role="note"><b>AI 토론 안내</b><br>${h(AI_NOTICE)}</div>${errorHtml()}<div class="action-bar">${btn('모둠 정보 확인', 'entry')}<div class="trailing">${btn('AI 토론 시작 →', 'debate-start', { primary: true })}</div></div></section>`;
  }
  function materialHtml(card) {
    const link = card.url && /^https:\/\//.test(card.url) ? ` · <a href="${h(card.url)}" target="_blank" rel="noopener noreferrer">원문 보기</a>` : '';
    return `<div class="debate-material ${card.virtual === false ? 'real' : ''}"><div class="virtual-strip"><span>${h(card.badge || '수업용 가상 자료')}</span><span>${h(card.id)}</span></div>${card.virtual === false ? `<p><b>${h(card.title)}</b></p>` : ''}<p>${h(card.content)}</p><small>${h(card.source)}${link}</small></div>`;
  }
  function debateLineHtml(row, d) {
    const ai = row.actor === 'ai', who = ai ? `AI · ${d.aiStance}측` : `우리 모둠 · ${a().stance}측`;
    const badge = ai ? (row.mode === 'ai' ? 'AI 생성 발언' : row.mode === 'script-fallback' ? '대본 질문' : '') : '';
    return `<article class="debate-line ${ai ? 'ai' : 'group'}"><header><b>${h(row.label || '')}</b><span>${h(who)} · ${h(DEBATE_KIND_LABELS[row.kind] || '')}</span>${badge ? `<span class="debate-badge">${badge}</span>` : ''}</header><p>${h(row.text)}</p>${(row.materials || []).map(materialHtml).join('')}</article>`;
  }
  function debateStepsHtml(d) {
    const current = d.next?.step || 13;
    return `<ol class="debate-steps" aria-label="12단계 토론 순서">${DEBATE_SEQUENCE.map(item => { const skipped = item.kind === '반박' && d.rebuttal === false; const mine = item.side === a().stance; return `<li class="${skipped ? 'skipped' : item.step < current ? 'done' : item.step === current ? 'current' : ''} ${mine ? 'mine' : 'ai'}" ${item.step === current ? 'aria-current="step"' : ''}><b>${item.step}</b><span>${item.side} ${item.no} ${item.kind}</span><small>${skipped ? '생략' : mine ? '우리 모둠' : 'AI'}</small></li>`; }).join('')}</ol>`;
  }
  function debateTurnPanel(d) {
    const next = d.next;
    if (!next) return busy ? '<p class="busy-note"><span class="spinner"></span>토론을 정리하고 있어요.</p>' : '';
    if (next.actor === 'ai') {
      if (busy) return `<p class="busy-note"><span class="spinner"></span>AI가 ${h(next.label)} · ${h(DEBATE_KIND_LABELS[next.kind])}을 준비하고 있어요. 30초쯤 걸릴 수 있어요.</p>`;
      if (d.aiError) return `<div class="debate-turn"><p class="error-message" role="alert">${h(d.aiError.message)}</p><div class="action-bar">${d.aiError.canScript ? btn('대본 활동으로 바꾸기', 'debate-to-script') : '<span></span>'}${btn('다시 시도', 'debate-ai', { primary: true })}</div></div>`;
      return `<div class="action-bar"><span></span>${btn('AI 발언 불러오기', 'debate-ai', { primary: true })}</div>`;
    }
    const heading = `${next.label} · ${DEBATE_KIND_LABELS[next.kind]}`;
    if (next.kind === 'group_constructive') return `<div class="debate-turn"><h3>${h(heading)}</h3><p class="field-help">미리 입력한 ${next.slot === 1 ? '①' : '⑤'} 입론을 우리 모둠의 입론${next.slot}로 발표합니다.</p><div class="my-answer"><span>우리 모둠 입론${next.slot}</span>${h(next.slot === 1 ? a().arg1 : a().arg5)}</div><div class="action-bar"><span></span>${btn(`입론${next.slot} 발표하기 →`, 'debate-send', { primary: true })}</div></div>`;
    const [min, max] = DEBATE_LIMITS.group[next.kind], value = drafts()[next.turnNo] || '';
    const guide = { group_question: `AI 입론${next.slot}에 반대 신문 질문을 해 주세요(${next.exchange}/${d.exchanges}). 상대가 실제로 한 말을 짚어 구체적이고 제한적으로 물어요.`,
      group_answer: '방금 받은 AI의 질문에 답해 주세요. 인정할 것은 인정하고, 근거와 이유의 연결을 밝혀요.',
      group_rebuttal: `우리 모둠 반박${next.slot}입니다. 앞에서 나온 쟁점을 골라 우리 주장이 유지되는 이유를 정리해요.` }[next.kind];
    return `<div class="debate-turn"><h3>${h(heading)}</h3><p class="field-help">${h(guide)}</p><label class="field-label" for="l4-debate-draft">${h(DEBATE_KIND_LABELS[next.kind])} · ${min}~${max}자</label><textarea id="l4-debate-draft" data-input="l4-debate-draft" maxlength="${max}" rows="${next.kind === 'group_rebuttal' ? 6 : 4}" placeholder="모둠에서 상의한 내용을 대표가 입력해요.">${h(value)}</textarea>${count('debate-draft', value, max)}<div class="action-bar"><span></span>${btn('보내기 →', 'debate-send', { primary: true })}</div></div>`;
  }
  function debateView() {
    const d = a().debate;
    const early = d.next && d.next.actor === 'group' && d.cursor >= d.earlyFinishTurn ? `<div class="early-exit">${btn('시간이 부족해요: 토론 마치기', 'debate-finish-early')}</div>` : '';
    return `<section class="activity-panel"><div class="section-kicker">STEP 02 · AI와 반대 신문식 토론</div><h2>${h(a().stance)}측 우리 모둠과 ${h(d.aiStance)}측 AI의 토론</h2><p class="section-intro">교과서의 12단계 순서로 진행합니다. 모둠 차례마다 상의한 내용을 대표가 입력해요.</p><div class="chat-notice">상대 발언은 AI가 만든 글이에요. 틀리거나 근거가 부족할 수 있으니 그대로 믿지 말고 질문으로 확인하세요.</div>${debateStepsHtml(d)}<div class="debate-log" aria-live="polite">${d.transcript.map(row => debateLineHtml(row, d)).join('') || '<p class="field-help">아직 발언이 없어요.</p>'}</div>${debateTurnPanel(d)}${errorHtml()}${early}</section>`;
  }
  function debateReviewHtml(readOnly = false) {
    const d = a().debate, review = d.review || { weaknesses: [], aiTurns: 0, fallbackTurns: 0, groupTurns: 0 };
    return `<div class="feedback-overview"><h3>AI 입론에 남겨 둔 허점</h3>${review.weaknesses.map(item => `<article class="feedback-item"><span class="criterion-badge">${h(item.label)}</span><p><b>${h(item.weaknessLabel)}</b> · ${h(item.guide)}</p></article>`).join('') || '<p>AI 입론까지 진행하지 않았어요.</p>'}<p class="field-help">우리 모둠은 이 허점을 신문이나 반박에서 짚었나요? AI가 근거 없이 말한 부분은 없었나요?</p></div><div class="feedback-legend">AI 발언 ${Number(review.aiTurns)}회 · 대본 대체 ${Number(review.fallbackTurns)}회 · 우리 모둠 발언 ${Number(review.groupTurns)}회<br>점수가 아니라 돌아보기 자료입니다.</div><details class="debate-transcript" ${readOnly ? 'open' : ''}><summary>토론 기록 다시 보기</summary>${d.transcript.map(row => debateLineHtml(row, d)).join('')}</details>${readOnly ? `<div class="my-answer"><span>모둠 성찰</span>${h(a().reflection)}</div>` : ''}`;
  }
  function debateReviewView() {
    return `<section class="activity-panel"><div class="section-kicker">STEP 03 · 돌아보기와 성찰</div><h2>토론을 함께 돌아보세요.</h2>${a().debate.earlyFinish ? '<p class="field-help">시간 관계로 일부 단계를 마치지 않고 끝냈어요.</p>' : ''}${debateReviewHtml()}<div class="reflection-box"><label class="field-label" for="l4-reflection">모둠 성찰 · 10~150자</label><textarea id="l4-reflection" data-input="l4-reflection" maxlength="150" rows="4" placeholder="AI와 토론하며 우리 입론에서 보완할 점은 무엇이었나요?">${h(a().reflection)}</textarea>${count('reflection', a().reflection, 150)}</div>${errorHtml()}<div class="action-bar"><span></span>${btn('모둠 결과 저장하기 →', 'debate-submit', { primary: true })}</div></section>`;
  }
  function completeView() {
    const pending = queue.getItems().find(item => item.payload.submissionId === a().submissionId);
    const closed = pending?.errorCode === 'LESSON_CLOSED';
    return `<section class="activity-panel"><div class="complete-symbol" aria-hidden="true">✓</div><div class="section-kicker">4차시 · 모둠 활동 기록</div><h2>모둠의 결과와 성찰</h2><div class="status-banner ${a().status === 'sent' ? 'sent' : ''}" role="status">${a().status === 'sent' ? '<b>선생님께 전달했어요.</b><br>모둠 단위로 결과가 저장되었습니다.' : closed ? '<b>활동이 닫혀 전송을 기다리고 있어요.</b><br>선생님이 다시 열면 아래에서 다시 전송해 주세요.' : pending?.blocked ? '<b>기록을 확인해야 해요.</b><br>이 기기에 결과를 보관 중입니다. 선생님께 알려 주세요.' : '<b>전송 대기 중이에요.</b><br>기기에 결과를 보관했어요. 연결되면 자동으로 다시 보냅니다.'}</div><div class="my-answer"><span>모둠 성찰</span>${h(a().reflection)}</div><div class="action-bar">${btn(a().debate ? '토론 다시 보기' : '피드백 다시 보기', 'review')}<div class="trailing">${a().status !== 'sent' ? btn('다시 전송', 'retry') : ''}${btn('결과 내려받기 ↓', 'download', { primary: true })}</div></div>${a().showReview ? (a().debate ? debateReviewHtml(true) : feedbackHtml(a().feedback, true)) : ''}</section>`;
  }
  function view() {
    if (!getAccess().allowed) return `<div id="main-content" tabindex="-1">${closedView(4)}</div>`;
    const debate = Boolean(a().debate) || debateAvailable();
    const titles = { entry: '모둠 정보', argument: '입론 입력', dialogue: debate ? 'AI 토론' : '반대 신문', feedback: debate ? '돌아보기·성찰' : '피드백·성찰', complete: '활동 결과' };
    const currentStage = { debate: 'dialogue', 'debate-review': 'feedback' }[a().stage] || a().stage;
    return `<div id="main-content" tabindex="-1" class="l4-layout"><div class="hero"><div><div class="eyebrow">화법과 언어 · LESSON 04</div><h1>모둠 입론으로<br><em>${debate ? 'AI와 토론해요.' : '반대 신문에 답해요.'}</em></h1><p>${debate ? '작성한 입론으로 반대 입장의 AI와 12단계 반대 신문식 토론을 합니다.' : '작성한 입론을 읽고 모둠이 상의해 답하는 대본 활동입니다.'}</p></div>${a().identity ? `<div class="l4-group-label"><b>${h(a().identity.groupName)}</b><span>${a().identity.cls}반 · ${a().identity.memberStudentIds.length}명 · 대표 ${h(maskStudentId(a().identity.studentId))}</span></div>` : ''}</div><ol class="stepper l4-stepper">${Object.entries(titles).map(([stage, name], i) => `<li class="${stage === currentStage ? 'current' : ''}"><b>${i + 1}</b><span>${name}</span></li>`).join('')}</ol>${({ entry: entryView, argument: argumentView, dialogue: dialogueView, feedback: feedbackView, complete: completeView,
      debate: () => (a().debate ? debateView() : argumentView()), 'debate-review': () => (a().debate ? debateReviewView() : argumentView()) }[a().stage] || entryView)()}</div>`;
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
  // ---- AI 토론 요청 ----
  const debatePost = (op, extra = {}, timeoutMs = 20000) => api.post('l4_debate', { ...common(), sessionId: a().debate.sessionId, op, ...extra }, { timeoutMs });
  function debateMessage(caught) {
    if (caught.code === 'LESSON_CLOSED') return '선생님이 4차시를 닫았습니다. 입력한 내용은 보관했어요.';
    if (caught.code === 'DEBATE_UNAVAILABLE') return 'AI 토론이 지금 열려 있지 않아요. 선생님께 확인해 주세요.';
    if (mayUseLocalFallback(caught)) return '연결이 불안정해요. 잠시 뒤 다시 시도해 주세요. 입력한 내용은 보관했어요.';
    return caught.message;
  }
  function applyDebate(data) {
    const d = a().debate;
    Object.assign(d, { debateVersion: data.debateVersion, aiStance: data.aiStance, exchanges: data.exchanges, rebuttal: data.rebuttal, turns: data.turns,
      transcript: data.transcript || [], cursor: data.cursor, next: data.next, earlyFinishTurn: data.earlyFinishTurn, finished: data.finished,
      earlyFinish: data.earlyFinish, review: data.review });
    d.aiError = data.unavailable ? { reason: data.unavailable.reason, message: data.unavailable.message, canScript: true } : null;
    if (data.finished && a().stage === 'debate') a().stage = 'debate-review';
  }
  async function debateRequest(work) {
    const token = ++generation, sid = a().debate?.sessionId; busy = true; error = ''; render();
    try {
      const result = await work(() => token === generation && sid === a().debate?.sessionId);
      return result;
    } catch (caught) {
      if (token !== generation || sid !== a().debate?.sessionId) return false;
      if (caught.code === 'INVALID_STEP') { try { const { data } = await debatePost('state'); applyDebate(data); } catch { /* 아래 안내 유지 */ } }
      if (a().debate?.next?.actor === 'ai') a().debate.aiError = { reason: caught.code, message: debateMessage(caught), canScript: !mayUseLocalFallback(caught) && caught.code !== 'LESSON_CLOSED' };
      else error = debateMessage(caught);
      return false;
    } finally { if (token === generation) { busy = false; show(); } }
  }
  async function debateContinue() {
    for (let guard = 0; guard < 8 && a().stage === 'debate' && a().debate?.next?.actor === 'ai' && !a().debate.aiError && getAccess().allowed; guard++) {
      if (!await debateAiTurn()) return;
    }
    if (a().stage === 'debate' && a().debate && !a().debate.next && !a().debate.finished) await debateFinish(false);
  }
  function debateAiTurn() {
    const d = a().debate, turnNo = d.next.turnNo;
    d.requestIds ||= {}; d.requestIds[turnNo] ||= makeLesson4Id('req'); d.aiError = null;
    return debateRequest(async current => {
      for (let attempt = 0; attempt < 12; attempt++) {
        const { data } = await debatePost('ai_turn', { turnNo, requestId: d.requestIds[turnNo] }, 40000);
        if (!current()) return false;
        // 같은 차례를 서버가 만드는 중이면 잠시 뒤 결과를 받아 옵니다.
        if (data.pending) { await wait(Number(data.retryAfterMs) || 3000); if (!current()) return false; continue; }
        applyDebate(data); return !data.unavailable;
      }
      a().debate.aiError = { reason: 'TIMEOUT', message: 'AI 응답이 늦어지고 있어요. 다시 시도해 주세요.', canScript: false }; return false;
    });
  }
  async function debateStart() {
    if (!ensureOpen()) return;
    const draft = a();
    try {
      if (!['찬성', '반대'].includes(draft.stance)) throw new Error('찬성 또는 반대를 선택해 주세요.');
      validateDebateArguments({ arg1: draft.arg1, arg5: draft.arg5 });
      if (!api.isConfigured()) throw new Error('AI 토론은 서버 연결이 필요해요. 선생님께 알려 주세요.');
    } catch (caught) { return fail(caught.message); }
    draft.debate ||= { sessionId: makeLesson4Id('l4d'), requestIds: {}, transcript: [] };
    draft.mode = 'debate'; draft.startedAt ||= Date.now();
    const started = await debateRequest(async current => {
      const { data } = await debatePost('start', { selection: { stance: draft.stance, arg1: draft.arg1, arg5: draft.arg5 } });
      if (!current()) return false;
      applyDebate(data); draft.stage = data.finished ? 'debate-review' : 'debate';
      delete progress[draft.sessionId]; storage.setItem(progressKey, JSON.stringify(progress)); return true;
    });
    if (!started && a().stage !== 'debate') { a().debate = null; a().mode = 'script-local'; save(); render(); return; }
    await debateContinue();
  }
  async function debateSend() {
    if (!ensureOpen()) return;
    const d = a().debate, turn = d?.next;
    if (!turn || turn.actor !== 'group') return;
    let text;
    try { if (turn.kind !== 'group_constructive') text = validateGroupTurn(turn, String(drafts()[turn.turnNo] || '')); }
    catch (caught) { return fail(caught.message); }
    const sent = await debateRequest(async current => {
      const { data } = await debatePost('group_turn', { turnNo: turn.turnNo, ...(text === undefined ? {} : { text }) });
      if (!current()) return false;
      applyDebate(data); delete drafts()[turn.turnNo]; return true;
    });
    if (sent) await debateContinue();
  }
  function debateFinish(early) {
    return debateRequest(async current => {
      const { data } = await debatePost('finish', { earlyFinish: early });
      if (!current()) return false;
      applyDebate(data); return true;
    });
  }
  async function debateRecover() {
    if (!a().debate || busy || !api.isConfigured() || !getAccess().allowed) return;
    const synced = await debateRequest(async current => {
      const { data } = await debatePost('state'); if (!current()) return false; applyDebate(data); return true;
    });
    if (synced) await debateContinue();
  }
  async function debateSubmit() {
    if (!ensureOpen() || !a().debate?.finished) return;
    try {
      const reflection = a().reflection.trim();
      if (reflection.length < DEBATE_LIMITS.reflectionMin || reflection.length > DEBATE_LIMITS.reflectionMax) throw new Error('모둠 성찰은 10~150자로 써 주세요.');
      if (containsPrivateData(reflection)) throw new Error('이름·학번·전화번호·이메일을 글에서 빼고 다시 입력해 주세요.');
      const payload = { ...common(), sessionId: a().debate.sessionId, kind: 'l4_debate_session', submissionId: a().submissionId, groupNo: '',
        data: { sessionId: a().debate.sessionId, debateVersion: a().debate.debateVersion || '1.0.0', reflection, earlyFinish: Boolean(a().debate.earlyFinish),
          durationSec: Math.max(0, Math.round((Date.now() - a().startedAt) / 1000)) } };
      a().reflection = reflection; a().stage = 'complete'; a().status = 'pending'; error = ''; save(); queue.enqueue(payload); render(); await queue.flush({ force: true }); render();
    } catch (caught) { fail(caught.message); }
  }
  function debateToScript() {
    // 토론 기록은 서버에 남기고, 같은 입론으로 기존 대본 활동을 새로 시작할 수 있게 합니다.
    Object.assign(a(), { debate: null, debateDrafts: {}, mode: 'script-local', forceScript: true, stage: 'argument',
      sessionId: makeLesson4Id('l4s'), submissionId: makeLesson4Id('l4sub'), session: null, answers: [], answerDrafts: {}, helpSelections: {}, remoteQuestions: {}, feedback: null, turn: 1 });
    generation++; busy = false; error = ''; show(); toast('대본 반대 신문 활동으로 바꾸었어요.');
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
      toast('모둠 활동에 입장했어요.');
      if (draft.stage === 'argument') sendProgress('argument');
      if (draft.stage === 'dialogue' && !draft.remoteQuestions[draft.turn]) remote('question');
      if (['debate', 'debate-review'].includes(draft.stage) && draft.debate) debateRecover();
    } catch (caught) { fail(caught.message); }
  }
  function handleInput(key, value) {
    if (!ensureOpen()) return;
    const field = key.replace(/^l4-/, '');
    if (/^member-\d$/.test(field)) a().memberEntries[Number(field.split('-')[1])] = value;
    else if (field === 'answer') a().answerDrafts[a().turn] = value;
    else if (field === 'debate-draft') { if (!a().debate?.next) return; drafts()[a().debate.next.turnNo] = value; }
    else if (['representative', 'groupName', 'arg1', 'arg5', 'reflection'].includes(field)) a()[field] = value;
    else return;
    const node = globalThis.document?.querySelector(`[data-l4-count="${field}"]`); if (node) node.textContent = String(value.length); save();
  }
  function debateResultText() {
    const draft = a(), d = draft.debate;
    // AI 입론 전문은 빈칸 모범 답안처럼 쓰이지 않도록 내려받기 파일에서 뺍니다.
    const lines = d.transcript.map(row => `${row.label} · ${row.actor === 'ai' ? `AI(${d.aiStance}측)` : '우리 모둠'} · ${DEBATE_KIND_LABELS[row.kind] || ''}\n${row.actor === 'ai' && row.kind === 'constructive' ? '(AI 입론 전문은 화면에서만 확인합니다.)' : row.text}\n`);
    return ['4차시 AI 토론 활동 결과', `모둠: ${draft.identity.groupName} / ${draft.identity.cls}반`, `대표: ${draft.identity.studentId}`, `모둠원: ${draft.identity.memberStudentIds.join(', ')}`,
      `전송 상태: ${draft.status === 'sent' ? '서버 저장 완료' : '전송 대기 · 기기 보관'}`, `입장: ${draft.stance} (상대: AI ${d.aiStance}측)`, '', ...lines,
      '모둠 성찰', draft.reflection, '', 'AI 발언은 인공 지능이 만든 글이며 사실 검증을 거치지 않았습니다. 도움 자료는 수업용 가상 자료입니다.'].join('\n');
  }
  function resultText() {
    const draft = a();
    if (draft.debate) return debateResultText();
    return ['4차시 모둠 반대 신문 활동 결과', `모둠: ${draft.identity.groupName} / ${draft.identity.cls}반`, `대표: ${draft.identity.studentId}`, `모둠원: ${draft.identity.memberStudentIds.join(', ')}`, `전송 상태: ${draft.status === 'sent' ? '서버 저장 완료' : '전송 대기 · 기기 보관'}`, '', `입장: ${draft.stance}`, '① 입론', draft.arg1, ...(draft.arg5 ? ['', '⑤ 입론', draft.arg5] : []), '', ...draft.answers.flatMap((item, index) => [`질문 ${index + 1}`, item.question.confirm, item.question.verify, `답변: ${item.answer}`, `인용 자료: ${item.helpIds.join(', ') || '없음'}`, `검토 기준: ${draft.feedback.items[index]?.criterion || ''}`, `신뢰성 ${draft.feedback.items[index]?.reliability || ''} / 타당성 ${draft.feedback.items[index]?.validity || ''} / 태도 ${draft.feedback.items[index]?.attitude || ''}`, `보완 방향: ${draft.feedback.items[index]?.better || ''}`, '']), '모둠 성찰', draft.reflection, '', '질문과 도움 자료는 수업용 대본·가상 자료입니다.'].join('\n');
  }
  async function handleClick(action, node) {
    if (!ensureOpen() || busy) return;
    error = '';
    if (action === 'l4-stance') { a().stance = node.dataset.value; show(); }
    else if (action === 'l4-entry') { a().stage = 'entry'; show(); }
    else if (action === 'l4-start') await start();
    else if (action === 'l4-debate-start') await debateStart();
    else if (action === 'l4-debate-send') await debateSend();
    else if (action === 'l4-debate-ai') { if (a().debate) { a().debate.aiError = null; await debateContinue(); } }
    else if (action === 'l4-debate-finish-early') { if (await debateFinish(true)) show(); }
    else if (action === 'l4-debate-submit') await debateSubmit();
    else if (action === 'l4-debate-to-script') debateToScript();
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
    // 주기적 설정 확인마다 토론 상태를 다시 읽지 않고, 남은 AI 차례만 이어 받습니다.
    if (a().stage === 'debate' && a().debate) { if (a().debate.next?.actor === 'ai' && !a().debate.aiError) await debateContinue(); }
    else if (a().stage === 'dialogue' && a().session && !a().remoteQuestions[a().turn]) await remote('question');
    else if (a().stage === 'feedback' && a().blocked) await remote('feedback');
  }
  return { render: view, handleForm, handleInput, handleClick, onConfigChanged, startRecovery, recover, resultText, suspend,
    hasPending: () => queue.getItems().length > 0, stop: () => queue.stop(), isBusy: () => busy };
}
