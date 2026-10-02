// One-time converter only. Neither server.js nor cli.js imports node:sqlite.
import { DatabaseSync } from 'node:sqlite';
import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { MemoryStore } from '../lib/store.js';
import { MEMORY_PATH, PREVIOUS_SQLITE } from '../lib/config.js';
export function migrateSQLite(input,output) {
  if(!existsSync(input))throw new Error('SQLite input does not exist: '+input);
  if(existsSync(output))throw new Error('Destination already exists; migration will not overwrite it: '+output);
  const db=new DatabaseSync(input,{readOnly:true});let store;
  try {
    if(db.prepare('PRAGMA user_version').get().user_version!==1)throw new Error('Unsupported SQLite schema. Use the matching OmniMemory version to export it.');
    store=new MemoryStore(output);
    store.transaction(()=>{
      for(const c of db.prepare('SELECT * FROM conversations').all())store.put('conversations',c.id,c);
      for(const s of db.prepare('SELECT * FROM sources ORDER BY id').all()){
        const parts=db.prepare('SELECT id,part FROM chunks WHERE source_pk=? ORDER BY part').all(s.id);
        const start=parts.length?parts[0].id:store.nextChunk;
        if(parts.some((p,i)=>p.id!==start+i))throw new Error('Non-contiguous source chunk IDs; export requires review.');
        store.put('sources',s.uid,{...s,chunk_start:start,chunk_count:parts.length});
      }
      for(const c of db.prepare('SELECT * FROM collections').all())store.put('collections',c.id,{id:c.id,
        conversations:db.prepare('SELECT conversation_id FROM collection_conversations WHERE collection_id=?').all(c.id).map(r=>r.conversation_id),
        sources:db.prepare('SELECT source_uid FROM collection_sources WHERE collection_id=?').all(c.id).map(r=>r.source_uid)});
      for(const t of db.prepare('SELECT * FROM tombstones').all())store.put('tombstones',t.kind+'\0'+t.key,t);
      for(const s of db.prepare('SELECT * FROM settings').all())store.put('settings',s.key,s.value);
      for(const a of db.prepare('SELECT * FROM audit ORDER BY id').all())store.put('audit',String(a.id),a);
      store.log('migrate_sqlite',{input:resolve(input),output:resolve(output)});
    });
    return {input,output,original_preserved:true,...store.stats()};
  }catch(e){if(store){store.close();rmSync(output,{force:true});}throw e;}
  finally{store?.close();db.close();}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  try{console.log(JSON.stringify(migrateSQLite(process.argv[2]??PREVIOUS_SQLITE,process.argv[3]??MEMORY_PATH),null,2));}
  catch(e){console.error(e.message);process.exitCode=1;}
}
