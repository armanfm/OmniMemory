import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,writeFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Journal} from '../lib/journal.js';
import {MemoryStore} from '../lib/store.js';
const previous=process.env.OMNI_MEMORY_PASSPHRASE;
const reset=()=>{if(previous===undefined)delete process.env.OMNI_MEMORY_PASSPHRASE;else process.env.OMNI_MEMORY_PASSPHRASE=previous;};
function setup(t){const d=mkdtempSync(join(tmpdir(),'omni-encrypted-'));t.after(()=>{reset();rmSync(d,{recursive:true,force:true});});return join(d,'journal.jsonl');}
test('AES-GCM journal round-trip, no plaintext disclosure, and backup round-trip',t=>{
 const path=setup(t);process.env.OMNI_MEMORY_PASSPHRASE='correct horse battery staple more words';
 const s=new MemoryStore(path);s.capture([{conversation_id:'c',message_id:'x',text:'my very private memories 🧠'}]);
 const backup=path+'.backup';s.backup(backup);s.compact();s.close();
 for(const p of [path,backup]){
  const bytes=readFileSync(p,'utf8');assert.match(bytes,/omni_encrypted/);assert.doesNotMatch(bytes,/my very private memories/);
  const r=new MemoryStore(p);assert.equal(r.search('private').memories.length,1);r.close();
 }
});
test('wrong or missing passphrase fails closed without truncating data',t=>{
 const path=setup(t);process.env.OMNI_MEMORY_PASSPHRASE='correct horse battery staple more words';const w=new Journal(path);w.append([['settings','secret','hello world']]);w.close();const original=readFileSync(path);
 process.env.OMNI_MEMORY_PASSPHRASE='a totally different password';assert.throws(()=>new MemoryStore(path),/decryption failed/);
 delete process.env.OMNI_MEMORY_PASSPHRASE;assert.throws(()=>new MemoryStore(path),/OMNI_MEMORY_PASSPHRASE/);
 assert.deepEqual(readFileSync(path),original);assert.equal(existsSync(path+'.lock'),false);
});
test('setting passphrase on existing plaintext refuses implicit migration',t=>{
 const path=setup(t);writeFileSync(path,'{"version":1,"events":[],"checksum":"fake"}\n');const original=readFileSync(path);
 process.env.OMNI_MEMORY_PASSPHRASE='correct horse battery staple more words';assert.throws(()=>new MemoryStore(path),/Existing plaintext journal/);assert.deepEqual(readFileSync(path),original);
});
test('tampering with encrypted payload causes authenticated decryption failure',t=>{
 const path=setup(t);process.env.OMNI_MEMORY_PASSPHRASE='correct horse battery staple more words';const w=new Journal(path);w.append([['settings','test','secret']]);w.close();
 const lines=readFileSync(path,'utf8').trimEnd().split('\n');const row=JSON.parse(lines[1]);const corrupted=Buffer.from(row.data,'base64');corrupted[0]^=0x01;row.data=corrupted.toString('base64');lines[1]=JSON.stringify(row);writeFileSync(path,lines.join('\n')+'\n');
 assert.throws(()=>new MemoryStore(path),/decryption failed/);
});
