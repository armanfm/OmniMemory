import {readFileSync,writeFileSync,mkdirSync,renameSync,rmSync,existsSync,lstatSync,realpathSync,readdirSync} from 'node:fs';
import {resolve,join,dirname,relative,isAbsolute,sep} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const packageRoot=dirname(fileURLToPath(import.meta.url));
const allowed=new Set(["package.json", "desktop/bridge-client.mjs", "core/server.js", "core/test/security-gate.test.js", "test/bridge-concurrency.test.mjs", "test/local-auth.test.mjs", "test/tls-transport.test.mjs", "test/fixtures/tls/test-only-key.pem", "test/fixtures/tls/test-only-cert.pem", "desktop/main.cjs", "desktop/tunnel-client.mjs", "desktop/tunnel-vault.mjs", "desktop/tunnel-window.cjs", "desktop/tunnel-preload.cjs", "desktop/tunnel.html", "desktop/tunnel.css", "desktop/tunnel-ui.js", "installer/prepare-tunnel.mjs", "test/tunnel.test.mjs", "desktop/tunnel-runtime-integrity.json", "tunnel-runtime/tunnel-client.exe", "tunnel-runtime/manifest.json", "tunnel-runtime/LICENSE", "tunnel-runtime/NOTICE", "tunnel-runtime/third-party-licenses.txt", "test/tunnel-native.test.mjs", "test/runtime-integrity.test.mjs"]);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const readJson=path=>JSON.parse(readFileSync(path,'utf8'));

function inside(root,name){
 if(typeof name!=='string'||name.includes('\\')||name.includes(':')||name.split('/').some(p=>!p||p==='.'||p==='..'))throw Error('Caminho de atualizacao invalido.');
 const target=resolve(root,name),rel=relative(root,target);
 if(isAbsolute(rel)||rel==='..'||rel.startsWith('..'+sep))throw Error('Caminho fora do projeto.');
 // Do not follow file symlinks or directory junctions into data or another project.
 let current=root;
 for(const part of rel.split(sep)){
  current=join(current,part);
  if(existsSync(current)&&lstatSync(current).isSymbolicLink())throw Error('Link de arquivo ou diretorio recusado: '+name);
 }
 return target;
}

function atomicWrite(path,bytes){
 mkdirSync(dirname(path),{recursive:true});
 const temporary=path+'.omni-update-'+randomUUID();
 try{writeFileSync(temporary,bytes,{flag:'wx',mode:0o600});renameSync(temporary,path);}
 finally{rmSync(temporary,{force:true});}
}

function runCommand(command,args,cwd){
 const env={...process.env};
 // Test processes must not inherit paths or keys for a real memory archive.
 if((command==='npm'&&args[0]==='test')||command===process.execPath){
  for(const key of Object.keys(env))if(/^(OMNI_|TD_)/.test(key))delete env[key];
 }
 const result=spawnSync(command,args,{cwd,env,stdio:'inherit',shell:process.platform==='win32'&&command==='npm'});
 if(result.error)throw result.error;
 if(result.status!==0)throw Error('Comando falhou: '+command+' '+args.join(' ')+' (codigo '+result.status+').');
}

