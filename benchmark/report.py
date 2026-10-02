"""Generate current-version documentation from recorded measurements; does not run tests."""
import json,statistics,collections,csv
from pathlib import Path
root=Path(__file__).resolve().parent
version=json.loads((root.parent/'package.json').read_text())['version']
perf=json.loads((root/'results/current-performance.json').read_text())
loc=json.loads((root/'results/current-locomo.json').read_text())
r=next(r for r in perf['runs'] if r['engine']=='jsonl')
q=next(r for r in perf['quality'] if r['engine']=='jsonl')
l=next(r for r in loc['runs'] if r['engine']=='jsonl');ls=l['summary']
boots=[b for b in perf['boots'] if b['engine']=='jsonl']
s={'disk_mib':r['disk_bytes']/1048576,'ingestion_s':r['ingestion_ms']/1000,'update10_ms':r['update10_ms'],'unchanged10_ms':r['unchanged10_ms'],'boot_ms':statistics.median(b['boot_ms'] for b in boots),'boot_rss_mib':statistics.median(b['rss_mb'] for b in boots),'workload_rss_mib':r['rss_mb']}
labels={'exact_id':'Identificador exato','exact_hash':'Hash exato','project_topic':'Tema de projeto na base inteira','scoped_topic':'Tema restrito a uma conversa','fuzzy_identifier':'Identificador com erro: exige correspondência exata','typo_word':'Palavra com letras invertidas, restrita a uma conversa','global_common':'Termos comuns na base inteira','no_match':'Termo ausente'}
categories={'literal':'Fatos literais','identifier':'Identificadores exatos','typo':'Erros de digitação','paraphrase':'Paráfrases sem sobreposição lexical suficiente','neighbor':'Evidência em mensagem vizinha','knowledge_update':'Atualização de informação','scope':'Restrição por conversa','multi_evidence':'Evidências distribuídas','unanswerable':'Consultas sem resposta: retorno vazio correto'}
quality=collections.defaultdict(list)
for item in q['results']:quality[item['category']].append(item)
quality_rows=[(categories.get(cat,cat),sum(bool(x['abstained'] if cat=='unanswerable' else x['all_evidence']) for x in vals),len(vals)) for cat,vals in quality.items()]
answerable=[x for x in q['results'] if x['category']!='unanswerable']
good=sum(bool(x['all_evidence']) for x in answerable)
empty=quality['unanswerable']; empty_good=sum(bool(x['abstained']) for x in empty)
md=['# OmniMemory — benchmarks','',
f'Este documento registra o desempenho e a recuperação de contexto do OmniMemory {version}: persistência em JSONL, índice lexical em RAM e corte relativo de metade das correspondências do melhor resultado.','',
'## Proposta e interpretação','',
'O projeto pode ser descrito como uma ponte conceitual entre o **palácio da memória**, com informações em pontos que podem ser revisitados, e uma **memória consultável por agentes**, uso para o qual serviços como o Zep são uma referência. O bibliotecário da IA localiza fragmentos e traz o contexto ao redor; o agente interpreta as evidências. Esse posicionamento é uma metáfora de organização e acesso, não uma equivalência entre técnicas cognitivas e algoritmos nem uma classificação de desempenho em relação ao Zep.','',
'A implementação usa palavras inteiras normalizadas e tenta uma edição quando a palavra não existe no escopo consultado. São aceitas inserção, remoção, substituição ou inversão de duas letras vizinhas em palavras de consulta com 5–32 letras. Códigos com números ou pontuação, palavras curtas e sequências hexadecimais longas exigem correspondência exata. Não há índice de bigramas ou de correções; as alternativas são consultadas no vocabulário existente durante a busca. O mínimo é metade das correspondências do melhor candidato, arredondada para cima: melhor com 10 exige pelo menos 5. Repetições contam uma vez e vizinhos são adicionados após o filtro. Os resultados abaixo medem essa recuperação lexical; não pressupõem busca semântica por embeddings, construção de grafo de conhecimento ou raciocínio pelo mecanismo de memória.','',
'## Ambiente','',f"Execução sintética: `{perf['started_at']}` a `{perf.get('finished_at','')}` (UTC).",f"Execução LoCoMo: `{loc['started_at']}` a `{loc.get('finished_at','')}` (UTC).",f"Node {perf['node']}; {perf['platform']}; CPU {perf['cpu']}; {perf['logical_cpus']} CPUs lógicas visíveis.",
'', 'As medições ocorreram em 1 de outubro de 2026 no horário de São Paulo. São resultados de uma máquina e dos conjuntos especificados, não garantias de desempenho em outros ambientes. Nenhuma conversa pessoal foi usada.','',
'## Base sintética: 20 mil mensagens','', '| Medida | Resultado |','| --- | ---: |']
for label,key,unit in [('Armazenamento em disco','disk_mib','MiB'),('Importação inicial','ingestion_s','s'),('Atualizar dez mensagens','update10_ms','ms'),('Reenviar dez mensagens sem mudança de conteúdo','unchanged10_ms','ms'),('Reabrir a memória e reconstruir o índice','boot_ms','ms'),('RAM do processo após reabertura','boot_rss_mib','MiB'),('RAM do processo após consultas','workload_rss_mib','MiB')]:md.append(f'| {label} | {s[key]:.3f} {unit} |')
md+=['','### Latência de busca','', '| Consulta | p50 | p95 amostral |','| --- | ---: | ---: |']
for row in r['timings']:md.append(f"| {labels[row['id']]} | {row['p50_ms']:.3f} ms | {row['p95_ms']:.3f} ms |")
md+=['','Cada consulta teve uma execução de aquecimento e cinco medições. Com cinco observações, o p95 amostral corresponde ao máximo observado; não é uma estimativa robusta da cauda em produção.','',
'### Protocolo de desempenho','',
'- Corpus reproduzível de 20 mil mensagens, em conversas de 20 mensagens, com identificadores, hashes e termos técnicos; ingestão em lotes de 100.',
'- Uma medição de importação, uma atualização de dez mensagens e um reenvio sem mudança. Top-K 8 e orçamento normal de 24 mil caracteres nas consultas sintéticas.',
'- Reabertura medida em três processos separados, sem limpar o cache do sistema operacional. O cronômetro cobre abrir a memória e reconstruir o índice, sem o tempo de iniciar o processo Node.',
'- Disco medido após fechar o armazenamento, incluindo os registros da atualização. O diário guarda fontes e metadados; índices e fragmentos são reconstruídos na RAM. Revisões anteriores de fontes permanecem no diário até compactar.',
'- RAM é RSS do processo, não apenas tamanho do índice. A medição após consultas inclui o gerador do corpus e estruturas do teste. A medição de reabertura não carrega esse gerador. Nenhuma delas representa um pico garantido.',
'- Há limite de 10 mil candidatos pontuados. Nas buscas amplas desta base, 20 mil candidatos podem ser encontrados e somente 10 mil pontuados. O resultado informa essa truncagem; o limite pode reduzir recall.',
'- Tempos são locais: sem rede, HTTP, geração de resposta ou raciocínio do agente. Gravações, indexação e buscas são síncronas; buscas amplas podem ocupar o event loop.',
'','## Recuperação sintética','',
f'**{good} de {len(answerable)} consultas respondíveis ({100*good/len(answerable):.1f}%) recuperaram todas as fontes esperadas.** Das {len(empty)} consultas adicionais sem resposta, {empty_good} retornaram contexto vazio corretamente.','',
'| Categoria | Resultado |','| --- | ---: |']
for label,category_good,total in quality_rows:md.append(f'| {label} | {category_good}/{total} |')
md+=['',
'A métrica verifica as fontes esperadas no contexto retornado, incluindo vizinhos. Não é acurácia de respostas nem Recall@8 clássico de chunks: Top-K seleciona os hits antes da expansão. Os casos de atualização verificam a presença da informação nova, sem avaliar se uma IA escolheria a versão correta.','',
'A tolerância cobre somente uma edição nas palavras elegíveis. Uma palavra exata já existente não é reinterpretada; alternativas ambíguas podem trazer trechos irrelevantes. Cinco casos sintéticos aprovados não demonstram cobertura de todos os erros de digitação. Paráfrases continuam dependendo de pistas lexicais suficientes. A latência de uma consulta sem resultado não representa uma recuperação bem-sucedida; veja a qualidade por categoria.','',
'## LoCoMo: avaliação pública','',
f"Foram executadas **{ls['questions']:,} perguntas**, nas dez conversas do dataset, com **{ls['message_count']:,} falas**. Categorias 1–4 incluídas; categoria 5, com 446 perguntas adversariais, excluída.",
'', '| Medida | Resultado |','| --- | ---: |',
f"| Perguntas com toda a evidência anotada no contexto | {ls['complete_evidence']}/{ls['questions_with_evidence']} — {100*ls['complete_evidence_rate']:.2f}% |",
f"| Recall médio das evidências por pergunta | {100*ls['mean_evidence_recall']:.2f}% |",
f"| Latência p50 | {ls['p50_ms']:.2f} ms |",f"| Latência p95 | {ls['p95_ms']:.2f} ms |",f"| Contexto mediano entregue à avaliação | {ls['median_context_chars']:,} caracteres |",
f"| Armazenamento das 5.882 falas | {ls['disk_bytes']/1048576:.3f} MiB |",f"| Tempo acumulado de ingestão | {ls['ingestion_ms']:.2f} ms |",f"| RAM do processo após o teste | {ls['rss_mib']:.2f} MiB |",'',
'### O que a métrica significa','',
'**Evidência completa significa que todas as falas anotadas como suporte apareceram integralmente no contexto entregue. Não significa que uma IA respondeu corretamente.** O cálculo normaliza apenas espaços e exige o texto integral de cada fala; uma referência de fonte sem o texto correspondente após o corte não conta. É uma medida conservadora: parte de uma fala ou outra evidência pode bastar para responder.',
'',
'Quatro perguntas sem evidência anotada ficam fora do denominador de recuperação, mas entram na latência. Três perguntas possuem pelo menos um identificador de evidência não resolvido no corpus; esses identificadores foram registrados e contados como não encontrados.','',
'### Protocolo LoCoMo','',
'- Fonte: arquivo oficial locomo10.json, do repositório Snap Research, incluído com atribuição e licença.',
f"- SHA-256: `{loc['dataset_sha256']}`.",
'- Falas importadas em ordem, com IDs sequenciais, nome do falante, data da sessão e legenda de imagem quando fornecida. Respostas, anotações de evidência, observações e resumos não são indexados.',
'- Busca restrita à conversa inteira, incluindo todas as sessões. As conversas são adicionadas progressivamente ao corpus; cada pergunta consulta apenas sua conversa.',
'- Top-K 20 antes da expansão. O motor usa seu teto normal de 24 mil caracteres; o harness limita o texto entregue à avaliação a 10 mil caracteres.',
'- Uma pergunta de aquecimento por conversa e uma execução medida por pergunta. p50 e p95 são calculados entre as 1.540 consultas diferentes.',
'- O tempo de busca mede o motor; o corte final de texto e a verificação das evidências ocorrem depois do cronômetro. Não houve leitor ou juiz por LLM.',
'- A RAM ao final inclui corpus e contextos guardados pelo avaliador. O espaço em disco corresponde a esta base específica, não deve ser extrapolado como tamanho fixo por mensagem.',
'','## Zep: referência externa','',
'**O Zep não foi executado neste teste.** Os números abaixo são publicados pelo fornecedor, consultados em 1 de outubro de 2026. Não havia conexão autenticada disponível para uma execução direta.','',
'| Sistema e configuração | Busca p50 / p95 | Contexto | Avaliação |','| --- | --- | --- | --- |',
f"| OmniMemory — medido localmente | {ls['p50_ms']:.2f} / {ls['p95_ms']:.2f} ms | limite de 10.000 caracteres na avaliação | {100*ls['complete_evidence_rate']:.2f}% de evidência completa |",
'| Zep Auto Search — publicado | 115 / 173 ms | limite de 10.000 caracteres; mediana de 2.680 tokens | 86,5% de acurácia de respostas |',
'| Zep Multi-scope — publicado | 87 / 155 ms | mediana de 5.760 tokens | 94,7% de acurácia de respostas |','',
'A igualdade do limite de 10 mil caracteres aproxima o orçamento de contexto do Auto Search. Ela não iguala infraestrutura, rede, algoritmo, leitor ou método de avaliação. As porcentagens medem coisas diferentes e não devem ser usadas para declarar um vencedor.','',
'O Zep informa leitor gpt-5.4 com reasoning=medium e juiz gpt-5.4. Multi-scope usa 20 edges, 10 nodes, 10 episodes, cinco thread summaries, cinco observations e cross-encoder; esses limites não equivalem a Top-K 20 de chunks.',
'',
'A distribuição por categorias do snapshot oficial utilizado (282/321/96/841) difere da publicada pelo Zep. Não foi reproduzida a versão exata nem a preparação de dados do fornecedor. Também não foi localizado um número equivalente de armazenamento total do Zep para essas bases.',
'',
'Uma comparação direta de qualidade exige o mesmo snapshot, perguntas, escopo e orçamento de contexto, além do mesmo modelo leitor, prompt e juiz. Latência de rede e custo de API devem ser registrados separadamente.','',
'## Reprodução e arquivos','',
'Na pasta OmniMemory, com Node.js 24 e Python 3:','',
'```bash\nnpm install\nnpm test\nnode benchmark/run.mjs --current\nnode benchmark/locomo.mjs --current\npython3 benchmark/report.py\n```','',
'Os comandos medem a implementação atual usando diretórios temporários, sem alterar o arquivo de memória do usuário. `run.mjs --current` usa 20 mil mensagens por padrão e grava `benchmark/results/current-performance.json`; o avaliador LoCoMo grava `benchmark/results/current-locomo.json`. O gerador produz este relatório, a seção de benchmarks do README, `current-summary.json` e `current-performance.csv` a partir desses registros. Gerar a documentação não executa o benchmark novamente.',
'',
'Os JSON incluem amostras, perguntas, fontes e contextos retornados para inspeção. O dataset acompanha a licença em `benchmark/data/LoCoMo-LICENSE.txt`. Os registros atuais foram gerados com o código desta entrega. Resultados históricos preservados em outros JSON não descrevem necessariamente a implementação atual.','',
'## Fontes','',
'- [LoCoMo — Snap Research](https://github.com/snap-research/locomo): Maharana et al., Evaluating Very Long-Term Conversational Memory of LLM Agents, ACL 2024. Dataset CC BY-NC 4.0, utilizado aqui para avaliação não comercial.',
'- [Zep — métodos e resultados](https://www.getzep.com/research/): referência publicada pelo fornecedor; não é execução local.']
(root.parent/'BENCHMARK.md').write_text('\n'.join(md)+'\n')
summary={'implementation':f'OmniMemory {version}','storage':'JSONL','index':'in-memory tokens with query-time single-edit fallback','synthetic_20000':s,'locomo':ls,'zep_executed':False}
(root/'results/current-summary.json').write_text(json.dumps(summary,indent=2)+'\n')
with (root/'results/current-performance.csv').open('w') as f:
 w=csv.writer(f);w.writerow(['query','p50_ms','p95_ms','samples']);w.writerows((r['id'],r['p50_ms'],r['p95_ms'],r['n']) for r in r['timings'])
