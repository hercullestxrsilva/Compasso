import { readdir,readFile,writeFile } from 'node:fs/promises';
import { join,relative } from 'node:path';
import { createHash } from 'node:crypto';
const root=join(process.cwd(),'dist');
async function walk(dir){const entries=await readdir(dir,{withFileTypes:true});return(await Promise.all(entries.map(e=>e.isDirectory()?walk(join(dir,e.name)):[join(dir,e.name)]))).flat();}
const files=(await walk(root)).filter(f=>!f.endsWith('sw.js'));const paths=files.map(f=>'/'+relative(root,f).replaceAll('\\','/'));
const version=createHash('sha256').update((await Promise.all(files.map(f=>readFile(f)))).map(b=>b.toString('base64')).join('')).digest('hex').slice(0,12);
await writeFile(join(root,'sw.js'),`const CACHE='compasso-${version}';const ASSETS=${JSON.stringify(paths)};
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('compasso-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{const url=new URL(e.request.url);if(e.request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/'))return;
if(e.request.mode==='navigate'){e.respondWith(fetch(e.request).catch(()=>caches.match('/index.html')));return;}
e.respondWith(caches.match(e.request).then(cached=>cached||fetch(e.request)));});
`);
console.log('Offline shell generated:',paths.length,'files, version',version);
