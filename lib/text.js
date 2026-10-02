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

export function matchInfo(queryTokens,chunk,corrections=new Map()) {
  const exact=queryTokens.filter(q=>chunk.tokens.includes(q));
  const matched=queryTokens.filter(q=>chunk.tokens.includes(q)||corrections.get(q)?.some(t=>chunk.tokens.includes(t)));
  return {matched_words:matched,exact_words:exact,matched_word_count:matched.length,exact_word_count:exact.length};
}
export function scoreChunk(queryTokens,chunk,matchedCount=matchInfo(queryTokens,chunk).matched_word_count) {
  const phrase=queryTokens.join(' ');
  return Math.min(1,matchedCount/Math.max(1,queryTokens.length)*.72
    +matchedCount/Math.max(queryTokens.length,chunk.tokens.length,1)*.28
    +Math.min(matchedCount*.1,.4)+(phrase.length>4&&normalize(chunk.text).includes(phrase)?.35:0));
}
export const wordCount=text=>(String(text).match(/\S+/g)??[]).length;
