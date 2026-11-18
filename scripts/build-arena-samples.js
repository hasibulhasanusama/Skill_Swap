import PDFDocument from 'pdfkit';
import {createWriteStream} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {SAMPLE_LIBRARY} from '../server/arena-samples.js';
for(const m of SAMPLE_LIBRARY){
 const doc=new PDFDocument({size:'A4',margin:48});
 const stream=createWriteStream(fileURLToPath(new URL('../server/assets/'+m.category+'-study.pdf',import.meta.url)));
 doc.pipe(stream);doc.font(fileURLToPath(new URL('../server/assets/DejaVuSans.ttf',import.meta.url)));
 doc.fillColor('#245c49').fontSize(23).text('Skill Swap | Study Notes');doc.moveDown();doc.fontSize(16).text(m.title);doc.moveDown();
 doc.fillColor('#23352b').fontSize(11).text('Study these principles before playing Skill Detective. All sample questions refer to this page.');doc.moveDown();
 m.notes.forEach((n,i)=>{doc.fontSize(11).text((i+1)+'. '+n,{lineGap:5});doc.moveDown();});
 doc.fontSize(8).fillColor('#68746c').text('Original Skill Swap practice material. Page 1. This is a learning aid, not a qualification.');doc.end();
 await new Promise((resolve,reject)=>{stream.on('finish',resolve);stream.on('error',reject);});
}
console.log('Three study PDFs built.');
