import { CONTENT, learningSlides19, learningSections, getReasons, getEvidenceCards } from './core/content.js';
import { createEngine } from './core/engine.js';
import { createApiClient, mayUseLocalFallback } from './network/client.js';
import { createSubmissionQueue } from './network/queue.js';
import { STATE_KEY, uid, validateStudentId, maskStudentId, studentClass, escapeHtml as h, containsPrivateData, freshActivity, initialState, loadState, saveState, composeArgument, publicCard } from './ui/state.js';

const app = document.querySelector('#app');
const dialogRoot = document.querySelector('#dialog-root');
const runtime = globalThis.CLASSROOM_CONFIG || globalThis.APP_CONFIG || {};
const APP_VERSION = runtime.appVersion || '5.0.0';
const memory = new Map();
const memoryStorage = { getItem: key => memory.get(key) || null, setItem: (key, value) => memory.set(key, String(value)), removeItem: key => memory.delete(key) };
let storage;
try { localStorage.setItem('chaeum:probe', '1'); localStorage.removeItem('chaeum:probe'); storage = localStorage; } catch { storage = memoryStorage; }
let state = loadState(storage);
state.activity.committedAnswers ||= [];
const engine = createEngine(CONTENT);
let endpointOverride = storage.getItem('chaeum:public-endpoint') || '';
const api = createApiClient({ endpoint: endpointOverride || runtime.apiUrl || runtime.apiEndpoint || '' });
let serverConfig = { grade: 2, classCount: 11, acceptLessons: [2], l2Questions: 3, aiEnabled: false, publicSharing: true };
let busy = false;
let errorMessage = '';
let teacherPasscode = '';
let teacherClass = state.studentId ? studentClass(state.studentId) : 1;
let teacherData = null;
let teacherRows = [];
let sharedData = null;
let shareLoading = false;
let toastTimer;
let previousFocus;
let requestGeneration = 0;
let progressSending = false;
let previouslyQueuedPayloads = [];
const progressStorageKey = 'chaeum:v5:progress-queue';
let progressQueue = safeParse(storage.getItem(progressStorageKey) || '{}');

function persist() {
  try {
    saveState(storage, state);
    if (state.studentId) storage.setItem(`chaeum:v5:student:${state.studentId}`, JSON.stringify(state));
  } catch { toast('기기 저장 공간이 부족해요. 이 창을 유지하고 선생님께 알려 주세요.'); }
  const label = document.querySelector('[data-save-label]'); if (label) label.textContent = storage === memoryStorage ? '이 창에서 이어 하기' : '저장됨 · 방금';
}

const queue = createSubmissionQueue({ storage, api, onChange(items) {
  const pendingIds = new Set(items.map(item => item.payload.submissionId));
  for (const delivered of previouslyQueuedPayloads.filter(payload => !pendingIds.has(payload.submissionId))) {
    if (delivered.studentId && delivered.studentId !== state.studentId) {
      const key = `chaeum:v5:student:${delivered.studentId}`;
      const saved = safeParse(storage.getItem(key) || '{}');
      if (saved.activity?.submissionId === delivered.submissionId) {
        saved.activity.status = 'sent'; storage.setItem(key, JSON.stringify(saved));
      }
    }
  }
  previouslyQueuedPayloads = items.map(item => item.payload);
  if (state.activity.status === 'pending' && !items.some(item => item.payload.submissionId === state.activity.submissionId)) {
    state.activity.status = 'sent'; persist(); if (state.activity.step === 'complete') render();
  }
  const pending = document.querySelector('[data-pending-count]'); if (pending) pending.textContent = String(items.length);
}});
previouslyQueuedPayloads = queue.getItems().map(item => item.payload);

function toast(message) {
  const node = document.querySelector('#toast'); node.textContent = message; node.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => node.classList.remove('show'), 4200);
}
function scrollToMain() { const main = document.querySelector('#main-content'); main?.scrollIntoView({ block: 'start', behavior: 'instant' }); main?.focus({ preventScroll: true }); }
function setError(message) { errorMessage = message; render(); document.querySelector('.error-message')?.scrollIntoView({ block: 'nearest' }); }
function isTeacher() { return location.hash.startsWith('#/teacher'); }
function entered() { return validateStudentId(state.studentId, serverConfig); }
function selectedCard() { return CONTENT.evidenceCards.find(card => card.id === state.activity.cardId); }
function committed() { return state.activity.committedAnswers || []; }
function currentQuestion() {
  if (!state.activity.session) return null;
  const local = engine.getQuestion(state.activity.session, state.activity.turn);
    return { ...local, ...(state.activity.remoteQuestions[state.activity.turn] || {}) };
}
function errorHtml() { return errorMessage ? `<p class="error-message" role="alert">${h(errorMessage)}</p>` : ''; }
function button(label, action, { primary = false, disabled = false, extra = '', className = '' } = {}) {
  return `<button type="button" class="btn ${primary ? 'primary' : ''} ${className}" data-action="${action}" ${disabled ? 'disabled' : ''} ${extra}>${label}</button>`;
}
function header() {
  return `<div class="top-rule"><header class="topbar"><a href="#/learn" class="brand" aria-label="채움 학습 홈"><span class="brand-icon" aria-hidden="true">◒</span><span class="wordmark">채움<span>·</span></span><span class="brand-sub">화법과 언어<br>생각을 나누는 교실</span></a><div class="top-actions">${entered() ? `<button type="button" class="text-btn identity" data-action="identity" aria-label="학생 입장 정보 변경">${h(maskStudentId(state.studentId))} · ${studentClass(state.studentId)}반</button>` : `<button class="text-btn" data-action="login-dialog">학생 입장</button>`}<button class="text-btn" data-action="teacher">교사용</button></div></header></div>`;
}
function footer() { return `<footer class="page-footer"><span>채움 · 화법과 언어 &nbsp; / &nbsp; 2차시 발표와 토론</span><span>교과서 201~203쪽 · 토론과 반대 신문</span></footer>`; }
function hero() {
  return `<section class="hero" aria-label="수업 소개"><div><div class="eyebrow">화법과 언어 · LESSON 02</div><h1>반대 신문으로<br><em>입론을 점검해요.</em></h1><p>토론의 개념을 익히고, 내 입론을 검토하는 질문에 답해 보세요.</p></div><div class="hero-art" aria-hidden="true"><span class="hero-letter">생각</span><span>+</span><span class="hero-letter">질문</span></div></section>`;
}
function tabs() {
  return `<nav class="main-tabs" role="tablist" aria-label="수업 활동"><button id="tab-learn" class="main-tab" role="tab" aria-selected="${state.tab === 'learn'}" aria-controls="main-content" data-action="tab" data-value="learn"><span class="tab-num">01</span>PPT 내용 학습<span class="tab-desc">개념을 차근차근</span></button><button id="tab-activity" class="main-tab" role="tab" aria-selected="${state.tab === 'activity'}" aria-controls="main-content" data-action="tab" data-value="activity"><span class="tab-num">02</span>활동 수행 · 결과 공유<span class="tab-desc">질문에 직접 답하기</span></button></nav>`;
}

