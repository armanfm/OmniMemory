import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,appendFileSync,writeFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {MemoryStore} from '../lib/store.js';
import {Journal} from '../lib/journal.js';
const message=(id,text)=>({conversation_id:'c',message_id:id,text});
function setup(t){const dir=mkdtempSync(join(tmpdir(),'omni-journal-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return {dir,path:join(dir,'memory.jsonl')};}
test('streamed journal preserves Unicode across read blocks and ignores an unfinished reader tail',t=>{
 const {path}=setup(t),writer=new Journal(path);
 const events=[{type:'test',text:'ação 🌱 '.repeat(60000)}];
 writer.append(events);writer.append([{type:'test',text:'última linha'}]);writer.close();
 appendFileSync(path,'{"version":1,"events":');
 const before=readFileSync(path),reader=new Journal(path,{readOnly:true}),actual=[];
 reader.load(event=>actual.push(event));reader.close();
 assert.deepEqual(actual,[...events,{type:'test',text:'última linha'}]);assert.deepEqual(readFileSync(path),before);
});
test('failed batches roll back sources, indexes, counters and durable bytes',t=>{
 const {path}=setup(t),s=new MemoryStore(path);s.capture([message('a','cobalto original')]);const before=readFileSync(path),stats=s.stats();
 assert.throws(()=>s.capture([message('a','neodimio substituto'),{message_id:'bad',text:'sem conversa'}]),/requires/);
 assert.deepEqual(s.stats(),stats);assert.deepEqual(readFileSync(path),before);assert.equal(s.search('substituto').memories.length,0);assert.ok(s.search('original').memories.length);s.close();
 const r=new MemoryStore(path);assert.deepEqual(r.stats(),stats);r.close();
});
test('failed durable append does not acknowledge or retain changes in memory',t=>{
 const {path}=setup(t),s=new MemoryStore(path);s.capture([message('a','cobalto')]);
 const append=s.journal.append;s.journal.append=()=>{throw new Error('disk full');};
 assert.throws(()=>s.capture([message('b','neodimio')]),/disk full/);assert.equal(s.stats().total_messages,1);assert.equal(s.search('neodimio').memories.length,0);
 s.journal.append=append;s.close();const r=new MemoryStore(path);assert.equal(r.stats().total_messages,1);r.close();
});
test('single writer lock allows a read-only snapshot and rejects a second writer',t=>{
 const {path}=setup(t),s=new MemoryStore(path);s.capture([message('a','cobalto')]);
 assert.throws(()=>new MemoryStore(path),/already open/);const r=new MemoryStore(path,{readOnly:true});assert.equal(r.stats().total_messages,1);assert.throws(()=>r.capture([message('b','ferro')]),/read-only/);r.close();s.close();
 const next=new MemoryStore(path);next.capture([message('b','ferro')]);next.close();
});
test('interrupted tail is recovered but corruption in a committed line is rejected',t=>{
 const {dir,path}=setup(t),s=new MemoryStore(path);s.capture([message('a','cobalto')]);s.close();const original=readFileSync(path);
 appendFileSync(path,'{"version":1,"events":');const r=new MemoryStore(path);assert.equal(r.stats().total_messages,1);r.close();assert.deepEqual(readFileSync(path),original);
 writeFileSync(path,original.toString().replace('cobalto','cobaltX'));assert.throws(()=>new MemoryStore(path),/checksum/);assert.equal(existsSync(path+'.lock'),false);
});
test('compaction and backups preserve revisions, scopes, tombstones and source offsets',t=>{
 const {dir,path}=setup(t),s=new MemoryStore(path);s.capture([message('a','cobalto antigo'),message('b','ferro')]);s.capture([message('a','cobalto atual')]);
 const uid=s.listSources().find(r=>r.source_id==='a').uid;s.addCollection('Minerais',{source_uid:uid});s.deleteTarget('source',s.listSources().find(r=>r.source_id==='b').uid);
 const query=()=>s.search('cobalto',{collection_id:'Minerais'}).memories;const before=query();const backup=join(dir,'backup.jsonl');s.backup(backup);s.compact();assert.deepEqual(query(),before);s.close();
 for(const file of [path,backup]){const r=new MemoryStore(file);assert.deepEqual(r.search('cobalto',{collection_id:'Minerais'}).memories,before);assert.equal(r.capture([message('b','ferro')]).blocked,1);assert.equal(r.source(uid).revision,2);r.close();}
});
test('SQLite input is detected instead of being truncated as an incomplete journal',t=>{
 const {path}=setup(t),bytes=Buffer.from('SQLite format 3\0binary database');writeFileSync(path,bytes);assert.throws(()=>new MemoryStore(path),/SQLite/);assert.deepEqual(readFileSync(path),bytes);
});
