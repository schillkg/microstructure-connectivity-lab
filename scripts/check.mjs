import fs from 'node:fs';
import path from 'node:path';
import { checkViewerAssets } from './check-viewer-assets.mjs';
const info=JSON.parse(fs.readFileSync('dist/build-info.json','utf8'));
const errors=[];
const decode=s=>s.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>');
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(f=>f.isDirectory()?walk(path.join(dir,f.name)):[path.join(dir,f.name)]);}
const files=walk('dist');
const html=files.filter(p=>p.endsWith('.html'));
for(const file of html){
  const text=fs.readFileSync(file,'utf8');
  if(!text.includes('<h1'))errors.push(`${file}: missing heading`);
  if(!text.includes('<title>'))errors.push(`${file}: missing title`);
  if(/(?:\/Users\/|\/private\/tmp\/|\/nfs\d*\/|\/home\/|\/valiant\d*\/|localSourceFile)/.test(text))errors.push(`${file}: private provenance leaked`);
  for(const m of text.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)){
    try{JSON.parse(m[1]);}catch{errors.push(`${file}: invalid structured metadata`);}
  }
  for(const m of text.matchAll(/(?:href|src|data-source|data-centroids|data-atlas)="([^"]+)"/g)){
    const ref=decode(m[1]);
    if(/^(?:https?:|mailto:|tel:|data:|#)/.test(ref))continue;
    const pathname=decodeURIComponent(ref.split(/[?#]/)[0]);
    if(info.base&&!pathname.startsWith(info.base+'/')){errors.push(`${file}: unprefixed ${ref}`);continue;}
    const local=pathname.slice(info.base.length);
    let dest=path.join('dist',local);
    if(fs.existsSync(dest)&&fs.statSync(dest).isDirectory())dest=path.join(dest,'index.html');
    if(!fs.existsSync(dest)){errors.push(`${file}: missing ${ref}`);continue;}
    const fragment=ref.split('#')[1];
    if(fragment&&dest.endsWith('.html')&&!fs.readFileSync(dest,'utf8').includes(`id="${fragment}"`))errors.push(`${file}: missing fragment ${ref}`);
  }
}
const publications=JSON.parse(fs.readFileSync('dist/publications.json','utf8'));
if(publications.length!==info.papers)errors.push('Publication export count does not match generated pages');
if(new Set(publications.map(p=>p.doi.toLowerCase())).size!==publications.length)errors.push('Duplicate DOIs');
for(const p of publications){
  const page=fs.readFileSync(`dist/publications/${p.slug}/index.html`,'utf8');
  if((page.match(/name="citation_author"/g)||[]).length!==p.authorList.length)errors.push(`${p.slug}: incomplete author metadata`);
  for(const name of ['index.md','citation.bib'])if(!fs.existsSync(`dist/publications/${p.slug}/${name}`))errors.push(`${p.slug}: missing ${name}`);
  if(p.type==='Preprint'&&!page.includes('not completed peer review'))errors.push(`${p.slug}: missing preprint status`);
  if(p.localSourceFile)errors.push(`${p.slug}: local path in metadata export`);
}
errors.push(...checkViewerAssets('dist/assets'));
if(fs.readFileSync('dist/publications/index.html','utf8').includes('Selected work led by Kurt Schilling'))errors.push('Removed publication note has returned');
for(const route of ['index.html','tractography/index.html']){
  const page=fs.readFileSync('dist/'+route,'utf8');
  if(page.includes('10,000 streamlines')||page.includes('A different view.'))errors.push(`${route}: removed display text returned`);
}
for(const file of files)if(fs.statSync(file).size>25*1024*1024)errors.push(`${file}: unexpectedly large website asset (>25 MiB)`);
if(errors.length){console.error(errors.join('\n'));process.exit(1);}
console.log(`Verified ${html.length} HTML pages, all local links/assets, and asset sizes. ${info.papers} publication records; base ${info.base||'/'}.`);