en=['## Benchmarks','',
f'Measured with OmniMemory {version}, Node.js 24.19.0 on Linux, AMD EPYC 9V74, nine visible logical CPUs, on October 1, 2026 (São Paulo). These are local retrieval measurements, excluding network calls and model reasoning. Full methods, raw records, licenses and reproduction commands are in [BENCHMARK.md](BENCHMARK.md).','',
'### Synthetic corpus: 20,000 messages','', '| Measurement | Result |','| --- | ---: |',
f"| Disk storage | {s['disk_mib']:.2f} MiB |",f"| Initial ingestion | {s['ingestion_s']:.3f} s |",f"| Update ten messages | {s['update10_ms']:.3f} ms |",f"| Resend ten unchanged messages | {s['unchanged10_ms']:.3f} ms |",f"| Reopen and rebuild the index | {s['boot_ms']/1000:.3f} s |",f"| Process RSS after reopening | {s['boot_rss_mib']:.2f} MiB |",f"| Process RSS after queries | {s['workload_rss_mib']:.2f} MiB |",'',
'| Query | p50 | Sample p95 |','| --- | ---: | ---: |']
for row in r['timings']:en.append(f"| `{row['id']}` | {row['p50_ms']:.3f} ms | {row['p95_ms']:.3f} ms |")
en+=['',
'Each query has one warm-up and five measurements; sample p95 is therefore the maximum of five observations, not a robust production tail estimate. Ingestion uses batches of 100; reopening is the median of three separate processes with OS caches left intact. RSS after queries includes the corpus generator and temporary benchmark structures; reopening RSS does not. These are process measurements, not index-only sizes or guaranteed peaks.',
'',
'The default Top-K is 8 with up to 24,000 context characters. Broad queries can match 20,000 candidates while only 10,000 are scored; candidate truncation is reported and may reduce recall.',
'',
f'**Synthetic retrieval: {good}/{len(answerable)} answerable queries ({100*good/len(answerable):.1f}%) returned all expected sources.** {empty_good}/{len(empty)} additional unanswerable queries correctly returned empty context. This measures evidence retrieval, not generated-answer accuracy. Expansion adds neighboring sources, so it is not conventional chunk Recall@8. The bounded one-edit fallback can recover eligible typos but does not infer synonyms; see the category breakdown in BENCHMARK.md. A fast empty result is not a successful retrieval.',
'',
'### LoCoMo','',
'All 1,540 questions in categories 1–4 were run across ten conversations and 5,882 turns. The 446 adversarial category-5 questions were excluded. Retrieval used Top-K 20 within the full relevant conversation, followed by a 10,000-character cap in the evaluation harness. The engine retains its normal 24,000-character ceiling.',
'', '| Metric | Result |','| --- | ---: |',
f"| Complete annotated evidence in returned text | {ls['complete_evidence']}/{ls['questions_with_evidence']} — {100*ls['complete_evidence_rate']:.2f}% |",f"| Mean per-question evidence recall | {100*ls['mean_evidence_recall']:.2f}% |",f"| Retrieval p50 / p95 | {ls['p50_ms']:.2f} / {ls['p95_ms']:.2f} ms |",f"| Median context delivered for evaluation | {ls['median_context_chars']:,} characters |",f"| Disk storage for this corpus | {ls['disk_bytes']/1048576:.3f} MiB |",f"| Accumulated ingestion time | {ls['ingestion_ms']:.2f} ms |",f"| Process RSS after evaluation | {ls['rss_mib']:.2f} MiB |",'',
'Complete evidence requires the full text of every annotated support turn to survive in the returned context, normalizing whitespace only. Four questions without evidence annotations are excluded from the recall denominator but included in latency. Unresolved evidence IDs occur in three questions and count as missing. This conservative metric does not evaluate generated answers; partial turns or alternative evidence may still suffice for answering.',
'',
'Turns include speaker names, session timestamps and supplied image captions. Answers, evidence labels, observations and summaries are never indexed. Each conversation has one warm-up query, followed by one measured retrieval per question. Percentiles span 1,540 different questions. The final context cap and evidence evaluation occur outside the search timer. Evaluation RSS includes retained contexts and test data. No reader model or LLM judge was run.',
'',
'### Zep: published reference','',
'Zep was **not executed** in this evaluation. Its published LoCoMo figures are listed as external reference, with different quality metrics:','',
'| Configuration | Retrieval p50 / p95 | Context | Quality metric |','| --- | --- | --- | --- |',
f"| OmniMemory — measured locally | {ls['p50_ms']:.2f} / {ls['p95_ms']:.2f} ms | 10,000-character evaluation cap | {100*ls['complete_evidence_rate']:.2f}% complete evidence |",
'| Zep Auto Search — vendor-reported | 115 / 173 ms | 10,000-character cap; median 2,680 tokens | 86.5% answer accuracy |',
'| Zep Multi-scope — vendor-reported | 87 / 155 ms | median 5,760 tokens | 94.7% answer accuracy |','',
'The matching Auto Search character budget does not equalize infrastructure, network, corpus preparation or evaluation. Zep reports a gpt-5.4 reader and judge; no such answering stage was used here. Its published category distribution also differs from the official dataset snapshot used in this run. These results do not establish superiority over Zep, and the percentages must not be ranked against each other. No equivalent total-storage measurement was available.',
'',
'Sources: [official LoCoMo dataset](https://github.com/snap-research/locomo), [Zep research and methodology](https://www.getzep.com/research/), accessed October 1, 2026. Dataset SHA-256 and detailed methods are included in [BENCHMARK.md](BENCHMARK.md).','',
'```bash\nnode benchmark/run.mjs --current\nnode benchmark/locomo.mjs --current\npython3 benchmark/report.py\n```','']
readme=root.parent/'README.md';text=readme.read_text()
if '## Benchmarks\n' in text:
 a=text.index('## Benchmarks\n');b=text.index('## MCP tools\n',a);text=text[:a]+text[b:]
