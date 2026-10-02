import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import {MemoryStore} from '../lib/store.js';
import {MemoryStore as SQLiteStore} from './reference/sqlite/lib/store.js';
export function openEngine(engine,dir){
 if(engine==='jsonl'||engine==='sqlite'){
  const Store=engine==='jsonl'?MemoryStore:SQLiteStore;
  const store=new Store(path.join(dir,engine==='jsonl'?'omnimemory.jsonl':'omnimemory.sqlite'));
  return {store,capture:m=>store.capture(m),search:(q,scope)=>store.search(q,{top_k:8,conversation_id:scope}),close:()=>store.close(),
    readSource:r=>store.source(r.source_uid),stats:()=>store.stats()};
 }
 const source=fs.readFileSync(new URL('./reference/legacy-core.txt',import.meta.url),'utf8');
 const ctx=vm.createContext({...fs,...path,Buffer,performance,console:{log(){},warn(){}},process:{env:{TD_MEMORY_PATH:path.join(dir,'messages.jsonl'),TD_FILE_META_PATH:path.join(dir,'files.jsonl'),TD_FILE_DIR:path.join(dir,'files')}}});
 vm.runInContext(source+'\nloadMemory();\nglobalThis.api={capture:upsertMessages,search:(q,scope,top=8)=>searchMemory(q,top,scope),close:()=>{},stats:()=>({total_messages:messages.size,total_chunks:chunks.length}),resolve:(memory)=>{const group=memory.source_type===\'chat\'?\'chat:\'+memory.conversation_id:null;return (groupChunkIds.get(group)||[]).slice(memory.range.start,memory.range.end+1).map(id=>chunks[id]);}};',ctx);
 return {...ctx.api,resolve:ctx.api.resolve};
}
export function returnedEvidence(engine,result){
 const refs=new Set();
 for(const m of result.memories){
  if(m.sources){for(const r of m.sources)refs.add(m.conversation_id+'::'+r.source_id);}
  else for(const r of engine.resolve(m))refs.add(r.conversation_id+'::'+r.source_id);
 }
 return refs;
}
