import {existsSync,readFileSync,writeFileSync,renameSync,rmSync} from 'node:fs';
import {contextualRecall,needsContextualRecall} from '../core/lib/contextual.js';
// Personal recovery build only. Do NOT distribute with this account-specific bridge origin.
export const DEFAULT_BRIDGE_ORIGIN='https://omnimemory-connect-armando.crisp-comet-3717.chatgpt.site';
export function validateBridgeOrigin(value){
 if(typeof value!=='string'||value.length>2048)throw Error('Enter a valid HTTPS bridge URL.');
 let u;try{u=new URL(value);}catch{throw Error('Enter a valid bridge URL.');}
 if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.pathname!=='/'||!u.hostname)throw Error('Use an HTTPS origin without path, query or credentials.');
 return u.origin;
}
export function executeLocalTool(store,name,args){
 if(!args||typeof args!=='object'||Array.isArray(args))throw Error('Invalid arguments.');
 const allowed={search_memory:['query','top_k','conversation_id','collection_id'],investigate_memory:['query','top_k','conversation_id','collection_id'],read_memory_source:['source_uid','limit','offset','revision'],list_memory_scopes:['limit','offset']};
 if(!Object.hasOwn(allowed,name)||Object.keys(args).some(k=>!allowed[name].includes(k)))throw Error('Tool or argument not allowed.');
 for(const k of ['conversation_id','collection_id'])if(args[k]!==undefined&&(typeof args[k]!=='string'||!args[k]||args[k].length>256))throw Error('Invalid scope.');
 if(name==='search_memory'){
  if(typeof args.query!=='string'||!args.query.trim()||args.query.length>2000)throw Error('Invalid search.');
  if(args.top_k!==undefined&&(!Number.isInteger(args.top_k)||args.top_k<1||args.top_k>20))throw Error('Invalid limit.');
  const {query,...options}=args;return needsContextualRecall(query)?contextualRecall(store,query,options):store.search(query,options);
 }
 if(name==='investigate_memory'){
  if(typeof args.query!=='string'||!args.query.trim()||args.query.length>2000)throw Error('Invalid investigation query.');
  if(args.top_k!==undefined&&(!Number.isInteger(args.top_k)||args.top_k<1||args.top_k>20))throw Error('Invalid limit.');
  if(args.conversation_id!==undefined&&typeof args.conversation_id!=='string')throw Error('Invalid conversation scope.');
  if(args.collection_id!==undefined&&typeof args.collection_id!=='string')throw Error('Invalid collection scope.');
  const {query,...options}=args;return contextualRecall(store,query,options);
 }
 if(name==='read_memory_source'){
  if(typeof args.source_uid!=='string'||!args.source_uid||args.source_uid.length>256)throw Error('Invalid source.');
  if(args.limit!==undefined&&(!Number.isInteger(args.limit)||args.limit<1||args.limit>24000))throw Error('Invalid limit.');
  if(args.offset!==undefined&&(!Number.isInteger(args.offset)||args.offset<0))throw Error('Invalid offset.');
  if(args.revision!==undefined&&(!Number.isInteger(args.revision)||args.revision<1))throw Error('Invalid revision.');
  const {source_uid,...options}=args;return store.source(source_uid,options)??{found:false};
 }
 if(name==='list_memory_scopes'){
  const {limit=100,offset=0}=args;if(!Number.isInteger(limit)||limit<1||limit>200||!Number.isInteger(offset)||offset<0)throw Error('Invalid limit.');
  return {conversations:store.listConversations(limit,offset),collections:store.collections(),files:[...store.sources.values()].filter(s=>s.kind==='file').sort((a,b)=>a.id-b.id).slice(offset,offset+limit).map(s=>({source_uid:s.uid,filename:s.filename,index_mode:s.index_mode,revision:s.revision})),total_files:store.stats().total_files,limit,offset};
 }
 throw Error('Tool not allowed.');
}
export class BridgeClient {
 constructor({credentialPath,safeStorage,store,openURL,deviceName,fetcher=fetch,origin}){
  this.origin=validateBridgeOrigin(origin);
  Object.assign(this,{credentialPath,safeStorage,store,openURL,deviceName,fetcher});this.status='disconnected';this.stopped=false;this.credentials=null;this.timer=null;this.inflight=false;
  this.epoch=0;this.controllers=new Set();this.connectPromise=null;this.disconnectPromise=null;
  if(existsSync(credentialPath)){
   if(!safeStorage.isEncryptionAvailable())throw Error('Windows credential protection is unavailable.');
   this.credentials=JSON.parse(safeStorage.decryptString(readFileSync(credentialPath)));
  }
 }
 persist(){if(!this.safeStorage.isEncryptionAvailable())throw Error('Credential protection is unavailable.');const tmp=this.credentialPath+'.tmp';writeFileSync(tmp,this.safeStorage.encryptString(JSON.stringify(this.credentials)),{mode:0o600});renameSync(tmp,this.credentialPath);}
 invalidate(){this.epoch++;for(const controller of this.controllers)controller.abort();this.controllers.clear();}
 assertCurrent(epoch,credentials,authorized){if(epoch!==this.epoch||(authorized&&(!credentials||credentials!==this.credentials))){const e=Error('Connection changed.');e.name='AbortError';throw e;}}
 async request(route,{body,authorized=true,epoch=this.epoch,credentials=this.credentials}={}){
  this.assertCurrent(epoch,credentials,authorized);
  const controller=new AbortController();this.controllers.add(controller);
  try{
   const response=await this.fetcher(this.origin+route,{method:body===undefined?'GET':'POST',redirect:'error',headers:{'content-type':'application/json','user-agent':'OmniMemoryDesktop/0.2.1',...(authorized?{'x-omni-device':'Bearer '+credentials.token}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(10000)])});
   this.assertCurrent(epoch,credentials,authorized);
   const value=await response.json();this.assertCurrent(epoch,credentials,authorized);
   if(!response.ok){const e=Error(value.error??'Connection unavailable.');e.status=response.status;throw e;}return value;
  }finally{this.controllers.delete(controller);}
 }
 start(){this.stopped=false;this.schedule(0);}
 schedule(ms){clearTimeout(this.timer);if(!this.stopped)this.timer=setTimeout(()=>this.tick(),ms);}
 connect(){
  if(this.disconnectPromise||this.credentials?.revocationPending)return Promise.reject(Error('Wait for the previous connection to be revoked.'));
  if(!this.connectPromise)this.connectPromise=this.connectOnce().finally(()=>{this.connectPromise=null;});
  return this.connectPromise;
 }
 async connectOnce(){
  const epoch=this.epoch,previous=this.credentials;
  if(previous){
   const state=await this.request('/device/state',{epoch,credentials:previous});this.assertCurrent(epoch,previous,true);
   if(state.approved&&!previous.revocationPending){this.status='connected';return {approved:true};}
   if(previous.revocationPending)throw Error('Wait for the previous connection to be revoked.');
   if(previous.created>Date.now()-600000){await this.openURL(previous.approvalUrl);this.assertCurrent(epoch,previous,true);return {approved:false,code:previous.code};}
   this.credentials=null;rmSync(this.credentialPath,{force:true});
  }
  const result=await this.request('/device/start',{body:{name:this.deviceName},authorized:false,epoch});this.assertCurrent(epoch,null,false);
  const approval=new URL(result.approvalUrl);
  if(approval.origin!==this.origin||approval.protocol!=='https:'||approval.username||approval.password)throw Error('Invalid approval address.');
  if(!/^[a-f0-9]{64}$/.test(result.token??''))throw Error('Invalid device credential.');
  this.credentials={...result,created:Date.now()};const credentials=this.credentials;
  this.persist();this.status='awaiting_approval';await this.openURL(result.approvalUrl);this.assertCurrent(epoch,credentials,true);this.start();return {approved:false,code:result.code};
 }
 async tick(){if(this.stopped||this.inflight)return;this.inflight=true;const epoch=this.epoch,credentials=this.credentials;
 const current=()=>!this.stopped&&epoch===this.epoch&&credentials===this.credentials;
 const request=(route,options={})=>this.request(route,{...options,epoch,credentials});
 try{
  if(!this.credentials){this.status='disconnected';return;}
  if(credentials.revocationPending){this.status='revoking';await request('/device/revoke',{body:{}});if(!current())return;this.credentials=null;rmSync(this.credentialPath,{force:true});this.status='disconnected';return;}
  const state=await request('/device/state');if(!current()||credentials.revocationPending)return;if(!state.approved){this.status='awaiting_approval';return;}
  const {jobs=[]}=await request('/device/poll',{body:{}});if(!current()||credentials.revocationPending)return;this.status='connected';
  if(!Array.isArray(jobs)||jobs.length>10)throw Error('Invalid pending jobs.');
  for(const job of jobs){
   if(!current()||credentials.revocationPending)return;
   let result;try{const value=executeLocalTool(this.store,job.name,job.args);result={structuredContent:value,content:[{type:'text',text:JSON.stringify(value)}]};}catch(e){result={isError:true,content:[{type:'text',text:e.message}]};}
   if(!current()||credentials.revocationPending)return;
   try{await request('/device/result',{body:{id:job.id,result}});}catch(e){if(e.status!==410)throw e;}
  }
 }catch(e){if(!current())return;if(e.status===401){this.invalidate();this.status='revoked';this.credentials=null;rmSync(this.credentialPath,{force:true});}else this.status=this.credentials?.revocationPending?'revoking':'offline';}
 finally{this.inflight=false;this.schedule(this.status==='connected'?2000:5000);}
 }
 disconnect(){
  if(this.disconnectPromise)return this.disconnectPromise;
  this.invalidate();this.disconnectPromise=this.disconnectOnce().finally(()=>{this.disconnectPromise=null;});return this.disconnectPromise;
 }
 async disconnectOnce(){
  const epoch=this.epoch,credentials=this.credentials;
  if(credentials){credentials.revocationPending=true;this.persist();this.status='revoking';try{await this.request('/device/revoke',{body:{},epoch,credentials});}catch(e){if(epoch!==this.epoch)return;if(e.status!==401){this.start();return;}}}
  if(epoch!==this.epoch)return;
  this.credentials=null;rmSync(this.credentialPath,{force:true});this.status='disconnected';
 }
 stop(){this.stopped=true;this.invalidate();clearTimeout(this.timer);}
}
