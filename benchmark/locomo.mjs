import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {openEngine} from './adapters.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const sha=x=>createHash('sha256').update(x).digest('hex');
const datasetBytes=fs.readFileSync(path.join(root,'data/locomo10.json')),data=JSON.parse(datasetBytes);
const p=(xs,f)=>[...xs].sort((a,b)=>a-b)[Math.max(0,Math.ceil(xs.length*f)-1)];
const normalize=s=>s.replace(/\s+/g,' ').trim();
const [mode,engine]=process.argv.slice(2);
if(mode==='worker'){
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'omni-locomo-'));
 const api=openEngine(engine,tmp),all=[];let ingestion_ms=0,messageCount=0,closed=false;
 try{
  for(const sample of data){
   const conv=sample.sample_id,chat=sample.conversation,messages=[],byMid=new Map(),byDia=new Map();let i=0;
   const sessions=Object.keys(chat).filter(k=>/^session_\d+$/.test(k)).sort((a,b)=>Number(a.slice(8))-Number(b.slice(8)));
   for(const session of sessions)for(const turn of chat[session]){
    const mid='turn-'+String(++i).padStart(6,'0');
    const text=`[${chat[session+'_date_time']}] ${turn.speaker}: ${turn.text}`+(turn.blip_caption?`\nImage caption: ${turn.blip_caption}`:'');
    const m={conversation_id:conv,message_id:mid,role:turn.speaker===chat.speaker_a?'user':'assistant',text,captured_at:'2026-01-01T00:00:00Z',...(i>1?{previous_message_id:'turn-'+String(i-1).padStart(6,'0')}:{})};
    messages.push(m);byMid.set(mid,{dia_id:turn.dia_id,text});byDia.set(turn.dia_id,m);
   }
   let t=performance.now();for(let j=0;j<messages.length;j+=100)api.capture(messages.slice(j,j+100));ingestion_ms+=performance.now()-t;messageCount+=messages.length;
   // Only source conversations are ingested. Answers, evidence labels and generated summaries are never indexed.
   const questions=sample.qa.map((q,index)=>({...q,index})).filter(q=>q.category!==5);
   // One warm-up per conversation, not a warmed repetition of each measured question.
   if(questions.length)api.search(questions[0].question,conv);
   for(const q of questions){
    t=performance.now();const r=api.store?api.store.search(q.question,{top_k:20,conversation_id:conv}):api.search(q.question,conv,20);
    const elapsed_ms=performance.now()-t;
    // Shared 10,000-character context cap, comparable to Zep's published auto-search budget.
    const text=r.memories.map(m=>m.text).join('\n\n=====\n\n').slice(0,10000),flat=normalize(text);
    const refs=[];for(const m of r.memories){if(m.sources)refs.push(...m.sources.map(s=>s.source_id));else refs.push(...api.resolve(m).map(s=>s.source_id));}
    // Count an evidence turn only when its entire supplied source text survives the context cap.
    // This is intentionally stricter than presence of a source reference after truncation.
    const returned=[...new Set(refs)].filter(id=>byMid.has(id)&&flat.includes(normalize(byMid.get(id).text))).map(id=>byMid.get(id).dia_id);
    const gold=[...new Set((q.evidence??[]).flatMap(e=>String(e).match(/D\d+:\d+/g)??[]))];
    const found=gold.filter(e=>returned.includes(e)).length;
    all.push({id:conv+':'+q.index,conversation_id:conv,category:q.category,question:q.question,gold_answer:q.answer,
      annotated_evidence:q.evidence??[],evidence:gold,unresolved_evidence:gold.filter(e=>!byDia.has(e)),found_count:found,evidence_count:gold.length,
      all_evidence:gold.length?found===gold.length:null,evidence_recall:gold.length?found/gold.length:null,
      latency_ms:elapsed_ms,candidates:r.candidates,context_chars:text.length,returned_evidence:returned,context:text});
   }
   console.error(engine,conv,questions.length,'questions');
  }
  global.gc?.();const stats=api.stats();api.close();closed=true;const disk=fs.readdirSync(tmp).reduce((n,f)=>n+(fs.statSync(path.join(tmp,f)).isFile()?fs.statSync(path.join(tmp,f)).size:0),0);
  const annotated=all.filter(r=>r.evidence_count),summary={questions:all.length,questions_with_evidence:annotated.length,
   complete_evidence:annotated.filter(r=>r.all_evidence).length,complete_evidence_rate:annotated.filter(r=>r.all_evidence).length/annotated.length,
   mean_evidence_recall:annotated.reduce((n,r)=>n+r.evidence_recall,0)/annotated.length,
   p50_ms:p(all.map(r=>r.latency_ms),.5),p95_ms:p(all.map(r=>r.latency_ms),.95),median_context_chars:p(all.map(r=>r.context_chars),.5),
   ingestion_ms,message_count:messageCount,disk_bytes:disk,rss_mib:process.memoryUsage().rss/1048576,stats};
  console.log(JSON.stringify({engine,summary,results:all}));
 }finally{if(!closed)api.close();fs.rmSync(tmp,{recursive:true,force:true});}
}else{
 let result={started_at:new Date().toISOString(),node:process.version,dataset_url:'https://github.com/snap-research/locomo/blob/main/data/locomo10.json',dataset_sha256:sha(datasetBytes),
  protocol:{categories:[1,2,3,4],excluded_category:5,top_k:20,max_context_chars:10000,scope:'whole conversation, all sessions',reader:null,judge:null,metric:'complete annotated evidence turns in returned text; NOT QA accuracy',timing:'one measured retrieval per question after one warm-up per conversation; local, no network or reader'},runs:[],zep:{executed:false,reason:'No authenticated Zep connection or ZEP_API_KEY available',published_reference:{url:'https://www.getzep.com/research/',auto_search:{accuracy:.865,p50_ms:115,p95_ms:173,max_characters:10000},multi_scope:{accuracy:.947,p50_ms:87,p95_ms:155,median_context_tokens:5760},comparable_accuracy:false}}};
 const currentOnly=process.argv.includes('--current');
 const output=path.join(root,'results',currentOnly?'current-locomo.json':'locomo-raw.json');
 if(process.argv.includes('--resume')&&fs.existsSync(output)){const previous=JSON.parse(fs.readFileSync(output));if(previous.dataset_sha256!==result.dataset_sha256||JSON.stringify(previous.protocol)!==JSON.stringify(result.protocol))throw new Error('Resume protocol mismatch.');result=previous;result.resumed_at=new Date().toISOString();}
 for(const name of (currentOnly?['jsonl']:['legacy','sqlite','jsonl'])){
  if(result.runs.some(r=>r.engine===name))continue;
  console.log('LoCoMo',name);
  const r=spawnSync(process.execPath,['--expose-gc',fileURLToPath(import.meta.url),'worker',name],{encoding:'utf8',maxBuffer:100*1024*1024});
  if(r.status!==0)throw new Error(r.stderr||r.stdout);result.runs.push(JSON.parse(r.stdout));fs.writeFileSync(output,JSON.stringify(result));console.log(result.runs.at(-1).summary);
 }
 result.finished_at=new Date().toISOString();fs.writeFileSync(output,JSON.stringify(result));
}
