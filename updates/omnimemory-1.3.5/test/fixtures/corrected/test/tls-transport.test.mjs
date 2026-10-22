import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer,connect} from 'node:net';
import {request} from 'node:https';
import {createApp} from '../core/server.js';
import {MemoryStore} from '../core/lib/store.js';

test('authenticated MCP works over a TLS 1.3 passthrough without exposing plaintext to the relay',{timeout:12000},async t=>{
 const dir=mkdtempSync(join(tmpdir(),'omni-tls-'));
 // Public test fixtures for a reserved hostname. Trusted only by this test client;
 // never used for production or installed in the system certificate store.
 const key=readFileSync(new URL('./fixtures/tls/test-only-key.pem',import.meta.url));
 const cert=readFileSync(new URL('./fixtures/tls/test-only-cert.pem',import.meta.url));
 const readKey='tls-read-secret-for-test-only',marker='TRECHO_FICTICIO_SOMENTE_IA';
 const store=new MemoryStore(join(dir,'memory.jsonl'));
 store.capture([{conversation_id:'chat-tls',message_id:'tls-msg',role:'user',text:marker}]);
 const app=createApp({store,key:'capture-secret-for-tls-test',readKey,fileDir:join(dir,'files'),allowedHosts:['omni.test'],tls:{key,cert}});
 await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
 const captured=[],sockets=new Set();let applicationRequests=0;
 app.on('request',()=>{applicationRequests++;});app.on('tlsClientError',()=>{});
 const relay=createServer(inbound=>{
  const outbound=connect(app.address().port,'127.0.0.1');
  for(const s of [inbound,outbound]){sockets.add(s);s.on('close',()=>sockets.delete(s));s.on('error',()=>{inbound.destroy();outbound.destroy();});}
  inbound.on('data',b=>captured.push(Buffer.from(b)));outbound.on('data',b=>captured.push(Buffer.from(b)));
  inbound.pipe(outbound);outbound.pipe(inbound);
 });
 await new Promise(resolve=>relay.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{for(const s of sockets)s.destroy();app.closeAllConnections();await Promise.all([new Promise(r=>relay.close(r)),new Promise(r=>app.close(r))]);store.close();rmSync(dir,{recursive:true,force:true});});
 const query=JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'search_memory',arguments:{query:marker}}});
 async function call({credential=readKey,trusted=true}={}){
  return new Promise((resolve,reject)=>{
   const req=request({hostname:'127.0.0.1',port:relay.address().port,servername:'omni.test',path:'/mcp',method:'POST',agent:false,...(trusted?{ca:cert}:{}),minVersion:'TLSv1.3',headers:{host:'omni.test',authorization:'Bearer '+credential,'content-type':'application/json',accept:'application/json, text/event-stream','content-length':Buffer.byteLength(query)}},res=>{
    const protocol=res.socket.getProtocol(),chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>resolve({status:res.statusCode,protocol,body:Buffer.concat(chunks).toString()}));
   });req.on('error',reject);req.end(query);
  });
 }
 const answer=await call();assert.equal(answer.status,200);assert.equal(answer.protocol,'TLSv1.3');assert.ok(answer.body.includes(marker));
 const intercepted=Buffer.concat(captured);
 assert.ok(intercepted.length>0);assert.equal(intercepted.includes(Buffer.from(marker)),false);assert.equal(intercepted.includes(Buffer.from(readKey)),false);assert.equal(intercepted.includes(Buffer.from('search_memory')),false);
 const denied=await call({credential:'wrong-read-secret'});assert.equal(denied.status,401);assert.ok(!denied.body.includes(marker));
 const before=applicationRequests;await assert.rejects(call({trusted:false}),/self-signed|certificate/i);assert.equal(applicationRequests,before);
});
