import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
export const ROOT=fileURLToPath(new URL('../',import.meta.url));
export const DATA=resolve(process.env.OMNI_DATA_DIR??join(ROOT,'data'));
export const MEMORY_PATH=resolve(process.env.OMNI_MEMORY_PATH??join(DATA,'omnimemory.jsonl'));
export const PREVIOUS_SQLITE=resolve(process.env.OMNI_DB_PATH??join(DATA,'omnimemory.sqlite'));
export const PORT=Number(process.env.PORT??8787);
export const FILE_DIR=resolve(process.env.OMNI_FILE_DIR??process.env.TD_FILE_DIR??join(DATA,'files'));
export const LEGACY_MESSAGES=resolve(process.env.TD_MEMORY_PATH??join(DATA,'messages.jsonl'));
export const LEGACY_FILES=resolve(process.env.TD_FILE_META_PATH??join(DATA,'files.jsonl'));
export function configureCapture() {
  mkdirSync(DATA,{recursive:true});
  const path=join(DATA,'capture-key');
  let key=process.env.OMNI_CAPTURE_KEY??process.env.TD_CAPTURE_KEY;
  if(!key)key=existsSync(path)?readFileSync(path,'utf8').trim():randomBytes(32).toString('hex');
  if(key.length<16)throw new Error('Capture key must contain at least 16 characters.');
  writeFileSync(path,key,{mode:0o600});
  writeFileSync(join(ROOT,'extension','config.js'),'globalThis.OMNI_CONFIG = '+JSON.stringify({base:`http://127.0.0.1:${PORT}`,key})+';\n',{mode:0o600});
  return key;
}
