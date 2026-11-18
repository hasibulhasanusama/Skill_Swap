import {RELAY_EASY} from "./relay-easy.js";
export function createArenaUI({api,e,notice,user}) {
 const relayLanguages=["Java","JavaScript","HTML","CSS","C","C++","Python","TypeScript","C#","Go","Rust","PHP","Ruby","Kotlin","Swift","SQL","Other"];
 const names={detective:'Skill Detective',relay:'Code Relay',typing:'TypeSprint'};
 const $=q=>document.querySelector(q);
 let polling=null,clock=null,progressTimer=null,room=null,screenKey='',catalog=null,offset=0,lastProgress='',sending=false;
 function stop(){clearInterval(polling);clearInterval(clock);clearInterval(progressTimer);polling=clock=progressTimer=null;room=null;screenKey='';lastProgress='';sending=false;}
 function activeRoute(){return location.hash.slice(1).split('?')[0];}
 function status(text){const el=$('#arena-status');if(el)el.textContent=text;}
 function navigate(path){location.hash=path;}
 function options(values,current){return values.map(x=>'<option value="'+e(x)+'" '+(x===current?'selected':'')+'>'+e(x)+'</option>').join('');}
 const head=(title,sub,back='arena')=>'<div class="arena-top"><a class="arena-back" href="#'+back+'">&larr; Back to skills</a><h1>'+e(title)+'</h1><p>'+e(sub)+'</p></div>';
 const note=text=>'<div class="arena-note">'+e(text)+'</div>';
 function field(label,html){return '<label>'+e(label)+html+'</label>';}
 const button=(text,action,secondary=false)=>'<button type="button" class="'+(secondary?'secondary ':'')+'arena-action" data-action="'+action+'">'+e(text)+'</button>';
 const roomLink=id=>'arena/room/'+id;
 function leaderboard(s){return '<div class="arena-table-wrap"><table class="arena-table"><thead><tr><th>Rank</th><th>Player</th><th>Points</th><th>Accuracy</th><th>WPM</th></tr></thead><tbody>'+s.leaderboard.map((p,i)=>'<tr><td>'+ (i+1)+'</td><td>'+e(p.name)+(p.bot?' <span class="arena-tag">BOT</span>':'')+'</td><td>'+p.score+'</td><td>'+p.accuracy+'%</td><td>'+p.wpm+'</td></tr>').join('')+'</tbody></table></div>';}
 async function render(route){
  stop();if(!user())return head('Sign in to play','Your rooms, progress and results are saved to your account.','home')+'<a class="button" href="#login">Sign in</a>';
  if(route==='arena/admin')return adminPage();
  if(route.startsWith('arena/report/'))return report(route.split('/')[2]);
  if(route.startsWith('arena/room/')){catalog=await api('/arena/catalog');room=await api('/arena/rooms/'+route.split('/')[2]);offset=room.server_now-Date.now();return head(names[room.game],'Room '+room.code+' · '+room.mode)+roomShell();}
  catalog=await api('/arena/catalog');
  if(['arena/detective','arena/relay','arena/typing'].includes(route))return configuration(route.split('/')[1]);
  // Game-specific navigation v2
  return head('Your games & reports','Continue a room or review your results.','home?section=skills')+
   '<section class="arena-panel"><h2>Your games & reports</h2>'+(catalog.recent.length?'<div class="arena-recent">'+catalog.recent.map(r=>'<a href="#arena/'+(r.status==='finished'?'report':'room')+'/'+r.id+'"><span><strong>'+names[r.game]+'</strong><small>'+e(r.code)+' · '+e(r.mode)+'</small></span><span class="arena-tag">'+e(r.status)+'</span></a>').join('')+'</div>':'<p>Your first game starts here.</p>')+'</section>'+
   (catalog.admin?'<a class="button secondary" href="#arena/admin">Manage Detective PDFs</a>':'')+'<p id="arena-status" role="status"></p>';
 }
 function configuration(game){
  const detective=game==='detective',relay=game==='relay';
  return head(names[game],detective?'Only published administrator PDFs are available.':relay?'Each friend sets one question; everyone else solves it.':'Speed matters. Accuracy matters more.','home?section=skills')+
  (detective&&!catalog.materials.length?note('No PDF is published yet. An Arena administrator must upload a PDF, review its question bank and publish it.'): '')+
  '<section class="arena-panel"><form id="arena-create" data-game="'+game+'"><div class="arena-form-grid">'+
   field('Play mode','<select name="mode">'+(relay?'<option value="friends">Friends</option>':'<option value="solo">Solo practice</option><option value="bot">Race a bot</option><option value="friends">Friends</option>')+'</select>')+
   (detective?field('Study PDF','<select name="material_id" required><option value="">Select an admin PDF</option>'+catalog.materials.map(m=>'<option value="'+m.id+'">'+e(m.title)+' · '+e(m.category)+' · '+e(m.difficulty)+'</option>').join('')+'</select>'):'')+
   field('Seconds per round','<input name="seconds" type="number" min="15" max="1800" value="'+(relay?300:60)+'" required>')+
   (detective?field('Study seconds before play','<input name="study_seconds" type="number" min="10" max="1800" value="60" required>'):'')+
   (!relay?field('Rounds (friends Detective: one question each)','<input name="rounds" type="number" min="1" max="10" value="3" required>'):'')+
   (!relay?field('Bot difficulty','<select name="bot_level">'+options(['easy','medium','hard'],'medium')+'</select>'):'')+
   (game==='typing'?field('Typing mode','<select name="typing_mode">'+options(['english','bangla','code'],'english')+'</select>'):'')+
   (relay?field('Coding language','<select name="language">'+options(relayLanguages.filter(l=>l!=="Other"),"JavaScript")+'</select>'):'')+
   '</div>'+(game==='typing'?field('Custom passage (optional; shared equally with every player)','<textarea name="passage" maxlength="3000" rows="3" placeholder="Leave blank for a built-in passage"></textarea>'):'')+
   (relay?note(catalog.runner_configured?'Automatic sandbox grading is available. Select the matching runner language when setting your question.':'Runner is not configured. Code is saved but not executed; the round setter gives a 0–100 score with written feedback. Reports clearly label setter review.'):detective?note('Correct +10 · Wrong −3 · Hint-assisted correct +5. Bot tasks come from the published PDF bank; AI-generated banks are labelled.'):note('WPM = correct characters ÷ 5 ÷ elapsed minutes. Final-text accuracy contributes to points. Paste and drop are disabled.'))+
   
  '<div class="arena-actions"><button>Create room</button></div><p id="arena-status" role="status"></p></form></section>' +
  '<section class="arena-panel"><h2>Join friends ? '+names[game]+'</h2><form id="arena-join" class="arena-inline">'+field('Room code','<input name="code" maxlength="8" minlength="8" placeholder="8-character code" required autocomplete="off">')+'<button>Join room</button></form></section>' +
  '<section class="arena-panel"><h2>Your '+names[game]+' games & reports</h2>'+catalog.recent.filter(r=>r.game===game).map(r=>'<p><a href="#arena/'+(r.status==='finished'?'report':'room')+'/'+r.id+'">'+e(r.code)+' ? '+e(r.status)+'</a></p>').join('')+'</section>';

 }
 function roomShell(){return '<div class="arena-room-header"><span class="arena-room-code">Room <strong>'+e(room.code)+'</strong></span><span id="arena-timer" class="arena-timer"></span><a href="#arena">Save & leave</a>'+(room.host_id===user().id?'<button type="button" id="arena-delete-room" class="secondary small">Delete room</button>':'')+'</div><p id="arena-status" role="status"></p><div class="arena-room-grid"><section id="arena-stage" class="arena-panel"></section><aside><section class="arena-panel"><h3>Players</h3><div id="arena-players"></div></section><section class="arena-panel"><h3>Room chat</h3><div id="arena-chat" class="arena-chat" aria-live="polite"></div><form id="arena-chat-form" class="arena-chat-form"><label class="arena-sr">Message<input name="body" maxlength="500" placeholder="Message your room" required autocomplete="off"></label><button class="small">Send</button></form></section></aside></div><section class="arena-panel"><h3>Leaderboard</h3><div id="arena-leaderboard"></div></section>';}
 function taskForm(s){
  const existing=s.tasks.find(q=>q.author_id===user().id);
  if(s.game==='detective')return '<details class="arena-task-editor" '+(!existing?'open':'')+'><summary>'+ (existing?'Edit your question':'Set your mistake-finding question')+'</summary><form id="arena-task">'+
   field('Flawed example and question','<textarea name="prompt" rows="4" minlength="10" maxlength="5000" required>'+e(existing?.prompt||'')+'</textarea>')+
   [0,1,2,3].map(i=>field('Option '+(i+1),'<input name="choice'+i+'" maxlength="600" required value="'+e(existing?.choices?.[i]||'')+'">')).join('')+
   field('Correct option','<select name="answer">'+[0,1,2,3].map(i=>'<option value="'+i+'" '+(existing?.answer===i?'selected':'')+'>'+(i+1)+'</option>').join('')+'</select>')+
   field('Hint','<input name="hint" minlength="3" maxlength="500" required value="'+e(existing?.hint||'')+'">')+
   field('Explanation','<textarea name="explanation" minlength="5" maxlength="2000" required>'+e(existing?.explanation||'')+'</textarea>')+
   field('PDF page reference','<input name="page" type="number" min="1" max="5000" value="'+(existing?.page||1)+'" required>')+'<button>Save question</button></form></details>';
  return '<details class="arena-task-editor" '+(!existing?'open':'')+'><summary>'+(existing?'Edit your problem':'Set your coding problem')+'</summary><form id="arena-task">'+

   (s.settings.relay_all_solve?
    field('Choose an easy English question',
     '<select id="relay-easy-choice" required>'+
     '<option value="">Select a question</option>'+
     RELAY_EASY.map((q,i)=>
      '<option value="'+i+'" '+
      (existing?.prompt===q.prompt?'selected':'')+'>'+
      e(q.title)+'</option>'
     ).join('')+'</select>'
    ):'')+
   field('Problem and input/output format','<textarea name="prompt" rows="4" minlength="15" maxlength="5000" required>'+e(existing?.prompt||'')+'</textarea>')+
   field('Language','<input name="language" value="'+e(s.settings.language)+'" readonly>')+
   field('Runner language (required for automatic rooms)','<select name="language_id"><option value="">Setter review — no code execution</option>'+(catalog?.languages||[]).map(l=>'<option value="'+l.id+'" '+(existing?.language_id===l.id?'selected':'')+'>'+e(l.name)+'</option>').join('')+'</select>')+
   field('Test cases JSON: [{"input":"2 3","output":"5"}]','<textarea name="tests" rows="5" required>'+e(JSON.stringify(existing?.tests||[{input:'2 3',output:'5'}],null,2))+'</textarea>')+
   field('Reference solution (private to you)','<textarea name="reference_solution" rows="6" maxlength="12000" required>'+e(existing?.reference_solution||'')+'</textarea>')+
   '<button>Save coding problem</button></form></details>';
 }
 function drawStage(){
  const s=room,stage=$('#arena-stage');if(!s||!stage)return;
  const key=JSON.stringify([s.status,s.round,s.host_id,s.tasks.map(t=>t.author_id),s.history.length,s.members.map(m=>[m.id,m.ready,m.language_choice]),s.settings.language]);
  // Never replace a form just because a room poll or chat message arrived.
  if(key===screenKey){drawReview();return;}screenKey=key;lastProgress='';
  if(s.status==='finished'){stage.innerHTML='<h2>Game complete</h2><p>Your report has been saved.</p><a class="button" href="#arena/report/'+s.id+'">View performance report</a>';return;}
  const host=s.host_id===user().id,me=s.members.find(m=>m.id===user().id),q=s.tasks[s.round];
  if(s.status==='lobby'){
   stage.innerHTML='<span class="arena-kicker">LOBBY</span><h2>Bring your friends. Get ready.</h2><p>Share room code <strong>'+e(s.code)+'</strong>. Rejoin later with the same code.</p>'+
    (s.material?'<a class="button secondary small" href="/api/arena/materials/'+s.material.id+'/pdf" target="_blank" rel="noopener">Open study PDF</a>':'')+

    (s.game==='relay'?
     '<section><h3>Agree on a language</h3>'+
     '<form id="arena-language">'+
     field('Your language',
      '<select name="language">'+
      options(
       relayLanguages,
       relayLanguages.includes(me.language_choice||s.settings.language)
        ?(me.language_choice||s.settings.language):'Other'
      )+'</select>'
     )+
     field('Other language (only when Other selected)',
      '<input name="custom_language" maxlength="80" value="'+
      e(!relayLanguages.includes(me.language_choice||s.settings.language)
       ?(me.language_choice||s.settings.language):'')+'">'
     )+
     '<button>Confirm language</button></form><ul>'+
     s.members.map(m=>'<li>'+e(m.name)+': '+
      e(m.language_choice||'Not confirmed')+'</li>').join('')+
     '</ul><p>Everyone must confirm the same language. '+
     'One question and one round per player. '+
     'Changing the agreed language clears old questions.</p></section>'
    :'')+
    (s.mode==='friends'&&s.game!=='typing'&&(
     s.game!=='relay'||(
      s.members.length>=2&&
      s.members.every(m=>m.language_choice===s.settings.language)
     )
    )?taskForm(s):'')+
    '<div class="arena-actions">'+button(me.ready?'Not ready':'I am ready','ready',me.ready)+(host?button('Start game','start'):'<span>Waiting for the host to start.</span>')+'</div>'+
    note(s.game==='relay'?'Every player sets one question and a reference solution. Everyone solves and earns points in every round.':s.mode==='bot'?'The practice bot is simulated. It is not another student.':'Read the rules and mark yourself ready.')+
    '<p class="arena-muted">If the host disconnects, another player can take over after 90 seconds.</p>'+button('Take over disconnected host','claim-host',true);
   wireStage();return;
  }
  if(s.status==='study'){
   stage.innerHTML='<span class="arena-kicker">STUDY TIME</span><h2>'+e(s.material.title)+'</h2><p>Read the selected PDF. The first question opens when study time ends.</p><a class="button" target="_blank" rel="noopener" href="/api/arena/materials/'+s.material.id+'/pdf">Read PDF</a>'+note('This PDF was uploaded by an administrator. Students cannot upload or replace study PDFs.');return;
  }
  if(s.status==='round_result'){
   const h=s.history.at(-1);
   stage.innerHTML='<span class="arena-kicker">ROUND '+(s.round+1)+' RESULT</span><h2>'+(h.voided?'Round voided':'Review & learn')+'</h2>'+
    (q.prompt?'<pre class="arena-prompt">'+e(q.prompt)+'</pre>':'')+
    (s.game==='detective'?'<p><strong>Correct answer:</strong> '+e(q.choices[q.answer])+'</p><p>'+e(q.explanation)+'</p><small>PDF page '+q.page+'</small>':'')+
    '<div class="arena-round-results">'+h.answers.map(a=>'<article><strong>'+e(s.members.find(m=>m.id===a.user_id)?.name||'Player')+'</strong><p>'+a.score+' points'+(a.timeout?' · Time expired':'')+(a.hint?' · Hint used':'')+(a.accuracy!==undefined?' · '+a.accuracy+'% accuracy':'')+(a.grading?' · '+e(a.grading):'')+'</p>'+(a.feedback?'<p>'+e(a.feedback)+'</p>':'')+(s.game==='relay'&&a.body?'<details><summary>Submitted code</summary><pre>'+e(a.body)+'</pre></details>':'')+'</article>').join('')+'</div>'+
    (host?button(s.round+1>=s.tasks.length?'Finish & create report':'Next round','next'):'<p>Waiting for the host to continue.</p>')+
    button('Report this question','dispute',true)+(host?button('Void unfair / invalid round','void',true):'');wireStage();return;
  }
  const mine=s.answers.find(a=>a.round===s.round&&a.user_id===user().id);
  stage.innerHTML='<span class="arena-kicker">ROUND '+(s.round+1)+' / '+s.tasks.length+'</span><h2>'+ (s.game==='typing'?'Type accurately. Find your rhythm.':s.game==='relay'&&s.settings.relay_all_solve?'Everyone solves this round.':q.author_id===user().id?'Your question is live.':'Solve the challenge.')+'</h2>'+
   (s.game==='detective'?'<pre class="arena-prompt">'+e(q.prompt)+'</pre><p class="arena-muted">Study reference: PDF page '+q.page+'</p>':s.game==='relay'?'<pre class="arena-prompt">'+e(q.prompt)+'</pre><span class="arena-tag">'+e(q.language)+'</span>':'<div id="arena-passage" class="arena-passage"></div><div id="arena-typing-stats" class="arena-live-stats">0 WPM · 100% accuracy</div>')+
   (q.author_id===user().id&&!(s.game==='relay'&&s.settings.relay_all_solve)?'<p>You are the setter this round. You cannot submit an answer or earn points.</p><div id="arena-code-review"></div>':
    s.game==='detective'?'<form id="arena-answer"><div class="arena-options">'+q.choices.map((c,i)=>'<label><input type="radio" name="choice" value="'+i+'" required><span>'+e(c)+'</span></label>').join('')+'</div><div class="arena-actions"><button>Submit final answer</button>'+button('Use hint (+5 instead of +10)','hint',true)+'</div><p id="arena-hint"></p></form>':
    '<form id="arena-answer">'+field(s.game==='typing'?'Type the passage below':'Your code','<textarea id="arena-input" name="'+(s.game==='typing'?'text':'source')+'" rows="'+(s.game==='typing'?6:12)+'" maxlength="'+(s.game==='typing'?6000:12000)+'" spellcheck="false" autocomplete="off" autocorrect="off" autocapitalize="off" required></textarea>')+'<button>Submit final '+(s.game==='typing'?'text':'code')+'</button></form>')+
   '<p id="arena-answer-state" role="status"></p>'+button('Report this question','dispute',true)+(host?button('Void unfair / invalid round','void',true):'');
  if(s.game==='typing')drawTyping();
  if(mine){const f=$('#arena-answer');if(f)f.hidden=true;$('#arena-answer-state').textContent=mine.pending?'Code submitted — waiting for setter review.':'Final answer submitted. Waiting for the other players.';}
  wireStage();drawReview();
 }
 function drawReview(){
  const el=$('#arena-code-review');if(!el||!room)return;
  const pending=room.answers.filter(a=>a.round===room.round&&a.pending);
  const signature=pending.map(a=>a.user_id).join(',');if(el.dataset.signature===signature)return;el.dataset.signature=signature;
  el.innerHTML=pending.map(a=>'<form class="arena-grade" data-user="'+a.user_id+'"><h3>'+e(room.members.find(m=>m.id===a.user_id)?.name)+'</h3><pre>'+e(a.body||'')+'</pre>'+field('Score (0–100)','<input name="score" type="number" min="0" max="100" required>')+field('Feedback and reason','<textarea name="feedback" minlength="5" maxlength="1000" required></textarea>')+'<button>Record score</button></form>').join('');
  el.querySelectorAll('form').forEach(f=>f.addEventListener('submit',async ev=>{ev.preventDefault();await action('grade',{user_id:Number(f.dataset.user),score:Number(f.elements.score.value),feedback:f.elements.feedback.value});}));
 }
 function drawTyping(){
  const input=$('#arena-input'),target=room?.tasks[room.round]?.passage;if(!target)return;
  const chars=Array.from(target.normalize('NFC')),typed=Array.from((input?.value||'').normalize('NFC'));
  const passage=$('#arena-passage');if(passage)passage.innerHTML=chars.map((c,i)=>'<span class="'+(i<typed.length?(c===typed[i]?'is-correct':'is-wrong'):i===typed.length?'is-cursor':'')+'">'+e(c)+'</span>').join('');
  const elapsed=Math.max(1,(Date.now()+offset-room.round_starts_at)/1000);
  const correct=typed.filter((c,i)=>c===chars[i]).length;
  const stats=$('#arena-typing-stats');if(stats)stats.textContent=Math.round(correct/5/(elapsed/60))+' WPM · '+(typed.length?Math.round(correct/typed.length*100):100)+'% accuracy';
 }
 function paint(){
  if(!room)return;
  drawStage();
  $('#arena-players').innerHTML=room.members.map(m=>{
   const p=room.progress[m.id];const answered=room.answers.some(a=>a.round===room.round&&a.user_id===m.id);
   return '<div class="arena-player"><strong>'+e(m.name)+(m.id===room.host_id?' · Host':'')+'</strong><small>'+(m.bot?'Practice bot':room.status==='lobby'?(m.ready?'Ready':'Not ready'):answered?'Submitted':Date.now()+offset-m.last_seen>15000?'Reconnecting…':'Connected')+'</small>'+(p?'<progress max="100" value="'+(p.percent||0)+'"></progress>':'')+'</div>';
  }).join('');
  const chat=$('#arena-chat');const signature=room.chat.map(x=>x.id).join(',');if(chat.dataset.signature!==signature){chat.dataset.signature=signature;chat.innerHTML=room.chat.map(m=>'<p><strong>'+e(m.name)+'</strong><span>'+e(m.body)+'</span></p>').join('')||'<p class="arena-muted">Keep it friendly. Share ideas, not answers.</p>';chat.scrollTop=chat.scrollHeight;}
  $('#arena-leaderboard').innerHTML=leaderboard(room);
  const mine=room.answers.find(a=>a.round===room.round&&a.user_id===user().id);
  if(room.status==='playing'&&mine){const f=$('#arena-answer');if(f)f.hidden=true;const message=$('#arena-answer-state');if(message)message.textContent=mine.pending?'Code submitted — waiting for setter review.':'Final answer submitted. Waiting for other players.';}
  timerTick();
 }
 function timerTick(){
  if(!room)return;
  const now=Date.now()+offset;const display=$('#arena-timer');
  const target=room.status==='study'?room.study_ends_at:now<room.round_starts_at?room.round_starts_at:room.deadline;
  if(display)display.textContent=['study','playing'].includes(room.status)?(room.awaiting_review?'Awaiting code review':(room.status==='study'?'Study ':now<room.round_starts_at?'Starting in ':'')+Math.max(0,Math.ceil((target-now)/1000))+'s'):room.status.replaceAll('_',' ');
  const answer=$('#arena-answer');if(answer)for(const el of answer.elements)el.disabled=now<room.round_starts_at||now>=room.deadline;
 }
 async function action(name,body={}){
  if(sending)return;sending=true;status('');
  if(['answer','hint','grade','progress','dispute','void','next'].includes(name))body={...body,round:room.round};
  try{const result=await api('/arena/rooms/'+room.id+'/'+name,'POST',body);room=result.room||result;offset=room.server_now-Date.now();paint();if(result.hint&&$('#arena-hint'))$('#arena-hint').textContent=result.hint;}
  catch(error){status(error.message);}finally{sending=false;}
 }

 function wireStage(){
  const easySelect=$('#relay-easy-choice');
  if(easySelect){
   const f=$('#arena-task');
   f.elements.prompt.readOnly=true;
   f.elements.tests.readOnly=true;
   const updateEasy=()=>{
    const q=RELAY_EASY[Number(easySelect.value)];
    if(easySelect.value===''||!q){
     f.elements.prompt.value='';
     f.elements.tests.value='';
     return;
    }
    f.elements.prompt.value=q.prompt;
    f.elements.tests.value=JSON.stringify(
     q.tests.map(t=>({input:t.input})),null,2
    );
   };
   easySelect.addEventListener('change',updateEasy);
   updateEasy();
  }

  $('#arena-language')?.addEventListener('submit',async ev=>{
   ev.preventDefault();
   const f=ev.currentTarget;
   const language=f.elements.language.value==='Other'
    ?f.elements.custom_language.value.trim()
    :f.elements.language.value;

   if(!language){
    status('Enter a language name.');
    return;
   }
   await action('language',{language});
  });

  $('#arena-stage')?.querySelectorAll('[data-action]').forEach(b=>b.addEventListener('click',async()=>{
   const name=b.dataset.action;let data={};
   if(name==='ready')data={ready:!room.members.find(m=>m.id===user().id).ready};
   if(name==='dispute'||name==='void'){const reason=window.prompt(name==='void'?'Why should this round be voided?':'Describe the problem with this question:');if(!reason)return;data={reason};}
   await action(name,data);
  }));
  $('#arena-task')?.addEventListener('submit',async ev=>{
   ev.preventDefault();const f=ev.currentTarget;const b=Object.fromEntries(new FormData(f));
   try{if(room.game==='detective'){b.choices=[0,1,2,3].map(i=>b['choice'+i]);b.answer=Number(b.answer);b.page=Number(b.page);}else{b.tests=JSON.parse(b.tests);b.language_id=b.language_id?Number(b.language_id):null;}await action('task',b);}
   catch(error){status(error.message);}
  });
  $('#arena-answer')?.addEventListener('submit',async ev=>{ev.preventDefault();const b=Object.fromEntries(new FormData(ev.currentTarget));if(b.choice!==undefined)b.choice=Number(b.choice);await action('answer',b);});
  const input=$('#arena-input');if(input&&room.game==='typing'){
   input.addEventListener('paste',ev=>{ev.preventDefault();status('Paste is disabled in a typing race.');});input.addEventListener('drop',ev=>ev.preventDefault());input.addEventListener('input',()=>{
    drawTyping();
    const target=room?.tasks[room.round]?.passage;
    if(target&&input.value.normalize('NFC')===target.normalize('NFC')&&!input.disabled&&!sending){
      void action('answer',{text:input.value});
    }
   });
  }
 }
 async function poll(){
  if(!room||!activeRoute().startsWith('arena/room/')||document.hidden||sending)return;
  try{const id=room.id;const result=await api('/arena/rooms/'+id);if(!room||room.id!==id)return;room=result;offset=room.server_now-Date.now();paint();}catch(error){status(error.message);}
 }
 async function syncProgress(){
  const input=$('#arena-input');if(!room||room.game!=='typing'||room.status!=='playing'||!input||input.disabled||document.hidden||sending)return;
  if(lastProgress===input.value)return;const value=input.value;
  try{const id=room.id;await api('/arena/rooms/'+id+'/progress','POST',{text:value,round:room.round});if(room?.id===id)lastProgress=value;}catch(error){status(error.message);}
 }
 function wire(){
  $('#arena-delete-room')?.addEventListener('click',async ev=>{
   if(!room || room.host_id!==user().id) return;
   if(!window.confirm('Delete this room permanently? Its report and certificate will also be removed.')) return;

   const btn=ev.currentTarget;
   const game=room.game;
   btn.disabled=true;

   try {
    await api('/arena/rooms/'+room.id,'DELETE');
    stop();
    navigate('arena/'+game);
    notice('Room deleted.');
   } catch(error) {
    status(error.message);
    btn.disabled=false;
   }
  });

  $('#arena-join')?.addEventListener('submit',async ev=>{ev.preventDefault();try{const r=await api('/arena/join','POST',{code:ev.currentTarget.elements.code.value.trim()});navigate(roomLink(r.id));}catch(error){status(error.message);}});
  $('#arena-create')?.addEventListener('submit',async ev=>{ev.preventDefault();const f=ev.currentTarget,b=Object.fromEntries(new FormData(f));const btn=f.querySelector('button');btn.disabled=true;try{const r=await api('/arena/rooms','POST',{game:f.dataset.game,mode:b.mode,material_id:b.material_id?Number(b.material_id):undefined,settings:{seconds:Number(b.seconds),rounds:Number(b.rounds||3),study_seconds:Number(b.study_seconds||60),bot_level:b.bot_level||'medium',typing_mode:b.typing_mode||'english',language:b.language||'JavaScript',passage:b.passage||undefined}});navigate(roomLink(r.id));}catch(error){status(error.message);}finally{btn.disabled=false;}});
  if(room){paint();polling=setInterval(poll,2500);clock=setInterval(timerTick,250);progressTimer=setInterval(syncProgress,1400);$('#arena-chat-form')?.addEventListener('submit',async ev=>{ev.preventDefault();const input=ev.currentTarget.elements.body;if(!input.value.trim())return;await action('chat',{body:input.value});input.value='';});}
  wireAdmin();
 }
 async function report(id){
  const s=await api('/arena/reports/'+id);const own=s.leaderboard.find(p=>p.id===user().id);
  return head('Your game report',names[s.game]+' · Room '+s.code)+
   '<section class="arena-panel"><div class="arena-report-summary"><div><small>Your points</small><strong>'+own.score+'</strong></div><div><small>Accuracy</small><strong>'+own.accuracy+'%</strong></div><div><small>Average WPM</small><strong>'+own.wpm+'</strong></div><div><small>Hints used</small><strong>'+own.hints+'</strong></div></div>'+leaderboard(s)+
   '<div class="arena-actions"><a class="button" href="/api/arena/reports/'+s.id+'/pdf">Download PDF report</a>'+
   (s.certificate_id&&s.winner===user().id?'<a class="button secondary" href="/api/arena/certificates/'+s.certificate_id+'/pdf">Download Winner Certificate</a>':'')+'<a href="#arena/'+s.game+'">Play again</a></div>'+
   note(s.mode==='solo'?'Solo practice saves your personal results. Winner certificates are for competition winners.':s.tie?'Exact tie. Play a rematch to decide the winner; no winner certificate was issued.':s.winner==='bot'?'The practice bot won this game. Try again!':s.certificate_id?'Only the first-place human winner receives a game achievement certificate.':'No winner certificate: a positive score is required.')+'</section>'+
   '<section class="arena-panel"><h2>Round review</h2>'+s.history.map(h=>'<details class="arena-round-review"><summary>Round '+h.round+(h.voided?' · Voided':'')+'</summary><pre>'+e(h.task.prompt||h.task.passage)+'</pre>'+(h.task.explanation?'<p>'+e(h.task.explanation)+'</p><small>PDF page '+h.task.page+'</small>':'')+h.answers.map(a=>'<p><strong>'+e(s.members.find(m=>m.id===a.user_id)?.name)+'</strong> — '+a.score+' points'+(a.grading?' · '+e(a.grading):'')+(a.feedback?' · '+e(a.feedback):'')+'</p>').join('')+'</details>').join('')+'</section>';
 }
 async function adminPage(){
  catalog=await api('/arena/catalog');if(!catalog.admin)throw Error('Arena administrator permission required.');
  const data=await api('/arena/admin/materials');
  const sample={prompt:'Find the error in this example from the PDF.',choices:['Option A','Option B','Option C','Option D'],answer:0,hint:'Review the relevant rule.',explanation:'Explain why the correct option fixes the error.',page:1};
  return head('Detective PDF Library','Only an Arena administrator can upload PDFs. Questions and AI drafts require administrator review.')+
   '<section class="arena-panel"><h2>Start with the sample library</h2><p>Install three original study PDFs and reviewed practice question banks. Only an administrator can do this.</p><button type="button" id="arena-install-samples">Install sample PDFs</button></section>'+
   '<section class="arena-panel"><h2>Upload a study PDF</h2><form id="arena-pdf-upload">'+field('Title','<input name="title" minlength="3" maxlength="160" required>')+field('Category','<select name="category">'+options(['coding','design','english'],'coding')+'</select>')+field('Difficulty','<select name="difficulty">'+options(['Beginner','Intermediate','Advanced'],'Beginner')+'</select>')+field('PDF (maximum 5 MB)','<input name="document" type="file" accept="application/pdf" required>')+'<button>Upload PDF</button></form></section>'+
   note(catalog.ai_configured?'AI is connected. Generate a PDF-based draft, then review the answers and page references before publishing.':'AI is not configured. You can upload PDFs and write the question bank manually. Configure OPENAI_API_KEY on the server for real AI-generated PDF tasks.')+
   data.items.map(m=>'<section class="arena-panel"><h2>'+e(m.title)+'</h2><p>'+e(m.question_source)+' question bank · '+(m.published?'Published':'Draft')+'</p><a target="_blank" rel="noopener" href="/api/arena/materials/'+m.id+'/pdf">Open PDF</a><form class="arena-material-edit" data-id="'+m.id+'">'+field('Title','<input name="title" value="'+e(m.title)+'" required>')+field('Category','<select name="category">'+options(['coding','design','english'],m.category)+'</select>')+field('Difficulty','<select name="difficulty">'+options(['Beginner','Intermediate','Advanced'],m.difficulty)+'</select>')+field('Question bank JSON (answer: 0–3; actual PDF page required)','<textarea name="questions" rows="14" spellcheck="false" required>'+e(JSON.stringify(m.questions.length?m.questions:[sample],null,2))+'</textarea>')+'<label class="arena-checkbox"><input type="checkbox" name="published" '+(m.published?'checked':'')+'> Publish after reviewing every question and page reference</label><div class="arena-actions"><button>Save PDF & question bank</button><button type="button" class="secondary arena-ai-generate" data-id="'+m.id+'" '+(!catalog.ai_configured?'disabled':'')+'>Generate AI draft from PDF</button></div></form></section>').join('')+'<p id="arena-status" role="status"></p>';
 }
 function wireAdmin(){
  $('#arena-install-samples')?.addEventListener('click',async ev=>{const b=ev.currentTarget;b.disabled=true;try{const r=await api('/arena/admin/samples','POST',{});notice(r.message);window.dispatchEvent(new HashChangeEvent('hashchange'));}catch(error){status(error.message);}finally{b.disabled=false;}});
  $('#arena-pdf-upload')?.addEventListener('submit',async ev=>{ev.preventDefault();const f=ev.currentTarget,btn=f.querySelector('button');btn.disabled=true;try{await api('/arena/admin/materials','POST',new FormData(f));notice('PDF uploaded as draft.');window.dispatchEvent(new HashChangeEvent('hashchange'));}catch(error){status(error.message);}finally{btn.disabled=false;}});
  document.querySelectorAll('.arena-material-edit').forEach(f=>f.addEventListener('submit',async ev=>{ev.preventDefault();const btn=f.querySelector('button');btn.disabled=true;try{const b=Object.fromEntries(new FormData(f));b.questions=JSON.parse(b.questions);b.published=f.elements.published.checked;await api('/arena/admin/materials/'+f.dataset.id,'PUT',b);notice('PDF question bank saved.');window.dispatchEvent(new HashChangeEvent('hashchange'));}catch(error){status(error.message);}finally{btn.disabled=false;}}));
  document.querySelectorAll('.arena-ai-generate').forEach(b=>b.addEventListener('click',async()=>{if(!window.confirm('Send this administrator PDF to the configured AI service to generate questions? The result will be saved as a draft.'))return;b.disabled=true;status('Reading the PDF and generating a draft. This may take a minute…');try{await api('/arena/admin/materials/'+b.dataset.id+'/generate','POST',{});notice('AI draft ready. Review it before publishing.');window.dispatchEvent(new HashChangeEvent('hashchange'));}catch(error){status(error.message);}finally{b.disabled=false;}}));
 }
 return {render,wire,stop};
}
