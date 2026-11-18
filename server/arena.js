import {RELAY_EASY} from "../public/relay-easy.js";
import { readFile } from 'node:fs/promises';
import { SAMPLE_LIBRARY } from './arena-samples.js';
import { sendArenaReport,sendWinnerCertificate } from './arena-pdf.js';
import { randomUUID, randomBytes, randomInt } from 'node:crypto';
import { z } from 'zod';
import { transaction } from './db.js';
import { documentType,safeFilename } from './storage.js';
import { can } from './permissions.js';
import { GAME_NAMES,PASSAGES,fault,players,currentTask,activePlayers,rankPlayers,startRound,tick,safeRoom,typingMetrics,detectiveScore,textUnits } from './arena-engine.js';
import { generatePDFQuestions,gradeCode,runnerLanguages } from './arena-services.js';
const ident=z.uuid();
const taskSchema=z.object({prompt:z.string().trim().min(10).max(5000),choices:z.array(z.string().trim().min(1).max(600)).length(4),answer:z.number().int().min(0).max(3),hint:z.string().trim().min(3).max(500),explanation:z.string().trim().min(5).max(2000),page:z.number().int().min(1).max(5000)}).refine(q=>new Set(q.choices).size===4,'Choices must be distinct.');
const relayTask=z.object({prompt:z.string().trim().min(15).max(5000),language:z.string().trim().min(1).max(80),language_id:z.number().int().positive().nullable().optional(),tests:z.array(z.object({input:z.string().max(2000),output:z.string().max(2000).default('')})).min(1).max(5),reference_solution:z.string().min(1).max(12000)});
const asNumber=(n,min,max,fallback)=>Number.isFinite(Number(n))?Math.min(max,Math.max(min,Math.floor(Number(n)))):fallback;
export function mountArena(app,{db,login,upload,storage,services={}}){
 const ai=services.generatePDFQuestions||generatePDFQuestions, judge=services.gradeCode||gradeCode;
 const languages=services.runnerLanguages||runnerLanguages;
 const isAdmin=req=>req.user?.role==='admin'&&can(req.user,'arena.manage');
 const adminOnly=(req,res,next)=>isAdmin(req)?next():next(fault(403,'Arena administrator permission required.'));
 async function notify(c,uid,title,route,event){await c.query('INSERT INTO notifications(user_id,title,route,event_key) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[uid,title,route,event]);}
 async function save(c,s){
  if(s.status==='finished'&&!s.finalized){
   const ranked=rankPlayers(s);s.leaderboard=ranked;s.finalized=true;s.finished_at=Date.now();
   const top=ranked[0],second=ranked[1];
   s.tie=!!(second&&top.score===second.score&&top.accuracy===second.accuracy&&top.seconds===second.seconds);
   s.winner=s.tie?null:top?.id;
   if(s.mode!=='solo'&&!s.tie&&top&&!top.bot&&top.score>0&&top.rounds>0){
    const cert=(await c.query('INSERT INTO arena_certificates(id,room_id,user_id,winner_name,game,score) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(room_id) DO NOTHING RETURNING id',[randomUUID(),s.id,top.id,top.name,s.game,top.score])).rows[0];
    if(cert)s.certificate_id=cert.id;
   }
   for(const m of players(s))await notify(c,m.id,GAME_NAMES[s.game]+' report is ready.','arena/report/'+s.id,'arena-finished:'+s.id);
  }
  await c.query('UPDATE arena_rooms SET state=$1,status=$2,version=version+1,updated_at=now() WHERE id=$3',[JSON.stringify(s),s.status,s.id]);
 }
 async function access(c,id,uid){
  const row=(await c.query('SELECT * FROM arena_rooms WHERE id=$1 FOR UPDATE',[ident.parse(id)])).rows[0];
  if(!row||!row.state.members.some(m=>m.id===uid))throw fault(404,'Room not found in your account.');
  return row.state;
 }
 const mutate=async(req,run)=>transaction(db,async c=>{const s=await access(c,req.params.id,req.user.id);tick(s,Date.now());await run(s,c);await save(c,s);return safeRoom(s,req.user.id);});
 app.get('/api/arena/catalog',login,async(req,res)=>{
  const materials=(await db.query('SELECT id,title,category,difficulty,published,question_source,jsonb_array_length(questions) AS question_count FROM arena_materials WHERE published=true ORDER BY id DESC')).rows;
  const recent=(await db.query('SELECT r.id,r.code,r.game,r.mode,r.status,r.created_at FROM arena_rooms r JOIN arena_members m ON m.room_id=r.id WHERE m.user_id=$1 ORDER BY r.created_at DESC LIMIT 30',[req.user.id])).rows;
  res.json({materials,recent,admin:isAdmin(req),ai_configured:!!process.env.OPENAI_API_KEY,runner_configured:!!process.env.ARENA_JUDGE_URL,languages:await languages().catch(()=>[]),passages:PASSAGES});
 });
 app.get('/api/arena/admin/materials',login,adminOnly,async(req,res)=>res.json({items:(await db.query('SELECT * FROM arena_materials ORDER BY id DESC')).rows.map(({storage_key,...m})=>m)}));
 app.post('/api/arena/admin/samples',login,adminOnly,async(req,res)=>{
  const stored=[];
  try {
   const installed=await transaction(db,async c=>{
    await c.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[req.user.id]);
    let count=0;
    for(const sample of SAMPLE_LIBRARY){
     const exists=(await c.query('SELECT id FROM arena_materials WHERE title=$1',[sample.title])).rows[0];
     if(exists)continue;
     const bytes=await readFile(new URL('./assets/'+sample.category+'-study.pdf',import.meta.url));
     const key=await storage.put(bytes);stored.push(key);
     await c.query("INSERT INTO arena_materials(owner_id,title,category,difficulty,storage_key,original_name,questions,published,question_source) VALUES($1,$2,$3,$4,$5,$6,$7,true,'admin sample')",[req.user.id,sample.title,sample.category,sample.difficulty,key,sample.category+'-study.pdf',JSON.stringify(sample.questions)]);count++;
    }
    return count;
   });
   res.json({message:installed+' sample PDFs installed by administrator.'});
  } catch(error){for(const key of stored)await storage.delete(key).catch(()=>{});throw error;}
 });
 app.post('/api/arena/admin/materials',login,adminOnly,upload.single('document'),async(req,res)=>{
  const b=z.object({title:z.string().trim().min(3).max(160),category:z.enum(['coding','design','english']),difficulty:z.enum(['Beginner','Intermediate','Advanced'])}).parse(req.body);
  if(!req.file||documentType(req.file.buffer)!=='application/pdf')throw fault(400,'Upload a PDF document, at most 5 MB.');
  const key=await storage.put(req.file.buffer);
  try{const m=(await db.query('INSERT INTO arena_materials(owner_id,title,category,difficulty,storage_key,original_name) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',[req.user.id,b.title,b.category,b.difficulty,key,safeFilename(req.file.originalname)])).rows[0];res.status(201).json(m);}catch(error){await storage.delete(key);throw error;}
 });
 app.get('/api/arena/materials/:materialId/pdf',login,async(req,res)=>{
  const m=(await db.query('SELECT * FROM arena_materials WHERE id=$1',[z.coerce.number().int().positive().parse(req.params.materialId)])).rows[0];
  if(!m||(!m.published&&!isAdmin(req)))throw fault(404,'Published PDF not found.');
  res.set('Cache-Control','private, no-store').set('Content-Disposition','inline; filename="study.pdf"').type('application/pdf').send(await storage.read(m.storage_key));
 });
 app.put('/api/arena/admin/materials/:materialId',login,adminOnly,async(req,res)=>{
  const b=z.object({title:z.string().trim().min(3).max(160),category:z.enum(['coding','design','english']),difficulty:z.enum(['Beginner','Intermediate','Advanced']),questions:z.array(taskSchema).max(100),published:z.boolean()}).parse(req.body);
  if(b.published&&!b.questions.length)throw fault(400,'Add at least one reviewed PDF question before publishing.');
  const m=(await db.query('UPDATE arena_materials SET title=$1,category=$2,difficulty=$3,questions=$4,published=$5,updated_at=now() WHERE id=$6 RETURNING id',[b.title,b.category,b.difficulty,JSON.stringify(b.questions),b.published,z.coerce.number().int().positive().parse(req.params.materialId)])).rows[0];
  if(!m)throw fault(404,'Material not found.');res.json({message:'PDF and question bank saved.'});
 });
 app.post('/api/arena/admin/materials/:materialId/generate',login,adminOnly,async(req,res)=>{
  const m=(await db.query('SELECT * FROM arena_materials WHERE id=$1',[z.coerce.number().int().positive().parse(req.params.materialId)])).rows[0];
  if(!m)throw fault(404,'PDF not found.');
  const generated=await ai({bytes:await storage.read(m.storage_key),filename:m.original_name,category:m.category,difficulty:m.difficulty});
  const questions=z.array(taskSchema).min(1).max(30).parse(generated.questions);
  // Save as draft: an administrator must review the answers and page references.
  await db.query("UPDATE arena_materials SET questions=$1,question_source='ai',published=false,updated_at=now() WHERE id=$2",[JSON.stringify(questions),m.id]);
  res.json({questions,message:'AI draft generated from the PDF. Review all answers and page references before publishing.'});
 });
 app.post('/api/arena/rooms',login,async(req,res)=>{
  const b=z.object({game:z.enum(['detective','relay','typing']),mode:z.enum(['solo','bot','friends']),material_id:z.number().int().positive().optional(),settings:z.object({seconds:z.number().int().min(15).max(1800),study_seconds:z.number().int().min(10).max(1800).default(60),rounds:z.number().int().min(1).max(10).default(3),bot_level:z.enum(['easy','medium','hard']).default('medium'),typing_mode:z.enum(['english','bangla','code']).default('english'),language:z.string().max(80).default('JavaScript'),passage:z.string().max(3000).optional()})}).parse(req.body);
  if(b.game==='relay'&&b.mode!=='friends')throw fault(400,'Code Relay is a friends game.');
  let material=null,tasks=[];
  if(b.game==='detective'){
   const m=(await db.query('SELECT * FROM arena_materials WHERE id=$1 AND published=true',[b.material_id||0])).rows[0];
   if(!m)throw fault(400,'Choose a published administrator PDF.');
   material={id:m.id,title:m.title,source:m.question_source,category:m.category};
   if(b.mode!=='friends')tasks=m.questions.slice(0,b.settings.rounds).map(q=>{
    const indexes=[0,1,2,3];for(let i=3;i>0;i--){const j=randomInt(i+1);[indexes[i],indexes[j]]=[indexes[j],indexes[i]];}
    return {...q,choices:indexes.map(i=>q.choices[i]),answer:indexes.indexOf(q.answer),author_id:null};
   });
   if(b.mode!=='friends'&&!tasks.length)throw fault(400,'This PDF has no published tasks.');
  }
  if(b.game==='typing'){
   const passages=PASSAGES[b.settings.typing_mode];
   tasks=Array.from({length:b.settings.rounds},(_,i)=>({passage:b.settings.passage?.trim()||passages[i%passages.length],author_id:null}));
  }
  // Relay everyone solves v3
  if(b.game==='relay')b.settings.relay_all_solve=true;
  const id=randomUUID(),code=randomBytes(4).toString('hex').toUpperCase();
  const s={id,code,game:b.game,mode:b.mode,status:'lobby',material,settings:b.settings,members:[{id:req.user.id,name:req.user.name,ready:false,last_seen:Date.now()}],tasks,round:0,answers:[],history:[],progress:{},chat:[],host_id:req.user.id};
  if(b.mode==='bot')s.members.push({id:'bot',name:'Practice Bot ('+b.settings.bot_level+')',bot:true,ready:true});
  await transaction(db,async c=>{await c.query('INSERT INTO arena_rooms(id,code,host_id,game,mode,state) VALUES($1,$2,$3,$4,$5,$6)',[id,code,req.user.id,b.game,b.mode,JSON.stringify(s)]);await c.query('INSERT INTO arena_members(room_id,user_id) VALUES($1,$2)',[id,req.user.id]);});
  res.status(201).json(safeRoom(s,req.user.id));
 });
 app.post('/api/arena/join',login,async(req,res)=>{
  const {code}=z.object({code:z.string().trim().regex(/^[A-Fa-f0-9]{8}$/)}).parse(req.body);
  const result=await transaction(db,async c=>{
   const row=(await c.query('SELECT * FROM arena_rooms WHERE code=$1 FOR UPDATE',[code.toUpperCase()])).rows[0];if(!row)throw fault(404,'Room code not found.');
   const s=row.state;
   if(!s.members.some(m=>m.id===req.user.id)){
    if(s.mode!=='friends'||s.status!=='lobby')throw fault(409,'This room is not open for joining.');
    if(s.members.length>=4)throw fault(409,'Room is full (maximum four players).');
    s.members.push({id:req.user.id,name:req.user.name,ready:false,last_seen:Date.now()});
    await c.query('INSERT INTO arena_members(room_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[s.id,req.user.id]);
    await notify(c,s.host_id,req.user.name+' joined your '+GAME_NAMES[s.game]+' room.','arena/room/'+s.id,'arena-join:'+s.id+':'+req.user.id);
   }
   await save(c,s);return safeRoom(s,req.user.id);
  });res.json(result);
 });

 // Host room deletion
 app.delete('/api/arena/rooms/:id', login, async(req,res)=>{
  const roomId = ident.parse(req.params.id);

  await transaction(db, async c=>{
   const row = (await c.query(
    'SELECT host_id FROM arena_rooms WHERE id=$1 FOR UPDATE',
    [roomId]
   )).rows[0];

   if (!row) throw fault(404,'Room not found.');
   if (row.host_id !== req.user.id) {
    throw fault(403,'Only the room host can delete this room.');
   }

   await c.query(
    'DELETE FROM arena_certificates WHERE room_id=$1',
    [roomId]
   );
   await c.query(
    'DELETE FROM arena_members WHERE room_id=$1',
    [roomId]
   );
   await c.query(
    'DELETE FROM notifications WHERE route=$1 OR route=$2',
    ['arena/room/'+roomId,'arena/report/'+roomId]
   );
   await c.query(
    'DELETE FROM arena_rooms WHERE id=$1',
    [roomId]
   );
  });

  res.json({message:'Room deleted.'});
 });

 app.get('/api/arena/rooms/:id',login,async(req,res)=>res.json(await mutate(req,s=>{const m=s.members.find(m=>m.id===req.user.id);m.last_seen=Date.now();})));

 // Relay language consensus
 app.post('/api/arena/rooms/:id/language',login,async(req,res)=>
  res.json(await mutate(req,s=>{
   if(s.game!=='relay'||s.status!=='lobby') {
    throw fault(409,'Choose a language in the Code Relay lobby.');
   }

   const b=z.object({
    language:z.string().trim().min(1).max(80)
   }).parse(req.body);

   const me=s.members.find(m=>m.id===req.user.id);
   const changed=me.language_choice!==b.language;
   me.language_choice=b.language;

   if(changed)s.members.forEach(m=>m.ready=false);

   const all=players(s);
   if(all.length>=2&&all.every(m=>m.language_choice===b.language)){
    if(s.settings.language!==b.language){
     s.tasks=[];
     s.members.forEach(m=>m.ready=false);
    }
    s.settings.language=b.language;
   }
  }))
 );

 app.post('/api/arena/rooms/:id/task',login,async(req,res)=>res.json(await mutate(req,async s=>{
  if(s.status!=='lobby'||s.mode!=='friends'||s.game==='typing')throw fault(409,'Tasks can only be set in the friends lobby.');

  if(s.game==='relay'&&(
   players(s).length<2||
   !players(s).every(m=>m.language_choice===s.settings.language)
  ))throw fault(400,'Every player must confirm the same language first.');

  const task=s.game==='detective'?taskSchema.parse(req.body):relayTask.parse(req.body);
  // Easy English Relay questions
  if(s.game==='relay'&&s.settings.relay_all_solve){
   const easy=RELAY_EASY.find(q=>q.prompt===task.prompt);
   if(!easy)throw fault(400,'Choose an easy English question from the list.');
   task.tests=easy.tests.map(t=>({...t}));
  }
 
  if(s.game==='relay'&&s.settings.language!==task.language)throw fault(400,'Use the room language.');

  if(s.game==='relay'&&['HTML','CSS'].includes(task.language)&&task.language_id){
   throw fault(400,'HTML/CSS use setter review, not a console runner.');
  }

  if(s.game==='relay'&&s.settings.relay_all_solve){
   if(['HTML','CSS'].includes(task.language)){
    throw fault(400,'HTML/CSS need a separate browser checker.');
   }
   if(!task.language_id||(!process.env.ARENA_JUDGE_URL&&!services.gradeCode)){
    throw fault(503,'Configure the code runner and select a runner language first.');
   }
  }
  if(s.game==='relay'&&task.language_id){
   if(!process.env.ARENA_JUDGE_URL&&!services.gradeCode)throw fault(400,'Choose setter review or configure the code runner.');
   const supported=await languages();if(!supported.some(l=>l.id===task.language_id))throw fault(400,'Select an active runner language.');

   const selected=supported.find(l=>l.id===task.language_id);
   if(s.settings.relay_all_solve){
    const name=selected.name.toLowerCase();
    const wanted=task.language.toLowerCase();
    if(name!==wanted&&!name.startsWith(wanted+' ')&&!name.startsWith(wanted+'(')){
     throw fault(400,'Choose the runner matching the agreed language.');
    }
   }
   const validation=await judge({
    source:task.reference_solution,
    language_id:task.language_id,
    tests:task.tests,
    reference:!!s.settings.relay_all_solve
   });
   if(s.settings.relay_all_solve){
    if(!validation||
       validation.checks?.length!==task.tests.length||
       validation.checks.some(t=>
        !t.passed||typeof t.output!=='string'||t.output.length>2000
       )){
     throw fault(400,'Reference solution must run successfully for every test input.');
    }

    if(validation.checks.some((t,i)=>
     t.output.trim()!==task.tests[i].output.trim()
    )){
     throw fault(400,'Reference solution gives a wrong output. Correct it and try again.');
    }
    task.tests=task.tests.map((t,i)=>({
     input:t.input,output:validation.checks[i].output
    }));
 
   }
 
   if(!validation||validation.score!==100)throw fault(400,'The reference solution must pass all supplied tests before this question can be used.');
  }
  s.tasks=s.tasks.filter(t=>t.author_id!==req.user.id);s.tasks.push({...task,author_id:req.user.id});
  s.members.forEach(m=>m.ready=false);
 })));
 app.post('/api/arena/rooms/:id/ready',login,async(req,res)=>res.json(await mutate(req,s=>{
  if(s.status!=='lobby')throw fault(409,'Game already started.');
  if(s.game==='relay'&&(
   players(s).length<2||
   !players(s).every(m=>m.language_choice===s.settings.language)
  ))throw fault(400,'Every player must confirm the same language first.');

  if(s.mode==='friends'&&s.game!=='typing'&&!s.tasks.some(t=>t.author_id===req.user.id))throw fault(400,'Set your question first.');
  s.members.find(m=>m.id===req.user.id).ready=z.object({ready:z.boolean()}).parse(req.body).ready;
 })));
 app.post('/api/arena/rooms/:id/start',login,async(req,res)=>res.json(await mutate(req,s=>{
  if(s.host_id!==req.user.id||s.status!=='lobby')throw fault(403,'Only the host can start the lobby.');
  if(s.mode==='friends'&&players(s).length<2)throw fault(400,'At least two friends must join.');

  if(s.game==='relay'&&(
   players(s).length<2||
   !players(s).every(m=>m.language_choice===s.settings.language)
  ))throw fault(400,'Every player must confirm the same language first.');
  if(!players(s).every(m=>m.ready))throw fault(400,'All players must be ready.');
  if(s.mode==='friends'&&s.game!=='typing'){
   if(!players(s).every(m=>s.tasks.some(t=>t.author_id===m.id)))throw fault(400,'Each player must set a question.');
   s.tasks=players(s).map(m=>s.tasks.find(t=>t.author_id===m.id));
  }
  if(s.game==='detective'){s.status='study';s.study_ends_at=Date.now()+s.settings.study_seconds*1000;}else startRound(s,Date.now());
 })));
 app.post('/api/arena/rooms/:id/chat',login,async(req,res)=>res.json(await mutate(req,s=>{
  const {body}=z.object({body:z.string().trim().min(1).max(500)}).parse(req.body);
  const last=s.chat.filter(x=>x.user_id===req.user.id).at(-1);if(last&&Date.now()-last.at<1000)throw fault(429,'Wait a moment before another message.');
  s.chat.push({id:randomUUID(),user_id:req.user.id,name:req.user.name,body,at:Date.now()});s.chat=s.chat.slice(-80);
 })));
 app.post('/api/arena/rooms/:id/hint',login,async(req,res)=>{
  let hint;
  const room=await mutate(req,s=>{
   if(s.status!=='playing'||s.game!=='detective'||Date.now()<s.round_starts_at)throw fault(409,'Hint is unavailable now.');
   if(currentTask(s).author_id===req.user.id)throw fault(403,'You are the question setter.');
   if(s.answers.some(a=>a.round===s.round&&a.user_id===req.user.id))throw fault(409,'Answer already submitted.');
   if(req.body.round!==s.round)throw fault(409,'The round changed. Refresh the room.');
   s.hints[req.user.id]=true;hint=currentTask(s).hint;
  });res.json({room,hint});
 });
 app.post('/api/arena/rooms/:id/progress',login,async(req,res)=>res.json(await mutate(req,s=>{
  if(s.game!=='typing'||s.status!=='playing'||Date.now()<s.round_starts_at)return;
  if(req.body.round!==s.round)throw fault(409,'The round changed. Refresh the room.');
  const {text}=z.object({text:z.string().max(6000)}).parse(req.body);
  if(s.answers.some(a=>a.round===s.round&&a.user_id===req.user.id))return;
  const elapsed=Date.now()-s.round_starts_at;
  if(textUnits(text).length>elapsed/1000*35+15)throw fault(400,'Typing input arrived too quickly.');
  const m=typingMetrics(currentTask(s).passage,text,elapsed,s.settings.seconds);
  s.progress[req.user.id]={text,...m,percent:Math.min(100,Math.round(m.correct/textUnits(currentTask(s).passage).length*100))};
 })));
 app.post('/api/arena/rooms/:id/answer',login,async(req,res)=>res.json(await mutate(req,async s=>{
  const now=Date.now();if(s.status!=='playing'||now<s.round_starts_at||now>s.deadline)throw fault(409,'This round is not accepting answers.');
  if(req.body.round!==s.round)throw fault(409,'The round changed. Refresh the room.');
  const q=currentTask(s);if(q.author_id===req.user.id&&!(s.game==='relay'&&s.settings.relay_all_solve))throw fault(403,'The question setter cannot compete in this round.');
  if(s.answers.some(a=>a.round===s.round&&a.user_id===req.user.id))throw fault(409,'Your final answer is already submitted.');
  const elapsed_ms=now-s.round_starts_at;
  let answer={round:s.round,user_id:req.user.id,elapsed_ms};
  if(s.game==='detective'){
   const {choice}=z.object({choice:z.number().int().min(0).max(3)}).parse(req.body);const correct=choice===q.answer,hint=!!s.hints[req.user.id];
   answer={...answer,choice,correct,hint,accuracy:correct?100:0,score:detectiveScore(correct,hint)};
  }else if(s.game==='typing'){
   const {text}=z.object({text:z.string().max(6000)}).parse(req.body);
   if(textUnits(text).length>elapsed_ms/1000*35+15)throw fault(400,'Typing input arrived too quickly.');
   const m=typingMetrics(q.passage,text,elapsed_ms,s.settings.seconds);
   answer={...answer,...m,body:text};
  }else{
   const {source}=z.object({source:z.string().min(1).max(12000)}).parse(req.body);
   let graded=null;
   if(q.language_id&&process.env.ARENA_JUDGE_URL||services.gradeCode)graded=await judge({source,language_id:q.language_id,tests:q.tests});
   if(s.settings.relay_all_solve&&!graded)throw fault(503,'Code runner unavailable. Retry before the deadline.');
   answer={...answer,body:source,score:graded?.score||0,accuracy:graded?.score||0,grading:graded?.grading||'setter review',checks:graded?.checks,pending:!graded};
  }
  s.answers.push(answer);tick(s,Date.now());
 })));
 app.post('/api/arena/rooms/:id/grade',login,async(req,res)=>res.json(await mutate(req,s=>{
  if(s.settings.relay_all_solve)throw fault(403,'Automatic rooms do not allow manual scores.');
  if(s.game!=='relay'||s.status!=='playing'||currentTask(s).author_id!==req.user.id)throw fault(403,'Only this round setter can review pending code.');
  if(req.body.round!==s.round)throw fault(409,'The round changed. Refresh the room.');
  const b=z.object({user_id:z.number().int(),score:z.number().int().min(0).max(100),feedback:z.string().trim().min(5).max(1000)}).parse(req.body);
  const a=s.answers.find(a=>a.round===s.round&&a.user_id===b.user_id&&a.pending);if(!a)throw fault(404,'Pending submission not found.');
  a.score=b.score;a.accuracy=b.score;a.feedback=b.feedback;a.pending=false;tick(s,Date.now());
 })));
 app.post('/api/arena/rooms/:id/dispute',login,async(req,res)=>res.json(await mutate(req,s=>{
  if(!['playing','round_result'].includes(s.status))throw fault(409,'No round to report.');
  const {reason}=z.object({reason:z.string().trim().min(5).max(500)}).parse(req.body);
  s.disputes=s.disputes||[];if(s.disputes.some(d=>d.round===s.round&&d.user_id===req.user.id))throw fault(409,'Already reported.');
  s.disputes.push({round:s.round,user_id:req.user.id,reason});
 })));
 app.post('/api/arena/rooms/:id/void',login,async(req,res)=>res.json(await mutate(req,s=>{
  if(s.host_id!==req.user.id||!['playing','round_result'].includes(s.status))throw fault(403,'Only the host can void this round.');
  s.void_reason=z.object({reason:z.string().trim().min(5).max(500)}).parse(req.body).reason;
  if(s.status==='round_result')s.history.at(-1).voided=true;else{s.voided_round=true;for(const a of s.answers.filter(a=>a.round===s.round))a.pending=false;s.deadline=Date.now();tick(s,Date.now());}
 })));
 app.post('/api/arena/rooms/:id/next',login,async(req,res)=>res.json(await mutate(req,s=>{
  if(req.body.round!==s.round)throw fault(409,'The round changed. Refresh the room.');
  if(s.host_id!==req.user.id||s.status!=='round_result')throw fault(403,'Host can advance after the round ends.');
  if(s.round+1>=s.tasks.length){s.status='finished';return;}
  s.round++;startRound(s,Date.now());
 })));
 app.post('/api/arena/rooms/:id/claim-host',login,async(req,res)=>res.json(await mutate(req,s=>{
  const host=s.members.find(m=>m.id===s.host_id);if(host&&Date.now()-host.last_seen<90000)throw fault(409,'Host is still connected.');s.host_id=req.user.id;
 })));
 app.get('/api/arena/reports/:id/pdf',login,async(req,res)=>{const room=await mutate(req,()=>{});if(room.status!=='finished')throw fault(409,'Finish the game first.');sendArenaReport(res,room,req.user.id);});
 app.get('/api/arena/reports/:id',login,async(req,res)=>{
  const room=await mutate(req,()=>{});if(room.status!=='finished')throw fault(409,'Finish the game to view its report.');res.json(room);
 });
 app.get('/api/arena/certificates/:certificateId/pdf',login,async(req,res)=>{const cert=(await db.query('SELECT * FROM arena_certificates WHERE id=$1 AND user_id=$2',[ident.parse(req.params.certificateId),req.user.id])).rows[0];if(!cert)throw fault(404,'Winner certificate not found.');sendWinnerCertificate(res,cert);});
 app.get('/api/arena/certificates/:certificateId',login,async(req,res)=>{
  const cert=(await db.query('SELECT * FROM arena_certificates WHERE id=$1 AND user_id=$2',[ident.parse(req.params.certificateId),req.user.id])).rows[0];
  if(!cert)throw fault(404,'Winner certificate not found in your account.');res.json(cert);
 });
}
