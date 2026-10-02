import { createHash } from 'node:crypto';

export const CONFIG = Object.freeze({ chunkSize: 800, topK: 8, neighborsBefore: 1,
  neighborsAfter: 2, maxExpandedChars: 24000, maxTextFileBytes: 25 * 1024 * 1024,
  maxUploadBytes: 100 * 1024 * 1024, maxCandidates: 10000, minContextWords: 40, maxContextNeighbors: 12 });
const STOPWORDS = new Set(('a o as os um uma uns umas de da do das dos e ou mas em no na nos nas que se por para com sem eu voce ele ela eles elas me te meu minha seu sua isso isto aquilo esse essa este esta como qual quais quando onde foi era ser estar tem tinha ter mais muito ai ne the a an and or of to in on is are was were with what how did').split(' '));
export function normalize(text) {
  return String(text ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9_\-.$#]/g, ' ').replace(/\s+/g, ' ').trim();
}
export function tokenize(text) { return [...new Set(normalize(text).split(' ').map(t=>t.replace(/\.+$/,'')).filter(t => t.length >= 2 && !STOPWORDS.has(t)))]; }
export function hash(text) { return createHash('sha256').update(text).digest('hex'); }
export function bigrams(token) { return new Set(Array.from({length: Math.max(0,token.length-1)}, (_,i)=>token.slice(i,i+2))); }
export function similarity(a,b,A=bigrams(a),B=bigrams(b)) {
  if (a===b) return 1;
  if (a.length<4 || b.length<4) return 0;
  if (a.startsWith(b)||b.startsWith(a)) return .72;
  const possible=Math.min(A.size,B.size)/Math.max(A.size,B.size,1);
  if (possible<.55) return 0;
  let intersection=0; for(const gram of A) if(B.has(gram)) intersection++;
  const j=intersection/(A.size+B.size-intersection || 1);
  return j>=.55 ? j*.72 : 0;
}

// Offsets refer to the stored text, in JavaScript UTF-16 code units. No short block is discarded.
export function chunkText(text, size=CONFIG.chunkSize) {
  const chunks=[]; const headings=[]; let offset=0; let fence=null;
  const paragraphs=[]; let blockStart=0;
  for(const line of text.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
    const stripped=line.trim(); const fenced=stripped.match(/^(`{3,}|~{3,})/);
    if(fenced) { if(!fence) fence=fenced[1][0]; else if(fence===fenced[1][0]) fence=null; }
    const heading=!fence && stripped.match(/^(#{1,6})\s+(.+)$/);
    if(heading) {
      if(offset>blockStart) paragraphs.push({start:blockStart,end:offset,section:headings.filter(Boolean).join(' > ')});
      headings.length=heading[1].length; headings[heading[1].length-1]=heading[2]; blockStart=offset;
    }
    offset+=line.length;
    if(!stripped && !fence) { paragraphs.push({start:blockStart,end:offset,section:headings.filter(Boolean).join(' > ')}); blockStart=offset; }
  }
  if(blockStart<text.length) paragraphs.push({start:blockStart,end:text.length,section:headings.filter(Boolean).join(' > ')});
  for(const block of paragraphs) {
    let start=block.start;
    while(start<block.end) {
      while(start<block.end && /\s/.test(text[start])) start++;
      if(start>=block.end) break;
      let end=Math.min(start+size,block.end);
      if(end<block.end) { const cut=text.lastIndexOf(' ',end); if(cut>start+size/2) end=cut; }
      while(end>start && /\s/.test(text[end-1])) end--;
      chunks.push({part:chunks.length,start,end,section:block.section,text:text.slice(start,end)});
      start=end;
    }
  }
  return chunks;
}

export function scoreChunk(queryTokens, chunk, similarityCache=new Map()) {
  let total=0,exact=0,fuzzy=0;
  for(const q of queryTokens) {
    let best=0;
    for(const t of chunk.tokens) {
      const key=q+'\0'+t;
      let s=similarityCache.get(key);
      if(s===undefined) {s=similarity(q,t);similarityCache.set(key,s);}
      best=Math.max(best,s); if(best===1) break;
    }
    total+=best; if(best===1) exact++; else if(best>0) fuzzy++;
  }
  const phrase=queryTokens.join(' ');
  return Math.min(1,total/Math.max(1,queryTokens.length)*.72 + total/Math.max(queryTokens.length,chunk.tokens.length,1)*.28
    +Math.min(exact*.1,.4)+Math.min(fuzzy*.025,.1)+(phrase.length>4 && normalize(chunk.text).includes(phrase) ? .35 : 0));
}

export function matchInfo(queryTokens, chunk, cache=new Map()) {
  const matched=[],exact=[];
  for(const q of queryTokens){let best=0;for(const t of chunk.tokens){const key=q+'\0'+t;let value=cache.get(key);if(value===undefined){value=similarity(q,t);cache.set(key,value);}best=Math.max(best,value);if(best===1)break;}
    if(best>0)matched.push(q);if(best===1)exact.push(q);
  }
  return {matched_words:matched,exact_words:exact,matched_word_count:matched.length,exact_word_count:exact.length};
}
export const wordCount=text=>(String(text).match(/\S+/g)??[]).length;
