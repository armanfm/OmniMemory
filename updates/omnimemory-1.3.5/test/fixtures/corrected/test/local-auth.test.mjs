import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {request} from 'node:http';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {createApp} from '../core/server.js';
import {MemoryStore} from '../core/lib/store.js';

async function fixture(t,label,{separateReadKey=true}={}){
 const dir=mkdtempSync(join(tmpdir(),'omni-auth-')),store=new MemoryStore(join(dir,'memory.jsonl'));
 const key='capture-only-secret-'+label,readKey=separateReadKey?'read-only-secret-'+label:key;
 store.capture([{conversation_id:'chat-'+label,message_id:'message-'+label,role:'user',text:'memoria ficticia exclusiva '+label}]);
 const previousOrigins=process.env.OMNI_MCP_ALLOWED_ORIGINS;
 process.env.OMNI_MCP_ALLOWED_ORIGINS='https://trusted-ui.test';
 let app;
 try{app=createApp({store,key,readKey,fileDir:join(dir,'files')});}
 finally{if(previousOrigins===undefined)delete process.env.OMNI_MCP_ALLOWED_ORIGINS;else process.env.OMNI_MCP_ALLOWED_ORIGINS=previousOrigins;}
 await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{app.closeAllConnections();await new Promise(resolve=>app.close(resolve));store.close();rmSync(dir,{recursive:true,force:true});});
 return {store,key,readKey,base:'http://127.0.0.1:'+app.address().port};
}
const auth=key=>({authorization:'Bearer '+key});

test('all local read routes reject anonymous and invalid credentials',async t=>{
 const {base,readKey,key}=await fixture(t,'A');
 for(const path of ['/','/status','/mcp']){
  const r=await fetch(base+path);assert.equal(r.status,401);assert.ok(!(await r.text()).includes('exclusiva'));
 }
 for(const method of ['POST','GET','DELETE'])assert.equal((await fetch(base+'/mcp',{method,headers:auth('incorrect-read-secret')})).status,401);
 assert.equal((await fetch(base+'/status?token='+readKey)).status,401);
 assert.equal((await fetch(base+'/status',{headers:auth(key)})).status,401);
 assert.equal((await fetch(base+'/status',{headers:auth(readKey)})).status,200);
 assert.equal((await fetch(base+'/status',{headers:{'x-omni-read-key':readKey}})).status,200);
});

test('read credentials cannot capture or overwrite memory',async t=>{
 const {base,key,readKey,store}=await fixture(t,'A');
 const body=JSON.stringify({messages:[{conversation_id:'x',message_id:'x',role:'user',text:'captura ficticia'}]});
 for(const headers of [auth(readKey),{'x-omni-key':readKey}])assert.equal((await fetch(base+'/capture/batch',{method:'POST',headers:{'content-type':'application/json',...headers},body})).status,401);
 assert.equal(store.stats().total_messages,1);
 assert.equal((await fetch(base+'/capture/batch',{method:'POST',headers:{'content-type':'application/json','x-omni-key':key},body})).status,200);
 assert.equal(store.stats().total_messages,2);
});

test('existing local x-omni-key clients remain compatible',async t=>{
 const {base,key}=await fixture(t,'COMPAT',{separateReadKey:false});
 assert.equal((await fetch(base+'/status',{headers:{'x-omni-key':key}})).status,200);
 assert.equal((await fetch(base+'/status',{headers:{'x-omni-key':key,...auth('wrong-token')}})).status,401);
 const client=new Client({name:'legacy-authorized-ai',version:'1.0.0'});t.after(()=>client.close());
 await client.connect(new StreamableHTTPClientTransport(new URL(base+'/mcp'),{requestInit:{headers:{'x-omni-key':key}}}));
 const answer=await client.callTool({name:'search_memory',arguments:{query:'memoria ficticia exclusiva'}});
 assert.ok(JSON.stringify(answer).includes('COMPAT'));
});

test('foreign origins and rebinding hosts are rejected even with a valid read key',async t=>{
 const {base,readKey}=await fixture(t,'A');
 for(const origin of ['https://different.test','null']){
  const r=await fetch(base+'/mcp',{method:'OPTIONS',headers:{origin,'access-control-request-method':'POST'}});
  assert.equal(r.status,403);assert.equal(r.headers.get('access-control-allow-origin'),null);
  assert.equal((await fetch(base+'/status',{headers:{...auth(readKey),origin}})).status,403);
 }
 const rebinding=await new Promise((resolve,reject)=>{
  const req=request(base+'/status',{headers:{...auth(readKey),host:'rebinding.test'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end();
 });
 assert.equal(rebinding,403);
 const trustedOrigin=await fetch(base+'/mcp',{method:'OPTIONS',headers:{origin:'https://trusted-ui.test'}});
 assert.equal(trustedOrigin.status,204);assert.equal(trustedOrigin.headers.get('access-control-allow-origin'),'https://trusted-ui.test');
});

test('two authorized AI clients search and read only their own server concurrently',{timeout:6000},async t=>{
 const [a,b]=await Promise.all([fixture(t,'ALFA'),fixture(t,'BETA')]);
 assert.equal((await fetch(b.base+'/mcp',{method:'POST',headers:{'content-type':'application/json',...auth(a.readKey)},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})})).status,401);
 const clients=[new Client({name:'ai-a',version:'1.0.0'}),new Client({name:'ai-b',version:'1.0.0'})];
 t.after(()=>Promise.all(clients.map(c=>c.close())));
 await Promise.all(clients.map((c,i)=>c.connect(new StreamableHTTPClientTransport(new URL([a,b][i].base+'/mcp'),{requestInit:{headers:auth([a,b][i].readKey)}}))));
 const results=await Promise.all(clients.map(c=>c.callTool({name:'search_memory',arguments:{query:'memoria ficticia exclusiva'}})));
 for(const [i,answer] of results.entries()){
  const own=i===0?'ALFA':'BETA',other=i===0?'BETA':'ALFA';
  assert.ok(JSON.stringify(answer).includes(own));assert.ok(!JSON.stringify(answer).includes(other));
  const ref=answer.structuredContent.memories[0].sources[0];
  const source=await clients[i].callTool({name:'read_memory_source',arguments:{source_uid:ref.source_uid,revision:ref.revision}});
  assert.ok(source.structuredContent.text.includes(own));
  const scopes=await clients[i].callTool({name:'list_memory_scopes',arguments:{}});assert.equal(scopes.structuredContent.conversations[0].id,'chat-'+own);
 }
});
