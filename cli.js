import { mkdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { MemoryStore } from './lib/store.js';
import { importLegacy, importChatGPT } from './lib/import.js';
import { MEMORY_PATH, PREVIOUS_SQLITE, DATA, FILE_DIR, LEGACY_FILES, LEGACY_MESSAGES } from './lib/config.js';
const args=process.argv.slice(2),cmd=args.shift()??'help';
const flag=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
const print=r=>console.log(JSON.stringify(r,null,2));
const help=`OmniMemory — biblioteca local para agentes de IA

npm run memory -- status
npm run memory -- list
npm run memory -- sources
npm run memory -- collections
npm run memory -- search "balanço de massa"
npm run memory -- duplicates
npm run memory -- compact
npm run memory -- backup
npm run memory -- import-legacy

Comandos com argumento obrigatório:
  read                  UID de fonte mostrado por search/sources; aceita --offset e --revision
  import-chatgpt        caminho do conversations.json exportado pelo ChatGPT
  collection-add       nome da coleção; aceita --conversation ou --source com um ID existente
  collection-remove    nome da coleção; remove apenas o agrupamento
  delete-conversation  ID da conversa; exige --yes e cria backup antes da remoção
  delete-source        UID da fonte; exige --yes e cria backup antes da remoção
  allow-recapture      conversation ou source, seguido do ID anteriormente removido

list e sources aceitam --limit e --offset. search aceita --conversation, --collection e --top.
Exclusões removem registros e índice e bloqueiam recaptura; arquivos brutos e backups permanecem no disco.
import-chatgpt importa texto do ramo atual do export. Arquivos anexados e ramos alternativos não são importados.
`;
if(cmd==='help'){console.log(help);}else{
 if(!existsSync(MEMORY_PATH)&&existsSync(PREVIOUS_SQLITE)){console.error('Existing SQLite memory found. Run npm run migrate-sqlite first.');process.exit(1);}
 const readOnly=['status','list','sources','collections','search','read','duplicates','backup'].includes(cmd);
 const store=new MemoryStore(MEMORY_PATH,{readOnly});
 try{
  const paginate=()=>[Math.min(200,Math.max(1,Number(flag('--limit')??100))),Math.max(0,Number(flag('--offset')??0))];
  const take=()=>{if(!args[0]||args[0].startsWith('--'))throw new Error('Argumento obrigatório ausente. Use npm run memory -- help.');return args[0];};
  const saveBackup=async()=>{const dir=join(DATA,'backups');mkdirSync(dir,{recursive:true});const path=join(dir,'omnimemory-'+new Date().toISOString().replaceAll(':','-')+'.jsonl');store.backup(path);return path;};
  switch(cmd){
   case 'status':print({storage_file:MEMORY_PATH,...store.stats()});break;
   case 'list':print(store.listConversations(...paginate()));break;
   case 'sources':print(store.listSources(...paginate()));break;
   case 'collections':print(store.collections());break;
   case 'search':print(store.search(take(),{top_k:Number(flag('--top')??8),conversation_id:flag('--conversation'),collection_id:flag('--collection')}));break;
   case 'read':print(store.source(take(),{offset:Number(flag('--offset')??0),revision:flag('--revision')?Number(flag('--revision')):undefined}));break;
   case 'duplicates':print(store.duplicates());break;
   case 'collection-add':print(store.addCollection(take(),{conversation_id:flag('--conversation'),source_uid:flag('--source')}));break;
   case 'collection-remove':print(store.removeCollection(take()));break;
   case 'delete-conversation':case 'delete-source':{
    const target=take();if(!args.includes('--yes'))throw new Error('Exclusão explícita exige --yes. Nenhum registro foi removido.');
    const path=await saveBackup();print({backup:path,...store.deleteTarget(cmd==='delete-source'?'source':'conversation',target)});break;
   }
   case 'allow-recapture':if(!['source','conversation'].includes(take())||!args[1])throw new Error('Informe conversation ou source e o ID.');store.allowRecapture(args[0],args[1]);print({ok:true});break;
   case 'compact':store.compact();print({ok:true,...store.stats()});break;
   case 'backup':print({backup:await saveBackup()});break;
   case 'import-legacy':print(await importLegacy(store,{messages:LEGACY_MESSAGES,files:LEGACY_FILES,fileDir:FILE_DIR},args.includes('--force')));break;
   case 'import-chatgpt':print(importChatGPT(store,resolve(take())));break;
   default:throw new Error('Comando desconhecido. Use npm run memory -- help.');
  }
 }catch(e){console.error(e.message);process.exitCode=1;}finally{store.close();}
}
