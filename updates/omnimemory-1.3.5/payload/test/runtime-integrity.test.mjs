import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,cpSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {prepareTunnel,unpackVerifiedArchive} from '../installer/prepare-tunnel.mjs';
import {verifiedRuntime} from '../desktop/tunnel-client.mjs';

test('bundled official runtime builds offline and changed executable or archive is refused',async t=>{
  const root=mkdtempSync(join(tmpdir(),'omni-runtime-test-'));t.after(()=>rmSync(root,{force:true,recursive:true}));
  mkdirSync(join(root,'desktop'));cpSync(fileURLToPath(new URL('../tunnel-runtime',import.meta.url)),join(root,'tunnel-runtime'),{recursive:true});
  let fetched=false;await prepareTunnel(root,{fetcher:async()=>{fetched=true;throw Error('No network allowed in test.');}});assert.equal(fetched,false);
  assert.equal(verifiedRuntime(join(root,'tunnel-runtime')),join(root,'tunnel-runtime','tunnel-client.exe'));
  writeFileSync(join(root,'tunnel-runtime','tunnel-client.exe'),'altered binary');assert.throws(()=>verifiedRuntime(join(root,'tunnel-runtime')),/alterado/);
  assert.throws(()=>unpackVerifiedArchive(Buffer.from('invalid archive')),/SHA256/);
});
