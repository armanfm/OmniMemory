# OmniMemory — extensão Chrome

Execute `npm start` na raiz do projeto antes de carregar esta pasta. O servidor cria `config.js` com a conexão e uma chave local real.

No Chrome, abra `chrome://extensions`, habilite o modo do desenvolvedor e carregue esta pasta sem compactação. Desative a versão antiga e recarregue as páginas do ChatGPT.

A extensão usa uma fila persistente para mensagens ainda não confirmadas. A janela do ícone mostra o estado da captura e oferece uma tentativa manual de envio. Arquivos são enviados enquanto a página permanece aberta; os bytes de arquivos pendentes não ficam nessa fila persistente.

Somente mensagens carregadas na página são observáveis. A contagem exibida não confirma sincronização completa do histórico. Se o ChatGPT alterar seu DOM, a captura poderá precisar de adaptação.

Ao mudar porta ou chave do servidor, reinicie o servidor e recarregue a extensão e as páginas do ChatGPT para aplicar a nova configuração.
