import {spawn} from 'node:child_process';
import {createHash,randomBytes} from 'node:crypto';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createApp} from '../core/server.js';
import {validateTunnelConfig} from './tunnel-vault.mjs';

const digest=b=>createHash('sha256').update(b).digest('hex');
export function verifiedRuntime(runtimeDir){
  const expected=JSON.parse(readFileSync(new URL('./tunnel-runtime-integrity.json',import.meta.url),'utf8'));
  const manifest=JSON.parse(readFileSync(join(runtimeDir,'manifest.json'),'utf8'));
  const exe=join(runtimeDir,'tunnel-client.exe');
  if(manifest.version!=='0.0.16'||manifest.version!==expected.version||manifest.sha256!==expected.sha256||expected.sha256!=='4226bb74a72388147882881f29f79801b95e285d731a138071812e3aa6766571'||digest(readFileSync(exe))!==manifest.sha256)throw Error('Cliente do tunel ausente ou alterado. Gere novamente o instalador.');
  return exe;
}
export function childEnvironment(config,readKey,source=process.env){
  const env={};
  for(const name of ['SystemRoot','SYSTEMROOT','WINDIR','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA','PATH','Path','PATHEXT','PROGRAMDATA','ALLUSERSPROFILE'])if(source[name]!==undefined)env[name]=source[name];
  env.OMNI_TUNNEL_RUNTIME_KEY=config.apiKey;env.OMNI_TUNNEL_LOCAL_KEY=readKey;
  return env;
}
export function pollState(snapshot){
  const d=snapshot?.details;
  if(d?.http_status===401||d?.http_status===403)return 'unauthorized';
  if(d?.consecutive_failures>0)return 'offline';
  if(d?.last_success)return 'connected';
  return 'starting';
}

export class TunnelClient {
  constructor({store,fileDir,vault,runtimeDir,spawnClient=spawn,verify=verifiedRuntime,fetcher=fetch,platform=process.platform}){
    Object.assign(this,{store,fileDir,vault,runtimeDir,spawnClient,verify,fetcher,platform});
    this.state='disconnected';this.generation=0;this.active=null;this.config=null;this.busy=false;
  }
  status(){return {state:this.state,tunnelId:this.config?.tunnelId??'',configured:!!this.config,ready:this.state==='connected',lastToolCall:this.lastToolCall??null};}
  async restore(){try{const config=this.vault.read();if(config)await this.start(config,{save:false});}catch{this.state='configuration_error';}}
  async start(value,{save=true}={}){
    if(this.busy)throw Error('Aguarde a operacao de conexao em andamento.');
    const config=validateTunnelConfig(value);
    if(this.platform!=='win32')throw Error('Este cliente integrado requer Windows.');
    const exe=this.verify(this.runtimeDir);
    this.busy=true;const generation=++this.generation;
    this.shutdown();this.state='starting';this.lastToolCall=null;
    let run;
    try{
      const readKey=randomBytes(32).toString('hex');
      const server=createApp({store:this.store,key:randomBytes(32).toString('hex'),readKey,fileDir:this.fileDir,mcpOnly:true,isReadEnabled:()=>this.active===run&&this.generation===generation});
      const sockets=new Set();server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
      run={server,sockets,child:null,timer:null,dir:mkdtempSync(join(tmpdir(),'omnimemory-tunnel-')),generation,healthURL:null};
      this.active=run;
      await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
      if(this.generation!==generation)throw Error('Conexao cancelada.');
      const urlFile=join(run.dir,'health-url');
      const args=['run','--control-plane.base-url','https://api.openai.com','--control-plane.api-key','env:OMNI_TUNNEL_RUNTIME_KEY','--control-plane.tunnel-id',config.tunnelId,
        '--mcp.server-url',`http://127.0.0.1:${server.address().port}/mcp`,
        '--mcp.extra-headers','X-Omni-Read-Key: env:OMNI_TUNNEL_LOCAL_KEY',
        '--mcp.discovery-extra-headers','X-Omni-Read-Key: env:OMNI_TUNNEL_LOCAL_KEY',
        '--health.listen-addr','127.0.0.1:0','--health.url-file',urlFile,'--log.format','struct-text','--log.level','warn','--log.http-raw-unsafe=false'];
      run.child=this.spawnClient(exe,args,{windowsHide:true,shell:false,stdio:['ignore','pipe','pipe'],env:childEnvironment(config,readKey)});
      // Drain without retaining raw logs, prompts, headers, query results or secrets.
      run.child.stdout?.on('data',()=>{});run.child.stderr?.on('data',()=>{});
      const fail=()=>{if(this.active!==run)return;this.generation++;this.shutdown();this.state='offline';};
      run.child.once('error',fail);run.child.once('exit',fail);
      await new Promise((resolve,reject)=>{run.child.once('spawn',resolve);run.child.once('error',()=>reject(Error('Nao foi possivel iniciar o cliente do tunel.')));run.child.once('exit',()=>reject(Error('Cliente encerrado durante a conexao.')));});
      if(this.generation!==generation)throw Error('Conexao cancelada.');
      if(save)this.vault.write(config);
      this.config=config;
      run.urlFile=urlFile;run.timer=setInterval(()=>void this.observe(run),2500);run.timer.unref?.();
      await this.observe(run);
      return this.status();
    }catch(error){if(this.active===run){this.generation++;this.shutdown();this.state='configuration_error';}else if(run)this.closeRun(run);throw error;}
    finally{this.busy=false;}
  }
  async observe(run){
    if(this.active!==run||run.observing)return;run.observing=true;
    try{
      if(!run.healthURL){
        const raw=readFileSync(run.urlFile,'utf8').trim(),url=new URL(raw);
        if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.username||url.password||!url.port||url.search||url.hash)throw Error('Endereco local invalido.');
        run.healthURL=url.origin;
      }
      const response=await this.fetcher(run.healthURL+'/health/control-plane',{redirect:'error',signal:AbortSignal.timeout(2000)});
      if(!response.ok)throw Error('Diagnostico indisponivel.');
      const snapshot=await response.json();
      if(this.active===run&&run.generation===this.generation)this.state=pollState(snapshot);
    }catch{if(this.active===run&&this.state==='connected')this.state='offline';}
    finally{run.observing=false;}
  }
  shutdown(){
    const run=this.active;this.active=null;if(!run)return;
    this.closeRun(run);
  }
  closeRun(run){
    clearInterval(run.timer);
    for(const socket of run.sockets)socket.destroy();
    run.server.close();run.server.closeAllConnections();
    run.child?.kill();
    try{rmSync(run.dir,{recursive:true,force:true});}catch{}
  }
  disconnect(){this.generation++;this.shutdown();this.vault.forget();this.config=null;this.state='disconnected';return this.status();}
  stop(){this.generation++;this.shutdown();this.state='disconnected';}
}
