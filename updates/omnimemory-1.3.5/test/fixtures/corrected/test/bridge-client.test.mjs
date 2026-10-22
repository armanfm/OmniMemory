import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,rmSync,readFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {BridgeClient,executeLocalTool} from '../desktop/bridge-client.mjs';
const secure={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from('sealed:'+s),decryptString:b=>b.toString().slice(7)};
test('client pairs through approval, saves protected credentials and sends only allowed read results',async()=>{const dir=mkdtempSync(join(tmpdir(),'omni-connect-'));const calls=[],t='a'.repeat(64);let client;try{let approved=false;const fetcher=async(url,opt)=>{calls.push({url,opt});if(url.endsWith('/device/start'))return Response.json({token:t,deviceId:'d',code:'123456',approvalUrl:'https://omni.test/pair?id=d'});if(url.endsWith('/device/state'))return Response.json({approved});if(url.endsWith('/device/poll'))return Response.json({jobs:[{id:'j',name:'search_memory',args:{query:'projeto'}}]});return Response.json({ok:true});};let opened;client=new BridgeClient({credentialPath:join(dir,'c.bin'),safeStorage:secure,store:{search:q=>({query:q,memories:[]})},openURL:url=>{opened=url;},deviceName:'Meu PC',fetcher,origin:'https://omni.test'});await client.connect();client.stop();assert.equal(opened,'https://omni.test/pair?id=d');assert.equal(client.status,'awaiting_approval');assert.match(readFileSync(join(dir,'c.bin')).toString(),/^sealed:/);approved=true;client.stopped=false;await client.tick();client.stop();assert.equal(client.status,'connected');const sent=calls.find(c=>c.url.endsWith('/device/result'));assert.equal(JSON.parse(sent.opt.body).result.structuredContent.query,'projeto');assert.equal(sent.opt.headers['x-omni-device'],'Bearer '+t);await client.disconnect();assert.equal(client.status,'disconnected');}finally{client?.stop();rmSync(dir,{recursive:true});}});
test('remote caller cannot execute arbitrary commands or excessive memory reads',()=>{assert.throws(()=>executeLocalTool({},'exec_command',{cmd:'whoami'}));assert.throws(()=>executeLocalTool({},'read_memory_source',{source_uid:'s',limit:24001}));assert.throws(()=>executeLocalTool({},'search_memory',{query:'x',top_k:21}));});

test('bridge returns contextual evidence for complex searches, simple queries remain fast',()=>{
 let searched=0;
 const store={search:(q)=>{searched++;return {query:q,memories:[]}}};
 const basic=executeLocalTool(store,'search_memory',{query:'nome'});
 assert.equal(basic.query,'nome');assert.equal(basic.contextual_analysis,undefined);
 const complex=executeLocalTool(store,'search_memory',{query:'cronologia envolvidos'});
 assert.equal(complex.mode,'contextual_adaptive');assert.deepEqual(complex.contextual_analysis.contradictions,[]);
 assert.ok(searched>=2);
});
test('bridge supports bounded investigate_memory but rejects invalid request',()=>{
 const store={search:(q)=>({query:q,memories:[]})};
 const result=executeLocalTool(store,'investigate_memory',{query:'quem disse o quê',top_k:3});
 assert.equal(result.mode,'contextual_adaptive');
 assert.deepEqual(result.contextual_analysis.possible_victims,[]);
 assert.throws(()=>executeLocalTool(store,'investigate_memory',{query:'x',top_k:21}));
 assert.throws(()=>executeLocalTool(store,'investigate_memory',{query:'x',conversation_id:8}));
});
