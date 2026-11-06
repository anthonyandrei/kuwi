import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
const root=resolve('dist');
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.png':'image/png','.webmanifest':'application/manifest+json','.css':'text/css'};
http.createServer(async(req,res)=>{
 const path=resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
 if(path!==root&&!path.startsWith(root+'/')) {res.writeHead(403).end();return;}
 try {const file=path===root?resolve(root,'index.html'):path;const bytes=await readFile(file);res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream','Cache-Control':'no-cache'}).end(bytes);}
 catch {res.writeHead(404).end('Not found');}
}).listen(4183,'127.0.0.1');
