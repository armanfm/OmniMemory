# OmniMemory — comece aqui

O OmniMemory usa arquivos JSONL com índice em memória. Oferece busca com ranking por palavras da pergunta, ampliação de contexto, fila de reenvio e migração do histórico antigo.

Conceitualmente, o projeto faz uma ponte entre o palácio da memória — informações em pontos que podem ser revisitados — e uma memória consultável por agentes. O **bibliotecário da IA** organiza e recupera trechos; a IA interpreta o contexto retornado. A implementação faz busca lexical determinística por palavras inteiras normalizadas, com tolerância limitada a um erro de digitação quando falta uma correspondência exata. Não armazena bigramas. Se o melhor trecho corresponder a 10 palavras da busca, entram apenas os candidatos com pelo menos 5; repetições contam uma vez. O contexto vizinho é acrescentado depois desse filtro.

## 1. Confira o Node.js

No terminal:

```powershell
node -v
```

Use **Node.js 24 ou superior**. Os dados ficam em arquivos locais.

## 2. Preserve seus dados antigos

1. Pare o servidor antigo com **Ctrl+C**.
2. Extraia `OmniMemory.zip`.
3. Copie a pasta **data** do projeto antigo para dentro da nova pasta **OmniMemory**. Inclua `messages.jsonl`, `files.jsonl` e a pasta `files`, se existirem.
4. Mantenha a pasta antiga guardada enquanto verifica a migração.

O ZIP contém o código, sem suas conversas e sem dependências instaladas.

## 3. Inicie o OmniMemory

Abra a pasta **OmniMemory** no VS Code e execute no terminal dessa pasta:

```powershell
npm install
npm start
```

Na primeira execução, o sistema cria `data/omnimemory.jsonl` e importa os JSONL antigos encontrados. Em cada inicialização, reconstrói o índice na memória. Atualizações durante o uso afetam apenas as fontes alteradas.

A migração mostra um resumo. Linhas inválidas e arquivos não encontrados aparecem nas contagens desse resumo. Os JSONL originais permanecem preservados.

## 4. Atualize a extensão

1. Abra **chrome://extensions** no Chrome.
2. Desative a extensão antiga para evitar duas capturas simultâneas.
3. Ative **Modo do desenvolvedor**.
4. Clique em **Carregar sem compactação**.
5. Selecione a pasta **extension**, dentro de **OmniMemory**.
6. Recarregue a página do ChatGPT.

Inicie o servidor antes de instalar a extensão: ele gera a configuração local automaticamente. Não é necessário preencher chaves no código.

## 5. Confira o funcionamento

Abra:

```text
http://127.0.0.1:8787/status
```

O nome deve aparecer como **OmniMemory**, com `storage: jsonl`.

Escreva uma mensagem no ChatGPT e observe a contagem. No ícone da extensão, veja as mensagens observadas, a fila de envio e o último envio confirmado. Se o servidor estiver desligado, as mensagens ficam na fila local e são reenviadas quando a conexão voltar.

O endereço MCP continua:

```text
http://127.0.0.1:8787/mcp
```

A ferramenta principal continua sendo **search_memory**. Se sua conexão atual aponta para esse mesmo servidor por um túnel, mantenha o encaminhamento para a porta 8787. O nome do plugin já instalado no ChatGPT não muda apenas por renomear o servidor; esta entrega altera o projeto e a extensão.

## Como o contexto é selecionado

- Um trecho que corresponde a **três palavras da pergunta** vem antes de um que corresponde a duas.
- O mínimo é **metade das correspondências do melhor resultado, arredondada para cima**.
- Se o melhor corresponde a 8 palavras, ficam os resultados com 4 ou mais. Se corresponde a 7, também ficam os com 4 ou mais.
- A mesma regra vale para todos os resultados, inclusive identificadores. Uma busca por uma única palavra, endereço ou hash exige uma correspondência.
- O filtro conta palavras distintas da pergunta após normalização, incluindo aproximações aceitas; não conta o tamanho total do trecho. Ele é aplicado antes de acrescentar vizinhos.
- Frases curtas recebem contexto de parágrafos ou mensagens vizinhas, com uma meta de **40 palavras**, se houver material disponível.
- Há um teto de **24 mil caracteres** para o texto recuperado.
- O sistema não completa trechos com texto inventado nem favorece um trecho apenas por ser comprido.

## Comandos úteis

Abra outro terminal na pasta OmniMemory:

```powershell
npm run memory -- status
npm run memory -- list
npm run memory -- sources
npm run memory -- search "balanço de massa"
npm run memory -- duplicates
npm run memory -- backup
npm run memory -- help
```

A ajuda explica como criar coleções, importar `conversations.json`, ler fontes e remover registros. Use os IDs reais mostrados por `list` e `sources`.

Pare o servidor antes de executar comandos que alteram a memória: importações, coleções, exclusões, liberação de recaptura e compactação. Consultas e backups funcionam em outro terminal com o servidor aberto. Para compactar o arquivo:

```powershell
npm run memory -- compact
```

## O que ainda precisa saber

**Histórico:** abrir uma conversa não garante a captura de mensagens antigas que a página não carregou. O importador de exportações é uma alternativa para o texto do ramo atual da conversa.

**Arquivos:** TXT, Markdown, código e outros formatos textuais têm o conteúdo indexado. PDF, DOCX e imagens ficam guardados, mas esta versão pesquisa apenas seus nomes e metadados. Arquivos enviados antes de existir a URL da conversa ficam temporariamente na página; mantenha a página aberta e, se necessário, selecione-os novamente na conversa correta.

**Backups:** `backup` grava uma cópia JSONL do estado atual. Para guardar também os arquivos anexados, copie `data/files/`. Exclusões retiram conteúdo da memória ativa e bloqueiam a recaptura; o texto antigo permanece no diário até executar `compact`. Arquivos brutos, entradas antigas de migração e backups anteriores também permanecem no disco.

**Compatibilidade:** os testes foram executados no Linux com Node.js 24. A captura real no seu Chrome e a instalação no Windows precisam ser conferidas pelos passos acima.

**Operação:** o índice ocupa RAM e é reconstruído ao iniciar. Há apenas um processo escritor por arquivo. Confira os resultados medidos em `BENCHMARK.md`.

## Resultados medidos

Na base sintética de 20 mil mensagens: 19,53 MiB em disco, busca por ID com mediana de 0,11 ms e busca numa conversa com mediana de 6,34 ms. A abertura levou 0,48 s e o processo ocupou 211,81 MiB de RAM após abrir.

No LoCoMo foram executadas 1540 perguntas: evidência completa em 1027 das 1536 perguntas com anotações (66,86%), com busca mediana de 3,63 ms. Isso mede recuperação de evidência, não acerto de respostas da IA. Consulte [BENCHMARK.md](BENCHMARK.md) para todos os resultados, metodologia e a referência publicada do Zep.

A tolerância aceita uma edição em palavras de consulta com 5–32 letras quando não há correspondência exata no escopo. Não corrige códigos com números ou pontuação, termos curtos, múltiplos erros ou sinônimos. Nos testes sintéticos de typos: 5/5 casos recuperaram todas as fontes esperadas.
