import PDFDocument from 'pdfkit';
import { fileURLToPath } from 'node:url';
import { GAME_NAMES,rankPlayers } from './arena-engine.js';
const font=fileURLToPath(new URL('./assets/DejaVuSans.ttf',import.meta.url));
const bengali=fileURLToPath(new URL('./assets/NotoSansBengali-Regular.ttf',import.meta.url));
function write(doc,text,size=11){doc.font(/[\u0980-\u09ff]/.test(String(text))?bengali:font).fontSize(size).text(String(text));}
function setup(res,filename,landscape=false){const doc=new PDFDocument({size:'A4',layout:landscape?'landscape':'portrait',margin:48});res.type('application/pdf').set('Content-Disposition','attachment; filename="'+filename+'"').set('Cache-Control','private, no-store');doc.pipe(res);return doc;}
export function sendArenaReport(res,s,viewer){
 const doc=setup(res,'Skill_Swap_'+s.game+'_Report.pdf');
 doc.fillColor('#245c49');write(doc,'Skill Swap | Performance Report',23);doc.moveDown(.7);
 doc.fillColor('#23352b');write(doc,GAME_NAMES[s.game]+' · '+s.mode,16);
 write(doc,'Room '+s.code+' | '+new Date(s.finished_at).toLocaleString('en-GB',{timeZone:'Asia/Dhaka'})+' (Asia/Dhaka)',9);
 doc.moveDown();write(doc,'FINAL LEADERBOARD',12);
 rankPlayers(s).forEach((p,i)=>{write(doc,(i+1)+'. '+p.name+(p.bot?' [Bot]':'')+' | Points '+p.score+' | Accuracy '+p.accuracy+'% | WPM '+p.wpm+' | Time '+p.seconds+'s',10);});
 doc.moveDown();write(doc,'Scoring',13);
 write(doc,s.game==='detective'?'Correct +10; wrong -3; hint-assisted correct +5. Missing answers receive 0.':s.game==='typing'?'WPM = correct characters / 5 / elapsed minutes. Points = correct characters × accuracy ratio, plus a small completion time bonus. Final-text accuracy does not count corrected keystrokes.':'Automatic scores are the percentage of tests passed. If no runner is configured, the question setter grades 0–100 and records feedback. Setter-reviewed scores are not independent assessments.',10);
 write(doc,'Tie-break: points, then accuracy, then lowest total answer time. An exact tie needs a rematch and receives no winner certificate.',9);
 for(const h of s.history){
  if(doc.y>650)doc.addPage();doc.moveDown();doc.fillColor('#245c49');write(doc,'ROUND '+h.round+(h.voided?' — VOIDED':''),14);doc.fillColor('#23352b');
  write(doc,h.task.prompt||h.task.passage,10);
  if(h.task.page)write(doc,'PDF reference: page '+h.task.page,9);
  if(h.task.explanation)write(doc,'Explanation: '+h.task.explanation,10);
  for(const a of h.answers){const name=s.members.find(m=>m.id===a.user_id)?.name||'Player';write(doc,name+': '+a.score+' points | '+(a.accuracy||0)+'% accuracy'+(a.hint?' | hint used':'')+(a.timeout?' | timed out':'')+(a.grading?' | '+a.grading:''),9);if(a.feedback)write(doc,'Feedback: '+a.feedback,9);}
 }
 const own=rankPlayers(s).find(p=>p.id===viewer);doc.moveDown();write(doc,'Next practice step',13);
 write(doc,s.game==='typing'?(own?.accuracy<95?'Slow down and practise accuracy before speed.':'Try a longer passage or a harder bot next.'):'Review the explanations for missed questions, then practise the same topic again.',10);
 write(doc,'Skill Swap practice activity. This report is not an accredited qualification.',8);doc.end();
}
export function sendWinnerCertificate(res,c){
 const doc=setup(res,'Skill_Swap_Winner_Certificate.pdf',true);const w=doc.page.width,h=doc.page.height;
 doc.rect(18,18,w-36,h-36).fill('#f7f8f3');doc.lineWidth(2).rect(30,30,w-60,h-60).stroke('#245c49');doc.lineWidth(.6).rect(38,38,w-76,h-76).stroke('#b89b65');
 doc.fillColor('#245c49').font(font).fontSize(22).text('Skill Swap',48,62,{align:'center'});
 doc.fontSize(32).text('WINNER CERTIFICATE',48,116,{align:'center'});
 doc.fillColor('#68746c').fontSize(12).text('Awarded for first place in',48,179,{align:'center'});
 doc.fillColor('#245c49').fontSize(22).text(GAME_NAMES[c.game],48,207,{align:'center'});
 doc.font(/[\u0980-\u09ff]/.test(c.winner_name)?bengali:font).fontSize(30).fillColor('#23352b').text(c.winner_name,58,270,{align:'center',width:w-116});
 doc.font(font).fontSize(13).text('Final score: '+c.score+' points',48,335,{align:'center'});
 doc.fontSize(10).fillColor('#68746c').text('Issued '+new Date(c.issued_at).toLocaleDateString('en-GB',{timeZone:'Asia/Dhaka'}),48,388,{align:'center'});
 doc.fontSize(9).text('Certificate ID: '+c.id,48,418,{align:'center'});
 doc.fontSize(9).text('Skill Swap game achievement · Not an accredited academic or professional qualification',48,h-91,{align:'center'});doc.end();
}
