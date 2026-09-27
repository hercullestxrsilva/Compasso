# Estado da implementação · 26/09/2026

## Correção: PDF importado em branco

- Reproduzida a página branca na versão anterior com `tests/fixtures/partitura-jpeg2000.pdf`, um documento sintético digitalizado. O console registrava imagem dependente indisponível.
- O build e o servidor de desenvolvimento agora incluem os decodificadores WebAssembly/fallbacks de PDF.js, CMaps, fontes padrão e perfis de cor. Os caminhos usam a versão instalada e os recursos ficam no mesmo servidor e no cache offline.
- Renderização em canvas temporário: a página visível só é substituída quando o desenho termina. Cancelamentos durante carregamento, mudança de página ou zoom não podem sobrescrever uma renderização mais recente.
- Erros de decodificação passam a ser reportados com opção de tentar novamente; o arquivo original é preservado.
- Verificação visual antes/depois no mesmo PDF: conteúdo agora visível; página girada e mudanças rápidas de zoom conferidas. A partitura específica da captura do usuário não estava disponível no navegador de teste; a confirmação nesse arquivo depende de reabri-lo no navegador do usuário.
- Verificação offline: após ativar o novo cache, o servidor isolado foi desligado; a aplicação foi recarregada e o PDF JPEG2000 voltou a exibir o conteúdo usando os decodificadores locais em cache.
- **28 testes em 6 arquivos aprovados**, incluindo quatro regressões de renderização; build aprovado. O fixture foi importado apenas no ambiente isolado `127.0.0.1:4190`, sem alterar o acervo do usuário.

## Navegação e tela cheia da partitura

- Botões de página anterior/próxima e indicação de página foram adicionados acima da partitura; os controles inferiores continuam disponíveis.
- O botão **Tela cheia** amplia a partitura para ocupar o visor, mantém ferramentas e controles à vista e oferece saída por botão ou Esc. Quando a API nativa de tela cheia não está disponível, a interface usa uma ampliação por CSS, inclusive no iPad.
- Verificação em PDF de duas páginas: navegação superior em ambos os sentidos, ampliação, saída pelo botão e por Esc, e largura de 1024 px de iPad. Build TypeScript/Vite aprovado. A implementação não altera partituras ou marcações armazenadas.

## Tamanho do texto e movimentação de anotações

- O formulário de texto permite escolher tamanho de fonte de 10 a 100; textos existentes podem ser selecionados e editados. O tamanho é mantido no backup e na exportação do PDF anotado; anotações antigas continuam com tamanho padrão 20.
- A ferramenta **Selecionar e mover** permite arrastar texto, caneta e marca-texto, inclusive com toque/caneta em telas sensíveis. O deslocamento preserva o formato do traço e impede que ele ultrapasse os limites da página. A barra de seleção reserva espaço fixo, mantendo a partitura parada no primeiro arraste.
- Verificação no navegador isolado com PDF sintético: criação de texto em tamanho 36, movimentação horizontal e vertical no primeiro arraste, edição para tamanho 52 e persistência após recarregar. **31 testes em 7 arquivos e build aprovados.** A validação em iPad físico ainda é necessária.

## Gravação e reprodução no Firefox

- A captura agora prioriza Ogg/Opus quando o navegador suporta o formato, evitando a escolha anterior de WebM no Firefox. A extensão dos blocos recuperados acompanha o formato real.
- Durante a captura, a interface exibe o microfone em uso, nível de entrada e alerta após cinco segundos sem sinal. Com mais de uma entrada disponível, é possível escolher o dispositivo para a próxima gravação. O cronômetro usa tempo real decorrido.
- Em **Evolução → Minhas gravações**, os arquivos existentes podem ser baixados ou convertidos para uma nova cópia WAV com duração definida; o original é preservado. A conversão verifica decodificação e sinal, não cria uma cópia quando não há áudio audível e limita o tamanho a 100 MB.
- Validação: WAV sintético de três segundos importado e convertido pela interface em origem isolada; ambas as versões exibiram duração e faixa navegável. Os **34 testes em 8 arquivos** e o build passaram. A tentativa de reproduzir áudio no navegador integrado encerrou a aba, como já ocorrera antes; a audição real e a captura no Firefox do usuário ainda precisam de teste no próprio dispositivo.

