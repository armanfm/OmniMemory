import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MemoryStore } from '../lib/store.js';
import { importLegacy, importChatGPT } from '../lib/import.js';
import { FileUploads } from '../lib/files.js';
import { chunkText, CONFIG, tokenize } from '../lib/text.js';
const record=(id,text,conv='c',extra={})=>({message_id:id,text,conversation_id:conv,role:'user',...extra});
function fixture(t){const dir=mkdtempSync(join(tmpdir(),'omni-test-'));const store=new MemoryStore(join(dir,'memory.jsonl'));t.after(()=>{try{store.close();}catch{}rmSync(dir,{recursive:true,force:true});});return {dir,store};}

test('JSONL reconstructs stable chunks across restart and updates only the changed source',t=>{
 const {dir,store:s}=fixture(t);s.capture([record('a','cobalto rastreabilidade'),record('b','neodimio transporte')]);
 const before=[...s.chunks.values()].sort((a,b)=>a.id-b.id);
 const result=s.capture([record('a','cobalto rastreabilidade')]);assert.equal(result.changed,0);
 s.capture([record('a','cobalto auditoria atualizada')]);
 const unchanged=[...s.chunks.values()].find(c=>c.source_id==='b');assert.equal(unchanged.id,before[1].id);
 assert.equal(s.search('rastreabilidade').memories.length,0);assert.ok(s.search('auditoria').memories.length);
 const ids=[...s.chunks.keys()].sort((a,b)=>a-b);s.close();const reopened=new MemoryStore(join(dir,'memory.jsonl'));
 assert.deepEqual([...reopened.chunks.keys()].sort((a,b)=>a-b),ids);assert.equal(reopened.search('auditoria').total_messages,2);reopened.close();
});
test('conversation chronology and local scope are preserved',t=>{
 const {store:s}=fixture(t);
 s.capture([record('b','TERCEIRA mensagem', 'c',{previous_message_id:'a'}),record('a','SEGUNDA mensagem','c')]);
 s.capture([record('z','PRIMEIRA mensagem','c'),record('a','SEGUNDA mensagem','c',{previous_message_id:'z'}),record('b','TERCEIRA mensagem','c',{previous_message_id:'a'})]);
 const order=[...s.sources.values()].filter(r=>r.conversation_id==='c').sort((a,b)=>a.sort_order-b.sort_order).map(r=>r.source_id);assert.deepEqual(order,['z','a','b']);
 s.capture([record('x','SEGUNDA conversa diferente','other')]);
 const r=s.search('SEGUNDA',{conversation_id:'c'});assert.ok(r.memories.every(m=>m.conversation_id==='c'));assert.ok(r.memories[0].text.indexOf('PRIMEIRA')<r.memories[0].text.indexOf('SEGUNDA'));
});
test('word matching normalizes case and accents with a limited typo fallback',t=>{
 const {store:s}=fixture(t);s.capture([record('a','ExploreChem documentação transporte','c')]);
 assert.ok(s.search('EXPLORECHEM DOCUMENTACAO').memories.length);
 assert.ok(s.search('Explorecham').memories.length);
 assert.equal(s.search('explore').memories.length,0);
 assert.equal(s.search('transportadora').memories.length,0);
 assert.equal(s.search('Explorecham transporte').best_matched_word_count,2);
 assert.equal(s.search('ExploreChem').match_mode,'exact_with_typo_fallback');
 assert.equal(tokenize('massa.')[0],'massa');
});
test('ten matches require five; the relative threshold uses the best result, not query length',t=>{
 const {store:s}=fixture(t);const words=['abacaxi','bicicleta','cobalto','diamante','esmeralda','foguete','girassol','hematita','isqueiro','jabuticaba'];
 s.capture([record('a',words.join(' '),'ten'),record('a',words.slice(0,5).join(' '),'five'),record('a',words.slice(0,4).join(' '),'four')]);
 const r=s.search(words.join(' '));assert.equal(r.minimum_matched_words,5);assert.deepEqual(r.memories.map(m=>m.conversation_id),['ten','five']);
 const scoped=s.search(words.join(' '),{conversation_id:'four'});assert.equal(scoped.best_matched_word_count,4);assert.equal(scoped.minimum_matched_words,2);assert.ok(scoped.memories.length);
});
test('typo fallback handles one edit, prefers exact words and rejects short terms and codes',t=>{
 const {store:s}=fixture(t);s.capture([record('a','cobalto auditoria caso lote-123 abcdefff','correct'),record('a','cobalta','near')]);
 for(const query of ['cobaltp','coblto','cobaltoo','cobatlo']){
  const r=s.search(query);assert.ok(r.memories.some(m=>m.conversation_id==='correct'),query);
  assert.ok(r.fuzzy_matches.some(x=>x.matches.includes('cobalto')));assert.equal(r.best_matched_word_count,1);
 }
 assert.deepEqual(s.search('cobalto').memories.map(m=>m.conversation_id),['correct']);
 assert.deepEqual(s.search('cobalto').fuzzy_matches,[]);
 assert.equal(s.search('cobaltp auditoria').best_matched_word_count,2);
 for(const query of ['cobal','cabbaltp','casa','lote-124','abcdeffa'])assert.equal(s.search(query).memories.length,0,query);
});
test('typo alternatives respect conversation and collection scopes and do not double count a word',t=>{
 const {store:s}=fixture(t);s.capture([record('a','cobalto','outside'),record('a','cobalta cobaltq auditoria','inside')]);
 const uid=s.listSources().find(x=>x.conversation_id==='inside').uid;s.addCollection('allowed',{source_uid:uid});
 for(const scope of [{conversation_id:'inside'},{collection_id:'allowed'}]){
  const r=s.search('cobalto',scope);assert.equal(r.memories.length,1);assert.equal(r.memories[0].conversation_id,'inside');
  assert.equal(r.best_matched_word_count,1);assert.deepEqual(r.fuzzy_matches[0].matches,['cobalta','cobaltq']);
  assert.ok(!r.memories[0].sources.some(x=>x.source_uid!==uid));
 }
 s.capture([record('a','neodimio atualizado','inside')]);
 assert.equal(s.search('cobalto',{collection_id:'allowed'}).memories.length,0);
});
test('corrected query words follow the ten-to-five cutoff',t=>{
 const {store:s}=fixture(t),words=['abacaxi','bicicleta','cobalto','diamante','esmeralda','foguete','girassol','hematita','isqueiro','jabuticaba'];
 s.capture([record('a',words.join(' '),'ten'),record('a',words.slice(0,5).join(' '),'five'),record('a',words.slice(0,4).join(' '),'four')]);
 const r=s.search(words.join(' ').replace('cobalto','cobaltp'));
 assert.equal(r.best_matched_word_count,10);assert.equal(r.minimum_matched_words,5);
 assert.deepEqual(r.memories.map(m=>m.conversation_id),['ten','five']);
});
test('query-word ranking removes weak isolated matches and expands short passages',t=>{
 const {store:s}=fixture(t);
 s.capture([record('a','massa','weak'),record('a','massa transporte','middle'),record('a','massa transporte auditoria','best'),record('b',Array(45).fill('explicação').join(' '),'best',{previous_message_id:'a'})]);
 const r=s.search('massa transporte auditoria');assert.equal(r.memories[0].conversation_id,'best');assert.equal(r.memories[0].matched_word_count,3);
 assert.ok(r.memories[0].word_count>=40);assert.ok(!r.memories.some(m=>m.conversation_id==='weak'));assert.equal(r.weak_hits_filtered,1);
 assert.ok(s.search('massa',{conversation_id:'weak'}).memories.length);
});
test('exact identifiers follow the same relative cutoff and remain searchable on their own',t=>{
 const {store:s}=fixture(t);const id='0x191F35b0E823319B167E7E0ffEb7BB442f9b396F';
 s.capture([record('a',id,'address'),record('b','massa transporte auditoria','other')]);
 const r=s.search('massa transporte auditoria '+id);assert.ok(!r.memories.some(m=>m.text.includes(id)));assert.equal(r.minimum_matched_words,2);
 assert.equal(s.search(id).memories[0].conversation_id,'address');
});
test('relative half cutoff includes the boundary and rounds odd maxima upward',t=>{
 const {store:s}=fixture(t);const words=['abacaxi','bicicleta','cobalto','diamante','esmeralda','foguete','girassol','hematita'];
 for(const maximum of [8,7]){
  const prefix='case'+maximum;
  s.capture([record('a',words.slice(0,maximum).join(' '),prefix+'best'),record('a',words.slice(0,4).join(' '),prefix+'four'),record('a',words.slice(0,3).join(' '),prefix+'three')]);
  const collection='maximum-'+maximum;for(const suffix of ['best','four','three'])s.addCollection(collection,{conversation_id:prefix+suffix});
  const result=s.search(words.slice(0,maximum).join(' '),{collection_id:collection});
  assert.equal(result.best_matched_word_count,maximum);assert.equal(result.minimum_matched_words,4);
  assert.deepEqual(result.memories.map(m=>m.conversation_id),[prefix+'best',prefix+'four']);assert.equal(result.weak_hits_filtered,1);
 }
});
test('relative cutoff supports one-word queries, two-word maxima and empty results',t=>{
 const {store:s}=fixture(t);s.capture([record('a','abacaxi bicicleta','both'),record('a','abacaxi','single')]);
 const two=s.search('abacaxi bicicleta');assert.equal(two.minimum_matched_words,1);assert.equal(two.memories.length,2);
 const one=s.search('abacaxi');assert.equal(one.minimum_matched_words,1);assert.equal(one.memories.length,2);
 const empty=s.search('zzqxv');assert.equal(empty.minimum_matched_words,0);assert.equal(empty.memories.length,0);
});
test('file section context, short blocks, source offsets and bounded output',t=>{
 const {store:s}=fixture(t);const text='# Contratos\n\nID\n\n'+Array(3000).fill('cobalto transporte rastreabilidade').join(' ');
 s.transaction(()=>s.upsertSource({kind:'file',conversation_id:'c',file_id:'file',filename:'manual.md',text}));
 const pieces=chunkText(text);assert.ok(pieces.some(c=>c.text==='ID'));assert.ok(pieces.every(c=>text.slice(c.start,c.end)===c.text));assert.ok(pieces.at(-1).section.includes('Contratos'));
 const r=s.search('cobalto',{top_k:20});assert.ok(r.memories.map(m=>m.text).join('\n\n===').length<=CONFIG.maxExpandedChars);
 const ref=r.memories[0].sources[0];assert.equal(s.source(ref.source_uid,{offset:ref.start,limit:ref.end-ref.start,revision:ref.revision}).text,text.slice(ref.start,ref.end));
 assert.throws(()=>s.source(ref.source_uid,{revision:99}),/changed/);
});
test('collection scoping applies to both hits and expanded neighbors',t=>{
 const {store:s}=fixture(t);s.capture([record('a','neodimio permitido'),record('b','SEGREDO vizinho não selecionado')]);
 const uid=s.listSources().find(x=>x.source_id==='a').uid;s.addCollection('Projeto',{source_uid:uid});
 const r=s.search('neodimio',{collection_id:'Projeto'});assert.ok(r.memories.length);assert.ok(!r.memories[0].text.includes('SEGREDO'));
 assert.equal(s.search('neodimio',{collection_id:'inexistente'}).memories.length,0);
 s.addCollection('Conversa',{conversation_id:'c'});assert.ok(s.search('neodimio',{collection_id:'Conversa'}).memories[0].text.includes('SEGREDO'));
});
test('legacy JSONL migrates latest versions once and leaves the original files intact',async t=>{
 const {dir,store:s}=fixture(t);const msg=join(dir,'messages.jsonl'),files=join(dir,'files.jsonl'),fileDir=join(dir,'files');mkdirSync(join(fileDir,'c'),{recursive:true});
 const file=join(fileDir,'c','f__manual.md');writeFileSync(file,'# Documento\n\nDados minerais.');
 const raw=[record('a','texto antigo'),record('a','texto novo')].map(JSON.stringify).join('\n')+'\nBAD JSON\n';writeFileSync(msg,raw);
 writeFileSync(files,JSON.stringify({conversation_id:'c',file_id:'f',filename:'manual.md',mime:'text/markdown',saved_path:'./data/files/c/f__manual.md'})+'\n');
 const result=await importLegacy(s,{messages:msg,files,fileDir});assert.equal(result.messages.invalid,1);assert.equal(s.stats().total_messages,1);assert.equal(s.stats().total_files,1);assert.equal(readFileSync(msg,'utf8'),raw);
 assert.ok(s.search('minerais').memories.length);assert.equal((await importLegacy(s,{messages:msg,files,fileDir})).skipped,true);
});
test('export importer preserves current-branch order without inventing attachment content',t=>{
 const {dir,store:s}=fixture(t);const p=join(dir,'export.json');writeFileSync(p,JSON.stringify([{id:'export',current_node:'b',mapping:{a:{id:'a',parent:null,message:{id:'z',author:{role:'user'},content:{parts:['Primeira fala']}}},b:{id:'b',parent:'a',message:{id:'a',author:{role:'assistant'},content:{parts:['Segunda fala',{asset_pointer:'binary'}]}}}}}]));
 const r=importChatGPT(s,p);assert.equal(r.changed,2);assert.deepEqual([...s.sources.values()].filter(r=>r.conversation_id==='export').sort((a,b)=>a.sort_order-b.sort_order).map(r=>r.source_id),['z','a']);assert.equal(s.listConversations()[0].coverage,'export_current_branch');
});
test('file uploads check offsets, declared bytes and content identity',t=>{
 const {dir,store:s}=fixture(t);const u=new FileUploads(s,join(dir,'uploads'));t.after(()=>u.close());const bytes=Buffer.from('cobalto arquivo completo');
 const meta={conversation_id:'c',file_id:'a',filename:'teste.txt',mime:'text/plain',size:bytes.length};
 const id=u.start(meta);assert.throws(()=>u.finish(id),/Incomplete/);assert.throws(()=>u.append(id,bytes.toString('base64'),1),/offset/);
 u.append(id,bytes.toString('base64'),0);assert.equal(u.finish(id).changed,true);
 const second=u.start({...meta,file_id:'b'});u.append(second,bytes.toString('base64'),0);assert.equal(u.finish(second).changed,false);assert.equal(s.stats().total_files,1);
 const broken=u.start({...meta,size:1});assert.throws(()=>u.append(broken,bytes.toString('base64'),0),/declared/);u.abort(broken);
});
test('deletion is auditable, clears the in-memory index, blocks recapture and can be released',t=>{
 const {store:s}=fixture(t);s.capture([record('a','cobalto')]);const uid=s.listSources()[0].uid;
 s.deleteTarget('source',uid);assert.equal(s.search('cobalto').memories.length,0);assert.equal(s.capture([record('a','cobalto')]).blocked,1);
 s.allowRecapture('source',uid);assert.equal(s.capture([record('a','cobalto')]).changed,1);
 assert.ok(s.tables.audit.size>=2);s.compact();assert.ok(s.search('cobalto').memories.length);
});
