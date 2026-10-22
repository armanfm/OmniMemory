// Device-bound automatic encryption key. The Electron safeStorage API uses
// the platform's credential protection; never fall back to plaintext.
const fs=require('node:fs');
const path=require('node:path');
const {randomBytes}=require('node:crypto');
const KEYFILE='memory-device-key.bin';
function getOrCreateDeviceSecret({dir,safeStorage,journalPath}){
  if(!safeStorage?.isEncryptionAvailable?.())throw Error('Secure OS key storage is unavailable. Refusing to create unprotected keys.');
  if(process.platform==='linux' && safeStorage.getSelectedStorageBackend?.()==='basic_text')throw Error('Insecure Electron basic_text backend is not allowed.');
  const keyPath=path.join(dir,KEYFILE);
  if(fs.existsSync(keyPath)){
    const bytes=fs.readFileSync(keyPath);
    let secret;try{secret=safeStorage.decryptString(bytes);}catch{throw Error('The local encryption key cannot be unlocked. Restore a key backup; do not recreate the key.');}
    if(!/^[a-f0-9]{64}$/.test(secret))throw Error('Invalid protected local encryption key.');
    return {secret,mode:'protected'};
  }
  // Never generate a new key for an existing journal: doing so can strand data.
  if(fs.existsSync(journalPath) && fs.statSync(journalPath).size>0){
    const existing=fs.openSync(journalPath,'r');let prefix=Buffer.alloc(32);try{fs.readSync(existing,prefix,0,32,0);}finally{fs.closeSync(existing);}
    if(prefix.toString('utf8').startsWith('{"omni_encrypted"'))throw Error('Encrypted legacy memory found without its key. Restore its passphrase before continuing.');
    return {secret:null,mode:'legacy-plaintext'};
  }
  const secret=randomBytes(32).toString('hex');
  const encrypted=safeStorage.encryptString(secret);
  fs.mkdirSync(dir,{recursive:true});
  const temp=keyPath+'.tmp-'+process.pid;
  try{fs.writeFileSync(temp,encrypted,{flag:'wx',mode:0o600});fs.renameSync(temp,keyPath);}finally{fs.rmSync(temp,{force:true});}
  return {secret,mode:'protected-new'};
}
module.exports={getOrCreateDeviceSecret};
