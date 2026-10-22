import {existsSync,readFileSync,writeFileSync,renameSync,rmSync,mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';

export function validateTunnelConfig(value){
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Configuracao invalida.');
  const {tunnelId,apiKey}=value;
  if(typeof tunnelId!=='string'||!/^tunnel_[a-f0-9]{32}$/.test(tunnelId))throw Error('Informe o Tunnel ID completo.');
  if(typeof apiKey!=='string'||apiKey.length<20||apiKey.length>2048||!apiKey.startsWith('sk-')||/\s|[^\x21-\x7e]/.test(apiKey))throw Error('Cole a secret key completa da OpenAI, sem espacos.');
  return {tunnelId,apiKey};
}

export class TunnelVault {
  constructor(file,safeStorage){this.file=file;this.safeStorage=safeStorage;}
  assertSecure(){
    if(!this.safeStorage?.isEncryptionAvailable?.()||this.safeStorage.getSelectedStorageBackend?.()==='basic_text')throw Error('Protecao de credenciais do sistema indisponivel.');
  }
  read(){
    if(!existsSync(this.file))return null;
    this.assertSecure();
    try{return validateTunnelConfig(JSON.parse(this.safeStorage.decryptString(readFileSync(this.file))));}
    catch{throw Error('Nao foi possivel abrir a credencial protegida do tunel. Configure-a novamente.');}
  }
  write(config){
    this.assertSecure();const checked=validateTunnelConfig(config),temporary=this.file+'.'+randomUUID()+'.tmp';
    mkdirSync(dirname(this.file),{recursive:true});
    try{writeFileSync(temporary,this.safeStorage.encryptString(JSON.stringify(checked)),{flag:'wx',mode:0o600});renameSync(temporary,this.file);}
    finally{rmSync(temporary,{force:true});}
  }
  forget(){rmSync(this.file,{force:true});}
}
