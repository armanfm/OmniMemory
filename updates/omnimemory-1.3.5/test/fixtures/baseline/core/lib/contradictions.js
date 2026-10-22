// Conservative lexical contradiction leads. NOT a truth or culpability verdict.
// Only explicit dated statements from different source records are compared.
import { normalize, tokenize } from './text.js';
const DATE=/\b(?:\d{1,2}[/.\-]\d{1,2}[/.\-]\d{4}|\d{4}-\d{2}-\d{2})\b/;
const SPEAKER=/^(?:\[([^\]]+)\]\s*)?([^:\n]{2,70}):\s*(.{8,})$/;
const TARGET=/\b(implement|public|cri|desenvolv|registr|assin|envi|mint|tokeniz|rwa|artigo|projeto|direitos|solana|ethereum)\w*/i;
const NEGATION=/\b(?:n[aã]o|nunca|jamais|nem|not|never)\b/i;
const STATEMENT=/\b(?:afirm|declar|diss|aleg|acus|relat|falei|disse|implementei|implementar|publiquei|publicou|criei|criou|registrou|desenvolvi|desenvolveu|negou|nunca|jamais)\w*/i;
const STOP=new Set(['para','sobre','como','quando','entao','porque','depois','antes','agora','disse','afirmou','alegou','isso','essa','esse','aqui','minha','dele','dela','nossa','voce','voces','comigo','tambem','ainda','tinha','tenho','muito','nunca','nao','sera','mesmo','fazer','fiz','estava','estou','hoje','ontem','data','artigo','projeto']);
function signature(t){return new Set(tokenize(t).filter(x=>x.length>3&&!STOP.has(x)&&!/^\d+$/.test(x)));}
function overlap(a,b){let n=0;for(const w of a)if(b.has(w))n++;return n;}
function refs(m){return [...(m.sources??[])].filter(s=>s.source_uid).map(s=>({source_uid:s.source_uid,revision:s.revision??null,start:s.start??null,end:s.end??null}));}
function extract(memories){
 const out=[];const seen=new Set();
 for(const m of memories){
  const sources=refs(m);
  if(!sources.length)continue;
  for(const raw of (m.text??'').split(/\n/).slice(0,180)){
   // Typical WhatsApp transcript: "28/09/2026 13:28 - Armando: ..."
   const line=raw.replace(/^[\s\u200e]+/,'').trim();
   const dated=line.match(/^(\d{2}[/.\-]\d{2}[/.\-]\d{4})\s+(?:\d{1,2}:\d{2}(?::\d{2})?\s*[-–]\s*)([^:]{2,70}):\s*(.+)$/);
   const bracket=line.match(/^\[(\d{2}[/.\-]\d{2}[/.\-]\d{4})\s+\d{1,2}:\d{2}\]\s*([^:]{2,70}):\s*(.+)$/);
   const match=dated||bracket;
   if(!match)continue;
   const [,date,speaker,statement]=match;
   if(!TARGET.test(statement)||!STATEMENT.test(statement))continue;
   const actor=normalize(speaker).trim();const normalized=normalize(statement);
   const key=actor+'|'+date+'|'+normalized;
   if(seen.has(key))continue;seen.add(key);
   out.push({speaker:speaker.trim(),actor,date,excerpt:statement.slice(0,340),tokens:signature(statement),negated:NEGATION.test(statement),sources});
   if(out.length>=160)return out;
  }
 }
 return out;
}
export function findContradictionLeads(memories,{maxPairs=8}={}){
 const claims=extract(memories);const candidates=[];
 for(let i=0;i<claims.length;i++)for(let j=i+1;j<claims.length;j++){
  const a=claims[i],b=claims[j];
  // Same author + opposite negation + at least two shared meaningful terms.
  if(a.actor!==b.actor||a.negated===b.negated||overlap(a.tokens,b.tokens)<2)continue;
  // Different dates required; a change of mind is not proof of dishonesty.
  if(a.date===b.date)continue;
  candidates.push({classification:'possible_statement_inconsistency',speaker:a.speaker,
   first:{date:a.date,excerpt:a.excerpt,sources:a.sources},second:{date:b.date,excerpt:b.excerpt,sources:b.sources},
   basis:'Opposite explicit negation in dated statements attributed to the same speaker with shared subject terms.',
   verification_needed:'Read both full sources; check subject, timeframe, quotation context and whether circumstances changed. This is not a finding of lying or wrongdoing.'});
  if(candidates.length>=maxPairs)break;
 }
 return {candidates,statements_scanned:claims.length,
  limitations:'Lexical indicator only: cannot infer publication dates, causal influence, intent, criminal responsibility, or identify contradictions requiring semantic interpretation.'};
}