const debateSequence = ['찬성 1 입론', '반대 2 신문', '반대 1 입론', '찬성 1 신문', '찬성 2 입론', '반대 1 신문', '반대 2 입론', '찬성 2 신문', '반대 1 반박', '찬성 1 반박', '반대 2 반박', '찬성 2 반박'];
function conceptExtra(slide) {
  const title = slide.title || '';
  if (/타당성|신뢰성·공정성|검토 기준/.test(title)) return `<div class="concept-grid">${Object.entries(CONTENT.criterionExplanations).map(([name, text]) => `<div class="concept-box"><strong>검토 기준</strong><h3>${h(name)}</h3><p>${h(text)}</p></div>`).join('')}</div>`;
  if (/절차|12단계|토론의 순서/.test(title)) return `<div class="sequence" aria-label="2대2 반대 신문식 토론의 12단계">${debateSequence.map((label, i) => `<div class="sequence-item"><b>${i + 1}</b><span>${label}</span></div>`).join('')}</div>`;
  if (/폐쇄형|확인.*검증|질문의 형태|구체적이고 제한적인/.test(title)) return `<div class="sample-pair"><div class="sample-row good"><b>확인 질문 · 상대가 한 말을 정확히 짚기</b>“이 방법이 사고를 줄인다고 말씀하셨지요?”</div><div class="sample-row good"><b>검증 질문 · 연결의 빈틈을 구체적으로 묻기</b>“사고가 줄어든 원인이 이 방법뿐이라고 확인하셨습니까?”</div><div class="sample-row bad"><b>넓게 열어 두는 질문과 구별하기</b>“이 문제를 어떻게 생각하세요?”</div></div>`;
  if (/논제.*유형|논제의 종류/.test(title)) return `<div class="concept-grid"><div class="concept-box"><h3>사실</h3><p>참인지 거짓인지 따집니다.</p></div><div class="concept-box"><h3>가치</h3><p>옳거나 바람직한지 따집니다.</p></div><div class="concept-box"><h3>정책</h3><p>어떤 행동을 해야 하는지 따집니다.</p></div></div>`;
  return '';
}
function learningView() {
  const slides = learningSlides19 || CONTENT.learningSlides19 || [];
  if (!slides.length) return `<div class="empty-box"><h2>학습 자료를 준비하고 있어요.</h2></div>`;
  state.learningIndex = Math.min(slides.length - 1, Math.max(0, state.learningIndex));
  const slide = slides[state.learningIndex];
  let lastGroup = '';
  const menu = slides.map((item, index) => {
    const group = (learningSections || []).find(section => section.slides.includes(item.slide ?? index + 1));
    let heading = ''; if (group && group.id !== lastGroup) { lastGroup = group.id; heading = `<div class="menu-group">${h(group.title)}</div>`; }
    return `${heading}<button class="lesson-link ${index === state.learningIndex ? 'active' : ''} ${state.learned.includes(index) ? 'done' : ''}" data-action="learn-slide" data-index="${index}" ${index === state.learningIndex ? 'aria-current="step"' : ''}><span class="lesson-number">${state.learned.includes(index) ? '✓' : String(index + 1).padStart(2, '0')}</span><span>${h(item.title)}</span></button>`;
  }).join('');
  return `<div class="learning-layout"><aside class="lesson-menu" aria-label="학습 목차"><div class="menu-heading">오늘의 학습<span>${state.learned.length} / ${slides.length}</span></div><div class="mini-progress"><span style="width:${state.learned.length / slides.length * 100}%"></span></div>${menu}</aside><div><label class="sr-only" for="mobile-lesson">학습 장 선택</label><select class="mobile-lesson-select" id="mobile-lesson" data-input="lesson-select">${slides.map((s, i) => `<option value="${i}" ${i === state.learningIndex ? 'selected' : ''}>${String(i + 1).padStart(2, '0')} · ${h(s.title)}</option>`).join('')}</select><article class="lesson-card"><div class="lesson-topline"><span class="chapter">토론 · 반대 신문의 방법</span><span>${h(Array.isArray(slide.textbookPages) ? slide.textbookPages.join(' · ') : slide.textbookPages || '교과서 201~203쪽')}</span></div><h2>${h(slide.title)}</h2><ul class="lesson-points">${(slide.points || []).map(point => `<li>${h(point)}</li>`).join('')}</ul>${conceptExtra(slide)}<div class="lesson-footer">${button('← 이전', 'learn-prev', { disabled: state.learningIndex === 0 })}${button(state.learningIndex === slides.length - 1 ? '활동으로 가기 →' : '이해했어요 · 다음 →', state.learningIndex === slides.length - 1 ? 'learn-finish' : 'learn-next', { primary: true })}</div></article><div class="learning-bottom"><span>최종 PPT 19장에 맞춘 개념 요약 · 교과서와 함께 읽어요.</span><span>${state.learningIndex + 1} / ${slides.length}</span></div></div></div>`;
}
function loginView() {
  return `<section class="activity-panel intro-login"><div class="section-kicker">반대 신문 체험 · 개인 활동</div><h2>내 생각으로 시작해 볼까요?</h2><p class="section-intro">학번만 입력하면 활동을 이어서 할 수 있어요.<br>모둠 번호나 이름은 입력하지 않습니다.</p><div class="motion"><span class="motion-tag">오늘의 정책 논제</span>${h(CONTENT.motion)}</div><form class="login-form" data-form="login"><label class="sr-only" for="student-id">학번 5자리</label><input id="student-id" name="studentId" inputmode="numeric" pattern="[0-9]{5}" maxlength="5" autocomplete="off" placeholder="학번 5자리 (예: 20315)" required><button class="btn primary" type="submit">입장하기 →</button></form>${errorHtml()}<p class="login-caption">화면에는 203**처럼 끝 두 자리를 가려 보여요.</p></section>`;
}
function stepper() {
  const steps = CONTENT.steps; let current = steps.findIndex(step => step.id === state.activity.step); if (state.activity.step === 'complete') current = 6;
  return `<ol class="stepper" aria-label="활동 단계">${steps.map((step, i) => `<li class="${i < current ? 'complete' : ''} ${i === current ? 'current' : ''}" ${i === current ? 'aria-current="step"' : ''}><b>${i < current ? '✓' : String(i + 1).padStart(2, '0')}</b><span>${h(step.label)}</span></li>`).join('')}</ol>`;
}
function aside() {
  const a = state.activity;
  return `<aside class="activity-aside"><div class="aside-note"><span class="tiny-label">내 생각의 밑그림</span><h3>한 문장씩, 차근차근</h3>${a.stance ? `<div class="summary-item"><b>입장</b><p>${h(a.stance)} · ${a.stance === '찬성' ? '벌금을 부과해야 한다' : '벌금을 부과해서는 안 된다'}</p></div>` : '<p>먼저 나의 입장을 골라 보세요.</p>'}${a.reasonText ? `<div class="summary-item"><b>이유</b><p>${h(a.reasonText)}</p></div>` : ''}${a.cardId ? `<div class="summary-item"><b>선택한 자료</b><p>자료 ${h(a.cardId)}<br>${h(selectedCard()?.source)}</p></div>` : ''}</div><div class="aside-note"><h3>이렇게 생각해 보세요.</h3><p>주장과 이유, 근거가 서로 어떻게 이어지는지 살펴보세요.</p><p>모르는 내용은 꾸며 답하지 않아도 괜찮아요. 인정할 것은 인정하고 생각을 보완해요.</p></div></aside>`;
}
function actionBar({ previous = true, nextLabel = '다음으로 →', nextAction = 'next', nextDisabled = false } = {}) {
  return `<div class="action-bar">${previous ? button('← 이전', 'previous') : '<span class="action-spacer"></span>'}<div class="trailing">${button(busy ? '<span class="spinner" aria-hidden="true"></span>잠시만요' : nextLabel, nextAction, { primary: true, disabled: busy || nextDisabled })}</div></div>`;
}
function stanceView() {
  return `<div class="section-kicker">STEP 01 · 입장 세우기</div><h2>어느 쪽에 동의하나요?</h2><div class="motion"><span class="motion-tag">정책 논제</span>${h(CONTENT.motion)}</div><div class="choice-grid">${CONTENT.stances.map((stance, i) => `<button class="stance-button ${state.activity.stance === stance.value ? 'selected' : ''}" data-action="stance" data-value="${h(stance.value)}" aria-pressed="${state.activity.stance === stance.value}"><span class="choice-letter">${i === 0 ? 'A' : 'B'} &nbsp; 나의 입장${state.activity.stance === stance.value ? '<span class="choice-check">✓</span>' : ''}</span><strong>${h(stance.value)}</strong><span>${h(stance.value === '찬성' ? '벌금을 부과해야 한다.' : '벌금을 부과해서는 안 된다.')}</span></button>`).join('')}</div>${errorHtml()}${actionBar({ previous: false, nextDisabled: !state.activity.stance })}`;
}
function reasonView() {
  return `<div class="section-kicker">STEP 02 · 이유 찾기</div><h2>왜 그렇게 생각하나요?</h2><p class="section-intro">내 입장을 뒷받침할 이유를 고르거나 직접 써 보세요.</p><div class="reason-list">${getReasons(state.activity.stance).map(reason => `<button class="reason-button ${state.activity.reasonId === reason.id ? 'selected' : ''}" data-action="reason" data-id="${reason.id}" aria-pressed="${state.activity.reasonId === reason.id}"><span class="radio-mark">${state.activity.reasonId === reason.id ? '✓' : ''}</span><span>${h(reason.custom ? '내 말로 직접 쓰기' : reason.text)}</span></button>`).join('')}</div>${state.activity.reasonId === 'RX' ? `<div class="custom-reason"><label class="field-label" for="reason-text">나의 이유</label><textarea id="reason-text" data-input="reasonText" maxlength="120" rows="4" placeholder="내 입장에 동의하는 까닭을 10~120자로 써 보세요.">${h(state.activity.reasonText)}</textarea><div class="char-count"><span data-count="reasonText">${state.activity.reasonText.length}</span> / 120자</div></div>` : ''}${errorHtml()}${actionBar({ nextDisabled: !state.activity.reasonId })}`;
}
function cardHtml(rawCard, { kind = 'evidence', selected = false, citation = false } = {}) {
  const card = publicCard(rawCard);
  return `<article class="evidence-card ${selected ? 'selected' : ''}"><div class="virtual-strip"><span>수업용 가상 자료</span><span>${h(card.id)}</span></div><div class="evidence-body"><div class="evidence-id">${kind === 'help' ? '도움 자료' : '근거 자료'} ${h(card.id)}</div><p>${h(card.content)}</p><dl class="card-facts"><dt>출처</dt><dd>${h(card.source)}</dd><dt>시기</dt><dd>${h(card.year)}</dd><dt>방법</dt><dd>${h(card.method)}</dd></dl></div>${citation ? `<button class="evidence-select" data-action="cite" data-id="${h(card.id)}">＋ 이 자료 인용</button>` : `<button class="evidence-select" data-action="card" data-id="${h(card.id)}" aria-pressed="${selected}">${selected ? '✓ 선택한 자료' : '이 자료 선택하기'}</button>`}</article>`;
}
function evidenceView() {
  return `<div class="section-kicker">STEP 03 · 근거 살피기</div><h2>어떤 자료로 뒷받침할까요?</h2><p class="section-intro">같은 입장의 자료라도 출처와 시기, 조사 방법은 달라요.</p><div class="instruction-line">${h(CONTENT.labels.cardInstruction)}</div><div class="evidence-grid">${getEvidenceCards(state.activity.stance).map(card => cardHtml(card, { selected: state.activity.cardId === card.id })).join('')}</div>${errorHtml()}${actionBar({ nextDisabled: !state.activity.cardId })}`;
}
function argumentView() {
  return `<div class="section-kicker">STEP 04 · 내 입론 다듬기</div><h2>세 요소를 하나로 이어 보세요.</h2><p class="section-intro">고른 입장·이유·자료로 초안을 만들었어요. 내 생각에 맞게 고쳐 써도 좋아요.</p><div class="arg-preview"><div class="arg-line"><b>주장</b><span>${h(state.activity.stance)} · ${h(CONTENT.stances.find(x => x.value === state.activity.stance)?.claim)}</span></div><div class="arg-line"><b>이유</b><span>${h(state.activity.reasonText)}</span></div><div class="arg-line"><b>근거</b><span>자료 ${h(state.activity.cardId)} · ${h(selectedCard()?.source)}</span></div></div><label class="field-label" for="arg-text">나의 입론</label><textarea id="arg-text" data-input="argText" maxlength="300" rows="8">${h(state.activity.argText)}</textarea><div class="char-count"><span data-count="argText">${state.activity.argText.length}</span> / 300자</div><p class="field-help">이름이나 연락처는 쓰지 않아요. 자료의 출처를 입론 안에 밝혀 주세요.</p>${errorHtml()}${actionBar({ nextLabel: '반대 신문 시작 →' })}`;
}
function dialogueView() {
  const q = currentQuestion(); const a = state.activity;
  if (!q) return `<h2>질문을 준비하고 있어요.</h2><p class="busy-note"><span class="spinner"></span>잠시만 기다려 주세요.</p>`;
  return `<div class="section-kicker">STEP 05 · 반대 신문</div><h2>질문을 듣고, 답해 보세요.</h2><p class="section-intro">내 입론의 어떤 부분을 묻는지 살펴보고 자료와 함께 답해요.</p><div class="chat-notice">${h(CONTENT.labels.chatNotice)}</div>${a.mode !== 'ai' ? `<div class="script-notice">${h(CONTENT.labels.scriptNotice)}</div>` : ''}<div class="chat-person"><span class="bot-avatar" aria-hidden="true">?</span>반대측 토론자<span class="tiny-label" style="margin:0 0 0 auto">질문 ${a.turn} / ${a.questionCount || 3}</span></div><div class="question-bubble" aria-live="polite"><span class="question-index">확인하고, 검증하기</span><p>${h(q.confirm)}</p><p>${h(q.verify)}</p></div>${busy ? '<p class="busy-note"><span class="spinner"></span>질문을 확인하고 있어요.</p>' : ''}<div class="help-heading"><strong>답변에 활용할 도움 자료</strong><span>필요한 자료만 인용해요.</span></div><div class="evidence-grid help-cards">${(q.helpCards || []).map(card => cardHtml(card, { kind: 'help', citation: true })).join('')}</div><div class="answer-field"><label class="field-label" for="answer-text">나의 답변</label><textarea id="answer-text" data-input="answer" maxlength="300" rows="5" placeholder="인정할 것은 인정하고, 내 주장을 지킬 근거를 덧붙여 보세요.">${h(a.answerDrafts[a.turn] || '')}</textarea><div class="char-count"><span data-count="answer">${(a.answerDrafts[a.turn] || '').length}</span> / 300자</div><p class="field-help">다음 질문으로 넘어간 뒤에는 이 답을 고칠 수 없어요.</p></div>${errorHtml()}${actionBar({ previous: false, nextLabel: a.turn >= a.questionCount ? '답변 마치고 피드백 보기 →' : '답변 보내고 다음 질문 →', nextAction: 'commit-answer' })}${committed().length >= 2 && a.turn <= a.questionCount ? `<div class="early-exit"><button data-action="early-feedback">${h(CONTENT.labels.earlyFeedback)}</button></div>` : ''}`;
}
const ratingLabel = symbol => CONTENT.feedbackRules.ratingLabels[symbol] || '확인 중';
function feedbackView() {
  const feedback = state.activity.feedback || engine.getFeedback(state.activity.session);
  return `<div class="section-kicker">STEP 06 · 피드백과 성찰</div><h2>질문이 내 입론에 남긴 것</h2><p class="section-intro">이제 각 질문이 겨냥했던 기준을 함께 확인해요.</p>${busy ? '<p class="busy-note"><span class="spinner"></span>피드백을 확인하고 있어요.</p>' : ''}<div class="feedback-overview"><h3>내 답변 돌아보기</h3><p><b>잘한 점</b> &nbsp;${h(feedback.summary?.good)}</p><p><b>보완할 점</b> &nbsp;${h(feedback.summary?.improve)}</p><div class="feedback-counts"><span>신뢰성 바탕 ● ${Number(feedback.summary?.reliabilityGood ?? feedback.items?.filter(item => item.reliability === '●').length ?? 0)}개</span><span>타당성 바탕 ● ${Number(feedback.summary?.validityGood ?? feedback.items?.filter(item => item.validity === '●').length ?? 0)}개</span></div></div>${(feedback.summary?.cardWarning || selectedCard()?.reliability === '낮음') ? `<div class="warning-line">${h(feedback.summary?.cardWarning && feedback.summary.cardWarning !== true ? feedback.summary.cardWarning : CONTENT.labels.weakCardReminder)}</div>` : ''}<div class="feedback-legend">● 잘 바탕함 &nbsp; ◐ 조금 &nbsp; ○ 보완 필요<br>답변의 표현을 살피는 연습용 피드백이에요. 점수에 반영하지 않습니다.</div>${(feedback.items || []).map((item, index) => {
    const answer = committed()[index]; const question = answer?.question || {};
    return `<article class="feedback-item"><span class="criterion-badge">질문 ${item.turn || index + 1} · ${h(item.criterion)}</span><p class="criterion-meaning">${h(item.criterionDescription || CONTENT.criterionExplanations[item.criterion])}</p><p class="feedback-question">${h(question.confirm || '')}<br>${h(question.verify || '')}</p><div class="my-answer"><span>나의 답변</span>${h(item.answer || answer?.answer || '')}</div><div class="ratings"><span class="rating">신뢰성 <strong>${h(item.reliability)}</strong> ${h(ratingLabel(item.reliability))}</span><span class="rating">타당성 <strong>${h(item.validity)}</strong> ${h(ratingLabel(item.validity))}</span><span class="rating">태도 <strong>${h(item.attitude)}</strong></span></div><p class="feedback-comment">${h(item.comment)}</p><div class="better"><strong>이렇게 답하면 더 좋아요</strong>${h(item.better)}</div></article>`;
  }).join('')}<div class="reflection-box"><label class="field-label" for="reflection-text">한 줄 성찰 · 10~150자</label><p class="section-intro">반대 신문을 받아 보니, 다음에 입론을 쓸 때 무엇을 더 살펴볼 건가요?</p><textarea id="reflection-text" data-input="reflection" maxlength="150" rows="4" placeholder="다음에 입론을 쓸 때에는…">${h(state.activity.reflection)}</textarea><div class="char-count"><span data-count="reflection">${state.activity.reflection.length}</span> / 150자</div></div>${errorHtml()}${actionBar({ previous: false, nextLabel: '성찰과 함께 제출하기 →', nextAction: 'submit', nextDisabled: busy })}`;
}
function completeView() {
  const a = state.activity; const pending = queue.getItems().find(item => item.payload.submissionId === a.submissionId);
  const failed = pending && !mayUseLocalFallback({ code: pending.errorCode }) && pending.errorCode;
  return `<div class="complete-symbol" aria-hidden="true">✓</div><div class="section-kicker">오늘의 활동 기록</div><h2>활동 기록과 성찰</h2><p class="section-intro">나의 입론과 답변, 마지막 성찰을 함께 돌아보세요.</p><div class="status-banner ${a.status === 'sent' ? 'sent' : failed ? 'error' : ''}" role="status">${a.status === 'sent' ? '<b>선생님께 전달했어요.</b><br>활동 기록이 제출되었습니다.' : failed ? '<b>제출 내용을 확인해야 해요.</b><br>기록은 기기에 보관 중이에요. 선생님께 알려 주세요.' : '<b>전송 대기 중이에요.</b><br>기기에 기록을 보관했어요. 연결이 준비되면 자동으로 다시 보냅니다. 이 기기의 기록을 지우지 말아 주세요.'}</div><label class="field-label">내가 남긴 성찰</label><div class="my-answer">${h(a.reflection)}</div><div class="action-bar">${button('피드백 다시 보기', 'review-feedback')}<div class="trailing">${a.status !== 'sent' ? button('다시 전송', 'retry-submit') : ''}${button('결과 공유 보기 →', 'share', { primary: true })}</div></div><p class="ack-note">제출 여부와 관계없이 학습 탭에서 개념을 다시 볼 수 있어요.</p>`;
}
function activityView() {
  return `<div class="activity-switch" aria-label="활동과 결과"><button class="${state.activityView !== 'share' ? 'active' : ''}" data-action="perform">활동 수행</button><button class="${state.activityView === 'share' ? 'active' : ''}" data-action="share">결과 공유</button></div>${state.activityView === 'share' ? shareView() : !entered() ? loginView() : !serverConfig.acceptLessons.map(Number).includes(2) ? '<div class="empty-box"><h2>아직 열리지 않은 활동이에요.</h2><p>선생님의 안내를 기다려 주세요.</p></div>' : `<div class="activity-topline"><span class="save-status"><span class="save-dot"></span><span data-save-label>${storage === memoryStorage ? '이 창에서 이어 하기' : '저장됨 · 방금'}</span></span><div class="activity-meta">${state.activity.startedAt && state.activity.step !== 'complete' ? '<span class="timer" data-timer>안내 18:00</span>' : ''}<button class="chip" data-action="textbook">교과서 볼 곳 ↗</button></div></div>${stepper()}<div class="activity-layout"><section class="activity-panel">${({ stance: stanceView, reason: reasonView, evidence: evidenceView, argument: argumentView, dialogue: dialogueView, feedback: feedbackView, complete: completeView }[state.activity.step] || stanceView)()}</section>${aside()}</div>`}`;
}
function bars(counts, labels = {}) {
  const entries = Object.entries(counts || {}); const max = Math.max(1, ...entries.map(([, count]) => Number(count)));
  return entries.length ? entries.map(([key, value]) => `<div class="bar-row"><span>${h(labels[key] || key)}</span><div class="bar-track" aria-hidden="true"><div class="bar-fill" style="width:${Math.max(0, Math.min(100, Number(value) / max * 100))}%"></div></div><span>${Number(value) || 0}명</span></div>`).join('') : '<p class="share-note">아직 모인 결과가 없어요.</p>';
}
function shareView() {
  if (!entered()) return loginView();
  if (shareLoading) return '<div class="empty-box"><span class="spinner"></span><p>우리 반의 생각을 모으고 있어요.</p></div>';
  if (!sharedData) return `<div class="empty-box"><div class="section-kicker">우리 반의 생각 모아 보기</div><h2>모인 결과를 함께 볼까요?</h2><p>입장과 자료 선택을 익명으로 모아 보여 줍니다.<br>학번이나 친구의 개별 답변은 표시하지 않아요.</p>${button('모인 결과 새로 보기', 'refresh-share', { primary: true })}<p class="quiet-note">${api.isConfigured() ? '아직 결과를 불러오지 못했어요. 잠시 뒤 다시 확인해 주세요.' : '선생님이 결과 공유를 준비하면 이곳에서 확인할 수 있어요.'}</p></div>`;
  const total = Number(sharedData.total ?? sharedData.count ?? 0); const stance = sharedData.stanceCounts || sharedData.byStance || {};
  return `<section><div class="teacher-top"><div><div class="section-kicker">결과 공유 · ${studentClass(state.studentId)}반</div><h2>서로 다른 생각, 함께 살펴보기</h2></div>${button('새로 보기 ↻', 'refresh-share', { className: 'small' })}</div><div class="share-grid"><div class="share-metric"><b>${total}</b><span>모인 활동 기록</span></div><div class="share-metric"><b>${Number(stance['찬성'] ?? stance.pro ?? 0)}</b><span>벌금 부과에 찬성</span></div><div class="share-metric"><b>${Number(stance['반대'] ?? stance.con ?? 0)}</b><span>벌금 부과에 반대</span></div></div><div class="chart-panel"><h3>어떤 근거 카드를 골랐을까요?</h3>${bars(sharedData.cardCounts || sharedData.byCard)}</div><p class="share-note">자료 번호별 선택 수만 보여 줍니다. 어느 친구가 골랐는지는 알 수 없어요.<br>선택 수가 많다는 사실만으로 그 자료가 더 믿을 만한 것은 아니에요.</p></section>`;
}