Foi entregue o Compasso 0.1, uma aplicação funcional local, não apenas uma maquete. O projeto usa React/TypeScript/Vite, IndexedDB/Dexie, PDF.js, SVG/Pointer Events, Web Audio e uma API Fastify opcional. O código está organizado por domínio para evoluir sem introduzir microsserviços prematuramente.

## Disponível

| Área        | Entrega                                                                                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repertório  | Cadastro, edição, exclusão, busca, etiquetas e três estados de estudo                                                                                         |
| Partituras  | PDF/imagem local, versões preservadas, paginação, zoom e exportação de PDF anotado                                                                            |
| Marcações   | Caneta, marca-texto, texto com tamanho ajustável, seleção e movimentação, apagar, desfazer/refazer e visibilidade por camada                                  |
| Trechos     | Seleção retangular, compassos informados pelo usuário, mão, objetivo, dificuldade, BPM e data de revisão                                                      |
| Prática     | Foco visual no trecho, metrônomo, compassos/subdivisões, repetição por segundos ou compassos, preparação, descanso, progressão de BPM e compassos silenciosos |
| Rotinas     | Lista ordenada de trechos com minutos, reordenação e preparação manual de cada passo                                                                          |
| Histórico   | Tempo ativo sem descansos/preparação, repetições concluídas, percepção e observação; sessão parcial salva periodicamente                                      |
| Aulas       | Registro, áudio importado, gravação via microfone, reprodução nativa com velocidade e notas com tempo                                                         |
| IA          | Endpoints reais de transcrição e resumo, propostas com evidência e aceitação humana; ativação depende de chave e autenticação                                 |
| Recuperação | Blocos de gravação a cada 3 segundos em IndexedDB e recuperação de captura interrompida                                                                       |
| Evolução    | Sessões, revisões por trecho, gravações de execução e exportação de pauta para próxima aula                                                                   |
| Dados       | Backup/restauração validada e transacional com mídias; solicitação de persistência e estimativa de armazenamento                                              |
| Nuvem       | Código e SQL para backups manuais privados em Supabase, com login de conta existente                                                                          |
| Instalação  | Manifesto, ícones, fontes locais e cache offline; servidor Node de produção e Dockerfile                                                                      |

## Validação realizada

- `npm test`: **34 testes, 8 arquivos, todos aprovados** após os ajustes de gravação.
- `npm run build`: TypeScript e compilação de produção aprovados. Avisos não bloqueantes de anotações de otimização de uma dependência Zod.
- Servidor de produção: página inicial e `/api/status` retornaram HTTP 200. Corrigido o uso da API de cabeçalhos do plugin de arquivos estáticos; teste de regressão verifica cabeçalhos e mais de 30 acessos sem o limite reservado à IA.
- Navegador: cadastro de peça de teste, importação de PDF sintético de duas páginas, desenho sobre a partitura e seleção de trecho.
- Navegador: ciclo a 120 BPM com 1 compasso, 2 repetições, preparação e descanso. A sessão terminou e registrou corretamente **4 segundos ativos**, excluindo preparação e pausa; observação persistida no histórico.
- Navegador: cadastro de aula, nota manual, transcrição manual e resposta explícita de indisponibilidade da IA sem credenciais.
- Navegador: upload de áudio sintético, exibição do player e controles. **Ao acionar a reprodução, a aba do navegador integrado encerrou inesperadamente**; não foi possível confirmar a reprodução. Validar em Chrome/Safari e no aparelho físico antes de considerar áudio homologado.
- Layout inspecionado nas dimensões 1366×1024 e 1024×1366, relacionadas ao uso de tablet. Isso não equivale a testar Safari/iPadOS/Apple Pencil.
- Verificação adicional em 390×844 sem rolagem horizontal na tela de prática. Navegação lateral fechada removida da interação e da árvore de acessibilidade. A exportação de backup acionada pela interface retornou confirmação, mas o salvamento do arquivo pelo navegador integrado não foi confirmado.
- Produção: interface indicou preparação offline concluída. O servidor foi desligado e a aba recarregada: a aplicação abriu pelo cache. Servidor reiniciado após o teste.
- Nenhum microfone real foi acionado, nenhum áudio pessoal foi enviado e nenhuma API paga foi chamada.

