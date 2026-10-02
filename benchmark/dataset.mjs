import {createHash} from 'node:crypto';
const digest=s=>createHash('sha256').update(s).digest('hex');
const departments=['laboratorio','transportadora','mineradora','purificadora','fabricante','recicladora'];
const materials=['neodimio','cobalto','litio','cerio','disprosio','lantanio'];
export function corpus(n){return Array.from({length:n},(_,i)=>{
 const conv='projeto-'+Math.floor(i/20).toString().padStart(5,'0');
 const message_id=digest('omni-benchmark-message-'+i).slice(0,32);
 return {conversation_id:conv,message_id,role:i%2?'assistant':'user',captured_at:new Date(Date.UTC(2026,0,1,0,i)).toISOString(),
  ...(i%20?{previous_message_id:digest('omni-benchmark-message-'+(i-1)).slice(0,32)}:{}),
  text:`Registro registro-${i.toString().padStart(6,'0')} do ${conv}. A ${departments[i%6]} acompanha o lote lote-${digest('lot-'+i).slice(0,12)} de ${materials[i%6]}. A quantidade declarada foi ${1000+i%800} kg. O protocolo exige rastreabilidade, evidencias e auditoria do material. O responsavel registra a origem, o destino e as alteracoes antes de concluir a transferencia. Referencia tecnica: 0x${digest('contract-'+i).slice(0,40)}.`};
 });}
export function performanceQueries(n){const index=Math.floor(n*.71),conv='projeto-'+Math.floor(index/20).toString().padStart(5,'0');
 return [
 {id:'exact_id',category:'selective',query:'registro-'+index.toString().padStart(6,'0')},
 {id:'exact_hash',category:'selective',query:'0x'+digest('contract-'+Math.floor(n*.43)).slice(0,40)},
 {id:'project_topic',category:'selective',query:conv+' quantidade material'},
 {id:'scoped_topic',category:'scoped',query:'origem destino transferencia',conversation_id:conv},
 {id:'fuzzy_identifier',category:'fuzzy',query:'registrp-'+index.toString().padStart(6,'0')},
 {id:'typo_word',category:'typo',query:'origem destino transferencai',conversation_id:conv},
 {id:'global_common',category:'broad',query:'rastreabilidade auditoria material'},
 {id:'no_match',category:'absent',query:'zzqxvzzqxv'}
 ];}
export function qualityFixture(){
 const messages=corpus(400),cases=[];
 function add(id,category,text,query,{conversation_id='quality-'+id,more=[],answer=[],expected=[],absent=false}={}){
  const mid='m-'+id;messages.push({conversation_id,message_id:mid,role:'user',text,captured_at:'2026-01-01T00:00:00Z'});
  for(const m of more)messages.push({conversation_id,captured_at:'2026-01-01T00:00:01Z',...m});
  cases.push({id,category,query,...(conversation_id.startsWith('scoped-')?{conversation_id}:{}),
    expected:expected.length?expected:[{conversation_id,source_id:mid}],answer_needles:answer,absent});
 }
 for(let i=0;i<5;i++)add('literal'+i,'literal',`O projeto Mineral${i} adotou o parametro limite operacional ${20+i} quilogramas. Codigo certificado: CERT-AX${i}.`,`Mineral${i} limite operacional`,{answer:[String(20+i)+' quilogramas']});
 for(let i=0;i<5;i++){const addr='0x'+digest('quality-address-'+i).slice(0,40);add('hash'+i,'identifier',`Contrato de referencia para a filial ${i}: ${addr}.`,addr,{answer:[addr]});}
 const names=['ExploreChem','Verificadora','Rastreabilidade','Consolidacao','Transportadora'];
 const typos=['Explorecham','Verificadpra','Rastreabilidafe','Consolidacap','Transportadpra'];
 for(let i=0;i<5;i++)add('typo'+i,'typo',`${names[i]} registra a chave secreta ficcional FATO-${i}-QXZ.`,typos[i],{answer:[`FATO-${i}-QXZ`]});
 const synonyms=[
 ['O veiculo ficou imobilizado na rodovia por pane mecanica.','Por que o automovel parou na estrada?'],
 ['A equipe decidiu adiar o encontro devido a tempestade.','Qual foi o motivo do cancelamento da reuniao por chuva?'],
 ['O fornecedor reduziu o preco da mercadoria apos negociacao.','Houve desconto no produto comprado?'],
 ['A encomenda foi entregue no domicilio de Beatriz.','Onde a cliente recebeu o pacote?'],
 ['A credencial expirou e impediu a autenticacao do funcionario.','Por que o empregado nao conseguiu entrar na conta?']];
 synonyms.forEach(([text,q],i)=>add('semantic'+i,'paraphrase',text,q,{answer:[text]}));
 for(let i=0;i<5;i++){
  const conv='quality-neighbor'+i;
  messages.push({conversation_id:conv,message_id:'b-unrelated',role:'user',text:'Observacao administrativa sem a resposta procurada.'});
  add('neighbor'+i,'neighbor',`Qual foi a decisao do projeto Nexo${i} sobre o frete?`,`Nexo${i} decisao frete`,{conversation_id:conv,
   more:[{message_id:'a-answer',role:'assistant',previous_message_id:'m-neighbor'+i,text:`A decisao foi contratar a empresa SERRA-${i} e pagar ${70+i} reais.`}],
   answer:[`SERRA-${i}`],expected:[{conversation_id:conv,source_id:'a-answer'}]});
 }
 for(let i=0;i<5;i++){
  const conv='quality-update'+i;
  messages.push({conversation_id:conv,message_id:'z-old',role:'user',text:`O parametro da linha temporal Vega${i} era ${10+i} unidades em janeiro.`});
  add('update'+i,'knowledge_update',`Atualizacao: o parametro da linha temporal Vega${i} agora vale ${60+i} unidades; substitui o valor de janeiro.`,`Vega${i} parametro atual`,{conversation_id:conv,answer:[`${60+i} unidades`]});
 }
 for(let i=0;i<5;i++){
  const conv='scoped-team'+i;
  messages.push({conversation_id:'other-team'+i,message_id:'wrong',role:'user',text:`A chave Lumen${i} pertence ao grupo ERRADO-${i}.`});
  add('scope'+i,'scope',`A chave Lumen${i} pertence ao grupo CORRETO-${i}.`,`Lumen${i} chave`,{conversation_id:conv,answer:[`CORRETO-${i}`]});
 }
 for(let i=0;i<5;i++){
  const conv='quality-join'+i;
  messages.push({conversation_id:conv,message_id:'b-gap',role:'assistant',text:'Um comentario intermediario sobre o calendario.'});
  add('join'+i,'multi_evidence',`No projeto Ponte${i}, a unidade Origem${i} transfere material para a unidade Destino${i}.`,`Ponte${i} transferencia limite`,{conversation_id:conv,
   more:[{message_id:'a-second',role:'user',previous_message_id:'m-join'+i,text:`A unidade Destino${i} admite apenas ${90+i} quilogramas por transferencia.`}],
   expected:[{conversation_id:conv,source_id:'m-join'+i},{conversation_id:conv,source_id:'a-second'}],answer:[`Origem${i}`,`${90+i} quilogramas`]});
 }
 for(let i=0;i<5;i++)cases.push({id:'absent'+i,category:'unanswerable',query:'zqxv'+i+' nvvqqxxzz',expected:[],answer_needles:[],absent:true});
 return {messages,cases,description:'45 synthetic Portuguese retrieval questions across nine categories; no LLM answers or judge.'};
}
