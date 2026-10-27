import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HEADERS, COMMON_HEADERS } from './service.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFile(path.join(root, file), 'utf8');
const content = JSON.parse(await read('data/content.json'));
const lesson4Content = JSON.parse(await read('data/lesson4.json'));
const namespace = {
  '../src/core/engine.js': 'ClassroomCore',
  './engine.js': 'ClassroomCore',
  '../src/core/lesson4.js': 'ClassroomLesson4',
  '../src/core/lesson4-content.js': '{LESSON4_CONTENT:ClassroomLesson4Content,default:ClassroomLesson4Content}',
  './lesson4-content.js': '{LESSON4_CONTENT:ClassroomLesson4Content,default:ClassroomLesson4Content}',
};
function compileModule(source, name) {
  const names = [...source.matchAll(/^export (?:async )?(?:function|class|const|let)\s+(\w+)/gm)].map(x => x[1]);
  let code = source.replace(/^import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"];\s*/gm, (_, imported, from) => {
    const target = namespace[from];
    if (!target) throw new Error(`GAS 번들에 정의되지 않은 import: ${from}`);
    const trimmed = imported.trim();
    if (trimmed.startsWith('{')) {
      const keys = trimmed.replace(/\bas\b/g, ':');
      return `const ${keys} = ${target};\n`;
    }
    if (/^[A-Za-z_$][\w$]*$/.test(trimmed)) return `const ${trimmed} = ${target}.default;\n`;
    throw new Error(`지원하지 않는 import 형태: ${trimmed}`);
  }).replace(/^export default[^\n]*\n?/gm, '').replace(/^export /gm, '');
  return `var ${name} = (function(){\n${code}\nreturn {${names.join(',')}};\n})();\n`;
}
const compiled = '// 자동 생성: node backend/sync.mjs. 직접 수정하지 마세요.\n'
  + compileModule(await read('src/core/engine.js'), 'ClassroomCore')
  + `var ClassroomContent = ${JSON.stringify(content)};\n`
  + `var ClassroomLesson4Content = ${JSON.stringify(lesson4Content)};\n`
  + compileModule(await read('src/core/lesson4.js'), 'ClassroomLesson4')
  + compileModule(await read('backend/service.js'), 'ClassroomService')
  + await read('backend/Native.gs');
const schema = JSON.stringify({ common: COMMON_HEADERS, tabs: HEADERS,
  config: { grade: 2, classCount: 11, groupMax: 8, acceptLessons: '2', l2Questions: 3, l4Questions: 4, publicSharing: 'true', recordingFallbackUrl: '' } }, null, 2) + '\n';
const dest = path.join(root, 'backend/ServerBundle.gs');
if (process.argv.includes('--check')) {
  const actual = await fs.readFile(dest, 'utf8').catch(() => '');
  const actualSchema = await read('backend/schema.json').catch(() => '');
  if (actual !== compiled || actualSchema !== schema) {
    console.error('ServerBundle.gs/schema.json이 원본 엔진·서비스·콘텐츠와 다릅니다. node backend/sync.mjs로 갱신하세요.'); process.exitCode = 1;
  } else console.log('GAS 번들과 Node/browser 2·4차시 엔진·콘텐츠 일치');
} else {
  await fs.writeFile(dest, compiled); await fs.writeFile(path.join(root, 'backend/schema.json'), schema);
  console.log('backend/ServerBundle.gs·schema.json 생성');
}
