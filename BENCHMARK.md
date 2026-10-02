# OmniMemory — benchmarks

Este documento registra o desempenho e a recuperação de contexto do OmniMemory 1.3.0: persistência em JSONL, índice lexical em RAM e corte relativo de metade das correspondências do melhor resultado.

## Proposta e interpretação

O projeto pode ser descrito como uma ponte conceitual entre o **palácio da memória**, com informações em pontos que podem ser revisitados, e uma **memória consultável por agentes**, uso para o qual serviços como o Zep são uma referência. O bibliotecário da IA localiza fragmentos e traz o contexto ao redor; o agente interpreta as evidências. Esse posicionamento é uma metáfora de organização e acesso, não uma equivalência entre técnicas cognitivas e algoritmos nem uma classificação de desempenho em relação ao Zep.

A implementação usa palavras inteiras normalizadas e tenta uma edição quando a palavra não existe no escopo consultado. São aceitas inserção, remoção, substituição ou inversão de duas letras vizinhas em palavras de consulta com 5–32 letras. Códigos com números ou pontuação, palavras curtas e sequências hexadecimais longas exigem correspondência exata. Não há índice de bigramas ou de correções; as alternativas são consultadas no vocabulário existente durante a busca. O mínimo é metade das correspondências do melhor candidato, arredondada para cima: melhor com 10 exige pelo menos 5. Repetições contam uma vez e vizinhos são adicionados após o filtro. Os resultados abaixo medem essa recuperação lexical; não pressupõem busca semântica por embeddings, construção de grafo de conhecimento ou raciocínio pelo mecanismo de memória.

## Ambiente

Execução sintética: `2026-10-02T01:14:01.483Z` a `2026-10-02T01:14:05.449Z` (UTC).
Execução LoCoMo: `2026-10-02T01:14:50.053Z` a `2026-10-02T01:14:56.970Z` (UTC).
Node v24.19.0; linux; CPU AMD EPYC 9V74 80-Core Processor; 9 CPUs lógicas visíveis.

As medições ocorreram em 1 de outubro de 2026 no horário de São Paulo. São resultados de uma máquina e dos conjuntos especificados, não garantias de desempenho em outros ambientes. Nenhuma conversa pessoal foi usada.

## Base sintética: 20 mil mensagens

| Medida | Resultado |
| --- | ---: |
| Armazenamento em disco | 19.532 MiB |
| Importação inicial | 0.763 s |
| Atualizar dez mensagens | 2.491 ms |
| Reenviar dez mensagens sem mudança de conteúdo | 0.195 ms |
| Reabrir a memória e reconstruir o índice | 475.391 ms |
| RAM do processo após reabertura | 211.809 MiB |
| RAM do processo após consultas | 300.656 MiB |

### Latência de busca

| Consulta | p50 | p95 amostral |
| --- | ---: | ---: |
| Identificador exato | 0.110 ms | 0.152 ms |
| Hash exato | 0.045 ms | 0.076 ms |
| Tema de projeto na base inteira | 67.896 ms | 70.669 ms |
| Tema restrito a uma conversa | 6.345 ms | 9.318 ms |
| Identificador com erro: exige correspondência exata | 0.005 ms | 0.055 ms |
| Palavra com letras invertidas, restrita a uma conversa | 8.406 ms | 9.193 ms |
| Termos comuns na base inteira | 72.560 ms | 102.724 ms |
| Termo ausente | 0.100 ms | 0.129 ms |

Cada consulta teve uma execução de aquecimento e cinco medições. Com cinco observações, o p95 amostral corresponde ao máximo observado; não é uma estimativa robusta da cauda em produção.

### Protocolo de desempenho

