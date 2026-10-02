import fs from 'node:fs';
import path from 'node:path';
import {openEngine,returnedEvidence} from './adapters.mjs';
import {corpus,performanceQueries,qualityFixture} from './dataset.mjs';
const [mode,engine,nraw,dir]=process.argv.slice(2),n=Number(nraw);
const mem=()=>({rss_mb:process.memoryUsage().rss/1048576,heap_mb:process.memoryUsage().heapUsed/1048576,max_rss_mb:process.resourceUsage().maxRSS/1024});
const percentile=(xs,p)=>[...xs].sort((a,b)=>a-b)[Math.max(0,Math.ceil(xs.length*p)-1)];
const summarize=xs=>({n:xs.length,p50_ms:percentile(xs,.5),p95_ms:percentile(xs,.95),min_ms:Math.min(...xs),max_ms:Math.max(...xs)});
const sizeOf=p=>fs.existsSync(p)?fs.statSync(p).isDirectory()?fs.readdirSync(p).reduce((n,f)=>n+sizeOf(path.join(p,f)),0):fs.statSync(p).size:0;
fs.mkdirSync(dir,{recursive:true});
let start=performance.now();const api=openEngine(engine,dir);const boot_ms=performance.now()-start;
if(mode==='boot'){global.gc?.();const result={mode,engine,n,boot_ms,...mem()};api.close();console.log(JSON.stringify(result));process.exit(0);}
if(mode==='quality'){
 const fixture=qualityFixture();for(let i=0;i<fixture.messages.length;i+=100)api.capture(fixture.messages.slice(i,i+100));
 const results=[];
 for(const c of fixture.cases){
  const t=performance.now();const r=api.search(c.query,c.conversation_id);const elapsed=performance.now()-t;
  const refs=returnedEvidence(api,r),text=r.memories.map(m=>m.text).join('\n');
  const found=c.expected.filter(e=>refs.has(e.conversation_id+'::'+e.source_id)).length;
  results.push({id:c.id,category:c.category,query:c.query,expected:c.expected,expected_count:c.expected.length,found_count:found,
    evidence_recall:c.expected.length?found/c.expected.length:null,all_evidence:c.expected.length?found===c.expected.length:null,
    answer_evidence_present:c.absent?null:c.answer_needles.every(a=>text.includes(a)),abstained:r.memories.length===0,
    returned_sources:refs.size,returned_chars:text.length,elapsed_ms:elapsed,returned_source_ids:[...refs],returned_text:text});
 }
 api.close();console.log(JSON.stringify({mode,engine,...mem(),description:fixture.description,results}));process.exit(0);
}
const messages=corpus(n);start=performance.now();const batchTimes=[];
for(let i=0;i<n;i+=100){const t=performance.now();api.capture(messages.slice(i,i+100));batchTimes.push(performance.now()-t);}
const ingestion_ms=performance.now()-start;
const queries=performanceQueries(n),timings=[];
for(const q of queries){api.search(q.query,q.conversation_id);const samples=[],chars=[],candidates=[];
 for(let repeat=0;repeat<5;repeat++){const t=performance.now();const r=api.search(q.query,q.conversation_id);samples.push(performance.now()-t);chars.push(r.memories.reduce((n,m)=>n+m.text.length,0));candidates.push(r.candidates);}
 timings.push({...q,...summarize(samples),raw_ms:samples,returned_chars:chars,candidates});
}
const updates=messages.slice(-10).map(m=>({...m,text:m.text+' Atualizacao confirmada do documento.'}));
start=performance.now();api.capture(updates);const update10_ms=performance.now()-start;
start=performance.now();api.capture(updates);const unchanged10_ms=performance.now()-start;
global.gc?.();const memory=mem();const stats=api.stats();api.close();
console.log(JSON.stringify({mode,engine,n,boot_empty_ms:boot_ms,ingestion_ms,batches:summarize(batchTimes),update10_ms,unchanged10_ms,
 timings,...memory,disk_bytes:sizeOf(dir),stats}));
