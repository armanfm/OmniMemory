import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const background=readFileSync(new URL('../extension/background.js',import.meta.url),'utf8');
function worker(shared,fetcher){
 let listener;
 const ctx=vm.createContext({TextEncoder,AbortController,setTimeout,clearTimeout,importScripts(){},OMNI_CONFIG:{base:'http://127.0.0.1:8787',key:'unit-test-key'},fetch:fetcher,
 chrome:{storage:{local:{async get(keys){return Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,structuredClone(shared[k])]));},async set(values){Object.assign(shared,structuredClone(values));}}},action:{async setBadgeText(){},async setBadgeBackgroundColor(){}},alarms:{create(){},onAlarm:{addListener(){}}},runtime:{onMessage:{addListener(fn){listener=fn;}},onStartup:{addListener(){}},onInstalled:{addListener(){}}}}});
 vm.runInContext(background,ctx);
 return msg=>new Promise(resolve=>listener(msg,{},resolve));
}
test('extension durable outbox survives offline delivery and worker restart',async()=>{
 const shared={};let attempts=0;
 const send=worker(shared,async()=>{attempts++;throw new Error('offline');});
 const message={conversation_id:'c',message_id:'m',role:'user',text:'Conteúdo original'};
 const first=await send({type:'OMNI_CAPTURE_BATCH',messages:[message],visible_messages:1});assert.equal(first.ok,true);assert.equal(first.queued,true);assert.equal(Object.keys(shared.outbox).length,1);
 await send({type:'OMNI_CAPTURE_BATCH',messages:[{...message,text:'Conteúdo atualizado'}],visible_messages:1});assert.equal(Object.keys(shared.outbox).length,1);
 let received;
 const restarted=worker(shared,async(url,init)=>{received=JSON.parse(init.body);return {ok:true,async json(){return {ok:true,accepted:received.messages.length};}};});
 const retry=await restarted({type:'OMNI_RETRY'});assert.equal(retry.ok,true);assert.equal(received.messages[0].text,'Conteúdo atualizado');assert.equal(Object.keys(shared.outbox).length,0);assert.equal(attempts,2);
});
test('extension retains outbox when server does not acknowledge the complete batch',async()=>{
 const shared={};const send=worker(shared,async()=>({ok:true,async json(){return {ok:true,accepted:0};}}));
 await send({type:'OMNI_CAPTURE_BATCH',messages:[{conversation_id:'c',message_id:'m',text:'teste'}]});assert.equal(Object.keys(shared.outbox).length,1);
});
const content=readFileSync(new URL('../extension/content.js',import.meta.url),'utf8');
function contentHarness(path='/c/test'){
 const calls=[],timers=[];let fail=true;
 const node={innerText:'Texto capturado',textContent:'Texto capturado',id:'',matches:()=>true,
   getAttribute:k=>({'data-message-author-role':'user','data-message-id':'z'}[k]??null),querySelector:()=>null,closest:()=>null};
 const ctx=vm.createContext({location:{href:'https://chatgpt.com'+path,pathname:path},document:{querySelectorAll:()=>[node],documentElement:{},addEventListener(){}},window:{addEventListener(){}},
  MutationObserver:class{observe(){}},setTimeout(fn){timers.push(fn);return timers.length;},clearTimeout(){},setInterval(){},console:{log(){},warn(){}},
  chrome:{runtime:{sendMessage(m,cb){calls.push(m);cb({ok:!fail});}}}});
 vm.runInContext(content,ctx);return {calls,timers,succeed(){fail=false;}};
}
test('content script retries unacknowledged text without dropping it',async()=>{
 const h=contentHarness();await h.timers[0]();h.succeed();await h.timers[0]();await h.timers[0]();assert.equal(h.calls.filter(x=>x.type==='OMNI_CAPTURE_BATCH').length,2);
});
test('content script does not mix draft chats under a shared fallback ID',async()=>{
 const h=contentHarness('/');await h.timers[0]();assert.equal(h.calls.length,0);
});
