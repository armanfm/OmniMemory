import { normalize, tokenize } from './text.js';

// Bounded, deterministic clue expansion. Nothing here establishes factual truth:
// a clue is only a candidate for further reading against a cited source.
const MAX_CLUES = 4;
const MAX_RESULTS = 12;
const textKey = text => normalize(text).replace(/\s+/g,' ').trim();
const referenceKey = m => (m.sources??[]).map(s => `${s.source_uid}:${s.start}:${s.end}`).join('|');
const tokensOf = text => new Set(tokenize(text));
function similarity(a,b){
  if(!a.size||!b.size)return 0;
  let same=0;for(const word of a)if(b.has(word))same++;
  return same/Math.min(a.size,b.size);
}
function distinctMemories(memories){
  const kept=[],duplicates=[];
  for(const m of memories){
    const key=textKey(m.text),tok=tokensOf(m.text);
    const existing=kept.find(x=>x.key===key || (key.length>70&&x.key.length>70&&similarity(tok,x.tokens)>=.94));
    if(existing){
      existing.duplicates.push(...(m.sources??[]),...(m.corroborating_sources??[]));
      duplicates.push({kept_source:existing.memory.sources?.[0]?.source_uid??null,duplicate_sources:(m.sources??[]).map(x=>x.source_uid)});
    }else kept.push({memory:m,key,tokens:tok,duplicates:[...(m.corroborating_sources??[])]});
  }
  return {memories:kept.map(x=>({...x.memory,corroborating_sources:[...new Map(x.duplicates.map(r=>[`${r.source_uid}:${r.start}:${r.end}`,r])).values()]})),duplicates};
}
export function investigateMemory(store,query,options={}){
  if(typeof query!=='string'||!query.trim()||query.length>2000)throw new Error('Invalid investigation query.');
  const requested=options.top_k??8;
  if(!Number.isInteger(requested)||requested<1||requested>20)throw new Error('top_k must be from 1 to 20.');
  const scope={conversation_id:options.conversation_id,collection_id:options.collection_id};
  const initial=store.search(query,{...scope,top_k:Math.min(20,Math.max(requested,12))});
  const primary=distinctMemories(initial.memories);
  const queryTerms=tokensOf(query);
  const strong=primary.memories.filter(m=>m.matched_word_count>=Math.max(1,Math.ceil(initial.best_matched_word_count*.75)));
  const seen=new Set();const clues=[];
  // Extract candidate tokens only from primary matched passages, not from unverified side results.
  // Require a moderately distinctive word and bound exploration to 4 extra searches.
  for(const mem of strong.slice(0,5)){
    const words=tokenize(mem.text).filter(t=>t.length>=6 && !queryTerms.has(t) && !/^\d+$/.test(t) && !t.startsWith('file'));
    for(const token of words.slice(0,32)){
      if(seen.has(token))continue;
      seen.add(token);
      clues.push({token,origin:mem.sources?.[0]?.source_uid??null});
      if(clues.length>=MAX_CLUES)break;
    }
    if(clues.length>=MAX_CLUES)break;
  }
  const all=[...primary.memories];const traces=[];
  const originalSources=new Set(primary.memories.flatMap(m=>(m.sources??[]).map(r=>r.source_uid)));
  for(const clue of clues){
    // Keep query context during expansion to prevent a general clue from dragging in unrelated material.
    const next=store.search(`${query} ${clue.token}`,{...scope,top_k:8});
    const fresh=distinctMemories(next.memories).memories.filter(m=>
      m.matched_words?.includes(clue.token) &&
      m.matched_words.some(w=>queryTerms.has(w)) &&
      (m.sources??[]).some(r=>!originalSources.has(r.source_uid))
    );
    traces.push({clue:clue.token,from_source_uid:clue.origin,matching_sources:fresh.map(m=>m.sources?.[0]?.source_uid).filter(Boolean)});
    for(const mem of fresh){if(all.length>=MAX_RESULTS*2)break;all.push({...mem,evidence_type:'indirect_clue'});}
  }
  const dedup=distinctMemories(all);
  const primaryRefs=new Set(primary.memories.map(referenceKey));
  const final=dedup.memories.slice(0,Math.min(MAX_RESULTS,requested));
  return {query,scope:initial.scope,mode:'investigative_lexical',not_a_truth_verdict:true,
    clues_examined:traces,duplicates_collapsed:primary.duplicates.length+dedup.duplicates.length,
    limits:{max_clues:MAX_CLUES,max_results:MAX_RESULTS},
    memories:final.map(m=>({...m,evidence_type:m.evidence_type??(primaryRefs.has(referenceKey(m))?'direct_match':'indirect_clue')})),
    guidance:'Treat indirect clues as search leads, not proof; read_memory_source to verify context and identify uncertainty.'};
}