function teacherView() {
  if (!teacherPasscode || !teacherData) return `<div class="teacher-wrap"><div class="teacher-top"><div><div class="section-kicker">TEACHER'S DESK</div><h1>교사용 모아 보기</h1></div>${button('학생 화면으로', 'student-screen')}</div><section class="activity-panel intro-login"><h2>수업 기록을 확인합니다.</h2><p class="section-intro">교사용 암호를 확인한 뒤 기록을 불러옵니다.</p><form data-form="teacher-login"><label class="field-label" for="teacher-class">반</label><select id="teacher-class" name="cls">${Array.from({ length: 11 }, (_, i) => `<option value="${i + 1}" ${teacherClass === i + 1 ? 'selected' : ''}>${i + 1}반</option>`).join('')}</select><label class="field-label" for="teacher-passcode" style="margin-top:20px">교사용 암호</label><input id="teacher-passcode" name="passcode" type="password" autocomplete="off" required placeholder="암호 입력"><div class="action-bar"><span></span><button type="submit" class="btn primary" ${busy || !api.isConfigured() ? 'disabled' : ''}>${busy ? '확인 중…' : '확인하고 열기 →'}</button></div></form>${errorHtml()}${!api.isConfigured() ? '<p class="quiet-note">수업 기록을 연결하면 모아 보기를 열 수 있습니다.</p>' : ''}${adminSettings()}</section></div>`;
  const total = Number(teacherData.total ?? teacherData.count ?? teacherRows.length);
  return `<div class="teacher-wrap"><div class="teacher-top"><div><div class="section-kicker">TEACHER'S DESK · 2차시</div><h1>생각의 과정 모아 보기</h1></div><div>${button('학생 화면', 'student-screen')}${button('닫기', 'teacher-logout')}</div></div><div class="teacher-filters"><label for="teacher-filter">반 선택</label><select id="teacher-filter" data-input="teacher-class">${Array.from({ length: 11 }, (_, i) => `<option value="${i + 1}" ${teacherClass === i + 1 ? 'selected' : ''}>${i + 1}반</option>`).join('')}</select>${button('새로 고침', 'teacher-refresh', { className: 'small', disabled: busy })}</div><div class="share-grid"><div class="share-metric"><b>${total}</b><span>활동 기록</span></div><div class="share-metric"><b>${Number(teacherData.completed ?? total)}</b><span>제출 완료</span></div><div class="share-metric"><b>${Math.round(Number(teacherData.lowReliability?.rate || 0) * 100)}%</b><span>출처 재검토가 필요한 자료 선택</span></div></div><div class="chart-panel"><h3>근거 카드 선택 분포</h3>${bars(teacherData.cardCounts || teacherData.byCard)}</div>${teacherProgressPanel()}<div class="chart-panel"><h3>학생별 기록</h3><div class="table-scroll"><table class="teacher-table"><thead><tr><th>학생</th><th>입장</th><th>자료</th><th>진행</th><th>기록</th></tr></thead><tbody>${teacherRows.map((row, i) => `<tr><td>${h(maskStudentId(row.studentId))}</td><td>${h(row.stance || row.data?.stance || '')}</td><td>${h(row.cardId || row.data?.cardId || '')}</td><td>${h(row.stage || row.status || '제출')}</td><td><button class="text-btn" data-action="teacher-record" data-index="${i}">열기 ↗</button></td></tr>`).join('')}</tbody></table></div>${!teacherRows.length ? '<p class="share-note">아직 불러온 개별 기록이 없습니다.</p>' : ''}</div>${errorHtml()}${adminSettings()}</div>`;
}
function adminSettings() {
  return `<details class="admin-details"><summary>연결 설정 · 관리자용</summary><p>Google Apps Script 웹 앱 배포 주소를 사용합니다. 이 주소에는 비밀 키나 교사 암호를 넣지 않습니다.</p><label for="api-endpoint">활동 기록 연결 주소<input id="api-endpoint" data-input="api-endpoint" type="url" value="${h(api.getEndpoint())}" placeholder="https://script.google.com/macros/s/…/exec"></label>${button('주소 저장하고 연결 확인', 'connect-endpoint', { className: 'small' })}<p class="field-help">AI 공급자 기본값은 none입니다. 공급자 키·교사용 암호는 Apps Script의 Script Properties에서 설정합니다. 연결되지 않은 제출은 전송 대기로 유지됩니다.</p></details>`;
}
function render() {
  app.innerHTML = `${header()}<main class="shell" ${isTeacher() ? '' : 'aria-label="수업 공간"'}>${isTeacher() ? teacherView() : `${hero()}${tabs()}<div id="main-content" role="tabpanel" aria-labelledby="tab-${state.tab}" tabindex="-1">${state.tab === 'learn' ? learningView() : activityView()}</div>`}</main>${footer()}`;
  tickTimer();
}

