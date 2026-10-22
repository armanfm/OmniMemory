import {investigateMemory} from './investigate.js';
import {findContradictionLeads} from './contradictions.js';

// Conservative, bounded, local metadata extraction. This is not semantic fact checking.
const COMPLEX = /\b(cronologia|linha do tempo|quando aconteceu|quem fez|quem disse|quem participou|envolvidos|evid[eê]ncias|provas|contradi[cç][aã]o|diverg[eê]ncia|reconstru|investig|sequ[eê]ncia|v[ií]tima|respons[aá]vel|history of|timeline|evidence|contradiction|who did|what happened)\b/i;
const DATE = /\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}|\d{1,2}\s+de\s+(?:janeiro|fevereiro|mar[cç]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)(?:\s+de\s+\d{4})?)\b/gi;
const CLAIM = /\b(alegou|afirmou|disse|relatou|acusou|declarou|negou|claimed|stated|denied)\b/i;
const ACTION = /\b(criou|implementou|enviou|publicou|registrou|assinou|desenvolveu|aprovou|conversou|discutiu|created|published|signed|implemented)\b/i;
const LABELS = new Set(['User','Assistant','FILE','ExploreChem','OmniMemory']);
const clip=(s,n=240)=>s.replace(/\s+/g,' ').trim().slice(0,n);
const allRefs=m=>[...(m.sources??[]),...(m.corroborating_sources??[])].map(r=>({source_uid:r.source_uid,revision:r.revision??null,start:r.start??null,end:r.end??null,captured_at:r.captured_at??null}));
function normalizedDate(s){
 const x=s.match(/^(\d{4})-(\d\d)-(\d\d)$/);if(x)return x[0];
 const d=s.match(/^(\d{1,2})[\/\.\-](\d{1,2})[\/\.\-](\d{2,4})$/);
 if(d){const yr=d[3].length===2?`20${d[3]}`:d[3];return `${yr}-${d[2].padStart(2,'0')}-${d[1].padStart(2,'0')}`;}
 return null;
}
export function needsContextualRecall(query){return COMPLEX.test(query??'');}
export function contextualRecall(store,query,options={}){
 const result=investigateMemory(store,query,options);
 const events=[],actors=new Map(),claims=[],datesSeen=new Set();
 const contradictions=findContradictionLeads(result.memories);
 for(const m of result.memories){
   const refs=allRefs(m);const lines=m.text.split(/\n+/).filter(Boolean).slice(0,36);
   for(const line of lines){
     const dates=[...line.matchAll(DATE)].map(x=>x[0]);
     const candidate=clip(line);
     // Only explicit phrases are extracted; no inferred guilt, victimhood, or authorship.
     const names=[...line.matchAll(/\b[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][a-záàâãéêíóôõúç]{2,}(?:\s+[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][a-záàâãéêíóôõúç]{2,}){0,2}\b/g)]
       .map(x=>x[0]).filter(x=>!LABELS.has(x) && !/^(FILE|USER|ASSISTANT)$/.test(x));
     for(const name of names.slice(0,4)){
       if(!actors.has(name))actors.set(name,{name,role:'mentioned_only',sources:[]});
       const a=actors.get(name);for(const r of refs)if(!a.sources.some(s=>s.source_uid===r.source_uid))a.sources.push(r);
     }
     if(CLAIM.test(line)&&claims.length<12)claims.push({excerpt:candidate,classification:'reported_statement_not_verified',sources:refs});
     if(dates.length&&(ACTION.test(line)||CLAIM.test(line))){
       for(const date of dates.slice(0,2)){
         const key=`${date}|${candidate.toLowerCase()}`;if(datesSeen.has(key)||events.length>=16)continue;datesSeen.add(key);
         events.push({date_mentioned:date,sort_date:normalizedDate(date),event_excerpt:candidate,date_role:'unverified_event_or_statement_date',sources:refs});
       }
     }
   }
 }
 events.sort((a,b)=>!a.sort_date?1:!b.sort_date?-1:a.sort_date.localeCompare(b.sort_date));
 return {...result,mode:'contextual_adaptive',contextual_analysis:{
   actors:[...actors.values()].slice(0,25),chronology:events,reported_claims:claims,
   possible_victims:[],contradictions:contradictions.candidates,contradiction_scan:{statements_scanned:contradictions.statements_scanned,limitations:contradictions.limitations},
   unresolved_questions:events.length?['Confirm whether cited dates refer to the event, publication, or later statement.']:[],
   evidence_policy:'Entries are extracted leads, not verified facts. A name is not a determination of victim or perpetrator. Possible contradictions are automatically flagged only under narrow conditions and must be checked in the full original sources; no automatic verdict is generated.',
   completeness:'Limited to indexed, matched local passages; missing evidence is not evidence of absence.'}};
}