Os exemplos de QA ficam apenas no banco do navegador usado para desenvolvimento em `127.0.0.1:5188`. O endereço de produção `127.0.0.1:4188` começa sem dados fictícios. Os arquivos em `tests/fixtures` são sintéticos, sem valor como material didático.

## Limitações conhecidas

1. **Não há publicação HTTPS nem validação em iPad físico.** A instalação PWA, pressão/rejeição de palma, áudio em interrupções e retomada após suspensão devem ser testados no dispositivo.
2. O armazenamento é local por origem. A nuvem é backup manual; sincronização automática, resolução de conflitos e colaboração do professor permanecem futuras.
3. IA e Supabase não foram validados em serviços reais por falta das configurações. Autenticação/limites e interpretação de respostas foram testados com dados simulados.
4. A gravação é salva em blocos; o último bloco pode se perder em encerramento abrupto. Um fragmento recuperado pode ter metadados incompletos, dependendo do codec e do navegador. A recuperação precisa de teste real com Safari e gravações longas.
5. A sessão de prática tem checkpoints a cada aproximadamente 5 segundos de execução. Uma queda abrupta pode perder o período desde o último checkpoint e permanece registrada como parcial. Não há retomada automática de uma sessão após recarregar.
6. Pausar e continuar mantém a posição do metrônomo sem uma nova contagem de preparação. A seleção do PDF é visual e manual, sem entendimento das notas.
7. Uma seleção criada pela interface é um retângulo em uma página. Seleção contínua entre sistemas/páginas e andamento diferente por subtrecho ainda não existem.
8. A exportação de PDF usa fonte Helvetica padrão: caracteres sem suporte podem virar `?`. PDFs com rotações incomuns, CropBox deslocado, senha, grande volume ou formulários precisam de uma bateria específica de testes. As camadas são achatadas no PDF exportado; o original local continua preservado.
9. Limites de tamanho são explícitos na interface. O backup é um `.zip` com as mídias originais (até 4 GB, sem zip64), verificado por CRC e restaurado em uma única transação; cada cópia na nuvem aceita até 45 MB. No Safari o `.zip` pode ficar inteiro na memória durante a exportação: acervos grandes precisam de teste no iPad. A nuvem ainda guarda cópias inteiras, não objetos individuais.
10. Rotinas não avançam automaticamente. Revisões têm datas manuais, sem algoritmo adaptativo ou notificações em segundo plano.
11. A recuperação de senha/cadastro, gestão de cotas por usuário, orçamento persistente de IA, processamento longo com fila e limpeza programada de backups não estão implementados. O serviço atual é voltado a uma instalação pessoal inicial.
12. Dockerfile preparado, mas não executado. Não foi criado repositório remoto, CI externo ou deploy.

## Próximas entregas recomendadas

1. Disponibilizar HTTPS em infraestrutura do usuário e homologar iPad: páginas grandes, anotação com Apple Pencil, áudio, instalação, offline, interrupções e restauração entre aparelhos.
2. Configurar Supabase e IA, testar isolamento entre dois usuários e o caminho completo de uma aula real com autorização do usuário.
3. Melhorar gravação/transcrição longa com fila, divisão em blocos, deduplicação, progresso, cancelamento e controle de custo.
4. Sincronização incremental com fila local, revisão de conflitos e mídias por objeto; substituir snapshots para uso cotidiano entre aparelhos.
5. Exportação PDF mais fiel com fontes Unicode, seleção multipágina, pedal Bluetooth e modo tela cheia de partitura.
6. Rotinas com continuidade, revisões espaçadas, convite de professor e análise opcional de execução/MIDI apenas após estabilizar a base.
