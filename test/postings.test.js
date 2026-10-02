import test from 'node:test';
import assert from 'node:assert/strict';
import {PostingList} from '../lib/postings.js';

test('packed postings preserve IDs through growth, deletion, shrinking and wide IDs',()=>{
 const list=new PostingList(),expected=new Set();
 for(let id=0;id<100;id++){list.appendUnique(id);expected.add(id);}
 for(const id of [2**32+7,Number.MAX_SAFE_INTEGER]){list.appendUnique(id);expected.add(id);}
 assert.deepEqual(new Set(list),expected);
 assert.equal(list.delete(999),false);
 for(const id of [...expected].slice(0,-1)){assert.equal(list.delete(id),true);expected.delete(id);assert.deepEqual(new Set(list),expected);assert.equal(list.size,expected.size);}
 assert.equal(list.delete(Number.MAX_SAFE_INTEGER),true);assert.deepEqual([...list],[]);
 list.appendUnique(42);list.appendUnique(43);assert.deepEqual([...list],[42,43]);
 assert.throws(()=>list.appendUnique(Number.MAX_SAFE_INTEGER+1),/safe integers/);
});
