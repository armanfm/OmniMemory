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
  if(typeof args.source_uid!=='string'||args.source_uid.length>256)throw Error('Invalid source.');
  if(args.limit!==undefined&&(!Number.isInteger(args.limit)||args.limit<1||args.limit>24000))throw Error('Invalid limit.');
  if(args.offset!==undefined&&(!Number.isInteger(args.offset)||args.offset<0))throw Error('Invalid offset.');
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
  if(existsSync(credentialPath)){
   if(!safeStorage.isEncryptionAvailable())throw Error('Windows credential protection is unavailable.');
   this.credentials=JSON.parse(safeStorage.decryptString(readFileSync(credentialPath)));
  }
 }
 persist(){if(!this.safeStorage.isEncryptionAvailable())throw Error('Credential protection is unavailable.');const tmp=this.credentialPath+'.tmp';writeFileSync(tmp,this.safeStorage.encryptString(JSON.stringify(this.credentials)));renameSync(tmp,this.credentialPath);}
 async request(route,{body,authorized=true}={}){
  const response=await this.fetcher(this.origin+route,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json','user-agent':'OmniMemoryDesktop/0.2.0',...(authorized&&this.credentials?{'x-omni-device':'Bearer '+this.credentials.token}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
  const value=await response.json();if(!response.ok){const e=Error(value.error??'Connection unavailable.');e.status=response.status;throw e;}return value;
 }
 start(){this.stopped=false;this.schedule(0);}
 schedule(ms){clearTimeout(this.timer);if(!this.stopped)this.timer=setTimeout(()=>this.tick(),ms);}
 async connect(){
  if(this.credentials){const state=await this.request('/device/state');if(state.approved&&!this.credentials.revocationPending){this.status='connected';return {approved:true};}if(this.credentials.revocationPending)throw Error('Wait for the previous connection to be revoked.');if(this.credentials.created>Date.now()-600000){await this.openURL(this.credentials.approvalUrl);return {approved:false,code:this.credentials.code};}this.credentials=null;rmSync(this.credentialPath,{force:true});}
  const result=await this.request('/device/start',{body:{name:this.deviceName},authorized:false});
  this.credentials={...result,created:Date.now()};this.persist();this.status='awaiting_approval';await this.openURL(result.approvalUrl);this.start();return {approved:false,code:result.code};
 }
 async tick(){if(this.stopped||this.inflight)return;this.inflight=true;
 try{
  if(!this.credentials){this.status='disconnected';return;}
  if(this.credentials.revocationPending){this.status='revoking';await this.request('/device/revoke',{body:{}});this.credentials=null;rmSync(this.credentialPath,{force:true});this.status='disconnected';return;}
  const state=await this.request('/device/state');if(!state.approved){this.status='awaiting_approval';return;}
  const {jobs=[]}=await this.request('/device/poll',{body:{}});this.status='connected';
  for(const job of jobs){let result;try{const value=executeLocalTool(this.store,job.name,job.args);result={structuredContent:value,content:[{type:'text',text:JSON.stringify(value)}]};}catch(e){result={isError:true,content:[{type:'text',text:e.message}]};}
   try{await this.request('/device/result',{body:{id:job.id,result}});}catch(e){if(e.status!==410)throw e;}
  }
 }catch(e){if(e.status===401){this.status='revoked';this.credentials=null;rmSync(this.credentialPath,{force:true});}else this.status=this.credentials?.revocationPending?'revoking':'offline';}
 finally{this.inflight=false;this.schedule(this.status==='connected'?2000:5000);}
 }
 async disconnect(){if(this.credentials){this.credentials.revocationPending=true;this.persist();this.status='revoking';try{await this.request('/device/revoke',{body:{}});}catch{this.start();return;}}this.credentials=null;rmSync(this.credentialPath,{force:true});this.status='disconnected';}
 stop(){this.stopped=true;clearTimeout(this.timer);}
}
