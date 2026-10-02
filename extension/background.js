importScripts('config.js');
const {base,key}=globalThis.OMNI_CONFIG;
let serial=Promise.resolve();
const exclusively=fn=>{const work=serial.then(fn,fn);serial=work.catch(()=>{});return work;};
async function post(path,body) {
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),15000);
  try {
    const response=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json','x-omni-key':key},body:JSON.stringify(body),signal:controller.signal});
    const data=await response.json();if(!response.ok||!data.ok)throw new Error(data.error??`HTTP ${response.status}`);
    return data;
  }finally{clearTimeout(timeout);}
}
async function flush() {
  const {outbox={},capture_status={}}=await chrome.storage.local.get(['outbox','capture_status']);
  let status=capture_status;
  const entries=Object.entries(outbox);let sent=0;
  while(entries.length){
    const group=[],firstConv=entries[0][1].conversation_id;let bytes=0;
    for(let i=0;i<entries.length&&group.length<100;){
      const item=entries[i];const n=new TextEncoder().encode(JSON.stringify(item[1])).length;
      if(item[1].conversation_id!==firstConv){i++;continue;}
      if(group.length&&bytes+n>8_000_000)break;
      group.push(item);bytes+=n;entries.splice(i,1);
    }
    try{
      const response=await post('/capture/batch',{messages:group.map(x=>x[1]),conversation_id:firstConv,
        visible_messages:group[0][1].observed_visible_messages});
      if(response.accepted!==group.length)throw new Error('Servidor não confirmou o lote completo.');
      for(const [id] of group)delete outbox[id];sent+=group.length;
      status={...status,last_success:new Date().toISOString(),last_error:null,pending:Object.keys(outbox).length};
      await chrome.storage.local.set({outbox,capture_status:status});
    }catch(error){
      await chrome.storage.local.set({capture_status:{...status,last_error:error.message,pending:Object.keys(outbox).length}});
      await chrome.action.setBadgeText({text:'!'});await chrome.action.setBadgeBackgroundColor({color:'#b45309'});
      return {ok:true,queued:true,pending:Object.keys(outbox).length,error:error.message};
    }
  }
  await chrome.action.setBadgeText({text:''});return {ok:true,queued:false,sent,pending:0};
}
async function enqueue(message) {
  const {outbox={}}=await chrome.storage.local.get('outbox');
  for(const m of message.messages??[])outbox[m.conversation_id+'::'+m.message_id]={...m,observed_visible_messages:message.visible_messages};
  await chrome.storage.local.set({outbox}); // Durable acknowledgement precedes transport; never drop on network failure.
  return flush();
}
chrome.runtime.onMessage.addListener((m,sender,respond)=>{
  let task;
  if(m?.type==='OMNI_CAPTURE_BATCH')task=exclusively(()=>enqueue(m));
  else if(m?.type==='OMNI_RETRY')task=exclusively(flush);
  else if(m?.type==='OMNI_FILE'){
    const allowed=new Set(['start','chunk','end','abort']);
    if(!allowed.has(m.action)){respond({ok:false,error:'Unknown file action'});return false;}
    task=post('/capture/file/'+m.action,m.body).then(data=>({ok:true,data}));
  }else if(m?.type==='OMNI_OBSERVATION'){
    task=chrome.storage.local.set({observation:{conversation_id:m.conversation_id,visible_messages:m.visible_messages,
      observed_at:new Date().toISOString(),coverage:'Somente conteúdo carregado na página'}}).then(()=>({ok:true}));
  }else return false;
  task.then(respond).catch(e=>respond({ok:false,error:e.message}));return true;
});
chrome.alarms.create('omni-retry',{periodInMinutes:1});
chrome.alarms.onAlarm.addListener(a=>{if(a.name==='omni-retry')void exclusively(flush).catch(()=>{});});
chrome.runtime.onStartup.addListener(()=>{void exclusively(flush).catch(()=>{});});
chrome.runtime.onInstalled.addListener(()=>{void exclusively(flush).catch(()=>{});});
