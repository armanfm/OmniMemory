import { existsSync, readFileSync, statSync, mkdirSync, writeFileSync, appendFileSync, renameSync, rmSync, readdirSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { CONFIG, hash } from './text.js';
const TEXT=new Set('.txt .md .markdown .json .jsonl .csv .ts .tsx .js .jsx .mjs .cjs .rs .go .py .java .kt .kts .c .h .cpp .hpp .cs .sol .html .htm .css .scss .sass .less .yaml .yml .xml .sql .toml .ini .env .log .sh .ps1 .bat .cmd .vue .svelte .graphql .gql .properties'.split(' '));
export const safePart=v=>String(v??'').replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,180).replace(/^\.+$/,'_');
export function fileText(path,meta) {
  const size=statSync(path).size,mime=String(meta.mime??'').toLowerCase(),ext=extname(meta.filename??'').toLowerCase();
  const textType=TEXT.has(ext)||mime.startsWith('text/')||/json|xml|javascript|yaml/.test(mime);
  if(!textType||size>CONFIG.maxTextFileBytes) return {text:`${meta.filename??''} ${mime}`,index_mode:'metadata_only',size};
  const bytes=readFileSync(path);
  if(bytes.includes(0))return {text:`${meta.filename??''} ${mime}`,index_mode:'metadata_only',size};
  const text=bytes.toString('utf8');
  return text.trim()?{text,index_mode:'text',size}:{text:`${meta.filename??''} ${mime}`,index_mode:'metadata_only',size};
}
export class FileUploads {
  constructor(store,dir) {
    this.store=store;this.dir=resolve(dir);this.pending=new Map();mkdirSync(dir,{recursive:true});
    this.temp=join(dir,'.uploads');mkdirSync(this.temp,{recursive:true});
    // Temp files carry no committed metadata. Remove only stale upload fragments.
    for(const name of readdirSync(this.temp)) {const p=join(this.temp,name);if(statSync(p).isFile()&&Date.now()-statSync(p).mtimeMs>86400000)rmSync(p);}
  }
  start(meta) {
    const conversation_id=String(meta.conversation_id??'').trim(),file_id=String(meta.file_id??'').trim();
    const size=Number(meta.size),filename=String(meta.filename??'').trim();
    if(!conversation_id||!file_id||!filename||!Number.isSafeInteger(size)||size<0||size>CONFIG.maxUploadBytes)throw new Error('Invalid file metadata or file larger than 100 MiB.');
    if(this.store.blocked('conversation',conversation_id))throw new Error('This conversation was removed and capture is blocked.');
    for(const [id,u]of this.pending)if(Date.now()-u.started>3600000)this.abort(id);
    if(this.pending.size>=16)throw new Error('Too many uploads in progress.');
    const id=randomUUID(),path=join(this.temp,id+'.uploading');writeFileSync(path,Buffer.alloc(0));
    this.pending.set(id,{...meta,conversation_id,file_id,filename,size,path,received:0,started:Date.now(),digest:createHash('sha256')});return id;
  }
  append(id,base64,offset) {
    const u=this.pending.get(id);if(!u)throw new Error('Unknown upload_id.');
    if(typeof base64!=='string'||!/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64))throw new Error('Invalid base64.');
    const bytes=Buffer.from(base64,'base64');
    if(bytes.length>1024*1024)throw new Error('Upload chunk exceeds 1 MiB.');
    if(offset!==undefined&&offset!==u.received)throw new Error('Unexpected upload offset; restart this upload.');
    if(u.received+bytes.length>u.size)throw new Error('Upload exceeds declared size.');
    appendFileSync(u.path,bytes);u.digest.update(bytes);u.received+=bytes.length;return u.received;
  }
  finish(id) {
    const u=this.pending.get(id);if(!u)throw new Error('Unknown upload_id.');
    if(u.received!==u.size)throw new Error('Incomplete upload.');
    const digest=u.digest.copy().digest('hex');
    if(u.content_sha256&&u.content_sha256!==digest)throw new Error('File checksum mismatch.');
    const dir=join(this.dir,hash(u.conversation_id));mkdirSync(dir,{recursive:true});
    const final=join(dir,digest+'__'+safePart(u.filename));
    const extracted=fileText(u.path,u);
    // Content-addressed paths preserve the old file until the journal commit succeeds.
    if(existsSync(final))rmSync(u.path);else renameSync(u.path,final);
    const result=this.store.transaction(()=>this.store.upsertSource({...u,...extracted,kind:'file',saved_path:final,source_id:digest}));
    this.pending.delete(id);return {...result,filename:u.filename,conversation_id:u.conversation_id,index_mode:extracted.index_mode,size:u.size};
  }
  abort(id){const u=this.pending.get(id);if(u){rmSync(u.path,{force:true});this.pending.delete(id);}}
  close(){for(const id of this.pending.keys())this.abort(id);}
}
