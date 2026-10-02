// Numeric postings: a singleton stays a number; larger lists use packed buffers.
// appendUnique is internal: callers add each chunk/token association exactly once.
export class PostingList {
  constructor(){this.size=0;this.items=0;}
  appendUnique(id){
    if(!Number.isSafeInteger(id)||id<0)throw new Error('Posting IDs must be non-negative safe integers.');
    if(!this.size){this.items=id;this.size=1;return;}
    if(this.size===1){const first=this.items;this.items=(id>0xffffffff||first>0xffffffff)?new Float64Array(4):new Uint32Array(4);this.items[0]=first;}
    if(id>0xffffffff&&this.items instanceof Uint32Array){const wide=new Float64Array(this.items.length);wide.set(this.items);this.items=wide;}
    if(this.size===this.items.length){const grown=new this.items.constructor(this.items.length*2);grown.set(this.items);this.items=grown;}
    this.items[this.size++]=id;
  }
  delete(id){
    if(!this.size)return false;
    if(this.size===1){if(this.items!==id)return false;this.items=0;this.size=0;return true;}
    const index=this.items.subarray(0,this.size).indexOf(id);if(index<0)return false;
    this.items[index]=this.items[--this.size];
    if(this.size===1)this.items=this.items[0];
    else if(this.size<this.items.length/4)this.items=this.items.slice(0,Math.max(4,this.size*2));
    return true;
  }
  *[Symbol.iterator](){if(this.size===1){yield this.items;return;}for(let i=0;i<this.size;i++)yield this.items[i];}
}
export class TokenPostings extends PostingList {
  constructor(token){super();this.token=token;}
}
