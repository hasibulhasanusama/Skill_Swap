
import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {transaction} from './db.js';
import {requireFundedBooking} from './payment-ledger.js';

const fail=(status,message)=>Object.assign(new Error(message),{status});
const params=z.object({
 kind:z.enum(['booking','exchange-session']),
 id:z.coerce.number().int().positive()
});

export async function assertSessionTime(c,kind,id){
 const t=(await c.query(
  'SELECT * FROM learning_session_clocks WHERE kind=$1 AND session_id=$2',
  [kind,id]
 )).rows[0];
 if(!t?.started_at||Date.parse(t.ends_at)>Date.now()){
  throw fail(409,'Both participants must start the session and the full session time must pass before delivery can be recorded.');
 }
}

export async function sweepSessionTimers(db){
 await transaction(db,async c=>{
  const due=(await c.query(
   'SELECT * FROM learning_session_clocks WHERE ends_at<=now() AND notified_at IS NULL ORDER BY ends_at LIMIT 100 FOR UPDATE SKIP LOCKED'
  )).rows;
  for(const t of due){
   const row=(await c.query(
    t.kind==='booking'
     ?'SELECT status FROM bookings WHERE id=$1'
     :'SELECT e.status FROM exchange_sessions s JOIN exchanges e ON e.id=s.exchange_id WHERE s.id=$1',
    [t.session_id]
   )).rows[0];

   if(row&&['reserved','active'].includes(row.status)){
    for(const uid of [t.teacher_id,t.learner_id]){
     await c.query(
      'INSERT INTO notifications(user_id,title,route,event_key) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',
      [
       uid,
       'Session time completed. Confirm delivery only if the class was delivered.',
       t.route,
       'class-time:'+t.kind+':'+t.session_id
      ]
     );
    }
   }
   await c.query(
    'UPDATE learning_session_clocks SET notified_at=now() WHERE kind=$1 AND session_id=$2',
    [t.kind,t.session_id]
   );
  }
 });
}

export function startSessionTimerWorker(db){
 let busy=false;
 const run=async()=>{
  if(busy)return;
  busy=true;
  try{await sweepSessionTimers(db);}
  catch(e){console.error('Session timer notifications:',e.message);}
  finally{busy=false;}
 };
 const timer=setInterval(run,15000);
 timer.unref();
 void run();
 return()=>clearInterval(timer);
}

export function mountSessionTimers(app,{db,login,sessionContext,sessionOpen}){
 const act=async(req,action)=>transaction(db,async c=>{
  const {kind,id}=params.parse(req.params);
  const ctx=await sessionContext(c,kind,id,req.user.id,true);
  const s=ctx.session;
  const teacher=ctx.teacherId;
  const learner=ctx.participants.find(x=>x!==teacher);

  let t=(await c.query(
   'SELECT * FROM learning_session_clocks WHERE kind=$1 AND session_id=$2 FOR UPDATE',
   [kind,id]
  )).rows[0];

  if(action!=='status'){
   const allowed=action==='problem'
    ?['reserved','active'].includes(ctx.record.status)
    :sessionOpen(ctx);
   if(!allowed)throw fail(409,'This session is not open for class actions.');

   if(kind==='booking'&&action!=='problem'){
    await requireFundedBooking(c,s);
   }
   if(action!=='problem'&&!s.meeting_url){
    throw fail(409,'The teacher must save a meeting link first.');
   }
   if(action==='start'&&Date.parse(s.starts_at)>Date.now()){
    throw fail(409,'Start at or after the scheduled session time.');
   }

   if(!t){
    const duration=Math.round(
     (Date.parse(s.ends_at)-Date.parse(s.starts_at))/1000
    );
    if(!Number.isFinite(duration)||duration<=0){
     throw fail(409,'Invalid scheduled duration.');
    }
    const route='dashboard/room/'+
     (kind==='booking'?'booking':'exchange')+'/'+ctx.parentId;
    t=(await c.query(
     'INSERT INTO learning_session_clocks(kind,session_id,teacher_id,learner_id,duration_seconds,route) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
     [kind,id,teacher,learner,duration,route]
    )).rows[0];
   }

   const role=req.user.id===teacher?'teacher':'learner';

   if(action==='join'){
    await c.query(
     'UPDATE learning_session_clocks SET '+role+
     '_joined_at=COALESCE('+role+'_joined_at,now()) WHERE kind=$1 AND session_id=$2',
     [kind,id]
    );
   }

   if(action==='start'){
    if(!t[role+'_joined_at']){
     throw fail(409,'Use Join class before confirming the start.');
    }
    await c.query(
     'UPDATE learning_session_clocks SET '+role+
     '_ready_at=COALESCE('+role+'_ready_at,now()) WHERE kind=$1 AND session_id=$2',
     [kind,id]
    );
    await c.query(
     "UPDATE learning_session_clocks SET started_at=now(),ends_at=now()+duration_seconds*interval '1 second' WHERE kind=$1 AND session_id=$2 AND started_at IS NULL AND teacher_ready_at IS NOT NULL AND learner_ready_at IS NOT NULL",
     [kind,id]
    );
   }

   if(action==='problem'){
    const {reason}=z.object({
     reason:z.string().trim().min(5).max(1000)
    }).parse(req.body);
    const col=kind==='booking'?'booking_id':'exchange_id';
    await c.query(
     'INSERT INTO learning_messages('+col+',sender_id,body,client_key) VALUES($1,$2,$3,$4)',
     [ctx.parentId,req.user.id,'Class problem: '+reason,randomUUID()]
    );
    await c.query(
     'INSERT INTO notifications(user_id,title,route,event_key) VALUES($1,$2,$3,$4)',
     [
      req.user.id===teacher?learner:teacher,
      'Your learning partner reported a class problem.',
      t.route,
      'class-problem:'+randomUUID()
     ]
    );
   }

   t=(await c.query(
    'SELECT * FROM learning_session_clocks WHERE kind=$1 AND session_id=$2',
    [kind,id]
   )).rows[0];
  }

  return {
   clock:t||null,
   server_now:Date.now(),
   can_start:sessionOpen(ctx)&&Date.parse(s.starts_at)<=Date.now(),
   can_join:sessionOpen(ctx)&&!!s.meeting_url,
   can_problem:['reserved','active'].includes(ctx.record.status),
   meeting_url:s.meeting_url||'',
   message:action==='problem'
    ?'Problem shared in the learning room. Do not confirm delivery until resolved.'
    :action==='start'?'Start confirmation saved.'
    :action==='join'?'Join time recorded.':'Timer loaded.'
  };
 });

 app.get('/api/learning-sessions/:kind/:id/clock',login,
  async(req,res)=>res.json(await act(req,'status'))
 );
 for(const action of ['join','start','problem']){
  app.post('/api/learning-sessions/:kind/:id/clock/'+action,login,
   async(req,res)=>res.json(await act(req,action))
  );
 }
}
