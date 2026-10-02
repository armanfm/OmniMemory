import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { CONFIG, tokenize, bigrams, similarity, scoreChunk, chunkText, hash, matchInfo, wordCount } from './text.js';

const now=()=>new Date().toISOString();
const marks=n=>Array(n).fill('?').join(',');
const encoded=token=>'t'+Buffer.from(token).toString('hex');
const sourceUID=(kind,conversation,id)=>hash(JSON.stringify([kind,conversation,id]));
const nullable=v=>v===undefined ? null : v;

export class MemoryStore {
  constructor(path) {
    if(path!==':memory:') mkdirSync(dirname(path),{recursive:true});
    this.db=new DatabaseSync(path,{timeout:5000});
    this.statements=new Map();
    this.db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;');
    const version=this.db.prepare('PRAGMA user_version').get().user_version;
    if(version>1) throw new Error('This database was created by a newer OmniMemory. Update the application.');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS conversations(id TEXT PRIMARY KEY,url TEXT NOT NULL DEFAULT '',last_seen TEXT,
        visible_messages INTEGER NOT NULL DEFAULT 0,coverage TEXT NOT NULL DEFAULT 'observed_only',order_warning TEXT);
      CREATE TABLE IF NOT EXISTS sources(id INTEGER PRIMARY KEY AUTOINCREMENT,uid TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL CHECK(kind IN ('chat','file')),conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        source_id TEXT NOT NULL,role TEXT,filename TEXT,mime TEXT,saved_path TEXT,size INTEGER NOT NULL DEFAULT 0,
        text TEXT NOT NULL,content_hash TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,
        first_seen TEXT NOT NULL,updated_at TEXT NOT NULL,sort_order INTEGER NOT NULL,previous_id TEXT,url TEXT NOT NULL DEFAULT '',
        index_mode TEXT NOT NULL DEFAULT 'text',UNIQUE(kind,conversation_id,source_id));
      CREATE INDEX IF NOT EXISTS source_order ON sources(conversation_id,kind,sort_order,id);
      CREATE TABLE IF NOT EXISTS chunks(id INTEGER PRIMARY KEY AUTOINCREMENT,source_pk INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
        part INTEGER NOT NULL,start INTEGER NOT NULL,end INTEGER NOT NULL,section TEXT NOT NULL,text TEXT NOT NULL,tokens TEXT NOT NULL,
        UNIQUE(source_pk,part));
      CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(tokens);
      CREATE TRIGGER IF NOT EXISTS chunk_deleted AFTER DELETE ON chunks BEGIN DELETE FROM chunks_fts WHERE rowid=old.id; END;
      CREATE TABLE IF NOT EXISTS vocabulary(token TEXT PRIMARY KEY,gram_count INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS token_grams(gram TEXT NOT NULL,token TEXT NOT NULL REFERENCES vocabulary(token) ON DELETE CASCADE,PRIMARY KEY(gram,token));
      CREATE TABLE IF NOT EXISTS chunk_tokens(chunk_id INTEGER NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
        token TEXT NOT NULL REFERENCES vocabulary(token),PRIMARY KEY(chunk_id,token));
      CREATE INDEX IF NOT EXISTS token_chunks ON chunk_tokens(token,chunk_id);
      CREATE TABLE IF NOT EXISTS collections(id TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS collection_conversations(collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,PRIMARY KEY(collection_id,conversation_id));
      CREATE TABLE IF NOT EXISTS collection_sources(collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
        source_uid TEXT NOT NULL REFERENCES sources(uid) ON DELETE CASCADE,PRIMARY KEY(collection_id,source_uid));
      CREATE TABLE IF NOT EXISTS tombstones(kind TEXT NOT NULL,key TEXT NOT NULL,deleted_at TEXT NOT NULL,PRIMARY KEY(kind,key));
      CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT,at TEXT NOT NULL,action TEXT NOT NULL,details TEXT NOT NULL);
      PRAGMA user_version=1;
    `);
  }
  stmt(sql) { if(!this.statements.has(sql)) this.statements.set(sql,this.db.prepare(sql)); return this.statements.get(sql); }
  transaction(fn) {
    if(this.db.isTransaction) return fn();
    this.db.exec('BEGIN IMMEDIATE');
    try { const r=fn(); this.db.exec('COMMIT'); return r; } catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  setting(key) {return this.stmt('SELECT value FROM settings WHERE key=?').get(key)?.value;}
  setSetting(key,value) {this.stmt('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,String(value));}
  log(action,details) {this.stmt('INSERT INTO audit(at,action,details) VALUES(?,?,?)').run(now(),action,JSON.stringify(details));}
  ensureConversation(id,url='') {
    this.stmt("INSERT INTO conversations(id,url,last_seen) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET last_seen=excluded.last_seen,url=CASE WHEN excluded.url<>'' THEN excluded.url ELSE conversations.url END").run(id,url,now());
  }
  blocked(kind,key) {return !!this.stmt('SELECT 1 FROM tombstones WHERE kind=? AND key=?').get(kind,key);}
  upsertSource(raw) {
    const kind=raw.kind??'chat', conv=String(raw.conversation_id??'').trim(), sid=String(raw.source_id??raw.message_id??raw.file_id??'').trim();
    if(!['chat','file'].includes(kind)||!conv||!sid) throw new Error('A source requires a valid kind, conversation_id and source_id.');
    const uid=sourceUID(kind,conv,sid);
    if(this.blocked('conversation',conv)||this.blocked('source',uid)) return {changed:false,blocked:true,uid};
    const text=String(raw.text??'');
    const digest=hash(text); const old=this.stmt('SELECT * FROM sources WHERE uid=?').get(uid);
    const role=kind==='chat' ? (raw.role==='assistant'?'assistant':'user') : null;
    this.ensureConversation(conv,String(raw.url??''));
    const updated=String(raw.captured_at??now());
    const previous=raw.previous_message_id===undefined ? (old?.previous_id??null) : raw.previous_message_id;
    const order=old?.sort_order??(this.stmt('SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM sources WHERE conversation_id=? AND kind=?').get(conv,kind).n);
    const changed=!old||old.content_hash!==digest||old.role!==role||old.filename!==(raw.filename??null);
    if(!changed) {
      this.stmt('UPDATE sources SET previous_id=?,saved_path=COALESCE(?,saved_path),url=CASE WHEN ?<>\'\' THEN ? ELSE url END WHERE id=?')
        .run(previous,nullable(raw.saved_path),String(raw.url??''),String(raw.url??''),old.id);
      return {changed:false,uid};
    }
    this.stmt(`INSERT INTO sources(uid,kind,conversation_id,source_id,role,filename,mime,saved_path,size,text,content_hash,revision,first_seen,updated_at,sort_order,previous_id,url,index_mode)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(uid) DO UPDATE SET role=excluded.role,filename=excluded.filename,
      mime=excluded.mime,saved_path=excluded.saved_path,size=excluded.size,text=excluded.text,content_hash=excluded.content_hash,
      revision=sources.revision+1,updated_at=excluded.updated_at,previous_id=excluded.previous_id,url=excluded.url,index_mode=excluded.index_mode`)
      .run(uid,kind,conv,sid,role,raw.filename??null,raw.mime??null,raw.saved_path??null,raw.size??Buffer.byteLength(text),text,digest,
        old?.revision??1,old?.first_seen??updated,updated,order,previous,String(raw.url??''),raw.index_mode??'text');
    const pk=this.stmt('SELECT id FROM sources WHERE uid=?').get(uid).id;
    this.indexSource(pk,text,raw.filename??'');
    return {changed:true,uid};
  }
  indexSource(pk,text,filename='') {
    this.stmt('DELETE FROM chunks WHERE source_pk=?').run(pk);
    for(const ch of chunkText(text)) {
      const tokens=tokenize(ch.text+' '+ch.section+' '+filename);
      const id=Number(this.stmt('INSERT INTO chunks(source_pk,part,start,end,section,text,tokens) VALUES(?,?,?,?,?,?,?)')
        .run(pk,ch.part,ch.start,ch.end,ch.section,ch.text,JSON.stringify(tokens)).lastInsertRowid);
      this.stmt('INSERT INTO chunks_fts(rowid,tokens) VALUES(?,?)').run(id,tokens.map(encoded).join(' '));
      for(const token of tokens) {
        const grams=bigrams(token);
        const inserted=this.stmt('INSERT OR IGNORE INTO vocabulary(token,gram_count) VALUES(?,?)').run(token,grams.size).changes;
        if(inserted) for(const g of grams) this.stmt('INSERT INTO token_grams VALUES(?,?)').run(g,token);
        this.stmt('INSERT INTO chunk_tokens VALUES(?,?)').run(id,token);
      }
    }
  }
  capture(messages,{conversation_id,visible_messages}={}) {
    if(!Array.isArray(messages)||messages.length>1000) throw new Error('messages must be an array of at most 1000 records.');
    return this.transaction(()=>{
      let changed=0,blocked=0; const conversations=new Set();
      for(const m of messages) {
        if(!String(m.text??'').trim()) continue;
        if(String(m.text).length>2_000_000) throw new Error('Message exceeds 2 million characters.');
        const r=this.upsertSource({...m,kind:'chat'}); changed+=Number(r.changed); blocked+=Number(!!r.blocked);
        if(!r.blocked) conversations.add(m.conversation_id);
      }
      for(const id of conversations) this.reorderConversation(id);
      if(conversation_id && !this.blocked('conversation',conversation_id)) {
        this.ensureConversation(conversation_id);
        this.stmt('UPDATE conversations SET visible_messages=?,last_seen=? WHERE id=?').run(Number.isSafeInteger(visible_messages)?visible_messages:messages.length,now(),conversation_id);
      }
      return {changed,blocked,accepted:messages.length};
    });
  }
  reorderConversation(conv) {
    const rows=this.stmt("SELECT id,source_id,previous_id,sort_order FROM sources WHERE kind='chat' AND conversation_id=? ORDER BY sort_order,id").all(conv);
    const byId=new Map(rows.map(r=>[r.source_id,r])); const children=new Map(),degree=new Map(rows.map(r=>[r.source_id,0]));
    for(const r of rows) if(r.previous_id && byId.has(r.previous_id) && r.previous_id!==r.source_id) {
      if(!children.has(r.previous_id)) children.set(r.previous_id,[]);
      children.get(r.previous_id).push(r.source_id);degree.set(r.source_id,1);
    }
    const ready=rows.filter(r=>degree.get(r.source_id)===0).reverse(),ordered=[];
    // An observed predecessor is followed before unrelated fallback-order nodes.
    while(ready.length) {const r=ready.pop();ordered.push(r);const next=children.get(r.source_id)??[];
      for(let i=next.length-1;i>=0;i--) {degree.set(next[i],degree.get(next[i])-1);if(degree.get(next[i])===0) ready.push(byId.get(next[i]));}}
    if(ordered.length!==rows.length) {
      this.stmt('UPDATE conversations SET order_warning=? WHERE id=?').run('Conflicting predecessor observations; retained previous order.',conv);return;
    }
    this.stmt('UPDATE conversations SET order_warning=NULL WHERE id=?').run(conv);
    ordered.forEach((r,i)=>{if(r.sort_order!==i+1)this.stmt('UPDATE sources SET sort_order=? WHERE id=?').run(i+1,r.id);});
  }
  scopeSQL({conversation_id,collection_id}={},alias='s') {
    const conditions=[],params=[];
    if(conversation_id) {conditions.push(`${alias}.conversation_id=?`);params.push(conversation_id);}
    if(collection_id) {
      conditions.push(`(EXISTS(SELECT 1 FROM collection_conversations cc WHERE cc.collection_id=? AND cc.conversation_id=${alias}.conversation_id)
        OR EXISTS(SELECT 1 FROM collection_sources cs WHERE cs.collection_id=? AND cs.source_uid=${alias}.uid))`);
      params.push(collection_id,collection_id);
    }
    return {sql:conditions.length?' AND '+conditions.join(' AND '):'',params};
  }
  tokenExists(token,scope) {
    const f=this.scopeSQL(scope);
    return !!this.stmt(`SELECT 1 FROM chunk_tokens ct JOIN chunks c ON c.id=ct.chunk_id JOIN sources s ON s.id=c.source_pk WHERE ct.token=?${f.sql} LIMIT 1`).get(token,...f.params);
  }
  fuzzyTokens(q,scope) {
    if(q.length<4) return [];
    const grams=[...bigrams(q)]; if(!grams.length) return [];
    // Prefix comparisons do not use the Jaccard bound; preserve their existing semantics.
    const prefix=this.stmt('SELECT token FROM vocabulary WHERE token>=? AND token<?').all(q,q+'\uffff').map(r=>r.token);
    for(let n=4;n<q.length;n++) if(this.stmt('SELECT 1 FROM vocabulary WHERE token=?').get(q.slice(0,n))) prefix.push(q.slice(0,n));
    const min=Math.ceil(grams.length*.55),max=Math.floor(grams.length/.55);
    const similar=this.stmt(`SELECT g.token,COUNT(*) AS overlap,v.gram_count FROM token_grams g JOIN vocabulary v ON v.token=g.token
      WHERE g.gram IN (${marks(grams.length)}) AND v.gram_count BETWEEN ? AND ? GROUP BY g.token
      HAVING COUNT(*)*1.0 / (?+v.gram_count-COUNT(*)) >= 0.55`).all(...grams,min,max,grams.length);
    return [...new Set([...prefix,...similar.map(r=>r.token)])].sort().filter(t=>similarity(q,t)>0 && this.tokenExists(t,scope));
  }
  search(query,{top_k=CONFIG.topK,conversation_id,collection_id}={}) {
    const started=performance.now();
    if(typeof query!=='string'||!query.trim()||query.length>2000) throw new Error('query must contain 1 to 2000 characters.');
    if(!Number.isInteger(top_k)||top_k<1||top_k>20) throw new Error('top_k must be from 1 to 20.');
    const allTokens=tokenize(query),queryTokens=allTokens.slice(0,32),scope={conversation_id,collection_id};
    const matches=new Set();const fuzzy=[];
    for(const q of queryTokens) {
      if(this.tokenExists(q,scope)) matches.add(q);
      else {const near=this.fuzzyTokens(q,scope);for(const t of near)matches.add(t);if(near.length)fuzzy.push({query_token:q,matches:near});}
    }
    const f=this.scopeSQL(scope);let candidates=0,rows=[];
    // Candidate IDs are accumulated in SQLite to keep large expansions out of JS memory.
    this.db.exec('CREATE TEMP TABLE IF NOT EXISTS candidate_ids(id INTEGER PRIMARY KEY); DELETE FROM candidate_ids;');
    const words=[...matches];
    for(let i=0;i<words.length;i+=200) {
      const expr=words.slice(i,i+200).map(t=>encoded(t)).join(' OR ');
      this.stmt(`INSERT OR IGNORE INTO candidate_ids SELECT c.id FROM chunks_fts JOIN chunks c ON c.id=chunks_fts.rowid
        JOIN sources s ON s.id=c.source_pk WHERE chunks_fts MATCH ?${f.sql}`).run(expr,...f.params);
    }
    candidates=this.stmt('SELECT COUNT(*) AS n FROM candidate_ids').get().n;
    rows=this.stmt(`SELECT c.*,s.uid,s.kind,s.conversation_id,s.source_id,s.role,s.filename,s.revision,s.content_hash,s.updated_at,s.sort_order
      FROM candidate_ids x JOIN chunks c ON c.id=x.id JOIN sources s ON s.id=c.source_pk
      ORDER BY (SELECT COUNT(*) FROM chunk_tokens ct WHERE ct.chunk_id=c.id AND ct.token IN (${marks(queryTokens.length)||"NULL"})) DESC,c.id LIMIT ?`).all(...queryTokens,CONFIG.maxCandidates);
    const cache=new Map();
    const ranked=rows.map(r=>({...r,tokens:JSON.parse(r.tokens)}))
      .map(r=>({...r,...matchInfo(queryTokens,r,cache),score:scoreChunk(queryTokens,r,cache)}))
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
            const sc=this.scopeSQL(scope);
            adjacent=!this.stmt(`SELECT 1 FROM chunks c JOIN sources s ON s.id=c.source_pk
              WHERE s.kind='chat' AND s.conversation_id=?
              AND (s.sort_order>? OR (s.sort_order=? AND c.part>?))
              AND (s.sort_order<? OR (s.sort_order=? AND c.part<?))${sc.sql} LIMIT 1`)
              .get(end.conversation_id,end.sort_order,end.sort_order,end.part,start.sort_order,start.sort_order,start.part,...sc.params);
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
      ...this.stats(),candidates,candidates_scored:rows.length,weak_hits_filtered:ranked.length-eligible.length,best_matched_word_count:bestMatchCount,minimum_matched_words:minimumMatchedWords,ranking:"matched_words_then_exact_words_then_score",min_context_words:CONFIG.minContextWords,candidates_truncated:candidates>rows.length,fuzzy_matches:fuzzy,
      latency_ms:Number((performance.now()-started).toFixed(3)),memories};
  }
  neighbors(hit,scope={}) {
    const fields='c.*,s.uid,s.kind,s.conversation_id,s.source_id,s.role,s.filename,s.revision,s.content_hash,s.updated_at,s.sort_order';
    let before=[],after=[];
    if(hit.kind==='file') {
      before=this.stmt(`SELECT ${fields} FROM chunks c JOIN sources s ON s.id=c.source_pk WHERE s.id=? AND c.part<? ORDER BY c.part DESC LIMIT ?`).all(hit.source_pk,hit.part,CONFIG.maxContextNeighbors);
      after=this.stmt(`SELECT ${fields} FROM chunks c JOIN sources s ON s.id=c.source_pk WHERE s.id=? AND c.part>? ORDER BY c.part LIMIT ?`).all(hit.source_pk,hit.part,CONFIG.maxContextNeighbors);
    }else{
      const f=this.scopeSQL(scope);
      before=this.stmt(`SELECT ${fields} FROM chunks c JOIN sources s ON s.id=c.source_pk WHERE s.kind='chat' AND s.conversation_id=?
        AND (s.sort_order<? OR (s.sort_order=? AND c.part<?))${f.sql} ORDER BY s.sort_order DESC,c.part DESC LIMIT ?`)
        .all(hit.conversation_id,hit.sort_order,hit.sort_order,hit.part,...f.params,CONFIG.maxContextNeighbors);
      after=this.stmt(`SELECT ${fields} FROM chunks c JOIN sources s ON s.id=c.source_pk WHERE s.kind='chat' AND s.conversation_id=?
        AND (s.sort_order>? OR (s.sort_order=? AND c.part>?))${f.sql} ORDER BY s.sort_order,c.part LIMIT ?`)
        .all(hit.conversation_id,hit.sort_order,hit.sort_order,hit.part,...f.params,CONFIG.maxContextNeighbors);
    }
    let left=Math.min(CONFIG.neighborsBefore,before.length),right=Math.min(CONFIG.neighborsAfter,after.length);
    const count=()=>wordCount(hit.text)+before.slice(0,left).reduce((n,c)=>n+wordCount(c.text),0)+after.slice(0,right).reduce((n,c)=>n+wordCount(c.text),0);
    while(count()<CONFIG.minContextWords && left+right<CONFIG.maxContextNeighbors && (left<before.length||right<after.length)) {
      if(right<after.length)right++;
      if(count()<CONFIG.minContextWords&&left+right<CONFIG.maxContextNeighbors&&left<before.length)left++;
    }
    return [...before.slice(0,left).reverse(),hit,...after.slice(0,right)];
  }
  source(uid,{offset=0,limit=24000,revision}={}) {
    if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>24000)throw new Error('Invalid source range.');
    const row=this.stmt('SELECT * FROM sources WHERE uid=?').get(uid);if(!row)return null;
    if(revision!==undefined&&revision!==row.revision)throw new Error('Source has changed; search again for the current revision.');
    const {text,saved_path,...meta}=row;return {...meta,text:text.slice(offset,offset+limit),offset,next_offset:offset+limit<text.length?offset+limit:null,total_chars:text.length};
  }
  stats() {
    const count=sql=>this.stmt(sql).get().n;
    return {total_messages:count("SELECT COUNT(*) AS n FROM sources WHERE kind='chat'"),total_files:count("SELECT COUNT(*) AS n FROM sources WHERE kind='file'"),
      total_chunks:count('SELECT COUNT(*) AS n FROM chunks'),tokens:count('SELECT COUNT(*) AS n FROM vocabulary WHERE EXISTS(SELECT 1 FROM chunk_tokens WHERE chunk_tokens.token=vocabulary.token)')};
  }
  listConversations(limit=100,offset=0) {return this.stmt(`SELECT c.*,(SELECT COUNT(*) FROM sources s WHERE s.conversation_id=c.id AND s.kind='chat') AS messages,
    (SELECT COUNT(*) FROM sources s WHERE s.conversation_id=c.id AND s.kind='file') AS files FROM conversations c ORDER BY c.last_seen DESC,c.id LIMIT ? OFFSET ?`).all(limit,offset);}
  listSources(limit=100,offset=0) {return this.stmt('SELECT uid,kind,conversation_id,source_id,filename,revision,index_mode FROM sources ORDER BY id LIMIT ? OFFSET ?').all(limit,offset);}
  collections() {return this.stmt('SELECT * FROM collections ORDER BY id').all();}
  addCollection(id,{conversation_id,source_uid}={}) {
    if(!id?.trim())throw new Error('Collection name required.');
    return this.transaction(()=>{
      this.stmt('INSERT OR IGNORE INTO collections VALUES(?)').run(id);
      if(conversation_id)this.stmt('INSERT OR IGNORE INTO collection_conversations VALUES(?,?)').run(id,conversation_id);
      if(source_uid)this.stmt('INSERT OR IGNORE INTO collection_sources VALUES(?,?)').run(id,source_uid);
      this.log('collection_add',{id,conversation_id,source_uid});return {id};
    });
  }
  removeCollection(id) {return this.transaction(()=>{const r=this.stmt('DELETE FROM collections WHERE id=?').run(id);this.log('collection_remove',{id});return {removed:r.changes};});}
  duplicates() {return this.stmt(`SELECT kind,role,content_hash,COUNT(*) AS count,GROUP_CONCAT(uid) AS source_uids FROM sources
    GROUP BY kind,role,content_hash HAVING COUNT(*)>1 ORDER BY count DESC LIMIT 200`).all();}
  cleanupVocabulary() {this.db.exec('DELETE FROM vocabulary WHERE NOT EXISTS(SELECT 1 FROM chunk_tokens WHERE token=vocabulary.token)');}
  deleteTarget(kind,key) {
    if(!['conversation','source'].includes(kind))throw new Error('Unknown delete target.');
    return this.transaction(()=>{
      this.stmt('INSERT OR REPLACE INTO tombstones VALUES(?,?,?)').run(kind,key,now());
      const result=kind==='conversation'?this.stmt('DELETE FROM conversations WHERE id=?').run(key):this.stmt('DELETE FROM sources WHERE uid=?').run(key);
      this.cleanupVocabulary();this.log('delete',{kind,key});return {removed:result.changes,recapture_blocked:true};
    });
  }
  allowRecapture(kind,key) {this.stmt('DELETE FROM tombstones WHERE kind=? AND key=?').run(kind,key);this.log('allow_recapture',{kind,key});}
  compact() {this.cleanupVocabulary();this.db.exec("INSERT INTO chunks_fts(chunks_fts) VALUES('optimize'); PRAGMA wal_checkpoint(TRUNCATE); VACUUM;");this.log('compact',{});}
  close(){this.db.close();}
}