text=text.replace('## MCP tools\n','\n'.join(en)+'\n## MCP tools\n');readme.write_text(text)
print('Current-version benchmark documentation generated from recorded results.')

quick=root.parent/'COMECE_AQUI.md'
text=quick.read_text().split('## Resultados medidos')[0]
pt=lambda value,d=2:f'{value:.{d}f}'.replace('.',',')
timings={x['id']:x['p50_ms'] for x in r['timings']}
text+='## Resultados medidos\n\n'
text+=f"Na base sintética de 20 mil mensagens: {pt(s['disk_mib'])} MiB em disco, busca por ID com mediana de {pt(timings['exact_id'])} ms e busca numa conversa com mediana de {pt(timings['scoped_topic'])} ms. A abertura levou {pt(s['boot_ms']/1000)} s e o processo ocupou {pt(s['boot_rss_mib'])} MiB de RAM após abrir.\n\n"
text+=f"No LoCoMo foram executadas {ls['questions']} perguntas: evidência completa em {ls['complete_evidence']} das {ls['questions_with_evidence']} perguntas com anotações ({pt(100*ls['complete_evidence_rate'])}%), com busca mediana de {pt(ls['p50_ms'])} ms. Isso mede recuperação de evidência, não acerto de respostas da IA. Consulte [BENCHMARK.md](BENCHMARK.md) para todos os resultados, metodologia e a referência publicada do Zep.\n\n"
text+=f"A tolerância aceita uma edição em palavras de consulta com 5–32 letras quando não há correspondência exata no escopo. Não corrige códigos com números ou pontuação, termos curtos, múltiplos erros ou sinônimos. Nos testes sintéticos de typos: {sum(bool(x['all_evidence']) for x in quality['typo'])}/{len(quality['typo'])} casos recuperaram todas as fontes esperadas.\n"
quick.write_text(text)
