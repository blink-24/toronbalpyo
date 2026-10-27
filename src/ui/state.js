export const STATE_KEY = 'chaeum:v5:state';
export const uid = prefix => `${prefix}_${globalThis.crypto?.randomUUID?.().replaceAll('-', '').slice(0, 24) || `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`}`;
export function validateStudentId(value, config = {}) {
  const id = String(value || '').trim();
  if (!/^\d{5}$/.test(id)) return false;
  return Number(id[0]) === Number(config.grade || 2) && Number(id.slice(1, 3)) >= 1 && Number(id.slice(1, 3)) <= Number(config.classCount || 11) && Number(id.slice(3)) >= 1 && Number(id.slice(3)) <= 99;
}
export const maskStudentId = value => /^\d{5}$/.test(String(value || '')) ? `${String(value).slice(0, 3)}**` : '학생';
export const studentClass = value => Number(String(value).slice(1, 3));
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function containsPrivateData(value) {
  return /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|(?:01[016789]|0\d{1,2})[- .]?\d{3,4}[- .]?\d{4}|(?:제\s*이름은|내\s*이름은)\s*\S+|\b2\d{4}\b/.test(String(value || ''));
}
export function freshActivity() {
  return { step: 'stance', stance: '', reasonId: '', reasonText: '', cardId: '', argText: '', sessionId: uid('s'), submissionId: uid('sub'), startedAt: 0, turn: 1, answerDrafts: {}, helpSelections: {}, remoteQuestions: {}, session: null, feedback: null, reflection: '', mode: 'script-local', status: 'draft', earlyFinish: false };
}
export function initialState() { return { version: 5, studentId: '', tab: 'learn', learningIndex: 0, learned: [], activityView: 'perform', activity: freshActivity() }; }
export function loadState(storage) {
  try { const parsed = JSON.parse(storage.getItem(STATE_KEY)); if (parsed?.version === 5) return { ...initialState(), ...parsed, activity: { ...freshActivity(), ...parsed.activity } }; } catch {}
  return initialState();
}
export function saveState(storage, state) { storage.setItem(STATE_KEY, JSON.stringify(state)); }
export function composeArgument({ stance, reasonText, card, motion }) {
  const date = card.year && card.year !== '밝혀지지 않음' ? `의 ${card.year} 자료` : '';
  const reason = reasonText.replace(/[.。]+$/, '');
  return `저는 '${motion}'는 논제에 ${stance}합니다.\n그 이유는 ${reason}.\n${card.source}${date}에 따르면 '${card.content.replace(/[.。]+$/, '')}'라고 합니다.`;
}
export function publicCard(card) {
  return Object.fromEntries(['id', 'source', 'year', 'method', 'content', 'virtual'].map(key => [key, card[key] ?? '밝혀지지 않음']));
}
