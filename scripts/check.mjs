import fs from 'node:fs';
import path from 'node:path';
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
  if(/(?:\/Users\/|\/private\/tmp\/|localSourceFile)/.test(text))errors.push(`${file}: private provenance leaked`);
  for(const m of text.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)){
    try{JSON.parse(m[1]);}catch{errors.push(`${file}: invalid structured metadata`);}
  }
  for(const m of text.matchAll(/(?:href|src|data-source|data-centroids)="([^"]+)"/g)){
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
const viewer=JSON.parse(fs.readFileSync('dist/assets/tract-viewer.json','utf8'));
if(viewer.subject||viewer.normalization)errors.push('Viewer contains unnecessary subject provenance');
for(const bundle of viewer.bundles)if(bundle.sourceFiles||bundle.lines.some(l=>l.source||l.sourceIndex!==undefined))errors.push('Viewer contains source file provenance');
const glass=JSON.parse(fs.readFileSync('dist/assets/glass-viewer.json','utf8'));
if(!glass.allStreamlines||!glass.allOriginalVertices||glass.streamlineCount!==10000||glass.pointCount!==341877)errors.push('Glass viewer must preserve all 10,000 streamlines and 341,877 original points');
const binary=name=>{
  if(path.basename(name)!==name)throw new Error('Viewer asset must use a local filename');
  return fs.readFileSync(path.join('dist/assets',name));
};
const positions=binary(glass.tracts.positions), offsets=binary(glass.tracts.offsets);
if(positions.length!==glass.pointCount*12)errors.push('Streamline position buffer size does not match metadata');
if(offsets.length!==glass.bundles.reduce((n,b)=>n+b.offsetCount,0)*4)errors.push('Streamline offset buffer size does not match metadata');
if(glass.bundles.reduce((n,b)=>n+b.streamlineCount,0)!==glass.streamlineCount)errors.push('Bundle counts do not match total streamline count');
for(const b of glass.bundles){
  const first=b.offsetOffset*4,last=(b.offsetOffset+b.offsetCount-1)*4;
  if(b.offsetCount!==b.streamlineCount+1||offsets.readUInt32LE(first)!==b.pointOffset||offsets.readUInt32LE(last)!==b.pointOffset+b.pointCount)errors.push(`${b.id}: invalid streamline boundaries`);
  for(let i=first+4;i<=last;i+=4)if(offsets.readUInt32LE(i)-offsets.readUInt32LE(i-4)<2)errors.push(`${b.id}: streamline has fewer than two points`);
}
for(const [name,count] of [[glass.tracts.positions,glass.pointCount],[glass.brain.positions,glass.brain.vertexCount],[glass.brain.normals,glass.brain.vertexCount]]){
  const buffer=binary(name);
  if(buffer.length!==count*12)errors.push(`${name}: invalid geometry size`);
  for(let i=0;i<buffer.length;i+=4)if(!Number.isFinite(buffer.readFloatLE(i))){errors.push(`${name}: non-finite geometry`);break;}
}
const indices=binary(glass.brain.indices);
if(indices.length!==glass.brain.triangleCount*6)errors.push('Brain surface triangle count mismatch');
for(let i=0;i<indices.length;i+=2)if(indices.readUInt16LE(i)>=glass.brain.vertexCount){errors.push('Brain surface index out of range');break;}
if(fs.readFileSync('dist/publications/index.html','utf8').includes('Selected work led by Kurt Schilling'))errors.push('Removed publication note has returned');
const centroids=JSON.parse(fs.readFileSync('dist/assets/tract-centroids.json','utf8'));
if(centroids.bundles.length!==5)errors.push('Expected one centroid for each of the five native reconstructions');
for(const b of centroids.bundles){
  if(!['af','cst','cc'].includes(b.group)||b.points.length<2||b.points.some(p=>p.length!==3||p.some(v=>!Number.isFinite(v)||Math.abs(v)>1.1)))errors.push(`${b.id}: invalid centroid geometry`);
}
for(const route of ['index.html','tractography/index.html']){
  const page=fs.readFileSync('dist/'+route,'utf8');
  if(page.includes('10,000 streamlines')||page.includes('A different view.'))errors.push(`${route}: removed display text returned`);
}
for(const file of files)if(fs.statSync(file).size>25*1024*1024)errors.push(`${file}: unexpectedly large website asset (>25 MiB)`);
if(errors.length){console.error(errors.join('\n'));process.exit(1);}
console.log(`Verified ${html.length} HTML pages, all local links/assets, and asset sizes. ${info.papers} publication records; base ${info.base||'/'}.`);
