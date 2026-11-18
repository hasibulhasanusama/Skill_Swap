import { createHash } from 'node:crypto';
export const GAME_NAMES = { detective: 'Skill Detective', relay: 'Code Relay', typing: 'TypeSprint' };
export const PASSAGES = {
 english: [
  'Learning grows when we share what we know. Small steps, honest practice, and helpful feedback turn curiosity into confidence.',
  'A good teammate listens carefully, explains clearly, and makes space for questions. Progress is something we can build together.',
  'The quickest answer is not always the best answer. Read the problem, check your assumptions, and test one small idea at a time.'
 ],
 bangla: [
  'নতুন কিছু শেখার জন্য প্রতিদিন একটু অনুশীলন প্রয়োজন। আমরা যা জানি তা ভাগ করে নিলে অন্যের শেখার পথ সহজ হয়।',
  'একসঙ্গে কাজ করলে কঠিন সমস্যাও সহজ হয়ে যায়। মন দিয়ে শোনা এবং প্রশ্ন করা শেখার গুরুত্বপূর্ণ অংশ।',
  'সঠিকভাবে লেখা দ্রুত লেখার মতোই গুরুত্বপূর্ণ। ধৈর্য ধরে নিয়মিত অনুশীলন করলে দক্ষতা বাড়ে।'
 ],
 code: [
  'function add(a, b) {\n  return a + b;\n}\nconsole.log(add(3, 5));',
  'const scores = [10, 20, 30];\nconst total = scores.reduce((sum, value) => sum + value, 0);\nconsole.log(total);',
  'for (let index = 0; index < 5; index++) {\n  console.log(index);\n}'
 ]
};
export const fault = (status, message) => Object.assign(new Error(message), { status });
export function textUnits(text) { return Array.from(String(text).normalize('NFC')); }
export function typingMetrics(target, input, elapsedMs, roundSeconds = 60) {
 const expected = textUnits(target), typed = textUnits(input);
 let correct = 0;
 for (let i=0;i<typed.length;i++) if (typed[i]===expected[i]) correct++;
 const accuracy = typed.length ? correct / typed.length : 0;
 const seconds = Math.max(1, Math.min(roundSeconds, elapsedMs/1000));
 const wpm = (correct/5)/(seconds/60);
 const completed = typed.length === expected.length && correct === expected.length;
 return { correct, typed: typed.length, accuracy: Math.round(accuracy*10000)/100,
  wpm: Math.round(wpm*100)/100, completed,
  score: Math.round(correct * accuracy + (completed ? Math.max(0,roundSeconds-seconds)*0.25 : 0)) };
}
export function detectiveScore(correct, hint) { return correct ? (hint ? 5 : 10) : -3; }
export function botRandom(seed) { return parseInt(createHash('sha256').update(seed).digest('hex').slice(0,8),16)/0xffffffff; }
export function players(s) { return s.members.filter(m=>!m.bot); }
export function currentTask(s) { return s.tasks[s.round]; }
export function activePlayers(s) { const q=currentTask(s); return s.game==='relay'&&s.settings.relay_all_solve?s.members:s.members.filter(m=>m.id!==q?.author_id); }
export function rankPlayers(s) {
 return s.members.map(m=> {
  const rows=s.history.flatMap(h=>h.answers.filter(a=>a.user_id===m.id && !h.voided));
  const count=rows.length;
  return { id:m.id,name:m.name,bot:!!m.bot, score:rows.reduce((n,a)=>n+a.score,0),
   accuracy:count ? Math.round(rows.reduce((n,a)=>n+(a.accuracy??(a.correct?100:0)),0)/count*100)/100 : 0,
   wpm:count ? Math.round(rows.reduce((n,a)=>n+(a.wpm||0),0)/count*100)/100 : 0,
   seconds:Math.round(rows.reduce((n,a)=>n+(a.elapsed_ms||0)/1000,0)*100)/100,
   hints:rows.filter(a=>a.hint).length, rounds:count };
 }).sort((a,b)=>b.score-a.score || b.accuracy-a.accuracy || a.seconds-b.seconds || String(a.id).localeCompare(String(b.id)));
}
export function finishRound(s, now) {
 const q=currentTask(s);
 const answers=s.answers.filter(a=>a.round===s.round);
 for (const member of activePlayers(s)) {
  if (!answers.some(a=>a.user_id===member.id)) {
   const progress = s.game==='typing' ? s.progress[member.id] : null;
   const metrics = progress?.text ? typingMetrics(q.passage,progress.text,s.settings.seconds*1000,s.settings.seconds) : {};
   answers.push({user_id:member.id,round:s.round,score:0,accuracy:0,...metrics,elapsed_ms:s.settings.seconds*1000,timeout:true,body:progress?.text||''});
  }
 }
 s.history.push({round:s.round+1,task:structuredClone(q),answers:structuredClone(answers),voided:!!s.voided_round});
 s.voided_round=false;
 s.status='round_result';
 s.round_ended_at=now;
 s.version=(s.version||0)+1;
}
export function tick(s, now) {
 if(s.status==='study' && now>=s.study_ends_at) startRound(s,now);
 if(s.status!=='playing') return;
 const q=currentTask(s);
 const bot=s.members.find(m=>m.bot);
 if(bot && !s.answers.some(a=>a.round===s.round&&a.user_id===bot.id)) {
  const duration=s.settings.seconds*1000;
  if(s.game==='detective' && now>=s.round_starts_at+duration*.65) {
   const correct=botRandom(s.id+':'+s.round) < ({easy:.45,medium:.7,hard:.9}[s.settings.bot_level]||.7);
   s.answers.push({round:s.round,user_id:bot.id,choice:correct?q.answer:(q.answer+1)%q.choices.length,correct,score:detectiveScore(correct,false),accuracy:correct?100:0,elapsed_ms:duration*.65,bot:true});
  }
  if(s.game==='typing') {
   const elapsed=Math.max(0,now-s.round_starts_at);
   const speed={easy:20,medium:40,hard:65}[s.settings.bot_level]||40;
   const length=Math.min(textUnits(q.passage).length,Math.floor(elapsed/60000*speed*5));
   s.progress[bot.id]={length,percent:Math.round(length/textUnits(q.passage).length*100),wpm:speed,accuracy:100};
   if(length===textUnits(q.passage).length||now>=s.deadline) {
    const spent=Math.min(duration,textUnits(q.passage).length/5/speed*60000);
    const metrics=typingMetrics(q.passage,textUnits(q.passage).slice(0,length).join(''),spent,s.settings.seconds);
    s.answers.push({...metrics,round:s.round,user_id:bot.id,elapsed_ms:spent,bot:true});
   }
  }
 }
 const active=activePlayers(s);
 const answered=active.every(m=>s.answers.some(a=>a.round===s.round&&a.user_id===m.id));
 const judging=s.answers.some(a=>a.round===s.round&&a.pending);
 if((answered&&!judging)||now>=s.deadline) {
  if(judging) {s.awaiting_review=true;return;}
  finishRound(s,now);
 }
}
export function startRound(s,now) {
 s.status='playing';s.round_starts_at=now+3000;s.deadline=s.round_starts_at+s.settings.seconds*1000;
 s.progress={};s.hints={};s.awaiting_review=false;
}
export function safeRoom(s,viewer) {
 const result=structuredClone(s);
 result.server_now=Date.now();
 const q=currentTask(s);
 result.tasks=s.tasks.map((t,i)=> {
  if(s.status==='finished'||i<s.round|| (i===s.round&&s.status==='round_result')) return {...t,tests:undefined,reference_solution:undefined};
  if(t.author_id===viewer) return t;
  if(i!==s.round || !['playing','round_result'].includes(s.status)) return {author_id:t.author_id};
  const {answer,explanation,hint,tests,reference_solution,...safe}=t;
  return safe;
 });
 if(s.status!=='finished') result.answers=s.answers.map(a=> {
  if(a.round<s.round||s.status==='round_result'||a.user_id===viewer) return {...a,body: a.user_id===viewer||q?.author_id===viewer?a.body:undefined};
  return {round:a.round,user_id:a.user_id,pending:a.pending,submitted:true,body:q?.author_id===viewer?a.body:undefined};
 });

 if(s.game==='relay'&&s.settings.relay_all_solve&&s.status==='playing'){
  result.answers=result.answers.map(a=>
   a.user_id===viewer?a:{round:a.round,user_id:a.user_id,submitted:true}
  );
 }
 // Code remains private except to its author and the round setter.
 result.history=result.history.map(h=>({...h,task:{...h.task,tests:undefined,reference_solution:undefined},answers:h.answers.map(a=>({...a,body:s.game==='relay'&&a.user_id!==viewer&&h.task.author_id!==viewer?undefined:a.body}))}));
 result.tasks.forEach(t=>{if(t.author_id!==viewer){delete t.tests;delete t.reference_solution;}});
 result.leaderboard=rankPlayers(s);
 return result;
}
