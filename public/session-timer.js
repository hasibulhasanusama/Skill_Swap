
export function wireSessionTimers({api,notice,reload}){
 for(const box of document.querySelectorAll('[data-class-clock]')){
  if(box.dataset.wired)continue;
  box.dataset.wired='1';
  let state=null,busy=false,offset=0;
  const base='/learning-sessions/'+box.dataset.kind+'/'+box.dataset.session+'/clock';
  const panel=box.closest('.session-panel');
  const role=box.dataset.teacher==='true'?'teacher':'learner';

  function draw(){
   if(!state)return;
   const t=state.clock;
   let text='Both participants must join and confirm Start session.';

   if(t?.started_at){
    const left=Math.max(0,Math.ceil(
     (Date.parse(t.ends_at)-(Date.now()+offset))/1000
    ));
    const pad=n=>String(n).padStart(2,'0');
    text=left
     ?'Remaining '+pad(Math.floor(left/3600))+':'+
      pad(Math.floor(left%3600/60))+':'+pad(left%60)
     :'Session time completed. Delivery still needs confirmation.';
    if(!left)box.querySelector('[data-clock-refresh]').hidden=false;
   }else if(t){
    text='Teacher: '+(t.teacher_ready_at?'Start confirmed':'Waiting')+
     ' | Learner: '+(t.learner_ready_at?'Start confirmed':'Waiting');
   }

   box.querySelector('[data-clock-status]').textContent=text;
   box.querySelector('[data-clock-action="join"]').disabled=
    busy||!state.can_join;
   box.querySelector('[data-clock-action="start"]').disabled=
    busy||!state.can_start||!t?.[role+'_joined_at']||!!t?.[role+'_ready_at'];
   box.querySelector('[data-clock-action="problem"]').disabled=
    busy||!state.can_problem;

   if(box.dataset.teacher==='true'){
    for(const b of panel?.querySelectorAll(
     '.booking-completion,.exchange-completion'
    )||[]){
     b.disabled=!t?.started_at||Date.parse(t.ends_at)>Date.now()+offset;
    }
   }
  }

  async function poll(){
   if(!box.isConnected||busy)return;
   try{
    state=await api(base);
    offset=state.server_now-Date.now();
    draw();
   }catch(e){
    box.querySelector('[data-clock-status]').textContent=e.message;
   }
  }

  box.querySelector('[data-clock-refresh]').addEventListener('click',reload);

  for(const b of box.querySelectorAll('[data-clock-action]')){
   b.addEventListener('click',async()=>{
    if(busy)return;
    const action=b.dataset.clockAction;
    let body={};
    if(action==='problem'){
     const reason=window.prompt('What went wrong with this class?');
     if(!reason)return;
     body={reason};
    }
    const tab=action==='join'?window.open('about:blank','_blank'):null;
    if(tab)tab.opener=null;
    busy=true;
    draw();
    try{
     state=await api(base+'/'+action,'POST',body);
     offset=state.server_now-Date.now();
     if(action==='join'){
      if(tab)tab.location.href=state.meeting_url;
      else notice('Allow popups and click Join class again.');
     }else notice(state.message);
    }catch(e){
     if(tab)tab.close();
     notice(e.message);
    }finally{
     busy=false;
     draw();
    }
   });
  }

  const timer=setInterval(()=>{
   if(!box.isConnected){clearInterval(timer);return;}
   draw();
   if(!box.dataset.lastPoll||
      Date.now()-Number(box.dataset.lastPoll)>=5000){
    box.dataset.lastPoll=String(Date.now());
    void poll();
   }
  },1000);
  void poll();
 }
}
