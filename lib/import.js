import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { resolve, dirname, join, basename } from 'node:path';
import { createInterface } from 'node:readline';
import { fileText, safePart } from './files.js';
import { hash } from './text.js';
async function lines(path,visit) {
  let invalid=0,read=0;
  if(!existsSync(path))return {read,invalid};
  const reader=createInterface({input:createReadStream(path),crlfDelay:Infinity});
  for await(const line of reader) {
    if(!line.trim())continue;
    let row;try{row=JSON.parse(line);}catch{invalid++;continue;}
    await visit(row);read++;
  }
  return {read,invalid};
}
export async function importLegacy(store,{messages,files,fileDir},force=false) {
  const key='legacy:'+hash(JSON.stringify([resolve(messages),resolve(files)]));
  if(!force&&store.setting(key))return {skipped:true,reason:'already_imported'};
  if(!existsSync(messages)&&!existsSync(files))return {skipped:true,reason:'no_legacy_files'};
  let changed=0,missing_files=0,invalid_records=0;const conversations=new Set();
  store.begin();
  try {
    const messageResult=await lines(messages,r=>{
      if(!r.conversation_id||!r.message_id||!r.text){invalid_records++;return;}
      const result=store.upsertSource({...r,kind:'chat'});changed+=Number(result.changed);conversations.add(r.conversation_id);
    });
    const fileResult=await lines(files,r=>{
      if(!r.conversation_id||!r.file_id){invalid_records++;return;}
      const normalized=String(r.saved_path??'').replaceAll('\\','/');
      const candidates=[resolve(dirname(files),'..',normalized),resolve(dirname(files),normalized),
        join(fileDir,safePart(r.conversation_id),`${safePart(r.file_id)}__${safePart(r.filename)}`),
        join(fileDir,safePart(r.conversation_id),basename(normalized))];
      const roots=[resolve(fileDir),resolve(dirname(files)),resolve(dirname(files),'..')];
      const path=candidates.find(p=>roots.some(root=>p.startsWith(root+'/'))&&existsSync(p)&&statSync(p).isFile());
      const data=path?{...fileText(path,r),saved_path:path}:{text:`${r.filename??''} ${r.mime??''}`,index_mode:'missing_file',saved_path:null,size:r.size??0};
      if(!path)missing_files++;
      const result=store.upsertSource({...r,...data,kind:'file'});changed+=Number(result.changed);
    });
    for(const conv of conversations)store.reorderConversation(conv);
    const result={changed,messages:messageResult,files:fileResult,missing_files,invalid_records};
    store.setSetting(key,JSON.stringify(result));store.log('import_legacy',result);store.commit();return result;
  }catch(e){store.rollback();throw e;}
}
export function importChatGPT(store,path) {
  if(statSync(path).size>250*1024*1024)throw new Error('Export exceeds 250 MiB; split it before importing.');
  const data=JSON.parse(readFileSync(path,'utf8'));const conversations=Array.isArray(data)?data:[data];
  return store.transaction(()=>{
    let changed=0,imported=0,skipped=0;
    for(const conv of conversations){
      if(!conv.mapping){skipped++;continue;}
      const id=String(conv.id??conv.conversation_id??'');if(!id){skipped++;continue;}
      const nodes=[];let cursor=conv.current_node;const seen=new Set();
      if(!cursor){skipped++;continue;}
      while(cursor&&conv.mapping[cursor]&&!seen.has(cursor)){seen.add(cursor);const n=conv.mapping[cursor];nodes.push(n);cursor=n.parent;}
      nodes.reverse();let previous;
      for(const n of nodes){const m=n.message;if(!m||!['user','assistant'].includes(m.author?.role))continue;
        const text=(m.content?.parts??[]).filter(x=>typeof x==='string').join('\n');if(!text.trim())continue;
        const sid=String(m.id??n.id);const r=store.upsertSource({kind:'chat',conversation_id:id,source_id:sid,role:m.author.role,text,
          previous_message_id:previous,captured_at:m.create_time?new Date(m.create_time*1000).toISOString():undefined});
        previous=sid;changed+=Number(r.changed);
      }
      store.reorderConversation(id);store.setCoverage(id,'export_current_branch');imported++;
    }
    const result={changed,imported,skipped};store.log('import_chatgpt',result);return result;
  });
}
