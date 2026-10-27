import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const walk=async dir=>(await Promise.all((await fs.readdir(dir,{withFileTypes:true})).map(async e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]))).flat();
const files=await walk(path.join(root,'src'));
for(const filename of files.filter(f=>f.endsWith('.js'))){
  const result=spawnSync(process.execPath,['--check',filename],{encoding:'utf8'});
  if(result.status!==0)throw new Error(result.stderr);
  const code=await fs.readFile(filename,'utf8');
  for(const m of code.matchAll(/(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"](\.[^'"]+)['"]/g)){
    await fs.access(path.resolve(path.dirname(filename),m[1]));
  }
  if(/(?:AIza[0-9A-Za-z_-]{30,}|sk-ant-[0-9A-Za-z_-]{15,}|ghp_[0-9A-Za-z]{20,})/.test(code))throw new Error('공개 코드에서 비밀 키 형태를 발견했습니다.');
}
const js=await Promise.all(files.filter(f=>f.endsWith('.js')).map(f=>fs.readFile(f)));
const size=gzipSync(Buffer.concat(js)).length;
if(size>200*1024)throw new Error('첫 화면 JS gzip 총량이 200KB를 넘었습니다: '+size);
const html=await fs.readFile(path.join(root,'index.html'),'utf8');
if(!/charset\s*=\s*["']?utf-8/i.test(html)||!/name=["']viewport["']/i.test(html))throw new Error('UTF-8 또는 모바일 viewport 선언이 없습니다.');
console.log('모듈 문법·상대 import·공개 키 형태·문서 기본값 확인, JS gzip 합계 '+size+' bytes');
