(() => {
  const acknowledged=new Map(),inflightFiles=new Set(),finishedFiles=new Set();
  const deferredFiles=[];
  let draftSubmission=null;
  let debounce=null,lastUrl=location.href,busy=false,again=false,retryTimer=null;
  const conversationId=()=>location.pathname.match(/\/c\/([^/?#]+)/)?.[1]??null;
  function send(message){return new Promise(resolve=>chrome.runtime.sendMessage(message,response=>{
    if(chrome.runtime.lastError)resolve({ok:false,error:chrome.runtime.lastError.message});else resolve(response??{ok:false});
  }));}
  function stableID(node){
    const turn=node.getAttribute('data-turn-key')?node:node.closest('[data-turn-key]');
    // Preserve legacy capture IDs when a turn represents a single message.
    if(turn && (turn.querySelectorAll?.('[data-message-author-role]').length??1)<=1)return turn.getAttribute('data-turn-key');
    return node.getAttribute('data-message-id')||node.querySelector('[data-message-id]')?.getAttribute('data-message-id')||node.id||null;
  }
  function parse(node){
    const roleNode=node.matches('[data-message-author-role]')?node:node.querySelector('[data-message-author-role]');
    let role=roleNode?.getAttribute('data-message-author-role');
    const content=roleNode??node;let text=(content.innerText||content.textContent||'').replace(/\u00a0/g,' ').trim();
    if(!['user','assistant'].includes(role)){
      if(/^(Você disse:|Voce disse:|You said:)\s*/i.test(text))role='user';
      else if(/^(ChatGPT disse:|ChatGPT said:)\s*/i.test(text)||node.querySelector('.MarkdownRoot,[data-markdown]'))role='assistant';else return null;
    }
    text=text.replace(/^(Você disse:|Voce disse:|You said:|ChatGPT disse:|ChatGPT said:)\s*/i,'').trim();
    const id=stableID(roleNode??node);if(!id||!text)return null;
    return {message_id:id,role,text};
  }
  function collectNodes(){
    // Prefer leaf message nodes to prevent a whole turn from mixing roles or duplicating text.
    const roles=[...document.querySelectorAll('[data-message-author-role]')];
    if(roles.length)return roles.filter(n=>!n.querySelector('[data-message-author-role]'));
    return [...document.querySelectorAll('[data-turn-key]')].filter(n=>!n.querySelector('[data-turn-key]'));
  }
  async function collect(){
    if(busy){again=true;return;}
    const conv=conversationId();if(!conv)return;
    busy=true;
    try{
      const unique=new Map();for(const node of collectNodes()){const m=parse(node);if(m)unique.set(m.message_id,m);}
      const visible=[...unique.values()],batch=[];let previous;
      for(const m of visible){
        if(m.text.length>2_000_000){console.warn('[OmniMemory] Mensagem muito longa para a captura atual.');previous=m.message_id;continue;}
        const record={...m,conversation_id:conv,url:location.href};
        // Absence of a visible predecessor must not erase a previously known relationship.
        if(previous)record.previous_message_id=previous;
        previous=m.message_id;
        const fingerprint=m.role+'\n'+m.text+'\n'+(record.previous_message_id??'');
        const key=conv+'::'+m.message_id;
        if(acknowledged.get(key)!==fingerprint)batch.push({record,key,fingerprint});
      }
      if(batch.length){
        for(let i=0;i<batch.length;i+=100){const part=batch.slice(i,i+100);
          const response=await send({type:'OMNI_CAPTURE_BATCH',messages:part.map(x=>x.record),conversation_id:conv,visible_messages:visible.length});
          if(response.ok){for(const item of part)acknowledged.set(item.key,item.fingerprint);}
          else {console.warn('[OmniMemory] Falha ao enfileirar; nova tentativa agendada.',response.error);clearTimeout(retryTimer);retryTimer=setTimeout(schedule,5000);break;}
        }
      }
      await send({type:'OMNI_OBSERVATION',conversation_id:conv,visible_messages:visible.length});
    }finally{busy=false;if(again){again=false;schedule();}}
  }
  function schedule(){clearTimeout(debounce);debounce=setTimeout(collect,1200);}
  function toBase64(bytes){let s='';for(let i=0;i<bytes.length;i+=0x8000)s+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(s);}
  async function upload(file,conv,attempt=0){
    if(file.size>100*1024*1024){console.warn('[OmniMemory] Limite por arquivo: 100 MiB.',file.name);return;}
    const signature=[conv,file.name,file.size,file.lastModified,file.type].join('|');
    if(inflightFiles.has(signature)||finishedFiles.has(signature))return;
    inflightFiles.add(signature);let id;
    try{
      // Server verifies bytes and uses SHA-256 content identity; the upload ID is only a transport handle.
      const started=await send({type:'OMNI_FILE',action:'start',body:{conversation_id:conv,file_id:crypto.randomUUID(),filename:file.name,
        mime:file.type,size:file.size,last_modified:file.lastModified,url:location.href}});
      if(!started.ok)throw new Error(started.error);id=started.data.upload_id;
      for(let offset=0;offset<file.size;offset+=512*1024){
        const bytes=new Uint8Array(await file.slice(offset,offset+512*1024).arrayBuffer());
        const r=await send({type:'OMNI_FILE',action:'chunk',body:{upload_id:id,offset,base64:toBase64(bytes)}});if(!r.ok)throw new Error(r.error);
      }
      const ended=await send({type:'OMNI_FILE',action:'end',body:{upload_id:id}});if(!ended.ok)throw new Error(ended.error);
      finishedFiles.add(signature);
    }catch(e){
      if(id)await send({type:'OMNI_FILE',action:'abort',body:{upload_id:id}});
      console.warn('[OmniMemory] Arquivo pendente:',file.name,e.message);
      if(attempt<5)setTimeout(()=>upload(file,conv,attempt+1),Math.min(60000,5000*2**attempt));
    }finally{inflightFiles.delete(signature);}
  }
  function filesSelected(list){
    const conv=conversationId();for(const file of [...(list??[])]){
      if(!(file instanceof File))continue;
      if(conv)void upload(file,conv);else deferredFiles.push({file,draftUrl:location.href});
    }
  }
  function noteDraftSubmission(){if(!conversationId())draftSubmission={url:location.href,at:Date.now()};}
  document.addEventListener('submit',noteDraftSubmission,true);
  document.addEventListener('click',e=>{if(e.target?.closest?.('button[data-testid="send-button"]'))noteDraftSubmission();},true);
  document.addEventListener('keydown',e=>{
    if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&(e.target?.matches?.('textarea,[contenteditable="true"]')||e.target?.closest?.('[contenteditable="true"]')))noteDraftSubmission();
  },true);
  document.addEventListener('change',e=>{if(e.target instanceof HTMLInputElement&&e.target.type==='file')filesSelected(e.target.files);},true);
  document.addEventListener('drop',e=>filesSelected(e.dataTransfer?.files),true);
  new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true,characterData:true});
  setInterval(()=>{
    if(location.href!==lastUrl){
      const previousUrl=lastUrl;lastUrl=location.href;acknowledged.clear();
      const conv=conversationId();
      // Files selected on a draft are attached only when that same draft obtains a conversation URL.
      for(let i=deferredFiles.length-1;i>=0;i--){const item=deferredFiles[i];
        if(conv&&item.draftUrl===previousUrl&&draftSubmission?.url===previousUrl&&Date.now()-draftSubmission.at<120000){deferredFiles.splice(i,1);void upload(item.file,conv);}
        else if(item.draftUrl!==location.href){deferredFiles.splice(i,1);console.warn('[OmniMemory] Conversa do arquivo não confirmada. Selecione novamente:',item.file.name);}
      }
      draftSubmission=null;schedule();
    }
  },1000);
  setInterval(collect,15000); // Also recovers a failed content-to-worker delivery without a DOM mutation.
  window.addEventListener('online',()=>{void send({type:'OMNI_RETRY'});schedule();});
  setTimeout(collect,1200);
  console.log('[OmniMemory] Captura ativa. Histórico não carregado permanece fora da captura.');
})();
