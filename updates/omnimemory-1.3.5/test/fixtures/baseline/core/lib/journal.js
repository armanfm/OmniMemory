import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, openSync, closeSync, rmSync, renameSync, statSync, truncateSync, readSync, fstatSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID, randomBytes, scryptSync, createCipheriv, createDecipheriv } from 'node:crypto';
import { hash } from './text.js';

// One flushed JSON line is one committed batch. Indexes are never written here.
export class Journal {
  constructor(path,{readOnly=false}={}) {
    this.path=path;this.readOnly=readOnly;this.memory=path===':memory:';this.closed=false;
    this.passphrase=process.env.OMNI_MEMORY_PASSPHRASE || null;
    this.encrypted=false;this.key=null;this.salt=null;
    if(this.passphrase && this.memory)throw new Error('Encrypted memory mode requires a file path.');
    if(this.memory)return;
    mkdirSync(dirname(path),{recursive:true});
    this.lock=path+'.lock';this.owner=randomUUID();
    if(!readOnly){
      if(existsSync(this.lock)) {
        let previous;try{previous=JSON.parse(readFileSync(this.lock,'utf8'));}catch{}
        if(previous?.pid){try{process.kill(previous.pid,0);}catch(e){if(e.code==='ESRCH')rmSync(this.lock);}}
      }
      let fd;try{fd=openSync(this.lock,'wx',0o600);}catch(e){if(e.code==='EEXIST')throw new Error('Memory is already open for writing. Stop the server before administrative writes. Read-only CLI commands can run while it is active.');throw e;}
      try{writeFileSync(fd,JSON.stringify({pid:process.pid,owner:this.owner}));}finally{closeSync(fd);}
      try{
        if(!existsSync(path)) {
          if(this.passphrase){this.salt=randomBytes(16);this.initCipher(this.salt);writeFileSync(path,this.header(),{mode:0o600,flush:true});}
          else writeFileSync(path,'',{mode:0o600});
        }
      }catch(e){this.close();throw e;}
    }
  }
  initCipher(salt){
    if(!this.passphrase)throw new Error('Encrypted memory requires OMNI_MEMORY_PASSPHRASE.');
    this.salt=salt;this.key=scryptSync(this.passphrase,salt,32,{N:16384,r:8,p:1,maxmem:64*1024*1024});this.encrypted=true;
  }
  header(){return JSON.stringify({omni_encrypted:1,kdf:'scrypt',cipher:'aes-256-gcm',salt:this.salt.toString('base64')})+'\n';}
  parseHeader(line){
    let meta;try{meta=JSON.parse(line);}catch{throw new Error('Invalid encrypted journal header.');}
    if(meta.omni_encrypted!==1||meta.kdf!=='scrypt'||meta.cipher!=='aes-256-gcm'||typeof meta.salt!=='string')throw new Error('Unsupported encrypted journal format.');
    const salt=Buffer.from(meta.salt,'base64');if(salt.length!==16)throw new Error('Invalid encrypted journal salt.');
    this.initCipher(salt);
  }
  seal(events){
    const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key,iv);
    const plaintext=Buffer.from(JSON.stringify({version:1,events,checksum:hash(JSON.stringify(events))}));
    const payload=Buffer.concat([cipher.update(plaintext),cipher.final()]);
    return JSON.stringify({e:1,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:payload.toString('base64')})+'\n';
  }
  open(row){
    if(row.e!==1)throw new Error('Unencrypted row in encrypted journal.');
    const iv=Buffer.from(row.iv??'','base64'),tag=Buffer.from(row.tag??'','base64'),body=Buffer.from(row.data??'','base64');
    if(iv.length!==12||tag.length!==16)throw new Error('Invalid encrypted memory record.');
    try{const dec=createDecipheriv('aes-256-gcm',this.key,iv);dec.setAuthTag(tag);return JSON.parse(Buffer.concat([dec.update(body),dec.final()]).toString('utf8'));}
    catch{throw new Error('Memory decryption failed: wrong passphrase or modified data.');}
  }
  load(apply) {
    if(this.memory||!existsSync(this.path))return;
    const fd=openSync(this.path,'r');
    let offset=0,committed=0,lineNumber=0,parts=[],pendingBytes=0;
    try{
      // Bound reads to the file size at open: readers see a point-in-time prefix.
      const size=fstatSync(fd).size,header=Buffer.alloc(16);
      readSync(fd,header,0,Math.min(16,size),0);
      if(header.toString().startsWith('SQLite format 3'))throw new Error('This is a SQLite database. Export it with the previous version before using the JSONL store.');
      const encryptedFile=header.toString().startsWith('{"omni_encrypt');
      if(encryptedFile&&!this.passphrase)throw new Error('Encrypted memory requires OMNI_MEMORY_PASSPHRASE; refusing to open.');
      if(!encryptedFile&&this.passphrase&&size>0)throw new Error('Existing plaintext journal: run migrate-encryption.mjs first; refusing to mix encrypted and plaintext records.');
      let headerPending=encryptedFile;
      while(offset<size){
        const buffer=Buffer.allocUnsafe(Math.min(256*1024,size-offset));
        const count=readSync(fd,buffer,0,buffer.length,offset);if(!count)break;
        let start=0;
        for(let end=buffer.indexOf(10,start);end>=0&&end<count;end=buffer.indexOf(10,start)){
          const piece=buffer.subarray(start,end);parts.push(piece);pendingBytes+=piece.length;
          const line=parts.length===1?piece.toString('utf8'):Buffer.concat(parts,pendingBytes).toString('utf8');
          lineNumber++;
          if(line){
            if(headerPending){this.parseHeader(line);headerPending=false;parts=[];pendingBytes=0;start=end+1;committed=offset+start;continue;}
            let row;try{row=JSON.parse(line);}catch{throw new Error('Invalid memory journal at line '+lineNumber);}
            if(this.encrypted)row=this.open(row);
            if(row.version!==1||!Array.isArray(row.events)||row.checksum!==hash(JSON.stringify(row.events)))throw new Error('Invalid memory journal checksum or version at line '+lineNumber);
            for(const event of row.events)apply(event);
          }
          parts=[];pendingBytes=0;start=end+1;committed=offset+start;
        }
        if(start<count){parts.push(Buffer.from(buffer.subarray(start,count)));pendingBytes+=count-start;}
        offset+=count;
      }
      if(pendingBytes&&!this.readOnly){
        const recovery=this.path+'.interrupted-'+Date.now();writeFileSync(recovery,Buffer.concat(parts,pendingBytes),{mode:0o600,flush:true});
        truncateSync(this.path,committed);console.warn('Recovered an interrupted JSONL batch; its bytes were preserved in '+recovery);
      }
    }finally{closeSync(fd);}
  }

  encode(events){return this.encrypted?this.seal(events):JSON.stringify({version:1,events,checksum:hash(JSON.stringify(events))})+'\n';}
  append(events) {
    if(this.closed)throw new Error('Memory is closed.');
    if(this.readOnly)throw new Error('Memory was opened read-only.');
    if(this.memory||!events.length)return;
    const before=statSync(this.path).size;
    try{appendFileSync(this.path,this.encode(events),{flush:true});}
    catch(e){try{truncateSync(this.path,before);}catch{}throw e;}
  }
  snapshot(events,path=this.path) {
    if(this.closed)throw new Error('Memory is closed.');
    if(path===this.path&&this.readOnly)throw new Error('Memory was opened read-only.');
    if(path===':memory:')return;
    mkdirSync(dirname(path),{recursive:true});
    const temp=path+'.tmp-'+randomUUID();
    try{writeFileSync(temp,(this.encrypted?this.header():'')+this.encode(events),{mode:0o600,flush:true});renameSync(temp,path);}finally{rmSync(temp,{force:true});}
  }
  close(){if(this.closed)return;this.closed=true;if(this.memory||this.readOnly)return;
    try{if(JSON.parse(readFileSync(this.lock,'utf8')).owner===this.owner)rmSync(this.lock);}catch(e){if(e.code!=='ENOENT')throw e;}
  }
}

