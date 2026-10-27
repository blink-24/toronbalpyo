// CI 전용: 실제 서비스 모듈을 메모리 저장소로 실행. Google/실학생 기록 없음.
import http from 'node:http';
import { createHash } from 'node:crypto';
import { createService, HEADERS } from '../backend/service.js';
import content from '../src/core/content.js';
import lesson4Content from '../src/core/lesson4-content.js';

const db = Object.fromEntries(Object.keys(HEADERS).map(name => [name, []]));
db.config.push(...Object.entries({ grade: '2', classCount: '13', groupMax: '8', acceptLessons: '2', l2Questions: '3', l4Questions: '4', publicSharing: 'true' }).map(([key, value]) => ({ key, value })));
const props = new Map([['PASSCODE', 'fixture-teacher-only'], ['AI_PROVIDER', 'none']]);
let held = false;
const store = {
  read: name => db[name],
  append: (name, value) => { if (!held) throw Error('write without lock'); db[name].push(structuredClone(value)); },
  writeConfig: (key, value) => {
    if (!held) throw Error('config write without lock');
    const row = db.config.find(item => item.key === key); if (row) row.value = value; else db.config.push({ key, value });
  },
  withLock: fn => { if (held) throw Error('nested lock'); held = true; try { return fn(); } finally { held = false; } }
};
const service = createService({ content, lesson4Content, store,
  properties: { get: key => props.get(key), set: (key, value) => props.set(key, value) },
  hash: text => createHash('sha256').update(text).digest('hex'),
  providerCall: () => { throw Error('fixture must never call AI'); }
});
http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1:4180');
  response.setHeader('Content-Type', 'application/json');
  response.setHeader('Access-Control-Allow-Origin', '*');
  if (url.pathname === '/qa/state') return response.end(JSON.stringify(db));
  if (url.pathname !== '/exec') { response.statusCode = 404; return response.end('{}'); }
  try {
    let body = ''; for await (const chunk of request) body += chunk;
    const input = request.method === 'GET' ? Object.fromEntries(url.searchParams) : JSON.parse(body || '{}');
    response.end(JSON.stringify(service.respond(request.method, input)));
  } catch (error) { response.statusCode = 500; response.end(JSON.stringify({ fixtureError: error.message })); }
}).listen(4180, '127.0.0.1', () => console.log('Synthetic-only service fixture: http://127.0.0.1:4180'));
