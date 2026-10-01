# Terra Dourada Auto — ChatGPT + MCP + captura automática

Este projeto faz duas coisas:

1. **Extensão Chrome:** captura automaticamente mensagens visíveis do ChatGPT (`user` e `assistant`) e envia para o servidor local.
2. **Servidor Terra Dourada:** salva em JSONL, aplica o recall determinístico e expõe `search_memory` por MCP.

## Recall

A implementação usa a mesma direção do protótipo HTML:

- chunks ~800 caracteres
- normalização
- stopwords
- índice invertido
- match exato primeiro
- fallback fuzzy por prefixo + Jaccard de bigramas
- ranking determinístico
- 1 vizinho anterior + 2 posteriores
- fusão de janelas sobrepostas/adjacentes
- texto limpo para a LLM

## 1. Pare o servidor antigo

No terminal que está rodando o servidor antigo:

```powershell
Ctrl+C
```

## 2. Instale e rode esta versão

Abra esta pasta no VS Code:

```powershell
npm install
npm start
```

Você verá:

```text
Terra Dourada local: http://127.0.0.1:8787
MCP: http://127.0.0.1:8787/mcp
Captura automática: http://127.0.0.1:8787/capture/batch
Status: http://127.0.0.1:8787/status
```

## 3. Instale a extensão no Chrome

Abra:

```text
chrome://extensions
```

Ative **Modo do desenvolvedor**.

Clique **Carregar sem compactação**.

Escolha exatamente a pasta:

```text
terra-dourada-auto/extension
```

## 4. Recarregue o ChatGPT

Volte para a aba do ChatGPT e aperte:

```text
Ctrl+R
```

A extensão vai capturar as mensagens que estiverem presentes no DOM e continuará observando novas mensagens.

## 5. Confira se salvou

Abra no navegador:

```text
http://127.0.0.1:8787/status
```

O campo `messages` deve ser maior que 0.

O arquivo persistente fica em:

```text
data/messages.jsonl
```

## 6. MCP Inspector

O MCP continua em:

```text
http://127.0.0.1:8787/mcp
```

A tool é:

```text
search_memory
```

Não existe mais `store_turn`: a captura passou a ser automática.

## Importante

A extensão captura **mensagens que estão carregadas/presentes no DOM do ChatGPT**. Em conversas extremamente longas, se a interface não mantiver partes antigas carregadas no DOM, a extensão não consegue capturar algo que a própria página não entregou naquele momento.

A extensão usa `data-message-author-role` como seletor principal. Como a interface do ChatGPT pode mudar, esse seletor pode precisar ser atualizado no futuro.
