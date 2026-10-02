import { CONFIG, tokenize, scoreChunk, chunkText, hash, matchInfo, wordCount } from './text.js';
import { Journal } from './journal.js';
import { TokenPostings } from './postings.js';
import { typoMatches } from './typos.js';
const now=()=>new Date().toISOString();
const sourceUID=(kind,conversation,id)=>hash(JSON.stringify([kind,conversation,id]));
const cmp=(a,b)=>a.sort_order-b.sort_order||a.source_pk-b.source_pk||a.part-b.part;
const groupKey=r=>r.kind==='file'?'file:'+r.uid:'chat:'+r.conversation_id;

export class MemoryStore {
  constructor(path,options={}) {
    this.tables={sources:new Map(),conversations:new Map(),settings:new Map(),collections:new Map(),tombstones:new Map(),audit:new Map()};
    this.sources=this.tables.sources;this.chunks=new Map();this.bySource=new Map();this.groups=new Map();this.byConversation=new Map();
    this.postings=new Map();this.groupCache=new Map();
    this.counts={total_messages:0,total_files:0,total_chunks:0,tokens:0};
    this.nextSource=1;this.nextChunk=1;this.nextAudit=1;this.pending=null;this.closed=false;
    this.journal=new Journal(path,options);
    try{this.journal.load(e=>this.apply(e,false));for(const s of this.sources.values())this.addIndex(s);}
    catch(e){this.journal.close();throw e;}
  }
  apply(event,index=true) {
    const [table,key,value]=event;const map=this.tables[table];if(!map)throw new Error('Unknown journal table: '+table);
    const old=map.get(key);
    if(table==='sources') {
      if(index&&old)this.removeIndex(old);
      if(old){this.counts[old.kind==='chat'?'total_messages':'total_files']--;this.byConversation.get(old.conversation_id)?.delete(key);}
      if(value){
        this.counts[value.kind==='chat'?'total_messages':'total_files']++;
        if(!this.byConversation.has(value.conversation_id))this.byConversation.set(value.conversation_id,new Set());
        this.byConversation.get(value.conversation_id).add(key);
        this.nextSource=Math.max(this.nextSource,value.id+1);this.nextChunk=Math.max(this.nextChunk,value.chunk_start+value.chunk_count);
      }
    }
    if(value===null)map.delete(key);else map.set(key,value);
    if(table==='sources'&&value&&index)this.addIndex(value);
    if(table==='audit'&&value)this.nextAudit=Math.max(this.nextAudit,value.id+1);
  }
  put(table,key,value) {
    if(!this.pending)return this.transaction(()=>this.put(table,key,value));
    const eventKey=table+'\0'+key;
    if(!this.undo.has(eventKey))this.undo.set(eventKey,[table,key,this.tables[table].get(key)??null]);
    this.apply([table,key,value]);this.pending.set(eventKey,[table,key,value]);
  }
  begin() {
    if(this.closed)throw new Error('Memory is closed.');if(this.pending)throw new Error('A memory transaction is already active.');
    if(this.journal.readOnly)throw new Error('Memory was opened read-only.');
    this.pending=new Map();this.undo=new Map();this.previousIds=[this.nextSource,this.nextChunk,this.nextAudit];
  }
  commit(){if(!this.pending)throw new Error('No active transaction.');this.journal.append([...this.pending.values()]);this.pending=null;this.undo=null;}
  rollback(){if(!this.pending)return;for(const e of [...this.undo.values()].reverse())this.apply(e);[this.nextSource,this.nextChunk,this.nextAudit]=this.previousIds;this.pending=null;this.undo=null;}
  transaction(fn) {
    if(this.pending)return fn();this.begin();
    try{const result=fn();if(result?.then)throw new Error('Use explicit begin/commit for asynchronous imports.');this.commit();return result;}catch(e){this.rollback();throw e;}
  }
  setting(key){return this.tables.settings.get(key);}
  setSetting(key,value){this.put('settings',key,String(value));}
  log(action,details){this.transaction(()=>{const id=this.nextAudit++;this.put('audit',String(id),{id,at:now(),action,details:JSON.stringify(details)});});}
  ensureConversation(id,url='') {
    const old=this.tables.conversations.get(id);
    this.put('conversations',id,{id,url:old?.url??'',visible_messages:0,coverage:'observed_only',order_warning:null,...old,last_seen:now(),...(url?{url}:{})});
  }
  setCoverage(id,coverage){const c=this.tables.conversations.get(id);if(c)this.put('conversations',id,{...c,coverage});}
  blocked(kind,key){return this.tables.tombstones.has(kind+'\0'+key);}
  upsertSource(raw) {
    if(!this.pending)return this.transaction(()=>this.upsertSource(raw));
    const kind=raw.kind??'chat',conv=String(raw.conversation_id??'').trim(),sid=String(raw.source_id??raw.message_id??raw.file_id??'').trim();
    if(!['chat','file'].includes(kind)||!conv||!sid)throw new Error('A source requires a valid kind, conversation_id and source_id.');
    const uid=sourceUID(kind,conv,sid);
    if(this.blocked('conversation',conv)||this.blocked('source',uid))return {changed:false,blocked:true,uid};
    const text=String(raw.text??''),digest=hash(text),old=this.sources.get(uid),role=kind==='chat'?(raw.role==='assistant'?'assistant':'user'):null;
    this.ensureConversation(conv,String(raw.url??''));
    const previous=raw.previous_message_id===undefined?(old?.previous_id??null):raw.previous_message_id;
    const changed=!old||old.content_hash!==digest||old.role!==role||old.filename!==(raw.filename??null);
    if(!changed){
      const updated={...old,previous_id:previous,saved_path:raw.saved_path??old.saved_path,url:String(raw.url??'')||old.url};
      if(JSON.stringify(updated)!==JSON.stringify(old))this.put('sources',uid,updated);
      return {changed:false,uid};
    }
    const updated=String(raw.captured_at??now()),parts=chunkText(text);
    const siblings=[...(this.byConversation.get(conv)??[])].map(id=>this.sources.get(id)).filter(s=>s.kind===kind);
    const order=old?.sort_order??(siblings.reduce((n,s)=>Math.max(n,s.sort_order),0)+1);
    const source={id:old?.id??this.nextSource++,uid,kind,conversation_id:conv,source_id:sid,role,filename:raw.filename??null,mime:raw.mime??null,
      saved_path:raw.saved_path??null,size:raw.size??Buffer.byteLength(text),text,content_hash:digest,revision:old?old.revision+1:1,
      first_seen:old?.first_seen??updated,updated_at:updated,sort_order:order,previous_id:previous,url:String(raw.url??''),index_mode:raw.index_mode??'text',
      chunk_start:this.nextChunk,chunk_count:parts.length};
    this.nextChunk+=parts.length;this.put('sources',uid,source);return {changed:true,uid};
  }
  addIndex(s) {
    const ids=[];const key=groupKey(s);if(!this.groups.has(key))this.groups.set(key,new Set());
    for(const ch of chunkText(s.text)) {
      const id=s.chunk_start+ch.part,tokens=tokenize(ch.text+' '+ch.section+' '+(s.filename??''));
      const row={id,source_pk:s.id,part:ch.part,start:ch.start,end:ch.end,section:ch.section,text:ch.text,tokens,uid:s.uid,kind:s.kind,conversation_id:s.conversation_id,source_id:s.source_id,role:s.role,filename:s.filename,revision:s.revision,content_hash:s.content_hash,updated_at:s.updated_at,sort_order:s.sort_order};this.chunks.set(id,row);ids.push(id);this.groups.get(key).add(id);
      for(let i=0;i<tokens.length;i++){
        const t=tokens[i];let entry=this.postings.get(t);
        if(!entry){entry=new TokenPostings(t);this.postings.set(t,entry);}
        // Share one canonical string for repeated words across all chunks.
        tokens[i]=entry.token;entry.appendUnique(id);
      }
    }
    this.bySource.set(s.uid,ids);this.groupCache.delete(key);this.counts.total_chunks=this.chunks.size;this.counts.tokens=this.postings.size;
  }
  removeIndex(s) {
    const key=groupKey(s);
    for(const id of this.bySource.get(s.uid)??[]){const row=this.chunks.get(id);
      for(const t of row.tokens){const ids=this.postings.get(t);ids.delete(id);if(!ids.size){
        this.postings.delete(t);
      }}this.chunks.delete(id);this.groups.get(key)?.delete(id);
    }
    this.bySource.delete(s.uid);if(!this.groups.get(key)?.size)this.groups.delete(key);this.groupCache.delete(key);
    this.counts.total_chunks=this.chunks.size;this.counts.tokens=this.postings.size;
  }
  capture(messages,{conversation_id,visible_messages}={}) {
    if(!Array.isArray(messages)||messages.length>1000)throw new Error('messages must be an array of at most 1000 records.');
    return this.transaction(()=>{let changed=0,blocked=0;const conversations=new Set();
      for(const m of messages){if(!String(m.text??'').trim())continue;if(String(m.text).length>2_000_000)throw new Error('Message exceeds 2 million characters.');
        const r=this.upsertSource({...m,kind:'chat'});changed+=Number(r.changed);blocked+=Number(!!r.blocked);if(!r.blocked)conversations.add(String(m.conversation_id).trim());}
      for(const id of conversations)this.reorderConversation(id);
      if(conversation_id&&!this.blocked('conversation',conversation_id)){this.ensureConversation(conversation_id);this.put('conversations',conversation_id,{...this.tables.conversations.get(conversation_id),visible_messages:Number.isSafeInteger(visible_messages)?visible_messages:messages.length,last_seen:now()});}
      return {changed,blocked,accepted:messages.length};
    });
  }
  reorderConversation(conv) {
    const rows=[...(this.byConversation.get(conv)??[])].map(id=>this.sources.get(id)).filter(s=>s.kind==='chat').sort((a,b)=>a.sort_order-b.sort_order||a.id-b.id);
    const byId=new Map(rows.map(r=>[r.source_id,r])),children=new Map(),degree=new Map(rows.map(r=>[r.source_id,0]));
    for(const r of rows)if(r.previous_id&&byId.has(r.previous_id)&&r.previous_id!==r.source_id){if(!children.has(r.previous_id))children.set(r.previous_id,[]);children.get(r.previous_id).push(r.source_id);degree.set(r.source_id,1);}
    const ready=rows.filter(r=>degree.get(r.source_id)===0).reverse(),ordered=[];
    while(ready.length){const r=ready.pop();ordered.push(r);const next=children.get(r.source_id)??[];for(let i=next.length-1;i>=0;i--){degree.set(next[i],degree.get(next[i])-1);if(degree.get(next[i])===0)ready.push(byId.get(next[i]));}}
    const c=this.tables.conversations.get(conv);if(!c)return;
    const warning=ordered.length!==rows.length?'Conflicting predecessor observations; retained previous order.':null;
    if(c.order_warning!==warning)this.put('conversations',conv,{...c,order_warning:warning});if(warning)return;
    ordered.forEach((r,i)=>{if(r.sort_order!==i+1)this.put('sources',r.uid,{...r,sort_order:i+1});});
  }
  allowed(row,{conversation_id,collection_id}={}) {
    if(conversation_id&&row.conversation_id!==conversation_id)return false;
    if(collection_id){const c=this.tables.collections.get(collection_id);if(!c||(!c.conversations.includes(row.conversation_id)&&!c.sources.includes(row.uid)))return false;}
    return true;
  }
  orderedGroup(hit,scope={}){
    const key=groupKey(hit);if(!this.groupCache.has(key))this.groupCache.set(key,[...(this.groups.get(key)??[])].map(id=>this.chunks.get(id)).sort(cmp));
    const rows=this.groupCache.get(key);return scope.collection_id?rows.filter(r=>this.allowed(r,scope)):rows;
  }
  search(query,{top_k=CONFIG.topK,conversation_id,collection_id}={}) {
    if(this.closed)throw new Error('Memory is closed.');const started=performance.now();
    if(typeof query!=='string'||!query.trim()||query.length>2000)throw new Error('query must contain 1 to 2000 characters.');
    if(!Number.isInteger(top_k)||top_k<1||top_k>20)throw new Error('top_k must be from 1 to 20.');
    const allTokens=tokenize(query),queryTokens=allTokens.slice(0,32),scope={conversation_id,collection_id},corrections=new Map(),fuzzy=[];
    const hasScopedToken=token=>{
      const postings=this.postings.get(token);if(!postings)return false;
      if(!conversation_id&&!collection_id)return true;
      for(const id of postings)if(this.allowed(this.chunks.get(id),scope))return true;
      return false;
    };
    const matchedCounts=new Map(),exactCounts=new Map();
    for(const q of queryTokens){
      const exact=hasScopedToken(q),terms=exact?[q]:typoMatches(q,hasScopedToken);
      if(!exact&&terms.length){corrections.set(q,terms);fuzzy.push({query_token:q,matches:terms,method:'single_edit'});}
      const ids=new Set();
      for(const term of terms)for(const id of this.postings.get(term))if(this.allowed(this.chunks.get(id),scope))ids.add(id);
      for(const id of ids){matchedCounts.set(id,(matchedCounts.get(id)??0)+1);if(exact)exactCounts.set(id,(exactCounts.get(id)??0)+1);}
    }
    const candidates=matchedCounts.size;
    const rows=[...matchedCounts.keys()].sort((a,b)=>matchedCounts.get(b)-matchedCounts.get(a)||(exactCounts.get(b)??0)-(exactCounts.get(a)??0)||a-b).slice(0,CONFIG.maxCandidates).map(id=>this.chunks.get(id));
    const ranked=rows.map(r=>{const info=matchInfo(queryTokens,r,corrections);return {...r,...info,score:scoreChunk(queryTokens,r,info.matched_word_count)};})
      .filter(r=>r.score>0).sort((a,b)=>b.matched_word_count-a.matched_word_count||b.exact_word_count-a.exact_word_count||b.score-a.score||a.id-b.id);
    const bestMatchCount=ranked[0]?.matched_word_count??0;
    // Keep candidates with at least half the best matched-word count, rounded up.
    // The same rule applies to every candidate; a one-word query has a minimum of one.
    const minimumMatchedWords=Math.ceil(bestMatchCount/2);
    const eligible=ranked.filter(r=>r.matched_word_count>=minimumMatchedWords);
    const scored=eligible.slice(0,top_k);
    const ranges=new Map();
    for(const hit of scored) {
      const neighbors=this.neighbors(hit,scope);
      const group=hit.kind==='file'?'file:'+hit.uid:'chat:'+hit.conversation_id;
      if(!ranges.has(group))ranges.set(group,[]);
      const parts=ranges.get(group); const ids=new Set(neighbors.map(n=>n.id));
      const overlapping=parts.filter(p=>p.rows.some(n=>ids.has(n.id)));
      let combined=neighbors,hits=[hit];
      for(const p of overlapping){combined.push(...p.rows);hits.push(...p.hits);parts.splice(parts.indexOf(p),1);}
      combined=[...new Map(combined.map(c=>[c.id,c])).values()].sort((a,b)=>a.sort_order-b.sort_order||a.source_pk-b.source_pk||a.part-b.part);
      parts.push({rows:combined,hits});
    }
    // Merge immediately adjacent windows as well as overlapping windows.
    for(const [group,parts] of ranges) {
      parts.sort((a,b)=>a.rows[0].sort_order-b.rows[0].sort_order||a.rows[0].part-b.rows[0].part);
      const merged=[];
      for(const part of parts) {
        const last=merged.at(-1),end=last?.rows.at(-1),start=part.rows[0];let adjacent=false;
        if(end) {
          if(end.kind==='file')adjacent=end.source_pk===start.source_pk&&end.part+1===start.part;
          else {
            const ordered=this.orderedGroup(end,scope);
            adjacent=ordered.findIndex(r=>r.id===start.id)===ordered.findIndex(r=>r.id===end.id)+1;
          }
        }
        if(adjacent){last.rows.push(...part.rows);last.hits.push(...part.hits);}else merged.push(part);
      }
      ranges.set(group,merged);
    }
    const windows=[...ranges.values()].flat().sort((a,b)=>Math.max(...b.hits.map(h=>h.matched_word_count))-Math.max(...a.hits.map(h=>h.matched_word_count))||Math.max(...b.hits.map(h=>h.exact_word_count))-Math.max(...a.hits.map(h=>h.exact_word_count))||Math.max(...b.hits.map(h=>h.score))-Math.max(...a.hits.map(h=>h.score))||a.rows[0].id-b.rows[0].id);
    const memories=[];let used=0;
    for(const window of windows) {
      const assembled=window.rows.map(r=>({r,text:(r.kind==='file'?`FILE: ${r.filename}`:r.role.toUpperCase())+
        (r.section?` | ${r.section}`:'')+'\n'+r.text}));
      let remaining=CONFIG.maxExpandedChars-used-(memories.length?5:0);
      if(remaining<=0)break;
      // Spend the budget on the hit first if its surrounding window cannot fit.
      let selected=assembled;
      if(assembled.reduce((n,x)=>n+x.text.length+2,0)>remaining) {
        const hitIds=new Set(window.hits.map(h=>h.id));selected=assembled.filter(x=>hitIds.has(x.r.id));
      }
      const refs=[],texts=[];let truncated=false;
      for(const item of selected) {
        const room=remaining-(texts.length?2:0);if(room<=0){truncated=true;break;}
        const out=item.text.slice(0,room);texts.push(out);remaining-=out.length+(texts.length>1?2:0);
        const r=item.r;refs.push({source_uid:r.uid,source_id:r.source_id,revision:r.revision,content_hash:r.content_hash,
          chunk_id:r.id,part:r.part,start:r.start,end:r.end,section:r.section,captured_at:r.updated_at});
        if(out.length<item.text.length){truncated=true;break;}
      }
      if(!texts.length)continue;
      const first=window.rows[0],text=texts.join('\n\n');
      memories.push({source_type:first.kind,conversation_id:first.conversation_id,filename:first.filename,
        best_score:Number(Math.max(...window.hits.map(h=>h.score)).toFixed(6)),hits:window.hits.map(h=>h.id),
        sources:refs,truncated,context_reduced:selected!==assembled,matched_words:[...new Set(window.hits.flatMap(h=>h.matched_words))],matched_word_count:Math.max(...window.hits.map(h=>h.matched_word_count)),word_count:wordCount(text),text});
      used+=text.length+(memories.length>1?5:0);
    }
    return {query,query_tokens:queryTokens,query_truncated:allTokens.length>32,scope:{conversation_id:conversation_id??null,collection_id:collection_id??null},
      ...this.stats(),match_mode:"exact_with_typo_fallback",candidates,candidates_scored:rows.length,weak_hits_filtered:ranked.length-eligible.length,best_matched_word_count:bestMatchCount,minimum_matched_words:minimumMatchedWords,ranking:"matched_words_then_exact_words_then_score",min_context_words:CONFIG.minContextWords,candidates_truncated:candidates>rows.length,fuzzy_matches:fuzzy,
      latency_ms:Number((performance.now()-started).toFixed(3)),memories};
  }
  neighbors(hit,scope={}) {
    const rows=this.orderedGroup(hit,scope),i=rows.findIndex(r=>r.id===hit.id);
    const before=rows.slice(Math.max(0,i-CONFIG.maxContextNeighbors),i).reverse(),after=rows.slice(i+1,i+1+CONFIG.maxContextNeighbors);
    let left=Math.min(CONFIG.neighborsBefore,before.length),right=Math.min(CONFIG.neighborsAfter,after.length);
    const count=()=>wordCount(hit.text)+before.slice(0,left).reduce((n,c)=>n+wordCount(c.text),0)+after.slice(0,right).reduce((n,c)=>n+wordCount(c.text),0);
    while(count()<CONFIG.minContextWords&&left+right<CONFIG.maxContextNeighbors&&(left<before.length||right<after.length)){
      if(right<after.length)right++;if(count()<CONFIG.minContextWords&&left+right<CONFIG.maxContextNeighbors&&left<before.length)left++;
    }
    return [...before.slice(0,left).reverse(),hit,...after.slice(0,right)];
  }
  source(uid,{offset=0,limit=24000,revision}={}) {
    if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>24000)throw new Error('Invalid source range.');
    const row=this.sources.get(uid);if(!row)return null;
    if(revision!==undefined&&revision!==row.revision)throw new Error('Source has changed; search again for the current revision.');
    const {text,saved_path,chunk_start,chunk_count,...meta}=row;return {...meta,text:text.slice(offset,offset+limit),offset,next_offset:offset+limit<text.length?offset+limit:null,total_chars:text.length};
  }
  stats(){return {...this.counts};}
  listConversations(limit=100,offset=0){return [...this.tables.conversations.values()].sort((a,b)=>b.last_seen.localeCompare(a.last_seen)||a.id.localeCompare(b.id)).slice(offset,offset+limit).map(c=>{
    const sources=[...(this.byConversation.get(c.id)??[])].map(uid=>this.sources.get(uid));return {...c,messages:sources.filter(s=>s.kind==='chat').length,files:sources.filter(s=>s.kind==='file').length};});}
  listSources(limit=100,offset=0){return [...this.sources.values()].sort((a,b)=>a.id-b.id).slice(offset,offset+limit).map(({uid,kind,conversation_id,source_id,filename,revision,index_mode})=>({uid,kind,conversation_id,source_id,filename,revision,index_mode}));}
  collections(){return [...this.tables.collections.keys()].sort().map(id=>({id}));}
  addCollection(id,{conversation_id,source_uid}={}) {
    if(!id?.trim())throw new Error('Collection name required.');
    if(conversation_id&&!this.tables.conversations.has(conversation_id))throw new Error('Unknown conversation.');if(source_uid&&!this.sources.has(source_uid))throw new Error('Unknown source.');
    return this.transaction(()=>{const old=this.tables.collections.get(id)??{id,conversations:[],sources:[]};
      this.put('collections',id,{id,conversations:[...new Set([...old.conversations,...(conversation_id?[conversation_id]:[])])],sources:[...new Set([...old.sources,...(source_uid?[source_uid]:[])])]});
      this.log('collection_add',{id,conversation_id,source_uid});return {id};});
  }
  removeCollection(id){return this.transaction(()=>{const removed=Number(this.tables.collections.has(id));this.put('collections',id,null);this.log('collection_remove',{id});return {removed};});}
  duplicates(){const groups=new Map();for(const s of this.sources.values()){const key=JSON.stringify([s.kind,s.role,s.content_hash]);if(!groups.has(key))groups.set(key,{kind:s.kind,role:s.role,content_hash:s.content_hash,ids:[]});groups.get(key).ids.push(s.uid);}return [...groups.values()].filter(g=>g.ids.length>1).sort((a,b)=>b.ids.length-a.ids.length).slice(0,200).map(({ids,...g})=>({...g,count:ids.length,source_uids:ids.join(',')}));}
  deleteTarget(kind,key){
    if(!['conversation','source'].includes(kind))throw new Error('Unknown delete target.');
    return this.transaction(()=>{this.put('tombstones',kind+'\0'+key,{kind,key,deleted_at:now()});
      const removed=Number(kind==='conversation'?this.tables.conversations.has(key):this.sources.has(key));
      const ids=kind==='conversation'?[...(this.byConversation.get(key)??[])]:[key],deleted=new Set(ids);
      for(const id of ids)this.put('sources',id,null);if(kind==='conversation')this.put('conversations',key,null);
      for(const [id,c]of this.tables.collections)this.put('collections',id,{...c,conversations:c.conversations.filter(v=>kind!=='conversation'||v!==key),sources:c.sources.filter(v=>!deleted.has(v))});
      this.log('delete',{kind,key});return {removed,recapture_blocked:true};});
  }
  allowRecapture(kind,key){if(!['conversation','source'].includes(kind))throw new Error('Unknown delete target.');this.transaction(()=>{this.put('tombstones',kind+'\0'+key,null);this.log('allow_recapture',{kind,key});});}
  snapshot(){return Object.entries(this.tables).flatMap(([table,map])=>[...map].map(([key,value])=>[table,key,value]));}
  backup(path){if(path===this.journal.path)throw new Error('Backup destination must differ from active memory.');this.journal.snapshot(this.snapshot(),path);return path;}
  compact(){if(this.pending)throw new Error('Cannot compact during a transaction.');this.log('compact',{});this.journal.snapshot(this.snapshot());}
  close(){if(this.closed)return;this.rollback();this.journal.close();this.closed=true;}
}
