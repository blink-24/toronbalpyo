import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.join(root,'dist');
// Only these public application files may enter the Pages artifact.
const singles=['index.html','styles.css','config.js'];
await fs.mkdir(out,{recursive:true});
for(const name of await fs.readdir(out))await fs.rm(path.join(out,name),{recursive:true,force:true});
for(const name of singles)await fs.copyFile(path.join(root,name),path.join(out,name));
async function copyJsTree(src,dst){
  await fs.mkdir(dst,{recursive:true});
  for(const ent of await fs.readdir(src,{withFileTypes:true})){
    if(ent.isSymbolicLink())throw new Error('배포 파일에는 심볼릭 링크를 허용하지 않습니다.');
    const a=path.join(src,ent.name),b=path.join(dst,ent.name);
    if(ent.isDirectory())await copyJsTree(a,b);
    else if(/\.(js|svg|png|webp|woff2?)$/.test(ent.name))await fs.copyFile(a,b);
    else throw new Error('허용되지 않은 공개 파일: '+a);
  }
}
await copyJsTree(path.join(root,'src'),path.join(out,'src'));
try{await copyJsTree(path.join(root,'assets'),path.join(out,'assets'));}catch(e){if(e.code!=='ENOENT')throw e;}
await fs.writeFile(path.join(out,'.nojekyll'),'');
console.log('정적 배포 파일 준비: dist/ (서버·문서·테스트·원본 수업 파일 제외)');
