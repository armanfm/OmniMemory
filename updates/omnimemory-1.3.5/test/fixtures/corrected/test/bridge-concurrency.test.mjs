import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {BridgeClient} from '../desktop/bridge-client.mjs';

const secure={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()};
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
function fixture(t,fetcher){
 const dir=mkdtempSync(join(tmpdir(),'omni-concurrent-')),reads=[],sent=[];
 const client=new BridgeClient({origin:'https://omni.test',credentialPath:join(dir,'connection.bin'),safeStorage:secure,deviceName:'PC de teste',openURL:()=>{},fetcher:async(url,options)=>{
  if(url.endsWith('/device/result'))sent.push(JSON.parse(options.body));
  return fetcher(url,options);
 },store:{search:q=>{reads.push(q);return {memories:[{text:'memoria ficticia de teste'}]};}}});
 client.credentials={token:'a'.repeat(64)};client.persist();
 t.after(()=>{client.stop();rmSync(dir,{recursive:true,force:true});});
 return {client,reads,sent};
}

for(const route of ['/device/state','/device/poll']){
 test('disconnect cancels reads when '+route+' responds late',{timeout:3000},async t=>{
  const entered=deferred(),release=deferred();let signal;
  const {client,reads,sent}=fixture(t,async(url,options)=>{
   if(url.endsWith(route)){signal=options.signal;entered.resolve();await release.promise;}
   if(url.endsWith('/device/state'))return Response.json({approved:true});
   if(url.endsWith('/device/poll'))return Response.json({jobs:[{id:'job-ficticio',name:'search_memory',args:{query:'teste'}}]});
   return Response.json({ok:true});
  });
  const pending=client.tick();await entered.promise;
  await client.disconnect();assert.equal(signal.aborted,true);release.resolve();await pending;
  assert.deepEqual(reads,[]);assert.deepEqual(sent,[]);assert.equal(client.credentials,null);assert.equal(client.status,'disconnected');
 });
}

test('disconnect while a response body is being parsed also cancels reads',{timeout:3000},async t=>{
 const entered=deferred(),release=deferred();
 const {client,reads,sent}=fixture(t,async url=>{
  if(url.endsWith('/device/state'))return Response.json({approved:true});
  if(url.endsWith('/device/poll'))return {ok:true,json:async()=>{entered.resolve();await release.promise;return {jobs:[{id:'j',name:'search_memory',args:{query:'teste'}}]};}};
  return Response.json({ok:true});
 });
 const pending=client.tick();await entered.promise;await client.disconnect();release.resolve();await pending;
 assert.deepEqual(reads,[]);assert.deepEqual(sent,[]);assert.equal(client.status,'disconnected');
});

test('disconnect during the first upload prevents reading the remaining jobs',{timeout:3000},async t=>{
 const entered=deferred(),release=deferred();
 const {client,reads,sent}=fixture(t,async url=>{
  if(url.endsWith('/device/state'))return Response.json({approved:true});
  if(url.endsWith('/device/poll'))return Response.json({jobs:[1,2].map(id=>({id:String(id),name:'search_memory',args:{query:'teste '+id}}))});
  if(url.endsWith('/device/result')){entered.resolve();await release.promise;}
  return Response.json({ok:true});
 });
 const pending=client.tick();await entered.promise;await client.disconnect();release.resolve();await pending;
 // The first upload started before disconnect; it cannot be retroactively unsent.
 assert.deepEqual(reads,['teste 1']);assert.equal(sent.length,1);assert.equal(client.status,'disconnected');
});

test('an old unauthorized response cannot erase a new connection',{timeout:3000},async t=>{
 const entered=deferred(),release=deferred();
 const {client}=fixture(t,async url=>{
  if(url.endsWith('/device/state')){entered.resolve();await release.promise;return Response.json({error:'revoked'},{status:401});}
  return Response.json({ok:true});
 });
 const pending=client.tick();await entered.promise;await client.disconnect();
 const next={token:'b'.repeat(64)};client.credentials=next;client.persist();client.status='awaiting_approval';
 release.resolve();await pending;
 assert.equal(client.credentials,next);assert.equal(client.status,'awaiting_approval');assert.equal(existsSync(client.credentialPath),true);
});

test('stop cancels pending polling without reading local data',{timeout:3000},async t=>{
 const entered=deferred(),release=deferred();
 const {client,reads,sent}=fixture(t,async url=>{
  if(url.endsWith('/device/state'))return Response.json({approved:true});
  entered.resolve();await release.promise;return Response.json({jobs:[{id:'j',name:'search_memory',args:{query:'teste'}}]});
 });
 const pending=client.tick();await entered.promise;client.stop();release.resolve();await pending;
 assert.deepEqual(reads,[]);assert.deepEqual(sent,[]);
});

test('authorized requests without credentials never invoke fetch',async t=>{
 let called=false;const {client}=fixture(t,async()=>{called=true;return Response.json({ok:true});});
 client.credentials=null;await assert.rejects(client.request('/device/result',{body:{}}));assert.equal(called,false);
});

test('concurrent connect actions create only one authorization request',{timeout:3000},async t=>{
 const release=deferred();let starts=0,opens=0;
 const {client}=fixture(t,async()=>{starts++;await release.promise;return Response.json({token:'a'.repeat(64),approvalUrl:'https://omni.test/pair?id=teste',code:'123456'});});
 client.credentials=null;client.openURL=()=>{opens++;};
 const first=client.connect(),second=client.connect();release.resolve();await Promise.all([first,second]);
 assert.equal(starts,1);assert.equal(opens,1);
});

test('approval pages cannot redirect the user to another origin',async t=>{
 const {client}=fixture(t,async()=>Response.json({token:'a'.repeat(64),approvalUrl:'https://different.test/pair'}));
 client.credentials=null;let opened=false;client.openURL=()=>{opened=true;};
 await assert.rejects(client.connect(),/approval address/);assert.equal(opened,false);assert.equal(client.credentials,null);
});

test('a pending authorization cannot reconnect after disconnect',{timeout:3000},async t=>{
 const entered=deferred(),release=deferred();
 const {client}=fixture(t,async()=>{entered.resolve();await release.promise;return Response.json({token:'a'.repeat(64),approvalUrl:'https://omni.test/pair',code:'123456'});});
 client.credentials=null;let opened=false;client.openURL=()=>{opened=true;};
 const pending=client.connect();await entered.promise;await client.disconnect();release.resolve();
 await assert.rejects(pending,{name:'AbortError'});assert.equal(opened,false);assert.equal(client.credentials,null);assert.equal(client.status,'disconnected');
});
