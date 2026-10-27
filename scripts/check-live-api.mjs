// 조회와 저장 전에 거부되는 잘못된 입력만 사용하며 학생 기록은 만들지 않습니다.
import fs from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const settings = { window: {} };
vm.runInNewContext(await fs.readFile(new URL('../config.js', import.meta.url), 'utf8'), settings, { timeout: 1000 });
const endpoint = settings.window.CLASSROOM_CONFIG?.apiUrl;
assert.match(endpoint || '', /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/);

async function call(action, payload, method = 'GET') {
  const url = new URL(endpoint);
  const options = { method, redirect: 'follow', signal: AbortSignal.timeout(20000) };
  if (method === 'GET') url.searchParams.set('action', action);
  else {
    options.headers = { 'Content-Type': 'text/plain;charset=utf-8' };
    options.body = JSON.stringify({ ...payload, action });
  }
  const response = await fetch(url, options);
  assert.equal(response.status, 200, `${action}: HTTP ${response.status}`);
  const type = response.headers.get('content-type') || '';
  assert.ok(type.includes('json'), `${action}: JSON 응답이 아닙니다. 배포의 접근 권한을 확인하세요.`);
  return response.json();
}

const ping = await call('ping');
assert.equal(ping.ok, true, 'ping: 서버 오류');
assert.equal(ping.data?.status, 'ok');
assert.ok(['5.0.0', '5.1.0'].includes(ping.data?.version), '확인하지 않은 서버 버전입니다.');
console.log('PASS: 공개 서버 상태 응답');

const config = await call('config');
assert.equal(config.ok, true, 'config: 시트 설정 읽기 실패');
assert.equal(config.data?.grade, 2);
assert.ok(Number.isInteger(config.data?.classCount) && config.data.classCount >= 1 && config.data.classCount <= 99, '반 수는 현재 시트의 유효한 운영 설정을 따릅니다.');
console.log(`INFO: 현재 운영 반 수 ${config.data.classCount}`);
assert.ok(Array.isArray(config.data?.acceptLessons));
assert.ok(config.data.acceptLessons.every(lesson => [2, 4].includes(lesson)));
if (ping.data.version === '5.1.0') {
  assert.ok(config.data.implementedLessons?.includes(4));
  assert.ok([3, 4, 5].includes(config.data.l4Questions));
  assert.equal(config.data.l4AiEnabled, false);
} else console.log('INFO: 최초 서버가 실행 중입니다. 4차시·교사 개방 설정은 서버 새 버전 적용 대기입니다.');
for (const key of ['PASSCODE', 'AI_API_KEY', 'AI_MODEL', 'passcode', 'apiKey']) assert.ok(!(key in config.data));
console.log('PASS: 실제 시트 설정 조회 및 비밀값 비노출');

const shared = await call('public_summary');
const publicKeys = new Set(['count','total','completed','stanceCounts','cardCounts','feedbackCounts','byStance','byReason','byCard','lowReliability','metrics']);
if (config.data.acceptLessons.includes(2)) {
  assert.equal(shared.ok, true, 'public_summary: 집계 조회 실패');
  assert.ok(Number.isInteger(shared.data?.completed));
  assert.ok(Object.keys(shared.data).every(key => publicKeys.has(key)), '공개 집계에 허용하지 않은 필드가 있습니다.');
} else {
  assert.equal(shared.ok, false);
  assert.equal(shared.error?.code, 'LESSON_CLOSED');
}
console.log('PASS: 실제 익명 집계 허용 필드');

const privateQuery = await call('l2_summary');
assert.equal(privateQuery.ok, false);
assert.equal(privateQuery.error?.code, 'UNAUTHORIZED', '교사 암호 설정 또는 접근 거부를 확인하세요.');
console.log('PASS: 암호 없는 교사 조회 거부');

const invalid = await call('submit', { lesson: 2, kind: 'l2_session', studentId: '00000' }, 'POST');
assert.equal(invalid.ok, false);
assert.equal(invalid.error?.code, config.data.acceptLessons.includes(2) ? 'INVALID_STUDENT_ID' : 'LESSON_CLOSED');
console.log('PASS: 실제 POST 수신 및 잘못된 학번 거부(저장 없음)');
console.log('실제 저장·교사 암호 로그인·브라우저 CORS·학교 기기 동작은 별도 확인이 필요합니다.');
