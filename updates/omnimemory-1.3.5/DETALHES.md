# OmniMemory Desktop 1.3.5

## Alterações

- Reaproveita o servidor MCP existente e conserva busca contextual, investigação, leitura de fontes e escopos; acrescenta `server_info` e `echo` para comprovar o modo real.
- Janela adicional com IPC restrito à própria janela e ao frame principal, isolamento de contexto, sandbox e política de conteúdo local.
- Credencial da OpenAI protegida por Electron safeStorage; sem fallback para texto simples. Arquivos de memórias e a chave do arquivo não são passados ao cliente do túnel.
- Processo oficial iniciado diretamente, sem shell. Argumentos usam referências a variáveis privadas do processo; dados do arquivo não são herdados no ambiente.
- MCP dedicado em loopback, sem rotas de captura, com segredo de leitura por execução. O desligamento invalida consultas e encerra conexões ativas; respostas tardias não reativam a conexão.
- Estado conectado depende de `last_success` e ausência de falhas na saúde do control plane, com identificação explícita de 401/403.
- A ponte antiga não inicia polling. Os módulos anteriores e suas correções de revogação permanecem, sem reativação automática.
- Cliente oficial Windows amd64 0.0.16 incluído, com LICENSE, NOTICE e licenças de terceiros. SHA256 do ZIP oficial: `edef7241b0c647fcb30f1a80ff376b6b25c51927960f257a3f01e21b17c2aba6`. SHA256 do executável: `4226bb74a72388147882881f29f79801b95e285d731a138071812e3aa6766571`.
- O build verifica o executável já incluído, e pode recuperar o release oficial se necessário. Não altera os processos existentes de preparação de mídia nem o construtor original de instalador.
- Atualizador aceita somente os hashes da base 1.3.4 enviada, com ou sem o pacote anterior de segurança. Mudanças posteriores bloqueiam a substituição; dependências de criptografia, busca e recuperação têm hashes protegidos.

## Limites da validação

A distribuição Windows completa (interface principal, mídia e construtor original) permanece no computador do usuário e não veio neste ZIP parcial. Esses arquivos não são sobrescritos. A compilação Windows e os testes adicionais do projeto inteiro são executados pelo atualizador nesse computador. A interface Electron completa e o instalador Windows não foram executados neste ambiente Linux.

Os testes locais com dois arquivos/dispositivos simulados não comprovam as associações administrativas entre duas contas reais na OpenAI. O plugin atual sem OAuth herda a autorização do túnel e do workspace; deve ficar restrito à conta/workspace pretendido. O segredo local autentica o processo do túnel, não substitui a autorização da OpenAI.

O transporte em produção usa HTTPS para a OpenAI. O teste nativo usa HTTP somente em loopback para o plano de controle simulado. A OpenAI é destinatária dos trechos usados pela IA. Não há alegação de sigilo contra a própria OpenAI ou de ausência absoluta de vazamentos.
