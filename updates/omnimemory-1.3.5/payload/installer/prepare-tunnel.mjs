import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,renameSync,rmSync,existsSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import AdmZip from 'adm-zip';

export const RELEASE={version:'0.0.16',url:'https://github.com/openai/tunnel-client/releases/download/v0.0.16/tunnel-client-v0.0.16-windows-amd64.zip',sha256:'edef7241b0c647fcb30f1a80ff376b6b25c51927960f257a3f01e21b17c2aba6'};
export const RUNTIME_FILES={
  'tunnel-client.exe':'4226bb74a72388147882881f29f79801b95e285d731a138071812e3aa6766571',
  LICENSE:'f4c1d7ba32ef5bcf5cf03e2eefec5825ebafedf50fa330a36700a49c605c1ef4',
  NOTICE:'1364c020d86ecf948b78b7c655175032068203d13aece70fb0bfe112d7802dc2',
  'third-party-licenses.txt':'9399ced2b36f82fa18e5fe1e6df5712015680c48b8de51a4bd983e9a58de6b4c'
};
const digest=b=>createHash('sha256').update(b).digest('hex');
export function unpackVerifiedArchive(bytes){
  if(digest(bytes)!==RELEASE.sha256)throw Error('SHA256 do cliente do tunel nao corresponde ao release oficial.');
  const matches=new AdmZip(bytes).getEntries().filter(e=>!e.isDirectory&&/(^|\/)tunnel-client\.exe$/.test(e.entryName));
  if(matches.length!==1||matches[0].header.size>180_000_000)throw Error('Arquivo do cliente inesperado.');
  const exe=matches[0].getData();if(exe.subarray(0,2).toString()!=='MZ')throw Error('Executavel Windows invalido.');
  return exe;
}
export async function prepareTunnel(root,{fetcher=fetch}={}){
  const dest=join(root,'tunnel-runtime');mkdirSync(dest,{recursive:true});
  let bundled=false;
  try{bundled=Object.entries(RUNTIME_FILES).every(([name,hash])=>digest(readFileSync(join(dest,name)))===hash);}catch{}
  if(bundled){
    writeFileSync(join(dest,'manifest.json'),JSON.stringify({version:RELEASE.version,sha256:RUNTIME_FILES['tunnel-client.exe'],archive_sha256:RELEASE.sha256},null,2)+'\n');
    writeFileSync(join(root,'desktop','tunnel-runtime-integrity.json'),JSON.stringify({version:RELEASE.version,sha256:RUNTIME_FILES['tunnel-client.exe']})+'\n');
    console.log('Cliente oficial incluido no pacote: SHA256 verificado.');return;
  }
  // Always validate against the pinned official archive, including cached builds.
  const cache=join(root,'installer-cache','tunnel-client-'+RELEASE.version+'.zip');
  let archive;
  if(existsSync(cache)){const bytes=readFileSync(cache);if(digest(bytes)===RELEASE.sha256)archive=bytes;}
  if(!archive){
    console.log('Baixando cliente oficial do tunel '+RELEASE.version+'...');
    const response=await fetcher(RELEASE.url,{signal:AbortSignal.timeout(180000)});
    if(!response.ok)throw Error('Download do cliente falhou: HTTP '+response.status);
    archive=Buffer.from(await response.arrayBuffer());
    if(archive.length>60_000_000||digest(archive)!==RELEASE.sha256)throw Error('Cliente recebido nao passou na verificacao SHA256.');
    mkdirSync(dirname(cache),{recursive:true});const temp=cache+'.'+randomUUID();
    try{writeFileSync(temp,archive,{flag:'wx'});renameSync(temp,cache);}finally{rmSync(temp,{force:true});}
  }
  const exe=unpackVerifiedArchive(archive),hash=digest(exe);
  if(hash!==RUNTIME_FILES['tunnel-client.exe'])throw Error('Executavel oficial inesperado.');
  writeFileSync(join(dest,'tunnel-client.exe'),exe);
  const zip=new AdmZip(archive);
  for(const [source,name] of [['LICENSE','LICENSE'],['NOTICE','NOTICE'],['tunnel-client-v0.0.16-windows-amd64-licenses.txt','third-party-licenses.txt']]){
    const bytes=zip.readFile(source);if(!bytes||digest(bytes)!==RUNTIME_FILES[name])throw Error('Avisos de licenca do cliente invalidos.');writeFileSync(join(dest,name),bytes);
  }
  writeFileSync(join(dest,'manifest.json'),JSON.stringify({version:RELEASE.version,sha256:hash,archive_sha256:RELEASE.sha256},null,2)+'\n');
  // This expected hash is packaged inside app.asar, separate from the executable.
  writeFileSync(join(root,'desktop','tunnel-runtime-integrity.json'),JSON.stringify({version:RELEASE.version,sha256:hash})+'\n');
  console.log('Cliente do tunel verificado e preparado.');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  prepareTunnel(resolve(dirname(fileURLToPath(import.meta.url)),'..')).catch(error=>{console.error(error.message);process.exitCode=1;});
}