- Corpus reproduzível de 20 mil mensagens, em conversas de 20 mensagens, com identificadores, hashes e termos técnicos; ingestão em lotes de 100.
- Uma medição de importação, uma atualização de dez mensagens e um reenvio sem mudança. Top-K 8 e orçamento normal de 24 mil caracteres nas consultas sintéticas.
- Reabertura medida em três processos separados, sem limpar o cache do sistema operacional. O cronômetro cobre abrir a memória e reconstruir o índice, sem o tempo de iniciar o processo Node.
- Disco medido após fechar o armazenamento, incluindo os registros da atualização. O diário guarda fontes e metadados; índices e fragmentos são reconstruídos na RAM. Revisões anteriores de fontes permanecem no diário até compactar.
- RAM é RSS do processo, não apenas tamanho do índice. A medição após consultas inclui o gerador do corpus e estruturas do teste. A medição de reabertura não carrega esse gerador. Nenhuma delas representa um pico garantido.
- Há limite de 10 mil candidatos pontuados. Nas buscas amplas desta base, 20 mil candidatos podem ser encontrados e somente 10 mil pontuados. O resultado informa essa truncagem; o limite pode reduzir recall.
- Tempos são locais: sem rede, HTTP, geração de resposta ou raciocínio do agente. Gravações, indexação e buscas são síncronas; buscas amplas podem ocupar o event loop.

## Recuperação sintética

**35 de 40 consultas respondíveis (87.5%) recuperaram todas as fontes esperadas.** Das 5 consultas adicionais sem resposta, 5 retornaram contexto vazio corretamente.

| Categoria | Resultado |
| --- | ---: |
| Fatos literais | 5/5 |
| Identificadores exatos | 5/5 |
| Erros de digitação | 5/5 |
| Paráfrases sem sobreposição lexical suficiente | 0/5 |
| Evidência em mensagem vizinha | 5/5 |
| Atualização de informação | 5/5 |
| Restrição por conversa | 5/5 |
| Evidências distribuídas | 5/5 |
| Consultas sem resposta: retorno vazio correto | 5/5 |

A métrica verifica as fontes esperadas no contexto retornado, incluindo vizinhos. Não é acurácia de respostas nem Recall@8 clássico de chunks: Top-K seleciona os hits antes da expansão. Os casos de atualização verificam a presença da informação nova, sem avaliar se uma IA escolheria a versão correta.

A tolerância cobre somente uma edição nas palavras elegíveis. Uma palavra exata já existente não é reinterpretada; alternativas ambíguas podem trazer trechos irrelevantes. Cinco casos sintéticos aprovados não demonstram cobertura de todos os erros de digitação. Paráfrases continuam dependendo de pistas lexicais suficientes. A latência de uma consulta sem resultado não representa uma recuperação bem-sucedida; veja a qualidade por categoria.

## LoCoMo: avaliação pública

Foram executadas **1,540 perguntas**, nas dez conversas do dataset, com **5,882 falas**. Categorias 1–4 incluídas; categoria 5, com 446 perguntas adversariais, excluída.

| Medida | Resultado |
| --- | ---: |
| Perguntas com toda a evidência anotada no contexto | 1027/1536 — 66.86% |
| Recall médio das evidências por pergunta | 72.65% |
| Latência p50 | 3.63 ms |
| Latência p95 | 5.46 ms |
| Contexto mediano entregue à avaliação | 10,000 caracteres |
| Armazenamento das 5.882 falas | 4.308 MiB |
| Tempo acumulado de ingestão | 301.30 ms |
| RAM do processo após o teste | 250.21 MiB |

### O que a métrica significa

**Evidência completa significa que todas as falas anotadas como suporte apareceram integralmente no contexto entregue. Não significa que uma IA respondeu corretamente.** O cálculo normaliza apenas espaços e exige o texto integral de cada fala; uma referência de fonte sem o texto correspondente após o corte não conta. É uma medida conservadora: parte de uma fala ou outra evidência pode bastar para responder.

Quatro perguntas sem evidência anotada ficam fora do denominador de recuperação, mas entram na latência. Três perguntas possuem pelo menos um identificador de evidência não resolvido no corpus; esses identificadores foram registrados e contados como não encontrados.

### Protocolo LoCoMo

