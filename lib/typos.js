// Probe the existing vocabulary at query time; no correction index is stored.
// One insertion, deletion, substitution or adjacent transposition is accepted.
const alphabet='abcdefghijklmnopqrstuvwxyz';
export function typoMatches(word,exists) {
  // Short terms, identifiers, hashes and codes keep exact-only semantics.
  if(!/^[a-z]{5,32}$/.test(word)||/^[a-f]{8,}$/.test(word))return [];
  const found=new Set();
  const probe=candidate=>{if(candidate!==word&&exists(candidate))found.add(candidate);};
  for(let i=0;i<word.length;i++){
    const left=word.slice(0,i),right=word.slice(i+1);
    probe(left+right);
    for(const letter of alphabet)if(letter!==word[i])probe(left+letter+right);
    if(i+1<word.length&&word[i]!==word[i+1])probe(left+word[i+1]+word[i]+word.slice(i+2));
  }
  for(let i=0;i<=word.length;i++)for(const letter of alphabet)probe(word.slice(0,i)+letter+word.slice(i));
  return [...found].sort();
}
