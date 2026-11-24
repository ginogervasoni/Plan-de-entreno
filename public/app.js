const app=document.querySelector('#app'), modal=document.querySelector('#modal'), status=document.querySelector('#status');
let current, notifyTimer;
const names=['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'];
const short=['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];
const es=new Intl.NumberFormat('es-AR',{maximumFractionDigits:12});
const brand='<div class="brand"><span aria-hidden="true">P</span>Plan de Entreno</div>';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const $=(id)=>document.getElementById(id);
const btn=(label,id,primary=false)=>'<button type="button" '+(id?'id="'+id+'" ':'')+(primary?'class="primary"':'')+'>'+label+'</button>';
const opt=(value,label,selected)=>'<option value="'+esc(value)+'" '+(String(value)===String(selected)?'selected':'')+'>'+esc(label)+'</option>';
const input=(label,name,value='',opts='')=>'<label>'+label+'<input name="'+name+'" value="'+esc(value)+'" '+opts+'></label>';
const area=(label,name,value)=>'<label>'+label+'<textarea name="'+name+'">'+esc(value)+'</textarea></label>';
const formData=f=>Object.fromEntries(new FormData(f));
const byDate=s=>new Date(s+'T12:00:00Z');
const add=(s,offset)=>{const d=byDate(s);d.setUTCDate(d.getUTCDate()+offset);return d.toISOString().slice(0,10)};
const fmt=s=>new Intl.DateTimeFormat('es-AR',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(byDate(s));
const span=s=>fmt(s)+' al '+fmt(add(s,6));
const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Argentina/Buenos_Aires',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const dayIndex=(byDate(today).getUTCDay()+6)%7, thisMonday=add(today,-dayIndex);
const badge=active=>'<span class="badge '+(active?'live':'')+'">'+(active?'Publicada':'Borrador')+'</span>';
async function api(path,method='GET',data){
 const r=await fetch('/api'+path,{method,...(data?{headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}:{})});
 const b=await r.json();if(!r.ok)throw Error(b.error);return b;
}
function notice(message){status.textContent=message;clearTimeout(notifyTimer);notifyTimer=setTimeout(()=>status.textContent='',4000)}
function feedback(el,message,error=false){el.textContent=message;el.classList.toggle('error',error)}
function submit(form,task,output=form.querySelector('.feedback')){
 form.onsubmit=async event=>{
 event.preventDefault();
 const trigger=event.submitter;
 if(trigger)trigger.disabled=true;
 try{await task(formData(form))}catch(e){if(output)feedback(output,e.message,true);else notice(e.message)}
 finally{if(trigger)trigger.disabled=false}
 };
}
function go(route){if(location.hash==='#'+route)render();else location.hash=route}
function showDialog(html){
 if(modal.open)modal.close();
 modal.innerHTML='<div class="row split"><div></div>'+btn('Cerrar','close-modal')+'</div>'+html;
 $('close-modal').onclick=()=>modal.close();
 modal.showModal();
}
modal.addEventListener('close',()=>{if(!modal.open)modal.replaceChildren()});
async function play(id){
 try{
 const {url}=await api('/media/'+id);
 if(modal.open&&$('preview-player')){
 const slot=$('preview-player');slot.innerHTML='<video controls playsinline preload="metadata" src="'+esc(url)+'"></video>'+btn('Ocultar video','hide-video');
 $('hide-video').onclick=()=>slot.replaceChildren();
 }else showDialog('<video controls playsinline preload="metadata" src="'+esc(url)+'"></video>');
 }catch(e){notice(e.message)}
}
function layout(section,title,sub='',actions=''){
 const links=[['alumnos','Alumnos'],['biblioteca','Biblioteca de ejercicios'],['rutinas','Rutinas']];
 app.innerHTML='<div class="shell '+(current.role==='student'?'student':'')+'"><aside class="sidebar">'+brand+
 (current.role==='coach'?'<nav aria-label="Panel del entrenador">'+links.map(([key,label])=>'<button data-route="'+key+'" aria-current="'+(section===key)+'">'+label+'</button>').join('')+'</nav>':'')+
 '<div class="account"><small class="muted">'+esc(current.name)+'</small> '+btn('Cerrar sesión','logout')+'</div></aside><main class="canvas"><header class="header"><div><h1>'+esc(title)+'</h1>'+(sub?'<div class="muted">'+esc(sub)+'</div>':'')+'</div><div class="actions">'+actions+'</div></header><div id="content" class="stack"></div></main></div>';
 app.querySelectorAll('[data-route]').forEach(b=>b.onclick=()=>go(b.dataset.route));
 $('logout').onclick=async()=>{try{await api('/logout','POST');history.replaceState(null,'','/');current=null;auth()}catch(e){notice(e.message)}};
 return $('content');
}
function auth(mode='login',key=''){
 const setup=mode==='invite'||mode==='reset',recover=mode==='recover';
 const title=setup?(mode==='invite'?'Activá tu cuenta':'Elegí una contraseña'):recover?'Recuperá tu contraseña':'Iniciá sesión';
 app.innerHTML='<main class="auth"><div class="card">'+brand+'<h1>'+title+'</h1><form class="stack" id="auth">'+
 (setup?'':input('Correo electrónico','email','','required type="email" autocomplete="username"'))+
 (recover?'':input('Contraseña','password','','required maxlength="128" type="password" autocomplete="'+(setup?'new-password':'current-password')+'" '+(setup?'minlength="12"':'')))+
 '<button class="primary">'+(setup?'Guardar contraseña':recover?'Solicitar enlace':'Ingresar')+'</button><div class="feedback" role="status"></div></form>'+
 (mode==='login'?btn('Olvidé mi contraseña','recover'):btn('Volver al acceso','back'))+'</div></main>';
 if($('recover'))$('recover').onclick=()=>auth('recover');
 if($('back'))$('back').onclick=()=>{history.replaceState(null,'','/');auth()};
 submit($('auth'),async data=>{
 if(setup){await api('/activate','POST',{...data,token:key,reset:mode==='reset'});history.replaceState(null,'','/');auth();notice('Contraseña guardada. Ya podés ingresar.')}
 else if(recover){const r=await api('/recover','POST',data);feedback($('auth').querySelector('.feedback'),r.configured?'Si el correo está registrado, vas a recibir un enlace.':'La recuperación por correo todavía no está configurada.',!r.configured)}
 else {await api('/login','POST',data);current=(await api('/me')).user;render()}
 });
}
async function students(id){
 const list=await api('/students');
 if(id){
 const s=list.find(x=>x.id===id);if(!s)throw Error('Alumno no disponible.');
 const weeks=(await api('/weeks')).filter(w=>w.student===id);
 const c=layout('alumnos',s.name,s.email,btn('Volver','back-students')+btn('Crear semana','new-week',true));
 $('back-students').onclick=()=>go('alumnos');
 $('new-week').onclick=()=>weekDialog(list,s.id);
 c.innerHTML='<div class="card row split"><span class="badge '+(s.active?'live':'')+'">'+(s.active?'Cuenta activa':'Invitación pendiente')+'</span>'+(!s.active?btn('Generar invitación','invite'):'')+'</div><h2>Semanas de entrenamiento</h2><div id="week-list" class="stack"></div>';
 if($('invite'))$('invite').onclick=async()=>{
 try{const {link}=await api('/students/'+id+'/invite','POST');
 showDialog('<h2>Invitación individual</h2><p>Compartí este enlace con '+esc(s.name)+'. Vence en 72 horas y se puede usar una sola vez.</p><label>Enlace de activación<input readonly id="invite-link" value="'+esc(link)+'"></label>'+btn('Copiar enlace','copy-link',true));
 $('copy-link').onclick=async()=>{try{await navigator.clipboard.writeText(link);$('copy-link').textContent='Copiado'}catch{$('invite-link').select()}};
 }catch(e){notice(e.message)}
 };
 weekRows($('week-list'),weeks,list,false);return;
 }
 const c=layout('alumnos','Alumnos','Administrá las cuentas y abrí sus planes semanales.',btn('Nuevo alumno','add-student',true));
 c.innerHTML=input('Buscar por nombre','search','','type="search"')+'<div id="students" class="stack"></div>';
 const search=c.querySelector('input');
 function draw(){
 const matches=list.filter(s=>s.name.toLowerCase().includes(search.value.toLowerCase()));
 $('students').innerHTML=matches.map(s=>'<article class="card row split"><div><h3>'+esc(s.name)+'</h3><small>'+esc(s.email)+'</small></div><div class="row"><span class="badge '+(s.active?'live':'')+'">'+(s.active?'Cuenta activa':'Invitación pendiente')+'</span><button data-student="'+s.id+'">Abrir ficha</button></div></article>').join('')||'<div class="card muted">'+(list.length?'No encontramos alumnos con ese nombre.':'Todavía no cargaste alumnos.')+'</div>';
 $('students').querySelectorAll('button').forEach(b=>b.onclick=()=>go('alumnos/'+b.dataset.student));
 }
 search.oninput=draw;draw();
 $('add-student').onclick=()=>{
 showDialog('<h2>Nuevo alumno</h2><form class="stack" id="student-form">'+input('Nombre','name','','required maxlength="200"')+input('Correo electrónico','email','','required type="email"')+'<button class="primary">Crear alumno</button><div class="feedback" role="status"></div></form>');
 submit($('student-form'),async data=>{const r=await api('/students','POST',data);modal.close();go('alumnos/'+r.id)});
 };
}
function weekRows(target,weeks,list,showStudent){
 target.innerHTML=weeks.map(w=>'<article class="card row split"><div><strong>'+esc(span(w.monday))+'</strong>'+(showStudent?'<div class="muted">'+esc(w.name)+'</div>':'')+'</div><div class="row">'+badge(w.published)+'<button data-open="'+w.id+'">Editar</button><button data-copy="'+w.id+'">Duplicar semana</button></div></article>').join('')||'<div class="card muted">Todavía no hay semanas de entrenamiento.</div>';
 target.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>go('rutinas/'+b.dataset.open));
 target.querySelectorAll('[data-copy]').forEach(b=>b.onclick=()=>{const w=weeks.find(w=>w.id===b.dataset.copy);weekDialog(list,w.student,w)});
}
function weekDialog(list,id,copy){
 if(!list.length){notice('Creá un alumno antes de armar una semana.');return}
 showDialog('<h2>'+(copy?'Duplicar semana':'Crear semana')+'</h2><form class="stack" id="new-week-form"><label>Alumno<select name="student" '+((copy||id)?'disabled':'')+'>'+list.map(s=>opt(s.id,s.name,id)).join('')+'</select></label>'+
 input('Lunes de inicio','monday',copy?add(copy.monday,7):thisMonday,'required type="date"')+'<div id="range" class="muted"></div><button class="primary">'+(copy?'Duplicar como borrador':'Crear borrador')+'</button><div class="feedback" role="status"></div></form>');
 const f=$('new-week-form');
 const draw=()=>{const d=f.elements.monday.value;$('range').textContent=d?(byDate(d).getUTCDay()===1?span(d):'Elegí una fecha que caiga lunes.'):'Elegí una fecha.'};
 f.elements.monday.oninput=draw;draw();
 submit(f,async data=>{const r=await api('/weeks','POST',{...data,student:id||data.student,copy:copy?.id});modal.close();go('rutinas/'+r.id)});
}
async function library(id){
 const list=await api('/exercises');
 if(id){
 const x=list.find(e=>e.id===id)||{};
 if(id!=='nuevo'&&!x.id)throw Error('Ejercicio no disponible.');
 const c=layout('biblioteca',x.id?x.name:'Nuevo ejercicio','Biblioteca de ejercicios',btn('Volver','back-library'));
 $('back-library').onclick=()=>go('biblioteca');
 c.innerHTML='<form id="exercise-form" class="card stack">'+input('Nombre','name',x.name,'required maxlength="200"')+
 '<div class="grid">'+input('Grupo muscular','muscle',x.muscle,'maxlength="200"')+input('Equipamiento','equipment',x.equipment,'maxlength="200"')+'</div>'+area('Indicaciones generales','instructions',x.instructions)+
 '<fieldset class="stack"><legend>Video MP4 · opcional</legend><div class="row"><span class="badge" id="video-state">'+(x.video?'Con video':'Sin video')+'</span>'+btn('Ver video','exercise-play')+'</div>'+
 '<label>'+ (x.video?'Reemplazar video':'Seleccionar video')+'<input id="file" type="file" accept="video/mp4,.mp4"></label><small>Hasta 100 MB. Para mayor compatibilidad, usá MP4 con video H.264.</small><progress id="progress" max="100" value="0" hidden></progress></fieldset>'+
 '<div class="actions"><button class="primary" id="save-exercise">Guardar ejercicio</button></div><div class="feedback" role="status"></div></form>';
 const f=$('exercise-form'),file=$('file'),out=f.querySelector('.feedback');
 let saved=x.id,hasVideo=!!x.video;
 $('exercise-play').hidden=!hasVideo;$('exercise-play').onclick=()=>play(saved);
 file.onchange=()=>{$('save-exercise').textContent=file.files.length?'Guardar y subir MP4':'Guardar ejercicio'};
 submit(f,async data=>{
 feedback(out,'Guardando ejercicio…');
 saved=(await api('/exercises','POST',{...data,id:saved})).id;
 history.replaceState(null,'','#biblioteca/'+saved);
 const video=file.files[0];
 if(!video){feedback(out,'Ejercicio guardado.');return}
 const p=$('progress');p.hidden=false;p.value=0;feedback(out,'Subiendo video…');
 try{await uploadVideo(saved,video,p);hasVideo=true;$('video-state').textContent='Con video';$('exercise-play').hidden=false;file.value='';file.onchange();feedback(out,'Ejercicio guardado y video disponible.')}
 catch(e){feedback(out,'Ejercicio guardado. '+e.message+' Volvé a guardar para reintentar.',true)}
 finally{p.hidden=true}
 });
 return;
 }
 const c=layout('biblioteca','Biblioteca de ejercicios','Creá ejercicios reutilizables y agregales sus videos.',btn('Nuevo ejercicio','new-exercise',true));
 $('new-exercise').onclick=()=>go('biblioteca/nuevo');
 const muscles=[...new Set(list.map(e=>e.muscle).filter(Boolean))].sort();
 c.innerHTML='<div class="card grid">'+input('Buscar por nombre','search','','type="search"')+'<label>Grupo muscular<select id="muscle">'+opt('','Todos')+muscles.map(m=>opt(m,m)).join('')+'</select></label><label>Video<select id="video-filter">'+opt('','Todos')+opt('yes','Con video')+opt('no','Sin video')+'</select></label></div><div id="exercise-list" class="stack"></div>';
 const search=c.querySelector('input');
 function draw(){
 const state=$('video-filter').value,m=$('muscle').value;
 $('exercise-list').innerHTML=list.filter(e=>e.name.toLowerCase().includes(search.value.toLowerCase())&&(!m||m===e.muscle)&&(!state||(state==='yes')===!!e.video)).map(e=>'<article class="card row split"><div><h3>'+esc(e.name)+'</h3><small>'+esc([e.muscle,e.equipment].filter(Boolean).join(' · '))+'</small></div><div class="row"><span class="badge">'+(e.video?'Con video':'Sin video')+'</span><button data-edit="'+e.id+'">Editar</button></div></article>').join('')||'<div class="card muted">'+(list.length?'No encontramos ejercicios con esos filtros.':'Todavía no cargaste ejercicios.')+'</div>';
 $('exercise-list').querySelectorAll('button').forEach(b=>b.onclick=()=>go('biblioteca/'+b.dataset.edit));
 }
 search.oninput=draw;$('muscle').onchange=draw;$('video-filter').onchange=draw;draw();
}
function uploadVideo(id,file,progress){
 return new Promise((resolve,reject)=>{
 if(!/\.mp4$/i.test(file.name)||file.size>100*1024*1024){reject(Error('Elegí un MP4 de hasta 100 MB.'));return}
 const x=new XMLHttpRequest();x.open('PUT','/api/exercises/'+id+'/video');
 x.setRequestHeader('Content-Type','video/mp4');
 x.upload.onprogress=e=>{if(e.lengthComputable)progress.value=e.loaded/e.total*100};
 x.onload=()=>{if(x.status===200)resolve();else{let msg;try{msg=JSON.parse(x.responseText).error}catch{}reject(Error(msg||'Falló la carga del video.'))}};
 x.onerror=()=>reject(Error('Se interrumpió la carga del video.'));x.send(file);
 });
}
function dayView(days,monday,index,weekControl='',isPreview=false){
 const heading='<div class="row split"><strong>'+esc(span(monday))+'</strong>'+weekControl+'</div>';
 const selectors='<nav class="days" aria-label="Días de entrenamiento">'+short.map((d,i)=>{
 const date=add(monday,i);
 return '<button data-day="'+i+'" aria-label="'+names[i]+' '+fmt(date)+(date===today?', hoy':'')+'" aria-current="'+(i===index)+'" class="'+(date===today?'today':'')+'">'+d+'<small>'+Number(date.slice(-2))+'</small></button>';
 }).join('')+'</nav>';
 const day=days.find(d=>d.index===index);
 const cards=day?'<h2>'+esc(day.name)+'</h2>'+day.items.map(e=>{
 const load=e.load==='kg'?es.format(Number(String(e.weight).replace(',','.')))+' kg':e.load==='body'?'Peso corporal':'Sin carga indicada';
 const measure=e.kind==='seconds'?' s':e.amount==1?' repetición':' repeticiones';
 return '<article class="card"><h3>'+esc(e.name)+'</h3><p class="prescription">'+esc(e.sets)+(e.sets==1?' serie':' series')+' × '+esc(e.amount)+measure+' · '+load+' · '+esc(e.rest)+' s de descanso</p>'+
 (e.note?'<p class="note">'+esc(e.note)+'</p>':'')+(e.instructions?'<p class="note muted">'+esc(e.instructions)+'</p>':'')+(e.video?'<button data-video="'+e.exercise+'">Ver video</button>':'')+'</article>';
 }).join(''):'<div class="card muted">'+(monday===thisMonday&&index===dayIndex?'No tenés entrenamiento programado para hoy':'No tenés entrenamiento programado para este día')+'</div>';
 return heading+selectors+'<div class="stack">'+cards+'</div>'+(isPreview?'<div id="preview-player"></div>':'');
}
function bindDayView(el,choose){
 el.querySelectorAll('[data-day]').forEach(b=>b.onclick=()=>choose(Number(b.dataset.day)));
 el.querySelectorAll('[data-video]').forEach(b=>b.onclick=()=>play(b.dataset.video));
}
async function student(){
 const weeks=await api('/mine');
 const params=new URLSearchParams(location.hash.slice(1));
 const requested=params.get('semana');
 const match=requested?weeks.find(w=>w.id===requested):weeks.find(w=>w.monday===thisMonday);
 const monday=match?.monday||thisMonday;
 const days=match?(await api('/weeks/'+match.id)).days:null;
 let index=Number(params.get('dia') ?? (monday===thisMonday?dayIndex:0));
 if(!Number.isInteger(index)||index<0||index>6)index=0;
 const c=layout('','Mi semana');
 const choices=[{id:'',monday:thisMonday},...weeks.filter(w=>w.monday!==thisMonday)];
 const control='<label>Ir a otra semana<select id="week-select">'+choices.map(w=>opt(w.id,w.id?span(w.monday):'Semana actual',requested||'')).join('')+'</select></label>';
 function draw(){
 c.innerHTML=days?dayView(days,monday,index,control):'<div class="row split"><strong>'+esc(span(monday))+'</strong>'+control+'</div><div class="card muted">Tu entrenador todavía no publicó esta semana</div>';
 bindDayView(c,i=>{index=i;params.set('dia',String(i));history.replaceState(null,'','#'+params);draw()});
 $('week-select').onchange=e=>go(e.target.value?'semana='+e.target.value:'');
 }
 draw();
}
async function routines(id){
 const [students,weeks,exercises]=await Promise.all([api('/students'),api('/weeks'),id?api('/exercises'):Promise.resolve([])]);
 if(!id){
 const c=layout('rutinas','Rutinas','Consultá y editá las semanas de entrenamiento.',btn('Crear semana','create-week',true));
 $('create-week').onclick=()=>weekDialog(students);
 weekRows(c,weeks,students,true);return;
 }
 const w=await api('/weeks/'+id);
 const person=students.find(x=>x.id===w.student);
 const c=layout('rutinas','Semana de '+person.name,span(w.monday),btn('Ver ficha','back-person')+btn('Duplicar semana','duplicate'));
 $('back-person').onclick=()=>go('alumnos/'+person.id);

 const byId=new Map(exercises.map(e=>[e.id,e]));
 let days=w.draft, dirty=false;
 c.innerHTML='<div class="row">'+badge(w.published)+'<span id="editor-state" class="muted">'+(w.published?'Los cambios se muestran al alumno cuando volvés a publicar.':'El borrador queda visible solo para vos.')+'</span></div>'+
 '<form id="planner" class="stack"><div id="sessions" class="stack"></div><div class="row">'+btn('Agregar día','add-day')+'</div><div class="sticky stack"><div class="actions">'+btn('Guardar borrador','save-week')+btn('Vista previa','preview')+'<button class="primary" id="publish">Publicar semana</button></div><div id="editor-feedback" class="feedback" role="status"></div></div></form>';
 const f=$('planner'),out=$('editor-feedback');
 function mark(){dirty=true;feedback(out,'Tenés cambios sin guardar.')}
 window.onbeforeunload=e=>{if(dirty){e.preventDefault();e.returnValue=''}};
 const draw=()=>{
 $('add-day').disabled=days.length===7;
 $('sessions').innerHTML=days.map((d,di)=>'<fieldset class="card stack" data-session="'+di+'"><legend>'+names[d.index]+'</legend><div class="grid"><label>Día<select data-day-field="index">'+names.map((n,i)=>opt(i,n,d.index)).join('')+'</select></label>'+
 '<div>'+input('Nombre de la sesión','name',d.name,'data-day-field="name" required maxlength="200"')+'</div></div><div class="actions"><button type="button" data-action="pick">Agregar ejercicio</button><button type="button" data-action="remove-day">Quitar día</button></div>'+
 d.items.map((e,i)=>'<fieldset data-item="'+i+'"><legend>'+esc(byId.get(e.exercise)?.name||e.exercise)+'</legend><div class="stack"><div class="inline">'+
 input('Series','sets',e.sets,'type="number" min="1" max="100" required data-field="sets"')+
 '<label>Medida<select data-field="kind">'+opt('reps','Repeticiones',e.kind)+opt('seconds','Duración (s)',e.kind)+'</select></label>'+
 input('Cantidad','amount',e.amount,'type="number" min="1" max="86400" required data-field="amount"')+
 '<label>Carga<select data-field="load">'+opt('none','Sin carga indicada',e.load)+opt('body','Peso corporal',e.load)+opt('kg','Kilogramos',e.load)+'</select></label>'+
 (e.load==='kg'?input('Peso (kg)','weight',e.weight==null?'':String(e.weight).replace('.',','),'data-field="weight" inputmode="decimal" required'):'')+
 input('Descanso (s)','rest',e.rest,'data-field="rest" type="number" min="0" max="86400" required')+'</div>'+
 '<label>Nota personalizada<textarea maxlength="3000" data-field="note">'+esc(e.note)+'</textarea></label><div class="actions">'+
 (i?'<button type="button" data-action="up">Subir</button>':'')+(i<d.items.length-1?'<button type="button" data-action="down">Bajar</button>':'')+'<button type="button" data-action="remove">Quitar ejercicio</button></div></div></fieldset>').join('')+'</fieldset>').join('')||'<div class="card muted">Agregá un día para empezar a planificar.</div>';
 };
 draw();
 $('sessions').oninput=e=>{
 const t=e.target, di=t.closest('[data-session]')?.dataset.session;
 if(di==null)return;
 const d=days[di];
 if(t.dataset.dayField==='index'){
 if(days.some(o=>o!==d&&o.index===Number(t.value))){t.value=d.index;notice('Ese día ya tiene una sesión.');return}
 d.index=Number(t.value);draw();
 }else if(t.dataset.dayField)d[t.dataset.dayField]=t.value;
 else if(t.dataset.field){
 const item=d.items[t.closest('[data-item]').dataset.item];
 item[t.dataset.field]=t.value;
 if(t.dataset.field==='load')draw();
 }else return;
 mark();
 };
 $('add-day').onclick=()=>{
 const index=names.findIndex((_,i)=>!days.some(d=>d.index===i));
 if(index===-1)return;
 days.push({index,name:'Entrenamiento',items:[]});draw();mark();
 };
 $('sessions').onclick=e=>{
 const b=e.target.closest('[data-action]');if(!b)return;
 const di=Number(b.closest('[data-session]').dataset.session),d=days[di],action=b.dataset.action;
 if(action==='pick'){picker(d);return}
 if(action==='remove-day')days.splice(di,1);
 else{
 const i=Number(b.closest('[data-item]').dataset.item);
 if(action==='remove')d.items.splice(i,1);
 else{const j=i+(action==='up'?-1:1);[d.items[i],d.items[j]]=[d.items[j],d.items[i]]}
 }
 draw();mark();
 };
 function picker(d){
 showDialog('<h2>Agregar ejercicio</h2>'+input('Buscar por nombre','find-exercise','','type="search" id="pick-search"')+'<div id="pick-list" class="stack"></div>');
 const search=$('pick-search');
 function filter(){
 $('pick-list').innerHTML=exercises.filter(e=>e.name.toLowerCase().includes(search.value.toLowerCase())).map(e=>'<div class="card row split"><div><strong>'+esc(e.name)+'</strong><br><small>'+esc(e.muscle)+(e.video?'':' · Sin video')+'</small></div><button data-add="'+e.id+'">Agregar</button></div>').join('')||'<p class="muted">No hay ejercicios disponibles para esta búsqueda.</p>';
 $('pick-list').querySelectorAll('button').forEach(b=>b.onclick=()=>{d.items.push({exercise:b.dataset.add,sets:3,kind:'reps',amount:10,load:'none',weight:null,rest:60,note:''});modal.close();draw();mark()});
 }
 search.oninput=filter;filter();search.focus();
 }
 $('preview').onclick=()=>{
 if(!f.reportValidity())return;
 const mapped=days.map(d=>({...d,items:d.items.map(e=>({...e,...byId.get(e.exercise),exercise:e.exercise}))}));
 const renderDay=i=>{
 $('preview-content').innerHTML=dayView(mapped,w.monday,i,'',true);
 bindDayView($('preview-content'),renderDay);
 };
 showDialog('<h2>Vista previa · Mi semana</h2><div id="preview-content"></div>');
 renderDay(days[0]?.index??0);
 };
 async function save(publish,confirmMissing=false){
 if(!f.reportValidity())return;
 const buttons=Array.from(f.querySelectorAll('button,input,select,textarea')).filter(el=>!el.disabled);
 buttons.forEach(el=>el.disabled=true);
 feedback(out,publish?'Publicando…':'Guardando…');
 try{
 const r=await api('/weeks/'+id,'PUT',{days,publish,confirmMissing});
 if(r.missing){
 feedback(out,'Publicación pendiente de confirmación.');
 showDialog('<h2>Ejercicios sin video</h2><p>Podés publicar igual. El alumno verá las indicaciones disponibles.</p><ul>'+r.missing.map(n=>'<li>'+esc(n)+'</li>').join('')+'</ul>'+btn('Publicar igual','publish-anyway',true));
 $('publish-anyway').onclick=()=>{modal.close();save(true,true)};
 return;
 }
 dirty=false;
 if(publish){w.published=true;c.querySelector('.badge').outerHTML=badge(true);$('editor-state').textContent='Los cambios se muestran al alumno cuando volvés a publicar.'}
 feedback(out,publish?'Semana publicada.':w.published?'Borrador guardado. El alumno sigue viendo la última versión publicada.':'Borrador guardado.');
 }catch(e){feedback(out,e.message,true)}
 finally{buttons.forEach(el=>el.disabled=false)}
 }
 $('duplicate').onclick=()=>{
 if(dirty){feedback(out,'Guardá el borrador para incluir tus cambios en la copia. Si querés duplicar la versión guardada, continuá desde la lista de rutinas.');return}
 weekDialog(students,person.id,w);
 };
 $('save-week').onclick=()=>save(false);
 f.onsubmit=e=>{e.preventDefault();save(true)};
}
async function render(){
 if(!current)return;
 window.onbeforeunload=null;
 try{
 if(current.role==='student'){await student();return}
 const [section,id]=location.hash.slice(1).split('/');
 if(section==='biblioteca')await library(id);
 else if(section==='rutinas')await routines(id);
 else await students(section==='alumnos'?id:null);
 }catch(e){
 const c=layout('','Plan de Entreno','',btn('Volver al panel','back-panel'));
 c.textContent=e.message;$('back-panel').onclick=()=>go(current.role==='coach'?'alumnos':'');
 }
}
window.addEventListener('hashchange',render);
const query=new URLSearchParams(location.search), invite=query.get('invitacion'),reset=query.get('restablecer');
if(invite||reset)auth(invite?'invite':'reset',invite||reset);
else{
 try{current=(await api('/me')).user;if(current)await render();else auth()}
 catch(e){auth();notice(e.message)}
}
