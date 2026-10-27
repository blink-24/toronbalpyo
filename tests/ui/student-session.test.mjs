import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { initialState, saveState, loadState, saveStudentDraft, restoreStudentDraft, signedOutState } from '../../src/ui/state.js';
const memory = () => { const values = new Map(); return { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) }; };
const main = fs.readFileSync(new URL('../../src/main.js', import.meta.url), 'utf8');
function source(start, end) { return main.slice(main.indexOf(start), main.indexOf(end, main.indexOf(start) + start.length)); }

test('동일 기기 재입장은 학습·문항·작성 중 답·확정 답·제출 ID를 그대로 복원한다', () => {
  const storage = memory(), original = initialState(); original.studentId = '21301'; original.learned = [0, 1, 3]; original.learningIndex = 3;
  Object.assign(original.activity, { step: 'dialogue', turn: 2, answerDrafts: { 2: '아직 보내지 않은 우리 답변입니다.' }, committedAnswers: [{ turn: 1, answer: '첫 확정 답변입니다.' }], argText: '수정한 입론입니다.' });
  saveStudentDraft(storage, original); saveState(storage, signedOutState(original));
  const anonymous = loadState(storage); assert.equal(anonymous.studentId, ''); assert.equal(anonymous.activity.argText, '');
  const restored = restoreStudentDraft(storage, '21301', anonymous);
  assert.deepEqual(restored.activity, original.activity); assert.deepEqual(restored.learned, original.learned); assert.equal(restored.learningIndex, 3);
  assert.equal(restored.activity.sessionId, original.activity.sessionId); assert.equal(restored.activity.submissionId, original.activity.submissionId);
  assert.equal(restored.tab, original.tab);
});
test('학생 교체와 예전 스냅샷 복원 때 다른 학생 답변·모둠 로그인은 따라오지 않는다', () => {
  const storage = memory(), a = initialState(); a.studentId = '20301'; a.activity.argText = '첫 학생만의 초안입니다.'; a.lesson4.identity = { groupName: '다른 모둠' };
  saveStudentDraft(storage, a); assert.equal(JSON.parse(storage.getItem('chaeum:v5:student:20301')).lesson4, undefined);
  const b = restoreStudentDraft(storage, '20302', signedOutState(a)); assert.equal(b.activity.argText, ''); assert.equal(b.lesson4.identity, null);
  storage.setItem('chaeum:v5:student:20301', JSON.stringify(a));
  const legacy = restoreStudentDraft(storage, '20301'); assert.equal(legacy.activity.argText, a.activity.argText); assert.equal(legacy.lesson4.identity, null);
});
test('로그아웃은 대기 큐를 건드리지 않으며 완료/전송 상태도 복원한다', () => {
  const storage = memory(), a = initialState(); a.studentId = '20301'; a.activity.step = 'complete'; a.activity.status = 'pending';
  storage.setItem('chaeum:v5:submission-queue', 'KEEP_PENDING'); saveStudentDraft(storage, a);
  const out = signedOutState({ ...a, lesson: 4 }); assert.equal(out.lesson, 4); assert.equal(out.studentId, ''); assert.equal(out.lesson4.identity, null);
  assert.equal(restoreStudentDraft(storage, '20301', out).activity.status, 'pending'); assert.equal(storage.getItem('chaeum:v5:submission-queue'), 'KEEP_PENDING');
});
test('로그아웃 뒤 늦게 실패한 질문 요청은 새 입장 상태를 차단하지 않는다', async () => {
  let reject;
  const context = { state: initialState(), requestGeneration: 0, busy: false, errorMessage: '', lessonIsOpen: () => true, render() {}, persist() {},
    turnPayload: () => ({}), mayUseLocalFallback: () => false, api: { isConfigured: () => true, post: () => new Promise((_, no) => { reject = no; }) } };
  context.state.activity.session = {}; vm.runInNewContext(source('async function ensureQuestion()', 'async function showFeedback(') + ';globalThis.run=ensureQuestion;', context);
  const pending = context.run(); context.requestGeneration++; context.state = initialState(); context.busy = false;
  reject(Object.assign(new Error('다른 학생에게 표시하면 안 되는 오류'), { code: 'INVALID_SESSION' })); await pending;
  assert.equal(context.state.activity.blocked, undefined); assert.equal(context.errorMessage, ''); assert.equal(context.busy, false);
});
test('로그아웃 뒤 교사 조회 응답이 와도 교사 로그인과 기록을 되살리지 않는다', async () => {
  let resolve;
  const context = { requestGeneration: 0, teacherPasscode: '', teacherClass: 1, teacherLesson: 2, teacherData: null, teacherRows: [], errorMessage: '', busy: false, render() {},
    api: { isConfigured: () => true, get: () => new Promise(yes => { resolve = yes; }) } };
  vm.runInNewContext(source('async function loadTeacher(', 'function openDialog(') + ';globalThis.run=loadTeacher;', context);
  const pending = context.run('fake-private-passcode', 1); context.requestGeneration++;
  // 첫 응답 뒤 두 번째 조회는 더 이상 진행하지 않는 것이 안전합니다.
  context.api.get = async () => ({ data: [] }); resolve({ data: { total: 1 } }); await pending;
  assert.equal(context.teacherPasscode, ''); assert.equal(context.teacherData, null); assert.equal(context.teacherRows.length, 0);
});
test('저장 공간 오류 때 로그아웃은 현재 활동을 지우지 않는다', () => {
  const original = initialState(); original.studentId = '20301'; original.activity.argText = '아직 기기에 보관해야 할 초안입니다.';
  const context = { state: original, storage: {}, saveStudentDraft() { throw new Error('quota'); } };
  vm.runInNewContext(source('function logoutStudent()', 'function hero()') + ';globalThis.run=logoutStudent;', context);
  assert.throws(() => context.run(), /quota/); assert.equal(context.state, original); assert.equal(context.state.activity.argText, original.activity.argText);
});
