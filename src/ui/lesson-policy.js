export function normalizeLessonConfig(data = {}) {
  const array = value => Array.isArray(value) ? value.map(Number) : String(value ?? '').split(',').map(Number);
  const implementedLessons = Array.isArray(data.implementedLessons) ? array(data.implementedLessons).filter(value => [2, 4].includes(value)) : [2];
  return { grade: Number(data.grade) || 2, classCount: Number(data.classCount) || 11,
    groupMax: Number(data.groupMax) || 8, acceptLessons: array(data.acceptLessons ?? '2').filter(value => [2, 4].includes(value)),
    implementedLessons, l2Questions: Number(data.l2Questions) === 2 ? 2 : 3,
    l4Questions: [3, 4, 5].includes(Number(data.l4Questions)) ? Number(data.l4Questions) : 4,
    l4ScriptVersion: data.l4ScriptVersion === '1.1.0' ? '1.1.0' : '1.0.0',
    aiEnabled: Boolean(data.aiEnabled), l4AiEnabled: false, publicSharing: data.publicSharing !== false,
    appVersion: String(data.appVersion || data.version || '5.0.0') };
}
export function lessonAccess(config, lesson, resolved = true) {
  if (!resolved) return { allowed: false, reason: 'loading', label: '개방 상태 확인 중' };
  if (Number(lesson) === 4 && !config.implementedLessons?.includes(4)) return { allowed: false, reason: 'preparing', label: '준비 중' };
  if (!config.acceptLessons?.map(Number).includes(Number(lesson))) return { allowed: false, reason: 'closed', label: '닫힘' };
  return { allowed: true, reason: 'open', label: '열림' };
}
