import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdirSync, createReadStream, createWriteStream, statSync } from 'node:fs';
import { readFile, unlink } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { resolve } from 'node:path';
const dir = resolve(process.env.DATA_DIR || './data');
mkdirSync(dir+'/videos',{recursive:true, mode:0o700});
const db = new DatabaseSync(dir+'/entreno.sqlite');
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, name TEXT NOT NULL,email TEXT UNIQUE NOT NULL, password TEXT,role TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS single_coach ON users(role) WHERE role='coach';
CREATE TABLE IF NOT EXISTS tokens(hash TEXT PRIMARY KEY, user TEXT REFERENCES users(id), kind TEXT, expires INTEGER);
CREATE TABLE IF NOT EXISTS exercises(id TEXT PRIMARY KEY,name TEXT, muscle TEXT, equipment TEXT, instructions TEXT, video TEXT);
CREATE TABLE IF NOT EXISTS weeks(id TEXT PRIMARY KEY, student TEXT REFERENCES users(id), monday TEXT, draft TEXT NOT NULL,published TEXT, UNIQUE(student,monday));
CREATE TABLE IF NOT EXISTS media_tokens(hash TEXT PRIMARY KEY, session TEXT, exercise TEXT, video TEXT, expires INTEGER);
CREATE TABLE IF NOT EXISTS attempts(key TEXT PRIMARY KEY, count INTEGER, expires INTEGER);`);
if(!db.prepare('PRAGMA table_info(exercises)').all().some(c=>c.name==='youtube')){
 db.exec('ALTER TABLE exercises ADD COLUMN youtube TEXT');
}
const one=(s,...a)=>db.prepare(s).get(...a);
const all=(s,...a)=>db.prepare(s).all(...a);
const run=(s,...a)=>db.prepare(s).run(...a);
const token=()=>randomBytes(32).toString('base64url');
const hash=s=>createHash('sha256').update(s).digest('hex');
const derive=promisify(scrypt);
async function password(p,s=token()){return s+':'+(await derive(p,s,64)).toString('hex')}
const clean=(v,n=200)=>String(v??'').trim().slice(0,n);
const email=v=>clean(v,254).toLowerCase();
function fail(status,message){throw Object.assign(new Error(message),{status})}
function requireValue(ok,msg){if(!ok)fail(400,msg)}
function youtubeURL(value){
 const input=clean(value,1000);
 if(!input)return null;
 let clip;
 try{
 const url=new URL(input);
 if(url.protocol!=='https:'||url.username||url.password||url.port)throw Error();
 if(url.hostname==='youtu.be')clip=/^\/([\w-]{11})\/?$/.exec(url.pathname)?.[1];
 else if(['youtube.com','www.youtube.com','m.youtube.com'].includes(url.hostname)){
 clip=url.pathname==='/watch'?url.searchParams.get('v'):/^\/(?:shorts|embed|live)\/([\w-]{11})\/?$/.exec(url.pathname)?.[1];
 }
 }catch{}
 requireValue(/^[\w-]{11}$/.test(clip||''),'Pegá un enlace válido a un video de YouTube.');
 return 'https://www.youtube.com/watch?v='+clip;
}
const goodPassword=p=>typeof p==='string'&&p.length>=12&&p.length<=128;
function issue(user,kind,ttl){const key=token();run('DELETE FROM tokens WHERE expires<=?',Date.now());run('INSERT INTO tokens VALUES(?,?,?,?)',hash(key),user,kind,Date.now()+ttl);return key}
const hour=3600000;
const base=new URL(process.env.APP_URL||'http://localhost:3000');
const cookie=(key,age)=>'session='+key+'; HttpOnly; SameSite=Strict; Path=/; Max-Age='+age+(base.protocol==='https:'?'; Secure':'');
if(process.argv.includes('--coach')){
 const address=email(process.env.COACH_EMAIL), secret=process.env.COACH_PASSWORD;
 requireValue(address.includes('@')&&goodPassword(secret),'Configurá COACH_EMAIL y COACH_PASSWORD (12 caracteres como mínimo).');
 const existing=one("SELECT id FROM users WHERE role='coach'");
 const encoded=await password(secret);
 if(existing){run('UPDATE users SET email=?,password=? WHERE id=?',address,encoded,existing.id);run('DELETE FROM tokens WHERE user=?',existing.id)}
 else run('INSERT INTO users VALUES(?,?,?,?,?)',token(),clean(process.env.COACH_NAME)||'Entrenador',address,encoded,'coach');
 console.log('Cuenta de entrenador configurada.');
 process.exit(0);
}
// Bootstrap a new installation without replacing an existing coach or password.
if(process.env.COACH_PASSWORD&&!one("SELECT id FROM users WHERE role='coach'")){
 const address=email(process.env.COACH_EMAIL), secret=process.env.COACH_PASSWORD;
 requireValue(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)&&goodPassword(secret),'Configurá COACH_EMAIL y COACH_PASSWORD (entre 12 y 128 caracteres).');
 const encoded=await password(secret);
 run("INSERT INTO users VALUES(?,?,?,?,?) ON CONFLICT(role) WHERE role='coach' DO NOTHING",
 token(),clean(process.env.COACH_NAME)||'Entrenador',address,encoded,'coach');
 console.log('Cuenta inicial de entrenador creada.');
}
const dummy=await password(token());
const datePattern=/^\d{4}-\d{2}-\d{2}$/;
function monday(s){
 const d=new Date(s+'T12:00:00Z');
 requireValue(datePattern.test(s)&&Number.isFinite(+d)&&d.toISOString().slice(0,10)===s&&d.getUTCDay()===1,'Elegí un lunes válido.');
 return s;
}
function schedule(days){
 requireValue(Array.isArray(days)&&days.length<=7,'Revisá los días de la semana.');
 const indexes=new Set();
 return days.map(d=>{
 const index=d.index;
 requireValue(Number.isInteger(index)&&index>=0&&index<7&&!indexes.has(index),'Elegí un día distinto para cada sesión.');
 indexes.add(index);
 requireValue(Array.isArray(d.items)&&d.items.length<=60,'Revisá los ejercicios de la sesión.');
 return {index,name:clean(d.name)||'Entrenamiento',items:d.items.map(e=>{
 requireValue(one('SELECT id FROM exercises WHERE id=?',clean(e.exercise)),'El ejercicio ya no está disponible.');
 const kind=e.kind==='seconds'?'seconds':'reps';
 const load=['kg','body','none'].includes(e.load)?e.load:'none';
 const weight=clean(e.weight,20).replace(',','.');
 requireValue(load!=='kg'||(/^\d+(\.\d+)?$/.test(weight)&&+weight<=99999),'Ingresá una carga válida en kg.');
 for(const [value,min,max] of [[e.sets,1,100],[e.amount,1,86400],[e.rest,0,86400]])
 requireValue(Number.isInteger(+value)&&String(value).trim()!==''&&+value>=min&&+value<=max,'Revisá las series, repeticiones, duración y descanso.');
 return {exercise:e.exercise,sets:+e.sets,kind,amount:+e.amount,load,weight:load==='kg'?+weight:null,rest:+e.rest,note:clean(e.note,3000)};
 })};
 });
}
function hydrate(raw){
 return JSON.parse(raw).map(d=>({...d,items:d.items.map(e=>{
 const x=one('SELECT * FROM exercises WHERE id=?',e.exercise);
 return {...e,name:x.name,instructions:x.instructions,video:!!x.video,youtube:x.youtube};
 })}));
}
function mayPlay(user,id){
 return user.role==='coach'||!!one(`SELECT 1 FROM weeks w, json_each(w.published) d, json_each(d.value,'$.items') e
 WHERE w.student=? AND json_extract(e.value,'$.exercise')=? LIMIT 1`,user.id,id);
}
async function body(req){
 let data='';
 for await(const c of req){data+=c;if(data.length>500000)fail(413,'La solicitud es demasiado grande.')}
 try{return JSON.parse(data)}catch{fail(400,'Revisá los datos ingresados.')}
}
function limit(key,max){
 run('DELETE FROM attempts WHERE expires<=?',Date.now());
 run('INSERT INTO attempts VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1',key,Date.now()+15*60000);
 if(one('SELECT count FROM attempts WHERE key=?',key).count>max)fail(429,'Esperá unos minutos antes de reintentar.');
}
async function api(req,res,url){
 const path=url.pathname, method=req.method;
 const session=req.headers.cookie?.match(/(?:^|; )session=([\w-]+)/)?.[1];
 const sessionHash=session?hash(session):'';
 const user=one(`SELECT u.id,u.name,u.email,u.role FROM users u JOIN tokens t ON t.user=u.id
 WHERE t.hash=? AND t.kind='session' AND t.expires>?`,sessionHash,Date.now());
 if(!['GET','HEAD'].includes(method)&&req.headers.origin!==base.origin)fail(403,'Origen de la solicitud inválido.');
 if(path==='/api/me'&&method==='GET')return {user:user||null};
 if(path==='/api/login'&&method==='POST'){
 const b=await body(req), address=email(b.email);
 limit('login:'+req.socket.remoteAddress+':'+address,12);
 const u=one('SELECT * FROM users WHERE email=?',address);
 const expected=u?.password||dummy;
 const candidate=await password(typeof b.password==='string'?b.password.slice(0,128):'',expected.split(':')[0]);
 if(!timingSafeEqual(Buffer.from(candidate),Buffer.from(expected))||!u?.password||!goodPassword(b.password))fail(401,'Revisá el correo y la contraseña.');
 run('DELETE FROM attempts WHERE key=?','login:'+req.socket.remoteAddress+':'+address);
 res.setHeader('Set-Cookie',cookie(issue(u.id,'session',7*24*hour),604800));return {};
 }
 if(path==='/api/recover'&&method==='POST'){
 const b=await body(req);
 limit('recover:'+req.socket.remoteAddress,12);
 const u=one('SELECT * FROM users WHERE email=? AND password IS NOT NULL',email(b.email));
 if(u&&process.env.RESET_WEBHOOK){
 const key=issue(u.id,'reset',hour);
 try{
 const response=await fetch(process.env.RESET_WEBHOOK,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+(process.env.RESET_WEBHOOK_TOKEN||'')},body:JSON.stringify({email:u.email,link:new URL('/?restablecer='+key,base).href}),signal:AbortSignal.timeout(8000)});
 if(!response.ok)throw Error('Delivery failed');
 }catch{run('DELETE FROM tokens WHERE hash=?',hash(key));console.error('Falló el envío para restablecer contraseña.')}
 }
 return {configured:!!process.env.RESET_WEBHOOK};
 }
 if(path==='/api/activate'&&method==='POST'){
 const b=await body(req);requireValue(goodPassword(b.password),'Usá entre 12 y 128 caracteres.');
 const h=hash(clean(b.token)),kind=b.reset?'reset':'invite';
 const t=one('SELECT * FROM tokens WHERE hash=? AND kind=? AND expires>?',h,kind,Date.now());
 requireValue(t,'El enlace venció o ya fue usado.');
 const encoded=await password(b.password);
 db.exec('BEGIN IMMEDIATE');
 try{
 requireValue(run('DELETE FROM tokens WHERE hash=? AND expires>?',h,Date.now()).changes,'El enlace venció o ya fue usado.');
 run('UPDATE users SET password=? WHERE id=?',encoded,t.user);
 run('DELETE FROM tokens WHERE user=?',t.user);
 db.exec('COMMIT');
 }catch(err){db.exec('ROLLBACK');throw err}
 return {};
 }
 if(!user)fail(401,'Iniciá sesión para continuar.');
 if(path==='/api/logout'&&method==='POST'){
 run('DELETE FROM tokens WHERE hash=?',sessionHash);res.setHeader('Set-Cookie',cookie('',0));return {};
 }
 if(path==='/api/mine'&&method==='GET'){
 if(user.role!=='student')fail(403,'Esta vista corresponde a un alumno.');
 return all('SELECT id,monday FROM weeks WHERE student=? AND published IS NOT NULL ORDER BY monday DESC',user.id);
 }
 const readWeek=path.match(/^\/api\/weeks\/([\w-]+)$/);
 if(readWeek&&method==='GET'){
 const w=one('SELECT * FROM weeks WHERE id=?',readWeek[1]);
 if(!w||(user.role!=='coach'&&(w.student!==user.id||!w.published)))fail(404,'Semana no disponible.');
 return user.role==='coach'?{...w,draft:JSON.parse(w.draft),published:!!w.published}:{id:w.id,monday:w.monday,days:hydrate(w.published)};
 }
 const media=path.match(/^\/api\/media\/([\w-]+)$/);
 if(media&&method==='GET'){
 const x=one('SELECT * FROM exercises WHERE id=?',media[1]);
 if(!x?.video||!mayPlay(user,x.id))fail(404,'Video no disponible.');
 const key=token();
 run('DELETE FROM media_tokens WHERE expires<=?',Date.now());
 run('INSERT INTO media_tokens VALUES(?,?,?,?,?)',hash(key),sessionHash,x.id,x.video,Date.now()+hour);
 return {url:'/api/play/'+key};
 }
 const play=path.match(/^\/api\/play\/([\w-]+)$/);
 if(play&&['GET','HEAD'].includes(method)){
 const t=one('SELECT m.* FROM media_tokens m JOIN exercises e ON m.exercise=e.id AND m.video=e.video WHERE m.hash=? AND m.session=? AND m.expires>?',hash(play[1]),sessionHash,Date.now());
 if(!t||!mayPlay(user,t.exercise))fail(404,'Video no disponible.');
 const file=dir+'/videos/'+t.video, size=statSync(file).size;
 const range=req.headers.range;
 let start=0,end=size-1;
 if(range){
 const match=/^bytes=(\d*)-(\d*)$/.exec(range);
 if(match&&(match[1]||match[2])){
 start=match[1]?Number(match[1]):Math.max(0,size-Number(match[2]));
 end=match[1]&&match[2]?Math.min(end,Number(match[2])):end;
 }
 if(!match||(!match[1]&&!match[2])||start>end){res.writeHead(416,{'Content-Range':'bytes */'+size}).end();return}
 }
 res.writeHead(range?206:200,{'Content-Type':'video/mp4','Accept-Ranges':'bytes','Content-Length':end-start+1,...(range?{'Content-Range':`bytes ${start}-${end}/${size}`}:{})});
 if(method==='HEAD')res.end();else await pipeline(createReadStream(file,{start,end}),res);
 return;
 }
 if(user.role!=='coach')fail(403,'No tenés permiso para hacer esto.');
 if(path==='/api/students'&&method==='GET')return all("SELECT id,name,email,password IS NOT NULL AS active FROM users WHERE role='student' ORDER BY name");
 if(path==='/api/students'&&method==='POST'){
 const b=await body(req),address=email(b.email),name=clean(b.name);
 requireValue(name&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address),'Ingresá un nombre y un correo válido.');
 if(one('SELECT id FROM users WHERE email=?',address))fail(409,'Ese correo ya está registrado.');
 const id=token();run('INSERT INTO users VALUES(?,?,?,NULL,?)',id,name,address,'student');return {id};
 }
 const invite=path.match(/^\/api\/students\/([\w-]+)\/invite$/);
 if(invite&&method==='POST'){
 const u=one("SELECT * FROM users WHERE id=? AND role='student' AND password IS NULL",invite[1]);
 if(!u)fail(404,'No hay una invitación pendiente para esa cuenta.');
 run("DELETE FROM tokens WHERE user=? AND kind='invite'",u.id);
 return {link:new URL('/?invitacion='+issue(u.id,'invite',72*hour),base).href};
 }
 if(path==='/api/exercises'&&method==='GET')return all('SELECT id,name,muscle,equipment,instructions,video IS NOT NULL AS video,youtube FROM exercises ORDER BY name');
 if(path==='/api/exercises'&&method==='POST'){
 const b=await body(req),name=clean(b.name);
 requireValue(name,'Ingresá el nombre del ejercicio.');
 const fields=[name,clean(b.muscle),clean(b.equipment),clean(b.instructions,4000),youtubeURL(b.youtube)];
 if(b.id){if(!run('UPDATE exercises SET name=?,muscle=?,equipment=?,instructions=?,youtube=CASE WHEN ? THEN ? ELSE youtube END WHERE id=?',...fields.slice(0,4),Object.hasOwn(b,'youtube')?1:0,fields[4],clean(b.id)).changes)fail(404,'Ejercicio no disponible.');return {id:b.id,youtube:one('SELECT youtube FROM exercises WHERE id=?',b.id).youtube}}
 const id=token();run('INSERT INTO exercises(id,name,muscle,equipment,instructions,youtube) VALUES(?,?,?,?,?,?)',id,...fields);return {id,youtube:fields[4]};
 }
 const upload=path.match(/^\/api\/exercises\/([\w-]+)\/video$/);
 if(upload&&method==='PUT'){
 const x=one('SELECT * FROM exercises WHERE id=?',upload[1]);
 if(!x)fail(404,'Ejercicio no disponible.');
 const max=100*1024*1024;
 if(+req.headers['content-length']>max)fail(413,'El video debe pesar hasta 100 MB.');
 requireValue(req.headers['content-type']==='video/mp4','Elegí un archivo MP4.');
 const key=token(),file=dir+'/videos/'+key;
 let size=0,header=Buffer.alloc(0);
 try{
 await pipeline(req,new Transform({transform(chunk,enc,cb){
 size+=chunk.length;
 if(size>max)return cb(Object.assign(new Error('El video debe pesar hasta 100 MB.'),{status:413}));
 if(header.length<12)header=Buffer.concat([header,chunk.subarray(0,12-header.length)]);
 cb(null,chunk);
 }}),createWriteStream(file,{flags:'wx',mode:0o600}));
 requireValue(size>=16&&header.toString('ascii',4,8)==='ftyp','El archivo no es un MP4 válido.');
 const old=one('SELECT video FROM exercises WHERE id=?',x.id).video;
 run('UPDATE exercises SET video=? WHERE id=?',key,x.id);
 if(old)await unlink(dir+'/videos/'+old).catch(()=>{});
 }catch(e){await unlink(file).catch(()=>{});throw e}
 return {};
 }
 if(path==='/api/weeks'&&method==='GET')return all('SELECT w.id,w.student,w.monday,w.published IS NOT NULL AS published,u.name FROM weeks w JOIN users u ON u.id=w.student ORDER BY w.monday DESC,u.name');
 if(path==='/api/weeks'&&method==='POST'){
 const b=await body(req),target=monday(b.monday);
 requireValue(one("SELECT id FROM users WHERE id=? AND role='student'",clean(b.student)),'Elegí un alumno.');
 let draft='[]';
 if(b.copy){
 const original=one('SELECT * FROM weeks WHERE id=? AND student=?',clean(b.copy),b.student);
 if(!original)fail(404,'Semana de origen no disponible.');
 draft=original.draft;
 }
 const id=token();
 if(!run('INSERT INTO weeks VALUES(?,?,?,?,NULL) ON CONFLICT(student,monday) DO NOTHING',id,b.student,target,draft).changes)fail(409,'Ese alumno ya tiene un plan para esa semana.');
 return {id};
 }
 if(readWeek&&method==='PUT'){
 const b=await body(req),days=schedule(b.days),raw=JSON.stringify(days);
 if(b.publish){
 requireValue(days.length&&days.every(d=>d.items.length),'Agregá al menos un ejercicio en cada día antes de publicar.');
 const missing=[...new Set(hydrate(raw).flatMap(d=>d.items.filter(e=>!e.video&&!e.youtube).map(e=>e.name)))];
 if(missing.length&&!b.confirmMissing)return {missing};
 }
 const result=b.publish?run('UPDATE weeks SET draft=?,published=? WHERE id=?',raw,raw,readWeek[1]):run('UPDATE weeks SET draft=? WHERE id=?',raw,readWeek[1]);
 if(!result.changes)fail(404,'Semana no disponible.');
 return {};
 }
 fail(404,'Página no disponible.');
}
const assets={'/':'index.html','/app.js':'app.js','/style.css':'style.css'};
http.createServer(async(req,res)=>{
 res.setHeader('Cache-Control','no-store');
 res.setHeader('X-Content-Type-Options','nosniff');
 res.setHeader('Referrer-Policy','no-referrer');
 res.setHeader('Content-Security-Policy',"default-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'");
 try{
 const url=new URL(req.url,base);
 if(url.pathname.startsWith('/api/')){
 const response=await api(req,res,url);
 if(!res.headersSent)res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'}).end(JSON.stringify(response));
 }else if(Object.hasOwn(assets,url.pathname)){
 const file=assets[url.pathname],content=await readFile(new URL('./public/'+file,import.meta.url));
 const type={'index.html':'text/html','app.js':'text/javascript','style.css':'text/css'}[file];
 res.writeHead(200,{'Content-Type':type+'; charset=utf-8'}).end(content);
 }else fail(404,'Página no disponible.');
 }catch(e){
 if(!e.status&&e.code!=='ERR_STREAM_PREMATURE_CLOSE')console.error(e);
 if(!res.headersSent&&!res.destroyed)res.writeHead(e.status||500,{'Content-Type':'application/json; charset=utf-8'}).end(JSON.stringify({error:e.status?e.message:'Ocurrió un error. Probá de nuevo.'}));
 }
}).listen(Number(process.env.PORT||3000),process.env.HOST||'127.0.0.1',()=>console.log('Plan de Entreno disponible en '+base.origin));
