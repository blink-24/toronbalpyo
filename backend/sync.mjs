import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HEADERS, COMMON_HEADERS } from './service.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const engine = await fs.readFile(path.join(root, 'src/core/engine.js'), 'utf8');
const service = await fs.readFile(path.join(root, 'backend/service.js'), 'utf8');
const content = JSON.parse(await fs.readFile(path.join(root, 'data/content.json'), 'utf8'));
const native = await fs.readFile(path.join(root, 'backend/Native.gs'), 'utf8');
const names = [...engine.matchAll(/^export (?:function|class)\s+(\w+)/gm)].map(x => x[1]);
const imports = service.match(/^import \{([\s\S]*?)\} from '\.\.\/src\/core\/engine\.js';/)[1].replace(/\s+/g, ' ');
const compiled = '// 자동 생성: node backend/sync.mjs. 직접 수정하지 마세요.\n'
  + `var ClassroomCore = (function(){\n${engine.replace(/^export /gm, '')}\nreturn {${names.join(',')}};\n})();\n`
  + `var ClassroomContent = ${JSON.stringify(content)};\n`
  + `var ClassroomService = (function(){\nconst {${imports}} = ClassroomCore;\n${service.replace(/^import \{[\s\S]*?\} from '\.\.\/src\/core\/engine\.js';\s*/, '').replace(/^export /gm, '')}\nreturn {createService, HEADERS};\n})();\n`
  + native;
const dest = path.join(root, 'backend/ServerBundle.gs');
const schema = JSON.stringify({ common: COMMON_HEADERS, tabs: HEADERS, config: { grade: 2, classCount: 11, groupMax: 8, acceptLessons: '2', l2Questions: 3, l4Questions: 4, publicSharing: 'true', recordingFallbackUrl: '' } }, null, 2) + '\n';
if (process.argv.includes('--check')) {
  const actual = await fs.readFile(dest, 'utf8').catch(() => '');
  const actualSchema = await fs.readFile(path.join(root, 'backend/schema.json'), 'utf8').catch(() => '');
  if (actual !== compiled || actualSchema !== schema) { console.error('ServerBundle.gs/schema.json이 원본 엔진·서비스·콘텐츠와 다릅니다. node backend/sync.mjs로 갱신하세요.'); process.exitCode = 1; }
  else console.log('GAS 번들과 Node/browser 엔진·콘텐츠 일치');
} else { await fs.writeFile(dest, compiled); await fs.writeFile(path.join(root, 'backend/schema.json'), schema); console.log('backend/ServerBundle.gs·schema.json 생성'); }