- Fonte: arquivo oficial locomo10.json, do repositório Snap Research, incluído com atribuição e licença.
- SHA-256: `79fa87e90f04081343b8c8debecb80a9a6842b76a7aa537dc9fdf651ea698ff4`.
- Falas importadas em ordem, com IDs sequenciais, nome do falante, data da sessão e legenda de imagem quando fornecida. Respostas, anotações de evidência, observações e resumos não são indexados.
- Busca restrita à conversa inteira, incluindo todas as sessões. As conversas são adicionadas progressivamente ao corpus; cada pergunta consulta apenas sua conversa.
- Top-K 20 antes da expansão. O motor usa seu teto normal de 24 mil caracteres; o harness limita o texto entregue à avaliação a 10 mil caracteres.
- Uma pergunta de aquecimento por conversa e uma execução medida por pergunta. p50 e p95 são calculados entre as 1.540 consultas diferentes.
- O tempo de busca mede o motor; o corte final de texto e a verificação das evidências ocorrem depois do cronômetro. Não houve leitor ou juiz por LLM.
- A RAM ao final inclui corpus e contextos guardados pelo avaliador. O espaço em disco corresponde a esta base específica, não deve ser extrapolado como tamanho fixo por mensagem.

## Zep: referência externa

**O Zep não foi executado neste teste.** Os números abaixo são publicados pelo fornecedor, consultados em 1 de outubro de 2026. Não havia conexão autenticada disponível para uma execução direta.

| Sistema e configuração | Busca p50 / p95 | Contexto | Avaliação |
| --- | --- | --- | --- |
| OmniMemory — medido localmente | 3.63 / 5.46 ms | limite de 10.000 caracteres na avaliação | 66.86% de evidência completa |
| Zep Auto Search — publicado | 115 / 173 ms | limite de 10.000 caracteres; mediana de 2.680 tokens | 86,5% de acurácia de respostas |
| Zep Multi-scope — publicado | 87 / 155 ms | mediana de 5.760 tokens | 94,7% de acurácia de respostas |

A igualdade do limite de 10 mil caracteres aproxima o orçamento de contexto do Auto Search. Ela não iguala infraestrutura, rede, algoritmo, leitor ou método de avaliação. As porcentagens medem coisas diferentes e não devem ser usadas para declarar um vencedor.

O Zep informa leitor gpt-5.4 com reasoning=medium e juiz gpt-5.4. Multi-scope usa 20 edges, 10 nodes, 10 episodes, cinco thread summaries, cinco observations e cross-encoder; esses limites não equivalem a Top-K 20 de chunks.

A distribuição por categorias do snapshot oficial utilizado (282/321/96/841) difere da publicada pelo Zep. Não foi reproduzida a versão exata nem a preparação de dados do fornecedor. Também não foi localizado um número equivalente de armazenamento total do Zep para essas bases.

Uma comparação direta de qualidade exige o mesmo snapshot, perguntas, escopo e orçamento de contexto, além do mesmo modelo leitor, prompt e juiz. Latência de rede e custo de API devem ser registrados separadamente.

## Reprodução e arquivos

Na pasta OmniMemory, com Node.js 24 e Python 3:

```bash
npm install
npm test
node benchmark/run.mjs --current
node benchmark/locomo.mjs --current
python3 benchmark/report.py
```

Os comandos medem a implementação atual usando diretórios temporários, sem alterar o arquivo de memória do usuário. `run.mjs --current` usa 20 mil mensagens por padrão e grava `benchmark/results/current-performance.json`; o avaliador LoCoMo grava `benchmark/results/current-locomo.json`. O gerador produz este relatório, a seção de benchmarks do README, `current-summary.json` e `current-performance.csv` a partir desses registros. Gerar a documentação não executa o benchmark novamente.

Os JSON incluem amostras, perguntas, fontes e contextos retornados para inspeção. O dataset acompanha a licença em `benchmark/data/LoCoMo-LICENSE.txt`. Os registros atuais foram gerados com o código desta entrega. Resultados históricos preservados em outros JSON não descrevem necessariamente a implementação atual.

## Fontes

- [LoCoMo — Snap Research](https://github.com/snap-research/locomo): Maharana et al., Evaluating Very Long-Term Conversational Memory of LLM Agents, ACL 2024. Dataset CC BY-NC 4.0, utilizado aqui para avaliação não comercial.
- [Zep — métodos e resultados](https://www.getzep.com/research/): referência publicada pelo fornecedor; não é execução local.
