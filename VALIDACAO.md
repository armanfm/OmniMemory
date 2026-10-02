# Validação — OmniMemory 1.3.0

Validado em 1 de outubro de 2026 (America/Sao_Paulo), Node.js 24.19.0, Linux.

## Código

30 testes automatizados aprovados com `npm test`. A suíte cobre captura e fila da extensão, integração com cliente MCP real, ranking por palavras e corte de metade, correspondência exata e tolerância limitada a typos, fontes, coleções, contexto, uploads, importações, exclusões, reinício e atualização incremental.

Os testes de typos verificam troca, remoção e inserção de letra, inversão de letras vizinhas, prioridade da palavra exata, proteção de termos curtos e códigos, restrição por conversa/coleção, atualização do vocabulário e corte de 10 para 5 com correção.

Há cobertura para listas numéricas de IDs, inclusive acima de 32 bits, e leitura em blocos de linhas grandes com Unicode.

Os testes verificam rollback do lote e do índice, falha de gravação antes da confirmação, exclusão mútua de escritores, leitura simultânea por snapshot, recuperação de gravação interrompida, rejeição de checksum inválido, compactação, backup e rejeição de arquivos em formato incompatível.

Também foi executado o servidor real com dados temporários: importação inicial do JSONL antigo, geração da configuração da extensão, status `storage=jsonl` e consulta pela CLI enquanto o servidor permanecia aberto.

## Desempenho e recuperação

Os resultados medidos e os comandos de reprodução estão em `BENCHMARK.md` e `benchmark/results/`. Foram usados dados sintéticos e o conjunto público LoCoMo; nenhuma conversa pessoal foi usada. Resultados publicados pelo Zep estão identificados como referência externa, não como execução local.

## Limites

A captura foi testada com simulações das APIs do Chrome e transporte MCP real em localhost. Não foi testada na instalação Windows nem no Chrome do usuário. Arquivos binários continuam sem extração de texto. Esta entrega não altera o plugin já instalado na conta nem o servidor que está rodando na máquina do usuário.

O índice ocupa RAM e é reconstruído ao iniciar. O diário admite um escritor por vez; pare o servidor para manutenção que altera dados. Leituras e backups pela CLI são snapshots do momento da abertura.
