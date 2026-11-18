import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createArenaUI} from '../public/arena.js';
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pause=()=>new Promise(r=>setTimeout(r,20));
function setup(url='http://localhost/#arena'){
 const dom=new JSDOM('<main id="app"></main>',{url});
 for(const k of ['window','document','location','FormData','HashChangeEvent'])globalThis[k]=dom.window[k];
 return dom;
}
const catalog={materials:[{id:1,title:'Admin PDF',category:'coding',difficulty:'Beginner',question_count:3}],recent:[],admin:false,languages:[],passages:{},ai_configured:false,runner_configured:false};
test('Arena home and creation wire to server endpoints',async()=>{
 const dom=setup();const calls=[];
 const ui=createArenaUI({api:async(url,method,body)=>{calls.push({url,method,body});return url==='/arena/catalog'?catalog:{id:'room-123'};},e:escape,notice:()=>{},user:()=>({id:1,name:'Student'})});
 document.querySelector('#app').innerHTML=await ui.render('arena');ui.wire();assert.equal(document.querySelectorAll('.arena-game-card').length,3);
 document.querySelector('#app').innerHTML=await ui.render('arena/typing');ui.wire();
 const f=document.querySelector('#arena-create');f.querySelector('[name=mode]').value='bot';f.dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));await pause();
 assert.equal(calls.at(-1).url,'/arena/rooms');assert.equal(calls.at(-1).body.game,'typing');assert.equal(calls.at(-1).body.mode,'bot');assert.equal(location.hash,'#arena/room/room-123');ui.stop();dom.window.close();
});
test('Room polling preserves typing input; chat is escaped and paste is blocked',async()=>{
 const dom=setup('http://localhost/#arena/room/r1');
 const s={id:'r1',code:'ABCD1234',game:'typing',mode:'friends',status:'playing',server_now:Date.now(),host_id:1,round:0,round_starts_at:Date.now()-5000,deadline:Date.now()+60000,settings:{seconds:60},members:[{id:1,name:'Student',last_seen:Date.now()},{id:2,name:'Friend',last_seen:Date.now()}],tasks:[{passage:'hello world',author_id:null}],history:[],answers:[],progress:{},chat:[{id:'c',name:'<img src=x onerror=alert(1)>',body:'<script>bad()</script>'}],leaderboard:[{name:'Student',score:0,accuracy:0,wpm:0}]};
 const ui=createArenaUI({api:async url=>url==='/arena/catalog'?catalog:structuredClone(s),e:escape,notice:()=>{},user:()=>({id:1,name:'Student'})});
 document.querySelector('#app').innerHTML=await ui.render('arena/room/r1');ui.wire();const input=document.querySelector('#arena-input');input.value='hello';input.dispatchEvent(new window.Event('input'));
 assert.equal(document.querySelector('#arena-chat script'),null);assert.equal(document.querySelector('#arena-chat img'),null);assert.match(document.querySelector('#arena-typing-stats').textContent,/100% accuracy/);
 let prevented=false;input.addEventListener('paste',ev=>{prevented=ev.defaultPrevented});input.dispatchEvent(new window.Event('paste',{bubbles:true,cancelable:true}));assert.equal(prevented,true);
 await new Promise(r=>setTimeout(r,2700));assert.equal(document.querySelector('#arena-input'),input);assert.equal(input.value,'hello');ui.stop();dom.window.close();
});
test('Admin sample installer and PDF upload form show AI configuration honestly',async()=>{
 const dom=setup();let installed=false;
 const ui=createArenaUI({api:async(url)=>{if(url==='/arena/catalog')return {...catalog,admin:true};if(url==='/arena/admin/samples'){installed=true;return{message:'Installed'};}return{items:[]};},e:escape,notice:()=>{},user:()=>({id:9,name:'Admin'})});
 document.querySelector('#app').innerHTML=await ui.render('arena/admin');ui.wire();assert.ok(document.querySelector('#arena-pdf-upload'));assert.match(document.body.textContent,/AI is not configured/);document.querySelector('#arena-install-samples').click();await pause();assert.ok(installed);ui.stop();dom.window.close();
});
