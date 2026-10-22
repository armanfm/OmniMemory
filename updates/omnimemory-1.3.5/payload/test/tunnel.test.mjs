import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {TunnelClient,childEnvironment,pollState,verifiedRuntime} from '../desktop/tunnel-client.mjs';
import {TunnelVault,validateTunnelConfig} from '../desktop/tunnel-vault.mjs';
import {createApp} from '../core/server.js';
import {MemoryStore} from '../core/lib/store.js';

const config=n=>({tunnelId:'tunnel_'+n.repeat(32),apiKey:'sk-test-only-'+n.repeat(40)});
function encryptedStorage(){
  const key=randomBytes(32);
  return {isEncryptionAvailable:()=>true,encryptString(s){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv);const b=Buffer.concat([c.update(s,'utf8'),c.final()]);return Buffer.concat([iv,c.getAuthTag(),b]);},decryptString(b){const c=createDecipheriv('aes-256-gcm',key,b.subarray(0,12));c.setAuthTag(b.subarray(12,28));return Buffer.concat([c.update(b.subarray(28)),c.final()]).toString();}};
}
function fixture(t,name='a',options={}){
  const dir=mkdtempSync(join(tmpdir(),'omni-tunnel-test-')),store=new MemoryStore(join(dir,'memory.jsonl'));
  store.capture([{conversation_id:'chat-'+name,message_id:'msg-'+name,role:'user',text:'exclusivo canario-'+name}]);
  const vault=new TunnelVault(join(dir,'tunnel-connection.bin'),encryptedStorage());
  const children=[],runs=[];let health={status:'ok',details:{consecutive_failures:0,last_success:new Date().toISOString()}};
  const spawnClient=(exe,args,opt)=>{
    const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.killed=false;child.kill=()=>{child.killed=true;queueMicrotask(()=>child.emit('exit',0));};
    children.push(child);runs.push({exe,args,opt});
    writeFileSync(args[args.indexOf('--health.url-file')+1],'http://127.0.0.1:43210');queueMicrotask(()=>child.emit('spawn'));
    return child;
  };
  const client=new TunnelClient({store,fileDir:join(dir,'files'),vault,runtimeDir:dir,platform:'win32',verify:()=>join(dir,'tunnel-client.exe'),spawnClient,fetcher:async()=>Response.json(health),...options});
  t.after(()=>{client.stop();store.close();rmSync(dir,{force:true,recursive:true});});
  return {dir,store,vault,client,children,runs,setHealth:s=>{health=s;}};
}
async function ai(t,run){
  const client=new Client({name:'authorized-test-ai',version:'1'});t.after(()=>client.close());
  await client.connect(new StreamableHTTPClientTransport(new URL(run.args[run.args.indexOf('--mcp.server-url')+1]),{requestInit:{headers:{'x-omni-read-key':run.opt.env.OMNI_TUNNEL_LOCAL_KEY}}}));
  return client;
}

test('credentials are encrypted, validated and never returned through status',async t=>{
  const f=fixture(t);await f.client.start(config('a'));
  const saved=readFileSync(f.vault.file);assert.ok(!saved.includes(Buffer.from(config('a').apiKey)));assert.deepEqual(f.vault.read(),config('a'));
  assert.ok(!JSON.stringify(f.client.status()).includes('sk-'));assert.equal(f.client.state,'connected');
  f.vault.safeStorage.isEncryptionAvailable=()=>false;assert.throws(()=>f.vault.write(config('b')),/indisponivel/);
  assert.throws(()=>validateTunnelConfig({...config('a'),apiKey:'senha inventada'}));
  assert.throws(()=>validateTunnelConfig({...config('a'),tunnelId:'../archive'}));
  assert.throws(()=>validateTunnelConfig({...config('a'),apiKey:config('a').apiKey+'\n'}));
});

test('only a separate local read credential reaches the child; no key in command arguments or inherited archive secrets',async t=>{
  const f=fixture(t);await f.client.start(config('a'));const {args,opt}=f.runs[0];
  assert.ok(!args.join(' ').includes(config('a').apiKey));assert.ok(!args.join(' ').includes(opt.env.OMNI_TUNNEL_LOCAL_KEY));
  assert.ok(args.includes('X-Omni-Read-Key: env:OMNI_TUNNEL_LOCAL_KEY'));assert.ok(!args.includes('--embedded-stateless-mcp-stub'));assert.equal(opt.shell,false);
  const env=childEnvironment(config('a'),'synthetic-read-secret',{PATH:'test-path',OMNI_MEMORY_PASSPHRASE:'archive-secret',OPENAI_ADMIN_KEY:'admin-secret',MCP_SERVER_URL:'https://foreign.invalid',LOG_HTTP_RAW_UNSAFE:'true'});
  assert.equal(env.PATH,'test-path');for(const k of ['OMNI_MEMORY_PASSPHRASE','OPENAI_ADMIN_KEY','MCP_SERVER_URL','LOG_HTTP_RAW_UNSAFE'])assert.equal(env[k],undefined);
});