async function refreshConfig() {
  if (!api.isConfigured()) return;
  try {
    const { data } = await api.get('config');
    serverConfig = { ...serverConfig, ...data, acceptLessons: Array.isArray(data.acceptLessons) ? data.acceptLessons : String(data.acceptLessons || '2').split(',').map(Number) };
  } catch (error) { if (!mayUseLocalFallback(error)) toast(error.message); }
}
function beginActivity() {
  if (!state.activity.startedAt) state.activity.startedAt = Date.now();
  state.activity.questionCount ||= Number(serverConfig.l2Questions) === 2 ? 2 : 3; persist();
  const stage = { stance: 'entry', reason: 'reason', evidence: 'card', argument: 'argument' }[state.activity.step];
  if (stage) markProgress(stage);
}
function markProgress(stage) {
  if (!entered()) return;
  progressQueue[state.activity.sessionId] = { lesson: 2, studentId: state.studentId, cls: studentClass(state.studentId), sessionId: state.activity.sessionId, stage, clientTs: new Date().toISOString(), appVersion: APP_VERSION };
  storage.setItem(progressStorageKey, JSON.stringify(progressQueue)); flushProgress();
}
async function flushProgress() {
  if (progressSending || !api.isConfigured() || navigator.onLine === false) return;
  progressSending = true;
  try {
    for (const [id, payload] of Object.entries(progressQueue)) {
      try {
        await api.post('progress', payload);
        if (progressQueue[id]?.clientTs === payload.clientTs) delete progressQueue[id];
        storage.setItem(progressStorageKey, JSON.stringify(progressQueue));
      } catch (error) { if (!mayUseLocalFallback(error)) { delete progressQueue[id]; storage.setItem(progressStorageKey, JSON.stringify(progressQueue)); } }
    }
  } finally { progressSending = false; }
}
function switchTab(value) {
  state.tab = value; errorMessage = '';
  if (value === 'activity' && entered()) { beginActivity(); refreshConfig().then(() => { if (!state.activity.session) { state.activity.questionCount = Number(serverConfig.l2Questions) === 2 ? 2 : 3; persist(); render(); } }); }
  persist(); location.hash = value === 'learn' ? '#/learn' : '#/lesson2'; render();
}
function selectionPayload() {
  const a = state.activity;
  return { stance: a.stance, reasonId: a.reasonId, reasonText: a.reasonText, cardId: a.cardId, argText: a.argText };
}
function turnPayload(mode) {
  return { lesson: 2, sessionId: state.activity.sessionId, studentId: state.studentId, cls: studentClass(state.studentId), mode, turn: state.activity.turn, selection: selectionPayload(), history: committed().map(a => ({ questionId: a.questionId, answer: a.answer, helpIds: a.helpIds })), earlyFinish: state.activity.earlyFinish };
}
function rollbackForRetry(data) {
  const a = state.activity;
  const turn = Math.max(1, Math.min(a.questionCount, Number(data.turn) || Math.max(1, a.turn - 1)));
  const kept = committed().slice(0, turn - 1);
  let session = engine.buildSession({ ...selectionPayload(), sessionId: a.sessionId, questionCount: a.questionCount, seed: a.sessionId });
  kept.forEach(item => { session = engine.recordAnswer(session, { turn: item.turn, answer: item.answer, helpIds: item.helpIds }); });
  a.session = session; a.committedAnswers = kept; a.turn = turn; a.step = 'dialogue'; a.feedback = null; a.earlyFinish = false;
  Object.keys(a.remoteQuestions).forEach(key => { if (Number(key) >= turn) delete a.remoteQuestions[key]; });
  a.remoteQuestions[turn] = data.question; a.mode = data.mode || 'script';
  errorMessage = data.prompt || CONTENT.labels.offTopicReminder;
}
async function ensureQuestion() {
  if (!state.activity.session || state.activity.remoteQuestions[state.activity.turn]) return;
  if (!api.isConfigured()) { state.activity.mode = 'script-local'; persist(); return; }
  const generation = ++requestGeneration; busy = true; render();
  try {
    const { data } = await api.post('turn', turnPayload('question'));
    if (generation !== requestGeneration) return;
    if (data?.retry) { rollbackForRetry(data); return; }
    if (!data?.question?.confirm || !data.question.verify) throw Object.assign(new Error('질문을 확인하지 못했어요.'), { code: 'INVALID_RESPONSE' });
    state.activity.remoteQuestions[state.activity.turn] = data.question;
    state.activity.mode = data.mode || 'script';
  } catch (error) {
    if (mayUseLocalFallback(error)) state.activity.mode = 'script-local';
    else { errorMessage = error.message; state.activity.blocked = true; }
  } finally { if (generation === requestGeneration) { busy = false; persist(); render(); } }
}
async function showFeedback(earlyFinish = false) {
  state.activity.earlyFinish = earlyFinish; state.activity.feedback = engine.getFeedback(state.activity.session); state.activity.step = 'feedback';
  busy = false; errorMessage = ''; persist(); render(); scrollToMain();
  if (!api.isConfigured()) return;
  const generation = ++requestGeneration; busy = true; render();
  try {
    const { data } = await api.post('turn', turnPayload('feedback'));
    if (generation !== requestGeneration) return;
    if (data?.retry) { rollbackForRetry(data); return; }
    if (data.feedback?.items) { state.activity.feedback = data.feedback; state.activity.ruleFeedback = data.ruleFeedback; state.activity.mode = data.mode || state.activity.mode; }
  } catch (error) {
    if (mayUseLocalFallback(error)) state.activity.mode = 'script-local';
    else { state.activity.blocked = true; errorMessage = error.message; }
  } finally { if (generation === requestGeneration) { busy = false; persist(); render(); } }
}
async function nextStep() {
  const a = state.activity;
  errorMessage = '';
  if (a.step === 'stance') { if (!a.stance) return setError('나의 입장을 골라 주세요.'); a.step = 'reason'; }
  else if (a.step === 'reason') {
    if (!a.reasonId) return setError('이유를 고르거나 직접 써 주세요.');
    if (a.reasonId === 'RX' && (a.reasonText.trim().length < 10 || a.reasonText.trim().length > 120)) return setError('직접 쓴 이유는 10~120자로 적어 주세요.');
    if (containsPrivateData(a.reasonText)) return setError('이름·학번·연락처를 지우고 이유만 적어 주세요.'); a.step = 'evidence';
  } else if (a.step === 'evidence') {
    if (!a.cardId) return setError('근거 자료 한 장을 골라 주세요.');
    a.argText = composeArgument({ ...a, card: selectedCard(), motion: CONTENT.motion }); a.step = 'argument';
  } else if (a.step === 'argument') {
    if (!a.argText.trim() || a.argText.length > 300) return setError('나의 입론을 1~300자로 적어 주세요.');
    if (containsPrivateData(a.argText)) return setError('이름·학번·연락처를 지우고 입론만 적어 주세요.');
    a.session = engine.buildSession({ ...selectionPayload(), sessionId: a.sessionId, questionCount: a.questionCount || 3, seed: a.sessionId });
    a.step = 'dialogue'; a.turn = 1; a.blocked = false;
    delete progressQueue[a.sessionId]; storage.setItem(progressStorageKey, JSON.stringify(progressQueue));
  }
  const stage = { reason: 'reason', evidence: 'card', argument: 'argument' }[a.step]; if (stage) markProgress(stage);
  persist(); render(); scrollToMain(); if (a.step === 'dialogue') await ensureQuestion();
}
async function commitAnswer() {
  const a = state.activity; if (a.blocked) return setError('이전 단계의 내용을 확인하고 선생님께 알려 주세요.');
  const answer = String(a.answerDrafts[a.turn] || '').trim();
  if (!answer) return setError(CONTENT.labels.offTopicReminder);
  if (answer.length > 300) return setError('답변은 300자 이내로 적어 주세요.');
  if (containsPrivateData(answer)) return setError('이름·학번·연락처를 지우고 질문에 대한 답만 적어 주세요.');
  const q = currentQuestion(); const helpIds = a.helpSelections[a.turn] || [];
  try { a.session = engine.recordAnswer(a.session, { turn: a.turn, answer, helpIds }); }
  catch (error) { return setError(error.message); }
  a.committedAnswers.push({ turn: a.turn, questionId: q.id, answer, helpIds, question: q });
  errorMessage = '';
  if (a.turn >= a.questionCount) return showFeedback(false);
  a.turn++; persist(); render(); scrollToMain(); await ensureQuestion();
}
async function submitActivity() {
  const a = state.activity; const reflection = a.reflection.trim();
  if (reflection.length < 10 || reflection.length > 150) return setError('한 줄 성찰을 10~150자로 적어 주세요.');
  if (containsPrivateData(reflection)) return setError('이름·학번·연락처를 지우고 성찰만 적어 주세요.');
  if (a.blocked) return setError('기록 내용을 확인해야 해요. 선생님께 알려 주세요.');
  let finished;
  try { finished = engine.finishSession(a.session, { reflection, earlyFinish: a.earlyFinish }); }
  catch (error) { return setError(error.message); }
  a.reflection = reflection; a.status = 'pending'; a.step = 'complete';
  const data = { ...finished, ...selectionPayload(), reflection, earlyFinish: a.earlyFinish, mode: a.mode, durationSec: Math.max(0, Math.round((Date.now() - a.startedAt) / 1000)), feedback: a.feedback, ruleFeedback: a.ruleFeedback, history: committed().map(item => ({ questionId: item.questionId, questionText: `${item.question.confirm} ${item.question.verify}`, answer: item.answer, helpIds: item.helpIds })) };
  const payload = { kind: 'l2_session', lesson: 2, submissionId: a.submissionId, sessionId: a.sessionId, studentId: state.studentId, cls: studentClass(state.studentId), groupNo: '', clientTs: new Date().toISOString(), appVersion: APP_VERSION, data };
  errorMessage = ''; persist(); queue.enqueue(payload); render(); scrollToMain(); await queue.flush({ force: true }); render();
}
async function loadShared() {
  if (!entered()) return;
  const requestedClass = studentClass(state.studentId);
  shareLoading = true; render();
  try {
    if (!api.isConfigured()) { sharedData = null; return; }
    const { data } = await api.get('public_summary', { cls: requestedClass }); if (entered() && studentClass(state.studentId) === requestedClass) sharedData = data;
  } catch { sharedData = null; }
  finally { shareLoading = false; render(); }
}
async function loadTeacher(passcode = teacherPasscode, cls = teacherClass) {
  if (!api.isConfigured()) return setError('먼저 활동 기록 연결 주소를 설정해 주세요.');
  busy = true; errorMessage = ''; render();
  try {
    const summary = await api.get('l2_summary', { cls, passcode });
    const records = await api.get('list', { tab: 'l2_sessions', cls, latest: 1, passcode });
    teacherPasscode = passcode; teacherClass = Number(cls); teacherData = summary.data;
    teacherRows = Array.isArray(records.data) ? records.data : records.data?.rows || records.data?.entries || [];
  } catch (error) { teacherPasscode = ''; teacherData = null; teacherRows = []; errorMessage = error.message; }
  finally { busy = false; render(); }
}
function openDialog(html, { wide = false } = {}) {
  previousFocus = document.activeElement;
  dialogRoot.innerHTML = `<div class="modal-backdrop"><section class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><div class="modal-close-row"><span></span><button class="modal-close" data-action="close-dialog" aria-label="닫기">×</button></div>${html}</section></div>`;
  const focus = dialogRoot.querySelector('input') || dialogRoot.querySelector('button'); focus?.focus();
}
function closeDialog() { dialogRoot.innerHTML = ''; if (previousFocus?.isConnected) previousFocus.focus(); }
function loginDialog() {
  openDialog(`<h2 id="dialog-title">학생 입장</h2><p>학번 5자리만 입력해 주세요.<br>이름과 모둠 번호는 받지 않아요.</p><form data-form="login"><label for="dialog-student-id">학번<input id="dialog-student-id" name="studentId" inputmode="numeric" maxlength="5" pattern="[0-9]{5}" autocomplete="off" placeholder="예: 20315" required></label><div class="action-bar"><span></span><button class="btn primary" type="submit">입장하기 →</button></div></form>`);
}
function showTeacherRecord(index, projectionIndex = null) {
  const row = teacherRows[index]; if (!row) return;
  const record = teacherRecord(row);
  const history = record.history;
  openDialog(`<h2 id="dialog-title">${h(maskStudentId(row.studentId))} · 활동 기록</h2><div class="teacher-record"><label class="field-label">입론</label><pre>${h(record.argText || row.argText || '')}</pre>${history.map((item, j) => `<div class="feedback-item"><span class="criterion-badge">답변 ${j + 1}</span><p>${h(item.questionText || item.question?.verify || '')}</p><div class="my-answer">${h(item.answer || item.text || '')}</div>${button('번호 가리고 화면에 띄우기 ↗', 'project-answer', { className: 'small', extra: `data-record="${index}" data-answer="${j}"` })}</div>`).join('')}<label class="field-label" style="margin-top:24px">성찰</label><pre>${h(record.reflection || row.reflection || '')}</pre>${teacherFeedbackComparison(record)}</div>`, { wide: true });
}
function teacherFeedbackComparison(record) {
  const rule = record.ruleFeedback?.items || record.feedback?.rule || [];
  const ai = record.aiFeedback?.items || record.feedback?.ai || [];
  if (!rule.length && !ai.length) return '';
  return `<section class="admin-details"><h3>규칙 판정과 AI 피드백 비교</h3><p class="field-help">대본 모드에서는 규칙 판정만 표시됩니다.</p><div class="table-scroll"><table class="teacher-table"><thead><tr><th>질문</th><th>항목</th><th>규칙 판정</th><th>AI 피드백</th></tr></thead><tbody>${Array.from({ length: Math.max(rule.length, ai.length) }, (_, index) => ['reliability', 'validity', 'attitude'].map((key, j) => `<tr><td>${j === 0 ? index + 1 : ''}</td><td>${{ reliability: '신뢰성', validity: '타당성', attitude: '태도' }[key]}</td><td>${h(rule[index]?.[key] || '없음')}</td><td>${h(ai[index]?.[key] || '사용 안 함')}</td></tr>`).join('')).join('')}</tbody></table></div></section>`;
}
function teacherProgressPanel() {
  const rows = teacherData?.progress || [];
  if (!rows.length) return '';
  const stageName = stage => ({ entry: '입장', reason: '이유 선택', card: '근거 자료 선택', argument: '입론 작성', feedback: '피드백·성찰', submitted: '제출 완료' }[stage] || (/^question\d/.test(stage) ? `질문 ${stage.replace('question', '')}` : '진행 중'));
  return `<div class="chart-panel"><h3>활동 진행 현황</h3><div class="table-scroll"><table class="teacher-table"><thead><tr><th>학생</th><th>단계</th><th>진행 방식</th></tr></thead><tbody>${rows.map(row => `<tr><td>${h(row.masked || maskStudentId(row.studentId))}</td><td>${h(stageName(row.stage))}</td><td>${row.mode === 'ai' ? 'AI 대담' : row.mode === 'script-local' ? '기기 대본' : '대본'}</td></tr>`).join('')}</tbody></table></div></div>`;
}
function safeParse(value) { try { return JSON.parse(value); } catch { return {}; } }
function teacherRecord(row) {
  const record = typeof row?.data === 'string' ? safeParse(row.data) : row?.data || row || {};
  const history = record.history || record.answers || [1, 2, 3].filter(n => record[`a${n}Text`]).map(n => ({ questionText: record[`q${n}Text`], answer: record[`a${n}Text`], helpIds: record[`a${n}Help`] }));
  return { ...record, history, feedback: typeof record.feedback === 'string' ? safeParse(record.feedback) : record.feedback, ruleFeedback: typeof record.ruleFeedback === 'string' ? safeParse(record.ruleFeedback) : record.ruleFeedback, aiFeedback: typeof record.aiFeedback === 'string' ? safeParse(record.aiFeedback) : record.aiFeedback };
}
function projectAnswer(recordIndex, answerIndex) {
  const record = teacherRecord(teacherRows[recordIndex]);
  const item = record.history[answerIndex]; if (!item) return;
  openDialog(`<h2 id="dialog-title">우리 반 답변 함께 보기</h2><div class="projection"><span class="tiny-label">번호를 가린 답변 사례</span><p>${h(item.answer || item.text || '')}</p></div><div class="action-bar"><span></span>${button('닫기', 'close-dialog')}</div>`, { wide: true });
}

