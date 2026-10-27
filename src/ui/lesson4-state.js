const makeId = prefix => `${prefix}_${globalThis.crypto?.randomUUID?.().replaceAll('-', '').slice(0, 24) || `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`}`;
export const LESSON4_GROUP_PREFIX = 'chaeum:v5:l4:group:';
export function freshLesson4() {
  return { stage: 'entry', representative: '', groupName: '', memberEntries: ['', '', '', '', ''], identity: null,
    stance: '', arg1: '', arg5: '', sessionId: makeId('l4s'), submissionId: makeId('l4sub'), session: null,
    questionCount: 4, turn: 1, answers: [], answerDrafts: {}, helpSelections: {}, remoteQuestions: {}, feedback: null,
    reflection: '', earlyFinish: false, mode: 'script-local', status: 'draft', startedAt: 0 };
}
export function normalizeGroupIdentity({ representative, studentId, groupName, memberEntries, memberStudentIds }, config = {}) {
  const id = String(representative || studentId || '').trim();
  const grade = Number(config.grade || 2), classCount = Number(config.classCount || 11);
  const valid = value => /^\d{5}$/.test(value) && Number(value[0]) === grade && Number(value.slice(1, 3)) >= 1 && Number(value.slice(1, 3)) <= classCount && Number(value.slice(3)) >= 1;
  if (!valid(id)) throw new Error('대표 학번 5자리를 확인해 주세요.');
  const name = String(groupName || '').normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (!name || name.length > 30) throw new Error('모둠명은 1~30자로 입력해 주세요.');
  if (/[\u0000-\u001f\u007f]/.test(name)) throw new Error('모둠명에 사용할 수 없는 문자가 있습니다.');
  const members = (memberEntries || memberStudentIds || []).map(value => String(value || '').trim()).filter(Boolean);
  if (members.length < 4 || members.length > 5) throw new Error('대표를 포함한 모둠원 학번 4~5개를 입력해 주세요.');
  if (new Set(members).size !== members.length) throw new Error('모둠원 학번은 중복되지 않게 입력해 주세요.');
  if (!members.every(valid)) throw new Error('모든 모둠원 학번을 5자리로 정확히 입력해 주세요.');
  const cls = Number(id.slice(1, 3));
  if (!members.every(value => Number(value.slice(1, 3)) === cls)) throw new Error('모든 모둠원은 대표와 같은 반이어야 합니다.');
  if (!members.includes(id)) throw new Error('모둠원 목록에 대표 학번도 포함해 주세요.');
  return { studentId: id, cls, groupName: name, groupKey: `${cls}:${name.toLowerCase()}`, memberStudentIds: members.sort() };
}
export function sameGroupRoster(left, right) {
  return Boolean(left && right && left.groupKey === right.groupKey
    && JSON.stringify([...left.memberStudentIds].sort()) === JSON.stringify([...right.memberStudentIds].sort()));
}
export function lesson4Storage(storage) {
  return { getItem: key => storage.getItem(`chaeum:v5:l4:${key}`), setItem: (key, value) => storage.setItem(`chaeum:v5:l4:${key}`, value) };
}
export function groupDraftKey(identity) { return LESSON4_GROUP_PREFIX + encodeURIComponent(identity.groupKey); }