test('real MCP catalog, search, investigation, source reads and scope listing work through the authenticated client binding',async t=>{
  const f=fixture(t);await f.client.start(config('a'));const c=await ai(t,f.runs[0]);
  const catalog=await c.listTools();assert.equal(catalog.tools.length,6);assert.ok(catalog.tools.every(x=>x.annotations.readOnlyHint));
  const info=await c.callTool({name:'server_info',arguments:{}});assert.equal(info.structuredContent.mode,'real-memory');
  const echo=await c.callTool({name:'echo',arguments:{input:'OMNIMEMORY-TUNEL-OK'}});assert.equal(echo.structuredContent.echoed,'OMNIMEMORY-TUNEL-OK');
  const result=await c.callTool({name:'search_memory',arguments:{query:'exclusivo'}});assert.ok(JSON.stringify(result).includes('canario-a'));
  const ref=result.structuredContent.memories[0].sources[0];const source=await c.callTool({name:'read_memory_source',arguments:{source_uid:ref.source_uid,revision:ref.revision}});assert.ok(source.structuredContent.text.includes('canario-a'));
  const investigation=await c.callTool({name:'investigate_memory',arguments:{query:'exclusivo',top_k:2}});assert.equal(investigation.structuredContent.mode,'contextual_adaptive');
  const scopes=await c.callTool({name:'list_memory_scopes',arguments:{}});assert.equal(scopes.structuredContent.conversations[0].id,'chat-a');
  await assert.rejects(()=>c.callTool({name:'exec_command',arguments:{command:'whoami'}}),/not found/);
  await assert.rejects(()=>c.callTool({name:'read_memory_source',arguments:{source_uid:ref.source_uid,limit:24001}}),/24000|validation|Invalid/i);
  const base=new URL(f.runs[0].args[f.runs[0].args.indexOf('--mcp.server-url')+1]).origin;
  for(const suffix of ['/status','/mcp'])assert.equal((await fetch(base+suffix)).status,401);
  assert.equal((await fetch(base+'/capture/batch',{method:'POST',headers:{'x-omni-read-key':f.runs[0].opt.env.OMNI_TUNNEL_LOCAL_KEY},body:'{}'})).status,404);
});

test('two independent devices reject swapped credentials, source IDs and conversation IDs during concurrent queries',async t=>{
  const a=fixture(t,'a'),b=fixture(t,'b');await Promise.all([a.client.start(config('a')),b.client.start(config('b'))]);
  const [ca,cb]=await Promise.all([ai(t,a.runs[0]),ai(t,b.runs[0])]);
  const [ra,rb]=await Promise.all([ca,cb].map(c=>c.callTool({name:'search_memory',arguments:{query:'exclusivo'}})));
  assert.ok(!JSON.stringify(ra).includes('canario-b'));assert.ok(!JSON.stringify(rb).includes('canario-a'));
  const foreignRef=ra.structuredContent.memories[0].sources[0];
  const foreignRead=await cb.callTool({name:'read_memory_source',arguments:{source_uid:foreignRef.source_uid}});assert.equal(foreignRead.structuredContent.found,false);
  const foreignScope=await cb.callTool({name:'search_memory',arguments:{query:'exclusivo',conversation_id:'chat-a'}});assert.equal(foreignScope.structuredContent.memories.length,0);
  const url=b.runs[0].args[b.runs[0].args.indexOf('--mcp.server-url')+1];assert.equal((await fetch(url,{method:'POST',headers:{'x-omni-read-key':a.runs[0].opt.env.OMNI_TUNNEL_LOCAL_KEY},body:'{}'})).status,401);
});

test('disconnect kills the client, closes active MCP reads, removes saved key and never restores after late health response',async t=>{
  let finish;let delayed=false;const f=fixture(t,'a',{fetcher:async()=>delayed?new Promise(resolve=>{finish=resolve;}):Response.json({details:{last_success:'now'}})});
  await f.client.start(config('a'));const c=await ai(t,f.runs[0]),run=f.client.active,url=f.runs[0].args[f.runs[0].args.indexOf('--mcp.server-url')+1];
  delayed=true;const observation=f.client.observe(run);f.client.disconnect();finish(Response.json({details:{last_success:'later'}}));await observation;
  assert.equal(f.client.state,'disconnected');assert.equal(existsSync(f.vault.file),false);assert.equal(f.children[0].killed,true);
  await assert.rejects(()=>c.callTool({name:'search_memory',arguments:{query:'exclusivo'}},{},{timeout:1000}));await assert.rejects(()=>fetch(url));
});

