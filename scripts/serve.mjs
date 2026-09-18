import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
execFileSync(process.execPath,['scripts/build.mjs'],{stdio:'inherit'});
const root = path.resolve('dist');
const port = Number(process.env.PORT || 4321);
const base = (process.env.BASE_PATH || '').replace(/\/$/, '');
const types = {'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.pdf':'application/pdf','.xml':'application/xml','.txt':'text/plain; charset=utf-8','.md':'text/plain; charset=utf-8','.bib':'text/plain; charset=utf-8'};
http.createServer((req,res)=>{
  try {
    const requested=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(base && requested!==base && !requested.startsWith(base+'/')){res.writeHead(404).end('Not found');return;}
    let dest=path.resolve(root,'.'+requested.slice(base.length));
    if(dest!==root&&!dest.startsWith(root+path.sep)){res.writeHead(403).end();return;}
    if(fs.existsSync(dest)&&fs.statSync(dest).isDirectory())dest=path.join(dest,'index.html');
    if(!fs.existsSync(dest)){res.writeHead(404,{'Content-Type':'text/html'});res.end(fs.readFileSync(path.join(root,'404.html')));return;}
    res.writeHead(200,{'Content-Type':types[path.extname(dest)]||'application/octet-stream','Cache-Control':'no-cache'});
    fs.createReadStream(dest).pipe(res);
  }catch{res.writeHead(400).end('Bad request');}
}).listen(port,'127.0.0.1',()=>console.log(`Local: http://127.0.0.1:${port}${base}/`));
