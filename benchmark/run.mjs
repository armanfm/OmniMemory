import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=path.dirname(fileURLToPath(import.meta.url));
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'omni-nosql-bench-'));
const currentOnly=process.argv.includes('--current');
const out={started_at:new Date().toISOString(),node:process.version,platform:process.platform,cpu:os.cpus()[0]?.model,logical_cpus:os.cpus().length,runs:[],boots:[],quality:[]};
const worker=(...args)=>{const r=spawnSync(process.execPath,['--expose-gc',path.join(root,'worker.mjs'),...args.map(String)],{encoding:'utf8',maxBuffer:30*1024*1024});if(r.status!==0)throw new Error(r.stderr||r.stdout);return JSON.parse(r.stdout);};
const save=()=>fs.writeFileSync(path.join(root,'results',currentOnly?'current-performance.json':'no-sql-raw.json'),JSON.stringify(out,null,2));
try{
 for(const n of (process.env.BENCH_SIZES??'20000').split(',').map(Number))for(const engine of (currentOnly?['jsonl']:['legacy','sqlite','jsonl'])){
  const dir=path.join(temp,engine+'-'+n);console.log('Measuring',engine,n);out.runs.push(worker('performance',engine,n,dir));save();
  for(let i=0;i<3;i++)out.boots.push(worker('boot',engine,n,dir));save();
 }
 for(const engine of (currentOnly?['jsonl']:['legacy','sqlite','jsonl'])){console.log('Quality',engine);out.quality.push(worker('quality',engine,0,path.join(temp,'quality-'+engine)));save();}
 out.finished_at=new Date().toISOString();
 out.code_sha256=Object.fromEntries(['../lib/store.js','../lib/journal.js','../lib/postings.js','../lib/typos.js','../lib/text.js','reference/sqlite/lib/store.js','reference/legacy-core.txt','dataset.mjs','worker.mjs','adapters.mjs'].map(p=>[p,createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex')]));save();
 console.log('Complete:',path.join(root,'results',currentOnly?'current-performance.json':'no-sql-raw.json'));
}finally{fs.rmSync(temp,{recursive:true,force:true});}
