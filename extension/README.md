# Patch Terra Dourada Capture v3

Este patch corrige a captura para o DOM atual do ChatGPT.

Ele usa:

```text
[data-turn-key]
```

e identifica os papéis pelos rótulos:

```text
Você disse:
ChatGPT disse:
```

## Aplicar

Substitua apenas:

```text
terra-dourada-auto/extension/content.js
```

pelo `content.js` desta pasta.

Depois:

1. Abra `chrome://extensions`.
2. No card `Terra Dourada Chat Capture`, clique no botão de recarregar (↻).
3. Volte ao ChatGPT.
4. Pressione `Ctrl+R`.
5. Aguarde 2–3 segundos.
6. Abra `http://127.0.0.1:8787/status`.

`messages` deve ficar maior que zero.

Não substitua `background.js`, pois ele contém a chave local que corresponde ao seu servidor atual.