document.addEventListener('click', async event => {
  const node = event.target.closest('[data-action]'); if (!node || node.disabled) return;
  const action = node.dataset.action;
  if (busy && ['next', 'commit-answer', 'submit', 'early-feedback'].includes(action)) return;
  try {
    if (action === 'tab') switchTab(node.dataset.value);
    else if (action === 'learn-slide') { state.learningIndex = Number(node.dataset.index); persist(); render(); }
    else if (action === 'learn-prev') { state.learningIndex--; persist(); render(); scrollToMain(); }
    else if (action === 'learn-next' || action === 'learn-finish') { state.learned = [...new Set([...state.learned, state.learningIndex])]; if (action === 'learn-finish') switchTab('activity'); else { state.learningIndex++; persist(); render(); scrollToMain(); } }
    else if (action === 'stance') { if (state.activity.stance !== node.dataset.value) { state.activity.stance = node.dataset.value; state.activity.reasonId = ''; state.activity.reasonText = ''; state.activity.cardId = ''; state.activity.argText = ''; } errorMessage = ''; persist(); render(); }
    else if (action === 'reason') { state.activity.reasonId = node.dataset.id; state.activity.reasonText = node.dataset.id === 'RX' ? '' : CONTENT.reasons.find(x => x.id === node.dataset.id).text; state.activity.argText = ''; errorMessage = ''; persist(); render(); document.querySelector('#reason-text')?.focus(); }
    else if (action === 'card') { state.activity.cardId = node.dataset.id; state.activity.argText = ''; errorMessage = ''; persist(); render(); }
    else if (action === 'next') await nextStep();
    else if (action === 'previous') { const sequence = ['stance', 'reason', 'evidence', 'argument']; const index = sequence.indexOf(state.activity.step); if (index > 0) { state.activity.step = sequence[index - 1]; errorMessage = ''; persist(); render(); scrollToMain(); } }
    else if (action === 'commit-answer') await commitAnswer();
    else if (action === 'early-feedback') await showFeedback(true);
    else if (action === 'submit') await submitActivity();
    else if (action === 'review-feedback') {
      const feedback = state.activity.feedback;
      openDialog(`<h2 id="dialog-title">피드백 다시 보기</h2>` + `<p>제출한 답변과 성찰을 다시 살펴보세요.</p>${(feedback?.items || []).map(item => `<div class="feedback-item"><span class="criterion-badge">질문 ${item.turn} · ${h(item.criterion)}</span><div class="my-answer">${h(item.answer)}</div><p>${h(item.comment)}</p><div class="better"><strong>보완할 방향</strong>${h(item.better)}</div></div>`).join('')}<div class="my-answer"><span>내가 남긴 성찰</span>${h(state.activity.reflection)}</div>`, { wide: true });
    }
    else if (action === 'retry-submit') { await queue.flush({ force: true }); render(); if (state.activity.status !== 'sent') toast('기록을 보관 중이에요. 연결되면 다시 전송합니다.'); }
    else if (action === 'cite') {
      const q = currentQuestion(); const card = q.helpCards.find(x => x.id === node.dataset.id); if (!card) return;
      const citation = `[자료 ${card.id}] ${card.source} ${card.year && card.year !== '밝혀지지 않음' ? card.year : ''}`.trim();
      const current = state.activity.answerDrafts[state.activity.turn] || ''; const next = `${current}${current ? '\n' : ''}${citation}`;
      if (next.length > 300) return toast('자료 인용을 넣을 공간을 조금 남겨 주세요.');
      state.activity.answerDrafts[state.activity.turn] = next; state.activity.helpSelections[state.activity.turn] = [...new Set([...(state.activity.helpSelections[state.activity.turn] || []), card.id])]; persist(); render(); document.querySelector('#answer-text')?.focus();
    }
    else if (action === 'share') { state.activityView = 'share'; persist(); await loadShared(); }
    else if (action === 'perform') { state.activityView = 'perform'; persist(); render(); }
    else if (action === 'refresh-share') await loadShared();
    else if (action === 'login-dialog' || action === 'identity') loginDialog();
    else if (action === 'close-dialog') closeDialog();
    else if (action === 'textbook') openDialog(`<h2 id="dialog-title">교과서에서 함께 볼 곳</h2><p>개념을 다시 확인하고 싶을 때 찾아보세요.</p><div class="sample-pair"><div class="sample-row"><b>201쪽</b>토론의 개념 · 논제 유형 · 반대 신문의 역할과 절차</div><div class="sample-row"><b>202쪽</b>입론 예시와 ㉠㉡㉢ · 주장·이유·근거</div><div class="sample-row"><b>203쪽</b>타당성·신뢰성·공정성 · 확인·검증 질문 · 폐쇄형 질문</div></div><p class="quiet-note">앱의 예시와 자료 카드는 수업을 위해 따로 만든 내용입니다.</p>`);
    else if (action === 'teacher') { errorMessage = ''; location.hash = '#/teacher'; render(); }
    else if (action === 'student-screen') { location.hash = state.tab === 'learn' ? '#/learn' : '#/lesson2'; render(); }
    else if (action === 'teacher-logout') { teacherPasscode = ''; teacherData = null; teacherRows = []; render(); }
    else if (action === 'teacher-refresh') await loadTeacher();
    else if (action === 'teacher-record') showTeacherRecord(Number(node.dataset.index));
    else if (action === 'project-answer') projectAnswer(Number(node.dataset.record), Number(node.dataset.answer));
    else if (action === 'connect-endpoint') {
      const value = document.querySelector('[data-input="api-endpoint"]').value.trim();
      if (!/^https:\/\//.test(value)) return toast('https로 시작하는 웹 앱 배포 주소를 입력해 주세요.');
      api.setEndpoint(value); storage.setItem('chaeum:public-endpoint', value); busy = true; render();
      try { await api.get('ping'); await refreshConfig(); toast('활동 기록 연결을 확인했어요.'); await queue.flush({ force: true }); }
      catch { toast('연결을 확인하지 못했어요. 배포 주소와 접근 권한을 확인해 주세요.'); }
      finally { busy = false; render(); }
    }
  } catch (error) { setError(error.message || '진행 내용을 확인해 주세요.'); }
});

document.addEventListener('input', event => {
  const key = event.target.dataset.input;
  if (['reasonText', 'argText', 'reflection'].includes(key)) state.activity[key] = event.target.value;
  else if (key === 'answer') state.activity.answerDrafts[state.activity.turn] = event.target.value;
  else return;
  const count = document.querySelector(`[data-count="${key}"]`); if (count) count.textContent = String(event.target.value.length); persist();
});
document.addEventListener('change', async event => {
  if (event.target.dataset.input === 'lesson-select') { state.learningIndex = Number(event.target.value); persist(); render(); }
  if (event.target.dataset.input === 'teacher-class') { teacherClass = Number(event.target.value); await loadTeacher(); }
});
document.addEventListener('submit', async event => {
  const form = event.target; if (!form.dataset.form) return; event.preventDefault(); const data = new FormData(form);
  if (form.dataset.form === 'login') {
    const id = String(data.get('studentId') || '').trim(); if (!validateStudentId(id, serverConfig)) return toast('학년·반·번호를 확인해 학번 5자리를 입력해 주세요.');
    if (id !== state.studentId) {
      requestGeneration++; busy = false; sharedData = null;
      const saved = safeParse(storage.getItem(`chaeum:v5:student:${id}`) || '{}');
      state = saved.version === 5 ? saved : { ...initialState(), learned: state.learned, learningIndex: state.learningIndex, studentId: id, tab: 'activity' };
      state.studentId = id; state.activity.committedAnswers ||= [];
    }
    state.tab = 'activity'; state.activityView = 'perform'; errorMessage = ''; beginActivity(); closeDialog(); location.hash = '#/lesson2'; persist(); render(); await refreshConfig();
    if (!state.activity.session) state.activity.questionCount = Number(serverConfig.l2Questions) === 2 ? 2 : 3;
    persist(); render();
  } else if (form.dataset.form === 'teacher-login') await loadTeacher(String(data.get('passcode') || ''), Number(data.get('cls')));
});
document.addEventListener('keydown', event => {
  if (!dialogRoot.firstChild) {
    if (event.target.getAttribute('role') === 'tab' && ['ArrowRight', 'ArrowLeft'].includes(event.key)) {
      event.preventDefault(); const next = state.tab === 'learn' ? 'activity' : 'learn'; switchTab(next); document.querySelector(`#tab-${next}`)?.focus();
    }
    return;
  }
  if (event.key === 'Escape') closeDialog();
  if (event.key === 'Tab') {
    const focusable = [...dialogRoot.querySelectorAll('button,input,textarea,select,a[href]')].filter(x => !x.disabled); if (!focusable.length) return;
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
});
function tickTimer() {
  const timer = document.querySelector('[data-timer]'); if (!timer || !state.activity.startedAt) return;
  const left = Math.max(0, 1080 - Math.floor((Date.now() - state.activity.startedAt) / 1000));
  timer.textContent = `안내 ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  timer.classList.toggle('warn', left > 0 && left <= 120); timer.classList.toggle('over', left === 0);
}
window.addEventListener('online', () => { queue.flush({ force: true }); flushProgress(); });
window.addEventListener('beforeunload', event => { if (queue.getItems().length) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('hashchange', () => {
  if (location.hash === '#/learn') state.tab = 'learn';
  else if (location.hash === '#/lesson2') state.tab = 'activity';
  errorMessage = ''; persist(); render();
});
setInterval(tickTimer, 1000);
setInterval(flushProgress, 30000);
if (location.hash === '#/lesson2') state.tab = 'activity';
if (location.hash === '#/learn') state.tab = 'learn';
render();
refreshConfig().then(() => { if (!state.activity.session) state.activity.questionCount = Number(serverConfig.l2Questions) === 2 ? 2 : 3; render(); if (state.activity.step === 'dialogue') ensureQuestion(); });
queue.start();
flushProgress();