test('key rotation closes the previous binding and uses a fresh local credential; old child exit cannot stop the new client',async t=>{
  const f=fixture(t);await f.client.start(config('a'));const first=f.runs[0],child=f.children[0];await f.client.start(config('b'));
  assert.notEqual(first.opt.env.OMNI_TUNNEL_LOCAL_KEY,f.runs[1].opt.env.OMNI_TUNNEL_LOCAL_KEY);child.emit('exit',1);assert.equal(f.client.state,'connected');
  const c=await ai(t,f.runs[1]);assert.equal((await c.callTool({name:'server_info',arguments:{}})).structuredContent.mode,'real-memory');
});

test('simultaneous configuration attempts cannot leave a second active client',async t=>{
  const f=fixture(t);const first=f.client.start(config('a'));await assert.rejects(()=>f.client.start(config('b')),/Aguarde/);await first;assert.equal(f.children.length,1);
});

test('failed spawn and failed secure persistence close the listener and refuse to save plaintext',async t=>{
  const f=fixture(t,'a',{spawnClient:()=>{throw Error('synthetic spawn failure');}});await assert.rejects(()=>f.client.start(config('a')));assert.equal(f.client.active,null);assert.equal(existsSync(f.vault.file),false);
  const g=fixture(t,'b');g.vault.safeStorage.isEncryptionAvailable=()=>false;await assert.rejects(()=>g.client.start(config('b')),/indisponivel/);assert.equal(g.client.active,null);assert.equal(g.children[0].killed,true);
});

test('corrupt protected config is not silently replaced, and readiness alone never means authenticated',async t=>{
  const f=fixture(t);writeFileSync(f.vault.file,'corrupted-encrypted-key');await f.client.restore();assert.equal(f.client.state,'configuration_error');assert.equal(readFileSync(f.vault.file,'utf8'),'corrupted-encrypted-key');assert.equal(f.children.length,0);
  assert.equal(pollState({status:'ok',ready:true,details:{}}),'starting');assert.equal(pollState({details:{http_status:401,last_success:'yesterday',consecutive_failures:5}}),'unauthorized');assert.equal(pollState({details:{consecutive_failures:1,last_success:'yesterday'}}),'offline');
  assert.throws(()=>verifiedRuntime(f.dir));
});

test('revocation during a tool invocation suppresses the result, even with an already authenticated request',async t=>{
  let enabled=true;const dir=mkdtempSync(join(tmpdir(),'omni-revoke-test-'));
  const app=createApp({store:{source:()=>{enabled=false;return {text:'NEVER-RETURN-THIS-CANARY'};}},key:'synthetic-capture-secret',readKey:'synthetic-read-secret',fileDir:join(dir,'files'),mcpOnly:true,isReadEnabled:()=>enabled});
  await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));t.after(()=>{app.closeAllConnections();app.close();rmSync(dir,{force:true,recursive:true});});
  const c=new Client({name:'test-ai',version:'1'});t.after(()=>c.close());const url='http://127.0.0.1:'+app.address().port+'/mcp';
  await c.connect(new StreamableHTTPClientTransport(new URL(url),{requestInit:{headers:{'x-omni-read-key':'synthetic-read-secret'}}}));
  const result=await c.callTool({name:'read_memory_source',arguments:{source_uid:'synthetic-source'}});assert.equal(result.isError,true);assert.ok(!JSON.stringify(result).includes('NEVER-RETURN'));
  assert.equal((await fetch(url,{method:'POST',headers:{'x-omni-read-key':'synthetic-read-secret'},body:'{}'})).status,401);
});

test('disconnect during client startup prevents late credential persistence and listener revival',async t=>{
 let child,argsSeen,optSeen;
 const f=fixture(t,'a',{spawnClient:(exe,args,opt)=>{argsSeen=args;optSeen=opt;child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{queueMicrotask(()=>child.emit('exit',0));};return child;}});
 const pending=f.client.start(config('a'));
 // Wait for the listener to bind and the child to be created, without completing spawn.
 for(let i=0;i<10&&!child;i++)await new Promise(resolve=>setImmediate(resolve));
 assert.ok(child);f.client.disconnect();child.emit('spawn');await assert.rejects(()=>pending,/cancelada|encerrado/);
 assert.equal(f.client.state,'disconnected');assert.equal(f.vault.read(),null);assert.equal(f.client.active,null);
 const url=argsSeen[argsSeen.indexOf('--mcp.server-url')+1];await assert.rejects(()=>fetch(url,{headers:{'x-omni-read-key':optSeen.env.OMNI_TUNNEL_LOCAL_KEY}}));
});