export function applyUpdate({project,updateRoot=packageRoot,build=false,run=runCommand,log=console.log}){
 const projectRoot=realpathSync(resolve(project));
 const manifest=readJson(join(updateRoot,'manifest.json'));
 const metadata=readJson(join(projectRoot,'package.json'));
 if(metadata.name!=='omnimemory-desktop'||!['1.3.4','1.3.5'].includes(metadata.version))throw Error('Este pacote e especifico para o codigo-fonte OmniMemory Desktop 1.3.4 enviado nesta conversa.');
 if(manifest.format!==2||!Array.isArray(manifest.files)||!manifest.guarded_files)throw Error('Manifesto de atualizacao invalido.');
 const planned=[],names=new Set();
 for(const item of manifest.files){
  if(!allowed.has(item.path)||names.has(item.path))throw Error('Arquivo de atualizacao nao permitido.');names.add(item.path);
  const target=inside(projectRoot,item.path),payload=inside(join(updateRoot,'payload'),item.path);
  const bytes=readFileSync(payload);if(digest(bytes)!==item.after)throw Error('Pacote danificado: '+item.path);
  const before=existsSync(target)?readFileSync(target):null,hash=before===null?null:digest(before);
  if(!item.before.includes(hash)&&hash!==item.after)throw Error('O arquivo mudou desde a coleta: '+item.path+'. Nenhuma substituicao sera feita.');
  planned.push({item,target,bytes,before,alreadyApplied:hash===item.after});
 }
 for(const [name,hash] of Object.entries(manifest.guarded_files)){
  const target=inside(projectRoot,name);
  if(!existsSync(target)||digest(readFileSync(target))!==hash)throw Error('Uma dependencia ou recurso mudou desde a coleta: '+name+'. Envie o codigo atualizado antes de aplicar.');
 }
 const pending=planned.filter(p=>!p.alreadyApplied);
 if(metadata.version==='1.3.5'&&pending.length)throw Error('A versao 1.3.5 local diverge deste pacote. Nenhuma substituicao sera feita.');
 let backup=null;
 if(pending.length){
  const stamp=new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8);
  backup=inside(projectRoot,'security-backups/'+stamp);mkdirSync(backup,{recursive:true,mode:0o700});
  // Complete every backup before the first replacement.
  for(const p of pending)if(p.before!==null)atomicWrite(inside(backup,p.item.path),p.before);
  atomicWrite(join(backup,'alteracoes.json'),Buffer.from(JSON.stringify(pending.map(p=>({path:p.item.path,existed:p.before!==null})),null,2)));
  log('Backup apenas do codigo: '+backup);
 }else log('As correcoes deste pacote ja estao aplicadas.');
 const written=[];
 try{
  for(const p of pending){
   const now=existsSync(p.target)?readFileSync(p.target):null;
   if((now===null?null:digest(now))!==(p.before===null?null:digest(p.before)))throw Error('Arquivo alterado durante a atualizacao: '+p.item.path);
   atomicWrite(p.target,p.bytes);written.push(p);
  }
  // Run the user's full existing suite, which now includes the new security tests.
  run('npm',['test'],projectRoot);
  // The current npm test script omits .cjs files; include all existing CJS tests.
  const cjsTests=readdirSync(join(projectRoot,'test')).filter(name=>name.endsWith('.test.cjs')).map(name=>'test/'+name);
  if(cjsTests.length)run(process.execPath,['--test',...cjsTests],projectRoot);
 }catch(error){
  const rollbackErrors=[];
  for(const p of written.reverse()){
   try{
    // Preserve any concurrent user edit rather than overwriting it during rollback.
    if(!existsSync(p.target)||digest(readFileSync(p.target))!==p.item.after)throw Error('Arquivo mudou durante os testes: '+p.item.path);
    if(p.before===null)rmSync(p.target);else atomicWrite(p.target,p.before);
   }catch(e){rollbackErrors.push(e.message);}
  }
  if(rollbackErrors.length)throw new AggregateError([error,...rollbackErrors.map(m=>Error(m))],'Falha nos testes; restauracao incompleta. Consulte o backup: '+backup);
  throw Error('Falha antes da compilacao. Alteracoes desta execucao restauradas. '+error.message);
 }
 log('Atualizacao do codigo aplicada e testes aprovados.');
 if(build){
  log('Gerando instalador com o processo existente do seu projeto...');
  try{run('npm',['run','build:win'],projectRoot);}
  catch(error){throw Error('Codigo corrigido e testes aprovados, mas a compilacao falhou. O codigo foi mantido. Nao instale arquivos de uma compilacao incompleta. '+error.message);}
  const dist=join(projectRoot,'dist');
  const installers=existsSync(dist)?readdirSync(dist).filter(n=>n.toLowerCase().endsWith('.exe')).map(n=>join(dist,n)):[];
  log('Compilacao concluida. O nome do instalador segue o processo existente do projeto.');
  for(const installer of installers)log('Instalador em dist: '+installer);
  if(!installers.length)log('Consulte a saida do compilador acima para o caminho exato do instalador.');
 }
 return {backup,changed:pending.map(p=>p.item.path),built:build};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const project=process.argv[2]??'C:\\Users\\Armandinho\\OmniMemory-Desktop';
  applyUpdate({project,build:process.argv.slice(3).includes('--build')});
 }catch(error){
  console.error('\nATUALIZACAO INTERROMPIDA: '+error.message);
  if(error instanceof AggregateError)for(const item of error.errors)console.error(item.message);
  process.exitCode=1;
 }
}
