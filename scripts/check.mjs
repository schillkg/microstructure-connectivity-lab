import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { checkViewerAssets } from './check-viewer-assets.mjs';
import { checkSliceAssets } from './check-slice-assets.mjs';
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
  for(const m of text.matchAll(/(?:href|src|data-source|data-centroids|data-atlas|data-slices-source)="([^"]+)"/g)){
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
errors.push(...checkSliceAssets('dist/assets'));
let pathwayCount=0;
try{
  const requireClassification=(condition,message)=>{if(!condition)throw new Error(message);};
  const classification=JSON.parse(fs.readFileSync('content/pathway-groups.json','utf8'));
  const explorer=fs.readFileSync('dist/tractography/index.html','utf8');
  const embedded=[...explorer.matchAll(/<script\b(?=[^>]*\bid="pathway-group-data")(?=[^>]*\btype="application\/json")[^>]*>([\s\S]*?)<\/script>/g)];
  requireClassification(embedded.length===1,'explorer must contain exactly one pathway classification');
  requireClassification(isDeepStrictEqual(JSON.parse(embedded[0][1]),classification),'embedded pathway classification differs from content source');
  requireClassification(classification.schemaVersion===1&&Array.isArray(classification.groups),'unsupported pathway classification schema');
  const basicSystems=['Association','Projection','Commissural'];
  const groupIds=classification.groups.map(g=>g.id),tables=classification.groups.filter(g=>g.table!==undefined).map(g=>g.table);
  requireClassification(groupIds.every(id=>typeof id==='string'&&/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id))&&new Set(groupIds).size===groupIds.length,'invalid or duplicate pathway system IDs');
  requireClassification(tables.length===4&&new Set(tables).size===4&&tables.every(n=>Number.isInteger(n)&&n>=1&&n<=4),'paper systems must cover tables 1–4 exactly once');
  requireClassification(classification.groups.every(g=>typeof g.name==='string'&&g.name.trim()&&typeof g.displayName==='string'&&g.displayName.trim()),'pathway systems need full and concise display names');
  const atlas=JSON.parse(fs.readFileSync('dist/assets/pathway-atlas.json','utf8'));
  const glass=JSON.parse(fs.readFileSync('dist/assets/glass-viewer.json','utf8'));
  const brainstem=atlas.bundles.filter(b=>b.generator==='BrainstemSeg');
  const sourceNames=brainstem.map(b=>b.sourceName),mapping=classification.mappings?.BrainstemSeg;
  requireClassification(mapping&&typeof mapping==='object'&&!Array.isArray(mapping),'missing BrainstemSeg system mapping');
  requireClassification(sourceNames.every(n=>typeof n==='string'&&n)&&new Set(sourceNames).size===sourceNames.length,'duplicate or invalid BrainstemSeg source names');
  requireClassification(isDeepStrictEqual(Object.keys(mapping).sort(),[...sourceNames].sort()),'BrainstemSeg mapping must cover every current source name exactly once, without obsolete keys');
  requireClassification(Object.values(mapping).every(id=>groupIds.includes(id)),'BrainstemSeg mapping refers to an undefined paper system');
  requireClassification(groupIds.includes('tang')&&classification.groups.find(g=>g.id==='tang').section==='brainstem','Tang needs its own visible brainstem group');
  requireClassification(Object.entries(mapping).every(([name,id])=>name.includes('_Tang')?(id==='tang'):(id!=='tang')),'Tang variants must appear only in the Tang group');
  const inventory=[...glass.bundles.flatMap(b=>b.parts?.length?b.parts:[b]),...atlas.bundles];
  requireClassification(new Set(inventory.map(b=>b.id)).size===inventory.length,'original and optional pathway IDs must be globally unique');
  const reachableSystems=new Set([...basicSystems,...groupIds]);
  const tractsegPeduncles=new Set(['ICP_left','ICP_right','MCP','SCP_left','SCP_right']);
  for(const bundle of inventory){
    // These five TractSeg peduncles join the paper's cerebellar system. Other
    // unclassified pathways must fail, rather than silently inheriting that group.
    const system=classification.mappings?.[bundle.generator]?.[bundle.sourceName]||
      (bundle.generator==='TractSeg'&&bundle.group==='Brainstem'&&tractsegPeduncles.has(bundle.sourceName)?'cerebellar-peduncular':bundle.group);
    requireClassification(reachableSystems.has(system),`${bundle.id}: pathway has no reachable system`);
  }
  pathwayCount=inventory.length;
}catch(error){errors.push(`Pathway classification: ${error.message}`);}
if(fs.readFileSync('dist/publications/index.html','utf8').includes('Selected work led by Kurt Schilling'))errors.push('Removed publication note has returned');
for(const route of ['index.html','tractography/index.html']){
  const page=fs.readFileSync('dist/'+route,'utf8');
  if(page.includes('10,000 streamlines')||page.includes('A different view.'))errors.push(`${route}: removed display text returned`);
}
for(const file of files)if(fs.statSync(file).size>25*1024*1024)errors.push(`${file}: unexpectedly large website asset (>25 MiB)`);
if(errors.length){console.error(errors.join('\n'));process.exit(1);}
console.log(`Verified ${html.length} HTML pages, all local links/assets, and asset sizes. ${info.papers} publication records; ${pathwayCount} reachable pathways; base ${info.base||'/'}.`);
